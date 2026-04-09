const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, "..", "..", ".env");

const EDITABLE_KEYS = [
  "REDIRECT_URI",
  "ALLOWED_EMAILS",
  "LICENSE_REQUEST_TO",
  "LICENSE_REQUEST_CC",
  "ASSETS_REQUEST_TO",
  "ASSETS_REQUEST_CC",
  "SNIPEIT_ENABLED",
  "SNIPEIT_LAPTOP_PREFIX",
  "SNIPEIT_MONITOR_PREFIX"
];

const RESTRICTED_KEYS = [
  "PORT",
  "TEAMS_OUTGOING_WEBHOOK_SECRET",
  "TENANT_ID",
  "CLIENT_ID",
  "CLIENT_SECRET",
  "DEFAULT_USAGE_LOCATION",
  "SESSION_SECRET",
  "SNIPEIT_URL",
  "SNIPEIT_API_KEY"
];

const FALLBACK_LEGACY_TENANT_KEY = "EIGROUP";

function normalizeNewlines(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function splitEmailList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function isValidDomain(value) {
  return /^(?=.{1,253}$)(?!-)(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/.test(String(value || "").trim().toLowerCase());
}

function normalizeMatcherKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9_]/g, "");
}

function normalizeTenantKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9_]/g, "");
}

function normalizeCompanyCodeValue(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parseEnvKey(line) {
  const match = String(line || "").match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  return match ? match[1] : null;
}

function parseEnvFileMap() {
  const raw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const lines = raw ? raw.split(/\r?\n/) : [];
  const map = {};

  for (const line of lines) {
    const key = parseEnvKey(line);
    if (!key) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const value = line.slice(idx + 1).trim();
    map[key] = value;
  }

  return map;
}

function normalizeEnvStoredValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function validateEmailList(field, value) {
  const emails = splitEmailList(value);
  for (const email of emails) {
    if (!isValidEmail(email)) {
      const error = new Error(`${field} contains invalid email: ${email}`);
      error.status = 400;
      throw error;
    }
  }
}

function validateRedirectUri(value) {
  const uri = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    const error = new Error("REDIRECT_URI must be a valid URL");
    error.status = 400;
    throw error;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    const error = new Error("REDIRECT_URI must use http or https protocol");
    error.status = 400;
    throw error;
  }
}

function validateUpdates(updates) {
  for (const key of Object.keys(updates || {})) {
    if (!EDITABLE_KEYS.includes(key)) {
      const isRestricted = RESTRICTED_KEYS.includes(key);
      const reason = isRestricted ? "restricted and cannot be edited via UI" : "not supported";
      const error = new Error(`${key} is ${reason}`);
      error.status = 400;
      throw error;
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, "REDIRECT_URI")) {
    validateRedirectUri(updates.REDIRECT_URI);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "ALLOWED_EMAILS")) {
    validateEmailList("ALLOWED_EMAILS", updates.ALLOWED_EMAILS);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "LICENSE_REQUEST_TO")) {
    validateEmailList("LICENSE_REQUEST_TO", updates.LICENSE_REQUEST_TO);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "LICENSE_REQUEST_CC")) {
    validateEmailList("LICENSE_REQUEST_CC", updates.LICENSE_REQUEST_CC);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "ASSETS_REQUEST_TO")) {
    validateEmailList("ASSETS_REQUEST_TO", updates.ASSETS_REQUEST_TO);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "ASSETS_REQUEST_CC")) {
    validateEmailList("ASSETS_REQUEST_CC", updates.ASSETS_REQUEST_CC);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "SNIPEIT_ENABLED")) {
    const value = String(updates.SNIPEIT_ENABLED || "").trim().toLowerCase();
    if (!["true", "false"].includes(value)) {
      const error = new Error("SNIPEIT_ENABLED must be true or false");
      error.status = 400;
      throw error;
    }
    if (value === "true") {
      const url = String(process.env.SNIPEIT_URL || "").trim();
      const key = String(process.env.SNIPEIT_API_KEY || "").trim();
      if (!url || !key) {
        const error = new Error("SNIPEIT_URL and SNIPEIT_API_KEY must be configured in .env before enabling");
        error.status = 400;
        throw error;
      }
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        const error = new Error("SNIPEIT_URL must be a valid URL");
        error.status = 400;
        throw error;
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        const error = new Error("SNIPEIT_URL must use http or https protocol");
        error.status = 400;
        throw error;
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, "SNIPEIT_LAPTOP_PREFIX")) {
    const value = String(updates.SNIPEIT_LAPTOP_PREFIX || "").trim();
    if (!value) {
      const error = new Error("SNIPEIT_LAPTOP_PREFIX is required");
      error.status = 400;
      throw error;
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, "SNIPEIT_MONITOR_PREFIX")) {
    const value = String(updates.SNIPEIT_MONITOR_PREFIX || "").trim();
    if (!value) {
      const error = new Error("SNIPEIT_MONITOR_PREFIX is required");
      error.status = 400;
      throw error;
    }
  }
}

