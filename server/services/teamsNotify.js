function isEnabled() {
  return String(process.env.TEAMS_NOTIFICATIONS_ENABLED || "false").trim().toLowerCase() === "true";
}

function buildAdaptiveCardPayload({ title, note, mentions, date }) {
  const rows = Array.isArray(mentions) ? mentions : [];

  const mentionLines = rows.map((row) => `<at>${row.name}</at> ${row.text}`);
  const entities = rows.map((row) => ({
    type: "mention",
    text: `<at>${row.name}</at>`,
    mentioned: {
      id: row.id,
      name: row.name
    }
  }));

  const bodyLines = [];
  const cleanNote = String(note || "").trim();
  if (cleanNote) bodyLines.push(cleanNote);
  bodyLines.push(...mentionLines);
  const cleanDate = String(date || "").trim();
  if (cleanDate) bodyLines.push(`Date: ${cleanDate}`);

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              weight: "Bolder",
              size: "Medium",
              text: String(title || ""),
              wrap: true
            },
            {
              type: "TextBlock",
              text: bodyLines.join("\n\n"),
              wrap: true
            }
          ],
          msteams: {
            entities
          }
        }
      }
    ]
  };
}

async function sendTeamsNotification({ title, note, mentions, date }) {
  if (!isEnabled()) return;
  const rows = Array.isArray(mentions) ? mentions.filter((row) => row?.id && row?.name) : [];
  const cleanNote = String(note || "").trim();
  if (rows.length === 0 && !cleanNote) return;

  const webhookUrl = String(process.env.TEAMS_NOTIFICATIONS_WEBHOOK_URL || "").trim();
  if (!webhookUrl) {
    console.warn("[teamsNotify] TEAMS_NOTIFICATIONS_ENABLED is true but TEAMS_NOTIFICATIONS_WEBHOOK_URL is not configured");
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAdaptiveCardPayload({ title, note: cleanNote, mentions: rows, date }))
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn(`[teamsNotify] Webhook responded with ${response.status}: ${text}`);
    }
  } catch (error) {
    console.warn(`[teamsNotify] Failed to send Teams notification: ${error.message}`);
  }
}

module.exports = {
  isEnabled,
  buildAdaptiveCardPayload,
  sendTeamsNotification
};
