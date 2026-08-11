const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.resolve(__dirname);
const IS_VERCEL = process.env.VERCEL === "1";
const DATA_ROOT = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : (IS_VERCEL ? path.join("/tmp", "global-market-dashboard-data") : path.join(ROOT, ".data"));
const USERS_FILE = path.join(DATA_ROOT, "users.json");
const APPLICATIONS_FILE = path.join(DATA_ROOT, "account-applications.json");
const PERMISSIONS_FILE = path.join(DATA_ROOT, "permissions.json");
const MAIL_OUTBOX_FILE = path.join(DATA_ROOT, "mail-outbox.json");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PUBLIC_FILES = new Set(["login.html", "login.css", "login.js"]);
const SUPERVISOR_USERNAME = "soulzen127@gmail.com";
const SUPERVISOR_PASSWORD = "Chichi0902";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash("sha256").update(`${SUPERVISOR_USERNAME}:${SUPERVISOR_PASSWORD}`).digest("hex");
const DEFAULT_PERMISSIONS = {
  dashboard: "user",
  assets: "user",
  watchlists: "user",
  research: "user",
  trend: "user",
  alerts: "user",
  audit: "user",
  sources: "user",
  account: "user",
  accountManagement: "supervisor",
  permissionSettings: "supervisor",
  accountApplications: "supervisor"
};
const sessions = new Map();
const loginFailures = new Map();

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
  if (!fs.existsSync(USERS_FILE)) return [];
  const content = fs.readFileSync(USERS_FILE, "utf8");
  if (!content.trim()) return [];
  const users = JSON.parse(content);
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
  fs.writeFileSync(USERS_FILE, `${JSON.stringify(users, null, 2)}\n`, "utf8");
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const content = fs.readFileSync(filePath, "utf8");
  if (!content.trim()) return fallback;
  return JSON.parse(content);
}

function saveJsonFile(filePath, value) {
  ensureDataRoot();
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
  const required = getPermissions()[feature] || "user";
  return required === "supervisor" ? isSupervisor(user) : Boolean(user);
}

function initializeUsers() {
  ensureDataRoot();
  if (fs.existsSync(USERS_FILE)) return;
  const record = newPasswordRecord("Admin@2026!");
  saveUsers([{
    username: "admin",
    displayName: "System Administrator",
    role: "supervisor",
    enabled: true,
    forcePasswordChange: true,
    ...record,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }]);
}

function ensureSystemState() {
  let users = readUsers();
  let supervisor = users.find((user) => user.username === SUPERVISOR_USERNAME);
  const record = newPasswordRecord(SUPERVISOR_PASSWORD);
  if (!supervisor) {
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
  } else {
    Object.assign(supervisor, record, {
      role: "supervisor",
      enabled: true,
      forcePasswordChange: false,
      updatedAt: new Date().toISOString()
    });
  }
  users = users.map((user) => ({ ...user, role: normalizeRole(user.role) }));
  saveUsers(users);
  if (!fs.existsSync(PERMISSIONS_FILE)) savePermissions(DEFAULT_PERMISSIONS);
  if (!fs.existsSync(APPLICATIONS_FILE)) saveJsonFile(APPLICATIONS_FILE, []);
  if (!fs.existsSync(MAIL_OUTBOX_FILE)) saveJsonFile(MAIL_OUTBOX_FILE, []);
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

function signSessionPayload(payload) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

function createSessionToken(username) {
  const payload = Buffer.from(JSON.stringify({
    username,
    expiresAt: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomBytes(12).toString("base64url")
  })).toString("base64url");
  return `v1.${payload}.${signSessionPayload(payload)}`;
}

function verifySessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, payload, signature] = parts;
  const expected = signSessionPayload(payload);
  const actual = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actual.length !== expectedBuffer.length || !crypto.timingSafeEqual(actual, expectedBuffer)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.username || Date.now() > Number(session.expiresAt)) return null;
    return { username: session.username, expiresAt: Number(session.expiresAt), stateless: true };
  } catch {
    return null;
  }
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
  const entry = loginFailures.get(key);
  if (!entry) return true;
  if (Date.now() > entry.resetAt) {
    loginFailures.delete(key);
    return true;
  }
  return entry.count < 5;
}

