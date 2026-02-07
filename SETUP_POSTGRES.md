# PostgreSQL Setup Guide for FDA Wallet

## Option 1: Install PostgreSQL (Recommended)

### Step 1: Download and Install PostgreSQL

1. **Download PostgreSQL:**
   - Go to: https://www.postgresql.org/download/windows/
   - Download the installer (e.g., PostgreSQL 15 or 16)
   - Run the installer

2. **During Installation:**
   - Remember the password you set for the `postgres` user
   - Default port: `5432` (keep this)
   - Default user: `postgres`

3. **Verify Installation:**
   - Open Command Prompt or PowerShell
   - Navigate to: `C:\Program Files\PostgreSQL\[version]\bin`
   - Run: `psql --version`

### Step 2: Create the Database

**Method A: Using pgAdmin (GUI)**
1. Open pgAdmin (installed with PostgreSQL)
2. Connect to your PostgreSQL server
3. Right-click "Databases" → "Create" → "Database"
4. Name: `fda_wallet`
5. Click "Save"

**Method B: Using Command Line**
1. Open Command Prompt or PowerShell
2. Navigate to PostgreSQL bin folder:
   ```powershell
   cd "C:\Program Files\PostgreSQL\[version]\bin"
   ```
3. Run:
   ```powershell
   .\psql.exe -U postgres
   ```
4. Enter your PostgreSQL password
5. Run:
   ```sql
   CREATE DATABASE fda_wallet;
   \q
   ```

**Method C: Using SQL Command Directly**
```powershell
cd "C:\Program Files\PostgreSQL\[version]\bin"
.\psql.exe -U postgres -c "CREATE DATABASE fda_wallet;"
```

### Step 3: Create .env File

Create a file named `.env` in the `backend` folder:

```env
PORT=4000
JWT_SECRET=your-secret-key-change-in-production

DB_HOST=localhost
DB_PORT=5432
DB_NAME=fda_wallet
DB_USER=postgres
DB_PASSWORD=YOUR_POSTGRES_PASSWORD_HERE
```

**Important:** Replace `YOUR_POSTGRES_PASSWORD_HERE` with the password you set during PostgreSQL installation.

### Step 4: Install Dependencies and Start Server

```bash
cd backend
npm install
npm run dev
```

---

## Option 2: Use Docker (If Docker is Installed)

### Step 1: Run PostgreSQL Container

```bash
docker run --name postgres-fda -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fda_wallet -p 5432:5432 -d postgres
```

### Step 2: Create .env File

```env
PORT=4000
JWT_SECRET=your-secret-key-change-in-production

DB_HOST=localhost
DB_PORT=5432
DB_NAME=fda_wallet
DB_USER=postgres
DB_PASSWORD=postgres
```

### Step 3: Start Server

```bash
cd backend
npm install
npm run dev
```

---

## Option 3: Use SQLite (Temporary - For Quick Testing)

If you want to test quickly without PostgreSQL, I can help you revert to SQLite temporarily.

---

## Troubleshooting

### "Connection refused" or "Connection timeout"
- **Check if PostgreSQL is running:**
  - Windows: Open Services (services.msc)
  - Look for "postgresql-x64-[version]" service
  - Right-click → Start if not running

### "Password authentication failed"
- Check your `.env` file has the correct password
- Try resetting PostgreSQL password:
  ```powershell
  cd "C:\Program Files\PostgreSQL\[version]\bin"
  .\psql.exe -U postgres
  ```
  Then:
  ```sql
  ALTER USER postgres PASSWORD 'newpassword';
  ```

### "Database does not exist"
- Create it using one of the methods above

### "Port 5432 already in use"
- Another PostgreSQL instance might be running
- Change port in `.env` to another port (e.g., 5433)
- Update PostgreSQL configuration if needed

---

## Quick Test

After setup, test the connection:

1. **Start the server:**
   ```bash
   cd backend
   npm run dev
   ```

2. **Check health endpoint:**
   - Open browser: http://localhost:4000/health
   - Should see: `{"status":"ok","service":"fda-wallet-backend"}`

3. **Check server logs:**
   - Should see: `✅ PostgreSQL connection successful`
   - Should see: `Database migrations completed successfully`

---

## Need Help?

If you encounter any issues, check:
1. PostgreSQL service is running
2. `.env` file exists and has correct credentials
3. Database `fda_wallet` exists
4. Port 5432 is not blocked by firewall
