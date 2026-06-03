const express = require("express");
const router = express.Router();
const db = require("../db");
const multer = require("multer");
const XLSX = require("xlsx");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/* ============ PUNTOS DE VENTA ============ */

// Listar puntos de venta
router.get("/puntos-venta", (req, res) => {
  const todos = req.query.todos === "1";
  let query = "SELECT * FROM puntos_venta";
  if (!todos) query += " WHERE activo = 1";
  query += " ORDER BY indicador";

  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    res.json(rows || []);
  });
});

// Crear punto de venta
router.post("/puntos-venta", (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: "El nombre es requerido" });

  // Obtener el siguiente indicador disponible
  db.get("SELECT COALESCE(MAX(indicador), 0) + 1 as siguiente FROM puntos_venta", [], (err, row) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    const indicador = row.siguiente;

    db.run("INSERT INTO puntos_venta (indicador, nombre) VALUES (?, ?)", [indicador, nombre.trim()], function (err) {
      if (err) return res.status(500).json({ error: "Error al crear punto de venta" });
      res.json({ message: "Punto de venta creado", id: this.lastID, indicador });
    });
  });
});

// Editar punto de venta
router.put("/puntos-venta/:id", (req, res) => {
  const { id } = req.params;
  const { nombre, activo } = req.body;

  db.get("SELECT * FROM puntos_venta WHERE id = ?", [id], (err, pdv) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!pdv) return res.status(404).json({ error: "Punto de venta no encontrado" });

    db.run(
      "UPDATE puntos_venta SET nombre = ?, activo = ? WHERE id = ?",
      [nombre || pdv.nombre, activo !== undefined ? (activo ? 1 : 0) : pdv.activo, id],
      function (err) {
        if (err) return res.status(500).json({ error: "Error al actualizar" });
        res.json({ message: "Punto de venta actualizado" });
      }
    );
  });
});

// Desactivar punto de venta
router.delete("/puntos-venta/:id", (req, res) => {
  const { id } = req.params;
  db.run("UPDATE puntos_venta SET activo = 0 WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: "Error al desactivar" });
    res.json({ message: "Punto de venta desactivado" });
  });
});

/* ============ PRODUCTOS ============ */

