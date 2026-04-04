(function () {
  var STORE_KEY = "grizz-auth-store-v2";
  var LEGACY_STORE_KEY = "grizz-auth-store-v1";
  var SESSION_KEY = "grizz-auth-session-v1";
  var NICKNAME_COOLDOWN_MS = 21 * 24 * 60 * 60 * 1000;

  var DEFAULT_SITE_CONTENT = {
    heroTitle: "Cosmo Product Status",
    subtitle: "Live tracking for Updating and Testing products",
    announcement: ""
  };

  var DEFAULT_ROLES = [
    { name: "owner", label: "Owner", color: "#ffd369", accent: "#ff8f3a", glow: true, adminAccess: true, system: true },
    { name: "coder", label: "Coder", color: "#67f5ff", accent: "#26a7ff", glow: true, adminAccess: true, system: true },
    { name: "manager", label: "Manager", color: "#8dfca6", accent: "#38c97a", glow: false, adminAccess: true, system: true },
    { name: "admin", label: "Admin", color: "#f9a8d4", accent: "#ec4899", glow: false, adminAccess: true, system: true },
    { name: "support", label: "Support", color: "#aac6ff", accent: "#5d88ff", glow: false, adminAccess: false, system: true }
  ];

  function nowIso() {
    return new Date().toISOString();
  }

  function uid(prefix) {
    return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
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

  function normalizeRoleName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeUsername(value) {
    return String(value || "").trim().toLowerCase();
  }

  function ensureStoreShape(store) {
    var out = store && typeof store === "object" ? store : {};
    if (!Array.isArray(out.users)) out.users = [];
    if (!out.siteContent || typeof out.siteContent !== "object") out.siteContent = {};
    if (!Array.isArray(out.manualItems)) out.manualItems = [];
    if (!Array.isArray(out.roles)) out.roles = [];

    DEFAULT_ROLES.forEach(function (baseRole) {
      var existing = out.roles.find(function (r) {
        return normalizeRoleName(r && r.name) === baseRole.name;
      });
      if (!existing) {
        out.roles.push(JSON.parse(JSON.stringify(baseRole)));
      } else {
        existing.name = baseRole.name;
        if (!existing.label) existing.label = baseRole.label;
        if (!existing.color) existing.color = baseRole.color;
        if (!existing.accent) existing.accent = baseRole.accent;
        existing.glow = !!existing.glow || !!baseRole.glow;
        existing.adminAccess = !!existing.adminAccess || !!baseRole.adminAccess;
        existing.system = true;
      }
    });

    out.siteContent.heroTitle = String(out.siteContent.heroTitle || DEFAULT_SITE_CONTENT.heroTitle);
    out.siteContent.subtitle = String(out.siteContent.subtitle || DEFAULT_SITE_CONTENT.subtitle);
    out.siteContent.announcement = String(out.siteContent.announcement || "");

    out.users = out.users.map(function (user) {
      var role = normalizeRoleName(user.role) || "support";
      if (role === "admin") role = "manager";
      return {
        id: user.id || uid("u"),
        username: String(user.username || "").trim(),
        passwordHash: String(user.passwordHash || ""),
        role: role,
        approved: !!user.approved,
        banned: !!user.banned,
        createdAt: user.createdAt || nowIso(),
        lastSeen: user.lastSeen || null,
        nickname: user.nickname ? String(user.nickname).trim() : "",
        nicknameUpdatedAt: user.nicknameUpdatedAt || null
      };
    });

    return out;
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) return ensureStoreShape(JSON.parse(raw));
      var legacyRaw = localStorage.getItem(LEGACY_STORE_KEY);
      if (legacyRaw) return ensureStoreShape(JSON.parse(legacyRaw));
    } catch (e) {}
    return ensureStoreShape({ users: [], roles: [], siteContent: DEFAULT_SITE_CONTENT, manualItems: [] });
  }

  function saveStore(store) {
    var safe = ensureStoreShape(store);
    localStorage.setItem(STORE_KEY, JSON.stringify(safe));
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

  function findRole(store, roleName) {
    var norm = normalizeRoleName(roleName);
    return store.roles.find(function (r) { return normalizeRoleName(r.name) === norm; }) || null;
  }

  function hasAdminAccess(user) {
    if (!user) return false;
    var store = loadStore();
    var role = findRole(store, user.role);
    if (!role && normalizeRoleName(user.role) === "admin") return true;
    return !!(role && role.adminAccess);
  }

  function sanitizePublicUser(store, user) {
    var role = findRole(store, user.role);
    var safeDisplayName = (user.nickname && String(user.nickname).trim()) || "No Nickname";
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname || "",
      displayName: safeDisplayName,
      role: user.role,
      roleLabel: role ? role.label : user.role,
      roleStyle: role ? {
        name: role.name,
        color: role.color,
        accent: role.accent,
        glow: !!role.glow,
        adminAccess: !!role.adminAccess
      } : null,
      approved: !!user.approved,
      banned: !!user.banned,
      createdAt: user.createdAt,
      lastSeen: user.lastSeen,
      nicknameUpdatedAt: user.nicknameUpdatedAt || null
    };
  }

  function getCurrentUser() {
    var store = loadStore();
    var id = getSessionUserId();
    if (!id) return null;
    var user = store.users.find(function (u) { return u.id === id; });
    if (!user) return null;
    return sanitizePublicUser(store, user);
  }

  function seedPrivilegedUsers() {
    var store = loadStore();
    var didChange = false;

    function upsertFixed(id, username, password, roleName, nickname) {
      var existing = store.users.find(function (u) {
        return normalizeUsername(u.username) === normalizeUsername(username) || u.id === id;
      });
      if (!existing) {
        store.users.push({
          id: id,
          username: username,
          passwordHash: simpleHash(password),
          role: roleName,
          approved: true,
          banned: false,
          createdAt: nowIso(),
          lastSeen: null,
          nickname: nickname || "",
          nicknameUpdatedAt: null
        });
        didChange = true;
        return;
      }
      if (normalizeRoleName(existing.role) !== roleName) {
        existing.role = roleName;
        didChange = true;
      }
      if (!existing.approved) {
        existing.approved = true;
        didChange = true;
      }
      if (existing.banned) {
        existing.banned = false;
        didChange = true;
      }
      if ((!existing.nickname || !String(existing.nickname).trim()) && nickname) {
        existing.nickname = nickname;
        didChange = true;
      }
    }

    upsertFixed("owner-mert", "mert", "mert", "owner", "Cosmo Owner");
    upsertFixed("coder-yurixd666", "yurixd666", "yurixd666", "coder", "Nova Coder");

    if (didChange) saveStore(store);
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
    var exists = store.users.some(function (x) {
      return normalizeUsername(x.username) === normalizeUsername(u);
    });
    if (exists) throw new Error("Username already exists");

    store.users.push({
      id: uid("u"),
      username: u,
      passwordHash: simpleHash(p),
      role: "support",
      approved: false,
      banned: false,
      createdAt: nowIso(),
      lastSeen: null,
      nickname: "",
      nicknameUpdatedAt: null
    });

    saveStore(store);
    return { ok: true, message: "Registered. Waiting for admin approval." };
  }

  function login(username, password) {
    var u = normalizeUsername(username);
    var p = String(password || "");
    var store = loadStore();
    var user = store.users.find(function (x) {
      return normalizeUsername(x.username) === u;
    });

    if (!user || user.passwordHash !== simpleHash(p)) {
      throw new Error("Invalid username or password");
    }
    if (user.banned) throw new Error("This account is banned");
    if (!user.approved) throw new Error("Pending admin approval");

    user.lastSeen = nowIso();
    saveStore(store);
    setSessionUserId(user.id);
    return sanitizePublicUser(store, user);
  }

  function logout() {
    clearSession();
  }

  function touch() {
    var id = getSessionUserId();
    if (!id) return;
    var store = loadStore();
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
    if (!hasAdminAccess(user)) {
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
        var publicUser = sanitizePublicUser(store, u);
        publicUser.online = !!ts && (now - ts <= 90000);
        return publicUser;
      })
      .sort(function (a, b) {
        if (a.online && !b.online) return -1;
        if (!a.online && b.online) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }

  function listUsers() {
    var store = loadStore();
    return store.users.map(function (u) { return sanitizePublicUser(store, u); });
  }

  function listRoles() {
    var store = loadStore();
    return store.roles.slice().sort(function (a, b) {
      return a.label.localeCompare(b.label);
    });
  }

  function createRole(payload) {
    var name = normalizeRoleName(payload && payload.name);
    var label = String((payload && payload.label) || name).trim();
    var color = String((payload && payload.color) || "#aac6ff").trim();
    var accent = String((payload && payload.accent) || "#5d88ff").trim();
    if (!/^[a-z0-9_-]{2,24}$/.test(name)) {
      throw new Error("Role name must be 2-24 chars: lowercase letters, numbers, _ or -");
    }

    var store = loadStore();
    if (findRole(store, name)) throw new Error("Role already exists");

    var role = {
      name: name,
      label: label || name,
      color: color || "#aac6ff",
      accent: accent || "#5d88ff",
      glow: !!(payload && payload.glow),
      adminAccess: !!(payload && payload.adminAccess),
      system: false
    };
    store.roles.push(role);
    saveStore(store);
    return role;
  }

  function removeRole(name) {
    var roleName = normalizeRoleName(name);
    var store = loadStore();
    var role = findRole(store, roleName);
    if (!role) throw new Error("Role not found");
    if (role.system) throw new Error("System role cannot be removed");
    if (roleName === "support") throw new Error("Support role cannot be removed");
    store.roles = store.roles.filter(function (r) { return normalizeRoleName(r.name) !== roleName; });
    store.users.forEach(function (u) {
      if (normalizeRoleName(u.role) === roleName) {
        u.role = "support";
      }
    });
    saveStore(store);
  }

  function setUserRole(id, roleName) {
    var store = loadStore();
    var user = store.users.find(function (u) { return u.id === id; });
    if (!user) throw new Error("User not found");
    var role = findRole(store, roleName);
    if (!role) throw new Error("Role does not exist");
    user.role = role.name;
    saveStore(store);
    return sanitizePublicUser(store, user);
  }

  function updateUser(id, patch) {
    var store = loadStore();
    var user = store.users.find(function (u) { return u.id === id; });
    if (!user) throw new Error("User not found");
    if (patch.hasOwnProperty("approved")) user.approved = !!patch.approved;
    if (patch.hasOwnProperty("banned")) user.banned = !!patch.banned;
    if (patch.hasOwnProperty("role")) {
      var role = findRole(store, patch.role);
      if (!role) throw new Error("Role does not exist");
      user.role = role.name;
    }
    saveStore(store);
    return sanitizePublicUser(store, user);
  }

  function removeUser(id, currentUserId) {
    if (id === currentUserId) throw new Error("You cannot remove your own account");
    var store = loadStore();
    var idx = store.users.findIndex(function (u) { return u.id === id; });
    if (idx === -1) throw new Error("User not found");
    var user = store.users[idx];
    if (normalizeUsername(user.username) === "mert" || normalizeUsername(user.username) === "yurixd666") {
      throw new Error("Privileged seeded accounts cannot be removed");
    }
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
      id: uid("m"),
      brand: String(item.brand || "").trim(),
      game: String(item.game || "").trim(),
      status: String(item.status || "").trim(),
      updated: String(item.updated || nowIso()).trim()
    };
    if (!out.brand || !out.game || !out.status) {
      throw new Error("brand, game, and status are required");
    }
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

  function getNicknameCooldown(userId) {
    var store = loadStore();
    var user = store.users.find(function (u) { return u.id === userId; });
    if (!user) throw new Error("User not found");
    if (!user.nicknameUpdatedAt) return { canChange: true, waitMs: 0, nextAllowedAt: null };
    var nextAllowed = Date.parse(user.nicknameUpdatedAt) + NICKNAME_COOLDOWN_MS;
    var waitMs = Math.max(0, nextAllowed - Date.now());
    return {
      canChange: waitMs === 0,
      waitMs: waitMs,
      nextAllowedAt: new Date(nextAllowed).toISOString()
    };
  }

  function updateNickname(userId, nickname) {
    var nick = String(nickname || "").trim();
    if (!/^[a-zA-Z0-9_.\-\s]{3,24}$/.test(nick)) {
      throw new Error("Nickname must be 3-24 chars: letters, numbers, spaces, _, ., -");
    }

    var store = loadStore();
    var user = store.users.find(function (u) { return u.id === userId; });
    if (!user) throw new Error("User not found");

    var cooldown = getNicknameCooldown(userId);
    if (!cooldown.canChange) {
      var days = Math.ceil(cooldown.waitMs / (24 * 60 * 60 * 1000));
      throw new Error("Nickname can be changed again in about " + days + " day(s)");
    }

    user.nickname = nick;
    user.nicknameUpdatedAt = nowIso();
    saveStore(store);
    return sanitizePublicUser(store, user);
  }

  function changePassword(userId, currentPassword, newPassword) {
    var current = String(currentPassword || "");
    var next = String(newPassword || "");
    if (next.length < 4) throw new Error("New password must be at least 4 characters");

    var store = loadStore();
    var user = store.users.find(function (u) { return u.id === userId; });
    if (!user) throw new Error("User not found");
    if (user.passwordHash !== simpleHash(current)) {
      throw new Error("Current password is incorrect");
    }
    user.passwordHash = simpleHash(next);
    saveStore(store);
    return true;
  }

  seedPrivilegedUsers();

  window.GrizzAuth = {
    registerSupport: registerSupport,
    login: login,
    logout: logout,
    touch: touch,
    hasAdminAccess: hasAdminAccess,
    getCurrentUser: getCurrentUser,
    requireApprovedSession: requireApprovedSession,
    requireAdminSession: requireAdminSession,
    getApprovedUsersWithPresence: getApprovedUsersWithPresence,
    listUsers: listUsers,
    listRoles: listRoles,
    createRole: createRole,
    removeRole: removeRole,
    setUserRole: setUserRole,
    updateUser: updateUser,
    removeUser: removeUser,
    getSiteContent: getSiteContent,
    setSiteContent: setSiteContent,
    getManualItems: getManualItems,
    addManualItem: addManualItem,
    removeManualItem: removeManualItem,
    getNicknameCooldown: getNicknameCooldown,
    updateNickname: updateNickname,
    changePassword: changePassword
  };
})();
