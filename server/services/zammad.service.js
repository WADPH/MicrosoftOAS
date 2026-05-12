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

function normalizeAgentRow(user = {}) {
  const firstName = normalizeString(user.firstname || user.first_name || "");
  const lastName = normalizeString(user.lastname || user.last_name || "");
  const displayName = normalizeString([firstName, lastName].filter(Boolean).join(" ")) || normalizeString(user.login || user.email || "");
  return {
    id: Number(user.id),
    displayName,
    email: normalizeString(user.email || ""),
    active: user.active !== false
  };
}

async function listAgents() {
  console.log("[Zammad] Loading agent users");
  try {
    const [roles, users] = await Promise.all([
      zammadRequest("GET", "/api/v1/roles"),
      zammadRequest("GET", "/api/v1/users?per_page=200&page=1")
    ]);

    const roleRows = Array.isArray(roles) ? roles : [];
    const agentRole = roleRows.find((role) => String(role?.name || "").trim().toLowerCase() === "agent");
    const agentRoleId = Number(agentRole?.id || 2);

    const userRows = Array.isArray(users) ? users : [];
    const agents = userRows
      .filter((user) => {
        const roleIds = Array.isArray(user?.role_ids) ? user.role_ids.map((id) => Number(id)) : [];
        return user?.active !== false && roleIds.includes(agentRoleId);
      })
      .map(normalizeAgentRow)
      .filter((row) => Number.isFinite(row.id));

    console.log(`[Zammad] Loaded ${agents.length} agents`);
    return agents.sort((a, b) => String(a.displayName || "").localeCompare(String(b.displayName || ""), undefined, { sensitivity: "base" }));
  } catch (error) {
    console.error(`[Zammad] Failed to load agents: ${error.message}`);
    throw error;
  }
}

async function listGroups() {
  console.log("[Zammad] Loading groups");
  try {
    const groups = await zammadRequest("GET", "/api/v1/groups");
    const rows = Array.isArray(groups) ? groups : [];
    return rows
      .map((group) => ({
        id: Number(group?.id),
        name: normalizeString(group?.name || "")
      }))
      .filter((group) => Number.isFinite(group.id) && group.name);
  } catch (error) {
    console.error(`[Zammad] Failed to load groups: ${error.message}`);
    throw error;
  }
}

async function resolveAgentGroupId(agentDisplayName) {
  const targetName = normalizeString(agentDisplayName);
  if (!targetName) return null;
  const groups = await listGroups();
  const exact = groups.find((group) => group.name.toLowerCase() === targetName.toLowerCase());
  return exact?.id || null;
}

async function createManualOnboardingTicket(task = {}, ownerId) {
  if (!process.env.ZAMMAD_ENABLED || process.env.ZAMMAD_ENABLED.toLowerCase() !== "true") {
    throw new Error("Zammad integration is disabled");
  }

  const normalizedOwnerId = Number(ownerId);
  if (!Number.isFinite(normalizedOwnerId)) {
    throw new Error("ownerId must be a valid number");
  }

  const defaultCustomerEmail = normalizeString(process.env.ZAMMAD_DEFAULT_CUSTOMER || "");
  if (!defaultCustomerEmail) {
    throw new Error("ZAMMAD_DEFAULT_CUSTOMER is not configured");
  }

  console.log(`[Zammad] Manual onboarding ticket requested for task=${task.id || "n/a"} owner=${normalizedOwnerId}`);

  const [customer, users] = await Promise.all([
    findUserByEmail(defaultCustomerEmail),
    zammadRequest("GET", "/api/v1/users?per_page=200&page=1")
  ]);
  if (!customer?.id) {
    throw new Error(`Default customer ${defaultCustomerEmail} not found in Zammad`);
  }
  const ownerUser = (Array.isArray(users) ? users : []).find((row) => Number(row?.id) === normalizedOwnerId);
  if (!ownerUser) {
    throw new Error(`Owner user ${normalizedOwnerId} not found in Zammad`);
  }
  const ownerDisplayName = normalizeAgentRow(ownerUser).displayName;
  const ownerGroupId = await resolveAgentGroupId(ownerDisplayName);
  if (!ownerGroupId) {
    throw new Error(`Group not found for agent "${ownerDisplayName}"`);
  }

  const employeeName = normalizeString(task.fullName) || normalizeString([task.firstName, task.lastName].filter(Boolean).join(" ")) || "Employee";
  const title = `Onboarding ${employeeName}`.trim();
  const body = "Set up the equipment (laptop, monitor, keyboard, mouse, and headphones) for the new user and prepare their workstation";

  const ticketData = {
    title,
    type: "MicrosoftOAS",
    group_id: ownerGroupId,
    owner_id: normalizedOwnerId,
    customer_id: customer.id,
    priority: "2 normal",
    article: {
      subject: title,
      body,
      type: "note",
      internal: false
    }
  };

  const ticket = await createTicket(ticketData);
  console.log(`[Zammad] Manual onboarding ticket created task=${task.id || "n/a"} ticket=${ticket?.id || "n/a"} owner=${normalizedOwnerId}`);
  return ticket;
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
    const body = normalizeString(options.ticketBody) || "Onboarding request created from Microsoft OAS";

    const ticketData = {
      title,
      type: "MicrosoftOAS",
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

async function createOffboardingTicket(task, options = {}) {
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

    const title = `Offboarding - ${normalizeString(task.firstName)} ${normalizeString(task.lastName)}`.trim();
    const body = normalizeString(options.ticketBody) || "Offboarding request created from Microsoft OAS";

    const ticketData = {
      title,
      type: "MicrosoftOAS",
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
    console.error(`[Zammad] Failed to create offboarding ticket: ${error.message}`);
    // Don't throw - this is non-blocking
  }
}

module.exports = {
  findUserByEmail,
  createTicket,
  listAgents,
  createManualOnboardingTicket,
  resolveTeamsUserEmail,
  createOnboardingTicket,
  createOffboardingTicket
};
