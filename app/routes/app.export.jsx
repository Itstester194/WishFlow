// CSV export of every wishlist item (used by the Export CSV button).
import { authenticate } from "../shopify.server";
import { exportRows } from "../wishlist.server";

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const rows = await exportRows(session.shop);
  const header = ["shopper_type", "customer_id", "product_id", "variant_id", "product_handle", "added_at"];
  const lines = [header.join(",")].concat(
    rows.map((r) =>
      [r.ownerType, r.customerId, r.productId, r.variantId, r.handle, r.addedAt].map(csvCell).join(","),
    ),
  );
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="wishlists.csv"',
    },
  });
};
