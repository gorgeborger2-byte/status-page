const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || "cosmo-dev-secret-change-me";
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "backend-db.json");
const OWNER_USERNAME = String(process.env.OWNER_USERNAME || "").trim();
const OWNER_PASSWORD = String(process.env.OWNER_PASSWORD || "");
const CODER_USERNAME = String(process.env.CODER_USERNAME || "").trim();
const CODER_PASSWORD = String(process.env.CODER_PASSWORD || "");
const NICKNAME_COOLDOWN_MS = 21 * 24 * 60 * 60 * 1000;
const PRESENCE_WINDOW_MS = 45 * 1000;
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 25;
const STATUS_SYNC_INTERVAL_MS = Math.max(30 * 1000, Number(process.env.STATUS_SYNC_INTERVAL_MS || 30 * 1000));

const PUBLIC_FILE_ALLOWLIST = new Set([
  "/auth.html",
  "/index.html",
  "/admin.html",
  "/profile.html",
  "/presentation.html",
  "/commands.html",
  "/styles.css",
  "/auth-local.js",
  "/guard.js",
  "/ui-effects.js",
  "/data/status.json"
]);
const STATUS_JSON_PATH = path.join(__dirname, "data", "status.json");

const DEFAULT_SITE_CONTENT = {
  heroTitle: "Cosmo Product Status",
  subtitle: "Live tracking for Updating and Testing products",
  announcement: ""
};

const DEFAULT_ROLES = [
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
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function normalizeRoleName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function userRecencyTs(user) {
  const candidates = [user.nicknameUpdatedAt, user.lastSeen, user.createdAt]
    .map((v) => (v ? Date.parse(v) : 0))
    .filter((v) => Number.isFinite(v));
  return candidates.length ? Math.max(...candidates) : 0;
}

function safeReadDb() {
  const dirPath = path.dirname(DB_PATH);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], roles: [], siteContent: DEFAULT_SITE_CONTENT, manualItems: [], auditLogs: [] }, null, 2));
  }

  const raw = fs.readFileSync(DB_PATH, "utf8");
  const parsed = JSON.parse(raw || "{}");
  const db = parsed && typeof parsed === "object" ? parsed : {};
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.roles)) db.roles = [];
  if (!Array.isArray(db.commands)) db.commands = [];
  if (!db.siteContent || typeof db.siteContent !== "object") db.siteContent = {};
  if (!Array.isArray(db.manualItems)) db.manualItems = [];
  if (!Array.isArray(db.auditLogs)) db.auditLogs = [];

  DEFAULT_ROLES.forEach((base) => {
    const existing = db.roles.find((r) => normalizeRoleName(r && r.name) === base.name);
    if (!existing) {
      db.roles.push({ ...base });
    } else {
      existing.name = base.name;
      existing.label = existing.label || base.label;
      existing.color = existing.color || base.color;
      existing.accent = existing.accent || base.accent;
      existing.glow = !!existing.glow || !!base.glow;
      existing.adminAccess = !!existing.adminAccess || !!base.adminAccess;
      existing.system = true;
    }
  });

  db.siteContent.heroTitle = String(db.siteContent.heroTitle || DEFAULT_SITE_CONTENT.heroTitle);
  db.siteContent.subtitle = String(db.siteContent.subtitle || DEFAULT_SITE_CONTENT.subtitle);
  db.siteContent.announcement = String(db.siteContent.announcement || "");

  db.users = db.users.map((u) => ({
    id: u.id || uid("u"),
    username: String(u.username || "").trim(),
    passwordHash: String(u.passwordHash || ""),
    role: normalizeRoleName(u.role) || "support",
    approved: !!u.approved,
    banned: !!u.banned,
    createdAt: u.createdAt || nowIso(),
    lastSeen: u.lastSeen || null,
    nickname: String(u.nickname || "").trim(),
    nicknameUpdatedAt: u.nicknameUpdatedAt || null
  }));

  const dedupedByUsername = new Map();
  db.users.forEach((u) => {
    const key = normalizeUsername(u.username);
    if (!key) return;
    const existing = dedupedByUsername.get(key);
    if (!existing) {
      dedupedByUsername.set(key, u);
      return;
    }

    const existingScore = userRecencyTs(existing) + (existing.approved ? 1000 : 0) + (existing.banned ? -500 : 0);
    const nextScore = userRecencyTs(u) + (u.approved ? 1000 : 0) + (u.banned ? -500 : 0);
    if (nextScore >= existingScore) {
      dedupedByUsername.set(key, u);
    }
  });
  db.users = Array.from(dedupedByUsername.values());

  return db;
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function findRole(db, roleName) {
  const norm = normalizeRoleName(roleName);
  return db.roles.find((r) => normalizeRoleName(r.name) === norm) || null;
}

