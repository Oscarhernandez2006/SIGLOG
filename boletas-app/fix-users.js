const db = require('./db');

setTimeout(() => {
  // admin = administrador
  db.run("UPDATE usuarios SET rol = 'administrador', permisos = 'canjear,generar,informes,reimprimir,validar' WHERE username = 'admin'", () => {
    // waldir = usuario sin permisos
    db.run("UPDATE usuarios SET rol = 'usuario', permisos = '' WHERE username = 'waldir'", () => {
      // admin2 = usuario sin permisos
      db.run("UPDATE usuarios SET rol = 'usuario', permisos = '' WHERE username = 'admin2'", () => {
        // Eliminar usuarios con username NULL
        db.run("DELETE FROM usuarios WHERE username IS NULL", () => {
          db.all('SELECT id, username, rol, permisos FROM usuarios', [], (e, r) => {
            console.log(JSON.stringify(r, null, 2));
            process.exit();
          });
        });
      });
    });
  });
}, 500);
