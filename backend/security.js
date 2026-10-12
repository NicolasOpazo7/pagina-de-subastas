const { randomBytes, createHash, timingSafeEqual, scryptSync } = require('node:crypto');
const { argon2id } = require('@noble/hashes/argon2');

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
function passwordHash(password) {
  const salt = randomBytes(16);
  const digest = argon2id(password, salt, { t: 2, m: 19456, p: 1, dkLen: 32 });
  return `argon2id:${salt.toString('hex')}:${Buffer.from(digest).toString('hex')}`;
}
function passwordMatches(password, encoded) {
  if (encoded.startsWith('argon2id:')) {
    const [, salt, digest] = encoded.split(':');
    return timingSafeEqual(
      Buffer.from(
        argon2id(password, Buffer.from(salt, 'hex'), { t: 2, m: 19456, p: 1, dkLen: 32 }),
      ),
      Buffer.from(digest, 'hex'),
    );
  }
  const [salt, digest] = encoded.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(digest, 'hex'));
}
function validatePassword(password) {
  if (
    typeof password !== 'string' ||
    password.length < 8 ||
    password.length > 128 ||
    !/[a-z]/i.test(password) ||
    !/[0-9]/.test(password)
  )
    fail(400, 'La contrasena debe tener entre 8 y 128 caracteres, una letra y un numero.');
}
async function readJSON(request, limit = 65536) {
  if (!(request.headers['content-type'] || '').startsWith('application/json'))
    fail(415, 'Utiliza JSON.');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) fail(413, 'La solicitud excede el tamano permitido.');
    chunks.push(chunk);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail(400, 'Solicitud JSON invalida.');
  }
  if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, 'Solicitud invalida.');
  return data;
}
function integer(value, label, optional = false) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1000000000000)
    fail(400, `${label} debe ser un entero positivo en CLP.`);
  return value;
}
function text(value, label, max = 160, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
    fail(400, `${label}: usa entre ${min} y ${max} caracteres.`);
  return value.trim();
}
module.exports = {
  fail,
  hash,
  passwordHash,
  passwordMatches,
  validatePassword,
  readJSON,
  integer,
  text,
};
