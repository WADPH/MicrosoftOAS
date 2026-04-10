const express = require("express");
const { getTenantKeysFromEnv, normalizeTenantKey } = require("../services/tenantConfig");
const { listUsers, deleteUserById, getUserByEmail } = require("../services/graph");
const { isEnabled: isSnipeitEnabled, getAssignedAssetsByEmail, checkinAsset } = require("../services/snipeit.service");
const { addTask, getTasksByType, getTaskById, updateTaskById } = require("../services/taskStore");

const router = express.Router();

function normalizeIdentity(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function domainFromEmail(email) {
  const raw = String(email || "").trim().toLowerCase();
  const at = raw.indexOf("@");
  if (at < 0) return "";
  return raw.slice(at + 1);
}

function localFromEmail(email) {
  const raw = String(email || "").trim().toLowerCase();
  const at = raw.indexOf("@");
  if (at < 0) return raw;
  return raw.slice(0, at);
}

function matchRelatedAccount(referenceEmail, account) {
  const upn = String(account.userPrincipalName || account.mail || "").toLowerCase();
  const mail = String(account.mail || "").toLowerCase();
  const refEmail = String(referenceEmail || "").toLowerCase();
  const refLocal = localFromEmail(refEmail);
  const refDomain = domainFromEmail(refEmail);
  const refIdentity = normalizeIdentity(refLocal);
  const extDomainMarker = normalizeIdentity(refDomain.replace(/\./g, "-"));
  const upnIdentity = normalizeIdentity(upn);

  if (!upn) return false;
  if (upn === refEmail || mail === refEmail) return true;
  if (upn.startsWith(`${refLocal}@`)) return true;
  if (upnIdentity.startsWith(refIdentity) && upn.includes("#ext#")) return true;
  if (upnIdentity.includes(`${refIdentity}${extDomainMarker}`) && upn.includes("#ext#")) return true;
  return false;
}

function dedupeAccounts(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.tenant}:${String(row.userPrincipalName || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function buildOffboardingTaskPayload(payload = {}) {
  const user = payload.user || {};
  const tenant = normalizeTenantKey(payload.tenant || user.tenant || "");
  const email = String(payload.email || user.mail || user.userPrincipalName || "").trim().toLowerCase();
  const deleteUser = payload.deleteUser !== false;
  const accountsToDelete = Array.isArray(payload.accountsToDelete) ? payload.accountsToDelete : [];
  const assetsToCheckin = Array.isArray(payload.assetsToCheckin) ? payload.assetsToCheckin : [];
  return {
    tenant,
    email,
    deleteUser,
    user,
    accountsToDelete,
    assetsToCheckin
  };
}

router.get("/meta", (req, res) => {
  return res.json({
    ok: true,
    tenants: getTenantKeysFromEnv(),
    snipeitEnabled: isSnipeitEnabled()
  });
});

router.get("/tasks", (req, res) => {
  const tasks = getTasksByType("offboarding");
  return res.json({ ok: true, tasks });
});

router.post("/tasks", (req, res) => {
  const payload = req.body || {};
  const offboarding = buildOffboardingTaskPayload(payload);
  if (!offboarding.tenant) {
    return res.status(400).json({ ok: false, error: "tenant is required" });
  }
  if (!offboarding.email) {
    return res.status(400).json({ ok: false, error: "user/email is required" });
  }

  if (payload.taskId) {
    const existing = getTaskById(String(payload.taskId));
    if (!existing) {
      return res.status(404).json({ ok: false, error: "Offboarding task not found" });
    }
    const updated = updateTaskById(existing.id, {
      taskType: "offboarding",
      status: existing.status === "done" ? "done" : "pending",
      fullName: String(offboarding.user?.displayName || offboarding.email || existing.fullName || ""),
      email: offboarding.email,
      offboarding
    });
    return res.json({ ok: true, task: updated });
  }

  const created = addTask(
    {
      taskType: "offboarding",
      status: "pending",
      fullName: String(offboarding.user?.displayName || offboarding.email || ""),
      email: offboarding.email,
      startDate: new Date().toISOString(),
      offboarding
    },
    { skipDuplicate: true }
  );

  return res.status(201).json({ ok: true, task: created.task });
});

router.get("/users", async (req, res) => {
  try {
    const tenant = normalizeTenantKey(req.query.tenant || "");
    const search = String(req.query.search || "").trim();
    if (!tenant) {
      return res.status(400).json({ ok: false, error: "tenant is required" });
    }

    const users = await listUsers(search, 200, tenant, { excludeGuests: false, excludeDisabled: true });
    const rows = users
      .map((user) => ({
        id: String(user.id || ""),
        tenant,
        displayName: String(user.displayName || "").trim(),
        mail: String(user.mail || user.userPrincipalName || "").trim(),
        userPrincipalName: String(user.userPrincipalName || "").trim(),
        userType: String(user.userType || "").trim(),
        accountEnabled: user.accountEnabled !== false
      }))
      .filter((user) => {
        const identity = String(user.userPrincipalName || user.mail || "").toLowerCase();
        const displayName = String(user.displayName || "").toLowerCase();
        if (identity.includes("#ext#")) return false;
        if (displayName.includes("service account")) return false;
        if (/^(svc[-_.]|service[-_.])/.test(identity)) return false;
        return true;
      });

    return res.json({ ok: true, users: rows });
  } catch (error) {
    const status = Number(error.status || 500);
    return res.status(status).json({ ok: false, error: error.message || "Failed to load users" });
  }
});

router.get("/accounts", async (req, res) => {
  try {
    const tenant = normalizeTenantKey(req.query.tenant || "");
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!tenant || !email) {
      return res.status(400).json({ ok: false, error: "tenant and email are required" });
    }

    const tenants = getTenantKeysFromEnv();
    const related = [];
    const local = localFromEmail(email);
    const seedQueries = [...new Set([local, email, local.split(".")[0]].filter(Boolean))];

    for (const t of tenants) {
      for (const query of seedQueries) {
        const users = await listUsers(query, 250, t, { excludeGuests: false, excludeDisabled: false });
        for (const user of users) {
          const candidate = {
            id: String(user.id || ""),
            tenant: t,
            displayName: String(user.displayName || "").trim(),
            mail: String(user.mail || "").trim(),
            userPrincipalName: String(user.userPrincipalName || "").trim(),
            userType: String(user.userType || "").trim(),
            accountEnabled: user.accountEnabled !== false
          };
          if (matchRelatedAccount(email, candidate)) {
            related.push(candidate);
          }
        }
      }
    }

    const sorted = dedupeAccounts(related).sort((a, b) => {
      if (a.tenant !== b.tenant) return a.tenant.localeCompare(b.tenant);
      return String(a.userPrincipalName || "").localeCompare(String(b.userPrincipalName || ""), undefined, { sensitivity: "base" });
    });

    return res.json({ ok: true, accounts: sorted });
  } catch (error) {
    const status = Number(error.status || 500);
    return res.status(status).json({ ok: false, error: error.message || "Failed to load related accounts" });
  }
});

router.get("/snipeit-assets", async (req, res) => {
  try {
    if (!isSnipeitEnabled()) {
      return res.json({ ok: true, enabled: false, assets: [] });
    }

    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ ok: false, error: "email is required" });
    }

    const assets = await getAssignedAssetsByEmail(email);
    return res.json({ ok: true, enabled: true, assets });
  } catch (error) {
    const status = Number(error.status || 500);
    return res.status(status).json({ ok: false, error: error.message || "Failed to load Snipe-IT assets" });
  }
});

