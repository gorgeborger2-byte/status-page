import { writeFile } from "node:fs/promises";

const statusUrl = process.env.STATUS_URL || "https://support.cosmotickets.com/status/index.php";
const password = process.env.STATUS_PASSWORD;

if (!password) {
  throw new Error("STATUS_PASSWORD is required.");
}

function normalize(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function mergeCookies(cookieMap, setCookieHeaders) {
  for (const header of setCookieHeaders) {
    const part = header.split(";")[0];
    const separator = part.indexOf("=");
    if (separator > 0) {
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      cookieMap.set(key, value);
    }
  }
}

function cookieHeader(cookieMap) {
  return Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function parseStatuses(html) {
  const sectionChunks = html.split('<div class="brand-section">').slice(1);
  const results = [];

  for (const chunk of sectionChunks) {
    const brandMatch = chunk.match(/<h2>([\s\S]*?)<\/h2>/i);
    const brand = normalize(brandMatch ? brandMatch[1] : "Unknown");

    const gameRegex = /<div class="game-card[^\"]*">[\s\S]*?<div class="game-name">([\s\S]*?)<\/div>[\s\S]*?<span class="status-text">([\s\S]*?)<\/span>[\s\S]*?<div class="game-updated">\s*Updated:\s*([\s\S]*?)\s*<\/div>/gi;
    let gameMatch = gameRegex.exec(chunk);

    while (gameMatch) {
      const game = normalize(gameMatch[1]);
      const status = normalize(gameMatch[2]);
      const updated = normalize(gameMatch[3]);

      const normalizedStatus = status.toLowerCase();
      if (normalizedStatus === "updating" || normalizedStatus === "testing") {
        results.push({ brand, game, status, updated });
      }

      gameMatch = gameRegex.exec(chunk);
    }
  }

  results.sort((a, b) => {
    if (a.brand !== b.brand) {
      return a.brand.localeCompare(b.brand);
    }

    return a.game.localeCompare(b.game);
  });

  return results;
}

const cookieMap = new Map();
const postBody = new URLSearchParams({ password }).toString();

const loginResponse = await fetch(statusUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "Mozilla/5.0 (compatible; StatusSyncBot/1.0)",
  },
  body: postBody,
  redirect: "manual",
});

mergeCookies(cookieMap, getSetCookies(loginResponse));

if (!cookieMap.size) {
  throw new Error("Login failed: no session cookie returned.");
}

const dashboardUrlObj = new URL("status.php", statusUrl);
dashboardUrlObj.searchParams.set("t", String(Date.now()));
const dashboardUrl = dashboardUrlObj.toString();
const dashboardResponse = await fetch(dashboardUrl, {
  headers: {
    Cookie: cookieHeader(cookieMap),
    "User-Agent": "Mozilla/5.0 (compatible; StatusSyncBot/1.0)",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
  },
});

if (!dashboardResponse.ok) {
  throw new Error(`Status fetch failed: HTTP ${dashboardResponse.status}`);
}

const html = await dashboardResponse.text();
if (html.includes("Status Page Login") || html.includes("Status Login - Cosmo")) {
  throw new Error("Authentication failed: dashboard returned login page.");
}

const lastUpdatedMatch = html.match(/<div class="last-updated">([\s\S]*?)<\/div>/i);
const lastUpdated = normalize(lastUpdatedMatch ? lastUpdatedMatch[1] : "Unknown");
const items = parseStatuses(html);

const payload = {
  source: "https://support.cosmotickets.com/status/status.php",
  fetchedAt: new Date().toISOString(),
  lastUpdated,
  counts: {
    total: items.length,
    updating: items.filter((item) => item.status.toLowerCase() === "updating").length,
    testing: items.filter((item) => item.status.toLowerCase() === "testing").length,
  },
  items,
};

await writeFile("data/status.json", JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`Saved ${items.length} products in Updating/Testing states.`);
