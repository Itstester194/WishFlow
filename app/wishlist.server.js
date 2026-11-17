// WishFlow — server-side wishlist logic shared by the storefront API
// (app proxy) and the admin pages.
import { randomBytes } from "node:crypto";
import db from "./db.server";

export const MAX_ITEMS_PER_WISHLIST = 500;
const GUEST_ID_RE = /^[a-zA-Z0-9-]{16,64}$/;
const NUMERIC_ID_RE = /^\d{1,20}$/;
const HANDLE_RE = /^[^\s/?#]{1,255}$/;

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

export function numericId(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).split("/").pop();
  return NUMERIC_ID_RE.test(str) ? str : null;
}

export function isValidGuestId(value) {
  return typeof value === "string" && GUEST_ID_RE.test(value);
}

export function isValidHandle(value) {
  return typeof value === "string" && HANDLE_RE.test(value);
}

function newShareToken() {
  return randomBytes(12).toString("base64url");
}

/**
 * Works out who is asking. A logged-in customer ID comes from the app proxy
 * signature (Shopify adds logged_in_customer_id and signs the request), so it
 * can be trusted. Guests send a random ID generated in their browser.
 */
export function resolveOwner({ customerId, guestId }) {
  const cid = numericId(customerId);
  if (cid) return { ownerType: "customer", ownerId: cid };
  if (isValidGuestId(guestId)) return { ownerType: "guest", ownerId: guestId };
  return null;
}

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

function serialize(wishlist) {
  if (!wishlist) return { items: [], count: 0, shareToken: null };
  const items = wishlist.items
    .slice()
    .sort((a, b) => b.addedAt - a.addedAt)
    .map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      handle: i.handle,
      addedAt: i.addedAt.toISOString(),
    }));
  return { items, count: items.length, shareToken: wishlist.shareToken };
}

async function findWishlist(shop, owner) {
  return db.wishlist.findUnique({
    where: {
      shop_ownerType_ownerId: { shop, ownerType: owner.ownerType, ownerId: owner.ownerId },
    },
    include: { items: true },
  });
}

async function findOrCreateWishlist(shop, owner) {
  const existing = await findWishlist(shop, owner);
  if (existing) return existing;
  try {
    return await db.wishlist.create({
      data: { shop, ...owner, shareToken: newShareToken() },
      include: { items: true },
    });
  } catch {
    // Created by a parallel request
    return findWishlist(shop, owner);
  }
}

export async function getWishlist(shop, owner) {
  return serialize(await findWishlist(shop, owner));
}

export async function getSharedWishlist(shop, shareToken) {
  if (typeof shareToken !== "string" || shareToken.length > 64) return null;
  const wishlist = await db.wishlist.findFirst({
    where: { shop, shareToken },
    include: { items: true },
  });
  return wishlist ? serialize(wishlist) : null;
}

/**
 * When a guest logs in, move their guest wishlist into their customer wishlist.
 */
