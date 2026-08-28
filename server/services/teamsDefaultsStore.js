const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "db", "teamsDefaults.json");

function emptyDefaults() {
  return {
    onboarding: { note: "", mentions: [] },
    offboarding: { note: "", mentions: [] }
  };
}

function normalizeMentions(mentions) {
  if (!Array.isArray(mentions)) return [];
  return mentions
    .map((row) => ({
      id: String(row?.id || "").trim(),
      name: String(row?.name || "").trim(),
      text: String(row?.text || "").trim()
    }))
    .filter((row) => row.id && row.name && row.text);
}

function normalizeSection(section) {
  return {
    note: String(section?.note || "").trim(),
    mentions: normalizeMentions(section?.mentions)
  };
}

function ensureDbFile() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(emptyDefaults(), null, 2), "utf8");
  }
}

function getTeamsDefaults() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return {
      onboarding: normalizeSection(parsed.onboarding),
      offboarding: normalizeSection(parsed.offboarding)
    };
  } catch (error) {
    console.warn(`[teamsDefaultsStore] Failed to read ${DB_PATH}: ${error.message}`);
    return emptyDefaults();
  }
}

function saveTeamsDefault(type, section) {
  const key = String(type).trim().toLowerCase() === "offboarding" ? "offboarding" : "onboarding";
  const current = getTeamsDefaults();
  current[key] = normalizeSection(section);
  fs.writeFileSync(DB_PATH, JSON.stringify(current, null, 2), "utf8");
  return current[key];
}

module.exports = {
  getTeamsDefaults,
  saveTeamsDefault
};
