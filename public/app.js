const state = {
  tasks: [],
  selectedId: null,
  companyDomains: ["eilink.az", "researchlab.digital", "ei-g.com"],
  companyCodes: ["EILINK", "DRL", "EIG"],
  availableManagers: [],
  currentUser: null,
  userEditedLicenseSubject: false,
  userEditedLicenseBody: false,
  userEditedAssetsSubject: false,
  userEditedAssetsBody: false
};

function serverLog(message, level = "INFO") {
  console.log(`[${level}] ${message}`);
  // Also send to server for debugging
  fetch("/debug/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, level })
  }).catch(() => {});
}

async function checkAuthStatus() {
  try {
    serverLog("Checking auth status...");
    const response = await fetch("/auth/user");
    const data = await response.json();
    serverLog(`Auth status: ${JSON.stringify(data)}`);
    return data;
  } catch (error) {
    serverLog(`Status check failed: ${error.message}`, "ERROR");
    return { authenticated: false };
  }
}

function showLoginScreen() {
  serverLog("Showing login screen");
  el("loginScreen")?.classList.remove("hidden");
  el("appScreen")?.classList.add("hidden");
}

function showAppScreen() {
  serverLog("Showing app screen");
  el("loginScreen")?.classList.add("hidden");
  el("appScreen")?.classList.remove("hidden");
}

function initAuth() {
  serverLog("Initializing auth handlers");
  try {
    const loginBtn = el("microsoftLoginBtn");
    const logoutBtn = el("logoutBtn");

    serverLog(`loginBtn exists? ${!!loginBtn}`);
    serverLog(`logoutBtn exists? ${!!logoutBtn}`);

    if (loginBtn) {
      serverLog("Found login button, attaching handler");
      loginBtn.addEventListener("click", (e) => {
        serverLog("Login button CLICKED!");
        e.preventDefault();
        serverLog("Redirecting to /auth/login");
        window.location.href = "/auth/login";
      });
      serverLog("Login button handler attached successfully");
    } else {
      serverLog("Login button NOT FOUND", "WARN");
    }

    if (logoutBtn) {
      serverLog("Found logout button, attaching handler");
      logoutBtn.addEventListener("click", (e) => {
        serverLog("Logout button CLICKED!");
        e.preventDefault();
        window.location.href = "/auth/logout";
      });
      serverLog("Logout button handler attached successfully");
    }
  } catch (error) {
    serverLog(`initAuth() error: ${error.message}`, "ERROR");
  }
}

async function initApp() {
  serverLog("initApp() started");
  const status = await checkAuthStatus();

  if (!status.authenticated) {
    serverLog("Not authenticated, showing login");
    showLoginScreen();
    return;
  }

  serverLog("Authenticated, showing app");
  state.currentUser = status.user;
  if (el("userEmail")) {
    el("userEmail").textContent = state.currentUser.email || "User";
  }

  showAppScreen();
  await loadMeta();
  await loadTasks();
  initTheme();
  setupActions();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `HTTP ${response.status}`);
  }

  return response.json();
}

