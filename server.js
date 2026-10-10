const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { databaseState, withDatabase } = require("./storage");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.resolve(__dirname);
const IS_VERCEL = process.env.VERCEL === "1";
const DATA_ROOT = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : (IS_VERCEL ? path.join("/tmp", "global-market-dashboard-data") : path.join(ROOT, ".data"));
const USERS_FILE = path.join(DATA_ROOT, "users.json");
const APPLICATIONS_FILE = path.join(DATA_ROOT, "account-applications.json");
const PERMISSIONS_FILE = path.join(DATA_ROOT, "permissions.json");
const MAIL_OUTBOX_FILE = path.join(DATA_ROOT, "mail-outbox.json");
const SESSIONS_FILE = path.join(DATA_ROOT, "sessions.json");
const WORKSPACES_FILE = path.join(DATA_ROOT, "workspaces.json");
const TENANTS_FILE = path.join(DATA_ROOT, "tenants.json");
const TENANT_WORKSPACES_FILE = path.join(DATA_ROOT, "tenant-workspaces.json");
const TENANT_PERMISSIONS_FILE = path.join(DATA_ROOT, "tenant-permissions.json");
const SERVER_AUDIT_FILE = path.join(DATA_ROOT, "server-audit.json");
const FAILURES_FILE = path.join(DATA_ROOT, "login-failures.json");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PUBLIC_FILES = new Set(["login.html", "login.css", "login.js"]);
const SUPERVISOR_USERNAME = "soulzen127@gmail.com";
const SUPERVISOR_PASSWORD = process.env.INITIAL_SUPERVISOR_PASSWORD;
const PRIVATE_FILES = new Set(["index.html", "styles.css", "app.js", "strategy.js", "strategy.css", "portfolio.js", "responsive.css", "responsive.js"]);
const DEFAULT_PERMISSIONS = {
  dashboard: "user",
  assets: "user",
  watchlists: "user",
  research: "user",
  trend: "user",
  alerts: "user",
  audit: "user",
  sources: "user",
  strategy: "user",
  account: "user",
  accountManagement: "supervisor",
  permissionSettings: "supervisor",
  accountApplications: "supervisor"
};
const WORKSPACE_FEATURES = { groups: "watchlists", alerts: "alerts", annotations: "research", strategy: "strategy" };

function recordServerAudit(user, action, target, status, change = {}) {
  const records = readJsonFile(SERVER_AUDIT_FILE, []);
  records.push({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), user: user?.username || "anonymous", tenantId: user?.tenantId || null, type: "system", action, target, detail: `HTTP ${status}`, before: null, after: null, ...change });
  saveJsonFile(SERVER_AUDIT_FILE, records);
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function ensureDataRoot() {
  if (databaseState()) return;
  fs.mkdirSync(DATA_ROOT, { recursive: true });
}

function newPasswordRecord(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256");
  return {
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
    iterations: 120000
  };
}

function testPassword(user, password) {
  if (!user || !user.salt || !user.hash || !user.iterations) return false;
  const salt = Buffer.from(String(user.salt), "base64");
  const expected = Buffer.from(String(user.hash), "base64");
  const actual = crypto.pbkdf2Sync(String(password || ""), salt, Number(user.iterations), expected.length, "sha256");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function readUsers() {
  const users = readJsonFile(USERS_FILE, []);
  const normalized = [];
  const addUsersFromNode = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(addUsersFromNode);
      return;
    }
    if (typeof node.username === "string" && node.username.trim()) {
      normalized.push(node);
      return;
    }
    if (node.value) addUsersFromNode(node.value);
  };
  addUsersFromNode(users);
  return normalized;
}

function saveUsers(users) {
  ensureDataRoot();
  saveJsonFile(USERS_FILE, users);
}

function readJsonFile(filePath, fallback) {
  const state = databaseState();
  if (state) return structuredClone(state.values[path.basename(filePath)] ?? fallback);
  if (!fs.existsSync(filePath)) return fallback;
  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  if (!content.trim()) return fallback;
  return JSON.parse(content);
}

