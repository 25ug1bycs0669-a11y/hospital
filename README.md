# CarePoint Hospital Management System

CarePoint is a full-stack hospital management system for coordinating patient care and hospital operations. The React dashboard talks to an Express API backed by PostgreSQL; authentication, role permissions, and records are handled by the existing server.

## Features

- Role-aware access for administrators, doctors, receptionists, nurses, pharmacists, laboratory technicians, and accountants.
- Patient and doctor directories, appointments, departments, beds and wards, and medical records.
- Pharmacy inventory, laboratory orders, billing and payments, staff accounts, reports, and hospital settings.
- Session-based authentication, password hashing, API rate limiting, request validation, and role-based API permissions.
- Responsive dashboard with patient, appointment, bed-occupancy, and revenue summaries.

## Technology

- React 18, TypeScript, Vite, Recharts, and Lucide
- Node.js, Express, TypeScript, and PostgreSQL
- Helmet, Zod, bcryptjs, and cookie-based sessions

## Requirements

- Node.js 20 or newer and npm
- PostgreSQL with the `pgcrypto` extension available to the database user

## Local setup

1. Install dependencies:

   ```sh
   npm ci
   ```

2. Create a local environment file (do not commit it):

   ```sh
   # macOS/Linux
   cp .env.example .env
   # Windows PowerShell
   Copy-Item .env.example .env
   ```

3. Set `DATABASE_URL` to your PostgreSQL connection string. Set `ADMIN_EMAIL` and a unique `SEED_ADMIN_PASSWORD` of at least 12 characters. Keep real credentials only in `.env` or your deployment provider's secret manager.

4. Create the schema and sample records:

   ```sh
   npm run db:migrate
   npm run seed
   ```

5. Start the API and frontend in separate terminals:

   ```sh
   npm run server
   ```

   ```sh
   npm run dev
   ```

   Open the Vite URL printed in the terminal. The Vite development server proxies `/api` requests to the API on port 3001.

## Validation and production build

```sh
npm run typecheck
npm run build
```

For a single Node.js deployment, build the frontend and start the API with `NODE_ENV=production`; the Express server serves the built `dist/` files and the `/api` routes:

```sh
npm run build
npm start
```

Configure `DATABASE_URL`, `SESSION_HOURS`, and `PORT` in the deployment environment. Run migrations before starting the application, and seed an administrator only when initializing a new database.

## Deployment

Deploy to a Node.js host that supports a persistent Express process and PostgreSQL. This project does not currently include a Vercel serverless configuration: its API is an Express server with a PostgreSQL connection pool and should not be deployed as static-only frontend output. If using a separate frontend host, configure it to proxy `/api` to the Node.js API over HTTPS.

## Data and security notes

The seed script creates illustrative records using reserved `.test` email addresses. Set a strong, unique administrator password through `SEED_ADMIN_PASSWORD`; no real credentials are provided in this repository. Do not use sample data or this project as-is with real patient information. Before production use, complete the organization's security, privacy, access-control, backup, monitoring, and regulatory reviews.