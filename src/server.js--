import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db, runMigrations } from './db.js';

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const FDA_API_KEY = process.env.FDA_API_KEY || 'fda-mc-wallet-api-key-2024'; // API key for futuredigiassets.com

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Create API router to mount all routes under /api prefix
const apiRouter = express.Router();

// Mount API router at /api - all routes will be accessible at /api/*
app.use('/api', apiRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Helpers
function toUserDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    fdaUserId: row.fda_user_id,
    email: row.email,
    phone: row.phone,
    fullName: row.full_name,
    isAdmin: !!row.is_admin,
    dreamerStatus: row.dreamer_status,
    learnerStatus: row.learner_status,
    dreamerCountStatus: row.dreamer_count_status,
    learnerCountStatus: row.learner_count_status,
    userCountry: row.user_country,
    userState: row.user_state,
    userCity: row.user_city,
    inrPrice: row.inr_price,
    reffId: row.reff_id,
  };
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const row = await db
      .prepare('SELECT id, fda_user_id, email, phone, is_admin FROM users WHERE id = ?')
      .get(payload.sub);
    if (!row) return res.status(401).json({ error: 'User not found' });
    req.user = toUserDto(row);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Middleware to validate requests from futuredigiassets.com only
function validateFDAOrigin(req, res, next) {
  const origin = req.headers.origin || req.headers.referer || '';
  const allowedDomains = [
    'https://futuredigiassets.com',
    'http://futuredigiassets.com',
    'https://www.futuredigiassets.com',
    'http://www.futuredigiassets.com'
  ];
  
  const isAllowed = allowedDomains.some(domain => 
    origin.startsWith(domain) || req.headers.host?.includes('futuredigiassets.com')
  );
  
  // Also allow if API key is provided (for server-to-server calls)
  if (!isAllowed && !req.headers['x-api-key'] && !req.body.apiKey) {
    console.log(`[FDA API] ❌ Blocked request from unauthorized origin: ${origin}`);
    return res.status(403).json({ 
      error: 'Unauthorized origin',
      message: 'This endpoint only accepts requests from futuredigiassets.com'
    });
  }
  
  next();
}

// Middleware to validate API key
function validateAPIKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.body.apiKey || req.query.apiKey;
  
  if (!apiKey) {
    return res.status(401).json({ 
      error: 'API key required',
      message: 'Please provide API key in X-API-Key header or apiKey in request body'
    });
  }
  
  if (apiKey !== FDA_API_KEY) {
    console.log(`[FDA API] ❌ Invalid API key attempt from: ${req.headers.origin || req.ip}`);
    return res.status(401).json({ 
      error: 'Invalid API key',
      message: 'The provided API key is not valid'
    });
  }
  
  next();
}

// Helper function to calculate expiration date from holding period
// holdingPeriod format: "1M", "6M", "13M", "36M", etc. (months only, any number)
function calculateExpirationDate(holdingPeriod) {
  if (!holdingPeriod) return null;
  
  const period = String(holdingPeriod).toUpperCase().trim();
  const now = new Date();
  const expirationDate = new Date(now);
  
  // Parse holding period (e.g., "1M", "6M", "13M", "36M")
  const match = period.match(/^(\d+)M$/);
  if (!match) {
    throw new Error(`Invalid holding period format: ${holdingPeriod}. Must be in months format like "1M", "6M", "13M", "36M", etc. (only months are allowed, not years)`);
  }
  
  const months = parseInt(match[1], 10);
  
  // Validate that it's a positive number
  if (isNaN(months) || months <= 0) {
    throw new Error(`Invalid holding period: ${holdingPeriod}. Number of months must be greater than 0`);
  }
  
  // Calculate expiration date by adding months
  expirationDate.setMonth(now.getMonth() + months);
  
  return expirationDate.toISOString();
}

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'fda-wallet-backend' });
});

// Helper function to call remote FDA API
async function getUserFromFDA(username, password) {
  const apiKey = '123x';
  const postData = {
    action: 'remote_login',
    id: username,
    password: password,
    type: ''
  };

  try {
    // Convert JSON to URL-encoded format (matching PHP's json_encode in form data)
    const formData = new URLSearchParams();
    formData.append('data', JSON.stringify(postData));
    
    const response = await fetch('https://futuredigiassets.com/fda/userdash/members/serverapi.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(postData) // PHP code uses json_encode, so we send JSON string
    });

    const httpCode = response.status;
    const responseText = await response.text();

    if (httpCode === 200) {
      return {
        status: true,
        message: 'Get User data successfully.',
        data: responseText
      };
    } else {
      return {
        status: false,
        message: 'Unable to connect to remote(FDA) server.',
        data: responseText
      };
    }
  } catch (error) {
    console.error('[FDA API] Error:', error);
    return {
      status: false,
      message: 'Unable to connect to remote(FDA) server.',
      data: error.message
    };
  }
}

// Helper function to update FDA balance on remote FDA server
async function updateFDABalanceOnRemote(userId, amount) {
  const apiKey = '123x';
  const postData = {
    action: 'update_fda_balance', // You may need to adjust this action name based on your FDA API
    user_id: userId,
    amount: amount,
    type: 'add' // or 'set' - adjust based on your API requirements
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

    console.log(`[FDA API] Update Balance Response (HTTP ${httpCode}):`, responseText);

    if (httpCode === 200) {
      try {
        const parsedResponse = JSON.parse(responseText);
        return {
          status: true,
          message: 'FDA balance updated successfully on remote server.',
          data: parsedResponse
        };
      } catch (parseError) {
        // If response is not JSON, return as text
        return {
          status: true,
          message: 'FDA balance updated successfully on remote server.',
          data: responseText
        };
      }
    } else {
      return {
        status: false,
        message: 'Unable to update balance on remote(FDA) server.',
        data: responseText
      };
    }
  } catch (error) {
    console.error('[FDA API] Error updating balance:', error);
    return {
      status: false,
      message: 'Unable to connect to remote(FDA) server.',
      data: error.message
    };
  }
}

