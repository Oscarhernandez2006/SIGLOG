const express = require("express");
const router = express.Router();
const db = require("../db");
const multer = require("multer");
const XLSX = require("xlsx");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/* ============ RUTAS ============ */

router.get("/rutas", (req, res) => {
  const { buscar } = req.query;
  let q = "SELECT * FROM agro_rutas WHERE activo = 1";
  const params = [];
  if (buscar) {
    q += " AND (nombre LIKE ? OR recorrido LIKE ? OR ciudad LIKE ?)";
    const t = "%" + buscar + "%";
    params.push(t, t, t);
  }
  q += " ORDER BY id";
  db.all(q, params, (err, rows) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    res.json(rows || []);
  });
});

router.post("/rutas", (req, res) => {
  const { nombre, recorrido, ciudad, kls_recorridos, tiempo, horas } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: "Nombre es requerido" });
  db.run(
    "INSERT INTO agro_rutas (nombre, recorrido, ciudad, kls_recorridos, tiempo, horas) VALUES (?, ?, ?, ?, ?, ?)",
    [nombre.trim(), recorrido || "", ciudad || "", parseFloat(kls_recorridos) || 0, tiempo || "", parseFloat(horas) || 0],
    function (err) {
      if (err) return res.status(500).json({ error: "Error al crear ruta" });
      res.json({ message: "Ruta creada", id: this.lastID });
    }
  );
});

router.put("/rutas/:id", (req, res) => {
  const { id } = req.params;
  const { nombre, recorrido, ciudad, kls_recorridos, tiempo, horas } = req.body || {};
  db.get("SELECT * FROM agro_rutas WHERE id = ?", [id], (err, r) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!r) return res.status(404).json({ error: "Ruta no encontrada" });
    db.run(
      "UPDATE agro_rutas SET nombre = ?, recorrido = ?, ciudad = ?, kls_recorridos = ?, tiempo = ?, horas = ? WHERE id = ?",
      [
        nombre !== undefined ? nombre : r.nombre,
        recorrido !== undefined ? recorrido : r.recorrido,
        ciudad !== undefined ? ciudad : r.ciudad,
        kls_recorridos !== undefined ? parseFloat(kls_recorridos) || 0 : r.kls_recorridos,
        tiempo !== undefined ? tiempo : r.tiempo,
        horas !== undefined ? parseFloat(horas) || 0 : r.horas,
        id,
      ],
      function (err2) {
        if (err2) return res.status(500).json({ error: "Error al actualizar ruta" });
        res.json({ message: "Ruta actualizada" });
      }
    );
  });
});

router.delete("/rutas/:id", (req, res) => {
  const { id } = req.params;
  db.run("UPDATE agro_rutas SET activo = 0 WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: "Error al eliminar ruta" });
    res.json({ message: "Ruta desactivada" });
  });
});

router.post("/rutas/carga-masiva", upload.single("archivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });
  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const datos = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!datos.length) return res.status(400).json({ error: "El archivo está vacío" });

    const norm = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
    let insertados = 0, errores = 0, total = 0;
    const detalleErrores = [];

    const procesar = (i) => {
      if (i >= datos.length) {
        return res.json({ insertados, actualizados: 0, errores, total, detalleErrores });
      }
      const fila = datos[i];
      const obj = {};
      Object.keys(fila).forEach(k => { obj[norm(k)] = fila[k]; });
      const nombre = String(obj["nombre"] || "").trim();
      if (!nombre) { return procesar(i + 1); }
      total++;
      const recorrido = String(obj["recorrido"] || "").trim();
      const ciudad = String(obj["ciudad"] || "").trim();
      const kls = parseFloat(obj["kls recorridos"] || obj["kls"] || obj["kilometros"] || 0) || 0;
      const tiempo = String(obj["tiempo"] || "").trim();
      const horas = parseFloat(obj["horas"] || 0) || 0;
      db.run(
        "INSERT INTO agro_rutas (nombre, recorrido, ciudad, kls_recorridos, tiempo, horas) VALUES (?, ?, ?, ?, ?, ?)",
        [nombre, recorrido, ciudad, kls, tiempo, horas],
        function (err) {
          if (err) { errores++; detalleErrores.push("Fila " + (i + 2) + ": " + err.message); }
          else insertados++;
          procesar(i + 1);
        }
      );
    };
    procesar(0);
  } catch (e) {
    res.status(500).json({ error: "Error procesando archivo: " + e.message });
  }
});

/* ============ PRODUCTOS AGROPECUARIOS ============ */

// Listar productos
router.get("/productos", (req, res) => {
  const mostrarTodos = req.query.todos === "1";
  const { buscar } = req.query;
  let query = "SELECT * FROM agro_productos";
  const params = [];

  if (!mostrarTodos) {
    query += " WHERE activo = 1";
  }

  if (buscar) {
    const prefix = !mostrarTodos ? " AND" : " WHERE";
    query += prefix + " (nombre LIKE ? OR referencia LIKE ? OR categoria LIKE ?)";
    const term = "%" + buscar + "%";
    params.push(term, term, term);
  }

  query += " ORDER BY nombre";

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    res.json(rows || []);
  });
});

// Crear producto
router.post("/productos", (req, res) => {
  const { referencia, nombre, descripcion, categoria, precio, unidad_medida, stock } = req.body;
  if (!nombre || precio == null) return res.status(400).json({ error: "Nombre y precio son requeridos" });

  db.run(
    "INSERT INTO agro_productos (referencia, nombre, descripcion, categoria, precio, unidad_medida, stock) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [referencia || "", nombre.trim(), descripcion || "", categoria || "", parseFloat(precio), unidad_medida || "UNIDAD", parseInt(stock) || 0],
    function (err) {
      if (err) return res.status(500).json({ error: "Error al crear producto" });
      res.json({ message: "Producto creado", id: this.lastID });
    }
  );
});

// Editar producto
router.put("/productos/:id", (req, res) => {
  const { id } = req.params;
  const { referencia, nombre, descripcion, categoria, precio, unidad_medida, stock, activo } = req.body;

  db.get("SELECT * FROM agro_productos WHERE id = ?", [id], (err, prod) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!prod) return res.status(404).json({ error: "Producto no encontrado" });

    db.run(
      "UPDATE agro_productos SET referencia = ?, nombre = ?, descripcion = ?, categoria = ?, precio = ?, unidad_medida = ?, stock = ?, activo = ? WHERE id = ?",
      [
        referencia !== undefined ? referencia : prod.referencia,
        nombre || prod.nombre,
        descripcion !== undefined ? descripcion : prod.descripcion,
        categoria !== undefined ? categoria : prod.categoria,
        precio != null ? parseFloat(precio) : prod.precio,
        unidad_medida !== undefined ? unidad_medida : prod.unidad_medida,
        stock != null ? parseInt(stock) : prod.stock,
        activo !== undefined ? (activo ? 1 : 0) : prod.activo,
        id,
      ],
      function (err) {
        if (err) return res.status(500).json({ error: "Error al actualizar producto" });
        res.json({ message: "Producto actualizado" });
      }
    );
  });
});

// Desactivar producto
router.delete("/productos/:id", (req, res) => {
  const { id } = req.params;
  db.run("UPDATE agro_productos SET activo = 0 WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: "Error al eliminar producto" });
    res.json({ message: "Producto desactivado" });
  });
});

// Carga masiva de productos desde Excel
router.post("/productos/carga-masiva", upload.single("archivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const datos = XLSX.utils.sheet_to_json(sheet);

    if (!datos || datos.length === 0) return res.status(400).json({ error: "El archivo está vacío" });

    function norm(key) {
      return key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\./g, "").trim();
    }

    function getVal(fila, ...keys) {
      for (const k of Object.keys(fila)) {
        const n = norm(k);
        if (keys.includes(n)) return String(fila[k] || "").trim();
      }
      return "";
    }

    let insertados = 0;
    let actualizados = 0;
    let errores = [];
    let pendientes = datos.length;

    datos.forEach((fila, i) => {
      const referenciaRaw = getVal(fila, "referencia", "ref", "codigo", "cod");
      const referencia = referenciaRaw.replace(/\.0$/, "");
      const nombre = getVal(fila, "nombre", "producto", "descripcion", "item");
      const categoria = getVal(fila, "categoria", "tipo", "linea");
      const precioRaw = getVal(fila, "precio", "valor", "precio_unitario");
      const precio = parseFloat(String(precioRaw).replace(/[,$\s]/g, "")) || 0;
      const unidad_medida = getVal(fila, "unidad_medida", "unidad", "um", "medida").toUpperCase() || "UNIDAD";
      const stockRaw = getVal(fila, "stock", "cantidad", "inventario");
      const stock = parseInt(stockRaw) || 0;

      if (!nombre || !precio) {
        errores.push("Fila " + (i + 2) + ": sin nombre o precio");
        pendientes--;
        if (pendientes === 0) enviarRespuesta();
        return;
      }

      if (referencia) {
        db.get("SELECT id FROM agro_productos WHERE referencia = ?", [referencia], (err, existe) => {
          if (existe) {
            db.run(
              "UPDATE agro_productos SET nombre = ?, categoria = ?, precio = ?, unidad_medida = ?, stock = ?, activo = 1 WHERE id = ?",
              [nombre, categoria, precio, unidad_medida, stock, existe.id],
              (err2) => {
                if (err2) errores.push("Fila " + (i + 2) + ": " + err2.message);
                else actualizados++;
                pendientes--;
                if (pendientes === 0) enviarRespuesta();
              }
            );
          } else {
            insertarProducto();
          }
        });
      } else {
        insertarProducto();
      }

      function insertarProducto() {
        db.run(
          "INSERT INTO agro_productos (referencia, nombre, descripcion, categoria, precio, unidad_medida, stock) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [referencia, nombre, "", categoria, precio, unidad_medida, stock],
          (err) => {
            if (err) errores.push("Fila " + (i + 2) + ": " + err.message);
            else insertados++;
            pendientes--;
            if (pendientes === 0) enviarRespuesta();
          }
        );
      }
    });

    function enviarRespuesta() {
      res.json({
        message: "Carga completada",
        total: datos.length,
        insertados,
        actualizados,
        errores: errores.length,
        detalleErrores: errores.slice(0, 15),
      });
    }
  } catch (e) {
    res.status(500).json({ error: "Error al procesar archivo: " + e.message });
  }
});

