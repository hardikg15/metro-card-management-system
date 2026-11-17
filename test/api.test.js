import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, seed } from '../src/db.js';
import { createApp, toPaise } from '../src/app.js';
import { createMockPayment } from '../src/payment.js';

let server, base, db; const tokens = {};
const call = async (method, path, token, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (u, p) => (await call('POST', '/api/auth/login', null, { username: u, password: p })).body.token;
const recharge = (tok, card, amount, key, simulate = 'SUCCESS') => call('POST', `/api/cards/${card}/recharges`, tok, { amount, simulate }, { 'Idempotency-Key': key });
const balance = async (card) => (await call('GET', `/api/cards/${card}`, tokens.asha)).body.balance;

before(async () => {
  db = openDb(); seed(db, { rounds: 4 });
  const app = createApp({ db, rounds: 4, payment: createMockPayment({ delayMs: 30 }) });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
  tokens.asha = await login('asha@mcms.test', 'Passenger@123');
  tokens.ravi = await login('ravi@mcms.test', 'Passenger@123');
  tokens.staff = await login('staff@mcms.test', 'Staff@123');
  tokens.admin = await login('admin@mcms.test', 'Admin@123');
});
after(() => server.close());

test('money parsing: 500 valid; 0, negative, junk rejected', () => {
  assert.equal(toPaise('500'), 50000);
  assert.equal(toPaise(12.5), 1250);
  for (const bad of [0, '0', -5, '-5', 'abc', '', null, '1.234']) assert.throws(() => toPaise(bad), /Amount/);
});

test('auth: register, login, invalid credentials rejected', async () => {
  const reg = await call('POST', '/api/auth/register', null, { name: 'Test User', age: 30, address: 'Somewhere', contactNo: '9999999999', email: 'T@Example.com', password: 'longenough1' });
  assert.equal(reg.status, 201);
  assert.ok(await login('t@example.com', 'longenough1'));
  assert.equal((await call('POST', '/api/auth/login', null, { username: 't@example.com', password: 'wrong' })).status, 401);
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('POST', '/api/auth/register', null, { name: 'X', age: 30, address: 'a', contactNo: '9999999999', email: 'bad', password: 'longenough1' })).status, 400);
});

test('recharge: 200 + 500 SUCCESS = 700.00', async () => {
  const r = await recharge(tokens.asha, 'MC10000001', 500, 'k-success');
  assert.equal(r.status, 201); assert.equal(r.body.recharge.status, 'SUCCESS'); assert.equal(r.body.balance, '700.00');
});
test('recharge: FAILED leaves balance unchanged', async () => {
  const before = await balance('MC10000001');
  const r = await recharge(tokens.asha, 'MC10000001', 500, 'k-fail', 'FAILED');
  assert.equal(r.body.recharge.status, 'FAILED'); assert.equal(await balance('MC10000001'), before);
});
test('recharge: zero / negative / missing key rejected, balance untouched', async () => {
  const before = await balance('MC10000001');
  assert.equal((await recharge(tokens.asha, 'MC10000001', 0, 'k0')).status, 400);
  assert.equal((await recharge(tokens.asha, 'MC10000001', -10, 'k-1')).status, 400);
  assert.equal((await call('POST', '/api/cards/MC10000001/recharges', tokens.asha, { amount: 10 })).status, 400);
  assert.equal(await balance('MC10000001'), before);
});
test('recharge: blocked card rejected', async () => {
  assert.equal((await recharge(tokens.asha, 'MC10000002', 100, 'k-blocked')).status, 409);
});
test('recharge: same idempotency key credits once (sequential replay)', async () => {
  const before = Number(await balance('MC10000001'));
  const a = await recharge(tokens.asha, 'MC10000001', 100, 'k-dup'); const b = await recharge(tokens.asha, 'MC10000001', 100, 'k-dup');
  assert.equal(b.body.replayed, true); assert.equal(b.body.recharge.rechargeId, a.body.recharge.rechargeId);
  assert.equal(Number(await balance('MC10000001')), before + 100);
  assert.equal((await recharge(tokens.asha, 'MC10000001', 999, 'k-dup')).status, 422);
});
test('recharge: concurrent duplicate requests credit once', async () => {
  const before = Number(await balance('MC10000001'));
  const rs = await Promise.all([1, 2, 3, 4].map(() => recharge(tokens.asha, 'MC10000001', 50, 'k-race')));
  assert.equal(rs.filter((r) => r.body.replayed === false).length, 1);
  assert.equal(Number(await balance('MC10000001')), before + 50);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM recharges WHERE idempotency_key='k-race'").get().n, 1);
});

