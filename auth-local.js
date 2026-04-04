(function () {
  var STORE_KEY = "grizz-auth-store-v1";
  var SESSION_KEY = "grizz-auth-session-v1";

  function nowIso() {
    return new Date().toISOString();
  }

  function simpleHash(input) {
    var str = String(input || "");
    var h = 5381;
    for (var i = 0; i < str.length; i += 1) {
      h = ((h << 5) + h) + str.charCodeAt(i);
      h = h & h;
    }
    return String(h);
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) {
        return { users: [], siteContent: { heroTitle: "Cosmo Product Status", subtitle: "Live tracking for Updating and Testing products", announcement: "" }, manualItems: [] };
      }
      return JSON.parse(raw);
    } catch (e) {
      return { users: [], siteContent: { heroTitle: "Cosmo Product Status", subtitle: "Live tracking for Updating and Testing products", announcement: "" }, manualItems: [] };
    }
  }

  function saveStore(store) {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }

  function seedAdmin() {
    var store = loadStore();
    var exists = store.users.some(function (u) { return String(u.username).toLowerCase() === "mert"; });
    if (!exists) {
      store.users.push({
        id: "admin-mert",
        username: "mert",
        passwordHash: simpleHash("mert"),
        role: "admin",
        approved: true,
        banned: false,
        createdAt: nowIso(),
        lastSeen: nowIso()
      });
      saveStore(store);
    }
  }

  function getSessionUserId() {
    return localStorage.getItem(SESSION_KEY);
  }

  function setSessionUserId(id) {
    localStorage.setItem(SESSION_KEY, id);
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function getCurrentUser() {
    var store = loadStore();
    var id = getSessionUserId();
    if (!id) return null;
    return store.users.find(function (u) { return u.id === id; }) || null;
  }

  function registerSupport(username, password) {
    var u = String(username || "").trim();
    var p = String(password || "");
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(u)) {
      throw new Error("Username must be 3-32 chars: letters, numbers, _, ., -");
    }
    if (p.length < 4) {
      throw new Error("Password must be at least 4 characters");
    }

    var store = loadStore();
    var exists = store.users.some(function (x) { return String(x.username).toLowerCase() === u.toLowerCase(); });
    if (exists) {
      throw new Error("Username already exists");
    }

    store.users.push({
      id: "u-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
      username: u,
      passwordHash: simpleHash(p),
      role: "support",
      approved: false,
      banned: false,
      createdAt: nowIso(),
      lastSeen: null
    });
    saveStore(store);
    return { ok: true, message: "Registered. Waiting for admin approval." };
  }

  function login(username, password) {
    var u = String(username || "").trim().toLowerCase();
    var p = String(password || "");
    var store = loadStore();
    var user = store.users.find(function (x) { return String(x.username).toLowerCase() === u; });
    if (!user || user.passwordHash !== simpleHash(p)) {
      throw new Error("Invalid username or password");
    }
    if (user.banned) {
      throw new Error("This account is banned");
    }
    if (!user.approved) {
      throw new Error("Pending admin approval");
    }

    user.lastSeen = nowIso();
    saveStore(store);
    setSessionUserId(user.id);
    return user;
  }

  function logout() {
    clearSession();
  }

  function touch() {
    var store = loadStore();
    var id = getSessionUserId();
    if (!id) return;
    var user = store.users.find(function (u) { return u.id === id; });
    if (!user) return;
    user.lastSeen = nowIso();
    saveStore(store);
  }

  function requireApprovedSession(redirectTo) {
    var user = getCurrentUser();
    if (!user || !user.approved || user.banned) {
      window.location.href = redirectTo || "auth.html";
      return null;
    }
    return user;
  }

  function requireAdminSession(redirectTo) {
    var user = requireApprovedSession(redirectTo || "auth.html");
    if (!user) return null;
    if (user.role !== "admin") {
      window.location.href = redirectTo || "index.html";
      return null;
    }
    return user;
  }

  function getApprovedUsersWithPresence() {
    var now = Date.now();
    var store = loadStore();
    return store.users
      .filter(function (u) { return u.approved && !u.banned; })
      .map(function (u) {
        var ts = u.lastSeen ? Date.parse(u.lastSeen) : 0;
        return {
          id: u.id,
          username: u.username,
          role: u.role,
          online: !!ts && (now - ts <= 90000),
          lastSeen: u.lastSeen
        };
      });
  }

  function listUsers() {
    return loadStore().users.slice();
  }

  function updateUser(id, patch) {
    var store = loadStore();
    var user = store.users.find(function (u) { return u.id === id; });
    if (!user) throw new Error("User not found");
    Object.keys(patch).forEach(function (k) { user[k] = patch[k]; });
    saveStore(store);
    return user;
  }

  function removeUser(id, currentUserId) {
    if (id === currentUserId) throw new Error("You cannot remove your own account");
    var store = loadStore();
    var idx = store.users.findIndex(function (u) { return u.id === id; });
    if (idx === -1) throw new Error("User not found");
    store.users.splice(idx, 1);
    saveStore(store);
  }

  function getSiteContent() {
    return loadStore().siteContent;
  }

  function setSiteContent(content) {
    var store = loadStore();
    store.siteContent.heroTitle = String(content.heroTitle || store.siteContent.heroTitle || "");
    store.siteContent.subtitle = String(content.subtitle || store.siteContent.subtitle || "");
    store.siteContent.announcement = String(content.announcement || "");
    saveStore(store);
    return store.siteContent;
  }

  function getManualItems() {
    return loadStore().manualItems.slice();
  }

  function addManualItem(item) {
    var store = loadStore();
    var out = {
      id: "m-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
      brand: String(item.brand || "").trim(),
      game: String(item.game || "").trim(),
      status: String(item.status || "").trim(),
      updated: String(item.updated || nowIso()).trim()
    };
    if (!out.brand || !out.game || !out.status) throw new Error("brand, game, and status are required");
    store.manualItems.push(out);
    saveStore(store);
    return out;
  }

  function removeManualItem(id) {
    var store = loadStore();
    var idx = store.manualItems.findIndex(function (m) { return m.id === id; });
    if (idx === -1) throw new Error("Item not found");
    store.manualItems.splice(idx, 1);
    saveStore(store);
  }

  seedAdmin();

  window.GrizzAuth = {
    seedAdmin: seedAdmin,
    registerSupport: registerSupport,
    login: login,
    logout: logout,
    touch: touch,
    getCurrentUser: getCurrentUser,
    requireApprovedSession: requireApprovedSession,
    requireAdminSession: requireAdminSession,
    getApprovedUsersWithPresence: getApprovedUsersWithPresence,
    listUsers: listUsers,
    updateUser: updateUser,
    removeUser: removeUser,
    getSiteContent: getSiteContent,
    setSiteContent: setSiteContent,
    getManualItems: getManualItems,
    addManualItem: addManualItem,
    removeManualItem: removeManualItem
  };
})();
