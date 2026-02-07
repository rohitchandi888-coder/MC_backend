# PostgreSQL Setup - Step by Step

## ✅ What We Found:
- PostgreSQL 18 is installed at: `C:\Program Files\PostgreSQL\18\`
- Dependencies are installed
- Need: Your PostgreSQL password and database creation

## 🔑 Step 1: Get Your PostgreSQL Password

You need the password you set when installing PostgreSQL. If you forgot it, you can:

**Option A: Check if you saved it somewhere**
- Look for installation notes
- Check password manager

**Option B: Reset the password (if you have admin access)**
1. Open Command Prompt as Administrator
2. Navigate to: `cd "C:\Program Files\PostgreSQL\18\bin"`
3. Run: `psql.exe -U postgres`
4. If it asks for password, try common ones or reset using pgAdmin

## 📝 Step 2: Create .env File

I'll create the .env file. You just need to update the password.

The .env file will be created with:
```env
PORT=4000
JWT_SECRET=your-secret-key-change-in-production

DB_HOST=localhost
DB_PORT=5432
DB_NAME=fda_wallet
DB_USER=postgres
DB_PASSWORD=YOUR_PASSWORD_HERE
```

**Replace `YOUR_PASSWORD_HERE` with your actual PostgreSQL password.**

## 🗄️ Step 3: Create Database

**Method 1: Using pgAdmin (Easiest)**
1. Open pgAdmin (search in Start Menu)
2. Connect to your PostgreSQL server (enter your password)
3. Right-click "Databases" → "Create" → "Database"
4. Name: `fda_wallet`
5. Click "Save"

**Method 2: Using Command Line**
1. Open PowerShell
2. Run:
   ```powershell
   cd "C:\Program Files\PostgreSQL\18\bin"
   .\psql.exe -U postgres
   ```
3. Enter your password when prompted
4. Run:
   ```sql
   CREATE DATABASE fda_wallet;
   \q
   ```

**Method 3: One-line command**
```powershell
cd "C:\Program Files\PostgreSQL\18\bin"
$env:PGPASSWORD="YOUR_PASSWORD"; .\psql.exe -U postgres -c "CREATE DATABASE fda_wallet;"
```

## 🚀 Step 4: Start the Server

Once database is created and .env file has correct password:

```bash
cd backend
npm run dev
```

You should see:
```
✅ PostgreSQL connection successful
Database migrations completed successfully
FDA wallet backend running on port 4000
```

## 🧪 Step 5: Test

Open browser: http://localhost:4000/health

Should see: `{"status":"ok","service":"fda-wallet-backend"}`

---

## 💡 Quick Help

**If you don't know your password:**
1. Try common passwords: `postgres`, `admin`, `password`, `123456`
2. Or reset it using pgAdmin (Tools → Server Configuration → Change Password)

**If database creation fails:**
- Make sure PostgreSQL service is running (check Services)
- Make sure you're using the correct password

**Need help?** Let me know your PostgreSQL password and I can help create the database automatically!
