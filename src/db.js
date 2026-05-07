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
      { name: 'fda_full_data', type: 'JSONB' },
      { name: 'p2p_usdt_payout_address', type: 'VARCHAR(100)' },
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
        encrypted_data TEXT,
        network VARCHAR(50),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    
    // Add encrypted_data and network columns if they don't exist (migration)
    try {
      const columnsCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'wallets' AND column_name IN ('encrypted_data', 'network')
      `);
      const existingColumns = columnsCheck.rows.map(r => r.column_name);
      
      if (!existingColumns.includes('encrypted_data')) {
        await client.query(`ALTER TABLE wallets ADD COLUMN encrypted_data TEXT;`);
        console.log('[Migration] ✅ Added encrypted_data column to wallets table');
      }
      
      if (!existingColumns.includes('network')) {
        await client.query(`ALTER TABLE wallets ADD COLUMN network VARCHAR(50);`);
        console.log('[Migration] ✅ Added network column to wallets table');
      }
    } catch (migrationErr) {
      console.error('[Migration] Error adding columns to wallets table:', migrationErr);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS wallet_phrases (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        wallet_address VARCHAR(255) NOT NULL,
        encrypted_phrase TEXT NOT NULL,
        phrase_hash VARCHAR(255),
        network VARCHAR(50),
        label VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, wallet_address)
      );
    `);
    
    // Add phrase_hash column if it doesn't exist (migration)
    try {
      await client.query(`
        ALTER TABLE wallet_phrases 
        ADD COLUMN IF NOT EXISTS phrase_hash VARCHAR(255);
      `);
      
      // Create index for faster lookups
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_wallet_phrases_hash ON wallet_phrases(phrase_hash);
      `);
    } catch (migrationErr) {
      // Column might already exist, ignore
      console.log('[Migration] phrase_hash column check:', migrationErr.message);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        upi_id VARCHAR(255) NOT NULL,
        qr_code TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

    // Check if table exists and what structure it has
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'internal_balances'
      );
    `);
    
    if (tableExists.rows[0].exists) {
      // Table exists, check if it has user_id column (old structure)
      const hasUserId = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'internal_balances' AND column_name = 'user_id'
      `);
      
      const hasWalletAddress = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'internal_balances' AND column_name = 'wallet_address'
      `);
      
      if (hasUserId.rows.length > 0 && hasWalletAddress.rows.length === 0) {
        // Old structure exists, need to migrate
        console.log('[Migration] Migrating internal_balances from user_id to wallet_address...');
        
        try {
          // Add wallet_address column first (nullable initially)
          await client.query(`
            ALTER TABLE internal_balances 
            ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(255);
          `);
          
          // Migrate data: get all user balances and their primary wallet addresses
          const userBalances = await client.query(`
            SELECT ib.user_id, ib.fda_balance, w.address as wallet_address
            FROM internal_balances ib
            LEFT JOIN wallets w ON w.user_id = ib.user_id
            WHERE w.address IS NOT NULL
          `);
          
          console.log(`[Migration] Found ${userBalances.rows.length} balances to migrate`);
          
          // Update existing rows with wallet addresses
          for (const row of userBalances.rows) {
            const walletAddr = row.wallet_address.toLowerCase().trim();
            await client.query(`
              UPDATE internal_balances 
              SET wallet_address = $1
              WHERE user_id = $2 AND (wallet_address IS NULL OR wallet_address = '')
            `, [walletAddr, row.user_id]);
          }
          
          // Remove rows without wallet addresses (orphaned balances)
          const deleteResult = await client.query(`
            DELETE FROM internal_balances 
            WHERE wallet_address IS NULL OR wallet_address = ''
          `);
          console.log(`[Migration] Removed ${deleteResult.rowCount} orphaned balance records`);
          
          // Check for duplicate wallet addresses before adding unique constraint
          const duplicates = await client.query(`
            SELECT wallet_address, COUNT(*) as count
            FROM internal_balances
            WHERE wallet_address IS NOT NULL
            GROUP BY wallet_address
            HAVING COUNT(*) > 1
          `);
          
          if (duplicates.rows.length > 0) {
            console.warn('[Migration] Warning: Found duplicate wallet addresses, consolidating...');
            // For duplicates, keep the one with highest balance
            for (const dup of duplicates.rows) {
              await client.query(`
                DELETE FROM internal_balances
                WHERE id NOT IN (
                  SELECT id FROM internal_balances
                  WHERE wallet_address = $1
                  ORDER BY fda_balance DESC, id DESC
                  LIMIT 1
                )
                AND wallet_address = $1
              `, [dup.wallet_address]);
            }
          }
          
          // Make wallet_address NOT NULL
          await client.query(`
            ALTER TABLE internal_balances 
            ALTER COLUMN wallet_address SET NOT NULL;
          `);
          
          // Add unique constraint if it doesn't exist
          const constraintExists = await client.query(`
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'internal_balances' 
            AND constraint_type = 'UNIQUE'
            AND constraint_name LIKE '%wallet_address%'
          `);
          
          if (constraintExists.rows.length === 0) {
            await client.query(`
              ALTER TABLE internal_balances 
              ADD CONSTRAINT internal_balances_wallet_address_unique UNIQUE (wallet_address);
            `);
          }
          
          // Drop old user_id column and foreign key
          await client.query(`
            ALTER TABLE internal_balances 
            DROP COLUMN IF EXISTS user_id CASCADE;
          `);
          
          console.log('[Migration] ✅ Migrated internal_balances to wallet_address');
        } catch (migrationErr) {
          console.error('[Migration] ❌ Migration error:', migrationErr.message);
          console.error('[Migration] Error details:', migrationErr);
          // Don't throw - allow server to continue, but log the error
        }
      } else if (hasWalletAddress.rows.length > 0) {
        // Already migrated, ensure constraints
        await client.query(`
          ALTER TABLE internal_balances 
          ALTER COLUMN wallet_address SET NOT NULL;
        `);
        
        // Add unique constraint if it doesn't exist
        const uniqueCheck = await client.query(`
          SELECT constraint_name 
          FROM information_schema.table_constraints 
          WHERE table_name = 'internal_balances' 
          AND constraint_type = 'UNIQUE'
          AND constraint_name = 'internal_balances_wallet_address_unique'
        `);
        
        if (uniqueCheck.rows.length === 0) {
          await client.query(`
            ALTER TABLE internal_balances 
            ADD CONSTRAINT internal_balances_wallet_address_unique UNIQUE (wallet_address);
          `);
        }
      }
    } else {
      // Table doesn't exist, create with new structure
      await client.query(`
        CREATE TABLE internal_balances (
          id SERIAL PRIMARY KEY,
          wallet_address VARCHAR(255) NOT NULL UNIQUE,
          fda_balance NUMERIC(30, 18) NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('[Migration] ✅ Created internal_balances table with wallet_address');
    }

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
      CREATE TABLE IF NOT EXISTS onchain_transfers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        from_wallet_address VARCHAR(255) NOT NULL,
        to_wallet_address VARCHAR(255) NOT NULL,
        asset_symbol VARCHAR(50) NOT NULL,
        token_address VARCHAR(255),
        amount NUMERIC(30, 18) NOT NULL,
        tx_hash VARCHAR(255) NOT NULL,
        chain VARCHAR(50) NOT NULL DEFAULT 'BNB',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_onchain_transfers_user_created
      ON onchain_transfers (user_id, created_at DESC);
    `);

    await client.query(`
      ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS from_wallet_address VARCHAR(255);
    `);
    await client.query(`
      ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS to_wallet_address VARCHAR(255);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fda_holdings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        wallet_address VARCHAR(255),
        holding_plan VARCHAR(20) NOT NULL DEFAULT 'standard',
        amount NUMERIC(30, 18) NOT NULL,
        holding_period VARCHAR(20) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        reward_rate NUMERIC(10, 4),
        base_fda_price NUMERIC(30, 8),
        reward_value_locked NUMERIC(30, 8),
        reward_amount NUMERIC(30, 18),
        claimed_at TIMESTAMP,
        break_request_status VARCHAR(20) NOT NULL DEFAULT 'NONE',
        break_request_note TEXT,
        break_requested_at TIMESTAMP,
        break_decided_at TIMESTAMP,
        break_decided_by INTEGER,
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

    // Ensure reward tracking columns exist on fda_holdings
    const holdingsColumnsToAdd = [
      { name: 'wallet_address', type: 'VARCHAR(255)' },
      { name: 'reward_rate', type: 'NUMERIC(10, 4)' },
      { name: 'base_fda_price', type: 'NUMERIC(30, 8)' },
      { name: 'reward_value_locked', type: 'NUMERIC(30, 8)' },
      { name: 'reward_amount', type: 'NUMERIC(30, 18)' },
      { name: 'claimed_at', type: 'TIMESTAMP' },
      { name: 'break_request_status', type: "VARCHAR(20) NOT NULL DEFAULT 'NONE'" },
      { name: 'break_request_note', type: 'TEXT' },
      { name: 'break_requested_at', type: 'TIMESTAMP' },
      { name: 'break_decided_at', type: 'TIMESTAMP' },
      { name: 'break_decided_by', type: 'INTEGER' },
      { name: 'holding_plan', type: "VARCHAR(20) NOT NULL DEFAULT 'standard'" },
    ];
    for (const column of holdingsColumnsToAdd) {
      const check = await client.query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'fda_holdings' AND column_name = $1
        `,
        [column.name],
      );
      if (check.rows.length === 0) {
        await client.query(`ALTER TABLE fda_holdings ADD COLUMN ${column.name} ${column.type};`);
      }
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

    // Migrate legacy key to new key if needed.
    const hasNewMinPriceKey = await client.query('SELECT 1 FROM settings WHERE key = $1 LIMIT 1', ['p2p_min_price_per_fda']);
    const hasOldMinOfferKey = await client.query('SELECT 1 FROM settings WHERE key = $1 LIMIT 1', ['p2p_min_offer_amount']);
    if (hasOldMinOfferKey.rows.length > 0 && hasNewMinPriceKey.rows.length === 0) {
      await client.query(
        `UPDATE settings
         SET key = $1,
             description = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE key = $3`,
        [
          'p2p_min_price_per_fda',
          'Minimum price per FDA required to create a P2P offer (applies to both BUY and SELL)',
          'p2p_min_offer_amount',
        ],
      );
    }

    // Initialize default settings if they don't exist
    const defaultSettings = [
      { key: 'p2p_fee_rate', value: '1', description: 'P2P Trading Fee Rate (percentage, e.g., 1 for 1%, 5 for 5%)' },
      { key: 'p2p_min_price_per_fda', value: '1', description: 'Minimum price per FDA (INR) for INR-denominated P2P offers (BUY and SELL)' },
      { key: 'p2p_min_price_per_fda_usdt', value: '1', description: 'Minimum price per FDA (USDT) for USDT-denominated P2P offers (BUY and SELL)' },
      { key: 'holding_fda_amount', value: '0', description: 'Minimum FDA balance to hold (users cannot use this amount for offers or transfers, e.g., 2.5 for 2.5 FDA)' },
      { key: 'holding_reward_rate', value: '5', description: 'FDA holding reward percentage (e.g., 5 means 5%)' },
      { key: 'holding_reward_min_amount', value: '25', description: 'Minimum FDA amount required in one holding lot to qualify for reward' },
      { key: 'holding_reward_period_months', value: '12', description: 'Minimum holding period in months required to earn reward' },
      { key: 'holding_reward_rate_merchant_buy', value: '2', description: 'Merchant buy hold reward percentage (monthly)' },
      { key: 'holding_reward_min_amount_merchant_buy', value: '10', description: 'Minimum FDA amount required in merchant buy hold' },
      { key: 'holding_reward_period_months_merchant_buy', value: '12', description: 'Merchant buy hold period in months (minimum 12)' }
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
