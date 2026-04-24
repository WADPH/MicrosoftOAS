const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { findCompanyMatcherByHints } = require("../parser");

const DB_PATH = path.join(__dirname, "..", "db", "tasks.json");
const NOT_SPECIFIED = "not specified";
const DEFAULT_COMPANY_DOMAIN = "ei-g.com";
const DOMAIN_OPTIONS = ["eilink.az", "researchlab.digital", "ei-g.com"];
const COMPANY_CODE_OPTIONS = ["EILINK", "DRL", "EIG"];
const DEFAULT_COMPANY_CODE = "EIG";
const TASK_TYPE_ONBOARDING = "onboarding";
const TASK_TYPE_OFFBOARDING = "offboarding";

function parseRecipients(rawValue) {
  if (!rawValue) return [];
  return String(rawValue)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function getDefaultRecipients(prefix) {
  return {
    to: parseRecipients(process.env[`${prefix}_TO`]),
    cc: parseRecipients(process.env[`${prefix}_CC`])
  };
}

function normalizeString(value, fallback = NOT_SPECIFIED) {
  const clean = String(value || "").trim();
  return clean || fallback;
}

function normalizeDomain(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (!clean) return DEFAULT_COMPANY_DOMAIN;
  return clean;
}

function normalizeCompanyCode(value) {
  const clean = String(value || "").trim().toUpperCase();
  if (!clean) return DEFAULT_COMPANY_CODE;
  return clean;
}

function normalizeRecipientsGroup(value, fallback) {
  const to = Array.isArray(value?.to) ? value.to : fallback.to;
  const cc = Array.isArray(value?.cc) ? value.cc : fallback.cc;

  return {
    to: to.map((x) => String(x || "").trim()).filter(Boolean),
    cc: cc.map((x) => String(x || "").trim()).filter(Boolean)
  };
}

function buildDefaultMails(taskLike) {
  const company = normalizeString(taskLike.company);
  const fullName = normalizeString(taskLike.fullName);
  const selectedAssets = Object.entries(taskLike.assets || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name);
  const assetSentence =
    selectedAssets.length === 0
      ? "no assets selected"
      : selectedAssets.length === 1
        ? selectedAssets[0]
        : selectedAssets.length === 2
          ? `${selectedAssets[0]} and ${selectedAssets[1]}`
          : `${selectedAssets.slice(0, -1).join(", ")} and ${selectedAssets[selectedAssets.length - 1]}`;

  return {
    licenseMail: {
      ...getDefaultRecipients("LICENSE_REQUEST"),
      subject: "License request for new employee",
      body: `Hello,\nWe need 1 Microsoft Business Premium licence with monthly payment on ${company} balance.`
    },
    assetsMail: {
      ...getDefaultRecipients("ASSETS_REQUEST"),
      subject: `Assets request: ${fullName}`,
      body: `Hello,\nWe need ${assetSentence} for our new employee ${fullName}. From ${company} balance.`
    }
  };
}

function normalizeOffboardingPayload(value = {}) {
  const user = value?.user || {};
  return {
    tenant: String(value.tenant || "").trim().toUpperCase(),
    email: String(value.email || user.userPrincipalName || user.mail || "").trim().toLowerCase(),
    deleteUser: value.deleteUser !== false,
    sendLicenseCancelEmail: value.sendLicenseCancelEmail !== false,
    licenseCancelMail: {
      to: Array.isArray(value.licenseCancelMail?.to)
        ? value.licenseCancelMail.to.map((x) => String(x || "").trim()).filter(Boolean)
        : [],
      cc: Array.isArray(value.licenseCancelMail?.cc)
        ? value.licenseCancelMail.cc.map((x) => String(x || "").trim()).filter(Boolean)
        : [],
      subject: String(value.licenseCancelMail?.subject || "").trim(),
      body: String(value.licenseCancelMail?.body || "")
    },
    user: {
      id: String(user.id || "").trim(),
      tenant: String(user.tenant || value.tenant || "").trim().toUpperCase(),
      displayName: String(user.displayName || "").trim(),
      mail: String(user.mail || "").trim(),
      userPrincipalName: String(user.userPrincipalName || "").trim(),
      userType: String(user.userType || "").trim()
    },
    accountsToDelete: Array.isArray(value.accountsToDelete)
      ? value.accountsToDelete
          .map((row) => ({
            id: String(row?.id || "").trim(),
            tenant: String(row?.tenant || "").trim().toUpperCase(),
            displayName: String(row?.displayName || "").trim(),
            mail: String(row?.mail || "").trim(),
            userPrincipalName: String(row?.userPrincipalName || "").trim(),
            userType: String(row?.userType || "").trim()
          }))
          .filter((row) => row.id || row.userPrincipalName || row.mail)
      : [],
    assetsToCheckin: Array.isArray(value.assetsToCheckin)
      ? value.assetsToCheckin
          .map((row) => ({
            id: Number(row?.id || row),
            asset_tag: String(row?.asset_tag || row?.assetTag || "").trim(),
            model: String(row?.model || "").trim(),
            notes: String(row?.notes || "").trim(),
            companyName: String(row?.companyName || "").trim()
          }))
          .filter((row) => Number.isFinite(row.id))
      : []
  };
}

function normalizeTask(task = {}) {
  const taskType = String(task.taskType || TASK_TYPE_ONBOARDING).toLowerCase() === TASK_TYPE_OFFBOARDING
    ? TASK_TYPE_OFFBOARDING
    : TASK_TYPE_ONBOARDING;

  const assets = {
    laptop: Boolean(task.assets?.laptop),
    keyboard: Boolean(task.assets?.keyboard),
    mouse: Boolean(task.assets?.mouse),
    headphones: Boolean(task.assets?.headphones),
    monitor: Boolean(task.assets?.monitor)
  };
  const base = {
    id: task.id || crypto.randomUUID(),
    taskType,
    status: task.status || "pending",
    fullName: normalizeString(task.fullName),
    firstName: normalizeString(task.firstName),
    lastName: normalizeString(task.lastName),
    company: normalizeString(task.company),
    companyCode: normalizeCompanyCode(task.companyCode),
    companyDomain: normalizeDomain(task.companyDomain),
    position: normalizeString(task.position),
    phone: normalizeString(task.phone),
    manager: normalizeString(task.manager),
    startDate: normalizeString(task.startDate),
    email: normalizeString(task.email),
    licenseRequired: task.licenseRequired !== false,
    assets,
    snipeitAssets: Array.isArray(task.snipeitAssets)
      ? task.snipeitAssets
          .map((asset) => ({
            id: Number(asset?.id),
            asset_tag: String(asset?.asset_tag || "").trim(),
            model: String(asset?.model || "").trim(),
            notes: String(asset?.notes || "").trim(),
            companyName: String(asset?.companyName || "").trim(),
            type: String(asset?.type || "").trim().toLowerCase()
          }))
          .filter((asset) => Number.isFinite(asset.id) && asset.asset_tag)
      : [],
    entraGroups: Array.isArray(task.entraGroups)
      ? task.entraGroups
          .map((group) => ({
            id: String(group?.id || group || "").trim(),
            displayName: String(group?.displayName || "").trim(),
            tenant: String(group?.tenant || "").trim().toUpperCase()
          }))
          .filter((group) => group.id)
      : [],
    offboarding: normalizeOffboardingPayload(task.offboarding),
    createdAt: task.createdAt || new Date().toISOString()
  };

  const defaults = buildDefaultMails(base);
  return {
    ...base,
    licenseMail: {
      ...defaults.licenseMail,
      ...task.licenseMail,
      ...normalizeRecipientsGroup(task.licenseMail, defaults.licenseMail)
    },
    assetsMail: {
      ...defaults.assetsMail,
      ...task.assetsMail,
      ...normalizeRecipientsGroup(task.assetsMail, defaults.assetsMail)
    }
  };
}

function ensureDbFile() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, "[]", "utf8");
  }
}

