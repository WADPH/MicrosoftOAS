const express = require("express");
const {
  getAllTasks,
  getTasksByType,
  getTaskById,
  addTask,
  updateTaskById,
  deleteTaskById,
  DOMAIN_OPTIONS,
  COMPANY_CODE_OPTIONS
} = require("../services/taskStore");
const { getCompanyMatcherOptions, resolveTenantKeyByEmail, buildCompanyMatchers, findCompanyMatcherByHints } = require("../parser");
const { getDefaultTenantKey } = require("../services/tenantConfig");
const {
  getUserByEmail,
  createUser,
  updateUserUsageLocation,
  graphRequest,
  getSubscribedSkus,
  findBusinessPremiumSku,
  hasAvailableSeats,
  assignLicenseWithRetry,
  waitForUserProvisioning,
  listUsers,
  assignManager,
  listGroups,
  getGroupById,
  addUserToGroup
} = require("../services/graph");
const { sendLicenseRequestMail, sendAssetsMail } = require("../services/mail");
const { isEnabled } = require("../services/snipeit.service");
const { addAssignTask } = require("../services/snipeitAssignStore");
const { processPendingAssignTasks } = require("../services/snipeitAssignWorker");
const { listAgents, createManualOnboardingTicket } = require("../services/zammad.service");

const router = express.Router();

function createExecutionLogger() {
  const executionLogs = [];
  const push = (type, message) => {
    const normalizedType = ["success", "warning", "error"].includes(type) ? type : "info";
    const text = String(message || "").trim();
    const entry = {
      type: normalizedType,
      message: text,
      timestamp: new Date().toISOString()
    };
    executionLogs.push(entry);
    const prefix = normalizedType === "error" ? "[manual-license][error]" : normalizedType === "warning" ? "[manual-license][warn]" : "[manual-license]";
    console.log(`${prefix} ${text}`);
    return entry;
  };

  return {
    executionLogs,
    info: (message) => push("info", message),
    success: (message) => push("success", message),
    warning: (message) => push("warning", message),
    error: (message) => push("error", message)
  };
}

function hasSkuAssigned(user, skuId) {
  const targetSku = String(skuId || "").trim().toLowerCase();
  const licenses = Array.isArray(user?.assignedLicenses) ? user.assignedLicenses : [];
  return licenses.some((license) => String(license?.skuId || "").trim().toLowerCase() === targetSku);
}

async function fetchUserLicenseState(email, tenantKey) {
  const user = await graphRequest(
    "GET",
    `/users/${encodeURIComponent(String(email || "").trim())}?$select=id,displayName,mail,userPrincipalName,usageLocation,assignedLicenses`,
    undefined,
    tenantKey
  );
  return user;
}

