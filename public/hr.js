const state = {
  companies: [],
  companiesByKey: new Map(),
  pickerTarget: null, // "manager" | "employee" | "mention"
  pickerMentionForm: null, // "onboarding" | "offboarding" - only used when pickerTarget === "mention"
  pickerTenant: "",
  pickerRequestId: 0,
  pickerLoading: false,
  pickerUsers: [],
  pickerDebounceTimer: null,
  selectedManager: null,
  selectedEmployee: null,
  sessionWatchTimer: null,
  sessionExpiredNotified: false,
  teamsNotificationsEnabled: false,
  onboardingMentions: [],
  offboardingMentions: [],
  teamsDefaults: {
    onboarding: { note: "", mentions: [] },
    offboarding: { note: "", mentions: [] }
  }
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

async function checkAuthStatus() {
  try {
    const response = await fetch("/auth/user");
    return await response.json();
  } catch {
    return { authenticated: false };
  }
}

function showSessionExpiredNotice() {
  if (state.sessionExpiredNotified) return;
  state.sessionExpiredNotified = true;

  const message = "Session expired. Please reload the page to continue and sign in again.";
  if (byId("hrOnboardingStatus")) byId("hrOnboardingStatus").textContent = message;
  if (byId("hrOffboardingStatus")) byId("hrOffboardingStatus").textContent = message;

  let modal = document.getElementById("sessionExpiredModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "sessionExpiredModal";
    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.zIndex = "99999";
    modal.style.background = "rgba(0,0,0,0.45)";
    modal.style.display = "grid";
    modal.style.placeItems = "center";
    modal.innerHTML = `
      <div style="max-width:480px;width:92%;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:var(--shadow);">
        <h3 style="margin:0 0 10px;">Session Expired</h3>
        <p style="margin:0 0 14px;color:var(--muted);line-height:1.45;">Your session is no longer valid (for example after a service restart). Reload the page to open the login screen.</p>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button id="sessionExpiredReloadBtn" class="primary" type="button">Reload Page</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const reloadBtn = document.getElementById("sessionExpiredReloadBtn");
    if (reloadBtn) {
      reloadBtn.addEventListener("click", () => window.location.reload());
    }
  }
}

function startSessionWatch() {
  if (state.sessionWatchTimer) {
    clearInterval(state.sessionWatchTimer);
  }
  state.sessionWatchTimer = setInterval(() => {
    checkAuthStatus()
      .then((session) => {
        if (!session?.authenticated) {
          showSessionExpiredNotice();
        }
      })
      .catch(() => {});
  }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    checkAuthStatus()
      .then((session) => {
        if (!session?.authenticated) {
          showSessionExpiredNotice();
        }
      })
      .catch(() => {});
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (response.status === 401 || response.status === 403) {
    showSessionExpiredNotice();
    throw new Error("Session expired. Reload the page and sign in again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function populateCompanySelect(select) {
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select company";
  select.appendChild(placeholder);
  for (const company of state.companies) {
    const option = document.createElement("option");
    option.value = company.key;
    option.textContent = company.code || company.key;
    select.appendChild(option);
  }
}

async function loadCompanies() {
  const data = await api("/hr/companies");
  state.companies = Array.isArray(data.companies) ? data.companies : [];
  state.companiesByKey = new Map(state.companies.map((company) => [company.key, company]));
  state.teamsNotificationsEnabled = Boolean(data.teamsNotificationsEnabled);
  populateCompanySelect(byId("hrOnboardingCompany"));
  populateCompanySelect(byId("hrOffboardingCompany"));
  applyTeamsUiVisibility();
}

function applyTeamsUiVisibility() {
  byId("hrOnboardingTeamsSection").classList.toggle("hidden", !state.teamsNotificationsEnabled);
  byId("hrOffboardingTeamsSection").classList.toggle("hidden", !state.teamsNotificationsEnabled);
}

async function loadTeamsDefaults() {
  const data = await api("/hr/teams-defaults");
  state.teamsDefaults = data.defaults || state.teamsDefaults;
  applyTeamsDefault("onboarding");
  applyTeamsDefault("offboarding");
}

function applyTeamsDefault(formType) {
  const defaults = state.teamsDefaults?.[formType] || { note: "", mentions: [] };
  const noteId = formType === "onboarding" ? "hrOnboardingTeamsNote" : "hrOffboardingTeamsNote";
  byId(noteId).value = defaults.note || "";
  const rows = (defaults.mentions || []).map((row) => ({ ...row }));
  if (formType === "onboarding") {
    state.onboardingMentions = rows;
  } else {
    state.offboardingMentions = rows;
  }
  renderMentionRows(formType);
}

async function saveTeamsDefault(formType) {
  const noteId = formType === "onboarding" ? "hrOnboardingTeamsNote" : "hrOffboardingTeamsNote";
  const statusId = formType === "onboarding" ? "hrOnboardingStatus" : "hrOffboardingStatus";
  const note = byId(noteId).value.trim();
  const mentions = formType === "onboarding" ? state.onboardingMentions : state.offboardingMentions;

  try {
    const data = await api("/hr/teams-defaults", {
      method: "POST",
      body: JSON.stringify({ type: formType, note, mentions })
    });
    state.teamsDefaults[formType] = data.defaults;
    byId(statusId).textContent = "Default Teams message saved.";
  } catch (error) {
    byId(statusId).textContent = `Failed to save default: ${error.message}`;
  }
}

function switchHrTab(tab) {
  const isOnboarding = tab === "onboarding";
  byId("hrTabOnboardingBtn").classList.toggle("active", isOnboarding);
  byId("hrTabOffboardingBtn").classList.toggle("active", !isOnboarding);
  byId("hrOnboardingForm").classList.toggle("hidden", !isOnboarding);
  byId("hrOffboardingForm").classList.toggle("hidden", isOnboarding);
}

function renderMentionRows(formType) {
  const containerId = formType === "onboarding" ? "hrOnboardingMentions" : "hrOffboardingMentions";
  const rows = formType === "onboarding" ? state.onboardingMentions : state.offboardingMentions;
  const container = byId(containerId);
  container.innerHTML = "";

  rows.forEach((row, index) => {
    const rowEl = document.createElement("div");
    rowEl.className = "mentionRow";

    const nameEl = document.createElement("div");
    nameEl.className = "mentionRowName";
    nameEl.title = row.name;
    nameEl.textContent = row.name;

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.placeholder = "Message after mention";
    textInput.value = row.text;
    textInput.addEventListener("input", (event) => {
      row.text = event.target.value;
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "mentionRowRemove";
    removeBtn.setAttribute("aria-label", "Remove mention");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      rows.splice(index, 1);
      renderMentionRows(formType);
    });

    rowEl.appendChild(nameEl);
    rowEl.appendChild(textInput);
    rowEl.appendChild(removeBtn);
    container.appendChild(rowEl);
  });
}

function addMentionRow(formType, user) {
  const rows = formType === "onboarding" ? state.onboardingMentions : state.offboardingMentions;
  rows.push({
    id: user.id || "",
    name: user.displayName || user.mail || "Unnamed user",
    text: ""
  });
  renderMentionRows(formType);
}

function resetManagerSelection() {
  state.selectedManager = null;
  byId("hrManager").value = "";
}

function resetEmployeeSelection() {
  state.selectedEmployee = null;
  const box = byId("hrOffboardingEmployee");
  box.textContent = "Not selected";
  box.classList.add("managerEmpty");
}

function onOnboardingCompanyChange() {
  const key = byId("hrOnboardingCompany").value;
  byId("hrChooseManagerBtn").disabled = !key;
  resetManagerSelection();
}

function onOffboardingCompanyChange() {
  const key = byId("hrOffboardingCompany").value;
  byId("hrChooseEmployeeBtn").disabled = !key;
  resetEmployeeSelection();
}

function openUserModal(target, mentionForm) {
  state.pickerTarget = target;
  state.pickerMentionForm = mentionForm || null;

  if (target === "mention") {
    state.pickerTenant = "";
    byId("hrUserModalTitle").textContent = "Add Mention";
  } else {
    const companyKey = target === "manager" ? byId("hrOnboardingCompany").value : byId("hrOffboardingCompany").value;
    const company = state.companiesByKey.get(companyKey);
    if (!company) return;
    state.pickerTenant = company.tenant;
    byId("hrUserModalTitle").textContent = target === "manager" ? "Choose Line Manager" : "Choose Employee";
  }

  byId("hrUserSearch").value = "";
  byId("hrUserModalError").textContent = "";
  state.pickerUsers = [];
  renderUserModalList();

  const modal = byId("hrUserModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  byId("hrUserSearch").focus();
  searchPickerUsers("");
}

function closeUserModal() {
  const modal = byId("hrUserModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  state.pickerTarget = null;
}

async function searchPickerUsers(search) {
  const requestId = ++state.pickerRequestId;
  state.pickerLoading = true;
  renderUserModalList();
  try {
    const endpoint = state.pickerTarget === "mention"
      ? `/hr/mention-users?search=${encodeURIComponent(search || "")}`
      : `/hr/users?tenant=${encodeURIComponent(state.pickerTenant)}&search=${encodeURIComponent(search || "")}`;
    const data = await api(endpoint);
    if (requestId !== state.pickerRequestId) return;
    state.pickerUsers = Array.isArray(data.users) ? data.users : [];
    byId("hrUserModalError").textContent = "";
  } catch (error) {
    if (requestId !== state.pickerRequestId) return;
    state.pickerUsers = [];
    byId("hrUserModalError").textContent = `Failed to load users: ${error.message}`;
  } finally {
    if (requestId === state.pickerRequestId) {
      state.pickerLoading = false;
    }
  }
  if (requestId !== state.pickerRequestId) return;
  renderUserModalList();
}

function renderUserModalList() {
  const list = byId("hrUserList");
  list.innerHTML = "";

  if (state.pickerLoading) {
    const loading = document.createElement("div");
    loading.className = "managerEmpty";
    loading.textContent = "Loading users...";
    list.appendChild(loading);
    return;
  }

  if (state.pickerUsers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "managerEmpty";
    empty.textContent = byId("hrUserSearch").value.trim()
      ? "No matching users found."
      : "Use search to find tenant users by name or email.";
    list.appendChild(empty);
    return;
  }

  for (const user of state.pickerUsers) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "managerItem";
    item.onclick = () => selectPickedUser(user);

    const title = document.createElement("div");
    title.textContent = user.displayName || user.mail || "Unnamed user";
    const subtitle = document.createElement("div");
    subtitle.className = "subtitle";
    subtitle.textContent = user.mail || user.userPrincipalName || "";
    item.appendChild(title);
    item.appendChild(subtitle);
    list.appendChild(item);
  }
}

function selectPickedUser(user) {
  if (state.pickerTarget === "manager") {
    state.selectedManager = user;
    const managerInput = byId("hrManager");
    managerInput.value = user.displayName || user.mail || "";
    managerInput.classList.remove("fieldInvalid");
  } else if (state.pickerTarget === "employee") {
    state.selectedEmployee = user;
    const box = byId("hrOffboardingEmployee");
    box.textContent = `${user.displayName || "Unnamed user"}${user.mail ? ` · ${user.mail}` : ""}`;
    box.classList.remove("managerEmpty");
    box.classList.remove("fieldInvalid");
  } else if (state.pickerTarget === "mention") {
    addMentionRow(state.pickerMentionForm, user);
  }
  closeUserModal();
}

function setupDatePicker(input) {
  const supportsShowPicker = typeof input.showPicker === "function";
  const open = () => {
    if (!supportsShowPicker) return;
    try {
      input.showPicker();
    } catch {
      // ignore - browser refused (e.g. not a user gesture)
    }
  };
  // Note: the input is intentionally NOT set readOnly - showPicker() throws
  // InvalidStateError on a readonly/disabled control, which silently blocked
  // the picker from ever opening. Manual typing is blocked via keydown instead.
  input.addEventListener("click", open);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Tab" || event.key === "Shift" || event.key === "Escape") return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
      return;
    }
    event.preventDefault();
  });
}

function showHrSuccess(title, message) {
  byId("hrSuccessModalTitle").textContent = title;
  byId("hrSuccessModalMessage").textContent = message;
  const modal = byId("hrSuccessModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeHrSuccessModal() {
  const modal = byId("hrSuccessModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function markFieldValidity(field, isValid) {
  if (!field) return;
  field.classList.toggle("fieldInvalid", !isValid);
}

function clearFieldInvalid(event) {
  event.target.classList.remove("fieldInvalid");
}

function debouncedSearch(value) {
  if (state.pickerDebounceTimer) {
    clearTimeout(state.pickerDebounceTimer);
  }
  state.pickerDebounceTimer = setTimeout(() => {
    searchPickerUsers(value);
  }, 300);
}

async function submitOnboarding() {
  const statusEl = byId("hrOnboardingStatus");
  statusEl.textContent = "";
  const payload = {
    fullName: byId("hrFullName").value.trim(),
    companyKey: byId("hrOnboardingCompany").value,
    position: byId("hrPosition").value.trim(),
    phone: byId("hrPhone").value.trim(),
    manager: byId("hrManager").value.trim(),
    startDate: byId("hrStartDate").value,
    teamsNote: byId("hrOnboardingTeamsNote").value.trim(),
    teamsMentions: state.onboardingMentions
      .filter((row) => row.text.trim())
      .map((row) => ({ id: row.id, name: row.name, text: row.text.trim() }))
  };

  const requiredFields = [
    [byId("hrFullName"), payload.fullName],
    [byId("hrOnboardingCompany"), payload.companyKey],
    [byId("hrManager"), payload.manager],
    [byId("hrStartDate"), payload.startDate]
  ];
  let allValid = true;
  for (const [field, value] of requiredFields) {
    const isValid = Boolean(String(value || "").trim());
    markFieldValidity(field, isValid);
    if (!isValid) allValid = false;
  }
  if (!allValid) {
    statusEl.textContent = "Please fill in all required fields.";
    return;
  }

  const submitBtn = byId("hrOnboardingSubmitBtn");
  submitBtn.disabled = true;
  try {
    await api("/hr/onboarding", { method: "POST", body: JSON.stringify(payload) });
    showHrSuccess("Onboarding Task Created", `${payload.fullName} has been submitted for onboarding.`);
    byId("hrFullName").value = "";
    byId("hrOnboardingCompany").value = "";
    byId("hrPosition").value = "";
    byId("hrPhone").value = "";
    byId("hrStartDate").value = "";
    byId("hrChooseManagerBtn").disabled = true;
    resetManagerSelection();
    applyTeamsDefault("onboarding");
  } catch (error) {
    statusEl.textContent = `Failed to create task: ${error.message}`;
  } finally {
    submitBtn.disabled = false;
  }
}

async function submitOffboarding() {
  const statusEl = byId("hrOffboardingStatus");
  statusEl.textContent = "";
  const companyKey = byId("hrOffboardingCompany").value;
  const startDate = byId("hrOffboardingDate").value;

  const requiredFields = [
    [byId("hrOffboardingCompany"), companyKey],
    [byId("hrOffboardingEmployee"), state.selectedEmployee ? "set" : ""],
    [byId("hrOffboardingDate"), startDate]
  ];
  let allValid = true;
  for (const [field, value] of requiredFields) {
    const isValid = Boolean(String(value || "").trim());
    markFieldValidity(field, isValid);
    if (!isValid) allValid = false;
  }
  if (!allValid) {
    statusEl.textContent = "Please fill in all required fields.";
    return;
  }

  const payload = {
    companyKey,
    user: state.selectedEmployee,
    startDate,
    teamsNote: byId("hrOffboardingTeamsNote").value.trim(),
    teamsMentions: state.offboardingMentions
      .filter((row) => row.text.trim())
      .map((row) => ({ id: row.id, name: row.name, text: row.text.trim() }))
  };

  const submitBtn = byId("hrOffboardingSubmitBtn");
  submitBtn.disabled = true;
  try {
    await api("/hr/offboarding", { method: "POST", body: JSON.stringify(payload) });
    const employeeLabel = state.selectedEmployee.displayName || state.selectedEmployee.mail || "The employee";
    showHrSuccess("Offboarding Task Created", `${employeeLabel} has been submitted for offboarding.`);
    byId("hrOffboardingCompany").value = "";
    byId("hrOffboardingDate").value = "";
    byId("hrChooseEmployeeBtn").disabled = true;
    resetEmployeeSelection();
    applyTeamsDefault("offboarding");
  } catch (error) {
    statusEl.textContent = `Failed to create task: ${error.message}`;
  } finally {
    submitBtn.disabled = false;
  }
}

function init() {
  initTheme();
  startSessionWatch();

  byId("hrProgressBtn").addEventListener("click", () => {
    window.location.href = "/progress";
  });
  byId("hrLogoutBtn").addEventListener("click", () => {
    window.location.href = "/auth/logout";
  });

  byId("hrTabOnboardingBtn").addEventListener("click", () => switchHrTab("onboarding"));
  byId("hrTabOffboardingBtn").addEventListener("click", () => switchHrTab("offboarding"));

  byId("hrOnboardingCompany").addEventListener("change", onOnboardingCompanyChange);
  byId("hrOffboardingCompany").addEventListener("change", onOffboardingCompanyChange);

  byId("hrChooseManagerBtn").addEventListener("click", () => openUserModal("manager"));
  byId("hrChooseEmployeeBtn").addEventListener("click", () => openUserModal("employee"));
  byId("hrAddOnboardingMentionBtn").addEventListener("click", () => openUserModal("mention", "onboarding"));
  byId("hrAddOffboardingMentionBtn").addEventListener("click", () => openUserModal("mention", "offboarding"));
  byId("hrSaveOnboardingDefaultBtn").addEventListener("click", () => saveTeamsDefault("onboarding"));
  byId("hrSaveOffboardingDefaultBtn").addEventListener("click", () => saveTeamsDefault("offboarding"));
  byId("hrUserModalClose").addEventListener("click", closeUserModal);
  byId("hrUserModalOverlay").addEventListener("click", closeUserModal);
  byId("hrUserSearch").addEventListener("input", (event) => debouncedSearch(event.target.value));

  byId("hrOnboardingSubmitBtn").addEventListener("click", submitOnboarding);
  byId("hrOffboardingSubmitBtn").addEventListener("click", submitOffboarding);

  byId("hrSuccessModalClose").addEventListener("click", closeHrSuccessModal);
  byId("hrSuccessModalOverlay").addEventListener("click", closeHrSuccessModal);

  setupDatePicker(byId("hrStartDate"));
  setupDatePicker(byId("hrOffboardingDate"));

  ["hrFullName", "hrPosition", "hrPhone"].forEach((id) => {
    byId(id).addEventListener("input", clearFieldInvalid);
  });
  ["hrOnboardingCompany", "hrOffboardingCompany"].forEach((id) => {
    byId(id).addEventListener("change", clearFieldInvalid);
  });
  byId("hrStartDate").addEventListener("change", clearFieldInvalid);
  byId("hrOffboardingDate").addEventListener("change", clearFieldInvalid);

  loadCompanies().catch((error) => {
    byId("hrOnboardingStatus").textContent = `Failed to load companies: ${error.message}`;
    byId("hrOffboardingStatus").textContent = `Failed to load companies: ${error.message}`;
  });

  loadTeamsDefaults().catch((error) => {
    console.warn(`Failed to load Teams defaults: ${error.message}`);
  });

  checkAuthStatus().then((session) => {
    if (session?.authenticated && session.user?.email) {
      byId("hrUserEmail").textContent = session.user.email;
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
