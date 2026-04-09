const {
  listAssignTasks,
  updateAssignTaskById,
  getAssignTaskById
} = require("./snipeitAssignStore");
const {
  isEnabled,
  getUserByEmail,
  assignAsset,
  getAssetByTag
} = require("./snipeit.service");

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
let running = false;

function nowIso() {
  return new Date().toISOString();
}

function isDue(task) {
  if (!task || task.status !== "pending") return false;
  const when = Date.parse(task.nextAttemptAt || 0);
  if (Number.isNaN(when)) return true;
  return when <= Date.now();
}

function getNextAttemptAt(minutes = 15) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function processOneTask(task, { force = false } = {}) {
  const current = getAssignTaskById(task.id);
  if (!current || current.status !== "pending") return { skipped: true, reason: "not_pending" };
  if (!force && !isDue(current)) return { skipped: true, reason: "not_due" };

  const user = await getUserByEmail(current.email);
  if (!user || !user.id) {
    updateAssignTaskById(current.id, {
      lastAttemptAt: nowIso(),
      nextAttemptAt: getNextAttemptAt(15),
      attempts: Number(current.attempts || 0) + 1,
      error: "Snipe-IT user not found yet"
    });
    return { skipped: true, reason: "user_not_found" };
  }

  for (const asset of current.assets || []) {
    let assetId = Number(asset.id);

    if (!Number.isFinite(assetId) && asset.asset_tag) {
      const found = await getAssetByTag(asset.asset_tag);
      assetId = Number(found?.id);
    }

    if (!Number.isFinite(assetId)) {
      throw new Error(`Asset ID missing for ${asset.asset_tag || "unknown"}`);
    }

    await assignAsset(assetId, Number(user.id));
  }

  updateAssignTaskById(current.id, {
    status: "completed",
    completedAt: nowIso(),
    lastAttemptAt: nowIso(),
    attempts: Number(current.attempts || 0) + 1,
    error: ""
  });

  return { ok: true };
}

async function processPendingAssignTasks(options = {}) {
  if (!isEnabled()) {
    return { ok: true, skipped: true, reason: "disabled" };
  }

  if (running && !options.force) {
    return { ok: true, skipped: true, reason: "already_running" };
  }

  running = true;
  try {
    const tasks = listAssignTasks().filter((task) => task.status === "pending");
    const target = options.taskId
      ? tasks.filter((task) => task.id === options.taskId)
      : tasks.filter((task) => options.force ? true : isDue(task));

    const results = [];
    for (const task of target) {
      try {
        const result = await processOneTask(task, { force: Boolean(options.force) });
        results.push({ id: task.id, ...result });
      } catch (error) {
        updateAssignTaskById(task.id, {
          lastAttemptAt: nowIso(),
          nextAttemptAt: getNextAttemptAt(15),
          attempts: Number(task.attempts || 0) + 1,
          error: String(error.message || "unknown error")
        });
        results.push({ id: task.id, ok: false, error: String(error.message || "unknown error") });
      }
    }

    return { ok: true, processed: results.length, results };
  } finally {
    running = false;
  }
}

function startSnipeitAssignWorker() {
  setInterval(() => {
    processPendingAssignTasks().catch((error) => {
      console.error("[snipeit-worker] periodic run failed", error.message);
    });
  }, CHECK_INTERVAL_MS);
}

module.exports = {
  CHECK_INTERVAL_MS,
  processPendingAssignTasks,
  startSnipeitAssignWorker
};