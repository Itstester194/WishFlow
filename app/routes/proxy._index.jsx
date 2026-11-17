// Storefront wishlist page, served through the Shopify app proxy at
// https://<store>/apps/wishlist. It renders inside the store's theme; the
// WishFlow app embed script fills it in (see extensions/wishflow-theme).
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { liquid, session } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const share = url.searchParams.get("share") || "";
  const safeShare = /^[A-Za-z0-9_-]{1,64}$/.test(share) ? share : "";

  if (!session) {
    return liquid(`<div class="page-width"><p>Wishlist is not available right now.</p></div>`);
  }

  return liquid(`
<div class="page-width wishflow-page-wrap">
  <div id="wishflow-page" data-share-token="${safeShare}"></div>
  <p class="wishflow-page-fallback" data-wishflow-fallback style="padding:48px 0;text-align:center;">
    Loading wishlist…
  </p>
  <script>
    setTimeout(function () {
      var f = document.querySelector('[data-wishflow-fallback]');
      if (f && !window.WishFlow) {
        f.textContent = 'The wishlist could not load. Store owner: turn on the WishFlow app embed in Online Store > Themes > Customize > App embeds.';
      }
    }, 6000);
  </script>
</div>`);
};
