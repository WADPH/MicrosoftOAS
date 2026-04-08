const { graphRequest } = require("./graph");

const TEST_RECIPIENT = process.env.TEST_RECIPIENT || "";

function parseRecipients(rawValue) {
  if (!rawValue) return [];
  return String(rawValue)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function getRecipientConfig(key) {
  const to = parseRecipients(process.env[`${key}_TO`]);
  const cc = parseRecipients(process.env[`${key}_CC`]);

  if (TEST_RECIPIENT) {
    return {
      to: [TEST_RECIPIENT],
      cc: []
    };
  }

  return { to, cc };
}

function toRecipients(addresses) {
  return addresses.map((address) => ({ emailAddress: { address } }));
}

function normalizeRecipients(value) {
  const list = Array.isArray(value) ? value : [];
  return list.map((x) => String(x || "").trim()).filter(Boolean);
}

async function sendMail({ subject, body, to, cc }) {
  const sender = process.env.MAIL_SENDER_UPN;
  if (!sender) throw new Error("MAIL_SENDER_UPN is not configured");

  return graphRequest("POST", `/users/${encodeURIComponent(sender)}/sendMail`, {
    message: {
      subject,
      body: {
        contentType: "Text",
        content: body
      },
      toRecipients: toRecipients(to),
      ccRecipients: toRecipients(cc)
    },
    saveToSentItems: "true"
  });
}

function buildLicenseMail(task) {
  const recipients = getRecipientConfig("LICENSE_REQUEST");
  return {
    to: normalizeRecipients(task.licenseMail?.to).length ? normalizeRecipients(task.licenseMail?.to) : recipients.to,
    cc: normalizeRecipients(task.licenseMail?.cc).length ? normalizeRecipients(task.licenseMail?.cc) : recipients.cc,
    subject: String(task.licenseMail?.subject || "License request for new employee"),
    body: String(
      task.licenseMail?.body ||
        `Hello,\nWe need 1 Microsoft Business Premium licence with monthly payment on ${task.company} balance.\n\nBest regards,\nIT Team`
    )
  };
}

async function sendLicenseRequestMail(task) {
  const mail = buildLicenseMail(task);
  if (mail.to.length === 0) {
    console.warn("[mail] LICENSE_REQUEST_TO is empty, skipping email");
    return;
  }
  await sendMail({
    subject: mail.subject,
    body: mail.body,
    to: mail.to,
    cc: mail.cc
  });
}

function humanizeAssetList(assets) {
  const selected = Object.entries(assets || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name);

  if (selected.length === 0) return "no assets selected";
  if (selected.length === 1) return selected[0];
  if (selected.length === 2) return `${selected[0]} and ${selected[1]}`;

  return `${selected.slice(0, -1).join(", ")} and ${selected[selected.length - 1]}`;
}

function buildAssetsMail(task) {
  const recipients = getRecipientConfig("ASSETS_REQUEST");
  const assetsSentence = humanizeAssetList(task.assets || {});
  return {
    to: normalizeRecipients(task.assetsMail?.to).length ? normalizeRecipients(task.assetsMail?.to) : recipients.to,
    cc: normalizeRecipients(task.assetsMail?.cc).length ? normalizeRecipients(task.assetsMail?.cc) : recipients.cc,
    subject: String(task.assetsMail?.subject || `Assets request: ${task.fullName}`),
    body: String(task.assetsMail?.body || `Hello,\nWe need ${assetsSentence} for our new employee ${task.fullName}. From ${task.company} balance.\n\nBest regards,\nIT Team`)
  };
}

async function sendAssetsMail(task) {
  const mail = buildAssetsMail(task);
  if (mail.to.length === 0) {
    console.warn("[mail] ASSETS_REQUEST_TO is empty, skipping email");
    return;
  }
  await sendMail({
    subject: mail.subject,
    body: mail.body,
    to: mail.to,
    cc: mail.cc
  });
}

module.exports = {
  sendLicenseRequestMail,
  sendAssetsMail,
  humanizeAssetList,
  buildLicenseMail,
  buildAssetsMail
};