function ensureAllowedPayloadKeys(payload) {
  const allowed = new Set([...EDITABLE_KEYS, "companyMatcher", "companies", "ALLOWED_EMAIL"]);
  for (const key of Object.keys(payload || {})) {
    if (!allowed.has(key)) {
      const isRestricted = RESTRICTED_KEYS.includes(key);
      const reason = isRestricted ? "restricted and cannot be edited via UI" : "not supported";
      const error = new Error(`${key} is ${reason}`);
      error.status = 400;
      throw error;
    }
  }
}

function parseTenantsFromEnvMap(envMap) {
  const explicit = splitCsv(normalizeEnvStoredValue(envMap.TENANTS || "")).map((x) => normalizeTenantKey(x));
  const uniqueExplicit = [...new Set(explicit)].filter(Boolean);
  if (uniqueExplicit.length > 0) return uniqueExplicit;

  const inferred = Object.keys(envMap)
    .map((key) => {
      const m = key.match(/^([A-Z0-9_]+)_TENANT_ID$/);
      return m ? normalizeTenantKey(m[1]) : "";
    })
    .filter(Boolean);
  const uniqueInferred = [...new Set(inferred)].filter(Boolean);
  if (uniqueInferred.length > 0) return uniqueInferred;

  if (envMap.TENANT_ID || envMap.CLIENT_ID || envMap.CLIENT_SECRET) {
    return [FALLBACK_LEGACY_TENANT_KEY];
  }

  return [];
}

function parseCompanyMatchersFromEnvMap(envMap, tenants) {
  const keys = splitCsv(normalizeEnvStoredValue(envMap.COMPANY_MATCHER_KEYS || "")).map((key) => normalizeMatcherKey(key));
  const uniqueKeys = [...new Set(keys)].filter(Boolean);
  const defaultTenant = tenants[0] || "";

  return uniqueKeys.map((key) => ({
    key,
    patterns: normalizeEnvStoredValue(envMap[`COMPANY_MATCHER_${key}_PATTERNS`] || ""),
    domain: normalizeEnvStoredValue(envMap[`COMPANY_MATCHER_${key}_DOMAIN`] || ""),
    code: normalizeCompanyCodeValue(normalizeEnvStoredValue(envMap[`COMPANY_MATCHER_${key}_CODE`] || "")),
    tenant: normalizeTenantKey(normalizeEnvStoredValue(envMap[`COMPANY_MATCHER_${key}_TENANT`] || defaultTenant))
  }));
}

