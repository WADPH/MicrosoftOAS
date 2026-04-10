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
  userEditedAssetsBody: false,
  settings: null,
  snipeitConfig: {
    enabled: false,
    url: "",
    laptopPrefix: "PC-",
    monitorPrefix: "MN-",
    checkIntervalMs: 15 * 60 * 1000
  },
  availableSnipeitAssets: [],
  selectedSnipeitModalType: null,
  selectedSnipeitAssetsDraft: [],
  taskMode: "onboarding",
  offboardingTasks: [],
  offboardingSelectedId: null,
  offboarding: {
    tenants: [],
    selectedTenant: "",
    selectedUser: null,
    userCandidates: [],
    relatedAccounts: [],
    snipeitAssets: [],
    deleteUser: true
  }
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
  await loadSnipeitConfig();
  await loadOffboardingMeta().catch(() => {});
  await loadTasks();
  await loadOffboardingTasks().catch(() => {});
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

function parseCommaSeparatedEmails(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function validateEmailList(label, value) {
  const emails = parseCommaSeparatedEmails(value);
  const invalid = emails.find((email) => !isValidEmail(email));
  if (invalid) {
    throw new Error(`${label} contains invalid email: ${invalid}`);
  }
}

function validateRedirectUri(value) {
  const raw = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("SSO Callback URL must be a valid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("SSO Callback URL must use http or https");
  }
}

function normalizeCompanyMatcherKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9_]/g, "");
}

function isValidDomain(value) {
  return /^(?=.{1,253}$)(?!-)(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/.test(String(value || "").trim().toLowerCase());
}

function matcherVarName(key, suffix) {
  const normalized = normalizeCompanyMatcherKey(key) || "KEY";
  return `COMPANY_MATCHER_${normalized}_${suffix}`;
}

function normalizeTenantKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9_]/g, "");
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

function getCurrentTask() {
  return state.tasks.find((task) => task.id === state.selectedId) || null;
}

function getSelectedSnipeitAssets(task = getCurrentTask()) {
  return Array.isArray(task?.snipeitAssets) ? task.snipeitAssets : [];
}

function setTaskMode(mode) {
  state.taskMode = mode === "offboarding" ? "offboarding" : "onboarding";
  const isOffboarding = state.taskMode === "offboarding";

  el("tabOnboardingBtn")?.classList.toggle("active", !isOffboarding);
  el("tabOffboardingBtn")?.classList.toggle("active", isOffboarding);
  el("refreshBtn")?.classList.toggle("hidden", isOffboarding);
  el("onboardingNewBtn")?.classList.toggle("hidden", isOffboarding);
  el("offboardingRefreshBtn")?.classList.toggle("hidden", !isOffboarding);
  el("offboardingNewBtn")?.classList.toggle("hidden", !isOffboarding);
  el("offboardingTaskListHint")?.classList.toggle("hidden", !isOffboarding);
  el("onboardingDetails")?.classList.toggle("hidden", isOffboarding);
  el("offboardingDetails")?.classList.toggle("hidden", !isOffboarding);
  const title = el("detailsTitle");
  if (title) title.textContent = isOffboarding ? "Offboarding Details" : "Onboarding Details";
  renderCurrentTaskList();
  if (isOffboarding) {
    loadOffboardingTasks().catch(() => {});
  }
}

function renderOffboardingTenantOptions() {
  const options = Array.isArray(state.offboarding.tenants) ? state.offboarding.tenants : [];
  const selects = [el("offboardingUserTenantSelect")].filter(Boolean);
  for (const select of selects) {
    select.innerHTML = "";
    for (const tenant of options) {
      const option = document.createElement("option");
      option.value = tenant;
      option.textContent = tenant;
      option.selected = tenant === state.offboarding.selectedTenant;
      select.appendChild(option);
    }
  }
}

function renderOffboardingSelectedUser() {
  const box = el("offboardingSelectedUser");
  if (!box) return;
  const user = state.offboarding.selectedUser;
  if (!user) {
    box.textContent = "No user selected.";
    return;
  }
  box.innerHTML = `
    <div class="assetTag">${String(user.displayName || "Unnamed user").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
    <div class="assetMeta">${String(user.userPrincipalName || user.mail || "").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
  `;
}

function renderOffboardingAccounts() {
  const list = el("offboardingAccountsList");
  if (!list) return;
  list.innerHTML = "";
  const accounts = Array.isArray(state.offboarding.relatedAccounts) ? state.offboarding.relatedAccounts : [];
  if (accounts.length === 0) {
    list.innerHTML = `<div class="managerEmpty">No related accounts found yet.</div>`;
    updateOffboardingPreview();
    return;
  }

  for (const account of accounts) {
    const row = document.createElement("label");
    row.className = "checkTile offboardingCheckTile";
    row.innerHTML = `
      <input type="checkbox" class="offboardingAccountCheck" data-id="${account.id}" ${account.selected ? "checked" : ""} />
      <span class="checkMark" aria-hidden="true"></span>
      <div>
        <div class="checkText">${String(account.userPrincipalName || account.mail || "").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
        <div class="assetMeta">${[account.displayName, account.tenant, account.userType].filter(Boolean).join(" · ").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
      </div>
    `;
    list.appendChild(row);
  }
  updateOffboardingPreview();
}

function renderOffboardingAssets() {
  const section = el("offboardingSnipeitSection");
  const list = el("offboardingAssetsList");
  if (!section || !list) return;

  const enabled = Boolean(state.snipeitConfig?.enabled);
  section.classList.toggle("hidden", !enabled);
  list.innerHTML = "";

  if (!enabled) {
    updateOffboardingPreview();
    return;
  }

  const assets = Array.isArray(state.offboarding.snipeitAssets) ? state.offboarding.snipeitAssets : [];
  if (assets.length === 0) {
    list.innerHTML = `<div class="managerEmpty">No assigned SnipeIT assets found.</div>`;
    updateOffboardingPreview();
    return;
  }

  for (const asset of assets) {
    const row = document.createElement("label");
    row.className = "checkTile offboardingCheckTile";
    row.innerHTML = `
      <input type="checkbox" class="offboardingAssetCheck" data-id="${asset.id}" ${asset.selected ? "checked" : ""} />
      <span class="checkMark" aria-hidden="true"></span>
      <div>
        <div class="checkText">${String(asset.asset_tag || "").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
        <div class="assetMeta">${[asset.model, asset.companyName, asset.notes].filter(Boolean).join(" · ").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
      </div>
    `;
    list.appendChild(row);
  }
  updateOffboardingPreview();
}

