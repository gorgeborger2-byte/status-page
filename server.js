const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = path.join(__dirname, "backend-db.json");
const ONLINE_WINDOW_MS = 90 * 1000;
const STATUS_FILE = path.join(__dirname, "data", "status.json");

function nowIso() {
  return new Date().toISOString();
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    return {
      users: [],
      siteContent: {
        heroTitle: "Cosmo Product Status",
        subtitle: "Live tracking for Updating and Testing products",
        announcement: "",
      },
      manualItems: [],
    };
  }

  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + "\n", "utf8");
}

function ensureAdmin(db) {
  const existing = db.users.find((u) => u.username.toLowerCase() === "mert");
  if (existing) {
    return;
  }

  db.users.push({
    id: crypto.randomUUID(),
    username: "mert",
    passwordHash: bcrypt.hashSync("mert", 10),
    role: "admin",
    approved: true,
    createdAt: nowIso(),
    lastSeen: nowIso(),
  });
}

function sanitizeUsername(value) {
  return String(value || "").trim();
}

function validateUsername(username) {
  return /^[a-zA-Z0-9_.-]{3,32}$/.test(username);
}

function authUser(req, db) {
  const userId = req.session.userId;
  if (!userId) {
    return null;
  }
  return db.users.find((u) => u.id === userId) || null;
}

function requireAuth(req, res, next) {
  const db = loadDb();
  const user = authUser(req, db);
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  req.db = db;
  req.user = user;
  return next();
}

function requirePageAuth(req, res, next) {
  const db = loadDb();
  const user = authUser(req, db);
  if (!user) {
    return res.redirect("/auth.html");
  }
  req.db = db;
  req.user = user;
  return next();
}

function requireAdminPage(req, res, next) {
  const db = loadDb();
  const user = authUser(req, db);
  if (!user) {
    return res.redirect("/auth.html");
  }
  if (user.role !== "admin") {
    return res.redirect("/index.html");
  }
  req.db = db;
  req.user = user;
  return next();
}

function requireAdmin(req, res, next) {
  const db = loadDb();
  const user = authUser(req, db);
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (user.role !== "admin") {
    return res.status(403).json({ error: "Admin required" });
  }
  req.db = db;
  req.user = user;
  return next();
}

const dbBoot = loadDb();
ensureAdmin(dbBoot);
saveDb(dbBoot);

app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-secret-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.post("/api/auth/register", (req, res) => {
  const db = loadDb();
  const username = sanitizeUsername(req.body.username);
  const password = String(req.body.password || "");

  if (!validateUsername(username)) {
    return res.status(400).json({ error: "Username must be 3-32 chars: letters, numbers, _, ., -" });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }

  const exists = db.users.some((u) => u.username.toLowerCase() === username.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: "Username already exists" });
  }

  db.users.push({
    id: crypto.randomUUID(),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role: "support",
    approved: false,
    createdAt: nowIso(),
    lastSeen: null,
  });

  saveDb(db);
  return res.json({ ok: true, message: "Registered. Waiting for admin approval." });
});

app.post("/api/auth/login", (req, res) => {
  const db = loadDb();
  const username = sanitizeUsername(req.body.username);
  const password = String(req.body.password || "");

  const user = db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  if (!bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  if (!user.approved) {
    return res.status(403).json({ error: "Pending admin approval" });
  }

  user.lastSeen = nowIso();
  saveDb(db);
  req.session.userId = user.id;
  return req.session.save(() => {
    res.json({ ok: true, user: { username: user.username, role: user.role, approved: user.approved } });
  });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/auth/me", (req, res) => {
  const db = loadDb();
  const user = authUser(req, db);
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  return res.json({ user: { id: user.id, username: user.username, role: user.role, approved: user.approved, lastSeen: user.lastSeen } });
});

app.post("/api/auth/heartbeat", requireAuth, (req, res) => {
  req.user.lastSeen = nowIso();
  saveDb(req.db);
  return res.json({ ok: true, lastSeen: req.user.lastSeen });
});

app.get("/api/users/presence", requireAuth, (req, res) => {
  const now = Date.now();
  const users = req.db.users
    .filter((u) => u.approved)
    .map((u) => {
      const seenTs = u.lastSeen ? Date.parse(u.lastSeen) : 0;
      const online = !!seenTs && now - seenTs <= ONLINE_WINDOW_MS;
      return {
        id: u.id,
        username: u.username,
        role: u.role,
        online,
        lastSeen: u.lastSeen,
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username));

  return res.json({ users });
});

app.get("/api/site/config", requireAuth, (req, res) => {
  return res.json({ siteContent: req.db.siteContent, manualItems: req.db.manualItems });
});

app.get("/api/status-feed", requireAuth, (req, res) => {
  let statusData = { items: [], fetchedAt: nowIso(), lastUpdated: "--" };
  if (fs.existsSync(STATUS_FILE)) {
    try {
      statusData = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
    } catch (e) {
      // fallback to empty
    }
  }

  const items = (statusData.items || []).concat(req.db.manualItems || []);
  return res.json({
    source: statusData.source || "",
    fetchedAt: statusData.fetchedAt || nowIso(),
    lastUpdated: statusData.lastUpdated || "--",
    items,
  });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = req.db.users.map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    approved: u.approved,
    createdAt: u.createdAt,
    lastSeen: u.lastSeen,
  }));
  return res.json({ users });
});

