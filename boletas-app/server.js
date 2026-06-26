require("dotenv").config();
const express = require("express");
const path = require("path");
const app = express();

const db = require("./db");

// Módulo toma de pedidos
const tomaPedidosRoutes = require("./toma-pedidos/routes");

// Módulo distribución agropecuaria
const distribucionAgroRoutes = require("./distribucion-agropecuaria/routes");

// Módulo distribución TaT (Tienda a Tienda)
const distribucionTatRoutes = require("./distribucion-tat/routes");

// Módulo Run Errands
const runErrandsRoutes = require("./run-errands/routes");

app.use(express.json());

// No cachear HTML para evitar versiones obsoletas en el navegador
app.use((req, res, next) => {
  if (req.path.endsWith(".html") || req.path === "/") {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  next();
});

// ── Acceso SOLO vía rutas_web (SSO). Si SSO_ONLY está activo, el login directo
// de SIGLOG queda deshabilitado: el formulario no se sirve y /login rechaza.
// El SSO usa /sso (no toca /login), así que sigue funcionando. Reversible
// quitando la variable de entorno SSO_ONLY.
const SSO_ONLY = ["1", "true", "yes"].includes(String(process.env.SSO_ONLY || "").toLowerCase());
app.use((req, res, next) => {
  if (!SSO_ONLY) return next();
  const p = req.path;
  if (req.method === "POST" && p === "/login") {
    return res.status(403).json({ error: "Acceso deshabilitado. Ingresa a SIGLOG desde rutas_web." });
  }
  if (req.method === "GET" && (p === "/" || p === "/login.html")) {
    res.set("Cache-Control", "no-store");
    return res.status(200).send(
      '<!doctype html><meta charset="utf-8"><title>SIGLOG</title>' +
      '<body style="font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:48px 16px;color:#374151">' +
      '<h2 style="margin:0 0 8px">SIGLOG</h2>' +
      '<p>El acceso a SIGLOG es únicamente desde <b>rutas_web</b>.</p>' +
      '<p><a href="https://routeplanner.grupo-santacruz.com" style="color:#16a34a;font-weight:600;text-decoration:none">Ir a rutas_web →</a></p>'
    );
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

/*Inicio estadísticas*/
app.get("/stats", (req, res) => {
  db.get(
    `SELECT
       COUNT(*) as total,
       COALESCE(SUM(CASE WHEN estado = 'ACTIVA' THEN 1 ELSE 0 END), 0) as activas,
       COALESCE(SUM(CASE WHEN estado = 'CANJEADO' THEN 1 ELSE 0 END), 0) as canjeadas,
       COALESCE(SUM(CASE WHEN vencimiento IS NOT NULL AND vencimiento < datetime('now') AND estado = 'ACTIVA' THEN 1 ELSE 0 END), 0) as vencidas
     FROM boletas`,
    [],
    (err, row) => {
      if (err) {
        return res.json({ total: 0, activas: 0, canjeadas: 0, vencidas: 0 });
      }
      res.json(row || { total: 0, activas: 0, canjeadas: 0, vencidas: 0 });
    }
  );
});
/*Fin estadísticas*/

/*Inicio dashboard widgets*/
// Últimos bonos generados
app.get("/stats/ultimos", (req, res) => {
  db.all("SELECT nombre, cedula, monto, fecha, estado FROM boletas ORDER BY fecha DESC LIMIT 10", [], (err, rows) => {
    if (err) return res.json([]);
    res.json(rows || []);
  });
});

// Últimos canjes
app.get("/stats/ultimos-canjes", (req, res) => {
  db.all("SELECT nombre, cedula, monto, fecha_canje, consecutivo_canje FROM boletas WHERE estado = 'CANJEADO' AND fecha_canje IS NOT NULL ORDER BY fecha_canje DESC LIMIT 10", [], (err, rows) => {
    if (err) return res.json([]);
    res.json(rows || []);
  });
});

// Bonos próximos a vencer (próximos 7 días)
app.get("/stats/por-vencer", (req, res) => {
  db.all(
    `SELECT nombre, cedula, monto, vencimiento, codigo FROM boletas
     WHERE estado = 'ACTIVA' AND vencimiento IS NOT NULL
     AND vencimiento >= datetime('now')
     AND vencimiento <= datetime('now', '+7 days')
     ORDER BY vencimiento ASC`,
    [], (err, rows) => {
      if (err) return res.json([]);
      res.json(rows || []);
    }
  );
});

// Resumen monetario
app.get("/stats/montos", (req, res) => {
  db.get(
    `SELECT
       COALESCE(SUM(monto), 0) as totalGenerado,
       COALESCE(SUM(CASE WHEN estado = 'CANJEADO' THEN monto ELSE 0 END), 0) as totalCanjeado,
       COALESCE(SUM(CASE WHEN estado = 'ACTIVA' THEN monto ELSE 0 END), 0) as totalPendiente
     FROM boletas`,
    [], (err, row) => {
      if (err) return res.json({ totalGenerado: 0, totalCanjeado: 0, totalPendiente: 0 });
      res.json(row || { totalGenerado: 0, totalCanjeado: 0, totalPendiente: 0 });
    }
  );
});

// Top beneficiarios
app.get("/stats/top-beneficiarios", (req, res) => {
  db.all(
    `SELECT nombre, cedula, COUNT(*) as cantidad, SUM(monto) as montoTotal
     FROM boletas GROUP BY cedula ORDER BY cantidad DESC LIMIT 5`,
    [], (err, rows) => {
      if (err) return res.json([]);
      res.json(rows || []);
    }
  );
});
/*Fin dashboard widgets*/

/*Inicio informes*/
app.get("/informes", (req, res) => {
  const { estado, desde, hasta } = req.query;

  let query = "SELECT * FROM boletas WHERE 1=1";
  const params = [];

  if (estado && estado !== "TODOS") {
    query += " AND estado = ?";
    params.push(estado);
  }

  if (desde) {
    query += " AND fecha >= ?";
    params.push(new Date(desde).toISOString());
  }

  if (hasta) {
    const hastaFin = new Date(hasta);
    hastaFin.setHours(23, 59, 59, 999);
    query += " AND fecha <= ?";
    params.push(hastaFin.toISOString());
  }

  query += " ORDER BY fecha DESC";

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "Error del servidor" });
    }
    res.json(rows || []);
  });
});
/*Fin informes*/

