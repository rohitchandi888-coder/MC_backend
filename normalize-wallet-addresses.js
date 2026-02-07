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

async function normalizeWalletAddresses() {
  const client = await pool.connect();
  try {
    console.log('🔄 Normalizing wallet addresses to lowercase...\n');

    // Get all wallets
    const wallets = await client.query(`
      SELECT id, address, user_id, LOWER(address) as normalized_address
      FROM wallets
      WHERE address != LOWER(address)
    `);

    if (wallets.rows.length === 0) {
      console.log('✅ All wallet addresses are already lowercase!');
    } else {
      console.log(`Found ${wallets.rows.length} wallet(s) with uppercase letters:\n`);

      for (const wallet of wallets.rows) {
        console.log(`  Wallet ID ${wallet.id}: ${wallet.address} → ${wallet.normalized_address}`);
        
        // Check if lowercase version already exists
        const existing = await client.query(`
          SELECT id, user_id FROM wallets 
          WHERE LOWER(address) = $1 AND id != $2
        `, [wallet.normalized_address, wallet.id]);
        
        if (existing.rows.length > 0) {
          console.log(`    ⚠️  Lowercase version already exists (Wallet ID ${existing.rows[0].id}, User ID ${existing.rows[0].user_id})`);
          console.log(`    ❌ Deleting duplicate wallet ID ${wallet.id} (User ID ${wallet.user_id})`);
          await client.query('DELETE FROM wallets WHERE id = $1', [wallet.id]);
        } else {
          // Update to lowercase
          await client.query(`
            UPDATE wallets SET address = $1 WHERE id = $2
          `, [wallet.normalized_address, wallet.id]);
          console.log(`    ✅ Updated to lowercase`);
        }
      }
    }

    // Now normalize all addresses to lowercase
    console.log('\n🔄 Normalizing all addresses to lowercase...');
    const result = await client.query(`
      UPDATE wallets 
      SET address = LOWER(address)
      WHERE address != LOWER(address)
    `);
    console.log(`✅ Normalized ${result.rowCount} wallet address(es)\n`);

    // Check for duplicates again (case-insensitive)
    const duplicates = await client.query(`
      SELECT LOWER(address) as address_lower, 
             COUNT(*) as count,
             array_agg(id) as wallet_ids,
             array_agg(user_id) as user_ids
      FROM wallets
      GROUP BY LOWER(address)
      HAVING COUNT(*) > 1
    `);

    if (duplicates.rows.length > 0) {
      console.log(`⚠️  Found ${duplicates.rows.length} duplicate address(es) after normalization:\n`);
      for (const dup of duplicates.rows) {
        console.log(`  Address: ${dup.address_lower}`);
        console.log(`    Wallet IDs: ${dup.wallet_ids.join(', ')}`);
        console.log(`    User IDs: ${dup.user_ids.join(', ')}`);
        
        // Keep the first (oldest), delete the rest
        const walletIdsToDelete = dup.wallet_ids.slice(1);
        await client.query(`
          DELETE FROM wallets WHERE id = ANY($1::int[])
        `, [walletIdsToDelete]);
        console.log(`    ✅ Kept wallet ID ${dup.wallet_ids[0]}, deleted ${walletIdsToDelete.join(', ')}\n`);
      }
    } else {
      console.log('✅ No duplicates found after normalization!');
    }

    // Verify unique constraint
    console.log('\n🔍 Verifying unique constraint...');
    const constraintCheck = await client.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'wallets' 
        AND constraint_type = 'UNIQUE'
        AND constraint_name LIKE '%address%'
    `);
    
    if (constraintCheck.rows.length === 0) {
      console.log('⚠️  No unique constraint found. Creating one...');
      await client.query(`
        ALTER TABLE wallets
        ADD CONSTRAINT wallets_address_unique UNIQUE (address)
      `);
      console.log('✅ Unique constraint created!');
    } else {
      console.log(`✅ Unique constraint exists: ${constraintCheck.rows[0].constraint_name}`);
    }

    console.log('\n✅ Wallet address normalization complete!');
  } catch (err) {
    console.error('❌ Error normalizing addresses:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

normalizeWalletAddresses();
