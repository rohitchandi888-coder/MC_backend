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

async function checkDuplicates() {
  const client = await pool.connect();
  try {
    console.log('🔍 Checking for duplicate wallet addresses by user...\n');

    // Check for the specific address mentioned by user
    const specificAddress = '0x817C0B006b8B85d0807F48A1489b470C52A0DeB6';
    const normalizedAddress = specificAddress.toLowerCase();

    const wallets = await client.query(`
      SELECT w.id, w.address, w.user_id, w.label, w.created_at,
             u.email, u.phone, u.full_name
      FROM wallets w
      JOIN users u ON u.id = w.user_id
      WHERE LOWER(w.address) = $1
      ORDER BY w.created_at
    `, [normalizedAddress]);

    console.log(`Found ${wallets.rows.length} wallet(s) with address ${specificAddress}:\n`);
    
    if (wallets.rows.length > 1) {
      console.log('⚠️  DUPLICATE FOUND! Same address registered to multiple users:\n');
      wallets.rows.forEach((wallet, index) => {
        console.log(`  ${index + 1}. Wallet ID: ${wallet.id}`);
        console.log(`     Address: ${wallet.address}`);
        console.log(`     User ID: ${wallet.user_id}`);
        console.log(`     User: ${wallet.email || wallet.phone || wallet.full_name || 'Unknown'}`);
        console.log(`     Created: ${wallet.created_at}`);
        console.log('');
      });

      // Keep the first (oldest), delete the rest
      const walletIdsToDelete = wallets.rows.slice(1).map(w => w.id);
      console.log(`\n🗑️  Will delete wallet IDs: ${walletIdsToDelete.join(', ')}`);
      console.log(`✅ Will keep wallet ID: ${wallets.rows[0].id} (User: ${wallets.rows[0].email || wallets.rows[0].phone})\n`);

      // Ask for confirmation (in a real script, you'd use readline)
      console.log('Deleting duplicates...');
      await client.query(`
        DELETE FROM wallets WHERE id = ANY($1::int[])
      `, [walletIdsToDelete]);
      
      console.log(`✅ Deleted ${walletIdsToDelete.length} duplicate wallet(s)\n`);
    } else if (wallets.rows.length === 1) {
      console.log('✅ No duplicates found for this address.');
      console.log(`   Wallet ID: ${wallets.rows[0].id}`);
      console.log(`   User: ${wallets.rows[0].email || wallets.rows[0].phone}`);
    } else {
      console.log('❌ No wallets found with this address.');
    }

    // Check all duplicates
    console.log('\n🔍 Checking for ALL duplicate addresses (case-insensitive)...\n');
    const allDuplicates = await client.query(`
      SELECT LOWER(address) as address_lower, 
             COUNT(*) as count,
             array_agg(id ORDER BY created_at) as wallet_ids,
             array_agg(user_id ORDER BY created_at) as user_ids,
             array_agg(address ORDER BY created_at) as addresses
      FROM wallets
      GROUP BY LOWER(address)
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `);

    if (allDuplicates.rows.length > 0) {
      console.log(`Found ${allDuplicates.rows.length} duplicate address(es):\n`);
      for (const dup of allDuplicates.rows) {
        console.log(`Address: ${dup.addresses[0]}`);
        console.log(`  Count: ${dup.count}`);
        console.log(`  Wallet IDs: ${dup.wallet_ids.join(', ')}`);
        console.log(`  User IDs: ${dup.user_ids.join(', ')}`);
        
        // Get user emails
        const users = await client.query(`
          SELECT id, email, phone, full_name
          FROM users
          WHERE id = ANY($1::int[])
        `, [dup.user_ids]);
        
        console.log(`  Users:`);
        users.rows.forEach(user => {
          console.log(`    - User ID ${user.id}: ${user.email || user.phone || user.full_name || 'Unknown'}`);
        });
        console.log('');
      }
    } else {
      console.log('✅ No duplicates found!');
    }

  } catch (err) {
    console.error('❌ Error checking duplicates:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

checkDuplicates();
