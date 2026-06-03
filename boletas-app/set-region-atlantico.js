const db = require("./db");

db.run("UPDATE clientes SET region = 'Atlantico'", function (err) {
  if (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
  console.log("Clientes actualizados con region='Atlantico':", this.changes);
  db.close();
});