/* ============ DISTRIBUIDORES ============ */

// Listar distribuidores
router.get("/distribuidores", (req, res) => {
  const { buscar, todos } = req.query;
  let query = "SELECT * FROM agro_distribuidores";
  const params = [];

  if (todos !== "1") {
    query += " WHERE activo = 1";
  }

  if (buscar) {
    const prefix = todos !== "1" ? " AND" : " WHERE";
    query += prefix + " (nombre LIKE ? OR cedula_nit LIKE ? OR telefono LIKE ? OR zona LIKE ?)";
    const term = "%" + buscar + "%";
    params.push(term, term, term, term);
  }

  query += " ORDER BY nombre";

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    res.json(rows || []);
  });
});

// Obtener un distribuidor
router.get("/distribuidores/:id", (req, res) => {
  db.get("SELECT * FROM agro_distribuidores WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!row) return res.status(404).json({ error: "Distribuidor no encontrado" });
    res.json(row);
  });
});

// Crear distribuidor
router.post("/distribuidores", (req, res) => {
  const { nombre, cedula_nit, telefono, direccion, ciudad, zona, email, observaciones } = req.body;
  if (!nombre) return res.status(400).json({ error: "El nombre es requerido" });

  db.run(
    "INSERT INTO agro_distribuidores (nombre, cedula_nit, telefono, direccion, ciudad, zona, email, observaciones, fecha_registro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [nombre.trim(), cedula_nit || "", telefono || "", direccion || "", ciudad || "", zona || "", email || "", observaciones || "", new Date().toISOString()],
    function (err) {
      if (err) return res.status(500).json({ error: "Error al crear distribuidor" });
      res.json({ message: "Distribuidor creado", id: this.lastID });
    }
  );
});

// Editar distribuidor
router.put("/distribuidores/:id", (req, res) => {
  const { id } = req.params;
  const { nombre, cedula_nit, telefono, direccion, ciudad, zona, email, observaciones, activo } = req.body;

  db.get("SELECT * FROM agro_distribuidores WHERE id = ?", [id], (err, dist) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!dist) return res.status(404).json({ error: "Distribuidor no encontrado" });

    db.run(
      "UPDATE agro_distribuidores SET nombre=?, cedula_nit=?, telefono=?, direccion=?, ciudad=?, zona=?, email=?, observaciones=?, activo=? WHERE id=?",
      [
        nombre || dist.nombre,
        cedula_nit !== undefined ? cedula_nit : dist.cedula_nit,
        telefono !== undefined ? telefono : dist.telefono,
        direccion !== undefined ? direccion : dist.direccion,
        ciudad !== undefined ? ciudad : dist.ciudad,
        zona !== undefined ? zona : dist.zona,
        email !== undefined ? email : dist.email,
        observaciones !== undefined ? observaciones : dist.observaciones,
        activo !== undefined ? (activo ? 1 : 0) : dist.activo,
        id,
      ],
      function (err) {
        if (err) return res.status(500).json({ error: "Error al actualizar distribuidor" });
        res.json({ message: "Distribuidor actualizado" });
      }
    );
  });
});

// Desactivar distribuidor
router.delete("/distribuidores/:id", (req, res) => {
  db.run("UPDATE agro_distribuidores SET activo = 0 WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Error al desactivar distribuidor" });
    res.json({ message: "Distribuidor desactivado" });
  });
});

/* ============ ÓRDENES DE DISTRIBUCIÓN ============ */

// Listar clientes únicos de órdenes (para filtro)
// Devuelve { value: distribuidor_nombre almacenado, label: nombre visible del cliente (o stored si no hay match) }
router.get("/ordenes/clientes", (req, res) => {
  db.all(
    `SELECT DISTINCT o.distribuidor_nombre AS value,
            COALESCE(c.nombre, o.distribuidor_nombre) AS label
     FROM agro_ordenes o
     LEFT JOIN agro_clientes c
       ON c.activo = 1
      AND (c.codigo_concatenado = o.distribuidor_nombre OR c.nombre = o.distribuidor_nombre)
     ORDER BY label`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Error del servidor" });
      res.json(rows || []);
    }
  );
});

// Listar órdenes con filtros
router.get("/ordenes", (req, res) => {
  const { estado, desde, hasta, distribuidor, tipo, todas } = req.query;

  // Por defecto excluye órdenes ya asignadas (cola de pendientes).
  // Pasar todas=1 para incluir TODAS (necesario para reporte de nivel de servicio).
  let query = `
    SELECT o.*,
      COALESCE(c.nombre, o.distribuidor_nombre) AS distribuidor_nombre,
      (SELECT COALESCE(SUM(cantidad), 0) FROM agro_orden_items WHERE orden_id = o.id) AS total_pedido,
      (SELECT COALESCE(SUM(cantidad_entregada), 0) FROM agro_orden_items WHERE orden_id = o.id) AS total_entregado
    FROM agro_ordenes o
    LEFT JOIN agro_clientes c
      ON c.activo = 1
     AND (c.codigo_concatenado = o.distribuidor_nombre OR c.nombre = o.distribuidor_nombre)
    WHERE 1=1
  `;
  if (!todas) {
    query += " AND o.id NOT IN (SELECT orden_id FROM agro_asignacion_ordenes)";
  }
  const params = [];

  if (tipo) {
    query += " AND o.numero_orden LIKE ?";
    params.push(tipo + "%");
  }
  if (distribuidor && distribuidor !== "TODOS") {
    query += " AND o.distribuidor_nombre = ?";
    params.push(distribuidor);
  }
  if (estado && estado !== "TODOS") {
    query += " AND o.estado = ?";
    params.push(estado);
  }
  if (desde) {
    query += " AND o.fecha >= ?";
    params.push(new Date(desde).toISOString());
  }
  if (hasta) {
    const hastaFin = new Date(hasta);
    hastaFin.setHours(23, 59, 59, 999);
    query += " AND o.fecha <= ?";
    params.push(hastaFin.toISOString());
  }

  query += " ORDER BY o.fecha DESC";

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    const enriched = (rows || []).map((r) => {
      const ped = Number(r.total_pedido) || 0;
      const ent = Number(r.total_entregado) || 0;
      r.nivel_servicio = ped > 0 ? Math.round((ent / ped) * 1000) / 10 : 0;
      return r;
    });
    res.json(enriched);
  });
});

// Obtener una orden con sus items
router.get("/ordenes/:id", (req, res) => {
  const { id } = req.params;

  db.get("SELECT * FROM agro_ordenes WHERE id = ?", [id], (err, orden) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!orden) return res.status(404).json({ error: "Orden no encontrada" });

    db.all("SELECT * FROM agro_orden_items WHERE orden_id = ?", [id], (err2, items) => {
      if (err2) return res.status(500).json({ error: "Error del servidor" });
      res.json({ ...orden, items: items || [] });
    });
  });
});

// Crear orden con items
router.post("/ordenes", (req, res) => {
  const { distribuidor_id, distribuidor_nombre, observaciones, items } = req.body;

  if (!distribuidor_nombre) return res.status(400).json({ error: "El distribuidor es requerido" });
  if (!items || items.length === 0) return res.status(400).json({ error: "Debe agregar al menos un producto" });

  // Generar número de orden DA-XXXXX
  db.get(
    "SELECT COALESCE(MAX(CAST(SUBSTR(numero_orden, 4) AS INTEGER)), 0) as ultimo FROM agro_ordenes WHERE numero_orden LIKE 'DA-%'",
    [],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Error del servidor" });
      const consecutivo = (row.ultimo || 0) + 1;
      const numero_orden = "DA-" + String(consecutivo).padStart(5, "0");

      const fecha = new Date().toISOString();
      let total = 0;
      items.forEach((item) => {
        total += (parseFloat(item.precio_unitario) || 0) * (parseInt(item.cantidad) || 1);
      });

      db.run(
        "INSERT INTO agro_ordenes (numero_orden, distribuidor_id, distribuidor_nombre, fecha, estado, total, observaciones) VALUES (?, ?, ?, ?, 'PENDIENTE', ?, ?)",
        [numero_orden, distribuidor_id || null, distribuidor_nombre.trim(), fecha, total, observaciones || ""],
        function (err) {
          if (err) return res.status(500).json({ error: "Error al crear orden" });

          const ordenId = this.lastID;
          const stmt = db.prepare(
            "INSERT INTO agro_orden_items (orden_id, producto_nombre, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)"
          );

          items.forEach((item) => {
            const cant = parseInt(item.cantidad) || 1;
            const precio = parseFloat(item.precio_unitario) || 0;
            stmt.run([ordenId, item.producto_nombre, cant, precio, cant * precio]);
          });

          stmt.finalize(() => {
            res.json({ message: "Orden creada", id: ordenId, numero_orden, total });
          });
        }
      );
    }
  );
});

// Actualizar estado de la orden
router.put("/ordenes/:id/estado", (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  const estadosValidos = ["PENDIENTE", "EN_PROCESO", "DESPACHADO", "ENTREGADO", "CANCELADO"];

  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: "Estado no válido. Use: " + estadosValidos.join(", ") });
  }

  db.run("UPDATE agro_ordenes SET estado = ? WHERE id = ?", [estado, id], function (err) {
    if (err) return res.status(500).json({ error: "Error al actualizar estado" });
    if (this.changes === 0) return res.status(404).json({ error: "Orden no encontrada" });
    res.json({ message: "Estado actualizado a " + estado });
  });
});

