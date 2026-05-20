function requireAuth(req, res, next) {
  if (!req.session?.user) {
    console.warn("[auth] Unauthorized access attempt");
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.user = req.session.user;
  next();
}

function requireMainAccess(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).send("Forbidden");
  }
  next();
}

function requireProgressAccess(req, res, next) {
  const role = String(req.user?.role || "");
  if (role !== "admin" && role !== "spectator") {
    return res.status(403).send("Forbidden");
  }
  next();
}

module.exports = requireAuth;
module.exports.requireMainAccess = requireMainAccess;
module.exports.requireProgressAccess = requireProgressAccess;
