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
const { startSnipeitAssignWorker, processPendingAssignTasks } = require("./services/snipeitAssignWorker");

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

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-key-change-in-production",
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      sameSite: "none",    
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);



app.get("/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use("/auth", authRouter);
app.use("/settings", requireAuth, settingsRouter);
app.use("/tasks", requireAuth, tasksRouter);
app.use("/snipeit", requireAuth, snipeitRouter);
app.use("/offboarding", requireAuth, offboardingRouter);
app.use("/webhook", webhookRouter);

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(port, () => {
  console.log(`[server] Running on http://localhost:${port}`);
  startSnipeitAssignWorker();
  processPendingAssignTasks().catch((error) => {
    console.error("[snipeit-worker] startup run failed", error.message);
  });
});
