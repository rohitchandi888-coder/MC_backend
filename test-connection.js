// Quick connection test script
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: 'postgres', // Connect to default database first
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function testConnection() {
  try {
    console.log('Testing PostgreSQL connection...');
    console.log('Host:', process.env.DB_HOST || 'localhost');
    console.log('Port:', process.env.DB_PORT || 5432);
    console.log('User:', process.env.DB_USER || 'postgres');
    console.log('Password:', process.env.DB_PASSWORD ? '***' : 'not set');
    
    const client = await pool.connect();
    console.log('✅ Connected successfully!');
    
    // Check if database exists
    const dbCheck = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = 'fda_wallet'"
    );
    
    if (dbCheck.rows.length === 0) {
      console.log('Creating database fda_wallet...');
      await client.query('CREATE DATABASE fda_wallet');
      console.log('✅ Database created!');
    } else {
      console.log('✅ Database fda_wallet already exists');
    }
    
    client.release();
    await pool.end();
    console.log('\n✅ Setup complete! You can now run: npm run dev');
  } catch (err) {
    console.error('\n❌ Connection failed!');
    console.error('Error:', err.message);
    console.error('\nPossible issues:');
    console.error('1. Password is incorrect');
    console.error('2. PostgreSQL service is not running');
    console.error('3. Wrong username (try your Windows username)');
    console.error('4. PostgreSQL is configured for different authentication');
    console.error('\nTry:');
    console.error('- Check Services (services.msc) - ensure PostgreSQL is running');
    console.error('- Try opening pgAdmin and check the connection there');
    console.error('- Verify the password in pgAdmin');
    process.exit(1);
  }
}

testConnection();
