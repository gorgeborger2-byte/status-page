(function () {
  var ticking = false;
  var navigating = false;

  function setupPageTransitions() {
    var body = document.body;
    if (!body) return;

    body.classList.add("page-transitions-enabled");
    window.requestAnimationFrame(function () {
      body.classList.add("page-visible");
    });

    window.addEventListener("pageshow", function () {
      navigating = false;
      body.classList.add("page-visible");
    });

    document.addEventListener("click", function (event) {
      if (navigating) return;
      var target = event.target;
      if (!target || typeof target.closest !== "function") return;
      var link = target.closest("a[href]");
      if (!link) return;

      var href = link.getAttribute("href");
      if (!href || href.charAt(0) === "#") return;
      if (link.target && link.target !== "_self") return;
      if (link.hasAttribute("download")) return;

      var url;
      try {
        url = new URL(link.href, window.location.href);
      } catch (e) {
        return;
      }

      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;

      event.preventDefault();
      navigating = true;
      body.classList.remove("page-visible");
      setTimeout(function () {
        window.location.href = url.href;
      }, 180);
    });
  }

  function onScroll() {
    if (ticking) {
      return;
    }

    ticking = true;
    window.requestAnimationFrame(function () {
      var y = window.scrollY || window.pageYOffset || 0;
      document.documentElement.style.setProperty("--cosmic-shift", String(y * 0.08) + "px");
      ticking = false;
    });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  setupPageTransitions();
})();
