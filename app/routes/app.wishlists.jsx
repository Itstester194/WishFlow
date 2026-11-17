import { useState } from "react";
import { useLoaderData, useNavigation, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listWishlists, productDetails } from "../wishlist.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const ownerType = url.searchParams.get("owner") || "";
  const data = await listWishlists(session.shop, { page, ownerType });

  let products = {};
  try {
    products = await productDetails(
      admin,
      data.wishlists.flatMap((w) => w.items.slice(0, 6).map((i) => i.productId)),
    );
  } catch (error) {
    console.error("Could not load product details", error);
  }
  return { ...data, ownerType, products };
};

function shortDate(iso) {
  return iso.replace("T", " ").slice(0, 16) + " UTC";
}

export default function Wishlists() {
  const { wishlists, total, page, pages, ownerType, products } = useLoaderData();
  const [, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [exporting, setExporting] = useState(false);

  function setParam(key, value) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== "page") next.delete("page");
      return next;
    });
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await fetch("/app/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `wishlists-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      shopify.toast.show("Export downloaded");
    } catch (error) {
      shopify.toast.show(error.message, { isError: true });
    }
    setExporting(false);
  }

  return (
    <s-page heading="Wishlists">
      <s-button slot="primary-action" onClick={exportCsv} {...(exporting ? { loading: true } : {})}>
        Export CSV
      </s-button>

      <s-section>
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text color="subdued">Show:</s-text>
          {[
            ["", "All"],
            ["customer", "Customers"],
            ["guest", "Guests"],
          ].map(([value, label]) => (
            <s-button
              key={value || "all"}
              variant={ownerType === value ? "primary" : "secondary"}
              onClick={() => setParam("owner", value)}
            >
              {label}
            </s-button>
          ))}
          <s-text color="subdued">
            {total} wishlist{total === 1 ? "" : "s"}
            {navigation.state === "loading" ? " · Loading…" : ""}
          </s-text>
        </s-stack>
      </s-section>

      <s-section padding="none">
        {wishlists.length === 0 ? (
          <s-box padding="large">
            <s-paragraph color="subdued">
              No wishlists yet. They appear here as soon as shoppers save a product.
            </s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Shopper</s-table-header>
              <s-table-header>Saved products</s-table-header>
              <s-table-header format="numeric">Items</s-table-header>
              <s-table-header>Last updated</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {wishlists.map((w) => (
                <s-table-row key={w.id}>
                  <s-table-cell>
                    {w.ownerType === "customer" ? (
                      <s-link href={`shopify:admin/customers/${w.ownerId}`} target="_blank">
                        Customer {w.ownerId}
                      </s-link>
                    ) : (
                      <s-text>Guest {w.ownerId}…</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      {w.items.slice(0, 6).map((i) => {
                        const d = products[i.productId];
                        return (
                          <s-link
                            key={i.productId}
                            href={`shopify:admin/products/${i.productId}`}
                            target="_blank"
                            accessibilityLabel={d?.title || i.handle}
                          >
                            <s-thumbnail src={d?.image || undefined} alt={d?.title || i.handle} size="small" />
                          </s-link>
                        );
                      })}
                      {w.items.length > 6 ? <s-text color="subdued">+{w.items.length - 6}</s-text> : null}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{w.items.length}</s-table-cell>
                  <s-table-cell>{shortDate(w.updatedAt)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {pages > 1 && (
        <s-stack direction="inline" gap="small" justifyContent="center">
          <s-button disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>
            ← Previous
          </s-button>
          <s-text color="subdued">
            Page {page} of {pages}
          </s-text>
          <s-button disabled={page >= pages} onClick={() => setParam("page", String(page + 1))}>
            Next →
          </s-button>
        </s-stack>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
