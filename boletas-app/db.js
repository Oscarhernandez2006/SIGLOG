/**
 * Capa de compatibilidad SQLite -> PostgreSQL
 *
 * Expone la misma API que sqlite3 (`db.run`, `db.get`, `db.all`,
 * `db.prepare`, `db.serialize`) sobre un `pg.Pool`, traduciendo en runtime
 * la sintaxis específica de SQLite a PostgreSQL.
 *
 * Esto permite migrar la base de datos sin reescribir las rutas existentes.
 *
 * Conexión: variable de entorno DATABASE_URL
 *   p.ej. postgres://usuario:clave@localhost:5432/boletas
 */

const { Pool } = require("pg");

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/boletas";

const pool = new Pool({
  connectionString,
  ssl: /sslmode=require/i.test(connectionString)
    ? { rejectUnauthorized: false }
    : undefined,
});

pool.on("error", (err) => {
  console.error("[pg pool error]", err.message);
});

// ---------------------------------------------------------------------------
// Cola FIFO global para preservar el orden secuencial tipo db.serialize().
// ---------------------------------------------------------------------------
let queue = Promise.resolve();
function enqueue(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

// ---------------------------------------------------------------------------
// Traducción de SQL: SQLite -> PostgreSQL
// ---------------------------------------------------------------------------
function translateSql(sql) {
  let s = String(sql);

  // Tipos / claves
  s = s.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, "SERIAL PRIMARY KEY");
  s = s.replace(/AUTOINCREMENT/gi, "");
  // REAL -> DOUBLE PRECISION (sólo como tipo de columna)
  s = s.replace(/(\s)REAL(\s|,|\))/gi, "$1DOUBLE PRECISION$2");

  // TEXT DEFAULT CURRENT_TIMESTAMP -> default cast a texto
  s = s.replace(
    /TEXT\s+DEFAULT\s+CURRENT_TIMESTAMP/gi,
    "TEXT DEFAULT (CURRENT_TIMESTAMP::text)"
  );

  // INSERT OR IGNORE -> INSERT ... ON CONFLICT DO NOTHING
  if (/\bINSERT\s+OR\s+IGNORE\b/i.test(s)) {
    s = s.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, "INSERT");
    if (/\bRETURNING\b/i.test(s)) {
      s = s.replace(/\bRETURNING\b/i, "ON CONFLICT DO NOTHING RETURNING");
    } else {
      s = s.trimEnd().replace(/;?\s*$/, "") + " ON CONFLICT DO NOTHING";
    }
  }
  s = s.replace(/\bINSERT\s+OR\s+REPLACE\b/gi, "INSERT");

  // datetime('now', '+N days') -> ISO 8601 con milisegundos
  s = s.replace(
    /datetime\(\s*'now'\s*,\s*'([+-]?\d+)\s+days?'\s*\)/gi,
    (_m, n) =>
      `to_char((now() at time zone 'UTC') + interval '${n} days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  );
  s = s.replace(
    /datetime\(\s*'now'\s*\)/gi,
    `to_char((now() at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  );

  // INSTR(a, b) -> STRPOS(a, b)
  s = s.replace(/\bINSTR\s*\(/gi, "STRPOS(");

  // COLLATE NOCASE (SQLite) no existe en Postgres -> usar LOWER()
  // Reemplaza "<expr> COLLATE NOCASE" por "LOWER(<expr>)"
  s = s.replace(/([A-Za-z_][A-Za-z0-9_.]*)\s+COLLATE\s+NOCASE/gi, "LOWER($1)");
  // Si quedan COLLATE NOCASE sueltos, los elimina
  s = s.replace(/\s+COLLATE\s+NOCASE/gi, "");

  // sqlite_sequence no existe en Postgres -> no-op
  if (/\bsqlite_sequence\b/i.test(s)) {
    s = "SELECT 1 WHERE false";
  }

  // ALTER TABLE ... ADD COLUMN  ->  ADD COLUMN IF NOT EXISTS
  s = s.replace(
    /(ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN)\s+(?!IF\s+NOT\s+EXISTS)/gi,
    "$1 IF NOT EXISTS "
  );

  // Marcadores ? -> $1, $2, ...
  let i = 0;
  s = s.replace(/\?/g, () => "$" + ++i);

  return s;
}

function isInsert(sql) {
  return /^\s*INSERT\b/i.test(sql);
}

// Errores que deben silenciarse en migraciones (ALTER/CREATE idempotentes
// contra tablas que aún no existen en este punto del arranque).
function isIgnorableMigrationError(err, sql) {
  if (!err) return false;
  const code = err.code;
  if (["42P01", "42703", "42P07", "42701", "42710"].includes(code)) {
    return /^\s*(ALTER|CREATE)\b/i.test(sql);
  }
  return false;
}

function execute(sql, params) {
  return enqueue(async () => {
    const translated = translateSql(sql);
    const insert = isInsert(translated);
    const hasReturning = /\bRETURNING\b/i.test(translated);

    let withReturning = translated;
    if (insert && !hasReturning) {
      withReturning = translated.replace(/;?\s*$/, "") + " RETURNING *";
    }

    let result;
    try {
      result = await pool.query(withReturning, params || []);
    } catch (err) {
      if (insert && !hasReturning && err.code === "42703") {
        result = await pool.query(translated, params || []);
      } else {
        throw err;
      }
    }

    const firstRow = result.rows && result.rows[0];
    let lastID;
    if (firstRow) {
      lastID =
        firstRow.id !== undefined
          ? firstRow.id
          : firstRow.consecutivo !== undefined
          ? firstRow.consecutivo
          : Object.values(firstRow)[0];
    }
    const changes = typeof result.rowCount === "number" ? result.rowCount : 0;
    return { lastID, changes, rows: result.rows || [] };
  });
}

function normalizeArgs(params, cb) {
  if (typeof params === "function") {
    cb = params;
    params = [];
  }
  if (!Array.isArray(params)) params = params == null ? [] : [params];
  return { params, cb };
}

function run(sql, params, cb) {
  ({ params, cb } = normalizeArgs(params, cb));
  execute(sql, params).then(
    ({ lastID, changes }) => {
      if (typeof cb === "function") cb.call({ lastID, changes }, null);
    },
    (err) => {
      if (isIgnorableMigrationError(err, sql)) {
        if (typeof cb === "function") cb.call({ lastID: undefined, changes: 0 }, err);
        return;
      }
      if (typeof cb === "function") {
        cb.call({ lastID: undefined, changes: 0 }, err);
      } else {
        console.error("[db.run]", err.message, "\nSQL:", sql);
      }
    }
  );
}

function get(sql, params, cb) {
  ({ params, cb } = normalizeArgs(params, cb));
  execute(sql, params).then(
    ({ rows }) => {
      if (typeof cb === "function") cb(null, rows[0]);
    },
    (err) => {
      if (typeof cb === "function") cb(err);
      else console.error("[db.get]", err.message, "\nSQL:", sql);
    }
  );
}

function all(sql, params, cb) {
  ({ params, cb } = normalizeArgs(params, cb));
  execute(sql, params).then(
    ({ rows }) => {
      if (typeof cb === "function") cb(null, rows);
    },
    (err) => {
      if (typeof cb === "function") cb(err, []);
      else console.error("[db.all]", err.message, "\nSQL:", sql);
    }
  );
}

// db.prepare(sql) -> { run([params], cb?), finalize(cb?) }
function prepare(sql) {
  return {
    run(params, cb) {
      run(sql, params, cb);
      return this;
    },
    finalize(cb) {
      enqueue(async () => {}).then(
        () => { if (typeof cb === "function") cb(null); },
        (err) => { if (typeof cb === "function") cb(err); }
      );
    },
  };
}

function serialize(fn) {
  if (typeof fn === "function") fn();
}

function close(cb) {
  pool.end().then(
    () => cb && cb(null),
    (err) => cb && cb(err)
  );
}

const db = { run, get, all, prepare, serialize, close, pool };

// ===========================================================================
// Esquema, migraciones y seeds
// ===========================================================================
db.serialize(() => {

  // Usuarios
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      rol TEXT DEFAULT 'usuario',
      permisos TEXT DEFAULT 'canjear,generar,informes,reimprimir,validar',
      modulos TEXT DEFAULT 'bono,pedidos,agropecuaria',
      submodulos TEXT DEFAULT '',
      nombres TEXT DEFAULT '',
      apellidos TEXT DEFAULT ''
    )
  `);
  db.run(`ALTER TABLE usuarios ADD COLUMN rol TEXT DEFAULT 'usuario'`, (err) => {});
  db.run(`ALTER TABLE usuarios ADD COLUMN permisos TEXT DEFAULT 'canjear,generar,informes,reimprimir,validar'`, (err) => {});
  db.run(`ALTER TABLE usuarios ADD COLUMN modulos TEXT DEFAULT 'bono,pedidos,agropecuaria'`, (err) => {});
  db.run(`ALTER TABLE usuarios ADD COLUMN submodulos TEXT DEFAULT ''`, (err) => {});
  db.run(`ALTER TABLE usuarios ADD COLUMN nombres TEXT DEFAULT ''`, (err) => {});
  db.run(`ALTER TABLE usuarios ADD COLUMN apellidos TEXT DEFAULT ''`, (err) => {});

  // Boletas
  db.run(`
    CREATE TABLE IF NOT EXISTS boletas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      cedula TEXT,
      fecha TEXT,
      monto REAL,
      codigo TEXT UNIQUE,
      estado TEXT,
      vencimiento TEXT,
      impreso INTEGER DEFAULT 0
    )
  `);
  db.run(`ALTER TABLE boletas ADD COLUMN vencimiento TEXT`, (err) => {});
  db.run(`ALTER TABLE boletas ADD COLUMN impreso INTEGER DEFAULT 0`, (err) => {});
  db.run(`ALTER TABLE boletas ADD COLUMN consecutivo_canje INTEGER`, (err) => {});
  db.run(`ALTER TABLE boletas ADD COLUMN fecha_canje TEXT`, (err) => {});

  // Logs
  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT,
      accion TEXT,
      fecha TEXT
    )
  `);

  // Productos
  db.run(`
    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referencia TEXT,
      nombre TEXT NOT NULL,
      descripcion TEXT,
      precio REAL NOT NULL,
      unidad_medida TEXT DEFAULT 'UNIDAD',
      activo INTEGER DEFAULT 1
    )
  `);
  db.run(`ALTER TABLE productos ADD COLUMN referencia TEXT`, (err) => {});
  db.run(`ALTER TABLE productos ADD COLUMN unidad_medida TEXT DEFAULT 'UNIDAD'`, (err) => {});

  // Pedidos
  db.run(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_nombre TEXT NOT NULL,
      cliente_cedula TEXT,
      fecha TEXT NOT NULL,
      estado TEXT DEFAULT 'PENDIENTE',
      total REAL DEFAULT 0,
      observaciones TEXT
    )
  `);

  // Items de cada pedido
  db.run(`
    CREATE TABLE IF NOT EXISTS pedido_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER NOT NULL,
      producto_nombre TEXT NOT NULL,
      cantidad INTEGER NOT NULL DEFAULT 1,
      precio_unitario REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
    )
  `);

  // Puntos de Venta
  db.run(`
    CREATE TABLE IF NOT EXISTS puntos_venta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      indicador INTEGER NOT NULL UNIQUE,
      nombre TEXT NOT NULL,
      activo INTEGER DEFAULT 1
    )
  `);

  db.run(`ALTER TABLE pedidos ADD COLUMN punto_venta_id INTEGER`, (err) => {});
  db.run(`ALTER TABLE pedidos ADD COLUMN numero_pedido TEXT`, (err) => {});
  db.run(`ALTER TABLE pedidos ADD COLUMN kilos REAL DEFAULT 0`, (err) => {});
  db.run(`ALTER TABLE pedidos ADD COLUMN editado_de TEXT`, (err) => {});

  // Seed: 15 PDVs iniciales si la tabla está vacía
  db.get("SELECT COUNT(*) as c FROM puntos_venta", [], (err, row) => {
    if (!err && row && Number(row.c) === 0) {
      const pdvs = [
        [1, "Carnes Santacruz La 93"],
        [2, "Carnes Santacruz La 70"],
        [3, "Carnes Santacruz La 43"],
        [4, "Carnes Santacruz Alameda I"],
        [5, "Carnes Santacruz Alameda II"],
        [6, "Carnes Santacruz Olaya"],
        [7, "Carnes Santacruz San Felipe"],
        [8, "Carnes Santacruz Centro"],
        [9, "Carnes Santacruz Simon Bolivar"],
        [10, "Carnes Santacruz La Granja"],
        [11, "Carnes Santacruz Concord"],
        [12, "Carnes Santacruz Malambo"],
        [13, "Carnes Santacruz Cartagena"],
        [14, "Carnes Santacruz Bucaramanga"],
        [15, "Carnes Santacruz Pereira"],
      ];
      const stmt = db.prepare("INSERT OR IGNORE INTO puntos_venta (indicador, nombre) VALUES (?, ?)");
      pdvs.forEach(([ind, nom]) => stmt.run([ind, nom]));
      stmt.finalize();
    }
  });

  // Clientes
  db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      cedula TEXT,
      telefono TEXT,
      direccion TEXT,
      referencia TEXT,
      barrio TEXT,
      ciudad TEXT,
      region TEXT,
      punto_venta TEXT,
      email TEXT,
      observaciones TEXT,
      activo INTEGER DEFAULT 1,
      fecha_registro TEXT
    )
  `);
  db.run(`ALTER TABLE clientes ADD COLUMN referencia TEXT`, (err) => {});
  db.run(`ALTER TABLE clientes ADD COLUMN punto_venta TEXT`, (err) => {});
  db.run(`ALTER TABLE clientes ADD COLUMN confirmacion_codigo TEXT`, (err) => {});
  db.run(`ALTER TABLE clientes ADD COLUMN region TEXT`, (err) => {});

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_cedula ON clientes(cedula) WHERE cedula IS NOT NULL AND cedula != ''`, (err) => {});

  // ============ DISTRIBUCIÓN AGROPECUARIA ============

  db.run(`
    CREATE TABLE IF NOT EXISTS agro_productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referencia TEXT,
      nombre TEXT NOT NULL,
      descripcion TEXT,
      categoria TEXT,
      precio REAL NOT NULL,
      unidad_medida TEXT DEFAULT 'UNIDAD',
      stock INTEGER DEFAULT 0,
      activo INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agro_rutas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      recorrido TEXT,
      ciudad TEXT,
      kls_recorridos REAL DEFAULT 0,
      tiempo TEXT,
      horas REAL DEFAULT 0,
      activo INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agro_distribuidores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      cedula_nit TEXT,
      telefono TEXT,
      direccion TEXT,
      ciudad TEXT,
      zona TEXT,
      email TEXT,
      observaciones TEXT,
      activo INTEGER DEFAULT 1,
      fecha_registro TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agro_ordenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_orden TEXT,
      distribuidor_id INTEGER,
      distribuidor_nombre TEXT NOT NULL,
      fecha TEXT NOT NULL,
      estado TEXT DEFAULT 'PENDIENTE',
      total REAL DEFAULT 0,
      observaciones TEXT,
      FOREIGN KEY (distribuidor_id) REFERENCES agro_distribuidores(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agro_orden_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orden_id INTEGER NOT NULL,
      producto_nombre TEXT NOT NULL,
      cantidad INTEGER NOT NULL DEFAULT 1,
      precio_unitario REAL NOT NULL,
      subtotal REAL NOT NULL,
      cantidad_entregada INTEGER DEFAULT 0,
      FOREIGN KEY (orden_id) REFERENCES agro_ordenes(id) ON DELETE CASCADE
    )
  `);

  db.run(`ALTER TABLE agro_orden_items ADD COLUMN cantidad_entregada INTEGER DEFAULT 0`, (err) => {});
  db.run(`ALTER TABLE agro_ordenes ADD COLUMN observacion_servicio TEXT DEFAULT 'Sin Novedad'`, (err) => {});
  db.run(`ALTER TABLE agro_ordenes ADD COLUMN novedades TEXT`, (err) => {});
  db.run(`ALTER TABLE agro_ordenes ADD COLUMN responsabilidades TEXT`, (err) => {});
  db.run(`ALTER TABLE agro_ordenes ADD COLUMN detalles TEXT`, (err) => {});
  // Estos ALTER se ejecutan antes de crear agro_asignaciones; el shim
  // ignora el error "tabla no existe" durante migraciones.
  db.run(`ALTER TABLE agro_asignaciones ADD COLUMN estado TEXT DEFAULT 'ACTIVA'`, (err) => {});
  db.run(`ALTER TABLE agro_asignaciones ADD COLUMN observacion_servicio TEXT DEFAULT 'Sin Novedad'`, (err) => {});
  db.run(`ALTER TABLE agro_asignaciones ADD COLUMN fecha_exportacion TEXT`, (err) => {});
  db.run(`ALTER TABLE agro_asignaciones ADD COLUMN auxiliar TEXT DEFAULT ''`, (err) => {});

  // Vehículos
  db.run(`
    CREATE TABLE IF NOT EXISTS agro_vehiculos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      placa TEXT NOT NULL,
      conductor TEXT NOT NULL,
      disponibilidad TEXT DEFAULT '',
      activo INTEGER DEFAULT 1
    )
  `);
  db.run(`ALTER TABLE agro_vehiculos ADD COLUMN tripulacion_id INTEGER`, (err) => {});

  // Tripulación
  db.run(`
    CREATE TABLE IF NOT EXISTS agro_tripulacion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      cedula TEXT DEFAULT '',
      telefono TEXT DEFAULT '',
      rol TEXT DEFAULT 'Conductor',
      nombres TEXT DEFAULT '',
      apellidos TEXT DEFAULT ''
    )
  `);
  db.run(`ALTER TABLE agro_tripulacion ADD COLUMN rol TEXT DEFAULT 'Conductor'`, (err) => {});
  db.run(`ALTER TABLE agro_tripulacion ADD COLUMN nombres TEXT DEFAULT ''`, (err) => {});
  db.run(`ALTER TABLE agro_tripulacion ADD COLUMN apellidos TEXT DEFAULT ''`, (err) => {});
  db.run(`ALTER TABLE agro_tripulacion ADD COLUMN tipo TEXT DEFAULT ''`, (err) => {});
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agro_tripulacion_cedula ON agro_tripulacion(cedula)`, (err) => {});

  // Seed inicial de tripulación
  const tripulacionSeed = [
    ["8532404",    "Alexis Eduardo",   "Betancourt Betancourt Altahona", "3004294085"],
    ["1048320104", "Bray Alfonso",     "Suarez Mendoza",                 "3017121289"],
    ["1048271704", "Cristian Enrique", "Colpas Gonzales",                "3107358658"],
    ["72044513",   "Cristian Jesus",   "Ortega Rivera",                  "3235389049"],
    ["12623211",   "Ricardo de Jesus", "Hernandez Suarez",               "3136751622"],
    ["72208534",   "Juan de Jesus",    "Bustamante Vargas",              "3012652752"],
    ["10220109",   "Francisco Javier", "de la cruz Mendoza",             "3123254305"],
    ["72210468",   "Ember Luis",       "Martinez Castro",                "3006980203"],
    ["5080863",    "Gustavo Jose",     "Amaya Escobar",                  "3023989487"],
    ["72124291",   "Hector Holmes",    "Trujillo Gonzalez",              "3008179299"],
    ["1047349101", "Ivan Jose",        "Quintero Carreño",               "3025532209"],
    ["91426474",   "Javier Ramiro",    "Mejia Sandoval",                 "3147429912"],
    ["1067910282", "Jeinnson Andres",  "Roldan Castro",                  "3135011159"],
    ["1129579118", "Jhon Jairo",       "Massu Arnedo",                   "3042038840"],
    ["19585264",   "Jorge Omar",       "Bustamante Olivero",             "3205700157"],
    ["91042831",   "Jose Antonio",     "Arenas Martinez",                "3207348963"],
    ["1001997186", "Kenny Andres",     "Escorcia Tabares",               "3044225620"],
    ["72252225",   "Luis Arnoldo",     "Castro Sarmiento",               "3012476303"],
    ["1001995338", "Luis Daniel",      "Rios Posada",                    "3004377162"],
    ["72141279",   "Miguel Antonio",   "Candela Garcia",                 "3207350185"],
    ["8638578",    "Oscar Luis",       "Leones Carrillo",                "3045792542"],
    ["8522001",    "Samir Habid",      "Borja Coll",                     "3018114719"],
    ["72045692",   "Raul",             "Caballero Sepulveda",            "3145022709"],
    ["72126233",   "Virgilio Antonio", "Maldonado Sierra",               "3102818717"],
    ["8508302",    "Wilmer Jose",      "Urzola Lara",                    "3103912774"]
  ];
  const stmt = db.prepare(`INSERT OR IGNORE INTO agro_tripulacion (cedula, nombres, apellidos, telefono, nombre, rol) VALUES (?, ?, ?, ?, ?, 'Conductor')`);
  tripulacionSeed.forEach(([ced, nom, ape, tel]) => {
    stmt.run([ced, nom, ape, tel, (nom + " " + ape).trim()]);
  });
  stmt.finalize();

  // Seed de Auxiliares de ruta
  const auxiliaresSeed = [
    ["Alberto",       "Marguez",        "Aux"],
    ["Brayan",        "Maldonado",      "Aux"],
    ["Francisco",     "",               "Aux"],
    ["Alberto",       "Marin",          "C&D"],
    ["Alexis",        "Ripoll",         "C&D"],
    ["Britner",       "Sanchez Parra",  "C&D"],
    ["Carlos Andres", "Fernandez",      "C&D"],
    ["Carlos",        "Sanchez",        "C&D"],
    ["Danilo",        "De La Hoz",      "C&D"],
    ["David",         "Mendez Diaz",    "C&D"],
    ["Eusebio",       "Carmona",        "C&D"],
    ["Francisco",     "Cortez",         "C&D"],
    ["Francisco",     "Florian",        "C&D"],
    ["Franklin",      "Avila",          "C&D"],
    ["Gilmar",        "Batista",        "C&D"],
    ["Heiber",        "Sanchez Parra",  "C&D"],
    ["Hugo",          "Rosario",        "C&D"],
    ["Humberto",      "Moreno",         "C&D"],
    ["Jean Carlos",   "De los Reyes",   "C&D"],
    ["Jeremias",      "Rojas",          "C&D"],
    ["Jesus",         "Peraza",         "C&D"],
    ["Johan",         "Barras",         "C&D"],
    ["Jose",          "Bolivar",        "C&D"],
    ["Juan Diego",    "Fuentes",        "C&D"],
    ["Juan Jose",     "Hueto",          "C&D"],
    ["Leonardo",      "Torres",         "C&D"],
    ["Luis",          "Henao",          "C&D"],
    ["Miguel Angel",  "Robles",         "C&D"],
    ["Perfecto",      "Moreno",         "C&D"],
    ["Samuel",        "Galue",          "C&D"],
    ["Santiago",      "Blanco",         "C&D"],
    ["Wilson",        "Suarez",         "C&D"],
    ["Yeiner",        "Beltran",        "C&D"],
    ["Yosman",        "Medina",         "C&D"],
    ["Yosmer",        "Medina",         "C&D"]
  ];
  auxiliaresSeed.forEach(([nom, ape, tipo]) => {
    db.get(
      `SELECT id FROM agro_tripulacion WHERE rol='Auxiliar de ruta' AND nombres=? AND apellidos=?`,
      [nom, ape],
      (e, row) => {
        if (e) return;
        if (row) {
          db.run(`UPDATE agro_tripulacion SET tipo = ? WHERE id = ?`, [tipo || "", row.id]);
          return;
        }
        db.run(
          `INSERT INTO agro_tripulacion (cedula, nombres, apellidos, telefono, nombre, rol, tipo) VALUES (NULL, ?, ?, '', ?, 'Auxiliar de ruta', ?)`,
          [nom, ape, (nom + " " + ape).trim(), tipo || ""]
        );
      }
    );
  });

  db.run(`DELETE FROM agro_tripulacion WHERE (cedula IS NULL OR TRIM(cedula) = '') AND (nombres IS NULL OR TRIM(nombres) = '') AND (apellidos IS NULL OR TRIM(apellidos) = '')`);

  // Auto-asociar tripulantes a vehículos por nombre
  db.all(`SELECT id, nombres, apellidos, nombre FROM agro_tripulacion`, [], (err, tripulantes) => {
    if (err || !tripulantes) return;
    const normalizar = s => (s || "").toString().trim().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
    const indice = new Map();
    tripulantes.forEach(t => {
      const full = ((t.nombres || "") + " " + (t.apellidos || "")).trim();
      [full, t.nombre].filter(Boolean).forEach(n => {
        const key = normalizar(n);
        if (key && !indice.has(key)) indice.set(key, t.id);
      });
    });
    db.all(`SELECT id, conductor FROM agro_vehiculos WHERE tripulacion_id IS NULL`, [], (err2, vehiculos) => {
      if (err2 || !vehiculos) return;
      vehiculos.forEach(v => {
        const key = normalizar(v.conductor);
        const tid = indice.get(key);
        if (tid) db.run(`UPDATE agro_vehiculos SET tripulacion_id = ? WHERE id = ?`, [tid, v.id]);
      });
    });
  });

  // Seed de vehículos
  const vehiculosSeed = [
    ["NIN543", "Juan Bustamante",       "72208534"],
    ["RFK700", "",                       null],
    ["SNZ312", "Luis Rios",             "1001995338"],
    ["SPU817", "Jorge Bustamante",      "19585264"],
    ["STR623", "Alex Sierra",           null],
    ["STR646", "Alexis Betancur",       "8532404"],
    ["STR837", "Jeinnson Roldan",       "1067910282"],
    ["STS678", "Wilmer Urzola",         "8508302"],
    ["SUC763", "Javier Mejia",          "91426474"],
    ["TAW289", "Cristian Ortega",       "72044513"],
    ["TAW299", "Samir Borja",           "8522001"],
    ["TDU027", "Jhon Massu",            "1129579118"],
    ["UQF103", "Oscar Leonares",        "8638578"],
    ["UZC178", "Ember Martinez",        "72210468"],
    ["WEM026", "Ricardo Hernandez",     "12623211"],
    ["WEM027", "Luis Castro",           "72252225"],
    ["WEM156", "Raul Caballero",        "72045692"],
    ["WEM422", "Miguel Candela",        "72141279"],
    ["WEO426", "Francisco de la Cruz",  "10220109"],
    ["WEO427", "Virgilio Maldonado",    "72126233"],
    ["TTR892", "Hector Trujillo",       "72124291"],
    ["TTU303", "Kenny Escorcia",        "1001997186"],
    ["ESQ019", "Ivan Quintero",         "1047349101"],
    ["STS935", "",                       null],
    ["STS765", "",                       null],
    ["SZM192", "Gustavo Amaya",         "5080863"],
    ["TAW298", "",                       null],
    ["WEM155", "Bray Suarez",           "1048320104"],
    ["TAW816", "Jose Arenas",           "91042831"],
    ["XVY238", "Cristian Colpas",       "1048271704"]
  ];
  {
    const placasPermitidas = vehiculosSeed.map(v => v[0]);
    const placeholders = placasPermitidas.map(() => "?").join(",");
    db.run(
      `DELETE FROM agro_asignaciones WHERE vehiculo_id IN (SELECT id FROM agro_vehiculos WHERE placa NOT IN (${placeholders}))`,
      placasPermitidas,
      () => {}
    );
    db.run(
      `DELETE FROM agro_vehiculos WHERE placa NOT IN (${placeholders})`,
      placasPermitidas,
      () => {}
    );
  }

  db.all(`SELECT id, cedula FROM agro_tripulacion`, [], (errT, tripT) => {
    const mapaCedula = new Map();
    (tripT || []).forEach(t => { if (t.cedula) mapaCedula.set(String(t.cedula).trim(), t.id); });
    vehiculosSeed.forEach(([placa, conductor, cedula]) => {
      const tid = cedula ? mapaCedula.get(String(cedula).trim()) : null;
      const conductorFinal = conductor || "";
      const sinTripulante = !tid;
      db.get(`SELECT id FROM agro_vehiculos WHERE placa = ?`, [placa], (errV, row) => {
        if (errV) return;
        if (!row) {
          db.run(
            `INSERT INTO agro_vehiculos (placa, conductor, tripulacion_id, activo) VALUES (?, ?, ?, 1)`,
            [placa, conductorFinal, tid || null]
          );
        } else if (sinTripulante && conductorFinal === "") {
          db.run(
            `UPDATE agro_vehiculos SET conductor = '', tripulacion_id = NULL WHERE id = ?`,
            [row.id]
          );
        } else {
          db.run(
            `UPDATE agro_vehiculos
               SET conductor = CASE WHEN ? <> '' THEN ? ELSE conductor END,
                   tripulacion_id = COALESCE(?, tripulacion_id)
             WHERE id = ?`,
            [conductorFinal, conductorFinal, tid || null, row.id]
          );
        }
      });
    });
  });

  // Clientes agropecuarios
  db.run(`
    CREATE TABLE IF NOT EXISTS agro_clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo BIGINT,
      codigo_concatenado TEXT,
      nombre TEXT NOT NULL,
      direccion TEXT,
      barrio TEXT,
      ciudad TEXT,
      departamento TEXT,
      telefono TEXT,
      activo INTEGER DEFAULT 1
    )
  `);
  db.run(`ALTER TABLE agro_clientes ALTER COLUMN codigo TYPE BIGINT`, () => {});

  // Asignación de vehículos a órdenes
  db.run(`
    CREATE TABLE IF NOT EXISTS agro_asignaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehiculo_id INTEGER NOT NULL,
      vehiculo_placa TEXT,
      vehiculo_conductor TEXT,
      fecha TEXT NOT NULL,
      observaciones TEXT,
      FOREIGN KEY (vehiculo_id) REFERENCES agro_vehiculos(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agro_asignacion_ordenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asignacion_id INTEGER NOT NULL,
      orden_id INTEGER NOT NULL,
      FOREIGN KEY (asignacion_id) REFERENCES agro_asignaciones(id) ON DELETE CASCADE,
      FOREIGN KEY (orden_id) REFERENCES agro_ordenes(id)
    )
  `);

  // Contador global para Planificación D.L
  db.run(`
    CREATE TABLE IF NOT EXISTS agro_contadores (
      nombre TEXT PRIMARY KEY,
      valor INTEGER NOT NULL DEFAULT 0
    )
  `, () => {
    db.run(`INSERT OR IGNORE INTO agro_contadores (nombre, valor) VALUES ('plantilla_dl', 0)`);
  });

  // Plantillas D.L
  db.run(`
    CREATE TABLE IF NOT EXISTS agro_plantillas_dl (
      consecutivo INTEGER PRIMARY KEY AUTOINCREMENT,
      placa TEXT NOT NULL,
      conductor TEXT,
      auxiliar TEXT DEFAULT '',
      fecha_despacho TEXT,
      origen TEXT,
      hora_salida TEXT,
      ruta TEXT,
      total_documentos INTEGER DEFAULT 0,
      total_kilos REAL DEFAULT 0,
      ordenes_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`ALTER TABLE agro_plantillas_dl ADD COLUMN auxiliar TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE agro_plantillas_dl ADD COLUMN kms_recorridos TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE agro_plantillas_dl ADD COLUMN tiempo_recorrido TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE agro_plantillas_dl ADD COLUMN municipios_recorre TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE agro_plantillas_dl ADD COLUMN fecha_hora_llegada TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE agro_plantillas_dl ADD COLUMN editado INTEGER DEFAULT 0`, () => {});

});

module.exports = db;
