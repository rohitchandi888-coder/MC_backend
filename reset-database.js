import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'fda_wallet',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function resetDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting database reset...\n');
    
    await client.query('BEGIN');
    
    // Disable foreign key checks temporarily (PostgreSQL doesn't have this, but we'll truncate in order)
    // Truncate tables in order (respecting foreign key constraints)
    // Start with tables that have foreign keys, then parent tables
    
    console.log('📋 Truncating tables...');
    
    // 1. Truncate child tables first
    await client.query('TRUNCATE TABLE internal_transfers CASCADE');
    console.log('  ✅ Truncated internal_transfers');
    
    await client.query('TRUNCATE TABLE disputes CASCADE');
    console.log('  ✅ Truncated disputes');
    
    await client.query('TRUNCATE TABLE trades CASCADE');
    console.log('  ✅ Truncated trades');
    
    await client.query('TRUNCATE TABLE offers CASCADE');
    console.log('  ✅ Truncated offers');
    
    await client.query('TRUNCATE TABLE internal_balances CASCADE');
    console.log('  ✅ Truncated internal_balances');
    
    await client.query('TRUNCATE TABLE wallets CASCADE');
    console.log('  ✅ Truncated wallets');
    
    // 2. Truncate parent tables
    await client.query('TRUNCATE TABLE users CASCADE');
    console.log('  ✅ Truncated users');
    
    // 3. Reset settings to defaults (or truncate if you want to remove them too)
    await client.query('TRUNCATE TABLE settings CASCADE');
    console.log('  ✅ Truncated settings');
    
    // Re-insert default settings
    console.log('\n📝 Re-inserting default settings...');
    await client.query(`
      INSERT INTO settings (key, value, description, updated_at) 
      VALUES 
        ('p2p_fee_rate', '1', 'P2P Trading Fee Rate (percentage, e.g., 1 for 1%, 5 for 5%)', CURRENT_TIMESTAMP),
        ('holding_fda_amount', '0', 'Minimum FDA balance to hold (users cannot use this amount for offers or transfers, e.g., 2.5 for 2.5 FDA)', CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO NOTHING;
    `);
    console.log('  ✅ Default settings restored');
    
    // Ensure unique constraint on wallets.address
    console.log('\n🔒 Checking unique constraint on wallets.address...');
    try {
      // Check if unique constraint exists
      const constraintCheck = await client.query(`
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = 'wallets' 
        AND constraint_type = 'UNIQUE' 
        AND constraint_name LIKE '%address%'
      `);
      
      if (constraintCheck.rows.length === 0) {
        // Add unique constraint if it doesn't exist
        await client.query(`
          ALTER TABLE wallets 
          ADD CONSTRAINT wallets_address_unique UNIQUE (address)
        `);
        console.log('  ✅ Added UNIQUE constraint on wallets.address');
      } else {
        console.log('  ✅ UNIQUE constraint on wallets.address already exists');
      }
    } catch (err) {
      // Constraint might already exist with a different name, check for it
      const allConstraints = await client.query(`
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = 'wallets' 
        AND constraint_type = 'UNIQUE'
      `);
      
      if (allConstraints.rows.length > 0) {
        console.log('  ✅ UNIQUE constraint on wallets.address already exists');
      } else {
        // Try to add it
        try {
          await client.query(`
            ALTER TABLE wallets 
            ADD CONSTRAINT wallets_address_unique UNIQUE (address)
          `);
          console.log('  ✅ Added UNIQUE constraint on wallets.address');
        } catch (addErr) {
          console.log('  ⚠️  Could not add constraint (might already exist):', addErr.message);
        }
      }
    }
    
    await client.query('COMMIT');
    
    console.log('\n✅ Database reset completed successfully!');
    console.log('\n📊 Summary:');
    console.log('  • All tables truncated');
    console.log('  • Default settings restored');
    console.log('  • Unique constraint ensured on wallets.address');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error resetting database:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the reset
resetDatabase()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n💥 Failed to reset database:', err);
    process.exit(1);
  });
