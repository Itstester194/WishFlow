// Mandatory privacy (GDPR) webhooks required for Shopify App Store apps.
import { authenticate } from "../shopify.server";
import { customerDataReport, redactCustomer, redactShop } from "../wishlist.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} compliance webhook for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      // WishFlow only stores the product IDs a customer saved. Log them so the
      // store owner's data request can be answered.
      const data = await customerDataReport(shop, payload?.customer?.id);
      console.log(`Wishlist data for customer ${payload?.customer?.id}:`, JSON.stringify(data));
      break;
    }
    case "CUSTOMERS_REDACT":
      await redactCustomer(shop, payload?.customer?.id);
      break;
    case "SHOP_REDACT":
      await redactShop(shop);
      break;
    default:
      break;
  }
  return new Response();
};
