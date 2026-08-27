const state = {
  companies: [],
  companiesByKey: new Map(),
  pickerTarget: null, // "manager" | "employee"
  pickerTenant: "",
  pickerRequestId: 0,
  pickerLoading: false,
  pickerUsers: [],
  pickerDebounceTimer: null,
  selectedManager: null,
  selectedEmployee: null
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (response.status === 401 || response.status === 403) {
    window.location.href = "/";
    throw new Error("Not authorized");
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
  populateCompanySelect(byId("hrOnboardingCompany"));
  populateCompanySelect(byId("hrOffboardingCompany"));
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

function openUserModal(target) {
  const companyKey = target === "manager" ? byId("hrOnboardingCompany").value : byId("hrOffboardingCompany").value;
  const company = state.companiesByKey.get(companyKey);
  if (!company) return;

  state.pickerTarget = target;
  state.pickerTenant = company.tenant;
  byId("hrUserModalTitle").textContent = target === "manager" ? "Choose Line Manager" : "Choose Employee";
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
    const data = await api(`/hr/users?tenant=${encodeURIComponent(state.pickerTenant)}&search=${encodeURIComponent(search || "")}`);
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
    byId("hrManager").value = user.displayName || user.mail || "";
  } else if (state.pickerTarget === "employee") {
    state.selectedEmployee = user;
    const box = byId("hrOffboardingEmployee");
    box.textContent = `${user.displayName || "Unnamed user"}${user.mail ? ` · ${user.mail}` : ""}`;
    box.classList.remove("managerEmpty");
  }
  closeUserModal();
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
    firstName: byId("hrFirstName").value.trim(),
    lastName: byId("hrLastName").value.trim(),
    companyKey: byId("hrOnboardingCompany").value,
    position: byId("hrPosition").value.trim(),
    phone: byId("hrPhone").value.trim(),
    manager: byId("hrManager").value.trim(),
    startDate: byId("hrStartDate").value
  };

  if (!payload.firstName || !payload.lastName || !payload.companyKey || !payload.position || !payload.phone || !payload.manager || !payload.startDate) {
    statusEl.textContent = "Please fill in all required fields.";
    return;
  }

  const submitBtn = byId("hrOnboardingSubmitBtn");
  submitBtn.disabled = true;
  try {
    await api("/hr/onboarding", { method: "POST", body: JSON.stringify(payload) });
    statusEl.textContent = "Onboarding task created.";
    byId("hrFirstName").value = "";
    byId("hrLastName").value = "";
    byId("hrOnboardingCompany").value = "";
    byId("hrPosition").value = "";
    byId("hrPhone").value = "";
    byId("hrStartDate").value = "";
    byId("hrChooseManagerBtn").disabled = true;
    resetManagerSelection();
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

  if (!companyKey || !state.selectedEmployee || !startDate) {
    statusEl.textContent = "Please fill in all required fields.";
    return;
  }

  const payload = {
    companyKey,
    user: state.selectedEmployee,
    startDate
  };

  const submitBtn = byId("hrOffboardingSubmitBtn");
  submitBtn.disabled = true;
  try {
    await api("/hr/offboarding", { method: "POST", body: JSON.stringify(payload) });
    statusEl.textContent = "Offboarding task created.";
    byId("hrOffboardingCompany").value = "";
    byId("hrOffboardingDate").value = "";
    byId("hrChooseEmployeeBtn").disabled = true;
    resetEmployeeSelection();
  } catch (error) {
    statusEl.textContent = `Failed to create task: ${error.message}`;
  } finally {
    submitBtn.disabled = false;
  }
}

function init() {
  initTheme();

  byId("hrProgressBtn").addEventListener("click", () => {
    window.location.href = "/progress";
  });
  byId("hrLogoutBtn").addEventListener("click", () => {
    window.location.href = "/auth/logout";
  });

  byId("hrOnboardingCompany").addEventListener("change", onOnboardingCompanyChange);
  byId("hrOffboardingCompany").addEventListener("change", onOffboardingCompanyChange);

  byId("hrChooseManagerBtn").addEventListener("click", () => openUserModal("manager"));
  byId("hrChooseEmployeeBtn").addEventListener("click", () => openUserModal("employee"));
  byId("hrUserModalClose").addEventListener("click", closeUserModal);
  byId("hrUserModalOverlay").addEventListener("click", closeUserModal);
  byId("hrUserSearch").addEventListener("input", (event) => debouncedSearch(event.target.value));

  byId("hrOnboardingSubmitBtn").addEventListener("click", submitOnboarding);
  byId("hrOffboardingSubmitBtn").addEventListener("click", submitOffboarding);

  loadCompanies().catch((error) => {
    byId("hrOnboardingStatus").textContent = `Failed to load companies: ${error.message}`;
    byId("hrOffboardingStatus").textContent = `Failed to load companies: ${error.message}`;
  });
}

document.addEventListener("DOMContentLoaded", init);