// Editar orden completa (datos + items)
router.put("/ordenes/:id", (req, res) => {
  const { id } = req.params;
  const { distribuidor_id, distribuidor_nombre, observaciones, items } = req.body;

  if (!items || items.length === 0) return res.status(400).json({ error: "Debe agregar al menos un producto" });

  db.get("SELECT * FROM agro_ordenes WHERE id = ?", [id], (err, orden) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!orden) return res.status(404).json({ error: "Orden no encontrada" });

    let total = 0;
    items.forEach((item) => {
      total += (parseFloat(item.precio_unitario) || 0) * (parseInt(item.cantidad) || 1);
    });

    db.run(
      "UPDATE agro_ordenes SET distribuidor_id = ?, distribuidor_nombre = ?, observaciones = ?, total = ? WHERE id = ?",
      [
        distribuidor_id !== undefined ? distribuidor_id : orden.distribuidor_id,
        distribuidor_nombre || orden.distribuidor_nombre,
        observaciones !== undefined ? observaciones : orden.observaciones,
        total,
        id,
      ],
      function (err) {
        if (err) return res.status(500).json({ error: "Error al actualizar orden" });

        db.run("DELETE FROM agro_orden_items WHERE orden_id = ?", [id], (err2) => {
          if (err2) return res.status(500).json({ error: "Error al actualizar items" });

          const stmt = db.prepare(
            "INSERT INTO agro_orden_items (orden_id, producto_nombre, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)"
          );

          items.forEach((item) => {
            const cant = parseInt(item.cantidad) || 1;
            const precio = parseFloat(item.precio_unitario) || 0;
            stmt.run([id, item.producto_nombre, cant, precio, cant * precio]);
          });

          stmt.finalize(() => {
            res.json({ message: "Orden actualizada", id: parseInt(id), total });
          });
        });
      }
    );
  });
});

// Eliminar orden
router.delete("/ordenes/:id", (req, res) => {
  const { id } = req.params;

  db.get("SELECT * FROM agro_ordenes WHERE id = ?", [id], (err, orden) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!orden) return res.status(404).json({ error: "Orden no encontrada" });

    db.run("DELETE FROM agro_orden_items WHERE orden_id = ?", [id], (err2) => {
      if (err2) return res.status(500).json({ error: "Error al eliminar items" });

      db.run("DELETE FROM agro_ordenes WHERE id = ?", [id], function (err3) {
        if (err3) return res.status(500).json({ error: "Error al eliminar orden" });
        res.json({ message: "Orden eliminada" });
      });
    });
  });
});

// Borrar todas las órdenes (requiere contraseña de admin)
router.post("/ordenes/borrar-todas", async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "La contraseña es requerida" });

  db.get("SELECT * FROM usuarios WHERE rol = 'administrador' AND password = ?", [password], async (err, user) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!user) return res.status(401).json({ error: "Contraseña de administrador incorrecta" });

    // Estrategia: contar antes, luego TRUNCATE CASCADE (Postgres) para no
    // depender de que cada FK tenga ON DELETE CASCADE.
    try {
      const countRow = await new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) AS n FROM agro_ordenes", [], (e, row) => e ? reject(e) : resolve(row));
      });
      const eliminadas = Number(countRow && countRow.n) || 0;

      const tryRun = (sql) => new Promise((resolve, reject) => {
        db.run(sql, [], (e) => e ? reject(e) : resolve());
      });

      try {
        // Postgres: limpia en cascada cualquier tabla que referencie agro_ordenes
        await tryRun("TRUNCATE TABLE agro_ordenes RESTART IDENTITY CASCADE");
      } catch (eTrunc) {
        // Fallback (motores que no soporten TRUNCATE CASCADE): borrado en orden
        console.warn("[borrar-todas] TRUNCATE CASCADE falló, usando DELETE en orden:", eTrunc.message);
        await tryRun("DELETE FROM agro_asignacion_ordenes");
        await tryRun("DELETE FROM agro_orden_items");
        await tryRun("DELETE FROM agro_ordenes");
      }

      // También borrar todas las asignaciones (quedarían vacías sin órdenes).
      // Se borran solo las ACTIVAS para conservar el historial de exportadas.
      try {
        await tryRun("DELETE FROM agro_asignacion_ordenes");
        await tryRun("DELETE FROM agro_asignaciones WHERE COALESCE(estado,'ACTIVA') = 'ACTIVA'");
      } catch (eAsig) {
        console.warn("[borrar-todas] error limpiando asignaciones activas:", eAsig.message);
      }

      return res.json({ message: "Todas las órdenes han sido eliminadas", eliminadas });
    } catch (e) {
      console.error("[borrar-todas] error final:", e && e.message);
      return res.status(500).json({ error: "Error al eliminar órdenes: " + (e && e.message ? e.message : "desconocido") });
    }
  });
});

// Registrar entrega: actualiza cantidad_entregada por item y marca orden como ENTREGADO
router.post("/ordenes/:id/entrega", (req, res) => {
  const { id } = req.params;
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Debe enviar el detalle de items entregados" });
  }

  db.get("SELECT * FROM agro_ordenes WHERE id = ?", [id], (err, orden) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!orden) return res.status(404).json({ error: "Orden no encontrada" });

    db.all("SELECT * FROM agro_orden_items WHERE orden_id = ?", [id], (err2, currentItems) => {
      if (err2) return res.status(500).json({ error: "Error del servidor" });

      const stmt = db.prepare("UPDATE agro_orden_items SET cantidad_entregada = ? WHERE id = ? AND orden_id = ?");
      items.forEach((it) => {
        const itemId = parseInt(it.id);
        let entregada = parseInt(it.cantidad_entregada);
        if (isNaN(entregada) || entregada < 0) entregada = 0;

        // No permitir entregar más de lo pedido
        const current = currentItems.find((c) => c.id === itemId);
        if (current && entregada > current.cantidad) entregada = current.cantidad;

        stmt.run([entregada, itemId, id]);
      });

      stmt.finalize(() => {
        db.run("UPDATE agro_ordenes SET estado = 'ENTREGADO' WHERE id = ?", [id], function (err3) {
          if (err3) return res.status(500).json({ error: "Error al actualizar estado" });
          res.json({ message: "Entrega registrada" });
        });
      });
    });
  });
});

// Nivel de servicio: KPIs agregados con filtros opcionales por fecha
router.get("/nivel-servicio", (req, res) => {
  const { desde, hasta } = req.query;

  const conditions = ["1=1"];
  const params = [];

  if (desde) {
    conditions.push("o.fecha >= ?");
    params.push(new Date(desde).toISOString());
  }
  if (hasta) {
    const hastaFin = new Date(hasta);
    hastaFin.setHours(23, 59, 59, 999);
    conditions.push("o.fecha <= ?");
    params.push(hastaFin.toISOString());
  }

  const where = conditions.join(" AND ");

  const queries = {
    global: `
      SELECT
        COALESCE(SUM(i.cantidad), 0) AS pedido,
        COALESCE(SUM(i.cantidad_entregada), 0) AS entregado,
        COUNT(DISTINCT o.id) AS ordenes
      FROM agro_ordenes o
      LEFT JOIN agro_orden_items i ON i.orden_id = o.id
      WHERE ${where}
    `,
    porCliente: `
      SELECT
        o.distribuidor_nombre AS cliente,
        COALESCE(SUM(i.cantidad), 0) AS pedido,
        COALESCE(SUM(i.cantidad_entregada), 0) AS entregado
      FROM agro_ordenes o
      LEFT JOIN agro_orden_items i ON i.orden_id = o.id
      WHERE ${where}
      GROUP BY o.distribuidor_nombre
      HAVING pedido > 0
      ORDER BY pedido DESC
    `,
    porProducto: `
      SELECT
        i.producto_nombre AS producto,
        COALESCE(SUM(i.cantidad), 0) AS pedido,
        COALESCE(SUM(i.cantidad_entregada), 0) AS entregado
      FROM agro_orden_items i
      INNER JOIN agro_ordenes o ON o.id = i.orden_id
      WHERE ${where}
      GROUP BY i.producto_nombre
      ORDER BY pedido DESC
    `,
    porVehiculo: `
      SELECT
        a.vehiculo_placa AS placa,
        a.vehiculo_conductor AS conductor,
        COALESCE(SUM(i.cantidad), 0) AS pedido,
        COALESCE(SUM(i.cantidad_entregada), 0) AS entregado
      FROM agro_asignaciones a
      INNER JOIN agro_asignacion_ordenes ao ON ao.asignacion_id = a.id
      INNER JOIN agro_ordenes o ON o.id = ao.orden_id
      LEFT JOIN agro_orden_items i ON i.orden_id = o.id
      WHERE ${where}
      GROUP BY a.vehiculo_placa, a.vehiculo_conductor
      ORDER BY pedido DESC
    `,
    porPeriodo: `
      SELECT
        SUBSTR(o.fecha, 1, 10) AS fecha,
        COALESCE(SUM(i.cantidad), 0) AS pedido,
        COALESCE(SUM(i.cantidad_entregada), 0) AS entregado
      FROM agro_ordenes o
      LEFT JOIN agro_orden_items i ON i.orden_id = o.id
      WHERE ${where}
      GROUP BY SUBSTR(o.fecha, 1, 10)
      ORDER BY fecha DESC
    `,
  };

  const result = {};
  const keys = Object.keys(queries);
  let pendientes = keys.length;
  let respondido = false;

  const calcNivel = (row) => {
    const ped = Number(row.pedido) || 0;
    const ent = Number(row.entregado) || 0;
    row.nivel = ped > 0 ? Math.round((ent / ped) * 1000) / 10 : 0;
    return row;
  };

  keys.forEach((k) => {
    const fn = k === "global" ? "get" : "all";
    db[fn](queries[k], params, (err, data) => {
      if (respondido) return;
      if (err) {
        respondido = true;
        return res.status(500).json({ error: "Error al calcular nivel de servicio: " + err.message });
      }
      result[k] = k === "global" ? calcNivel(data || { pedido: 0, entregado: 0, ordenes: 0 }) : (data || []).map(calcNivel);
      pendientes--;
      if (pendientes === 0) res.json(result);
    });
  });
});