function el(id) {
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
  const btn = el("themeBtn");
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

function parseRecipients(value) {
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function getAssetSentence() {
  const selected = [];
  if (el("assetLaptop").checked) selected.push("laptop");
  if (el("assetKeyboard").checked) selected.push("keyboard");
  if (el("assetMouse").checked) selected.push("mouse");
  if (el("assetHeadphones").checked) selected.push("headphones");
  if (el("assetMonitor").checked) selected.push("monitor");

  if (selected.length === 0) return "no assets selected";
  if (selected.length === 1) return selected[0];
  if (selected.length === 2) return `${selected[0]} and ${selected[1]}`;
  return `${selected.slice(0, -1).join(", ")} and ${selected[selected.length - 1]}`;
}

function hasAnyAssetSelected() {
  return ["assetLaptop", "assetKeyboard", "assetMouse", "assetHeadphones", "assetMonitor"].some((id) => el(id).checked);
}

function buildDefaultLicenseSubject() {
  return "License request for new employee";
}

function buildDefaultLicenseBody() {
  return `Hello,\nWe need 1 Microsoft Business Premium licence with monthly payment on ${el("company").value.trim() || "not specified"} balance.`;
}

function buildDefaultAssetsSubject() {
  return `Assets request: ${el("fullName").value.trim() || "not specified"}`;
}

function buildDefaultAssetsBody() {
  return `Hello,\nWe need ${getAssetSentence()} for our new employee ${el("fullName").value.trim() || "not specified"}. From ${el("company").value.trim() || "not specified"} balance.`;
}

function refreshMailVisibilityAndPreview() {
  const licenseSection = el("licenseMailSection");
  const assetsSection = el("assetsMailSection");
  const licenseRequired = el("licenseRequired").checked;
  const anyAsset = hasAnyAssetSelected();

  licenseSection.classList.toggle("hidden", !licenseRequired);
  assetsSection.classList.toggle("hidden", !anyAsset);

  if (!state.userEditedLicenseSubject) {
    el("licenseSubject").value = buildDefaultLicenseSubject();
  }
  if (!state.userEditedLicenseBody) {
    el("licenseBody").value = buildDefaultLicenseBody();
  }
  if (!state.userEditedAssetsSubject) {
    el("assetsSubject").value = buildDefaultAssetsSubject();
  }
  if (!state.userEditedAssetsBody) {
    el("assetsBody").value = buildDefaultAssetsBody();
  }
}

function fillRecipients(inputId, values) {
  el(inputId).value = Array.isArray(values) ? values.join(", ") : "";
}

function ensureSelectedTaskStillExists() {
  if (!state.selectedId) return;
  const exists = state.tasks.some((task) => task.id === state.selectedId);
  if (!exists) state.selectedId = state.tasks[0]?.id || null;
}

function renderDomainOptions(selected) {
  const select = el("companyDomain");
  if (!select) return;
  if (!Array.isArray(state.companyDomains) || state.companyDomains.length === 0) {
    state.companyDomains = ["eilink.az", "researchlab.digital", "ei-g.com"];
  }
  select.innerHTML = "";

  for (const domain of state.companyDomains) {
    const option = document.createElement("option");
    option.value = domain;
    option.textContent = domain;
    option.selected = domain === selected;
    select.appendChild(option);
  }
}

function renderCompanyCodeOptions(selected) {
  const select = el("company");
  if (!select) return;
  if (!Array.isArray(state.companyCodes) || state.companyCodes.length === 0) {
    state.companyCodes = ["EILINK", "DRL", "EIG"];
  }
  select.innerHTML = "";

  for (const code of state.companyCodes) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = code;
    option.selected = code === selected;
    select.appendChild(option);
  }
}

function renderTasks() {
  const list = el("taskList");
  list.innerHTML = "";

  if (state.tasks.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No tasks yet";
    list.appendChild(li);
    return;
  }

  const cls = (status) => {
    const s = String(status || "").toLowerCase();
    if (s === "done") return "done";
    if (s === "failed") return "failed";
    if (s === "processing") return "processing";
    return "pending";
  };

  for (const task of state.tasks) {
    const li = document.createElement("li");
    li.className = task.id === state.selectedId ? "active" : "";
    li.innerHTML = `
      <div class="taskRow">
        <div class="taskMain">
          <div class="taskName">${(task.fullName || "not specified").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
          <div class="taskMeta">${(task.startDate || "not specified").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
        </div>
        <div class="statusPill ${cls(task.status)}">${(task.status || "pending").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
      </div>
    `;
    li.onclick = () => selectTask(task.id);
    list.appendChild(li);
  }
}

function setCheckbox(id, value) {
  const input = el(id);
  if (input) input.checked = Boolean(value);
}

function selectTask(id) {
  state.selectedId = id;
  renderTasks();

  const task = state.tasks.find((x) => x.id === id);
  if (!task) return;
  state.userEditedLicenseSubject = false;
  state.userEditedLicenseBody = false;
  state.userEditedAssetsSubject = false;
  state.userEditedAssetsBody = false;

  el("taskId").textContent = task.id;
  el("fullName").value = task.fullName || "";
  el("firstName").value = task.firstName || "";
  el("lastName").value = task.lastName || "";
  el("startDate").value = task.startDate || "";

  el("email").value = task.email || "";
  el("company").value = task.company || "";
  el("position").value = task.position || "";
  el("phone").value = task.phone || "";
  el("manager").value = task.manager || "";

  renderDomainOptions(task.companyDomain || state.companyDomains[2]);
  renderCompanyCodeOptions(task.companyCode || state.companyCodes[2]);

  el("licenseRequired").checked = Boolean(task.licenseRequired);

  setCheckbox("assetLaptop", task.assets?.laptop);
  setCheckbox("assetKeyboard", task.assets?.keyboard);
  setCheckbox("assetMouse", task.assets?.mouse);
  setCheckbox("assetHeadphones", task.assets?.headphones);
  setCheckbox("assetMonitor", task.assets?.monitor);

  fillRecipients("licenseTo", task.licenseMail?.to);
  fillRecipients("licenseCc", task.licenseMail?.cc);
  el("licenseSubject").value = task.licenseMail?.subject || buildDefaultLicenseSubject();
  el("licenseBody").value = task.licenseMail?.body || buildDefaultLicenseBody();

  fillRecipients("assetsTo", task.assetsMail?.to);
  fillRecipients("assetsCc", task.assetsMail?.cc);
  el("assetsSubject").value = task.assetsMail?.subject || buildDefaultAssetsSubject();
  el("assetsBody").value = task.assetsMail?.body || buildDefaultAssetsBody();
  refreshMailVisibilityAndPreview();
}

async function loadMeta() {
  try {
    const data = await api("/tasks/meta/options");
    if (Array.isArray(data.companyDomains) && data.companyDomains.length > 0) {
      state.companyDomains = data.companyDomains;
    }
    if (Array.isArray(data.companyCodes) && data.companyCodes.length > 0) {
      state.companyCodes = data.companyCodes;
    }
  } catch (error) {
    console.warn("Failed to load meta options", error);
  }
  renderDomainOptions(state.companyDomains[0]);
  renderCompanyCodeOptions(state.companyCodes[0]);
}

async function loadLicenseAvailability() {
  const target = el("premiumSeats");
  if (!target) return;

  try {
    target.textContent = "...";
    const data = await api("/tasks/meta/licenses");
    if (data && data.ok && data.found) {
      target.textContent = String(data.available);
    } else if (data && data.ok && !data.found) {
      target.textContent = "N/A";
    } else {
      target.textContent = "-";
    }
  } catch (error) {
    console.warn("Failed to load license availability", error);
    target.textContent = "-";
  }
}

async function loadTasks() {
  state.tasks = await api("/tasks");
  ensureSelectedTaskStillExists();

  if (!state.selectedId && state.tasks.length > 0) {
    state.selectedId = state.tasks[0].id;
  }

  renderTasks();

  if (state.selectedId) {
    selectTask(state.selectedId);
  }
}

async function loadManagerUsers(search = "") {
  try {
    const users = await api(`/tasks/meta/users?search=${encodeURIComponent(String(search || ""))}`);
    state.availableManagers = Array.isArray(users) ? users : [];
    el("managerModalError").textContent = "";
  } catch (error) {
    state.availableManagers = [];
    el("managerModalError").textContent = `Failed to load users: ${error.message}`;
  }
  renderManagerModal();
}

function renderManagerModal() {
  const list = el("managerUserList");
  list.innerHTML = "";

  if (!Array.isArray(state.availableManagers) || state.availableManagers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "managerEmpty";
    empty.textContent = el("managerSearch").value.trim()
      ? "No matching users found."
      : "Use search to find tenant users by name or email.";
    list.appendChild(empty);
    return;
  }

  for (const user of state.availableManagers) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "managerItem";
    item.onclick = () => {
      const managerDisplay = user.displayName || user.mail || "";
      el("manager").value = managerDisplay;
      closeManagerModal();
      el("status").textContent = `Manager set to ${managerDisplay}`;
    };

    const title = document.createElement("div");
    title.textContent = user.displayName || user.mail || "Unnamed user";
    const subtitle = document.createElement("div");
    subtitle.className = "subtitle";
    subtitle.textContent = [user.mail, user.givenName, user.surname].filter(Boolean).join(" · ");
    item.appendChild(title);
    item.appendChild(subtitle);
    list.appendChild(item);
  }
}

