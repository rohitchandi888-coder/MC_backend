# PostgreSQL Setup Guide

## Prerequisites

1. Install PostgreSQL (if not already installed)
   - Windows: Download from https://www.postgresql.org/download/windows/
   - Or use Docker: `docker run --name postgres-fda -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fda_wallet -p 5432:5432 -d postgres`

## Setup Steps

1. **Create the database:**
   ```sql
   CREATE DATABASE fda_wallet;
   ```

2. **Update `.env` file:**
   ```env
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=fda_wallet
   DB_USER=postgres
   DB_PASSWORD=postgres
   ```

3. **Install dependencies:**
   ```bash
   cd backend
   npm install
   ```

4. **Run the server:**
   ```bash
   npm run dev
   ```

   The migrations will run automatically on startup and create all necessary tables.

## Migration from SQLite

If you have existing data in SQLite, you'll need to export and import it manually:

1. Export SQLite data to CSV or SQL
2. Import into PostgreSQL using pgAdmin or psql
3. Adjust data types as needed (SQLite REAL → PostgreSQL NUMERIC)

## Notes

- All SQL queries have been converted from SQLite syntax to PostgreSQL
- Parameter placeholders changed from `?` to `$1, $2, etc.`
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY`
- `TEXT` → `VARCHAR` or `TEXT` (as appropriate)
- `REAL` → `NUMERIC(20, 8)` for financial data
- `datetime('now')` → `CURRENT_TIMESTAMP`
