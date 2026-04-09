function isEnabled() {
  return String(process.env.SNIPEIT_ENABLED || "false").trim().toLowerCase() === "true";
}

function getBaseUrl() {
  return String(process.env.SNIPEIT_URL || "").trim().replace(/\/+$/, "");
}

function getApiKey() {
  return String(process.env.SNIPEIT_API_KEY || "").trim();
}

function assertEnabled() {
  if (!isEnabled()) {
    const error = new Error("Snipe-IT integration is disabled");
    error.status = 400;
    throw error;
  }
}

function assertConfigured() {
  const baseUrl = getBaseUrl();
  const apiKey = getApiKey();
  if (!baseUrl || !apiKey) {
    const error = new Error("SNIPEIT_URL or SNIPEIT_API_KEY is not configured");
    error.status = 400;
    throw error;
  }
  return { baseUrl, apiKey };
}

function isReadyToDeploy(statusLabel) {
  const raw = String(statusLabel || "").trim().toLowerCase();
  if (!raw) return true;
  return raw.includes("ready") && raw.includes("deploy");
}

function normalizeHardware(item) {
  const assignedTo = item?.assigned_to;
  const statusLabel =
    item?.status_label?.name || item?.status_label?.status_meta || item?.status_label?.status_type || item?.status_label || "";

  return {
    id: Number(item?.id),
    asset_tag: String(item?.asset_tag || "").trim(),
    model: String(item?.model?.name || item?.model_number || item?.model || "").trim(),
    notes: String(item?.notes || "").trim(),
    companyName: String(item?.company?.name || item?.company || "").trim(),
    assigned_to: assignedTo || null,
    status_label: String(statusLabel || "").trim()
  };
}

async function snipeitRequest(method, endpoint, body) {
  assertEnabled();
  const { baseUrl, apiKey } = assertConfigured();

  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const raw = await response.text();
  let json = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = {};
  }

  if (!response.ok) {
    const error = new Error(json?.messages || json?.message || raw || `Snipe-IT request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return json;
}

async function getAssetsByPrefix(prefix, limit = 200) {
  const normalizedPrefix = String(prefix || "").trim();
  if (!normalizedPrefix) return [];

  const pageSize = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const query = `/hardware?limit=${pageSize}&search=${encodeURIComponent(normalizedPrefix)}`;
  const data = await snipeitRequest("GET", query);
  const rows = Array.isArray(data?.rows) ? data.rows : [];

  return rows
    .map(normalizeHardware)
    .filter((item) => item.asset_tag.startsWith(normalizedPrefix))
    .filter((item) => item.assigned_to == null)
    .filter((item) => isReadyToDeploy(item.status_label))
    .sort((a, b) => String(b.asset_tag || "").localeCompare(String(a.asset_tag || ""), undefined, { numeric: true, sensitivity: "base" }));
}

async function getAssetByTag(assetTag) {
  const normalizedTag = String(assetTag || "").trim();
  if (!normalizedTag) return null;
  const data = await snipeitRequest("GET", `/hardware?limit=50&search=${encodeURIComponent(normalizedTag)}`);
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const exact = rows.map(normalizeHardware).find((item) => item.asset_tag === normalizedTag);
  return exact || null;
}

async function getUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;

  const data = await snipeitRequest("GET", `/users?limit=50&search=${encodeURIComponent(normalized)}`);
  const rows = Array.isArray(data?.rows) ? data.rows : [];

  const exact = rows.find((user) => {
    const userEmail = String(user?.email || "").trim().toLowerCase();
    const username = String(user?.username || "").trim().toLowerCase();
    return userEmail === normalized || username === normalized;
  });

  return exact || null;
}

async function assignAsset(assetId, userId) {
  const hardwareId = Number(assetId);
  const targetUser = Number(userId);
  if (!Number.isFinite(hardwareId) || !Number.isFinite(targetUser)) {
    const error = new Error("Invalid assetId or userId");
    error.status = 400;
    throw error;
  }

  return snipeitRequest("POST", `/hardware/${hardwareId}/checkout`, {
    checkout_to_type: "user",
    assigned_user: targetUser
  });
}

function getSnipeitConfig() {
  return {
    enabled: isEnabled(),
    url: getBaseUrl(),
    laptopPrefix: String(process.env.SNIPEIT_LAPTOP_PREFIX || "PC-").trim(),
    monitorPrefix: String(process.env.SNIPEIT_MONITOR_PREFIX || "MN-").trim()
  };
}

module.exports = {
  isEnabled,
  getSnipeitConfig,
  getAssetsByPrefix,
  getAssetByTag,
  getUserByEmail,
  assignAsset,
  assertEnabled
};
