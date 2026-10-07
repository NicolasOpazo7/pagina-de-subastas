const path = require('node:path'),
  fs = require('node:fs');
const { randomUUID, randomBytes } = require('node:crypto');
if (process.env.NODE_ENV === 'production') throw new Error('El seed no se permite en produccion.');
process.env.AURUM_DATA_DIR = path.join(__dirname, '../data-demo');
const { database: sql, transaction, closeExpiredAuctions, directory } = require('./database');
const { passwordHash } = require('./security');
const { prepareImages, writeImages } = require('./images');
async function seed() {
  if (sql.prepare('SELECT count(*) AS n FROM users').get().n)
    throw new Error('La base demo ya tiene datos. No se sobrescriben.');
  const sources = [
    ['Reloj Heritage', 'relojeria', 125000, 'photo-1523170335258-f5ed11844a49'],
    ['Collar de perlas', 'joyeria', 65000, 'photo-1515562141207-7a88fb7ce338'],
    ['Camara Canon', 'fotografia', 210000, 'photo-1516035069371-29a1b244cc32'],
    ['Instrumentos de estudio', 'musica', 175000, 'photo-1511379938547-c1f69419868d'],
    ['Notebook de trabajo', 'tecnologia', 380000, 'photo-1496181133206-80ce9b88a853'],
  ];
  const photos = [];
  for (const [title, , , photo] of sources) {
    const response = await fetch(
      `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=900&q=80`,
      { signal: AbortSignal.timeout(20000) },
    );
    if (!response.ok) throw new Error(`No se pudo obtener la imagen demo: ${title}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    photos.push(
      prepareImages([
        {
          data: `data:${response.headers.get('content-type').split(';')[0]};base64,${buffer.toString('base64')}`,
        },
      ])[0],
    );
  }
  const credentials = [],
    sellers = [],
    clients = [],
    now = Date.now();
  for (const photo of photos) writeImages([photo]);
  transaction(() => {
    for (const role of ['admin', ...Array(3).fill('subastador'), ...Array(5).fill('usuario')]) {
      const id = randomUUID(),
        number = credentials.filter((item) => item.role === role).length + 1,
        email = `${role}${number}@demo.aurum.test`,
        password = `Aurum${randomBytes(8).toString('hex')}9`,
        first =
          role === 'admin' ? 'Administrador' : role === 'subastador' ? 'Subastador' : 'Cliente';
      sql
        .prepare(
          'INSERT INTO users(id,full_name,email,password_hash,role,created_at,first_name,last_name,terms_accepted_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          `${first} Demo ${number}`,
          email,
          passwordHash(password),
          role,
          new Date(now).toISOString(),
          first,
          `Demo ${number}`,
          new Date(now).toISOString(),
        );
      credentials.push({ email, password, role });
      if (role === 'subastador') sellers.push(id);
      if (role === 'usuario') clients.push(id);
    }
    for (let index = 0; index < 10; index++) {
      const [title, category, price] = sources[index % 5],
        id = randomUUID(),
        past = index >= 8,
        scheduled = index === 7,
        start = new Date(now + (scheduled ? 3600000 : -86400000)).toISOString(),
        end = new Date(
          now + (past ? -10000 : scheduled ? 86400000 : (index + 1) * 7200000),
        ).toISOString();
      sql
        .prepare(
          'INSERT INTO products(id,seller_id,title,description,category,starting_price,current_price,minimum_increment,ends_at,created_at,state,starts_at,reserve_price,location,delivery_terms,is_featured,condition) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          sellers[index % 3],
          `${title} (Demo)`,
          'Publicacion de demostracion para probar los flujos. No es un producto real en venta.',
          category,
          price,
          price,
          1000,
          end,
          new Date(now - 86400000).toISOString(),
          scheduled ? 'scheduled' : 'active',
          start,
          index === 9 ? price * 3 : null,
          'Santiago, Chile',
          'Retiro coordinado entre las partes. Publicacion de prueba.',
          index < 3 ? 1 : 0,
          'used',
        );
      sql
        .prepare('INSERT INTO product_images VALUES(?,?,?,?)')
        .run(randomUUID(), id, photos[index % 5].image_url, 0);
      if (index % 2 === 0 || past) {
        const amount = price + 1000;
        sql
          .prepare(
            'INSERT INTO bids(id,product_id,user_id,amount,idempotency_key,created_at) VALUES(?,?,?,?,?,?)',
          )
          .run(
            randomUUID(),
            id,
            clients[index % 5],
            amount,
            randomUUID(),
            new Date(now - 30000).toISOString(),
          );
        sql.prepare('UPDATE products SET current_price=? WHERE id=?').run(amount, id);
      }
    }
  });
  closeExpiredAuctions();
  fs.writeFileSync(path.join(directory, 'credentials.json'), JSON.stringify(credentials, null, 2));
  console.log(
    'Demo creada en data-demo. Credenciales: data-demo/credentials.json. Ejecuta npm run dev:demo.',
  );
}
seed()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => sql.close());
