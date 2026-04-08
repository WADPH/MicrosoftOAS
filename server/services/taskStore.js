const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "..", "db", "tasks.json");
const NOT_SPECIFIED = "not specified";
const DEFAULT_COMPANY_DOMAIN = "ei-g.com";
const DOMAIN_OPTIONS = ["eilink.az", "researchlab.digital", "ei-g.com"];
const COMPANY_CODE_OPTIONS = ["EILINK", "DRL", "EIG"];
const DEFAULT_COMPANY_CODE = "EIG";

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

function normalizeTask(task = {}) {
  const assets = {
    laptop: Boolean(task.assets?.laptop),
    keyboard: Boolean(task.assets?.keyboard),
    mouse: Boolean(task.assets?.mouse),
    headphones: Boolean(task.assets?.headphones),
    monitor: Boolean(task.assets?.monitor)
  };
  const base = {
    id: task.id || crypto.randomUUID(),
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

function addTask(parsedData) {
  const tasks = readTasks();
  const normalizedTask = normalizeTask({
    ...parsedData,
    assets: parsedData.assets || {
      laptop: false,
      keyboard: false,
      mouse: false,
      headphones: false,
      monitor: false
    }
  });
  if (isDuplicateTask(tasks, normalizedTask.fullName, normalizedTask.startDate)) {
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
  getTaskById,
  addTask,
  updateTaskById,
  deleteTaskById,
  normalizeTask,
  NOT_SPECIFIED,
  DOMAIN_OPTIONS,
  COMPANY_CODE_OPTIONS
};
