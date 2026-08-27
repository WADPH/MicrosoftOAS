const express = require("express");
const path = require("path");
const { buildCompanyMatchers, normalizeNamePart } = require("../parser");
const { listUsers } = require("../services/graph");
const { addTask } = require("../services/taskStore");
const { buildOffboardingTaskPayload } = require("../services/offboardingPayload");

const router = express.Router();

function findMatcherByKey(key) {
  const normalized = String(key || "").trim().toUpperCase();
  if (!normalized) return null;
  return buildCompanyMatchers().find((matcher) => matcher.key === normalized) || null;
}

function buildOnboardingEmail(firstName, lastName, domain) {
  const first = normalizeNamePart(firstName);
  const last = normalizeNamePart(lastName);
  const local = [first, last].filter(Boolean).join(".") || first || "new.user";
  return `${local}@${domain}`;
}

router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "hr.html"));
});

router.get("/companies", (req, res) => {
  const companies = buildCompanyMatchers().map((matcher) => ({
    key: matcher.key,
    code: matcher.code,
    domain: matcher.domain,
    tenant: matcher.tenant
  }));
  res.json({ ok: true, companies });
});

router.get("/users", async (req, res) => {
  try {
    const tenant = String(req.query.tenant || "").trim();
    const search = String(req.query.search || "").trim();
    if (!tenant) {
      return res.status(400).json({ ok: false, error: "tenant is required" });
    }
    const users = await listUsers(search, 50, tenant, { excludeGuests: true, excludeDisabled: true });
    res.json({
      ok: true,
      users: users.map((user) => ({
        displayName: String(user.displayName || "").trim(),
        mail: String(user.mail || "").trim(),
        userPrincipalName: String(user.userPrincipalName || "").trim()
      }))
    });
  } catch (error) {
    console.error("[hr] users search failed", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post("/onboarding", (req, res) => {
  const body = req.body || {};
  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const companyKey = String(body.companyKey || "").trim();
  const position = String(body.position || "").trim();
  const phone = String(body.phone || "").trim();
  const manager = String(body.manager || "").trim();
  const startDate = String(body.startDate || "").trim();

  if (!firstName || !lastName || !companyKey || !position || !phone || !manager || !startDate) {
    return res.status(400).json({ ok: false, error: "All fields are required" });
  }

  const matcher = findMatcherByKey(companyKey);
  if (!matcher || !matcher.code || !matcher.domain) {
    return res.status(400).json({ ok: false, error: "Unknown company" });
  }

  const fullName = `${firstName} ${lastName}`.trim();
  const email = buildOnboardingEmail(firstName, lastName, matcher.domain);

  const result = addTask({
    taskType: "onboarding",
    status: "pending",
    fullName,
    firstName,
    lastName,
    company: matcher.code,
    companyCode: matcher.code,
    companyDomain: matcher.domain,
    position,
    phone,
    manager,
    startDate,
    email,
    skipLicense: false,
    licenseRequired: true,
    assets: {
      laptop: false,
      keyboard: false,
      mouse: false,
      headphones: false,
      monitor: false
    }
  });

  if (result.duplicate) {
    return res.status(409).json({ ok: false, error: "A task for this employee and date already exists" });
  }

  res.status(201).json({ ok: true, task: result.task });
});

router.post("/offboarding", (req, res) => {
  const body = req.body || {};
  const companyKey = String(body.companyKey || "").trim();
  const user = body.user || {};
  const startDate = String(body.startDate || "").trim();

  if (!companyKey || !startDate) {
    return res.status(400).json({ ok: false, error: "Company and date are required" });
  }

  const userEmail = String(user.mail || user.userPrincipalName || "").trim();
  if (!userEmail) {
    return res.status(400).json({ ok: false, error: "Employee is required" });
  }

  const matcher = findMatcherByKey(companyKey);
  if (!matcher || !matcher.tenant) {
    return res.status(400).json({ ok: false, error: "Unknown company" });
  }

  const offboarding = buildOffboardingTaskPayload({
    tenant: matcher.tenant,
    company: matcher.code,
    email: userEmail,
    user
  });

  const result = addTask(
    {
      taskType: "offboarding",
      status: "pending",
      fullName: String(user.displayName || offboarding.email || ""),
      company: offboarding.company || "",
      email: offboarding.email,
      startDate,
      offboarding
    },
    { skipDuplicate: true }
  );

  res.status(201).json({ ok: true, task: result.task });
});

module.exports = router;
