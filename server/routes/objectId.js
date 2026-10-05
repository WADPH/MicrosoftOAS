const express = require("express");
const { listLookupJobs, getLookupJobById, removeLookupJobById } = require("../services/objectIdLookupStore");
const { processPendingLookups, CHECK_INTERVAL_MS } = require("../services/objectIdLookupWorker");

const router = express.Router();

router.get("/jobs", (req, res) => {
  const status = String(req.query.status || "pending").trim().toLowerCase();
  const taskId = String(req.query.taskId || "").trim();
  const jobs = listLookupJobs()
    .filter((job) => status === "all" || job.status === status)
    .filter((job) => !taskId || job.taskId === taskId);
  return res.json({ ok: true, jobs, checkIntervalMs: CHECK_INTERVAL_MS });
});

router.post("/jobs/:id/force", async (req, res) => {
  const job = getLookupJobById(req.params.id);
  if (!job) {
    return res.status(404).json({ ok: false, error: "Job not found" });
  }
  try {
    const result = await processPendingLookups({ jobId: job.id, force: true });
    return res.json({ ok: true, result, job: getLookupJobById(job.id) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Force lookup failed" });
  }
});

router.delete("/jobs/:id", (req, res) => {
  const removed = removeLookupJobById(req.params.id);
  if (!removed) {
    return res.status(404).json({ ok: false, error: "Job not found" });
  }
  return res.json({ ok: true, removed });
});

module.exports = router;
