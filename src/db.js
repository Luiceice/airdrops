import Database from "better-sqlite3";

const db = new Database("membership.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  session_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_hash TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  amount_usdt TEXT NOT NULL,
  amount_units TEXT NOT NULL,
  token_contract TEXT NOT NULL,
  payment_address TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_hash TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  matched_from_address TEXT
);

CREATE TABLE IF NOT EXISTS query_usage (
  session_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (session_id, usage_date)
);

CREATE TABLE IF NOT EXISTS chain_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_transfers (
  tx_hash TEXT PRIMARY KEY,
  token_contract TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  amount_units TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  order_id TEXT
);
`);

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_status_expires
    ON orders(status, expires_at);

    CREATE INDEX IF NOT EXISTS idx_orders_amount_status_addr
    ON orders(amount_units, status, payment_address);

    CREATE INDEX IF NOT EXISTS idx_orders_session_status
    ON orders(session_id, status);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tx_hash_unique
    ON orders(tx_hash)
    WHERE tx_hash IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_memberships_status
    ON memberships(status);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_tx_hash
    ON memberships(tx_hash);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_tx_hash
    ON processed_transfers(tx_hash);
  `);
} catch (e) {
  console.error("Index creation error:", e);
}

export default db;