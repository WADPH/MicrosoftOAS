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
- **Snipe-IT Integration**: Automated asset assignment to employees
- **Zammad Integration**: Automatic ticket creation for IT support tasks
- **Task Management**: Track and manage onboarding/offboarding tasks
- **Web Dashboard**: User-friendly interface for monitoring and managing tasks
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
REDIRECT_URI=https://your-app-domain.com/auth/callback

# Multi-Tenant Setup
TENANTS=EIGROUP,WAVERITY

# Tenant 1: EIGROUP
EIGROUP_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
EIGROUP_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
EIGROUP_CLIENT_SECRET=your-client-secret-here

# Tenant 2: WAVERITY
WAVERITY_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
WAVERITY_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
WAVERITY_CLIENT_SECRET=your-client-secret-here

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

# Debugging (set to false in production)
WEBHOOK_DEBUG=false
TEST_RECIPIENT=  # Optional: redirect all emails to this address for testing
```

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
COMPANY_MATCHER_KEYS=EIGROUP,NEOTECH,WAVERITY

# EIGROUP Configuration
COMPANY_MATCHER_EIGROUP_PATTERNS=eigroup,eigroup llc,ei-group
COMPANY_MATCHER_EIGROUP_DOMAIN=eigroup.az
COMPANY_MATCHER_EIGROUP_CODE=EIG
COMPANY_MATCHER_EIGROUP_TENANT=EIGROUP
COMPANY_MATCHER_EIGROUP_GROUPS=

# NEOTECH Configuration
COMPANY_MATCHER_NEOTECH_PATTERNS=neotech,neotech llc
COMPANY_MATCHER_NEOTECH_DOMAIN=neotech.az
COMPANY_MATCHER_NEOTECH_CODE=NEO
COMPANY_MATCHER_NEOTECH_TENANT=COMPANY1
COMPANY_MATCHER_NEOTECH_GROUPS=group-id-1,group-id-2

# WAVERITY Configuration
COMPANY_MATCHER_WAVERITY_PATTERNS=waverity,waverity corp
COMPANY_MATCHER_WAVERITY_DOMAIN=waverity.az
COMPANY_MATCHER_WAVERITY_CODE=WAV
COMPANY_MATCHER_WAVERITY_TENANT=COMPANY2
COMPANY_MATCHER_WAVERITY_GROUPS=
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
  "text": "New employee - John Smith\nJohn Smith will join us on April 15, 2026.\nCompany: Neotech LLC\nPosition: Senior Developer\nName: John Smith\nMobile number: +994 70 000 00 00\nLine Manager: Jane Doe"
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

## Project Structure

```
OAS/
├── public/                          # Frontend assets
│   ├── index.html                  # Main HTML file
│   ├── app.js                      # Frontend JavaScript
│   ├── styles.css                  # Frontend styles
│   └── images/                     # Image assets
├── server/                          # Backend application
│   ├── server.js                   # Main server file
│   ├── parser.js                   # Message parsing logic
│   ├── middleware/
│   │   └── requireAuth.js          # Authentication middleware
│   ├── routes/
│   │   ├── auth.js                 # Authentication endpoints
│   │   ├── tasks.js                # Task management endpoints
│   │   ├── settings.js             # Settings management endpoints
│   │   ├── snipeit.js              # Snipe-IT integration endpoints
│   │   ├── offboarding.js          # Offboarding workflow
│   │   └── webhook.js              # Teams webhook handling
│   ├── services/
│   │   ├── auth.js                 # Authentication service
│   │   ├── graph.js                # Microsoft Graph API wrapper
│   │   ├── mail.js                 # Email service
│   │   ├── snipeit.service.js      # Snipe-IT service
│   │   ├── snipeitAssignStore.js   # Snipe-IT assignment storage
│   │   ├── snipeitAssignWorker.js  # Snipe-IT assignment worker
│   │   ├── taskStore.js            # Task storage service
│   │   ├── tenantConfig.js         # Tenant configuration
│   │   ├── settingsStore.js        # Settings storage
│   │   ├── zammad.service.js       # Zammad ticketing service
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
    "text": "New employee - John Smith\nJohn Smith will join us on April 15, 2026.\nCompany: Neotech LLC\nPosition: Senior Developer\nName: John Smith\nMobile number: +994 70 000 00 00\nLine Manager: Jane Doe"
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

---

## Support & Contributing

For issues, questions, or contributions, please contact the development team or open an issue in the repository.

---

**Last Updated**: April 2026  
**Version**: 1.0.0