// Marcar orden como entregada "Sin Novedad" (entrega completa = lo pedido)
router.post("/ordenes/:id/sin-novedad", (req, res) => {
  const { id } = req.params;
  db.get("SELECT id FROM agro_ordenes WHERE id = ?", [id], (err, orden) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!orden) return res.status(404).json({ error: "Orden no encontrada" });

    db.run("UPDATE agro_orden_items SET cantidad_entregada = cantidad WHERE orden_id = ?", [id], function (err2) {
      if (err2) return res.status(500).json({ error: "Error al actualizar items" });
      db.run("UPDATE agro_ordenes SET estado = 'SIN NOVEDAD' WHERE id = ?", [id], function (err3) {
        if (err3) return res.status(500).json({ error: "Error al actualizar estado" });
        res.json({ message: "Entrega registrada sin novedad" });
      });
    });
  });
});

// Listar órdenes asignadas pendientes de entrega completa
router.get("/ordenes-pendientes-entrega", (req, res) => {
  const query = `
    SELECT o.*,
      a.id AS asignacion_id,
      a.vehiculo_placa,
      a.vehiculo_conductor,
      a.fecha AS asignacion_fecha,
      (SELECT COALESCE(SUM(cantidad), 0) FROM agro_orden_items WHERE orden_id = o.id) AS total_pedido,
      (SELECT COALESCE(SUM(cantidad_entregada), 0) FROM agro_orden_items WHERE orden_id = o.id) AS total_entregado
    FROM agro_ordenes o
    INNER JOIN agro_asignacion_ordenes ao ON ao.orden_id = o.id
    INNER JOIN agro_asignaciones a ON a.id = ao.asignacion_id
    WHERE 1=1
    ORDER BY a.fecha DESC, o.numero_orden ASC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    const pendientes = (rows || []).filter(r => (Number(r.total_entregado) || 0) < (Number(r.total_pedido) || 0));
    res.json(pendientes);
  });
});

/* ============ VEHÍCULOS ============ */

// Listar vehículos
router.get("/vehiculos", (req, res) => {
  const { buscar, todos } = req.query;
  let query = `SELECT v.*, t.cedula AS tripulacion_cedula,
                      TRIM(COALESCE(t.nombres,'') || ' ' || COALESCE(t.apellidos,'')) AS tripulacion_nombre,
                      COALESCE(t.rol,'Conductor') AS tripulacion_rol
                 FROM agro_vehiculos v
                 LEFT JOIN agro_tripulacion t ON t.id = v.tripulacion_id`;
  const params = [];

  if (todos !== "1") {
    query += " WHERE v.activo = 1";
  }

  if (buscar) {
    const prefix = todos !== "1" ? " AND" : " WHERE";
    query += prefix + " (v.placa LIKE ? OR v.conductor LIKE ?)";
    const term = "%" + buscar + "%";
    params.push(term, term);
  }

  query += " ORDER BY v.placa";

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error("[GET /vehiculos]", err.message, "\nSQL:", query, "\nParams:", params);
      return res.status(500).json({ error: err.message || "Error del servidor" });
    }
    res.json(rows || []);
  });
});

// Obtener un vehículo
router.get("/vehiculos/:id", (req, res) => {
  db.get("SELECT * FROM agro_vehiculos WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!row) return res.status(404).json({ error: "Vehículo no encontrado" });
    res.json(row);
  });
});

// Crear vehículo
router.post("/vehiculos", (req, res) => {
  const { placa, conductor, disponibilidad } = req.body;
  if (!placa || !conductor) return res.status(400).json({ error: "Placa y conductor son requeridos" });

  db.run(
    "INSERT INTO agro_vehiculos (placa, conductor, disponibilidad) VALUES (?, ?, ?)",
    [placa.trim().toUpperCase(), conductor.trim(), disponibilidad || ""],
    function (err) {
      if (err) return res.status(500).json({ error: "Error al crear vehículo" });
      res.json({ message: "Vehículo creado", id: this.lastID });
    }
  );
});

// Editar vehículo
router.put("/vehiculos/:id", (req, res) => {
  const { id } = req.params;
  const { placa, conductor, disponibilidad, activo, tripulacion_id } = req.body;

  db.get("SELECT * FROM agro_vehiculos WHERE id = ?", [id], (err, veh) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!veh) return res.status(404).json({ error: "Vehículo no encontrado" });

    // Validación: no permitir marcar como "Disponible" si no hay conductor
    if (disponibilidad === "Disponible") {
      const tendraTripulante = tripulacion_id !== undefined
        ? (tripulacion_id !== null && tripulacion_id !== "")
        : !!veh.tripulacion_id;
      if (!tendraTripulante) {
        return res.status(400).json({ error: "Asigne un conductor antes de marcar el vehículo como disponible" });
      }
    }

    // Si llega tripulacion_id, obtener el nombre desde tripulación para guardar en conductor
    const aplicar = (conductorFinal, tidFinal) => {
      // Si queda sin tripulante, forzar disponibilidad = "" (no puede estar disponible sin conductor)
      const sinConductor = !tidFinal;
      const dispFinal = sinConductor
        ? ""
        : (disponibilidad !== undefined ? disponibilidad : veh.disponibilidad);
      db.run(
        "UPDATE agro_vehiculos SET placa=?, conductor=?, disponibilidad=?, activo=?, tripulacion_id=? WHERE id=?",
        [
          placa ? placa.trim().toUpperCase() : veh.placa,
          conductorFinal,
          dispFinal,
          activo !== undefined ? (activo ? 1 : 0) : veh.activo,
          tidFinal,
          id,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: "Error al actualizar vehículo" });
          res.json({ message: "Vehículo actualizado" });
        }
      );
    };

    if (tripulacion_id !== undefined) {
      if (tripulacion_id === null || tripulacion_id === "") {
        // Quitar tripulante: limpiar también el texto conductor heredado
        aplicar(conductor !== undefined ? (conductor || "") : "", null);
      } else {
        db.get("SELECT nombres, apellidos FROM agro_tripulacion WHERE id = ?", [tripulacion_id], (e, t) => {
          if (e || !t) return res.status(400).json({ error: "Tripulante no encontrado" });
          const nombreFull = ((t.nombres || "") + " " + (t.apellidos || "")).trim();
          aplicar(nombreFull || conductor || veh.conductor, tripulacion_id);
        });
      }
    } else {
      aplicar(conductor || veh.conductor, veh.tripulacion_id);
    }
  });
});

// Desactivar vehículo
router.delete("/vehiculos/:id", (req, res) => {
  db.run("UPDATE agro_vehiculos SET activo = 0 WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Error al desactivar vehículo" });
    res.json({ message: "Vehículo desactivado" });
  });
});

// ==================== TRIPULACIÓN ====================
// Lista de tripulación
router.get("/tripulacion", (req, res) => {
  db.all(
    `SELECT id, cedula, COALESCE(nombres,'') AS nombres, COALESCE(apellidos,'') AS apellidos,
            COALESCE(telefono,'') AS telefono, COALESCE(rol,'Conductor') AS rol,
            COALESCE(tipo,'') AS tipo
       FROM agro_tripulacion
      ORDER BY nombres COLLATE NOCASE, apellidos COLLATE NOCASE`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Error al obtener tripulación" });
      res.json(rows);
    }
  );
});

// Helper: verificar contraseña de administrador
function verificarAdmin(password, cb) {
  if (!password) return cb(false);
  db.get("SELECT id FROM usuarios WHERE rol = 'administrador' AND password = ?", [password], (err, user) => {
    cb(!err && !!user);
  });
}

// Crear tripulante
router.post("/tripulacion", (req, res) => {
  const { cedula, nombres, apellidos, telefono, rol, tipo, password } = req.body;
  verificarAdmin(password, (ok) => {
    if (!ok) return res.status(401).json({ error: "Contraseña de administrador incorrecta" });
    const rolFinal = rol === "Auxiliar de ruta" ? "Auxiliar de ruta" : "Conductor";
    // Conductores requieren cédula; auxiliares pueden no tenerla
    if (rolFinal === "Conductor" && (!cedula || !String(cedula).trim())) {
      return res.status(400).json({ error: "Cédula requerida" });
    }
    if (!nombres && !apellidos) return res.status(400).json({ error: "Nombre requerido" });
    const nom = (nombres || "").trim();
    const ape = (apellidos || "").trim();
    const cedFinal = cedula && String(cedula).trim() ? String(cedula).trim() : null;
    db.run(
      `INSERT INTO agro_tripulacion (cedula, nombres, apellidos, telefono, rol, nombre, tipo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cedFinal, nom, ape, (telefono || "").trim(), rolFinal, (nom + " " + ape).trim(), (tipo || "").trim()],
      function (err) {
        if (err) {
          if (String(err.message).includes("UNIQUE")) return res.status(400).json({ error: "Ya existe un tripulante con esa cédula" });
          return res.status(500).json({ error: "Error al crear tripulante" });
        }
        res.json({ id: this.lastID, message: "Tripulante creado" });
      }
    );
  });
});

// Actualizar tripulante
router.put("/tripulacion/:id", (req, res) => {
  const { cedula, nombres, apellidos, telefono, rol, tipo, password, soloRol } = req.body;
  // Si solo se cambia el rol no se exige contraseña (cambio rápido)
  const continuar = () => {
    const rolFinal = rol === "Auxiliar de ruta" ? "Auxiliar de ruta" : "Conductor";
    const nom = (nombres || "").trim();
    const ape = (apellidos || "").trim();
    const cedFinal = cedula && String(cedula).trim() ? String(cedula).trim() : null;
    db.run(
      `UPDATE agro_tripulacion
          SET cedula = ?, nombres = ?, apellidos = ?, telefono = ?, rol = ?, nombre = ?, tipo = ?
        WHERE id = ?`,
      [cedFinal, nom, ape, (telefono || "").trim(), rolFinal, (nom + " " + ape).trim(), (tipo || "").trim(), req.params.id],
      function (err) {
        if (err) {
          if (String(err.message).includes("UNIQUE")) return res.status(400).json({ error: "Ya existe un tripulante con esa cédula" });
          return res.status(500).json({ error: "Error al actualizar tripulación" });
        }
        res.json({ message: "Tripulación actualizada" });
      }
    );
  };
  if (soloRol) return continuar();
  verificarAdmin(password, (ok) => {
    if (!ok) return res.status(401).json({ error: "Contraseña de administrador incorrecta" });
    continuar();
  });
});

