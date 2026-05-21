const PROGRESS_STEPS = ["Created", "Licensing", "Provisioned", "Completed"];

function byId(id) {
  return document.getElementById(id);
}

function applyTheme(theme) {
  const value = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = value;
  try {
    localStorage.setItem("theme", value);
  } catch {
    // ignore
  }
}

function initTheme() {
  const btn = byId("themeBtn");
  if (!btn) return;
  let stored = "light";
  try {
    stored = localStorage.getItem("theme") || "light";
  } catch {
    stored = "light";
  }
  applyTheme(stored);
  btn.addEventListener("click", () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
  });
}

function mapStatusToStage(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "done") return "Completed";
  if (normalized === "provisioned") return "Provisioned";
  if (normalized === "unlicensed") return "Licensing";
  return "Created";
}

function stageDescription(stage) {
  if (stage === "Created") return "Task is created and queued for onboarding actions.";
  if (stage === "Licensing") return "Account is prepared, but license purchase/request is in progress.";
  if (stage === "Provisioned") return "Account and access are ready. Remaining step is workplace handoff.";
  return "Employee is onboarded and actively working.";
}

function orderedAssets(task) {
  const assets = task?.assets || {};
  const labels = {
    laptop: "Laptop",
    keyboard: "Keyboard",
    mouse: "Mouse",
    headphones: "Headphones",
    monitor: "Monitor"
  };
  return Object.keys(labels).filter((key) => Boolean(assets[key])).map((key) => labels[key]);
}

function esc(value) {
  return String(value || "").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderRoadmap(stage) {
  const stageIndex = PROGRESS_STEPS.indexOf(stage);
  return PROGRESS_STEPS.map((item, index) => {
    const done = index < stageIndex ? "done" : "";
    const active = index === stageIndex ? "active" : "";
    const pulsing = index === stageIndex && stage !== "Completed" ? "pulsing" : "";
    return `<div class="progressStep ${done} ${active} ${pulsing}">${esc(item)}</div>`;
  }).join("");
}

function renderTasks(tasks) {
  const list = byId("progressList");
  if (!list) return;
  const previousOpenStateById = new Map(
    Array.from(list.querySelectorAll("details.progressTaskCard[data-task-id]"))
      .map((node) => [String(node.getAttribute("data-task-id") || "").trim(), node.hasAttribute("open")])
      .filter(([id]) => Boolean(id))
  );
  if (!Array.isArray(tasks) || tasks.length === 0) {
    list.innerHTML = `<div class="managerEmpty">No onboarding tasks yet.</div>`;
    return;
  }

  const rows = tasks.map((task) => {
    const stage = mapStatusToStage(task.status);
    const assets = orderedAssets(task);
    const employeeLabel = `${task.fullName || "Employee"}${task.email ? ` · ${task.email}` : ""}`;
    const taskId = String(task.id || "").trim();
    const isDefaultOpen = stage !== "Completed";
    const isOpen = taskId && previousOpenStateById.has(taskId)
      ? Boolean(previousOpenStateById.get(taskId))
      : isDefaultOpen;
    const openAttr = isOpen ? "open" : "";
    return `
      <details class="progressTaskCard" data-task-id="${esc(taskId)}" ${openAttr}>
        <summary class="progressTaskHeader">
          <span class="progressTaskEmployee">${esc(employeeLabel)}</span>
          <span class="pill">${esc(stage)}</span>
        </summary>
        <div class="progressTaskBody">
          <div class="progressRoadmap">${renderRoadmap(stage)}</div>
          <div class="progressDescription">${esc(stageDescription(stage))}</div>
          ${assets.length > 0
            ? `<div class="progressAssetsWrap">
                <div class="metaSmall">Ordered assets (requested from procurement):</div>
                <div class="progressAssetsList">${assets.map((asset) => `<span class="assetPill">${esc(asset)}</span>`).join("")}</div>
              </div>`
            : ""}
        </div>
      </details>
    `;
  });
  list.innerHTML = rows.join("");
}

async function api(path) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" } });
  if (response.status === 401 || response.status === 403) {
    window.location.href = "/";
    throw new Error("Unauthorized");
  }
  if (!response.ok) {
    throw new Error(await response.text() || `HTTP ${response.status}`);
  }
  return response.json();
}

async function loadProgress() {
  const data = await api("/progress/tasks");
  renderTasks(Array.isArray(data) ? data : []);
}

function initNavigation() {
  const backBtn = byId("backToMainBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      window.location.href = "/";
    });
  }
}

async function init() {
  initTheme();
  initNavigation();
  await loadProgress();
  setInterval(() => {
    loadProgress().catch(() => {});
  }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      loadProgress().catch(() => {});
    }
  });
}

init().catch((error) => {
  const list = byId("progressList");
  if (list) {
    list.innerHTML = `<div class="managerEmpty">Failed to load tasks: ${esc(error.message)}</div>`;
  }
});