function validateCompanyMatchers(rawList, tenants) {
  if (!Array.isArray(rawList)) {
    const error = new Error("companyMatcher must be an array");
    error.status = 400;
    throw error;
  }

  const seen = new Set();
  const normalized = [];
  const tenantSet = new Set((tenants || []).map((x) => normalizeTenantKey(x)).filter(Boolean));
  if (tenantSet.size === 0 && rawList.length > 0) {
    const error = new Error("TENANTS is not configured in .env");
    error.status = 400;
    throw error;
  }

  for (let i = 0; i < rawList.length; i += 1) {
    const row = rawList[i] || {};
    const key = normalizeMatcherKey(row.key);
    const patterns = splitCsv(row.patterns).join(",");
    const domain = String(row.domain || "").trim().toLowerCase();
    const code = normalizeCompanyCodeValue(row.code);
    const tenant = normalizeTenantKey(row.tenant);
    const indexLabel = `companyMatcher[${i}]`;

    if (!key) {
      const error = new Error(`${indexLabel}.key is required`);
      error.status = 400;
      throw error;
    }
    if (seen.has(key)) {
      const error = new Error(`${indexLabel}.key must be unique (${key})`);
      error.status = 400;
      throw error;
    }
    if (!patterns) {
      const error = new Error(`${indexLabel}.patterns is required`);
      error.status = 400;
      throw error;
    }
    if (!domain || !isValidDomain(domain)) {
      const error = new Error(`${indexLabel}.domain must be a valid domain`);
      error.status = 400;
      throw error;
    }
    if (!code) {
      const error = new Error(`${indexLabel}.code is required`);
      error.status = 400;
      throw error;
    }
    if (!tenant) {
      const error = new Error(`${indexLabel}.tenant is required`);
      error.status = 400;
      throw error;
    }
    if (tenantSet.size > 0 && !tenantSet.has(tenant)) {
      const error = new Error(`${indexLabel}.tenant must be one of TENANTS`);
      error.status = 400;
      throw error;
    }

    seen.add(key);
    normalized.push({ key, patterns, domain, code, tenant });
  }

  return normalized;
}

function getCurrentSettings() {
  const envMap = parseEnvFileMap();
  const tenants = parseTenantsFromEnvMap(envMap);
  const allowedEmail = normalizeEnvStoredValue(envMap.ALLOWED_EMAILS || envMap.ALLOWED_EMAIL || process.env.ALLOWED_EMAILS || process.env.ALLOWED_EMAIL || "");
  return {
    REDIRECT_URI: normalizeEnvStoredValue(envMap.REDIRECT_URI || process.env.REDIRECT_URI || ""),
    ALLOWED_EMAILS: String(allowedEmail),
    LICENSE_REQUEST_TO: normalizeEnvStoredValue(envMap.LICENSE_REQUEST_TO || process.env.LICENSE_REQUEST_TO || ""),
    LICENSE_REQUEST_CC: normalizeEnvStoredValue(envMap.LICENSE_REQUEST_CC || process.env.LICENSE_REQUEST_CC || ""),
    ASSETS_REQUEST_TO: normalizeEnvStoredValue(envMap.ASSETS_REQUEST_TO || process.env.ASSETS_REQUEST_TO || ""),
    ASSETS_REQUEST_CC: normalizeEnvStoredValue(envMap.ASSETS_REQUEST_CC || process.env.ASSETS_REQUEST_CC || ""),
    SNIPEIT_ENABLED: normalizeEnvStoredValue(envMap.SNIPEIT_ENABLED || process.env.SNIPEIT_ENABLED || "false") || "false",
    SNIPEIT_LAPTOP_PREFIX: normalizeEnvStoredValue(envMap.SNIPEIT_LAPTOP_PREFIX || process.env.SNIPEIT_LAPTOP_PREFIX || "PC-") || "PC-",
    SNIPEIT_MONITOR_PREFIX: normalizeEnvStoredValue(envMap.SNIPEIT_MONITOR_PREFIX || process.env.SNIPEIT_MONITOR_PREFIX || "MN-") || "MN-",
    tenants,
    companies: parseCompanyMatchersFromEnvMap(envMap, tenants),
    companyMatcher: parseCompanyMatchersFromEnvMap(envMap, tenants)
  };
}