// Auth - Remote Login with Auto-Register (Only calls remote API if user doesn't exist)
// Auth - Remote Login with Auto-Register (Only calls remote API if user doesn't exist)
apiRouter.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'User ID and password are required' });
  }

  try {
    console.log(`\n[========================================]`);
    console.log(`[AUTH] 🔐 Attempting login for user: ${username}`);
    console.log(`[========================================]\n`);
    
    // Step 1: First check if user exists locally (by username, email, phone, or fda_user_id)
    // Try all possible matches to find the user
    console.log(`[AUTH] 🔍 Searching for user with identifier: ${username}`);
    console.log(`[AUTH] 🔍 Checking email, phone, and fda_user_id...`);
    
    // Try email/phone first
    let userRow = await db
      .prepare('SELECT id, fda_user_id, email, phone, password_hash, is_admin FROM users WHERE email = ? OR phone = ?')
      .get(username, username);
    
    // If not found by email/phone, try fda_user_id (as string)
    if (!userRow) {
      console.log(`[AUTH] 🔍 Not found by email/phone, trying fda_user_id...`);
      userRow = await db
        .prepare('SELECT id, fda_user_id, email, phone, password_hash, is_admin FROM users WHERE fda_user_id = ?')
        .get(String(username));
    }
    
    // Also try if username is numeric and matches the database id (for testing)
    if (!userRow && /^\d+$/.test(username)) {
      console.log(`[AUTH] 🔍 Username is numeric, checking if it matches database ID...`);
      const numericId = parseInt(username, 10);
      if (!isNaN(numericId)) {
        userRow = await db
          .prepare('SELECT id, fda_user_id, email, phone, password_hash, is_admin FROM users WHERE id = ?')
          .get(numericId);
        if (userRow) {
          console.log(`[AUTH] ⚠️  Found user by database ID (this should not be used for login, but found for debugging)`);
        }
      }
    }
    
    console.log(`[AUTH] 🔍 User lookup result:`, userRow ? { id: userRow.id, email: userRow.email, phone: userRow.phone, is_admin: userRow.is_admin } : 'Not found');
    
    // Step 2: If user exists locally, authenticate with local password
    if (userRow) {
      console.log(`[AUTH] ✅ User found locally with ID: ${userRow.id}, FDA User ID: ${userRow.fda_user_id}`);
      console.log(`[AUTH] 🔍 Checking password for user: ${username}`);
      console.log(`[AUTH] 🔍 Password hash exists: ${!!userRow.password_hash}`);
      console.log(`[AUTH] 🔍 Password hash length: ${userRow.password_hash?.length || 0}`);
      
      // Verify password against stored hash
      const passwordToCheck = password + JWT_SECRET;
      console.log(`[AUTH] 🔍 Attempting password verification...`);
      const valid = bcrypt.compareSync(passwordToCheck, userRow.password_hash);
      
      if (!valid) {
        console.log(`[AUTH] ❌ Invalid password for local user ${username}`);
        console.log(`[AUTH] 🔍 User exists but password doesn't match`);
        console.log(`[AUTH] 🔍 This could mean:`);
        console.log(`[AUTH] 🔍   1. Password is incorrect`);
        console.log(`[AUTH] 🔍   2. Password was changed on FDA but not synced locally`);
        console.log(`[AUTH] 🔍   3. User should authenticate via FDA API`);
        console.log(`[AUTH] 🔍 Attempting FDA API authentication as fallback...`);
        
        // If local password fails, try FDA API as fallback
        const fdaResponse = await getUserFromFDA(username, password);
        console.log(`[FDA API] 📥 Fallback FDA response status:`, fdaResponse.status);
        
        if (fdaResponse.status) {
          console.log(`[AUTH] ✅ FDA API authentication successful, updating local password...`);
          // Update local password hash to match FDA
          const newPasswordHash = bcrypt.hashSync(password + JWT_SECRET, 10);
          await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, userRow.id);
          console.log(`[AUTH] ✅ Local password updated successfully`);
          
          // Generate JWT token and return user data
          const user = toUserDto(userRow);
          const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
          
          console.log(`[AUTH] ✅ Login successful (FDA fallback authentication)`);
          console.log(`[AUTH] ✅ User ID: ${user.id}`);
          console.log(`[AUTH] ✅ FDA User ID: ${user.fdaUserId || 'N/A'}`);
          console.log(`[AUTH] ✅ Email: ${user.email || 'N/A'}`);
          console.log(`[AUTH] ✅ isAdmin from DB: ${userRow.is_admin} (type: ${typeof userRow.is_admin})`);
          console.log(`[AUTH] ✅ isAdmin in response: ${user.isAdmin} (type: ${typeof user.isAdmin})`);
          console.log(`[========================================]\n`);
          
          return res.json({ token, user, fdaUserData: fdaResponse.data });
        } else {
          console.log(`[AUTH] ❌ Both local and FDA authentication failed`);
          return res.status(401).json({ error: 'Invalid credentials. Please check your user ID and password.' });
        }
      }
      
      // Generate JWT token and return user data
      const user = toUserDto(userRow);
      const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
      
      console.log(`[AUTH] ✅ Login successful (local authentication)`);
      console.log(`[AUTH] ✅ User ID: ${user.id}`);
      console.log(`[AUTH] ✅ FDA User ID: ${user.fdaUserId || 'N/A'}`);
      console.log(`[AUTH] ✅ Email: ${user.email || 'N/A'}`);
      console.log(`[AUTH] ✅ isAdmin from DB: ${userRow.is_admin} (type: ${typeof userRow.is_admin})`);
      console.log(`[AUTH] ✅ isAdmin in response: ${user.isAdmin} (type: ${typeof user.isAdmin})`);
      console.log(`[========================================]\n`);
      
      return res.json({ token, user });
    }
    
    // Step 3: User doesn't exist locally - call remote FDA API to verify and register
    console.log(`[AUTH] ⚠️  User ${username} not found locally, calling remote FDA API...`);
    console.log(`[FDA API] 📞 Calling remote login API...\n`);
    
    const fdaResponse = await getUserFromFDA(username, password);
    
    // Log full FDA response
    console.log(`[FDA API] 📥 Full Response Status:`, fdaResponse.status);
    console.log(`[FDA API] 📥 Full Response Message:`, fdaResponse.message);
    console.log(`[FDA API] 📥 Full Response Data (Raw):`, fdaResponse.data);
    console.log(`[FDA API] 📥 Full Response Object:`, JSON.stringify(fdaResponse, null, 2));
    console.log(`\n`);
    
    if (!fdaResponse.status) {
      console.log(`[AUTH] ❌ Remote login failed: ${fdaResponse.message}`);
      console.log(`[AUTH] ❌ Response data:`, fdaResponse.data);
      return res.status(401).json({ error: 'Invalid credentials. Please check your user ID and password.' });
    }

    // Step 4: Parse FDA response (assuming it returns JSON with user data)
    let fdaUserData;
    try {
      fdaUserData = JSON.parse(fdaResponse.data);
      console.log(`[FDA API] ✅ Successfully parsed JSON response`);
      console.log(`[FDA API] 📋 Parsed User Data:`, JSON.stringify(fdaUserData, null, 2));
      console.log(`[FDA API] 📋 All available fields:`, Object.keys(fdaUserData));
      console.log(`\n`);
    } catch (parseError) {
      // If response is not JSON, treat it as successful but log it
      console.log(`[FDA API] ⚠️  Response is not JSON, parsing error:`, parseError.message);
      console.log(`[FDA API] ⚠️  Raw response data:`, fdaResponse.data);
      console.log(`[FDA API] ⚠️  Response type:`, typeof fdaResponse.data);
      console.log(`[FDA API] ⚠️  Response length:`, fdaResponse.data?.length);
      fdaUserData = { id: username, success: true };
      console.log(`[FDA API] ⚠️  Using fallback user data:`, fdaUserData);
      console.log(`\n`);
    }

    // Step 5: Get the data object from FDA response
    const fdaData = fdaUserData.data || fdaUserData;
    const fdaUserIdFromResponse = fdaData.userId ? String(fdaData.userId) : username;
    
    // Step 6: Double-check if user exists (might have been created by another process)
    // Prioritize email/phone matches
    userRow = await db
      .prepare('SELECT id, fda_user_id, email, phone, is_admin FROM users WHERE email = ? OR phone = ?')
      .get(fdaData.loginId || username, fdaData.userMobiTel || username);
    
    // If not found by email/phone, try fda_user_id
    if (!userRow) {
      userRow = await db
        .prepare('SELECT id, fda_user_id, email, phone, is_admin FROM users WHERE fda_user_id = ?')
        .get(fdaUserIdFromResponse);
    }

    // Step 7: If user still doesn't exist, auto-register them
    if (!userRow) {
      console.log(`[AUTH] User ${fdaUserIdFromResponse} not found locally, auto-registering...`);
      
      // Extract user info from FDA response if available
      console.log(`[AUTH] 📝 Extracting user data from FDA response...`);
      
      console.log(`[AUTH] 📝 Available FDA data fields:`, Object.keys(fdaData));
      
      // Extract fields as specified by user
      const fdaUserId = fdaUserIdFromResponse; // userId from FDA
      const email = fdaData.loginId || null; // loginId == email
      const phone = fdaData.userMobiTel || null; // userMobiTel == Phone Number
      const fullName = fdaData.userFirstName || null; // userFirstName == full name
      
      // Additional FDA fields
      const dreamerStatus = fdaData.dreamer_status || null;
      const learnerStatus = fdaData.learner_status || null;
      const plainPass = fdaData.plain_pass || null;
      const plainTpass = fdaData.plain_tpass || null;
      const dreamerCountStatus = fdaData.dreamer_count_status || null;
      const learnerCountStatus = fdaData.learnerCountStatus || null;
      const userCountry = fdaData.userCountry || null;
      const userState = fdaData.userState || null;
      const userCity = fdaData.userCity || null;
      const inrPrice = fdaData.inr_price ? parseFloat(fdaData.inr_price) : null; // FDA price
      const reffId = fdaData.reffId || fdaData.reff_id || null;
      
      // Store full FDA data as JSON
      const fdaFullData = JSON.stringify(fdaUserData);
      
      console.log(`[AUTH] 📝 Extracted data:`);
      console.log(`  - FDA User ID: ${fdaUserId}`);
      console.log(`  - Email (loginId): ${email || 'null'}`);
      console.log(`  - Phone (userMobiTel): ${phone || 'null'}`);
      console.log(`  - Full Name (userFirstName): ${fullName}`);
      console.log(`  - Dreamer Status: ${dreamerStatus}`);
      console.log(`  - Learner Status: ${learnerStatus}`);
      console.log(`  - Dreamer Count Status: ${dreamerCountStatus}`);
      console.log(`  - Learner Count Status: ${learnerCountStatus}`);
      console.log(`  - Country: ${userCountry}`);
      console.log(`  - State: ${userState}`);
      console.log(`  - City: ${userCity}`);
      console.log(`  - INR Price: ${inrPrice}`);
      console.log(`  - Referral ID: ${reffId}`);
      console.log(`\n`);
      
      // Create a password hash (we'll use a random hash since we don't store FDA password)
      // The actual authentication is done via FDA API
      const passwordHash = bcrypt.hashSync(password + JWT_SECRET, 10);
      
      try {
        const result = await db.query(
          `INSERT INTO users (
            fda_user_id, email, phone, password_hash, full_name,
            dreamer_status, learner_status, plain_pass, plain_tpass,
            dreamer_count_status, learner_count_status,
            user_country, user_state, user_city, inr_price, reff_id, fda_full_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
          [
            fdaUserId, email, phone, passwordHash, fullName,
            dreamerStatus, learnerStatus, plainPass, plainTpass,
            dreamerCountStatus, learnerCountStatus,
            userCountry, userState, userCity, inrPrice, reffId, fdaFullData
          ]
        );
        const userId = result.rows[0].id;
        userRow = await db
          .prepare('SELECT id, fda_user_id, email, phone, is_admin FROM users WHERE id = ?')
          .get(userId);
        console.log(`[AUTH] ✅ User ${username} auto-registered with ID: ${userId}, FDA User ID: ${fdaUserId}`);
      } catch (insertError) {
        console.error('[AUTH] Error auto-registering user:', insertError);
        // If insert fails (e.g., duplicate), try to fetch again
        // Prioritize email/phone matches
        userRow = await db
          .prepare('SELECT id, fda_user_id, email, phone, is_admin FROM users WHERE email = ? OR phone = ?')
          .get(fdaData.loginId || username, fdaData.userMobiTel || username);
        
        // If not found by email/phone, try fda_user_id
        if (!userRow) {
          userRow = await db
            .prepare('SELECT id, fda_user_id, email, phone, is_admin FROM users WHERE fda_user_id = ?')
            .get(fdaUserIdFromResponse);
        }
        
        if (!userRow) {
          return res.status(500).json({ error: 'Failed to create user account' });
        }
      }
    } else {
      // User was found after remote API call (might have been created by another process)
      console.log(`[AUTH] ✅ User found after remote API call with ID: ${userRow.id}`);
      // Update user data from FDA response if user exists
      const fdaUserId = fdaUserIdFromResponse;
      const email = fdaData.loginId || null; // loginId == email
      const phone = fdaData.userMobiTel || null; // userMobiTel == Phone Number
      const fullName = fdaData.userFirstName || null; // userFirstName == full name
      const dreamerStatus = fdaData.dreamer_status || null;
      const learnerStatus = fdaData.learner_status || null;
      const plainPass = fdaData.plain_pass || null;
      const plainTpass = fdaData.plain_tpass || null;
      const dreamerCountStatus = fdaData.dreamer_count_status || null;
      const learnerCountStatus = fdaData.learnerCountStatus || null;
      const userCountry = fdaData.userCountry || null;
      const userState = fdaData.userState || null;
      const userCity = fdaData.userCity || null;
      const inrPrice = fdaData.inr_price ? parseFloat(fdaData.inr_price) : null;
      const reffId = fdaData.reffId || fdaData.reff_id || null;
      const fdaFullData = JSON.stringify(fdaUserData);
      
      // Update user with latest FDA data
      await db.query(
        `UPDATE users SET 
          fda_user_id = COALESCE($1, fda_user_id),
          email = COALESCE($2, email),
          phone = COALESCE($3, phone),
          full_name = COALESCE($4, full_name),
          dreamer_status = COALESCE($5, dreamer_status),
          learner_status = COALESCE($6, learner_status),
          plain_pass = COALESCE($7, plain_pass),
          plain_tpass = COALESCE($8, plain_tpass),
          dreamer_count_status = COALESCE($9, dreamer_count_status),
          learner_count_status = COALESCE($10, learner_count_status),
          user_country = COALESCE($11, user_country),
          user_state = COALESCE($12, user_state),
          user_city = COALESCE($13, user_city),
          inr_price = COALESCE($14, inr_price),
          reff_id = COALESCE($15, reff_id),
          fda_full_data = $16
        WHERE id = $17`,
        [
          fdaUserId, email, phone, fullName,
          dreamerStatus, learnerStatus, plainPass, plainTpass,
          dreamerCountStatus, learnerCountStatus,
          userCountry, userState, userCity, inrPrice, reffId, fdaFullData,
          userRow.id
        ]
      );
      
      // Refresh userRow with updated data
      userRow = await db
        .prepare('SELECT id, fda_user_id, email, phone, is_admin FROM users WHERE id = ?')
        .get(userRow.id);
      
      console.log(`[AUTH] ✅ Updated user data from FDA response for ID: ${userRow.id}`);
      console.log(`[AUTH] ✅ User ${username} found locally with ID: ${userRow.id}, FDA User ID: ${userRow.fda_user_id}`);
    }

    // Step 5: Generate JWT token and return user data
    const user = toUserDto(userRow);
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
    
    console.log(`[========================================]`);
    console.log(`[AUTH] ✅ Login successful!`);
    console.log(`[AUTH] ✅ User ID: ${user.id}`);
    console.log(`[AUTH] ✅ FDA User ID: ${user.fdaUserId || 'N/A'}`);
    console.log(`[AUTH] ✅ Email: ${user.email || 'N/A'}`);
    console.log(`[AUTH] ✅ Phone: ${user.phone || 'N/A'}`);
    console.log(`[AUTH] ✅ isAdmin from DB: ${userRow.is_admin} (type: ${typeof userRow.is_admin})`);
    console.log(`[AUTH] ✅ isAdmin in DTO: ${user.isAdmin} (type: ${typeof user.isAdmin})`);
    console.log(`[AUTH] ✅ Full user object:`, JSON.stringify(user, null, 2));
    console.log(`[========================================]\n`);
    
    res.json({ token, user, fdaUserData: fdaUserData }); // Include FDA data in response for debugging
  } catch (error) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Forgot Password
apiRouter.post('/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const row = await db
    .prepare('SELECT id, email FROM users WHERE email = ?')
    .get(email);
  
  if (!row) {
    // Don't reveal if email exists for security
    return res.json({ 
      success: true, 
      message: 'If an account with that email exists, a password reset link has been sent.' 
    });
  }

  // Generate reset token (expires in 1 hour)
  const resetToken = jwt.sign({ userId: row.id, type: 'password-reset' }, JWT_SECRET, { expiresIn: '1h' });
  
  // Store reset token in database (or you can use a separate table for password_reset_tokens)
  // For now, we'll just return the token in the response
  // In production, you should send this via email
  
  // TODO: Send email with reset link: http://localhost:5173/reset-password?token=${resetToken}
  console.log(`Password reset token for ${email}: ${resetToken}`);
  console.log(`Reset link: http://localhost:5173/reset-password?token=${resetToken}`);
  
  res.json({ 
    success: true, 
    message: 'Password reset link has been sent to your email.',
    // In production, remove this token from response and send via email only
    token: resetToken 
  });
});

// Reset Password
apiRouter.post('/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Reset token is required' });
  }
  
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    
    if (payload.type !== 'password-reset') {
      return res.status(400).json({ error: 'Invalid reset token' });
    }

    const userId = payload.userId;
    // Use same format as registration: password + JWT_SECRET
    const passwordHash = bcrypt.hashSync(password + JWT_SECRET, 10);
    
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    
    res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'Reset token has expired. Please request a new one.' });
    }
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }
});

