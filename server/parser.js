const normalizeText = (value) => String(value || "").trim();

function cleanInlineField(value) {
  return normalizeText(value)
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LABELS = ["Company", "Position", "Name", "Mobile number", "Line Manager"];

function sanitizeText(input) {
  return String(input || "")
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\u00a0/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function flattenPayloadStrings(payload) {
  const seen = new Set();
  const acc = [];

  function walk(value) {
    if (value == null) return;
    if (typeof value === "string") {
      const clean = sanitizeText(value);
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        acc.push(clean);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value === "object") {
      for (const key of Object.keys(value)) {
        walk(value[key]);
      }
    }
  }

  walk(payload);
  return acc.join("\n");
}

function extractAdaptiveCardText(content) {
  if (!content || typeof content !== "object") return "";
  const parts = [];

  function walk(node) {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object") return;
    if (node.type === "TextBlock" && typeof node.text === "string") {
      parts.push(node.text);
    }
    if (Array.isArray(node.body)) {
      for (const item of node.body) walk(item);
    }
    if (Array.isArray(node.items)) {
      for (const item of node.items) walk(item);
    }
    if (Array.isArray(node.columns)) {
      for (const col of node.columns) walk(col);
    }
  }

  walk(content);
  return parts.join("\n");
}

function extractAttachmentStrings(attachments) {
  if (!Array.isArray(attachments)) return "";
  const chunks = [];
  for (const attachment of attachments) {
    const ct = String(attachment?.contentType || "");
    if (ct.includes("adaptive") && attachment?.content && typeof attachment.content === "object") {
      const t = extractAdaptiveCardText(attachment.content);
      if (t) chunks.push(t);
    }
    if (attachment?.content?.text) chunks.push(String(attachment.content.text));
    if (typeof attachment?.content === "string") chunks.push(attachment.content);
    if (attachment?.text) chunks.push(String(attachment.text));
  }
  return chunks.join("\n");
}

function dedupeOrderedStrings(chunks) {
  const seen = new Set();
  const out = [];
  for (const c of chunks) {
    if (typeof c !== "string" || !c.trim()) continue;
    const key = c.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function collectHeadlineStrings(root) {
  const activity = root?.activity || root;
  const list = [
    activity?.subject,
    activity?.summary,
    activity?.title,
    activity?.topicName,
    activity?.name,
    root?.subject,
    root?.title,
    root?.topicName,
    root?.summary,
    root?.channelData?.topicName,
    root?.channelData?.subject,
    activity?.channelData?.topicName,
    activity?.channelData?.subject
  ];
  return dedupeOrderedStrings(list.filter((x) => typeof x === "string" && x.trim()));
}

function extractMessageText(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return sanitizeText(payload);

  const activity = payload.activity || payload;
  const headlines = collectHeadlineStrings(payload);

  const bodyChunks = [
    ...headlines,
    payload.activity?.text,
    activity?.text,
    payload.text,
    payload.message,
    typeof payload.content === "string" ? payload.content : "",
    activity?.body?.text,
    activity?.body?.content,
    payload.body?.text,
    payload.body?.content,
    payload.value?.text,
    payload.value?.content,
    payload.data?.text,
    payload.data?.content
  ].filter((x) => typeof x === "string" && x.trim());

  const attFromRoot = extractAttachmentStrings(payload.attachments);
  const attFromActivity = extractAttachmentStrings(activity?.attachments);
  if (attFromRoot) bodyChunks.push(attFromRoot);
  if (attFromActivity) bodyChunks.push(attFromActivity);

  const joined = dedupeOrderedStrings(bodyChunks).join("\n").trim();
  if (joined) {
    return sanitizeText(joined);
  }

  return sanitizeText(flattenPayloadStrings(payload));
}

function normalizeCompanyKey(company) {
  return String(company || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const DEFAULT_COMPANY_MATCHERS = [
  {
    key: "EILINK",
    patterns: ["eilink", "eilinkllc"],
    domain: "eilink.az",
    code: "EILINK"
  },
  {
    key: "DRL",
    patterns: ["digitalresearchlab", "drl", "drlllc"],
    domain: "researchlab.digital",
    code: "DRL"
  },
  {
    key: "EIG",
    patterns: ["eigroup", "eigroupllc", "eig", "eigcom", "eigllc"],
    domain: "ei-g.com",
    code: "EIG"
  }
];

function parseEnvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function loadCompanyMatcherKeys() {
  return String(process.env.COMPANY_MATCHER_KEYS || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function buildCompanyMatchers() {
  const keys = loadCompanyMatcherKeys();
  if (keys.length === 0) {
    return DEFAULT_COMPANY_MATCHERS;
  }

  return keys
    .map((key) => ({
      key,
      patterns: parseEnvList(process.env[`COMPANY_MATCHER_${key}_PATTERNS`]),
      domain: String(process.env[`COMPANY_MATCHER_${key}_DOMAIN`] || "").trim() || "ei-g.com",
      code: String(process.env[`COMPANY_MATCHER_${key}_CODE`] || "").trim() || key
    }))
    .filter((matcher) => matcher.patterns.length > 0);
}

const COMPANY_MATCHERS = buildCompanyMatchers();

function findCompanyMatcher(company) {
  const normalized = normalizeCompanyKey(company);
  return COMPANY_MATCHERS.find((matcher) =>
    matcher.patterns.some((pattern) => normalized.includes(pattern))
  );
}

function inferCompanyInfo(company) {
  const matcher = findCompanyMatcher(company);
  if (matcher) {
    return {
      domain: matcher.domain || "ei-g.com",
      code: matcher.code || "EIG"
    };
  }
  return { domain: "ei-g.com", code: "EIG" };
}

function getCompanyMatcherOptions() {
  const seenDomains = new Set();
  const seenCodes = new Set();
  const domains = [];
  const codes = [];

  for (const matcher of COMPANY_MATCHERS) {
    const domain = String(matcher.domain || "").trim();
    const code = String(matcher.code || "").trim();
    if (domain && !seenDomains.has(domain)) {
      seenDomains.add(domain);
      domains.push(domain);
    }
    if (code && !seenCodes.has(code)) {
      seenCodes.add(code);
      codes.push(code);
    }
  }

  if (!seenDomains.has("ei-g.com")) {
    domains.push("ei-g.com");
  }
  if (!seenCodes.has("EIG")) {
    codes.push("EIG");
  }

  return { domains, codes };
}

function inferDomain(company) {
  return inferCompanyInfo(company).domain;
}

function inferCompanyCode(company) {
  return inferCompanyInfo(company).code;
}

function normalizeNamePart(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function splitName(fullName) {
  const clean = normalizeText(fullName).replace(/\s+/g, " ");
  const parts = clean.split(" ").filter(Boolean);

  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function tryParseDateToIso(raw) {
  const clean = String(raw || "").replace(/[.]+$/, "").trim();
  const date = new Date(clean);

  if (Number.isNaN(date.getTime())) return clean;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function generateEmail(firstName, lastName, company) {
  const domain = inferDomain(company);
  const first = normalizeNamePart(firstName);
  const last = normalizeNamePart(lastName);
  const local = [first, last].filter(Boolean).join(".") || normalizeNamePart(firstName || "new.user") || "new.user";

  return `${local}@${domain}`;
}

function insertLineBreaksBeforeLabels(raw) {
  let t = String(raw || "");
  const glued = [
    [/([a-zA-Z0-9])(Company\s*:)/gi, "$1\n$2"],
    [/([a-zA-Z0-9])(Position\s*:)/gi, "$1\n$2"],
    [/([a-zA-Z0-9])(Name\s*:)/gi, "$1\n$2"],
    [/([a-zA-Z0-9])(Mobile\s+number\s*:)/gi, "$1\n$2"],
    [/([a-zA-Z0-9])(Line\s+Manager\s*:)/gi, "$1\n$2"]
  ];
  for (const [re, rep] of glued) {
    t = t.replace(re, rep);
  }
  return t.replace(/\s+(Company|Position|Name|Mobile number|Line Manager)\s*:/gi, "\n$1:");
}

function fillFromLabeledLines(text, base) {
  const re = /^\s*(Company|Position|Name|Mobile number|Line Manager)\s*:\s*(.+)$/gim;
  let m;
  while ((m = re.exec(text)) !== null) {
    const label = m[1].toLowerCase();
    const val = cleanInlineField(m[2]);
    if (!val) continue;
    if (label === "company" && !base.company) base.company = val;
    if (label === "position" && !base.position) base.position = val;
    if (label === "name" && !base.fullName) base.fullName = val;
    if (label === "mobile number" && !base.phone) base.phone = val;
    if (label === "line manager" && !base.manager) base.manager = val;
  }
}

function parseOnboardingMessage(messageText) {
  const text = insertLineBreaksBeforeLabels(sanitizeText(messageText));

  function findField(label) {
    const escaped = label.replace(/\s+/g, "\\s+");
    const others = LABELS.filter((x) => x !== label).map((x) => x.replace(/\s+/g, "\\s+"));
    const pattern = new RegExp(
      `(?:^|\\n|\\s)${escaped}\\s*:\\s*(.+?)(?=(?:\\n|\\s)(?:${others.join("|")})\\s*:|$)`,
      "i"
    );
    const match = text.match(pattern);
    return cleanInlineField(match?.[1]);
  }

  const fullNameMatch =
    text.match(
      /new\s+employee\s*[-:]\s*(.+?)(?=\s*(?:dear\s+colleagues|will\s+join\s+us\s+on|company:|position:|name:|mobile\s+number:|line\s+manager:|$))/i
    ) ||
    text.match(/(?:^|\n)\s*new\s+employee\s*[-:]\s*(.+?)(?:\s*$)/im) ||
    text.match(/(?:^|\n|\s)\s*Name:\s*(.+?)(?=(?:\n|\s)(?:Company|Position|Mobile\s+number|Line\s+Manager)\s*:|$)/i);
  const labeledName =
    (() => {
      const escaped = "Name".replace(/\s+/g, "\\s+");
      const others = ["Company", "Position", "Mobile number", "Line Manager"].map((x) => x.replace(/\s+/g, "\\s+"));
      const pattern = new RegExp(
        `(?:^|\\n|\\s)${escaped}\\s*:\\s*(.+?)(?=(?:\\n|\\s)(?:${others.join("|")})\\s*:|$)`,
        "i"
      );
      return cleanInlineField(text.match(pattern)?.[1]);
    })();
  let fullName = labeledName || cleanInlineField(fullNameMatch?.[1]) || "";

  const startDateMatch =
    text.match(/will\s+join\s+us\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i) ||
    text.match(/join\s+us\s+on\s+([^\n.]+)/i) ||
    text.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/);
  let company = findField("Company");
  let position = findField("Position");
  let phone = findField("Mobile number");
  let manager = findField("Line Manager");

  const loose = { fullName, company, position, phone, manager };
  fillFromLabeledLines(text, loose);
  fullName = loose.fullName || fullName;
  company = company || loose.company;
  position = position || loose.position;
  phone = phone || loose.phone;
  manager = manager || loose.manager;

  const { firstName, lastName } = splitName(fullName);

  return {
    fullName,
    firstName,
    lastName,
    company,
    companyCode: inferCompanyCode(company),
    position,
    phone,
    manager,
    startDate: tryParseDateToIso(startDateMatch?.[1] || ""),
    email: generateEmail(firstName, lastName, company)
  };
}

module.exports = {
  extractMessageText,
  flattenPayloadStrings,
  parseOnboardingMessage,
  inferDomain,
  inferCompanyCode,
  getCompanyMatcherOptions,
  generateEmail
};
