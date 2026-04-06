(() => {
  "use strict";

  const page = document.body.dataset.page || "";
  const $ = (id) => document.getElementById(id);

  async function api(url, options = {}) {
    const init = {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: {},
      ...options
    };
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    const res = await fetch(url, init);
    let payload = null;
    try {
      payload = await res.json();
    } catch (_err) {
      payload = null;
    }
    if (!res.ok) {
      const message = payload && payload.error ? payload.error : `Request failed (${res.status})`;
      throw new Error(message);
    }
    return payload || {};
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function setState(id, value, type = "") {
    const el = $(id);
    if (!el) return;
    el.className = `state ${type}`.trim();
    el.textContent = value || "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  function escSelector(value) {
    const str = String(value || "");
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(str);
    return str.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function isAdmin(user) {
    return !!(user && user.roleStyle && user.roleStyle.adminAccess);
  }

  function isBoss(user) {
    return !!(user && String(user.role || "").toLowerCase() === "owner");
  }

  function applyAuthUi(user) {
    document.querySelectorAll("[data-auth-only]").forEach((el) => {
      el.style.display = user ? "" : "none";
    });
    document.querySelectorAll("[data-guest-only]").forEach((el) => {
      el.style.display = user ? "none" : "";
    });
    document.querySelectorAll("[data-admin-only]").forEach((el) => {
      el.style.display = isAdmin(user) ? "" : "none";
    });
    document.querySelectorAll("[data-boss-only]").forEach((el) => {
      el.style.display = isBoss(user) ? "" : "none";
    });
    if ($("whoami")) {
      $("whoami").textContent = user ? `${user.displayName} (${user.roleLabel})` : "Guest";
    }
  }

  async function getSession() {
    const payload = await api("/api/auth/session");
    return payload.user || null;
  }

  async function requireSession() {
    const user = await getSession();
    if (!user) {
      window.location.replace("auth.html");
      throw new Error("No session");
    }
    return user;
  }

  function bindLogout() {
    document.querySelectorAll("#logoutBtn,#logoutBtnMobile").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          await api("/api/auth/logout", { method: "POST", body: {} });
        } catch (_err) {
        }
        window.location.replace("auth.html");
      });
    });
  }

  function startHeartbeat() {
    let running = false;
    const ping = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        await api("/api/auth/touch", { method: "POST", body: {} });
      } catch (_err) {
      } finally {
        running = false;
      }
    };
    ping();
    setInterval(ping, 12000);
    document.addEventListener("visibilitychange", ping);
  }

  function bindSectionNav() {
    if (page !== "status") return;
    const links = Array.from(document.querySelectorAll(".jump-link[href^='#']"));
    if (!links.length) return;

    const byId = new Map();
    links.forEach((link) => {
      const id = String(link.getAttribute("href") || "").replace("#", "").trim();
      const section = id ? document.getElementById(id) : null;
      if (section) byId.set(id, link);
    });

    function setActive(id) {
      links.forEach((l) => l.classList.remove("active"));
      const hit = byId.get(id);
      if (hit) hit.classList.add("active");
    }

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (!visible.length) return;
      const id = visible[0].target.id;
      if (id) setActive(id);
    }, { root: null, threshold: [0.35, 0.55, 0.75] });

    byId.forEach((_link, id) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });

    setActive("home");
  }

  async function initAuthPage() {
    let current = null;
    try {
      current = await getSession();
    } catch (_err) {
      current = null;
    }
    applyAuthUi(current);
    if (current) {
      setState("authState", "Already logged in. Redirecting...", "ok");
      setTimeout(() => window.location.replace("index.html"), 500);
      return;
    }

    const activeLink = $("activeLink");
    const copyLinkBtn = $("copyLinkBtn");
    if (activeLink) {
      activeLink.value = `${window.location.origin}/auth.html`;
    }
    if (copyLinkBtn && activeLink) {
      copyLinkBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(activeLink.value);
          setState("authState", "Link copied.", "ok");
        } catch (_err) {
          setState("authState", "Copy failed. Copy manually.", "err");
        }
      });
    }

    const runLogin = async () => {
      setState("authState", "Logging in...");
      try {
        await api("/api/auth/login", {
          method: "POST",
          body: {
            username: $("loginUser").value,
            password: $("loginPass").value
          }
        });
        setState("authState", "Login successful.", "ok");
        window.location.replace("index.html");
      } catch (err) {
        setState("authState", err.message, "err");
      }
    };

    const loginForm = $("loginForm");
    if (loginForm) {
      loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await runLogin();
      });
    } else {
      const loginSubmit = $("loginSubmit");
      if (loginSubmit) {
        loginSubmit.addEventListener("click", runLogin);
      }
    }

    const registerForm = $("registerForm");
    if (registerForm) {
      registerForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        setState("authState", "Registering...");
        try {
          const res = await api("/api/auth/register", {
            method: "POST",
            body: {
              username: $("regUser").value,
              password: $("regPass").value
            }
          });
          setState("authState", res.message || "Registered. Waiting for approval.", "ok");
          registerForm.reset();
        } catch (err) {
          setState("authState", err.message, "err");
        }
      });
    }
  }

  async function initStatusPage() {
    const searchEl = $("searchInput");
    const filters = Array.from(document.querySelectorAll("[data-filter]"));
    let filter = "all";
    let rows = [];

    function renderStatus() {
      const q = (searchEl.value || "").trim().toLowerCase();
      const out = rows.filter((row) => {
        const hitQ = !q || `${row.brand} ${row.game} ${row.status}`.toLowerCase().includes(q);
        const hitF = filter === "all" || String(row.status).toLowerCase() === filter;
        return hitQ && hitF;
      });

      setText("countChip", `${out.length} shown`);
      const host = $("statusHost");
      host.innerHTML = out.map((row) => {
        const cls = String(row.status).toLowerCase() === "testing" ? "testing" : "updating";
        return `<article class="card"><h4>${escapeHtml(row.game)}</h4><p>${escapeHtml(row.brand)}</p><p><span class="badge ${cls}">${escapeHtml(row.status)}</span></p><p class="muted">${escapeHtml(row.updated || "-")}</p></article>`;
      }).join("");
      if (!out.length) host.innerHTML = "<p class=\"muted\">No products match your filter.</p>";
    }

    function renderPresence(users) {
      const online = users.filter((u) => u.online);
      const offline = users.filter((u) => !u.online);
      setText("presenceChip", `${online.length} online / ${offline.length} offline`);

      $("onlineHost").innerHTML = online.map((u) => {
        return `<div class="presence-row"><div><span class="dot on"></span>${escapeHtml(u.displayName)}</div><span class="muted">${escapeHtml(u.roleLabel)}</span></div>`;
      }).join("") || "<p class=\"muted\">Nobody online.</p>";

      $("offlineHost").innerHTML = offline.map((u) => {
        return `<div class="presence-row"><div><span class="dot off"></span>${escapeHtml(u.displayName)}</div><span class="muted">${formatDate(u.lastSeen)}</span></div>`;
      }).join("") || "<p class=\"muted\">Nobody offline.</p>";
    }

    filters.forEach((btn) => {
      btn.addEventListener("click", () => {
        filter = btn.dataset.filter;
        filters.forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
        renderStatus();
      });
    });
    searchEl.addEventListener("input", renderStatus);

    try {
      const [site, status, manual, presence] = await Promise.all([
        api("/api/site-content"),
        api("/api/status"),
        api("/api/manual-items"),
        api("/api/presence")
      ]);
      const content = site.siteContent || {};
      setText("title", content.heroTitle || "Support Operations");
      setText("subtitle", content.subtitle || "Live status and support activity");
      setText("announce", content.announcement || "");
      setText("syncChip", `Synced ${formatDate(status.fetchedAt)}`);

      rows = ([]).concat(status.items || [], manual.items || []);
      renderStatus();
      renderPresence(presence.users || []);
      setState("statusState", "Data loaded.", "ok");
    } catch (err) {
      setState("statusState", err.message, "err");
    }
  }

  async function initCommandsPage(user) {
    const searchEl = $("commandSearch");
    const host = $("commandHost");
    const adminPanel = $("commandAdminPanel");
    let commands = [];

    function render() {
      const q = (searchEl.value || "").trim().toLowerCase();
      const out = commands.filter((item) => !q || `${item.command} ${item.response}`.toLowerCase().includes(q));
      setText("commandCount", `${out.length} commands`);

      host.innerHTML = out.map((item) => {
        const removeBtn = isBoss(user) ? `<button class="danger" data-remove="${escapeHtml(item.id)}">Delete</button>` : "";
        return `<div class="list-row"><div class="toolbar"><strong>${escapeHtml(item.command)}</strong><div><button class="secondary" data-copy="${escapeHtml(item.id)}">Copy</button>${removeBtn}</div></div><p>${escapeHtml(item.response)}</p></div>`;
      }).join("");

      if (!out.length) host.innerHTML = "<p class=\"muted\">No commands found.</p>";

      host.querySelectorAll("[data-copy]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const found = commands.find((x) => x.id === btn.dataset.copy);
          if (!found) return;
          try {
            await navigator.clipboard.writeText(found.response);
            setState("commandState", `Copied ${found.command}`, "ok");
          } catch (_err) {
            setState("commandState", "Copy failed.", "err");
          }
        });
      });

      if (isBoss(user)) {
        host.querySelectorAll("[data-remove]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await api(`/api/admin/commands/${encodeURIComponent(btn.dataset.remove)}`, { method: "DELETE" });
              await load();
            } catch (err) {
              setState("commandState", err.message, "err");
            }
          });
        });
      }
    }

    async function load() {
      const payload = await api("/api/commands");
      commands = payload.commands || [];
      render();
    }

    adminPanel.style.display = isBoss(user) ? "" : "none";
    if (isBoss(user)) {
      $("addCommandForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await api("/api/admin/commands", {
            method: "POST",
            body: {
              command: $("newCommand").value,
              response: $("newResponse").value
            }
          });
          $("addCommandForm").reset();
          setState("commandState", "Command added.", "ok");
          await load();
        } catch (err) {
          setState("commandState", err.message, "err");
        }
      });
    }

    searchEl.addEventListener("input", render);
    try {
      await load();
      setState("commandState", "Commands loaded.", "ok");
    } catch (err) {
      setState("commandState", err.message, "err");
    }
  }

  async function initInlineCommands(user) {
    const searchEl = $("commandSearchInline");
    const host = $("commandHostInline");
    if (!searchEl || !host) return;

    let commands = [];

    function render() {
      const q = (searchEl.value || "").trim().toLowerCase();
      const out = commands.filter((item) => !q || `${item.command} ${item.response}`.toLowerCase().includes(q));
      setText("commandCountInline", `${out.length} commands`);
      host.innerHTML = out.map((item) => {
        return `<div class="list-row"><div class="toolbar"><strong>${escapeHtml(item.command)}</strong><button class="secondary" data-copy-inline="${escapeHtml(item.id)}">Copy</button></div><p>${escapeHtml(item.response)}</p></div>`;
      }).join("") || "<p class=\"muted\">No commands found.</p>";

      host.querySelectorAll("[data-copy-inline]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const found = commands.find((x) => x.id === btn.dataset.copyInline);
          if (!found) return;
          try {
            await navigator.clipboard.writeText(found.response);
            setState("commandStateInline", `Copied ${found.command}`, "ok");
          } catch (_err) {
            setState("commandStateInline", "Copy failed.", "err");
          }
        });
      });
    }

    searchEl.addEventListener("input", render);
    try {
      const payload = await api("/api/commands");
      commands = payload.commands || [];
      render();
      setState("commandStateInline", isBoss(user) ? "Commands loaded. Boss can manage from Commands page." : "Commands loaded.", "ok");
    } catch (err) {
      setState("commandStateInline", err.message, "err");
    }
  }

  async function initGuideWidget(config) {
    const searchEl = $(config.searchId);
    const navHost = $(config.navId);
    const titleEl = $(config.titleId);
    const bodyEl = $(config.bodyId);
    if (!searchEl || !navHost || !titleEl || !bodyEl) return;

    const defs = [
      { title: "1. Overview", anchors: ["Support Guide Overview"] },
      { title: "2. Links and Commands", anchors: ["https://support.cosmotickets.com/", "All bot commands"] },
      { title: "3. Slides Index", anchors: ["Overview of slides:"] },
      { title: "4. Cosmo Naxo", heading: "Cosmo (Naxo)" },
      { title: "5. Cosmo Pro", heading: "Cosmo Pro" },
      { title: "6. Atlas", heading: "Atlas" },
      { title: "7. Forge", heading: "Forge" },
      { title: "8. Astrozoom", heading: "Astrozoom" },
      { title: "9. Supreme", heading: "Supreme" },
      { title: "10. Kane", heading: "Kane" },
      { title: "11. Liquid", heading: "Liquid" },
      { title: "12. ProAim", heading: "ProAim" },
      { title: "13. Cobra", heading: "Cobra" },
      { title: "14. Athena", heading: "Athena" },
      { title: "15. Kraken Games", heading: "Kraken (Games)" },
      { title: "16. Kraken Spoofer", heading: "Kraken Spoofer" },
      { title: "17. Inferno", heading: "Inferno" },
      { title: "18. Pulse", heading: "Pulse" },
      { title: "19. Hero Valorant", heading: "Hero Valorant" },
      { title: "20. Hero OW2", heading: "Hero OW2" },
      { title: "21. Hero Delta Force", heading: "Hero Delta Force" },
      { title: "22. Hero FN/Rust/Apex/ABI/ARC", heading: "Hero FN,Rust,Apex,ABI,ARC" },
      { title: "23. VOLT", heading: "VOLT" },
      { title: "24. VEX", heading: "VEX" },
      { title: "25. Crown", heading: "Crown" },
      { title: "26. Opal", heading: "Opal" },
      { title: "27. Opal except FiveM", heading: "Opal except FiveM" },
      { title: "28. Viper", heading: "Viper" },
      { title: "29. Breeze", heading: "Breeze" },
      { title: "30. Vortex", heading: "Vortex" },
      { title: "31. Extra Fixes Kane", heading: "Extra Fixes Kane:" },
      { title: "32. Extra Rare Fixes", heading: "Extra rare fixes" },
      { title: "33. Refunds / Compensation / HWID", heading: "T.O.S. Refunds / Compensation / HWID Reset" }
    ];

    function normalize(raw) {
      return String(raw || "")
        .replace(/\r/g, "\n")
        .replace(/[\u000b\f]/g, "\n")
        .replace(/\n{3,}/g, "\n\n");
    }

    function escapeRegex(value) {
      return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function indexOfHeading(text, heading, fromIndex) {
      if (!heading) return -1;
      const source = text.slice(fromIndex || 0);
      const re = new RegExp(`(?:^|\\n)${escapeRegex(heading)}(?:\\n|$)`, "i");
      const m = re.exec(source);
      if (!m) return -1;
      return (fromIndex || 0) + m.index + (m[0].startsWith("\n") ? 1 : 0);
    }

    function indexOfAny(text, terms, fromIndex) {
      const t = text.toLowerCase();
      let best = -1;
      terms.forEach((term) => {
        const idx = t.indexOf(String(term).toLowerCase(), fromIndex || 0);
        if (idx !== -1 && (best === -1 || idx < best)) best = idx;
      });
      return best;
    }

    function extractSlides(text) {
      const starts = [];
      let cursor = 0;

      defs.forEach((def) => {
        let start = indexOfHeading(text, def.heading, cursor);
        if (start === -1 && def.anchors) {
          start = indexOfAny(text, def.anchors, cursor);
        }
        if (start === -1) {
          start = indexOfHeading(text, def.heading, 0);
        }
        if (start === -1 && def.anchors) {
          start = indexOfAny(text, def.anchors, 0);
        }

        starts.push(start);
        if (start !== -1) cursor = start + 1;
      });

      return defs.map((def, i) => {
        const start = starts[i];
        if (start === -1) {
          return { title: def.title, body: "Slide content missing in source export." };
        }

        let end = text.length;
        for (let j = i + 1; j < starts.length; j += 1) {
          const nextStart = starts[j];
          if (nextStart !== -1 && nextStart > start) {
            end = nextStart;
            break;
          }
        }

        const body = text.slice(start, end).trim();
        return { title: def.title, body: body || "Slide content missing in source export." };
      });
    }

    let slides = [];
    let filtered = [];
    let activeIndex = 0;

    function renderActive() {
      const slide = filtered[activeIndex] || null;
      if (!slide) {
        titleEl.textContent = "No slide selected";
        bodyEl.textContent = "No matching slides for this search.";
        return;
      }
      titleEl.textContent = slide.title;
      bodyEl.textContent = slide.body;
    }

    if (config.copyBtnId && $(config.copyBtnId)) {
      $(config.copyBtnId).addEventListener("click", async () => {
        const slide = filtered[activeIndex] || null;
        if (!slide) {
          setState(config.stateId, "No slide selected.", "err");
          return;
        }
        try {
          await navigator.clipboard.writeText(`${slide.title}\n\n${slide.body}`);
          setState(config.stateId, `${slide.title} copied.`, "ok");
        } catch (_err) {
          setState(config.stateId, "Copy failed.", "err");
        }
      });
    }

    function renderNav() {
      navHost.innerHTML = filtered.map((slide, i) => {
        const cls = i === activeIndex ? "slide-btn active" : "slide-btn";
        return `<button class="${cls}" data-slide-index="${i}">${escapeHtml(slide.title)}</button>`;
      }).join("");
      navHost.querySelectorAll("[data-slide-index]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeIndex = Number(btn.dataset.slideIndex || 0);
          renderNav();
          renderActive();
        });
      });
      setText(config.countId, `${filtered.length} slides`);
    }

    function applySearch() {
      const q = (searchEl.value || "").trim().toLowerCase();
      filtered = slides.filter((s) => !q || `${s.title}\n${s.body}`.toLowerCase().includes(q));
      activeIndex = 0;
      renderNav();
      renderActive();
    }

    searchEl.addEventListener("input", applySearch);
    try {
      const raw = await fetch("/slides_full.txt?t=" + Date.now(), { cache: "no-store", credentials: "same-origin" });
      if (!raw.ok) throw new Error(`Slides source missing (${raw.status})`);
      const text = normalize(await raw.text());
      slides = extractSlides(text);
      filtered = slides.slice();
      renderNav();
      renderActive();
      setState(config.stateId, "Guide loaded from 33-slide source.", "ok");
    } catch (err) {
      setState(config.stateId, err.message, "err");
    }
  }

  async function initProfilePage() {
    async function load() {
      const payload = await api("/api/profile");
      const user = payload.user;
      const cooldown = payload.nicknameCooldown || {};

      setText("profileName", user.displayName);
      setText("profileRole", user.roleLabel);
      setText("profileCreated", formatDate(user.createdAt));
      setText("profileSeen", formatDate(user.lastSeen));
      if (cooldown.canChange) {
        setText("nicknameHint", "Nickname can be changed now.");
      } else {
        setText("nicknameHint", `Nickname locked until ${formatDate(cooldown.nextAllowedAt)}.`);
      }
    }

    $("nicknameForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/profile/nickname", {
          method: "POST",
          body: { nickname: $("nicknameInput").value }
        });
        setState("profileState", "Nickname updated.", "ok");
        await load();
      } catch (err) {
        setState("profileState", err.message, "err");
      }
    });

    $("passwordForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/profile/password", {
          method: "POST",
          body: {
            currentPassword: $("currentPassword").value,
            newPassword: $("newPassword").value
          }
        });
        $("passwordForm").reset();
        setState("profileState", "Password updated.", "ok");
      } catch (err) {
        setState("profileState", err.message, "err");
      }
    });

    try {
      await load();
      setState("profileState", "Profile loaded.", "ok");
    } catch (err) {
      setState("profileState", err.message, "err");
    }
  }

  async function initGuidePage() {
    await initGuideWidget({
      searchId: "guideSearch",
      navId: "slidesNav",
      titleId: "slideTitle",
      bodyId: "slideBody",
      countId: "slideCountChip",
      stateId: "guideState"
    });
  }

  async function initAdminPage(user) {
    if (!isBoss(user)) {
      setState("adminState", "Boss access required.", "err");
      $("adminWorkspace").style.display = "none";
      return;
    }

    const usersHost = $("usersHost");
    const rolesHost = $("rolesHost");
    const itemsHost = $("itemsHost");

    $("createUserForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/admin/users", {
          method: "POST",
          body: {
            username: $("createUsername").value,
            password: $("createPassword").value,
            role: $("createRole").value
          }
        });
        $("createUserForm").reset();
        setState("adminState", "User account created.", "ok");
        await load();
      } catch (err) {
        setState("adminState", err.message, "err");
      }
    });

    async function load() {
      const [overview, users, roles, items, site] = await Promise.all([
        api("/api/admin/overview"),
        api("/api/admin/users"),
        api("/api/admin/roles"),
        api("/api/manual-items"),
        api("/api/site-content")
      ]);

      const stats = overview.stats || {};
      setText("mApproved", String(stats.approved || 0));
      setText("mPending", String(stats.pending || 0));
      setText("mBanned", String(stats.banned || 0));
      setText("mOnline", String(stats.online || 0));

      const siteContent = site.siteContent || {};
      $("heroTitleInput").value = siteContent.heroTitle || "";
      $("heroSubtitleInput").value = siteContent.subtitle || "";
      $("heroAnnouncementInput").value = siteContent.announcement || "";

      usersHost.innerHTML = `<div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Approved</th><th>Banned</th><th>Save</th><th>Remove</th></tr></thead><tbody>${(users.users || []).map((u) => {
        return `<tr><td>${escapeHtml(u.username)}<br><span class="muted">${escapeHtml(u.displayName)}</span></td><td><select data-role="${escapeHtml(u.id)}">${(roles.roles || []).map((r) => `<option value="${escapeHtml(r.name)}"${u.role === r.name ? " selected" : ""}>${escapeHtml(r.label)}</option>`).join("")}</select></td><td><input type="checkbox" data-approved="${escapeHtml(u.id)}"${u.approved ? " checked" : ""}></td><td><input type="checkbox" data-banned="${escapeHtml(u.id)}"${u.banned ? " checked" : ""}></td><td><button data-save="${escapeHtml(u.id)}">Save</button></td><td><button class="danger" data-remove="${escapeHtml(u.id)}">Remove</button></td></tr>`;
      }).join("")}</tbody></table></div>`;

      usersHost.querySelectorAll("[data-save]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.save;
          const safe = escSelector(id);
          try {
            await api(`/api/admin/users/${encodeURIComponent(id)}`, {
              method: "PATCH",
              body: {
                role: usersHost.querySelector(`[data-role="${safe}"]`).value,
                approved: !!usersHost.querySelector(`[data-approved="${safe}"]`).checked,
                banned: !!usersHost.querySelector(`[data-banned="${safe}"]`).checked
              }
            });
            setState("adminState", "User updated.", "ok");
            await load();
          } catch (err) {
            setState("adminState", err.message, "err");
          }
        });
      });

      usersHost.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await api(`/api/admin/users/${encodeURIComponent(btn.dataset.remove)}`, { method: "DELETE" });
            setState("adminState", "User removed.", "ok");
            await load();
          } catch (err) {
            setState("adminState", err.message, "err");
          }
        });
      });

      rolesHost.innerHTML = (roles.roles || []).map((r) => {
        const del = r.system ? "" : `<button class="danger" data-role-del="${escapeHtml(r.name)}">Delete</button>`;
        return `<div class="list-row"><div class="toolbar"><strong>${escapeHtml(r.label)}</strong>${del}</div><p class="muted">${escapeHtml(r.name)}${r.adminAccess ? " - admin" : ""}</p></div>`;
      }).join("");

      rolesHost.querySelectorAll("[data-role-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await api(`/api/admin/roles/${encodeURIComponent(btn.dataset.roleDel)}`, { method: "DELETE" });
            await load();
          } catch (err) {
            setState("adminState", err.message, "err");
          }
        });
      });

      itemsHost.innerHTML = (items.items || []).map((item) => {
        return `<div class="list-row"><div class="toolbar"><strong>${escapeHtml(item.game)}</strong><button class="danger" data-item-del="${escapeHtml(item.id)}">Delete</button></div><p>${escapeHtml(item.brand)} - ${escapeHtml(item.status)}</p><p class="muted">${escapeHtml(item.updated)}</p></div>`;
      }).join("") || "<p class=\"muted\">No manual items.</p>";

      const roleSelect = $("createRole");
      if (roleSelect) {
        const current = roleSelect.value;
        roleSelect.innerHTML = (roles.roles || [])
          .filter((r) => String(r.name || "") !== "owner")
          .map((r) => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.label)}</option>`)
          .join("");
        if (current && roleSelect.querySelector(`option[value="${escSelector(current)}"]`)) {
          roleSelect.value = current;
        }
      }

      itemsHost.querySelectorAll("[data-item-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await api(`/api/manual-items/${encodeURIComponent(btn.dataset.itemDel)}`, { method: "DELETE" });
            await load();
          } catch (err) {
            setState("adminState", err.message, "err");
          }
        });
      });
    }

    $("siteContentForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/site-content", {
          method: "PUT",
          body: {
            heroTitle: $("heroTitleInput").value,
            subtitle: $("heroSubtitleInput").value,
            announcement: $("heroAnnouncementInput").value
          }
        });
        setState("adminState", "Homepage content saved.", "ok");
      } catch (err) {
        setState("adminState", err.message, "err");
      }
    });

    $("roleForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/admin/roles", {
          method: "POST",
          body: {
            name: $("roleName").value,
            label: $("roleLabel").value,
            color: $("roleColor").value,
            accent: $("roleAccent").value,
            adminAccess: $("roleAdmin").checked,
            glow: $("roleGlow").checked
          }
        });
        $("roleForm").reset();
        await load();
      } catch (err) {
        setState("adminState", err.message, "err");
      }
    });

    $("manualForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/manual-items", {
          method: "POST",
          body: {
            brand: $("manualBrand").value,
            game: $("manualGame").value,
            status: $("manualStatus").value,
            updated: $("manualUpdated").value
          }
        });
        $("manualForm").reset();
        await load();
      } catch (err) {
        setState("adminState", err.message, "err");
      }
    });

    try {
      await load();
      setState("adminState", "Admin workspace loaded.", "ok");
    } catch (err) {
      setState("adminState", err.message, "err");
    }
  }

  async function boot() {
    bindLogout();
    bindSectionNav();
    if (page === "auth") {
      await initAuthPage();
      return;
    }

    const user = await requireSession();
    applyAuthUi(user);
    startHeartbeat();

    if (page === "status") await initStatusPage();
    if (page === "status") await initInlineCommands(user);
    if (page === "status") await initGuideWidget({
      searchId: "guideSearchInline",
      navId: "slidesNavInline",
      titleId: "slideTitleInline",
      bodyId: "slideBodyInline",
      countId: "slideCountInline",
      stateId: "guideStateInline",
      copyBtnId: "copySlideInline"
    });
    if (page === "commands") await initCommandsPage(user);
    if (page === "profile") await initProfilePage();
    if (page === "presentation") await initGuidePage();
    if (page === "admin") await initAdminPage(user);
  }

  boot().catch((err) => {
    setState("globalState", err.message, "err");
  });
})();
