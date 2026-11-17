// Storefront wishlist API, reached through the app proxy at
// https://<store>/apps/wishlist/api. Shopify signs every proxied request and
// adds logged_in_customer_id for signed-in shoppers.
import { authenticate } from "../shopify.server";
import {
  addItem,
  clearWishlist,
  getSharedWishlist,
  getWishlist,
  mergeGuestIntoCustomer,
  removeItem,
  resolveOwner,
  trackEvent,
} from "../wishlist.server";

const noStore = { "Cache-Control": "no-store" };

function json(data, status = 200) {
  return Response.json(data, { status, headers: noStore });
}

async function context(request) {
  const { session } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  return {
    shop: session?.shop || null,
    customerId: url.searchParams.get("logged_in_customer_id") || null,
    url,
  };
}

export const loader = async ({ request }) => {
  const { shop, customerId, url } = await context(request);
  if (!shop) return json({ error: "App not installed" }, 404);

  const share = url.searchParams.get("share");
  if (share) {
    const shared = await getSharedWishlist(shop, share);
    if (!shared) return json({ error: "Wishlist not found" }, 404);
    return json({ ...shared, shared: true, shareToken: null });
  }

  const guestId = url.searchParams.get("guest");
  const owner = resolveOwner({ customerId, guestId });
  if (!owner) return json({ items: [], count: 0, shareToken: null, loggedIn: false });

  if (owner.ownerType === "customer" && guestId) {
    await mergeGuestIntoCustomer(shop, guestId, owner);
  }
  const data = await getWishlist(shop, owner);
  return json({ ...data, loggedIn: owner.ownerType === "customer" });
};

export const action = async ({ request }) => {
  const { shop, customerId } = await context(request);
  if (!shop) return json({ error: "App not installed" }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  const owner = resolveOwner({ customerId, guestId: body.guest });
  try {
    switch (body.intent) {
      case "add":
        if (!owner) return json({ error: "Missing shopper" }, 400);
        return json({ ...(await addItem(shop, owner, body)), loggedIn: owner.ownerType === "customer" });
      case "remove":
        if (!owner) return json({ error: "Missing shopper" }, 400);
        return json({ ...(await removeItem(shop, owner, body)), loggedIn: owner.ownerType === "customer" });
      case "clear":
        if (!owner) return json({ error: "Missing shopper" }, 400);
        return json({ ...(await clearWishlist(shop, owner)), loggedIn: owner.ownerType === "customer" });
      case "track":
        await trackEvent(shop, owner, body.type, body.productId);
        return json({ ok: true });
      default:
        return json({ error: "Unknown intent" }, 400);
    }
  } catch (error) {
    return json({ error: error?.message || "Something went wrong" }, 400);
  }
};
