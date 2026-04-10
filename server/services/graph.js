const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const { normalizeTenantKey, getDefaultTenantKey, getTenantConfig } = require("./tenantConfig");

const tokenCache = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error.status || 0;
      const retriable = status >= 500 || status === 429 || status === 0;

      if (!retriable || attempt === attempts) break;

      const backoffMs = 300 * attempt;
      console.warn(`[graph] Retry ${attempt}/${attempts} in ${backoffMs}ms`);
      await delay(backoffMs);
    }
  }

  throw lastError;
}

async function getAccessToken(tenantKey) {
  const tenant = getTenantConfig(tenantKey);
  const cacheKey = tenant.key;
  const cached = tokenCache.get(cacheKey);
  if (cached?.accessToken && Date.now() < cached.expiresAt - 60_000) {
    return cached.accessToken;
  }

  const body = new URLSearchParams({
    client_id: tenant.clientId,
    client_secret: tenant.clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default"
  });

  const response = await fetch(`https://login.microsoftonline.com/${tenant.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Failed to get Graph token: ${response.status} ${txt}`);
  }

  const data = await response.json();
  tokenCache.set(cacheKey, {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000
  });

  return data.access_token;
}

async function graphRequest(method, path, body, tenantKey) {
  return withRetry(async () => {
    const token = await getAccessToken(tenantKey);

    const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const errText = await response.text();
      const error = new Error(`Graph request failed ${method} ${path}: ${response.status} ${errText}`);
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) return null;

    const raw = await response.text();
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw);
  });
}

async function getUserByEmail(email, tenantKey) {
  try {
    return await graphRequest("GET", `/users/${encodeURIComponent(email)}`, undefined, tenantKey);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function listUsers(search = "", limit = 200, tenantKey, options = {}) {
  const normalized = String(search || "").trim().replace(/'/g, "''");
  const cappedLimit = Math.min(Math.max(Number(limit) || 1, 1), 999);
  const queryParts = [`$select=displayName,givenName,surname,mail,id,userPrincipalName,userType,accountEnabled`, `$top=${cappedLimit}`];

  if (normalized) {
    const pieces = normalized.split(/\s+/).filter(Boolean);
    let filter = `startswith(displayName,'${normalized}') or startswith(givenName,'${pieces[0]}') or startswith(surname,'${pieces[pieces.length - 1]}')`;
    if (pieces.length >= 2) {
      const first = pieces[0];
      const last = pieces[pieces.length - 1];
      filter = `startswith(displayName,'${normalized}') or startswith(displayName,'${last} ${first}') or (startswith(givenName,'${first}') and startswith(surname,'${last}'))`;
    }
    queryParts.push(`$filter=${encodeURIComponent(filter)}`);
  }

  const path = `/users?${queryParts.join("&")}`;
  const result = await graphRequest("GET", path, undefined, tenantKey);
  const users = Array.isArray(result?.value) ? result.value : [];
  const excludeGuests = options.excludeGuests !== false;
  const excludeDisabled = options.excludeDisabled !== false;
  return users.filter((user) => {
    const upn = String(user.userPrincipalName || "").toLowerCase();
    const userType = String(user.userType || "").toLowerCase();
    const isGuest = upn.includes("#ext#") || userType === "guest";
    const isDisabled = user.accountEnabled === false;
    if (excludeGuests && isGuest) return false;
    if (excludeDisabled && isDisabled) return false;
    return true;
  });
}

async function findUserByDisplayName(displayName, tenantKey) {
  const raw = String(displayName || "").trim();
  if (!raw) return null;

  const users = await listUsers(raw, 50, tenantKey);
  const normalized = raw.toLowerCase();

  const exact = users.find((user) => String(user.displayName || "").toLowerCase() === normalized);
  if (exact) return exact;

  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0].toLowerCase();
    const last = parts[parts.length - 1].toLowerCase();
    const byName = users.find(
      (user) =>
        String(user.givenName || "").toLowerCase() === first &&
        String(user.surname || "").toLowerCase() === last
    );
    if (byName) return byName;
  }

  return users[0] || null;
}

async function assignManager(userIdentifier, managerDisplayName, tenantKey) {
  try {
    const manager = await findUserByDisplayName(managerDisplayName, tenantKey);
    if (!manager || !manager.id) {
      console.log(`[graph] Manager not found for: ${managerDisplayName}`);
      return { success: false, reason: `Manager not found: ${managerDisplayName}` };
    }

    const managerId = manager.id;
    const path = `/users/${encodeURIComponent(userIdentifier)}/manager/$ref`;
    const body = {
      "@odata.id": `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(managerId)}`
    };

    await graphRequest("PUT", path, body, tenantKey);
    console.log(`[graph] Manager assigned: ${userIdentifier} -> ${managerDisplayName}`);
    return { success: true, reason: "Manager assigned", manager: { displayName: manager.displayName, mail: manager.mail } };
  } catch (error) {
    console.error(`[graph] Failed to assign manager to ${userIdentifier}: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

function buildMailNickname(email) {
  return String(email || "")
    .split("@")[0]
    .replace(/[^a-zA-Z0-9._-]/g, "");
}

function generateInitialPassword() {
  const stamp = Date.now().toString(36).slice(-6);
  return `Temp#${stamp}Aa1!`;
}

async function createUser(task, tenantKey) {
  const usageLocation = String(process.env.DEFAULT_USAGE_LOCATION || "AZ").trim().toUpperCase();
  const payload = {
    accountEnabled: true,
    displayName: task.fullName,
    mailNickname: buildMailNickname(task.email),
    userPrincipalName: task.email,
    givenName: task.firstName || undefined,
    surname: task.lastName || undefined,
    companyName: task.company || undefined,
    usageLocation,
    jobTitle: task.position || undefined,
    mobilePhone: task.phone || undefined,
    passwordProfile: {
      forceChangePasswordNextSignIn: true,
      password: generateInitialPassword()
    }
  };

  return graphRequest("POST", "/users", payload, tenantKey);
}

async function updateUserUsageLocation(userIdentifier, usageLocation, tenantKey) {
  return graphRequest("PATCH", `/users/${encodeURIComponent(userIdentifier)}`, {
    usageLocation: String(usageLocation || "").trim().toUpperCase()
  }, tenantKey);
}

/**
 * After createUser Graph can briefly return 404 on subsequent operations.
 * Polls /users/{email} until it is visible (or we give up).
 */
async function waitForUserProvisioning(email, attempts = 10, tenantKey) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const user = await getUserByEmail(email, tenantKey);
      if (user) return user;
      lastError = new Error("User still not found");
    } catch (error) {
      lastError = error;
    }

    const waitMs = 1000;
    console.warn(`[graph] waitForUserProvisioning: user not visible yet, retry ${attempt}/${attempts} in ${waitMs}ms`);
    await delay(waitMs);
  }

  throw lastError || new Error("User not visible after provisioning retries");
}

