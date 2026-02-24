import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

// PostgreSQL connection configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'fda_wallet',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function truncateAllTables() {
  const client = await pool.connect();
  
  try {
    console.log('⚠️  WARNING: This will delete ALL data from ALL tables!');
    console.log('Starting truncation...\n');
    
    // Disable foreign key checks temporarily
    await client.query("SET session_replication_role = 'replica'");
    
    // Truncate all tables
    await client.query(`
      TRUNCATE TABLE 
        internal_transfers,
        disputes,
        trades,
        offers,
        fda_holdings,
        wallet_phrases,
        payment_methods,
        internal_balances,
        wallets,
        users,
        settings
      CASCADE
    `);
    
    // Re-enable foreign key checks
    await client.query("SET session_replication_role = 'origin'");
    
    console.log('✅ All tables truncated successfully!\n');
    
    // Verify tables are empty
    const result = await client.query(`
      SELECT 
        'users' as table_name, COUNT(*) as row_count FROM users
      UNION ALL
      SELECT 'wallets', COUNT(*) FROM wallets
      UNION ALL
      SELECT 'internal_balances', COUNT(*) FROM internal_balances
      UNION ALL
      SELECT 'offers', COUNT(*) FROM offers
      UNION ALL
      SELECT 'trades', COUNT(*) FROM trades
      UNION ALL
      SELECT 'internal_transfers', COUNT(*) FROM internal_transfers
      UNION ALL
      SELECT 'wallet_phrases', COUNT(*) FROM wallet_phrases
      UNION ALL
      SELECT 'payment_methods', COUNT(*) FROM payment_methods
      UNION ALL
      SELECT 'fda_holdings', COUNT(*) FROM fda_holdings
      UNION ALL
      SELECT 'disputes', COUNT(*) FROM disputes
      UNION ALL
      SELECT 'settings', COUNT(*) FROM settings
      ORDER BY table_name
    `);
    
    console.log('Table row counts after truncation:');
    console.log('================================');
    result.rows.forEach(row => {
      console.log(`${row.table_name.padEnd(20)} : ${row.row_count} rows`);
    });
    console.log('\n✅ Database reset complete!');
    
  } catch (err) {
    console.error('❌ Error truncating tables:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the truncation
truncateAllTables()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Script failed:', err);
    process.exit(1);
  });
