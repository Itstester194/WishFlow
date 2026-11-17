import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { dashboardStats, productDetails } from "../wishlist.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const stats = await dashboardStats(shop);

  const ids = [
    ...stats.topProducts.map((p) => p.productId),
    ...stats.recentEvents.map((e) => e.productId),
  ];
  let products = {};
  try {
    products = await productDetails(admin, ids);
  } catch (error) {
    console.error("Could not load product details", error);
  }

  // eslint-disable-next-line no-undef
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  return {
    stats,
    products,
    shop,
    links: {
      embed: `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${apiKey}/app-embed`,
      productBlock: `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/wishlist-button&target=mainSection`,
      storefrontPage: `https://${shop}/apps/wishlist`,
      proxySettings: `https://${shop}/admin/settings/apps/app_proxy`,
    },
  };
};

const EVENT_LABELS = {
  add: { label: "Added to wishlist", tone: "success" },
  remove: { label: "Removed", tone: "neutral" },
  clear: { label: "Cleared wishlist", tone: "neutral" },
  add_to_cart: { label: "Added to cart", tone: "info" },
  share: { label: "Shared wishlist", tone: "info" },
};

function shortDate(iso) {
  return iso.replace("T", " ").slice(0, 16) + " UTC";
}

function StatCard({ label, value, hint }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {hint ? <s-text color="subdued">{hint}</s-text> : null}
      </s-stack>
    </s-box>
  );
}