test('authorization: passenger sees only own data; admin/staff routes denied', async () => {
  assert.equal((await call('GET', '/api/cards/MC10000003', tokens.asha)).status, 403);
  assert.equal((await recharge(tokens.asha, 'MC10000003', 10, 'k-x')).status, 403);
  assert.equal((await call('GET', '/api/cards/MC10000003/transactions', tokens.asha)).status, 403);
  const list = await call('GET', '/api/cards', tokens.asha);
  assert.deepEqual(list.body.map((c) => c.cardId), ['MC10000001', 'MC10000002']);
  assert.equal((await call('GET', '/api/admin/reports/summary', tokens.asha)).status, 403);
  assert.equal((await call('GET', '/api/admin/reports/summary', tokens.staff)).status, 403);
  assert.equal((await call('POST', '/api/cards', tokens.asha, { passengerId: 1 })).status, 403);
  assert.equal((await call('GET', '/api/admin/reports/summary', tokens.admin)).status, 200);
});

test('card lifecycle: staff issues, activates, blocks; passenger can block but not unblock', async () => {
  const c = await call('POST', '/api/cards', tokens.staff, { passengerId: 2 });
  assert.equal(c.status, 201); assert.equal(c.body.status, 'ISSUED');
  const id = c.body.cardId;
  assert.equal((await recharge(tokens.ravi, id, 100, 'k-issued')).status, 409);
  assert.equal((await call('PATCH', `/api/cards/${id}/status`, tokens.staff, { status: 'ACTIVE' })).body.status, 'ACTIVE');
  assert.equal((await call('PATCH', `/api/cards/${id}/status`, tokens.ravi, { status: 'BLOCKED' })).body.status, 'BLOCKED');
  assert.equal((await call('PATCH', `/api/cards/${id}/status`, tokens.ravi, { status: 'ACTIVE' })).status, 403);
  assert.equal((await call('PATCH', `/api/cards/${id}/status`, tokens.staff, { status: 'ISSUED' })).status, 409);
  assert.equal((await call('PATCH', `/api/cards/${id}/status`, tokens.staff, { status: 'ACTIVE' })).body.status, 'ACTIVE');
});

test('travel: staff records journey, fare deducted atomically; history shows it', async () => {
  const before = Number(await balance('MC10000001'));
  const t = await call('POST', '/api/transactions', tokens.staff, { cardId: 'MC10000001', entryStationId: 1, exitStationId: 4, fare: 40 });
  assert.equal(t.status, 201); assert.equal(Number(await balance('MC10000001')), before - 40);
  assert.equal((await call('POST', '/api/transactions', tokens.staff, { cardId: 'MC10000001', entryStationId: 1, exitStationId: 4, fare: 999999 })).status, 409);
  assert.equal((await call('POST', '/api/transactions', tokens.asha, { cardId: 'MC10000001', entryStationId: 1, exitStationId: 4, fare: 1 })).status, 403);
  assert.equal((await call('POST', '/api/transactions', tokens.staff, { cardId: 'MC10000002', entryStationId: 1, exitStationId: 4, fare: 1 })).status, 409);
  const h = await call('GET', '/api/cards/MC10000001/transactions', tokens.asha);
  assert.equal(h.body.items[0].exitStation, 'Dwarka Sector 21');
});

test('admin: disabled user loses access immediately', async () => {
  const t = await login('ravi@mcms.test', 'Passenger@123');
  assert.equal((await call('PATCH', '/api/admin/users/4/status', tokens.admin, { status: 'DISABLED' })).status, 200);
  assert.equal((await call('GET', '/api/me', t)).status, 401);
  assert.equal((await call('POST', '/api/auth/login', null, { username: 'ravi@mcms.test', password: 'Passenger@123' })).status, 403);
  await call('PATCH', '/api/admin/users/4/status', tokens.admin, { status: 'ACTIVE' });
});
