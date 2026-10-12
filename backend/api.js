const { randomUUID, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  database: sql,
  directory,
  transaction,
  closeExpiredAuctions,
  notify,
  audit,
  events,
} = require('./database');
const {
  fail,
  hash,
  passwordHash,
  passwordMatches,
  validatePassword,
  readJSON,
  integer,
  text,
} = require('./security');
const { prepareImages, writeImages, removeImage } = require('./images');
const { google, configured: googleConfigured } = require('./google');
const mail = require('./mail');
const get = (query, ...values) => sql.prepare(query).get(...values);
const all = (query, ...values) => sql.prepare(query).all(...values);
const run = (query, ...values) => sql.prepare(query).run(...values);
const dummyPasswordHash = passwordHash('Unknown123!');
function publicUser(user) {
  return user
    ? {
        id: user.id,
        full_name: user.full_name,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
        notifications_enabled: Boolean(user.notifications_enabled),
        status: user.status,
      }
    : null;
}
function cookieToken(request) {
  return (request.headers.cookie || '')
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('aurum_session='))
    ?.slice(14);
}
function currentUser(request) {
  const token = cookieToken(request);
  return token
    ? get(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'",
        hash(token),
        Date.now(),
      )
    : null;
}
function requireUser(request, role) {
  const user = currentUser(request);
  if (!user) fail(401, 'Inicia sesion para continuar.');
  if (role && user.role !== role) fail(403, 'No tienes permisos para esta accion.');
  return user;
}
function session(response, user) {
  const token = randomBytes(32).toString('hex');
  run('INSERT INTO sessions VALUES(?,?,?)', hash(token), user.id, Date.now() + 7 * 86400000);
  response.setHeader(
    'Set-Cookie',
    `aurum_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
}
function images(id) {
  return all(
    'SELECT id,image_url,position FROM product_images WHERE product_id=? ORDER BY position',
    id,
  );
}
function product(row, user = null) {
  if (!row) return null;
  const result = get('SELECT * FROM auction_results WHERE product_id=?', row.id);
  const photos = images(row.id);
  const seller = get('SELECT full_name FROM users WHERE id=?', row.seller_id);
  return {
    ...row,
    product_images: photos,
    image_url: photos[0]?.image_url || null,
    bid_count: get('SELECT count(*) AS count FROM bids WHERE product_id=?', row.id).count,
    participants: get(
      'SELECT count(DISTINCT user_id) AS count FROM bids WHERE product_id=?',
      row.id,
    ).count,
    seller_name: seller?.full_name,
    result: result ? { ...result, reserve_met: Boolean(result.winner_id) } : null,
    is_favorite: user
      ? Boolean(get('SELECT 1 FROM favorites WHERE user_id=? AND product_id=?', user.id, row.id))
      : false,
  };
}
function visible(row, user) {
  return (
    row &&
    (['active', 'scheduled', 'finalized', 'cancelled'].includes(row.state) ||
      user?.id === row.seller_id ||
      user?.role === 'admin')
  );
}
function ownAuction(request, id) {
  const user = requireUser(request);
  const row = get('SELECT * FROM products WHERE id=?', id);
  if (!row) fail(404, 'Subasta no encontrada.');
  if (row.seller_id !== user.id) fail(403, 'Solo puedes administrar tus publicaciones.');
  return { user, row };
}
function dealForUser(request, id) {
  const user = requireUser(request);
  const deal = get('SELECT * FROM deals WHERE id=?', id);
  if (!deal || ![deal.buyer_id, deal.seller_id].includes(user.id))
    fail(404, 'Acuerdo no encontrado.');
  return { user, deal };
}
function dealView(deal) {
  return {
    ...deal,
    products: product(get('SELECT * FROM products WHERE id=?', deal.product_id)),
    seller: get('SELECT full_name FROM users WHERE id=?', deal.seller_id),
    buyer: get('SELECT full_name FROM users WHERE id=?', deal.buyer_id),
  };
}
const limits = new Map();
function rate(request, group, max, window = 60000) {
  const key = `${group}:${request.socket.remoteAddress}`;
  const now = Date.now();
  let entry = limits.get(key);
  if (!entry || entry.until <= now) entry = { count: 0, until: now + window };
  limits.set(key, entry);
  if (++entry.count > max) fail(429, 'Demasiadas solicitudes. Espera e intenta nuevamente.');
}
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
  run('DELETE FROM sessions WHERE expires_at<=?', now);
  run('DELETE FROM password_reset_tokens WHERE expires_at<?', now - 86400000);
}, 60000);
cleanup.unref();

function auctionInput(input, current = null) {
  const now = new Date();
  const starts = new Date(input.starts_at || current?.starts_at || now.toISOString());
  const ends = new Date(input.ends_at || current?.ends_at);
  if (
    !Number.isFinite(starts.getTime()) ||
    !Number.isFinite(ends.getTime()) ||
    ends <= starts ||
    ends <= now
  )
    fail(400, 'El cierre debe ser posterior al inicio y al momento actual.');
  const price = integer(input.starting_price ?? current?.starting_price, 'El precio inicial');
  const increment = integer(
    input.minimum_increment ?? current?.minimum_increment ?? 1000,
    'El incremento',
  );
  const reserve = integer(
    input.reserve_price === undefined ? current?.reserve_price : input.reserve_price,
    'La reserva',
    true,
  );
  if (reserve !== null && reserve < price)
    fail(400, 'La reserva debe ser igual o superior al precio inicial.');
  const category = input.category || current?.category;
  if (!get('SELECT id FROM categories WHERE id=?', category || ''))
    fail(400, 'Selecciona una categoria valida.');
  const condition = input.condition || current?.condition || 'used';
  if (!['new', 'like_new', 'used', 'restored'].includes(condition))
    fail(400, 'Estado del producto invalido.');
  return {
    title: text(input.title ?? current?.title, 'Nombre', 160, 2),
    description: text(input.description ?? current?.description, 'Descripcion', 10000, 5),
    category,
    starting_price: price,
    minimum_increment: increment,
    reserve_price: reserve,
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    brand: text(input.brand ?? current?.brand ?? '', 'Marca', 100, 0),
    model: text(input.model ?? current?.model ?? '', 'Modelo', 100, 0),
    condition,
    location: text(input.location ?? current?.location ?? '', 'Ubicacion', 160, 0),
    features: text(input.features ?? current?.features ?? '', 'Caracteristicas', 3000, 0),
    delivery_terms: text(
      input.delivery_terms ?? current?.delivery_terms ?? '',
      'Condiciones de entrega',
      3000,
      0,
    ),
  };
}
function storeImages(id, prepared) {
  run('DELETE FROM product_images WHERE product_id=?', id);
  prepared.forEach((image, index) =>
    run('INSERT INTO product_images VALUES(?,?,?,?)', image.id, id, image.image_url, index),
  );
}
function emit() {
  events.emit('changed');
}

async function api(request, response) {
  const url = new URL(request.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  const send = (data, status = 200) => {
    response.writeHead(status);
    response.end(JSON.stringify({ data }));
  };
  try {
    rate(request, 'general', 300);
    if (!['GET', 'HEAD'].includes(request.method)) {
      const origin = request.headers.origin;
      if (
        origin &&
        ![`http://${request.headers.host}`, `https://${request.headers.host}`].includes(origin)
      )
        fail(403, 'Origen no permitido.');
      if (request.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Origen no permitido.');
    }
    const route = `${request.method} ${url.pathname}`;
    const user = currentUser(request);
    if (route === 'GET /api/config') {
      send({ google_enabled: googleConfigured() });
      return true;
    }
    if (request.method === 'GET' && (await google(request, response, session))) return true;
    if (route === 'GET /api/health') {
      send({ database: 'sqlite', server_time: new Date().toISOString() });
      return true;
    }
    if (route === 'GET /api/auth/me' || route === 'GET /api/users/me') {
      send(publicUser(user));
      return true;
    }
    if (route === 'POST /api/auth/register' || route === 'POST /api/auth/login') {
      rate(request, 'auth', 20, 900000);
      const input = await readJSON(request);
      const email = text(input.email, 'Correo', 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Correo invalido.');
      let account = get('SELECT * FROM users WHERE email=?', email);
      if (route.endsWith('register')) {
        validatePassword(input.password);
        if (input.password !== input.confirm_password) fail(400, 'Las contrasenas no coinciden.');
        if (input.accept_terms !== true) fail(400, 'Debes aceptar los terminos.');
        if (account) fail(409, 'Este correo ya esta registrado.');
        if (!['usuario', 'subastador'].includes(input.role))
          fail(400, 'Selecciona cliente o subastador.');
        const first = text(input.first_name, 'Nombre', 60, 2),
          last = text(input.last_name, 'Apellido', 60, 2),
          id = randomUUID();
        run(
          'INSERT INTO users(id,full_name,email,password_hash,role,created_at,first_name,last_name,terms_accepted_at) VALUES(?,?,?,?,?,?,?,?,?)',
          id,
          `${first} ${last}`,
          email,
          passwordHash(input.password),
          input.role,
          new Date().toISOString(),
          first,
          last,
          new Date().toISOString(),
        );
        account = get('SELECT * FROM users WHERE id=?', id);
      } else {
        if (typeof input.password !== 'string' || input.password.length > 128)
          fail(401, 'Correo o contrasena incorrectos.');
        // A dummy derivation gives unknown accounts the same expensive verification path.
        const stored = account?.password_hash || dummyPasswordHash;
        const correct = passwordMatches(input.password, stored);
        if (!account || !correct || account.status !== 'active')
          fail(401, 'Correo o contrasena incorrectos.');
      }
      session(response, account);
      audit(account.id, 'auth.login', 'user', account.id);
      emit();
      send(publicUser(account), route.endsWith('register') ? 201 : 200);
      return true;
    }
    if (route === 'POST /api/auth/logout') {
      const token = cookieToken(request);
      if (token) run('DELETE FROM sessions WHERE token_hash=?', hash(token));
      response.setHeader(
        'Set-Cookie',
        'aurum_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
      );
      emit();
      send(null);
      return true;
    }
    if (route === 'POST /api/auth/forgot-password') {
      if (process.env.NODE_ENV === 'production' && !mail.configured())
        fail(503, 'El envio de correo aun no esta configurado.');
      rate(request, 'reset', 5, 900000);
      const input = await readJSON(request);
      const email = String(input.email || '')
        .trim()
        .toLowerCase();
      const account = get("SELECT * FROM users WHERE email=? AND status='active'", email);
      if (account) {
        const token = randomBytes(32).toString('hex');
        run('DELETE FROM password_reset_tokens WHERE user_id=?', account.id);
        run(
          'INSERT INTO password_reset_tokens VALUES(?,?,?,NULL)',
          hash(token),
          account.id,
          Date.now() + 1800000,
        );
        if (process.env.NODE_ENV !== 'production') {
          const outbox = path.join(directory, 'outbox');
          fs.mkdirSync(outbox, { recursive: true });
          fs.writeFileSync(
            path.join(outbox, `${account.id}.json`),
            JSON.stringify({
              to: account.email,
              reset_path: `/#/reset?token=${token}`,
              expires_at: new Date(Date.now() + 1800000).toISOString(),
            }),
          );
        }
        if (mail.configured()) {
          try {
            await mail.sendReset(account.email, token);
          } catch {
            audit(null, 'mail.delivery_failed', 'system', null);
          }
        }
      }
      send({
        message:
          'Si el correo esta registrado, recibiras instrucciones. En desarrollo consulta el buzon local.',
      });
      return true;
    }
    if (route === 'POST /api/auth/reset-password') {
      rate(request, 'reset', 5, 900000);
      const input = await readJSON(request);
      validatePassword(input.password);
      if (input.password !== input.confirm_password) fail(400, 'Las contrasenas no coinciden.');
      const token = typeof input.token === 'string' ? input.token : '';
      const record = get(
        'SELECT * FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?',
        hash(token),
        Date.now(),
      );
      if (!record) fail(400, 'El enlace no es valido o ya expiro.');
      const encoded = passwordHash(input.password);
      transaction(() => {
        run('UPDATE users SET password_hash=? WHERE id=?', encoded, record.user_id);
        run(
          'UPDATE password_reset_tokens SET used_at=? WHERE token_hash=?',
          new Date().toISOString(),
          hash(token),
        );
        run('DELETE FROM sessions WHERE user_id=?', record.user_id);
        audit(record.user_id, 'password.reset', 'user', record.user_id);
      });
      emit();
      send(null);
      return true;
    }
    if (route === 'PATCH /api/users/me') {
      const account = requireUser(request);
      const input = await readJSON(request, 8 * 1024 * 1024);
      const first = text(input.first_name ?? account.first_name, 'Nombre', 60, 2),
        last = text(input.last_name ?? account.last_name, 'Apellido', 60, 2);
      let avatar = account.avatar_url;
      if (input.avatar) {
        const prepared = prepareImages([input.avatar]);
        writeImages(prepared);
        avatar = prepared[0].image_url;
      }
      run(
        'UPDATE users SET first_name=?,last_name=?,full_name=?,avatar_url=?,notifications_enabled=? WHERE id=?',
        first,
        last,
        `${first} ${last}`,
        avatar,
        input.notifications_enabled === undefined
          ? account.notifications_enabled
          : Number(Boolean(input.notifications_enabled)),
        account.id,
      );
      send(publicUser(get('SELECT * FROM users WHERE id=?', account.id)));
      return true;
    }
    if (route === 'PATCH /api/users/me/password') {
      const account = requireUser(request);
      rate(request, 'password', 5, 900000);
      const input = await readJSON(request);
      if (
        typeof input.current_password !== 'string' ||
        !passwordMatches(input.current_password, account.password_hash)
      )
        fail(400, 'La contrasena actual no es correcta.');
      validatePassword(input.password);
      if (input.password !== input.confirm_password) fail(400, 'Las contrasenas no coinciden.');
      const encoded = passwordHash(input.password);
      transaction(() => {
        run('UPDATE users SET password_hash=? WHERE id=?', encoded, account.id);
        run('DELETE FROM sessions WHERE user_id=?', account.id);
      });
      session(response, account);
      audit(account.id, 'password.changed', 'user', account.id);
      emit();
      send(null);
      return true;
    }
    closeExpiredAuctions();
    if (route === 'GET /api/categories') {
      send(
        all(
          "SELECT c.*,count(p.id) AS count FROM categories c LEFT JOIN products p ON p.category=c.id AND p.state='active' AND p.status='open' GROUP BY c.id ORDER BY c.name",
        ),
      );
      return true;
    }
    if (route === 'GET /api/stats') {
      send({
        active: get("SELECT count(*) AS n FROM products WHERE state='active' AND status='open'").n,
        products: get("SELECT count(*) AS n FROM products WHERE state NOT IN ('draft','suspended')")
          .n,
        users: get('SELECT count(*) AS n FROM users').n,
        finished: get("SELECT count(*) AS n FROM products WHERE state='finalized'").n,
      });
      return true;
    }
    if (route === 'GET /api/auctions/mine') {
      const account = requireUser(request, 'subastador');
      send(
        all('SELECT * FROM products WHERE seller_id=? ORDER BY created_at DESC', account.id).map(
          (row) => product(row, account),
        ),
      );
      return true;
    }
    if (route === 'GET /api/users/me/bids') {
      const account = requireUser(request, 'usuario');
      send(
        all(
          'SELECT b.* FROM bids b WHERE b.user_id=? AND b.amount=(SELECT max(x.amount) FROM bids x WHERE x.user_id=b.user_id AND x.product_id=b.product_id) ORDER BY b.created_at DESC',
          account.id,
        ).map((bid) => ({
          ...bid,
          products: product(get('SELECT * FROM products WHERE id=?', bid.product_id), account),
        })),
      );
      return true;
    }
    if (route === 'GET /api/auctions') {
      const values = [];
      const clauses = ["p.status != 'cancelled'"];
      const state = url.searchParams.get('state') || 'active';
      if (!['active', 'scheduled', 'finalized'].includes(state))
        fail(400, 'Estado de filtro invalido.');
      clauses.push('p.state=?');
      values.push(state);
      if (url.searchParams.get('category')) {
        clauses.push('p.category=?');
        values.push(url.searchParams.get('category'));
      }
      if (url.searchParams.get('q')) {
        const query = `%${url.searchParams.get('q').slice(0, 160)}%`;
        clauses.push(
          '(p.title LIKE ? OR p.description LIKE ? OR p.brand LIKE ? OR p.category LIKE ?)',
        );
        values.push(query, query, query, query);
      }
      if (url.searchParams.get('location')) {
        clauses.push('p.location LIKE ?');
        values.push(`%${url.searchParams.get('location').slice(0, 160)}%`);
      }
      for (const [key, operator] of [
        ['min', '>='],
        ['max', '<='],
      ])
        if (url.searchParams.has(key)) {
          const amount = Number(url.searchParams.get(key));
          if (!Number.isSafeInteger(amount) || amount < 0) fail(400, 'Precio de filtro invalido.');
          clauses.push(`p.current_price ${operator} ?`);
          values.push(amount);
        }
      if (url.searchParams.get('featured') === '1') clauses.push('p.is_featured=1');
      if (url.searchParams.get('no_bids') === '1')
        clauses.push('NOT EXISTS(SELECT 1 FROM bids b WHERE b.product_id=p.id)');
      if (url.searchParams.get('closing')) {
        const hours = Number(url.searchParams.get('closing'));
        if (![24, 168].includes(hours)) fail(400, 'Plazo invalido.');
        clauses.push('p.ends_at<=?');
        values.push(new Date(Date.now() + hours * 3600000).toISOString());
      }
      const orders = {
        closing: 'p.ends_at ASC',
        low: 'p.current_price ASC',
        high: 'p.current_price DESC',
        recent: 'p.created_at DESC',
        popular: '(SELECT count(*) FROM bids b WHERE b.product_id=p.id) DESC',
      };
      const page = Number(url.searchParams.get('page') || 1);
      if (!Number.isSafeInteger(page) || page < 1) fail(400, 'Pagina invalida.');
      const where = clauses.join(' AND ');
      send({
        items: all(
          `SELECT p.* FROM products p WHERE ${where} ORDER BY ${orders[url.searchParams.get('sort')] || 'p.is_featured DESC,p.created_at DESC'},p.id LIMIT 12 OFFSET ?`,
          ...values,
          (page - 1) * 12,
        ).map((row) => product(row, user)),
        total: get(`SELECT count(*) AS n FROM products p WHERE ${where}`, ...values).n,
        page,
        page_size: 12,
      });
      return true;
    }
    if (route === 'POST /api/auctions') {
      const account = requireUser(request, 'subastador');
      rate(request, 'uploads', 20);
      const input = await readJSON(request, 72 * 1024 * 1024);
      const fields = auctionInput(input);
      const photos = prepareImages(input.images || []);
      const draft = input.draft === true;
      if (!draft && (!photos.length || !fields.location || !fields.delivery_terms))
        fail(400, 'Para publicar agrega una imagen, ubicacion y condiciones de entrega.');
      const id = randomUUID();
      writeImages(photos);
      try {
        transaction(() => {
          const now = new Date().toISOString();
          const state = draft ? 'draft' : fields.starts_at > now ? 'scheduled' : 'active';
          run(
            `INSERT INTO products(id,seller_id,title,description,category,starting_price,current_price,minimum_increment,ends_at,created_at,state,starts_at,reserve_price,brand,model,condition,location,features,delivery_terms,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            id,
            account.id,
            fields.title,
            fields.description,
            fields.category,
            fields.starting_price,
            fields.starting_price,
            fields.minimum_increment,
            fields.ends_at,
            now,
            state,
            fields.starts_at,
            fields.reserve_price,
            fields.brand,
            fields.model,
            fields.condition,
            fields.location,
            fields.features,
            fields.delivery_terms,
            now,
          );
          storeImages(id, photos);
          audit(account.id, 'auction.created', 'auction', id, { state });
        });
      } catch (error) {
        for (const photo of photos) removeImage(photo);
        throw error;
      }
      emit();
      send(product(get('SELECT * FROM products WHERE id=?', id), account), 201);
      return true;
    }
    const auctionMatch = url.pathname.match(
      /^\/api\/auctions\/([^/]+)(?:\/(bids|publish|cancel|report))?$/,
    );
    if (auctionMatch) {
      const [, id, action] = auctionMatch;
      const row = get('SELECT * FROM products WHERE id=?', id);
      if (!visible(row, user)) fail(404, 'Subasta no encontrada.');
      if (request.method === 'GET' && !action) {
        send(product(row, user));
        return true;
      }
      if (request.method === 'GET' && action === 'bids') {
        send(
          all(
            'SELECT id,amount,created_at,user_id FROM bids WHERE product_id=? ORDER BY rowid DESC LIMIT 100',
            id,
          ).map((bid) => ({
            id: bid.id,
            amount: bid.amount,
            created_at: bid.created_at,
            participant: `Participante ${hash(`${id}:${bid.user_id}`).slice(0, 6).toUpperCase()}`,
          })),
        );
        return true;
      }
      if (request.method === 'POST' && action === 'bids') {
        const account = requireUser(request, 'usuario');
        rate(request, 'bids', 30);
        const input = await readJSON(request);
        const amount = integer(input.amount, 'La oferta');
        const key = text(input.idempotency_key, 'Identificador de oferta', 128, 8);
        const accepted = transaction(() => {
          const prior = get(
            'SELECT * FROM bids WHERE user_id=? AND idempotency_key=?',
            account.id,
            key,
          );
          if (prior) {
            if (prior.product_id !== id || prior.amount !== amount)
              fail(409, 'El identificador pertenece a otra oferta.');
            return prior;
          }
          const current = get('SELECT * FROM products WHERE id=?', id);
          if (
            current.state !== 'active' ||
            current.status !== 'open' ||
            new Date(current.ends_at) <= new Date() ||
            new Date(current.starts_at) > new Date()
          )
            fail(409, 'La subasta no esta activa.');
          if (current.seller_id === account.id)
            fail(403, 'No puedes ofertar en tu propia subasta.');
          if (amount < current.current_price + current.minimum_increment)
            fail(
              409,
              `La oferta minima es ${current.current_price + current.minimum_increment} CLP.`,
            );
          const leader = get(
            'SELECT user_id FROM bids WHERE product_id=? ORDER BY amount DESC,rowid ASC LIMIT 1',
            id,
          );
          const bid = {
            id: randomUUID(),
            product_id: id,
            user_id: account.id,
            amount,
            idempotency_key: key,
            created_at: new Date().toISOString(),
          };
          run(
            'INSERT INTO bids(id,product_id,user_id,amount,idempotency_key,created_at) VALUES(?,?,?,?,?,?)',
            bid.id,
            id,
            account.id,
            amount,
            key,
            bid.created_at,
          );
          run('UPDATE products SET current_price=? WHERE id=?', amount, id);
          notify(account.id, 'accepted', 'Puja aceptada', current.title, id, `accepted:${bid.id}`);
          notify(
            current.seller_id,
            'new_bid',
            'Nueva oferta recibida',
            current.title,
            id,
            `seller:${bid.id}`,
          );
          if (leader && leader.user_id !== account.id)
            notify(
              leader.user_id,
              'outbid',
              'Tu puja fue superada',
              current.title,
              id,
              `outbid:${bid.id}`,
            );
          audit(account.id, 'bid.accepted', 'auction', id, { amount, bid: bid.id });
          return bid;
        });
        emit();
        send(accepted, 201);
        return true;
      }
      if (request.method === 'PATCH' && !action) {
        const { user: account } = ownAuction(request, id);
        if (!['draft', 'active', 'scheduled'].includes(row.state))
          fail(409, 'Esta subasta no puede editarse.');
        if (get('SELECT 1 FROM bids WHERE product_id=?', id))
          fail(409, 'Una subasta con pujas no puede modificarse.');
        const input = await readJSON(request, 72 * 1024 * 1024);
        const fields = auctionInput(input, row);
        const existing = images(id);
        const photos = prepareImages(input.images || existing, existing);
        if (row.state !== 'draft' && !photos.length)
          fail(400, 'La publicacion necesita una imagen.');
        writeImages(photos);
        try {
          transaction(() => {
            const state =
              row.state === 'draft'
                ? 'draft'
                : fields.starts_at > new Date().toISOString()
                  ? 'scheduled'
                  : 'active';
            run(
              'UPDATE products SET title=?,description=?,category=?,starting_price=?,current_price=?,minimum_increment=?,ends_at=?,starts_at=?,reserve_price=?,brand=?,model=?,condition=?,location=?,features=?,delivery_terms=?,state=?,updated_at=? WHERE id=?',
              fields.title,
              fields.description,
              fields.category,
              fields.starting_price,
              fields.starting_price,
              fields.minimum_increment,
              fields.ends_at,
              fields.starts_at,
              fields.reserve_price,
              fields.brand,
              fields.model,
              fields.condition,
              fields.location,
              fields.features,
              fields.delivery_terms,
              state,
              new Date().toISOString(),
              id,
            );
            storeImages(id, photos);
            audit(account.id, 'auction.edited', 'auction', id);
          });
        } catch (error) {
          for (const photo of photos) if (photo.file) removeImage(photo);
          throw error;
        }
        for (const photo of existing)
          if (!photos.some((item) => item.id === photo.id)) removeImage(photo);
        emit();
        send(product(get('SELECT * FROM products WHERE id=?', id), account));
        return true;
      }
      if (request.method === 'POST' && action === 'publish') {
        const { user: account } = ownAuction(request, id);
        if (row.state !== 'draft') fail(409, 'Solo puedes publicar un borrador.');
        auctionInput({}, row);
        if (!images(id).length || !row.location || !row.delivery_terms)
          fail(400, 'Completa las imagenes, ubicacion y condiciones.');
        run(
          'UPDATE products SET state=? WHERE id=?',
          row.starts_at > new Date().toISOString() ? 'scheduled' : 'active',
          id,
        );
        audit(account.id, 'auction.published', 'auction', id);
        emit();
        send(product(get('SELECT * FROM products WHERE id=?', id), account));
        return true;
      }
      if (
        (request.method === 'POST' && action === 'cancel') ||
        (request.method === 'DELETE' && !action)
      ) {
        const { user: account } = ownAuction(request, id);
        if (!['draft', 'active', 'scheduled'].includes(row.state))
          fail(409, 'Esta subasta no puede cancelarse.');
        if (get('SELECT 1 FROM bids WHERE product_id=?', id))
          fail(
            409,
            'No puedes eliminar o cancelar una publicacion con pujas. Solicita revision administrativa.',
          );
        const remove = request.method === 'DELETE';
        const photos = images(id);
        if (remove && get('SELECT 1 FROM reports WHERE product_id=?', id))
          fail(409, 'Una publicacion reportada requiere revision administrativa.');
        transaction(() => {
          if (remove) {
            run('DELETE FROM favorites WHERE product_id=?', id);
            run('UPDATE notifications SET product_id=NULL WHERE product_id=?', id);
            run('DELETE FROM products WHERE id=?', id);
          } else run("UPDATE products SET status='cancelled',state='cancelled' WHERE id=?", id);
          audit(account.id, remove ? 'auction.deleted' : 'auction.cancelled', 'auction', id);
        });
        if (remove) for (const photo of photos) removeImage(photo);
        emit();
        send(null);
        return true;
      }
      if (request.method === 'POST' && action === 'report') {
        const account = requireUser(request);
        const input = await readJSON(request);
        run(
          'INSERT INTO reports(id,reporter_id,product_id,reason,description,created_at) VALUES(?,?,?,?,?,?)',
          randomUUID(),
          account.id,
          id,
          text(input.reason, 'Motivo', 160),
          text(input.description || '', 'Descripcion', 2000, 0),
          new Date().toISOString(),
        );
        send(null, 201);
        return true;
      }
    }
    if (route === 'GET /api/favorites') {
      const account = requireUser(request);
      send(
        all(
          'SELECT p.* FROM favorites f JOIN products p ON p.id=f.product_id WHERE f.user_id=? ORDER BY f.created_at DESC',
          account.id,
        )
          .filter((row) => visible(row, account))
          .map((row) => product(row, account)),
      );
      return true;
    }
    const favorite = url.pathname.match(/^\/api\/favorites\/([^/]+)$/);
    if (favorite && ['POST', 'DELETE'].includes(request.method)) {
      const account = requireUser(request);
      const row = get('SELECT * FROM products WHERE id=?', favorite[1]);
      if (!visible(row, account)) fail(404, 'Subasta no encontrada.');
      if (request.method === 'POST')
        run(
          'INSERT OR IGNORE INTO favorites VALUES(?,?,?)',
          account.id,
          row.id,
          new Date().toISOString(),
        );
      else run('DELETE FROM favorites WHERE user_id=? AND product_id=?', account.id, row.id);
      send(null);
      return true;
    }
    if (route === 'GET /api/notifications') {
      const account = requireUser(request);
      send(
        all(
          'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
          account.id,
        ),
      );
      return true;
    }
    if (route === 'PATCH /api/notifications/read-all') {
      const account = requireUser(request);
      run('UPDATE notifications SET is_read=1 WHERE user_id=?', account.id);
      emit();
      send(null);
      return true;
    }
    const notification = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (notification && request.method === 'PATCH') {
      const account = requireUser(request);
      run(
        'UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?',
        notification[1],
        account.id,
      );
      send(null);
      return true;
    }
    if (route === 'GET /api/deals') {
      const account = requireUser(request);
      send(
        all(
          'SELECT * FROM deals WHERE seller_id=? OR buyer_id=? ORDER BY created_at DESC',
          account.id,
          account.id,
        ).map(dealView),
      );
      return true;
    }
    const dealMatch = url.pathname.match(
      /^\/api\/deals\/([^/]+)(?:\/(messages|confirm|incident))?$/,
    );
    if (dealMatch) {
      const { user: account, deal } = dealForUser(request, dealMatch[1]);
      const action = dealMatch[2];
      if (request.method === 'GET' && !action) {
        send(dealView(deal));
        return true;
      }
      if (request.method === 'GET' && action === 'messages') {
        send(
          all(
            'SELECT m.*,u.full_name AS sender_name FROM deal_messages m JOIN users u ON u.id=m.sender_id WHERE deal_id=? ORDER BY m.rowid LIMIT 500',
            deal.id,
          ),
        );
        return true;
      }
      if (request.method === 'POST' && action === 'messages') {
        rate(request, 'messages', 30);
        const input = await readJSON(request);
        const message = text(input.message, 'Mensaje', 2000);
        transaction(() => {
          run(
            'INSERT INTO deal_messages VALUES(?,?,?,?,?)',
            randomUUID(),
            deal.id,
            account.id,
            message,
            new Date().toISOString(),
          );
          if (deal.status === 'pending')
            run("UPDATE deals SET status='coordinating' WHERE id=?", deal.id);
          notify(
            account.id === deal.buyer_id ? deal.seller_id : deal.buyer_id,
            'message',
            'Nuevo mensaje',
            'Tienes un mensaje en un acuerdo.',
            deal.product_id,
          );
        });
        emit();
        send(null, 201);
        return true;
      }
      if (request.method === 'POST' && action === 'confirm') {
        if (deal.status === 'incident') fail(409, 'Resuelve primero la incidencia con soporte.');
        transaction(() => {
          run(
            `UPDATE deals SET ${account.id === deal.buyer_id ? 'buyer_confirmed' : 'seller_confirmed'}=1 WHERE id=?`,
            deal.id,
          );
          run(
            "UPDATE deals SET status='completed' WHERE id=? AND buyer_confirmed=1 AND seller_confirmed=1",
            deal.id,
          );
          audit(account.id, 'deal.confirmed', 'deal', deal.id);
        });
        emit();
        send(dealView(get('SELECT * FROM deals WHERE id=?', deal.id)));
        return true;
      }
      if (request.method === 'POST' && action === 'incident') {
        const input = await readJSON(request);
        const message = text(input.message, 'Describe la incidencia', 2000, 5);
        transaction(() => {
          run("UPDATE deals SET status='incident' WHERE id=?", deal.id);
          run(
            'INSERT INTO deal_messages VALUES(?,?,?,?,?)',
            randomUUID(),
            deal.id,
            account.id,
            message,
            new Date().toISOString(),
          );
          run(
            'INSERT INTO reports(id,reporter_id,product_id,reason,description,created_at) VALUES(?,?,?,?,?,?)',
            randomUUID(),
            account.id,
            deal.product_id,
            'Incidencia en acuerdo',
            message,
            new Date().toISOString(),
          );
          audit(account.id, 'deal.incident', 'deal', deal.id);
        });
        emit();
        send(null);
        return true;
      }
    }
    if (url.pathname.startsWith('/api/admin/')) {
      const admin = requireUser(request, 'admin');
      if (route === 'GET /api/admin/stats') {
        send({
          users: get('SELECT count(*) AS n FROM users').n,
          sellers: get("SELECT count(*) AS n FROM users WHERE role='subastador'").n,
          clients: get("SELECT count(*) AS n FROM users WHERE role='usuario'").n,
          active: get("SELECT count(*) AS n FROM products WHERE state='active'").n,
          finished: get("SELECT count(*) AS n FROM products WHERE state='finalized'").n,
          reports: get("SELECT count(*) AS n FROM reports WHERE status='pending'").n,
          volume: get(
            'SELECT coalesce(sum(final_amount),0) AS n FROM auction_results WHERE winner_id IS NOT NULL',
          ).n,
        });
        return true;
      }
      if (route === 'GET /api/admin/users') {
        const query = `%${(url.searchParams.get('q') || '').slice(0, 100)}%`;
        const role = url.searchParams.get('role');
        send(
          all(
            `SELECT * FROM users WHERE (full_name LIKE ? OR email LIKE ?) ${role ? 'AND role=?' : ''} ORDER BY created_at DESC LIMIT 200`,
            query,
            query,
            ...(role ? [role] : []),
          ).map(publicUser),
        );
        return true;
      }
      if (route === 'GET /api/admin/auctions') {
        send(
          all('SELECT * FROM products ORDER BY created_at DESC LIMIT 200').map((row) =>
            product(row, admin),
          ),
        );
        return true;
      }
      if (route === 'GET /api/admin/reports') {
        send(
          all(
            'SELECT r.*,p.title FROM reports r JOIN products p ON p.id=r.product_id ORDER BY r.created_at DESC LIMIT 200',
          ),
        );
        return true;
      }
      if (route === 'GET /api/admin/audit-logs') {
        send(all('SELECT * FROM audit_logs ORDER BY rowid DESC LIMIT 200'));
        return true;
      }
      const accountMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
      if (accountMatch && request.method === 'PATCH') {
        const input = await readJSON(request);
        if (!['active', 'suspended'].includes(input.status)) fail(400, 'Estado invalido.');
        const target = get('SELECT * FROM users WHERE id=?', accountMatch[1]);
        if (!target) fail(404, 'Usuario no encontrado.');
        if (target.role === 'admin') fail(403, 'No puedes suspender administradores.');
        const reason = text(input.reason, 'Motivo', 500, 5);
        transaction(() => {
          run('UPDATE users SET status=? WHERE id=?', input.status, target.id);
          if (input.status === 'suspended') {
            run('DELETE FROM sessions WHERE user_id=?', target.id);
            const publications = all(
              "SELECT id FROM products WHERE seller_id=? AND state IN ('active','scheduled')",
              target.id,
            );
            for (const publication of publications) {
              run("UPDATE products SET state='suspended' WHERE id=?", publication.id);
              audit(admin.id, 'auction.seller_suspended', 'auction', publication.id, { reason });
              const participants = all(
                'SELECT DISTINCT user_id FROM bids WHERE product_id=?',
                publication.id,
              );
              for (const person of participants)
                notify(person.user_id, 'moderated', 'Subasta suspendida', reason, publication.id);
            }
          }
          audit(admin.id, 'user.status', 'user', target.id, { status: input.status, reason });
        });
        emit();
        send(null);
        return true;
      }
      const moderation = url.pathname.match(/^\/api\/admin\/auctions\/([^/]+)\/moderation$/);
      if (moderation && request.method === 'PATCH') {
        const input = await readJSON(request);
        const row = get('SELECT * FROM products WHERE id=?', moderation[1]);
        if (!row) fail(404, 'Subasta no encontrada.');
        if (!['suspended', 'cancelled', 'active'].includes(input.state))
          fail(400, 'Estado invalido.');
        if (row.state === 'finalized' || row.state === 'cancelled')
          fail(409, 'No se puede modificar una subasta finalizada o cancelada.');
        if (input.state === 'active') {
          if (new Date(row.ends_at) <= new Date())
            fail(409, 'No puedes reactivar una subasta vencida.');
          if (get('SELECT status FROM users WHERE id=?', row.seller_id).status !== 'active')
            fail(409, 'Reactiva primero la cuenta del subastador.');
          if (!images(row.id).length || !row.location || !row.delivery_terms)
            fail(400, 'La publicacion no tiene todos los datos necesarios.');
        }
        const reason = text(input.reason, 'Motivo', 500, 5);
        const nextState =
          input.state === 'active' && row.starts_at > new Date().toISOString()
            ? 'scheduled'
            : input.state;
        transaction(() => {
          run(
            'UPDATE products SET state=?,status=?,is_featured=? WHERE id=?',
            nextState,
            input.state === 'cancelled' ? 'cancelled' : 'open',
            input.featured ? 1 : 0,
            row.id,
          );
          audit(admin.id, 'auction.moderated', 'auction', row.id, { state: nextState, reason });
          notify(row.seller_id, 'moderated', 'Publicacion revisada', reason, row.id);
          const participants = all('SELECT DISTINCT user_id FROM bids WHERE product_id=?', row.id);
          for (const person of participants)
            notify(
              person.user_id,
              'moderated',
              'Una subasta en la que participas fue revisada',
              reason,
              row.id,
            );
        });
        emit();
        send(null);
        return true;
      }
      const report = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)$/);
      if (report && request.method === 'PATCH') {
        const input = await readJSON(request);
        if (!['reviewed', 'dismissed'].includes(input.status)) fail(400, 'Estado invalido.');
        const record = get('SELECT * FROM reports WHERE id=?', report[1]);
        if (!record) fail(404, 'Reporte no encontrado.');
        transaction(() => {
          run(
            'UPDATE reports SET status=?,reviewed_by=? WHERE id=?',
            input.status,
            admin.id,
            report[1],
          );
          if (record.reason === 'Incidencia en acuerdo') {
            run(
              "UPDATE deals SET status='coordinating',buyer_confirmed=0,seller_confirmed=0 WHERE product_id=? AND status='incident'",
              record.product_id,
            );
            const deal = get('SELECT * FROM deals WHERE product_id=?', record.product_id);
            if (deal)
              for (const participant of [deal.buyer_id, deal.seller_id])
                notify(
                  participant,
                  'moderated',
                  'Incidencia revisada',
                  'Puedes continuar la coordinacion y confirmar nuevamente el acuerdo.',
                  record.product_id,
                );
          }
          audit(admin.id, 'report.reviewed', 'report', report[1], { status: input.status });
        });
        emit();
        send(null);
        return true;
      }
    }
    fail(404, 'Ruta no encontrada.');
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(error.status || 500);
      response.end(
        JSON.stringify({
          error: { message: error.status ? error.message : 'No se pudo completar la operacion.' },
        }),
      );
    } else response.end();
  }
  return true;
}
module.exports = { api, currentUser, publicUser, passwordHash, closeExpiredAuctions, events };
