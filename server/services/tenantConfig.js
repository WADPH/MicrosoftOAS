function normalizeTenantKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9_]/g, "");
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((x) => normalizeTenantKey(x))
    .filter(Boolean);
}

function getTenantKeysFromEnv() {
  const explicit = splitCsv(process.env.TENANTS || "");
  if (explicit.length > 0) return [...new Set(explicit)];

  const inferred = Object.keys(process.env)
    .map((key) => {
      const m = key.match(/^([A-Z0-9_]+)_TENANT_ID$/);
      return m ? normalizeTenantKey(m[1]) : "";
    })
    .filter(Boolean);

  if (inferred.length > 0) return [...new Set(inferred)];

  if (process.env.TENANT_ID && process.env.CLIENT_ID && process.env.CLIENT_SECRET) {
    return ["EIGROUP"];
  }

  return [];
}

function getDefaultTenantKey() {
  const keys = getTenantKeysFromEnv();
  return keys[0] || "";
}

function getTenantConfig(tenantKey) {
  const normalized = normalizeTenantKey(tenantKey || getDefaultTenantKey());
  if (!normalized) {
    throw new Error("No tenant is configured. Set TENANTS and tenant credentials in .env.");
  }

  const tenantId =
    process.env[`${normalized}_TENANT_ID`] ||
    (normalized === "EIGROUP" ? process.env.TENANT_ID : "");
  const clientId =
    process.env[`${normalized}_CLIENT_ID`] ||
    (normalized === "EIGROUP" ? process.env.CLIENT_ID : "");
  const clientSecret =
    process.env[`${normalized}_CLIENT_SECRET`] ||
    (normalized === "EIGROUP" ? process.env.CLIENT_SECRET : "");

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      `Missing tenant credentials for ${normalized}. Required: ${normalized}_TENANT_ID, ${normalized}_CLIENT_ID, ${normalized}_CLIENT_SECRET`
    );
  }

  return {
    key: normalized,
    tenantId,
    clientId,
    clientSecret
  };
}

module.exports = {
  normalizeTenantKey,
  getTenantKeysFromEnv,
  getDefaultTenantKey,
  getTenantConfig
};