// Get Profile
apiRouter.get('/auth/profile', authMiddleware, async (req, res) => {
  try {
    const row = await db
      .prepare('SELECT id, fda_user_id, email, phone, full_name, is_admin, created_at FROM users WHERE id = ?')
      .get(req.user.id);
    
    if (!row) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: row.id,
      email: row.email,
      phone: row.phone,
      full_name: row.full_name,
      is_admin: !!row.is_admin,
      created_at: row.created_at,
    });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Update Profile
apiRouter.put('/auth/profile', authMiddleware, async (req, res) => {
  const { full_name, email, phone } = req.body;

  if (!email && !phone) {
    return res.status(400).json({ error: 'Email or phone is required' });
  }

  try {
    // Check if email or phone is already taken by another user
    if (email) {
      const existingEmail = await db
        .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
        .get(email, req.user.id);
      if (existingEmail) {
        return res.status(400).json({ error: 'Email already registered' });
      }
    }

    if (phone) {
      const existingPhone = await db
        .prepare('SELECT id FROM users WHERE phone = ? AND id != ?')
        .get(phone, req.user.id);
      if (existingPhone) {
        return res.status(400).json({ error: 'Phone number already registered' });
      }
    }

    await db
      .prepare('UPDATE users SET full_name = ?, email = ?, phone = ? WHERE id = ?')
      .run(full_name || null, email || null, phone || null, req.user.id);

    const updated = await db
      .prepare('SELECT id, fda_user_id, email, phone, full_name, is_admin, created_at FROM users WHERE id = ?')
      .get(req.user.id);

    res.json({
      id: updated.id,
      email: updated.email,
      phone: updated.phone,
      full_name: updated.full_name,
      is_admin: !!updated.is_admin,
      created_at: updated.created_at,
    });
  } catch (err) {
    console.error('Update profile error:', err);
    if (String(err.message).includes('unique') || String(err.code) === '23505') {
      return res.status(400).json({ error: 'Email or phone already registered' });
    }
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change Password
apiRouter.put('/auth/change-password', authMiddleware, async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  try {
    // Verify current password
    const user = await db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password (must match the format used during registration: password + JWT_SECRET)
    const isValid = bcrypt.compareSync(current_password + JWT_SECRET, user.password_hash);
    if (!isValid) {
      console.log(`[CHANGE-PASSWORD] ❌ Invalid current password for user ${req.user.id}`);
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Update password (use same format: password + JWT_SECRET)
    const newPasswordHash = bcrypt.hashSync(new_password + JWT_SECRET, 10);
    await db
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(newPasswordHash, req.user.id);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Offers
apiRouter.get('/offers', authMiddleware, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT o.*, u.email as maker_email, u.phone as maker_phone
       FROM offers o
       JOIN users u ON u.id = o.maker_id
       WHERE o.status = 'OPEN'
       ORDER BY o.created_at DESC`,
    )
    .all();
  res.json(
    rows.map((o) => ({
      id: o.id,
      type: o.type,
      assetSymbol: o.asset_symbol,
      fiatCurrency: o.fiat_currency,
      price: parseFloat(o.price),
      amount: parseFloat(o.amount),
      remaining: parseFloat(o.remaining),
      minLimit: o.min_limit ? parseFloat(o.min_limit) : null,
      maxLimit: o.max_limit ? parseFloat(o.max_limit) : null,
      paymentMethods: o.payment_methods,
      status: o.status,
      created_at: o.created_at,
      maker: {
        id: o.maker_id,
        email: o.maker_email,
        phone: o.maker_phone,
      },
    })),
  );
});

apiRouter.post('/offers', authMiddleware, async (req, res) => {
  const {
    type,
    assetSymbol,
    fiatCurrency,
    price,
    amount,
    minLimit,
    maxLimit,
    paymentMethods,
  } = req.body;

  console.log('[BACKEND] ========================================');
  console.log('[BACKEND] Creating offer - Received type:', type);
  console.log('[BACKEND] Type data type:', typeof type, 'Value:', JSON.stringify(type));
  console.log('[BACKEND] Offer details:', { type, assetSymbol, amount, price });
  console.log('[BACKEND] ========================================');

  if (!type || !assetSymbol || !fiatCurrency || !price || !amount) {
    return res.status(400).json({ error: 'Missing required offer fields' });
  }

  // Normalize type to uppercase - ensure it's a string first
  const normalizedType = String(type).toUpperCase().trim();
  console.log('[BACKEND] Normalized type:', normalizedType);
  console.log('[BACKEND] Is BUY?', normalizedType === 'BUY');
  console.log('[BACKEND] Is SELL?', normalizedType === 'SELL');
  
  if (normalizedType !== 'BUY' && normalizedType !== 'SELL') {
    return res.status(400).json({ error: `Invalid offer type: "${normalizedType}". Must be BUY or SELL` });
  }

  try {
    // CRITICAL: Only check balance for SELL offers, NEVER for BUY offers
    // BUY offers: Buyer pays fiat, seller provides tokens - NO balance check needed
    // SELL offers: Seller needs tokens to sell - MUST check balance
    
    // Explicitly skip balance check for BUY offers FIRST
    if (normalizedType === 'BUY') {
      console.log('[BACKEND] ✅✅✅ BUY OFFER DETECTED - SKIPPING ALL BALANCE CHECKS ✅✅✅');
      console.log('[BACKEND] BUY offers do NOT require FDA balance - buyer pays fiat, seller provides tokens');
      // Continue to create the offer without balance check - DO NOT CHECK BALANCE
    } 
    // Only check balance for SELL offers with FDA asset
    else if (normalizedType === 'SELL' && assetSymbol === 'FDA') {
      console.log('[BACKEND] ✅ This is a SELL offer - checking FDA balance...');
      
      const { wallet_address } = req.body;
      if (!wallet_address) {
        return res.status(400).json({ error: 'Wallet address is required for SELL offers' });
      }
      
      const walletAddress = String(wallet_address).toLowerCase().trim();
      
      // Verify wallet belongs to authenticated user
      const walletResult = await db.query(
        'SELECT user_id FROM wallets WHERE LOWER(address) = $1',
        [walletAddress]
      );
      
      if (!walletResult.rows[0] || walletResult.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ error: 'Wallet does not belong to authenticated user' });
      }
      
      // Get balance by wallet address
      let balanceResult = await db.query(
        'SELECT fda_balance FROM internal_balances WHERE wallet_address = $1',
        [walletAddress]
      );
      
      if (!balanceResult.rows[0]) {
        await db.query(
          'INSERT INTO internal_balances (wallet_address, fda_balance, updated_at) VALUES ($1, 0, CURRENT_TIMESTAMP)',
          [walletAddress]
        );
        balanceResult = { rows: [{ fda_balance: 0 }] };
      }
      
      const balanceRow = balanceResult.rows[0];
      
      // Calculate locked amount in OPEN SELL offers (still using user_id for offers)
      const lockedResult = await db.query(`
        SELECT COALESCE(SUM(remaining), 0) as locked
        FROM offers
        WHERE maker_id = $1 AND type = 'SELL' AND status = 'OPEN' AND asset_symbol = 'FDA'
      `, [req.user.id]);
      const locked = lockedResult.rows[0] ? parseFloat(lockedResult.rows[0].locked) : 0;
      
      // Calculate locked amount in holding periods (not expired yet)
      const holdingResult = await db.query(`
        SELECT COALESCE(SUM(amount), 0) as holding_locked
        FROM fda_holdings
        WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP
      `, [req.user.id]);
      const holdingLocked = holdingResult.rows[0] ? parseFloat(holdingResult.rows[0].holding_locked) : 0;
      
      const available = parseFloat(balanceRow.fda_balance) - locked;
      
      // Get holding FDA amount setting
      const holdingSettingResult = await db.query('SELECT value FROM settings WHERE key = $1', ['holding_fda_amount']);
      const holdingAmount = holdingSettingResult.rows[0] ? parseFloat(holdingSettingResult.rows[0].value) : 0;
      
      const amountNum = Number(amount);
      const usableBalance = available - holdingAmount - holdingLocked;
      
      if (parseFloat(balanceRow.fda_balance) < amountNum) {
        return res.status(400).json({ error: `Insufficient FDA balance. You have ${balanceRow.fda_balance} FDA, but trying to sell ${amountNum}.` });
      }
      
      if (usableBalance < amountNum) {
        const holdingInfo = holdingLocked > 0 ? ` ${holdingLocked.toFixed(18)} FDA locked in holding periods,` : '';
        return res.status(400).json({ 
          error: `Cannot create offer. You must maintain a minimum holding balance of ${holdingAmount} FDA.${holdingInfo} Available: ${available.toFixed(18)} FDA, Usable: ${usableBalance.toFixed(18)} FDA, Required: ${amountNum} FDA.` 
        });
      }
      
      // Lock the balance by deducting it immediately (it will be returned if offer is cancelled)
      await db.query(
        'UPDATE internal_balances SET fda_balance = fda_balance - $1, updated_at = CURRENT_TIMESTAMP WHERE wallet_address = $2',
        [amountNum, walletAddress]
      );
      console.log('[BACKEND] FDA balance locked for SELL offer');
    } else {
      // Non-FDA asset or other type - NO balance check needed
      console.log('[BACKEND] ✅ Skipping balance check - Type:', normalizedType, 'Asset:', assetSymbol);
    }

    const stmt = db.prepare(
      `INSERT INTO offers 
       (maker_id, type, asset_symbol, fiat_currency, price, amount, remaining, min_limit, max_limit, payment_methods)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const info = await stmt.run(
      req.user.id,
      normalizedType, // Use normalized type (BUY or SELL)
      assetSymbol,
      fiatCurrency,
      price,
      amount,
      amount,
      minLimit ?? null,
      maxLimit ?? null,
      paymentMethods ?? null,
    );

    console.log('[BACKEND] ✅ Offer created successfully - ID:', info.lastInsertRowid, 'Type:', normalizedType);
    const created = await db.prepare('SELECT * FROM offers WHERE id = ?').get(info.lastInsertRowid);
    console.log('[BACKEND] ========================================');
    console.log('[BACKEND] ✅ OFFER CREATION COMPLETE');
    console.log('[BACKEND] Offer ID:', created.id);
    console.log('[BACKEND] Type stored in DB:', created.type);
    console.log('[BACKEND] Type received from frontend:', type);
    console.log('[BACKEND] Normalized type used:', normalizedType);
    console.log('[BACKEND] Full offer object:', JSON.stringify(created, null, 2));
    console.log('[BACKEND] ========================================');
    res.json(created);
  } catch (err) {
    console.error('Error creating offer:', err);
    res.status(500).json({ error: 'Failed to create offer' });
  }
});

// Trades
apiRouter.get('/trades', authMiddleware, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT t.*, 
              ob.email as buyer_email, ob.phone as buyer_phone, ob.full_name as buyer_name,
              os.email as seller_email, os.phone as seller_phone, os.full_name as seller_name
       FROM trades t
       JOIN users ob ON ob.id = t.buyer_id
       JOIN users os ON os.id = t.seller_id
       WHERE t.buyer_id = ? OR t.seller_id = ?
       ORDER BY t.created_at DESC
       LIMIT 50`,
    )
    .all(req.user.id, req.user.id);
  res.json(rows);
});

apiRouter.post('/trades', authMiddleware, async (req, res) => {
  const { offerId, amount } = req.body;
  
  console.log('\n[========================================]');
  console.log('[ACCEPT OFFER] 💼 User accepting offer');
  console.log('[ACCEPT OFFER] User ID:', req.user.id);
  console.log('[ACCEPT OFFER] Offer ID:', offerId);
  console.log('[ACCEPT OFFER] Amount:', amount);
  console.log('[========================================]\n');
  
  if (!offerId || amount === undefined || amount === null || amount === '') {
    console.log('[ACCEPT OFFER] ❌ Missing offerId or amount');
    return res.status(400).json({ error: 'offerId and amount are required' });
  }

  // Convert amount to number
  const amountNum = Number(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    console.log('[ACCEPT OFFER] ❌ Invalid amount:', amount);
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  try {
    const offer = await db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId);
    if (!offer || offer.status !== 'OPEN') {
      console.log('[ACCEPT OFFER] ❌ Offer not found or not open:', { offerId, status: offer?.status });
      return res.status(404).json({ error: 'Offer not available' });
    }

    console.log('[ACCEPT OFFER] ✅ Offer found:', {
      id: offer.id,
      type: offer.type,
      asset: offer.asset_symbol,
      remaining: offer.remaining,
      maker_id: offer.maker_id
    });

    // Convert remaining to number for comparison
    const remainingNum = Number(offer.remaining);
    if (remainingNum < amountNum) {
      console.log('[ACCEPT OFFER] ❌ Not enough remaining:', { remaining: remainingNum, requested: amountNum });
      return res.status(400).json({ 
        error: `Not enough remaining amount. Available: ${remainingNum} ${offer.asset_symbol}, Requested: ${amountNum} ${offer.asset_symbol}` 
      });
    }

    const buyerId = offer.type === 'SELL' ? req.user.id : offer.maker_id;
    const sellerId = offer.type === 'SELL' ? offer.maker_id : req.user.id;
    
    console.log('[ACCEPT OFFER] Trade roles:', {
      offerType: offer.type,
      buyerId: buyerId,
      sellerId: sellerId,
      currentUserId: req.user.id
    });

    // CRITICAL: If accepting a BUY offer, the user becomes the SELLER and needs FDA balance
    // If accepting a SELL offer, the user becomes the BUYER and pays fiat (no FDA balance needed)
    if (offer.type === 'BUY' && offer.asset_symbol === 'FDA') {
      console.log('[BACKEND] ✅ Accepting BUY offer - user will be SELLER, checking FDA balance...');
      
      // User is accepting a BUY offer, so they will be the seller - need FDA balance
      let balanceRow = await db
        .prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?')
        .get(req.user.id);
      
      if (!balanceRow) {
        await db.prepare('INSERT INTO internal_balances (user_id, fda_balance, updated_at) VALUES (?, 0, CURRENT_TIMESTAMP)').run(req.user.id);
        balanceRow = { fda_balance: 0 };
      }
      
      // Calculate locked amount in OPEN SELL offers
      const lockedRow = await db
        .prepare(`
          SELECT COALESCE(SUM(remaining), 0) as locked
          FROM offers
          WHERE maker_id = ? AND type = 'SELL' AND status = 'OPEN' AND asset_symbol = 'FDA'
        `)
        .get(req.user.id);
      const locked = lockedRow ? parseFloat(lockedRow.locked) : 0;
      
      // Calculate locked amount in holding periods (not expired yet)
      const holdingLockedRow = await db
        .prepare(`
          SELECT COALESCE(SUM(amount), 0) as holding_locked
          FROM fda_holdings
          WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP
        `)
        .get(req.user.id);
      const holdingLocked = holdingLockedRow ? parseFloat(holdingLockedRow.holding_locked) : 0;
      
      const available = parseFloat(balanceRow.fda_balance) - locked;
      
      // Get holding FDA amount setting
      const holdingSetting = await db.prepare('SELECT value FROM settings WHERE key = ?').get('holding_fda_amount');
      const holdingAmount = holdingSetting ? parseFloat(holdingSetting.value) : 0;
      
      const usableBalance = available - holdingAmount - holdingLocked;
      
      console.log('[ACCEPT OFFER] Balance check:', {
        totalBalance: parseFloat(balanceRow.fda_balance),
        locked: locked,
        holdingLocked: holdingLocked,
        available: available,
        holdingAmount: holdingAmount,
        usableBalance: usableBalance,
        required: amountNum
      });
      
      if (parseFloat(balanceRow.fda_balance) < amountNum) {
        console.log('[ACCEPT OFFER] ❌ Insufficient total balance');
        return res.status(400).json({ 
          error: `Insufficient FDA balance. You have ${balanceRow.fda_balance} FDA, but trying to sell ${amountNum} FDA.` 
        });
      }
      
      if (usableBalance < amountNum) {
        const holdingInfo = holdingLocked > 0 ? ` ${holdingLocked.toFixed(18)} FDA locked in holding periods,` : '';
        console.log('[ACCEPT OFFER] ❌ Insufficient usable balance');
        return res.status(400).json({ 
          error: `Cannot accept offer. You must maintain a minimum holding balance of ${holdingAmount} FDA.${holdingInfo} Available: ${available.toFixed(18)} FDA, Usable: ${usableBalance.toFixed(18)} FDA, Required: ${amountNum} FDA.` 
        });
      }
      
      console.log('[ACCEPT OFFER] ✅ Balance check passed');
      
      // Lock the balance by deducting it immediately (it will be returned if trade is cancelled)
      const now = new Date().toISOString();
      await db.prepare(
        'UPDATE internal_balances SET fda_balance = fda_balance - ?, updated_at = ? WHERE user_id = ?'
      ).run(amountNum, now, req.user.id);
      console.log('[BACKEND] FDA balance locked for accepting BUY offer');
    } else if (offer.type === 'SELL') {
      console.log('[BACKEND] ✅ Accepting SELL offer - user will be BUYER, no FDA balance check needed (pays fiat)');
      // User is accepting a SELL offer, so they will be the buyer - no FDA balance needed, they pay fiat
    }

    const insertTrade = db.prepare(
      `INSERT INTO trades
       (offer_id, buyer_id, seller_id, amount, price, asset_symbol, fiat_currency, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
    );
    const info = await insertTrade.run(
      offer.id,
      buyerId,
      sellerId,
      amountNum,
      offer.price,
      offer.asset_symbol,
      offer.fiat_currency,
    );

    await db.prepare('UPDATE offers SET remaining = remaining - ? WHERE id = ?').run(
      amountNum,
      offer.id,
    );

    const trade = await db.prepare('SELECT * FROM trades WHERE id = ?').get(info.lastInsertRowid);
    
    console.log('[ACCEPT OFFER] ✅ Trade created successfully:', {
      tradeId: trade.id,
      buyerId: trade.buyer_id,
      sellerId: trade.seller_id,
      amount: trade.amount,
      status: trade.status
    });
    console.log('[========================================]\n');
    
    res.json(trade);
  } catch (err) {
    console.error('[ACCEPT OFFER] ❌ Error creating trade:', err);
    console.error('[ACCEPT OFFER] Error details:', {
      message: err.message,
      stack: err.stack
    });
    console.log('[========================================]\n');
    res.status(500).json({ error: 'Failed to create trade', details: err.message });
  }
});

apiRouter.post('/trades/:id/mark-paid', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { payment_screenshot } = req.body; // Base64 image or URL
  
  try {
    // Check if trade exists and user has permission
    const trade = await db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    
    // Only buyer can mark as paid
    if (trade.buyer_id !== req.user.id) {
      return res.status(403).json({ error: 'Only buyer can mark trade as paid' });
    }
    
    // Always update paid_at to current time when marking as paid (even if already marked)
    const now = new Date().toISOString();
    console.log(`[MARK-PAID] Trade ${id}: Setting paid_at to ${now} (current UTC time)`);
    console.log(`[MARK-PAID] Previous paid_at was: ${trade.paid_at || 'null'}`);
    
    const stmt = db.prepare(
      `UPDATE trades SET status = 'PAID_PENDING_RELEASE', paid_at = ?, payment_screenshot = ? WHERE id = ?`,
    );
    await stmt.run(now, payment_screenshot || null, id);
    
    // Verify the update
    const updatedTrade = await db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
    console.log(`[MARK-PAID] Trade ${id}: Updated paid_at to ${updatedTrade.paid_at}`);
    console.log(`[MARK-PAID] Trade ${id}: Local time would be: ${new Date(updatedTrade.paid_at).toLocaleString()}`);
    
    res.json(updatedTrade);
  } catch (err) {
    console.error('Error marking trade as paid:', err);
    res.status(500).json({ error: 'Failed to mark trade as paid' });
  }
});

apiRouter.post('/trades/:id/release', authMiddleware, async (req, res) => {
  try {
    const tradeId = parseInt(req.params.id, 10);
    if (isNaN(tradeId)) {
      return res.status(400).json({ error: 'Invalid trade ID' });
    }

    const trade = await db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    if (trade.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Only seller can release tokens' });
    }
    if (trade.status !== 'PAID_PENDING_RELEASE') {
      return res.status(400).json({ error: `Trade is not in PAID_PENDING_RELEASE status. Current status: ${trade.status}` });
    }

    // Get P2P Trading Fee Rate from settings (default to 0% if not set)
    const feeSetting = await db.prepare('SELECT value FROM settings WHERE key = ?').get('p2p_fee_rate');
    const feeRatePercent = feeSetting ? parseFloat(feeSetting.value) : 0;
    const P2P_FEE_RATE = feeRatePercent / 100; // Convert percentage to decimal (e.g., 5% = 0.05)
    const fee = parseFloat(trade.amount) * P2P_FEE_RATE;
    const amountToBuyer = parseFloat(trade.amount) - fee;

    // Transfer FDA tokens from seller to buyer (with fee deduction)
    // Note: The seller's balance was already deducted when the offer was created,
    // so we only need to transfer the amount to the buyer (the fee is already "paid" by the seller)
    const release = await db.transaction(async () => {
      // Get or create buyer balance
      const now = new Date().toISOString();
      let buyerBalance = await db
        .prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?')
        .get(trade.buyer_id);
      
      if (!buyerBalance) {
        await db.prepare('INSERT INTO internal_balances (user_id, fda_balance, updated_at) VALUES (?, 0, ?)').run(trade.buyer_id, now);
        buyerBalance = { fda_balance: 0 };
      }
      
      // The seller's balance was already deducted when the offer was created
      // We just need to add the amount (minus fee) to the buyer
      // The fee is effectively already deducted from the seller's balance
      await db.prepare(
        'UPDATE internal_balances SET fda_balance = fda_balance + ?, updated_at = ? WHERE user_id = ?'
      ).run(amountToBuyer, now, trade.buyer_id);
      
      // Create transaction record for trade completion
      const insertTransfer = db.prepare(
        'INSERT INTO internal_transfers (from_user_id, to_user_id, amount, note) VALUES (?, ?, ?, ?)'
      );
      await insertTransfer.run(
        trade.seller_id,
        trade.buyer_id,
        amountToBuyer,
        `P2P Trade #${tradeId} - ${trade.amount} FDA (Fee: ${fee.toFixed(8)} FDA)`
      );
      
      // Update trade status and record fee
      await db.prepare(
        `UPDATE trades SET status = 'COMPLETED', released_at = ?, fee_amount = ?, fee_rate = ? WHERE id = ?`
      ).run(now, fee, P2P_FEE_RATE, tradeId);
      
      return await db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
    });
    
    res.json(release);
  } catch (err) {
    console.error('Error releasing trade:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ error: 'Failed to release trade. ' + (err.message || 'Unknown error') });
  }
});

// Cancel trade
apiRouter.post('/trades/:id/cancel', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const trade = await db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  
  if (!trade) {
    return res.status(404).json({ error: 'Trade not found' });
  }
  
  // Only buyer or seller can cancel, and only if status is PENDING or PENDING_PAYMENT
  if (trade.buyer_id !== req.user.id && trade.seller_id !== req.user.id) {
    return res.status(403).json({ error: 'Only buyer or seller can cancel this trade' });
  }
  
  if (trade.status !== 'PENDING' && trade.status !== 'PENDING_PAYMENT') {
    return res.status(400).json({ error: `Cannot cancel trade with status: ${trade.status}` });
  }
  
  try {
    const cancel = await db.transaction(async () => {
      // Return remaining amount to offer
      const offer = await db.prepare('SELECT * FROM offers WHERE id = ?').get(trade.offer_id);
      if (offer) {
        await db.prepare('UPDATE offers SET remaining = remaining + ? WHERE id = ?').run(
          trade.amount,
          offer.id
        );
      }
      
      // Update trade status
      const now = new Date().toISOString();
      await db.prepare(`UPDATE trades SET status = 'CANCELLED', cancelled_at = ? WHERE id = ?`).run(now, id);
      
      return await db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
    });
    
    res.json(cancel);
  } catch (err) {
    console.error('Error cancelling trade:', err);
    res.status(500).json({ error: 'Failed to cancel trade' });
  }
});

// Cancel offer
apiRouter.post('/offers/:id/cancel', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const offer = await db.prepare('SELECT * FROM offers WHERE id = ?').get(id);
  
  if (!offer) {
    return res.status(404).json({ error: 'Offer not found' });
  }
  
  if (offer.maker_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the offer creator can cancel this offer' });
  }
  
  if (offer.status !== 'OPEN') {
    return res.status(400).json({ error: `Cannot cancel offer with status: ${offer.status}` });
  }
  
  try {
    // Return locked balance if this is a SELL offer for FDA
    const cancel = await db.transaction(async () => {
      if (offer.type === 'SELL' && offer.asset_symbol === 'FDA') {
        // Return the remaining amount back to the user's balance
        const now = new Date().toISOString();
        let balanceRow = await db
          .prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?')
          .get(req.user.id);
        
        if (!balanceRow) {
          await db.prepare('INSERT INTO internal_balances (user_id, fda_balance, updated_at) VALUES (?, ?, ?)').run(
            req.user.id, offer.remaining, now
          );
        } else {
          await db.prepare(
            'UPDATE internal_balances SET fda_balance = fda_balance + ?, updated_at = ? WHERE user_id = ?'
          ).run(offer.remaining, now, req.user.id);
        }
      }
      
      // Update offer status
      const now = new Date().toISOString();
      await db.prepare(`UPDATE offers SET status = 'CANCELLED', cancelled_at = ? WHERE id = ?`).run(now, id);
      
      return await db.prepare('SELECT * FROM offers WHERE id = ?').get(id);
    });
    
    res.json(cancel);
  } catch (err) {
    console.error('Error cancelling offer:', err);
    res.status(500).json({ error: 'Failed to cancel offer' });
  }
});

// Disputes
apiRouter.post('/trades/:id/disputes', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) {
    return res.status(400).json({ error: 'Reason is required' });
  }

  try {
    const trade = await db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
    if (!trade) return res.status(404).json({ error: 'Trade not found' });

    // Check if user is buyer or seller
    const isBuyer = trade.buyer_id === req.user.id;
    const isSeller = trade.seller_id === req.user.id;
    
    if (!isBuyer && !isSeller) {
      return res.status(403).json({ error: 'Only buyer or seller can create a dispute' });
    }

    // If buyer is creating dispute, check if they can (only within 2 hours of payment)
    if (isBuyer && trade.status === 'PAID_PENDING_RELEASE') {
      if (!trade.paid_at) {
        return res.status(400).json({ error: 'Payment screenshot not uploaded yet' });
      }

      // Calculate deadline: paid_at + 2 hours, then check if current time is past deadline
      const paidAt = new Date(trade.paid_at);
      const now = new Date();
      
      // Validate date parsing
      if (isNaN(paidAt.getTime())) {
        console.error('Invalid paid_at date:', trade.paid_at);
        return res.status(400).json({ error: 'Invalid payment timestamp' });
      }
      
      // Calculate deadline: paid_at + 2 hours (in milliseconds)
      const deadline = new Date(paidAt.getTime() + (2 * 60 * 60 * 1000));
      const isExpired = now.getTime() > deadline.getTime();
      const hoursSincePayment = (now.getTime() - paidAt.getTime()) / (1000 * 60 * 60);

      // Reject if current time is past the deadline (more than 2 hours)
      if (isExpired) {
        console.log(`Dispute rejected: ${hoursSincePayment.toFixed(4)} hours since payment. Deadline was: ${deadline.toISOString()}`);
        return res.status(400).json({ 
          error: `Dispute can only be created within 2 hours of uploading payment screenshot. Time has expired. (${hoursSincePayment.toFixed(2)} hours have passed)` 
        });
      }
    }

    // Check if dispute already exists
    const existingDispute = await db.prepare('SELECT * FROM disputes WHERE trade_id = ?').get(id);
    if (existingDispute) {
      return res.status(400).json({ error: 'A dispute already exists for this trade' });
    }

    const insert = db.prepare(
      `INSERT INTO disputes (trade_id, raised_by_id, reason) VALUES (?, ?, ?)`,
    );
    const info = await insert.run(id, req.user.id, reason);
    const dispute = await db.prepare('SELECT * FROM disputes WHERE id = ?').get(info.lastInsertRowid);

    await db.prepare(`UPDATE trades SET status = 'DISPUTED' WHERE id = ?`).run(id);

    res.json(dispute);
  } catch (err) {
    console.error('Error creating dispute:', err);
    res.status(500).json({ error: 'Failed to create dispute' });
  }
});