function openManagerModal() {
  el("managerModal").classList.remove("hidden");
  el("managerModal").setAttribute("aria-hidden", "false");
  el("managerSearch").value = "";
  loadManagerUsers();
  el("managerSearch").focus();
}

function closeManagerModal() {
  el("managerModal").classList.add("hidden");
  el("managerModal").setAttribute("aria-hidden", "true");
}

function updateEmailFromDomain() {
  const first = el("firstName").value.trim();
  const last = el("lastName").value.trim();
  const domain = el("companyDomain").value.trim();
  if (first && last && domain) {
    const newEmail = `${first}.${last}@${domain}`.toLowerCase();
    el("email").value = newEmail;
  }
}

function buildPatchPayload() {
  const payload = {
    fullName: el("fullName").value.trim(),
    firstName: el("firstName").value.trim(),
    lastName: el("lastName").value.trim(),
    startDate: el("startDate").value.trim(),
    email: el("email").value.trim(),
    company: el("company").value.trim(),
    companyCode: el("company").value,
    companyDomain: el("companyDomain").value,
    position: el("position").value.trim(),
    phone: el("phone").value.trim(),
    manager: el("manager").value.trim(),
    licenseRequired: el("licenseRequired").checked,
    assets: {
      laptop: el("assetLaptop").checked,
      keyboard: el("assetKeyboard").checked,
      mouse: el("assetMouse").checked,
      headphones: el("assetHeadphones").checked,
      monitor: el("assetMonitor").checked
    },
    licenseMail: {
      to: parseRecipients(el("licenseTo").value),
      cc: parseRecipients(el("licenseCc").value),
      subject: el("licenseSubject").value,
      body: el("licenseBody").value
    },
    assetsMail: {
      to: parseRecipients(el("assetsTo").value),
      cc: parseRecipients(el("assetsCc").value),
      subject: el("assetsSubject").value,
      body: el("assetsBody").value
    }
  };
  return payload;
}

