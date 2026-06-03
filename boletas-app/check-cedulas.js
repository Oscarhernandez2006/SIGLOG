const db = require('./db');
setTimeout(() => {
  db.all("SELECT cedula, typeof(cedula) as tipo FROM boletas ORDER BY id DESC LIMIT 10", [], (e, r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit();
  });
}, 500);
