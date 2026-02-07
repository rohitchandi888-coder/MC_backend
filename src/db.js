import pg from 'pg';
const { Pool } = pg;

// PostgreSQL connection configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'fda_wallet',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
  // Don't exit on idle client errors, just log them
  console.error('This might indicate a database connection issue. Please check your PostgreSQL connection.');
});

// Helper function to convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
function convertSqliteToPostgres(sql) {
  let pgSql = sql;
  let paramIndex = 1;
  // Replace ? with $1, $2, etc. in order
  pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);
  return pgSql;
}

// Database wrapper to maintain compatibility with existing code
export const db = {
  // Query method (returns promise) - converts ? to $1, $2, etc.
  query: (text, params) => {
    // If SQL uses ? placeholders, convert them
    let pgSql = text;
    if (text.includes('?') && !text.includes('$')) {
      pgSql = convertSqliteToPostgres(text);
    }
    return pool.query(pgSql, params || []);
  },
  
  // Helper methods for compatibility
  prepare: (sql) => {
    return {
      get: async (...params) => {
        // If SQL already uses $1, $2 syntax, use it directly; otherwise convert
        let pgSql = sql;
        if (!sql.includes('$')) {
          pgSql = convertSqliteToPostgres(sql);
        }
        // Ensure params is an array
        const paramsArray = Array.isArray(params[0]) ? params[0] : params;
        const result = await pool.query(pgSql, paramsArray);
        return result.rows[0] || null;
      },
      all: async (...params) => {
        let pgSql = sql;
        if (!sql.includes('$')) {
          pgSql = convertSqliteToPostgres(sql);
        }
        const paramsArray = Array.isArray(params[0]) ? params[0] : params;
        const result = await pool.query(pgSql, paramsArray);
        return result.rows;
      },
      run: async (...params) => {
        let pgSql = sql;
        if (!sql.includes('$')) {
          pgSql = convertSqliteToPostgres(sql);
        }
        // For INSERT queries, add RETURNING id if not present
        if (pgSql.trim().toUpperCase().startsWith('INSERT') && !pgSql.toUpperCase().includes('RETURNING')) {
          pgSql = pgSql.trim().replace(/;?\s*$/, '') + ' RETURNING id';
        }
        const paramsArray = Array.isArray(params[0]) ? params[0] : params;
        const result = await pool.query(pgSql, paramsArray);
        return {
          lastInsertRowid: result.rows[0]?.id || null,
          changes: result.rowCount || 0,
        };
      },
    };
  },
  
  exec: async (sql) => {
    // Split multiple statements if needed
    const statements = sql.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      if (stmt.trim()) {
        await pool.query(stmt.trim());
      }
    }
  },
  
  transaction: async (callback) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback();
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

