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

async function checkAdmin() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking admin users...\n');
    
    const result = await client.query(
      'SELECT id, email, phone, fda_user_id, is_admin, full_name FROM users WHERE email = $1 OR phone = $2',
      ['admin@gmail.com', '909022']
    );
    
    if (result.rows.length === 0) {
      console.log('❌ No user found with email: admin@gmail.com or phone: 909022');
    } else {
      console.log(`✅ Found ${result.rows.length} user(s):\n`);
      result.rows.forEach((user, index) => {
        console.log(`User ${index + 1}:`);
        console.log(`  ID: ${user.id}`);
        console.log(`  Email: ${user.email || 'N/A'}`);
        console.log(`  Phone: ${user.phone || 'N/A'}`);
        console.log(`  FDA User ID: ${user.fda_user_id || 'N/A'}`);
        console.log(`  is_admin: ${user.is_admin} (type: ${typeof user.is_admin})`);
        console.log(`  Full Name: ${user.full_name || 'N/A'}`);
        console.log(`  Is Admin: ${user.is_admin ? '✅ YES' : '❌ NO'}`);
        console.log('');
      });
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('💥 Failed:', err);
    process.exit(1);
  });
