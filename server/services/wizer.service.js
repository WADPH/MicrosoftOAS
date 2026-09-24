const DEFAULT_WIZER_API_URL = "https://gateway.wizer-training.com";

function isEnabled() {
  return String(process.env.WIZER_ENABLED || "false").trim().toLowerCase() === "true";
}

function getBaseUrl() {
  return String(process.env.WIZER_API_URL || DEFAULT_WIZER_API_URL).trim().replace(/\/+$/, "");
}

function getApiKey() {
  return String(process.env.WIZER_API_KEY || "").trim();
}

function getCompanyId() {
  return String(process.env.WIZER_COMPANY_ID || "").trim();
}

function assertEnabled() {
  if (!isEnabled()) {
    const error = new Error("Wizer integration is disabled");
    error.status = 400;
    throw error;
  }
}

function assertConfigured() {
  const apiKey = getApiKey();
  const companyId = getCompanyId();
  if (!apiKey || !companyId) {
    const error = new Error("WIZER_API_KEY or WIZER_COMPANY_ID is not configured");
    error.status = 400;
    throw error;
  }
  return { baseUrl: getBaseUrl(), apiKey, companyId };
}

async function wizerRequest(method, path) {
  assertEnabled();
  const { baseUrl, apiKey } = assertConfigured();

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      apiKey,
      Accept: "application/json"
    }
  });

  const raw = await response.text();
  let json = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = {};
  }

  if (!response.ok) {
    const message = json?.error?.message || json?.message || raw || `Wizer request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return json;
}

// The OpenAPI spec leaves the Fetch Users response schema undocumented, so accept the common envelope shapes.
function extractUserItems(json) {
  const data = json?.data;
  const candidates = [data?.items, data?.users, data?.data, json?.items, json?.users, data, json];
  return candidates.find((value) => Array.isArray(value)) || [];
}

function normalizeWizerUser(item) {
  const disablementStatus = String(item?.disablementStatus || "").trim();
  return {
    id: String(item?.id || item?.userId || item?._id || "").trim(),
    email: String(item?.email || "").trim().toLowerCase(),
    firstName: String(item?.firstName || item?.name || "").trim(),
    lastName: String(item?.lastName || "").trim(),
    role: String(item?.role || "").trim(),
    isDisabled: item?.isDisabled === true || Boolean(item?.disabledAt) || /^disabled$/i.test(disablementStatus)
  };
}

async function findUsersByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return [];

  const { companyId } = assertConfigured();
  const query = new URLSearchParams({ searchText: normalizedEmail, pageSize: "25", pageNumber: "0" });
  const json = await wizerRequest("GET", `/customers/api/v1/external/company/${encodeURIComponent(companyId)}/users?${query}`);

  // searchText also matches first/last name, so keep exact email matches only.
  return extractUserItems(json)
    .map(normalizeWizerUser)
    .filter((user) => user.email === normalizedEmail);
}

// Wizer's public API has no delete-user endpoint; disabling by email is the only offboarding action it exposes.
async function disableUserByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    const error = new Error("email is required");
    error.status = 400;
    throw error;
  }
  return wizerRequest("PATCH", `/api/v1/external/user/by_email/${encodeURIComponent(normalizedEmail)}/disable`);
}

module.exports = {
  isEnabled,
  findUsersByEmail,
  disableUserByEmail
};