// Convert SQLite schema to PostgreSQL
export async function runMigrations() {
  let client;
  try {
    // Test connection first
    console.log('Attempting to connect to PostgreSQL...');
    client = await pool.connect();
    await client.query('SELECT 1');
    console.log('✅ PostgreSQL connection successful');
  } catch (err) {
    console.error('\n❌ PostgreSQL connection failed!');
    console.error('Error:', err.message);
    console.error('\n📋 Please ensure:');
    console.error('1. PostgreSQL is installed and running');
    console.error('2. Database "fda_wallet" exists');
    console.error('   Run in psql: CREATE DATABASE fda_wallet;');
    console.error('3. .env file exists with correct credentials');
    console.error('\n💡 To create .env file, copy this to backend/.env:');
    console.error('PORT=4000');
    console.error('JWT_SECRET=your-secret-key');
    console.error('DB_HOST=localhost');
    console.error('DB_PORT=5432');
    console.error('DB_NAME=fda_wallet');
    console.error('DB_USER=postgres');
    console.error('DB_PASSWORD=postgres\n');
    if (client) client.release();
    throw err;
  }
  
  try {
    await client.query('BEGIN');
    
    // Enable foreign keys (PostgreSQL has them enabled by default, but we'll ensure it)
    
    // Create tables with PostgreSQL syntax
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        fda_user_id VARCHAR(255) UNIQUE,
        email VARCHAR(255) UNIQUE,
        phone VARCHAR(50) UNIQUE,
        password_hash TEXT NOT NULL,
        full_name VARCHAR(255),
        is_admin INTEGER NOT NULL DEFAULT 0,
        dreamer_status INTEGER,
        learner_status INTEGER,
        plain_pass VARCHAR(255),
        plain_tpass VARCHAR(255),
        dreamer_count_status INTEGER,
        learner_count_status INTEGER,
        user_country VARCHAR(255),
        user_state VARCHAR(255),
        user_city VARCHAR(255),
        inr_price NUMERIC(20, 8),
        reff_id INTEGER,
        fda_full_data JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add new columns if they don't exist (for existing databases)
    const columnsToAdd = [
      { name: 'fda_user_id', type: 'VARCHAR(255) UNIQUE' },
      { name: 'dreamer_status', type: 'INTEGER' },
      { name: 'learner_status', type: 'INTEGER' },
      { name: 'plain_pass', type: 'VARCHAR(255)' },
      { name: 'plain_tpass', type: 'VARCHAR(255)' },
      { name: 'dreamer_count_status', type: 'INTEGER' },
      { name: 'learner_count_status', type: 'INTEGER' },
      { name: 'user_country', type: 'VARCHAR(255)' },
      { name: 'user_state', type: 'VARCHAR(255)' },
      { name: 'user_city', type: 'VARCHAR(255)' },
      { name: 'inr_price', type: 'NUMERIC(20, 8)' },
      { name: 'reff_id', type: 'INTEGER' },
      { name: 'fda_full_data', type: 'JSONB' }
    ];

    for (const column of columnsToAdd) {
      const columnCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = $1
      `, [column.name]);
      
      if (columnCheck.rows.length === 0) {
        try {
          await client.query(`ALTER TABLE users ADD COLUMN ${column.name} ${column.type};`);
          console.log(`✅ Added ${column.name} column to users table`);
        } catch (err) {
          // If unique constraint fails, try without it
          if (column.type.includes('UNIQUE')) {
            const typeWithoutUnique = column.type.replace(' UNIQUE', '');
            await client.query(`ALTER TABLE users ADD COLUMN ${column.name} ${typeWithoutUnique};`);
            console.log(`✅ Added ${column.name} column to users table (without unique constraint)`);
          } else {
            console.log(`⚠️  Could not add ${column.name}:`, err.message);
          }
        }
      }
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        address VARCHAR(255) UNIQUE NOT NULL,
        label VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS offers (
        id SERIAL PRIMARY KEY,
        maker_id INTEGER NOT NULL,
        type VARCHAR(10) NOT NULL,
        asset_symbol VARCHAR(50) NOT NULL,
        fiat_currency VARCHAR(50) NOT NULL,
        price NUMERIC(20, 8) NOT NULL,
        amount NUMERIC(20, 8) NOT NULL,
        remaining NUMERIC(20, 8) NOT NULL,
        min_limit NUMERIC(20, 8),
        max_limit NUMERIC(20, 8),
        payment_methods TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        cancelled_at TIMESTAMP,
        FOREIGN KEY (maker_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        offer_id INTEGER NOT NULL,
        buyer_id INTEGER NOT NULL,
        seller_id INTEGER NOT NULL,
        amount NUMERIC(20, 8) NOT NULL,
        price NUMERIC(20, 8) NOT NULL,
        asset_symbol VARCHAR(50) NOT NULL,
        fiat_currency VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        paid_at TIMESTAMP,
        released_at TIMESTAMP,
        cancelled_at TIMESTAMP,
        payment_screenshot TEXT,
        fee NUMERIC(20, 8) DEFAULT 0,
        fee_amount NUMERIC(20, 8) DEFAULT 0,
        fee_rate NUMERIC(10, 6) DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (offer_id) REFERENCES offers(id),
        FOREIGN KEY (buyer_id) REFERENCES users(id),
        FOREIGN KEY (seller_id) REFERENCES users(id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS disputes (
        id SERIAL PRIMARY KEY,
        trade_id INTEGER NOT NULL UNIQUE,
        raised_by_id INTEGER NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
        reason TEXT NOT NULL,
        resolution_note TEXT,
        resolved_by_id INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP,
        FOREIGN KEY (trade_id) REFERENCES trades(id),
        FOREIGN KEY (raised_by_id) REFERENCES users(id),
        FOREIGN KEY (resolved_by_id) REFERENCES users(id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS internal_balances (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        fda_balance NUMERIC(30, 18) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        value TEXT NOT NULL,
        description TEXT,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS internal_transfers (
        id SERIAL PRIMARY KEY,
        from_user_id INTEGER NOT NULL,
        to_user_id INTEGER NOT NULL,
        amount NUMERIC(30, 18) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
        note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (from_user_id) REFERENCES users(id),
        FOREIGN KEY (to_user_id) REFERENCES users(id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fda_holdings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        amount NUMERIC(30, 18) NOT NULL,
        holding_period VARCHAR(20) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // Add updated_at column if it doesn't exist (for existing tables)
    const holdingsUpdatedAtCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'fda_holdings' AND column_name = 'updated_at'
    `);
    if (holdingsUpdatedAtCheck.rows.length === 0) {
      await client.query(`ALTER TABLE fda_holdings ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);
    }

    // Check and add columns if they don't exist (PostgreSQL way)
    const userColumns = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'full_name'
    `);
    if (userColumns.rows.length === 0) {
      await client.query(`ALTER TABLE users ADD COLUMN full_name VARCHAR(255);`);
    }

    // Initialize default settings if they don't exist
    const defaultSettings = [
      { key: 'p2p_fee_rate', value: '1', description: 'P2P Trading Fee Rate (percentage, e.g., 1 for 1%, 5 for 5%)' },
      { key: 'holding_fda_amount', value: '0', description: 'Minimum FDA balance to hold (users cannot use this amount for offers or transfers, e.g., 2.5 for 2.5 FDA)' }
    ];

    for (const setting of defaultSettings) {
      const existing = await client.query('SELECT * FROM settings WHERE key = $1', [setting.key]);
      if (existing.rows.length === 0) {
        await client.query(
          'INSERT INTO settings (key, value, description, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
          [setting.key, setting.value, setting.description]
        );
      }
    }

    await client.query('COMMIT');
    console.log('Database migrations completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration error:', err);
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
