// Script de inspección: conecta a la base configurada en .env y lista tablas.
// Uso: node probe-db.js
require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const cs = process.env.DATABASE_URL;
  console.log("Conectando a:", cs.replace(/:[^:@]+@/, ":***@"));

  const client = new Client({
    connectionString: cs,
    ssl: /sslmode=require/i.test(cs) ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 8000,
  });

  try {
    await client.connect();
    console.log("OK conectado.\n");

    const ver = await client.query("SELECT version() AS v");
    console.log("Versión:", ver.rows[0].v, "\n");

    const dbs = await client.query("SELECT current_database() AS db, current_user AS usr");
    console.log("DB actual:", dbs.rows[0].db, "| usuario:", dbs.rows[0].usr, "\n");

    const tablas = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `);
    console.log(`Tablas (${tablas.rows.length}):`);
    tablas.rows.forEach(r => console.log("  -", r.table_schema + "." + r.table_name));
  } catch (err) {
    console.error("ERROR:", err.code || "", err.message);
    if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
      console.error("→ revisar host/puerto/firewall");
    }
    if (err.code === "28P01") console.error("→ usuario o contraseña incorrectos");
    if (err.code === "3D000") console.error("→ la base de datos no existe");
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
