export default function HelpPage() {
  return (
    <s-page heading="Help">
      <s-section heading="Set up the wishlist on your store">
        <s-ordered-list>
          <s-list-item>
            Go to Online Store → Themes → Customize → App embeds and turn on{" "}
            <s-text type="strong">WishFlow wishlist</s-text>. Click Save. This adds the header
            wishlist icon, hearts on product cards (collection, search and home page grids) and the
            wishlist page.
          </s-list-item>
          <s-list-item>
            Open a product page in the theme editor, click Add block, choose{" "}
            <s-text type="strong">Wishlist button</s-text> under Apps, drag it under the Add to cart
            button and click Save.
          </s-list-item>
          <s-list-item>
            Add a menu link to <code>/apps/wishlist</code> (Online Store → Navigation) if you want a
            text link as well as the header icon.
          </s-list-item>
        </s-ordered-list>
        <s-paragraph>
          The Dashboard page has buttons that open the theme editor at the right place for steps 1 and 2.
        </s-paragraph>
      </s-section>

      <s-section heading="How shoppers use it">
        <s-unordered-list>
          <s-list-item>Tap the heart on any product card or the product page button to save it.</s-list-item>
          <s-list-item>
            Guests can save items without an account. When they log in, their items move to their
            customer account and follow them on every device.
          </s-list-item>
          <s-list-item>
            The wishlist page shows live prices in the shopper&apos;s currency, lets them pick a variant,
            add one or all items to the cart, remove items and share the list by link, email, WhatsApp,
            Facebook or X.
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Customize">
        <s-paragraph>
          In App embeds → WishFlow wishlist you can change the icon (heart, star, bookmark), colors,
          heart position, header icon or floating button, whether shoppers must log in, and every piece
          of text (so you can translate it into your store&apos;s language).
        </s-paragraph>
        <s-paragraph>
          If hearts don&apos;t appear on your theme&apos;s product cards, enter your theme&apos;s card
          class in “Custom product card selector” (for example <code>.product-card</code>).
        </s-paragraph>
      </s-section>

      <s-section heading="JavaScript API (for developers)">
        <s-paragraph>The app embed exposes <code>window.WishFlow</code>:</s-paragraph>
        <s-box padding="base" background="subdued" borderRadius="base">
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            <code>{`WishFlow.items()                // saved items
WishFlow.count()                // number of items
WishFlow.has(productIdOrHandle)
WishFlow.add({ id, handle, variantId })
WishFlow.remove({ id, handle })
WishFlow.toggle({ handle })
WishFlow.onChange(items => { ... })
document.addEventListener("wishflow:change", e => e.detail.items)

<!-- Any element with this attribute shows the item count -->
<span data-wishflow-count></span>

<!-- Your own wishlist button anywhere in the theme -->
<button data-wishflow-button data-product-handle="{{ product.handle }}"
        data-product-id="{{ product.id }}">
  <span class="wishflow-icon"></span>
</button>`}</code>
          </pre>
        </s-box>
      </s-section>

      <s-section slot="aside" heading="Bulk editor">
        <s-paragraph>
          The Bulk editor page lets you search products, edit them in a table, and change price,
          compare-at price, status, tags, vendor, type, title or SKU for many products at once.
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Privacy">
        <s-paragraph>
          WishFlow stores only product IDs and the Shopify customer ID (or a random guest ID). Data is
          deleted automatically when Shopify sends customer or shop redaction requests.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
