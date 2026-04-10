const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "..", "db", "snipeit_assign.json");
const RETRY_MINUTES = 5;

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
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[snipeitAssignStore] Failed to parse snipeit_assign.json", error.message);
    return [];
  }
}

function writeTasks(tasks) {
  ensureDbFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(tasks, null, 2), "utf8");
}

function normalizeAsset(asset) {
  if (!asset) return null;
  const id = Number(asset.id);
  const assetTag = String(asset.asset_tag || asset.assetTag || "").trim();
  if (!Number.isFinite(id) || !assetTag) return null;

  return {
    id,
    asset_tag: assetTag,
    model: String(asset.model || "").trim(),
    notes: String(asset.notes || "").trim(),
    companyName: String(asset.companyName || "").trim(),
    type: String(asset.type || "").trim().toLowerCase()
  };
}

function normalizeTask(raw = {}) {
  const assets = Array.isArray(raw.assets)
    ? raw.assets.map((item) => normalizeAsset(item)).filter(Boolean)
    : [];

  const now = new Date().toISOString();
  const createdAt = String(raw.createdAt || now);
  const createdAtMs = Date.parse(createdAt);
  const safeCreatedAt = Number.isNaN(createdAtMs) ? now : new Date(createdAtMs).toISOString();
  const attempts = Math.max(0, Number(raw.attempts || 0));
  const lastAttemptAt = raw.lastAttemptAt ? String(raw.lastAttemptAt) : null;
  const nextAttemptAt = raw.nextAttemptAt
    ? String(raw.nextAttemptAt)
    : new Date((Number.isNaN(createdAtMs) ? Date.now() : createdAtMs) + RETRY_MINUTES * 60 * 1000).toISOString();

  return {
    id: String(raw.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    type: "SNIPEIT_ASSIGN",
    status: String(raw.status || "pending"),
    email: String(raw.email || "").trim().toLowerCase(),
    createdAt: safeCreatedAt,
    updatedAt: String(raw.updatedAt || safeCreatedAt),
    lastAttemptAt,
    nextAttemptAt,
    attempts,
    completedAt: raw.completedAt ? String(raw.completedAt) : null,
    error: raw.error ? String(raw.error) : "",
    taskId: raw.taskId ? String(raw.taskId) : "",
    assets
  };
}

function listAssignTasks() {
  return readTasks().map((item) => normalizeTask(item));
}

function upsertTask(task) {
  const tasks = listAssignTasks();
  const normalized = normalizeTask(task);
  const index = tasks.findIndex((row) => row.id === normalized.id);
  if (index >= 0) {
    tasks[index] = normalized;
  } else {
    tasks.unshift(normalized);
  }
  writeTasks(tasks);
  return normalized;
}

function addAssignTask({ email, assets, taskId }) {
  const normalized = normalizeTask({
    email,
    assets,
    taskId,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nextAttemptAt: new Date().toISOString(),
    attempts: 0
  });

  const tasks = listAssignTasks();
  tasks.unshift(normalized);
  writeTasks(tasks);
  return normalized;
}

function getAssignTaskById(id) {
  return listAssignTasks().find((item) => item.id === id) || null;
}

function removeAssignTaskById(id) {
  const tasks = listAssignTasks();
  const index = tasks.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const [removed] = tasks.splice(index, 1);
  writeTasks(tasks);
  return removed;
}

function updateAssignTaskById(id, patch = {}) {
  const tasks = listAssignTasks();
  const index = tasks.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const merged = {
    ...tasks[index],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  const normalized = normalizeTask(merged);
  tasks[index] = normalized;
  writeTasks(tasks);
  return normalized;
}

module.exports = {
  listAssignTasks,
  addAssignTask,
  getAssignTaskById,
  updateAssignTaskById,
  removeAssignTaskById,
  upsertTask,
  normalizeTask
};
