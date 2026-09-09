const crypto = require("crypto");
const { getAllTasks, updateTaskById } = require("./taskStore");
const { sendReminderMail } = require("./mail");

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
let running = false;

function todayIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
}

function computeRemindAt(startDate, daysBefore) {
  const raw = String(startDate || "").trim();
  const datePart = raw.includes("T") ? raw.slice(0, 10) : raw;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return "";

  const [, y, m, d] = match;
  const base = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(base.getTime())) return "";

  base.setUTCDate(base.getUTCDate() - Number(daysBefore || 0));
  return base.toISOString().slice(0, 10);
}

function getDefaultReminderDays() {
  return String(process.env.ONBOARDING_DEFAULT_REMINDER_DAYS || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x))
    .map(Number)
    .filter((x) => x > 0);
}

/**
 * Auto-seeds a task's reminders from the configured default schedule the first
 * time it has both a real target date and no reminders yet - regardless of how
 * the task was created (HR page, admin manual entry, Teams webhook). No-ops
 * (and never overwrites) once a task already has any reminders. Reminders only
 * apply to onboarding tasks - offboarding tasks never get any.
 */
function seedDefaultReminders(task) {
  if (!task || !task.id) return null;
  if (task.taskType === "offboarding") return null;
  if (Array.isArray(task.reminders) && task.reminders.length > 0) return null;

  const rawStartDate = String(task.startDate || "").trim();
  if (!rawStartDate || rawStartDate.toLowerCase() === "not specified") return null;

  const defaultDays = getDefaultReminderDays();
  if (defaultDays.length === 0) return null;

  const reminders = defaultDays
    .map((daysBefore) => {
      const remindAt = computeRemindAt(rawStartDate, daysBefore);
      return remindAt ? { id: crypto.randomUUID(), daysBefore, remindAt, fired: false } : null;
    })
    .filter(Boolean);

  if (reminders.length === 0) return null;
  return updateTaskById(task.id, { reminders });
}

async function processDueReminders() {
  if (running) {
    return { ok: true, skipped: true, reason: "already_running" };
  }

  running = true;
  try {
    const today = todayIso();
    const tasks = getAllTasks().filter((task) => Array.isArray(task.reminders) && task.reminders.length > 0);
    let sent = 0;

    for (const task of tasks) {
      const dueReminders = task.reminders.filter((reminder) => !reminder.fired && reminder.remindAt && reminder.remindAt <= today);
      if (dueReminders.length === 0) continue;

      const updatedReminders = task.reminders.map((reminder) => ({ ...reminder }));
      for (const due of dueReminders) {
        try {
          await sendReminderMail(task, due);
          sent += 1;
        } catch (error) {
          console.error(`[reminder-worker] Failed to send reminder for task ${task.id}: ${error.message}`);
        }
        const target = updatedReminders.find((reminder) => reminder.id === due.id);
        if (target) target.fired = true;
      }

      updateTaskById(task.id, { reminders: updatedReminders });
    }

    return { ok: true, sent };
  } finally {
    running = false;
  }
}

function startReminderWorker() {
  setInterval(() => {
    processDueReminders().catch((error) => {
      console.error("[reminder-worker] periodic run failed", error.message);
    });
  }, CHECK_INTERVAL_MS);
}

module.exports = {
  CHECK_INTERVAL_MS,
  computeRemindAt,
  seedDefaultReminders,
  processDueReminders,
  startReminderWorker
};
