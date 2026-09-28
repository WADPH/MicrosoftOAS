const { normalizeTenantKey } = require("./tenantConfig");
const { findCompanyMatcherByHints } = require("../parser");

function inferCompanyFromEmail(email) {
  const matcher = findCompanyMatcherByHints({ email: String(email || "").trim().toLowerCase() });
  return String(matcher?.code || "").trim();
}

function buildOffboardingTaskPayload(payload = {}) {
  const user = payload.user || {};
  const tenant = normalizeTenantKey(payload.tenant || user.tenant || "");
  const email = String(payload.email || user.mail || user.userPrincipalName || "").trim().toLowerCase();
  const company = String(payload.company || payload.offboarding?.company || inferCompanyFromEmail(email)).trim();
  const deleteUser = payload.deleteUser !== false;
  const sendLicenseCancelEmail = payload.sendLicenseCancelEmail !== false;
  const accountsToDelete = Array.isArray(payload.accountsToDelete) ? payload.accountsToDelete : [];
  const assetsToCheckin = Array.isArray(payload.assetsToCheckin) ? payload.assetsToCheckin : [];
  const legacyMail = payload.email && typeof payload.email === "object" ? payload.email : {};
  const licenseCancelMail = payload.licenseCancelMail || legacyMail || {};
  return {
    tenant,
    company,
    email,
    deleteUser,
    sendLicenseCancelEmail,
    licenseCancelMail: {
      to: Array.isArray(licenseCancelMail.to) ? licenseCancelMail.to.map((x) => String(x || "").trim()).filter(Boolean) : [],
      cc: Array.isArray(licenseCancelMail.cc) ? licenseCancelMail.cc.map((x) => String(x || "").trim()).filter(Boolean) : [],
      subject: String(licenseCancelMail.subject || `License cancel for ${tenant}`).trim(),
      body: String(
        licenseCancelMail.body ||
          `Hello,\n\nPlease stop the renewal of 1 Microsoft Business Premium license (Monthly) ${company ? `from the ${company} ` : "for the "}${tenant} tenant.\n\nBest regards,\nIT Team`
      )
    },
    user,
    accountsToDelete,
    assetsToCheckin
  };
}

module.exports = {
  inferCompanyFromEmail,
  buildOffboardingTaskPayload
};
