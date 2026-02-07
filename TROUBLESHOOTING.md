# PostgreSQL Connection Troubleshooting

## Current Issue: Password Authentication Failed

The password `mcwallet` is not working. Here are solutions:

## Solution 1: Verify Password in pgAdmin

1. **Open pgAdmin** (search in Start Menu)
2. **Connect to your PostgreSQL server**
   - Right-click on "Servers" → "Create" → "Server" (if not already connected)
   - Or expand existing server connection
3. **Check the connection properties:**
   - Go to server properties → Connection tab
   - See what password is saved there
4. **Try connecting** - if it works in pgAdmin, use that password

## Solution 2: Reset PostgreSQL Password

If you forgot the password, you can reset it:

1. **Open Command Prompt as Administrator**
2. **Navigate to PostgreSQL bin:**
   ```powershell
   cd "C:\Program Files\PostgreSQL\18\bin"
   ```
3. **Edit pg_hba.conf** to allow local connections without password temporarily:
   - Location: `C:\Program Files\PostgreSQL\18\data\pg_hba.conf`
   - Find line: `host all all 127.0.0.1/32 scram-sha-256`
   - Change to: `host all all 127.0.0.1/32 trust`
   - Restart PostgreSQL service
4. **Connect without password:**
   ```powershell
   .\psql.exe -U postgres
   ```
5. **Reset password:**
   ```sql
   ALTER USER postgres PASSWORD 'mcwallet';
   ```
6. **Revert pg_hba.conf** back to `scram-sha-256`
7. **Restart PostgreSQL service**

## Solution 3: Use Windows Authentication

If PostgreSQL is configured for Windows authentication:

1. **Check your Windows username**
2. **Update .env file:**
   ```env
   DB_USER=YOUR_WINDOWS_USERNAME
   DB_PASSWORD=
   ```
3. **Or use your Windows username as the PostgreSQL user**

## Solution 4: Check PostgreSQL Service

1. **Open Services** (Win+R → `services.msc`)
2. **Find PostgreSQL service** (usually named like `postgresql-x64-18`)
3. **Ensure it's running** (Status should be "Running")
4. **If not running, right-click → Start**

## Solution 5: Try Different Common Passwords

Sometimes the password might be:
- `postgres` (default)
- `admin`
- `password`
- `123456`
- Your Windows password
- Empty (no password)

## Solution 6: Check PostgreSQL Configuration

1. **Open pgAdmin**
2. **Right-click server → Properties**
3. **Check:**
   - Host: `localhost` or `127.0.0.1`
   - Port: `5432`
   - Username: Usually `postgres`
   - Password: What you set during installation

## Quick Test: Try Starting Server Anyway

Sometimes the Node.js pg library handles authentication differently. Try:

```bash
cd backend
npm run dev
```

The server might connect successfully even if command-line tools fail.

---

## Need More Help?

1. **Open pgAdmin and check what password works there**
2. **Share the working password** and I'll update the .env file
3. **Or try the server** - it might work even if psql doesn't
