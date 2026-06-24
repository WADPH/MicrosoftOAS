const express = require("express");
const { addTask, getTasksByType, NOT_SPECIFIED } = require("../services/taskStore");
const { listUsers } = require("../services/graph");
const { createOnboardingTicket, createOffboardingTicket } = require("../services/zammad.service");
const { getLicenseRequestRecipients } = require("../services/mail");
const { sendTeamsIncomingMessage } = require("../services/teamsNotifier");
const {
  getCompanyMatcherOptions,
  buildCompanyMatchers,
  findCompanyMatcherByHints,
  inferDomain,
  inferCompanyCode,
  generateEmail
} = require("../parser");

const router = express.Router();

function normalizeTenantKey(value) {
  return String(value || "").trim().toUpperCase();
}

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function normalizeUserRow(user = {}, tenant = "") {
  return {
    id: String(user.id || "").trim(),
    tenant: normalizeTenantKey(user.tenant || tenant),
    displayName: String(user.displayName || "").trim(),
    mail: String(user.mail || user.userPrincipalName || "").trim(),
    userPrincipalName: String(user.userPrincipalName || user.mail || "").trim(),
    givenName: String(user.givenName || "").trim(),
    surname: String(user.surname || "").trim()
  };
}

function resolveMatcherByCompany(company) {
  return findCompanyMatcherByHints({
    companyCode: inferCompanyCode(company),
    companyDomain: inferDomain(company),
    email: generateEmail("user", "placeholder", company)
  });
}

function formatHrOnboardingTicketBody(payload) {
  return [
    "HR onboarding request created from Microsoft OAS",
    "",
    `First Name: ${payload.firstName || NOT_SPECIFIED}`,
    `Last Name: ${payload.lastName || NOT_SPECIFIED}`,
    `Position: ${payload.position || NOT_SPECIFIED}`,
    `Phone: ${payload.phone || NOT_SPECIFIED}`,
    `Company: ${payload.company || NOT_SPECIFIED}`,
    `Start Date: ${payload.startDate || NOT_SPECIFIED}`,
    `Line Manager: ${payload.manager || NOT_SPECIFIED}`,
    `Additional Note: ${payload.additionalNote || "-"}`
  ].join("\n");
}

function formatHrOffboardingTicketBody(payload) {
  return [
    "HR offboarding request created from Microsoft OAS",
    "",
    `Employee: ${payload.fullName || NOT_SPECIFIED}`,
    `Company: ${payload.company || NOT_SPECIFIED}`,
    `End Date: ${payload.startDate || NOT_SPECIFIED}`,
    `Additional Note: ${payload.additionalNote || "-"}`
  ].join("\n");
}

function formatHrOnboardingTeamsMessage(payload) {
  return [
    "New employee",
    `Name: ${payload.fullName}`,
    `Position: ${payload.position || NOT_SPECIFIED}`,
    `Company: ${payload.company || NOT_SPECIFIED}`,
    `Start Date: ${payload.startDate || NOT_SPECIFIED}`,
    `Line Manager: ${payload.manager || NOT_SPECIFIED}`,
    `Additional Note: ${payload.additionalNote || "-"}`
  ].join("\n");
}

function formatHrOffboardingTeamsMessage(payload) {
  return [
    `Offboarding - ${payload.fullName || NOT_SPECIFIED}`,
    `Employee: ${payload.fullName || NOT_SPECIFIED}`,
    `Company: ${payload.company || NOT_SPECIFIED}`,
    `End Date: ${payload.startDate || NOT_SPECIFIED}`,
    `Additional Note: ${payload.additionalNote || "-"}`
  ].join("\n");
}

async function safeNotifyTeams(text) {
  try {
    await sendTeamsIncomingMessage(text);
  } catch (error) {
    console.error(`[hr] Teams notification failed: ${error.message}`);
  }
}

async function safeCreateOnboardingTicket(task, senderEmail, ticketBody) {
  try {
    await createOnboardingTicket(task, {
      senderEmail,
      ticketBody
    });
  } catch (error) {
    console.error(`[hr] Zammad onboarding ticket failed: ${error.message}`);
  }
}

async function safeCreateOffboardingTicket(task, senderEmail, ticketBody) {
  try {
    await createOffboardingTicket(task, {
      senderEmail,
      ticketBody
    });
  } catch (error) {
    console.error(`[hr] Zammad offboarding ticket failed: ${error.message}`);
  }
}

router.get("/meta", (req, res) => {
  const options = getCompanyMatcherOptions();
  const companyMatchers = buildCompanyMatchers().map((matcher) => ({
    key: matcher.key,
    code: matcher.code,
    domain: matcher.domain,
    tenant: matcher.tenant,
    groups: Array.isArray(matcher.groups) ? matcher.groups : []
  }));

  return res.json({
    ok: true,
    user: {
      email: String(req.user?.email || "").trim(),
      name: String(req.user?.name || "").trim(),
      role: String(req.user?.role || "").trim()
    },
    companyDomains: options.domains,
    companyCodes: options.codes,
    companyMatchers
  });
});

router.get("/tasks", (req, res) => {
  const type = String(req.query.type || "onboarding").trim().toLowerCase();
  if (type !== "onboarding" && type !== "offboarding") {
    return res.status(400).json({ ok: false, error: "type must be onboarding or offboarding" });
  }
  return res.json({ ok: true, tasks: getTasksByType(type) });
});

