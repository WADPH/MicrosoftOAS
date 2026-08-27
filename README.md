# Microsoft Onboarding & Offboarding Automation System (OAS)

A self-hosted automation platform for managing employee onboarding and offboarding workflows integrated with Microsoft Teams, Microsoft Graph, Snipe-IT asset management, and Zammad ticketing system.

**Tech Stack**: Node.js + Express + Microsoft Graph API + Docker

---

## 📋 Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
  - [Microsoft Graph API Setup](#microsoft-graph-api-setup)
  - [Environment Variables](#environment-variables)
  - [Multi-Tenant Setup](#multi-tenant-setup)
  - [Company Matcher Configuration](#company-matcher-configuration)
- [Running the Application](#running-the-application)
- [Docker Setup](#docker-setup)
- [API Endpoints](#api-endpoints)
- [Integrations](#integrations)
  - [Snipe-IT Asset Management](#snipe-it-asset-management)
  - [Zammad Ticketing System](#zammad-ticketing-system)
- [HR Self-Service Page](#hr-self-service-page)
- [Teams Notifications (Optional)](#teams-notifications-optional)
- [Project Structure](#project-structure)
- [Sample Webhook Call](#sample-webhook-call)
- [Important Notes](#important-notes)

---

## Features

- **Employee Onboarding**: Automated workflow for new employee setup
- **Employee Offboarding**: Automated workflow for employee offboarding
- **Teams Integration**: Receive onboarding/offboarding requests directly from Microsoft Teams
- **Microsoft Graph Integration**: 
  - Create and manage user accounts in Azure AD
  - Assign licenses
  - Manage group memberships
- **Multi-Tenant Support**: Manage multiple Azure AD tenants/organizations
- **Per-Task Notes**: Free-text internal note field on every onboarding/offboarding task
- **License Status Indicator**: Onboarding tasks show whether the target user already has a Business Premium license (not found / no license / licensed)
- **Snipe-IT Integration**: Automated asset assignment to employees
- **Zammad Integration**: Automatic ticket creation for IT support tasks
- **Task Management**: Track and manage onboarding/offboarding tasks
- **Web Dashboard**: User-friendly interface for monitoring and managing tasks
- **Progress Dashboard**: HR-friendly read-only onboarding progress page (`/progress`)
- **HR Self-Service Page**: Restricted `/hr` page where HR staff can submit simplified onboarding/offboarding requests without seeing the full admin dashboard
- **Teams Notifications** *(optional)*: Post an @mention notification to a Teams channel via Power Automate whenever an HR-page task is created
- **Settings Management**: Configure system settings and email recipients

---

## Prerequisites

Before you begin, ensure you have:

- **Node.js**: v18 or higher
- **npm**: Latest version
- **Docker & Docker Compose** (optional, for containerized deployment)
- **Microsoft Azure Tenant**: Access to Azure AD
- **Microsoft Graph API** credentials
- **Snipe-IT Instance** (optional, for asset management)
- **Zammad Instance** (optional, for ticketing)

---

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd OAS
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create Environment File

Copy the example environment file:

```bash
cp .env.example .env
```

### 4. Configure the `.env` File

See the [Configuration](#configuration) section below for detailed setup instructions.

---

## Configuration

### Microsoft Graph API Setup

To enable the system to manage users and licenses in Azure AD, you need to create an Azure app registration with the required permissions.

#### Step 1: Create App Registration in Azure

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** > **App registrations**
3. Click **New registration**
4. Enter app name (e.g., "OAS - Onboarding Automation")
5. Choose appropriate account type and click **Register**

#### Step 2: Configure API Permissions

Your app registration must have the following **Microsoft Graph** application permissions:

| Permission | Type | Description | Status |
|-----------|------|-------------|--------|
| **Group.ReadWrite.All** | Application | Read and write all groups | Required |
| **LicenseAssignment.ReadWrite.All** | Application | Manage all license assignments | Required |
| **Mail.Send** | Application | Send mail as any user | Required |
| **Organization.Read.All** | Application | Read organization information | Required |
| **User.Read.All** | Application | Read all users' full profiles | Required |
| **User.ReadWrite.All** | Application | Read and write all users' full profiles | Required |

**To add these permissions:**

1. In your app registration, go to **API permissions**
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Choose **Application permissions**
5. Search for each permission listed above and add them
6. Click **Grant admin consent for [Your Organization]**

#### Step 3: Create Client Secret

1. Go to **Certificates & secrets**
2. Under **Client secrets**, click **New client secret**
3. Set an expiration period
4. Copy the **Value** (you'll need this for `.env`)

#### Step 4: Get Tenant Information

1. In app registration overview, copy:
   - **Application (client) ID** → Use for `{TENANT}_CLIENT_ID`
   - **Directory (tenant) ID** → Use for `{TENANT}_TENANT_ID`

---

### Environment Variables

Create a `.env` file in the project root with the following configuration:

```env
# Application Settings
PORT=3000
NODE_ENV=production

# Session Security
SESSION_SECRET=your-very-secure-random-string-here

# Teams Webhook
TEAMS_OUTGOING_WEBHOOK_SECRET=your-teams-webhook-secret

# SSO Configuration
ALLOWED_EMAILS=user1@company.com,user2@company.com,admin@company.com
ALLOWED_SPECTATORS=spectator1@company.com,spectator2@company.com
ALLOWED_HR=hr1@company.com,hr2@company.com
REDIRECT_URI=https://your-app-domain.com/auth/callback

# Multi-Tenant Setup
TENANTS=COMPANY1,COMPANY2

# Tenant 1: COMPANY1
COMPANY1_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
COMPANY1_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
COMPANY1_CLIENT_SECRET=your-client-secret-here

# Tenant 2: COMPANY2
COMPANY2_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
COMPANY2_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
COMPANY2_CLIENT_SECRET=your-client-secret-here

# Default License Usage Location (e.g., US, AZ, GB)
DEFAULT_USAGE_LOCATION=US

# Email Configuration
MAIL_SENDER_UPN=noreply@company.com
LICENSE_REQUEST_TO=licenses@company.com
LICENSE_REQUEST_CC=admin@company.com
ASSETS_REQUEST_TO=it@company.com
ASSETS_REQUEST_CC=admin@company.com

# Snipe-IT Integration (Asset Management)
SNIPEIT_ENABLED=true
SNIPEIT_URL=https://inventory.company.com
SNIPEIT_API_KEY=your-snipeit-api-key-here
SNIPEIT_LAPTOP_PREFIX=PC-
SNIPEIT_MONITOR_PREFIX=MN-

# Zammad Integration (Ticketing System)
ZAMMAD_ENABLED=true
ZAMMAD_URL=https://zammad.company.com
ZAMMAD_API_TOKEN=your-zammad-api-token-here
ZAMMAD_DEFAULT_CUSTOMER=support@company.com

# Teams Notifications (Optional - see "Teams Notifications" section below)
TEAMS_NOTIFICATIONS_ENABLED=false
TEAMS_NOTIFICATIONS_WEBHOOK_URL=  # Power Automate flow trigger URL

# Debugging (set to false in production)
WEBHOOK_DEBUG=false
TEST_RECIPIENT=  # Optional: redirect all emails to this address for testing
```

`ALLOWED_EMAILS` (`admin` role) users have full access to the main dashboard (`/`) and can also open `/progress`.
`ALLOWED_SPECTATORS` (`spectator` role) users are redirected to `/progress` after login and can access only the read-only progress dashboard.
`ALLOWED_HR` (`hr` role) users are redirected to `/hr` after login and can access only the HR self-service page and `/progress` — no access to `/tasks`, `/offboarding`, `/settings`, or `/snipeit`.

---

### Multi-Tenant Setup

If you manage multiple Azure AD tenants (e.g., different companies or departments):

```env
TENANTS=COMPANY1,COMPANY2,COMPANY3

COMPANY1_TENANT_ID=xxxxx-xxxxx-xxxxx
COMPANY1_CLIENT_ID=xxxxx-xxxxx-xxxxx
COMPANY1_CLIENT_SECRET=xxxxx

COMPANY2_TENANT_ID=xxxxx-xxxxx-xxxxx
COMPANY2_CLIENT_ID=xxxxx-xxxxx-xxxxx
COMPANY2_CLIENT_SECRET=xxxxx

COMPANY3_TENANT_ID=xxxxx-xxxxx-xxxxx
COMPANY3_CLIENT_ID=xxxxx-xxxxx-xxxxx
COMPANY3_CLIENT_SECRET=xxxxx
```

Each tenant key in `TENANTS` must have corresponding `{KEY}_TENANT_ID`, `{KEY}_CLIENT_ID`, and `{KEY}_CLIENT_SECRET` variables.

---

### Company Matcher Configuration

Map incoming requests to specific Azure AD tenants and configure company-specific settings:

```env
COMPANY_MATCHER_KEYS=COMPANY1,COMPANY3,COMPANY2

# COMPANY1 Configuration
COMPANY_MATCHER_COMPANY1_PATTERNS=COMPANY1,COMPANY1 llc,ei-group
COMPANY_MATCHER_COMPANY1_DOMAIN=COMPANY1.az
COMPANY_MATCHER_COMPANY1_CODE=EIG
COMPANY_MATCHER_COMPANY1_TENANT=COMPANY1
COMPANY_MATCHER_COMPANY1_GROUPS=

# COMPANY3 Configuration
COMPANY_MATCHER_COMPANY3_PATTERNS=COMPANY3,COMPANY3 llc
COMPANY_MATCHER_COMPANY3_DOMAIN=COMPANY3.az
COMPANY_MATCHER_COMPANY3_CODE=NEO
COMPANY_MATCHER_COMPANY3_TENANT=COMPANY1
COMPANY_MATCHER_COMPANY3_GROUPS=group-id-1,group-id-2

# COMPANY2 Configuration
COMPANY_MATCHER_COMPANY2_PATTERNS=COMPANY2,COMPANY2 corp
COMPANY_MATCHER_COMPANY2_DOMAIN=COMPANY2.az
COMPANY_MATCHER_COMPANY2_CODE=WAV
COMPANY_MATCHER_COMPANY2_TENANT=COMPANY2
COMPANY_MATCHER_COMPANY2_GROUPS=
```

**Configuration Fields:**
- `PATTERNS`: Comma-separated patterns to identify the company (matched against email/company name)
- `DOMAIN`: Primary email domain for the company
- `CODE`: Short company code
- `TENANT`: Which tenant credentials to use (must be in `TENANTS` list)
- `GROUPS`: Comma-separated Azure AD group IDs to automatically assign users (optional)

---

## Running the Application

### Development Mode

```bash
npm run dev
```

This starts the server with auto-reload on file changes.

### Production Mode

```bash
npm start
```

Access the web dashboard at `http://localhost:3000` (or your configured domain)

---

## Docker Setup

### Using Docker Compose (Recommended)

1. Ensure Docker and Docker Compose are installed
2. Configure your `.env` file
3. Run:

```bash
docker-compose up -d
```

This will:
- Build the Docker image
- Start the container
- Map port 3000
- Mount the `.env` file and database directory

### View Logs

```bash
docker-compose logs -f microsoft-oas
```

### Stop the Application

```bash
docker-compose down
```

### Rebuild After Code Changes

```bash
docker-compose down
docker-compose up -d --build
```

---

## API Endpoints

### Health Check

```http
GET /health
```

Returns application status.

### Webhook (Teams Integration)

```http
POST /webhook/teams
```

Receives onboarding/offboarding requests from Microsoft Teams.

**Required Header:**
- `Authorization`: Teams HMAC signature

**Payload Example:**
```json
{
  "text": "New employee - John Smith\nJohn Smith will join us on April 15, 2026.\nCompany: COMPANY3 LLC\nPosition: Senior Developer\nName: John Smith\nMobile number: +994 70 000 00 00\nLine Manager: Jane Doe"
}
```

### Tasks Management

```http
GET /tasks                    # Get all tasks
GET /tasks/meta/options      # Get task options/metadata
GET /tasks/:id               # Get specific task
PATCH /tasks/:id             # Update task
DELETE /tasks/:id            # Delete task
POST /tasks/:id/approve      # Approve task
```

### Settings Management

```http
GET /settings                # Get system settings
PATCH /settings              # Update system settings
```

### Authentication

```http
GET /auth/login              # Initiate SSO login
GET /auth/callback           # OAuth callback
POST /auth/logout            # Logout
```

### Progress Dashboard

```http
GET /progress                # Read-only progress page (admin + spectator + hr)
GET /progress/tasks          # Onboarding tasks feed for progress page
```

### HR Self-Service Page

```http
GET /hr                      # HR page (admin + hr roles only)
GET /hr/companies            # Company dropdown options + Teams notification enabled flag
GET /hr/users                # Tenant-scoped user search (Line Manager / Employee pickers)
GET /hr/mention-users        # Cross-tenant user search (Teams @mention picker)
POST /hr/onboarding          # Create a simplified onboarding task
POST /hr/offboarding         # Create a simplified offboarding task
```

---

## Integrations

### Snipe-IT Asset Management

Automatically assign IT assets (laptops, monitors, etc.) to new employees.

**Features:**
- Automatic asset assignment upon employee onboarding
- Support for multiple asset types (laptops, monitors, peripherals)
- Asset tracking and status management

**Setup:**
1. Set `SNIPEIT_ENABLED=true` in `.env`
2. Configure Snipe-IT URL and API key
3. Define asset prefixes (`SNIPEIT_LAPTOP_PREFIX`, `SNIPEIT_MONITOR_PREFIX`)

### Zammad Ticketing System

Automatically create support tickets for offboarding tasks.

**Features:**
- Automatic ticket creation for employee offboarding
- Tracks equipment return and system access removal
- Integrates with existing ticketing workflow

**Setup:**
1. Set `ZAMMAD_ENABLED=true` in `.env`
2. Configure Zammad URL and API token
3. Set default customer/group for tickets

---

## HR Self-Service Page

A restricted page (`/hr`) that lets HR staff submit onboarding/offboarding requests without exposing the full admin dashboard (no license assignment, no Snipe-IT, no Zammad, no Graph user deletion, etc.).

**Access:** Only users listed in `ALLOWED_HR` (see [Environment Variables](#environment-variables)). After SSO login, HR users are redirected straight to `/hr` and can also open `/progress`; every other route (`/`, `/tasks`, `/offboarding`, `/settings`, `/snipeit`) returns `403 Forbidden` for this role.

**Onboarding tab** — fields: Name, Surname, Company (dropdown, built from [Company Matcher Configuration](#company-matcher-configuration)), Position, Mobile Number, Line Manager (searched from the company's tenant), Date (native date picker only — no manual typing).

**Offboarding tab** — fields: Company (dropdown), Employee (searched from the company's tenant), Date.

Submitted requests are created as normal `pending` tasks in the same store the admin dashboard manages — an HR submission is equivalent to an admin manually creating a draft task and filling in the basic fields. The admin then continues processing it as usual (License/Assets/Groups + Approve for onboarding; choose related accounts/assets + Execute for offboarding).

Each tab optionally includes a **Teams Notification** block — see below. It only appears when Teams notifications are enabled in Settings.

---

## Teams Notifications (Optional)

When enabled, creating a task from the [HR page](#hr-self-service-page) can post a message to a Microsoft Teams channel, optionally @mentioning specific people (e.g. "Offboarding - Jane Doe" + "@IT Colleague, please revoke her badge access."). **This feature is fully optional** — if you don't need it, leave `TEAMS_NOTIFICATIONS_ENABLED=false` (the default) and skip this section entirely; nothing else in the app depends on it.

Delivery goes through a **Power Automate Workflow**, not a direct Microsoft Graph API call — Graph's `ChannelMessage.Send` permission only exists as a *Delegated* permission (no Application/app-only variant), which doesn't fit this app's daemon/service-account backend. Power Automate avoids having to manage a delegated user token for a bot account.

### Step 1 — Create the Power Automate flow

1. In Microsoft Teams, right-click the target channel → **Workflows** → search for and select the template **"Post to a channel when a webhook request is received"** (or create it directly at [make.powerautomate.com](https://make.powerautomate.com) with the trigger **"When a Teams webhook request is received"**).
2. Pick the Team and channel where notifications should be posted, then create the flow.

> This trigger's request format is fixed by Microsoft to a Bot-Framework-style `attachments` envelope — there is no editable "Schema" field, and that's expected. The flow just needs to relay whatever card it receives; the app builds the full card itself (see Step 2).

### Step 2 — Configure the flow to relay the card as-is

The default flow generated by the template already has the right shape. Make sure it looks like this:

```
Trigger: When a Teams webhook request is received
For_each (@triggerOutputs()?['body']?['attachments'])
  └── Compose            → Input: @item()?['content']
  └── Post card in a chat or channel
        Adaptive Card field = @{outputs('Compose')}
        Team / Channel = the ones you picked in Step 1
```

Do **not** try to reconstruct the card manually inside the flow (e.g. with `concat()`/variables) — building the message, mention list, and JSON escaping is handled entirely by this app's backend (`server/services/teamsNotify.js`); the flow's only job is to relay `attachments[0].content` to the channel.

### Step 3 — Get the trigger URL and configure `.env`

1. Save the flow, then open the trigger step — it now shows an **HTTP POST URL**. Copy it.
2. Treat this URL as a secret (it works like a password — anyone with it can post to your channel). Add it directly to `.env` on the server (it is **not** editable from the web Settings UI, for the same reason `ZAMMAD_URL`/`SNIPEIT_URL` aren't):
   ```env
   TEAMS_NOTIFICATIONS_WEBHOOK_URL=https://your-flow-trigger-url...
   ```
3. Restart the app, then enable the feature from **Settings → Teams Notifications** in the admin dashboard (or set `TEAMS_NOTIFICATIONS_ENABLED=true` directly in `.env`). Enabling via the UI is rejected with a clear error if the webhook URL above isn't configured yet — this is intentional, mirroring how `ZAMMAD_ENABLED`/`SNIPEIT_ENABLED` require their URL/token to already be set.

### Step 4 — Test the flow directly (before relying on the app)

```powershell
$json = @'
{
  "type": "message",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "content": {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": [
          { "type": "TextBlock", "weight": "Bolder", "size": "Medium", "text": "Offboarding - Test User", "wrap": true },
          { "type": "TextBlock", "text": "<at>Test Mention</at> please double-check this.\n\nDate: 2026-01-01", "wrap": true }
        ],
        "msteams": {
          "entities": [
            { "type": "mention", "text": "<at>Test Mention</at>", "mentioned": { "id": "someone@yourcompany.com", "name": "Test Mention" } }
          ]
        }
      }
    }
  ]
}
'@

Invoke-RestMethod -Uri "<your trigger URL>" -Method Post -ContentType "application/json" -Body $json
```

Check the channel: the mention should render as a clickable, highlighted `@Test Mention`, not literal `<at>` text. If it doesn't render as a mention, double-check that the `<at>...</at>` text inside `body` matches the corresponding `entities[].text` **exactly**, and prefer the person's Azure AD Object ID over their email for `mentioned.id` if rendering is unreliable.

### How the message is built

Once wired up, every HR-page submission with Teams notifications enabled can include, in this order:
1. **Title** (auto-generated: `Onboarding - {Name}` / `Offboarding - {Employee}`)
2. **Free-text note** (optional, typed by HR)
3. **Mention lines** (optional, each a person picked via a cross-tenant search + a short custom message)
4. **Date** (always appended at the bottom, taken from the task's date field)

A notification is only sent if there's a note and/or at least one mention — an empty Teams section sends nothing. A failed delivery (bad URL, flow down, etc.) is logged and never blocks task creation.

---

## Project Structure

```
OAS/
├── public/                          # Frontend assets
│   ├── index.html                  # Main HTML file
│   ├── app.js                      # Frontend JavaScript
│   ├── progress.js                 # Progress page JavaScript
│   ├── hr.js                       # HR self-service page JavaScript
│   ├── styles.css                  # Frontend styles
│   └── images/                     # Image assets
├── server/                          # Backend application
│   ├── server.js                   # Main server file
│   ├── parser.js                   # Message parsing logic
│   ├── middleware/
│   │   └── requireAuth.js          # Authentication middleware (admin/spectator/hr role gates)
│   ├── routes/
│   │   ├── auth.js                 # Authentication endpoints
│   │   ├── tasks.js                # Task management endpoints
│   │   ├── settings.js             # Settings management endpoints
│   │   ├── snipeit.js              # Snipe-IT integration endpoints
│   │   ├── offboarding.js          # Offboarding workflow
│   │   ├── hr.js                   # HR self-service page endpoints
│   │   └── webhook.js              # Teams webhook handling
│   ├── services/
│   │   ├── auth.js                 # Authentication service
│   │   ├── graph.js                # Microsoft Graph API wrapper
│   │   ├── mail.js                 # Email service
│   │   ├── offboardingPayload.js   # Shared offboarding task payload builder (admin + HR page)
│   │   ├── teamsNotify.js          # Teams notification Adaptive Card builder/sender (optional feature)
│   │   ├── snipeit.service.js      # Snipe-IT service
│   │   ├── snipeitAssignStore.js   # Snipe-IT assignment storage
│   │   ├── snipeitAssignWorker.js  # Snipe-IT assignment worker
│   │   ├── taskStore.js            # Task storage service
│   │   ├── tenantConfig.js         # Tenant configuration
│   │   ├── settingsStore.js        # Settings storage
│   │   ├── zammad.service.js       # Zammad ticketing service
│   ├── views/
│   │   ├── progress.html           # Progress page template
│   │   └── hr.html                 # HR self-service page template
│   └── db/                          # Data storage
│       ├── tasks.json              # Tasks database
│       └── snipeit_assign.json     # Snipe-IT assignments database
├── .env.example                     # Environment variables example
├── .dockerignore                    # Docker ignore file
├── docker-compose.yml               # Docker Compose configuration
├── Dockerfile                       # Docker build file
├── package.json                     # Node.js dependencies
└── README.md                        # This file
```

---

## Sample Webhook Call

### Using cURL

```bash
curl -X POST "http://localhost:3000/webhook/teams" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "New employee - John Smith\nJohn Smith will join us on April 15, 2026.\nCompany: COMPANY3 LLC\nPosition: Senior Developer\nName: John Smith\nMobile number: +994 70 000 00 00\nLine Manager: Jane Doe"
  }'
```

The Teams message format should be:
```
New employee - [Line Manager]

[Employee Name] will join us on [Start Date].

Company: [Company Name]
Position: [Position]
Mobile number: [Phone]
```

---

## Important Notes

### Data Storage
- Tasks are stored in `server/db/tasks.json` (JSON file-based storage)
- Snipe-IT assignments are stored in `server/db/snipeit_assign.json`
- Duplicate key: `fullName + startDate` (prevents duplicate employee entries)

### Email Handling
- Outgoing emails use the sender account configured in `MAIL_SENDER_UPN`
- For testing/development: Set `TEST_RECIPIENT` to redirect all emails to a test address
- Email recipients are configured per request type (licenses, assets)

### Security
- Webhook validation uses Teams HMAC signature from `Authorization` header
- Session secret should be a strong random string in production
- All API endpoints (except `/health` and `/webhook/teams`) require authentication
- Access model (three roles, set by which `ALLOWED_*` list a user's email appears in):
  - `ALLOWED_EMAILS` → `admin`: full dashboard access (`/`) + progress (`/progress`) + HR page (`/hr`)
  - `ALLOWED_SPECTATORS` → `spectator`: progress-only access (`/progress`)
  - `ALLOWED_HR` → `hr`: HR self-service page (`/hr`) + progress (`/progress`) only
- In production, ensure `SESSION_SECRET` is set to a secure value

### Teams Webhook
- The webhook URL is: `https://your-app-domain.com/webhook/teams`
- Configure this URL in Teams Outgoing Webhook
- Use the same secret value for both `TEAMS_OUTGOING_WEBHOOK_SECRET` (app) and Teams webhook configuration
- If webhook payload contains "new employee" but fields are missing, the task is still created with values set to "not specified"

### Missing Fields
- If the webhook payload is incomplete, the system gracefully handles missing values
- Incomplete tasks can be edited/updated through the web dashboard

### Debugging
- Set `WEBHOOK_DEBUG=true` to log incoming webhook payloads (disable in production for security)
- Check application logs for detailed error information
- Use Docker logs for container-based deployments: `docker-compose logs -f`

### Production Deployment
- Change `NODE_ENV=production`
- Use strong `SESSION_SECRET` (generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- Configure `REDIRECT_URI` with your production domain
- Ensure SSL/TLS is enabled (use reverse proxy like Nginx)
- Set `WEBHOOK_DEBUG=false`
- Use `TEST_RECIPIENT` only for testing, disable in production
- Regularly rotate client secrets and API tokens

---

## Troubleshooting

### Application won't start
- Verify all required environment variables are set in `.env`
- Check Node.js version: `node --version` (should be v18+)
- Clear `node_modules` and reinstall: `rm -rf node_modules && npm install`

### Cannot create users in Azure AD
- Verify Microsoft Graph API permissions are granted (use "Grant admin consent")
- Check tenant ID, client ID, and client secret are correct
- Ensure the application identity has sufficient permissions

### Webhook requests failing
- Verify `TEAMS_OUTGOING_WEBHOOK_SECRET` matches Teams webhook configuration
- Enable `WEBHOOK_DEBUG=true` to see incoming payloads
- Check firewall/network allows incoming requests from Teams

### Emails not sending
- Verify `MAIL_SENDER_UPN` account has Mail.Send permission
- Check recipient email addresses in configuration
- If testing, verify `TEST_RECIPIENT` is set correctly

### Docker container issues
- Check logs: `docker-compose logs -f microsoft-oas`
- Verify `.env` file is in the project root
- Ensure `server/db/` directory has write permissions

### Teams Notifications toggle won't save / "Save failed" in Settings
- This is expected validation, not a bug: enabling `TEAMS_NOTIFICATIONS_ENABLED` via the Settings UI is rejected until `TEAMS_NOTIFICATIONS_WEBHOOK_URL` is already set directly in `.env` (see [Teams Notifications](#teams-notifications-optional), Step 3) — the same rule already applies to `ZAMMAD_ENABLED`/`SNIPEIT_ENABLED`.
- Since the checkbox's value is submitted on every Settings save (not just when changed), leaving it checked while the URL is missing will block *all* settings saves until the URL is configured or the checkbox is unchecked.

### Teams message sends but @mentions show as plain text
- The `<at>Name</at>` text must match **exactly** between the visible message and the corresponding `entities[].text` entry — verify both sides in `server/services/teamsNotify.js` if you've customized it.
- Try using the person's Azure AD Object ID instead of their email for `mentioned.id`.

---

## Support & Contributing

For issues, questions, or contributions, please contact the development team or open an issue in the repository.

---

**Last Updated**: August 2026  
**Version**: 1.1.0
