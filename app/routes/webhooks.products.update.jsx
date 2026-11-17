// Receives the "product-price-change" event configured in shopify.app.toml.
// Price changes on products that shoppers have wishlisted are stored so they
// can be shown on the dashboard (and used for price-drop emails later).
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { numericId } from "../wishlist.server";

export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  try {
    const data = payload?.data || payload || {};
    const product = data.product || {};
    const variant = data.productVariant || data.variant || {};
    const productId = numericId(product.id || payload?.id);
    if (productId) {
      const wishlisted = await db.wishlistItem.count({ where: { shop, productId } });
      if (wishlisted > 0) {
        await db.priceChange.create({
          data: {
            shop,
            productId,
            variantId: numericId(variant.id),
            productTitle: product.title ? String(product.title).slice(0, 255) : null,
            variantTitle: variant.title ? String(variant.title).slice(0, 255) : null,
            price: variant.price != null ? String(variant.price) : null,
            compareAtPrice: variant.compareAtPrice != null ? String(variant.compareAtPrice) : null,
          },
        });
      }
    }
  } catch (error) {
    console.error("Could not record price change", error);
  }
  return new Response();
};
