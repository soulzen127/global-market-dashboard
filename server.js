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
const SERVER_AUDIT_FILE = path.join(DATA_ROOT, "server-audit.json");
const FAILURES_FILE = path.join(DATA_ROOT, "login-failures.json");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PUBLIC_FILES = new Set(["login.html", "login.css", "login.js"]);
const SUPERVISOR_USERNAME = "soulzen127@gmail.com";
const SUPERVISOR_PASSWORD = process.env.INITIAL_SUPERVISOR_PASSWORD;
const PRIVATE_FILES = new Set(["index.html", "styles.css", "app.js", "strategy.js", "strategy.css", "portfolio.js"]);
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

function recordServerAudit(user, action, target, status) {
  const records = readJsonFile(SERVER_AUDIT_FILE, []);
  records.push({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), user: user?.username || "anonymous", type: "system", action, target, detail: `HTTP ${status}`, before: null, after: null });
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
  return Boolean(user && normalizeRole(user.role) === "supervisor");
}

function getPermissions() {
  const stored = readJsonFile(PERMISSIONS_FILE, {});
  return Object.fromEntries(Object.entries({ ...DEFAULT_PERMISSIONS, ...stored }).map(([key, value]) => [key, normalizeRole(value)]));
}

function savePermissions(permissions) {
  const next = {};
  for (const key of Object.keys(DEFAULT_PERMISSIONS)) next[key] = normalizeRole(permissions[key] || DEFAULT_PERMISSIONS[key]);
  saveJsonFile(PERMISSIONS_FILE, next);
}

function canAccess(user, feature) {
  if (["accountManagement", "permissionSettings", "accountApplications"].includes(feature)) return isSupervisor(user);
  const required = getPermissions()[feature] || "user";
  return required === "supervisor" ? isSupervisor(user) : Boolean(user);
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
  const role = normalizeRole(user.role);
  return {
    username: user.username,
    displayName: user.displayName,
    role,
    roleLabel: roleLabel(role),
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
    requestedRole: normalizeRole(application.requestedRole),
    status: application.status,
    note: application.note,
    requestedAt: application.requestedAt,
    decidedAt: application.decidedAt,
    decidedBy: application.decidedBy
  };
}

function readApplications() {
  return readJsonFile(APPLICATIONS_FILE, []);
}

function saveApplications(applications) {
  saveJsonFile(APPLICATIONS_FILE, applications);
}

