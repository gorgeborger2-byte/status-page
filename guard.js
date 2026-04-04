(function () {
  var overlayVisible = false;

  function ensureOverlay() {
    var existing = document.getElementById("grizz-guard-overlay");
    if (existing) {
      return existing;
    }

    var overlay = document.createElement("div");
    overlay.id = "grizz-guard-overlay";
    overlay.className = "grizz-guard-overlay";
    overlay.innerHTML = ""
      + "<div class=\"grizz-guard-box\">"
      + "<p class=\"grizz-guard-title\">ACCESS BLOCKED</p>"
      + "<p class=\"grizz-guard-main\">Gr1zz not allowed here</p>"
      + "<p class=\"grizz-guard-sub\">Inspection / developer tools are blocked on this page.</p>"
      + "<button type=\"button\" class=\"grizz-guard-close\" id=\"grizzGuardClose\">Close</button>"
      + "</div>";

    document.body.appendChild(overlay);

    var closeBtn = document.getElementById("grizzGuardClose");
    closeBtn.addEventListener("click", function () {
      overlay.classList.remove("show");
      overlayVisible = false;
    });

    return overlay;
  }

  function showBigGuard(reason) {
    var overlay = ensureOverlay();
    overlay.classList.add("show");
    overlayVisible = true;

    try {
      console.error("[SECURITY BLOCK] Gr1zz not allowed here | reason: " + reason);
    } catch (e) {
      // ignore
    }
  }

  function showGuardMessage() {
    var existing = document.getElementById("grizz-guard-msg");
    if (existing) {
      existing.classList.add("show");
      clearTimeout(existing._hideTimer);
      existing._hideTimer = setTimeout(function () {
        existing.classList.remove("show");
      }, 1800);
      return;
    }

    var msg = document.createElement("div");
    msg.id = "grizz-guard-msg";
    msg.className = "grizz-guard-msg show";
    msg.textContent = "You cannot be here Grizz";
    document.body.appendChild(msg);

    msg._hideTimer = setTimeout(function () {
      msg.classList.remove("show");
    }, 1800);
  }

  document.addEventListener("contextmenu", function (event) {
    event.preventDefault();
    showGuardMessage();
    showBigGuard("contextmenu");
  });

  document.addEventListener("keydown", function (event) {
    var key = (event.key || "").toLowerCase();
    var blocked = false;

    if (key === "f12") {
      blocked = true;
    }

    if (event.ctrlKey && event.shiftKey && (key === "i" || key === "j" || key === "c")) {
      blocked = true;
    }

    if (event.ctrlKey && key === "u") {
      blocked = true;
    }

    if (blocked) {
      event.preventDefault();
      event.stopPropagation();
      showGuardMessage();
      showBigGuard("keyboard");
    }
  }, true);

  if ("ontouchstart" in window) {
    var longPressTimer = null;

    document.addEventListener("touchstart", function (event) {
      if (!event.touches || event.touches.length !== 1) {
        return;
      }
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(function () {
        showGuardMessage();
        showBigGuard("mobile-long-press");
      }, 650);
    }, { passive: true });

    function clearLongPress() {
      clearTimeout(longPressTimer);
    }

    document.addEventListener("touchend", clearLongPress, { passive: true });
    document.addEventListener("touchcancel", clearLongPress, { passive: true });
    document.addEventListener("touchmove", clearLongPress, { passive: true });
  }

  setInterval(function () {
    var devtoolsOpen = (window.outerWidth - window.innerWidth > 160) || (window.outerHeight - window.innerHeight > 160);
    if (devtoolsOpen && !overlayVisible) {
      showBigGuard("devtools-detected");
    }
  }, 800);
})();