async function saveTask() {
  if (!state.selectedId) return;

  const payload = buildPatchPayload();
  await api(`/tasks/${state.selectedId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });

  await loadTasks();
  el("status").textContent = "Saved";
}

async function approveTask() {
  if (!state.selectedId) return;

  await saveTask();

  const result = await api(`/tasks/${state.selectedId}/approve`, {
    method: "POST"
  });

  await loadTasks();
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  const summary = steps.map((s) => `${s.step}:${s.action}`).join(", ");
  el("status").textContent = summary ? `Approved (${summary})` : "Approved";
}

async function deleteTask() {
  if (!state.selectedId) {
    el("status").textContent = "Select a task first";
    return;
  }

  const target = state.tasks.find((x) => x.id === state.selectedId);
  const ok = window.confirm(`Delete task for ${target?.fullName || "employee"}?`);
  if (!ok) return;

  await api(`/tasks/${state.selectedId}`, {
    method: "DELETE"
  });

  await loadTasks();
  el("status").textContent = "Task deleted";
}

function setupActions() {
  const livePreviewInputs = [
    "licenseRequired",
    "assetLaptop",
    "assetKeyboard",
    "assetMouse",
    "assetHeadphones",
    "assetMonitor",
    "fullName",
    "company"
  ];
  for (const id of livePreviewInputs) {
    el(id).addEventListener("input", refreshMailVisibilityAndPreview);
    el(id).addEventListener("change", refreshMailVisibilityAndPreview);
  }
  el("licenseSubject").addEventListener("input", () => {
    state.userEditedLicenseSubject = true;
  });
  el("licenseBody").addEventListener("input", () => {
    state.userEditedLicenseBody = true;
  });
  el("assetsSubject").addEventListener("input", () => {
    state.userEditedAssetsSubject = true;
  });
  el("assetsBody").addEventListener("input", () => {
    state.userEditedAssetsBody = true;
  });

  const managerButton = el("changeManagerBtn");
  if (managerButton) {
    managerButton.onclick = () => openManagerModal();
  }

  const managerSearch = el("managerSearch");
  if (managerSearch) {
    managerSearch.addEventListener("input", () => {
      loadManagerUsers(managerSearch.value.trim());
    });
  }

  const managerModalClose = el("managerModalClose");
  if (managerModalClose) {
    managerModalClose.onclick = () => closeManagerModal();
  }

  const managerModalOverlay = el("managerModalOverlay");
  if (managerModalOverlay) {
    managerModalOverlay.onclick = () => closeManagerModal();
  }

  el("companyDomain").addEventListener("change", updateEmailFromDomain);

  el("saveBtn").onclick = async () => {
    try {
      await saveTask();
    } catch (error) {
      el("status").textContent = `Save failed: ${error.message}`;
    }
  };

  el("approveBtn").onclick = async () => {
    try {
      await approveTask();
    } catch (error) {
      el("status").textContent = `Approve failed: ${error.message}`;
    }
  };

  el("deleteBtn").onclick = async () => {
    try {
      await deleteTask();
    } catch (error) {
      el("status").textContent = `Delete failed: ${error.message}`;
    }
  };

  el("refreshBtn").onclick = async () => {
    try {
      await loadTasks();
      el("status").textContent = "Refreshed";
    } catch (error) {
      el("status").textContent = `Refresh failed: ${error.message}`;
    }
  };

  const refreshLicensesBtn = el("refreshLicensesBtn");
  if (refreshLicensesBtn) {
    refreshLicensesBtn.onclick = async () => {
      try {
        await loadLicenseAvailability();
        el("status").textContent = "License availability updated";
      } catch (error) {
        el("status").textContent = `License refresh failed: ${error.message}`;
      }
    };
  }
}

(async function main() {
  initAuth();
  await initApp();
})();
