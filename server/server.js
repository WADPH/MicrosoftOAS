require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");

const authRouter = require("./routes/auth");
const settingsRouter = require("./routes/settings");
const tasksRouter = require("./routes/tasks");
const snipeitRouter = require("./routes/snipeit");
const offboardingRouter = require("./routes/offboarding");
const webhookRouter = require("./routes/webhook");
const requireAuth = require("./middleware/requireAuth");
const { requireMainAccess, requireProgressAccess, requireProgressEditAccess } = require("./middleware/requireAuth");
const { startSnipeitAssignWorker, processPendingAssignTasks } = require("./services/snipeitAssignWorker");
const { getTasksByType } = require("./services/taskStore");
const {
  getTaskAssetStatuses,
  getAssetStatus,
  setAssetStatus,
  toggleAssetStatus
} = require("./services/assetStatusStore");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(
  express.json({
    limit: "1mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use(express.urlencoded({ extended: true }));

// WADPH old one
// app.use(
//   session({
//     secret: process.env.SESSION_SECRET || "dev-secret-key-change-in-production",
//     resave: false,
//     saveUninitialized: true,
//     cookie: {
//       httpOnly: true,
//       secure: process.env.NODE_ENV === "production",
//       maxAge: 24 * 60 * 60 * 1000
//     }
//   })
// );


app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);


app.get("/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use("/auth", authRouter);
app.use("/settings", requireAuth, requireMainAccess, settingsRouter);
app.use("/tasks", requireAuth, requireMainAccess, tasksRouter);
app.use("/snipeit", requireAuth, requireMainAccess, snipeitRouter);
app.use("/offboarding", requireAuth, requireMainAccess, offboardingRouter);
app.use("/webhook", webhookRouter);

app.get("/", (req, res) => {
  if (req.session?.user?.role === "spectator") {
    return res.redirect("/progress");
  }
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("/progress", requireAuth, requireProgressAccess, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "progress.html"));
});

app.get("/progress/user-role", requireAuth, requireProgressAccess, (req, res) => {
  const role = String(req.user?.role || "").trim().toLowerCase();
  res.json({ ok: true, role: role || "spectator" });
});

app.get("/progress/tasks", requireAuth, requireProgressAccess, (req, res) => {
  res.json(getTasksByType("onboarding"));
});

// Asset status endpoints - read access for both admin and spectator
app.get("/progress/assets/:taskId/statuses", requireAuth, requireProgressAccess, (req, res) => {
  const taskId = String(req.params.taskId || "").trim();
  if (!taskId) {
    return res.status(400).json({ ok: false, error: "Missing taskId" });
  }
  const statuses = getTaskAssetStatuses(taskId);
  res.json({ ok: true, statuses });
});

app.get("/progress/assets/:taskId/:assetName/status", requireAuth, requireProgressAccess, (req, res) => {
  const taskId = String(req.params.taskId || "").trim();
  const assetName = String(req.params.assetName || "").trim();
  
  if (!taskId || !assetName) {
    return res.status(400).json({ ok: false, error: "Missing taskId or assetName" });
  }

  const status = getAssetStatus(taskId, assetName);
  res.json({ ok: true, status });
});

// Asset status modification endpoints - write access only for admin
app.put("/progress/assets/:taskId/:assetName/status", requireAuth, requireProgressEditAccess, (req, res) => {
  const taskId = String(req.params.taskId || "").trim();
  const assetName = String(req.params.assetName || "").trim();
  const { status } = req.body || {};

  if (!taskId || !assetName || !status) {
    return res.status(400).json({ ok: false, error: "Missing taskId, assetName, or status" });
  }

  try {
    const newStatus = setAssetStatus(taskId, assetName, status);
    res.json({ ok: true, status: newStatus });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/progress/assets/:taskId/:assetName/toggle", requireAuth, requireProgressEditAccess, (req, res) => {
  const taskId = String(req.params.taskId || "").trim();
  const assetName = String(req.params.assetName || "").trim();

  if (!taskId || !assetName) {
    return res.status(400).json({ ok: false, error: "Missing taskId or assetName" });
  }

  try {
    const newStatus = toggleAssetStatus(taskId, assetName);
    res.json({ ok: true, status: newStatus });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(port, () => {
  console.log(`[server] Running on http://localhost:${port}`);
  startSnipeitAssignWorker();
  processPendingAssignTasks().catch((error) => {
    console.error("[snipeit-worker] startup run failed", error.message);
  });
});
