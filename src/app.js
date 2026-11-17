import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomInt } from 'node:crypto';
import { createMockPayment } from './payment.js';

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const MAX_RECHARGE_PAISE = 10000 * 100;
const NEXT = { REQUESTED: ['ISSUED'], ISSUED: ['ACTIVE'], ACTIVE: ['BLOCKED', 'EXPIRED'], BLOCKED: ['ACTIVE', 'EXPIRED'], EXPIRED: [] };
const rupees = (p) => (p / 100).toFixed(2);

// Parses a rupee amount into integer paise. Rejects <= 0, non-numeric, >2 decimals.
export function toPaise(v) {
  const s = String(v ?? '').trim();
  if ((typeof v === 'number' || typeof v === 'string') && s !== '' && Number(s) <= 0) throw bad('Amount must be greater than zero');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw bad('Amount must be a number with at most 2 decimal places');
  const p = Math.round(Number(s) * 100);
  if (p <= 0) throw bad('Amount must be greater than zero');
  return p;
}
const fareToPaise = (v) => {
  const s = String(v ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw bad('Fare must be zero or a positive number');
  return Math.round(Number(s) * 100);
};

const cardOut = (c) => ({ cardId: c.card_id, passengerId: c.passenger_id, passengerName: c.name, issueDate: c.issue_date, balance: rupees(c.balance_paise), status: c.card_status });
const rechargeOut = (r) => ({ rechargeId: r.recharge_id, cardId: r.card_id, amount: rupees(r.amount_paise), date: r.recharge_date, status: r.payment_status, reference: r.payment_reference });
const passengerOut = (p) => ({ passengerId: p.passenger_id, name: p.name, age: p.age, address: p.address, contactNo: p.contact_no, email: p.email, createdAt: p.created_at });
const CARD_SQL = 'SELECT c.*, p.name FROM metro_cards c JOIN passengers p USING (passenger_id)';

export function createApp({ db, payment = createMockPayment(), jwtSecret = 'dev-secret', rounds = 10, allowSimulate = true } = {}) {
  const app = express();
  app.use(express.json({ limit: '50kb' }));
  app.use(express.static(new URL('../public', import.meta.url).pathname));

  // Explicit transaction helper (node:sqlite is synchronous, so BEGIN IMMEDIATE serialises writers).
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  const str = (v, name, min = 1, max = 200) => {
    if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw bad(`${name} is required`);
    return v.trim();
  };
  const validateProfile = (b) => {
    const age = Number(b.age);
    if (!Number.isInteger(age) || age < 5 || age > 120) throw bad('Age must be between 5 and 120');
    const email = str(b.email, 'Email').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email is invalid');
    const contact = str(b.contactNo, 'Contact number');
    if (!/^[0-9+\-\s]{7,15}$/.test(contact)) throw bad('Contact number is invalid');
    return { name: str(b.name, 'Name'), age, address: str(b.address, 'Address'), contact, email };
  };
  const passwordOk = (p) => { if (typeof p !== 'string' || p.length < 8 || p.length > 72) throw bad('Password must be 8-72 characters'); return p; };
  const sign = (u) => jwt.sign({ sub: u.user_id }, jwtSecret, { expiresIn: '8h' });

  // --- AuthN / AuthZ (always enforced server-side; user re-read each request so disabled accounts lose access)
  const auth = (req, _res, next) => {
    try {
      const t = jwt.verify((req.get('authorization') || '').replace(/^Bearer /, ''), jwtSecret);
      const u = db.prepare('SELECT user_id, passenger_id, username, role, account_status FROM users WHERE user_id = ?').get(t.sub);
      if (!u || u.account_status !== 'ACTIVE') throw new Error('inactive');
      req.user = u; next();
    } catch { next(new HttpError(401, 'Authentication required')); }
  };
  const need = (...roles) => (req, _res, next) => roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Insufficient permissions'));
  const isStaff = (u) => u.role !== 'PASSENGER';
  const loadCard = (user, id) => {
    const c = db.prepare(`${CARD_SQL} WHERE c.card_id = ?`).get(id);
    if (!c) throw new HttpError(404, 'Card not found');
    if (!isStaff(user) && c.passenger_id !== user.passenger_id) throw new HttpError(403, 'Access denied');
    return c;
  };
  const page = (req) => ({ limit: Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100), offset: Math.max(parseInt(req.query.offset) || 0, 0) });

  app.get('/api/health', (_q, r) => r.json({ ok: true }));

  // FR-01 / FR-02: registration & login
  app.post('/api/auth/register', (req, res) => {
    const p = validateProfile(req.body); passwordOk(req.body.password);
    const hash = bcrypt.hashSync(req.body.password, rounds);
    const user = tx(() => {
      const pid = db.prepare('INSERT INTO passengers (name, age, address, contact_no, email) VALUES (?,?,?,?,?)').run(p.name, p.age, p.address, p.contact, p.email).lastInsertRowid;
      const uid = db.prepare("INSERT INTO users (passenger_id, username, password_hash, role) VALUES (?,?,?,'PASSENGER')").run(pid, p.email, hash).lastInsertRowid;
      return { user_id: Number(uid) };
    });
    res.status(201).json({ token: sign(user) });
  });
  app.post('/api/auth/login', (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.body?.username ?? '').toLowerCase());
    const ok = u && bcrypt.compareSync(String(req.body?.password ?? ''), u.password_hash);
    if (!ok) throw new HttpError(401, 'Invalid username or password');
    if (u.account_status !== 'ACTIVE') throw new HttpError(403, 'Account is disabled');
    res.json({ token: sign(u) });
  });
  app.get('/api/me', auth, (req, res) => {
    const p = req.user.passenger_id && db.prepare('SELECT * FROM passengers WHERE passenger_id = ?').get(req.user.passenger_id);
    res.json({ userId: req.user.user_id, username: req.user.username, role: req.user.role, allowSimulate, passenger: p ? passengerOut(p) : null });
  });

  app.get('/api/stations', auth, (_q, res) => res.json(db.prepare('SELECT station_id AS stationId, station_name AS name, location FROM stations ORDER BY station_name').all()));

  // FR-14: staff/admin passenger lookup
  app.get('/api/passengers', auth, need('STAFF', 'ADMIN'), (req, res) => {
    const q = `%${String(req.query.q ?? '').trim()}%`; const { limit, offset } = page(req);
    res.json(db.prepare('SELECT * FROM passengers WHERE name LIKE ? OR email LIKE ? OR contact_no LIKE ? ORDER BY passenger_id DESC LIMIT ? OFFSET ?').all(q, q, q, limit, offset).map(passengerOut));
  });

  // Cards (FR-04, FR-05, FR-06)
  app.get('/api/cards', auth, (req, res) => {
    if (!isStaff(req.user)) return res.json(db.prepare(`${CARD_SQL} WHERE c.passenger_id = ? ORDER BY c.card_id`).all(req.user.passenger_id).map(cardOut));
    const q = `%${String(req.query.q ?? '').trim()}%`; const { limit, offset } = page(req);
    res.json(db.prepare(`${CARD_SQL} WHERE c.card_id LIKE ? OR p.name LIKE ? ORDER BY c.card_id LIMIT ? OFFSET ?`).all(q, q, limit, offset).map(cardOut));
  });
  app.get('/api/cards/:cardId', auth, (req, res) => res.json(cardOut(loadCard(req.user, req.params.cardId))));
  app.post('/api/cards', auth, need('STAFF', 'ADMIN'), (req, res) => {
    const pid = Number(req.body?.passengerId);
    if (!db.prepare('SELECT 1 FROM passengers WHERE passenger_id = ?').get(pid)) throw new HttpError(404, 'Passenger not found');
    for (let i = 0; i < 5; i++) {
      const id = `MC${randomInt(10000000, 99999999)}`;
      try { db.prepare("INSERT INTO metro_cards (card_id, passenger_id, card_status) VALUES (?,?,'ISSUED')").run(id, pid); return res.status(201).json(cardOut(db.prepare(`${CARD_SQL} WHERE c.card_id = ?`).get(id))); }
      catch (e) { if (!/UNIQUE/.test(e.message)) throw e; }
    }
    throw new Error('Could not allocate unique card id');
  });
  app.patch('/api/cards/:cardId/status', auth, (req, res) => {
    const to = req.body?.status; const card = loadCard(req.user, req.params.cardId);
    if (!NEXT[card.card_status]?.includes(to)) throw new HttpError(409, `Cannot change card from ${card.card_status} to ${to}`);
    // Passengers may only report a lost card / request a block; unblocking needs staff verification.
    if (!isStaff(req.user) && to !== 'BLOCKED') throw new HttpError(403, 'Only staff can perform this change');
    db.prepare('UPDATE metro_cards SET card_status = ? WHERE card_id = ?').run(to, card.card_id);
    res.json(cardOut(db.prepare(`${CARD_SQL} WHERE c.card_id = ?`).get(card.card_id)));
  });

  // Recharge (FR-07..FR-11). Balance changes ONLY on confirmed SUCCESS; each (card, idempotency key) is processed once.
  app.post('/api/cards/:cardId/recharges', auth, async (req, res) => {
    const amountPaise = toPaise(req.body?.amount);
    if (amountPaise > MAX_RECHARGE_PAISE) throw bad('Maximum recharge is 10000.00');
    const key = String(req.get('Idempotency-Key') ?? req.body?.idempotencyKey ?? '').trim();
    if (!key || key.length > 100) throw bad('Idempotency-Key is required (max 100 chars)');
    const cardId = req.params.cardId;

    // Phase 1: validate + record PENDING (or replay a previous result for the same key)
    const phase1 = tx(() => {
      const card = loadCard(req.user, cardId);
      const prev = db.prepare('SELECT * FROM recharges WHERE card_id = ? AND idempotency_key = ?').get(cardId, key);
      if (prev) {
        if (prev.amount_paise !== amountPaise) throw new HttpError(422, 'Idempotency-Key was already used with a different amount');
        return { replay: prev };
      }
      if (card.card_status !== 'ACTIVE') throw new HttpError(409, `Card is ${card.card_status}; only ACTIVE cards can be recharged`);
      const id = db.prepare("INSERT INTO recharges (card_id, amount_paise, payment_status, idempotency_key) VALUES (?,?,'PENDING',?)").run(cardId, amountPaise, key).lastInsertRowid;
      return { id: Number(id) };
    });
    const balanceOf = () => rupees(db.prepare('SELECT balance_paise FROM metro_cards WHERE card_id = ?').get(cardId).balance_paise);
    if (phase1.replay) return res.status(phase1.replay.payment_status === 'PENDING' ? 202 : 200).json({ recharge: rechargeOut(phase1.replay), balance: balanceOf(), replayed: true });

    // Phase 2: call mock provider outside the DB transaction
    let result;
    try { result = await payment.charge({ amountPaise, simulate: allowSimulate ? req.body?.simulate : undefined }); }
    catch { result = { status: 'FAILED', reference: null }; }

    // Phase 3: settle exactly once. The PENDING->final guard makes double-credit impossible.
    const final = tx(() => {
      const status = result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
      const moved = db.prepare("UPDATE recharges SET payment_status = ?, payment_reference = ? WHERE recharge_id = ? AND payment_status = 'PENDING'").run(status, result.reference ?? null, phase1.id).changes;
      if (moved === 1 && status === 'SUCCESS') db.prepare('UPDATE metro_cards SET balance_paise = balance_paise + ? WHERE card_id = ?').run(amountPaise, cardId);
      return db.prepare('SELECT * FROM recharges WHERE recharge_id = ?').get(phase1.id);
    });
    res.status(201).json({ recharge: rechargeOut(final), balance: balanceOf(), replayed: false });
  });
  app.get('/api/cards/:cardId/recharges', auth, (req, res) => {
    loadCard(req.user, req.params.cardId); const { limit, offset } = page(req);
    const total = db.prepare('SELECT COUNT(*) n FROM recharges WHERE card_id = ?').get(req.params.cardId).n;
    res.json({ total, items: db.prepare('SELECT * FROM recharges WHERE card_id = ? ORDER BY recharge_date DESC, recharge_id DESC LIMIT ? OFFSET ?').all(req.params.cardId, limit, offset).map(rechargeOut) });
  });

  // Travel transactions (FR-12, FR-13)
  const TX_SQL = `SELECT t.*, e.station_name AS entry_name, x.station_name AS exit_name FROM transactions t
    JOIN stations e ON e.station_id = t.entry_station_id JOIN stations x ON x.station_id = t.exit_station_id`;
  const txOut = (t) => ({ transactionId: t.transaction_id, cardId: t.card_id, entryStation: t.entry_name, exitStation: t.exit_name, fare: rupees(t.fare_paise), dateTime: t.travel_date_time });
  app.get('/api/cards/:cardId/transactions', auth, (req, res) => {
    loadCard(req.user, req.params.cardId); const { limit, offset } = page(req);
    const total = db.prepare('SELECT COUNT(*) n FROM transactions WHERE card_id = ?').get(req.params.cardId).n;
    res.json({ total, items: db.prepare(`${TX_SQL} WHERE t.card_id = ? ORDER BY t.travel_date_time DESC, t.transaction_id DESC LIMIT ? OFFSET ?`).all(req.params.cardId, limit, offset).map(txOut) });
  });
  app.post('/api/transactions', auth, need('STAFF', 'ADMIN'), (req, res) => {
    const b = req.body ?? {}; const fare = fareToPaise(b.fare);
    const out = tx(() => {
      const card = db.prepare('SELECT * FROM metro_cards WHERE card_id = ?').get(b.cardId);
      if (!card) throw new HttpError(404, 'Card not found');
      if (card.card_status !== 'ACTIVE') throw new HttpError(409, `Card is ${card.card_status}; travel requires an ACTIVE card`);
      for (const s of [b.entryStationId, b.exitStationId]) if (!db.prepare('SELECT 1 FROM stations WHERE station_id = ?').get(s)) throw bad('Unknown station');
      if (card.balance_paise < fare) throw new HttpError(409, 'Insufficient balance for this fare');
      db.prepare('UPDATE metro_cards SET balance_paise = balance_paise - ? WHERE card_id = ?').run(fare, card.card_id);
      const id = db.prepare("INSERT INTO transactions (card_id, entry_station_id, exit_station_id, fare_paise) VALUES (?,?,?,?)").run(card.card_id, b.entryStationId, b.exitStationId, fare).lastInsertRowid;
      return db.prepare(`${TX_SQL} WHERE t.transaction_id = ?`).get(id);
    });
    res.status(201).json(txOut(out));
  });

  // Administration & reports (FR-15)
  app.get('/api/admin/users', auth, need('ADMIN'), (_q, res) => res.json(db.prepare('SELECT user_id AS userId, username, role, account_status AS status, passenger_id AS passengerId FROM users ORDER BY user_id').all()));
  app.post('/api/admin/users', auth, need('ADMIN'), (req, res) => {
    const role = req.body?.role; if (!['STAFF', 'ADMIN'].includes(role)) throw bad('Role must be STAFF or ADMIN');
    const username = str(req.body?.username, 'Username').toLowerCase(); passwordOk(req.body?.password);
    const id = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?,?,?)').run(username, bcrypt.hashSync(req.body.password, rounds), role).lastInsertRowid;
    res.status(201).json({ userId: Number(id), username, role });
  });
  app.patch('/api/admin/users/:id/status', auth, need('ADMIN'), (req, res) => {
    const s = req.body?.status; if (!['ACTIVE', 'DISABLED'].includes(s)) throw bad('Status must be ACTIVE or DISABLED');
    if (Number(req.params.id) === req.user.user_id) throw new HttpError(409, 'You cannot change your own account status');
    const n = db.prepare('UPDATE users SET account_status = ? WHERE user_id = ?').run(s, req.params.id).changes;
    if (!n) throw new HttpError(404, 'User not found'); res.json({ userId: Number(req.params.id), status: s });
  });
  app.get('/api/admin/reports/summary', auth, need('ADMIN'), (_q, res) => {
    const one = (sql) => db.prepare(sql).get();
    const group = (sql) => Object.fromEntries(db.prepare(sql).all().map((r) => [r.k, r.n]));
    res.json({
      passengers: one('SELECT COUNT(*) n FROM passengers').n,
      cardsByStatus: group('SELECT card_status k, COUNT(*) n FROM metro_cards GROUP BY card_status'),
      rechargesByStatus: group('SELECT payment_status k, COUNT(*) n FROM recharges GROUP BY payment_status'),
      totalRecharged: rupees(one("SELECT COALESCE(SUM(amount_paise),0) n FROM recharges WHERE payment_status='SUCCESS'").n),
      totalFares: rupees(one('SELECT COALESCE(SUM(fare_paise),0) n FROM transactions').n),
      totalBalanceHeld: rupees(one('SELECT COALESCE(SUM(balance_paise),0) n FROM metro_cards').n),
      journeys: one('SELECT COUNT(*) n FROM transactions').n,
    });
  });

  app.use('/api', (_q, _r, next) => next(new HttpError(404, 'Not found')));
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (/UNIQUE constraint/.test(err.message ?? '')) return res.status(409).json({ error: 'Record already exists' });
    console.error(err); res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
