import { mkdirSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb, seed } from './src/db.js';
import { createApp } from './src/app.js';
import { createMockPayment } from './src/payment.js';

const path = process.env.DB_PATH ?? './data/mcms.db';
const rounds = Number(process.env.BCRYPT_ROUNDS ?? 10);
mkdirSync(dirname(path), { recursive: true });
if (process.argv.includes('--reset')) for (const s of ['', '-wal', '-shm']) rmSync(path + s, { force: true });
const db = openDb(path);
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) { seed(db, { rounds }); console.log('Seeded demo data.'); }
if (process.argv.includes('--reset')) { console.log('Database reset and seeded.'); process.exit(0); }
if (!process.env.JWT_SECRET) console.warn('WARNING: JWT_SECRET not set; using an insecure dev secret. Copy .env.example to .env.');
const app = createApp({ db, payment: createMockPayment(), jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me', rounds, allowSimulate: process.env.MOCK_PAYMENT_ALLOW_SIMULATE !== 'false' });
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`MCMS running at http://localhost:${port}`));
