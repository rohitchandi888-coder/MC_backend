import 'dotenv/config';
import { db } from './src/db.js';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const username = '89685';
const password = '9842';

async function testUser() {
  console.log('\n[========================================]');
  console.log('[TEST] 🔍 Testing user 89685');
  console.log('[========================================]\n');
  
  try {
    // Check by email/phone
    console.log('[TEST] 1. Checking by email/phone...');
    let userRow = await db
      .prepare('SELECT id, fda_user_id, email, phone, password_hash, is_admin, full_name, created_at FROM users WHERE email = ? OR phone = ?')
      .get(username, username);
    
    // Check by fda_user_id
    if (!userRow) {
      console.log('[TEST] 2. Checking by fda_user_id...');
      userRow = await db
        .prepare('SELECT id, fda_user_id, email, phone, password_hash, is_admin, full_name, created_at FROM users WHERE fda_user_id = ?')
        .get(String(username));
    }
    
    // Check by database ID if numeric
    if (!userRow && /^\d+$/.test(username)) {
      console.log('[TEST] 3. Checking by database ID...');
      const numericId = parseInt(username, 10);
      if (!isNaN(numericId)) {
        userRow = await db
          .prepare('SELECT id, fda_user_id, email, phone, password_hash, is_admin, full_name, created_at FROM users WHERE id = ?')
          .get(numericId);
      }
    }
    
    if (!userRow) {
      console.log('[TEST] ❌ User NOT found in database');
      console.log('[TEST] User will need to be created via FDA API');
      return;
    }
    
    console.log('[TEST] ✅ User FOUND in database:');
    console.log(`  - Database ID: ${userRow.id}`);
    console.log(`  - FDA User ID: ${userRow.fda_user_id || 'N/A'}`);
    console.log(`  - Email: ${userRow.email || 'N/A'}`);
    console.log(`  - Phone: ${userRow.phone || 'N/A'}`);
    console.log(`  - Full Name: ${userRow.full_name || 'N/A'}`);
    console.log(`  - Is Admin: ${!!userRow.is_admin}`);
    console.log(`  - Has Password Hash: ${!!userRow.password_hash}`);
    console.log(`  - Password Hash Length: ${userRow.password_hash?.length || 0}`);
    console.log(`  - Created At: ${userRow.created_at || 'N/A'}`);
    
    if (userRow.password_hash) {
      console.log('\n[TEST] 🔐 Testing password...');
      const passwordToCheck = password + JWT_SECRET;
      const valid = bcrypt.compareSync(passwordToCheck, userRow.password_hash);
      
      if (valid) {
        console.log('[TEST] ✅ Password is CORRECT');
      } else {
        console.log('[TEST] ❌ Password is INCORRECT');
        console.log('[TEST] This means:');
        console.log('  - User exists locally but password doesn\'t match');
        console.log('  - Password may have been changed on FDA side');
        console.log('  - System should try FDA API as fallback');
      }
    } else {
      console.log('[TEST] ⚠️  No password hash stored');
      console.log('[TEST] User needs to authenticate via FDA API');
    }
    
    // Test FDA API
    console.log('\n[TEST] 🌐 Testing FDA API...');
    const apiKey = '123x';
    const postData = {
      action: 'remote_login',
      id: username,
      password: password,
      type: ''
    };
    
    try {
      const response = await fetch('https://futuredigiassets.com/fda/userdash/members/serverapi.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(postData)
      });
      
      const httpCode = response.status;
      const responseText = await response.text();
      
      console.log(`[TEST] FDA API Response Code: ${httpCode}`);
      console.log(`[TEST] FDA API Response: ${responseText.substring(0, 200)}...`);
      
      if (httpCode === 200) {
        console.log('[TEST] ✅ FDA API returned 200 OK');
        try {
          const parsed = JSON.parse(responseText);
          console.log('[TEST] ✅ FDA API Response is valid JSON');
          console.log('[TEST] FDA Data:', JSON.stringify(parsed, null, 2).substring(0, 500));
        } catch (e) {
          console.log('[TEST] ⚠️  FDA API Response is not JSON');
        }
      } else {
        console.log('[TEST] ❌ FDA API returned error status');
      }
    } catch (error) {
      console.log('[TEST] ❌ FDA API Error:', error.message);
    }
    
  } catch (err) {
    console.error('[TEST] ❌ Error:', err);
  }
  
  console.log('\n[========================================]\n');
  
  // Close database connection
  process.exit(0);
}

testUser();