function roleHasAdmin(db, roleName) {
  const role = findRole(db, roleName);
  return !!(role && role.adminAccess);
}

function sanitizeUser(db, user, opts = {}) {
  const role = findRole(db, user.role);
  const displayName = (user.nickname && user.nickname.trim()) || "No Nickname";
  return {
    id: user.id,
    username: opts.includeUsername ? user.username : undefined,
    displayName,
    nickname: user.nickname || "",
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

function audit(db, actor, action, target, details) {
  db.auditLogs.unshift({
    id: uid("log"),
    at: nowIso(),
    actor: actor || "system",
    action,
    target: target || "-",
    details: details || ""
  });
  if (db.auditLogs.length > 800) db.auditLogs = db.auditLogs.slice(0, 800);
}

function seedAccountsIfNeeded() {
  const db = safeReadDb();
  let changed = false;

  function upsertFixed(id, username, password, role, nickname) {
    let user = db.users.find((u) => normalizeUsername(u.username) === normalizeUsername(username) || u.id === id);
    if (!user) {
      user = {
        id,
        username,
        passwordHash: bcrypt.hashSync(password, 10),
        role,
        approved: true,
        banned: false,
        createdAt: nowIso(),
        lastSeen: null,
        nickname,
        nicknameUpdatedAt: null
      };
      db.users.push(user);
      changed = true;
      return;
    }
    if (user.role !== role) { user.role = role; changed = true; }
    if (!user.approved) { user.approved = true; changed = true; }
    if (user.banned) { user.banned = false; changed = true; }
    if (!user.passwordHash) {
      user.passwordHash = bcrypt.hashSync(password, 10);
      changed = true;
    }
  }

  if (OWNER_USERNAME && OWNER_PASSWORD) {
    upsertFixed("owner-seeded", OWNER_USERNAME, OWNER_PASSWORD, "owner", "Cosmo Owner");
  }
  if (CODER_USERNAME && CODER_PASSWORD) {
    upsertFixed("coder-seeded", CODER_USERNAME, CODER_PASSWORD, "coder", "Nova Coder");
  }

  if (!db.users.some((u) => roleHasAdmin(db, u.role) && u.approved && !u.banned)) {
    const bootstrapPassword = Math.random().toString(36).slice(-12);
    db.users.push({
      id: "owner-bootstrap",
      username: "owner",
      passwordHash: bcrypt.hashSync(bootstrapPassword, 10),
      role: "owner",
      approved: true,
      banned: false,
      createdAt: nowIso(),
      lastSeen: null,
      nickname: "Cosmo Owner",
      nicknameUpdatedAt: null
    });
    console.log("[BOOTSTRAP] Created local owner account:");
    console.log("[BOOTSTRAP] username: owner");
    console.log("[BOOTSTRAP] password:", bootstrapPassword);
    changed = true;
  }

  if (changed) saveDb(db);
}

seedAccountsIfNeeded();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const authRateLimitMap = new Map();

function getClientIp(req) {
  return String((req.headers["cf-connecting-ip"] || req.ip || req.socket.remoteAddress || "unknown")).slice(0, 90);
}

function checkAuthRateLimit(req, res, next) {
  const username = normalizeUsername(req.body && req.body.username);
  const key = `${getClientIp(req)}:${req.path}:${username || "anon"}`;
  const now = Date.now();
  const row = authRateLimitMap.get(key);
  if (!row || now - row.startedAt > AUTH_WINDOW_MS) {
    authRateLimitMap.set(key, { startedAt: now, attempts: 1 });
    return next();
  }
  row.attempts += 1;
  if (row.attempts > AUTH_MAX_ATTEMPTS) {
    return res.status(429).json({ error: "Too many attempts. Please wait and try again." });
  }
  return next();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of authRateLimitMap.entries()) {
    if (!value || now - value.startedAt > AUTH_WINDOW_MS * 2) {
      authRateLimitMap.delete(key);
    }
  }
}, AUTH_WINDOW_MS).unref();

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()") ;
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
});

