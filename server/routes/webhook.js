const express = require("express");
const crypto = require("crypto");
const { extractMessageText, flattenPayloadStrings, parseOnboardingMessage, inferDomain, inferCompanyCode } = require("../parser");
const { addTask, NOT_SPECIFIED } = require("../services/taskStore");
const { findUserByDisplayName } = require("../services/graph");
const { createOnboardingTicket } = require("../services/zammad.service");

const router = express.Router();

function parseHmacFromAuthorization(headerValue) {
  const raw = String(headerValue || "").trim();
  if (!raw) return "";

  if (raw.toLowerCase().startsWith("hmac ")) {
    return raw.slice(5).trim();
  }

  return raw;
}

function validateTeamsHmac(req) {
  const signingKey = process.env.TEAMS_OUTGOING_WEBHOOK_SECRET;
  if (!signingKey) {
    console.error("[webhook] Missing TEAMS_OUTGOING_WEBHOOK_SECRET");
    return false;
  }

  const provided = parseHmacFromAuthorization(req.headers.authorization);
  if (!provided) return false;

  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), "utf8");
  const keyBytes = Buffer.from(signingKey, "base64");
  const calculated = crypto.createHmac("sha256", keyBytes).update(rawBody).digest("base64");

  const providedBuf = Buffer.from(provided, "utf8");
  const calculatedBuf = Buffer.from(calculated, "utf8");

  if (providedBuf.length !== calculatedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, calculatedBuf);
}

function chooseValue(...values) {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }
  return "";
}

function mergeParsed(candidates) {
  const merged = {
    fullName: "",
    firstName: "",
    lastName: "",
    company: "",
    position: "",
    phone: "",
    manager: "",
    startDate: "",
    email: ""
  };

  for (const row of candidates) {
    merged.fullName = chooseValue(merged.fullName, row.fullName);
    merged.firstName = chooseValue(merged.firstName, row.firstName);
    merged.lastName = chooseValue(merged.lastName, row.lastName);
    merged.company = chooseValue(merged.company, row.company);
    merged.position = chooseValue(merged.position, row.position);
    merged.phone = chooseValue(merged.phone, row.phone);
    merged.manager = chooseValue(merged.manager, row.manager);
    merged.startDate = chooseValue(merged.startDate, row.startDate);
    merged.email = chooseValue(merged.email, row.email);
  }

  return merged;
}


router.post("/teams", async (req, res) => {
  if (!validateTeamsHmac(req)) {
    return res.status(401).json({
      type: "message",
      text: "Unauthorized webhook signature"
    });
  }

  const messageText = extractMessageText(req.body);
  const flattened = flattenPayloadStrings(req.body);
  const activity = req.body?.activity || {};
  const glueText = [
    messageText,
    flattened,
    activity.subject,
    activity.summary,
    activity.title,
    activity.text,
    req.body?.subject,
    req.body?.text,
    req.body?.body?.content,
    activity.body?.content
  ]
    .filter((x) => x != null && String(x).trim())
    .join("\n");

  if (!glueText.trim()) {
    return res.status(400).json({
      type: "message",
      text: "Empty message payload"
    });
  }

  const parseCandidates = [
    parseOnboardingMessage(glueText),
    parseOnboardingMessage(messageText),
    parseOnboardingMessage(flattened),
    parseOnboardingMessage(String(req.body?.text || "")),
    parseOnboardingMessage(String(req.body?.subject || "")),
    parseOnboardingMessage(String(activity?.text || "")),
    parseOnboardingMessage(String(activity?.subject || "")),
    parseOnboardingMessage(String(req.body?.body?.content || "")),
    parseOnboardingMessage(String(activity?.body?.content || "")),
    parseOnboardingMessage(JSON.stringify(req.body))
  ];
  const parsed = mergeParsed(parseCandidates);

  const combinedText = glueText;
  const hasOnboardingMarker = /\bnew\s*[-\s]*employee\b/i.test(combinedText);
  const hasOnboardingStructure =
    /will\s+join\s+us\s+on/i.test(combinedText) ||
    /company\s*:/i.test(combinedText) ||
    /position\s*:/i.test(combinedText) ||
    /line\s*manager\s*:/i.test(combinedText) ||
    /mobile\s*number\s*:/i.test(combinedText);

  if (!hasOnboardingMarker && !hasOnboardingStructure) {
    console.warn("[webhook] Parse failed. Extracted text:", messageText);
    return res.status(200).json({
      type: "message",
      text: "Message ignored. Onboarding marker not found."
    });
  }

  const company = String(parsed.company || "").trim() || NOT_SPECIFIED;
  const companyDomain = inferDomain(company);
  const companyCode = inferCompanyCode(company);
  const normalized = {
    fullName: String(parsed.fullName || "").trim() || NOT_SPECIFIED,
    firstName: String(parsed.firstName || "").trim() || NOT_SPECIFIED,
    lastName: String(parsed.lastName || "").trim() || NOT_SPECIFIED,
    company,
    companyCode,
    companyDomain,
    position: String(parsed.position || "").trim() || NOT_SPECIFIED,
    phone: String(parsed.phone || "").trim() || NOT_SPECIFIED,
    manager: String(parsed.manager || "").trim() || NOT_SPECIFIED,
    startDate: String(parsed.startDate || "").trim() || NOT_SPECIFIED,
    email:
      String(parsed.email || "").trim() &&
      !String(parsed.email || "").includes("new.user@") &&
      String(parsed.fullName || "").trim()
        ? String(parsed.email).trim()
        : NOT_SPECIFIED
  };

  if (normalized.manager && normalized.manager !== NOT_SPECIFIED) {
    try {
      const matchedManager = await findUserByDisplayName(normalized.manager);
      if (matchedManager && matchedManager.displayName) {
        console.log(`[webhook] Line Manager selected: ${normalized.manager}`);
        normalized.manager = String(matchedManager.displayName).trim();
      }
    } catch (error) {
      console.warn(`[webhook] Manager lookup failed: ${error.message}`);
    }
  }

  const result = addTask(normalized);

  if (result.duplicate) {
    return res.status(200).json({
      type: "message",
      text: `Duplicate ignored: ${normalized.fullName} (${normalized.startDate}) already exists.`
    });
  }

  console.log(`[webhook] Task created: ${result.task.id} for ${result.task.fullName}`);

  // Create Zammad ticket asynchronously (non-blocking)
  const ticketBody = flattenPayloadStrings(req.body) || extractMessageText(req.body) || "Onboarding request created from Microsoft OAS";
  createOnboardingTicket(result.task, {
    webhookPayload: req.body,
    ticketBody
  }).catch((error) => {
    console.error(`[webhook] Zammad ticket creation failed: ${error.message}`);
  });

  return res.status(200).json({
    type: "message",
    text: `Task created for ${result.task.fullName}.`
  });
});

module.exports = router;
