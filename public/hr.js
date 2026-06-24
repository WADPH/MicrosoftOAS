const state = {
  user: null,
  currentTab: "onboarding",
  currentForm: null,
  companyCodes: [],
  companyMatchers: [],
  tasks: {
    onboarding: [],
    offboarding: []
  },
  selectedManager: null,
  selectedEmployee: null
};

function byId(id) {
  return document.getElementById(id);
}

function esc(value) {
  return String(value || "").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function setStatus(message) {
  const box = byId("hrStatus");
  if (box) box.textContent = String(message || "");
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
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (response.status === 401 || response.status === 403) {
    window.location.href = "/";
    throw new Error("Unauthorized");
  }
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(typeof data === "string" ? data : data.error || `HTTP ${response.status}`);
  }
  return data;
}

function companyMatcher(company) {
  const code = String(company || "").trim().toUpperCase();
  return (Array.isArray(state.companyMatchers) ? state.companyMatchers : []).find((row) => String(row.code || "").trim().toUpperCase() === code) || null;
}

function renderCompanyOptions(selectId) {
  const select = byId(selectId);
  if (!select) return;
  select.innerHTML = "";
  for (const code of state.companyCodes) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = code;
    select.appendChild(option);
  }
}

function statusClass(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "done") return "done";
  if (value === "error") return "error";
  if (value === "processing") return "processing";
  if (value === "provisioned") return "provisioned";
  if (value === "unlicensed") return "unlicensed";
  return "pending";
}

function renderTaskList() {
  const list = byId("hrTaskList");
  if (!list) return;
  const rows = state.tasks[state.currentTab] || [];
  list.innerHTML = "";
  if (rows.length === 0) {
    list.innerHTML = `<li class="readOnlyTaskItem"><div class="managerEmpty">No ${esc(state.currentTab)} tasks yet.</div></li>`;
    return;
  }

  for (const task of rows) {
    const li = document.createElement("li");
    li.className = "readOnlyTaskItem";
    const meta = state.currentTab === "onboarding"
      ? (task.startDate || "not specified")
      : (task.email || task.offboarding?.email || task.startDate || "not specified");
    li.innerHTML = `
      <div class="taskRow">
        <div class="taskMain">
          <div class="taskName">${esc(task.fullName || "not specified")}</div>
          <div class="taskMeta">${esc(meta)}</div>
        </div>
        <div class="statusPill ${statusClass(task.status)}">${esc(task.status || "pending")}</div>
      </div>
    `;
    list.appendChild(li);
  }
}

function renderTabs() {
  byId("hrTabOnboardingBtn")?.classList.toggle("active", state.currentTab === "onboarding");
  byId("hrTabOffboardingBtn")?.classList.toggle("active", state.currentTab === "offboarding");
  renderTaskList();
}

function resetOnboardingForm() {
  byId("hrOnboardingForm")?.reset();
  state.selectedManager = null;
  byId("hrOnboardingManager").value = "";
}

function resetOffboardingForm() {
  byId("hrOffboardingForm")?.reset();
  state.selectedEmployee = null;
  byId("hrOffboardingEmployee").value = "";
}

function setCurrentForm(name) {
  state.currentForm = name;
  byId("hrEmptyState")?.classList.toggle("hidden", Boolean(name));
  byId("hrOnboardingForm")?.classList.toggle("hidden", name !== "onboarding");
  byId("hrOffboardingForm")?.classList.toggle("hidden", name !== "offboarding");
}

async function loadTasks() {
  const [onboarding, offboarding] = await Promise.all([
    api("/hr-api/tasks?type=onboarding"),
    api("/hr-api/tasks?type=offboarding")
  ]);
  state.tasks.onboarding = Array.isArray(onboarding?.tasks) ? onboarding.tasks : [];
  state.tasks.offboarding = Array.isArray(offboarding?.tasks) ? offboarding.tasks : [];
  renderTaskList();
}