function readTasks() {
  ensureDbFile();
  const raw = fs.readFileSync(DB_PATH, "utf8");
  if (!raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((task) => normalizeTask(task)) : [];
  } catch (error) {
    console.error("[taskStore] Failed to parse tasks.json", error.message);
    return [];
  }
}

function writeTasks(tasks) {
  ensureDbFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(tasks, null, 2), "utf8");
}

function getAllTasks() {
  return readTasks();
}

function getTasksByType(taskType = TASK_TYPE_ONBOARDING) {
  const type = String(taskType || TASK_TYPE_ONBOARDING).toLowerCase() === TASK_TYPE_OFFBOARDING
    ? TASK_TYPE_OFFBOARDING
    : TASK_TYPE_ONBOARDING;
  return readTasks().filter((task) => String(task.taskType || TASK_TYPE_ONBOARDING) === type);
}

function getTaskById(id) {
  return readTasks().find((task) => task.id === id) || null;
}

function isDuplicateTask(tasks, fullName, startDate) {
  const nameKey = String(fullName || "").trim().toLowerCase();
  const dateKey = String(startDate || "").trim().toLowerCase();

  return tasks.some((task) => {
    return String(task.fullName || "").trim().toLowerCase() === nameKey && String(task.startDate || "").trim().toLowerCase() === dateKey;
  });
}

