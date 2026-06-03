const db = require('./db');
db.all("SELECT id, nombre, cedula, punto_venta FROM clientes WHERE punto_venta IS NOT NULL AND punto_venta != ''", [], (e, r) => {
  console.log("=== CLIENTES CON PDV ===");
  if (r) r.forEach(c => console.log(`ID:${c.id} | ${c.nombre} | ${c.cedula} | PDV: ${c.punto_venta}`));
  db.all("SELECT * FROM puntos_venta ORDER BY indicador", [], (e2, r2) => {
    console.log("\n=== PUNTOS DE VENTA ===");
    if (r2) r2.forEach(p => console.log(`Indicador:${p.indicador} | ${p.nombre}`));
    process.exit();
  });
});