async function getSubscribedSkus(tenantKey) {
  const data = await graphRequest("GET", "/subscribedSkus", undefined, tenantKey);
  return data?.value || [];
}

function findBusinessPremiumSku(skus) {
  return skus.find((sku) => {
    const key = String(sku.skuPartNumber || "").toLowerCase();
    return (
      key.includes("business_premium") ||
      key === "spb" ||
      key.includes("m365_business_premium") ||
      key.includes("microsoft_365_business_premium")
    );
  }) || null;
}

function hasAvailableSeats(sku) {
  if (!sku?.prepaidUnits) return false;

  const enabled = Number(sku.prepaidUnits.enabled || 0);
  const consumed = Number(sku.consumedUnits || 0);
  return enabled - consumed > 0;
}

async function assignLicense(email, skuId, tenantKey) {
  return graphRequest("POST", `/users/${encodeURIComponent(email)}/assignLicense`, {
    addLicenses: [{ skuId }],
    removeLicenses: []
  }, tenantKey);
}

/**
 * Newly created users can briefly return 404 on assignLicense; retry a few times.
 */
async function assignLicenseWithRetry(email, skuId, attempts = 5, tenantKey) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await assignLicense(email, skuId, tenantKey);
    } catch (error) {
      lastError = error;
      const status = error.status || 0;
      if (status === 404 && attempt < attempts) {
        const waitMs = 800 * attempt;
        console.warn(`[graph] assignLicense 404, retry ${attempt}/${attempts} in ${waitMs}ms`);
        await delay(waitMs);
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

async function deleteUserById(userId, tenantKey) {
  if (!String(userId || "").trim()) {
    const error = new Error("userId is required");
    error.status = 400;
    throw error;
  }
  return graphRequest("DELETE", `/users/${encodeURIComponent(String(userId).trim())}`, undefined, tenantKey);
}

module.exports = {
  normalizeTenantKey,
  getDefaultTenantKey,
  getUserByEmail,
  listUsers,
  findUserByDisplayName,
  assignManager,
  createUser,
  updateUserUsageLocation,
  waitForUserProvisioning,
  getSubscribedSkus,
  findBusinessPremiumSku,
  hasAvailableSeats,
  assignLicense,
  assignLicenseWithRetry,
  deleteUserById,
  graphRequest
};
