// Script único para vaciar la tabla clientes
const db = require("./db");

db.serialize(() => {
  db.get("SELECT COUNT(*) AS n FROM clientes", [], (err, row) => {
    if (err) { console.error("Error:", err.message); process.exit(1); }
    console.log(`Clientes existentes: ${row.n}`);
    db.run("DELETE FROM clientes", [], function (err2) {
      if (err2) { console.error("Error al borrar:", err2.message); process.exit(1); }
      db.run("DELETE FROM sqlite_sequence WHERE name='clientes'", [], () => {
        console.log(`✔ Eliminados ${this.changes} clientes. Tabla vacía.`);
        db.close(() => process.exit(0));
      });
    });
  });
});
