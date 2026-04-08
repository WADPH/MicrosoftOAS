require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");

const authRouter = require("./routes/auth");
const tasksRouter = require("./routes/tasks");
const webhookRouter = require("./routes/webhook");
const requireAuth = require("./middleware/requireAuth");

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
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);



app.get("/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use("/auth", authRouter);
app.use("/tasks", requireAuth, tasksRouter);
app.use("/webhook", webhookRouter);

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(port, () => {
  console.log(`[server] Running on http://localhost:${port}`);
});