// Listar productos activos
router.get("/productos", (req, res) => {
  const mostrarTodos = req.query.todos === "1";
  const { buscar } = req.query;
  let query = "SELECT * FROM productos";
  const params = [];

  if (mostrarTodos !== true && req.query.todos !== "1") {
    query += " WHERE activo = 1";
  }

  if (buscar) {
    const prefix = req.query.todos !== "1" ? " AND" : " WHERE";
    query += prefix + " (nombre LIKE ? OR referencia LIKE ? OR descripcion LIKE ?)";
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
  const { referencia, nombre, descripcion, precio, unidad_medida } = req.body;
  if (!nombre || precio == null) return res.status(400).json({ error: "Nombre y precio son requeridos" });

  db.run(
    "INSERT INTO productos (referencia, nombre, descripcion, precio, unidad_medida) VALUES (?, ?, ?, ?, ?)",
    [referencia || "", nombre.trim(), descripcion || "", parseFloat(precio), unidad_medida || "UNIDAD"],
    function (err) {
      if (err) return res.status(500).json({ error: "Error al crear producto" });
      res.json({ message: "Producto creado", id: this.lastID });
    }
  );
});

// Editar producto
router.put("/productos/:id", (req, res) => {
  const { id } = req.params;
  const { referencia, nombre, descripcion, precio, unidad_medida, activo } = req.body;

  db.get("SELECT * FROM productos WHERE id = ?", [id], (err, prod) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!prod) return res.status(404).json({ error: "Producto no encontrado" });

    db.run(
      "UPDATE productos SET referencia = ?, nombre = ?, descripcion = ?, precio = ?, unidad_medida = ?, activo = ? WHERE id = ?",
      [
        referencia !== undefined ? referencia : prod.referencia,
        nombre || prod.nombre,
        descripcion !== undefined ? descripcion : prod.descripcion,
        precio != null ? parseFloat(precio) : prod.precio,
        unidad_medida !== undefined ? unidad_medida : prod.unidad_medida,
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

// Eliminar producto (desactivar)
router.delete("/productos/:id", (req, res) => {
  const { id } = req.params;
  db.run("UPDATE productos SET activo = 0 WHERE id = ?", [id], function (err) {
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
      const nombre = getVal(fila, "desc item", "desc_item", "descripcion item", "nombre", "producto", "item", "descripcion");
      const precioRaw = getVal(fila, "precio unit", "precio_unit", "precio unitario", "precio", "valor", "precio_unitario");
      const precio = parseFloat(String(precioRaw).replace(/[,$\s]/g, "")) || 0;
      const unidad_medida = getVal(fila, "um invent", "um_invent", "u m invent", "unidad_medida", "unidad", "um", "medida").toUpperCase() || "UNIDAD";

      if (!nombre || !precio) {
        errores.push("Fila " + (i + 2) + ": sin nombre o precio");
        pendientes--;
        if (pendientes === 0) enviarRespuesta();
        return;
      }

      // Si tiene referencia, verificar si ya existe para actualizar
      if (referencia) {
        db.get("SELECT id FROM productos WHERE referencia = ?", [referencia], (err, existe) => {
          if (existe) {
            db.run(
              "UPDATE productos SET nombre = ?, precio = ?, unidad_medida = ?, activo = 1 WHERE id = ?",
              [nombre, precio, unidad_medida, existe.id],
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
          "INSERT INTO productos (referencia, nombre, descripcion, precio, unidad_medida) VALUES (?, ?, ?, ?, ?)",
          [referencia, nombre, "", precio, unidad_medida],
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

/* ============ PEDIDOS ============ */

// Listar pedidos con filtros opcionales
router.get("/pedidos", (req, res) => {
  const { estado, desde, hasta, pdv } = req.query;

  let query = "SELECT * FROM pedidos WHERE 1=1";
  const params = [];

  if (pdv && pdv !== "TODOS") {
    query += " AND punto_venta_id = ?";
    params.push(parseInt(pdv));
  }
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
    if (err) return res.status(500).json({ error: "Error del servidor" });
    res.json(rows || []);
  });
});

// Siguiente n\u00famero de pedido (preview para el formulario)
router.get("/pedidos-next-numero", (req, res) => {
  db.get(
    "SELECT COALESCE(MAX(CAST(SUBSTR(numero_pedido, 6) AS INTEGER)), 0) as ultimo FROM pedidos WHERE numero_pedido LIKE 'OSRun%'",
    [],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Error del servidor" });
      const consecutivo = (row && row.ultimo ? row.ultimo : 0) + 1;
      res.json({ numero_pedido: "OSRun" + String(consecutivo).padStart(5, "0") });
    }
  );
});

// Obtener un pedido con sus items
router.get("/pedidos/:id", (req, res) => {
  const { id } = req.params;

  db.get("SELECT * FROM pedidos WHERE id = ?", [id], (err, pedido) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });

    db.all("SELECT * FROM pedido_items WHERE pedido_id = ?", [id], (err2, items) => {
      if (err2) return res.status(500).json({ error: "Error del servidor" });
      res.json({ ...pedido, items: items || [] });
    });
  });
});

// Crear pedido con items
router.post("/pedidos", (req, res) => {
  const { cliente_nombre, cliente_cedula, kilos, estado, punto_venta_id: pdvBody } = req.body;

  if (!cliente_nombre) return res.status(400).json({ error: "El nombre del cliente es requerido" });

  // Buscar el cliente por cédula para obtener su punto de venta
  const buscarPDV = (callback) => {
    if (pdvBody) {
      db.get("SELECT * FROM puntos_venta WHERE id = ?", [parseInt(pdvBody)], (e, p) => callback(p || null));
      return;
    }
    if (!cliente_cedula) return callback(null);
    db.get("SELECT punto_venta FROM clientes WHERE cedula = ?", [cliente_cedula.trim()], (err, cli) => {
      if (err || !cli || !cli.punto_venta) return callback(null);
      db.get("SELECT * FROM puntos_venta WHERE nombre LIKE ? AND activo = 1", ["%" + cli.punto_venta.trim() + "%"], (err2, pdv) => {
        if (err2 || !pdv) return callback(null);
        callback(pdv);
      });
    });
  };

  buscarPDV((pdv) => {
    const punto_venta_id = pdv ? pdv.id : null;

    db.get(
      "SELECT COALESCE(MAX(CAST(SUBSTR(numero_pedido, 6) AS INTEGER)), 0) as ultimo FROM pedidos WHERE numero_pedido LIKE 'OSRun%'",
      [],
      (err, row) => {
        if (err) return res.status(500).json({ error: "Error del servidor" });
        const consecutivo = (row.ultimo || 0) + 1;
        const numero_pedido = "OSRun" + String(consecutivo).padStart(5, "0");

        const fecha = new Date().toISOString();
        const estadoFinal = estado || "PENDIENTE";
        const kilosFinal = parseFloat(kilos) || 0;

        db.run(
          "INSERT INTO pedidos (cliente_nombre, cliente_cedula, fecha, estado, total, kilos, observaciones, punto_venta_id, numero_pedido) VALUES (?, ?, ?, ?, 0, ?, '', ?, ?)",
          [cliente_nombre.trim(), cliente_cedula || "", fecha, estadoFinal, kilosFinal, punto_venta_id, numero_pedido],
          function (err) {
            if (err) return res.status(500).json({ error: "Error al crear pedido" });
            res.json({ message: "Pedido creado", id: this.lastID, numero_pedido, kilos: kilosFinal });
          }
        );
      }
    );
  });
});

// Actualizar estado del pedido
router.put("/pedidos/:id/estado", (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  const estadosValidos = ["PENDIENTE", "EN_PROCESO", "ENTREGADO", "CANCELADO"];

  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: "Estado no válido. Use: " + estadosValidos.join(", ") });
  }

  db.run("UPDATE pedidos SET estado = ? WHERE id = ?", [estado, id], function (err) {
    if (err) return res.status(500).json({ error: "Error al actualizar estado" });
    if (this.changes === 0) return res.status(404).json({ error: "Pedido no encontrado" });
    res.json({ message: "Estado actualizado a " + estado });
  });
});

// Editar pedido completo (datos del destino + kilos + estado + PDV)
router.put("/pedidos/:id/completo", (req, res) => {
  const { id } = req.params;
  const { cliente_nombre, cliente_cedula, kilos, estado, punto_venta_id } = req.body;

  db.get("SELECT * FROM pedidos WHERE id = ?", [id], (err, pedido) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });

    db.run(
      "UPDATE pedidos SET cliente_nombre = ?, cliente_cedula = ?, kilos = ?, estado = ?, punto_venta_id = ? WHERE id = ?",
      [
        cliente_nombre || pedido.cliente_nombre,
        cliente_cedula !== undefined ? cliente_cedula : pedido.cliente_cedula,
        kilos !== undefined ? parseFloat(kilos) || 0 : pedido.kilos,
        estado || pedido.estado,
        punto_venta_id !== undefined ? (punto_venta_id ? parseInt(punto_venta_id) : null) : pedido.punto_venta_id,
        id,
      ],
      function (err) {
        if (err) return res.status(500).json({ error: "Error al actualizar pedido" });
        res.json({ message: "Pedido actualizado", id: parseInt(id) });
      }
    );
  });
});

// Editar pedido (datos generales)
router.put("/pedidos/:id", (req, res) => {
  const { id } = req.params;
  const { cliente_nombre, cliente_cedula, observaciones } = req.body;

  db.get("SELECT * FROM pedidos WHERE id = ?", [id], (err, pedido) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });

    db.run(
      "UPDATE pedidos SET cliente_nombre = ?, cliente_cedula = ?, observaciones = ? WHERE id = ?",
      [
        cliente_nombre || pedido.cliente_nombre,
        cliente_cedula !== undefined ? cliente_cedula : pedido.cliente_cedula,
        observaciones !== undefined ? observaciones : pedido.observaciones,
        id,
      ],
      function (err) {
        if (err) return res.status(500).json({ error: "Error al actualizar pedido" });
        res.json({ message: "Pedido actualizado" });
      }
    );
  });
});