/*Inicio Creador de usuarios*/
app.post("/register", (req, res) => {
  const { username, password } = req.body;

  db.run(
    "INSERT INTO usuarios (username, password, rol, permisos) VALUES (?, ?, 'usuario', '')",
    [username, password],
    function (err) {
      if (err) {
        return res.status(400).json({ error: "Usuario ya existe o error" });
      }

      res.json({ message: "Usuario creado correctamente" });
    }
  );
});
/*Fin Creador de usuarios*/

/*Inicio gestión de usuarios*/
app.get("/usuarios", (req, res) => {
  db.all("SELECT id, username, rol, permisos, modulos, submodulos, nombres, apellidos FROM usuarios ORDER BY id", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    res.json(rows || []);
  });
});

app.post("/usuarios", (req, res) => {
  const { username, password, rol, permisos, modulos, submodulos, nombres, apellidos } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Usuario y contraseña son requeridos" });
  if (!nombres || !String(nombres).trim()) return res.status(400).json({ error: "Los nombres son requeridos" });
  if (!apellidos || !String(apellidos).trim()) return res.status(400).json({ error: "Los apellidos son requeridos" });

  const rolFinal = rol || 'usuario';
  const permisosFinal = permisos || 'canjear,generar,informes,reimprimir,validar';
  const modulosFinal = rolFinal === 'administrador'
    ? 'bono,pedidos,agropecuaria,run-errands,tat'
    : (modulos || '').trim();
  const submodulosFinal = rolFinal === 'administrador' ? '' : (submodulos || '').trim();

  if (!modulosFinal) return res.status(400).json({ error: "Debe asignar al menos un módulo al usuario" });

  db.run(
    "INSERT INTO usuarios (username, password, rol, permisos, modulos, submodulos, nombres, apellidos) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [username, password, rolFinal, permisosFinal, modulosFinal, submodulosFinal, String(nombres).trim(), String(apellidos).trim()],
    function (err) {
      if (err) return res.status(400).json({ error: "Usuario ya existe" });
      res.json({ message: "Usuario creado", id: this.lastID });
    }
  );
});