// Eliminar tripulante
router.delete("/tripulacion/:id", (req, res) => {
  const password = req.body?.password || req.query?.password || req.headers["x-admin-password"];
  verificarAdmin(password, (ok) => {
    if (!ok) return res.status(401).json({ error: "Contraseña de administrador incorrecta" });
    db.run("DELETE FROM agro_tripulacion WHERE id = ?", [req.params.id], function (err) {
      if (err) return res.status(500).json({ error: "Error al eliminar tripulante" });
      res.json({ message: "Tripulante eliminado" });
    });
  });
});

// Carga masiva de vehículos desde Excel
router.post("/vehiculos/carga-masiva", upload.single("archivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (!raw || raw.length < 2) return res.status(400).json({ error: "El archivo está vacío" });

    const dataRows = raw.slice(1); // Saltar encabezado
    let insertados = 0;
    let actualizados = 0;
    let errores = [];
    let pendientes = 0;

    const filasValidas = dataRows.filter(r => String(r[1] || "").trim() && String(r[2] || "").trim());
    pendientes = filasValidas.length;

    if (pendientes === 0) return res.json({ message: "No se encontraron vehículos válidos", insertados: 0 });

    filasValidas.forEach((fila, i) => {
      const placa = String(fila[1] || "").trim().toUpperCase();
      const conductor = String(fila[2] || "").trim();
      const disponibilidad = String(fila[3] || "").trim();

      db.get("SELECT id FROM agro_vehiculos WHERE placa = ?", [placa], (err, existe) => {
        if (existe) {
          db.run("UPDATE agro_vehiculos SET conductor = ?, disponibilidad = ?, activo = 1 WHERE id = ?",
            [conductor, disponibilidad, existe.id], (err2) => {
              if (err2) errores.push("Fila " + (i + 2) + ": " + err2.message);
              else actualizados++;
              pendientes--;
              if (pendientes === 0) enviarRespuesta();
            });
        } else {
          db.run("INSERT INTO agro_vehiculos (placa, conductor, disponibilidad) VALUES (?, ?, ?)",
            [placa, conductor, disponibilidad], (err2) => {
              if (err2) errores.push("Fila " + (i + 2) + ": " + err2.message);
              else insertados++;
              pendientes--;
              if (pendientes === 0) enviarRespuesta();
            });
        }
      });
    });

    function enviarRespuesta() {
      res.json({ message: "Carga completada", insertados, actualizados, errores: errores.length, detalleErrores: errores.slice(0, 15) });
    }
  } catch (e) {
    res.status(500).json({ error: "Error al procesar archivo: " + e.message });
  }
});

/* ============ CLIENTES AGROPECUARIOS ============ */

// Listar clientes
router.get("/clientes", (req, res) => {
  const { buscar, todos } = req.query;
  let query = "SELECT * FROM agro_clientes";
  const params = [];

  if (todos !== "1") {
    query += " WHERE activo = 1";
  }

  if (buscar) {
    const prefix = todos !== "1" ? " AND" : " WHERE";
    query += prefix + " (nombre LIKE ? OR codigo LIKE ? OR ciudad LIKE ? OR barrio LIKE ? OR codigo_concatenado LIKE ?)";
    const term = "%" + buscar + "%";
    params.push(term, term, term, term, term);
  }

  query += " ORDER BY codigo";

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    res.json(rows || []);
  });
});

// Obtener un cliente
router.get("/clientes/:id", (req, res) => {
  db.get("SELECT * FROM agro_clientes WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!row) return res.status(404).json({ error: "Cliente no encontrado" });
    res.json(row);
  });
});

// Crear cliente
router.post("/clientes", (req, res) => {
  const { codigo, codigo_concatenado, nombre, direccion, barrio, ciudad, departamento, telefono } = req.body;
  if (!nombre) return res.status(400).json({ error: "El nombre es requerido" });

  db.run(
    "INSERT INTO agro_clientes (codigo, codigo_concatenado, nombre, direccion, barrio, ciudad, departamento, telefono) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [codigo || null, codigo_concatenado || "", nombre.trim(), direccion || "", barrio || "", ciudad || "", departamento || "", telefono || ""],
    function (err) {
      if (err) return res.status(500).json({ error: "Error al crear cliente" });
      res.json({ message: "Cliente creado", id: this.lastID });
    }
  );
});

// Editar cliente
router.put("/clientes/:id", (req, res) => {
  const { id } = req.params;
  const { codigo, codigo_concatenado, nombre, direccion, barrio, ciudad, departamento, telefono, activo } = req.body;

  db.get("SELECT * FROM agro_clientes WHERE id = ?", [id], (err, cli) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });

    db.run(
      "UPDATE agro_clientes SET codigo=?, codigo_concatenado=?, nombre=?, direccion=?, barrio=?, ciudad=?, departamento=?, telefono=?, activo=? WHERE id=?",
      [
        codigo !== undefined ? codigo : cli.codigo,
        codigo_concatenado !== undefined ? codigo_concatenado : cli.codigo_concatenado,
        nombre || cli.nombre,
        direccion !== undefined ? direccion : cli.direccion,
        barrio !== undefined ? barrio : cli.barrio,
        ciudad !== undefined ? ciudad : cli.ciudad,
        departamento !== undefined ? departamento : cli.departamento,
        telefono !== undefined ? telefono : cli.telefono,
        activo !== undefined ? (activo ? 1 : 0) : cli.activo,
        id,
      ],
      function (err) {
        if (err) return res.status(500).json({ error: "Error al actualizar cliente" });
        res.json({ message: "Cliente actualizado" });
      }
    );
  });
});

// Desactivar cliente
router.delete("/clientes/:id", (req, res) => {
  db.run("UPDATE agro_clientes SET activo = 0 WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Error al desactivar cliente" });
    res.json({ message: "Cliente desactivado" });
  });
});

// Carga masiva de clientes desde Excel
router.post("/clientes/carga-masiva", upload.single("archivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (!raw || raw.length < 2) return res.status(400).json({ error: "El archivo está vacío" });

    const dataRows = raw.slice(1);
    let insertados = 0;
    let actualizados = 0;
    let errores = [];
    let pendientes = 0;

    const filasValidas = dataRows.filter(r => String(r[3] || "").trim());
    pendientes = filasValidas.length;

    if (pendientes === 0) return res.json({ message: "No se encontraron clientes válidos", insertados: 0 });

    filasValidas.forEach((fila, i) => {
      const codigo = parseInt(fila[2]) || null;
      const codigo_concatenado = String(fila[1] || "").trim();
      const nombre = String(fila[3] || "").trim();
      const direccion = String(fila[4] || "").trim();
      const barrio = String(fila[5] || "").trim();
      const ciudad = String(fila[6] || "").trim();
      const departamento = String(fila[7] || "").trim();
      const telefono = String(fila[8] || "").trim();

      if (codigo) {
        db.get("SELECT id FROM agro_clientes WHERE codigo = ? AND codigo_concatenado = ?", [codigo, codigo_concatenado], (err, existe) => {
          if (existe) {
            db.run("UPDATE agro_clientes SET nombre=?, direccion=?, barrio=?, ciudad=?, departamento=?, telefono=?, activo=1 WHERE id=?",
              [nombre, direccion, barrio, ciudad, departamento, telefono, existe.id], (err2) => {
                if (err2) errores.push("Fila " + (i + 2) + ": " + err2.message);
                else actualizados++;
                pendientes--;
                if (pendientes === 0) enviarRespuesta();
              });
          } else {
            insertarCliente();
          }
        });
      } else {
        insertarCliente();
      }

      function insertarCliente() {
        db.run("INSERT INTO agro_clientes (codigo, codigo_concatenado, nombre, direccion, barrio, ciudad, departamento, telefono) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [codigo, codigo_concatenado, nombre, direccion, barrio, ciudad, departamento, telefono], (err2) => {
            if (err2) errores.push("Fila " + (i + 2) + ": " + err2.message);
            else insertados++;
            pendientes--;
            if (pendientes === 0) enviarRespuesta();
          });
      }
    });

    function enviarRespuesta() {
      res.json({ message: "Carga completada", insertados, actualizados, errores: errores.length, detalleErrores: errores.slice(0, 15) });
    }
  } catch (e) {
    res.status(500).json({ error: "Error al procesar archivo: " + e.message });
  }
});

/* ============ CARGA MASIVA DE ÓRDENES DESDE EXCEL ============ */

// Verificar clientes del Excel antes de cargar
router.post("/ordenes/verificar-excel", upload.single("archivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (!raw || raw.length < 3) return res.status(400).json({ error: "El archivo está vacío o no tiene datos" });

    const dataRows = raw.slice(2);
    const clientesMap = new Map(); // concatenado -> nombre

    dataRows.forEach(fila => {
      if (!fila || fila.length < 5) return;
      const cliente = String(fila[3] || "").trim();
      const destino = String(fila[4] || "").trim();
      const concatenado = destino ? cliente + "-" + destino : cliente;
      if (concatenado && !clientesMap.has(concatenado)) clientesMap.set(concatenado, cliente);
    });

    const clientesUnicos = Array.from(clientesMap.keys());

    if (clientesUnicos.length === 0) return res.json({ nuevos: [], existentes: [] });

    // Buscar cuáles existen en agro_clientes (por nombre o codigo_concatenado)
    const placeholders = clientesUnicos.map(() => "?").join(",");
    const allPlaceholders = [...clientesUnicos, ...clientesUnicos];
    db.all(
      "SELECT DISTINCT nombre, codigo_concatenado FROM agro_clientes WHERE (nombre IN (" + placeholders + ") OR codigo_concatenado IN (" + placeholders + ")) AND activo = 1",
      allPlaceholders,
      (err, rows) => {
        if (err) return res.status(500).json({ error: "Error del servidor" });

        const existentes = new Set();
        (rows || []).forEach(r => {
          existentes.add(r.nombre);
          if (r.codigo_concatenado) existentes.add(r.codigo_concatenado);
        });
        const nuevos = clientesUnicos
          .filter(c => !existentes.has(c))
          .map(concatenado => ({ nombre: clientesMap.get(concatenado), concatenado }));

        // Extraer órdenes únicas para selección de tipo
        const ordenesUnicas = [];
        const ordenesVistas = new Set();
        dataRows.forEach(fila => {
          if (!fila || fila.length < 5) return;
          const numOrden = String(fila[2] || "").trim();
          const cliente = String(fila[3] || "").trim();
          if (numOrden && !ordenesVistas.has(numOrden)) {
            ordenesVistas.add(numOrden);
            ordenesUnicas.push({ numero: numOrden, cliente });
          }
        });

        res.json({ nuevos, existentes: Array.from(existentes), ordenes: ordenesUnicas });
      }
    );
  } catch (e) {
    res.status(500).json({ error: "Error al procesar archivo: " + e.message });
  }
});

