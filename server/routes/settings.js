const express = require("express");
const { EDITABLE_KEYS, RESTRICTED_KEYS, getCurrentSettings, updateSettings } = require("../services/settingsStore");

const router = express.Router();

router.get("/", (req, res) => {
  return res.json({
    editableKeys: EDITABLE_KEYS,
    restrictedKeys: RESTRICTED_KEYS,
    values: getCurrentSettings()
  });
});

router.patch("/", (req, res) => {
  try {
    const values = updateSettings(req.body || {});
    return res.json({ ok: true, values });
  } catch (error) {
    const status = Number(error.status || 500);
    return res.status(status).json({ ok: false, error: error.message || "Failed to update settings" });
  }
});

module.exports = router;