app.put("/usuarios/:id", (req, res) => {
  const { id } = req.params;
  const { username, password, rol, permisos, modulos, submodulos, nombres, apellidos } = req.body;

  db.get("SELECT * FROM usuarios WHERE id = ?", [id], (err, user) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    const updates = [];
    const params = [];

    if (username) { updates.push("username = ?"); params.push(username); }
    if (password) { updates.push("password = ?"); params.push(password); }
    if (rol) { updates.push("rol = ?"); params.push(rol); }
    if (permisos !== undefined) { updates.push("permisos = ?"); params.push(permisos); }
    if (nombres !== undefined) {
      if (!String(nombres).trim()) return res.status(400).json({ error: "Los nombres son requeridos" });
      updates.push("nombres = ?"); params.push(String(nombres).trim());
    }
    if (apellidos !== undefined) {
      if (!String(apellidos).trim()) return res.status(400).json({ error: "Los apellidos son requeridos" });
      updates.push("apellidos = ?"); params.push(String(apellidos).trim());
    }
    if (modulos !== undefined) {
      const rolFinal = rol || user.rol;
      const modulosFinal = rolFinal === 'administrador'
        ? 'bono,pedidos,agropecuaria,run-errands,tat'
        : String(modulos).trim();
      if (!modulosFinal) return res.status(400).json({ error: "Debe asignar al menos un módulo al usuario" });
      updates.push("modulos = ?"); params.push(modulosFinal);
    }
    if (submodulos !== undefined) {
      const rolFinal = rol || user.rol;
      const subFinal = rolFinal === 'administrador' ? '' : String(submodulos).trim();
      updates.push("submodulos = ?"); params.push(subFinal);
    }

    if (updates.length === 0) return res.status(400).json({ error: "Nada que actualizar" });

    params.push(id);
    db.run(`UPDATE usuarios SET ${updates.join(", ")} WHERE id = ?`, params, function (err) {
      if (err) return res.status(500).json({ error: "Error al actualizar usuario" });
      res.json({ message: "Usuario actualizado" });
    });
  });
});

app.delete("/usuarios/:id", (req, res) => {
  const { id } = req.params;

  db.get("SELECT * FROM usuarios WHERE id = ?", [id], (err, user) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
    if (user.rol === 'administrador') {
      // Verificar que no sea el último admin
      db.get("SELECT COUNT(*) as total FROM usuarios WHERE rol = 'administrador'", [], (err2, row) => {
        if (row && row.total <= 1) return res.status(400).json({ error: "No se puede eliminar el último administrador" });
        db.run("DELETE FROM usuarios WHERE id = ?", [id], function (err3) {
          if (err3) return res.status(500).json({ error: "Error al eliminar" });
          res.json({ message: "Usuario eliminado" });
        });
      });
    } else {
      db.run("DELETE FROM usuarios WHERE id = ?", [id], function (err2) {
        if (err2) return res.status(500).json({ error: "Error al eliminar" });
        res.json({ message: "Usuario eliminado" });
      });
    }
  });
});
/*Fin gestión de usuarios*/

/*Inicio inidicador de error*/
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  db.get(
    "SELECT * FROM usuarios WHERE username = ? AND password = ?",
    [username, password],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: "Error del servidor" });
      }

      if (!user) {
        return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
      }

      res.json({
        message: "Login correcto",
        user: {
          id: user.id,
          username: user.username,
          nombres: user.nombres || '',
          apellidos: user.apellidos || '',
          rol: user.rol || 'administrador',
          permisos: user.permisos || 'canjear,generar,informes,reimprimir,validar',
          modulos: user.modulos || 'bono,pedidos,agropecuaria',
          submodulos: user.submodulos || ''
        }
      });
    }
  );
});
/*Fin inidicador de error*/