app.post("/api/admin/users/:id/approve", requireAdmin, (req, res) => {
  const user = req.db.users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  user.approved = !!req.body.approved;
  saveDb(req.db);
  return res.json({ ok: true, user: { id: user.id, approved: user.approved } });
});

app.post("/api/admin/users/:id/role", requireAdmin, (req, res) => {
  const role = String(req.body.role || "").toLowerCase();
  if (!["admin", "support"].includes(role)) {
    return res.status(400).json({ error: "Role must be admin or support" });
  }
  const user = req.db.users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  user.role = role;
  saveDb(req.db);
  return res.json({ ok: true, user: { id: user.id, role: user.role } });
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  if (req.user.id === req.params.id) {
    return res.status(400).json({ error: "You cannot remove your own account" });
  }
  const idx = req.db.users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "User not found" });
  }
  req.db.users.splice(idx, 1);
  saveDb(req.db);
  return res.json({ ok: true });
});

app.get("/api/admin/content", requireAdmin, (req, res) => {
  return res.json({ siteContent: req.db.siteContent, manualItems: req.db.manualItems });
});

app.put("/api/admin/content", requireAdmin, (req, res) => {
  const heroTitle = String(req.body.heroTitle || "").trim();
  const subtitle = String(req.body.subtitle || "").trim();
  const announcement = String(req.body.announcement || "").trim();

  req.db.siteContent.heroTitle = heroTitle || req.db.siteContent.heroTitle;
  req.db.siteContent.subtitle = subtitle || req.db.siteContent.subtitle;
  req.db.siteContent.announcement = announcement;

  saveDb(req.db);
  return res.json({ ok: true, siteContent: req.db.siteContent });
});

app.post("/api/admin/manual-items", requireAdmin, (req, res) => {
  const brand = String(req.body.brand || "").trim();
  const game = String(req.body.game || "").trim();
  const status = String(req.body.status || "").trim();
  const updated = String(req.body.updated || "").trim();

  if (!brand || !game || !status) {
    return res.status(400).json({ error: "brand, game, and status are required" });
  }

  const item = {
    id: crypto.randomUUID(),
    brand,
    game,
    status,
    updated: updated || nowIso(),
  };

  req.db.manualItems.push(item);
  saveDb(req.db);
  return res.json({ ok: true, item });
});

app.delete("/api/admin/manual-items/:id", requireAdmin, (req, res) => {
  const idx = req.db.manualItems.findIndex((i) => i.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Item not found" });
  }
  req.db.manualItems.splice(idx, 1);
  saveDb(req.db);
  return res.json({ ok: true });
});

app.get("/", requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/index.html", requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/presentation.html", requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "presentation.html"));
});

app.get("/admin.html", requireAdminPage, (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/auth.html", (req, res) => {
  res.sendFile(path.join(__dirname, "auth.html"));
});

app.get("/slides_full.txt", requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "slides_full.txt"));
});

app.get("/data/status.json", requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "data", "status.json"));
});

app.use((req, res, next) => {
  const blocked = new Set([
    "/server.js",
    "/backend-db.json",
    "/package.json",
    "/package-lock.json",
    "/grizz-ginger-boy-installer.nsi",
    "/grizz-ginger-boy-installer.iss",
  ]);
  if (blocked.has(req.path)) {
    return res.status(404).end();
  }
  return next();
});

app.use(express.static(__dirname, { index: false }));

app.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);
});
