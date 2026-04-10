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
const { getCompanyMatcherOptions, resolveTenantKeyByEmail } = require("../parser");
const {
  getUserByEmail,
  createUser,
  updateUserUsageLocation,
  getSubscribedSkus,
  findBusinessPremiumSku,
  hasAvailableSeats,
  assignLicenseWithRetry,
  waitForUserProvisioning,
  listUsers,
  assignManager
} = require("../services/graph");
const { sendLicenseRequestMail, sendAssetsMail } = require("../services/mail");
const { isEnabled } = require("../services/snipeit.service");
const { addAssignTask } = require("../services/snipeitAssignStore");
const { processPendingAssignTasks } = require("../services/snipeitAssignWorker");

const router = express.Router();

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
    companyCode: base.companyCode || "",
    companyDomain: base.companyDomain || "",
    position: base.position || "",
    phone: base.phone || "",
    manager: base.manager || "",
    startDate: base.startDate || "",
    email: base.email || "",
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
  return res.json({
    companyDomains: options.domains,
    companyCodes: options.codes
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

router.get("/meta/licenses", async (req, res) => {
  try {
    const skus = await getSubscribedSkus();
    const premiumSku = findBusinessPremiumSku(skus);

    if (!premiumSku) {
      return res.json({
        ok: true,
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

router.get("/:id", (req, res) => {
  const task = getTaskById(req.params.id);

  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  return res.json(task);
});

router.patch("/:id", (req, res) => {
  const payload = req.body || {};

  const allowedKeys = [
    "email",
    "company",
    "companyDomain",
    "licenseRequired",
    "assets",
    "position",
    "phone",
    "manager",
    "startDate",
    "firstName",
    "lastName",
    "fullName",
    "licenseMail",
    "assetsMail",
    "snipeitAssets"
  ];
  const updates = {};

  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      updates[key] = payload[key];
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

  updateTaskById(existingTask.id, { status: "processing" });

  try {
    console.log(`[approve] Started for ${existingTask.fullName} (${existingTask.email})`);
    const tenantKey = resolveTenantKeyByEmail(existingTask.email);
    console.log(`[approve] Resolved tenant ${tenantKey || "default"} for ${existingTask.email}`);

    let user = await getUserByEmail(existingTask.email, tenantKey);

    if (!user) {
      console.log(`[approve] User not found, creating ${existingTask.email}`);
      user = await createUser(existingTask, tenantKey);
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

    // licenseRequired = true  → only procurement email (do not assign from pool)
    // licenseRequired = false → try to assign Business Premium from tenant; if no seat, send procurement email
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

    task = getTaskById(existingTask.id) || task;

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
        const unlicensedTask = updateTaskById(existingTask.id, { status: "unlicensed" });
        return res.json({ task: unlicensedTask, steps, failedSteps: stepErrors });
      }

      const failedTask = updateTaskById(existingTask.id, { status: "failed" });
      return res.status(500).json({
        error: "Approval completed with errors",
        steps,
        failedSteps: stepErrors,
        task: failedTask
      });
    }

    const doneTask = updateTaskById(existingTask.id, { status: "done" });
    return res.json({ task: doneTask, steps });
  } catch (error) {
    console.error("[approve] Failed", error);
    const failedTask = updateTaskById(existingTask.id, { status: "failed" });
    return res.status(500).json({ error: "Approval failed", details: error.message, task: failedTask });
  }
});

module.exports = router;