async function waitForLicenseAssignment(email, skuId, tenantKey, attempts = 5, delayMs = 1200) {
  let lastUser = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastUser = await fetchUserLicenseState(email, tenantKey);
    if (hasSkuAssigned(lastUser, skuId)) {
      return lastUser;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return lastUser;
}

// Execution logs collector
function createLogCollector() {
  const logs = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  const collector = {
    logs,
    startCapture() {
      console.log = (...args) => {
        const message = args.map(arg => {
          if (typeof arg === 'string') return arg;
          try { return JSON.stringify(arg); } catch { return String(arg); }
        }).join(' ');
        logs.push({ message, type: 'info', timestamp: new Date().toISOString() });
        originalLog(...args);
      };
      console.warn = (...args) => {
        const message = args.map(arg => {
          if (typeof arg === 'string') return arg;
          try { return JSON.stringify(arg); } catch { return String(arg); }
        }).join(' ');
        logs.push({ message, type: 'warning', timestamp: new Date().toISOString() });
        originalWarn(...args);
      };
      console.error = (...args) => {
        const message = args.map(arg => {
          if (typeof arg === 'string') return arg;
          try { return JSON.stringify(arg); } catch { return String(arg); }
        }).join(' ');
        logs.push({ message, type: 'error', timestamp: new Date().toISOString() });
        originalError(...args);
      };
    },
    stopCapture() {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }
  };

  return collector;
}

function validateSnipeitAssetsInput(input) {
  if (!Array.isArray(input)) {
    const error = new Error("snipeitAssets must be an array");
    error.status = 400;
    throw error;
  }

  if (input.length === 0) return [];

  if (!isEnabled()) {
    const error = new Error("Snipe-IT integration is disabled");
    error.status = 400;
    throw error;
  }

  const laptopPrefix = String(process.env.SNIPEIT_LAPTOP_PREFIX || "PC-").trim();
  const monitorPrefix = String(process.env.SNIPEIT_MONITOR_PREFIX || "MN-").trim();
  const allowedPrefixes = [laptopPrefix, monitorPrefix].filter(Boolean);

  const normalized = input.map((asset) => ({
    id: Number(asset?.id),
    asset_tag: String(asset?.asset_tag || "").trim(),
    model: String(asset?.model || "").trim(),
    notes: String(asset?.notes || "").trim(),
    companyName: String(asset?.companyName || "").trim(),
    type: String(asset?.type || "").trim().toLowerCase()
  }));

  for (const asset of normalized) {
    if (!Number.isFinite(asset.id) || !asset.asset_tag) {
      const error = new Error("Each Snipe-IT asset must include id and asset_tag");
      error.status = 400;
      throw error;
    }
    if (!allowedPrefixes.some((prefix) => asset.asset_tag.startsWith(prefix))) {
      const error = new Error(`Asset ${asset.asset_tag} does not match configured Snipe-IT prefixes`);
      error.status = 400;
      throw error;
    }
  }

  return normalized;
}

router.get("/", (req, res) => {
  const taskType = String(req.query.type || "onboarding").trim().toLowerCase();
  const tasks = taskType === "all" ? getAllTasks() : getTasksByType(taskType);
  res.json(tasks);
});

router.post("/new", (req, res) => {
  const base = req.body || {};
  const result = addTask({
    taskType: "onboarding",
    status: "pending",
    fullName: base.fullName || "",
    firstName: base.firstName || "",
    lastName: base.lastName || "",
    company: base.company || "",
    companyCode: String(base.companyCode || "EIG").trim().toUpperCase(),
    companyDomain: String(base.companyDomain || "ei-g.com").trim().toLowerCase(),
    position: base.position || "",
    phone: base.phone || "",
    manager: base.manager || "",
    startDate: base.startDate || "",
    email: base.email || "",
    skipLicense: false,
    licenseRequired: true,
    assets: {
      laptop: false,
      keyboard: false,
      mouse: false,
      headphones: false,
      monitor: false
    }
  }, { skipDuplicate: true });

  return res.status(201).json({ ok: true, task: result.task });
});

router.get("/meta/options", (req, res) => {
  const options = getCompanyMatcherOptions();
  const companyMatchers = buildCompanyMatchers().map((matcher) => ({
    key: matcher.key,
    code: matcher.code,
    domain: matcher.domain,
    tenant: matcher.tenant,
    groups: Array.isArray(matcher.groups) ? matcher.groups : []
  }));
  return res.json({
    companyDomains: options.domains,
    companyCodes: options.codes,
    companyMatchers
  });
});

router.get("/meta/users", async (req, res) => {
  try {
    const emailForTenant = String(req.query.email || "").trim();
    const tenantKey = resolveTenantKeyByEmail(emailForTenant);
    const users = await listUsers(String(req.query.search || ""), 200, tenantKey, { excludeGuests: true, excludeDisabled: true });
    const filtered = users.filter((user) => {
      const displayName = String(user.displayName || "").toLowerCase();
      const identity = String(user.mail || user.userPrincipalName || "").toLowerCase();
      if (displayName.includes("service account")) return false;
      if (/^(svc[-_.]|service[-_.])/.test(identity)) return false;
      return true;
    });
    console.log(`[meta] users lookup tenant=${tenantKey} search="${String(req.query.search || "").trim()}" found=${filtered.length}`);
    return res.json(
      filtered.map((user) => ({
        displayName: String(user.displayName || "").trim(),
        mail: String(user.mail || user.userPrincipalName || "").trim(),
        userPrincipalName: String(user.userPrincipalName || "").trim(),
        givenName: String(user.givenName || "").trim(),
        surname: String(user.surname || "").trim()
      }))
    );
  } catch (error) {
    console.error("[meta] users lookup failed", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.get("/meta/groups", async (req, res) => {
  try {
    const tenant = String(req.query.tenant || "").trim();
    if (!tenant) {
      return res.status(400).json({ ok: false, error: "tenant is required" });
    }
    const ids = String(req.query.ids || "")
      .split(",")
      .map((id) => String(id || "").trim())
      .filter(Boolean);

    let groups = [];
    if (ids.length > 0) {
      groups = await Promise.all(ids.map((id) => getGroupById(id, tenant)));
      groups = groups.filter(Boolean);
    } else {
      groups = await listGroups(String(req.query.search || ""), 200, tenant);
    }

    return res.json({
      ok: true,
      groups: groups.map((group) => ({
        id: group.id,
        displayName: group.displayName,
        memberCount: Number.isFinite(group.memberCount) ? group.memberCount : null
      }))
    });
  } catch (error) {
    console.error("[meta] groups lookup failed", error.message);
    return res.status(500).json({ ok: false, error: error.message || "Failed to load groups" });
  }
});

router.get("/meta/licenses", async (req, res) => {
  try {
    const companyDomain = String(req.query.companyDomain || "").trim().toLowerCase();
    const email = String(req.query.email || "").trim().toLowerCase();
    const matcher = findCompanyMatcherByHints({ companyCode: "", companyDomain, email }) || findCompanyMatcherByHints({ companyDomain: "", email });
    const tenantKey = String(
      matcher?.tenant ||
      (email ? resolveTenantKeyByEmail(email) : "") ||
      getDefaultTenantKey()
    ).trim();

    const skus = await getSubscribedSkus(tenantKey);
    const premiumSku = findBusinessPremiumSku(skus);

    if (!premiumSku) {
      return res.json({
        ok: true,
        tenant: tenantKey || null,
        found: false,
        skuPartNumber: null,
        enabled: 0,
        consumed: 0,
        available: 0
      });
    }

    const enabled = Number(premiumSku.prepaidUnits?.enabled || 0);
    const consumed = Number(premiumSku.consumedUnits || 0);
    const available = Math.max(0, enabled - consumed);

    return res.json({
      ok: true,
      tenant: tenantKey || null,
      found: true,
      skuPartNumber: String(premiumSku.skuPartNumber || ""),
      enabled,
      consumed,
      available
    });
  } catch (error) {
    console.error("[meta] licenses failed", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.post("/:id/license-assign", async (req, res) => {
  const task = getTaskById(req.params.id);
  const logger = createExecutionLogger();

  if (!task) {
    logger.error(`Task not found: ${req.params.id}`);
    return res.status(404).json({ ok: false, error: "Task not found", executionLogs: logger.executionLogs });
  }

  if (String(task.taskType || "onboarding").toLowerCase() !== "onboarding") {
    logger.error("Manual license assign is only available for onboarding tasks");
    return res.status(400).json({ ok: false, error: "Manual license assign is only available for onboarding tasks", executionLogs: logger.executionLogs });
  }

  const status = String(task.status || "").trim().toLowerCase();
  if (status !== "unlicensed") {
    logger.error(`Task is not in Unlicensed state: ${task.status || "unknown"}`);
    return res.status(400).json({ ok: false, error: "Task must be Unlicensed to assign a license manually", executionLogs: logger.executionLogs });
  }

  const matcher = findCompanyMatcherByHints({ companyCode: "", companyDomain: task.companyDomain, email: task.email }) || findCompanyMatcherByHints({ companyCode: task.companyCode, companyDomain: "", email: task.email });
  const tenantKey = String(
    matcher?.tenant ||
    resolveTenantKeyByEmail(task.email) ||
    getDefaultTenantKey()
  ).trim();

  if (!tenantKey) {
    logger.error("Unable to resolve tenant for manual license assign");
    return res.status(400).json({ ok: false, error: "Unable to resolve tenant", executionLogs: logger.executionLogs });
  }

  logger.info(`Resolved tenant ${tenantKey} for ${task.email}`);
  logger.info(`Checking user existence in tenant for ${task.email}`);

  let user;
  try {
    user = await fetchUserLicenseState(task.email, tenantKey);
    logger.success(`User found in tenant: ${user.displayName || user.userPrincipalName || task.email}`);
  } catch (error) {
    if (Number(error.status || 0) === 404) {
      logger.error(`User not found in tenant yet: ${task.email}`);
      return res.status(404).json({ ok: false, error: "User not found in tenant", executionLogs: logger.executionLogs });
    }
    logger.error(`Failed to load user from tenant: ${error.message}`);
    return res.status(500).json({ ok: false, error: error.message || "Failed to load user", executionLogs: logger.executionLogs });
  }

  try {
    const skus = await getSubscribedSkus(tenantKey);
    const premiumSku = findBusinessPremiumSku(skus);

    if (!premiumSku) {
      logger.error("Business Premium SKU not found in tenant");
      return res.status(404).json({ ok: false, error: "Business Premium SKU not found", executionLogs: logger.executionLogs });
    }

    if (!hasAvailableSeats(premiumSku)) {
      logger.error("No free Business Premium seats available");
      return res.status(409).json({ ok: false, error: "No free Business Premium seats available", executionLogs: logger.executionLogs });
    }

    logger.info(`Business Premium SKU found (${premiumSku.skuPartNumber || premiumSku.skuId}) with free seats available`);

    if (hasSkuAssigned(user, premiumSku.skuId)) {
      logger.success("User already has Business Premium assigned; verifying state only");
    } else {
      logger.info("User does not have Business Premium yet, starting assignment");

      const desiredUsageLocation = String(process.env.DEFAULT_USAGE_LOCATION || "AZ").trim().toUpperCase();
      if (String(user.usageLocation || "").trim().toUpperCase() !== desiredUsageLocation) {
        try {
          await updateUserUsageLocation(user.id, desiredUsageLocation, tenantKey);
          logger.success(`usageLocation updated to ${desiredUsageLocation}`);
        } catch (error) {
          logger.warning(`Failed to update usageLocation: ${error.message}`);
        }
      }

      try {
        await assignLicenseWithRetry(user.id || task.email, premiumSku.skuId, 5, tenantKey);
        logger.success("License assignment request sent");
      } catch (error) {
        logger.error(`License assignment failed: ${error.message}`);
      }
    }

    const verifiedUser = await waitForLicenseAssignment(task.email, premiumSku.skuId, tenantKey, 5, 1200);
    if (!hasSkuAssigned(verifiedUser, premiumSku.skuId)) {
      logger.error("Verification failed: user still does not have Business Premium assigned");
      return res.status(500).json({ ok: false, error: "License assignment verification failed", executionLogs: logger.executionLogs });
    }

    logger.success("License verification succeeded");
    const updatedTask = updateTaskById(task.id, { status: "provisioned", errorMessage: "" });
    logger.success(`Task status updated to ${updatedTask.status}`);

    return res.json({
      ok: true,
      task: updatedTask,
      tenant: tenantKey,
      assigned: true,
      alreadyAssigned: hasSkuAssigned(user, premiumSku.skuId),
      executionLogs: logger.executionLogs
    });
  } catch (error) {
    logger.error(`Manual license assign failed: ${error.message}`);
    return res.status(500).json({ ok: false, error: error.message || "Manual license assign failed", executionLogs: logger.executionLogs });
  }
});

router.get("/:id", (req, res) => {
  const task = getTaskById(req.params.id);

  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  return res.json(task);
});

router.patch("/:id", async (req, res) => {
  const payload = req.body || {};

  const allowedKeys = [
    "email",
    "company",
    "companyDomain",
    "skipLicense",
    "licenseRequired",
    "assets",
    "position",
    "phone",
    "manager",
    "userTempPass",
    "startDate",
    "firstName",
    "lastName",
    "fullName",
    "status",
    "errorMessage",
    "licenseMail",
    "assetsMail",
    "snipeitAssets",
    "entraGroups"
  ];
  const updates = {};

  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      if (key === "userTempPass" || key === "errorMessage") {
        updates[key] = String(payload[key] || "").trim();
      } else {
        updates[key] = payload[key];
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, "snipeitAssets")) {
    try {
      updates.snipeitAssets = validateSnipeitAssetsInput(updates.snipeitAssets);
    } catch (error) {
      const status = Number(error.status || 400);
      return res.status(status).json({ error: error.message || "Invalid snipeitAssets" });
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, "entraGroups")) {
    if (!Array.isArray(updates.entraGroups)) {
      return res.status(400).json({ error: "entraGroups must be an array" });
    }
    updates.entraGroups = await Promise.all(
      updates.entraGroups
        .map(async (group) => {
          const normalized = {
            id: String(group?.id || group || "").trim(),
            displayName: String(group?.displayName || "").trim(),
            tenant: String(group?.tenant || "").trim().toUpperCase()
          };
          if (normalized.id && normalized.tenant && !normalized.displayName) {
            try {
              const found = await getGroupById(normalized.id, normalized.tenant);
              if (found && found.displayName) {
                normalized.displayName = String(found.displayName || "").trim();
              }
            } catch (error) {
              console.warn(`[tasks] Failed to resolve group metadata ${normalized.id} tenant=${normalized.tenant}: ${error.message}`);
            }
          }
          return normalized;
        })
    );
    updates.entraGroups = updates.entraGroups.filter((group) => group.id);
  }

  const updated = updateTaskById(req.params.id, updates);

  if (!updated) {
    return res.status(404).json({ error: "Task not found" });
  }

  return res.json(updated);
});

router.delete("/:id", (req, res) => {
  const removed = deleteTaskById(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: "Task not found" });
  }
  return res.json({ success: true, id: removed.id });
});

router.post("/:id/approve", async (req, res) => {
  const existingTask = getTaskById(req.params.id);

  if (!existingTask) {
    return res.status(404).json({ error: "Task not found" });
  }

  if (!existingTask.email || !String(existingTask.email).includes("@")) {
    return res.status(400).json({ error: "Task email is empty. Please update before approve." });
  }

  updateTaskById(existingTask.id, { status: "processing", errorMessage: "" });

  const logCollector = createLogCollector();
  logCollector.startCapture();

  try {
    const bodyPassword = String(req.body?.userTempPass || "").trim();
    if (bodyPassword) {
      updateTaskById(existingTask.id, { userTempPass: bodyPassword });
    }
    const taskForProvision = getTaskById(existingTask.id) || existingTask;

    console.log(`[approve] Started for ${existingTask.fullName} (${existingTask.email})`);
    const tenantKey = resolveTenantKeyByEmail(existingTask.email);
    console.log(`[approve] Resolved tenant ${tenantKey || "default"} for ${existingTask.email}`);

    let user = await getUserByEmail(existingTask.email, tenantKey);

    if (!user) {
      console.log(`[approve] User not found, creating ${existingTask.email}`);
      user = await createUser(taskForProvision, tenantKey);
      // Wait until the directory starts returning this user reliably
      try {
        user = await waitForUserProvisioning(existingTask.email, 10, tenantKey);
      } catch (provisionError) {
        console.warn("[approve] User provisioning wait failed, will still attempt license steps", provisionError.message);
      }
    } else {
      console.log(`[approve] User already exists, skipping create for ${existingTask.email}`);
    }

    let task = getTaskById(existingTask.id) || existingTask;
    const steps = [];
    const stepErrors = [];

    // Assign manager if specified
    const userIdentifier = (user && user.id) ? user.id : existingTask.email;
    if (task.manager && String(task.manager).trim() && task.manager !== "not specified") {
      try {
        const managerResult = await assignManager(userIdentifier, task.manager, tenantKey);
        if (managerResult.success) {
          console.log("[approve] Manager assigned successfully");
          steps.push({ step: "manager", action: "assigned", success: true });
        } else {
          console.warn(`[approve] Manager assignment failed: ${managerResult.reason}`);
          stepErrors.push({ step: "manager", message: managerResult.reason });
        }
      } catch (managerError) {
        console.error("[approve] Manager assignment failed", managerError);
        stepErrors.push({ step: "manager", message: managerError.message || "unknown error" });
      }
    }

    // skipLicense = true   → skip all license actions completely
    // skipLicense = false  → follow licenseRequired behavior below
    // licenseRequired = true  → only procurement email (do not assign from pool)
    // licenseRequired = false → try to assign Business Premium from tenant; if no seat, send procurement email
    if (task.skipLicense) {
      console.log("[approve] License step skipped by Skip License toggle");
      steps.push({ step: "license", action: "skipped_by_toggle", success: true });
    } else {
      try {
        if (task.licenseRequired) {
          console.log("[approve] License: request procurement email only (checkbox on)");
          await sendLicenseRequestMail(task);
          console.log("[approve] License request email sent");
          steps.push({ step: "license", action: "email_request", success: true });
        } else {
          console.log("[approve] License: assign from tenant pool only (checkbox off)");
          const skus = await getSubscribedSkus(tenantKey);
          const premiumSku = findBusinessPremiumSku(skus);

          if (premiumSku && hasAvailableSeats(premiumSku)) {
            const licenseTarget = String(user?.id || task.email || "").trim();
            const desiredUsageLocation = String(process.env.DEFAULT_USAGE_LOCATION || "AZ").trim().toUpperCase();
            await updateUserUsageLocation(licenseTarget, desiredUsageLocation, tenantKey);
            await assignLicenseWithRetry(licenseTarget, premiumSku.skuId, 5, tenantKey);
            console.log(`[approve] Business Premium assigned for ${task.email}`);
            steps.push({
              step: "license",
              action: "assign",
              success: true,
              skuPartNumber: String(premiumSku.skuPartNumber || ""),
              skuId: String(premiumSku.skuId || "")
            });
          } else {
            console.warn("[approve] Business Premium not assigned: no free seat or SKU not found");
            stepErrors.push({
              step: "license",
              message: "Business Premium not assigned: no free seat or SKU not found"
            });
          }
        }
      } catch (licenseError) {
        console.error("[approve] License step failed", licenseError);
        stepErrors.push({ step: "license", message: licenseError.message || "unknown license error" });
      }
    }

    task = getTaskById(existingTask.id) || task;

    try {
      const userObjectId = String(user?.id || "").trim();
      const selectedGroups = Array.isArray(task.entraGroups) ? task.entraGroups : [];
      const groupsToAssign = selectedGroups.map((group) => String(group.id || "").trim()).filter(Boolean);

      if (!userObjectId || groupsToAssign.length === 0) {
        steps.push({ step: "groups", action: groupsToAssign.length > 0 ? "skipped_no_user_id" : "skipped_no_groups", success: true });
      } else {
        const uniqueGroupIds = [...new Set(groupsToAssign)];
        const groupResults = [];
        for (const groupId of uniqueGroupIds) {
          try {
            const group = await getGroupById(groupId, tenantKey);
            if (!group?.id) {
              console.warn(`[approve] Group not found in tenant ${tenantKey}: ${groupId}`);
              groupResults.push({ groupId, status: "not_found" });
              continue;
            }
            await addUserToGroup(groupId, userObjectId, tenantKey);
            console.log(`[approve] User ${task.email} added to group ${groupId}`);
            groupResults.push({ groupId, status: "added" });
          } catch (groupError) {
            const message = String(groupError?.message || "");
            if (message.includes("added object references already exist")) {
              console.log(`[approve] User already in group ${groupId}`);
              groupResults.push({ groupId, status: "already_member" });
              continue;
            }
            console.error(`[approve] Failed to add user to group ${groupId}: ${message}`);
            groupResults.push({ groupId, status: "failed", error: message });
          }
        }
        steps.push({ step: "groups", action: "assign", success: true, groups: groupResults });
      }
    } catch (groupStepError) {
      console.error("[approve] Group step failed", groupStepError);
      steps.push({
        step: "groups",
        action: "failed_non_blocking",
        success: false,
        error: groupStepError.message || "unknown group error"
      });
    }

    try {
      const hasAnyAsset = Object.values(task.assets || {}).some((x) => Boolean(x));
      if (hasAnyAsset) {
        await sendAssetsMail(task);
        console.log("[approve] Assets email sent");
        steps.push({ step: "assets", action: "email_request", success: true });
      } else {
        console.log("[approve] No assets selected, skipping assets email");
        steps.push({ step: "assets", action: "skipped_no_assets", success: true });
      }
    } catch (assetsError) {
      console.error("[approve] Assets step failed", assetsError);
      stepErrors.push({ step: "assets", message: assetsError.message || "unknown assets error" });
    }

    try {
      const selectedSnipeitAssets = Array.isArray(task.snipeitAssets) ? task.snipeitAssets : [];
      if (isEnabled() && selectedSnipeitAssets.length > 0) {
        const assignTask = addAssignTask({
          email: task.email,
          assets: selectedSnipeitAssets,
          taskId: task.id
        });
        console.log(`[approve] Snipe-IT assign task queued: ${assignTask.id}`);
        try {
          const immediate = await processPendingAssignTasks({ taskId: assignTask.id, force: true });
          console.log(`[approve] Snipe-IT immediate assign attempt finished for ${assignTask.id}: ${JSON.stringify(immediate)}`);
        } catch (immediateError) {
          console.warn(`[approve] Snipe-IT immediate assign attempt failed for ${assignTask.id}: ${immediateError.message}`);
        }
        steps.push({ step: "snipeit_assign", action: "queued", success: true, assignTaskId: assignTask.id });
      } else if (!isEnabled() && selectedSnipeitAssets.length > 0) {
        console.warn("[approve] Snipe-IT assets selected but integration disabled, skipping queue");
        steps.push({ step: "snipeit_assign", action: "skipped_disabled", success: true });
      } else {
        steps.push({ step: "snipeit_assign", action: "skipped_no_assets", success: true });
      }
    } catch (snipeitError) {
      console.error("[approve] Snipe-IT queue step failed", snipeitError);
      stepErrors.push({ step: "snipeit_assign", message: snipeitError.message || "unknown snipeit error" });
    }

    if (stepErrors.length) {
      const onlyUnlicensed =
        stepErrors.length === 1 &&
        stepErrors[0].step === "license" &&
        String(stepErrors[0].message || "").includes("no free seat or SKU not found");

      if (onlyUnlicensed) {
        const unlicensedTask = updateTaskById(existingTask.id, { status: "unlicensed", errorMessage: "", executionLogs: logCollector.logs });
        logCollector.stopCapture();
        return res.json({ task: unlicensedTask, steps, failedSteps: stepErrors, executionLogs: logCollector.logs });
      }

      const failedTask = updateTaskById(existingTask.id, {
        status: "error",
        errorMessage: stepErrors.map((x) => `[${x.step}] ${x.message}`).join("\n"),
        executionLogs: logCollector.logs
      });
      logCollector.stopCapture();
      return res.status(500).json({
        error: "Approval completed with errors",
        steps,
        failedSteps: stepErrors,
        task: failedTask,
        executionLogs: logCollector.logs
      });
    }

    const finalStatus = task.skipLicense || task.licenseRequired ? "unlicensed" : "provisioned";
    const finalTask = updateTaskById(existingTask.id, { status: finalStatus, errorMessage: "", executionLogs: logCollector.logs });
    logCollector.stopCapture();
    return res.json({ task: finalTask, steps, executionLogs: logCollector.logs });
  } catch (error) {
    console.error("[approve] Failed", error);
    const failedTask = updateTaskById(existingTask.id, { status: "error", errorMessage: error.message || "Approval failed", executionLogs: logCollector.logs });
    logCollector.stopCapture();
    return res.status(500).json({ error: "Approval failed", details: error.message, task: failedTask, executionLogs: logCollector.logs });
  }
});

router.get("/:id/zammad/agents", async (req, res) => {
  const task = getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({ ok: false, error: "Task not found" });
  }
  if (String(process.env.ZAMMAD_ENABLED || "").trim().toLowerCase() !== "true") {
    return res.status(400).json({ ok: false, error: "Zammad integration is disabled" });
  }
  try {
    console.log(`[zammad] Loading agents for task ${task.id}`);
    const agents = await listAgents();
    return res.json({ ok: true, agents });
  } catch (error) {
    console.error(`[zammad] Failed to load agents for task ${task.id}: ${error.message}`);
    return res.status(500).json({ ok: false, error: error.message || "Failed to load Zammad agents" });
  }
});

router.post("/:id/zammad/ticket", async (req, res) => {
  const task = getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({ ok: false, error: "Task not found" });
  }
  if (String(process.env.ZAMMAD_ENABLED || "").trim().toLowerCase() !== "true") {
    return res.status(400).json({ ok: false, error: "Zammad integration is disabled" });
  }
  const ownerId = Number(req.body?.ownerId);
  if (!Number.isFinite(ownerId)) {
    return res.status(400).json({ ok: false, error: "ownerId must be a valid number" });
  }

  try {
    console.log(`[zammad] Manual ticket create requested task=${task.id} owner=${ownerId}`);
    const ticket = await createManualOnboardingTicket(task, ownerId);
    updateTaskById(task.id, { status: "done", errorMessage: "" });
    console.log(`[zammad] Manual ticket created task=${task.id} ticket=${ticket?.id || "n/a"} owner=${ownerId}`);
    return res.json({ ok: true, ticket });
  } catch (error) {
    console.error(`[zammad] Manual ticket failed task=${task.id} owner=${ownerId}: ${error.message}`);
    return res.status(500).json({ ok: false, error: error.message || "Failed to create ticket" });
  }
});

module.exports = router;
