function requireAuth(req, res, next) {
  if (!req.session?.user) {
    console.warn("[auth] Unauthorized access attempt");
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.user = req.session.user;
  next();
}

module.exports = requireAuth;