// ── SSO: ingreso automático desde rutas_web (token firmado HMAC) ─────────────
// rutas_web embebe SIGLOG en un iframe y abre /sso?token=... El token lleva el
// username (cédula) firmado con SSO_SECRET (mismo valor en ambas apps). Si es
// válido y el usuario existe, se puebla el localStorage igual que el login y se
// entra; si no, cae al login normal. Token de vida corta (~30s).
const crypto = require("crypto");

function verifySsoToken(token) {
  const secret = process.env.SSO_SECRET;
  if (!secret || !token || token.indexOf(".") < 0) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(payload)
    .digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    data = JSON.parse(json);
  } catch (e) { return null; }
  if (!data || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
  return String(data.u || "");
}

app.get("/sso", (req, res) => {
  const username = verifySsoToken(req.query.token);
  if (!username) return res.redirect("/login.html");
  // Página destino tras el SSO (deep-link desde el menú de rutas_web).
  // Solo se permiten rutas internas seguras; si no, al dashboard.
  let next = String(req.query.next || "/dashboard.html");
  if (!next.startsWith("/") || next.startsWith("//")) next = "/dashboard.html";
  db.get("SELECT * FROM usuarios WHERE username = ?", [username], (err, user) => {
    if (err || !user) return res.redirect("/login.html");
    const u = {
      username: user.username,
      rol: user.rol || "administrador",
      nombres: user.nombres || "",
      apellidos: user.apellidos || "",
      permisos: user.permisos || "canjear,generar,informes,reimprimir,validar",
      modulos: user.modulos || "bono,pedidos,agropecuaria",
      submodulos: user.submodulos || "",
    };
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.send(
      '<!doctype html><meta charset="utf-8"><title>SIGLOG</title>' +
      '<body style="font-family:system-ui;color:#666">Entrando a SIGLOG…<script>(function(){try{' +
      "localStorage.setItem('username'," + JSON.stringify(u.username) + ");" +
      "localStorage.setItem('userRol'," + JSON.stringify(u.rol) + ");" +
      "localStorage.setItem('userNombres'," + JSON.stringify(u.nombres) + ");" +
      "localStorage.setItem('userApellidos'," + JSON.stringify(u.apellidos) + ");" +
      "localStorage.setItem('userPermisos'," + JSON.stringify(u.permisos) + ");" +
      "localStorage.setItem('userModulos'," + JSON.stringify(u.modulos) + ");" +
      "localStorage.setItem('userSubmodulos'," + JSON.stringify(u.submodulos) + ");" +
      "}catch(e){}location.replace(" + JSON.stringify(next) + ");})();</script>"
    );
  });
});