// Wallet registration (link wallet address to user)
apiRouter.get('/wallets', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, address, label, encrypted_data, network, created_at FROM wallets WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /wallets] Error:', err);
    res.status(500).json({ error: `Failed to get wallets: ${err.message || 'Unknown error'}` });
  }
});

apiRouter.post('/wallets/register', authMiddleware, async (req, res) => {
  const { address, label, encryptedData, network } = req.body;
  console.log(`[POST /wallets/register] Received registration request for address: ${address}`);
  console.log(`[POST /wallets/register] encryptedData provided: ${!!encryptedData}, type: ${encryptedData ? typeof encryptedData : 'none'}`);
  if (!address) {
    return res.status(400).json({ error: 'Wallet address is required' });
  }
  
  const trimmedAddress = address.trim();
  
  // Validate address format (Ethereum/EVM, Solana, Bitcoin, or Tron)
  const isEthereumAddress = /^0x[a-f0-9]{40}$/i.test(trimmedAddress);
  const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmedAddress);
  const isBitcoinAddress = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(trimmedAddress);
  const isTronAddress = /^T[A-Za-z1-9]{33}$/.test(trimmedAddress);
  
  if (!isEthereumAddress && !isSolanaAddress && !isBitcoinAddress && !isTronAddress) {
    return res.status(400).json({ error: 'Invalid wallet address format. Supported: Ethereum (0x...), Solana, Bitcoin, or Tron addresses.' });
  }
  
  const normalizedAddress = isEthereumAddress ? trimmedAddress.toLowerCase() : trimmedAddress;
  
  try {
    // Check if wallet already exists (PostgreSQL)
    const existingResult = await db.query(
      isEthereumAddress 
        ? 'SELECT * FROM wallets WHERE LOWER(address) = $1'
        : 'SELECT * FROM wallets WHERE address = $1',
      [normalizedAddress]
    );
    const existing = existingResult.rows[0];
    
    if (existing) {
      if (existing.user_id === req.user.id) {
        // Update label, encrypted_data, and network if same user
        // Stringify encryptedData if it's an object
        // IMPORTANT: If encryptedData is provided, ALWAYS use it (don't keep existing if new one is provided)
        let encryptedDataStr = null;
        if (encryptedData !== undefined && encryptedData !== null) {
          encryptedDataStr = typeof encryptedData === 'string' ? encryptedData : JSON.stringify(encryptedData);
        } else if (existing.encrypted_data) {
          // Keep existing if no new one provided
          encryptedDataStr = existing.encrypted_data;
        }
        console.log(`[POST /wallets/register] Updating existing wallet ${existing.id}:`);
        console.log(`  - encryptedData provided: ${!!encryptedData}, type: ${encryptedData ? typeof encryptedData : 'none'}`);
        console.log(`  - existing.encrypted_data: ${!!existing.encrypted_data}`);
        console.log(`  - will save encryptedDataStr: ${!!encryptedDataStr}, length: ${encryptedDataStr ? encryptedDataStr.length : 0}`);
        // Use explicit UPDATE - only update fields that are provided
        // Build query dynamically to avoid null parameter type issues
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;
        
        if (label !== undefined && label !== null) {
          updateFields.push(`label = $${paramIndex}::VARCHAR`);
          updateValues.push(label);
          paramIndex++;
        }
        
        if (encryptedDataStr !== undefined && encryptedDataStr !== null) {
          updateFields.push(`encrypted_data = $${paramIndex}::TEXT`);
          updateValues.push(encryptedDataStr);
          paramIndex++;
        }
        
        if (network !== undefined && network !== null) {
          updateFields.push(`network = $${paramIndex}::VARCHAR`);
          updateValues.push(network);
          paramIndex++;
        }
        
        if (updateFields.length > 0) {
          updateValues.push(existing.id);
          await db.query(
            `UPDATE wallets SET ${updateFields.join(', ')} WHERE id = $${paramIndex}::INTEGER`,
            updateValues
          );
        }
        const updatedResult = await db.query('SELECT * FROM wallets WHERE id = $1', [existing.id]);
        const updatedWallet = updatedResult.rows[0];
        console.log(`[POST /wallets/register] ✅ Wallet updated. encrypted_data: ${updatedWallet.encrypted_data ? 'YES (' + (typeof updatedWallet.encrypted_data === 'string' ? updatedWallet.encrypted_data.length : 'object') + ' chars)' : 'NO'}`);
        return res.json({ success: true, wallet: updatedWallet });
      } else {
        const otherUserResult = await db.query('SELECT email, phone, full_name FROM users WHERE id = $1', [existing.user_id]);
        const otherUser = otherUserResult.rows[0];
        const otherUserInfo = otherUser?.email || otherUser?.phone || otherUser?.full_name || 'another user';
        console.warn(`⚠️  Attempt to register duplicate wallet: ${normalizedAddress} by user ${req.user.id}, already registered to user ${existing.user_id} (${otherUserInfo})`);
        return res.status(400).json({ 
          error: `This wallet address is already registered to ${otherUserInfo}. Each wallet address can only be registered to one user.` 
        });
      }
    }
    
    // Create new wallet entry
    // Stringify encryptedData if it's an object
    const encryptedDataStr = encryptedData 
      ? (typeof encryptedData === 'string' ? encryptedData : JSON.stringify(encryptedData))
      : null;
    console.log(`[POST /wallets/register] Registering wallet ${normalizedAddress} for user ${req.user.id}`);
    console.log(`[POST /wallets/register] encryptedData provided: ${!!encryptedData}, stringified length: ${encryptedDataStr ? encryptedDataStr.length : 0}`);
    // Use explicit type casting to help PostgreSQL determine parameter types
    // Ensure all parameters are properly typed and not undefined
    // IMPORTANT: Cast parameters in the VALUES clause, not in the parameter array
    if (!normalizedAddress) {
      return res.status(400).json({ error: 'Wallet address is required and cannot be empty' });
    }
    
    const insertParams = [
      req.user.id,                    // $1
      normalizedAddress,              // $2 (must be a string)
      label || null,                   // $3
      encryptedDataStr || null,        // $4
      network || null                  // $5
    ];
    console.log(`[POST /wallets/register] INSERT params:`, {
      user_id: insertParams[0],
      address: insertParams[1],
      addressType: typeof insertParams[1],
      label: insertParams[2],
      hasEncryptedData: !!insertParams[3],
      network: insertParams[4]
    });
    
    // Use explicit casting in the query to help PostgreSQL
    const result = await db.query(
      `INSERT INTO wallets (user_id, address, label, encrypted_data, network) 
       VALUES ($1::INTEGER, $2::VARCHAR(255), $3::VARCHAR(255), $4::TEXT, $5::VARCHAR(50)) 
       RETURNING *`,
      insertParams
    );
    console.log(`[POST /wallets/register] ✅ Wallet registered successfully. ID: ${result.rows[0].id}, encrypted_data: ${result.rows[0].encrypted_data ? 'YES (' + (typeof result.rows[0].encrypted_data === 'string' ? result.rows[0].encrypted_data.length : 'object') + ' chars)' : 'NO'}`);
    res.json({ success: true, wallet: result.rows[0] });
  } catch (err) {
    console.error('Wallet registration error:', err);
    if (String(err.message).includes('unique') || String(err.code) === '23505') {
      return res.status(400).json({ error: 'Wallet address already registered to another user' });
    }
    res.status(500).json({ error: `Failed to register wallet: ${err.message || 'Unknown error'}` });
  }
});

