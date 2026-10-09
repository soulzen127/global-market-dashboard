const { AsyncLocalStorage } = require("node:async_hooks");
const context = new AsyncLocalStorage();
let pool;
let initialized;

function databaseState() { return context.getStore(); }

async function withDatabase(action) {
  if (!process.env.DATABASE_URL) return action();
  if (!pool) {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });
    pool.on("error", () => console.error("Database connection interrupted"));
  }
  if (!initialized) {
    initialized = pool.query("CREATE TABLE IF NOT EXISTS gmr_state (id integer PRIMARY KEY CHECK (id = 1), document jsonb NOT NULL)")
      .then(() => pool.query("INSERT INTO gmr_state (id, document) VALUES (1, '{}'::jsonb) ON CONFLICT DO NOTHING"))
      .catch((error) => { initialized = null; throw error; });
  }
  await initialized;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");
    const result = await client.query("SELECT document FROM gmr_state WHERE id = 1 FOR UPDATE");
    const state = { values: result.rows[0].document, dirty: false };
    const response = await context.run(state, action);
    if (state.dirty) await client.query("UPDATE gmr_state SET document = $1::jsonb WHERE id = 1", [JSON.stringify(state.values)]);
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

module.exports = { databaseState, withDatabase };
