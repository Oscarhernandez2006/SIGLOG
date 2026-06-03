const db = require('./db');
db.all("SELECT DISTINCT punto_venta, COUNT(*) as total FROM clientes WHERE punto_venta IS NOT NULL AND punto_venta != '' GROUP BY punto_venta", [], (e, r) => {
  console.log("=== VALORES DISTINTOS DE PUNTO_VENTA EN CLIENTES ===");
  if (r) r.forEach(c => console.log(`"${c.punto_venta}" => ${c.total} clientes`));
  db.all("SELECT indicador, nombre FROM puntos_venta ORDER BY indicador", [], (e2, r2) => {
    console.log("\n=== PUNTOS DE VENTA REGISTRADOS ===");
    if (r2) r2.forEach(p => console.log(`${p.indicador}: "${p.nombre}"`));
    process.exit();
  });
});
