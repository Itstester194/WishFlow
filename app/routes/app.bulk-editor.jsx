import { useEffect, useMemo, useState } from "react";
import {
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { buildProductQuery, fetchProductPage } from "../bulk-edit.server";
import { BATCH_SIZE, PAGE_SIZES, SORT_OPTIONS } from "../bulk-edit.shared";

/* ================================================================== */
/* Server                                                               */
/* ================================================================== */

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const sp = url.searchParams;

  const filters = {
    q: sp.get("q") || "",
    status: sp.get("status") || "",
    vendor: sp.get("vendor") || "",
    productType: sp.get("productType") || "",
    tag: sp.get("tag") || "",
  };
  const sort = SORT_OPTIONS[sp.get("sort")] ? sp.get("sort") : "title_asc";
  const perPageRaw = Number(sp.get("perPage"));
  const perPage = PAGE_SIZES.includes(perPageRaw) ? perPageRaw : 25;
  const query = buildProductQuery(filters);

  try {
    const page = await fetchProductPage(admin, {
      query,
      sort,
      perPage,
      after: sp.get("after"),
      before: sp.get("before"),
    });
    return { ...page, filters, sort, perPage, query, error: null };
  } catch (error) {
    return {
      products: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      totalCount: 0,
      countPrecision: "EXACT",
      filters,
      sort,
      perPage,
      query,
      error: error?.message || "Could not load products.",
    };
  }
};

/* ================================================================== */
/* Client helpers                                                       */
/* ================================================================== */

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "DRAFT", label: "Draft" },
  { value: "ARCHIVED", label: "Archived" },
];

const FIELD_OPTIONS = [
  { value: "price", label: "Price" },
  { value: "compareAtPrice", label: "Compare-at price" },
  { value: "status", label: "Status" },
  { value: "tags", label: "Tags" },
  { value: "vendor", label: "Vendor" },
  { value: "productType", label: "Product type" },
  { value: "title", label: "Title" },
  { value: "sku", label: "SKU" },
];

const NUMBER_OPS = [
  { value: "set", label: "Set to" },
  { value: "increase_pct", label: "Increase by %" },
  { value: "decrease_pct", label: "Decrease by %" },
  { value: "increase_amt", label: "Increase by amount" },
  { value: "decrease_amt", label: "Decrease by amount" },
];

const OPS_BY_FIELD = {
  price: NUMBER_OPS,
  compareAtPrice: [
    ...NUMBER_OPS,
    { value: "from_price_pct", label: "Set to price + %" },
    { value: "clear", label: "Remove compare-at price" },
  ],
  tags: [
    { value: "add", label: "Add tags" },
    { value: "remove", label: "Remove tags" },
    { value: "replace", label: "Replace all tags with" },
  ],
  title: [
    { value: "prefix", label: "Add text at start" },
    { value: "suffix", label: "Add text at end" },
    { value: "replace", label: "Find and replace" },
    { value: "remove_text", label: "Remove text" },
  ],
  sku: [
    { value: "prefix", label: "Add text at start" },
    { value: "suffix", label: "Add text at end" },
    { value: "replace", label: "Find and replace" },
    { value: "remove_text", label: "Remove text" },
  ],
  status: [{ value: "set", label: "Set to" }],
  vendor: [{ value: "set", label: "Set to" }],
  productType: [{ value: "set", label: "Set to" }],
};

const ROUNDING_OPTIONS = [
  { value: "none", label: "No rounding" },
  { value: "whole", label: "Nearest whole number" },
  { value: "00_up", label: "Round up to whole number" },
  { value: "99", label: "End in .99" },
  { value: "95", label: "End in .95" },
];

