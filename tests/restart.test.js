const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
process.env.AURUM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-restart-'));
const { database } = require('../backend/database');
const timestamp = new Date(Date.now() - 60000).toISOString();
database
  .prepare(
    'INSERT INTO users(id,full_name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',
  )
  .run('seller', 'Vendedor Prueba', 'seller@restart.test', 'not-used', 'subastador', timestamp);
database
  .prepare(
    'INSERT INTO users(id,full_name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',
  )
  .run('client', 'Cliente Prueba', 'client@restart.test', 'not-used', 'usuario', timestamp);
database
  .prepare(
    'INSERT INTO products(id,seller_id,title,description,category,starting_price,current_price,minimum_increment,ends_at,created_at,starts_at,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
  )
  .run(
    'recover',
    'seller',
    'Recuperacion al reiniciar',
    'Prueba de cierre despues de una interrupcion',
    'hogar',
    1000,
    2000,
    1000,
    timestamp,
    timestamp,
    timestamp,
    'active',
  );
database
  .prepare('INSERT INTO bids VALUES(?,?,?,?,?,?)')
  .run('bid', 'recover', 'client', 2000, 'restart-key', timestamp);
database.close();
async function boot() {
  const child = spawn(process.execPath, ['--experimental-sqlite', 'server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: '5620' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', (chunk) => (errors += chunk));
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (child.exitCode !== null) throw new Error(errors);
      try {
        const response = await fetch('http://localhost:5620/api/auctions/recover');
        if (response.ok) {
          const result = (await response.json()).data;
          assert.equal(result.state, 'finalized');
          assert.equal(result.result.winner_id, 'client');
          return;
        }
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('No respondio el servidor reiniciado.');
  } finally {
    const finished = once(child, 'exit');
    child.kill();
    if (child.exitCode === null) await finished;
  }
}
async function main() {
  await boot();
  await boot();
  const { DatabaseSync } = require('node:sqlite');
  const reopened = new DatabaseSync(path.join(process.env.AURUM_DATA_DIR, 'aurum.sqlite'));
  assert.equal(reopened.prepare('SELECT count(*) AS n FROM auction_results').get().n, 1);
  assert.equal(reopened.prepare('SELECT count(*) AS n FROM deals').get().n, 1);
  reopened.close();
  console.log(
    'Reinicio OK: cierre recuperado y resultado/acuerdo sin duplicados despues de dos arranques.',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
