# Quick Start Guide - Backend Setup

## Issue: "Unable to reach backend API"

This error usually means:
1. Backend server is not running
2. PostgreSQL is not installed/configured
3. Database connection is failing

## Solution Steps:

### Option 1: Use PostgreSQL (Recommended)

1. **Install PostgreSQL** (if not installed):
   - Download from: https://www.postgresql.org/download/windows/
   - Or use Docker: `docker run --name postgres-fda -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fda_wallet -p 5432:5432 -d postgres`

2. **Create the database**:
   ```sql
   CREATE DATABASE fda_wallet;
   ```

3. **Create `.env` file** in `backend` folder:
   ```env
   PORT=4000
   JWT_SECRET=your-secret-key-change-in-production
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=fda_wallet
   DB_USER=postgres
   DB_PASSWORD=postgres
   ```

4. **Install dependencies**:
   ```bash
   cd backend
   npm install
   ```

5. **Start the server**:
   ```bash
   npm run dev
   ```

### Option 2: Quick Test (Temporary - Use SQLite)

If you want to test quickly without PostgreSQL, you can temporarily revert to SQLite:

1. In `backend/package.json`, change:
   ```json
   "pg": "^8.11.3"
   ```
   to:
   ```json
   "better-sqlite3": "^11.7.0"
   ```

2. Restore the old `db.js` file (or ask for help)

## Check if Server is Running:

1. Open browser: http://localhost:4000/health
2. Should see: `{"status":"ok","service":"fda-wallet-backend"}`

## Common Issues:

- **Port 4000 already in use**: Change PORT in .env
- **PostgreSQL connection refused**: Check if PostgreSQL service is running
- **Database doesn't exist**: Create it with `CREATE DATABASE fda_wallet;`
- **Wrong credentials**: Check .env file matches your PostgreSQL setup
