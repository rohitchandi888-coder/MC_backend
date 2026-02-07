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

async function createAdminUser() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Creating admin user...\n');
    
    // Default admin credentials
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@gmail.com';
    const adminPhone = process.env.ADMIN_PHONE || null;
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin@123';
    const adminName = process.env.ADMIN_NAME || 'Admin User';
    
    console.log('📋 Admin Details:');
    console.log(`  Email: ${adminEmail}`);
    if (adminPhone) console.log(`  Phone: ${adminPhone}`);
    console.log(`  Name: ${adminName}`);
    console.log(`  Password: ${adminPassword}`);
    console.log('');
    
    // Check if admin already exists
    const existing = await client.query(
      'SELECT id, email, phone FROM users WHERE email = $1 OR (phone = $2 AND phone IS NOT NULL)',
      [adminEmail, adminPhone]
    );
    
    if (existing.rows.length > 0) {
      const existingUser = existing.rows[0];
      
      // Update existing user to admin
      await client.query(
        'UPDATE users SET is_admin = 1, full_name = $1 WHERE id = $2',
        [adminName, existingUser.id]
      );
      
      // Update password if provided (use same format as login: password + JWT_SECRET)
      if (adminPassword) {
        const passwordHash = bcrypt.hashSync(adminPassword + JWT_SECRET, 10);
        await client.query(
          'UPDATE users SET password_hash = $1 WHERE id = $2',
          [passwordHash, existingUser.id]
        );
      }
      
      console.log('✅ Updated existing user to admin');
      console.log(`   User ID: ${existingUser.id}`);
      console.log(`   Email: ${existingUser.email || 'N/A'}`);
      console.log(`   Phone: ${existingUser.phone || 'N/A'}`);
    } else {
      // Create new admin user (use same format as login: password + JWT_SECRET)
      const passwordHash = bcrypt.hashSync(adminPassword + JWT_SECRET, 10);
      
      const result = await client.query(
        'INSERT INTO users (email, phone, password_hash, full_name, is_admin) VALUES ($1, $2, $3, $4, 1) RETURNING id',
        [adminEmail, adminPhone, passwordHash, adminName]
      );
      
      const adminId = result.rows[0].id;
      
      console.log('✅ Admin user created successfully!');
      console.log(`   User ID: ${adminId}`);
      console.log(`   Email: ${adminEmail}`);
      if (adminPhone) console.log(`   Phone: ${adminPhone}`);
      console.log(`   Name: ${adminName}`);
      console.log(`   Is Admin: Yes`);
    }
    
    console.log('\n📝 Login Credentials:');
    console.log(`   Email: ${adminEmail}`);
    if (adminPhone) console.log(`   Phone: ${adminPhone}`);
    console.log(`   Password: ${adminPassword}`);
    console.log('\n✨ Done!');
    
  } catch (err) {
    console.error('\n❌ Error creating admin user:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
createAdminUser()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n💥 Failed to create admin user:', err);
    process.exit(1);
  });
