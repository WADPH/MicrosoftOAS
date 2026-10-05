const {
  listLookupJobs,
  getLookupJobById,
  getPendingJobByTaskId,
  addLookupJob,
  updateLookupJobById
} = require("./objectIdLookupStore");
const { getTaskById, updateTaskById } = require("./taskStore");
const { findUserInTenantByEmail } = require("./graph");
const { isEnabled: isPtoEnabled } = require("./pto.service");

const RETRY_MINUTES = 5;
const CHECK_INTERVAL_MS = RETRY_MINUTES * 60 * 1000;
let running = false;

function getNextAttemptAt() {
  return new Date(Date.now() + CHECK_INTERVAL_MS).toISOString();
}

function isDue(job) {
  if (!job || job.status !== "pending") return false;
  const when = Date.parse(job.nextAttemptAt || 0);
  return Number.isNaN(when) || when <= Date.now();
}

// Successes go to the task's Logs; misses only to the job history so retries don't flood the Logs.
function appendTaskLog(task, type, message) {
  const logs = Array.isArray(task.executionLogs) ? task.executionLogs : [];
  updateTaskById(task.id, { executionLogs: [...logs, { type, message, timestamp: new Date().toISOString() }] });
}

function queueObjectIdLookup({ taskId, email, tenant, reason }) {
  const existing = getPendingJobByTaskId(taskId);
  if (existing) {
    return updateLookupJobById(
      existing.id,
      { email, tenant, nextAttemptAt: getNextAttemptAt() },
      { result: "queued", message: reason }
    );
  }
  return addLookupJob({ taskId, email, tenant, nextAttemptAt: getNextAttemptAt(), note: reason });
}

function completePendingLookupForTask(taskId, objectId) {
  const existing = getPendingJobByTaskId(taskId);
  if (!existing) return null;
  return updateLookupJobById(
    existing.id,
    { status: "completed", objectId, completedAt: new Date().toISOString(), error: "" },
    { result: "found", message: `Object ID found during approve: ${objectId}` }
  );
}

async function processOneJob(job, { force = false } = {}) {
  const current = getLookupJobById(job.id);
  if (!current || current.status !== "pending") return { skipped: true, reason: "not_pending" };
  if (!force && !isDue(current)) return { skipped: true, reason: "not_due" };

  const attempts = current.attempts + 1;
  const now = new Date().toISOString();
  const task = getTaskById(current.taskId);
  if (!task) {
    updateLookupJobById(
      current.id,
      { status: "failed", attempts, lastAttemptAt: now, error: "Onboarding task no longer exists" },
      { result: "failed", message: "Onboarding task no longer exists" }
    );
    return { ok: false, reason: "task_missing" };
  }

  const user = await findUserInTenantByEmail(current.email, current.tenant);
  const objectId = String(user?.id || "").trim().toLowerCase();
  if (!objectId) {
    const message = `User not found in PTO tenant ${current.tenant} yet`;
    updateLookupJobById(
      current.id,
      { attempts, lastAttemptAt: now, nextAttemptAt: getNextAttemptAt(), error: message },
      { result: "not_found", message: `Attempt ${attempts}: ${message}` }
    );
    return { ok: false, reason: "not_found" };
  }

  updateTaskById(task.id, { entraObjectId: objectId });
  const message = `[object-id] Object ID saved for ${current.email} (PTO tenant ${current.tenant}): ${objectId}`;
  appendTaskLog(getTaskById(task.id) || task, "success", message);
  console.log(message);
  updateLookupJobById(
    current.id,
    { status: "completed", objectId, attempts, lastAttemptAt: now, completedAt: now, error: "" },
    { result: "found", message: `Attempt ${attempts}: Object ID ${objectId}` }
  );
  return { ok: true, objectId };
}

async function processPendingLookups(options = {}) {
  if (!isPtoEnabled()) {
    return { ok: true, skipped: true, reason: "disabled" };
  }
  if (running && !options.force) {
    return { ok: true, skipped: true, reason: "already_running" };
  }

  running = true;
  try {
    const pending = listLookupJobs().filter((job) => job.status === "pending");
    const targets = options.jobId
      ? pending.filter((job) => job.id === options.jobId)
      : pending.filter((job) => options.force || isDue(job));

    const results = [];
    for (const job of targets) {
      try {
        results.push({ id: job.id, ...(await processOneJob(job, { force: Boolean(options.force) })) });
      } catch (error) {
        const message = String(error.message || "unknown error");
        updateLookupJobById(
          job.id,
          {
            attempts: job.attempts + 1,
            lastAttemptAt: new Date().toISOString(),
            nextAttemptAt: getNextAttemptAt(),
            error: message
          },
          { result: "error", message: `Attempt ${job.attempts + 1}: ${message}` }
        );
        results.push({ id: job.id, ok: false, error: message });
      }
    }
    return { ok: true, processed: results.length, results };
  } finally {
    running = false;
  }
}

function startObjectIdLookupWorker() {
  setInterval(() => {
    processPendingLookups().catch((error) => {
      console.error("[object-id-worker] periodic run failed", error.message);
    });
  }, CHECK_INTERVAL_MS);
}

module.exports = {
  CHECK_INTERVAL_MS,
  queueObjectIdLookup,
  completePendingLookupForTask,
  processPendingLookups,
  startObjectIdLookupWorker
};
