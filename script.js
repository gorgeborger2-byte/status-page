const cardsEl = document.getElementById("cards");
const statusLineEl = document.getElementById("statusLine");
const sourceTimeEl = document.getElementById("sourceTime");
const fetchedTimeEl = document.getElementById("fetchedTime");
const refreshBtn = document.getElementById("refreshBtn");

function formatDateTime(value) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function renderItems(items) {
  if (!items.length) {
    cardsEl.innerHTML = "";
    statusLineEl.textContent = "No products are currently in Updating or Testing.";
    return;
  }

  cardsEl.innerHTML = items
    .map((item) => {
      const isTesting = item.status.toLowerCase() === "testing";
      return `
        <article class="card">
          <p class="brand">${item.brand}</p>
          <h3 class="game">${item.game}</h3>
          <span class="pill ${isTesting ? "pill-testing" : "pill-updating"}">${item.status}</span>
          <p class="updated">Updated: ${item.updated}</p>
        </article>
      `;
    })
    .join("");

  statusLineEl.textContent = `${items.length} products currently active (Updating/Testing).`;
}

async function loadStatus() {
  refreshBtn.disabled = true;
  statusLineEl.textContent = "Refreshing feed...";

  try {
    const response = await fetch(`data/status.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    renderItems(data.items || []);
    sourceTimeEl.textContent = `Source last updated: ${data.lastUpdated || "--"}`;
    fetchedTimeEl.textContent = `Synced: ${formatDateTime(data.fetchedAt)}`;
  } catch (error) {
    statusLineEl.textContent = "Could not load feed right now. Retrying automatically.";
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", loadStatus);
loadStatus();
setInterval(loadStatus, 30000);
