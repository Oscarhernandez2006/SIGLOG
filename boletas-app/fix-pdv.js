const db = require('./db');
db.run("UPDATE clientes SET punto_venta = 'Carnes Santacruz Alameda I' WHERE punto_venta = 'PDV Alameda'", function(e) {
  if (e) console.log("Error Alameda:", e.message);
  else console.log("Alameda:", this.changes, "clientes actualizados");
  db.run("UPDATE clientes SET punto_venta = 'Carnes Santacruz La 93' WHERE punto_venta = 'PDV La 93'", function(e2) {
    if (e2) console.log("Error La 93:", e2.message);
    else console.log("La 93:", this.changes, "clientes actualizados");
    process.exit();
  });
});