function formatEnvValue(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (/[#\s"'`]/.test(normalized)) {
    const escaped = normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return normalized;
}

function collectExistingMatcherVarKeys(lines) {
  const keys = new Set();
  for (const line of lines) {
    const key = parseEnvKey(line);
    if (!key) continue;
    if (key === "COMPANY_MATCHER_KEYS" || /^COMPANY_MATCHER_[A-Z0-9_]+_(PATTERNS|DOMAIN|CODE|TENANT)$/.test(key)) {
      keys.add(key);
    }
  }
  return keys;
}

function updateEnvFile(updates, removeKeys = []) {
  const raw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const newline = normalizeNewlines(raw || "\n");
  const lines = raw ? raw.split(/\r?\n/) : [];

  const removeSet = new Set(removeKeys);
  const updateMap = new Map(Object.entries(updates || {}));
  const seenUpdates = new Set();
  const nextLines = [];

  for (const line of lines) {
    const key = parseEnvKey(line);
    if (!key) {
      nextLines.push(line);
      continue;
    }

    if (removeSet.has(key)) {
      continue;
    }

    if (updateMap.has(key)) {
      nextLines.push(`${key}=${formatEnvValue(updateMap.get(key))}`);
      seenUpdates.add(key);
      continue;
    }

    nextLines.push(line);
  }

  for (const [key, value] of updateMap.entries()) {
    if (seenUpdates.has(key)) continue;
    nextLines.push(`${key}=${formatEnvValue(value)}`);
  }

  const content = `${nextLines.join(newline).replace(/[ \t]+$/gm, "")}${newline}`;
  fs.writeFileSync(ENV_PATH, content, "utf8");
}

function applyRuntimeUpdates(updates, removeKeys = []) {
  for (const key of removeKeys) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(updates)) {
    const normalized = String(value ?? "").trim();
    process.env[key] = normalized;
    if (key === "ALLOWED_EMAILS") {
      process.env.ALLOWED_EMAIL = normalized;
    }
  }
}

function buildCompanyMatcherUpdates(companyMatcher, envLines, tenants) {
  const normalized = validateCompanyMatchers(companyMatcher, tenants);
  const updates = {
    COMPANY_MATCHER_KEYS: normalized.map((row) => row.key).join(",")
  };

  for (const row of normalized) {
    updates[`COMPANY_MATCHER_${row.key}_PATTERNS`] = row.patterns;
    updates[`COMPANY_MATCHER_${row.key}_DOMAIN`] = row.domain;
    updates[`COMPANY_MATCHER_${row.key}_CODE`] = row.code;
    updates[`COMPANY_MATCHER_${row.key}_TENANT`] = row.tenant;
  }

  const existingKeys = collectExistingMatcherVarKeys(envLines);
  const removeKeys = [...existingKeys].filter((key) => !Object.prototype.hasOwnProperty.call(updates, key));
  return { updates, removeKeys };
}

function updateSettings(rawUpdates) {
  const payload = { ...(rawUpdates || {}) };
  ensureAllowedPayloadKeys(payload);
  if (
    Object.prototype.hasOwnProperty.call(payload, "companies") &&
    !Object.prototype.hasOwnProperty.call(payload, "companyMatcher")
  ) {
    payload.companyMatcher = payload.companies;
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, "ALLOWED_EMAIL") &&
    !Object.prototype.hasOwnProperty.call(payload, "ALLOWED_EMAILS")
  ) {
    payload.ALLOWED_EMAILS = payload.ALLOWED_EMAIL;
  }

  const updates = {};
  for (const key of EDITABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      updates[key] = String(payload[key] ?? "").trim();
    }
  }

  const hasCompanyMatcher = Object.prototype.hasOwnProperty.call(payload, "companyMatcher");
  if (Object.keys(updates).length === 0 && !hasCompanyMatcher) {
    const error = new Error("No settings provided");
    error.status = 400;
    throw error;
  }

  validateUpdates(updates);

  let matcherUpdates = {};
  let matcherRemoveKeys = [];
  if (hasCompanyMatcher) {
    const raw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
    const lines = raw ? raw.split(/\r?\n/) : [];
    const envMap = parseEnvFileMap();
    const tenants = parseTenantsFromEnvMap(envMap);
    const matcherResult = buildCompanyMatcherUpdates(payload.companyMatcher, lines, tenants);
    matcherUpdates = matcherResult.updates;
    matcherRemoveKeys = matcherResult.removeKeys;
  }

  const allUpdates = { ...updates, ...matcherUpdates };
  updateEnvFile(allUpdates, matcherRemoveKeys);
  applyRuntimeUpdates(allUpdates, matcherRemoveKeys);
  return getCurrentSettings();
}

module.exports = {
  EDITABLE_KEYS,
  RESTRICTED_KEYS,
  getCurrentSettings,
  updateSettings
};