function updateOffboardingPreview() {
  const box = el("offboardingPreview");
  if (!box) return;
  const deleteUser = Boolean(el("offboardingDeleteUser")?.checked);
  const accountCount = state.offboarding.relatedAccounts.filter((row) => row.selected).length;
  const assetCount = state.offboarding.snipeitAssets.filter((row) => row.selected).length;
  const user = state.offboarding.selectedUser;
  if (!user) {
    box.textContent = "No actions selected yet.";
    return;
  }
  box.innerHTML = `
    <div class="assetTag">${String(user.userPrincipalName || user.mail || "").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
    <div class="assetMeta">Delete accounts: ${deleteUser ? accountCount : 0} | Checkin assets: ${assetCount}</div>
  `;
}

function resetOffboardingState() {
  state.offboardingSelectedId = null;
  state.offboarding.selectedUser = null;
  state.offboarding.relatedAccounts = [];
  state.offboarding.snipeitAssets = [];
  state.offboarding.deleteUser = true;
  if (el("offboardingDeleteUser")) el("offboardingDeleteUser").checked = true;
  renderOffboardingSelectedUser();
  renderOffboardingAccounts();
  renderOffboardingAssets();
  el("offboardingStatus").textContent = "";
  renderCurrentTaskList();
}

function selectOffboardingTask(id) {
  const task = state.offboardingTasks.find((row) => row.id === id);
  if (!task) return;
  state.offboardingSelectedId = id;
  renderCurrentTaskList();

  const payload = task.offboarding || {};
  state.offboarding.selectedTenant = String(payload.tenant || state.offboarding.selectedTenant || "").trim();
  if (!state.offboarding.selectedTenant && state.offboarding.tenants.length > 0) {
    state.offboarding.selectedTenant = state.offboarding.tenants[0];
  }
  renderOffboardingTenantOptions();

  state.offboarding.selectedUser = payload.user || null;
  state.offboarding.deleteUser = payload.deleteUser !== false;
  if (el("offboardingDeleteUser")) el("offboardingDeleteUser").checked = state.offboarding.deleteUser;
  state.offboarding.relatedAccounts = Array.isArray(payload.accountsToDelete)
    ? payload.accountsToDelete.map((row) => ({ ...row, selected: true }))
    : [];
  state.offboarding.snipeitAssets = Array.isArray(payload.assetsToCheckin)
    ? payload.assetsToCheckin.map((row) => ({ ...row, selected: true }))
    : [];

  renderOffboardingSelectedUser();
  renderOffboardingAccounts();
  renderOffboardingAssets();
  el("offboardingStatus").textContent = `Loaded offboarding task ${task.id}`;
}

async function loadOffboardingMeta() {
  const data = await api("/offboarding/meta");
  state.offboarding.tenants = Array.isArray(data?.tenants) ? data.tenants : [];
  state.offboarding.selectedTenant = state.offboarding.tenants[0] || "";
  renderOffboardingTenantOptions();
  return data;
}

async function loadOffboardingUsers(search = "") {
  const tenant = String(state.offboarding.selectedTenant || "").trim();
  if (!tenant) return;
  const errorBox = el("offboardingUserModalError");
  if (errorBox) errorBox.textContent = "";
  const data = await api(`/offboarding/users?tenant=${encodeURIComponent(tenant)}&search=${encodeURIComponent(search)}`);
  state.offboarding.userCandidates = Array.isArray(data?.users) ? data.users : [];
  const list = el("offboardingUserList");
  if (!list) return;
  list.innerHTML = "";
  if (state.offboarding.userCandidates.length === 0) {
    list.innerHTML = `<div class="managerEmpty">No users found.</div>`;
    return;
  }

  for (const user of state.offboarding.userCandidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "managerItem";
    button.innerHTML = `
      <div>${String(user.displayName || user.mail || "Unnamed user").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
      <div class="subtitle">${[user.userPrincipalName || user.mail, user.tenant].filter(Boolean).join(" · ").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
    `;
    button.onclick = () => {
      state.offboarding.selectedUser = user;
      closeOffboardingUserModal();
      loadOffboardingAccountAndAssets().catch((error) => {
        el("offboardingStatus").textContent = `Failed to load related data: ${error.message}`;
      });
    };
    list.appendChild(button);
  }
}

async function loadOffboardingAccountAndAssets() {
  renderOffboardingSelectedUser();
  const user = state.offboarding.selectedUser;
  if (!user) return;
  const tenant = state.offboarding.selectedTenant;
  const email = String(user.userPrincipalName || user.mail || "").trim().toLowerCase();
  if (!tenant || !email) return;

  const accountsData = await api(`/offboarding/accounts?tenant=${encodeURIComponent(tenant)}&email=${encodeURIComponent(email)}`);
  state.offboarding.relatedAccounts = (Array.isArray(accountsData?.accounts) ? accountsData.accounts : []).map((row) => ({
    ...row,
    selected: true
  }));
  renderOffboardingAccounts();

  if (state.snipeitConfig.enabled) {
    const assetsData = await api(`/offboarding/snipeit-assets?email=${encodeURIComponent(email)}`);
    state.offboarding.snipeitAssets = (Array.isArray(assetsData?.assets) ? assetsData.assets : []).map((row) => ({
      ...row,
      selected: true
    }));
  } else {
    state.offboarding.snipeitAssets = [];
  }
  renderOffboardingAssets();
}

function openOffboardingUserModal() {
  el("offboardingUserModal").classList.remove("hidden");
  el("offboardingUserModal").setAttribute("aria-hidden", "false");
  const tenantSelect = el("offboardingUserTenantSelect");
  if (tenantSelect) tenantSelect.value = state.offboarding.selectedTenant || "";
  el("offboardingUserSearch").value = "";
  loadOffboardingUsers().catch((error) => {
    el("offboardingUserModalError").textContent = `Failed to load users: ${error.message}`;
  });
}

function closeOffboardingUserModal() {
  el("offboardingUserModal").classList.add("hidden");
  el("offboardingUserModal").setAttribute("aria-hidden", "true");
}