async function loadMeta() {
  const data = await api("/hr-api/meta");
  state.user = data.user || null;
  state.companyCodes = Array.isArray(data.companyCodes) ? data.companyCodes : [];
  state.companyMatchers = Array.isArray(data.companyMatchers) ? data.companyMatchers : [];
  byId("userEmail").textContent = state.user?.email || "-";
  renderCompanyOptions("hrOnboardingCompany");
  renderCompanyOptions("hrOffboardingCompany");
}

async function loadManagerList(search = "") {
  const company = String(byId("hrOnboardingCompany")?.value || "").trim();
  if (!company) {
    throw new Error("Choose company first");
  }
  const data = await api(`/hr-api/managers?company=${encodeURIComponent(company)}&search=${encodeURIComponent(search)}`);
  const list = byId("hrManagerList");
  list.innerHTML = "";
  const users = Array.isArray(data?.users) ? data.users : [];
  if (users.length === 0) {
    list.innerHTML = `<div class="managerEmpty">No users found.</div>`;
    return;
  }
  for (const user of users) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "managerItem";
    button.innerHTML = `
      <div>${esc(user.displayName || user.mail || "Unnamed user")}</div>
      <div class="subtitle">${esc(user.userPrincipalName || user.mail || "")}</div>
    `;
    button.onclick = () => {
      state.selectedManager = user;
      byId("hrOnboardingManager").value = user.mail || user.userPrincipalName || user.displayName || "";
      closeModal("hrManagerModal");
    };
    list.appendChild(button);
  }
}

async function loadEmployeeList(search = "") {
  const company = String(byId("hrOffboardingCompany")?.value || "").trim();
  if (!company) {
    throw new Error("Choose company first");
  }
  const data = await api(`/hr-api/employees?company=${encodeURIComponent(company)}&search=${encodeURIComponent(search)}`);
  const list = byId("hrEmployeeList");
  list.innerHTML = "";
  const users = Array.isArray(data?.users) ? data.users : [];
  if (users.length === 0) {
    list.innerHTML = `<div class="managerEmpty">No users found.</div>`;
    return;
  }
  for (const user of users) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "managerItem";
    button.innerHTML = `
      <div>${esc(user.displayName || user.mail || "Unnamed user")}</div>
      <div class="subtitle">${esc(user.userPrincipalName || user.mail || "")}</div>
    `;
    button.onclick = () => {
      state.selectedEmployee = user;
      byId("hrOffboardingEmployee").value = user.displayName || user.userPrincipalName || user.mail || "";
      closeModal("hrEmployeeModal");
    };
    list.appendChild(button);
  }
}

function openModal(id) {
  byId(id)?.classList.remove("hidden");
  byId(id)?.setAttribute("aria-hidden", "false");
}

function closeModal(id) {
  byId(id)?.classList.add("hidden");
  byId(id)?.setAttribute("aria-hidden", "true");
}

