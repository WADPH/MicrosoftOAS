const PROGRESS_STEPS = ["Created", "Licensing", "Provisioned", "Completed"];

const ASSET_STATUS = {
  PENDING: "pending",
  DELIVERED: "delivered"
};

const state = {
  tasks: [],
  assetStatuses: {}, // Map of taskId -> { assetName -> status }
  userRole: null, // 'admin' or 'spectator'
  isLoading: false
};

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
    
    const assetsHtml = assets.length > 0
      ? `<div class="progressAssetsWrap">
          <div class="metaSmall">Ordered assets (requested from procurement):</div>
          <div class="progressAssetsList">
            ${assets.map((asset) => {
              const status = getAssetStatusForTask(taskId, asset);
              const statusClass = status === ASSET_STATUS.DELIVERED ? "delivered" : "pending";
              const isClickable = state.userRole === "admin" ? "clickable" : "";
              const title = state.userRole === "admin" 
                ? `Click to toggle status (currently ${status})`
                : `Status: ${status}`;
              return `<span 
                class="assetPill assetStatusPill ${statusClass} ${isClickable}" 
                data-task-id="${esc(taskId)}"
                data-asset-name="${esc(asset)}"
                title="${title}"
              >${esc(asset)}</span>`;
            }).join("")}
          </div>
        </div>`
      : "";

    return `
      <details class="progressTaskCard" data-task-id="${esc(taskId)}" ${openAttr}>
        <summary class="progressTaskHeader">
          <span class="progressTaskEmployee">${esc(employeeLabel)}</span>
          <span class="pill">${esc(stage)}</span>
        </summary>
        <div class="progressTaskBody">
          <div class="progressRoadmap">${renderRoadmap(stage)}</div>
          <div class="progressDescription">${esc(stageDescription(stage))}</div>
          ${assetsHtml}
        </div>
      </details>
    `;
  });
  list.innerHTML = rows.join("");
  
  // Attach event listeners to asset pills if user is admin
  if (state.userRole === "admin") {
    const assetPills = list.querySelectorAll(".assetStatusPill.clickable");
    assetPills.forEach((pill) => {
      pill.addEventListener("click", handleAssetPillClick);
    });
  }
}

function getAssetStatusForTask(taskId, assetName) {
  const taskStatuses = state.assetStatuses[taskId] || {};
  return taskStatuses[assetName] || ASSET_STATUS.PENDING;
}

async function api(path, options = {}) {
  const response = await fetch(path, { 
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (response.status === 401 || response.status === 403) {
    window.location.href = "/";
    throw new Error("Unauthorized");
  }
  if (!response.ok) {
    throw new Error(await response.text() || `HTTP ${response.status}`);
  }
  return response.json();
}

async function loadAssetStatuses(taskId) {
  try {
    const result = await api(`/progress/assets/${encodeURIComponent(taskId)}/statuses`);
    if (result.ok && result.statuses) {
      state.assetStatuses[taskId] = result.statuses;
    }
  } catch (error) {
    console.error("Failed to load asset statuses:", error.message);
  }
}

async function loadAllAssetStatuses(tasks) {
  const promises = tasks.map((task) => loadAssetStatuses(String(task.id || "").trim()));
  await Promise.all(promises);
}

async function toggleAssetStatus(taskId, assetName) {
  try {
    const result = await api(
      `/progress/assets/${encodeURIComponent(taskId)}/${encodeURIComponent(assetName)}/toggle`,
      { method: "POST" }
    );
    if (result.ok) {
      if (!state.assetStatuses[taskId]) {
        state.assetStatuses[taskId] = {};
      }
      state.assetStatuses[taskId][assetName] = result.status;
      return result.status;
    }
  } catch (error) {
    console.error("Failed to toggle asset status:", error.message);
    throw error;
  }
}

async function handleAssetPillClick(event) {
  const pill = event.currentTarget;
  const taskId = String(pill.getAttribute("data-task-id") || "").trim();
  const assetName = String(pill.getAttribute("data-asset-name") || "").trim();

  if (!taskId || !assetName) return;

  // Prevent double-clicking
  if (pill.classList.contains("updating")) return;
  pill.classList.add("updating");

  try {
    const newStatus = await toggleAssetStatus(taskId, assetName);
    
    // Update UI
    const statusClass = newStatus === ASSET_STATUS.DELIVERED ? "delivered" : "pending";
    pill.className = `assetPill assetStatusPill ${statusClass} clickable`;
    pill.title = `Click to toggle status (currently ${newStatus})`;
  } catch (error) {
    alert(`Failed to update asset status: ${error.message}`);
    pill.classList.remove("updating");
  } finally {
    pill.classList.remove("updating");
  }
}

async function loadProgress() {
  if (state.isLoading) return;
  state.isLoading = true;
  
  try {
    const data = await api("/progress/tasks");
    state.tasks = Array.isArray(data) ? data : [];
    
    // Load asset statuses for all tasks
    await loadAllAssetStatuses(state.tasks);
    
    renderTasks(state.tasks);
  } finally {
    state.isLoading = false;
  }
}

async function loadUserRole() {
  try {
    const result = await api("/progress/user-role");
    state.userRole = result.role || "spectator";
  } catch (error) {
    console.error("Failed to load user role:", error.message);
    state.userRole = "spectator";
  }
}

function initNavigation() {
  const backBtn = byId("backToMainBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      window.location.href = "/";
    });
  }
}

function updateUIBasedOnRole() {
  const editableNotice = byId("editableNotice");
  if (editableNotice) {
    if (state.userRole === "admin") {
      editableNotice.classList.remove("hidden");
    } else {
      editableNotice.classList.add("hidden");
    }
  }
}

async function init() {
  initTheme();
  initNavigation();
  await loadUserRole();
  updateUIBasedOnRole();
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
