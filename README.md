# Metro Card Management System (MCMS)

A full-stack web application for managing metro cards, passengers, recharges, balances and travel transactions through a centralized platform.

## Overview

The Metro Card Management System (MCMS) provides a unified platform for handling essential metro card operations. It supports passenger registration, card issuance, balance management, recharge processing, transaction tracking and administrative operations.

The application follows a client-server architecture with a RESTful backend, relational database and role-based access control.

## Features

### Passenger Management
- Passenger registration and authentication.
- View passenger profile and associated metro cards.
- Check current card balance and status.
- View recharge and travel transaction history.

### Metro Card Management
- Issue new metro cards.
- Activate, block and unblock cards.
- Maintain card status and balance.
- Restrict operations on blocked or inactive cards.

### Recharge Management
- Process recharge requests with amount validation.
- Simulate successful and failed payment responses.
- Update card balance only after successful payment.
- Maintain recharge records and payment status.
- Prevent duplicate recharge processing through idempotency controls.

### Travel Transaction Management
- Record journeys with entry and exit station details.
- Calculate and deduct applicable fares.
- Maintain transaction history.
- Validate card status before processing transactions.

### Administration
- Role-based access for administrators and station staff.
- Manage passenger and staff accounts.
- Issue and update metro cards.
- Monitor transactions and card records.
- View system-level reports.

## User Roles

| Role | Access |
|---|---|
| Passenger | Profile, card details, balance, recharge and transaction history |
| Station Staff | Card issuance, card status management and travel transactions |
| Administrator | User management, card management and system reports |

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express 5 |
| Database | SQLite (`node:sqlite`) |
| Authentication | JSON Web Tokens (JWT) |
| Password Security | bcryptjs |
| API Architecture | REST |
| Testing | Node.js Test Runner |

## Application Architecture

The application follows a layered client-server architecture.

1. **Frontend:** Provides the user interface and communicates with backend APIs using HTTP requests.
2. **Backend:** Handles authentication, authorization, validation and application business logic.
3. **Database:** Stores users, passengers, metro cards, recharge records, stations and travel transactions.
4. **Payment Service:** Simulates payment responses and handles recharge outcomes.

## Database Design

The application uses SQLite with the following core entities:

| Entity | Description |
|---|---|
| Users | Login credentials and assigned roles |
| Passengers | Passenger profile information |
| Metro Cards | Card identifiers, balances and status |
| Recharges | Recharge amounts and payment records |
| Stations | Metro station information |
| Transactions | Travel details, fares and timestamps |

Primary and foreign key relationships maintain data consistency between these entities.

## Recharge Processing

The recharge workflow follows these steps:

1. Passenger selects an active metro card and enters a recharge amount.
2. Backend validates the card, ownership and recharge amount.
3. A recharge request is created with a pending status.
4. The payment service returns a successful or failed response.
5. On successful payment, the recharge is recorded and the card balance is updated.
6. On failed payment, the existing balance remains unchanged.

Idempotency keys and conditional database updates protect against duplicate recharge credits.

**Note:** Payment processing currently uses a simulated payment provider. No real bank, UPI or payment gateway is connected.

## Getting Started

### Prerequisites

- Node.js 22.13 or later
- npm
- Git

### Installation

Clone the repository:

```bash
git clone https://github.com/hardikg15/metro-card-management-system.git
```

Navigate to the project directory:

```bash
cd metro-card-management-system
```

Install dependencies:

```bash
npm install
```

Create the environment configuration file:

```bash
cp .env.example .env
```

Update the `JWT_SECRET` value in `.env` with a long, randomly generated secret.

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| PORT | Application server port | 3000 |
| JWT_SECRET | Secret used for signing JWTs | Must be configured |
| DB_PATH | SQLite database location | `./data/mcms.db` |
| BCRYPT_ROUNDS | Password hashing rounds | 10 |
| MOCK_PAYMENT_ALLOW_SIMULATE | Enables manual SUCCESS/FAILED simulation | true |

### Initialize the Database

```bash
npm run seed
```

This command creates and seeds the database with demonstration records. Running it again resets the existing seeded database.

### Start the Application

```bash
npm start
```

Open the application in your browser:

```text
http://localhost:3000
```

## Demo Credentials

The following accounts are created when the database is seeded.

| Role | Email | Password |
|---|---|---|
| Administrator | admin@mcms.test | Admin@123 |
| Station Staff | staff@mcms.test | Staff@123 |
| Passenger | asha@mcms.test | Passenger@123 |
| Passenger | ravi@mcms.test | Passenger@123 |

These are local demonstration credentials. Change or remove default accounts before any public deployment.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register a passenger |
| POST | `/api/auth/login` | Authenticate a user |
| GET | `/api/me` | Retrieve current user details |
| GET | `/api/cards` | Retrieve accessible metro cards |
| POST | `/api/cards` | Issue a new card |
| PATCH | `/api/cards/:id/status` | Update card status |
| POST | `/api/cards/:id/recharges` | Process a recharge |
| GET | `/api/cards/:id/recharges` | Retrieve recharge history |
| GET | `/api/cards/:id/transactions` | Retrieve travel history |
| GET | `/api/stations` | Retrieve station records |
| POST | `/api/transactions` | Record a travel transaction |
| GET | `/api/admin/reports/summary` | Retrieve administrative reports |

Protected endpoints require authentication and enforce role-based permissions.

## Testing

The application includes automated API tests using the built-in Node.js Test Runner.

Run the test suite:

```bash
npm test
```

The test suite covers authentication, authorization, card operations, recharge processing, transaction handling and important validation scenarios.

## Project Structure

```text
metro-card-management-system/
│
├── public/
│   └── index.html
│
├── src/
│   ├── app.js
│   ├── db.js
│   └── payment.js
│
├── test/
│   └── api.test.js
│
├── data/
│
├── server.js
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
└── README.md
```

## Security and Data Integrity

- Passwords are hashed using bcryptjs.
- Protected API routes require JWT authentication.
- Role-based authorization is enforced on the server.
- Passengers can access only their own card records.
- Recharge requests require idempotency keys.
- Conditional database updates prevent duplicate balance credits.
- Monetary values are stored as integer paise to avoid floating-point precision errors.

## Current Limitations

- Payment processing is simulated; no real payment gateway is integrated.
- Metro gate and physical card-reader hardware integration is not available.
- Travel transactions are entered manually.
- Password reset, email verification and API rate limiting are not currently implemented.
- Pending recharge recovery after an unexpected server interruption requires further development.

## Future Enhancements

- Integration with real payment gateways and UPI.
- QR-code and contactless metro access.
- Automated metro gate and card-reader integration.
- Password recovery and email verification.
- Advanced analytics and reporting dashboards.
- Notifications for successful recharges and low balances.
- Deployment with persistent database infrastructure.

## License

This project is available for learning, development and further enhancement. A formal open-source license can be added when the distribution terms are decided.