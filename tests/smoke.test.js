const assert = require('assert');
const port = Number(process.env.TEST_PORT || 5607);
const baseUrl = `http://localhost:${port}`;

const pages = [
  {
    path: '/',
    checks: ['Aurum Subastas', 'main', 'modal'],
  },
  {
    path: '/pages/login.html',
    checks: ['Aurum Subastas', 'app.js'],
  },
  {
    path: '/pages/registro.html',
    checks: ['Aurum Subastas', 'app.js'],
  },
  {
    path: '/pages/perfil.html',
    checks: ['Aurum Subastas', 'app.js'],
  },
  {
    path: '/pages/subir-producto.html',
    checks: ['Aurum Subastas', 'app.js'],
  },
  {
    path: '/pages/producto.html?id=test',
    checks: ['Aurum Subastas', 'app.js'],
  },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(process) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error('El servidor termino antes de responder.');
    }

    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch (_) {
      await wait(150);
    }
  }

  throw new Error('El servidor no respondio a tiempo.');
}

function getLocalAssets(html, pagePath) {
  const matches = Array.from(html.matchAll(/\b(?:href|src)="([^"]+)"/g));
  return matches
    .map((match) => match[1])
    .filter(
      (asset) =>
        asset &&
        !asset.startsWith('http') &&
        !asset.startsWith('#') &&
        !asset.startsWith('mailto:') &&
        !asset.includes('?category='),
    )
    .map((asset) => new URL(asset, `${baseUrl}${pagePath}`).pathname);
}

async function assertPage(page) {
  const response = await fetch(`${baseUrl}${page.path}`);
  assert.strictEqual(response.status, 200, `${page.path} debe responder 200`);
  assert.match(
    response.headers.get('content-type') || '',
    /text\/html/,
    `${page.path} debe ser HTML`,
  );

  const html = await response.text();
  page.checks.forEach((text) => {
    assert(html.includes(text), `${page.path} debe contener ${text}`);
  });

  const assets = getLocalAssets(html, '/');
  for (const asset of assets) {
    const assetResponse = await fetch(`${baseUrl}${asset}`);
    assert.strictEqual(assetResponse.status, 200, `Asset local no encontrado: ${asset}`);
  }
}

async function assertNotFound() {
  const response = await fetch(`${baseUrl}/no-existe.html`);
  assert.strictEqual(response.status, 404, 'Las rutas inexistentes deben responder 404');
}

async function main() {
  process.env.PORT = String(port);
  process.env.AURUM_DATA_DIR = require('node:fs').mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'aurum-smoke-'),
  );
  const server = require('../server');

  try {
    await waitForServer({ exitCode: null });

    for (const page of pages) {
      await assertPage(page);
    }

    await assertNotFound();
    for (const file of [
      '/data/aurum.sqlite',
      '/.env',
      '/backend/api.js',
      '/database/migrations/001_initial_schema.sql',
      '/package.json',
      '/%zz',
    ]) {
      const response = await fetch(`${baseUrl}${file}`);
      assert([400, 404].includes(response.status), `Archivo privado expuesto: ${file}`);
    }
    console.log('Smoke tests OK');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await server.shutdown();
    require('../backend/database').database.close();
  }
}

main();
