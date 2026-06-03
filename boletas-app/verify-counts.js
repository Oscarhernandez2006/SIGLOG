require("dotenv").config();
const { Pool } = require("pg");
const p = new Pool({ connectionString: process.env.DATABASE_URL });
const tablas = [
  "usuarios", "boletas", "logs", "productos", "clientes", "puntos_venta",
  "pedidos", "pedido_items", "agro_productos", "agro_rutas", "agro_distribuidores",
  "agro_ordenes", "agro_orden_items", "agro_tripulacion", "agro_vehiculos",
  "agro_clientes", "agro_contadores", "agro_asignaciones",
  "agro_asignacion_ordenes", "agro_plantillas_dl",
];
(async () => {
  for (const t of tablas) {
    try {
      const r = await p.query(`SELECT COUNT(*)::int AS c FROM ${t}`);
      console.log(t.padEnd(28), r.rows[0].c);
    } catch (e) {
      console.log(t.padEnd(28), "ERR", e.message);
    }
  }
  await p.end();
})();