router.post("/execute", async (req, res) => {
  const payload = req.body || {};
  const offboarding = buildOffboardingTaskPayload(payload);
  const tenant = offboarding.tenant;
  const email = offboarding.email;
  const deleteUser = offboarding.deleteUser;
  const accountsToDelete = offboarding.accountsToDelete;
  const assetsToCheckin = offboarding.assetsToCheckin;

  if (!tenant) {
    return res.status(400).json({ ok: false, error: "tenant is required" });
  }
  if (!email) {
    return res.status(400).json({ ok: false, error: "user/email is required" });
  }
  if (deleteUser && accountsToDelete.length === 0) {
    return res.status(400).json({ ok: false, error: "At least one account must be selected for deletion" });
  }

  const steps = {
    snipeit: [],
    entra: []
  };
  let task = null;

  try {
    if (payload.taskId) {
      task = getTaskById(String(payload.taskId));
      if (!task) {
        return res.status(404).json({ ok: false, error: "Offboarding task not found" });
      }
      task = updateTaskById(task.id, {
        status: "processing",
        fullName: String(offboarding.user?.displayName || email || task.fullName || ""),
        email,
        offboarding
      });
    } else {
      const created = addTask({
        taskType: "offboarding",
        status: "processing",
        fullName: String(offboarding.user?.displayName || email || ""),
        email,
        startDate: new Date().toISOString(),
        offboarding
      }, { skipDuplicate: true });
      task = created.task;
    }

    console.log(`[offboarding] Started for ${email} (tenant=${tenant})`);
    if (isSnipeitEnabled() && assetsToCheckin.length > 0) {
      for (const rawAsset of assetsToCheckin) {
        const assetId = Number(rawAsset?.id || rawAsset);
        const assetTag = String(rawAsset?.asset_tag || rawAsset?.assetTag || assetId || "unknown");
        if (!Number.isFinite(assetId)) continue;
        console.log(`[offboarding] Attempting to checkin asset ${assetTag} for user ${email}`);
        try {
          await checkinAsset(assetId);
          console.log(`[offboarding] Successfully checked in asset ${assetTag}`);
          steps.snipeit.push({ id: assetId, asset_tag: assetTag, status: "checked_in" });
        } catch (error) {
          console.error(`[offboarding] Failed to checkin asset ${assetTag}: ${error.message || "checkin failed"}`);
          steps.snipeit.push({ id: assetId, asset_tag: assetTag, status: "failed", error: error.message || "checkin failed" });
        }
      }
    }

    if (deleteUser) {
      for (const row of accountsToDelete) {
        const account = typeof row === "string" ? { userPrincipalName: row, tenant } : row || {};
        const accountTenant = normalizeTenantKey(account.tenant || tenant);
        const accountId = String(account.id || "").trim();
        const accountUpn = String(account.userPrincipalName || account.mail || "").trim();

        if (!accountTenant || (!accountId && !accountUpn)) {
          console.error(`[offboarding] Failed to delete user ${accountUpn || "unknown"} in tenant ${accountTenant || tenant}: invalid account payload`);
          steps.entra.push({ tenant: accountTenant || tenant, user: accountUpn || "unknown", status: "failed", error: "invalid account payload" });
          continue;
        }

        console.log(`[offboarding] Attempting to delete user ${accountUpn || accountId} in tenant ${accountTenant}`);
        try {
          await deleteUserById(accountId || accountUpn, accountTenant);
          console.log(`[offboarding] Successfully deleted user ${accountUpn || accountId} in tenant ${accountTenant}`);
          steps.entra.push({ tenant: accountTenant, user: accountUpn || accountId, status: "deleted" });
        } catch (error) {
          const status = Number(error.status || 0);
          if (status === 404 && accountUpn) {
            console.warn(`[offboarding] Delete by id failed with 404 for ${accountUpn} in ${accountTenant}. Trying UPN lookup fallback.`);
            try {
              const existing = await getUserByEmail(accountUpn, accountTenant);
              if (!existing?.id) {
                console.warn(`[offboarding] User ${accountUpn} not found in tenant ${accountTenant}; treating as already deleted`);
                steps.entra.push({ tenant: accountTenant, user: accountUpn, status: "already_deleted" });
                continue;
              }
              await deleteUserById(String(existing.id), accountTenant);
              console.log(`[offboarding] Successfully deleted user ${accountUpn} in tenant ${accountTenant} via fallback id=${existing.id}`);
              steps.entra.push({ tenant: accountTenant, user: accountUpn, status: "deleted" });
              continue;
            } catch (fallbackError) {
              const fallbackStatus = Number(fallbackError.status || 0);
              if (fallbackStatus === 404) {
                console.warn(`[offboarding] User ${accountUpn} not found in tenant ${accountTenant} after fallback; treating as already deleted`);
                steps.entra.push({ tenant: accountTenant, user: accountUpn, status: "already_deleted" });
                continue;
              }
              console.error(
                `[offboarding] Failed to delete user ${accountUpn || accountId} in tenant ${accountTenant} after fallback: ${fallbackError.message || "delete failed"}`
              );
              steps.entra.push({
                tenant: accountTenant,
                user: accountUpn || accountId,
                status: "failed",
                error: fallbackError.message || "delete failed"
              });
              continue;
            }
          }
          console.error(`[offboarding] Failed to delete user ${accountUpn || accountId} in tenant ${accountTenant}: ${error.message || "delete failed"}`);
          steps.entra.push({ tenant: accountTenant, user: accountUpn || accountId, status: "failed", error: error.message || "delete failed" });
        }
      }
    }

    const hasErrors = (steps.entra || []).some((x) => x.status === "failed") || (steps.snipeit || []).some((x) => x.status === "failed");
    if (hasErrors) {
      console.warn("[offboarding] Offboarding task completed with errors");
      task = updateTaskById(task.id, { status: "failed", offboarding });
    } else {
      console.log("[offboarding] Offboarding task completed");
      task = updateTaskById(task.id, { status: "done", offboarding });
    }

    return res.json({ ok: true, steps, task });
  } catch (error) {
    console.error(`[offboarding] Offboarding task completed with errors: ${error.message || "unknown error"}`);
    if (task?.id) {
      try {
        updateTaskById(String(task.id), { status: "failed" });
      } catch {
        // ignore
      }
    }
    return res.status(500).json({ ok: false, error: error.message || "Offboarding execution failed", steps });
  }
});

module.exports = router;
