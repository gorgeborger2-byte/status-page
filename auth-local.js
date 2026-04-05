(function () {
  var currentUser = null;

  function parseJsonSafe(res) {
    return res.text().then(function (text) {
      try {
        return text ? JSON.parse(text) : {};
      } catch (e) {
        return {};
      }
    });
  }

  function request(url, options) {
    return fetch(url, Object.assign({
      credentials: "include",
      headers: { "Content-Type": "application/json" }
    }, options || {})).then(function (res) {
      return parseJsonSafe(res).then(function (body) {
        if (!res.ok) {
          throw new Error(body.error || ("Request failed: " + res.status));
        }
        return body;
      });
    });
  }

  function init() {
    return request("/api/auth/session").then(function (data) {
      currentUser = data.user || null;
      return currentUser;
    }).catch(function () {
      currentUser = null;
      return null;
    });
  }

  function hasAdminAccess(user) {
    var u = user || currentUser;
    return !!(u && u.roleStyle && u.roleStyle.adminAccess);
  }

  function getCurrentUser() {
    return currentUser;
  }

  function requireApprovedSession(redirectTo) {
    if (!currentUser || !currentUser.approved || currentUser.banned) {
      window.location.href = redirectTo || "auth.html";
      return null;
    }
    return currentUser;
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

  function registerSupport(username, password) {
    return request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username: username, password: password })
    });
  }

  function login(username, password) {
    return request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: username, password: password })
    }).then(function (data) {
      currentUser = data.user;
      return currentUser;
    });
  }

  function logout() {
    return request("/api/auth/logout", { method: "POST" }).catch(function () {
      return { ok: true };
    }).then(function () {
      currentUser = null;
    });
  }

  function touch() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return Promise.resolve({ ok: false, skipped: true });
    }
    return request("/api/auth/touch", { method: "POST" }).catch(function () {
      return { ok: false };
    });
  }

  function getApprovedUsersWithPresence() {
    return request("/api/presence").then(function (data) { return data.users || []; });
  }

  function listUsers() {
    return request("/api/admin/users").then(function (data) { return data.users || []; });
  }

  function updateUser(id, patch) {
    return request("/api/admin/users/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(patch || {})
    }).then(function (data) { return data.user; });
  }

  function removeUser(id) {
    return request("/api/admin/users/" + encodeURIComponent(id), { method: "DELETE" });
  }

  function listRoles() {
    return request("/api/admin/roles").then(function (data) { return data.roles || []; });
  }

  function createRole(payload) {
    return request("/api/admin/roles", {
      method: "POST",
      body: JSON.stringify(payload || {})
    }).then(function (data) { return data.role; });
  }

  function removeRole(name) {
    return request("/api/admin/roles/" + encodeURIComponent(name), { method: "DELETE" });
  }

  function setUserRole(id, roleName) {
    return updateUser(id, { role: roleName });
  }

  function getSiteContent() {
    return request("/api/site-content").then(function (data) { return data.siteContent || {}; });
  }

  function setSiteContent(content) {
    return request("/api/site-content", {
      method: "PUT",
      body: JSON.stringify(content || {})
    }).then(function (data) { return data.siteContent || {}; });
  }

  function getManualItems() {
    return request("/api/manual-items").then(function (data) { return data.items || []; });
  }

  function getCommands() {
    return request("/api/commands").then(function (data) { return data.commands || []; });
  }

  function addCommand(command, response) {
    return request("/api/admin/commands", {
      method: "POST",
      body: JSON.stringify({ command: command, response: response })
    }).then(function (data) { return data.command; });
  }

  function removeCommand(id) {
    return request("/api/admin/commands/" + encodeURIComponent(id), { method: "DELETE" });
  }

  function bootstrapCommands(commands) {
    return request("/api/admin/commands/bootstrap", {
      method: "POST",
      body: JSON.stringify({ commands: commands || [] })
    });
  }

  function addManualItem(item) {
    return request("/api/manual-items", {
      method: "POST",
      body: JSON.stringify(item || {})
    }).then(function (data) { return data.item; });
  }

  function removeManualItem(id) {
    return request("/api/manual-items/" + encodeURIComponent(id), { method: "DELETE" });
  }

  function getNicknameCooldown() {
    return request("/api/profile").then(function (data) {
      return data.nicknameCooldown || { canChange: true, waitMs: 0, nextAllowedAt: null };
    });
  }

  function updateNickname(userId, nickname) {
    return request("/api/profile/nickname", {
      method: "POST",
      body: JSON.stringify({ nickname: nickname })
    }).then(function (data) {
      currentUser = data.user;
      return data.user;
    });
  }

  function changePassword(userId, currentPassword, newPassword) {
    return request("/api/profile/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: currentPassword, newPassword: newPassword })
    });
  }

  function getAdminOverview() {
    return request("/api/admin/overview");
  }

  function getAdminLogs(limit) {
    var q = Number(limit || 120);
    return request("/api/admin/logs?limit=" + q).then(function (data) { return data.logs || []; });
  }

  function getAdminStore() {
    return request("/api/admin/store");
  }

  window.GrizzAuth = {
    init: init,
    hasAdminAccess: hasAdminAccess,
    getCurrentUser: getCurrentUser,
    requireApprovedSession: requireApprovedSession,
    requireAdminSession: requireAdminSession,
    registerSupport: registerSupport,
    login: login,
    logout: logout,
    touch: touch,
    getApprovedUsersWithPresence: getApprovedUsersWithPresence,
    listUsers: listUsers,
    updateUser: updateUser,
    removeUser: removeUser,
    listRoles: listRoles,
    createRole: createRole,
    removeRole: removeRole,
    setUserRole: setUserRole,
    getSiteContent: getSiteContent,
    setSiteContent: setSiteContent,
    getManualItems: getManualItems,
    getCommands: getCommands,
    addCommand: addCommand,
    removeCommand: removeCommand,
    bootstrapCommands: bootstrapCommands,
    addManualItem: addManualItem,
    removeManualItem: removeManualItem,
    getNicknameCooldown: getNicknameCooldown,
    updateNickname: updateNickname,
    changePassword: changePassword,
    getAdminOverview: getAdminOverview,
    getAdminLogs: getAdminLogs,
    getAdminStore: getAdminStore
  };
})();
