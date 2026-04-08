const express = require("express");
const { getAuthCodeUrl, handleAuthCallback, parseUserFromToken, isUserAllowed } = require("../services/auth");

const router = express.Router();

router.get("/login", async (req, res) => {
  try {
    const authCodeUrl = await getAuthCodeUrl(req);
    console.log("[auth] Redirecting to login", authCodeUrl.split("?")[0]);
    res.redirect(authCodeUrl);
  } catch (error) {
    console.error("[auth] Login failed", error.message);
    res.status(500).json({ error: "Login failed", details: error.message });
  }
});

router.get("/callback", async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    console.error("[auth] Callback error", error, error_description);
    return res.status(400).json({ error, error_description });
  }

  if (!code) {
    return res.status(400).json({ error: "Authorization code missing" });
  }

  try {
    console.log("[auth] Processing callback");
    const tokenResponse = await handleAuthCallback(code);
    const user = parseUserFromToken(tokenResponse);

    if (!isUserAllowed(user)) {
      console.warn(`[auth] Access denied for ${user.email}`);
      return res.status(403).json({ error: "Access denied" });
    }

    req.session.user = user;
    console.log(`[auth] User authenticated: ${user.email}`);
    req.session.save((err) => {
      if (err) {
        console.error("[auth] Session save failed", err);
        return res.status(500).json({ error: "Session save failed" });
      }
      res.redirect("/");
    });
  } catch (error) {
    console.error("[auth] Callback processing failed", error.message);
    res.status(500).json({ error: "Authentication failed", details: error.message });
  }
});

router.get("/logout", (req, res) => {
  const user = req.session?.user;
  if (user) {
    console.log(`[auth] User logged out: ${user.email}`);
  }
  req.session.destroy((err) => {
    if (err) {
      console.error("[auth] Session destroy failed", err);
      return res.status(500).json({ error: "Logout failed" });
    }
    res.redirect("/");
  });
});

router.get("/user", (req, res) => {
  if (!req.session?.user) {
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    user: req.session.user
  });
});

module.exports = router;