function registerMailNotification(application) {
  const outbox = readJsonFile(MAIL_OUTBOX_FILE, []);
  const message = {
    id: `mail-${Date.now()}`,
    to: SUPERVISOR_USERNAME,
    subject: `Global Market Radar 帳號申請待審：${application.username}`,
    body: `帳號 ${application.username} 申請使用 Global Market Radar。請以 Supervisor 登入系統後到帳號管理審核。`,
    status: "queued",
    createdAt: new Date().toISOString()
  };
  outbox.push(message);
  saveJsonFile(MAIL_OUTBOX_FILE, outbox);
  return message;
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
    return user ? json(res, 200, { user: publicUser(user), permissions: getPermissions() }) : json(res, 401, { error: "Authentication required." });
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
    const application = {
      id: `app-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      username,
      displayName: String(payload.displayName || "").trim() || username,
      requestedRole: "user",
      status: "pending",
      note: String(payload.note || ""),
      passwordRecord: newPasswordRecord(password),
      requestedAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null
    };
    applications.push(application);
    saveApplications(applications);
    const notification = registerMailNotification(application);
    return json(res, 202, { application: publicApplication(application), notification });
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

  if (pathname === "/api/workspace" && req.method === "GET") {
    const all = readJsonFile(WORKSPACES_FILE, {});
    const data = all[user.username] || {};
    return json(res, 200, { data: Object.fromEntries(Object.entries(data).filter(([key]) => WORKSPACE_FEATURES[key] && canAccess(user, WORKSPACE_FEATURES[key]))) });
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
    const all = readJsonFile(WORKSPACES_FILE, {});
    const workspace = all[user.username] || {};
    const version = workspace[payload.key]?.version || 0;
    if (payload.version !== version) return json(res, 409, { error: "Workspace changed on another device. Reload before saving." });
    workspace[payload.key] = { value: payload.value, version: version + 1, updatedAt: new Date().toISOString() };
    all[user.username] = workspace;
    saveJsonFile(WORKSPACES_FILE, all);
    return json(res, 200, workspace[payload.key]);
  }

  if (pathname === "/api/audit" && req.method === "GET") {
    if (!canAccess(user, "audit")) return json(res, 403, { error: "Supervisor access required." });
    const records = readJsonFile(SERVER_AUDIT_FILE, []);
    return json(res, 200, { records: records.filter((record) => isSupervisor(user) || record.user === user.username).reverse() });
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
    return json(res, 200, { users: readUsers().map(publicUser) });
  }

  if (pathname === "/api/users" && req.method === "POST") {
    if (!canAccess(user, "accountManagement")) return json(res, 403, { error: "Supervisor access required." });
    const payload = await readJsonBody(req);
    const username = String(payload.username || "").trim().toLowerCase();
    const password = String(payload.password || "");
    if (!testUsername(username)) return json(res, 400, { error: "Invalid username format." });
    if (!testNewPassword(password)) return json(res, 400, { error: "Password policy not satisfied." });
    const users = readUsers();
    if (users.some((candidate) => candidate.username === username)) return json(res, 409, { error: "Username already exists." });
    const account = {
      username,
      displayName: String(payload.displayName || "").trim() || username,
      role: normalizeRole(payload.role),
      enabled: true,
      forcePasswordChange: true,
      ...newPasswordRecord(password),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    users.push(account);
    saveUsers(users);
    return json(res, 201, { user: publicUser(account) });
  }

  if (pathname === "/api/users/status" && req.method === "POST") {
    if (!canAccess(user, "accountManagement")) return json(res, 403, { error: "Supervisor access required." });
    const payload = await readJsonBody(req);
    const username = String(payload.username || "").trim().toLowerCase();
    if ((username === user.username || username === SUPERVISOR_USERNAME) && !payload.enabled) return json(res, 400, { error: "Cannot disable the current account." });
    const users = readUsers();
    const account = users.find((candidate) => candidate.username === username);
    if (!account) return json(res, 404, { error: "User not found." });
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
    const account = users.find((candidate) => candidate.username === username);
    if (!account) return json(res, 404, { error: "User not found." });
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
    if (!users.some((candidate) => candidate.username === username)) return json(res, 404, { error: "User not found." });
    saveUsers(users.filter((candidate) => candidate.username !== username));
    removeUserSessions(username);
    return json(res, 200, { success: true });
  }

  if (pathname === "/api/account-applications" && req.method === "GET") {
    if (!canAccess(user, "accountApplications")) return json(res, 403, { error: "Supervisor access required." });
    return json(res, 200, { applications: readApplications().map(publicApplication) });
  }

  if (pathname === "/api/account-applications/decision" && req.method === "POST") {
    if (!canAccess(user, "accountApplications")) return json(res, 403, { error: "Supervisor access required." });
    const payload = await readJsonBody(req);
    const applications = readApplications();
    const application = applications.find((candidate) => candidate.id === payload.id);
    if (!application || application.status !== "pending") return json(res, 404, { error: "Application not found." });
    application.decidedAt = new Date().toISOString();
    application.decidedBy = user.username;
    if (payload.decision === "approve") {
      const users = readUsers();
      if (users.some((candidate) => candidate.username === application.username)) return json(res, 409, { error: "Username already exists." });
      users.push({
        username: application.username,
        displayName: application.displayName,
        role: "user",
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
    saveApplications(applications);
    return json(res, 200, { application: publicApplication(application) });
  }

  if (pathname === "/api/permissions" && req.method === "GET") {
    if (!canAccess(user, "permissionSettings")) return json(res, 403, { error: "Supervisor access required." });
    return json(res, 200, { permissions: getPermissions() });
  }

  if (pathname === "/api/permissions" && req.method === "POST") {
    if (!canAccess(user, "permissionSettings")) return json(res, 403, { error: "Supervisor access required." });
    const payload = await readJsonBody(req);
    savePermissions(payload.permissions || {});
    return json(res, 200, { permissions: getPermissions() });
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
if (!process.env.DATABASE_URL) { initializeUsers(); ensureSystemState(); }

async function handler(req, res) {
  try {
    const response = await withDatabase(async () => {
    if (databaseState() && !readUsers().length) ensureSystemState();
    // Commit database mutations before returning cookies or a success response.
    const buffered = { statusCode: 200, headersSent: false, body: Buffer.alloc(0), headers: {}, writeHead(status, headers) { this.statusCode = status; this.headers = headers; }, end(body) { this.body = body; this.headersSent = true; } };
    await routeRequest(req, buffered);
    return buffered;
    });
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
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) recordServerAudit(user, req.method, url.pathname, res.statusCode);
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