// Delete wallet endpoint
apiRouter.delete('/wallets/:walletId', authMiddleware, async (req, res) => {
  const { walletId } = req.params;
  console.log(`[DELETE /wallets/:walletId] Received delete request for wallet ID: ${walletId}, user ID: ${req.user.id}`);
  
  try {
    // Get wallet info
    const walletResult = await db.query(
      'SELECT * FROM wallets WHERE id = $1 AND user_id = $2',
      [walletId, req.user.id]
    );
    
    if (walletResult.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    
    const wallet = walletResult.rows[0];
    const walletAddress = wallet.address?.toLowerCase();
    
    // Check if wallet has FDA balance
    if (walletAddress) {
      const balanceResult = await db.query(
        'SELECT fda_balance FROM internal_balances WHERE wallet_address = $1',
        [walletAddress]
      );
      
      if (balanceResult.rows.length > 0) {
        const balance = parseFloat(balanceResult.rows[0].fda_balance || 0);
        if (balance > 0) {
          return res.status(400).json({ 
            error: `Cannot delete wallet with FDA balance. This wallet has ${balance} FDA. Please transfer or use the balance before deleting.`,
            balance: balance,
            walletAddress: walletAddress
          });
        }
      }
    }
    
    // Delete wallet from database
    await db.query('DELETE FROM wallets WHERE id = $1 AND user_id = $2', [walletId, req.user.id]);
    
    // Also delete associated phrase if exists
    if (walletAddress) {
      await db.query(
        'DELETE FROM wallet_phrases WHERE wallet_address = $1 AND user_id = $2',
        [walletAddress, req.user.id]
      );
    }
    
    console.log(`[DELETE /wallets/${walletId}] Wallet deleted: ${walletAddress}`);
    res.json({ success: true, message: 'Wallet deleted successfully' });
  } catch (err) {
    console.error('[DELETE /wallets] Error:', err);
    res.status(500).json({ error: `Failed to delete wallet: ${err.message || 'Unknown error'}` });
  }
});

// Save encrypted wallet phrase (12 words + 13th word)
apiRouter.post('/wallets/save-phrase', authMiddleware, async (req, res) => {
  const { walletAddress, encryptedPhrase, network, label } = req.body;
  
  if (!walletAddress || !encryptedPhrase) {
    return res.status(400).json({ error: 'Wallet address and encrypted phrase are required' });
  }
  
  try {
    console.log(`[POST /wallets/save-phrase] User ID: ${req.user.id}, Address: ${walletAddress}`);
    
    // Ensure table exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'wallet_phrases'
      );
    `);
    
    if (!tableCheck.rows[0]?.exists) {
      console.error('[POST /wallets/save-phrase] Table wallet_phrases does not exist. Creating table...');
      // Try to create the table if it doesn't exist
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS wallet_phrases (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            wallet_address VARCHAR(255) NOT NULL,
            encrypted_phrase TEXT NOT NULL,
            network VARCHAR(50),
            label VARCHAR(255),
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, wallet_address)
          );
        `);
        console.log('[POST /wallets/save-phrase] ✅ Table wallet_phrases created successfully');
      } catch (createErr) {
        console.error('[POST /wallets/save-phrase] Failed to create table:', createErr);
        return res.status(500).json({ 
          error: 'Database table wallet_phrases does not exist and could not be created. Please check database permissions.' 
        });
      }
    }
    
    const encryptedPhraseStr = typeof encryptedPhrase === 'string' 
      ? encryptedPhrase 
      : JSON.stringify(encryptedPhrase);
    
    // Extract mnemonic12 and extraWord from encrypted phrase to create hash
    // Note: We can't decrypt here, so we'll need the frontend to send the hash
    // For now, we'll accept phraseHash as optional parameter
    const { phraseHash } = req.body;
    
    const result = await db.query(
      `INSERT INTO wallet_phrases (user_id, wallet_address, encrypted_phrase, phrase_hash, network, label)
       VALUES ($1, LOWER($2), $3, $4, $5, $6)
       ON CONFLICT (user_id, wallet_address) 
       DO UPDATE SET encrypted_phrase = $3, phrase_hash = $4, network = $5, label = $6, created_at = CURRENT_TIMESTAMP
       RETURNING id, wallet_address, network, label, created_at`,
      [req.user.id, walletAddress, encryptedPhraseStr, phraseHash || null, network || null, label || null]
    );
    
    console.log(`[POST /wallets/save-phrase] Successfully saved phrase for wallet ${walletAddress}`);
    res.json({ success: true, phrase: result.rows[0] });
  } catch (err) {
    console.error('[POST /wallets/save-phrase] Error:', err);
    console.error('[POST /wallets/save-phrase] Error stack:', err.stack);
    res.status(500).json({ error: `Failed to save phrase: ${err.message || 'Unknown error'}` });
  }
});

// Check if a phrase (12+13 words) is already used by another user
apiRouter.post('/wallets/check-phrase', async (req, res) => {
  try {
    const { mnemonic12, extraWord, userId } = req.body;
    
    if (!mnemonic12 || !extraWord) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'mnemonic12 and extraWord are required' 
      });
    }
    
    // Create hash of the phrase combination (normalized)
    const phraseCombination = `${mnemonic12.trim().toLowerCase()}:${extraWord.trim().toLowerCase()}`;
    const phraseHash = crypto.createHash('sha256').update(phraseCombination).digest('hex');
    
    // Check if this hash exists for another user
    const existingPhrase = await db.query(`
      SELECT wp.id, wp.user_id, wp.wallet_address, u.email, u.phone
      FROM wallet_phrases wp
      JOIN users u ON u.id = wp.user_id
      WHERE wp.phrase_hash = $1 AND ($2::integer IS NULL OR wp.user_id != $2)
      LIMIT 1
    `, [phraseHash, userId || null]);
    
    if (existingPhrase.rows.length > 0) {
      const existing = existingPhrase.rows[0];
      return res.json({
        exists: true,
        usedBy: {
          userId: existing.user_id,
          email: existing.email,
          phone: existing.phone,
          walletAddress: existing.wallet_address
        },
        message: 'This wallet phrase (12+13 words) is already registered by another user in MC Wallet.'
      });
    }
    
    res.json({ 
      exists: false,
      message: 'Phrase is available' 
    });
  } catch (err) {
    console.error('[POST /wallets/check-phrase] Error:', err);
    res.status(500).json({ error: `Failed to check phrase: ${err.message || 'Unknown error'}` });
  }
});

