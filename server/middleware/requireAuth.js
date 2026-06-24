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

function requireHrAccess(req, res, next) {
  if (!req.user || req.user.role !== "hr") {
    return res.status(403).send("Forbidden");
  }
  next();
}

function requireProgressAccess(req, res, next) {
  const role = String(req.user?.role || "");
  if (role !== "admin" && role !== "spectator" && role !== "hr") {
    return res.status(403).send("Forbidden");
  }
  next();
}

function requireProgressEditAccess(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden - only admins can edit asset statuses" });
  }
  next();
}

module.exports = requireAuth;
module.exports.requireMainAccess = requireMainAccess;
module.exports.requireHrAccess = requireHrAccess;
module.exports.requireProgressAccess = requireProgressAccess;
module.exports.requireProgressEditAccess = requireProgressEditAccess;
