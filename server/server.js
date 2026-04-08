require("dotenv").config();
const express = require("express");
const path = require("path");

const tasksRouter = require("./routes/tasks");
const webhookRouter = require("./routes/webhook");

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

app.get("/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use("/tasks", tasksRouter);
app.use("/webhook", webhookRouter);

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(port, () => {
  console.log(`[server] Running on http://localhost:${port}`);
});
