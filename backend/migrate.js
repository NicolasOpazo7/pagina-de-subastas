function migrate(database) {
  const add = (table, name, definition) => {
    if (
      !database
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((column) => column.name === name)
    )
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  for (const [name, definition] of Object.entries({
    first_name: "TEXT NOT NULL DEFAULT ''",
    last_name: "TEXT NOT NULL DEFAULT ''",
    status: "TEXT NOT NULL DEFAULT 'active'",
    avatar_url: 'TEXT',
    notifications_enabled: 'INTEGER NOT NULL DEFAULT 1',
    terms_accepted_at: 'TEXT',
  }))
    add('users', name, definition);
  for (const [name, definition] of Object.entries({
    state: "TEXT NOT NULL DEFAULT 'active'",
    starts_at: 'TEXT',
    reserve_price: 'INTEGER',
    brand: "TEXT NOT NULL DEFAULT ''",
    model: "TEXT NOT NULL DEFAULT ''",
    condition: "TEXT NOT NULL DEFAULT 'used'",
    location: "TEXT NOT NULL DEFAULT ''",
    features: "TEXT NOT NULL DEFAULT ''",
    delivery_terms: "TEXT NOT NULL DEFAULT ''",
    updated_at: 'TEXT',
  }))
    add('products', name, definition);
  database.exec(`
    UPDATE products SET starts_at=created_at WHERE starts_at IS NULL;
    UPDATE products SET state='finalized' WHERE status='closed' AND state='active';
    CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY,name TEXT NOT NULL,icon TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS product_images(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,image_url TEXT NOT NULL,position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS favorites(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(user_id,product_id));
    CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,type TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,product_id TEXT REFERENCES products(id),is_read INTEGER NOT NULL DEFAULT 0,event_key TEXT UNIQUE,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,is_read,created_at);
    CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY,actor_id TEXT REFERENCES users(id),action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,metadata TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS password_reset_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL,used_at TEXT);
    CREATE TABLE IF NOT EXISTS deals(id TEXT PRIMARY KEY,product_id TEXT NOT NULL UNIQUE REFERENCES products(id),seller_id TEXT NOT NULL REFERENCES users(id),buyer_id TEXT NOT NULL REFERENCES users(id),final_price INTEGER NOT NULL,seller_confirmed INTEGER NOT NULL DEFAULT 0,buyer_confirmed INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deal_messages(id TEXT PRIMARY KEY,deal_id TEXT NOT NULL REFERENCES deals(id),sender_id TEXT NOT NULL REFERENCES users(id),message TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_deal ON deal_messages(deal_id,created_at);
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL REFERENCES users(id),product_id TEXT NOT NULL REFERENCES products(id),reason TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reviewed_by TEXT REFERENCES users(id),created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_states(state_hash TEXT PRIMARY KEY,verifier TEXT NOT NULL,role TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_identities(provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(provider,subject));
    CREATE TRIGGER IF NOT EXISTS products_validate_insert BEFORE INSERT ON products BEGIN
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM categories WHERE id=NEW.category) THEN RAISE(ABORT,'Categoria invalida') END;
      SELECT CASE WHEN typeof(NEW.starting_price)!='integer' OR typeof(NEW.current_price)!='integer' OR typeof(NEW.minimum_increment)!='integer' THEN RAISE(ABORT,'Los montos deben ser enteros') END;
      SELECT CASE WHEN NEW.state NOT IN ('draft','scheduled','active','finalized','cancelled','suspended') THEN RAISE(ABORT,'Estado invalido') END;
    END;
    CREATE TRIGGER IF NOT EXISTS products_validate_update BEFORE UPDATE ON products BEGIN
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM categories WHERE id=NEW.category) THEN RAISE(ABORT,'Categoria invalida') END;
      SELECT CASE WHEN typeof(NEW.starting_price)!='integer' OR typeof(NEW.current_price)!='integer' OR typeof(NEW.minimum_increment)!='integer' THEN RAISE(ABORT,'Los montos deben ser enteros') END;
      SELECT CASE WHEN NEW.state NOT IN ('draft','scheduled','active','finalized','cancelled','suspended') THEN RAISE(ABORT,'Estado invalido') END;
    END;
    CREATE TRIGGER IF NOT EXISTS bids_immutable BEFORE UPDATE ON bids BEGIN SELECT RAISE(ABORT,'Las pujas no pueden modificarse'); END;
    CREATE TRIGGER IF NOT EXISTS bids_no_delete BEFORE DELETE ON bids BEGIN SELECT RAISE(ABORT,'Las pujas no pueden eliminarse'); END;
    CREATE TRIGGER IF NOT EXISTS deals_sync_insert AFTER INSERT ON deals BEGIN UPDATE auction_results SET coordination_status=NEW.status WHERE product_id=NEW.product_id; END;
    CREATE TRIGGER IF NOT EXISTS deals_sync_update AFTER UPDATE OF status ON deals BEGIN UPDATE auction_results SET coordination_status=NEW.status WHERE product_id=NEW.product_id; END;
    INSERT OR IGNORE INTO schema_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  `);
  const categories = [
    ['tecnologia', 'Tecnologia', 'monitor'],
    ['joyeria', 'Joyeria', 'gem'],
    ['hogar', 'Hogar', 'house'],
    ['relojeria', 'Relojeria', 'watch'],
    ['musica', 'Musica', 'music'],
    ['fotografia', 'Fotografia', 'camera'],
    ['vehiculos', 'Vehiculos', 'car'],
    ['ropa', 'Ropa y accesorios', 'shirt'],
    ['coleccionables', 'Coleccionables', 'archive'],
    ['arte', 'Arte', 'palette'],
    ['deportes', 'Deportes', 'bike'],
    ['herramientas', 'Herramientas', 'wrench'],
    ['videojuegos', 'Videojuegos', 'gamepad-2'],
    ['otros', 'Otros', 'package'],
  ];
  for (const category of categories)
    database.prepare('INSERT OR IGNORE INTO categories VALUES(?,?,?)').run(...category);
}
module.exports = migrate;
