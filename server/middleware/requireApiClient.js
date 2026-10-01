const crypto = require("crypto");

// Service-to-service access (e.g. the PTO app). Clients are configured in .env:
//   API_CLIENTS=PTO
//   API_CLIENT_PTO_KEY=<long random string>
// and send "Authorization: Bearer <key>".

function hashKey(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function loadApiClients() {
  return String(process.env.API_CLIENTS || "")
    .split(",")
    .map((name) => name.trim().toUpperCase())
    .filter(Boolean)
    .map((name) => ({ name, key: String(process.env[`API_CLIENT_${name}_KEY`] || "").trim() }))
    // Short keys are ignored so a placeholder value can never grant access
    .filter((client) => client.key.length >= 32);
}

function requireApiClient(req, res, next) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ ok: false, error: "Missing API key" });
  }

  // Compare fixed-length hashes so the check takes the same time for every key
  const presented = hashKey(match[1].trim());
  const client = loadApiClients().find((row) => crypto.timingSafeEqual(presented, hashKey(row.key)));
  if (!client) {
    console.warn(`[api-client] Rejected request to ${req.originalUrl} from ${req.ip}`);
    return res.status(401).json({ ok: false, error: "Invalid API key" });
  }

  req.apiClient = client.name;
  next();
}

module.exports = requireApiClient;