export default function Dashboard() {
  const { stats, products, links } = useLoaderData();
  const max = Math.max(1, ...stats.daily.map((d) => d.count));
  const isEmpty = stats.totalItems === 0 && stats.recentEvents.length === 0;

  return (
    <s-page heading="WishFlow — Wishlist dashboard">
      <s-button slot="primary-action" href={links.storefrontPage} target="_blank">
        View wishlist page
      </s-button>

      {isEmpty && (
        <s-banner tone="info" heading="Finish setting up WishFlow">
          Complete the 3 steps below, then save a product from your store to see data here.
        </s-banner>
      )}

      <s-section heading="Setup">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
            <s-badge tone="info">1</s-badge>
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Turn on the WishFlow app embed</s-text>
              <s-text color="subdued">
                Adds the header wishlist icon, hearts on collection and search product cards, and the
                wishlist page. Click Save in the theme editor.
              </s-text>
            </s-stack>
            <s-button href={links.embed} target="_blank" variant="primary">
              Turn on
            </s-button>

            <s-badge tone="info">2</s-badge>
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Add the wishlist button to product pages</s-text>
              <s-text color="subdued">
                Places an “Add to wishlist” button in your product page. Drag it under the Add to cart
                button, then click Save.
              </s-text>
            </s-stack>
            <s-button href={links.productBlock} target="_blank">
              Add button
            </s-button>

            <s-badge tone="info">3</s-badge>
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Check your wishlist page</s-text>
              <s-text color="subdued">
                Shoppers see their saved items at /apps/wishlist. Link it from your menu: Online Store →
                Navigation → add a link to “/apps/wishlist”.
              </s-text>
            </s-stack>
            <s-button href={links.storefrontPage} target="_blank">
              Open page
            </s-button>
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="base">
          <StatCard
            label="Active wishlists"
            value={stats.activeWishlists}
            hint={`${stats.customerWishlists} customers · ${stats.guestWishlists} guests`}
          />
          <StatCard
            label="Saved items"
            value={stats.totalItems}
            hint={`${stats.uniqueProducts} different products`}
          />
          <StatCard label="Adds (30 days)" value={stats.adds30} />
          <StatCard
            label="Added to cart (30 days)"
            value={stats.carts30}
            hint={`${stats.conversion30}% of wishlist adds`}
          />
          <StatCard label="Shares (30 days)" value={stats.shares30} />
        </s-grid>
      </s-section>

      <s-section heading="Wishlist adds — last 30 days">
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 3,
            height: 120,
            padding: "8px 0",
          }}
          role="img"
          aria-label={`Wishlist adds per day over the last 30 days, ${stats.adds30} in total`}
        >
          {stats.daily.map((d) => (
            <div
              key={d.date}
              title={`${d.date}: ${d.count}`}
              style={{
                flex: 1,
                height: `${Math.max(2, (d.count / max) * 100)}%`,
                background: d.count ? "#e0245e" : "#e3e3e3",
                borderRadius: "3px 3px 0 0",
              }}
            />
          ))}
        </div>
        <s-stack direction="inline" justifyContent="space-between">
          <s-text color="subdued">{stats.daily[0]?.date}</s-text>
          <s-text color="subdued">Peak: {max === 1 && stats.adds30 === 0 ? 0 : max} / day</s-text>
          <s-text color="subdued">{stats.daily[stats.daily.length - 1]?.date}</s-text>
        </s-stack>
      </s-section>

      <s-section heading="Most wishlisted products">
        {stats.topProducts.length === 0 ? (
          <s-paragraph color="subdued">No products have been saved yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header>Price</s-table-header>
              <s-table-header format="numeric">Inventory</s-table-header>
              <s-table-header format="numeric">Wishlists</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {stats.topProducts.map((p) => {
                const d = products[p.productId];
                return (
                  <s-table-row key={p.productId}>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small" alignItems="center">
                        <s-thumbnail src={d?.image || undefined} alt={d?.title || ""} size="small" />
                        <s-link href={`shopify:admin/products/${p.productId}`} target="_blank">
                          {d?.title || `Product ${p.productId}`}
                        </s-link>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{d?.price || "—"}</s-table-cell>
                    <s-table-cell>{d?.inventory ?? "—"}</s-table-cell>
                    <s-table-cell>{p.count}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Recent activity">
        {stats.recentEvents.length === 0 ? (
          <s-paragraph color="subdued">No activity yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header>Action</s-table-header>
              <s-table-header>Shopper</s-table-header>
              <s-table-header>When</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {stats.recentEvents.map((e) => {
                const meta = EVENT_LABELS[e.type] || { label: e.type, tone: "neutral" };
                return (
                  <s-table-row key={e.id}>
                    <s-table-cell>
                      {e.productId ? products[e.productId]?.title || `Product ${e.productId}` : "—"}
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={meta.tone}>{meta.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {e.ownerType === "customer" ? (
                        <s-link href={`shopify:admin/customers/${e.ownerId}`} target="_blank">
                          Customer {e.ownerId}
                        </s-link>
                      ) : (
                        "Guest"
                      )}
                    </s-table-cell>
                    <s-table-cell>{shortDate(e.createdAt)}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Price changes on wishlisted products">
        {stats.priceChanges.length === 0 ? (
          <s-paragraph color="subdued">
            When you change the price of a product that shoppers have saved, it appears here.
          </s-paragraph>
        ) : (
          <s-unordered-list>
            {stats.priceChanges.map((p) => (
              <s-list-item key={p.id}>
                <s-text type="strong">{p.productTitle || `Product ${p.productId}`}</s-text>
                {p.variantTitle && p.variantTitle !== "Default Title" ? ` (${p.variantTitle})` : ""}: {p.price}
                {p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price)
                  ? ` (was ${p.compareAtPrice})`
                  : ""}
              </s-list-item>
            ))}
          </s-unordered-list>
        )}
      </s-section>

      <s-section slot="aside" heading="Storefront">
        <s-stack direction="block" gap="small">
          <s-paragraph>
            Wishlist page: <s-link href={links.storefrontPage} target="_blank">/apps/wishlist</s-link>
          </s-paragraph>
          <s-paragraph color="subdued">
            Change colors, icons and text in the theme editor under App embeds → WishFlow wishlist.
          </s-paragraph>
          <s-link href="/app/additional">Setup help and JavaScript API</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
