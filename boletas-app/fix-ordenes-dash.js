const db = require('./db');

db.run("UPDATE agro_ordenes SET numero_orden = REPLACE(numero_orden, 'B-', 'B') WHERE numero_orden LIKE 'B-%'", function(e) {
  console.log('B:', e || 'OK', this.changes, 'filas');
});

db.run("UPDATE agro_ordenes SET numero_orden = REPLACE(numero_orden, 'P-', 'P') WHERE numero_orden LIKE 'P-%'", function(e) {
  console.log('P:', e || 'OK', this.changes, 'filas');
});
