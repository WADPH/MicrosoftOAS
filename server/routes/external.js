const express = require("express");
const { getTasksByType, NOT_SPECIFIED, ONBOARDING_STATUSES } = require("../services/taskStore");
const { findCompanyMatcherByHints } = require("../parser");
const { getDefaultTenantKey } = require("../services/tenantConfig");

const router = express.Router();

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Statuses reached only after the Entra account was created by approve
const ACCOUNT_CREATED_STATUSES = new Set(["unlicensed", "provisioned", "done"]);

function valueOrNull(value) {
  const clean = String(value || "").trim();
  return clean && clean !== NOT_SPECIFIED ? clean : null;
}

// Only the fields PTO needs to pre-fill a person (CreatePersonRequestDto). Never add
// userTempPass, phone or other task internals here - this response leaves the app.
function toExternalOnboarding(task) {
  const startDate = valueOrNull(task.startDate);
  const matcher = findCompanyMatcherByHints({
    companyCode: task.companyCode,
    companyDomain: task.companyDomain,
    email: task.email
  });

  return {
    id: task.id,
    status: task.status,
    accountCreated: ACCOUNT_CREATED_STATUSES.has(task.status) || Boolean(task.microsoftUserId),
    tenant: valueOrNull(matcher?.tenant || getDefaultTenantKey()),
    fullName: valueOrNull(task.fullName),
    fullNameAzerbaijani: valueOrNull(task.fullNameAzerbaijani),
    isResident: typeof task.isResident === "boolean" ? task.isResident : null,
    email: valueOrNull(task.email),
    position: valueOrNull(task.position),
    company: valueOrNull(task.company),
    joinDate: startDate && ISO_DATE_PATTERN.test(startDate) ? startDate : null,
    leaveDate: ISO_DATE_PATTERN.test(task.leaveDate) ? task.leaveDate : null,
    microsoftPersonId: valueOrNull(task.microsoftUserId),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

// GET /api/external/onboarding-tasks[?status=done,provisioned][&updatedSince=2026-10-01T00:00:00Z]
router.get("/onboarding-tasks", (req, res) => {
  const statuses = String(req.query.status || "")
    .split(",")
    .map((status) => status.trim().toLowerCase())
    .filter(Boolean);
  const unknown = statuses.filter((status) => !ONBOARDING_STATUSES.has(status));
  if (unknown.length) {
    return res.status(400).json({ ok: false, error: `Unknown status: ${unknown.join(", ")}` });
  }

  const updatedSinceRaw = String(req.query.updatedSince || "").trim();
  const updatedSince = updatedSinceRaw ? Date.parse(updatedSinceRaw) : null;
  if (updatedSinceRaw && Number.isNaN(updatedSince)) {
    return res.status(400).json({ ok: false, error: "updatedSince must be an ISO 8601 date/time" });
  }

  const tasks = getTasksByType("onboarding")
    .filter((task) => statuses.length === 0 || statuses.includes(task.status))
    .filter((task) => updatedSince === null || Date.parse(task.updatedAt) > updatedSince)
    .map(toExternalOnboarding);

  console.log(`[external] ${req.apiClient} read ${tasks.length} onboarding task(s)`);
  res.json({ ok: true, tasks });
});

module.exports = router;
