const { randomUUID } = require('node:crypto');
const { database } = require('./database');
const { passwordHash, validatePassword, text } = require('./security');
const email = String(process.env.ADMIN_EMAIL || '')
  .trim()
  .toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error('Define ADMIN_EMAIL con un correo valido.');
validatePassword(process.env.ADMIN_PASSWORD);
if (database.prepare('SELECT id FROM users WHERE email=?').get(email))
  throw new Error('El correo ya existe. No se modifico ningun rol.');
const first = text(process.env.ADMIN_FIRST_NAME || 'Administrador', 'Nombre', 60, 2);
const last = text(process.env.ADMIN_LAST_NAME || 'Aurum', 'Apellido', 60, 2);
database
  .prepare(
    'INSERT INTO users(id,full_name,email,password_hash,role,created_at,first_name,last_name,terms_accepted_at) VALUES(?,?,?,?,?,?,?,?,?)',
  )
  .run(
    randomUUID(),
    `${first} ${last}`,
    email,
    passwordHash(process.env.ADMIN_PASSWORD),
    'admin',
    new Date().toISOString(),
    first,
    last,
    new Date().toISOString(),
  );
console.log('Administrador creado. La contrasena no se imprime.');
database.close();
