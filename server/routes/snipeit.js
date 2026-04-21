const express = require("express");
const { getSnipeitConfig, getAssetsByPrefix, isEnabled } = require("../services/snipeit.service");
const {
  listAssignTasks,
  removeAssignTaskById,
  getAssignTaskById
} = require("../services/snipeitAssignStore");
const { processPendingAssignTasks, CHECK_INTERVAL_MS } = require("../services/snipeitAssignWorker");

const router = express.Router();

router.get("/config", (req, res) => {
  return res.json({
    ok: true,
    ...getSnipeitConfig(),
    checkIntervalMs: CHECK_INTERVAL_MS
  });
});

router.get("/assets", async (req, res) => {
  try {
    if (!isEnabled()) {
      return res.json({ ok: true, enabled: false, assets: [] });
    }

    const prefix = String(req.query.prefix || "").trim();
    if (!prefix) {
      return res.status(400).json({ ok: false, error: "prefix is required" });
    }

    const assets = await getAssetsByPrefix(prefix, 500);
    return res.json({ ok: true, enabled: true, assets });
  } catch (error) {
    const status = Number(error.status || 500);
    return res.status(status).json({ ok: false, error: error.message || "Failed to fetch assets" });
  }
});

router.get("/assign-tasks", (req, res) => {
  const status = String(req.query.status || "pending").trim().toLowerCase();
  const allTasks = listAssignTasks();
  let tasks = allTasks;

  if (status !== "all") {
    tasks = allTasks.filter((task) => String(task.status || "").toLowerCase() === status);
  }

  return res.json({ ok: true, tasks, checkIntervalMs: CHECK_INTERVAL_MS });
});

router.post("/assign-tasks/:id/force", async (req, res) => {
  const task = getAssignTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({ ok: false, error: "Task not found" });
  }

  try {
    const result = await processPendingAssignTasks({ taskId: task.id, force: true });
    return res.json({ ok: true, result, task: getAssignTaskById(task.id) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Force assign failed" });
  }
});

router.delete("/assign-tasks/:id", (req, res) => {
  const removed = removeAssignTaskById(req.params.id);
  if (!removed) {
    return res.status(404).json({ ok: false, error: "Task not found" });
  }
  return res.json({ ok: true, removed });
});

module.exports = router;
