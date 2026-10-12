const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { database, transaction, audit } = require('./database');
const { hash, passwordHash, fail } = require('./security');
function configured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL,
  );
}
function callbackURL() {
  return new URL('/api/auth/google/callback', process.env.APP_URL).href;
}
async function google(request, response, session) {
  const url = new URL(request.url, 'http://localhost');
  if (!['/api/auth/google', '/api/auth/google/callback'].includes(url.pathname)) return false;
  if (!configured()) fail(503, 'El acceso con Google no esta configurado.');
  if (url.pathname === '/api/auth/google') {
    const role = url.searchParams.get('role') || 'usuario';
    if (!['usuario', 'subastador'].includes(role)) fail(400, 'Tipo de cuenta invalido.');
    if (url.searchParams.get('terms') !== '1')
      fail(400, 'Acepta primero los terminos de participacion.');
    const state = randomBytes(32).toString('hex'),
      verifier = randomBytes(32).toString('base64url');
    database.prepare('DELETE FROM oauth_states WHERE expires_at<?').run(Date.now());
    database
      .prepare('INSERT INTO oauth_states VALUES(?,?,?,?)')
      .run(hash(state), verifier, role, Date.now() + 600000);
    response.setHeader(
      'Set-Cookie',
      `aurum_oauth=${state}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=600${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    );
    const parameters = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: callbackURL(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    response.writeHead(302, {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${parameters}`,
    });
    response.end();
    return true;
  }
  const state = url.searchParams.get('state') || '',
    cookie = (request.headers.cookie || '')
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('aurum_oauth='))
      ?.slice(12);
  if (!state || cookie !== state) fail(400, 'La solicitud de Google no es valida.');
  const saved = database
    .prepare('SELECT * FROM oauth_states WHERE state_hash=? AND expires_at>?')
    .get(hash(state), Date.now());
  if (!saved) fail(400, 'La solicitud de Google ya expiro.');
  database.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(hash(state));
  if (url.searchParams.has('error')) {
    response.writeHead(302, { Location: '/#/login' });
    response.end();
    return true;
  }
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code: url.searchParams.get('code') || '',
      grant_type: 'authorization_code',
      redirect_uri: callbackURL(),
      code_verifier: saved.verifier,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!tokenResponse.ok) fail(400, 'No se pudo completar el acceso con Google.');
  const tokens = await tokenResponse.json();
  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!profileResponse.ok) fail(400, 'No se pudo verificar la cuenta de Google.');
  const profile = await profileResponse.json();
  if (!profile.email_verified || !profile.sub || !profile.email)
    fail(400, 'Google no entrego una identidad verificada.');
  const identity = database
    .prepare("SELECT user_id FROM oauth_identities WHERE provider='google' AND subject=?")
    .get(profile.sub);
  let account = identity
    ? database.prepare('SELECT * FROM users WHERE id=?').get(identity.user_id)
    : null;
  if (!account) {
    // Existing password accounts must not be linked based on an email match alone.
    if (database.prepare('SELECT id FROM users WHERE email=?').get(profile.email))
      fail(409, 'Este correo ya tiene una cuenta. Ingresa con tu contrasena.');
    const id = randomUUID(),
      first = String(profile.given_name || 'Usuario').slice(0, 60),
      last = String(profile.family_name || 'Google').slice(0, 60),
      now = new Date().toISOString();
    transaction(() => {
      database
        .prepare(
          'INSERT INTO users(id,full_name,email,password_hash,role,created_at,first_name,last_name,terms_accepted_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          `${first} ${last}`,
          profile.email.toLowerCase(),
          passwordHash(randomBytes(32).toString('hex')),
          saved.role,
          now,
          first,
          last,
          now,
        );
      database.prepare('INSERT INTO oauth_identities VALUES(?,?,?)').run('google', profile.sub, id);
    });
    account = database.prepare('SELECT * FROM users WHERE id=?').get(id);
  }
  if (account.status !== 'active') fail(403, 'Esta cuenta esta suspendida.');
  session(response, account);
  audit(account.id, 'auth.google', 'user', account.id);
  const sessionCookie = response.getHeader('Set-Cookie');
  response.setHeader('Set-Cookie', [
    sessionCookie,
    'aurum_oauth=; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=0',
  ]);
  response.writeHead(302, { Location: '/#/dashboard' });
  response.end();
  return true;
}
module.exports = { google, configured };
