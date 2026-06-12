const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "db", "asset_statuses.json");

// Asset status constants
const ASSET_STATUS = {
  PENDING: "pending",
  DELIVERED: "delivered"
};

function ensureStore() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({}, null, 2));
  }
}

function readStore() {
  ensureStore();
  try {
    const content = fs.readFileSync(STORE_PATH, "utf8");
    return JSON.parse(content || "{}");
  } catch (error) {
    console.error("[assetStatusStore] Failed to read store:", error.message);
    return {};
  }
}

function writeStore(data) {
  ensureStore();
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("[assetStatusStore] Failed to write store:", error.message);
  }
}

/**
 * Generate a key for storing asset status
 * @param {string} taskId - Task ID
 * @param {string} assetName - Asset name (e.g., "Laptop", "Monitor")
 * @returns {string}
 */
function generateKey(taskId, assetName) {
  return `${String(taskId || "").trim()}_${String(assetName || "").trim()}`;
}

/**
 * Get status for a specific asset
 * @param {string} taskId
 * @param {string} assetName
 * @returns {string} status (pending or delivered)
 */
function getAssetStatus(taskId, assetName) {
  const store = readStore();
  const key = generateKey(taskId, assetName);
  return String(store[key] || ASSET_STATUS.PENDING).toLowerCase();
}

/**
 * Get all statuses for a task
 * @param {string} taskId
 * @returns {Object} Map of assetName -> status
 */
function getTaskAssetStatuses(taskId) {
  const store = readStore();
  const prefix = `${String(taskId || "").trim()}_`;
  const result = {};

  Object.entries(store).forEach(([key, value]) => {
    if (key.startsWith(prefix)) {
      const assetName = key.substring(prefix.length);
      result[assetName] = String(value || ASSET_STATUS.PENDING).toLowerCase();
    }
  });

  return result;
}

/**
 * Set status for a specific asset
 * @param {string} taskId
 * @param {string} assetName
 * @param {string} status - pending or delivered
 */
function setAssetStatus(taskId, assetName, status) {
  const normalizedStatus = String(status || ASSET_STATUS.PENDING).trim().toLowerCase();
  
  if (!Object.values(ASSET_STATUS).includes(normalizedStatus)) {
    throw new Error(`Invalid asset status: ${status}. Must be one of: ${Object.values(ASSET_STATUS).join(", ")}`);
  }

  const store = readStore();
  const key = generateKey(taskId, assetName);
  store[key] = normalizedStatus;
  writeStore(store);

  console.log(`[assetStatusStore] Updated asset status: ${key} = ${normalizedStatus}`);
  return normalizedStatus;
}

/**
 * Toggle asset status between pending and delivered
 * @param {string} taskId
 * @param {string} assetName
 * @returns {string} new status
 */
function toggleAssetStatus(taskId, assetName) {
  const current = getAssetStatus(taskId, assetName);
  const next = current === ASSET_STATUS.PENDING ? ASSET_STATUS.DELIVERED : ASSET_STATUS.PENDING;
  return setAssetStatus(taskId, assetName, next);
}

/**
 * Delete asset status entry
 * @param {string} taskId
 * @param {string} assetName
 */
function deleteAssetStatus(taskId, assetName) {
  const store = readStore();
  const key = generateKey(taskId, assetName);
  delete store[key];
  writeStore(store);
}

/**
 * Clear all statuses for a task
 * @param {string} taskId
 */
function clearTaskAssetStatuses(taskId) {
  const store = readStore();
  const prefix = `${String(taskId || "").trim()}_`;
  const keysToDelete = Object.keys(store).filter((key) => key.startsWith(prefix));
  keysToDelete.forEach((key) => delete store[key]);
  writeStore(store);
}

module.exports = {
  ASSET_STATUS,
  getAssetStatus,
  getTaskAssetStatuses,
  setAssetStatus,
  toggleAssetStatus,
  deleteAssetStatus,
  clearTaskAssetStatuses
};
