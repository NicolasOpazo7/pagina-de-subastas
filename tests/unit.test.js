const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
process.env.AURUM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-unit-'));
const { passwordHash, passwordMatches, validatePassword, integer } = require('../backend/security');
const { prepareImages } = require('../backend/images');
const { PNG } = require('pngjs');
test('Argon2id usa sales diferentes y verifica contrasenas', () => {
  const first = passwordHash('Testing123!'),
    second = passwordHash('Testing123!');
  assert(first.startsWith('argon2id:'));
  assert.notEqual(first, second);
  assert(passwordMatches('Testing123!', first));
  assert(!passwordMatches('Incorrect123!', first));
});
test('Contrasenas debiles y montos fraccionarios no se aceptan', () => {
  assert.throws(() => validatePassword('12345678'));
  assert.throws(() => validatePassword('OnlyLetters'));
  assert.throws(() => integer(1.5, 'Monto'));
  assert.throws(() => integer(Number.MAX_SAFE_INTEGER + 1, 'Monto'));
  assert.equal(integer(150000, 'Monto'), 150000);
});
test('Imagenes se reencodifican y archivos con contenido agregado se rechazan', () => {
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(255);
  const source = Buffer.concat([PNG.sync.write(png), Buffer.from('TRAILING_UNTRUSTED_CONTENT')]);
  assert.throws(() =>
    prepareImages([{ data: `data:image/png;base64,${source.toString('base64')}` }]),
  );
  const [prepared] = prepareImages([
    { data: `data:image/png;base64,${PNG.sync.write(png).toString('base64')}` },
  ]);
  assert.equal(prepared.file.buffer.includes(Buffer.from('TRAILING_UNTRUSTED_CONTENT')), false);
  assert.equal(PNG.sync.read(prepared.file.buffer).width, 2);
  assert.throws(() => prepareImages([{ data: 'data:image/svg+xml;base64,PHN2Zz4=' }]));
  assert.throws(() => prepareImages([{ id: 'imagen-ajena' }], []));
});
after(() => require('../backend/database').database.close());