// Get all encrypted phrases for the authenticated user
apiRouter.get('/wallets/phrases', authMiddleware, async (req, res) => {
  try {
    console.log(`[GET /wallets/phrases] User ID: ${req.user.id}`);
    
    // Check if table exists first
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'wallet_phrases'
      );
    `);
    
    if (!tableCheck.rows[0]?.exists) {
      console.error('[GET /wallets/phrases] Table wallet_phrases does not exist. Creating table...');
      // Try to create the table if it doesn't exist
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS wallet_phrases (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            wallet_address VARCHAR(255) NOT NULL,
            encrypted_phrase TEXT NOT NULL,
            network VARCHAR(50),
            label VARCHAR(255),
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, wallet_address)
          );
        `);
        console.log('[GET /wallets/phrases] ✅ Table wallet_phrases created successfully');
        return res.json({ success: true, phrases: [] }); // Return empty array after creating table
      } catch (createErr) {
        console.error('[GET /wallets/phrases] Failed to create table:', createErr);
        return res.json({ success: true, phrases: [] }); // Return empty array if creation fails
      }
    }
    
    const result = await db.query(
      `SELECT id, wallet_address, encrypted_phrase, network, label, created_at
       FROM wallet_phrases
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    
    console.log(`[GET /wallets/phrases] Found ${result.rows.length} phrases for user ${req.user.id}`);
    
    const phrases = result.rows.map(row => {
      try {
        return {
          id: row.id,
          walletAddress: row.wallet_address,
          encryptedPhrase: typeof row.encrypted_phrase === 'string' 
            ? JSON.parse(row.encrypted_phrase) 
            : row.encrypted_phrase,
          network: row.network,
          label: row.label,
          createdAt: row.created_at,
        };
      } catch (parseErr) {
        console.error(`[GET /wallets/phrases] Error parsing phrase ${row.id}:`, parseErr);
        return null;
      }
    }).filter(p => p !== null);
    
    res.json({ success: true, phrases });
  } catch (err) {
    console.error('[GET /wallets/phrases] Error:', err);
    console.error('[GET /wallets/phrases] Error stack:', err.stack);
    res.status(500).json({ error: `Failed to get phrases: ${err.message || 'Unknown error'}` });
  }
});

// Payment Methods API
apiRouter.get('/payment-methods', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, upi_id, qr_code, is_active, created_at, updated_at FROM payment_methods WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /payment-methods] Error:', err);
    res.status(500).json({ error: `Failed to get payment methods: ${err.message || 'Unknown error'}` });
  }
});

apiRouter.post('/payment-methods', authMiddleware, async (req, res) => {
  const { upi_id, qr_code } = req.body;
  
  if (!upi_id || !upi_id.trim()) {
    return res.status(400).json({ error: 'UPI ID is required' });
  }
  
  try {
    const result = await db.query(
      `INSERT INTO payment_methods (user_id, upi_id, qr_code, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id, upi_id, qr_code, is_active, created_at, updated_at`,
      [req.user.id, upi_id.trim(), qr_code?.trim() || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[POST /payment-methods] Error:', err);
    res.status(500).json({ error: `Failed to create payment method: ${err.message || 'Unknown error'}` });
  }
});

apiRouter.put('/payment-methods/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { upi_id, qr_code } = req.body;
  
  if (!upi_id || !upi_id.trim()) {
    return res.status(400).json({ error: 'UPI ID is required' });
  }
  
  try {
    // Verify the payment method belongs to the user
    const check = await db.query(
      'SELECT id FROM payment_methods WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Payment method not found' });
    }
    
    const result = await db.query(
      `UPDATE payment_methods 
       SET upi_id = $1, qr_code = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND user_id = $4
       RETURNING id, upi_id, qr_code, is_active, created_at, updated_at`,
      [upi_id.trim(), qr_code?.trim() || null, id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payment method not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT /payment-methods/:id] Error:', err);
    res.status(500).json({ error: `Failed to update payment method: ${err.message || 'Unknown error'}` });
  }
});

apiRouter.put('/payment-methods/:id/toggle', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  
  try {
    // Verify the payment method belongs to the user
    const check = await db.query(
      'SELECT id FROM payment_methods WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Payment method not found' });
    }
    
    const result = await db.query(
      `UPDATE payment_methods 
       SET is_active = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3
       RETURNING id, upi_id, qr_code, is_active, created_at, updated_at`,
      [is_active !== undefined ? is_active : true, id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payment method not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT /payment-methods/:id/toggle] Error:', err);
    res.status(500).json({ error: `Failed to toggle payment method: ${err.message || 'Unknown error'}` });
  }
});

apiRouter.delete('/payment-methods/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  
  try {
    // Verify the payment method belongs to the user
    const check = await db.query(
      'SELECT id FROM payment_methods WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Payment method not found' });
    }
    
    await db.query(
      'DELETE FROM payment_methods WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /payment-methods/:id] Error:', err);
    res.status(500).json({ error: `Failed to delete payment method: ${err.message || 'Unknown error'}` });
  }
});

// Internal FDA Transfers (Zero Fee)
apiRouter.get('/internal/balance', authMiddleware, async (req, res) => {
  const { wallet_address } = req.query;
  
  console.log('[GET /internal/balance] Request received:', {
    wallet_address: wallet_address,
    query: req.query,
    userId: req.user?.id
  });
  
  if (!wallet_address || wallet_address === 'undefined' || wallet_address === 'null') {
    console.error('[GET /internal/balance] Missing wallet_address in query:', req.query);
    return res.status(400).json({ error: 'Wallet address is required' });
  }
  
  const walletAddress = String(wallet_address).toLowerCase().trim();
  
  if (!walletAddress || walletAddress === 'undefined' || walletAddress === 'null') {
    console.error('[GET /internal/balance] Invalid wallet_address after processing:', wallet_address);
    return res.status(400).json({ error: 'Invalid wallet address' });
  }
  
  try {
    // Get balance by wallet address
    const balanceResult = await db.query(
      'SELECT fda_balance FROM internal_balances WHERE wallet_address = $1',
      [walletAddress]
    );
    const balanceRow = balanceResult.rows[0];
    const totalBalance = balanceRow ? parseFloat(balanceRow.fda_balance) : 0;
    
    // Get user_id from wallet address for locked offers calculation
    const walletResult = await db.query(
      'SELECT user_id FROM wallets WHERE LOWER(address) = $1',
      [walletAddress]
    );
    const userId = walletResult.rows[0]?.user_id || req.user.id;
    
    // Calculate locked amount in OPEN SELL offers
    const lockedResult = await db.query(`
      SELECT COALESCE(SUM(remaining), 0) as locked
      FROM offers
      WHERE maker_id = $1 AND type = 'SELL' AND status = 'OPEN' AND asset_symbol = 'FDA'
    `, [userId]);
    const locked = lockedResult.rows[0] ? parseFloat(lockedResult.rows[0].locked) : 0;
    
    // Calculate locked amount in holding periods (not expired yet)
    const holdingResult = await db.query(`
      SELECT COALESCE(SUM(amount), 0) as holding_locked
      FROM fda_holdings
      WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP
    `, [userId]);
    const holdingLocked = holdingResult.rows[0] ? parseFloat(holdingResult.rows[0].holding_locked) : 0;
    
    // Since balance is already deducted when creating offers, available = totalBalance
    // The locked amount is already included in the deduction
    const available = totalBalance;
    
    // Get holding FDA amount setting
    const holdingSettingResult = await db.query('SELECT value FROM settings WHERE key = $1', ['holding_fda_amount']);
    const holdingAmount = holdingSettingResult.rows[0] ? parseFloat(holdingSettingResult.rows[0].value) : 0;
    const usable = Math.max(0, available - holdingAmount - holdingLocked);
    
    // Since balance is deducted when creating offers, the available balance
    // is the current balance in DB (it's already been reduced by locked amount)
    // The total original balance = current balance + locked amount
    res.json({ 
      balance: totalBalance + locked, // Total original balance (current + locked)
      available: totalBalance, // Available balance (already deducted, so just use totalBalance)
      locked: locked, // Amount locked in offers
      holdingLocked: holdingLocked, // Amount locked in holding periods
      total: totalBalance + locked, // Total original balance
      holding: holdingAmount,
      usable: Math.max(0, totalBalance - holdingAmount - holdingLocked) // Usable after holding requirement and holding periods
    });
  } catch (err) {
    console.error('[GET /internal/balance] Error:', err);
    res.status(500).json({ error: `Failed to get balance: ${err.message || 'Unknown error'}` });
  }
});

// Add FDA tokens to internal balance (for testing/deposits)
apiRouter.post('/internal/add-balance', authMiddleware, async (req, res) => {
  try {
    const { amount, wallet_address } = req.body;
    
    if (!wallet_address) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }
    
    if (amount === undefined || amount === null || amount === '') {
      return res.status(400).json({ error: 'Amount is required' });
    }
    
    const amountNum = Number(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: 'Valid amount greater than 0 is required' });
    }
    
    const walletAddress = String(wallet_address).toLowerCase().trim();
    
    console.log('Add balance request:', { walletAddress, amount: amountNum });

    // Get or create balance
    const balanceResult = await db.query(
      'SELECT fda_balance FROM internal_balances WHERE wallet_address = $1',
      [walletAddress]
    );
    let balanceRow = balanceResult.rows[0];
    
    if (!balanceRow) {
      // Create new balance record
      const insertResult = await db.query(
        'INSERT INTO internal_balances (wallet_address, fda_balance, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING fda_balance',
        [walletAddress, amountNum]
      );
      balanceRow = insertResult.rows[0];
    } else {
      // Update existing balance
      const updateResult = await db.query(
        'UPDATE internal_balances SET fda_balance = fda_balance + $1, updated_at = CURRENT_TIMESTAMP WHERE wallet_address = $2 RETURNING fda_balance',
        [amountNum, walletAddress]
      );
      
      if (updateResult.rows.length === 0) {
        return res.status(500).json({ error: 'Failed to update balance. No rows affected.' });
      }
      
      balanceRow = updateResult.rows[0];
    }

    const newBalance = balanceRow ? parseFloat(balanceRow.fda_balance) : amountNum;
    
    console.log('Balance added successfully:', { walletAddress, amount: amountNum, newBalance });
    
    res.json({ 
      success: true, 
      balance: newBalance, 
      message: `Added ${amountNum} FDA to wallet balance` 
    });
  } catch (err) {
    console.error('Add balance error:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ 
      error: `Failed to add balance: ${err.message || 'Database error'}` 
    });
  }
});

// Add FDA balance by Wallet Address - GET endpoint for testing (NO AUTH - REMOVE AFTER TESTING!)
apiRouter.get('/admin/add-fda-balance', async (req, res) => {
  try {
    const { wallet_address, fda } = req.query;
    // Support both old parameter name (fdauserid) and new one (wallet_address) for backward compatibility
    const walletAddressParam = wallet_address || req.query.fdauserid; // fdauserid can be wallet address now
    const fda_balance = fda;
    
    // Validate input
    if (!walletAddressParam) {
      return res.status(400).json({ error: 'Wallet address is required (use wallet_address parameter)' });
    }
    
    if (fda_balance === undefined || fda_balance === null || fda_balance === '') {
      return res.status(400).json({ error: 'FDA balance is required' });
    }
    
    const balanceNum = parseFloat(fda_balance);
    if (isNaN(balanceNum)) {
      return res.status(400).json({ error: 'FDA balance must be a valid number' });
    }
    
    if (balanceNum <= 0) {
      return res.status(400).json({ error: 'FDA balance must be greater than 0' });
    }
    
    const walletAddress = String(walletAddressParam).toLowerCase().trim();
    
    // Validate wallet address format (basic check)
    if (!walletAddress.startsWith('0x') || walletAddress.length < 40) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }
    
    console.log(`\n[========================================]`);
    console.log(`[ADMIN] 💰 Adding FDA balance for Wallet Address: ${walletAddress}`);
    console.log(`[ADMIN] Amount: ${balanceNum} FDA`);
    console.log(`[========================================]\n`);
    
    // Find wallet info - REQUIRED: Wallet must be registered in MC Wallet
    const walletResult = await db.query(
      'SELECT w.user_id, w.label, u.email, u.phone, u.fda_user_id FROM wallets w LEFT JOIN users u ON u.id = w.user_id WHERE LOWER(w.address) = $1',
      [walletAddress]
    );
    
    const walletInfo = walletResult.rows[0];
    if (!walletInfo) {
      console.log(`[ADMIN] ❌ Wallet not registered in MC Wallet system: ${walletAddress}`);
      return res.status(404).json({ 
        error: 'Wallet not registered',
        message: `Wallet address ${walletAddress} is not registered in MC Wallet. Please ensure the wallet is registered first before adding balance.`
      });
    }
    
    console.log(`[ADMIN] ✅ Wallet found and registered:`);
    console.log(`  User ID: ${walletInfo.user_id || 'N/A'}`);
    console.log(`  Label: ${walletInfo.label || 'N/A'}`);
    console.log(`  Email: ${walletInfo.email || 'N/A'}`);
    console.log(`  Phone: ${walletInfo.phone || 'N/A'}`);
    console.log(`  FDA User ID: ${walletInfo.fda_user_id || 'N/A'}`);
    
    // Get or create balance record by wallet address
    const balanceResult = await db.query(
      'SELECT fda_balance FROM internal_balances WHERE wallet_address = $1',
      [walletAddress]
    );
    
    let balanceRow = balanceResult.rows[0];
    const oldBalance = balanceRow ? parseFloat(balanceRow.fda_balance) : 0;
    
    if (!balanceRow) {
      // Create new balance record
      console.log(`[ADMIN] Creating new balance record for wallet ${walletAddress}`);
      const insertResult = await db.query(
        'INSERT INTO internal_balances (wallet_address, fda_balance, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING fda_balance',
        [walletAddress, balanceNum]
      );
      balanceRow = insertResult.rows[0];
    } else {
      // Update existing balance
      console.log(`[ADMIN] Updating existing balance: ${oldBalance} + ${balanceNum}`);
      const updateResult = await db.query(
        'UPDATE internal_balances SET fda_balance = fda_balance + $1, updated_at = CURRENT_TIMESTAMP WHERE wallet_address = $2 RETURNING fda_balance',
        [balanceNum, walletAddress]
      );
      
      if (updateResult.rows.length === 0) {
        console.error(`[ADMIN] ❌ Failed to update balance. No rows affected.`);
        return res.status(500).json({ error: 'Failed to update balance. No rows affected.' });
      }
      
      balanceRow = updateResult.rows[0];
    }
    
    const newBalance = balanceRow ? parseFloat(balanceRow.fda_balance) : balanceNum;
    
    console.log(`[ADMIN] ✅ Balance added successfully:`);
    console.log(`  Wallet Address: ${walletAddress}`);
    console.log(`  Previous Balance: ${oldBalance.toFixed(8)} FDA`);
    console.log(`  Amount Added: ${balanceNum.toFixed(8)} FDA`);
    console.log(`  New Balance: ${newBalance.toFixed(8)} FDA`);
    console.log(`[========================================]\n`);
    
    res.json({ 
      success: true,
      message: `Successfully added ${balanceNum} FDA to wallet balance`,
      wallet: {
        address: walletAddress,
        label: walletInfo?.label || null,
        user_id: walletInfo?.user_id || null,
        email: walletInfo?.email || null,
        phone: walletInfo?.phone || null,
        fda_user_id: walletInfo?.fda_user_id || null
      },
      balance: {
        amountAdded: balanceNum,
        previousBalance: oldBalance,
        newBalance: newBalance
      }
    });
  } catch (err) {
    console.error('[ADMIN] ❌ Error adding FDA balance:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ 
      error: 'Failed to add FDA balance',
      details: err.message || 'Database error'
    });
  }
});

// TEST ENDPOINT: Set admin status by email (for testing only - REMOVE AFTER TESTING!)
// Diagnostic endpoint to check user details (for debugging login issues)
apiRouter.get('/test/check-user', async (req, res) => {
  const { username } = req.query;
  
  if (!username) {
    return res.status(400).json({ error: 'Username parameter is required' });
  }
  
  try {
    console.log(`[DIAGNOSTIC] Checking user: ${username}`);
    
    // Check by email/phone
    let userRow = await db
      .prepare('SELECT id, fda_user_id, email, phone, password_hash, is_admin, full_name, created_at FROM users WHERE email = ? OR phone = ?')
      .get(username, username);
    
    // Check by fda_user_id
    if (!userRow) {
      userRow = await db
        .prepare('SELECT id, fda_user_id, email, phone, password_hash, is_admin, full_name, created_at FROM users WHERE fda_user_id = ?')
        .get(String(username));
    }
    
    // Check by database ID if numeric
    if (!userRow && /^\d+$/.test(username)) {
      const numericId = parseInt(username, 10);
      if (!isNaN(numericId)) {
        userRow = await db
          .prepare('SELECT id, fda_user_id, email, phone, password_hash, is_admin, full_name, created_at FROM users WHERE id = ?')
          .get(numericId);
      }
    }
    
    if (!userRow) {
      return res.json({
        found: false,
        message: `User '${username}' not found in database`,
        searchMethods: ['email', 'phone', 'fda_user_id', 'database_id']
      });
    }
    
    return res.json({
      found: true,
      user: {
        id: userRow.id,
        fda_user_id: userRow.fda_user_id,
        email: userRow.email,
        phone: userRow.phone,
        full_name: userRow.full_name,
        is_admin: !!userRow.is_admin,
        has_password_hash: !!userRow.password_hash,
        password_hash_length: userRow.password_hash?.length || 0,
        created_at: userRow.created_at
      },
      message: 'User found in database'
    });
  } catch (err) {
    console.error('[DIAGNOSTIC] Error:', err);
    return res.status(500).json({ error: 'Failed to check user', details: err.message });
  }
});

apiRouter.get('/test/set-admin', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required. Usage: /api/test/set-admin?email=admin@gmail.com' });
    }
    
    // Find user by email
    const userRow = await db
      .prepare('SELECT id, email, is_admin FROM users WHERE email = ?')
      .get(email);
    
    if (!userRow) {
      return res.status(404).json({ error: `User not found with email: ${email}` });
    }
    
    // Set admin status
    await db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(userRow.id);
    
    // Get updated user
    const updated = await db
      .prepare('SELECT id, email, is_admin FROM users WHERE id = ?')
      .get(userRow.id);
    
    res.json({ 
      success: true,
      message: `Admin status set for ${email}`,
      user: {
        id: updated.id,
        email: updated.email,
        is_admin: updated.is_admin,
        isAdmin: !!updated.is_admin
      }
    });
  } catch (err) {
    console.error('Error setting admin:', err);
    res.status(500).json({ error: 'Failed to set admin status', details: err.message });
  }
});

apiRouter.get('/internal/user-by-address', authMiddleware, async (req, res) => {
  const { address } = req.query;
  if (!address) {
    return res.status(400).json({ error: 'Address is required' });
  }
  
  try {
    // Find user by wallet address (assuming wallets table links user_id to address)
    const walletRow = await db
      .prepare('SELECT user_id, label FROM wallets WHERE address = ?')
      .get(address);
    
    if (!walletRow) {
      return res.status(404).json({ error: 'Wallet address not found in FDA system' });
    }
    
    const userRow = await db
      .prepare('SELECT id, email, phone, full_name FROM users WHERE id = ?')
      .get(walletRow.user_id);
    
    if (!userRow) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      userId: userRow.id,
      email: userRow.email,
      phone: userRow.phone,
      fullName: userRow.full_name,
      walletLabel: walletRow.label,
      address: address,
    });
  } catch (err) {
    console.error('Error finding user by address:', err);
    res.status(500).json({ error: 'Failed to find user' });
  }
});

apiRouter.post('/internal/transfer', authMiddleware, async (req, res) => {
  const { fromAddress, toAddress, amount, note } = req.body;
  
  if (!fromAddress) {
    return res.status(400).json({ error: 'Sender wallet address is required' });
  }
  if (!toAddress) {
    return res.status(400).json({ error: 'Recipient wallet address is required' });
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than zero' });
  }
  
  try {
    const fromWalletAddress = String(fromAddress).toLowerCase().trim();
    const toWalletAddress = String(toAddress).toLowerCase().trim();
    
    if (fromWalletAddress === toWalletAddress) {
      return res.status(400).json({ error: 'Cannot transfer to yourself' });
    }
    
    // Verify sender wallet belongs to authenticated user
    const senderWalletResult = await db.query(
      'SELECT user_id FROM wallets WHERE LOWER(address) = $1',
      [fromWalletAddress]
    );
    
    if (!senderWalletResult.rows[0] || senderWalletResult.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Sender wallet does not belong to authenticated user' });
    }
    
    // Verify recipient wallet exists
    const recipientWalletResult = await db.query(
      'SELECT user_id FROM wallets WHERE LOWER(address) = $1',
      [toWalletAddress]
    );
    
    if (!recipientWalletResult.rows[0]) {
      return res.status(404).json({ error: 'Recipient wallet address not found in FDA system' });
    }
    
    // Get or create sender balance
    let senderBalanceResult = await db.query(
      'SELECT fda_balance FROM internal_balances WHERE wallet_address = $1',
      [fromWalletAddress]
    );
    
    if (!senderBalanceResult.rows[0]) {
      await db.query(
        'INSERT INTO internal_balances (wallet_address, fda_balance, updated_at) VALUES ($1, 0, CURRENT_TIMESTAMP)',
        [fromWalletAddress]
      );
      senderBalanceResult = { rows: [{ fda_balance: 0 }] };
    }
    
    const senderBalance = parseFloat(senderBalanceResult.rows[0].fda_balance);
    
    // Calculate locked amount in OPEN SELL offers (still using user_id for offers)
    const lockedResult = await db.query(`
      SELECT COALESCE(SUM(remaining), 0) as locked
      FROM offers
      WHERE maker_id = $1 AND type = 'SELL' AND status = 'OPEN' AND asset_symbol = 'FDA'
    `, [req.user.id]);
    const locked = lockedResult.rows[0] ? parseFloat(lockedResult.rows[0].locked) : 0;
    const available = senderBalance - locked;
    
    // Get holding FDA amount setting
    const holdingSettingResult = await db.query('SELECT value FROM settings WHERE key = $1', ['holding_fda_amount']);
    const holdingAmount = holdingSettingResult.rows[0] ? parseFloat(holdingSettingResult.rows[0].value) : 0;
    const usableBalance = Math.max(0, available - holdingAmount);
    
    if (senderBalance < amount) {
      return res.status(400).json({ 
        error: `Insufficient balance. You have ${senderBalance} FDA, but trying to send ${amount}` 
      });
    }
    
    if (usableBalance < amount) {
      return res.status(400).json({ 
        error: `Cannot transfer. You must maintain a minimum holding balance of ${holdingAmount} FDA. Available: ${available.toFixed(18)} FDA, Usable: ${usableBalance.toFixed(18)} FDA, Required: ${amount} FDA.` 
      });
    }
    
    // Get or create recipient balance
    let recipientBalanceResult = await db.query(
      'SELECT fda_balance FROM internal_balances WHERE wallet_address = $1',
      [toWalletAddress]
    );
    
    if (!recipientBalanceResult.rows[0]) {
      await db.query(
        'INSERT INTO internal_balances (wallet_address, fda_balance, updated_at) VALUES ($1, 0, CURRENT_TIMESTAMP)',
        [toWalletAddress]
      );
      recipientBalanceResult = { rows: [{ fda_balance: 0 }] };
    }
    
    // Perform transfer
    const now = new Date().toISOString();
    // Deduct from sender
    await db.query(
      'UPDATE internal_balances SET fda_balance = fda_balance - $1, updated_at = $2 WHERE wallet_address = $3',
      [amount, now, fromWalletAddress]
    );
    
    // Add to recipient
    await db.query(
      'UPDATE internal_balances SET fda_balance = fda_balance + $1, updated_at = $2 WHERE wallet_address = $3',
      [amount, now, toWalletAddress]
    );
    
    // Record transfer (still using user_id for transfer history)
    const toUserId = recipientWalletResult.rows[0].user_id;
    const transferResult = await db.query(
      'INSERT INTO internal_transfers (from_user_id, to_user_id, amount, note) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, toUserId, amount, note || null]
    );
    
    const transfer = transferResult.rows[0];
    
    res.json({
      success: true,
      transfer,
      message: `Successfully transferred ${amount} FDA tokens internally (zero fee)`,
    });
  } catch (err) {
    console.error('Error transferring tokens:', err);
    res.status(500).json({ error: 'Failed to transfer tokens' });
  }
});

apiRouter.get('/internal/transfers', authMiddleware, async (req, res) => {
  try {
    const rows = await db
      .prepare(
        `SELECT 
          it.*,
          from_user.email as from_email,
          from_user.phone as from_phone,
          from_user.fda_user_id as from_fda_user_id,
          to_user.email as to_email,
          to_user.phone as to_phone,
          to_user.fda_user_id as to_fda_user_id,
          from_wallet.address as from_address,
          to_wallet.address as to_address
         FROM internal_transfers it
         JOIN users from_user ON from_user.id = it.from_user_id
         JOIN users to_user ON to_user.id = it.to_user_id
         LEFT JOIN wallets from_wallet ON from_wallet.user_id = it.from_user_id
         LEFT JOIN wallets to_wallet ON to_wallet.user_id = it.to_user_id
         WHERE it.from_user_id = ? OR it.to_user_id = ?
         ORDER BY it.created_at DESC
         LIMIT 50`
      )
      .all(req.user.id, req.user.id);
    
    // If multiple wallets per user, we need to handle that
    // For now, just get the first wallet for each user
    const processedRows = await Promise.all(rows.map(async (row) => {
      // Get first wallet for from_user
      const fromWallet = await db
        .prepare('SELECT address FROM wallets WHERE user_id = ? LIMIT 1')
        .get(row.from_user_id);
      
      // Get first wallet for to_user
      const toWallet = await db
        .prepare('SELECT address FROM wallets WHERE user_id = ? LIMIT 1')
        .get(row.to_user_id);
      
      return {
        ...row,
        from_address: fromWallet?.address || null,
        to_address: toWallet?.address || null,
      };
    }));
    
    res.json(processedRows);
  } catch (err) {
    console.error('Error fetching transfers:', err);
    res.status(500).json({ error: 'Failed to fetch transfers' });
  }
});

// Settings endpoints
apiRouter.get('/admin/settings', authMiddleware, adminMiddleware, async (_req, res) => {
  const settings = await db.prepare('SELECT * FROM settings ORDER BY key').all();
  res.json(settings);
});

apiRouter.get('/settings/p2p-fee-rate', async (_req, res) => {
  const setting = await db.prepare('SELECT value FROM settings WHERE key = ?').get('p2p_fee_rate');
  const feeRate = setting ? parseFloat(setting.value) : 0;
  res.json({ feeRate, feeRatePercent: feeRate });
});

apiRouter.get('/settings/holding-fda-amount', async (_req, res) => {
  const setting = await db.prepare('SELECT value FROM settings WHERE key = ?').get('holding_fda_amount');
  const holdingAmount = setting ? parseFloat(setting.value) : 0;
  res.json({ holdingAmount });
});

apiRouter.put('/admin/settings/:key', authMiddleware, adminMiddleware, async (req, res) => {
  const { key } = req.params;
  let { value, description } = req.body;
  
  // Allow 0 as a valid value - check for null/undefined/empty string only
  if (value === null || value === undefined || value === '') {
    return res.status(400).json({ error: 'Value is required' });
  }

  // Validate fee rate if it's the p2p_fee_rate setting
  if (key === 'p2p_fee_rate') {
    const feeRate = parseFloat(value);
    if (isNaN(feeRate) || feeRate < 0 || feeRate > 100) {
      return res.status(400).json({ error: 'Fee rate must be a number between 0 and 100' });
    }
    // Ensure value is stored as string (including "0")
    value = String(feeRate);
  }

  // Validate holding FDA amount if it's the holding_fda_amount setting
  if (key === 'holding_fda_amount') {
    const valueStr = String(value).trim();
    
    // Validate format: must be a valid decimal number with up to 18 decimal places
    if (!/^\d+(\.\d{0,18})?$/.test(valueStr)) {
      return res.status(400).json({ error: 'Invalid format. Holding FDA amount must be a number with up to 18 decimal places (e.g., 2.000250 or 0.000000000000000000)' });
    }
    
    // Validate numeric value is >= 0
    const holdingAmount = parseFloat(valueStr);
    if (isNaN(holdingAmount) || holdingAmount < 0) {
      return res.status(400).json({ error: 'Holding FDA amount must be a number >= 0' });
    }
    
    // Store the value as-is (preserve exact decimal places entered by user)
    // Normalize: remove leading zeros, but preserve decimal precision
    value = valueStr;
  }

  try {
    const now = new Date().toISOString();
    const existing = await db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
    
    if (existing) {
      await db.prepare('UPDATE settings SET value = ?, description = ?, updated_at = ? WHERE key = ?').run(
        value,
        description || existing.description,
        now,
        key
      );
    } else {
      await db.prepare('INSERT INTO settings (key, value, description, updated_at) VALUES (?, ?, ?, ?)').run(
        key,
        value,
        description || '',
        now
      );
    }

    const updated = await db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
    res.json(updated);
  } catch (err) {
    console.error('Error updating setting:', err);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// Admin user management
apiRouter.post('/admin/promote-user', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(userId);
    const updated = await db.prepare('SELECT id, fda_user_id, email, phone, is_admin FROM users WHERE id = ?').get(userId);
    res.json({ success: true, user: toUserDto(updated) });
  } catch (err) {
    console.error('Error promoting user:', err);
    res.status(500).json({ error: 'Failed to promote user' });
  }
});

apiRouter.get('/admin/users', authMiddleware, adminMiddleware, async (_req, res) => {
  const users = await db.prepare('SELECT id, fda_user_id, email, phone, full_name, is_admin, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users.map(u => ({ 
    ...u, 
    isAdmin: !!u.is_admin,
    fdaUserId: u.fda_user_id 
  })));
});

// Update admin user (demote or update details)
apiRouter.put('/admin/users/:userId', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { isAdmin, email, phone, fullName, password } = req.body;

  try {
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update is_admin if provided
    if (isAdmin !== undefined) {
      await db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
    }

    // Update email if provided
    if (email !== undefined) {
      await db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email || null, userId);
    }

    // Update phone if provided
    if (phone !== undefined) {
      await db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone || null, userId);
    }

    // Update full_name if provided
    if (fullName !== undefined) {
      await db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(fullName || null, userId);
    }

    // Update password if provided (use same format as login: password + JWT_SECRET)
    if (password) {
      const passwordHash = bcrypt.hashSync(password + JWT_SECRET, 10);
      await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    }

    const updated = await db.prepare('SELECT id, fda_user_id, email, phone, full_name, is_admin, created_at FROM users WHERE id = ?').get(userId);
    res.json({ success: true, user: toUserDto(updated) });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Admin endpoint to update FDA balance on remote FDA server (only if user exists in MC Wallet)
apiRouter.post('/admin/update-fda-balance', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, amount } = req.body;

  // Validate input
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  if (amount === undefined || amount === null || amount === '') {
    return res.status(400).json({ error: 'FDA amount is required' });
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum)) {
    return res.status(400).json({ error: 'FDA amount must be a valid number' });
  }

  if (amountNum <= 0) {
    return res.status(400).json({ error: 'FDA amount must be greater than 0' });
  }

  try {
    console.log(`\n[========================================]`);
    console.log(`[ADMIN] 💰 Updating FDA balance on remote server for user: ${userId}`);
    console.log(`[ADMIN] Amount: ${amountNum} FDA`);
    console.log(`[========================================]\n`);

    // Step 1: Check if user exists in MC Wallet (local database)
    let userRow = await db
      .prepare('SELECT id, fda_user_id, email, phone FROM users WHERE fda_user_id = ? OR email = ? OR phone = ?')
      .get(userId, userId, userId);

    if (!userRow) {
      console.log(`[ADMIN] ❌ User not found in MC Wallet: ${userId}`);
      return res.status(404).json({ 
        error: 'Please login first on MC Wallet',
        message: 'User does not exist in MC Wallet. User must login first to be registered in the system.'
      });
    }

    const localUserId = userRow.id;
    const fdaUserId = userRow.fda_user_id || userId; // Use fda_user_id if available, otherwise use provided userId

    console.log(`[ADMIN] ✅ User found in MC Wallet:`);
    console.log(`  Local User ID: ${localUserId}`);
    console.log(`  FDA User ID: ${fdaUserId}`);
    console.log(`  Email: ${userRow.email || 'N/A'}`);
    console.log(`  Phone: ${userRow.phone || 'N/A'}`);

    // Step 2: Update FDA balance on remote FDA server
    console.log(`\n[ADMIN] 🔄 Updating FDA balance on remote server...`);
    const remoteResult = await updateFDABalanceOnRemote(fdaUserId, amountNum);

    if (!remoteResult.status) {
      console.error(`[ADMIN] ❌ Failed to update balance on remote FDA server:`, remoteResult.message);
      return res.status(500).json({ 
        error: 'Failed to update balance on remote FDA server',
        details: remoteResult.message,
        remoteResponse: remoteResult.data
      });
    }

    console.log(`[ADMIN] ✅ Balance updated on remote server successfully`);
    console.log(`[ADMIN] Remote response:`, JSON.stringify(remoteResult.data, null, 2));

    console.log(`\n[ADMIN] ✅ FDA balance update completed successfully!`);
    console.log(`[========================================]\n`);

    res.json({
      success: true,
      message: `FDA balance updated successfully on remote server`,
      user: {
        localUserId: localUserId,
        fdaUserId: fdaUserId,
        email: userRow.email,
        phone: userRow.phone
      },
      amountUpdated: amountNum,
      remoteApiResponse: remoteResult.data
    });

  } catch (err) {
    console.error('[ADMIN] ❌ Error updating FDA balance:', err);
    res.status(500).json({ 
      error: 'Failed to update FDA balance',
      details: err.message 
    });
  }
});

// Public API endpoint for futuredigiassets.com to send FDA to MC wallet
// This endpoint is protected by API key and origin validation
apiRouter.post('/fda/transfer-to-mc-wallet', validateFDAOrigin, validateAPIKey, async (req, res) => {
  const { userId, amount, holdingPeriod } = req.body;

  // Validate input
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  if (amount === undefined || amount === null || amount === '') {
    return res.status(400).json({ error: 'FDA amount is required' });
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum)) {
    return res.status(400).json({ error: 'FDA amount must be a valid number' });
  }

  if (amountNum <= 0) {
    return res.status(400).json({ error: 'FDA amount must be greater than 0' });
  }

  // Validate holding period if provided
  let expiresAt = null;
  if (holdingPeriod) {
    try {
      expiresAt = calculateExpirationDate(holdingPeriod);
      console.log(`[FDA API] Holding period: ${holdingPeriod}, Expires at: ${expiresAt}`);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  try {
    console.log(`\n[========================================]`);
    console.log(`[FDA API] 💰 Transfer FDA to MC Wallet`);
    console.log(`[FDA API] User ID: ${userId}`);
    console.log(`[FDA API] Amount: ${amountNum} FDA`);
    console.log(`[FDA API] Holding Period: ${holdingPeriod || 'None (no lock)'}`);
    if (expiresAt) {
      console.log(`[FDA API] Expires At: ${expiresAt}`);
    }
    console.log(`[FDA API] Origin: ${req.headers.origin || req.headers.referer || 'N/A'}`);
    console.log(`[========================================]\n`);

    // Step 1: Check if user exists in MC Wallet (local database)
    let userRow = await db
      .prepare('SELECT id, fda_user_id, email, phone FROM users WHERE fda_user_id = ? OR email = ? OR phone = ?')
      .get(userId, userId, userId);

    if (!userRow) {
      console.log(`[FDA API] ❌ User not found in MC Wallet: ${userId}`);
      return res.status(404).json({ 
        error: 'User not found in MC Wallet',
        message: 'User does not exist in MC Wallet. User must login first to be registered in the system.',
        userId: userId
      });
    }

    const localUserId = userRow.id;
    const fdaUserId = userRow.fda_user_id || userId;

    console.log(`[FDA API] ✅ User found in MC Wallet:`);
    console.log(`  Local User ID: ${localUserId}`);
    console.log(`  FDA User ID: ${fdaUserId}`);
    console.log(`  Email: ${userRow.email || 'N/A'}`);
    console.log(`  Phone: ${userRow.phone || 'N/A'}`);

    // Step 2: Update FDA balance in MC Wallet
    console.log(`\n[FDA API] 🔄 Updating FDA balance in MC Wallet...`);
    
    // Get current balance
    let balanceRow = await db
      .prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?')
      .get(localUserId);

    const now = new Date().toISOString();
    const oldBalance = balanceRow ? parseFloat(balanceRow.fda_balance) : 0;

    if (!balanceRow) {
      // Create new balance record
      await db
        .prepare('INSERT INTO internal_balances (user_id, fda_balance, updated_at) VALUES (?, ?, ?)')
        .run(localUserId, amountNum, now);
      console.log(`[FDA API] ✅ Created new balance record: ${amountNum} FDA`);
    } else {
      // Update existing balance (add amount)
      await db
        .prepare('UPDATE internal_balances SET fda_balance = fda_balance + ?, updated_at = ? WHERE user_id = ?')
        .run(amountNum, now, localUserId);
      
      console.log(`[FDA API] ✅ Updated balance from ${oldBalance} FDA to ${oldBalance + amountNum} FDA`);
    }

    // Step 3: Create holding record if holding period is provided
    let holdingId = null;
    if (holdingPeriod && expiresAt) {
      console.log(`\n[FDA API] 🔒 Creating holding period record...`);
      const holdingStmt = db.prepare(`
        INSERT INTO fda_holdings (user_id, amount, holding_period, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const holdingResult = await holdingStmt.run(
        localUserId,
        amountNum,
        holdingPeriod.toUpperCase(),
        expiresAt,
        now
      );
      holdingId = holdingResult.lastInsertRowid;
      console.log(`[FDA API] ✅ Holding period record created (ID: ${holdingId})`);
      console.log(`[FDA API] Amount ${amountNum} FDA locked until ${expiresAt}`);
    }

    // Get final balance
    balanceRow = await db
      .prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?')
      .get(localUserId);

    const newBalance = parseFloat(balanceRow.fda_balance);

    console.log(`\n[FDA API] ✅ FDA transfer completed successfully!`);
    console.log(`[FDA API] Old Balance: ${oldBalance} FDA`);
    console.log(`[FDA API] Amount Added: ${amountNum} FDA`);
    if (holdingPeriod) {
      console.log(`[FDA API] Holding Period: ${holdingPeriod} (locked until ${expiresAt})`);
    }
    console.log(`[FDA API] New Balance: ${newBalance} FDA`);
    console.log(`[========================================]\n`);

    res.json({
      success: true,
      message: holdingPeriod 
        ? `FDA transferred successfully to MC Wallet with ${holdingPeriod} holding period`
        : 'FDA transferred successfully to MC Wallet',
      user: {
        localUserId: localUserId,
        fdaUserId: fdaUserId,
        email: userRow.email,
        phone: userRow.phone
      },
      transfer: {
        amount: amountNum,
        oldBalance: oldBalance,
        newBalance: newBalance,
        holdingPeriod: holdingPeriod || null,
        expiresAt: expiresAt || null,
        holdingId: holdingId
      },
      timestamp: now
    });

  } catch (err) {
    console.error('[FDA API] ❌ Error processing FDA transfer:', err);
    res.status(500).json({ 
      error: 'Failed to process FDA transfer',
      details: err.message 
    });
  }
});