app.use((req, res, next) => {
  const unsafe = req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE";
  if (!unsafe || !String(req.path || "").startsWith("/api/")) return next();

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== host) {
        return res.status(403).json({ error: "Cross-site request blocked" });
      }
    } catch (e) {
      return res.status(403).json({ error: "Invalid request origin" });
    }
  }
  return next();
});

app.use(express.json({ limit: "1mb" }));
app.use(session({
  name: "cosmo.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}));

function authRequired(req, res, next) {
  const db = safeReadDb();
  const userId = req.session.userId;
  const user = db.users.find((u) => u.id === userId);
  if (!user || !user.approved || user.banned) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.db = db;
  req.user = user;
  next();
}

function adminRequired(req, res, next) {
  if (!roleHasAdmin(req.db, req.user.role)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

app.post("/api/auth/register", checkAuthRateLimit, (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-32 chars: letters, numbers, _, ., -" });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }

  const db = safeReadDb();
  const exists = db.users.some((u) => normalizeUsername(u.username) === normalizeUsername(username));
  if (exists) {
    return res.status(400).json({ error: "Username already exists" });
  }

  db.users.push({
    id: uid("u"),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role: "support",
    approved: false,
    banned: false,
    createdAt: nowIso(),
    lastSeen: null,
    nickname: "",
    nicknameUpdatedAt: null
  });
  audit(db, "guest", "register", username, "support account requested");
  saveDb(db);
  res.json({ ok: true, message: "Registered. Waiting for admin approval." });
});

app.post("/api/auth/login", checkAuthRateLimit, (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");
  const db = safeReadDb();
  const user = db.users.find((u) => normalizeUsername(u.username) === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(400).json({ error: "Invalid username or password" });
  }
  if (user.banned) return res.status(403).json({ error: "This account is banned" });
  if (!user.approved) return res.status(403).json({ error: "Pending admin approval" });

  user.lastSeen = nowIso();
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Session error" });
    req.session.userId = user.id;
    audit(db, user.username, "login", user.username, "session started");
    saveDb(db);
    return res.json({ user: sanitizeUser(db, user, { includeUsername: true }) });
  });
});

app.post("/api/auth/logout", authRequired, (req, res) => {
  const db = req.db;
  req.user.lastSeen = null;
  audit(db, req.user.username, "logout", req.user.username, "session ended");
  saveDb(db);
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/auth/session", (req, res) => {
  const db = safeReadDb();
  const user = db.users.find((u) => u.id === req.session.userId);
  if (!user || !user.approved || user.banned) return res.json({ user: null });
  res.json({ user: sanitizeUser(db, user, { includeUsername: true }) });
});

app.post("/api/auth/touch", authRequired, (req, res) => {
  const last = req.user.lastSeen ? Date.parse(req.user.lastSeen) : 0;
  if (!last || Date.now() - last > 15000) {
    req.user.lastSeen = nowIso();
    saveDb(req.db);
  }
  res.json({ ok: true });
});

app.get("/api/presence", authRequired, (req, res) => {
  const now = Date.now();
  const users = req.db.users
    .filter((u) => u.approved && !u.banned)
    .map((u) => {
      const out = sanitizeUser(req.db, u, { includeUsername: roleHasAdmin(req.db, req.user.role) });
      const ts = u.lastSeen ? Date.parse(u.lastSeen) : 0;
      out.online = !!ts && (now - ts <= PRESENCE_WINDOW_MS);
      return out;
    })
    .sort((a, b) => {
      if (a.online && !b.online) return -1;
      if (!a.online && b.online) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  res.json({ users });
});

app.get("/api/site-content", authRequired, (req, res) => {
  res.json({ siteContent: req.db.siteContent });
});

app.get("/api/commands", authRequired, (req, res) => {
  const commands = req.db.commands
    .slice()
    .sort((a, b) => String(a.command || "").localeCompare(String(b.command || "")));
  res.json({ commands });
});

app.put("/api/site-content", authRequired, adminRequired, (req, res) => {
  req.db.siteContent.heroTitle = String(req.body.heroTitle || req.db.siteContent.heroTitle || "");
  req.db.siteContent.subtitle = String(req.body.subtitle || req.db.siteContent.subtitle || "");
  req.db.siteContent.announcement = String(req.body.announcement || "");
  audit(req.db, req.user.username, "site-content:update", "siteContent", "updated hero/subtitle/announcement");
  saveDb(req.db);
  res.json({ siteContent: req.db.siteContent });
});

app.get("/api/manual-items", authRequired, (req, res) => {
  res.json({ items: req.db.manualItems });
});

app.post("/api/manual-items", authRequired, adminRequired, (req, res) => {
  const out = {
    id: uid("m"),
    brand: String(req.body.brand || "").trim(),
    game: String(req.body.game || "").trim(),
    status: String(req.body.status || "").trim(),
    updated: String(req.body.updated || nowIso()).trim()
  };
  if (!out.brand || !out.game || !out.status) {
    return res.status(400).json({ error: "brand, game, and status are required" });
  }
  req.db.manualItems.push(out);
  audit(req.db, req.user.username, "manual-item:add", `${out.brand}/${out.game}`, out.status);
  saveDb(req.db);
  res.json({ item: out });
});

app.delete("/api/manual-items/:id", authRequired, adminRequired, (req, res) => {
  const idx = req.db.manualItems.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Item not found" });
  const removed = req.db.manualItems[idx];
  req.db.manualItems.splice(idx, 1);
  audit(req.db, req.user.username, "manual-item:remove", `${removed.brand}/${removed.game}`, removed.status);
  saveDb(req.db);
  res.json({ ok: true });
});

app.post("/api/admin/commands/bootstrap", authRequired, adminRequired, (req, res) => {
  const items = Array.isArray(req.body && req.body.commands) ? req.body.commands : [];
  if (!items.length) return res.status(400).json({ error: "commands array is required" });
  if (req.db.commands.length > 0) return res.json({ ok: true, skipped: true });

  const mapped = items
    .map((item) => ({
      id: uid("cmd"),
      command: String(item.command || "").trim(),
      response: String(item.response || "").trim(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    }))
    .filter((item) => item.command && item.response)
    .slice(0, 500);

  if (!mapped.length) return res.status(400).json({ error: "No valid commands provided" });
  req.db.commands = mapped;
  audit(req.db, req.user.username, "commands:bootstrap", "commands", `seeded ${mapped.length} commands`);
  saveDb(req.db);
  return res.json({ ok: true, created: mapped.length });
});

app.post("/api/admin/commands", authRequired, adminRequired, (req, res) => {
  const command = String(req.body.command || "").trim();
  const response = String(req.body.response || "").trim();
  if (!/^\*[a-z0-9_-]{2,40}$/i.test(command)) {
    return res.status(400).json({ error: "Command must start with * and be 3-41 chars" });
  }
  if (response.length < 2 || response.length > 12000) {
    return res.status(400).json({ error: "Response must be between 2 and 12000 chars" });
  }
  const exists = req.db.commands.some((c) => String(c.command || "").toLowerCase() === command.toLowerCase());
  if (exists) return res.status(400).json({ error: "Command already exists" });

  const item = {
    id: uid("cmd"),
    command,
    response,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  req.db.commands.push(item);
  audit(req.db, req.user.username, "commands:add", command, "added command");
  saveDb(req.db);
  res.json({ command: item });
});

app.delete("/api/admin/commands/:id", authRequired, adminRequired, (req, res) => {
  const idx = req.db.commands.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Command not found" });
  const removed = req.db.commands[idx];
  req.db.commands.splice(idx, 1);
  audit(req.db, req.user.username, "commands:remove", removed.command, "removed command");
  saveDb(req.db);
  res.json({ ok: true });
});

app.get("/api/profile", authRequired, (req, res) => {
  const user = sanitizeUser(req.db, req.user, { includeUsername: true });
  let canChangeNickname = true;
  let waitMs = 0;
  let nextAllowedAt = null;
  if (req.user.nicknameUpdatedAt) {
    const nextAllowed = Date.parse(req.user.nicknameUpdatedAt) + NICKNAME_COOLDOWN_MS;
    waitMs = Math.max(0, nextAllowed - Date.now());
    canChangeNickname = waitMs === 0;
    nextAllowedAt = new Date(nextAllowed).toISOString();
  }
  res.json({ user, nicknameCooldown: { canChange: canChangeNickname, waitMs, nextAllowedAt } });
});

app.post("/api/profile/nickname", authRequired, (req, res) => {
  const nickname = String(req.body.nickname || "").trim();
  if (!/^[a-zA-Z0-9_.\-\s]{3,24}$/.test(nickname)) {
    return res.status(400).json({ error: "Nickname must be 3-24 chars: letters, numbers, spaces, _, ., -" });
  }
  if (req.user.nicknameUpdatedAt) {
    const nextAllowed = Date.parse(req.user.nicknameUpdatedAt) + NICKNAME_COOLDOWN_MS;
    const waitMs = Math.max(0, nextAllowed - Date.now());
    if (waitMs > 0) {
      const days = Math.ceil(waitMs / (24 * 60 * 60 * 1000));
      return res.status(400).json({ error: `Nickname can be changed again in about ${days} day(s)` });
    }
  }
  req.user.nickname = nickname;
  req.user.nicknameUpdatedAt = nowIso();
  audit(req.db, req.user.username, "profile:nickname", req.user.username, nickname);
  saveDb(req.db);
  res.json({ user: sanitizeUser(req.db, req.user, { includeUsername: true }) });
});

app.post("/api/profile/password", authRequired, (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  if (newPassword.length < 4) return res.status(400).json({ error: "New password must be at least 4 characters" });
  if (!bcrypt.compareSync(currentPassword, req.user.passwordHash)) {
    return res.status(400).json({ error: "Current password is incorrect" });
  }
  req.user.passwordHash = bcrypt.hashSync(newPassword, 10);
  audit(req.db, req.user.username, "profile:password", req.user.username, "password changed");
  saveDb(req.db);
  res.json({ ok: true });
});

app.get("/api/admin/overview", authRequired, adminRequired, (req, res) => {
  const users = req.db.users;
  const now = Date.now();
  const approved = users.filter((u) => u.approved && !u.banned).length;
  const pending = users.filter((u) => !u.approved && !u.banned).length;
  const banned = users.filter((u) => u.banned).length;
  const online = users.filter((u) => {
    if (!u.approved || u.banned || !u.lastSeen) return false;
    return now - Date.parse(u.lastSeen) <= PRESENCE_WINDOW_MS;
  }).length;
  res.json({
    stats: {
      approved,
      pending,
      banned,
      online,
      roles: req.db.roles.length,
      manualItems: req.db.manualItems.length
    },
    recentLogs: req.db.auditLogs.slice(0, 30)
  });
});

app.get("/api/admin/logs", authRequired, adminRequired, (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 120)));
  res.json({ logs: req.db.auditLogs.slice(0, limit) });
});

app.get("/api/admin/store", authRequired, adminRequired, (req, res) => {
  const users = req.db.users.map((u) => ({
    ...u,
    passwordHash: "[hidden]"
  }));
  res.json({
    users,
    roles: req.db.roles,
    commands: req.db.commands,
    siteContent: req.db.siteContent,
    manualItems: req.db.manualItems,
    auditLogs: req.db.auditLogs.slice(0, 200)
  });
});

app.get("/api/admin/users", authRequired, adminRequired, (req, res) => {
  res.json({ users: req.db.users.map((u) => sanitizeUser(req.db, u, { includeUsername: true })) });
});

app.patch("/api/admin/users/:id", authRequired, adminRequired, (req, res) => {
  const target = req.db.users.find((u) => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });

  if (Object.prototype.hasOwnProperty.call(req.body, "approved")) target.approved = !!req.body.approved;
  if (Object.prototype.hasOwnProperty.call(req.body, "banned")) target.banned = !!req.body.banned;
  if (Object.prototype.hasOwnProperty.call(req.body, "role")) {
    const role = findRole(req.db, req.body.role);
    if (!role) return res.status(400).json({ error: "Role does not exist" });
    target.role = role.name;
  }

  audit(req.db, req.user.username, "user:update", target.username, JSON.stringify(req.body || {}));
  saveDb(req.db);
  res.json({ user: sanitizeUser(req.db, target, { includeUsername: true }) });
});

app.delete("/api/admin/users/:id", authRequired, adminRequired, (req, res) => {
  if (req.user.id === req.params.id) return res.status(400).json({ error: "You cannot remove your own account" });
  const idx = req.db.users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  const target = req.db.users[idx];
  if (["owner-seeded", "coder-seeded", "owner-bootstrap"].includes(String(target.id || ""))) {
    return res.status(400).json({ error: "Privileged seeded accounts cannot be removed" });
  }
  req.db.users.splice(idx, 1);
  audit(req.db, req.user.username, "user:remove", target.username, "removed account");
  saveDb(req.db);
  res.json({ ok: true });
});

app.get("/api/admin/roles", authRequired, adminRequired, (req, res) => {
  const roles = req.db.roles.slice().sort((a, b) => a.label.localeCompare(b.label));
  res.json({ roles });
});

app.post("/api/admin/roles", authRequired, adminRequired, (req, res) => {
  const name = normalizeRoleName(req.body.name);
  const label = String(req.body.label || name).trim();
  const color = String(req.body.color || "#aac6ff").trim();
  const accent = String(req.body.accent || "#5d88ff").trim();

  if (!/^[a-z0-9_-]{2,24}$/.test(name)) {
    return res.status(400).json({ error: "Role name must be 2-24 chars: lowercase letters, numbers, _ or -" });
  }
  if (findRole(req.db, name)) return res.status(400).json({ error: "Role already exists" });

  const role = {
    name,
    label: label || name,
    color,
    accent,
    glow: !!req.body.glow,
    adminAccess: !!req.body.adminAccess,
    system: false
  };
  req.db.roles.push(role);
  audit(req.db, req.user.username, "role:create", name, JSON.stringify(role));
  saveDb(req.db);
  res.json({ role });
});

app.delete("/api/admin/roles/:name", authRequired, adminRequired, (req, res) => {
  const roleName = normalizeRoleName(req.params.name);
  const role = findRole(req.db, roleName);
  if (!role) return res.status(404).json({ error: "Role not found" });
  if (role.system || roleName === "support") {
    return res.status(400).json({ error: "System role cannot be removed" });
  }

  req.db.roles = req.db.roles.filter((r) => normalizeRoleName(r.name) !== roleName);
  req.db.users.forEach((u) => {
    if (normalizeRoleName(u.role) === roleName) u.role = "support";
  });
  audit(req.db, req.user.username, "role:remove", roleName, "removed role and reassigned users");
  saveDb(req.db);
  res.json({ ok: true });
});

app.use((req, res, next) => {
  const p = String(req.path || "").toLowerCase();
  const blockedExact = new Set([
    "/backend-db.json",
    "/server.js",
    "/package.json",
    "/package-lock.json",
    "/render.yaml"
  ]);
  const blockedPrefixes = [
    "/node_modules/",
    "/runtime-logs/",
    "/scripts/",
    "/.github/"
  ];
  if (blockedExact.has(p) || blockedPrefixes.some((prefix) => p.startsWith(prefix))) {
    return res.status(404).send("Not found");
  }
  return next();
});

app.use((req, res, next) => {
  const p = String(req.path || "").toLowerCase();
  if (p.startsWith("/api/")) return next();
  if (p === "/") return next();
  if (PUBLIC_FILE_ALLOWLIST.has(p)) return next();
  return res.status(404).send("Not found");
});

app.get("/", (req, res) => {
  res.redirect("/auth.html");
});

app.use(express.static(__dirname, {
  index: false,
  fallthrough: true,
  dotfiles: "ignore",
  etag: true,
  maxAge: "5m"
}));

let isStatusSyncRunning = false;
let statusSyncPromise = null;
let lastStatusSyncAt = 0;
let lastStatusSyncOk = false;

function runStatusSync(trigger) {
  if (!process.env.STATUS_PASSWORD) return Promise.resolve(false);
  if (isStatusSyncRunning && statusSyncPromise) return statusSyncPromise;
  isStatusSyncRunning = true;

  statusSyncPromise = new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "scripts", "fetch-status.mjs")], {
      cwd: __dirname,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stdout.on("data", (buf) => {
      console.log(`[status-sync:${trigger}] ${String(buf).trim()}`);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("close", (code) => {
      lastStatusSyncAt = Date.now();
      lastStatusSyncOk = code === 0;
      if (code !== 0) {
        console.error(`[status-sync:${trigger}] failed with code ${code}`);
        if (stderr.trim()) console.error(stderr.trim());
      }
      isStatusSyncRunning = false;
      resolve(code === 0);
    });
  });

  return statusSyncPromise;
}

function readStatusPayload() {
  try {
    if (!fs.existsSync(STATUS_JSON_PATH)) return null;
    const raw = fs.readFileSync(STATUS_JSON_PATH, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

app.get("/api/status", authRequired, async (req, res) => {
  if (process.env.STATUS_PASSWORD) {
    const stale = !lastStatusSyncAt || (Date.now() - lastStatusSyncAt > Math.max(25 * 1000, STATUS_SYNC_INTERVAL_MS + 5000));
    if (stale) {
      await runStatusSync("api");
    }
  }

  const payload = readStatusPayload();
  if (!payload) {
    return res.status(503).json({ error: "Status feed not available yet" });
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  return res.json({
    ...payload,
    syncInfo: {
      lastStatusSyncAt: lastStatusSyncAt ? new Date(lastStatusSyncAt).toISOString() : null,
      lastStatusSyncOk
    }
  });
});

function startStatusSyncLoop() {
  if (!process.env.STATUS_PASSWORD) {
    console.log("[status-sync] disabled: STATUS_PASSWORD is not set");
    return;
  }
  runStatusSync("startup");
  setInterval(() => runStatusSync("interval"), STATUS_SYNC_INTERVAL_MS);
}

app.listen(PORT, () => {
  console.log(`Cosmo backend running on http://localhost:${PORT}`);
  startStatusSyncLoop();
});
