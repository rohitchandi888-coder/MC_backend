import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'fda_wallet',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'admin',
});

async function fixDuplicateWallets() {
  const client = await pool.connect();
  try {
    console.log('🔍 Checking for duplicate wallet addresses...\n');

    // Find duplicate addresses (case-insensitive)
    const duplicates = await client.query(`
      SELECT LOWER(address) as address_lower, 
             COUNT(*) as count,
             array_agg(id) as wallet_ids,
             array_agg(user_id) as user_ids,
             array_agg(address) as addresses
      FROM wallets
      GROUP BY LOWER(address)
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `);

    if (duplicates.rows.length === 0) {
      console.log('✅ No duplicate wallet addresses found!');
      return;
    }

    console.log(`Found ${duplicates.rows.length} duplicate wallet address(es):\n`);

    for (const dup of duplicates.rows) {
      console.log(`Address: ${dup.addresses[0]}`);
      console.log(`  Count: ${dup.count}`);
      console.log(`  Wallet IDs: ${dup.wallet_ids.join(', ')}`);
      console.log(`  User IDs: ${dup.user_ids.join(', ')}`);
      
      // Get user emails for these user IDs
      const userIds = dup.user_ids;
      const users = await client.query(`
        SELECT id, email, phone, full_name
        FROM users
        WHERE id = ANY($1::int[])
      `, [userIds]);
      
      console.log(`  Users:`);
      users.rows.forEach(user => {
        console.log(`    - User ID ${user.id}: ${user.email || user.phone || user.full_name || 'Unknown'}`);
      });
      
      // Keep the first wallet (oldest), delete the rest
      const walletIdsToDelete = dup.wallet_ids.slice(1);
      console.log(`  Keeping wallet ID ${dup.wallet_ids[0]} (first registered)`);
      console.log(`  Deleting wallet IDs: ${walletIdsToDelete.join(', ')}\n`);
      
      // Delete duplicate wallets
      await client.query(`
        DELETE FROM wallets
        WHERE id = ANY($1::int[])
      `, [walletIdsToDelete]);
      
      console.log(`  ✅ Deleted ${walletIdsToDelete.length} duplicate wallet(s)\n`);
    }

    console.log('✅ Duplicate wallet cleanup complete!');
    
    // Verify unique constraint exists
    console.log('\n🔍 Verifying unique constraint...');
    const constraintCheck = await client.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'wallets' 
        AND constraint_type = 'UNIQUE'
        AND constraint_name LIKE '%address%'
    `);
    
    if (constraintCheck.rows.length === 0) {
      console.log('⚠️  No unique constraint found on address column. Creating one...');
      await client.query(`
        ALTER TABLE wallets
        ADD CONSTRAINT wallets_address_unique UNIQUE (address)
      `);
      console.log('✅ Unique constraint created!');
    } else {
      console.log(`✅ Unique constraint exists: ${constraintCheck.rows[0].constraint_name}`);
    }
    
  } catch (err) {
    console.error('❌ Error fixing duplicates:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

fixDuplicateWallets();
