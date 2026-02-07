# How to Start the Backend Server

## Issue: "Unable to reach backend API"

The backend server is not running. Follow these steps:

## Step 1: Create .env File

Create a file named `.env` in the `backend` folder with this content:

```env
PORT=4000
JWT_SECRET=your-secret-key-change-in-production

DB_HOST=localhost
DB_PORT=5432
DB_NAME=fda_wallet
DB_USER=postgres
DB_PASSWORD=postgres
```

**Note:** Adjust `DB_PASSWORD` to match your PostgreSQL password.

## Step 2: Install PostgreSQL (if not installed)

### Option A: Download PostgreSQL
- Download from: https://www.postgresql.org/download/windows/
- Install and remember your password

### Option B: Use Docker
```bash
docker run --name postgres-fda -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fda_wallet -p 5432:5432 -d postgres
```

## Step 3: Create Database

Open PostgreSQL command line (psql) or pgAdmin and run:

```sql
CREATE DATABASE fda_wallet;
```

## Step 4: Install Dependencies

```bash
cd backend
npm install
```

## Step 5: Start the Server

```bash
npm run dev
```

You should see:
```
✅ PostgreSQL connection successful
Database migrations completed successfully
FDA wallet backend running on port 4000
```

## Step 6: Test the Server

Open browser: http://localhost:4000/health

Should see: `{"status":"ok","service":"fda-wallet-backend"}`

## Troubleshooting

### "Connection refused"
- PostgreSQL service is not running
- Start PostgreSQL service from Services (Windows)

### "Database does not exist"
- Run: `CREATE DATABASE fda_wallet;` in psql

### "Password authentication failed"
- Check your PostgreSQL password in .env file

### "Port 4000 already in use"
- Change PORT in .env to another port (e.g., 4001)
- Update frontend API URL if needed