async function submitOnboarding() {
  const payload = {
    firstName: String(byId("hrOnboardingFirstName").value || "").trim(),
    lastName: String(byId("hrOnboardingLastName").value || "").trim(),
    position: String(byId("hrOnboardingPosition").value || "").trim(),
    phone: String(byId("hrOnboardingPhone").value || "").trim(),
    startDate: String(byId("hrOnboardingStartDate").value || "").trim(),
    company: String(byId("hrOnboardingCompany").value || "").trim(),
    manager: state.selectedManager,
    additionalNote: String(byId("hrOnboardingNote").value || "").trim()
  };
  const response = await api("/hr-api/onboarding", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  state.currentTab = "onboarding";
  renderTabs();
  await loadTasks();
  resetOnboardingForm();
  setCurrentForm(null);
  setStatus(`Onboarding task created: ${response?.task?.fullName || "task"}`);
}

async function submitOffboarding() {
  const company = String(byId("hrOffboardingCompany").value || "").trim();
  const matcher = companyMatcher(company);
  const payload = {
    company,
    startDate: String(byId("hrOffboardingDate").value || "").trim(),
    additionalNote: String(byId("hrOffboardingNote").value || "").trim(),
    tenant: String(matcher?.tenant || "").trim(),
    user: state.selectedEmployee
  };
  const response = await api("/hr-api/offboarding", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  state.currentTab = "offboarding";
  renderTabs();
  await loadTasks();
  resetOffboardingForm();
  setCurrentForm(null);
  setStatus(`Offboarding task created: ${response?.task?.fullName || "task"}`);
}

function initEvents() {
  byId("progressLinkBtn")?.addEventListener("click", () => {
    window.location.href = "/progress";
  });
  byId("logoutBtn")?.addEventListener("click", () => {
    window.location.href = "/auth/logout";
  });
  byId("hrTabOnboardingBtn")?.addEventListener("click", () => {
    state.currentTab = "onboarding";
    renderTabs();
  });
  byId("hrTabOffboardingBtn")?.addEventListener("click", () => {
    state.currentTab = "offboarding";
    renderTabs();
  });
  byId("hrRefreshBtn")?.addEventListener("click", () => {
    loadTasks().catch((error) => setStatus(`Refresh failed: ${error.message}`));
  });
  byId("newHrOnboardingBtn")?.addEventListener("click", () => {
    resetOnboardingForm();
    setCurrentForm("onboarding");
    setStatus("");
  });
  byId("newHrOffboardingBtn")?.addEventListener("click", () => {
    resetOffboardingForm();
    setCurrentForm("offboarding");
    setStatus("");
  });
  byId("hrOnboardingCancelBtn")?.addEventListener("click", () => {
    resetOnboardingForm();
    setCurrentForm(null);
  });
  byId("hrOffboardingCancelBtn")?.addEventListener("click", () => {
    resetOffboardingForm();
    setCurrentForm(null);
  });
  byId("hrChooseManagerBtn")?.addEventListener("click", async () => {
    try {
      byId("hrManagerError").textContent = "";
      byId("hrManagerSearch").value = "";
      openModal("hrManagerModal");
      await loadManagerList("");
    } catch (error) {
      byId("hrManagerError").textContent = error.message;
    }
  });
  byId("hrChooseEmployeeBtn")?.addEventListener("click", async () => {
    try {
      byId("hrEmployeeError").textContent = "";
      byId("hrEmployeeSearch").value = "";
      openModal("hrEmployeeModal");
      await loadEmployeeList("");
    } catch (error) {
      byId("hrEmployeeError").textContent = error.message;
    }
  });
  byId("hrManagerSearch")?.addEventListener("input", () => {
    loadManagerList(byId("hrManagerSearch").value.trim()).catch((error) => {
      byId("hrManagerError").textContent = error.message;
    });
  });
  byId("hrEmployeeSearch")?.addEventListener("input", () => {
    loadEmployeeList(byId("hrEmployeeSearch").value.trim()).catch((error) => {
      byId("hrEmployeeError").textContent = error.message;
    });
  });
  byId("hrManagerModalClose")?.addEventListener("click", () => closeModal("hrManagerModal"));
  byId("hrManagerModalOverlay")?.addEventListener("click", () => closeModal("hrManagerModal"));
  byId("hrEmployeeModalClose")?.addEventListener("click", () => closeModal("hrEmployeeModal"));
  byId("hrEmployeeModalOverlay")?.addEventListener("click", () => closeModal("hrEmployeeModal"));
  byId("hrOnboardingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      setStatus("Creating onboarding task...");
      await submitOnboarding();
    } catch (error) {
      setStatus(`Create failed: ${error.message}`);
    }
  });
  byId("hrOffboardingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      setStatus("Creating offboarding task...");
      await submitOffboarding();
    } catch (error) {
      setStatus(`Create failed: ${error.message}`);
    }
  });

  // Prevent manual typing on date inputs - only allow date picker
  const dateInputs = [
    byId("hrOnboardingStartDate"),
    byId("hrOffboardingDate")
  ];
  dateInputs.forEach((input) => {
    if (input) {
      input.addEventListener("keydown", (event) => {
        event.preventDefault();
      });
      input.addEventListener("keypress", (event) => {
        event.preventDefault();
      });
      input.addEventListener("keyup", (event) => {
        event.preventDefault();
      });
    }
  });
}

async function init() {
  initTheme();
  initEvents();
  await loadMeta();
  await loadTasks();
  renderTabs();
}

init().catch((error) => {
  setStatus(`Failed to load HR portal: ${error.message}`);
});