function saveJsonFile(filePath, value) {
  const state = databaseState();
  if (state) { state.values[path.basename(filePath)] = value; state.dirty = true; return; }
  ensureDataRoot();
  const temporaryPath = `${filePath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function normalizeRole(role) {
  return role === "admin" || role === "supervisor" ? "supervisor" : "user";
}

function roleLabel(role) {
  return normalizeRole(role) === "supervisor" ? "L1 Supervisor" : "L2 User";
}

function isSupervisor(user) {
  return Boolean(user && user.username === SUPERVISOR_USERNAME && normalizeRole(user.role) === "supervisor");
}

function isTenantAdmin(user) { return Boolean(user && user.tenantRole === "owner"); }
function sameTenant(a, b) { return Boolean(a?.tenantId && a.tenantId === b?.tenantId); }
function migrateTenants() {
  const users = readUsers();
  const tenants = readJsonFile(TENANTS_FILE, {});
  const workspaces = readJsonFile(TENANT_WORKSPACES_FILE, {});
  const legacy = readJsonFile(WORKSPACES_FILE, {});
  const permissions = readJsonFile(TENANT_PERMISSIONS_FILE, {});
  let changed = false;
  for (const user of users) {
    if (user.tenantId) continue;
    user.tenantId = `tenant-${crypto.createHash("sha256").update(user.username).digest("hex").slice(0, 24)}`;
    user.tenantRole = "owner";
    tenants[user.tenantId] = { id: user.tenantId, name: `${user.displayName || user.username} 的帳戶`, createdAt: new Date().toISOString() };
    workspaces[user.tenantId] = structuredClone(legacy[user.username] || {});
    permissions[user.tenantId] = getPermissions();
    changed = true;
  }
  if (changed) {
    saveJsonFile(TENANTS_FILE, tenants);
    saveJsonFile(TENANT_WORKSPACES_FILE, workspaces);
    saveJsonFile(TENANT_PERMISSIONS_FILE, permissions);
    saveUsers(users);
  }
}

function createTenant(name) {
  const tenants = readJsonFile(TENANTS_FILE, {});
  const id = crypto.randomUUID();
  tenants[id] = { id, name: String(name).trim().slice(0, 100), createdAt: new Date().toISOString() };
  saveJsonFile(TENANTS_FILE, tenants);
  return id;
}

function lastOwner(users, account) {
  return account.enabled && account.tenantRole === "owner" && !users.some((u) => u.username !== account.username && sameTenant(u, account) && u.enabled && u.tenantRole === "owner");
}

function getPermissions(user) {
  const stored = user ? readJsonFile(TENANT_PERMISSIONS_FILE, {})[user.tenantId] || {} : readJsonFile(PERMISSIONS_FILE, {});
  return Object.fromEntries(Object.entries({ ...DEFAULT_PERMISSIONS, ...stored }).map(([key, value]) => [key, normalizeRole(value)]));
}

function savePermissions(permissions, user) {
  const next = {};
  for (const key of Object.keys(DEFAULT_PERMISSIONS)) next[key] = normalizeRole(permissions[key] || DEFAULT_PERMISSIONS[key]);
  if (user) { const all = readJsonFile(TENANT_PERMISSIONS_FILE, {}); all[user.tenantId] = next; saveJsonFile(TENANT_PERMISSIONS_FILE, all); }
  else saveJsonFile(PERMISSIONS_FILE, next);
}

function canAccess(user, feature) {
  if (feature === "accountApplications") return isSupervisor(user);
  if (["accountManagement", "permissionSettings"].includes(feature)) return isTenantAdmin(user);
  const required = getPermissions(user)[feature] || "user";
  return required === "supervisor" ? isTenantAdmin(user) : Boolean(user);
}

function initializeUsers() {
  ensureDataRoot();
  if (databaseState()) return;
  if (fs.existsSync(USERS_FILE)) return;
  saveUsers([]);
}

function ensureSystemState() {
  let users = readUsers();
  let supervisor = users.find((user) => user.username === SUPERVISOR_USERNAME);
  if (!supervisor) {
    if (!SUPERVISOR_PASSWORD) throw new Error("Set INITIAL_SUPERVISOR_PASSWORD to provision the first supervisor.");
    const record = newPasswordRecord(SUPERVISOR_PASSWORD);
    supervisor = {
      username: SUPERVISOR_USERNAME,
      displayName: "Steven Chang",
      role: "supervisor",
      enabled: true,
      forcePasswordChange: false,
      ...record,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    users.push(supervisor);
  }
  users = users.map((user) => ({ ...user, role: normalizeRole(user.role) }));
  saveUsers(users);
  if (!readJsonFile(PERMISSIONS_FILE, null)) savePermissions(DEFAULT_PERMISSIONS);
  if (!readJsonFile(APPLICATIONS_FILE, null)) saveJsonFile(APPLICATIONS_FILE, []);
  if (!readJsonFile(MAIL_OUTBOX_FILE, null)) saveJsonFile(MAIL_OUTBOX_FILE, []);
}

function publicUser(user) {
  const role = isTenantAdmin(user) ? "supervisor" : "user";
  return {
    username: user.username,
    displayName: user.displayName,
    role,
    roleLabel: { owner: "A1 帳戶管理者", editor: "A2 查看與操作", viewer: "A3 僅可瀏覽" }[user.tenantRole],
    tenantId: user.tenantId,
    tenantName: readJsonFile(TENANTS_FILE, {})[user.tenantId]?.name || "",
    tenantRole: user.tenantRole,
    platformAdmin: isSupervisor(user),
    enabled: Boolean(user.enabled),
    forcePasswordChange: Boolean(user.forcePasswordChange),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function publicApplication(application) {
  return {
    id: application.id,
    username: application.username,
    displayName: application.displayName,
    accountName: application.accountName || `${application.displayName} 的帳戶`,
    requestedRole: normalizeRole(application.requestedRole),
    status: application.status,
    note: application.note,
    requestedAt: application.requestedAt,
    decidedAt: application.decidedAt,
    decidedBy: application.decidedBy,
    decisionReason: application.decisionReason || "",
    history: application.history || []
  };
}

function readApplications() {
  return readJsonFile(APPLICATIONS_FILE, []);
}

function saveApplications(applications) {
  saveJsonFile(APPLICATIONS_FILE, applications);
}

function registerMailNotification(application, decision = false) {
  const outbox = readJsonFile(MAIL_OUTBOX_FILE, []);
  const message = {
    id: crypto.randomUUID(),
    applicationId: application.id,
    to: decision ? application.username : SUPERVISOR_USERNAME,
    subject: decision ? "Global Market Radar 帳號申請審核結果" : "Global Market Radar 帳號申請待審",
    body: decision ? `申請編號 ${application.id}：${application.status === "approved" ? "已同意，請使用申請時設定的帳密登入。" : "未通過。"}\n${application.decisionReason || ""}` : `帳號 ${application.username} 申請使用 Global Market Radar。請以 Supervisor 登入系統後到帳號管理審核。申請編號 ${application.id}`,
    status: "queued",
    createdAt: new Date().toISOString()
  };
  outbox.push(message);
  saveJsonFile(MAIL_OUTBOX_FILE, outbox);
  return message;
}

async function dispatchNotification(id) {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return;
  const message = await withDatabase(async () => {
    const outbox = readJsonFile(MAIL_OUTBOX_FILE, []);
    const item = outbox.find((m) => m.id === id);
    if (!item || item.status === "accepted" || (item.status === "sending" && Date.now() - Date.parse(item.lastAttemptAt) < 60000)) return null;
    item.status = "sending";
    item.lastAttemptAt = new Date().toISOString();
    item.attempts = (item.attempts || 0) + 1;
    saveJsonFile(MAIL_OUTBOX_FILE, outbox);
    return { ...item };
  });
  if (!message) return;
  let status = "failed", providerId = null, error = "Network or timeout error";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": message.id },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [message.to], subject: message.subject, text: message.body })
    });
    const result = await response.json();
    if (response.ok && result.id) { status = "accepted"; providerId = result.id; error = null; }
    else error = `Provider HTTP ${response.status}`;
  } catch { /* Persist a retryable outcome without provider secrets. */ }
  await withDatabase(async () => {
    const outbox = readJsonFile(MAIL_OUTBOX_FILE, []);
    const item = outbox.find((m) => m.id === id);
    if (item) Object.assign(item, { status, providerId, error, updatedAt: new Date().toISOString() });
    saveJsonFile(MAIL_OUTBOX_FILE, outbox);
  });
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > -1) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function createSessionToken(username) {
  const token = crypto.randomBytes(32).toString("base64url");
  const stored = readJsonFile(SESSIONS_FILE, {});
  for (const [key, session] of Object.entries(stored)) if (session.expiresAt <= Date.now()) delete stored[key];
  stored[sessionKey(token)] = { username, expiresAt: Date.now() + SESSION_TTL_MS };
  saveJsonFile(SESSIONS_FILE, stored);
  return token;
}

function sessionKey(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function revokeSession(token) {
  if (!token) return;
  const stored = readJsonFile(SESSIONS_FILE, {});
  delete stored[sessionKey(token)];
  saveJsonFile(SESSIONS_FILE, stored);
}

function secureCookieSuffix(req) {
  const proto = req.headers["x-forwarded-proto"];
  const visitor = String(req.headers["cf-visitor"] || "");
  return proto === "https" || visitor.includes('"scheme":"https"') ? "; Secure" : "";
}

function clientKey(req) {
  if (req.headers["cf-connecting-ip"]) return String(req.headers["cf-connecting-ip"]);
  if (req.headers["x-forwarded-for"]) return String(req.headers["x-forwarded-for"]).split(",")[0].trim();
  return req.socket.remoteAddress || "local";
}

function rateLimitOk(key) {
  const entry = readJsonFile(FAILURES_FILE, {})[sessionKey(key)];
  if (!entry) return true;
  if (Date.now() > entry.resetAt) {
    return true;
  }
  return entry.count < 5;
}

function registerLoginFailure(key) {
  const failures = readJsonFile(FAILURES_FILE, {});
  for (const [id, old] of Object.entries(failures)) if (Date.now() > old.resetAt) delete failures[id];
  const entry = failures[sessionKey(key)];
  if (!entry || Date.now() > entry.resetAt) {
    failures[sessionKey(key)] = { count: 1, resetAt: Date.now() + 10 * 60 * 1000 };
  } else {
    entry.count += 1;
  }
  saveJsonFile(FAILURES_FILE, failures);
}

function removeUserSessions(username) {
  const stored = readJsonFile(SESSIONS_FILE, {});
  for (const [key, session] of Object.entries(stored)) if (session.username === username) delete stored[key];
  saveJsonFile(SESSIONS_FILE, stored);
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie).gmr_session;
  if (!token) return null;
  const session = readJsonFile(SESSIONS_FILE, {})[sessionKey(token)];
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    return null;
  }
  const user = readUsers().find((candidate) => candidate.username === session.username && candidate.enabled);
  if (!user) {
    return null;
  }
  return user;
}

function testUsername(username) {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(username) ||
    /^[A-Za-z0-9._-]{3,32}$/.test(username);
}

function testNewPassword(password) {
  return typeof password === "string" &&
    password.length >= 10 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
}

function json(res, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  write(res, status, body, "application/json; charset=utf-8", headers);
}

function write(res, status, body = Buffer.alloc(0), contentType = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    ...headers
  });
  res.end(body);
}

function redirect(res, location) {
  write(res, 302, Buffer.alloc(0), "text/plain; charset=utf-8", { Location: location });
}

function readJsonBody(req) {
  if (req.body !== undefined) {
    if (Buffer.byteLength(typeof req.body === "string" ? req.body : JSON.stringify(req.body)) > 1024 * 1024) return Promise.reject(Object.assign(new Error("Request too large"), { status: 413 }));
    try { return Promise.resolve(typeof req.body === "string" ? JSON.parse(req.body) : req.body); }
    catch { return Promise.reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
  }
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(Object.assign(error, { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res, pathname, user) {
  if (pathname === "/api/health" && req.method === "GET") {
    return json(res, 200, {
      ok: true,
      service: "global-market-dashboard",
      release: "2026-10-10-tenants",
      storage: process.env.DATABASE_URL ? "postgres" : "local-files",
      marketData: "simulation",
      uptimeSeconds: Math.round(process.uptime()),
      checkedAt: new Date().toISOString()
    });
  }

  if (pathname === "/api/login" && req.method === "POST") {
    const payload = await readJsonBody(req);
    const username = String(payload.username || "").trim().toLowerCase();
    const key = `${clientKey(req)}:${username}`;
    if (!rateLimitOk(key)) return json(res, 429, { error: "Too many login attempts. Try again later." });
    const account = readUsers().find((candidate) => candidate.username === username);
    if (!account || !account.enabled || !testPassword(account, payload.password)) {
      registerLoginFailure(key);
      await new Promise((resolve) => setTimeout(resolve, 350));
      return json(res, 401, { error: "Invalid credentials or disabled account." });
    }
    const failures = readJsonFile(FAILURES_FILE, {});
    delete failures[sessionKey(key)];
    saveJsonFile(FAILURES_FILE, failures);
    const token = createSessionToken(account.username);
    return json(res, 200, { user: publicUser(account) }, {
      "Set-Cookie": `gmr_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secureCookieSuffix(req)}`
    });
  }

  if (pathname === "/api/session" && req.method === "GET") {
    return user ? json(res, 200, { user: publicUser(user), permissions: getPermissions(user) }) : json(res, 401, { error: "Authentication required." });
  }

  if (pathname === "/api/bootstrap-status" && req.method === "GET") {
    const admin = readUsers().find((candidate) => candidate.username === SUPERVISOR_USERNAME);
    const hasSupervisor = Boolean(admin && admin.enabled);
    return json(res, 200, {
      setupRequired: !hasSupervisor,
      hasSupervisor,
      supervisorUsername: SUPERVISOR_USERNAME,
      loginPath: "/login.html",
      initialPasswordActive: false
    });
  }

  if (pathname === "/api/account-applications" && req.method === "POST") {
    const payload = await readJsonBody(req);
    const username = String(payload.username || "").trim().toLowerCase();
    const password = String(payload.password || "");
    if (!testUsername(username)) return json(res, 400, { error: "Invalid username format." });
    if (!testNewPassword(password)) return json(res, 400, { error: "Password policy not satisfied." });
    if (readUsers().some((candidate) => candidate.username === username)) return json(res, 409, { error: "Username already exists." });
    const applications = readApplications();
    if (applications.some((candidate) => candidate.username === username && candidate.status === "pending")) return json(res, 409, { error: "Application already pending." });
    if (applications.filter((a) => Date.now() - Date.parse(a.requestedAt) < 3600000).length >= 20) return json(res, 429, { error: "Too many applications. Please retry later." });
    const application = {
      id: `app-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      username,
      displayName: String(payload.displayName || "").trim().slice(0, 100) || username,
      requestedRole: "user",
      accountName: String(payload.accountName || `${payload.displayName || username} 的帳戶`).trim().slice(0, 100),
      status: "pending",
      note: String(payload.note || "").slice(0, 2000),
      passwordRecord: newPasswordRecord(password),
      requestedAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null,
      history: [{ action: "submitted", at: new Date().toISOString(), actor: username }]
    };
    applications.push(application);
    saveApplications(applications);
    const notification = registerMailNotification(application);
    req.notificationIds = [notification.id];
    return json(res, 202, { application: publicApplication(application), notification: { status: "queued", configured: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM) } });
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    const token = parseCookies(req.headers.cookie).gmr_session;
    revokeSession(token);
    return json(res, 200, { success: true }, {
      "Set-Cookie": `gmr_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookieSuffix(req)}`
    });
  }

  if (!user) return json(res, 401, { error: "Session expired." });
  if (user.forcePasswordChange && pathname !== "/api/change-password") return json(res, 403, { error: "Password change required." });
  if (user.tenantRole === "viewer" && !["GET", "HEAD"].includes(req.method) && pathname !== "/api/change-password") return json(res, 403, { error: "Read-only account." });

  if (pathname === "/api/workspace" && req.method === "GET") {
    const all = readJsonFile(TENANT_WORKSPACES_FILE, {});
    const data = all[user.tenantId] || {};
    return json(res, 200, { data: Object.fromEntries(Object.entries(data).filter(([key]) => WORKSPACE_FEATURES[key] && canAccess(user, WORKSPACE_FEATURES[key]))) });
  }

  if (pathname === "/api/tenant" && req.method === "PUT") {
    if (!isTenantAdmin(user)) return json(res, 403, { error: "Supervisor access required." });
    const payload = await readJsonBody(req);
    const name = String(payload.name || "").trim().slice(0, 100);
    if (!name) return json(res, 400, { error: "Account name is required." });
    const tenants = readJsonFile(TENANTS_FILE, {});
    tenants[user.tenantId].name = name;
    saveJsonFile(TENANTS_FILE, tenants);
    return json(res, 200, { tenant: tenants[user.tenantId] });
  }

  if (pathname === "/api/workspace" && req.method === "PUT") {
    const payload = await readJsonBody(req);
    const feature = WORKSPACE_FEATURES[payload.key];
    if (!feature || !Object.hasOwn(WORKSPACE_FEATURES, payload.key)) return json(res, 400, { error: "Invalid workspace section." });
    if (!canAccess(user, feature)) return json(res, 403, { error: "Supervisor access required." });
    if (payload.key !== "strategy" && !Array.isArray(payload.value)) return json(res, 400, { error: "Expected a list." });
    if (payload.key === "strategy" && (!payload.value || typeof payload.value !== "object" || Array.isArray(payload.value))) return json(res, 400, { error: "Invalid strategy." });
    if (payload.key === "strategy") {
      const value = payload.value;
      const lists = ["positions", "constituents", "decisions"];
      if (lists.some((key) => !Array.isArray(value[key]))) return json(res, 400, { error: "Invalid strategy lists." });
      for (const key of ["cashTwd", "concentrationLimit", "cashFloor"]) {
        const number = Number(value[key] ?? "");
        if (!Number.isFinite(number) || number < 0 || (key !== "cashTwd" && number > 100)) return json(res, 400, { error: "Invalid strategy threshold." });
      }
      if (value.decisions.some((d) => !d || typeof d !== "object" || Array.isArray(d))) return json(res, 400, { error: "Invalid decision." });
      if (value.positions.some((p) => !p || typeof p.symbol !== "string" || !Number.isFinite(Number(p.marketValueTwd)) || Number(p.marketValueTwd) < 0)) return json(res, 400, { error: "Invalid position." });
      if (value.constituents.some((c) => !c || typeof c.etf !== "string" || typeof c.company !== "string" || !Number.isFinite(Number(c.weight)) || Number(c.weight) < 0 || Number(c.weight) > 100)) return json(res, 400, { error: "Invalid ETF constituent." });
      const totals = new Map();
      for (const c of value.constituents) totals.set(c.etf, (totals.get(c.etf) || 0) + Number(c.weight));
      if ([...totals.values()].some((weight) => weight > 100)) return json(res, 400, { error: "ETF weights exceed 100%." });
    }
    if (payload.key === "groups" && payload.value.some((g) => !g || typeof g.id !== "string" || typeof g.name !== "string" || !Array.isArray(g.symbols))) return json(res, 400, { error: "Invalid group." });
    const all = readJsonFile(TENANT_WORKSPACES_FILE, {});
    const workspace = all[user.tenantId] || {};
    const version = workspace[payload.key]?.version || 0;
    if (payload.version !== version) return json(res, 409, { error: "Workspace changed on another device. Reload before saving." });
    workspace[payload.key] = { value: payload.value, version: version + 1, updatedAt: new Date().toISOString() };
    all[user.tenantId] = workspace;
    saveJsonFile(TENANT_WORKSPACES_FILE, all);
    return json(res, 200, workspace[payload.key]);
  }

  if (pathname === "/api/audit" && req.method === "GET") {
    if (!canAccess(user, "audit")) return json(res, 403, { error: "Supervisor access required." });
    const records = readJsonFile(SERVER_AUDIT_FILE, []);
    return json(res, 200, { records: records.filter((record) => record.tenantId === user.tenantId || (!record.tenantId && record.user === user.username)).reverse() });
  }

  if (pathname === "/api/change-password" && req.method === "POST") {
    const payload = await readJsonBody(req);
    if (!testNewPassword(payload.newPassword)) return json(res, 400, { error: "Password policy not satisfied." });
    const users = readUsers();
    const account = users.find((candidate) => candidate.username === user.username);
    if (!testPassword(account, payload.currentPassword)) return json(res, 400, { error: "Current password is incorrect." });
    Object.assign(account, newPasswordRecord(payload.newPassword), {
      forcePasswordChange: false,
      updatedAt: new Date().toISOString()
    });
    saveUsers(users);
    removeUserSessions(account.username);
    const token = createSessionToken(account.username);
    return json(res, 200, { user: publicUser(account) }, { "Set-Cookie": `gmr_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secureCookieSuffix(req)}` });
  }

  if (pathname === "/api/users" && req.method === "GET") {
    if (!canAccess(user, "accountManagement")) return json(res, 403, { error: "Supervisor access required." });
    return json(res, 200, { users: readUsers().filter((candidate) => sameTenant(candidate, user)).map(publicUser) });
  }

  if (pathname === "/api/users" && req.method === "POST") {
    if (!canAccess(user, "accountManagement")) return json(res, 403, { error: "Supervisor access required." });
    const payload = await readJsonBody(req);
    if (!["owner", "editor", "viewer"].includes(payload.tenantRole)) return json(res, 400, { error: "Invalid tenant role." });
    const username = String(payload.username || "").trim().toLowerCase();
    const password = String(payload.password || "");
    if (!testUsername(username)) return json(res, 400, { error: "Invalid username format." });
    if (!testNewPassword(password)) return json(res, 400, { error: "Password policy not satisfied." });
    const users = readUsers();
    if (users.some((candidate) => candidate.username === username)) return json(res, 409, { error: "Username already exists." });
    const account = {
      username,
      displayName: String(payload.displayName || "").trim() || username,
      role: "user",
      tenantId: user.tenantId,
      tenantRole: payload.tenantRole,
      enabled: true,
      forcePasswordChange: true,
      ...newPasswordRecord(password),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    users.push(account);
    saveUsers(users);
    req.auditChange = { target: username, detail: "Created tenant member", after: { tenantRole: account.tenantRole } };
    return json(res, 201, { user: publicUser(account) });
  }

  if (pathname === "/api/users/status" && req.method === "POST") {
    if (!canAccess(user, "accountManagement")) return json(res, 403, { error: "Supervisor access required." });
    const payload = await readJsonBody(req);
    const username = String(payload.username || "").trim().toLowerCase();
    if ((username === user.username || username === SUPERVISOR_USERNAME) && !payload.enabled) return json(res, 400, { error: "Cannot disable the current account." });
    const users = readUsers();
    const account = users.find((candidate) => candidate.username === username && sameTenant(candidate, user));
    if (!account) return json(res, 404, { error: "User not found." });
    if (!payload.enabled && lastOwner(users, account)) return json(res, 400, { error: "Cannot remove the last owner." });
    account.enabled = Boolean(payload.enabled);
    account.updatedAt = new Date().toISOString();
    saveUsers(users);
    if (!account.enabled) removeUserSessions(username);
    return json(res, 200, { user: publicUser(account) });
  }

  if (pathname === "/api/users/reset-password" && req.method === "POST") {
    if (!canAccess(user, "accountManagement")) return json(res, 403, { error: "Supervisor access required." });
    const payload = await readJsonBody(req);
    const username = String(payload.username || "").trim().toLowerCase();
    const password = String(payload.password || "");
    if (!testNewPassword(password)) return json(res, 400, { error: "Password policy not satisfied." });
    const users = readUsers();
    const account = users.find((candidate) => candidate.username === username && sameTenant(candidate, user));
    if (!account) return json(res, 404, { error: "User not found." });
    if (isSupervisor(account) && !isSupervisor(user)) return json(res, 403, { error: "Supervisor access required." });
    Object.assign(account, newPasswordRecord(password), {
      forcePasswordChange: true,
      updatedAt: new Date().toISOString()
    });
    saveUsers(users);
    removeUserSessions(username);
    return json(res, 200, { user: publicUser(account) });
  }

  if (pathname === "/api/users/delete" && req.method === "POST") {
    if (!canAccess(user, "accountManagement")) return json(res, 403, { error: "Supervisor access required." });
    const payload = await readJsonBody(req);
    const username = String(payload.username || "").trim().toLowerCase();
    if (username === user.username || username === SUPERVISOR_USERNAME) return json(res, 400, { error: "Cannot delete the current account." });
    const users = readUsers();
    const account = users.find((candidate) => candidate.username === username && sameTenant(candidate, user));
    if (!account) return json(res, 404, { error: "User not found." });
    if (lastOwner(users, account)) return json(res, 400, { error: "Cannot remove the last owner." });
    saveUsers(users.filter((candidate) => candidate.username !== username));
    removeUserSessions(username);
    return json(res, 200, { success: true });
  }

  if (pathname === "/api/users/role" && req.method === "POST") {
    if (!isTenantAdmin(user)) return json(res, 403, { error: "Supervisor access required." });
    const payload = await readJsonBody(req);
    if (!["owner", "editor", "viewer"].includes(payload.tenantRole)) return json(res, 400, { error: "Invalid tenant role." });
    const users = readUsers();
    const account = users.find((u) => u.username === payload.username && sameTenant(u, user));
    if (!account) return json(res, 404, { error: "User not found." });
    if (account.username === user.username || isSupervisor(account) || (payload.tenantRole !== "owner" && lastOwner(users, account))) return json(res, 400, { error: "Cannot change this owner role." });
    req.auditChange = { target: account.username, detail: "Changed tenant member role; sessions revoked", before: { tenantRole: account.tenantRole }, after: { tenantRole: payload.tenantRole } };
    account.tenantRole = payload.tenantRole;
    account.updatedAt = new Date().toISOString();
    saveUsers(users); removeUserSessions(account.username);
    return json(res, 200, { user: publicUser(account) });
  }

  if (pathname === "/api/account-applications" && req.method === "GET") {
    if (!canAccess(user, "accountApplications")) return json(res, 403, { error: "Supervisor access required." });
    return json(res, 200, { applications: readApplications().map(publicApplication), notifications: readJsonFile(MAIL_OUTBOX_FILE, []).map(({ body, ...item }) => item), mailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM) });
  }

  if (pathname === "/api/notifications/retry" && req.method === "POST") {
    if (!canAccess(user, "accountApplications")) return json(res, 403, { error: "Supervisor access required." });
    const payload = await readJsonBody(req);
    const item = readJsonFile(MAIL_OUTBOX_FILE, []).find((m) => m.id === payload.id);
    if (!item) return json(res, 404, { error: "Notification not found." });
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return json(res, 409, { error: "Mail service is not configured." });
    req.notificationIds = [item.id];
    return json(res, 202, { status: "queued" });
  }

  if (pathname === "/api/account-applications/decision" && req.method === "POST") {
    if (!canAccess(user, "accountApplications")) return json(res, 403, { error: "Supervisor access required." });
    const payload = await readJsonBody(req);
    if (!["approve", "reject"].includes(payload.decision)) return json(res, 400, { error: "Invalid decision." });
    const reason = String(payload.reason || "").trim().slice(0, 2000);
    if (payload.decision === "reject" && !reason) return json(res, 400, { error: "Rejection reason is required." });
    const applications = readApplications();
    const application = applications.find((candidate) => candidate.id === payload.id);
    if (!application || application.status !== "pending") return json(res, 404, { error: "Application not found." });
    if (payload.decision === "approve") {
      const users = readUsers();
      if (users.some((candidate) => candidate.username === application.username)) return json(res, 409, { error: "Username already exists." });
      users.push({
        username: application.username,
        displayName: application.displayName,
        role: "user",
        tenantId: createTenant(application.accountName || `${application.displayName} 的帳戶`),
        tenantRole: "owner",
        enabled: true,
        forcePasswordChange: false,
        ...application.passwordRecord,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      saveUsers(users);
      application.status = "approved";
    } else {
      application.status = "rejected";
    }
    application.decidedAt = new Date().toISOString();
    application.decidedBy = user.username;
    application.decisionReason = reason;
    application.history = [...(application.history || []), { action: application.status, at: application.decidedAt, actor: user.username, reason }];
    delete application.passwordRecord;
    saveApplications(applications);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(application.username)) req.notificationIds = [registerMailNotification(application, true).id];
    return json(res, 200, { application: publicApplication(application) });
  }

  if (pathname === "/api/permissions" && req.method === "GET") {
    if (!canAccess(user, "permissionSettings")) return json(res, 403, { error: "Supervisor access required." });
    return json(res, 200, { permissions: getPermissions(user) });
  }

  if (pathname === "/api/permissions" && req.method === "POST") {
    if (!canAccess(user, "permissionSettings")) return json(res, 403, { error: "Supervisor access required." });
    const payload = await readJsonBody(req);
    savePermissions(payload.permissions || {}, user);
    return json(res, 200, { permissions: getPermissions(user) });
  }

  return json(res, 405, { error: "Method not allowed." });
}

