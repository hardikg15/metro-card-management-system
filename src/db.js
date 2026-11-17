import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

// Money is stored as integer paise (exact decimal arithmetic, no float drift).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS passengers (
  passenger_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, age INTEGER NOT NULL CHECK (age BETWEEN 5 AND 120),
  address TEXT NOT NULL, contact_no TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  passenger_id INTEGER REFERENCES passengers(passenger_id),
  username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('PASSENGER','STAFF','ADMIN')),
  account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE','DISABLED')),
  CHECK (role <> 'PASSENGER' OR passenger_id IS NOT NULL));
CREATE TABLE IF NOT EXISTS metro_cards (
  card_id TEXT PRIMARY KEY,
  passenger_id INTEGER NOT NULL REFERENCES passengers(passenger_id),
  issue_date TEXT NOT NULL DEFAULT (datetime('now')),
  balance_paise INTEGER NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
  card_status TEXT NOT NULL CHECK (card_status IN ('REQUESTED','ISSUED','ACTIVE','BLOCKED','EXPIRED')));
CREATE TABLE IF NOT EXISTS recharges (
  recharge_id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES metro_cards(card_id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  recharge_date TEXT NOT NULL DEFAULT (datetime('now')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('PENDING','SUCCESS','FAILED')),
  payment_reference TEXT, idempotency_key TEXT NOT NULL,
  UNIQUE (card_id, idempotency_key));
CREATE UNIQUE INDEX IF NOT EXISTS ux_recharge_payref ON recharges(payment_reference) WHERE payment_reference IS NOT NULL;
CREATE TABLE IF NOT EXISTS stations (
  station_id INTEGER PRIMARY KEY AUTOINCREMENT, station_name TEXT NOT NULL UNIQUE, location TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES metro_cards(card_id),
  entry_station_id INTEGER NOT NULL REFERENCES stations(station_id),
  exit_station_id INTEGER NOT NULL REFERENCES stations(station_id),
  fare_paise INTEGER NOT NULL CHECK (fare_paise >= 0),
  travel_date_time TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS ix_cards_passenger ON metro_cards(passenger_id);
CREATE INDEX IF NOT EXISTS ix_recharges_card ON recharges(card_id, recharge_date DESC);
CREATE INDEX IF NOT EXISTS ix_tx_card ON transactions(card_id, travel_date_time DESC);
`;

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function seed(db, { rounds = 10 } = {}) {
  const hash = (p) => bcrypt.hashSync(p, rounds);
  const st = db.prepare('INSERT INTO stations (station_name, location) VALUES (?,?)');
  [['Rajiv Chowk', 'Connaught Place'], ['Kashmere Gate', 'North Delhi'], ['Hauz Khas', 'South Delhi'],
   ['Dwarka Sector 21', 'West Delhi'], ['Noida City Centre', 'Noida'], ['Huda City Centre', 'Gurugram']]
    .forEach((s) => st.run(...s));
  const ps = db.prepare('INSERT INTO passengers (name, age, address, contact_no, email) VALUES (?,?,?,?,?)');
  ps.run('Asha Verma', 29, '12 Lodhi Road, New Delhi', '9810000001', 'asha@mcms.test');
  ps.run('Ravi Kumar', 34, '8 Sector 15, Noida', '9810000002', 'ravi@mcms.test');
  const us = db.prepare('INSERT INTO users (passenger_id, username, password_hash, role) VALUES (?,?,?,?)');
  us.run(null, 'admin@mcms.test', hash('Admin@123'), 'ADMIN');
  us.run(null, 'staff@mcms.test', hash('Staff@123'), 'STAFF');
  us.run(1, 'asha@mcms.test', hash('Passenger@123'), 'PASSENGER');
  us.run(2, 'ravi@mcms.test', hash('Passenger@123'), 'PASSENGER');
  const cs = db.prepare('INSERT INTO metro_cards (card_id, passenger_id, balance_paise, card_status) VALUES (?,?,?,?)');
  cs.run('MC10000001', 1, 20000, 'ACTIVE');
  cs.run('MC10000002', 1, 5000, 'BLOCKED');
  cs.run('MC10000003', 2, 12000, 'ACTIVE');
  const tx = db.prepare('INSERT INTO transactions (card_id, entry_station_id, exit_station_id, fare_paise, travel_date_time) VALUES (?,?,?,?,?)');
  tx.run('MC10000001', 1, 3, 3000, '2026-11-10 09:05:00');
  tx.run('MC10000001', 3, 1, 3000, '2026-11-10 18:20:00');
  tx.run('MC10000003', 2, 5, 4500, '2026-11-12 08:40:00');
  const rc = db.prepare('INSERT INTO recharges (card_id, amount_paise, recharge_date, payment_status, payment_reference, idempotency_key) VALUES (?,?,?,?,?,?)');
  rc.run('MC10000001', 20000, '2026-11-01 10:00:00', 'SUCCESS', 'SEED-0001', 'seed-1');
  rc.run('MC10000003', 10000, '2026-11-02 11:30:00', 'FAILED', 'SEED-0002', 'seed-2');
}
