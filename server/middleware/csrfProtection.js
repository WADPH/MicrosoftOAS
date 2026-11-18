// CSRF protection for cookie-session routes.
// State-changing requests must be JSON (a cross-site HTML form cannot send application/json
// without a CORS preflight, which this app never allows) and, when the browser sends an
// Origin header, it must match the host serving the app.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = "";
    }
    // Behind a reverse proxy the public host arrives in X-Forwarded-Host (a browser form cannot set it)
    const allowedHosts = [req.get("host"), ...String(req.get("x-forwarded-host") || "").split(",")]
      .map((host) => String(host || "").trim().toLowerCase())
      .filter(Boolean);
    if (!originHost || !allowedHosts.includes(originHost.toLowerCase())) {
      console.warn(`[csrf] Blocked ${req.method} ${req.originalUrl}: origin ${origin} does not match host`);
      return res.status(403).json({ ok: false, error: "Cross-site request blocked" });
    }
  }

  // HTML forms always send a form/text Content-Type (even with an empty body), so any
  // non-JSON Content-Type is rejected. Body-less requests (fetch DELETE) send none and pass.
  const contentType = req.get("content-type");
  const hasBody = Number(req.get("content-length") || 0) > 0 || Boolean(req.get("transfer-encoding"));
  if ((contentType || hasBody) && !req.is("application/json")) {
    console.warn(`[csrf] Blocked ${req.method} ${req.originalUrl}: content-type ${req.get("content-type") || "none"}`);
    return res.status(415).json({ ok: false, error: "Content-Type must be application/json" });
  }

  next();
}

module.exports = csrfProtection;
