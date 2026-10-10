const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");

test("tenant isolation, three roles, server-side enforcement and session revocation", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gmr-tenants-"));
  process.env.DATA_ROOT = root;
  delete process.env.DATABASE_URL;
  delete process.env.RESEND_API_KEY;
  const password = crypto.randomBytes(18).toString("base64") + "Aa1!";
  process.env.INITIAL_SUPERVISOR_PASSWORD = password;
  const server = http.createServer(require("../server").handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); return new Promise((r) => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (route, cookie, method = "GET", data) => fetch(base + route, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const login = async (username) => {
    const r = await req("/api/login", null, "POST", { username, password });
    assert.equal(r.status, 200);
    return r.headers.get("set-cookie").split(";")[0];
  };
  const platform = await login("soulzen127@gmail.com");
  const apply = async (name) => {
    const r = await req("/api/account-applications", null, "POST", { username: `${name}@example.com`, displayName: name, accountName: name, password });
    assert.equal(r.status, 202);
    const a = (await r.json()).application;
    assert.equal((await req("/api/account-applications/decision", platform, "POST", { id: a.id, decision: "approve" })).status, 200);
    return login(a.username);
  };
  const a = await apply("alpha");
  const b = await apply("beta");
  const sessionA = (await (await req("/api/session", a)).json()).user;
  const sessionB = (await (await req("/api/session", b)).json()).user;
  assert.notEqual(sessionA.tenantId, sessionB.tenantId);
  assert.equal(sessionA.tenantRole, "owner");
  assert.equal(sessionA.platformAdmin, false);
  const member = async (name, role) => {
    assert.equal((await req("/api/users", a, "POST", { username: name, password, tenantRole: role, tenantId: sessionB.tenantId, role: "supervisor" })).status, 201);
    const cookie = await login(name);
    const changed = await req("/api/change-password", cookie, "POST", { currentPassword: password, newPassword: password + "X" });
    assert.equal(changed.status, 200);
    return changed.headers.get("set-cookie").split(";")[0];
  };
  const editor = await member("a-editor@example.com", "editor");
  const viewer = await member("a-viewer@example.com", "viewer");
  const group = [{ id: "alpha-private", name: "Alpha private portfolio", symbols: ["2330.TW"] }];
  assert.equal((await req("/api/workspace", a, "PUT", { key: "groups", version: 0, value: group })).status, 200);
  for (const cookie of [editor, viewer]) assert.deepEqual((await (await req("/api/workspace", cookie)).json()).data.groups.value, group);
  assert.deepEqual((await (await req("/api/workspace?tenantId=" + sessionA.tenantId, b)).json()).data, {});
  assert.deepEqual((await (await req("/api/workspace", platform)).json()).data, {});
  assert.equal((await req("/api/workspace", editor, "PUT", { tenantId: sessionB.tenantId, username: "beta@example.com", key: "groups", version: 1, value: group })).status, 200);
  assert.deepEqual((await (await req("/api/workspace", b)).json()).data, {});
  assert.equal((await req("/api/workspace", a, "PUT", { key: "groups", version: 1, value: [] })).status, 409);
  for (const route of ["/api/workspace", "/api/tenant", "/api/users", "/api/users/role", "/api/users/status", "/api/users/reset-password", "/api/users/delete", "/api/permissions"]) {
    assert.equal((await req(route, viewer, route === "/api/workspace" || route === "/api/tenant" ? "PUT" : "POST", { key: "groups", value: [], version: 2 })).status, 403, route);
  }
  for (const route of ["/api/users/status", "/api/users/delete", "/api/users/reset-password", "/api/users/role"]) {
    assert.equal((await req(route, a, "POST", { username: "beta@example.com", enabled: false, password, tenantRole: "viewer" })).status, 404, route);
  }
  assert.equal((await req("/api/account-applications", a)).status, 403);
  assert.equal((await req("/api/users", editor)).status, 403);
  assert.equal((await req("/api/users/role", editor, "POST", { username: "a-viewer@example.com", tenantRole: "owner" })).status, 403);
  assert.equal((await req("/api/users/role", a, "POST", { username: "alpha@example.com", tenantRole: "viewer" })).status, 400);
  const roster = (await (await req("/api/users", a)).json()).users;
  assert.equal(roster.length, 3);
  assert.ok(roster.every((u) => u.tenantId === sessionA.tenantId && !u.platformAdmin));
  const auditB = await (await req("/api/audit", b)).json();
  assert.ok(auditB.records.every((r) => r.tenantId === sessionB.tenantId));
  assert.equal((await req("/api/users/role", a, "POST", { username: "a-editor@example.com", tenantRole: "viewer" })).status, 200);
  assert.equal((await req("/api/session", editor)).status, 401);
  assert.equal((await req("/api/permissions", a, "POST", { permissions: { strategy: "supervisor" } })).status, 200);
  assert.equal((await req("/api/instruments?q=2330", viewer)).status, 403);
  assert.equal((await (await req("/api/permissions", b)).json()).permissions.strategy, "user");
});
