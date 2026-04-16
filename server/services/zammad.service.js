const { graphRequest, getUserByEmail, findUserByDisplayName } = require("./graph");
const { extractMessageText, flattenPayloadStrings } = require("../parser");

function normalizeString(value) {
  return String(value || "").trim();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isGuid(value) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(value || "").trim());
}

function isTeamsUserId(value) {
  return String(value || "").startsWith("29:");
}

function extractEmailFromPayload(payload) {
  const text = flattenPayloadStrings(payload);
  const match = String(text || "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return match ? match[0] : null;
}

function getTeamsSenderInfo(payload) {
  const source = payload?.activity?.from || payload?.from || {};
  const user = source?.user || {};

  return {
    identifier: normalizeString(source.id || source.aadObjectId || source.objectId || user.id || user.aadObjectId || user.objectId || user.userPrincipalName || source.userPrincipalName || user.mail || source.mail || user.email || source.email),
    email: normalizeString(user.userPrincipalName || user.mail || source.userPrincipalName || source.mail || user.email || source.email),
    displayName: normalizeString(source.displayName || source.name || user.displayName || user.name || payload?.activity?.from?.name || payload?.from?.name)
  };
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error.status || 0;
      const retriable = status >= 500 || status === 429 || status === 0;

      if (!retriable || attempt === attempts) break;

      const backoffMs = 300 * attempt;
      console.warn(`[Zammad] Retry ${attempt}/${attempts} in ${backoffMs}ms`);
      await delay(backoffMs);
    }
  }

  throw lastError;
}

async function zammadRequest(method, path, body) {
  const url = process.env.ZAMMAD_URL;
  const token = process.env.ZAMMAD_API_TOKEN;

  if (!url || !token) {
    throw new Error("ZAMMAD_URL and ZAMMAD_API_TOKEN must be configured in .env");
  }

  return withRetry(async () => {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        Authorization: `Token token=${token}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Zammad request failed ${method} ${path}: ${response.status} ${errText}`);
    }

    if (response.status === 204) return null;

    const raw = await response.text();
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw);
  });
}

async function findUserByEmail(email) {
  console.log(`[Zammad] Searching Zammad user by email: ${email}`);
  try {
    const users = await zammadRequest("GET", `/api/v1/users/search?query=${encodeURIComponent(email)}`);
    if (Array.isArray(users) && users.length > 0) {
      const user = users.find(u => u.email === email);
      if (user) {
        console.log(`[Zammad] Found Zammad user: ${user.id} (${user.email})`);
        return user;
      }
    }
    console.log(`[Zammad] No Zammad user found for email: ${email}`);
    return null;
  } catch (error) {
    console.error(`[Zammad] Error searching user by email: ${error.message}`);
    throw error;
  }
}

async function resolveTeamsUserEmail(senderPayload) {
  const senderInfo = getTeamsSenderInfo(senderPayload || {});
  console.log(`[Zammad] Resolving Teams sender across tenants: identifier=${senderInfo.identifier || "n/a"}, displayName=${senderInfo.displayName || "n/a"}`);

  const tenants = process.env.TENANTS ? process.env.TENANTS.split(',').map((t) => t.trim()).filter(Boolean) : ["EIGROUP"];

  const tryResolveEmail = async (identifier, tenantKey) => {
    if (!identifier) return null;
    if (isEmail(identifier)) {
      return identifier.toLowerCase();
    }

    if (isGuid(identifier)) {
      try {
        const user = await graphRequest("GET", `/users/${encodeURIComponent(identifier)}`, null, tenantKey);
        if (user && user.mail) return user.mail;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }

    if (identifier.includes("@")) {
      try {
        const user = await getUserByEmail(identifier, tenantKey);
        if (user && user.mail) return user.mail;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }

    return null;
  };

  for (const tenantKey of tenants) {
    try {
      console.log(`[Zammad] Checking tenant: ${tenantKey}`);
      let email = null;

      if (senderInfo.email) {
        email = await tryResolveEmail(senderInfo.email, tenantKey);
      }

      if (!email && senderInfo.identifier && !isTeamsUserId(senderInfo.identifier)) {
        email = await tryResolveEmail(senderInfo.identifier, tenantKey);
      }

      if (!email && senderInfo.displayName) {
        const user = await findUserByDisplayName(senderInfo.displayName, tenantKey);
        if (user && user.mail) {
          email = user.mail;
        }
      }

      if (email) {
        console.log(`[Zammad] Found email in tenant ${tenantKey}: ${email}`);
        return email;
      }
    } catch (error) {
      console.warn(`[Zammad] Failed to resolve user in tenant ${tenantKey}: ${error.message}`);
    }
  }

  const fallbackEmail = extractEmailFromPayload(senderPayload);
  if (fallbackEmail) {
    console.log(`[Zammad] Extracted email from payload: ${fallbackEmail}`);
    return fallbackEmail;
  }

  console.log(`[Zammad] User not found in Graph`);
  return null;
}

async function createTicket(data) {
  console.log(`[Zammad] Creating ticket for ${data.title}`);

  try {
    const ticket = await zammadRequest("POST", "/api/v1/tickets", data);
    console.log(`[Zammad] Ticket created successfully: ${ticket.id}`);
    return ticket;
  } catch (error) {
    console.error(`[Zammad] Ticket creation failed: ${error.message}`);
    throw error;
  }
}

async function createOnboardingTicket(task, options = {}) {
  if (!process.env.ZAMMAD_ENABLED || process.env.ZAMMAD_ENABLED.toLowerCase() !== "true") {
    console.log(`[Zammad] Integration disabled`);
    return;
  }

  try {
    const webhookPayload = options.webhookPayload || {};
    let customerEmail = options.senderEmail || null;

    if (!customerEmail) {
      customerEmail = await resolveTeamsUserEmail(webhookPayload);
    }

    let customer = null;
    if (customerEmail) {
      customer = await findUserByEmail(customerEmail);
    }

    if (!customer) {
      const defaultCustomer = normalizeString(process.env.ZAMMAD_DEFAULT_CUSTOMER || "eigsystem@outlook.com");
      console.log(`[Zammad] Using default customer: ${defaultCustomer}`);
      customer = await findUserByEmail(defaultCustomer);
      if (!customer) {
        throw new Error(`Default customer ${defaultCustomer} not found in Zammad`);
      }
    }

    const title = `New employee - ${normalizeString(task.firstName)} ${normalizeString(task.lastName)}`.trim();
    const body = normalizeString(options.ticketBody || extractMessageText(webhookPayload) || flattenPayloadStrings(webhookPayload) || "Onboarding request created from Microsoft OAS");

    const ticketData = {
      title,
      type: "other",
      group: "Not Sorted",
      customer_id: customer.id,
      priority: "2 normal",
      article: {
        subject: title,
        body,
        type: "note",
        internal: false
      }
    };

    await createTicket(ticketData);
  } catch (error) {
    console.error(`[Zammad] Failed to create onboarding ticket: ${error.message}`);
    // Don't throw - this is non-blocking
  }
}

module.exports = {
  findUserByEmail,
  createTicket,
  resolveTeamsUserEmail,
  createOnboardingTicket
};