export async function mergeGuestIntoCustomer(shop, guestId, customerOwner) {
  if (!isValidGuestId(guestId)) return;
  const guest = await findWishlist(shop, { ownerType: "guest", ownerId: guestId });
  if (!guest) return;

  if (guest.items.length) {
    const target = await findOrCreateWishlist(shop, customerOwner);
    const existing = new Set(target.items.map((i) => i.productId));
    const room = MAX_ITEMS_PER_WISHLIST - target.items.length;
    const toMove = guest.items.filter((i) => !existing.has(i.productId)).slice(0, Math.max(0, room));
    for (const item of toMove) {
      await db.wishlistItem.create({
        data: {
          wishlistId: target.id,
          shop,
          productId: item.productId,
          variantId: item.variantId,
          handle: item.handle,
          addedAt: item.addedAt,
        },
      }).catch(() => {});
    }
    await db.wishlist.update({ where: { id: target.id }, data: { updatedAt: new Date() } });
  }
  await db.wishlist.delete({ where: { id: guest.id } }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Writing                                                              */
/* ------------------------------------------------------------------ */

async function logEvent(shop, owner, type, productId = null) {
  await db.wishlistEvent
    .create({ data: { shop, type, productId, ownerType: owner.ownerType, ownerId: owner.ownerId } })
    .catch(() => {});
}

export async function addItem(shop, owner, { productId, variantId, handle }) {
  const pid = numericId(productId);
  if (!pid) throw new Error("Invalid product.");
  if (!isValidHandle(handle)) throw new Error("Invalid product handle.");
  const vid = numericId(variantId);

  const wishlist = await findOrCreateWishlist(shop, owner);
  const already = wishlist.items.find((i) => i.productId === pid);
  if (already) {
    if (vid && already.variantId !== vid) {
      await db.wishlistItem.update({ where: { id: already.id }, data: { variantId: vid } });
    }
  } else {
    if (wishlist.items.length >= MAX_ITEMS_PER_WISHLIST) {
      throw new Error("Your wishlist is full.");
    }
    await db.wishlistItem
      .create({ data: { wishlistId: wishlist.id, shop, productId: pid, variantId: vid, handle } })
      .catch(() => {});
    await logEvent(shop, owner, "add", pid);
  }
  await db.wishlist.update({ where: { id: wishlist.id }, data: { updatedAt: new Date() } });
  return getWishlist(shop, owner);
}

export async function removeItem(shop, owner, { productId, handle }) {
  const wishlist = await findWishlist(shop, owner);
  if (!wishlist) return serialize(null);
  const pid = numericId(productId);
  const item = wishlist.items.find((i) => (pid && i.productId === pid) || (handle && i.handle === handle));
  if (item) {
    await db.wishlistItem.delete({ where: { id: item.id } }).catch(() => {});
    await db.wishlist.update({ where: { id: wishlist.id }, data: { updatedAt: new Date() } });
    await logEvent(shop, owner, "remove", item.productId);
  }
  return getWishlist(shop, owner);
}

export async function clearWishlist(shop, owner) {
  const wishlist = await findWishlist(shop, owner);
  if (wishlist) {
    await db.wishlistItem.deleteMany({ where: { wishlistId: wishlist.id } });
    await db.wishlist.update({ where: { id: wishlist.id }, data: { updatedAt: new Date() } });
    await logEvent(shop, owner, "clear");
  }
  return getWishlist(shop, owner);
}

const TRACKABLE = new Set(["add_to_cart", "share"]);

export async function trackEvent(shop, owner, type, productId) {
  if (!TRACKABLE.has(type)) return;
  await logEvent(shop, owner || { ownerType: "guest", ownerId: "anonymous" }, type, numericId(productId));
}

/* ------------------------------------------------------------------ */
/* Privacy / compliance                                                 */
/* ------------------------------------------------------------------ */

export async function redactCustomer(shop, customerId) {
  const cid = numericId(customerId);
  if (!cid) return;
  await db.wishlist.deleteMany({ where: { shop, ownerType: "customer", ownerId: cid } });
  await db.wishlistEvent.deleteMany({ where: { shop, ownerType: "customer", ownerId: cid } });
}

export async function redactShop(shop) {
  await db.wishlistItem.deleteMany({ where: { shop } });
  await db.wishlist.deleteMany({ where: { shop } });
  await db.wishlistEvent.deleteMany({ where: { shop } });
  await db.priceChange.deleteMany({ where: { shop } });
}

export async function customerDataReport(shop, customerId) {
  const cid = numericId(customerId);
  if (!cid) return null;
  return getWishlist(shop, { ownerType: "customer", ownerId: cid });
}

/* ------------------------------------------------------------------ */
/* Admin reporting                                                      */
/* ------------------------------------------------------------------ */

function daysAgo(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

export async function dashboardStats(shop) {
  const since30 = daysAgo(29);
  const [
    activeWishlists,
    customerWishlists,
    totalItems,
    productGroups,
    adds30,
    carts30,
    shares30,
    addEvents,
    topProducts,
    recentEvents,
    priceChanges,
  ] = await Promise.all([
    db.wishlist.count({ where: { shop, items: { some: {} } } }),
    db.wishlist.count({ where: { shop, ownerType: "customer", items: { some: {} } } }),
    db.wishlistItem.count({ where: { shop } }),
    db.wishlistItem.groupBy({ by: ["productId"], where: { shop } }),
    db.wishlistEvent.count({ where: { shop, type: "add", createdAt: { gte: since30 } } }),
    db.wishlistEvent.count({ where: { shop, type: "add_to_cart", createdAt: { gte: since30 } } }),
    db.wishlistEvent.count({ where: { shop, type: "share", createdAt: { gte: since30 } } }),
    db.wishlistEvent.findMany({
      where: { shop, type: "add", createdAt: { gte: since30 } },
      select: { createdAt: true },
    }),
    db.wishlistItem.groupBy({
      by: ["productId"],
      where: { shop },
      _count: { productId: true },
      orderBy: { _count: { productId: "desc" } },
      take: 10,
    }),
    db.wishlistEvent.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    db.priceChange.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  // Daily adds for the last 30 days
  const daily = [];
  const byDay = {};
  addEvents.forEach((e) => {
    const key = e.createdAt.toISOString().slice(0, 10);
    byDay[key] = (byDay[key] || 0) + 1;
  });
  for (let i = 29; i >= 0; i -= 1) {
    const key = daysAgo(i).toISOString().slice(0, 10);
    daily.push({ date: key, count: byDay[key] || 0 });
  }

  return {
    activeWishlists,
    customerWishlists,
    guestWishlists: activeWishlists - customerWishlists,
    totalItems,
    uniqueProducts: productGroups.length,
    adds30,
    carts30,
    shares30,
    conversion30: adds30 ? Math.round((carts30 / adds30) * 1000) / 10 : 0,
    daily,
    topProducts: topProducts.map((p) => ({ productId: p.productId, count: p._count.productId })),
    recentEvents: recentEvents.map((e) => ({
      id: e.id,
      type: e.type,
      productId: e.productId,
      ownerType: e.ownerType,
      ownerId: e.ownerId,
      createdAt: e.createdAt.toISOString(),
    })),
    priceChanges: priceChanges.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
  };
}

export async function listWishlists(shop, { page = 1, perPage = 25, ownerType = "" } = {}) {
  const where = { shop, items: { some: {} } };
  if (ownerType === "customer" || ownerType === "guest") where.ownerType = ownerType;
  const [total, rows] = await Promise.all([
    db.wishlist.count({ where }),
    db.wishlist.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: { items: { orderBy: { addedAt: "desc" } } },
    }),
  ]);
  return {
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
    wishlists: rows.map((w) => ({
      id: w.id,
      ownerType: w.ownerType,
      ownerId: w.ownerType === "customer" ? w.ownerId : w.ownerId.slice(0, 8),
      updatedAt: w.updatedAt.toISOString(),
      createdAt: w.createdAt.toISOString(),
      items: w.items.map((i) => ({ productId: i.productId, variantId: i.variantId, handle: i.handle })),
    })),
  };
}

export async function exportRows(shop) {
  const items = await db.wishlistItem.findMany({
    where: { shop },
    include: { wishlist: true },
    orderBy: { addedAt: "desc" },
    take: 50000,
  });
  return items.map((i) => ({
    ownerType: i.wishlist.ownerType,
    customerId: i.wishlist.ownerType === "customer" ? i.wishlist.ownerId : "",
    productId: i.productId,
    variantId: i.variantId || "",
    handle: i.handle,
    addedAt: i.addedAt.toISOString(),
  }));
}

/** Looks up product titles/images for the admin via GraphQL. */
export async function productDetails(admin, productIds) {
  const ids = [...new Set(productIds.filter(Boolean))].slice(0, 100);
  if (!ids.length) return {};
  const response = await admin.graphql(
    `#graphql
      query WishFlowProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            handle
            status
            totalInventory
            featuredMedia {
              preview {
                image {
                  url(transform: { maxWidth: 80, maxHeight: 80 })
                }
              }
            }
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }`,
    { variables: { ids: ids.map((id) => `gid://shopify/Product/${id}`) } },
  );
  const json = await response.json();
  const map = {};
  (json.data?.nodes || []).forEach((n) => {
    if (!n?.id) return;
    map[numericId(n.id)] = {
      title: n.title,
      handle: n.handle,
      status: n.status,
      inventory: n.totalInventory,
      image: n.featuredMedia?.preview?.image?.url || null,
      price: n.priceRangeV2?.minVariantPrice
        ? `${Number(n.priceRangeV2.minVariantPrice.amount).toFixed(2)} ${n.priceRangeV2.minVariantPrice.currencyCode}`
        : "",
    };
  });
  return map;
}
