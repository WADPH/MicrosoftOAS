async function sendTeamsIncomingMessage(text) {
  const webhookUrl = String(process.env.TEAMS_INCOMING_WEBHOOK_SECRET || process.env.TEAMS_INCOMING_WEBHOOK_URL || "").trim();
  if (!webhookUrl) {
    return { ok: false, skipped: true, reason: "not_configured" };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    return { ok: false, skipped: true, reason: "invalid_url" };
  }

  const response = await fetch(parsedUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: String(text || "") })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Teams incoming webhook failed: ${response.status} ${body}`.trim());
  }

  return { ok: true };
}

module.exports = {
  sendTeamsIncomingMessage
};
