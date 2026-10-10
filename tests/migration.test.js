const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("legacy personal workspaces are copied separately without changing original data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gmr-migration-"));
  process.env.DATA_ROOT = root;
  delete process.env.DATABASE_URL;
  const users = [
    { username: "soulzen127@gmail.com", role: "supervisor", enabled: true },
    { username: "legacy-user", role: "user", enabled: true }
  ];
  const original = JSON.stringify({ "soulzen127@gmail.com": { groups: { version: 4, value: [{ id: "one", name: "original", symbols: [] }] } }, "legacy-user": { strategy: { version: 2, value: { positions: [{ symbol: "PRIVATE" }] } } } });
  fs.writeFileSync(path.join(root, "users.json"), JSON.stringify(users));
  fs.writeFileSync(path.join(root, "workspaces.json"), original);
  require("../server");
  const migrated = JSON.parse(fs.readFileSync(path.join(root, "users.json")));
  const content = JSON.parse(fs.readFileSync(path.join(root, "tenant-workspaces.json")));
  assert.notEqual(migrated[0].tenantId, migrated[1].tenantId);
  for (const user of migrated) assert.deepEqual(content[user.tenantId], JSON.parse(original)[user.username]);
  assert.equal(fs.readFileSync(path.join(root, "workspaces.json"), "utf8"), original);
  const after = fs.readFileSync(path.join(root, "tenant-workspaces.json"), "utf8");
  delete require.cache[require.resolve("../server")];
  require("../server");
  assert.equal(fs.readFileSync(path.join(root, "tenant-workspaces.json"), "utf8"), after);
});
