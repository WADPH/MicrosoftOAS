# Microsoft Onboarding Automation System

Node.js + Express + JSON storage + Microsoft Graph.

## Run

1. Install dependencies:
   npm install
2. Start server:
   npm start
3. Open UI:
   http://localhost:3000

## API

- `POST /webhook/teams` (Teams Outgoing Webhook + HMAC validation)
- `GET /tasks`
- `GET /tasks/meta/options`
- `GET /tasks/:id`
- `PATCH /tasks/:id`
- `DELETE /tasks/:id`
- `POST /tasks/:id/approve`
- `GET /settings`
- `PATCH /settings`
- `GET /health`

## Sample webhook call

```bash
curl -X POST "http://localhost:3000/webhook/teams" \
  -H "Content-Type: application/json" \
  -d '{"text":"New employee - Someone Somesurname\nSomeone Somesurname will join us on April 1, 2026.\nCompany: neotech LLC\nPosition: Research Assistant\nName: Someone Somesurname\nMobile number: +994 xx xxx xx xx\nLine Manager: John Keneddy"}'
```

So message in Teams will look like:
New employee - John Keneddy

John Smith will join us on April 15, 2026.

Company: Neotech LLC
Position: Senior Developer
Mobile number: +994 xx xxx xx xx
Line Manager: Jane Doe


## Notes

- Storage file: `server/db/tasks.json`
- Sync read/write is used intentionally.
- Duplicate key: `fullName + startDate`.
- For safety in dev/test, all outgoing mails are rerouted to `TEST_RECIPIENT` if set.
- Outgoing webhook auth uses Teams HMAC signature from `Authorization` header and `TEAMS_OUTGOING_WEBHOOK_SECRET`.
- If webhook payload contains `new employee` but some fields are missing, task is still created and missing values are set to `not specified`.
- Debug webhook persistence has been disabled so `server/db/last-webhook.json` is no longer written by the application.
