const express = require("express");
const { EDITABLE_KEYS, RESTRICTED_KEYS, getCurrentSettings, updateSettings } = require("../services/settingsStore");

const router = express.Router();

router.get("/", (req, res) => {
  const values = getCurrentSettings();
  return res.json({
    editableKeys: EDITABLE_KEYS,
    restrictedKeys: RESTRICTED_KEYS,
    tenants: values.tenants,
    companies: values.companies,
    values
  });
});

router.patch("/", (req, res) => {
  try {
    const values = updateSettings(req.body || {});
    return res.json({ ok: true, tenants: values.tenants, companies: values.companies, values });
  } catch (error) {
    const status = Number(error.status || 500);
    return res.status(status).json({ ok: false, error: error.message || "Failed to update settings" });
  }
});

module.exports = router;