router.get("/managers", async (req, res) => {
  try {
    const company = String(req.query.company || "").trim();
    if (!company) {
      return res.status(400).json({ ok: false, error: "company is required" });
    }
    const matcher = resolveMatcherByCompany(company);
    const tenant = normalizeTenantKey(matcher?.tenant || "");
    if (!tenant) {
      return res.status(400).json({ ok: false, error: "Unable to resolve tenant for company" });
    }
    const users = await listUsers(String(req.query.search || "").trim(), 200, tenant, { excludeGuests: true, excludeDisabled: true });
    const rows = users
      .map((user) => normalizeUserRow(user, tenant))
      .filter((user) => {
        const displayName = String(user.displayName || "").toLowerCase();
        const identity = String(user.mail || user.userPrincipalName || "").toLowerCase();
        if (displayName.includes("service account")) return false;
        if (/^(svc[-_.]|service[-_.])/.test(identity)) return false;
        return true;
      });
    return res.json({ ok: true, tenant, users: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Failed to load managers" });
  }
});

router.get("/employees", async (req, res) => {
  try {
    const company = String(req.query.company || "").trim();
    if (!company) {
      return res.status(400).json({ ok: false, error: "company is required" });
    }
    const matcher = resolveMatcherByCompany(company);
    const tenant = normalizeTenantKey(matcher?.tenant || "");
    if (!tenant) {
      return res.status(400).json({ ok: false, error: "Unable to resolve tenant for company" });
    }
    const users = await listUsers(String(req.query.search || "").trim(), 200, tenant, { excludeGuests: false, excludeDisabled: true });
    const rows = users
      .map((user) => normalizeUserRow(user, tenant))
      .filter((user) => {
        const displayName = String(user.displayName || "").toLowerCase();
        const identity = String(user.mail || user.userPrincipalName || "").toLowerCase();
        if (displayName.includes("service account")) return false;
        if (/^(svc[-_.]|service[-_.])/.test(identity)) return false;
        return true;
      });
    return res.json({ ok: true, tenant, users: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Failed to load employees" });
  }
});

router.post("/onboarding", async (req, res) => {
  const body = req.body || {};
  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const company = String(body.company || "").trim().toUpperCase();
  const position = String(body.position || "").trim();
  const phone = String(body.phone || "").trim();
  const startDate = String(body.startDate || "").trim();
  const additionalNote = String(body.additionalNote || "").trim();
  const manager = String(body.manager?.mail || body.manager?.userPrincipalName || body.manager?.displayName || body.manager || "").trim();

  if (!firstName || !lastName || !company || !startDate) {
    return res.status(400).json({ ok: false, error: "firstName, lastName, company and startDate are required" });
  }

  const taskPayload = {
    taskType: "onboarding",
    status: "pending",
    firstName,
    lastName,
    fullName,
    company,
    companyCode: inferCompanyCode(company),
    companyDomain: inferDomain(company),
    position,
    phone,
    manager,
    startDate,
    additionalNote,
    email: generateEmail(firstName, lastName, company),
    skipLicense: false,
    licenseRequired: true,
    assets: {
      laptop: false,
      keyboard: false,
      mouse: false,
      headphones: false,
      monitor: false
    }
  };

  const result = addTask(taskPayload);
  if (result.duplicate) {
    return res.status(409).json({ ok: false, error: `Duplicate ignored: ${fullName} (${startDate}) already exists.` });
  }

  const task = result.task;
  const ticketBody = formatHrOnboardingTicketBody(taskPayload);
  safeCreateOnboardingTicket(task, String(req.user?.email || "").trim(), ticketBody);
  safeNotifyTeams(formatHrOnboardingTeamsMessage(taskPayload));

  return res.status(201).json({ ok: true, task });
});

router.post("/offboarding", async (req, res) => {
  const body = req.body || {};
  const company = String(body.company || "").trim().toUpperCase();
  const startDate = String(body.startDate || "").trim();
  const additionalNote = String(body.additionalNote || "").trim();
  const matcher = resolveMatcherByCompany(company);
  const tenant = normalizeTenantKey(body.tenant || matcher?.tenant || "");
  const user = normalizeUserRow(body.user || {}, tenant);
  const derivedName = user.displayName || body.fullName || "";
  const nameParts = splitName(derivedName);
  const fullName = String(derivedName || `${nameParts.firstName} ${nameParts.lastName}` || "").trim();

  if (!company || !startDate || !tenant || !user.userPrincipalName) {
    return res.status(400).json({ ok: false, error: "company, startDate and employee are required" });
  }

  const recipients = getLicenseRequestRecipients();
  const taskPayload = {
    taskType: "offboarding",
    status: "pending",
    firstName: nameParts.firstName || NOT_SPECIFIED,
    lastName: nameParts.lastName || NOT_SPECIFIED,
    fullName: fullName || NOT_SPECIFIED,
    company,
    companyCode: inferCompanyCode(company),
    companyDomain: inferDomain(company),
    startDate,
    additionalNote,
    email: String(user.userPrincipalName || user.mail || "").trim().toLowerCase(),
    offboarding: {
      tenant,
      company,
      email: String(user.userPrincipalName || user.mail || "").trim().toLowerCase(),
      deleteUser: true,
      sendLicenseCancelEmail: true,
      licenseCancelMail: {
        to: recipients.to,
        cc: recipients.cc,
        subject: "",
        body: ""
      },
      user,
      accountsToDelete: [],
      assetsToCheckin: []
    }
  };

  const result = addTask(taskPayload, { skipDuplicate: true });
  const task = result.task;
  const ticketBody = formatHrOffboardingTicketBody(taskPayload);
  safeCreateOffboardingTicket(task, String(req.user?.email || "").trim(), ticketBody);
  safeNotifyTeams(formatHrOffboardingTeamsMessage(taskPayload));

  return res.status(201).json({ ok: true, task });
});

module.exports = router;
