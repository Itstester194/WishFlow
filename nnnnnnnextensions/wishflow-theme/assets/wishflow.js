/* WishFlow storefront wishlist — https://<store>/apps/wishlist */
(function () {
  "use strict";
  if (window.WishFlow) return;

  /* ---------------------------------------------------------------- */
  /* Config                                                            */
  /* ---------------------------------------------------------------- */
  var cfg = Object.assign({}, window.WishFlowBlockConfig || {}, window.WishFlowConfig || {});
  var embedOn = !!window.WishFlowConfig;
  var S = Object.assign(
    {
      icon: "heart",
      headerIcon: embedOn,
      floating: false,
      floatingPosition: "bottom-right",
      cards: embedOn,
      cardPosition: "top-right",
      cardSelector: "",
      requireLogin: false,
      toast: true,
      afterCart: "stay",
      share: true,
    },
    cfg.settings || {}
  );
  var T = Object.assign(
    {
      add: "Add to wishlist",
      added: "In your wishlist",
      toastAdded: "Added to your wishlist",
      toastRemoved: "Removed from your wishlist",
      view: "View wishlist",
      pageTitle: "My wishlist",
      sharedTitle: "Shared wishlist",
      empty: "Your wishlist is empty. Tap the heart on any product to save it here.",
      continueShopping: "Continue shopping",
      addToCart: "Add to cart",
      addAll: "Add all to cart",
      soldOut: "Sold out",
      remove: "Remove",
      clear: "Clear wishlist",
      share: "Share wishlist",
      copied: "Link copied",
      login: "Log in to keep your wishlist on every device.",
      loginLink: "Log in",
      addedToCart: "Added to cart",
      viewCart: "View cart",
      unavailable: "This product is no longer available",
    },
    cfg.texts || {}
  );

  var root = cfg.root || (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  if (root.slice(-1) !== "/") root += "/";
  var proxyPath = "/" + String(cfg.proxyPath || "/apps/wishlist").replace(/^\/+|\/+$/g, "");
  var pageUrl = root.replace(/\/$/, "") + proxyPath;
  var apiUrl = pageUrl + "/api";
  var customerId = cfg.customerId || null;
  var currency =
    cfg.currency || (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || "USD";
  var locale = cfg.locale || document.documentElement.lang || "en";

  var ICONS = {
    heart:
      '<svg viewBox="0 0 24 24" width="20" height="20" focusable="false"><path d="M12 21s-7.5-4.6-10-9.2C.3 8.6 2.1 4.5 6 4.1c2.2-.2 4.2.9 6 3 1.8-2.1 3.8-3.2 6-3 3.9.4 5.7 4.5 4 7.7C19.5 16.4 12 21 12 21z"/></svg>',
    star:
      '<svg viewBox="0 0 24 24" width="20" height="20" focusable="false"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.3L12 17.1l-5.7 3.1 1.2-6.3L2.8 9.5l6.4-.8z"/></svg>',
    bookmark:
      '<svg viewBox="0 0 24 24" width="20" height="20" focusable="false"><path d="M6 2.8h12a1 1 0 011 1v17.4l-7-4.6-7 4.6V3.8a1 1 0 011-1z"/></svg>',
  };
  var ICON = ICONS[S.icon] || ICONS.heart;
  var CLOSE =
    '<svg viewBox="0 0 24 24" width="16" height="16" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';

  /* ---------------------------------------------------------------- */
  /* Storage helpers                                                   */
  /* ---------------------------------------------------------------- */
  function lsGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function lsSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* ignore */
    }
  }
  function guestId() {
    var id = lsGet("wishflow:guest");
    if (!id || !/^[a-zA-Z0-9-]{16,64}$/.test(id)) {
      id =
        window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
      lsSet("wishflow:guest", id);
    }
    return id;
  }

  /* ---------------------------------------------------------------- */
  /* State                                                             */
  /* ---------------------------------------------------------------- */
  var CACHE_KEY = "wishflow:items:" + (customerId || "guest");
  var state = { items: [], shareToken: null, loaded: false };
  var listeners = [];

  try {
    var cached = JSON.parse(lsGet(CACHE_KEY) || "null");
    if (cached && Array.isArray(cached.items)) state.items = cached.items;
  } catch (e) {
    /* ignore */
  }

  function setState(data) {
    state.items = Array.isArray(data.items) ? data.items : [];
    if (data.shareToken !== undefined && data.shareToken !== null) state.shareToken = data.shareToken;
    state.loaded = true;
    lsSet(CACHE_KEY, JSON.stringify({ items: state.items }));
    renderAll();
    listeners.forEach(function (fn) {
      try {
        fn(state.items.slice());
      } catch (e) {
        /* ignore */
      }
    });
    document.dispatchEvent(new CustomEvent("wishflow:change", { detail: { items: state.items.slice() } }));
  }

  function has(ref) {
    return state.items.some(function (i) {
      return (ref.id && String(i.productId) === String(ref.id)) || (ref.handle && i.handle === ref.handle);
    });
  }

  /* ---------------------------------------------------------------- */
  /* API                                                               */
  /* ---------------------------------------------------------------- */
  function request(method, body, query) {
    var url = apiUrl + (query ? "?" + query : "");
    var opts = { method: method, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (json) {
          if (!res.ok || json.error) throw new Error(json.error || "Request failed");
          return json;
        });
    });
  }

  function load() {
    return request("GET", null, "guest=" + encodeURIComponent(guestId()))
      .then(setState)
      .catch(function () {
        state.loaded = true;
        renderAll();
      });
  }

  var productCache = {};
  function fetchProduct(handle) {
    if (!productCache[handle]) {
      productCache[handle] = fetch(root + "products/" + encodeURIComponent(handle) + ".js", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }).then(function (res) {
        if (!res.ok) throw new Error("not found");
        return res.json();
      });
      productCache[handle].catch(function () {
        delete productCache[handle];
      });
    }
    return productCache[handle];
  }

  function track(type, productId) {
    request("POST", { intent: "track", type: type, productId: productId || null, guest: guestId() }).catch(
      function () {}
    );
  }

  /** Adds or removes a product. ref = { id, handle, variantId } (id may be missing for cards). */
  function toggle(ref) {
    if (S.requireLogin && !customerId) {
      window.location.href = cfg.loginUrl || "/account/login";
      return Promise.resolve();
    }
    var adding = !has(ref);
    var previous = state.items.slice();

    var existing = adding
      ? null
      : state.items.filter(function (i) {
          return (ref.id && String(i.productId) === String(ref.id)) || (ref.handle && i.handle === ref.handle);
        })[0];
    var ready = existing
      ? Promise.resolve({ id: existing.productId, handle: existing.handle })
      : ref.id
      ? Promise.resolve(ref)
      : fetchProduct(ref.handle).then(function (p) {
          var first =
            (p.variants || []).filter(function (v) {
              return v.available;
            })[0] || (p.variants || [])[0];
          return { id: p.id, handle: p.handle, variantId: ref.variantId || (first && first.id) };
        });

    return ready
      .then(function (r) {
        // Optimistic update
        if (adding) {
          state.items = [{ productId: String(r.id), handle: r.handle, variantId: r.variantId ? String(r.variantId) : null }].concat(
            state.items
          );
        } else {
          state.items = state.items.filter(function (i) {
            return !(String(i.productId) === String(r.id) || i.handle === r.handle);
          });
        }
        renderAll();
        if (S.toast) toast(adding ? T.toastAdded : T.toastRemoved, adding ? { href: pageUrl, label: T.view } : null);
        return request("POST", {
          intent: adding ? "add" : "remove",
          guest: guestId(),
          productId: r.id,
          variantId: r.variantId || null,
          handle: r.handle,
        });
      })
      .then(setState)
      .catch(function (err) {
        state.items = previous;
        renderAll();
        toast((err && err.message) || "Something went wrong", null, true);
      });
  }

  /* ---------------------------------------------------------------- */
  /* UI helpers                                                        */
  /* ---------------------------------------------------------------- */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "text") node.textContent = v;
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  var toastTimer;
  function toast(message, link, isError) {
    var box = document.querySelector(".wishflow-toast");
    if (!box) {
      box = el("div", { class: "wishflow-toast", role: "status", "aria-live": "polite" });
      document.body.appendChild(box);
    }
    box.innerHTML = "";
    box.classList.toggle("wishflow-toast--error", !!isError);
    box.appendChild(el("span", { text: message }));
    if (link) box.appendChild(el("a", { href: link.href, text: link.label }));
    box.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      box.classList.remove("is-visible");
    }, 3200);
  }

  function formatMoney(cents) {
    var amount = Number(cents || 0) / 100;
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: currency }).format(amount);
    } catch (e) {
      return amount.toFixed(2) + " " + currency;
    }
  }

  function imageUrl(src, width) {
    if (!src) return "";
    var url = String(src);
    if (url.indexOf("//") === 0) url = "https:" + url;
    return url + (url.indexOf("?") > -1 ? "&" : "?") + "width=" + (width || 400);
  }

  /* ---------------------------------------------------------------- */
  /* Buttons: product page block + product cards                       */
  /* ---------------------------------------------------------------- */
  function selectedVariantId(btn) {
    var scope = btn.closest("section, .shopify-section, product-info, main") || document;
    var input = scope.querySelector('form[action*="/cart/add"] [name="id"]');
    if (input && input.value) return input.value;
    var param = new URLSearchParams(window.location.search).get("variant");
    return param || btn.getAttribute("data-variant-id");
  }

  function refFromButton(btn) {
    return {
      id: btn.getAttribute("data-product-id"),
      handle: btn.getAttribute("data-product-handle"),
      variantId: btn.classList.contains("wishflow-btn--pdp") ? selectedVariantId(btn) : null,
    };
  }

  function renderButton(btn) {
    var active = has(refFromButton(btn));
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    var addText = btn.getAttribute("data-label-add") || T.add;
    var addedText = btn.getAttribute("data-label-added") || T.added;
    btn.setAttribute("aria-label", active ? addedText : addText);
    var label = btn.querySelector("[data-wishflow-label]");
    if (label) label.textContent = active ? addedText : addText;
    var icon = btn.querySelector(".wishflow-icon");
    if (icon && !icon.firstChild) icon.innerHTML = ICON;
  }

  document.addEventListener(
    "click",
    function (event) {
      var btn = event.target.closest && event.target.closest("[data-wishflow-button]");
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      if (btn.getAttribute("aria-busy") === "true") return;
      btn.setAttribute("aria-busy", "true");
      toggle(refFromButton(btn)).then(function () {
        btn.removeAttribute("aria-busy");
      });
    },
    true
  );

  var DEFAULT_CARD_SELECTOR = [
    ".product-card-wrapper",
    ".card-wrapper",
    "product-card",
    ".product-card",
    ".product-item",
    ".grid-product",
    ".productitem",
    ".product-grid-item",
    ".grid-view-item",
    ".product-block",
    ".product-tile",
    ".product-miniature",
    ".boost-pfs-filter-product-item",
  ].join(",");
  var EXCLUDE = "header, .header, predictive-search, .predictive-search, cart-drawer, .cart-drawer, #wishflow-page, .wishflow-page";
  var HANDLE_RE = /\/products\/([^/?#]+)/;

  function injectCardButtons() {
    if (!S.cards) return;
    var selector = (S.cardSelector || "").trim() || DEFAULT_CARD_SELECTOR;
    var cards;
    try {
      cards = document.querySelectorAll(selector);
    } catch (e) {
      cards = document.querySelectorAll(DEFAULT_CARD_SELECTOR);
      selector = DEFAULT_CARD_SELECTOR;
    }
    Array.prototype.forEach.call(cards, function (card) {
      if (card.hasAttribute("data-wishflow-card")) return;
      if (card.closest(EXCLUDE)) return;
      if (card.parentElement && card.parentElement.closest("[data-wishflow-card]")) return;
      if (card.querySelector("[data-wishflow-button]")) return;
      var link = card.querySelector('a[href*="/products/"]');
      if (!link) return;
      var match = HANDLE_RE.exec(link.getAttribute("href"));
      if (!match) return;
      var handle = decodeURIComponent(match[1]);
      card.setAttribute("data-wishflow-card", "");
      if (window.getComputedStyle(card).position === "static") card.style.position = "relative";
      var btn = el("button", {
        type: "button",
        class: "wishflow-btn wishflow-btn--card wishflow-btn--" + (S.cardPosition || "top-right"),
        "data-wishflow-button": "",
        "data-product-handle": handle,
        "aria-pressed": "false",
        "aria-label": T.add,
        html: '<span class="wishflow-icon" aria-hidden="true">' + ICON + "</span>",
      });
      card.appendChild(btn);
      renderButton(btn);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Header icon, floating button, counters                            */
  /* ---------------------------------------------------------------- */
  function injectHeader() {
    var placed = false;
    if (S.headerIcon && !document.querySelector(".wishflow-header-link")) {
      var target = document.querySelector(
        "#cart-icon-bubble, header a[href$='/cart'], .header a[href$='/cart'], .header__icon--cart, header [href*='/cart']"
      );
      if (target && target.parentNode) {
        var link = el("a", {
          href: pageUrl,
          class: "wishflow-header-link",
          "aria-label": T.view,
          html: '<span class="wishflow-icon" aria-hidden="true">' + ICON + '</span><span class="wishflow-count" data-wishflow-count hidden></span>',
        });
        target.parentNode.insertBefore(link, target);
        placed = true;
      }
    } else if (document.querySelector(".wishflow-header-link")) {
      placed = true;
    }
    if ((S.floating || (S.headerIcon && !placed)) && !document.querySelector(".wishflow-floating")) {
      document.body.appendChild(
        el("a", {
          href: pageUrl,
          class: "wishflow-floating wishflow-floating--" + (S.floatingPosition || "bottom-right"),
          "aria-label": T.view,
          html: '<span class="wishflow-icon" aria-hidden="true">' + ICON + '</span><span class="wishflow-count" data-wishflow-count hidden></span>',
        })
      );
    }
  }

  function renderCounts() {
    var count = state.items.length;
    document.querySelectorAll("[data-wishflow-count]").forEach(function (node) {
      node.textContent = count;
      if (count > 0) node.removeAttribute("hidden");
      else if (node.classList.contains("wishflow-count")) node.setAttribute("hidden", "");
    });
  }

  function renderAll() {
    document.querySelectorAll("[data-wishflow-button]").forEach(renderButton);
    renderCounts();
    if (page.root && !page.shared) renderPage();
  }

  /* ---------------------------------------------------------------- */
  /* Wishlist page (/apps/wishlist)                                    */
  /* ---------------------------------------------------------------- */
  var page = { root: null, shared: false, sharedItems: [], renderId: 0 };

  function addToCart(items) {
    return fetch(root + "cart/add.js", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: items }),
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) throw new Error(json.description || json.message || "Could not add to cart");
        return json;
      });
    });
  }

  function afterCartAdded(productIds) {
    productIds.forEach(function (id) {
      track("add_to_cart", id);
    });
    document.dispatchEvent(new CustomEvent("wishflow:added-to-cart", { detail: { productIds: productIds } }));
    if (S.afterCart === "cart") {
      window.location.href = cfg.cartUrl || root + "cart";
      return;
    }
    toast(T.addedToCart, { href: cfg.cartUrl || root + "cart", label: T.viewCart });
    // Refresh common theme cart counters
    fetch(root + "cart.js", { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (cart) {
        document.querySelectorAll(".cart-count-bubble span[aria-hidden], [data-cart-count], .cart-count").forEach(function (n) {
          n.textContent = cart.item_count;
        });
      })
      .catch(function () {});
  }

  function shareBar() {
    if (!S.share || !state.shareToken) return null;
    var url = window.location.origin + pageUrl + "?share=" + encodeURIComponent(state.shareToken);
    var text = encodeURIComponent(T.pageTitle + " — " + document.title);
    var enc = encodeURIComponent(url);
    function shareLink(label, href) {
      return el("a", {
        href: href,
        target: "_blank",
        rel: "noopener",
        class: "wishflow-share__link",
        text: label,
        onclick: function () {
          track("share");
        },
      });
    }
    var copyBtn = el("button", {
      type: "button",
      class: "wishflow-share__link",
      text: "Copy link",
      onclick: function () {
        var done = function () {
          toast(T.copied);
          track("share");
        };
        if (navigator.share) {
          navigator.share({ title: T.pageTitle, url: url }).then(done).catch(function () {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(done);
        } else {
          window.prompt(T.share, url);
        }
      },
    });
    return el("div", { class: "wishflow-share" }, [
      el("span", { class: "wishflow-share__label", text: T.share + ":" }),
      copyBtn,
      shareLink("Email", "mailto:?subject=" + text + "&body=" + enc),
      shareLink("WhatsApp", "https://wa.me/?text=" + text + "%20" + enc),
      shareLink("Facebook", "https://www.facebook.com/sharer/sharer.php?u=" + enc),
      shareLink("X", "https://twitter.com/intent/tweet?url=" + enc + "&text=" + text),
    ]);
  }

  function itemCard(item, product) {
    if (!product) {
      return el("div", { class: "wishflow-item wishflow-item--missing" }, [
        el("div", { class: "wishflow-item__body" }, [
          el("p", { class: "wishflow-item__title", text: item.handle }),
          el("p", { class: "wishflow-item__note", text: T.unavailable }),
          page.shared
            ? null
            : el("button", {
                type: "button",
                class: "wishflow-link",
                text: T.remove,
                onclick: function () {
                  toggle({ id: item.productId, handle: item.handle });
                },
              }),
        ]),
      ]);
    }

    var variants = product.variants || [];
    var variant =
      variants.filter(function (v) {
        return String(v.id) === String(item.variantId);
      })[0] ||
      variants.filter(function (v) {
        return v.available;
      })[0] ||
      variants[0];
    var url = root + "products/" + product.handle + (variant ? "?variant=" + variant.id : "");
    var img = (variant && variant.featured_image && variant.featured_image.src) || product.featured_image;

    var priceBox = el("div", { class: "wishflow-item__price" });
    var cartBtn = el("button", { type: "button", class: "wishflow-button wishflow-button--primary" });
    var link = el("a", { href: url, class: "wishflow-item__media" }, [
      img ? el("img", { src: imageUrl(img, 500), alt: product.title, loading: "lazy" }) : null,
    ]);

    function update() {
      priceBox.innerHTML = "";
      if (variant) {
        priceBox.appendChild(el("span", { class: "wishflow-price", text: formatMoney(variant.price) }));
        if (variant.compare_at_price && variant.compare_at_price > variant.price) {
          priceBox.appendChild(el("s", { class: "wishflow-price--compare", text: formatMoney(variant.compare_at_price) }));
        }
      }
      var available = variant && variant.available;
      cartBtn.textContent = available ? T.addToCart : T.soldOut;
      cartBtn.disabled = !available;
      link.setAttribute("href", root + "products/" + product.handle + (variant ? "?variant=" + variant.id : ""));
    }

    var select = null;
    var hasOptions = variants.length > 1 && !(variants.length === 1 && variants[0].title === "Default Title");
    if (hasOptions) {
      select = el(
        "select",
        {
          class: "wishflow-select",
          "aria-label": product.title,
          onchange: function (e) {
            variant = variants.filter(function (v) {
              return String(v.id) === e.target.value;
            })[0];
            update();
          },
        },
        variants.map(function (v) {
          var opt = el("option", { value: String(v.id), text: v.title + (v.available ? "" : " — " + T.soldOut) });
          if (variant && v.id === variant.id) opt.selected = true;
          return opt;
        })
      );
    }

    cartBtn.addEventListener("click", function () {
      if (!variant) return;
      cartBtn.disabled = true;
      addToCart([{ id: variant.id, quantity: 1 }])
        .then(function () {
          afterCartAdded([product.id]);
        })
        .catch(function (err) {
          toast(err.message, null, true);
        })
        .then(update);
    });

    var removeBtn = page.shared
      ? el("button", {
          type: "button",
          class: "wishflow-item__save wishflow-btn",
          "data-wishflow-button": "",
          "data-product-id": String(product.id),
          "data-product-handle": product.handle,
          "aria-label": T.add,
          html: '<span class="wishflow-icon" aria-hidden="true">' + ICON + "</span>",
        })
      : el("button", {
          type: "button",
          class: "wishflow-item__remove",
          "aria-label": T.remove + ": " + product.title,
          title: T.remove,
          html: CLOSE,
          onclick: function () {
            toggle({ id: product.id, handle: product.handle });
          },
        });

    update();
    var card = el("div", { class: "wishflow-item" }, [
      link,
      removeBtn,
      el("div", { class: "wishflow-item__body" }, [
        el("a", { href: url, class: "wishflow-item__title", text: product.title }),
        priceBox,
        select,
        cartBtn,
      ]),
    ]);
    card._wishflow = function () {
      return variant && variant.available ? { id: variant.id, productId: product.id } : null;
    };
    if (page.shared) renderButton(removeBtn);
    return card;
  }

  function renderPage() {
    var rootNode = page.root;
    var items = page.shared ? page.sharedItems : state.items;
    var renderId = ++page.renderId;

    var fallback = document.querySelector("[data-wishflow-fallback]");
    if (fallback) fallback.remove();

    if (!page.shared && !state.loaded && !items.length) {
      rootNode.innerHTML = '<p class="wishflow-page__loading">…</p>';
      return;
    }

    var header = el("div", { class: "wishflow-page__header" }, [
      el("h1", { class: "wishflow-page__title", text: page.shared ? T.sharedTitle : T.pageTitle }),
      el("span", { class: "wishflow-page__count", text: items.length ? "(" + items.length + ")" : "" }),
    ]);

    if (!items.length) {
      rootNode.innerHTML = "";
      rootNode.appendChild(header);
      rootNode.appendChild(
        el("div", { class: "wishflow-empty" }, [
          el("div", { class: "wishflow-empty__icon", html: ICON }),
          el("p", { text: T.empty }),
          el("a", { href: root + "collections/all", class: "wishflow-button wishflow-button--primary", text: T.continueShopping }),
        ])
      );
      return;
    }

    Promise.all(
      items.map(function (item) {
        return fetchProduct(item.handle).catch(function () {
          return null;
        });
      })
    ).then(function (products) {
      if (renderId !== page.renderId) return; // a newer render started
      rootNode.innerHTML = "";
      rootNode.appendChild(header);

      if (!page.shared && !customerId) {
        rootNode.appendChild(
          el("p", { class: "wishflow-notice" }, [
            T.login + " ",
            el("a", { href: (cfg.loginUrl || "/account/login") + "?return_url=" + encodeURIComponent(pageUrl), text: T.loginLink }),
          ])
        );
      }

      var grid = el("div", { class: "wishflow-grid" });
      var cards = items.map(function (item, i) {
        return itemCard(item, products[i]);
      });
      cards.forEach(function (c) {
        grid.appendChild(c);
      });

      var addAll = el("button", {
        type: "button",
        class: "wishflow-button wishflow-button--primary",
        text: T.addAll,
        onclick: function () {
          var lines = cards
            .map(function (c) {
              return c._wishflow ? c._wishflow() : null;
            })
            .filter(Boolean);
          if (!lines.length) return;
          addAll.disabled = true;
          addToCart(lines.map(function (l) { return { id: l.id, quantity: 1 }; }))
            .then(function () {
              afterCartAdded(lines.map(function (l) { return l.productId; }));
            })
            .catch(function (err) {
              toast(err.message, null, true);
            })
            .then(function () {
              addAll.disabled = false;
            });
        },
      });

      var actions = el("div", { class: "wishflow-page__actions" }, [
        addAll,
        page.shared
          ? null
          : el("button", {
              type: "button",
              class: "wishflow-button",
              text: T.clear,
              onclick: function () {
                if (!window.confirm(T.clear + "?")) return;
                var previous = state.items.slice();
                state.items = [];
                renderAll();
                request("POST", { intent: "clear", guest: guestId() })
                  .then(setState)
                  .catch(function () {
                    state.items = previous;
                    renderAll();
                  });
              },
            }),
      ]);

      var toolbar = el("div", { class: "wishflow-page__toolbar" }, [actions, page.shared ? null : shareBar()]);
      rootNode.appendChild(toolbar);
      rootNode.appendChild(grid);
    });
  }

  function initPage() {
    page.root = document.getElementById("wishflow-page");
    if (!page.root) return;
    document.body.classList.add("wishflow-page-active");
    var token = page.root.getAttribute("data-share-token");
    if (token) {
      page.shared = true;
      request("GET", null, "share=" + encodeURIComponent(token))
        .then(function (data) {
          page.sharedItems = data.items || [];
          renderPage();
        })
        .catch(function () {
          page.sharedItems = [];
          renderPage();
        });
    } else {
      renderPage();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Boot                                                              */
  /* ---------------------------------------------------------------- */
  var observerTimer;
  function boot() {
    initPage();
    injectHeader();
    injectCardButtons();
    renderAll();
    load();
    if (S.cards && window.MutationObserver) {
      new MutationObserver(function () {
        clearTimeout(observerTimer);
        observerTimer = setTimeout(function () {
          injectCardButtons();
          document.querySelectorAll("[data-wishflow-button]").forEach(renderButton);
        }, 150);
      }).observe(document.body, { childList: true, subtree: true });
    }
    // Keep the product page button in sync when the shopper changes variant
    document.addEventListener("change", function (e) {
      if (e.target && e.target.closest && e.target.closest('form[action*="/cart/add"], variant-selects, variant-radios')) {
        document.querySelectorAll(".wishflow-btn--pdp").forEach(renderButton);
      }
    });
  }

  /* Public JavaScript API */
  window.WishFlow = {
    version: "1.0.0",
    items: function () {
      return state.items.slice();
    },
    count: function () {
      return state.items.length;
    },
    has: function (productIdOrHandle) {
      return has({ id: productIdOrHandle, handle: productIdOrHandle });
    },
    add: function (ref) {
      return has(ref) ? Promise.resolve() : toggle(ref);
    },
    remove: function (ref) {
      return has(ref) ? toggle(ref) : Promise.resolve();
    },
    toggle: toggle,
    refresh: function () {
      injectCardButtons();
      return load();
    },
    onChange: function (fn) {
      listeners.push(fn);
    },
    pageUrl: pageUrl,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