router.post("/ordenes/carga-excel", upload.single("archivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });

  // Recibir tipo global (B o P)
  const tipoGlobal = (req.body.tipo || "B").toUpperCase() === "P" ? "P" : "B";

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Leer como array de arrays (sin headers)
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (!raw || raw.length < 3) return res.status(400).json({ error: "El archivo está vacío o no tiene datos" });

    // Fila 1 = título, Fila 2 = encabezados, Fila 3+ = datos
    // Solo se toman: 2=No.ORDEN, 3=CLIENTE, 4=DESTINO, 13=CANT.

    // Agrupar filas por No. ORDEN sumando cantidades
    const ordenesMap = {};
    const dataRows = raw.slice(2); // Saltar título y encabezados

    dataRows.forEach((fila, i) => {
      if (!fila || fila.length < 5) return;

      const numOrden = String(fila[2] || "").trim();
      const cliente = String(fila[3] || "").trim();
      const destino = String(fila[4] || "").trim();
      const concatenado = destino ? cliente + "-" + destino : cliente;
      const cantidad = parseFloat(fila[13]) || 0;

      if (!numOrden) return;

      const key = numOrden;

      if (!ordenesMap[key]) {
        ordenesMap[key] = {
          numero_orden_ext: numOrden,
          cliente: concatenado,
          destino,
          cantidad: 0,
        };
      }

      ordenesMap[key].cantidad += cantidad;
    });

    const ordenesArr = Object.values(ordenesMap);
    let creadas = 0;
    let errores = [];
    let omitidas = [];

    if (ordenesArr.length === 0) {
      return res.json({ message: "No se encontraron órdenes para procesar", creadas: 0, errores: 0, totalFilas: dataRows.length });
    }

    // Validar que el cliente (codigo_concatenado o nombre) exista en agro_clientes.
    // Las órdenes cuyo cliente NO esté creado se omiten.
    const clientesUnicos = [...new Set(ordenesArr.map(o => o.cliente).filter(Boolean))];
    const placeholders = clientesUnicos.map(() => "?").join(",");
    const params = [...clientesUnicos, ...clientesUnicos];

    db.all(
      "SELECT DISTINCT nombre, codigo_concatenado FROM agro_clientes WHERE activo = 1 AND (codigo_concatenado IN (" + placeholders + ") OR nombre IN (" + placeholders + "))",
      params,
      (errC, rowsC) => {
        if (errC) return res.status(500).json({ error: "Error validando clientes: " + errC.message });

        const existentes = new Set();
        (rowsC || []).forEach(r => {
          if (r.codigo_concatenado) existentes.add(r.codigo_concatenado);
          if (r.nombre) existentes.add(r.nombre);
        });

        const ordenesValidas = ordenesArr.filter(o => existentes.has(o.cliente));
        omitidas = ordenesArr
          .filter(o => !existentes.has(o.cliente))
          .map(o => "Orden " + o.numero_orden_ext + " omitida: cliente '" + o.cliente + "' no existe");

        if (ordenesValidas.length === 0) {
          return res.json({
            message: "No se creó ninguna orden: ningún cliente está registrado",
            totalFilas: dataRows.length,
            ordenesCreadas: 0,
            errores: 0,
            omitidas: omitidas.length,
            detalleOmitidas: omitidas.slice(0, 15),
            detalleErrores: [],
          });
        }

        const fechaISO = new Date().toISOString();
        let pendientes = ordenesValidas.length;

        ordenesValidas.forEach((ord, idx) => {
          const numero_orden = tipoGlobal + String(ord.numero_orden_ext);

          const observaciones = [
            ord.destino ? "Destino: " + ord.destino : "",
          ].filter(Boolean).join(" | ");

          db.run(
            "INSERT INTO agro_ordenes (numero_orden, distribuidor_id, distribuidor_nombre, fecha, estado, total, observaciones) VALUES (?, ?, ?, ?, 'PENDIENTE', ?, ?)",
            [numero_orden, null, ord.cliente || "Sin cliente", fechaISO, ord.cantidad, observaciones],
            function (err2) {
              if (err2) {
                errores.push("Orden " + (ord.numero_orden_ext || idx) + ": " + err2.message);
              } else {
                creadas++;
              }
              pendientes--;
              if (pendientes === 0) {
                res.json({
                  message: "Carga completada",
                  totalFilas: dataRows.length,
                  ordenesCreadas: creadas,
                  errores: errores.length,
                  omitidas: omitidas.length,
                  detalleOmitidas: omitidas.slice(0, 15),
                  detalleErrores: errores.slice(0, 15),
                });
              }
            }
          );
        });
      }
    );
  } catch (e) {
    res.status(500).json({ error: "Error al procesar archivo: " + e.message });
  }
});

/* ============ ASIGNACIÓN DE VEHÍCULOS ============ */