function addTask(parsedData, options = {}) {
  const taskType = String(parsedData?.taskType || TASK_TYPE_ONBOARDING).toLowerCase() === TASK_TYPE_OFFBOARDING
    ? TASK_TYPE_OFFBOARDING
    : TASK_TYPE_ONBOARDING;
  const providedGroups = Array.isArray(parsedData?.entraGroups)
    ? parsedData.entraGroups
        .map((group) => ({
          id: String(group?.id || group || "").trim(),
          displayName: String(group?.displayName || "").trim(),
          tenant: String(group?.tenant || "").trim().toUpperCase()
        }))
        .filter((group) => group.id)
    : [];
  let initialGroups = providedGroups;
  if (taskType === TASK_TYPE_ONBOARDING && providedGroups.length === 0) {
    const matcher = findCompanyMatcherByHints({
      companyCode: parsedData?.companyCode,
      companyDomain: parsedData?.companyDomain,
      email: parsedData?.email
    });
    const matcherGroups = Array.isArray(matcher?.groups) ? matcher.groups : [];
    const matcherTenant = String(matcher?.tenant || "").trim().toUpperCase();
    initialGroups = matcherGroups
      .map((groupId) => ({
        id: String(groupId || "").trim(),
        displayName: "",
        tenant: matcherTenant
      }))
      .filter((group) => group.id);
  }

  const tasks = readTasks();
  const normalizedTask = normalizeTask({
    ...parsedData,
    taskType,
    entraGroups: initialGroups,
    assets: parsedData.assets || {
      laptop: false,
      keyboard: false,
      mouse: false,
      headphones: false,
      monitor: false
    }
  });
  const skipDuplicate = options.skipDuplicate === true;
  const isOnboarding = normalizedTask.taskType === TASK_TYPE_ONBOARDING;
  if (!skipDuplicate && isOnboarding && isDuplicateTask(tasks, normalizedTask.fullName, normalizedTask.startDate)) {
    return { task: null, duplicate: true };
  }
  tasks.unshift(normalizedTask);
  writeTasks(tasks);

  return { task: normalizedTask, duplicate: false };
}

function updateTaskById(id, updates) {
  const tasks = readTasks();
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return null;

  const current = tasks[index];

  const nextAssets = updates.assets
    ? {
        ...current.assets,
        ...updates.assets
      }
    : current.assets;

  const updated = normalizeTask({
    ...current,
    ...updates,
    assets: nextAssets,
    offboarding: updates.offboarding ? { ...(current.offboarding || {}), ...updates.offboarding } : current.offboarding,
    id: current.id,
    createdAt: current.createdAt
  });

  tasks[index] = updated;
  writeTasks(tasks);
  return updated;
}

function deleteTaskById(id) {
  const tasks = readTasks();
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return null;

  const [removed] = tasks.splice(index, 1);
  writeTasks(tasks);
  return removed;
}

module.exports = {
  getAllTasks,
  getTasksByType,
  getTaskById,
  addTask,
  updateTaskById,
  deleteTaskById,
  normalizeTask,
  NOT_SPECIFIED,
  DOMAIN_OPTIONS,
  COMPANY_CODE_OPTIONS,
  TASK_TYPE_ONBOARDING,
  TASK_TYPE_OFFBOARDING
};