// Eliminar pedido
router.delete("/pedidos/:id", (req, res) => {
  const { id } = req.params;

  db.get("SELECT * FROM pedidos WHERE id = ?", [id], (err, pedido) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });

    db.run("DELETE FROM pedido_items WHERE pedido_id = ?", [id], (err2) => {
      if (err2) return res.status(500).json({ error: "Error al eliminar items" });

      db.run("DELETE FROM pedidos WHERE id = ?", [id], function (err3) {
        if (err3) return res.status(500).json({ error: "Error al eliminar pedido" });
        res.json({ message: "Pedido eliminado" });
      });
    });
  });
});

// Borrar TODOS los pedidos (requiere contraseña de admin)
router.post("/pedidos/borrar-todos", (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "La contraseña es requerida" });

  db.get("SELECT * FROM usuarios WHERE rol = 'administrador' AND password = ?", [password], (err, user) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!user) return res.status(401).json({ error: "Contraseña de administrador incorrecta" });

    db.run("DELETE FROM pedido_items", [], (err2) => {
      if (err2) return res.status(500).json({ error: "Error al eliminar items" });
      db.run("DELETE FROM pedidos", [], function (err3) {
        if (err3) return res.status(500).json({ error: "Error al eliminar pedidos" });
        const eliminados = this.changes;
        db.run("DELETE FROM sqlite_sequence WHERE name IN ('pedidos','pedido_items')", [], () => {
          res.json({ message: "Todos los pedidos han sido eliminados", eliminados });
        });
      });
    });
  });
});

