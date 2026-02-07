import pg from 'pg';
const { Pool } = pg;
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'fda_wallet',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function updateAdminUser() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Updating admin user...\n');
    
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@gmail.com';
    const adminPhone = process.env.ADMIN_PHONE || '909022';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
    const adminName = process.env.ADMIN_NAME || 'Admin';
    
    // Find user by email or phone
    const result = await client.query(
      'SELECT id, email, phone, is_admin FROM users WHERE email = $1 OR phone = $2',
      [adminEmail, adminPhone]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ No user found with email:', adminEmail, 'or phone:', adminPhone);
      console.log('   Please login first to create the user, then run this script again.');
      return;
    }
    
    for (const user of result.rows) {
      console.log(`📋 Found user:`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Email: ${user.email || 'N/A'}`);
      console.log(`   Phone: ${user.phone || 'N/A'}`);
      console.log(`   Current Admin Status: ${user.is_admin ? 'Yes' : 'No'}`);
      console.log('');
      
      // Update to admin
      await client.query(
        'UPDATE users SET is_admin = 1, full_name = $1 WHERE id = $2',
        [adminName, user.id]
      );
      
      // Update password
      const passwordHash = bcrypt.hashSync(adminPassword + JWT_SECRET, 10);
      await client.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [passwordHash, user.id]
      );
      
      console.log(`✅ Updated user ${user.id} to admin`);
      console.log(`   Email: ${user.email || adminEmail}`);
      console.log(`   Phone: ${user.phone || adminPhone}`);
      console.log(`   Name: ${adminName}`);
      console.log(`   Is Admin: Yes`);
      console.log(`   Password: ${adminPassword}`);
      console.log('');
    }
    
    console.log('✨ Done!');
    
  } catch (err) {
    console.error('\n❌ Error updating admin user:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
updateAdminUser()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n💥 Failed to update admin user:', err);
    process.exit(1);
  });