/*inicio cuerpo de datos boletas*/
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const XLSX = require("xlsx");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.post("/boletas", (req, res) => {
  const { nombre, cedula, monto, diasVencimiento } = req.body;

  const codigo = uuidv4(); // código único
  const fecha = new Date().toISOString();
  const estado = "ACTIVA";

  const dias = parseInt(diasVencimiento) || 30;
  const venc = new Date();
  venc.setDate(venc.getDate() + dias);
  const vencimiento = venc.toISOString();

  db.run(
    `INSERT INTO boletas (nombre, cedula, fecha, monto, codigo, estado, vencimiento)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [nombre, cedula, fecha, monto, codigo, estado, vencimiento],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Error creando bono" });
      }

      res.json({
        message: "Bono creado",
        codigo: codigo,
        vencimiento: vencimiento
      });
    }
  );
});
/*fin cuerpo de datos boletas*/

/*inicio carga masiva desde Excel*/
app.post("/boletas/carga-masiva", upload.single("archivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const datos = XLSX.utils.sheet_to_json(sheet);

    if (!datos || datos.length === 0) return res.status(400).json({ error: "El archivo está vacío" });

    const diasVencimiento = parseInt(req.body.diasVencimiento) || 30;
    const fecha = new Date().toISOString();
    const venc = new Date();
    venc.setDate(venc.getDate() + diasVencimiento);
    const vencimiento = venc.toISOString();

    let insertados = 0;
    let errores = [];

    const stmt = db.prepare(
      "INSERT INTO boletas (nombre, cedula, fecha, monto, codigo, estado, vencimiento) VALUES (?, ?, ?, ?, ?, 'ACTIVA', ?)"
    );

    datos.forEach((fila, i) => {
      // Normalizar claves a minúsculas sin tildes
      const norm = {};
      Object.keys(fila).forEach(k => {
        norm[k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")] = fila[k];
      });

      const nombre = norm.nombre || "";
      const cedulaRaw = String(norm.cedula || norm.ci || "").trim().replace(/\.0$/, "");
      const cedula = cedulaRaw;
      const monto = parseFloat(norm.bono || norm.monto || norm.valor || 0);

      if (!nombre || !cedula || !monto) {
        const cols = Object.keys(fila).join(", ");
        errores.push("Fila " + (i + 2) + ": datos incompletos (columnas: " + cols + ")");
        return;
      }

      const codigo = uuidv4();
      stmt.run([nombre.trim(), cedula, fecha, Math.round(monto), codigo, vencimiento], (err) => {
        if (err) errores.push("Fila " + (i + 2) + ": " + err.message);
        else insertados++;
      });
    });

    stmt.finalize(() => {
      res.json({
        message: "Carga completada",
        total: datos.length,
        insertados,
        errores: errores.length,
        detalleErrores: errores.slice(0, 10)
      });
    });

  } catch (e) {
    res.status(500).json({ error: "Error al procesar el archivo: " + e.message });
  }
});
/*fin carga masiva*/

/*inicio buscar bonos por cedula*/
app.get("/boletas/cedula/:cedula", (req, res) => {
  const cedula = req.params.cedula.trim();

  db.all(
    "SELECT * FROM boletas WHERE TRIM(cedula) = ? OR TRIM(cedula) LIKE ? ORDER BY fecha DESC",
    [cedula, '%' + cedula],
    (err, bonos) => {
      if (err) {
        return res.status(500).json({ error: "Error del servidor" });
      }

      if (!bonos || bonos.length === 0) {
        return res.status(404).json({ error: "No se encontraron bonos para esta cédula" });
      }

      res.json(bonos);
    }
  );
});
/*fin buscar bonos por cedula*/

/*inicio validar boleta por codigo*/
app.get("/boletas/:codigo", (req, res) => {
  const { codigo } = req.params;

  db.get(
    "SELECT * FROM boletas WHERE codigo = ?",
    [codigo],
    (err, boleta) => {
      if (err) {
        return res.status(500).json({ error: "Error del servidor" });
      }

      if (!boleta) {
        return res.status(404).json({ error: "Boleta no encontrada" });
      }

      res.json(boleta);
    }
  );
});
/*fin validar boleta por codigo*/

/*inicio editar bono*/
app.put("/boletas/:codigo", (req, res) => {
  const { codigo } = req.params;
  const { nombre, cedula, monto } = req.body;

  db.get("SELECT * FROM boletas WHERE codigo = ?", [codigo], (err, boleta) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!boleta) return res.status(404).json({ error: "Bono no encontrado" });

    db.run(
      "UPDATE boletas SET nombre = ?, cedula = ?, monto = ? WHERE codigo = ?",
      [nombre || boleta.nombre, cedula || boleta.cedula, monto ?? boleta.monto, codigo],
      function (err) {
        if (err) return res.status(500).json({ error: "Error al editar bono" });
        res.json({ message: "Bono actualizado" });
      }
    );
  });
});
/*fin editar bono*/

/*inicio eliminar bono*/
app.delete("/boletas/:codigo", (req, res) => {
  const { codigo } = req.params;

  db.get("SELECT * FROM boletas WHERE codigo = ?", [codigo], (err, boleta) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!boleta) return res.status(404).json({ error: "Bono no encontrado" });
    if (boleta.impreso) return res.status(400).json({ error: "No se puede eliminar un bono que ya fue impreso" });

    db.run("DELETE FROM boletas WHERE codigo = ?", [codigo], function (err) {
      if (err) return res.status(500).json({ error: "Error al eliminar bono" });
      res.json({ message: "Bono eliminado" });
    });
  });
});
/*fin eliminar bono*/

/*inicio marcar bono como impreso*/
app.put("/boletas/:codigo/imprimir", (req, res) => {
  const { codigo } = req.params;

  db.run("UPDATE boletas SET impreso = 1 WHERE codigo = ?", [codigo], function (err) {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    res.json({ message: "Bono marcado como impreso" });
  });
});
/*fin marcar bono como impreso*/

/*inicio canjear bono*/
app.put("/boletas/:codigo/canjear", (req, res) => {
  const { codigo } = req.params;

  db.get(
    "SELECT * FROM boletas WHERE codigo = ?",
    [codigo],
    (err, boleta) => {
      if (err) {
        return res.status(500).json({ error: "Error del servidor" });
      }

      if (!boleta) {
        return res.status(404).json({ error: "Bono no encontrado" });
      }

      if (boleta.estado !== "ACTIVA") {
        return res.status(400).json({ error: "Este bono ya fue canjeado" });
      }

      if (boleta.vencimiento && new Date(boleta.vencimiento) < new Date()) {
        return res.status(400).json({ error: "Este bono está vencido" });
      }

      // Obtener siguiente consecutivo de 4 cifras
      db.get("SELECT COALESCE(MAX(consecutivo_canje), 0) + 1 as siguiente FROM boletas", [], (err2, row) => {
        if (err2) return res.status(500).json({ error: "Error del servidor" });

        const consecutivo = row.siguiente;
        const fechaCanje = new Date().toISOString();

        db.run(
          "UPDATE boletas SET estado = 'CANJEADO', consecutivo_canje = ?, fecha_canje = ? WHERE codigo = ?",
          [consecutivo, fechaCanje, codigo],
          function (err) {
            if (err) {
              return res.status(500).json({ error: "Error al canjear bono" });
            }

            res.json({
              message: "Bono canjeado exitosamente",
              boleta: { ...boleta, estado: "CANJEADO", consecutivo_canje: consecutivo, fecha_canje: fechaCanje }
            });
          }
        );
      });
    }
  );
});
/*fin canjear bono*/



app.post("/boletas", (req, res) => {
  const { nombre, cedula, monto } = req.body;

  const codigo = uuidv4(); // código único
  const fecha = new Date().toISOString();
  const estado = "ACTIVA";

  db.run(
    `INSERT INTO boletas (nombre, cedula, fecha, monto, codigo, estado)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nombre, cedula, fecha, monto, codigo, estado],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Error creando boleta" });
      }

      res.json({
        message: "Boleta creada",
        codigo: codigo
      });
    }
  );
});



