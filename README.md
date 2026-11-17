# MCMS – Metro Card Management System (academic prototype)

Hardik Garg · 09614803124 · B.Tech IT Sem V · Software Engineering.
**Mock payments only.** No real metro gates, bank, UPI or payment gateway is connected.

## Stack
Node.js ≥ 22.13 · Express 5 REST API · SQLite (built-in `node:sqlite`) · bcryptjs · JWT · vanilla-JS single-page UI (served by Express) · `node:test`.

## Setup
```bash
npm install
cp .env.example .env      # set JWT_SECRET to a long random string
npm run seed              # (re)creates data/mcms.db with demo data
npm start                 # http://localhost:3000
npm test                  # 12 automated API tests (in-memory DB)
```

## Demo credentials (seed data)
| Role | Username | Password |
|---|---|---|
| Admin | admin@mcms.test | Admin@123 |
| Staff | staff@mcms.test | Staff@123 |
| Passenger (cards MC10000001 ACTIVE ₹200, MC10000002 BLOCKED) | asha@mcms.test | Passenger@123 |
| Passenger (card MC10000003 ACTIVE ₹120) | ravi@mcms.test | Passenger@123 |

## Key design rules
- **Recharge** (`POST /api/cards/:id/recharges`, header `Idempotency-Key` required): validate → insert `PENDING` → mock provider → settle with `UPDATE … WHERE payment_status='PENDING'`; balance is credited only if that update changed a row **and** the result is `SUCCESS`. `UNIQUE(card_id, idempotency_key)` + that guard mean a replayed or concurrent duplicate can never credit twice.
- Money is stored as integer paise (exact), exposed as 2-decimal strings.
- Authorization is server-side on every route; passengers can only touch their own cards; users are re-checked per request so disabling an account takes effect at once.
- Card lifecycle: Requested → Issued → Active ⇄ Blocked → Expired. Passengers can only block; unblock needs staff/admin.
- `MOCK_PAYMENT_ALLOW_SIMULATE=true` shows a demo-only "force SUCCESS/FAILED" selector.

## Deviations from the SRS suggestions (documented)
- Plain JS UI instead of React/Vite, and SQLite instead of PostgreSQL, to keep setup to `npm install`. The SRS marks these as recommendations; the schema is portable SQL.
- `Transaction` creation also deducts the fare atomically (SRS "production design"); the original browser demo did not.
- `User.Username` is the email for passengers. Staff/admin accounts are created by an admin.

## Known limitations
No password reset, rate limiting or email verification; a recharge left `PENDING` by a server crash is not auto-reconciled; travel entry is manual (no gate hardware).
