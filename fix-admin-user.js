import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

async function fixAdminUser() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Finding all users with admin@gmail.com or phone 909022...\n');
    
    const result = await client.query(
      'SELECT id, email, phone, fda_user_id, is_admin, full_name FROM users WHERE fda_user_id = $1 OR email = $1 OR phone = $2 ORDER BY id',
      ['admin@gmail.com', '909022']
    );
    
    console.log(`Found ${result.rows.length} user(s):\n`);
    result.rows.forEach((user, index) => {
      console.log(`User ${index + 1}:`);
      console.log(`  ID: ${user.id}`);
      console.log(`  Email: ${user.email || 'N/A'}`);
      console.log(`  Phone: ${user.phone || 'N/A'}`);
      console.log(`  FDA User ID: ${user.fda_user_id || 'N/A'}`);
      console.log(`  is_admin: ${user.is_admin}`);
      console.log(`  Full Name: ${user.full_name || 'N/A'}`);
      console.log('');
    });
    
    // Update ALL matching users to admin
    console.log('🔄 Updating all matching users to admin...\n');
    
    for (const user of result.rows) {
      // Update to admin
      await client.query(
        'UPDATE users SET is_admin = 1, full_name = COALESCE($1, full_name) WHERE id = $2',
        ['Admin', user.id]
      );
      
      // Only update email/phone if they're null and won't cause duplicate
      if (!user.email) {
        // Check if email is already taken by another user
        const emailCheck = await client.query(
          'SELECT id FROM users WHERE email = $1 AND id != $2',
          ['admin@gmail.com', user.id]
        );
        if (emailCheck.rows.length === 0) {
          await client.query('UPDATE users SET email = $1 WHERE id = $2', ['admin@gmail.com', user.id]);
        }
      }
      
      if (!user.phone) {
        // Check if phone is already taken by another user
        const phoneCheck = await client.query(
          'SELECT id FROM users WHERE phone = $1 AND id != $2',
          ['909022', user.id]
        );
        if (phoneCheck.rows.length === 0) {
          await client.query('UPDATE users SET phone = $1 WHERE id = $2', ['909022', user.id]);
        }
      }
      
      console.log(`✅ Updated user ID ${user.id} to admin`);
    }
    
    // Verify
    const verify = await client.query(
      'SELECT id, email, phone, fda_user_id, is_admin FROM users WHERE fda_user_id = $1 OR email = $1 OR phone = $2 ORDER BY id',
      ['admin@gmail.com', '909022']
    );
    
    console.log('\n✅ Verification - All matching users:');
    verify.rows.forEach(user => {
      console.log(`  ID: ${user.id}, Email: ${user.email}, Phone: ${user.phone}, Admin: ${user.is_admin ? 'YES' : 'NO'}`);
    });
    
    console.log('\n✨ Done!');
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

fixAdminUser()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n💥 Failed:', err);
    process.exit(1);
  });
