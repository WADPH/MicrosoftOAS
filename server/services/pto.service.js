const { getTenantConfig, getDefaultTenantKey, normalizeTenantKey } = require("./tenantConfig");


const POSITIONS_CACHE_MS = 10 * 60 * 1000;

let tokenCache = null;
let positionsCache = null;

function isEnabled() {
  return String(process.env.PTO_ENABLED || "").trim().toLowerCase() === "true";
}

// Tenant whose app credentials are used to get a token for the PTO API.
function getPtoTenantKey() {
  return normalizeTenantKey(process.env.PTO_TENANT || getDefaultTenantKey());
}

function getPtoConfig() {
  const baseUrl = String(process.env.PTO_API_URL || "").trim().replace(/\/+$/, "");
  const scope = String(process.env.PTO_API_SCOPE || "").trim();
  if (!baseUrl || !scope) {
    throw new Error("PTO integration is enabled but PTO_API_URL or PTO_API_SCOPE is missing");
  }
  return { baseUrl, scope, tenant: getTenantConfig(getPtoTenantKey()) };
}

async function getAccessToken() {
  if (tokenCache?.accessToken && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  const { scope, tenant } = getPtoConfig();
  const body = new URLSearchParams({
    client_id: tenant.clientId,
    client_secret: tenant.clientSecret,
    grant_type: "client_credentials",
    scope
  });

  const response = await fetch(`https://login.microsoftonline.com/${tenant.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Failed to get PTO token: ${response.status} ${txt}`);
  }

  const data = await response.json();
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000
  };
  return data.access_token;
}

async function ptoGet(path) {
  const { baseUrl } = getPtoConfig();
  const token = await getAccessToken();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });

  if (response.status === 401) {
    // Token may have been revoked/rotated - force a fresh one on the next call
    tokenCache = null;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const error = new Error(data.message || `PTO request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data.data;
}

async function getPositions() {
  if (positionsCache && Date.now() < positionsCache.expiresAt) {
    return positionsCache.positions;
  }

  const rows = await ptoGet("/api/pto/external/positions");
  const positions = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      name: String(row?.name || "").trim(),
      officialTitle: String(row?.officialTitle || "").trim()
    }))
    .filter((row) => row.name);

  positionsCache = { positions, expiresAt: Date.now() + POSITIONS_CACHE_MS };
  return positions;
}

module.exports = {
  isEnabled,
  getPositions
};
