const msal = require("@azure/msal-node");
const { getTenantConfig } = require("./tenantConfig");

function getMsalClient() {
  const tenant = getTenantConfig();
  const msalConfig = {
    auth: {
      clientId: tenant.clientId,
      authority: `https://login.microsoftonline.com/${tenant.tenantId}`,
      clientSecret: tenant.clientSecret
    },
    system: {
      loggerOptions: {
        loggerCallback(loglevel, message) {
          if (loglevel === msal.LogLevel.Error) {
            console.error(`[msal] ${message}`);
          }
        },
        piiLoggingEnabled: false,
        logLevel: msal.LogLevel.Warning
      }
    }
  };
  return new msal.ConfidentialClientApplication(msalConfig);
}

function getRedirectUri() {
  return process.env.REDIRECT_URI || "http://localhost:3000/auth/callback";
}

async function getAuthCodeUrl(req) {
  const authCodeUrlParameters = {
    scopes: ["openid", "profile", "email"],
    redirectUri: getRedirectUri(),
    state: req.sessionID
  };

  return await getMsalClient().getAuthCodeUrl(authCodeUrlParameters);
}

async function handleAuthCallback(code) {
  const tokenRequest = {
    code,
    scopes: ["openid", "profile", "email"],
    redirectUri: getRedirectUri()
  };

  try {
    const response = await getMsalClient().acquireTokenByCode(tokenRequest);
    return response;
  } catch (error) {
    console.error("[auth] Token acquisition failed", error.message);
    throw error;
  }
}

function parseUserFromToken(tokenResponse) {
  const claims = tokenResponse.idTokenClaims || {};

  return {
    oid: String(claims.oid || ""),
    email: String(claims.preferred_username || claims.email || ""),
    name: String(claims.name || ""),
    tid: String(claims.tid || ""),
    groups: Array.isArray(claims.groups) ? claims.groups : []
  };
}

function isUserAllowed(user) {
  const source = process.env.ALLOWED_EMAILS || process.env.ALLOWED_EMAIL || "";
  const allowedEmails = String(source)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowedEmails.length === 0) {
    console.warn("[auth] ALLOWED_EMAILS not configured, denying all access");
    return false;
  }

  const userEmail = String(user.email || "").toLowerCase();
  const allowed = allowedEmails.includes(userEmail);

  if (!allowed) {
    console.warn(`[auth] User ${userEmail} not in whitelist`);
  }

  return allowed;
}

module.exports = {
  getAuthCodeUrl,
  handleAuthCallback,
  parseUserFromToken,
  isUserAllowed
};
