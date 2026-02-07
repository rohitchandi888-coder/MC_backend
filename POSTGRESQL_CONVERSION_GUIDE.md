# PostgreSQL Conversion Guide

## What Has Been Done

1. ✅ **Database Connection**: Converted from `better-sqlite3` to `pg` (PostgreSQL)
2. ✅ **Schema Migration**: All tables converted to PostgreSQL syntax
3. ✅ **Auth Routes**: Login, Register, Forgot Password, Reset Password converted to async/await
4. ✅ **Database Wrapper**: Created compatibility layer to convert SQLite `?` placeholders to PostgreSQL `$1, $2, etc.`

## What Still Needs to Be Done

All remaining routes in `server.js` need to be converted from synchronous to async/await. Here's the pattern:

### Before (SQLite - Synchronous):
```javascript
app.get('/offers', authMiddleware, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM offers WHERE status = ?')
    .all('OPEN');
  res.json(rows);
});
```

### After (PostgreSQL - Async):
```javascript
app.get('/offers', authMiddleware, async (req, res) => {
  const rows = await db
    .prepare('SELECT * FROM offers WHERE status = ?')
    .all('OPEN');
  res.json(rows);
});
```

## Routes That Need Conversion

All routes using `db.prepare()` need to:
1. Add `async` to the route handler
2. Add `await` before `db.prepare()` calls
3. Ensure `authMiddleware` is also async (already done)

## Testing

1. Install PostgreSQL and create database:
   ```sql
   CREATE DATABASE fda_wallet;
   ```

2. Update `.env`:
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=fda_wallet
   DB_USER=postgres
   DB_PASSWORD=postgres
   ```

3. Install dependencies:
   ```bash
   cd backend
   npm install
   ```

4. Run server:
   ```bash
   npm run dev
   ```

## Notes

- The db wrapper automatically converts `?` to `$1, $2, etc.`
- All INSERT queries automatically get `RETURNING id` added
- Transactions are now async and use PostgreSQL connection pooling