// Exportar pedidos al formato Free_Order (SimpliRoute-like)
router.post("/pedidos/export-free-order", (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Debe indicar al menos un pedido" });
  }
  const placeholders = ids.map(() => "?").join(",");
  const sql = `
    SELECT p.*, c.nombre AS c_nombre, c.cedula AS c_cedula, c.direccion AS c_direccion,
           c.referencia AS c_referencia, c.barrio AS c_barrio, c.ciudad AS c_ciudad, c.region AS c_region,
           c.telefono AS c_telefono, c.email AS c_email,
           pv.nombre AS pdv_nombre
    FROM pedidos p
    LEFT JOIN clientes c ON c.cedula = p.cliente_cedula
    LEFT JOIN puntos_venta pv ON pv.id = p.punto_venta_id
    WHERE p.id IN (${placeholders})
    ORDER BY p.id ASC
  `;
  db.all(sql, ids, (err, rows) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!rows || rows.length === 0) return res.status(404).json({ error: "Pedidos no encontrados" });

    const headers = [
      "Fecha Maxima de Entrega","Nombre Plan","Esquema","Código de despacho*","Unidades_1*","Unidades_2","Unidades_3","Prioridad",
      "Código de dirección*","Nombre dirección","Nombre cliente","Tipo","Dirección 1*","Referencias","Descripción","Comuna*","Provincia","Región","País*",
      "Código Postal","Latitud","Longitud","Tiempo de servicio","Inicio Ventana 1","Fin Ventana 1","Características","Asignación vehículo",
      "Telefono de Contacto","Email de Contacto","Unidades del artículo","Código del artículo","Descripción del artículo","Exclusividad","Posicion","Proveedor",
      "Inicio ventana 2","Fin ventana 2","Código cliente","Nombre de contacto","Código Alternativo","Mail aprobar ruta","Mail iniciar ruta",
      "Mail en camino a direccion","Mail entrega finalizada","Código de ruta","Número de viaje","Tipo Unidad",
      "Texto 1","Texto 2","Texto 3","Texto 4","Texto 5","Texto 6","Texto 7","Texto 8","Texto 9","Texto 10","Texto 11",
      "Número 1","Número 2","Número 3","Número 4","Correo Conductor","Costo Asignación","Columna dummy","Fecha Facturación","Ruta Maestra",
      "Descripción Despacho","Telefono contacto ruta aprobada","Telefono contacto ruta iniciada","Telefono contacto cerca del lugar","Telefono contacto entrega",
      "Código zona de ventas","Unidades requeridas por item","Tag de Busqueda","Fecha de proceso","Folio","Orden de compra",
      "Nombre 2do Contacto","Teléfono 2do Contacto","Email 2do Contacto","Categoría","url","token","url con token","Unidades_4","Tipo de orden",
      "Paquete de datos","Código proveedor",
      "Texto 12","Texto 13","Texto 14","Texto 15","Texto 16","Texto 17","Texto 18","Texto 19","Texto 20","Código Empleador","Prioridad de Secuencia"
    ];

    // Construir aoa (array of arrays)
    const pad2 = (n) => String(n).padStart(2, "0");
    const fmtFechaDDMMYYYY = (d) => pad2(d.getDate()) + "-" + pad2(d.getMonth() + 1) + "-" + d.getFullYear();
    // Hora en formato 24h con cero a la izquierda: 11:41, 13:41
    const fmtHora24 = (d) => pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    const aoa = [headers];
    for (const r of rows) {
      const fecha = r.fecha ? new Date(r.fecha) : new Date();
      const fechaStr = fmtFechaDDMMYYYY(fecha);
      const horaInicio = fmtHora24(fecha);
      const horaFin = "23:59";
      const nombre = r.c_nombre || r.cliente_nombre || "";
      const direccion = r.c_direccion || "";
      const barrio = r.c_barrio || "";
      const ciudad = r.c_ciudad || "";
      const region = r.c_region || "";
      const codigoCliente = r.cliente_cedula || r.c_cedula || "";
      const pdv = r.pdv_nombre ? ("PDV " + r.pdv_nombre).replace(/^PDV PDV /, "PDV ") : "";
      const referencias = (nombre || "") + (r.c_referencia ? " / " + r.c_referencia : " / ");

      const row = new Array(headers.length).fill("");
      row[0] = fechaStr;                                   // A Fecha Maxima de Entrega (dd-mm-yyyy)
      row[3] = "OS" + (r.numero_pedido || "").replace(/^OS/i, ""); // D Código de despacho
      row[4] = r.kilos || 1;                               // E Unidades_1
      row[5] = 0;                                          // F Unidades_2
      row[6] = 0;                                          // G Unidades_3
      row[7] = 5;                                          // H Prioridad
      row[8] = codigoCliente;                              // I Código de dirección
      row[9] = nombre;                                     // J Nombre dirección
      row[10] = nombre;                                    // K Nombre cliente
      row[12] = direccion;                                 // M Dirección 1
      row[13] = referencias;                               // N Referencias
      row[15] = barrio;                                    // P Comuna
      row[16] = ciudad;                                    // Q Provincia
      row[17] = region;                                    // R Región
      row[18] = "Colombia";                                // S País
      row[22] = 10;                                        // W Tiempo de servicio
      row[23] = horaInicio;                                // X Inicio Ventana 1 (hora de creación)
      row[24] = horaFin;                                   // Y Fin Ventana 1 (+2h)
      row[27] = r.c_telefono || "";                        // AB Telefono
      row[28] = r.c_email || "";                           // AC Email
      row[34] = pdv;                                       // AI Proveedor (PDV ORIGEN)
      row[37] = codigoCliente;                             // AL Código cliente
      row[38] = nombre;                                    // AM Nombre de contacto
      aoa.push(row);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Forzar columna A como texto para preservar el formato dd-mm-yyyy con ceros
    // y columnas X (Inicio) e Y (Fin) como texto para preservar HH:MM
    for (let i = 1; i < aoa.length; i++) {
      const cellA = XLSX.utils.encode_cell({ r: i, c: 0 });
      if (ws[cellA]) { ws[cellA].t = "s"; ws[cellA].z = "@"; }
      const cellX = XLSX.utils.encode_cell({ r: i, c: 23 });
      if (ws[cellX]) { ws[cellX].t = "s"; ws[cellX].z = "@"; }
      const cellY = XLSX.utils.encode_cell({ r: i, c: 24 });
      if (ws[cellY]) { ws[cellY].t = "s"; ws[cellY].z = "@"; }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Free_Order");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Free_Order.xlsx"');
    res.send(buf);
  });
});