// Admin monitoring (read-only)
apiRouter.get('/admin/trades', authMiddleware, adminMiddleware, async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT t.*, 
              ob.email as buyer_email, ob.phone as buyer_phone,
              os.email as seller_email, os.phone as seller_phone
       FROM trades t
       JOIN users ob ON ob.id = t.buyer_id
       JOIN users os ON os.id = t.seller_id
       ORDER BY t.created_at DESC
       LIMIT 100`,
    )
    .all();
  res.json(rows);
});

// Admin: Get all holdings
apiRouter.get('/admin/holdings', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const holdings = await db
      .prepare(`
        SELECT h.*, 
               u.id as user_id, u.email, u.phone, u.full_name, u.fda_user_id
        FROM fda_holdings h
        JOIN users u ON u.id = h.user_id
        ORDER BY h.created_at DESC
      `)
      .all();
    
    res.json(holdings.map(h => ({
      id: h.id,
      userId: h.user_id,
      user: {
        id: h.user_id,
        email: h.email,
        phone: h.phone,
        fullName: h.full_name,
        fdaUserId: h.fda_user_id
      },
      amount: parseFloat(h.amount),
      holdingPeriod: h.holding_period,
      expiresAt: h.expires_at,
      createdAt: h.created_at,
      isExpired: new Date(h.expires_at) <= new Date()
    })));
  } catch (err) {
    console.error('Admin get holdings error:', err);
    res.status(500).json({ error: 'Failed to fetch holdings' });
  }
});

// Admin: Update holding period
apiRouter.put('/admin/holdings/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const { holdingPeriod } = req.body;

  if (!holdingPeriod) {
    return res.status(400).json({ error: 'Holding period is required' });
  }

  try {
    // Validate holding period format
    let expiresAt;
    try {
      expiresAt = calculateExpirationDate(holdingPeriod);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Check if holding exists
    const holding = await db
      .prepare('SELECT * FROM fda_holdings WHERE id = ?')
      .get(id);

    if (!holding) {
      return res.status(404).json({ error: 'Holding not found' });
    }

    // Update holding period and expiration date
    const now = new Date().toISOString();
    // Try to update with updated_at, fallback if column doesn't exist
    try {
      await db
        .prepare(`
          UPDATE fda_holdings 
          SET holding_period = ?, expires_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(holdingPeriod.toUpperCase(), expiresAt, now, id);
    } catch (err) {
      // If updated_at column doesn't exist, update without it
      if (String(err.message).includes('updated_at') || String(err.message).includes('column')) {
        await db
          .prepare(`
            UPDATE fda_holdings 
            SET holding_period = ?, expires_at = ?
            WHERE id = ?
          `)
          .run(holdingPeriod.toUpperCase(), expiresAt, id);
      } else {
        throw err;
      }
    }

    // Get updated holding with user info
    const updatedHolding = await db
      .prepare(`
        SELECT h.*, 
               u.id as user_id, u.email, u.phone, u.full_name, u.fda_user_id
        FROM fda_holdings h
        JOIN users u ON u.id = h.user_id
        WHERE h.id = ?
      `)
      .get(id);

    console.log(`[ADMIN] ✅ Updated holding period for holding ID ${id}: ${holding.holding_period} → ${holdingPeriod.toUpperCase()}`);
    console.log(`[ADMIN] New expiration date: ${expiresAt}`);

    res.json({
      success: true,
      message: 'Holding period updated successfully',
      holding: {
        id: updatedHolding.id,
        userId: updatedHolding.user_id,
        user: {
          id: updatedHolding.user_id,
          email: updatedHolding.email,
          phone: updatedHolding.phone,
          fullName: updatedHolding.full_name,
          fdaUserId: updatedHolding.fda_user_id
        },
        amount: parseFloat(updatedHolding.amount),
        holdingPeriod: updatedHolding.holding_period,
        expiresAt: updatedHolding.expires_at,
        createdAt: updatedHolding.created_at,
        isExpired: new Date(updatedHolding.expires_at) <= new Date()
      }
    });
  } catch (err) {
    console.error('Admin update holding error:', err);
    res.status(500).json({ error: 'Failed to update holding period' });
  }
});

