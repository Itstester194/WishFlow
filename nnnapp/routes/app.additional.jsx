export default function HowToUsePage() {
  return (
    <s-page heading="How to use the Bulk Product Editor">
      <s-section heading="1. Find the products you want to change">
        <s-paragraph>
          On the Bulk editor page, search by title or SKU and filter by status,
          vendor, product type or tag. Use the sort and per-page options above
          the table to change the order and how many products you see.
        </s-paragraph>
      </s-section>

      <s-section heading="2. Edit products directly in the table">
        <s-paragraph>
          Click any cell to edit the title, status, vendor, product type, tags,
          price, compare-at price or SKU. Changed cells are highlighted in
          yellow. For products with several variants, click “Edit variants” to
          open each variant&apos;s price, compare-at price and SKU.
        </s-paragraph>
        <s-paragraph>
          When you&apos;re done, click Save changes in the dark bar above the
          table, or Discard to undo your edits.
        </s-paragraph>
      </s-section>

      <s-section heading="3. Change many products at once">
        <s-paragraph>
          Tick the products you want (or tick the header box, then choose
          “Select all … matching this search” to include every page). Pick a
          field and an action, then click Apply and confirm.
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>
            Price and compare-at price: set a value, raise or lower by a
            percentage or amount, with optional rounding (.99, .95, whole
            numbers). Compare-at can also be set to price + % or removed.
          </s-list-item>
          <s-list-item>Status: make products Active, Draft or Archived.</s-list-item>
          <s-list-item>Tags: add, remove or replace tags.</s-list-item>
          <s-list-item>Vendor and product type: set a new value or clear it.</s-list-item>
          <s-list-item>
            Title and SKU: add text at the start or end, find and replace, or
            remove text.
          </s-list-item>
        </s-unordered-list>
        <s-paragraph>
          Price, compare-at and SKU changes apply to every variant of each
          selected product. Keep the page open while a bulk edit runs; any
          products that fail are listed with the reason when it finishes.
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Good to know">
        <s-unordered-list>
          <s-list-item>Bulk edits can&apos;t be undone automatically, so test on a few products first.</s-list-item>
          <s-list-item>Products are updated in batches of 10 to stay within Shopify&apos;s API limits.</s-list-item>
          <s-list-item>“Open” in each row opens that product in the Shopify admin.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