/* ============ CLIENTES ============ */

// Listar clientes
router.get("/clientes", (req, res) => {
  const { buscar, todos } = req.query;
  let query = "SELECT * FROM clientes";
  const params = [];

  if (todos !== "1") {
    query += " WHERE activo = 1";
  }

  if (buscar) {
    const prefix = todos !== "1" ? " AND" : " WHERE";
    query += prefix + " (nombre LIKE ? OR cedula LIKE ? OR telefono LIKE ? OR barrio LIKE ?)";
    const term = "%" + buscar + "%";
    params.push(term, term, term, term);
  }

  query += " ORDER BY nombre";

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    res.json(rows || []);
  });
});

// Obtener un cliente
router.get("/clientes/:id", (req, res) => {
  db.get("SELECT * FROM clientes WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!row) return res.status(404).json({ error: "Cliente no encontrado" });
    res.json(row);
  });
});

// Crear cliente
router.post("/clientes", (req, res) => {
  const { nombre, cedula, telefono, direccion, referencia, barrio, ciudad, region, punto_venta, email, observaciones } = req.body;
  if (!nombre) return res.status(400).json({ error: "El nombre es requerido" });
  if (!cedula || !cedula.trim()) return res.status(400).json({ error: "La cédula/NIT es requerida" });

  db.get("SELECT id FROM clientes WHERE cedula = ?", [cedula.trim()], (err, existe) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (existe) return res.status(400).json({ error: "Ya existe un cliente con esta cédula/NIT" });

    db.run(
      "INSERT INTO clientes (nombre, cedula, telefono, direccion, referencia, barrio, ciudad, region, punto_venta, email, observaciones, fecha_registro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [nombre.trim(), cedula.trim(), telefono || "", direccion || "", referencia || "", barrio || "", ciudad || "", region || "", punto_venta || "", email || "", observaciones || "", new Date().toISOString()],
      function (err) {
        if (err) return res.status(500).json({ error: "Error al crear cliente" });
        res.json({ message: "Cliente creado", id: this.lastID });
      }
    );
  });
});

