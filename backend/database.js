const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const environmentFile = path.join(__dirname, '../.env');
if (fs.existsSync(environmentFile)) process.loadEnvFile(environmentFile);

const directory = path.resolve(process.env.AURUM_DATA_DIR || path.join(__dirname, '../data'));
fs.mkdirSync(directory, { recursive: true });
const database = new DatabaseSync(path.join(directory, 'aurum.sqlite'));
const { randomUUID } = require('node:crypto');
const events = new (require('node:events').EventEmitter)();
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('usuario','subastador','admin')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
    description TEXT NOT NULL, category TEXT NOT NULL,
    starting_price INTEGER NOT NULL CHECK(starting_price > 0),
    current_price INTEGER NOT NULL CHECK(current_price > 0),
    minimum_increment INTEGER NOT NULL DEFAULT 1000 CHECK(minimum_increment > 0),
    ends_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','cancelled')),
    is_featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bids (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
    user_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL CHECK(amount > 0),
    idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(user_id, idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS bids_product ON bids(product_id, amount DESC, created_at);
  CREATE INDEX IF NOT EXISTS products_closing ON products(status, ends_at);
  CREATE TABLE IF NOT EXISTS auction_results (
    product_id TEXT PRIMARY KEY REFERENCES products(id), winner_id TEXT REFERENCES users(id),
    winning_bid_id TEXT REFERENCES bids(id), final_amount INTEGER, closed_at TEXT NOT NULL,
    coordination_status TEXT NOT NULL DEFAULT 'pending'
  );
`);
require('./migrate')(database);

function notify(userId, type, title, message, productId = null, key = null) {
  const id = randomUUID();
  return database
    .prepare(
      'INSERT OR IGNORE INTO notifications(id,user_id,type,title,message,product_id,event_key,created_at) VALUES(?,?,?,?,?,?,?,?)',
    )
    .run(id, userId, type, title, message, productId, key, new Date().toISOString()).changes;
}
function audit(actor, action, entityType, entityId, metadata = {}) {
  database
    .prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?)')
    .run(
      randomUUID(),
      actor,
      action,
      entityType,
      entityId,
      JSON.stringify(metadata),
      new Date().toISOString(),
    );
}

function transaction(operation) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function closeExpiredAuctions() {
  return transaction(() => {
    const now = new Date().toISOString();
    const activated = database
      .prepare(
        "UPDATE products SET state='active' WHERE state='scheduled' AND starts_at<=? AND ends_at>? AND status='open'",
      )
      .run(now, now).changes;
    const products = database
      .prepare(
        "SELECT * FROM products WHERE status = 'open' AND state IN ('active','scheduled') AND ends_at <= ?",
      )
      .all(now);
    for (const product of products) {
      const winner = database
        .prepare('SELECT * FROM bids WHERE product_id = ? ORDER BY amount DESC, rowid ASC LIMIT 1')
        .get(product.id);
      const reserveMet =
        winner && (!product.reserve_price || winner.amount >= product.reserve_price);
      database
        .prepare(
          'INSERT OR IGNORE INTO auction_results(product_id,winner_id,winning_bid_id,final_amount,closed_at) VALUES(?,?,?,?,?)',
        )
        .run(
          product.id,
          reserveMet ? winner.user_id : null,
          reserveMet ? winner.id : null,
          winner?.amount || null,
          now,
        );
      database
        .prepare("UPDATE products SET status='closed',state='finalized' WHERE id=?")
        .run(product.id);
      if (reserveMet) {
        database
          .prepare(
            'INSERT OR IGNORE INTO deals(id,product_id,seller_id,buyer_id,final_price,created_at) VALUES(?,?,?,?,?,?)',
          )
          .run(randomUUID(), product.id, product.seller_id, winner.user_id, winner.amount, now);
        notify(
          winner.user_id,
          'won',
          'Ganaste la subasta',
          product.title,
          product.id,
          `won:${product.id}`,
        );
      }
      const participants = database
        .prepare('SELECT DISTINCT user_id FROM bids WHERE product_id=?')
        .all(product.id);
      for (const user of participants)
        if (!reserveMet || user.user_id !== winner.user_id)
          notify(
            user.user_id,
            'lost',
            'Subasta finalizada',
            product.title,
            product.id,
            `lost:${product.id}:${user.user_id}`,
          );
      notify(
        product.seller_id,
        'closed',
        'Tu subasta finalizo',
        reserveMet ? 'Coordina la entrega desde tu perfil.' : 'Finalizo sin adjudicacion.',
        product.id,
        `closed:${product.id}`,
      );
      audit(null, 'auction.closed', 'auction', product.id, {
        winner: reserveMet ? winner.user_id : null,
        reserveMet: Boolean(reserveMet),
      });
    }
    const ending = database
      .prepare(
        "SELECT id,title FROM products WHERE status='open' AND state='active' AND ends_at>? AND ends_at<=?",
      )
      .all(now, new Date(Date.now() + 3600000).toISOString());
    let reminders = 0;
    for (const product of ending) {
      const participants = database
        .prepare(
          'SELECT DISTINCT user_id FROM bids WHERE product_id=? UNION SELECT user_id FROM favorites WHERE product_id=?',
        )
        .all(product.id, product.id);
      for (const user of participants)
        reminders += notify(
          user.user_id,
          'ending',
          'Subasta proxima a finalizar',
          product.title,
          product.id,
          `ending:${product.id}:${user.user_id}`,
        );
    }
    return products.length + activated + reminders;
  });
}

module.exports = { database, directory, transaction, closeExpiredAuctions, notify, audit, events };