// Montar rutas del módulo toma de pedidos
app.use("/api/toma-pedidos", tomaPedidosRoutes);

// Montar rutas del módulo distribución agropecuaria
app.use("/api/distribucion-agropecuaria", distribucionAgroRoutes);

app.use("/api/distribucion-tat", distribucionTatRoutes);

// Montar rutas del módulo Run Errands
app.use("/api/run-errands", runErrandsRoutes);

// ============ SCHEDULER: Reset diario de disponibilidad de vehículos a las 18:00 ============
function programarResetVehiculos() {
  const ahora = new Date();
  const proximo = new Date(ahora);
  proximo.setHours(18, 0, 0, 0);
  if (proximo <= ahora) {
    proximo.setDate(proximo.getDate() + 1);
  }
  const ms = proximo - ahora;
  console.log(`[Scheduler] Próximo reset de vehículos: ${proximo.toLocaleString("es-CO")}`);

  setTimeout(() => {
    db.run("UPDATE agro_vehiculos SET disponibilidad = '' WHERE disponibilidad = 'Disponible'", function (err) {
      if (err) {
        console.error("[Scheduler] Error reseteando vehículos:", err.message);
      } else {
        console.log(`[Scheduler] Vehículos reseteados a sin asignar: ${this.changes}`);
      }
      programarResetVehiculos(); // re-programar para el día siguiente
    });
  }, ms);
}
programarResetVehiculos();

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});