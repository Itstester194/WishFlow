// Server-side helpers for the Bulk Product Editor.
// All Shopify Admin GraphQL calls used by the editor live here.

import { BATCH_SIZE, PAGE_SIZES, SORT_OPTIONS } from "./bulk-edit.shared";

export { BATCH_SIZE, PAGE_SIZES, SORT_OPTIONS };

const STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"];

/* ------------------------------------------------------------------ */
/* Query building                                                       */
/* ------------------------------------------------------------------ */

function quote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Turns the filter values from the URL into a Shopify product search query. */
export function buildProductQuery({ q, status, vendor, productType, tag }) {
  const parts = [];
  if (q && q.trim()) parts.push(q.trim());
  if (status && STATUSES.includes(status.toUpperCase())) {
    parts.push(`status:${status.toLowerCase()}`);
  }
  if (vendor && vendor.trim()) parts.push(`vendor:${quote(vendor.trim())}`);
  if (productType && productType.trim()) {
    parts.push(`product_type:${quote(productType.trim())}`);
  }
  if (tag && tag.trim()) parts.push(`tag:${quote(tag.trim())}`);
  return parts.join(" AND ");
}



/* ------------------------------------------------------------------ */
/* Reading products                                                     */
/* ------------------------------------------------------------------ */

const LIST_QUERY = `#graphql
  query BulkEditorProducts(
    $first: Int
    $last: Int
    $after: String
    $before: String
    $query: String
    $sortKey: ProductSortKeys
    $reverse: Boolean
    $variantsFirst: Int!
  ) {
    productsCount(query: $query) {
      count
      precision
    }
    products(
      first: $first
      last: $last
      after: $after
      before: $before
      query: $query
      sortKey: $sortKey
      reverse: $reverse
    ) {
      nodes {
        id
        title
        handle
        status
        vendor
        productType
        tags
        hasOnlyDefaultVariant
        featuredMedia {
          preview {
            image {
              url(transform: { maxWidth: 80, maxHeight: 80 })
              altText
            }
          }
        }
        variantsCount {
          count
        }
        variants(first: $variantsFirst) {
          nodes {
            id
            title
            price
            compareAtPrice
            sku
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }`;

/**
 * Loads one page of products. The number of variants fetched per product is
 * scaled to the page size so the query stays under Shopify's cost limit.
 */
export async function fetchProductPage(admin, { query, sort, perPage, after, before }) {
  const sortOpt = SORT_OPTIONS[sort] || SORT_OPTIONS.title_asc;
  const variantsFirst = Math.min(100, Math.max(5, Math.floor(850 / perPage) - 4));

  const variables = {
    query: query || null,
    sortKey: sortOpt.sortKey,
    reverse: sortOpt.reverse,
    variantsFirst,
  };
  if (before) {
    variables.last = perPage;
    variables.before = before;
  } else {
    variables.first = perPage;
    if (after) variables.after = after;
  }

  const response = await admin.graphql(LIST_QUERY, { variables });
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  const products = json.data.products.nodes.map((p) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    status: p.status,
    vendor: p.vendor || "",
    productType: p.productType || "",
    tags: p.tags || [],
    hasOnlyDefaultVariant: p.hasOnlyDefaultVariant,
    image: p.featuredMedia?.preview?.image?.url || null,
    imageAlt: p.featuredMedia?.preview?.image?.altText || p.title,
    variantsCount: p.variantsCount?.count ?? p.variants.nodes.length,
    variants: p.variants.nodes.map((v) => ({
      id: v.id,
      title: v.title,
      price: v.price ?? "",
      compareAtPrice: v.compareAtPrice ?? "",
      sku: v.sku ?? "",
    })),
  }));

  return {
    products,
    pageInfo: json.data.products.pageInfo,
    totalCount: json.data.productsCount?.count ?? null,
    countPrecision: json.data.productsCount?.precision ?? "EXACT",
  };
}