function registerLoginFailure(key) {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() > entry.resetAt) {
    loginFailures.set(key, { count: 1, resetAt: Date.now() + 10 * 60 * 1000 });
  } else {
    entry.count += 1;
  }
}

function removeUserSessions(username) {
  for (const [token, session] of sessions.entries()) {
    if (session.username === username) sessions.delete(token);
  }
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie).gmr_session;
  if (!token) return null;
  const session = sessions.get(token) || verifySessionToken(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  const user = readUsers().find((candidate) => candidate.username === session.username && candidate.enabled);
  if (!user) {
    sessions.delete(token);
    return null;
  }
  if (!session.stateless) session.expiresAt = Date.now() + SESSION_TTL_MS;
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
    "Cache-Control": "no-store",
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
        reject(error);
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
      uptimeSeconds: Math.round(process.uptime()),
      checkedAt: new Date().toISOString()
    });
  }

  if (pathname === "/api/login" && req.method === "POST") {
    const payload = await readJsonBody(req);
    const username = String(payload.username || "").trim().toLowerCase();
    const key = clientKey(req);
    if (!rateLimitOk(key)) return json(res, 429, { error: "Too many login attempts. Try again later." });
    const account = readUsers().find((candidate) => candidate.username === username);
    if (!account || !account.enabled || !testPassword(account, payload.password)) {
      registerLoginFailure(key);
      await new Promise((resolve) => setTimeout(resolve, 350));
      return json(res, 401, { error: "Invalid credentials or disabled account." });
    }
    loginFailures.delete(key);
    const token = createSessionToken(account.username);
    sessions.set(token, { username: account.username, expiresAt: Date.now() + SESSION_TTL_MS });
    return json(res, 200, { user: publicUser(account) }, {
      "Set-Cookie": `gmr_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secureCookieSuffix(req)}`
    });
  }

  if (pathname === "/api/session" && req.method === "GET") {
    return user ? json(res, 200, { user: publicUser(user) }) : json(res, 401, { error: "Authentication required." });
  }

  if (pathname === "/api/bootstrap-status" && req.method === "GET") {
    const admin = readUsers().find((candidate) => candidate.username === SUPERVISOR_USERNAME);
    const hasSupervisor = Boolean(admin && admin.enabled);
    return json(res, 200, {
      setupRequired: !hasSupervisor,
      hasSupervisor,
      supervisorUsername: SUPERVISOR_USERNAME,
      loginPath: "/login.html",
      initialPasswordActive: Boolean(admin && admin.forcePasswordChange && testPassword(admin, SUPERVISOR_PASSWORD))
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
    if (token) sessions.delete(token);
    return json(res, 200, { success: true }, {
      "Set-Cookie": `gmr_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookieSuffix(req)}`
    });
  }

  if (!user) return json(res, 401, { error: "Session expired." });

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
    return json(res, 200, { user: publicUser(account) });
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
    if (username === user.username && !payload.enabled) return json(res, 400, { error: "Cannot disable the current account." });
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
    if (username === user.username) return json(res, 400, { error: "Cannot delete the current account." });
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
  if (!isPublic && !user) return redirect(res, "/login.html");
  if (relativePath === "login.html" && user) return redirect(res, "/");

  const filePath = path.resolve(ROOT, relativePath);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) return json(res, 403, { error: "Forbidden." });
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return json(res, 404, { error: "Resource not found." });
  const ext = path.extname(filePath).toLowerCase();
  write(res, 200, req.method === "HEAD" ? Buffer.alloc(0) : fs.readFileSync(filePath), MIME_TYPES[ext] || "application/octet-stream");
}

initializeUsers();
ensureSystemState();

async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const user = currentUser(req);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname, user);
    } else {
      serveStatic(req, res, url.pathname, user);
    }
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: "Internal server error." });
  }
}

module.exports = { handler };

if (require.main === module) {
  const server = http.createServer(handler);
  server.listen(PORT, HOST, () => {
    console.log(`Global market dashboard listening on http://${HOST}:${PORT}`);
  });
}
