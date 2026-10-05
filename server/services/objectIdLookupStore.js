const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "..", "db", "objectid_pending.json");
const MAX_HISTORY = 50;

function ensureDbFile() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, "[]", "utf8");
  }
}

function readJobs() {
  ensureDbFile();
  const raw = fs.readFileSync(DB_PATH, "utf8");
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[objectIdLookupStore] Failed to parse objectid_pending.json", error.message);
    return [];
  }
}

function writeJobs(jobs) {
  ensureDbFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(jobs, null, 2), "utf8");
}

function normalizeJob(raw = {}) {
  const now = new Date().toISOString();
  const history = Array.isArray(raw.history)
    ? raw.history
        .map((entry) => ({
          at: String(entry?.at || now),
          result: String(entry?.result || "info"),
          message: String(entry?.message || "")
        }))
        .slice(-MAX_HISTORY)
    : [];

  return {
    id: String(raw.id || crypto.randomUUID()),
    type: "OBJECT_ID_LOOKUP",
    status: String(raw.status || "pending"),
    taskId: String(raw.taskId || ""),
    email: String(raw.email || "").trim().toLowerCase(),
    tenant: String(raw.tenant || "").trim().toUpperCase(),
    objectId: String(raw.objectId || "").trim().toLowerCase(),
    createdAt: String(raw.createdAt || now),
    updatedAt: String(raw.updatedAt || now),
    lastAttemptAt: raw.lastAttemptAt ? String(raw.lastAttemptAt) : null,
    nextAttemptAt: raw.nextAttemptAt ? String(raw.nextAttemptAt) : now,
    attempts: Math.max(0, Number(raw.attempts || 0)),
    completedAt: raw.completedAt ? String(raw.completedAt) : null,
    error: raw.error ? String(raw.error) : "",
    history
  };
}

function listLookupJobs() {
  return readJobs().map((job) => normalizeJob(job));
}

function getLookupJobById(id) {
  return listLookupJobs().find((job) => job.id === id) || null;
}

function getPendingJobByTaskId(taskId) {
  return listLookupJobs().find((job) => job.taskId === String(taskId) && job.status === "pending") || null;
}

function addLookupJob({ taskId, email, tenant, nextAttemptAt, note }) {
  const now = new Date().toISOString();
  const job = normalizeJob({
    taskId,
    email,
    tenant,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    nextAttemptAt,
    history: note ? [{ at: now, result: "queued", message: note }] : []
  });
  const jobs = listLookupJobs();
  jobs.unshift(job);
  writeJobs(jobs);
  return job;
}

function updateLookupJobById(id, patch = {}, historyEntry = null) {
  const jobs = listLookupJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index === -1) return null;
  const now = new Date().toISOString();
  const history = historyEntry ? [...jobs[index].history, { at: now, ...historyEntry }] : jobs[index].history;
  jobs[index] = normalizeJob({ ...jobs[index], ...patch, history, updatedAt: now });
  writeJobs(jobs);
  return jobs[index];
}

function removeLookupJobById(id) {
  const jobs = listLookupJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index === -1) return null;
  const [removed] = jobs.splice(index, 1);
  writeJobs(jobs);
  return removed;
}

module.exports = {
  listLookupJobs,
  getLookupJobById,
  getPendingJobByTaskId,
  addLookupJob,
  updateLookupJobById,
  removeLookupJobById
};