// Editar cliente
router.put("/clientes/:id", (req, res) => {
  const { id } = req.params;
  const { nombre, cedula, telefono, direccion, referencia, barrio, ciudad, region, punto_venta, email, observaciones, activo } = req.body;

  db.get("SELECT * FROM clientes WHERE id = ?", [id], (err, cli) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });

    db.run(
      "UPDATE clientes SET nombre=?, cedula=?, telefono=?, direccion=?, referencia=?, barrio=?, ciudad=?, region=?, punto_venta=?, email=?, observaciones=?, activo=? WHERE id=?",
      [
        nombre || cli.nombre,
        cedula !== undefined ? cedula : cli.cedula,
        telefono !== undefined ? telefono : cli.telefono,
        direccion !== undefined ? direccion : cli.direccion,
        referencia !== undefined ? referencia : cli.referencia,
        barrio !== undefined ? barrio : cli.barrio,
        ciudad !== undefined ? ciudad : cli.ciudad,
        region !== undefined ? region : cli.region,
        punto_venta !== undefined ? punto_venta : cli.punto_venta,
        email !== undefined ? email : cli.email,
        observaciones !== undefined ? observaciones : cli.observaciones,
        activo !== undefined ? (activo ? 1 : 0) : cli.activo,
        id,
      ],
      function (err) {
        if (err) return res.status(500).json({ error: "Error al actualizar cliente" });

        // Auto-corregir pedidos OS0 de este cliente si ahora tiene PDV asignado
        const nuevoPV = punto_venta !== undefined ? punto_venta : cli.punto_venta;
        const cedulaCliente = cedula !== undefined ? cedula : cli.cedula;
        if (nuevoPV && cedulaCliente) {
          db.get("SELECT * FROM puntos_venta WHERE nombre LIKE ? AND activo = 1", ["%" + nuevoPV.trim() + "%"], (err2, pdv) => {
            if (!err2 && pdv) {
              // Buscar pedidos OS0 de este cliente
              db.all(
                "SELECT id FROM pedidos WHERE cliente_cedula = ? AND numero_pedido LIKE 'OS0-%'",
                [cedulaCliente.trim()],
                (err3, pedidos) => {
                  if (!err3 && pedidos && pedidos.length > 0) {
                    // Obtener el último consecutivo del PDV destino
                    db.get(
                      "SELECT COALESCE(MAX(CAST(SUBSTR(numero_pedido, INSTR(numero_pedido, '-') + 1) AS INTEGER)), 0) as ultimo FROM pedidos WHERE numero_pedido LIKE ?",
                      ["OS" + pdv.indicador + "-%"],
                      (err4, row) => {
                        let consecutivo = (row && row.ultimo || 0);
                        pedidos.forEach(p => {
                          consecutivo++;
                          const nuevoNumero = "OS" + pdv.indicador + "-" + String(consecutivo).padStart(5, "0");
                          db.run("UPDATE pedidos SET numero_pedido = ?, punto_venta_id = ? WHERE id = ?", [nuevoNumero, pdv.id, p.id]);
                        });
                      }
                    );
                  }
                }
              );
            }
          });
        }

        res.json({ message: "Cliente actualizado" });
      }
    );
  });
});

// Eliminar (desactivar) cliente
router.delete("/clientes/:id", (req, res) => {
  db.run("UPDATE clientes SET activo = 0 WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Error al desactivar cliente" });
    res.json({ message: "Cliente desactivado" });
  });
});