/** Collects every product ID that matches a search query (for "select all"). */
export async function collectProductIds(admin, query, limit = 10000) {
  const ids = [];
  let after = null;
  let hasNext = true;
  while (hasNext && ids.length < limit) {
    const response = await admin.graphql(
      `#graphql
        query BulkEditorCollectIds($query: String, $after: String) {
          products(first: 250, after: $after, query: $query) {
            nodes { id }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { variables: { query: query || null, after } },
    );
    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }
    const conn = json.data.products;
    conn.nodes.forEach((n) => ids.push(n.id));
    hasNext = conn.pageInfo.hasNextPage;
    after = conn.pageInfo.endCursor;
  }
  return ids.slice(0, limit);
}

async function fetchProductForEdit(admin, id) {
  const response = await admin.graphql(
    `#graphql
      query BulkEditorProduct($id: ID!) {
        product(id: $id) {
          id
          title
          status
          vendor
          productType
          tags
          variants(first: 250) {
            nodes { id price compareAtPrice sku }
          }
        }
      }`,
    { variables: { id } },
  );
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data.product;
}

/* ------------------------------------------------------------------ */
/* Writing products                                                     */
/* ------------------------------------------------------------------ */

function userErrorText(userErrors) {
  if (!userErrors || userErrors.length === 0) return null;
  return userErrors
    .map((e) => (e.field ? `${[].concat(e.field).join(".")}: ${e.message}` : e.message))
    .join("; ");
}

async function updateProductFields(admin, id, fields) {
  const response = await admin.graphql(
    `#graphql
      mutation BulkEditorProductUpdate($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product { id }
          userErrors { field message }
        }
      }`,
    { variables: { product: { id, ...fields } } },
  );
  const json = await response.json();
  const err = userErrorText(json.data?.productUpdate?.userErrors);
  if (err) throw new Error(err);
}

async function updateVariants(admin, productId, variants) {
  if (!variants.length) return;
  const input = variants.map((v) => {
    const out = { id: v.id };
    if (v.price !== undefined) out.price = v.price;
    if (v.compareAtPrice !== undefined) out.compareAtPrice = v.compareAtPrice;
    if (v.sku !== undefined) out.inventoryItem = { sku: v.sku };
    return out;
  });
  const response = await admin.graphql(
    `#graphql
      mutation BulkEditorVariantsUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id }
          userErrors { field message }
        }
      }`,
    { variables: { productId, variants: input } },
  );
  const json = await response.json();
  const err = userErrorText(json.data?.productVariantsBulkUpdate?.userErrors);
  if (err) throw new Error(err);
}

async function changeTags(admin, id, tags, mode) {
  if (!tags.length) return;
  const mutation =
    mode === "add"
      ? `#graphql
        mutation BulkEditorTagsAdd($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
        }`
      : `#graphql
        mutation BulkEditorTagsRemove($id: ID!, $tags: [String!]!) {
          tagsRemove(id: $id, tags: $tags) { userErrors { field message } }
        }`;
  const response = await admin.graphql(mutation, { variables: { id, tags } });
  const json = await response.json();
  const key = mode === "add" ? "tagsAdd" : "tagsRemove";
  const err = userErrorText(json.data?.[key]?.userErrors);
  if (err) throw new Error(err);
}

function errorMessage(error) {
  // GraphqlQueryError from the Shopify library carries the response body.
  const gqlErrors = error?.body?.errors?.graphQLErrors || error?.body?.errors;
  if (Array.isArray(gqlErrors) && gqlErrors.length) {
    return gqlErrors.map((e) => e.message).join("; ");
  }
  return error?.message || String(error);
}

/* ------------------------------------------------------------------ */
/* Bulk operations                                                      */
/* ------------------------------------------------------------------ */

export function parseTagList(value) {
  return String(value || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function roundPrice(value, rounding) {
  let v = Math.max(0, value);
  switch (rounding) {
    case "whole":
      v = Math.round(v);
      break;
    case "99":
      v = Math.floor(v) + 0.99;
      break;
    case "95":
      v = Math.floor(v) + 0.95;
      break;
    case "00_up":
      v = Math.ceil(v);
      break;
    default:
      break;
  }
  return Math.max(0, v).toFixed(2);
}

function adjustNumber(current, op, amount) {
  const base = Number(current) || 0;
  switch (op) {
    case "set":
      return amount;
    case "increase_pct":
      return base * (1 + amount / 100);
    case "decrease_pct":
      return base * (1 - amount / 100);
    case "increase_amt":
      return base + amount;
    case "decrease_amt":
      return base - amount;
    default:
      return base;
  }
}

function replaceAll(text, find, replaceWith) {
  if (!find) return text;
  return String(text).split(find).join(replaceWith ?? "");
}

/** Validates an operation sent from the browser. Returns an error string or null. */
export function validateOperation(op) {
  if (!op || typeof op !== "object") return "Missing operation.";
  const numericOps = ["set", "increase_pct", "decrease_pct", "increase_amt", "decrease_amt"];
  switch (op.field) {
    case "price":
      if (!numericOps.includes(op.op)) return "Choose how to change the price.";
      if (!Number.isFinite(Number(op.value)) || op.value === "") return "Enter a number.";
      return null;
    case "compareAtPrice":
      if (op.op === "clear") return null;
      if (![...numericOps, "from_price_pct"].includes(op.op)) {
        return "Choose how to change the compare-at price.";
      }
      if (!Number.isFinite(Number(op.value)) || op.value === "") return "Enter a number.";
      return null;
    case "status":
      return STATUSES.includes(op.value) ? null : "Choose a status.";
    case "vendor":
    case "productType":
      return null; // empty value clears the field
    case "tags":
      if (!["add", "remove", "replace"].includes(op.op)) return "Choose a tag action.";
      if (op.op !== "replace" && parseTagList(op.value).length === 0) {
        return "Enter at least one tag.";
      }
      return null;
    case "title":
    case "sku":
      if (!["prefix", "suffix", "replace", "remove_text"].includes(op.op)) {
        return "Choose a text action.";
      }
      if (op.op === "replace" || op.op === "remove_text") {
        return op.find ? null : "Enter the text to find.";
      }
      return op.value ? null : "Enter the text to add.";
    default:
      return "Unknown field.";
  }
}

function transformText(current, op) {
  const text = current ?? "";
  switch (op.op) {
    case "prefix":
      return `${op.value}${text}`;
    case "suffix":
      return `${text}${op.value}`;
    case "replace":
      return replaceAll(text, op.find, op.value);
    case "remove_text":
      return replaceAll(text, op.find, "");
    default:
      return text;
  }
}

/** Applies one bulk operation to one product. Returns a short summary of what changed. */
async function applyOperationToProduct(admin, id, op) {
  const product = await fetchProductForEdit(admin, id);
  if (!product) throw new Error("Product not found (it may have been deleted).");

  const amount = Number(op.value);

  switch (op.field) {
    case "price": {
      const variants = product.variants.nodes.map((v) => ({
        id: v.id,
        price: roundPrice(adjustNumber(v.price, op.op, amount), op.rounding),
      }));
      const changed = variants.filter(
        (v, i) => Number(v.price) !== Number(product.variants.nodes[i].price),
      );
      await updateVariants(admin, product.id, changed);
      return { product, changed: changed.length };
    }
    case "compareAtPrice": {
      const variants = product.variants.nodes.map((v) => {
        if (op.op === "clear") return { id: v.id, compareAtPrice: null };
        if (op.op === "from_price_pct") {
          return {
            id: v.id,
            compareAtPrice: roundPrice(Number(v.price) * (1 + amount / 100), op.rounding),
          };
        }
        const current = v.compareAtPrice ?? v.price;
        return {
          id: v.id,
          compareAtPrice: roundPrice(adjustNumber(current, op.op, amount), op.rounding),
        };
      });
      await updateVariants(admin, product.id, variants);
      return { product, changed: variants.length };
    }
    case "sku": {
      const variants = product.variants.nodes.map((v) => ({
        id: v.id,
        sku: transformText(v.sku, op),
      }));
      const changed = variants.filter((v, i) => v.sku !== (product.variants.nodes[i].sku ?? ""));
      await updateVariants(admin, product.id, changed);
      return { product, changed: changed.length };
    }
    case "status":
      if (product.status !== op.value) {
        await updateProductFields(admin, product.id, { status: op.value });
      }
      return { product, changed: 1 };
    case "vendor":
      await updateProductFields(admin, product.id, { vendor: String(op.value ?? "").trim() });
      return { product, changed: 1 };
    case "productType":
      await updateProductFields(admin, product.id, {
        productType: String(op.value ?? "").trim(),
      });
      return { product, changed: 1 };
    case "tags": {
      const tags = parseTagList(op.value);
      if (op.op === "replace") {
        await updateProductFields(admin, product.id, { tags });
      } else {
        await changeTags(admin, product.id, tags, op.op);
      }
      return { product, changed: 1 };
    }
    case "title": {
      const title = transformText(product.title, op).trim();
      if (!title) throw new Error("Resulting title would be empty.");
      if (title !== product.title) {
        await updateProductFields(admin, product.id, { title });
      }
      return { product, changed: 1 };
    }
    default:
      throw new Error("Unknown field.");
  }
}

/** Runs a bulk operation over a batch of product IDs, one product at a time. */
export async function applyBulkOperation(admin, ids, op) {
  const results = [];
  for (const id of ids) {
    try {
      const { product } = await applyOperationToProduct(admin, id, op);
      results.push({ id, title: product.title, ok: true });
    } catch (error) {
      results.push({ id, ok: false, error: errorMessage(error) });
    }
  }
  return results;
}

/**
 * Saves the edits made directly in the table.
 * changes: [{ id, title?, fields: {title,status,vendor,productType,tags}, variants: [{id, price?, compareAtPrice?, sku?}] }]
 */
export async function saveInlineChanges(admin, changes) {
  const results = [];
  for (const change of changes) {
    try {
      const fields = {};
      const f = change.fields || {};
      if (f.title !== undefined) {
        if (!String(f.title).trim()) throw new Error("Title can't be blank.");
        fields.title = String(f.title).trim();
      }
      if (f.status !== undefined) {
        if (!STATUSES.includes(f.status)) throw new Error("Invalid status.");
        fields.status = f.status;
      }
      if (f.vendor !== undefined) fields.vendor = String(f.vendor).trim();
      if (f.productType !== undefined) fields.productType = String(f.productType).trim();
      if (f.tags !== undefined) fields.tags = parseTagList(f.tags);

      if (Object.keys(fields).length) {
        await updateProductFields(admin, change.id, fields);
      }

      const variants = (change.variants || []).map((v) => {
        const out = { id: v.id };
        if (v.price !== undefined) {
          const n = Number(v.price);
          if (v.price === "" || !Number.isFinite(n) || n < 0) {
            throw new Error(`Invalid price "${v.price}".`);
          }
          out.price = n.toFixed(2);
        }
        if (v.compareAtPrice !== undefined) {
          if (v.compareAtPrice === "" || v.compareAtPrice === null) {
            out.compareAtPrice = null;
          } else {
            const n = Number(v.compareAtPrice);
            if (!Number.isFinite(n) || n < 0) {
              throw new Error(`Invalid compare-at price "${v.compareAtPrice}".`);
            }
            out.compareAtPrice = n.toFixed(2);
          }
        }
        if (v.sku !== undefined) out.sku = String(v.sku).trim();
        return out;
      });
      await updateVariants(admin, change.id, variants);

      results.push({ id: change.id, title: change.title, ok: true });
    } catch (error) {
      results.push({ id: change.id, title: change.title, ok: false, error: errorMessage(error) });
    }
  }
  return results;
}
