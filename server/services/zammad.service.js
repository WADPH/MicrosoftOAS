const { graphRequest } = require("./graph");
const { getTenantConfig } = require("./tenantConfig");

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

async function resolveTeamsUserEmail(userId) {
  console.log(`[Zammad] Resolving Teams user ID across tenants: ${userId}`);

  const tenants = process.env.TENANTS ? process.env.TENANTS.split(',').map(t => t.trim()) : ['EIGROUP'];

  for (const tenantKey of tenants) {
    try {
      console.log(`[Zammad] Checking tenant: ${tenantKey}`);
      const user = await graphRequest("GET", `/users/${userId}`, null, tenantKey);
      if (user && user.mail) {
        console.log(`[Zammad] Found email in tenant ${tenantKey}: ${user.mail}`);
        return user.mail;
      }
    } catch (error) {
      console.warn(`[Zammad] Failed to resolve user in tenant ${tenantKey}: ${error.message}`);
    }
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

async function createOnboardingTicket(task, senderEmail) {
  if (!process.env.ZAMMAD_ENABLED || process.env.ZAMMAD_ENABLED.toLowerCase() !== 'true') {
    console.log(`[Zammad] Integration disabled`);
    return;
  }

  try {
    // Resolve email from Teams sender
    let customerEmail = senderEmail;
    if (!customerEmail) {
      const fromId = task.from?.id;
      if (fromId) {
        customerEmail = await resolveTeamsUserEmail(fromId);
      }
    }

    // Find Zammad user
    let customer = null;
    if (customerEmail) {
      customer = await findUserByEmail(customerEmail);
    }

    // Fallback to default customer
    if (!customer) {
      const defaultCustomer = process.env.ZAMMAD_DEFAULT_CUSTOMER || 'eigsystem@outlook.com';
      console.log(`[Zammad] Using default customer: ${defaultCustomer}`);
      customer = await findUserByEmail(defaultCustomer);
      if (!customer) {
        throw new Error(`Default customer ${defaultCustomer} not found in Zammad`);
      }
    }

    // Create ticket
    const ticketData = {
      title: `New employee - ${task.firstName} ${task.lastName}`,
      group: "Not Sorted",
      customer_id: customer.id,
      priority: "2 normal",
      article: {
        subject: `New employee - ${task.firstName} ${task.lastName}`,
        body: "Onboarding request created from Microsoft OAS",
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