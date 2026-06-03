/**
 * Migración SQLite (boletas.db) -> PostgreSQL (DATABASE_URL).
 * Crea el esquema vacío SIN seeds, copia filas preservando IDs y resetea
 * sequences. Idempotente: cada corrida limpia las tablas destino.
 *
 * Uso: node migrate-sqlite-to-pg.js
 */
require("dotenv").config();
const sqlite3 = require("sqlite3");
const { Pool } = require("pg");

const SQLITE_PATH = "./boletas.db";
const cs = process.env.DATABASE_URL;
if (!cs) { console.error("DATABASE_URL no definida"); process.exit(1); }

const pool = new Pool({
  connectionString: cs,
  ssl: /sslmode=require/i.test(cs) ? { rejectUnauthorized: false } : undefined,
});

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS usuarios (
     id SERIAL PRIMARY KEY,
     username TEXT UNIQUE,
     password TEXT,
     rol TEXT DEFAULT 'usuario',
     permisos TEXT DEFAULT 'canjear,generar,informes,reimprimir,validar',
     modulos TEXT DEFAULT 'bono,pedidos,agropecuaria',
     submodulos TEXT DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS boletas (
     id SERIAL PRIMARY KEY,
     nombre TEXT, cedula TEXT, fecha TEXT,
     monto DOUBLE PRECISION,
     codigo TEXT UNIQUE, estado TEXT, vencimiento TEXT,
     impreso INTEGER DEFAULT 0,
     consecutivo_canje INTEGER, fecha_canje TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS logs (
     id SERIAL PRIMARY KEY,
     usuario TEXT, accion TEXT, fecha TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS productos (
     id SERIAL PRIMARY KEY,
     referencia TEXT, nombre TEXT NOT NULL, descripcion TEXT,
     precio DOUBLE PRECISION NOT NULL,
     unidad_medida TEXT DEFAULT 'UNIDAD',
     activo INTEGER DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS clientes (
     id SERIAL PRIMARY KEY,
     nombre TEXT NOT NULL, cedula TEXT, telefono TEXT,
     direccion TEXT, referencia TEXT, barrio TEXT, ciudad TEXT,
     region TEXT, punto_venta TEXT, email TEXT, observaciones TEXT,
     activo INTEGER DEFAULT 1, fecha_registro TEXT,
     confirmacion_codigo TEXT
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_cedula
     ON clientes(cedula) WHERE cedula IS NOT NULL AND cedula != ''`,
  `CREATE TABLE IF NOT EXISTS puntos_venta (
     id SERIAL PRIMARY KEY,
     indicador INTEGER NOT NULL UNIQUE,
     nombre TEXT NOT NULL,
     activo INTEGER DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS pedidos (
     id SERIAL PRIMARY KEY,
     cliente_nombre TEXT NOT NULL, cliente_cedula TEXT,
     fecha TEXT NOT NULL,
     estado TEXT DEFAULT 'PENDIENTE',
     total DOUBLE PRECISION DEFAULT 0,
     observaciones TEXT,
     punto_venta_id INTEGER, numero_pedido TEXT,
     kilos DOUBLE PRECISION DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS pedido_items (
     id SERIAL PRIMARY KEY,
     pedido_id INTEGER NOT NULL,
     producto_nombre TEXT NOT NULL,
     cantidad INTEGER NOT NULL DEFAULT 1,
     precio_unitario DOUBLE PRECISION NOT NULL,
     subtotal DOUBLE PRECISION NOT NULL,
     FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
   )`,
  `CREATE TABLE IF NOT EXISTS agro_productos (
     id SERIAL PRIMARY KEY,
     referencia TEXT, nombre TEXT NOT NULL, descripcion TEXT, categoria TEXT,
     precio DOUBLE PRECISION NOT NULL,
     unidad_medida TEXT DEFAULT 'UNIDAD',
     stock INTEGER DEFAULT 0, activo INTEGER DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS agro_rutas (
     id SERIAL PRIMARY KEY,
     nombre TEXT NOT NULL, recorrido TEXT, ciudad TEXT,
     kls_recorridos DOUBLE PRECISION DEFAULT 0,
     tiempo TEXT, horas DOUBLE PRECISION DEFAULT 0,
     activo INTEGER DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS agro_distribuidores (
     id SERIAL PRIMARY KEY,
     nombre TEXT NOT NULL, cedula_nit TEXT, telefono TEXT,
     direccion TEXT, ciudad TEXT, zona TEXT, email TEXT,
     observaciones TEXT, activo INTEGER DEFAULT 1, fecha_registro TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS agro_ordenes (
     id SERIAL PRIMARY KEY,
     numero_orden TEXT, distribuidor_id INTEGER,
     distribuidor_nombre TEXT NOT NULL, fecha TEXT NOT NULL,
     estado TEXT DEFAULT 'PENDIENTE',
     total DOUBLE PRECISION DEFAULT 0, observaciones TEXT,
     observacion_servicio TEXT DEFAULT 'Sin Novedad',
     novedades TEXT, responsabilidades TEXT, detalles TEXT,
     FOREIGN KEY (distribuidor_id) REFERENCES agro_distribuidores(id)
   )`,
  `CREATE TABLE IF NOT EXISTS agro_orden_items (
     id SERIAL PRIMARY KEY,
     orden_id INTEGER NOT NULL,
     producto_nombre TEXT NOT NULL,
     cantidad INTEGER NOT NULL DEFAULT 1,
     precio_unitario DOUBLE PRECISION NOT NULL,
     subtotal DOUBLE PRECISION NOT NULL,
     cantidad_entregada INTEGER DEFAULT 0,
     FOREIGN KEY (orden_id) REFERENCES agro_ordenes(id) ON DELETE CASCADE
   )`,
  `CREATE TABLE IF NOT EXISTS agro_tripulacion (
     id SERIAL PRIMARY KEY,
     nombre TEXT,
     cedula TEXT DEFAULT '',
     telefono TEXT DEFAULT '',
     rol TEXT DEFAULT 'Conductor',
     nombres TEXT DEFAULT '',
     apellidos TEXT DEFAULT '',
     tipo TEXT DEFAULT ''
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_agro_tripulacion_cedula
     ON agro_tripulacion(cedula)`,
  `CREATE TABLE IF NOT EXISTS agro_vehiculos (
     id SERIAL PRIMARY KEY,
     placa TEXT NOT NULL,
     conductor TEXT NOT NULL,
     disponibilidad TEXT DEFAULT '',
     activo INTEGER DEFAULT 1,
     tripulacion_id INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS agro_clientes (
     id SERIAL PRIMARY KEY,
     codigo BIGINT,
     codigo_concatenado TEXT,
     nombre TEXT NOT NULL,
     direccion TEXT, barrio TEXT, ciudad TEXT, departamento TEXT,
     telefono TEXT, activo INTEGER DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS agro_asignaciones (
     id SERIAL PRIMARY KEY,
     vehiculo_id INTEGER NOT NULL,
     vehiculo_placa TEXT, vehiculo_conductor TEXT,
     fecha TEXT NOT NULL, observaciones TEXT,
     estado TEXT DEFAULT 'ACTIVA',
     observacion_servicio TEXT DEFAULT 'Sin Novedad',
     fecha_exportacion TEXT,
     auxiliar TEXT DEFAULT '',
     FOREIGN KEY (vehiculo_id) REFERENCES agro_vehiculos(id)
   )`,
  `CREATE TABLE IF NOT EXISTS agro_asignacion_ordenes (
     id SERIAL PRIMARY KEY,
     asignacion_id INTEGER NOT NULL,
     orden_id INTEGER NOT NULL,
     FOREIGN KEY (asignacion_id) REFERENCES agro_asignaciones(id) ON DELETE CASCADE,
     FOREIGN KEY (orden_id) REFERENCES agro_ordenes(id)
   )`,
  `CREATE TABLE IF NOT EXISTS agro_contadores (
     nombre TEXT PRIMARY KEY,
     valor INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS agro_plantillas_dl (
     consecutivo SERIAL PRIMARY KEY,
     placa TEXT NOT NULL,
     conductor TEXT,
     auxiliar TEXT DEFAULT '',
     fecha_despacho TEXT, origen TEXT, hora_salida TEXT, ruta TEXT,
     total_documentos INTEGER DEFAULT 0,
     total_kilos DOUBLE PRECISION DEFAULT 0,
     ordenes_json TEXT,
     created_at TEXT DEFAULT (CURRENT_TIMESTAMP::text)
   )`,
];

const INSERT_ORDER = [
  "usuarios", "boletas", "logs",
  "productos", "clientes", "puntos_venta",
  "agro_productos", "agro_rutas", "agro_distribuidores",
  "agro_tripulacion", "agro_clientes", "agro_contadores",
  "pedidos", "agro_ordenes", "agro_vehiculos",
  "pedido_items", "agro_orden_items",
  "agro_asignaciones", "agro_asignacion_ordenes",
  "agro_plantillas_dl",
];

const PK_COLUMN = {
  agro_contadores: null,
  agro_plantillas_dl: "consecutivo",
};

const sqlite = new sqlite3.Database(SQLITE_PATH, sqlite3.OPEN_READONLY);
const sqliteAll = (sql, p = []) => new Promise((res, rej) =>
  sqlite.all(sql, p, (e, r) => (e ? rej(e) : res(r))));

const getSqliteCols = async (t) =>
  (await sqliteAll(`PRAGMA table_info(${t})`)).map(x => x.name);

const getPgCols = async (t) => (await pool.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
  [t])).rows.map(x => x.column_name);

const tableExistsSqlite = async (t) =>
  (await sqliteAll("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t])).length > 0;

const tableExistsPg = async (t) => (await pool.query(
  `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t])).rowCount > 0;

async function createSchema() {
  for (const sql of SCHEMA) await pool.query(sql);
  // Migraciones de tipo para tablas creadas previamente con tipos antiguos.
  await pool.query(
    `ALTER TABLE agro_clientes ALTER COLUMN codigo TYPE BIGINT USING codigo::BIGINT`
  ).catch(() => {});
}

async function clearAll() {
  for (const t of [...INSERT_ORDER].reverse()) {
    if (await tableExistsPg(t)) await pool.query(`DELETE FROM ${t}`);
  }
}

async function copyTable(t) {
  if (!(await tableExistsSqlite(t)) || !(await tableExistsPg(t))) return 0;
  const sCols = await getSqliteCols(t);
  const pCols = await getPgCols(t);
  const cols = sCols.filter(c => pCols.includes(c));
  if (!cols.length) return 0;

  const rows = await sqliteAll(
    `SELECT ${cols.map(c => `"${c}"`).join(",")} FROM ${t}`);
  if (!rows.length) { console.log(`  - ${t}: 0 filas`); return 0; }

  const sql = `INSERT INTO ${t} (${cols.map(c => `"${c}"`).join(",")})
               VALUES (${cols.map((_, i) => "$" + (i + 1)).join(",")})`;
  let ok = 0, fail = 0;
  for (const row of rows) {
    const params = cols.map(c => (row[c] === undefined ? null : row[c]));
    try { await pool.query(sql, params); ok++; }
    catch (e) {
      fail++;
      if (fail <= 3) console.warn(`    ! ${t}#${row.id ?? row.consecutivo ?? "?"}: ${e.message}`);
    }
  }
  console.log(`  - ${t}: ${ok} ok` + (fail ? `, ${fail} fallidas` : ""));
  return ok;
}

async function resetSequence(t) {
  if (PK_COLUMN[t] === null) return;
  const pk = PK_COLUMN[t] || "id";
  if (!(await tableExistsPg(t))) return;
  await pool.query(
    `SELECT setval(
       pg_get_serial_sequence($1, $2),
       COALESCE((SELECT MAX(${pk}) FROM ${t}), 0) + 1,
       false
     )`, [t, pk]);
}

(async () => {
  console.log("1) Creando esquema...");
  await createSchema();

  console.log("2) Limpiando tablas destino...");
  await clearAll();

  console.log("3) Copiando datos:");
  // Deshabilitamos disparadores/FKs para preservar filas huérfanas existentes
  // en SQLite (data legada con referencias rotas).
  await pool.query("SET session_replication_role = replica");
  let total = 0;
  for (const t of INSERT_ORDER) total += await copyTable(t);
  await pool.query("SET session_replication_role = DEFAULT");

  console.log("4) Reajustando sequences...");
  for (const t of INSERT_ORDER) {
    try { await resetSequence(t); }
    catch (e) { console.warn(`  ! ${t}: ${e.message}`); }
  }

  console.log(`\nOK. ${total} filas copiadas.`);
  sqlite.close();
  await pool.end();
})().catch(async (e) => {
  console.error("ERROR:", e);
  sqlite.close();
  await pool.end().catch(() => {});
  process.exit(1);
});