function serveStatic(req, res, pathname, user) {
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed." });
  let relativePath = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  if (/^(setup|setup\.html|admin-setup|bootstrap|init|initialize)(\/.*)?$/.test(relativePath)) {
    return redirect(res, "/login.html");
  }
  if (relativePath.startsWith(".") || ["server.ps1", "server.js", "package.json"].includes(relativePath)) {
    return json(res, 403, { error: "Forbidden." });
  }
  const isPublic = PUBLIC_FILES.has(relativePath);
  if (!isPublic && !PRIVATE_FILES.has(relativePath)) return json(res, 404, { error: "Resource not found." });
  if (!isPublic && !user) return redirect(res, "/login.html");
  if (relativePath === "login.html" && user) return redirect(res, "/");

  const filePath = path.resolve(ROOT, relativePath);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) return json(res, 403, { error: "Forbidden." });
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return json(res, 404, { error: "Resource not found." });
  const ext = path.extname(filePath).toLowerCase();
  write(res, 200, req.method === "HEAD" ? Buffer.alloc(0) : fs.readFileSync(filePath), MIME_TYPES[ext] || "application/octet-stream");
}

if (IS_VERCEL && !process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL for durable Vercel storage.");
if (process.env.RENDER && !process.env.DATABASE_URL && !process.env.DATA_ROOT) throw new Error("Configure DATABASE_URL or a persistent DATA_ROOT before cloud deployment.");
if (!process.env.DATABASE_URL) { initializeUsers(); ensureSystemState(); migrateTenants(); }

async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/instruments" && req.method === "GET") {
      const access = await withDatabase(async () => {
        const user = currentUser(req);
        return !user ? 401 : user.forcePasswordChange || !canAccess(user, "strategy") ? 403 : 200;
      });
      if (access !== 200) return json(res, access, { error: "Authentication or strategy permission required." });
      const query = (url.searchParams.get("q") || "").slice(0, 100);
      if (!query.trim()) return json(res, 200, { items: [] });
      // Fetch outside the database transaction so provider latency does not hold the state lock.
      try {
        const items = await require("./market-data").instruments();
        return json(res, 200, { items: require("./portfolio").search(items, query).slice(0, 60), source: "TWSE closing prices" });
      } catch { return json(res, 503, { error: "Official closing prices unavailable. Use manual valuation." }); }
    }
    const response = await withDatabase(async () => {
    if (databaseState() && !readUsers().length) ensureSystemState();
    migrateTenants();
    // Commit database mutations before returning cookies or a success response.
    const buffered = { statusCode: 200, headersSent: false, body: Buffer.alloc(0), headers: {}, writeHead(status, headers) { this.statusCode = status; this.headers = headers; }, end(body) { this.body = body; this.headersSent = true; } };
    await routeRequest(req, buffered);
    return buffered;
    });
    for (const id of req.notificationIds || []) {
      try { await dispatchNotification(id); } catch { console.error("Notification remains pending"); }
    }
    res.writeHead(response.statusCode, response.headers);
    res.end(response.body);
  } catch (error) {
    console.error("Request failed:", error.name);
    if (!res.headersSent) json(res, error.status || 503, { error: error.status === 400 ? "Invalid JSON." : "Service temporarily unavailable. Please retry." });
  }
}

async function routeRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin) {
      const origin = new URL(req.headers.origin);
      if (origin.host !== req.headers.host) return json(res, 403, { error: "Origin not allowed." });
    }
    const user = currentUser(req);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname, user);
    } else {
      serveStatic(req, res, url.pathname, user);
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) recordServerAudit(user, req.method, url.pathname, res.statusCode, req.auditChange);
  } catch (error) {
    throw error;
  }
}

module.exports = { handler };

if (require.main === module) {
  const server = http.createServer(handler);
  server.listen(PORT, HOST, () => {
    console.log(`Global market dashboard listening on http://${HOST}:${PORT}`);
  });
}