// Listar asignaciones ACTIVAS (no exportadas)
router.get("/asignaciones", (req, res) => {
  const { todas } = req.query;
  const whereEstado = String(todas || "") === "1" ? "1=1" : "COALESCE(estado,'ACTIVA') = 'ACTIVA'";
  db.all(`SELECT * FROM agro_asignaciones WHERE ${whereEstado} ORDER BY fecha DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });

    const asignaciones = rows || [];
    if (!asignaciones.length) return res.json([]);

    let pendientes = asignaciones.length;
    asignaciones.forEach(a => {
      db.all(
        `SELECT ao.orden_id, o.numero_orden,
                COALESCE(c.nombre, o.distribuidor_nombre) AS distribuidor_nombre,
                o.total
         FROM agro_asignacion_ordenes ao
         LEFT JOIN agro_ordenes o ON o.id = ao.orden_id
         LEFT JOIN agro_clientes c
           ON c.activo = 1
          AND (c.codigo_concatenado = o.distribuidor_nombre OR c.nombre = o.distribuidor_nombre)
         WHERE ao.asignacion_id = ?`,
        [a.id],
        (err2, ordenes) => {
          a.ordenes = ordenes || [];
          pendientes--;
          if (pendientes === 0) res.json(asignaciones);
        }
      );
    });
  });
});

// Crear asignación (recibe vehiculo_id y array de orden_ids)
router.post("/asignaciones", (req, res) => {
  const { vehiculo_id, orden_ids, observaciones } = req.body;

  if (!vehiculo_id) return res.status(400).json({ error: "Debe seleccionar un vehículo" });
  if (!orden_ids || !orden_ids.length) return res.status(400).json({ error: "Debe seleccionar al menos una orden" });

  db.get("SELECT * FROM agro_vehiculos WHERE id = ? AND activo = 1", [vehiculo_id], (err, vehiculo) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!vehiculo) return res.status(404).json({ error: "Vehículo no encontrado" });

    const fecha = new Date().toISOString();
    db.run(
      "INSERT INTO agro_asignaciones (vehiculo_id, vehiculo_placa, vehiculo_conductor, fecha, observaciones) VALUES (?, ?, ?, ?, ?)",
      [vehiculo_id, vehiculo.placa, vehiculo.conductor, fecha, observaciones || ""],
      function (err2) {
        if (err2) return res.status(500).json({ error: "Error al crear asignación" });

        const asignacionId = this.lastID;
        let insertados = 0;
        let errores = 0;

        orden_ids.forEach(ordenId => {
          db.run(
            "INSERT INTO agro_asignacion_ordenes (asignacion_id, orden_id) VALUES (?, ?)",
            [asignacionId, ordenId],
            (err3) => {
              if (err3) errores++; else insertados++;
              if (insertados + errores === orden_ids.length) {
                res.json({ message: "Asignación creada", id: asignacionId, ordenes: insertados });
              }
            }
          );
        });
      }
    );
  });
});

// Eliminar asignación (devuelve órdenes a pendientes)
router.delete("/asignaciones/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM agro_asignacion_ordenes WHERE asignacion_id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    db.run("DELETE FROM agro_asignaciones WHERE id = ?", [id], function (err2) {
      if (err2) return res.status(500).json({ error: "Error del servidor" });
      res.json({ message: "Asignación eliminada, órdenes devueltas" });
    });
  });
});

// Limpiar asignaciones ACTIVA que no tengan órdenes EXISTENTES asociadas
// (incluye casos en que agro_asignacion_ordenes apunta a órdenes ya eliminadas)
router.post("/asignaciones/limpiar-vacias", (req, res) => {
  // Primero, borrar referencias huérfanas en agro_asignacion_ordenes
  const limpiarHuerfanas = `
    DELETE FROM agro_asignacion_ordenes
    WHERE orden_id NOT IN (SELECT id FROM agro_ordenes)
  `;
  db.run(limpiarHuerfanas, [], (eH) => {
    if (eH) {
      console.error("[limpiar-vacias] huerfanas:", eH.message);
      return res.status(500).json({ error: "Error limpiando referencias huérfanas: " + eH.message });
    }
    // Luego borrar asignaciones ACTIVA que ya no tienen ninguna orden
    const sql = `
      DELETE FROM agro_asignaciones
      WHERE COALESCE(estado,'ACTIVA') = 'ACTIVA'
        AND id NOT IN (SELECT DISTINCT asignacion_id FROM agro_asignacion_ordenes)
    `;
    db.run(sql, [], function (err) {
      if (err) {
        console.error("[limpiar-vacias] error:", err.message);
        return res.status(500).json({ error: "Error al limpiar asignaciones vacías: " + err.message });
      }
      res.json({ message: "Asignaciones vacías eliminadas", eliminadas: this.changes || 0 });
    });
  });
});

// Desasignar una orden individual (quitarla de la asignación)
router.delete("/asignaciones/:asignacionId/orden/:ordenId", (req, res) => {
  const { asignacionId, ordenId } = req.params;
  db.run("DELETE FROM agro_asignacion_ordenes WHERE asignacion_id = ? AND orden_id = ?", [asignacionId, ordenId], function (err) {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    // Si la asignación queda sin órdenes, eliminarla
    db.get("SELECT COUNT(*) as total FROM agro_asignacion_ordenes WHERE asignacion_id = ?", [asignacionId], (err2, row) => {
      if (!err2 && row && row.total === 0) {
        db.run("DELETE FROM agro_asignaciones WHERE id = ?", [asignacionId]);
      }
      res.json({ message: "Orden desasignada" });
    });
  });
});

// Exportar asignaciones a Excel (formato Free Order) - marca como EXPORTADA y las mueve al historial
router.get("/asignaciones/exportar-excel", (req, res) => {
  db.all("SELECT * FROM agro_asignaciones WHERE COALESCE(estado,'ACTIVA') = 'ACTIVA' ORDER BY fecha DESC", [], (err, asignaciones) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!asignaciones || !asignaciones.length) return res.status(400).json({ error: "No hay asignaciones para exportar" });

    let pendientes = asignaciones.length;
    asignaciones.forEach(a => {
      db.all(
        `SELECT ao.orden_id, o.numero_orden,
                COALESCE(c.nombre, o.distribuidor_nombre) AS distribuidor_nombre,
                o.total
         FROM agro_asignacion_ordenes ao
         LEFT JOIN agro_ordenes o ON o.id = ao.orden_id
         LEFT JOIN agro_clientes c
           ON c.activo = 1
          AND (c.codigo_concatenado = o.distribuidor_nombre OR c.nombre = o.distribuidor_nombre)
         WHERE ao.asignacion_id = ?`,
        [a.id],
        (err2, ordenes) => {
          a.ordenes = ordenes || [];
          pendientes--;
          if (pendientes === 0) {
            // Marcar todas como EXPORTADA con observacion 'Sin Novedad' por defecto
            const ids = asignaciones.map(x => x.id);
            const placeholders = ids.map(() => "?").join(",");
            const ahora = new Date().toISOString();
            db.run(
              "UPDATE agro_asignaciones SET estado='EXPORTADA', fecha_exportacion=?, observacion_servicio=COALESCE(observacion_servicio,'Sin Novedad') WHERE id IN (" + placeholders + ")",
              [ahora, ...ids],
              () => {
                // Inicializar observacion_servicio = 'Sin Novedad' en las órdenes exportadas (si no la tienen)
                db.run(
                  "UPDATE agro_ordenes SET observacion_servicio = COALESCE(observacion_servicio,'Sin Novedad') WHERE id IN (SELECT orden_id FROM agro_asignacion_ordenes WHERE asignacion_id IN (" + placeholders + "))",
                  ids,
                  () => generarExcel(asignaciones, res)
                );
              }
            );
          }
        }
      );
    });
  });
});

// Historial de despachos a nivel de FACTURA (una fila por orden exportada)
router.get("/asignaciones/historial", (req, res) => {
  const { desde, hasta } = req.query;
  let q = `
    SELECT
      o.id AS orden_id,
      o.numero_orden,
      o.distribuidor_nombre,
      o.total,
      COALESCE(o.observacion_servicio, 'Sin Novedad') AS observacion_servicio,
      COALESCE(o.novedades, '') AS novedades,
      COALESCE(o.responsabilidades, '') AS responsabilidades,
      COALESCE(o.detalles, '') AS detalles,
      a.id AS asignacion_id,
      a.vehiculo_placa,
      a.vehiculo_conductor,
      COALESCE(a.fecha_exportacion, a.fecha) AS fecha_exportacion
    FROM agro_asignaciones a
    INNER JOIN agro_asignacion_ordenes ao ON ao.asignacion_id = a.id
    INNER JOIN agro_ordenes o ON o.id = ao.orden_id
    WHERE a.estado = 'EXPORTADA'
  `;
  const params = [];
  if (desde) { q += " AND COALESCE(a.fecha_exportacion, a.fecha) >= ?"; params.push(desde + "T00:00:00"); }
  if (hasta) { q += " AND COALESCE(a.fecha_exportacion, a.fecha) <= ?"; params.push(hasta + "T23:59:59.999"); }
  q += " ORDER BY COALESCE(a.fecha_exportacion, a.fecha) DESC, o.numero_orden";
  db.all(q, params, (err, rows) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    res.json(rows || []);
  });
});

// Historial de exportaciones AGRUPADO (un registro por lote/exportación)
// Cada lote = todas las asignaciones que comparten la misma fecha_exportacion
router.get("/asignaciones/historial-grupos", (req, res) => {
  const { desde, hasta } = req.query;
  let q = `
    SELECT
      COALESCE(a.fecha_exportacion, a.fecha) AS fecha_exportacion,
      COUNT(DISTINCT a.id) AS total_asignaciones,
      COUNT(DISTINCT ao.orden_id) AS total_ordenes,
      COALESCE(SUM(o.total), 0) AS total_kilos,
      string_agg(DISTINCT a.vehiculo_placa, ', ') AS placas
    FROM agro_asignaciones a
    LEFT JOIN agro_asignacion_ordenes ao ON ao.asignacion_id = a.id
    LEFT JOIN agro_ordenes o ON o.id = ao.orden_id
    WHERE a.estado = 'EXPORTADA'
  `;
  const params = [];
  if (desde) { q += " AND COALESCE(a.fecha_exportacion, a.fecha) >= ?"; params.push(desde + "T00:00:00"); }
  if (hasta) { q += " AND COALESCE(a.fecha_exportacion, a.fecha) <= ?"; params.push(hasta + "T23:59:59.999"); }
  q += " GROUP BY COALESCE(a.fecha_exportacion, a.fecha) ORDER BY COALESCE(a.fecha_exportacion, a.fecha) DESC";
  db.all(q, params, (err, rows) => {
    if (err) {
      console.error("[historial-grupos]", err.message);
      // Fallback: agrupar manualmente si string_agg no está disponible
      return db.all(
        `SELECT a.id, a.vehiculo_placa, COALESCE(a.fecha_exportacion, a.fecha) AS fecha_exportacion
         FROM agro_asignaciones a WHERE a.estado = 'EXPORTADA'
         ORDER BY COALESCE(a.fecha_exportacion, a.fecha) DESC`,
        [],
        (e2, asigs) => {
          if (e2) return res.status(500).json({ error: "Error del servidor: " + e2.message });
          const map = new Map();
          (asigs || []).forEach(a => {
            const k = a.fecha_exportacion;
            if (!map.has(k)) map.set(k, { fecha_exportacion: k, placas: new Set(), total_asignaciones: 0 });
            const g = map.get(k);
            g.placas.add(a.vehiculo_placa);
            g.total_asignaciones++;
          });
          const result = Array.from(map.values()).map(g => ({
            fecha_exportacion: g.fecha_exportacion,
            total_asignaciones: g.total_asignaciones,
            total_ordenes: 0,
            total_kilos: 0,
            placas: Array.from(g.placas).join(", ")
          }));
          res.json(result);
        }
      );
    }
    res.json(rows || []);
  });
});

// Reimprimir / re-exportar Excel de un lote del historial por fecha_exportacion
router.get("/asignaciones/historial/exportar-excel", (req, res) => {
  const { fecha_exportacion } = req.query;
  if (!fecha_exportacion) return res.status(400).json({ error: "fecha_exportacion es requerida" });

  db.all(
    "SELECT * FROM agro_asignaciones WHERE estado = 'EXPORTADA' AND COALESCE(fecha_exportacion, fecha) = ? ORDER BY fecha DESC",
    [fecha_exportacion],
    (err, asignaciones) => {
      if (err) return res.status(500).json({ error: "Error del servidor: " + err.message });
      if (!asignaciones || !asignaciones.length) {
        return res.status(404).json({ error: "No se encontró el lote exportado" });
      }
      let pendientes = asignaciones.length;
      asignaciones.forEach(a => {
        db.all(
          `SELECT ao.orden_id, o.numero_orden,
                  COALESCE(c.nombre, o.distribuidor_nombre) AS distribuidor_nombre,
                  o.total
           FROM agro_asignacion_ordenes ao
           LEFT JOIN agro_ordenes o ON o.id = ao.orden_id
           LEFT JOIN agro_clientes c
             ON c.activo = 1
            AND (c.codigo_concatenado = o.distribuidor_nombre OR c.nombre = o.distribuidor_nombre)
           WHERE ao.asignacion_id = ?`,
          [a.id],
          (err2, ordenes) => {
            a.ordenes = ordenes || [];
            pendientes--;
            if (pendientes === 0) generarExcel(asignaciones, res);
          }
        );
      });
    }
  );
});

// Actualizar observacion_servicio de una asignacion (legacy, por placa)
router.put("/asignaciones/:id/observacion", (req, res) => {
  const { id } = req.params;
  const { observacion } = req.body || {};
  const obs = (observacion || "Sin Novedad").toString().trim() || "Sin Novedad";
  db.run("UPDATE agro_asignaciones SET observacion_servicio = ? WHERE id = ?", [obs, id], function (err) {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (this.changes === 0) return res.status(404).json({ error: "Asignación no encontrada" });
    res.json({ message: "Observación actualizada", observacion: obs });
  });
});

// Asignar/actualizar Auxiliar de Ruta de una asignación
router.put("/asignaciones/:id/auxiliar", (req, res) => {
  const { id } = req.params;
  const { auxiliar } = req.body || {};
  const aux = (auxiliar || "").toString().trim();
  db.run("UPDATE agro_asignaciones SET auxiliar = ? WHERE id = ?", [aux, id], function (err) {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (this.changes === 0) return res.status(404).json({ error: "Asignación no encontrada" });
    res.json({ message: "Auxiliar actualizado", auxiliar: aux });
  });
});

// Actualizar observacion_servicio de una ORDEN (factura)
router.put("/ordenes/:id/observacion", (req, res) => {
  const { id } = req.params;
  const { observacion } = req.body || {};
  const obs = (observacion || "Sin Novedad").toString().trim() || "Sin Novedad";
  db.run("UPDATE agro_ordenes SET observacion_servicio = ? WHERE id = ?", [obs, id], function (err) {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (this.changes === 0) return res.status(404).json({ error: "Orden no encontrada" });
    res.json({ message: "Observación actualizada", observacion: obs });
  });
});

// Actualizar campos del historial (novedades / responsabilidades) de una ORDEN
router.put("/ordenes/:id/historial", (req, res) => {
  const { id } = req.params;
  const { novedades, responsabilidades, detalles } = req.body || {};
  const sets = [];
  const params = [];
  if (novedades !== undefined) { sets.push("novedades = ?"); params.push((novedades || "").toString()); }
  if (responsabilidades !== undefined) { sets.push("responsabilidades = ?"); params.push((responsabilidades || "").toString()); }
  if (detalles !== undefined) { sets.push("detalles = ?"); params.push((detalles || "").toString()); }
  if (!sets.length) return res.status(400).json({ error: "Nada que actualizar" });
  params.push(id);
  db.run("UPDATE agro_ordenes SET " + sets.join(", ") + " WHERE id = ?", params, function (err) {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (this.changes === 0) return res.status(404).json({ error: "Orden no encontrada" });
    res.json({ message: "Actualizado" });
  });
});

function generarExcel(asignaciones, res) {
  // Recoger todos los distribuidor_nombre para buscar datos del cliente
  const clienteNombres = new Set();
  asignaciones.forEach(a => {
    (a.ordenes || []).forEach(o => {
      if (o.distribuidor_nombre) clienteNombres.add(o.distribuidor_nombre);
    });
  });

  const nombres = Array.from(clienteNombres);
  if (!nombres.length) {
    return enviarExcel(asignaciones, {}, res);
  }

  const placeholders = nombres.map(() => "?").join(",");
  const allPlaceholders = [...nombres, ...nombres];
  db.all(
    "SELECT * FROM agro_clientes WHERE (nombre IN (" + placeholders + ") OR codigo_concatenado IN (" + placeholders + ")) AND activo = 1",
    allPlaceholders,
    (err, clientes) => {
      const clienteMap = {};
      (clientes || []).forEach(c => {
        clienteMap[c.nombre] = c;
        if (c.codigo_concatenado) clienteMap[c.codigo_concatenado] = c;
      });
      enviarExcel(asignaciones, clienteMap, res);
    }
  );
}

function enviarExcel(asignaciones, clienteMap, res) {
  // Encabezados del formato Free Order
  const headers = [
    "Factura", "Kilos", "Unidades_2", "Unidades_3", "Prioridad",
    "Código de Dirección*", "Nombre Dirección", "Nombre Cliente", "Tipo",
    "Dirección 1*", "Referencias", "Descripción", "Comuna", "Provincia",
    "Región", "País*", "Código Postal", "Latitud", "Longitud",
    "Tiempo de Servicio", "Inicio Ventana 1", "Fin Ventana 1",
    "Características", "Asignación Vehículo", "Telefono de Contacto",
    "Email de Contacto", "Unidades del Artículo", "Código del Artículo",
    "Descripción del Artículo", "Exclusividad", "Posicion", "Proveedor",
    "Inicio ventana 2", "Fin Ventana 2", "Código Cliente", "Nombre de Contacto",
    "Código Alternativo", "Mail aprobar ruta", "Mail iniciar ruta",
    "Mail en camino a direccion", "Mail entrega finalizada", "Código de ruta",
    "Número de viaje", "Tipo Unidad", "Texto 1", "Texto 2", "valor",
    "Texto 4", "Texto 5", "Texto 6", "Texto 7", "Texto 8", "Texto 9",
    "Texto 10", "Texto 11", "Número 1", "Número 2", "Número 3", "Número 4",
    "Correo Conductor", "Costo Asignación", "Fecha Maxima de Entrega"
  ];

  const rows = [headers];

  asignaciones.forEach(a => {
    (a.ordenes || []).forEach(o => {
      const cli = clienteMap[o.distribuidor_nombre] || {};
      rows.push([
        o.numero_orden || "",                           // Factura
        o.total || 0,                                   // Kilos
        "",                                             // Unidades_2
        "",                                             // Unidades_3
        "",                                             // Prioridad
        cli.codigo || "",                               // Código de Dirección
        cli.nombre || o.distribuidor_nombre || "",       // Nombre Dirección
        cli.nombre || o.distribuidor_nombre || "",       // Nombre Cliente
        "",                                             // Tipo
        cli.direccion || "",                             // Dirección 1
        "",                                             // Referencias
        "",                                             // Descripción
        cli.barrio || "",                               // Comuna
        cli.ciudad || "",                               // Provincia
        cli.departamento || "",                          // Región
        "Colombia",                                     // País
        "",                                             // Código Postal
        "",                                             // Latitud
        "",                                             // Longitud
        "",                                             // Tiempo de Servicio
        "",                                             // Inicio Ventana 1
        "",                                             // Fin Ventana 1
        "",                                             // Características
        a.vehiculo_placa || "",                          // Asignación Vehículo
        cli.telefono || "",                              // Telefono de Contacto
        cli.email || "",                                 // Z  Email de Contacto
        "",                                              // AA Unidades del Artículo
        "",                                              // AB Código del Artículo
        "",                                              // AC Descripción del Artículo
        "",                                              // AD Exclusividad
        "",                                              // AE Posicion
        "",                                              // AF Proveedor
        "",                                              // AG Inicio ventana 2
        "",                                              // AH Fin Ventana 2
        "",                                              // AI Código Cliente
        "",                                              // AJ Nombre de Contacto
        cli.codigo_concatenado || "",                    // AK Código Alternativo
        "",                                              // AL Mail aprobar ruta
        "",                                              // AM Mail iniciar ruta
        "",                                              // AN Mail en camino a direccion
        "",                                              // AO Mail entrega finalizada
        "",                                              // AP Código de ruta
        "",                                              // AQ Número de viaje
        "",                                              // AR Tipo Unidad
        "",                                              // AS Texto 1
        "",                                              // AT Texto 2
        "",                                              // AU valor
        "",                                              // AV Texto 4
        "",                                              // AW Texto 5
        "",                                              // AX Texto 6
        "",                                              // AY Texto 7
        "",                                              // AZ Texto 8
        "",                                              // BA Texto 9
        "",                                              // BB Texto 10
        "",                                              // BC Texto 11
        "",                                              // BD Número 1
        "",                                              // BE Número 2
        "",                                              // BF Número 3
        "",                                              // BG Número 4
        "",                                              // BH Correo Conductor
        "",                                              // BI Costo Asignación
        ""                                               // BJ Fecha Maxima de Entrega
      ]);
    });
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Carga Ordenes");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=Free_Order_Agropecuaria.xlsx");
  res.send(buffer);
}

// Consecutivo global de plantilla D.L — llave primaria única en agro_plantillas_dl
router.post("/plantillas/next-consecutivo", (req, res) => {
  const {
    placa = "", conductor = "", auxiliar = "", fecha_despacho = "", origen = "",
    hora_salida = "", ruta = "", total_documentos = 0, total_kilos = 0, ordenes = [],
    kms_recorridos = "", tiempo_recorrido = "", municipios_recorre = "", fecha_hora_llegada = ""
  } = req.body || {};

  const sql = `
    INSERT INTO agro_plantillas_dl
      (placa, conductor, auxiliar, fecha_despacho, origen, hora_salida, ruta, total_documentos, total_kilos, ordenes_json,
       kms_recorridos, tiempo_recorrido, municipios_recorre, fecha_hora_llegada)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(sql, [
    placa, conductor, auxiliar, fecha_despacho, origen, hora_salida, ruta,
    total_documentos, total_kilos, JSON.stringify(ordenes),
    String(kms_recorridos || ""), String(tiempo_recorrido || ""),
    String(municipios_recorre || ""), String(fecha_hora_llegada || "")
  ], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    const valor = this.lastID;
    res.json({ consecutivo: String(valor).padStart(5, "0"), valor });
  });
});

// Historial de plantillas D.L (con filtros opcionales)
router.get("/plantillas", (req, res) => {
  const { desde, hasta, placa } = req.query;
  const where = [];
  const params = [];
  if (desde) { where.push("date(created_at) >= date(?)"); params.push(desde); }
  if (hasta) { where.push("date(created_at) <= date(?)"); params.push(hasta); }
  if (placa) { where.push("UPPER(placa) LIKE UPPER(?)"); params.push("%" + placa + "%"); }
  const sql = `
    SELECT consecutivo, placa, conductor, COALESCE(auxiliar,'') AS auxiliar, fecha_despacho, origen, hora_salida, ruta,
           total_documentos, total_kilos, ordenes_json, created_at
    FROM agro_plantillas_dl
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY consecutivo DESC
    LIMIT 500
  `;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Detalle de una plantilla (para reimprimir)
router.get("/plantillas/:consecutivo", (req, res) => {
  db.get(`SELECT * FROM agro_plantillas_dl WHERE consecutivo = ?`, [req.params.consecutivo], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Plantilla no encontrada" });
    try { row.ordenes = JSON.parse(row.ordenes_json || "[]"); } catch { row.ordenes = []; }
    res.json(row);
  });
});

module.exports = router;
