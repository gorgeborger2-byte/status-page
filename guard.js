(function () {
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
    }
  }, true);
})();