// Borrar TODOS los clientes (requiere contraseña de admin)
router.post("/clientes/borrar-todos", (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "La contraseña es requerida" });

  db.get("SELECT * FROM usuarios WHERE rol = 'administrador' AND password = ?", [password], (err, user) => {
    if (err) return res.status(500).json({ error: "Error del servidor" });
    if (!user) return res.status(401).json({ error: "Contraseña de administrador incorrecta" });

    db.run("DELETE FROM clientes", [], function (err2) {
      if (err2) return res.status(500).json({ error: "Error al eliminar clientes" });
      db.run("DELETE FROM sqlite_sequence WHERE name='clientes'", [], () => {
        res.json({ message: "Todos los clientes han sido eliminados", eliminados: this.changes });
      });
    });
  });
});

// Carga masiva de clientes desde Excel
router.post("/clientes/carga-masiva", upload.single("archivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const datos = XLSX.utils.sheet_to_json(sheet);

    if (!datos || datos.length === 0) return res.status(400).json({ error: "El archivo está vacío" });

    const fecha = new Date().toISOString();
    let insertados = 0;
    let actualizados = 0;
    let errores = [];

    // Normalizar nombre de columna
    function norm(key) {
      return key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    }

    function getVal(fila, ...keys) {
      for (const k of Object.keys(fila)) {
        const n = norm(k);
        if (keys.includes(n)) return String(fila[k] || "").trim();
      }
      return "";
    }

    let pendientes = datos.length;

    datos.forEach((fila, i) => {
      const nombre = getVal(fila, "nombre", "cliente", "razon social", "razon_social");
      const cedula = getVal(fila, "nit_cedula", "nit cedula", "cedula", "nit", "ci", "documento", "cc").replace(/\.0$/, "");
      const telefono = getVal(fila, "telefono", "celular", "tel", "movil", "whatsapp").replace(/\.0$/, "");
      const direccion = getVal(fila, "direccion", "dir");
      const referencia = getVal(fila, "referencia", "ref");
      const barrio = getVal(fila, "barrio", "sector", "zona");
      const ciudad = getVal(fila, "ciudad", "municipio");
      const region = getVal(fila, "region", "región", "departamento", "depto", "dpto", "estado", "provincia");
      const punto_venta = getVal(fila, "punto de venta", "punto_de_venta", "punto venta", "pdv");
      const email = getVal(fila, "email", "correo", "e-mail");
      const observaciones = getVal(fila, "observaciones", "obs", "nota", "notas");

      if (!nombre) {
        errores.push("Fila " + (i + 2) + ": sin nombre");
        pendientes--;
        if (pendientes === 0) enviarRespuesta();
        return;
      }

      // Si tiene cédula, verificar si ya existe
      if (cedula) {
        db.get("SELECT id FROM clientes WHERE cedula = ?", [cedula], (err, existe) => {
          if (existe) {
            db.run(
              "UPDATE clientes SET nombre=?, telefono=COALESCE(NULLIF(?,''),(SELECT telefono FROM clientes WHERE id=?)), direccion=COALESCE(NULLIF(?,''),(SELECT direccion FROM clientes WHERE id=?)), referencia=COALESCE(NULLIF(?,''),(SELECT referencia FROM clientes WHERE id=?)), barrio=COALESCE(NULLIF(?,''),(SELECT barrio FROM clientes WHERE id=?)), ciudad=COALESCE(NULLIF(?,''),(SELECT ciudad FROM clientes WHERE id=?)), region=COALESCE(NULLIF(?,''),(SELECT region FROM clientes WHERE id=?)), punto_venta=COALESCE(NULLIF(?,''),(SELECT punto_venta FROM clientes WHERE id=?)), email=COALESCE(NULLIF(?,''),(SELECT email FROM clientes WHERE id=?)), activo=1 WHERE id=?",
              [nombre, telefono, existe.id, direccion, existe.id, referencia, existe.id, barrio, existe.id, ciudad, existe.id, region, existe.id, punto_venta, existe.id, email, existe.id, existe.id],
              (err2) => {
                if (err2) errores.push("Fila " + (i + 2) + ": " + err2.message);
                else actualizados++;
                pendientes--;
                if (pendientes === 0) enviarRespuesta();
              }
            );
          } else {
            insertarCliente();
          }
        });
      } else {
        insertarCliente();
      }

      function insertarCliente() {
        db.run(
          "INSERT INTO clientes (nombre, cedula, telefono, direccion, referencia, barrio, ciudad, region, punto_venta, email, observaciones, fecha_registro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [nombre, cedula, telefono, direccion, referencia, barrio, ciudad, region, punto_venta, email, observaciones, fecha],
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

module.exports = router;