apiRouter.get('/admin/disputes', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT d.*, 
              t.asset_symbol, t.fiat_currency, t.amount, t.price, t.status as trade_status,
              t.buyer_id, t.seller_id, t.payment_screenshot,
              buyer.email as buyer_email, buyer.phone as buyer_phone, buyer.full_name as buyer_name,
              seller.email as seller_email, seller.phone as seller_phone, seller.full_name as seller_name,
              raised_by.email as raised_by_email, raised_by.phone as raised_by_phone, raised_by.full_name as raised_by_name,
              resolved_by.email as resolved_by_email, resolved_by.phone as resolved_by_phone, resolved_by.full_name as resolved_by_name
       FROM disputes d
       JOIN trades t ON t.id = d.trade_id
       JOIN users buyer ON buyer.id = t.buyer_id
       JOIN users seller ON seller.id = t.seller_id
       JOIN users raised_by ON raised_by.id = d.raised_by_id
       LEFT JOIN users resolved_by ON resolved_by.id = d.resolved_by_id
       ORDER BY d.created_at DESC
       LIMIT 100`
    );
    res.json(result.rows || []);
  } catch (err) {
    console.error('Error fetching disputes:', err);
    res.status(500).json({ error: 'Failed to fetch disputes' });
  }
});

// Admin resolve dispute
apiRouter.post('/admin/disputes/:id/resolve', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status, resolution_note, trade_action } = req.body; // trade_action: 'release', 'cancel', 'none'
  
  if (!status || !['RESOLVED', 'REJECTED', 'CLOSED'].includes(status)) {
    return res.status(400).json({ error: 'Valid status is required (RESOLVED, REJECTED, or CLOSED)' });
  }
  
  try {
    const dispute = await db.prepare('SELECT * FROM disputes WHERE id = ?').get(id);
    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found' });
    }
    
    if (dispute.status !== 'OPEN') {
      return res.status(400).json({ error: `Dispute is already ${dispute.status}` });
    }
    
    const now = new Date().toISOString();
    
    // Update dispute
    await db.prepare(
      `UPDATE disputes 
       SET status = ?, resolution_note = ?, resolved_by_id = ?, resolved_at = ? 
       WHERE id = ?`
    ).run(status, resolution_note || null, req.user.id, now, id);
    
    // Handle trade action if specified
    if (trade_action === 'release') {
      // Release tokens to buyer
      const trade = await db.prepare('SELECT * FROM trades WHERE id = ?').get(dispute.trade_id);
      if (trade && trade.status === 'DISPUTED') {
        // Similar to release trade endpoint
        const buyerBalance = await db.prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?').get(trade.buyer_id);
        if (!buyerBalance) {
          await db.prepare('INSERT INTO internal_balances (user_id, fda_balance, updated_at) VALUES (?, 0, ?)').run(trade.buyer_id, now);
        }
        
        const feeAmount = parseFloat(trade.amount) * (parseFloat(trade.fee_rate) || 0.01);
        const amountToBuyer = parseFloat(trade.amount) - feeAmount;
        
        await db.prepare(
          'UPDATE internal_balances SET fda_balance = fda_balance + ?, updated_at = ? WHERE user_id = ?'
        ).run(amountToBuyer, now, trade.buyer_id);
        
        // Create transaction record for dispute resolution (release tokens)
        const insertTransfer = db.prepare(
          'INSERT INTO internal_transfers (from_user_id, to_user_id, amount, note) VALUES (?, ?, ?, ?)'
        );
        await insertTransfer.run(
          trade.seller_id,
          trade.buyer_id,
          amountToBuyer,
          `P2P Trade #${trade.id} - Dispute Resolution (Release) - ${parseFloat(trade.amount).toFixed(8)} FDA (Fee: ${feeAmount.toFixed(8)} FDA)`
        );
        
        await db.prepare(`UPDATE trades SET status = 'COMPLETED', released_at = ? WHERE id = ?`).run(now, trade.id);
      }
    } else if (trade_action === 'cancel') {
      // Cancel trade and return funds
      const trade = await db.prepare('SELECT * FROM trades WHERE id = ?').get(dispute.trade_id);
      if (trade && trade.status === 'DISPUTED') {
        // Return amount to seller if it was a SELL offer
        const offer = await db.prepare('SELECT * FROM offers WHERE id = ?').get(trade.offer_id);
        if (offer && offer.type === 'SELL' && offer.asset_symbol === 'FDA') {
          const sellerBalance = await db.prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?').get(trade.seller_id);
          if (!sellerBalance) {
            await db.prepare('INSERT INTO internal_balances (user_id, fda_balance, updated_at) VALUES (?, 0, ?)').run(trade.seller_id, now);
          }
          await db.prepare(
            'UPDATE internal_balances SET fda_balance = fda_balance + ?, updated_at = ? WHERE user_id = ?'
          ).run(trade.amount, now, trade.seller_id);
        }
        
        await db.prepare(`UPDATE trades SET status = 'CANCELLED', cancelled_at = ? WHERE id = ?`).run(now, trade.id);
      }
    }
    
    const updatedDispute = await db.prepare('SELECT * FROM disputes WHERE id = ?').get(id);
    res.json({ success: true, dispute: updatedDispute });
  } catch (err) {
    console.error('Error resolving dispute:', err);
    res.status(500).json({ error: 'Failed to resolve dispute' });
  }
});

// Initialize admin user from environment variables
async function initializeAdminUser() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@gmail.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
  const adminName = process.env.ADMIN_NAME || 'Admin';
  const adminPhone = process.env.ADMIN_PHONE || '909022';

  try {
    console.log('\n[========================================]');
    console.log('[INIT] 🔧 Initializing admin user...');
    console.log(`[INIT] Email: ${adminEmail}`);
    console.log(`[INIT] Name: ${adminName}`);
    console.log(`[INIT] Phone: ${adminPhone}`);
    console.log('[========================================]\n');

    // Check if admin user exists
    let adminUser = await db
      .prepare('SELECT id, email, is_admin FROM users WHERE email = ?')
      .get(adminEmail);

    if (adminUser) {
      // User exists - update admin status and password if needed
      console.log(`[INIT] ✅ Admin user found (ID: ${adminUser.id})`);
      
      // Set admin status
      await db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(adminUser.id);
      
      // Update password if provided
      if (adminPassword) {
        const passwordHash = bcrypt.hashSync(adminPassword + JWT_SECRET, 10);
        await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, adminUser.id);
        console.log(`[INIT] ✅ Admin password updated`);
      }
      
      // Update name and phone if provided
      if (adminName) {
        await db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(adminName, adminUser.id);
      }
      if (adminPhone) {
        await db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(adminPhone, adminUser.id);
      }
      
      console.log(`[INIT] ✅ Admin user updated successfully`);
    } else {
      // Create new admin user
      console.log(`[INIT] ⚠️  Admin user not found, creating new admin user...`);
      
      const passwordHash = bcrypt.hashSync(adminPassword + JWT_SECRET, 10);
      const now = new Date().toISOString();
      
      const result = await db.prepare(`
        INSERT INTO users (email, phone, password_hash, full_name, is_admin, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `).run(adminEmail, adminPhone, passwordHash, adminName, now);
      
      // Get the created user ID
      const createdUser = await db
        .prepare('SELECT id FROM users WHERE email = ? ORDER BY created_at DESC LIMIT 1')
        .get(adminEmail);
      
      console.log(`[INIT] ✅ Admin user created successfully (ID: ${createdUser?.id || result.lastInsertRowid || 'N/A'})`);
    }
    
    // Verify admin status
    const verified = await db
      .prepare('SELECT id, email, is_admin FROM users WHERE email = ?')
      .get(adminEmail);
    
    if (verified && verified.is_admin) {
      console.log(`[INIT] ✅ Admin user verified: ${verified.email} (is_admin: ${verified.is_admin})`);
    } else {
      console.error(`[INIT] ❌ WARNING: Admin user exists but is_admin is not set!`);
    }
    
    console.log('[========================================]\n');
  } catch (err) {
    console.error('[INIT] ❌ Error initializing admin user:', err);
    console.error('[INIT] ⚠️  Continuing server startup...');
  }
}

// Run migrations and start server
runMigrations()
  .then(() => {
    return initializeAdminUser();
  })
  .then(() => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`FDA wallet backend running on port ${PORT}`);
      console.log('Available routes:');
      console.log('  POST /internal/add-balance - Add FDA tokens to internal balance');
      console.log('  GET  /internal/balance - Get internal FDA balance');
    });
  })
  .catch(err => {
    console.error('Failed to run migrations:', err);
    console.error('Please ensure PostgreSQL is installed and running, and database credentials are correct in .env file');
    console.error('Error details:', err.message);
    process.exit(1);
  });