function buildOffboardingPayload(validateForExecute = false) {
  const user = state.offboarding.selectedUser;
  const tenant = String(state.offboarding.selectedTenant || "").trim();
  const deleteUser = Boolean(el("offboardingDeleteUser")?.checked);
  const accountsToDelete = state.offboarding.relatedAccounts.filter((row) => row.selected);
  const assetsToCheckin = state.offboarding.snipeitAssets.filter((row) => row.selected).map((row) => ({
    id: row.id,
    asset_tag: row.asset_tag
  }));

  if (!user) {
    throw new Error("Choose user first");
  }
  if (!tenant) {
    throw new Error("Tenant is required");
  }
  if (validateForExecute && deleteUser && accountsToDelete.length === 0) {
    throw new Error("Select at least one account to delete");
  }

  return {
    taskId: state.offboardingSelectedId || undefined,
    tenant,
    user,
    email: user.userPrincipalName || user.mail,
    deleteUser,
    accountsToDelete,
    assetsToCheckin
  };
}

async function saveOffboardingTask() {
  const payload = buildOffboardingPayload(false);
  const response = await api("/offboarding/tasks", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const task = response?.task;
  if (task?.id) state.offboardingSelectedId = task.id;
  await loadOffboardingTasks();
  return response;
}

async function executeOffboarding() {
  const payload = buildOffboardingPayload(true);
  const response = await api("/offboarding/execute", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const task = response?.task;
  if (task?.id) state.offboardingSelectedId = task.id;
  await loadOffboardingTasks();
  return response;
}

async function deleteOffboardingTask() {
  const id = state.offboardingSelectedId;
  if (!id) {
    throw new Error("Select offboarding task first");
  }
  const target = state.offboardingTasks.find((task) => task.id === id);
  const ok = window.confirm(`Delete offboarding task for ${target?.offboarding?.email || target?.email || "selected user"}?`);
  if (!ok) return;
  await api(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
  resetOffboardingState();
  await loadOffboardingTasks();
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

function renderOffboardingTasks() {
  const list = el("taskList");
  list.innerHTML = "";
  const rows = Array.isArray(state.offboardingTasks) ? state.offboardingTasks : [];
  el("offboardingTaskListHint")?.classList.toggle("hidden", rows.length > 0 || state.taskMode !== "offboarding");

  if (rows.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No offboarding tasks yet";
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

  for (const task of rows) {
    const li = document.createElement("li");
    li.className = task.id === state.offboardingSelectedId ? "active" : "";
    const userUpn = task.offboarding?.email || task.email || "not specified";
    li.innerHTML = `
      <div class="taskRow">
        <div class="taskMain">
          <div class="taskName">${String(task.fullName || userUpn).replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
          <div class="taskMeta">${String(userUpn).replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
        </div>
        <div class="statusPill ${cls(task.status)}">${String(task.status || "pending").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
      </div>
    `;
    li.onclick = () => selectOffboardingTask(task.id);
    list.appendChild(li);
  }
}

function renderCurrentTaskList() {
  if (state.taskMode === "offboarding") {
    renderOffboardingTasks();
  } else {
    renderTasks();
  }
}

function setCheckbox(id, value) {
  const input = el(id);
  if (input) input.checked = Boolean(value);
}

function setInputValue(id, value) {
  const input = el(id);
  if (input) input.value = value;
}

function setTextValue(id, value) {
  const node = el(id);
  if (node) node.textContent = value;
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

  setTextValue("taskId", task.id);
  setInputValue("fullName", task.fullName || "");
  setInputValue("firstName", task.firstName || "");
  setInputValue("lastName", task.lastName || "");
  setInputValue("startDate", task.startDate || "");

  setInputValue("email", task.email || "");
  setInputValue("company", task.company || "");
  setInputValue("position", task.position || "");
  setInputValue("phone", task.phone || "");
  setInputValue("manager", task.manager || "");

  renderDomainOptions(task.companyDomain || state.companyDomains[2]);
  renderCompanyCodeOptions(task.companyCode || state.companyCodes[2]);

  setCheckbox("licenseRequired", task.licenseRequired);

  setCheckbox("assetLaptop", task.assets?.laptop);
  setCheckbox("assetKeyboard", task.assets?.keyboard);
  setCheckbox("assetMouse", task.assets?.mouse);
  setCheckbox("assetHeadphones", task.assets?.headphones);
  setCheckbox("assetMonitor", task.assets?.monitor);

  fillRecipients("licenseTo", task.licenseMail?.to);
  fillRecipients("licenseCc", task.licenseMail?.cc);
  setInputValue("licenseSubject", task.licenseMail?.subject || buildDefaultLicenseSubject());
  setInputValue("licenseBody", task.licenseMail?.body || buildDefaultLicenseBody());

  fillRecipients("assetsTo", task.assetsMail?.to);
  fillRecipients("assetsCc", task.assetsMail?.cc);
  setInputValue("assetsSubject", task.assetsMail?.subject || buildDefaultAssetsSubject());
  setInputValue("assetsBody", task.assetsMail?.body || buildDefaultAssetsBody());
  renderSelectedSnipeitAssets(task);
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
  state.tasks = await api("/tasks?type=onboarding");
  ensureSelectedTaskStillExists();

  if (!state.selectedId && state.tasks.length > 0) {
    state.selectedId = state.tasks[0].id;
  }

  renderCurrentTaskList();

  if (state.selectedId) {
    selectTask(state.selectedId);
  }
}

async function loadOffboardingTasks() {
  const data = await api("/offboarding/tasks");
  state.offboardingTasks = Array.isArray(data?.tasks) ? data.tasks : [];
  if (state.offboardingSelectedId && !state.offboardingTasks.some((task) => task.id === state.offboardingSelectedId)) {
    state.offboardingSelectedId = null;
  }
  if (!state.offboardingSelectedId && state.offboardingTasks.length > 0) {
    state.offboardingSelectedId = state.offboardingTasks[0].id;
  }
  renderCurrentTaskList();
  if (state.offboardingSelectedId) {
    selectOffboardingTask(state.offboardingSelectedId);
  }
}

async function loadManagerUsers(search = "") {
  try {
    const taskEmail = String(el("email")?.value || "").trim();
    const users = await api(`/tasks/meta/users?search=${encodeURIComponent(String(search || ""))}&email=${encodeURIComponent(taskEmail)}`);
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

async function loadSnipeitConfig() {
  try {
    const data = await api("/snipeit/config");
    state.snipeitConfig = {
      enabled: Boolean(data?.enabled),
      url: String(data?.url || "").trim(),
      laptopPrefix: String(data?.laptopPrefix || "PC-").trim() || "PC-",
      monitorPrefix: String(data?.monitorPrefix || "MN-").trim() || "MN-",
      checkIntervalMs: Number(data?.checkIntervalMs || 15 * 60 * 1000)
    };
  } catch (error) {
    state.snipeitConfig = {
      enabled: false,
      url: "",
      laptopPrefix: "PC-",
      monitorPrefix: "MN-",
      checkIntervalMs: 15 * 60 * 1000
    };
    console.warn("Failed to load Snipe-IT config", error);
  }
  applySnipeitUiVisibility();
}

function applySnipeitUiVisibility() {
  const enabled = Boolean(state.snipeitConfig?.enabled);
  const assetsBlock = el("snipeitAssetsControls");
  if (assetsBlock) assetsBlock.classList.toggle("hidden", !enabled);
  const goBtn = el("goToSnipeitBtn");
  if (goBtn) goBtn.classList.toggle("hidden", !enabled || !state.snipeitConfig?.url);
  const selectedWrap = el("selectedSnipeitAssetsWrap");
  if (selectedWrap) selectedWrap.classList.toggle("hidden", !enabled);
  const settingsBlock = el("snipeitSettingsBody");
  if (settingsBlock) settingsBlock.classList.toggle("hidden", !enabled);
  const settingsDisabled = el("snipeitSettingsDisabled");
  if (settingsDisabled) settingsDisabled.classList.toggle("hidden", enabled);
  const pendingSection = el("snipeitPendingSection");
  if (pendingSection) pendingSection.classList.toggle("hidden", !enabled);
  const offboardingSnipeitSection = el("offboardingSnipeitSection");
  if (offboardingSnipeitSection) offboardingSnipeitSection.classList.toggle("hidden", !enabled);
}

function renderSelectedSnipeitAssets(task = getCurrentTask()) {
  const container = el("selectedSnipeitAssets");
  if (!container) return;
  container.innerHTML = "";

  const selected = getSelectedSnipeitAssets(task);
  if (selected.length === 0) {
    container.innerHTML = `<div class="managerEmpty">No Snipe-IT assets selected for this task.</div>`;
    return;
  }

  for (const asset of selected) {
    const row = document.createElement("div");
    row.className = "snipeitSelectedItem";
    row.innerHTML = `
      <div class="assetTag">${String(asset.asset_tag || "").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
      <div class="assetMeta">${[asset.model, asset.companyName, asset.notes, asset.type].filter(Boolean).join(" · ").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
    `;
    container.appendChild(row);
  }
}

function closeSnipeitAssetModal() {
  el("snipeitAssetModal").classList.add("hidden");
  el("snipeitAssetModal").setAttribute("aria-hidden", "true");
}

function renderSnipeitAssetModalList() {
  const list = el("snipeitAssetList");
  if (!list) return;
  list.innerHTML = "";

  if (!Array.isArray(state.availableSnipeitAssets) || state.availableSnipeitAssets.length === 0) {
    list.innerHTML = `<div class="managerEmpty">No free assets found for this prefix.</div>`;
    return;
  }

  const selectedIds = new Set((state.selectedSnipeitAssetsDraft || []).map((asset) => Number(asset.id)));
  for (const asset of state.availableSnipeitAssets) {
    const item = document.createElement("label");
    item.className = "snipeitAssetItem";
    item.innerHTML = `
      <input type="checkbox" value="${asset.id}" ${selectedIds.has(Number(asset.id)) ? "checked" : ""} />
      <div>
        <div class="assetTag">${String(asset.asset_tag || "").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
        <div class="assetMeta">${[asset.model, asset.companyName, asset.notes].filter(Boolean).join(" · ").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
      </div>
    `;
    list.appendChild(item);
  }
}

async function loadSnipeitAssetsByType(type) {
  const prefix = type === "laptop" ? state.snipeitConfig.laptopPrefix : state.snipeitConfig.monitorPrefix;
  const status = el("snipeitAssetModalStatus");
  if (status) status.textContent = "Loading assets...";

  const response = await api(`/snipeit/assets?prefix=${encodeURIComponent(prefix)}`);
  state.availableSnipeitAssets = Array.isArray(response?.assets)
    ? response.assets.map((asset) => ({
        id: Number(asset.id),
        asset_tag: String(asset.asset_tag || "").trim(),
        model: String(asset.model || "").trim(),
        notes: String(asset.notes || "").trim(),
        companyName: String(asset.companyName || "").trim(),
        type
      }))
    : [];
  renderSnipeitAssetModalList();
  if (status) status.textContent = `${state.availableSnipeitAssets.length} assets available`;
}

async function openSnipeitAssetModal(type) {
  if (!state.snipeitConfig.enabled) {
    el("status").textContent = "Snipe-IT is disabled";
    return;
  }
  state.selectedSnipeitModalType = type;
  const task = getCurrentTask();
  const selected = getSelectedSnipeitAssets(task);
  state.selectedSnipeitAssetsDraft = selected.filter((asset) => String(asset.type || "") === type);
  el("snipeitAssetModalTitle").textContent = type === "laptop" ? "Choose Laptop" : "Choose Monitor";
  el("snipeitAssetModal").classList.remove("hidden");
  el("snipeitAssetModal").setAttribute("aria-hidden", "false");
  el("snipeitAssetSearch").value = "";
  await loadSnipeitAssetsByType(type);
}

function applySelectedSnipeitAssetsFromModal() {
  const task = getCurrentTask();
  if (!task) return;
  const current = getSelectedSnipeitAssets(task).filter((asset) => String(asset.type || "") !== state.selectedSnipeitModalType);
  const checkboxes = [...document.querySelectorAll("#snipeitAssetList input[type='checkbox']:checked")];
  const selectedSet = new Set(checkboxes.map((box) => Number(box.value)));
  const selectedAssets = state.availableSnipeitAssets.filter((asset) => selectedSet.has(Number(asset.id)));
  task.snipeitAssets = [...current, ...selectedAssets];
  renderSelectedSnipeitAssets(task);
  closeSnipeitAssetModal();
}

function filterSnipeitModalList() {
  const query = String(el("snipeitAssetSearch")?.value || "").trim().toLowerCase();
  for (const node of document.querySelectorAll("#snipeitAssetList .snipeitAssetItem")) {
    const text = node.textContent.toLowerCase();
    node.classList.toggle("hidden", query && !text.includes(query));
  }
}

function formatRelativeTime(ms) {
  if (ms <= 0) return "due now";
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.ceil(mins / 60);
  return `${hours} h`;
}

async function loadSnipeitAssignTasks() {
  if (!state.snipeitConfig.enabled) return;
  const data = await api("/snipeit/assign-tasks");
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const list = el("snipeitPendingTasks");
  if (!list) return;
  list.innerHTML = "";
  if (tasks.length === 0) {
    list.innerHTML = `<div class="managerEmpty">No pending assign tasks.</div>`;
    return;
  }

  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = "snipeitPendingItem";
    const nextAt = Date.parse(task.nextAttemptAt || 0);
    const eta = Number.isNaN(nextAt) ? "-" : formatRelativeTime(nextAt - Date.now());
    row.innerHTML = `
      <div class="pendingMain">
        <div class="assetTag">${String(task.email || "").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
        <div class="assetMeta">${(task.assets || []).map((x) => x.asset_tag).join(", ").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</div>
        <div class="assetMeta">Created: ${task.createdAt || "-"} | Next check: ${task.nextAttemptAt || "-"} (${eta}) | Status: ${task.status || "pending"}</div>
      </div>
      <div class="pendingActions">
        <button type="button" class="ghost small" data-action="force" data-id="${task.id}">Force Assign</button>
        <button type="button" class="danger small" data-action="delete" data-id="${task.id}">Delete</button>
      </div>
    `;
    list.appendChild(row);
  }
}

async function handleSnipeitPendingAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.getAttribute("data-action");
  const id = button.getAttribute("data-id");
  if (!id) return;

  button.disabled = true;
  try {
    if (action === "force") {
      await api(`/snipeit/assign-tasks/${encodeURIComponent(id)}/force`, { method: "POST" });
    }
    if (action === "delete") {
      await api(`/snipeit/assign-tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
    }
    await loadSnipeitAssignTasks();
  } catch (error) {
    el("settingsStatus").textContent = `Snipe-IT task action failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

function createCompanyMatcherCard(entry = {}, tenantOptions = []) {
  const card = document.createElement("div");
  card.className = "companyMatcherCard";
  card.innerHTML = `
    <div class="companyMatcherHeader">
      <h4>Company</h4>
      <button type="button" class="danger small companyMatcherDeleteBtn">Delete</button>
    </div>
    <div class="grid2">
      <div class="field">
        <label class="companyKeyLabel" title="COMPANY_MATCHER_KEYS">Company Key</label>
        <input class="companyMatcherKey" type="text" placeholder="EIG" />
      </div>
      <div class="field">
        <label class="companyCodeLabel">Code Name</label>
        <input class="companyMatcherCode" type="text" placeholder="EIG" />
      </div>
      <div class="field">
        <label class="companyPatternsLabel">Patterns</label>
        <input class="companyMatcherPatterns" type="text" placeholder="eig,eigllc" />
      </div>
      <div class="field">
        <label class="companyDomainLabel">Domain</label>
        <input class="companyMatcherDomain" type="text" placeholder="ei-g.com" />
      </div>
      <div class="field">
        <label class="companyTenantLabel">Tenant</label>
        <select class="companyMatcherTenant"></select>
      </div>
    </div>
    <div class="companyMatcherErrors hidden"></div>
  `;

  const keyInput = card.querySelector(".companyMatcherKey");
  const patternsInput = card.querySelector(".companyMatcherPatterns");
  const domainInput = card.querySelector(".companyMatcherDomain");
  const codeInput = card.querySelector(".companyMatcherCode");
  const tenantInput = card.querySelector(".companyMatcherTenant");
  const deleteBtn = card.querySelector(".companyMatcherDeleteBtn");

  keyInput.value = String(entry.key || "");
  patternsInput.value = String(entry.patterns || "");
  domainInput.value = String(entry.domain || "");
  codeInput.value = String(entry.code || "");
  const normalizedTenants = (Array.isArray(tenantOptions) ? tenantOptions : [])
    .map((x) => normalizeTenantKey(x))
    .filter(Boolean);
  const selectedTenant = normalizeTenantKey(entry.tenant || normalizedTenants[0] || "");
  tenantInput.innerHTML = "";
  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Select tenant";
  tenantInput.appendChild(emptyOption);
  for (const tenant of normalizedTenants) {
    const option = document.createElement("option");
    option.value = tenant;
    option.textContent = tenant;
    option.selected = tenant === selectedTenant;
    tenantInput.appendChild(option);
  }
  if (selectedTenant && !normalizedTenants.includes(selectedTenant)) {
    const option = document.createElement("option");
    option.value = selectedTenant;
    option.textContent = `${selectedTenant} (not in TENANTS)`;
    option.selected = true;
    tenantInput.appendChild(option);
  }

  const syncTooltips = () => {
    const key = normalizeCompanyMatcherKey(keyInput.value);
    const patternsVar = matcherVarName(key, "PATTERNS");
    const domainVar = matcherVarName(key, "DOMAIN");
    const codeVar = matcherVarName(key, "CODE");
    const tenantVar = matcherVarName(key, "TENANT");
    const keyLabel = card.querySelector(".companyKeyLabel");
    const patternsLabel = card.querySelector(".companyPatternsLabel");
    const domainLabel = card.querySelector(".companyDomainLabel");
    const codeLabel = card.querySelector(".companyCodeLabel");
    const tenantLabel = card.querySelector(".companyTenantLabel");
    keyLabel.title = "COMPANY_MATCHER_KEYS";
    patternsLabel.title = patternsVar;
    domainLabel.title = domainVar;
    codeLabel.title = codeVar;
    tenantLabel.title = tenantVar;
    patternsInput.title = patternsVar;
    domainInput.title = domainVar;
    codeInput.title = codeVar;
    tenantInput.title = tenantVar;
  };

  keyInput.addEventListener("input", () => {
    keyInput.value = normalizeCompanyMatcherKey(keyInput.value);
    syncTooltips();
  });
  syncTooltips();

  deleteBtn.addEventListener("click", () => {
    const key = normalizeCompanyMatcherKey(keyInput.value) || "this company";
    const ok = window.confirm(`Delete ${key} from Company Matcher settings?`);
    if (!ok) return;
    card.remove();
    const status = el("settingsStatus");
    if (status) status.textContent = `${key} removed. Click Save Settings to apply.`;
    const list = el("companyMatcherList");
    if (list && list.children.length === 0) {
      list.innerHTML = `<div class="companyMatcherEmpty">No companies configured. Add one to start.</div>`;
    }
  });

  return card;
}

function renderCompanyMatcher(entries = [], tenantOptions = []) {
  const list = el("companyMatcherList");
  list.innerHTML = "";
  const rows = Array.isArray(entries) ? entries : [];

  if (rows.length === 0) {
    list.innerHTML = `<div class="companyMatcherEmpty">No companies configured. Add one to start.</div>`;
    return;
  }

  for (const entry of rows) {
    list.appendChild(createCompanyMatcherCard(entry, tenantOptions));
  }
}

function readCompanyMatcherEntries() {
  const cards = [...document.querySelectorAll("#companyMatcherList .companyMatcherCard")];
  return cards.map((card, index) => {
    const key = card.querySelector(".companyMatcherKey").value.trim();
    const patterns = card.querySelector(".companyMatcherPatterns").value.trim();
    const domain = card.querySelector(".companyMatcherDomain").value.trim();
    const code = card.querySelector(".companyMatcherCode").value.trim();
    const tenant = card.querySelector(".companyMatcherTenant").value.trim();
    return { key, patterns, domain, code, tenant, _index: index, _card: card };
  });
}

function setCompanyMatcherErrors(entries, tenantOptions = []) {
  const tenantSet = new Set((Array.isArray(tenantOptions) ? tenantOptions : []).map((x) => normalizeTenantKey(x)).filter(Boolean));
  for (const row of entries) {
    const box = row._card.querySelector(".companyMatcherErrors");
    const errors = [];
    const key = normalizeCompanyMatcherKey(row.key);
    if (!key) errors.push("Company Key is required.");
    if (!row.patterns || row.patterns.split(",").map((x) => x.trim()).filter(Boolean).length === 0) {
      errors.push("Patterns is required (comma-separated).");
    }
    if (!row.domain || !isValidDomain(row.domain)) {
      errors.push("Domain must be a valid domain (example: ei-g.com).");
    }
    if (!row.code) {
      errors.push("Code Name is required.");
    }
    const tenant = normalizeTenantKey(row.tenant);
    if (!tenant) {
      errors.push("Tenant is required.");
    } else if (tenantSet.size > 0 && !tenantSet.has(tenant)) {
      errors.push("Tenant must exist in TENANTS.");
    }

    if (errors.length > 0) {
      box.classList.remove("hidden");
      box.innerHTML = errors.map((e) => `<div>${e}</div>`).join("");
      row._errors = errors;
    } else {
      box.classList.add("hidden");
      box.textContent = "";
      row._errors = [];
    }
  }

  const seen = new Map();
  for (const row of entries) {
    const normalized = normalizeCompanyMatcherKey(row.key);
    if (!normalized) continue;
    if (!seen.has(normalized)) seen.set(normalized, []);
    seen.get(normalized).push(row);
  }
  for (const [key, rows] of seen.entries()) {
    if (rows.length <= 1) continue;
    for (const row of rows) {
      const box = row._card.querySelector(".companyMatcherErrors");
      box.classList.remove("hidden");
      box.innerHTML += `<div>Company Key must be unique (${key}).</div>`;
      row._errors.push(`duplicate:${key}`);
    }
  }
}

function fillSettingsForm(values = {}) {
  el("settingRedirectUri").value = String(values.REDIRECT_URI || "");
  el("settingAllowedEmail").value = String(values.ALLOWED_EMAILS || values.ALLOWED_EMAIL || "");
  el("settingLicenseTo").value = String(values.LICENSE_REQUEST_TO || "");
  el("settingLicenseCc").value = String(values.LICENSE_REQUEST_CC || "");
  el("settingAssetsTo").value = String(values.ASSETS_REQUEST_TO || "");
  el("settingAssetsCc").value = String(values.ASSETS_REQUEST_CC || "");
  el("settingSnipeitEnabled").checked = String(values.SNIPEIT_ENABLED || "false").toLowerCase() === "true";
  el("settingSnipeitLaptopPrefix").value = String(values.SNIPEIT_LAPTOP_PREFIX || state.snipeitConfig.laptopPrefix || "PC-");
  el("settingSnipeitMonitorPrefix").value = String(values.SNIPEIT_MONITOR_PREFIX || state.snipeitConfig.monitorPrefix || "MN-");
  const companies = values.companies || values.companyMatcher || [];
  renderCompanyMatcher(companies, values.tenants || []);
  state.snipeitConfig.enabled = el("settingSnipeitEnabled").checked;
  applySnipeitUiVisibility();
}

function readSettingsForm() {
  const companyMatcher = readCompanyMatcherEntries();
  return {
    REDIRECT_URI: el("settingRedirectUri").value.trim(),
    ALLOWED_EMAILS: el("settingAllowedEmail").value.trim(),
    LICENSE_REQUEST_TO: el("settingLicenseTo").value.trim(),
    LICENSE_REQUEST_CC: el("settingLicenseCc").value.trim(),
    ASSETS_REQUEST_TO: el("settingAssetsTo").value.trim(),
    ASSETS_REQUEST_CC: el("settingAssetsCc").value.trim(),
    SNIPEIT_ENABLED: String(Boolean(el("settingSnipeitEnabled").checked)),
    SNIPEIT_LAPTOP_PREFIX: el("settingSnipeitLaptopPrefix").value.trim(),
    SNIPEIT_MONITOR_PREFIX: el("settingSnipeitMonitorPrefix").value.trim(),
    companyMatcher: companyMatcher.map((row) => ({
      key: normalizeCompanyMatcherKey(row.key),
      patterns: row.patterns
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .join(","),
      domain: row.domain.trim().toLowerCase(),
      code: row.code.trim(),
      tenant: normalizeTenantKey(row.tenant)
    })),
    _companyMatcherMeta: companyMatcher
  };
}

function validateSettingsPayload(payload) {
  validateRedirectUri(payload.REDIRECT_URI);
  validateEmailList("Allowed Email(s)", payload.ALLOWED_EMAILS);
  validateEmailList("License Request To", payload.LICENSE_REQUEST_TO);
  validateEmailList("License Request CC", payload.LICENSE_REQUEST_CC);
  validateEmailList("Assets Request To", payload.ASSETS_REQUEST_TO);
  validateEmailList("Assets Request CC", payload.ASSETS_REQUEST_CC);
  if (!payload.SNIPEIT_LAPTOP_PREFIX) {
    throw new Error("Laptop Prefix is required");
  }
  if (!payload.SNIPEIT_MONITOR_PREFIX) {
    throw new Error("Monitor Prefix is required");
  }

  const entries = payload._companyMatcherMeta || [];
  const tenants = Array.isArray(state.settings?.tenants) ? state.settings.tenants : [];
  setCompanyMatcherErrors(entries, tenants);
  const hasErrors = entries.some((row) => Array.isArray(row._errors) && row._errors.length > 0);
  if (hasErrors) {
    throw new Error("Company Matcher contains validation errors");
  }
}

async function loadSettings() {
  const data = await api("/settings");
  state.settings = data?.values || {};
  fillSettingsForm(state.settings);
  await loadSnipeitAssignTasks().catch(() => {});
  return state.settings;
}

function openSettingsModal() {
  const status = el("settingsStatus");
  if (status) status.textContent = "";
  el("settingsModal").classList.remove("hidden");
  el("settingsModal").setAttribute("aria-hidden", "false");
  loadSettings().catch((error) => {
    if (status) {
      status.textContent = `Failed to load settings: ${error.message}`;
    }
  });
}

function closeSettingsModal() {
  el("settingsModal").classList.add("hidden");
  el("settingsModal").setAttribute("aria-hidden", "true");
}

async function saveSettings() {
  const payload = readSettingsForm();
  validateSettingsPayload(payload);
  delete payload._companyMatcherMeta;

  const response = await api("/settings", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });

  state.settings = response?.values || payload;
  fillSettingsForm(state.settings);
  await loadSnipeitConfig();
  if (!state.snipeitConfig.enabled) {
    const task = getCurrentTask();
    if (task) {
      task.snipeitAssets = [];
      renderSelectedSnipeitAssets(task);
    }
  }
  await loadMeta();
  await loadSnipeitAssignTasks().catch(() => {});
  if (state.selectedId) {
    selectTask(state.selectedId);
  }
  el("settingsStatus").textContent = "Settings saved";
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
  const selectedSnipeitAssets = state.snipeitConfig.enabled
    ? getSelectedSnipeitAssets().filter((asset, index, arr) => arr.findIndex((x) => Number(x.id) === Number(asset.id)) === index)
    : [];
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
    },
    snipeitAssets: selectedSnipeitAssets
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

  const tabOnboardingBtn = el("tabOnboardingBtn");
  if (tabOnboardingBtn) {
    tabOnboardingBtn.onclick = () => setTaskMode("onboarding");
  }

  const tabOffboardingBtn = el("tabOffboardingBtn");
  if (tabOffboardingBtn) {
    tabOffboardingBtn.onclick = () => setTaskMode("offboarding");
  }

  const offboardingNewBtn = el("offboardingNewBtn");
  if (offboardingNewBtn) {
    offboardingNewBtn.onclick = () => {
      resetOffboardingState();
      el("offboardingStatus").textContent = "New offboarding draft";
    };
  }

  const onboardingNewBtn = el("onboardingNewBtn");
  if (onboardingNewBtn) {
    onboardingNewBtn.onclick = async () => {
      try {
        const response = await api("/tasks/new", { method: "POST", body: JSON.stringify({}) });
        await loadTasks();
        if (response?.task?.id) {
          state.selectedId = response.task.id;
          selectTask(response.task.id);
        }
        el("status").textContent = "New onboarding task created";
      } catch (error) {
        el("status").textContent = `Failed to create onboarding task: ${error.message}`;
      }
    };
  }

  const offboardingRefreshBtn = el("offboardingRefreshBtn");
  if (offboardingRefreshBtn) {
    offboardingRefreshBtn.onclick = async () => {
      try {
        await loadOffboardingTasks();
        el("offboardingStatus").textContent = "Offboarding tasks refreshed";
      } catch (error) {
        el("offboardingStatus").textContent = `Refresh failed: ${error.message}`;
      }
    };
  }

  const chooseOffboardingUserBtn = el("chooseOffboardingUserBtn");
  if (chooseOffboardingUserBtn) {
    chooseOffboardingUserBtn.onclick = () => openOffboardingUserModal();
  }

  const offboardingDeleteUser = el("offboardingDeleteUser");
  if (offboardingDeleteUser) {
    offboardingDeleteUser.addEventListener("change", () => {
      state.offboarding.deleteUser = offboardingDeleteUser.checked;
      updateOffboardingPreview();
    });
  }

  const offboardingAccountsList = el("offboardingAccountsList");
  if (offboardingAccountsList) {
    offboardingAccountsList.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains("offboardingAccountCheck")) return;
      const id = target.getAttribute("data-id");
      for (const account of state.offboarding.relatedAccounts) {
        if (String(account.id) === String(id)) account.selected = target.checked;
      }
      updateOffboardingPreview();
    });
  }

  const offboardingAssetsList = el("offboardingAssetsList");
  if (offboardingAssetsList) {
    offboardingAssetsList.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains("offboardingAssetCheck")) return;
      const id = target.getAttribute("data-id");
      for (const asset of state.offboarding.snipeitAssets) {
        if (String(asset.id) === String(id)) asset.selected = target.checked;
      }
      updateOffboardingPreview();
    });
  }

  const offboardingExecuteBtn = el("offboardingExecuteBtn");
  if (offboardingExecuteBtn) {
    offboardingExecuteBtn.onclick = async () => {
      try {
        offboardingExecuteBtn.disabled = true;
        el("offboardingStatus").textContent = "Executing...";
        const result = await executeOffboarding();
        const entraSummary = (result?.steps?.entra || []).map((x) => `${x.user}:${x.status}`).join(", ");
        const snipeitSummary = (result?.steps?.snipeit || []).map((x) => `${x.id}:${x.status}`).join(", ");
        el("offboardingStatus").textContent = `Done. Entra[${entraSummary || "-"}], SnipeIT[${snipeitSummary || "-"}]`;
      } catch (error) {
        el("offboardingStatus").textContent = `Execute failed: ${error.message}`;
      } finally {
        offboardingExecuteBtn.disabled = false;
      }
    };
  }

  const offboardingSaveBtn = el("offboardingSaveBtn");
  if (offboardingSaveBtn) {
    offboardingSaveBtn.onclick = async () => {
      try {
        offboardingSaveBtn.disabled = true;
        const result = await saveOffboardingTask();
        el("offboardingStatus").textContent = `Saved (${result?.task?.id || "task"})`;
      } catch (error) {
        el("offboardingStatus").textContent = `Save failed: ${error.message}`;
      } finally {
        offboardingSaveBtn.disabled = false;
      }
    };
  }

  const offboardingDeleteBtn = el("offboardingDeleteBtn");
  if (offboardingDeleteBtn) {
    offboardingDeleteBtn.onclick = async () => {
      try {
        offboardingDeleteBtn.disabled = true;
        await deleteOffboardingTask();
        el("offboardingStatus").textContent = "Offboarding task deleted";
      } catch (error) {
        el("offboardingStatus").textContent = `Delete failed: ${error.message}`;
      } finally {
        offboardingDeleteBtn.disabled = false;
      }
    };
  }

  const offboardingUserModalClose = el("offboardingUserModalClose");
  if (offboardingUserModalClose) {
    offboardingUserModalClose.onclick = () => closeOffboardingUserModal();
  }

  const offboardingUserModalOverlay = el("offboardingUserModalOverlay");
  if (offboardingUserModalOverlay) {
    offboardingUserModalOverlay.onclick = () => closeOffboardingUserModal();
  }

  const offboardingUserTenantSelect = el("offboardingUserTenantSelect");
  if (offboardingUserTenantSelect) {
    offboardingUserTenantSelect.addEventListener("change", () => {
      state.offboarding.selectedTenant = offboardingUserTenantSelect.value;
      renderOffboardingTenantOptions();
      loadOffboardingUsers(el("offboardingUserSearch")?.value || "").catch((error) => {
        el("offboardingUserModalError").textContent = `Failed to load users: ${error.message}`;
      });
    });
  }

  const offboardingUserSearch = el("offboardingUserSearch");
  if (offboardingUserSearch) {
    offboardingUserSearch.addEventListener("input", () => {
      loadOffboardingUsers(offboardingUserSearch.value.trim()).catch((error) => {
        el("offboardingUserModalError").textContent = `Failed to load users: ${error.message}`;
      });
    });
  }

  const chooseLaptopBtn = el("chooseLaptopBtn");
  if (chooseLaptopBtn) {
    chooseLaptopBtn.onclick = async () => {
      try {
        await openSnipeitAssetModal("laptop");
      } catch (error) {
        el("status").textContent = `Laptop loading failed: ${error.message}`;
      }
    };
  }

  const chooseMonitorBtn = el("chooseMonitorBtn");
  if (chooseMonitorBtn) {
    chooseMonitorBtn.onclick = async () => {
      try {
        await openSnipeitAssetModal("monitor");
      } catch (error) {
        el("status").textContent = `Monitor loading failed: ${error.message}`;
      }
    };
  }

  const goToSnipeitBtn = el("goToSnipeitBtn");
  if (goToSnipeitBtn) {
    goToSnipeitBtn.onclick = () => {
      const url = String(state.snipeitConfig?.url || "").trim();
      if (!url) {
        el("status").textContent = "SNIPEIT_URL is not configured";
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    };
  }

  const snipeitAssetModalClose = el("snipeitAssetModalClose");
  if (snipeitAssetModalClose) {
    snipeitAssetModalClose.onclick = () => closeSnipeitAssetModal();
  }

  const snipeitAssetModalOverlay = el("snipeitAssetModalOverlay");
  if (snipeitAssetModalOverlay) {
    snipeitAssetModalOverlay.onclick = () => closeSnipeitAssetModal();
  }

  const snipeitAssetApplyBtn = el("snipeitAssetApplyBtn");
  if (snipeitAssetApplyBtn) {
    snipeitAssetApplyBtn.onclick = () => applySelectedSnipeitAssetsFromModal();
  }

  const snipeitAssetCancelBtn = el("snipeitAssetCancelBtn");
  if (snipeitAssetCancelBtn) {
    snipeitAssetCancelBtn.onclick = () => closeSnipeitAssetModal();
  }

  const snipeitAssetSearch = el("snipeitAssetSearch");
  if (snipeitAssetSearch) {
    snipeitAssetSearch.addEventListener("input", filterSnipeitModalList);
  }

  const settingsBtn = el("settingsBtn");
  if (settingsBtn) {
    settingsBtn.onclick = () => openSettingsModal();
  }

  const settingsModalClose = el("settingsModalClose");
  if (settingsModalClose) {
    settingsModalClose.onclick = () => closeSettingsModal();
  }

  const settingsModalOverlay = el("settingsModalOverlay");
  if (settingsModalOverlay) {
    settingsModalOverlay.onclick = () => closeSettingsModal();
  }

  const settingsCancelBtn = el("settingsCancelBtn");
  if (settingsCancelBtn) {
    settingsCancelBtn.onclick = () => closeSettingsModal();
  }

  const settingSnipeitEnabled = el("settingSnipeitEnabled");
  if (settingSnipeitEnabled) {
    settingSnipeitEnabled.addEventListener("change", () => {
      state.snipeitConfig.enabled = Boolean(settingSnipeitEnabled.checked);
      applySnipeitUiVisibility();
    });
  }

  const snipeitPendingTasks = el("snipeitPendingTasks");
  if (snipeitPendingTasks) {
    snipeitPendingTasks.addEventListener("click", (event) => {
      handleSnipeitPendingAction(event);
    });
  }

  const refreshSnipeitTasksBtn = el("refreshSnipeitTasksBtn");
  if (refreshSnipeitTasksBtn) {
    refreshSnipeitTasksBtn.onclick = async () => {
      try {
        await loadSnipeitAssignTasks();
      } catch (error) {
        el("settingsStatus").textContent = `Failed to load Snipe-IT tasks: ${error.message}`;
      }
    };
  }

  const settingsSaveBtn = el("settingsSaveBtn");
  if (settingsSaveBtn) {
    settingsSaveBtn.onclick = async () => {
      try {
        settingsSaveBtn.disabled = true;
        await saveSettings();
      } catch (error) {
        el("settingsStatus").textContent = `Save failed: ${error.message}`;
      } finally {
        settingsSaveBtn.disabled = false;
      }
    };
  }

  const addCompanyMatcherBtn = el("addCompanyMatcherBtn");
  if (addCompanyMatcherBtn) {
    addCompanyMatcherBtn.onclick = () => {
      const list = el("companyMatcherList");
      if (list.querySelector(".companyMatcherEmpty")) {
        list.innerHTML = "";
      }
      const tenants = Array.isArray(state.settings?.tenants) ? state.settings.tenants : [];
      list.appendChild(
        createCompanyMatcherCard({
          key: "",
          patterns: "",
          domain: "",
          code: "",
          tenant: tenants[0] || ""
        }, tenants)
      );
    };
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
      if (state.taskMode === "offboarding") {
        await loadOffboardingTasks();
        el("offboardingStatus").textContent = "Offboarding tasks refreshed";
      } else {
        await loadTasks();
        el("status").textContent = "Refreshed";
      }
    } catch (error) {
      if (state.taskMode === "offboarding") {
        el("offboardingStatus").textContent = `Refresh failed: ${error.message}`;
      } else {
        el("status").textContent = `Refresh failed: ${error.message}`;
      }
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

  renderOffboardingSelectedUser();
  renderOffboardingAccounts();
  renderOffboardingAssets();
  setTaskMode("onboarding");
}

(async function main() {
  initAuth();
  await initApp();
})();