function numericId(gid) {
  return String(gid).split("/").pop();
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function callApi(body) {
  const response = await fetch("/api/bulk-edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    // fall through
  }
  if (!response.ok || json?.error) {
    throw new Error(json?.error || `Request failed (${response.status})`);
  }
  return json;
}

function describeOperation(op) {
  const field = FIELD_OPTIONS.find((f) => f.value === op.field)?.label || op.field;
  const opLabel = (OPS_BY_FIELD[op.field] || []).find((o) => o.value === op.op)?.label || "";
  const rounding =
    op.rounding && op.rounding !== "none"
      ? ` (${ROUNDING_OPTIONS.find((r) => r.value === op.rounding)?.label.toLowerCase()})`
      : "";
  switch (op.field) {
    case "price":
    case "compareAtPrice":
      if (op.op === "clear") return `${field}: remove`;
      return `${field}: ${opLabel.toLowerCase()} ${op.value}${rounding}`;
    case "status":
      return `Status: set to ${STATUS_OPTIONS.find((s) => s.value === op.value)?.label}`;
    case "vendor":
    case "productType":
      return op.value ? `${field}: set to "${op.value}"` : `${field}: clear`;
    case "tags":
      return `Tags: ${opLabel.toLowerCase()} "${op.value}"`;
    case "title":
    case "sku":
      if (op.op === "replace") return `${field}: replace "${op.find}" with "${op.value}"`;
      if (op.op === "remove_text") return `${field}: remove "${op.find}"`;
      return `${field}: ${opLabel.toLowerCase()} "${op.value}"`;
    default:
      return field;
  }
}

function validateOperationClient(op) {
  if (["price", "compareAtPrice"].includes(op.field) && op.op !== "clear") {
    if (op.value === "" || !Number.isFinite(Number(op.value))) return "Enter a valid number.";
    if (Number(op.value) < 0) return "Enter a positive number.";
  }
  if (op.field === "tags" && op.op !== "replace" && !op.value.trim()) {
    return "Enter at least one tag (comma separated).";
  }
  if (["title", "sku"].includes(op.field)) {
    if (["replace", "remove_text"].includes(op.op) && !op.find) return "Enter the text to find.";
    if (["prefix", "suffix"].includes(op.op) && !op.value) return "Enter the text to add.";
  }
  return null;
}

/* ================================================================== */
/* Page                                                                 */
/* ================================================================== */

export default function BulkEditor() {
  const data = useLoaderData();
  const { products, pageInfo, totalCount, countPrecision, filters, sort, perPage, query } = data;
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [, setSearchParams] = useSearchParams();

  const isLoading = navigation.state === "loading" || revalidator.state === "loading";

  /* ---------------- Filters ---------------- */
  const [filterDraft, setFilterDraft] = useState(filters);
  useEffect(() => setFilterDraft(filters), [filters]);

  function updateParams(changes, resetCursor = true) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(changes).forEach(([key, value]) => {
        if (value === "" || value === null || value === undefined) next.delete(key);
        else next.set(key, value);
      });
      if (resetCursor) {
        next.delete("after");
        next.delete("before");
      }
      return next;
    });
  }

  /* ---------------- Inline edits ---------------- */
  // edits = { [productId]: { fields: {title, status, ...}, variants: { [variantId]: {price, ...} } } }
  const [edits, setEdits] = useState({});
  const [expanded, setExpanded] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  const productById = useMemo(() => {
    const map = {};
    products.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [products]);

  const pageKey = `${query}|${sort}|${perPage}|${products.map((p) => p.id).join(",")}`;
  useEffect(() => {
    setSelected(new Set());
    setAllMatching(false);
    // Keep only edits for products still on the page
    setEdits((prev) => {
      const next = {};
      Object.keys(prev).forEach((id) => {
        if (productById[id]) next[id] = prev[id];
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  function originalField(product, key) {
    if (key === "tags") return product.tags.join(", ");
    return product[key] ?? "";
  }

  function fieldValue(product, key) {
    const edited = edits[product.id]?.fields?.[key];
    return edited !== undefined ? edited : originalField(product, key);
  }

  function variantValue(product, variant, key) {
    const edited = edits[product.id]?.variants?.[variant.id]?.[key];
    return edited !== undefined ? edited : variant[key] ?? "";
  }

  function isFieldDirty(product, key) {
    return edits[product.id]?.fields?.[key] !== undefined;
  }

  function isVariantDirty(product, variant, key) {
    return edits[product.id]?.variants?.[variant.id]?.[key] !== undefined;
  }

  function setField(product, key, value) {
    setEdits((prev) => {
      const entry = { fields: { ...(prev[product.id]?.fields || {}) }, variants: { ...(prev[product.id]?.variants || {}) } };
      const original = originalField(product, key);
      const same =
        key === "tags"
          ? value.split(",").map((t) => t.trim()).filter(Boolean).join(",") === product.tags.join(",")
          : value === original;
      if (same) delete entry.fields[key];
      else entry.fields[key] = value;
      return cleanEntry(prev, product.id, entry);
    });
  }

  function setVariantField(product, variant, key, value) {
    setEdits((prev) => {
      const entry = { fields: { ...(prev[product.id]?.fields || {}) }, variants: { ...(prev[product.id]?.variants || {}) } };
      const v = { ...(entry.variants[variant.id] || {}) };
      const original = variant[key] ?? "";
      const same =
        key === "sku"
          ? value === original
          : value === original || (value !== "" && original !== "" && Number(value) === Number(original));
      if (same) delete v[key];
      else v[key] = value;
      if (Object.keys(v).length) entry.variants[variant.id] = v;
      else delete entry.variants[variant.id];
      return cleanEntry(prev, product.id, entry);
    });
  }

  function cleanEntry(prev, productId, entry) {
    const next = { ...prev };
    if (Object.keys(entry.fields).length || Object.keys(entry.variants).length) next[productId] = entry;
    else delete next[productId];
    return next;
  }

  const dirtyProductIds = Object.keys(edits);
  const changeCount = dirtyProductIds.reduce((sum, id) => {
    const e = edits[id];
    return (
      sum +
      Object.keys(e.fields).length +
      Object.values(e.variants).reduce((s, v) => s + Object.keys(v).length, 0)
    );
  }, 0);
  const hasUnsaved = changeCount > 0;

  async function saveInline() {
    // Basic client validation
    for (const id of dirtyProductIds) {
      const p = productById[id];
      const e = edits[id];
      if (e.fields.title !== undefined && !e.fields.title.trim()) {
        shopify.toast.show(`Title can't be blank`, { isError: true });
        return;
      }
      for (const v of Object.values(e.variants)) {
        if (v.price !== undefined && (v.price === "" || !Number.isFinite(Number(v.price)) || Number(v.price) < 0)) {
          shopify.toast.show(`Invalid price on "${p?.title}"`, { isError: true });
          return;
        }
        if (v.compareAtPrice !== undefined && v.compareAtPrice !== "" && (!Number.isFinite(Number(v.compareAtPrice)) || Number(v.compareAtPrice) < 0)) {
          shopify.toast.show(`Invalid compare-at price on "${p?.title}"`, { isError: true });
          return;
        }
      }
    }

    const changes = dirtyProductIds.map((id) => ({
      id,
      title: productById[id]?.title,
      fields: edits[id].fields,
      variants: Object.entries(edits[id].variants).map(([vid, v]) => ({ id: vid, ...v })),
    }));

    setSaving(true);
    const failures = [];
    const succeeded = [];
    try {
      for (const batch of chunk(changes, BATCH_SIZE)) {
        const { results } = await callApi({ intent: "saveInline", changes: batch });
        results.forEach((r) => (r.ok ? succeeded.push(r.id) : failures.push(r)));
      }
    } catch (error) {
      failures.push({ title: "Save", error: error.message });
    }
    setSaving(false);

    setEdits((prev) => {
      const next = { ...prev };
      succeeded.forEach((id) => delete next[id]);
      return next;
    });
    setLastResult({
      label: "Saved table edits",
      total: changes.length,
      ok: succeeded.length,
      failures,
    });
    if (succeeded.length) {
      shopify.toast.show(`Saved ${succeeded.length} product${succeeded.length === 1 ? "" : "s"}`);
      revalidator.revalidate();
    }
    if (failures.length) shopify.toast.show(`${failures.length} product(s) failed to save`, { isError: true });
  }

  /* ---------------- Selection ---------------- */
  const [selected, setSelected] = useState(() => new Set());
  const [allMatching, setAllMatching] = useState(false);

  const allOnPageSelected = products.length > 0 && products.every((p) => selected.has(p.id));
  const someOnPageSelected = products.some((p) => selected.has(p.id));
  const selectedCount = allMatching ? totalCount ?? 0 : selected.size;

  function toggleAllOnPage() {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) products.forEach((p) => next.delete(p.id));
      else products.forEach((p) => next.add(p.id));
      return next;
    });
  }

  function toggleOne(id) {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setAllMatching(false);
  }

  /* ---------------- Bulk action ---------------- */
  const [bulk, setBulk] = useState({ field: "price", op: "set", value: "", find: "", rounding: "none" });
  const [bulkError, setBulkError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [job, setJob] = useState(null); // { label, total, done }
  const [lastResult, setLastResult] = useState(null);

  function setBulkField(field) {
    const firstOp = OPS_BY_FIELD[field][0].value;
    setBulk({ field, op: firstOp, value: field === "status" ? "ACTIVE" : "", find: "", rounding: "none" });
    setBulkError(null);
    setConfirming(false);
  }

  function startBulk() {
    if (selectedCount === 0) {
      setBulkError("Select at least one product first.");
      return;
    }
    const problem = validateOperationClient(bulk);
    if (problem) {
      setBulkError(problem);
      return;
    }
    setBulkError(null);
    setConfirming(true);
  }

  async function runBulk() {
    setConfirming(false);
    const operation = { ...bulk };
    const label = describeOperation(operation);
    setJob({ label, total: selectedCount, done: 0, phase: "Preparing…" });

    const failures = [];
    let ok = 0;
    let ids = [];
    try {
      ids = allMatching
        ? (await callApi({ intent: "collectIds", query })).ids
        : Array.from(selected);
      setJob({ label, total: ids.length, done: 0, phase: "Updating products…" });

      let done = 0;
      for (const batch of chunk(ids, BATCH_SIZE)) {
        const { results } = await callApi({ intent: "bulkApply", ids: batch, operation });
        results.forEach((r) => {
          if (r.ok) ok += 1;
          else failures.push({ ...r, title: r.title || productById[r.id]?.title || `Product ${numericId(r.id)}` });
        });
        done += batch.length;
        setJob({ label, total: ids.length, done, phase: "Updating products…" });
      }
    } catch (error) {
      failures.push({ title: "Bulk edit stopped", error: error.message });
    }

    setJob(null);
    setLastResult({ label, total: ids.length, ok, failures });
    shopify.toast.show(
      failures.length ? `Updated ${ok} products, ${failures.length} failed` : `Updated ${ok} products`,
      failures.length ? { isError: true } : undefined,
    );
    revalidator.revalidate();
  }

  const busy = saving || !!job;

  /* ---------------- Render ---------------- */
  const opsForField = OPS_BY_FIELD[bulk.field];
  const showRounding =
    ["price", "compareAtPrice"].includes(bulk.field) && bulk.op !== "clear" && bulk.op !== "set";
  const showFind = ["title", "sku"].includes(bulk.field) && ["replace", "remove_text"].includes(bulk.op);
  const showValue = !(bulk.field === "compareAtPrice" && bulk.op === "clear") && bulk.op !== "remove_text";

  const countLabel =
    totalCount === null
      ? ""
      : `${totalCount}${countPrecision === "AT_LEAST" ? "+" : ""} product${totalCount === 1 ? "" : "s"}`;

  return (
    <s-page heading="Bulk Product Editor" inlineSize="large">
      <style>{STYLES}</style>

      {data.error && (
        <s-banner tone="critical" heading="Couldn't load products">
          {data.error}
        </s-banner>
      )}

      {/* ------------------------------------------------ Filters */}
      <s-section heading="Find products">
        <form
          className="be-filters"
          onSubmit={(e) => {
            e.preventDefault();
            if (hasUnsaved) return;
            updateParams(filterDraft);
          }}
        >
          <label className="be-field be-field--wide">
            <span>Search</span>
            <input
              type="search"
              placeholder="Title, SKU, barcode…"
              value={filterDraft.q}
              onChange={(e) => setFilterDraft({ ...filterDraft, q: e.target.value })}
            />
          </label>
          <label className="be-field">
            <span>Status</span>
            <select
              value={filterDraft.status}
              onChange={(e) => setFilterDraft({ ...filterDraft, status: e.target.value })}
            >
              <option value="">Any</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="be-field">
            <span>Vendor</span>
            <input
              value={filterDraft.vendor}
              onChange={(e) => setFilterDraft({ ...filterDraft, vendor: e.target.value })}
            />
          </label>
          <label className="be-field">
            <span>Product type</span>
            <input
              value={filterDraft.productType}
              onChange={(e) => setFilterDraft({ ...filterDraft, productType: e.target.value })}
            />
          </label>
          <label className="be-field">
            <span>Tag</span>
            <input
              value={filterDraft.tag}
              onChange={(e) => setFilterDraft({ ...filterDraft, tag: e.target.value })}
            />
          </label>
          <div className="be-filter-actions">
            <button type="submit" className="be-btn be-btn--primary" disabled={hasUnsaved || busy}>
              Search
            </button>
            <button
              type="button"
              className="be-btn"
              disabled={hasUnsaved || busy}
              onClick={() => {
                const empty = { q: "", status: "", vendor: "", productType: "", tag: "" };
                setFilterDraft(empty);
                updateParams(empty);
              }}
            >
              Clear
            </button>
          </div>
        </form>
        {hasUnsaved && (
          <p className="be-hint">Save or discard your table edits before searching or changing pages.</p>
        )}
      </s-section>

      {/* ------------------------------------------------ Bulk actions */}
      <s-section heading="Bulk edit selected products">
        <div className="be-selection">
          {selectedCount > 0 ? (
            <>
              <strong>
                {selectedCount} product{selectedCount === 1 ? "" : "s"} selected
                {allMatching ? " (all matching your search)" : ""}
              </strong>
              {!allMatching && allOnPageSelected && totalCount > products.length && (
                <button type="button" className="be-link" onClick={() => setAllMatching(true)} disabled={busy}>
                  Select all {countLabel} matching this search
                </button>
              )}
              <button type="button" className="be-link" onClick={clearSelection} disabled={busy}>
                Clear selection
              </button>
            </>
          ) : (
            <span className="be-muted">Tick products in the table below, then choose what to change.</span>
          )}
        </div>

        <div className="be-bulk">
          <label className="be-field">
            <span>Field</span>
            <select value={bulk.field} onChange={(e) => setBulkField(e.target.value)} disabled={busy}>
              {FIELD_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          {opsForField.length > 1 && (
            <label className="be-field">
              <span>Action</span>
              <select
                value={bulk.op}
                onChange={(e) => {
                  setBulk({ ...bulk, op: e.target.value });
                  setConfirming(false);
                }}
                disabled={busy}
              >
                {opsForField.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {showFind && (
            <label className="be-field">
              <span>Find</span>
              <input
                value={bulk.find}
                onChange={(e) => setBulk({ ...bulk, find: e.target.value })}
                disabled={busy}
              />
            </label>
          )}

          {showValue && bulk.field === "status" && (
            <label className="be-field">
              <span>Status</span>
              <select value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })} disabled={busy}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {showValue && bulk.field !== "status" && (
            <label className="be-field">
              <span>
                {["price", "compareAtPrice"].includes(bulk.field)
                  ? bulk.op.endsWith("pct")
                    ? "Percent"
                    : "Amount"
                  : bulk.field === "tags"
                    ? "Tags (comma separated)"
                    : bulk.op === "replace"
                      ? "Replace with"
                      : "Value"}
              </span>
              <input
                type={["price", "compareAtPrice"].includes(bulk.field) ? "number" : "text"}
                step="0.01"
                min="0"
                placeholder={
                  ["vendor", "productType"].includes(bulk.field) ? "Leave empty to clear" : ""
                }
                value={bulk.value}
                onChange={(e) => setBulk({ ...bulk, value: e.target.value })}
                disabled={busy}
              />
            </label>
          )}

          {showRounding && (
            <label className="be-field">
              <span>Rounding</span>
              <select value={bulk.rounding} onChange={(e) => setBulk({ ...bulk, rounding: e.target.value })} disabled={busy}>
                {ROUNDING_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="be-filter-actions">
            <button
              type="button"
              className="be-btn be-btn--primary"
              onClick={startBulk}
              disabled={busy || selectedCount === 0 || hasUnsaved}
            >
              Apply to {selectedCount || 0} product{selectedCount === 1 ? "" : "s"}
            </button>
          </div>
        </div>

        {bulkError && <p className="be-error">{bulkError}</p>}
        {hasUnsaved && selectedCount > 0 && (
          <p className="be-hint">Save or discard your table edits before running a bulk edit.</p>
        )}

        {["price", "compareAtPrice", "sku"].includes(bulk.field) && (
          <p className="be-hint">This change is applied to every variant of each selected product.</p>
        )}

        {confirming && (
          <div className="be-confirm">
            <div>
              <strong>Confirm bulk edit</strong>
              <p>
                {describeOperation(bulk)} — on <strong>{selectedCount}</strong> product
                {selectedCount === 1 ? "" : "s"}. This can&apos;t be undone automatically.
              </p>
            </div>
            <div className="be-filter-actions">
              <button type="button" className="be-btn be-btn--primary" onClick={runBulk}>
                Yes, update products
              </button>
              <button type="button" className="be-btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {job && (
          <div className="be-progress">
            <div className="be-progress__text">
              <strong>{job.label}</strong>
              <span>
                {job.phase} {job.done} / {job.total}
              </span>
            </div>
            <div className="be-progress__bar">
              <div style={{ width: `${job.total ? Math.round((job.done / job.total) * 100) : 5}%` }} />
            </div>
            <p className="be-hint">Keep this page open until the update finishes.</p>
          </div>
        )}

        {lastResult && !job && (
          <div className={`be-result ${lastResult.failures.length ? "be-result--warn" : "be-result--ok"}`}>
            <div className="be-result__head">
              <strong>
                {lastResult.label}: {lastResult.ok} of {lastResult.total} product
                {lastResult.total === 1 ? "" : "s"} updated
              </strong>
              <button type="button" className="be-link" onClick={() => setLastResult(null)}>
                Dismiss
              </button>
            </div>
            {lastResult.failures.length > 0 && (
              <ul>
                {lastResult.failures.slice(0, 20).map((f, i) => (
                  <li key={`${f.id || "x"}-${i}`}>
                    <strong>{f.title || f.id}</strong>: {f.error}
                  </li>
                ))}
                {lastResult.failures.length > 20 && <li>…and {lastResult.failures.length - 20} more</li>}
              </ul>
            )}
          </div>
        )}
      </s-section>

      {/* ------------------------------------------------ Table */}
      <s-section padding="none">
        <div className="be-toolbar">
          <span className="be-muted">
            {countLabel}
            {isLoading ? " · Loading…" : ""}
          </span>
          <div className="be-toolbar__right">
            <label className="be-inline">
              Sort
              <select
                value={sort}
                disabled={hasUnsaved || busy}
                onChange={(e) => updateParams({ sort: e.target.value })}
              >
                {Object.entries(SORT_OPTIONS).map(([key, o]) => (
                  <option key={key} value={key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="be-inline">
              Per page
              <select
                value={perPage}
                disabled={hasUnsaved || busy}
                onChange={(e) => updateParams({ perPage: e.target.value })}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {hasUnsaved && (
          <div className="be-savebar">
            <span>
              {changeCount} unsaved change{changeCount === 1 ? "" : "s"} on {dirtyProductIds.length} product
              {dirtyProductIds.length === 1 ? "" : "s"}
            </span>
            <div className="be-filter-actions">
              <button type="button" className="be-btn" onClick={() => setEdits({})} disabled={saving}>
                Discard
              </button>
              <button type="button" className="be-btn be-btn--primary" onClick={saveInline} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        )}

        <div className={`be-table-wrap ${isLoading ? "be-loading" : ""}`}>
          <table className="be-table">
            <thead>
              <tr>
                <th className="be-col-check">
                  <input
                    type="checkbox"
                    aria-label="Select all products on this page"
                    checked={allOnPageSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allOnPageSelected && someOnPageSelected;
                    }}
                    onChange={toggleAllOnPage}
                    disabled={busy || products.length === 0}
                  />
                </th>
                <th className="be-col-img" aria-label="Image" />
                <th className="be-col-title">Title</th>
                <th>Status</th>
                <th>Vendor</th>
                <th>Product type</th>
                <th className="be-col-tags">Tags</th>
                <th className="be-col-money">Price</th>
                <th className="be-col-money">Compare-at</th>
                <th>SKU</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {products.length === 0 && (
                <tr>
                  <td colSpan={11} className="be-empty">
                    No products match this search.
                  </td>
                </tr>
              )}
              {products.map((product) => {
                const single = product.hasOnlyDefaultVariant || product.variantsCount === 1;
                const firstVariant = product.variants[0];
                const isOpen = expanded.has(product.id);
                const dirtyRow = !!edits[product.id];
                return (
                  <ProductRows
                    key={product.id}
                    product={product}
                    single={single}
                    firstVariant={firstVariant}
                    isOpen={isOpen}
                    dirtyRow={dirtyRow}
                    selected={allMatching || selected.has(product.id)}
                    busy={busy}
                    onToggleSelect={() => toggleOne(product.id)}
                    onToggleOpen={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(product.id)) next.delete(product.id);
                        else next.add(product.id);
                        return next;
                      })
                    }
                    fieldValue={(key) => fieldValue(product, key)}
                    isFieldDirty={(key) => isFieldDirty(product, key)}
                    setField={(key, value) => setField(product, key, value)}
                    variantValue={(variant, key) => variantValue(product, variant, key)}
                    isVariantDirty={(variant, key) => isVariantDirty(product, variant, key)}
                    setVariantField={(variant, key, value) => setVariantField(product, variant, key, value)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="be-pagination">
          <button
            type="button"
            className="be-btn"
            disabled={!pageInfo.hasPreviousPage || hasUnsaved || busy || isLoading}
            onClick={() =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("after");
                next.set("before", pageInfo.startCursor);
                return next;
              })
            }
          >
            ← Previous
          </button>
          <button
            type="button"
            className="be-btn"
            disabled={!pageInfo.hasNextPage || hasUnsaved || busy || isLoading}
            onClick={() =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("before");
                next.set("after", pageInfo.endCursor);
                return next;
              })
            }
          >
            Next →
          </button>
        </div>
      </s-section>
    </s-page>
  );
}

/* ================================================================== */
/* Table rows                                                           */
/* ================================================================== */

function ProductRows({
  product,
  single,
  firstVariant,
  isOpen,
  dirtyRow,
  selected,
  busy,
  onToggleSelect,
  onToggleOpen,
  fieldValue,
  isFieldDirty,
  setField,
  variantValue,
  isVariantDirty,
  setVariantField,
}) {
  const cls = (dirty) => (dirty ? "be-input be-input--dirty" : "be-input");
  const hiddenVariants = product.variantsCount - product.variants.length;

  return (
    <>
      <tr className={`${selected ? "be-row--selected" : ""} ${dirtyRow ? "be-row--dirty" : ""}`}>
        <td className="be-col-check">
          <input
            type="checkbox"
            aria-label={`Select ${product.title}`}
            checked={selected}
            onChange={onToggleSelect}
            disabled={busy}
          />
        </td>
        <td className="be-col-img">
          {product.image ? (
            <img src={product.image} alt={product.imageAlt} />
          ) : (
            <div className="be-img-placeholder" />
          )}
        </td>
        <td className="be-col-title">
          <input
            className={cls(isFieldDirty("title"))}
            value={fieldValue("title")}
            onChange={(e) => setField("title", e.target.value)}
            disabled={busy}
            aria-label="Title"
          />
        </td>
        <td>
          <select
            className={cls(isFieldDirty("status"))}
            value={fieldValue("status")}
            onChange={(e) => setField("status", e.target.value)}
            disabled={busy}
            aria-label="Status"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </td>
        <td>
          <input
            className={cls(isFieldDirty("vendor"))}
            value={fieldValue("vendor")}
            onChange={(e) => setField("vendor", e.target.value)}
            disabled={busy}
            aria-label="Vendor"
          />
        </td>
        <td>
          <input
            className={cls(isFieldDirty("productType"))}
            value={fieldValue("productType")}
            onChange={(e) => setField("productType", e.target.value)}
            disabled={busy}
            aria-label="Product type"
          />
        </td>
        <td className="be-col-tags">
          <input
            className={cls(isFieldDirty("tags"))}
            value={fieldValue("tags")}
            onChange={(e) => setField("tags", e.target.value)}
            disabled={busy}
            aria-label="Tags"
            placeholder="tag1, tag2"
          />
        </td>
        {single && firstVariant ? (
          <>
            <td className="be-col-money">
              <input
                type="number"
                step="0.01"
                min="0"
                className={cls(isVariantDirty(firstVariant, "price"))}
                value={variantValue(firstVariant, "price")}
                onChange={(e) => setVariantField(firstVariant, "price", e.target.value)}
                disabled={busy}
                aria-label="Price"
              />
            </td>
            <td className="be-col-money">
              <input
                type="number"
                step="0.01"
                min="0"
                className={cls(isVariantDirty(firstVariant, "compareAtPrice"))}
                value={variantValue(firstVariant, "compareAtPrice")}
                onChange={(e) => setVariantField(firstVariant, "compareAtPrice", e.target.value)}
                disabled={busy}
                aria-label="Compare-at price"
              />
            </td>
            <td>
              <input
                className={cls(isVariantDirty(firstVariant, "sku"))}
                value={variantValue(firstVariant, "sku")}
                onChange={(e) => setVariantField(firstVariant, "sku", e.target.value)}
                disabled={busy}
                aria-label="SKU"
              />
            </td>
          </>
        ) : (
          <td colSpan={3}>
            <button type="button" className="be-link" onClick={onToggleOpen}>
              {isOpen ? "▾ Hide" : "▸ Edit"} {product.variantsCount} variants
            </button>
          </td>
        )}
        <td>
          <s-link href={`shopify:admin/products/${numericId(product.id)}`} target="_blank">
            Open
          </s-link>
        </td>
      </tr>

      {!single &&
        isOpen &&
        product.variants.map((variant) => (
          <tr key={variant.id} className="be-variant-row">
            <td />
            <td />
            <td colSpan={5} className="be-variant-title">
              ↳ {variant.title}
            </td>
            <td className="be-col-money">
              <input
                type="number"
                step="0.01"
                min="0"
                className={cls(isVariantDirty(variant, "price"))}
                value={variantValue(variant, "price")}
                onChange={(e) => setVariantField(variant, "price", e.target.value)}
                disabled={busy}
                aria-label={`Price for ${variant.title}`}
              />
            </td>
            <td className="be-col-money">
              <input
                type="number"
                step="0.01"
                min="0"
                className={cls(isVariantDirty(variant, "compareAtPrice"))}
                value={variantValue(variant, "compareAtPrice")}
                onChange={(e) => setVariantField(variant, "compareAtPrice", e.target.value)}
                disabled={busy}
                aria-label={`Compare-at price for ${variant.title}`}
              />
            </td>
            <td>
              <input
                className={cls(isVariantDirty(variant, "sku"))}
                value={variantValue(variant, "sku")}
                onChange={(e) => setVariantField(variant, "sku", e.target.value)}
                disabled={busy}
                aria-label={`SKU for ${variant.title}`}
              />
            </td>
            <td />
          </tr>
        ))}

      {!single && isOpen && hiddenVariants > 0 && (
        <tr className="be-variant-row">
          <td />
          <td />
          <td colSpan={9} className="be-muted">
            {hiddenVariants} more variant{hiddenVariants === 1 ? "" : "s"} not shown — choose fewer products per
            page to see more, or use a bulk edit (bulk edits update every variant).
          </td>
        </tr>
      )}
    </>
  );
}

/* ================================================================== */
/* Styles                                                               */
/* ================================================================== */

const STYLES = `
  .be-filters, .be-bulk {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 12px;
    align-items: end;
  }
  .be-field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
  .be-field > span { color: #616161; font-weight: 500; }
  .be-field--wide { grid-column: span 2; }
  .be-field input, .be-field select, .be-inline select {
    font: inherit; font-size: 13px; padding: 6px 8px; min-height: 32px;
    border: 1px solid #8a8a8a; border-radius: 8px; background: #fff; color: #303030;
    width: 100%; box-sizing: border-box;
  }
  .be-field input:focus, .be-field select:focus, .be-input:focus {
    outline: 2px solid #005bd3; outline-offset: 1px;
  }
  .be-filter-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .be-btn {
    font: inherit; font-size: 13px; font-weight: 600; padding: 6px 12px; min-height: 32px;
    border-radius: 8px; border: 1px solid #c9c9c9; background: #fff; color: #303030; cursor: pointer;
    box-shadow: 0 1px 0 rgba(0,0,0,.05);
  }
  .be-btn:hover:not(:disabled) { background: #f7f7f7; }
  .be-btn--primary { background: #303030; color: #fff; border-color: #303030; }
  .be-btn--primary:hover:not(:disabled) { background: #1a1a1a; }
  .be-btn:disabled { opacity: .45; cursor: not-allowed; }
  .be-link {
    font: inherit; font-size: 13px; background: none; border: 0; padding: 0;
    color: #005bd3; cursor: pointer; text-decoration: underline;
  }
  .be-link:disabled { color: #8a8a8a; cursor: not-allowed; }
  .be-muted { color: #616161; font-size: 13px; }
  .be-hint { color: #616161; font-size: 12px; margin: 8px 0 0; }
  .be-error { color: #8e1f0b; font-size: 13px; margin: 8px 0 0; }
  .be-selection { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; font-size: 13px; }
  .be-confirm, .be-progress, .be-result {
    margin-top: 12px; padding: 12px; border-radius: 8px; font-size: 13px;
  }
  .be-confirm {
    background: #fff4e4; border: 1px solid #ffb800;
    display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap;
  }
  .be-confirm p { margin: 4px 0 0; }
  .be-progress { background: #f1f1f1; }
  .be-progress__text { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .be-progress__bar { height: 8px; background: #e3e3e3; border-radius: 4px; overflow: hidden; }
  .be-progress__bar > div { height: 100%; background: #005bd3; transition: width .3s ease; }
  .be-result--ok { background: #e8f8ee; border: 1px solid #a4e8bd; }
  .be-result--warn { background: #fff1ee; border: 1px solid #fdc9be; }
  .be-result__head { display: flex; justify-content: space-between; gap: 12px; }
  .be-result ul { margin: 8px 0 0; padding-left: 18px; }

  .be-toolbar {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    padding: 12px 16px; flex-wrap: wrap;
  }
  .be-toolbar__right { display: flex; gap: 12px; flex-wrap: wrap; }
  .be-inline { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #616161; }
  .be-inline select { width: auto; }
  .be-savebar {
    position: sticky; top: 0; z-index: 3;
    display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 10px 16px; background: #303030; color: #fff; font-size: 13px; font-weight: 600;
  }
  .be-savebar .be-btn { border-color: #fff; }
  .be-savebar .be-btn--primary { background: #fff; color: #303030; }

  .be-table-wrap { overflow-x: auto; border-top: 1px solid #e3e3e3; }
  .be-loading { opacity: .55; pointer-events: none; }
  .be-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 1100px; }
  .be-table th {
    text-align: left; font-weight: 600; color: #616161; background: #f7f7f7;
    padding: 8px; border-bottom: 1px solid #e3e3e3; white-space: nowrap;
  }
  .be-table td { padding: 6px 8px; border-bottom: 1px solid #ebebeb; vertical-align: middle; }
  .be-table tr.be-row--selected td { background: #f2f7fe; }
  .be-table tr.be-row--dirty td:first-child { box-shadow: inset 3px 0 0 #b98900; }
  .be-variant-row td { background: #fafafa; }
  .be-variant-title { color: #303030; padding-left: 16px !important; }
  .be-col-check { width: 32px; text-align: center; }
  .be-col-img { width: 44px; }
  .be-col-img img, .be-img-placeholder {
    width: 36px; height: 36px; object-fit: cover; border-radius: 6px; border: 1px solid #e3e3e3; display: block;
  }
  .be-img-placeholder { background: #f1f1f1; }
  .be-col-title { min-width: 220px; }
  .be-col-tags { min-width: 180px; }
  .be-col-money { width: 110px; }
  .be-input {
    font: inherit; font-size: 13px; width: 100%; box-sizing: border-box; min-height: 30px;
    padding: 4px 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #303030;
  }
  .be-input:hover:not(:disabled) { border-color: #c9c9c9; background: #fff; }
  .be-input:focus { background: #fff; border-color: #8a8a8a; }
  .be-input--dirty, .be-input--dirty:hover { background: #fff8db !important; border-color: #b98900 !important; }
  .be-empty { text-align: center; padding: 32px !important; color: #616161; }
  .be-pagination { display: flex; justify-content: center; gap: 8px; padding: 12px; }
  @media (max-width: 640px) { .be-field--wide { grid-column: span 1; } }
`;

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
