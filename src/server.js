import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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
    
    // Step 1: First check if user exists locally (by username, email, or phone)
    // Prioritize email/phone matches over fda_user_id to avoid finding wrong user
    // Try email/phone first, then fda_user_id
    let userRow = await db
      .prepare('SELECT id, fda_user_id, email, phone, password_hash, is_admin FROM users WHERE email = ? OR phone = ?')
      .get(username, username);
    
    // If not found by email/phone, try fda_user_id
    if (!userRow) {
      userRow = await db
        .prepare('SELECT id, fda_user_id, email, phone, password_hash, is_admin FROM users WHERE fda_user_id = ?')
        .get(username);
    }
    
    console.log(`[AUTH] 🔍 User lookup result:`, userRow ? { id: userRow.id, email: userRow.email, phone: userRow.phone, is_admin: userRow.is_admin } : 'Not found');
    
    // Step 2: If user exists locally, authenticate with local password
    if (userRow) {
      console.log(`[AUTH] ✅ User found locally with ID: ${userRow.id}, FDA User ID: ${userRow.fda_user_id}`);
      
      // Verify password against stored hash
      const valid = bcrypt.compareSync(password + JWT_SECRET, userRow.password_hash);
      if (!valid) {
        console.log(`[AUTH] ❌ Invalid password for local user`);
        return res.status(401).json({ error: 'Invalid credentials. Please check your user ID and password.' });
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
      const now = new Date().toISOString();
      await db.prepare(
        'UPDATE internal_balances SET fda_balance = fda_balance - ?, updated_at = ? WHERE user_id = ?'
      ).run(amountNum, now, req.user.id);
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
  const wallets = await db
    .prepare('SELECT id, address, label, created_at FROM wallets WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.json(wallets);
});

apiRouter.post('/wallets/register', authMiddleware, async (req, res) => {
  const { address, label } = req.body;
  if (!address) {
    return res.status(400).json({ error: 'Wallet address is required' });
  }
  
  const trimmedAddress = address.trim();
  
  // Validate address format (Ethereum/EVM, Solana, Bitcoin, or Tron)
  const isEthereumAddress = /^0x[a-f0-9]{40}$/i.test(trimmedAddress);
  const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmedAddress); // Solana addresses are base58 encoded, 32-44 chars
  const isBitcoinAddress = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(trimmedAddress);
  const isTronAddress = /^T[A-Za-z1-9]{33}$/.test(trimmedAddress);
  
  if (!isEthereumAddress && !isSolanaAddress && !isBitcoinAddress && !isTronAddress) {
    return res.status(400).json({ error: 'Invalid wallet address format. Supported: Ethereum (0x...), Solana, Bitcoin, or Tron addresses.' });
  }
  
  // Normalize Ethereum addresses to lowercase for case-insensitive comparison
  // Solana, Bitcoin, and Tron addresses are case-sensitive, so don't normalize them
  const normalizedAddress = isEthereumAddress ? trimmedAddress.toLowerCase() : trimmedAddress;
  
  try {
    // Check if wallet already exists
    // For Ethereum addresses, use case-insensitive comparison. For others, use exact match.
    const existing = isEthereumAddress 
      ? await db.prepare('SELECT * FROM wallets WHERE LOWER(address) = ?').get(normalizedAddress)
      : await db.prepare('SELECT * FROM wallets WHERE address = ?').get(normalizedAddress);
    if (existing) {
      if (existing.user_id === req.user.id) {
        // Update label if same user
        await db.prepare('UPDATE wallets SET label = ? WHERE id = ?').run(label || null, existing.id);
        return res.json({ success: true, wallet: { ...existing, label: label || null } });
      } else {
        // Get the other user's email/phone for better error message
        const otherUser = await db.prepare('SELECT email, phone, full_name FROM users WHERE id = ?').get(existing.user_id);
        const otherUserInfo = otherUser?.email || otherUser?.phone || otherUser?.full_name || 'another user';
        console.warn(`⚠️  Attempt to register duplicate wallet: ${normalizedAddress} by user ${req.user.id}, already registered to user ${existing.user_id} (${otherUserInfo})`);
        return res.status(400).json({ 
          error: `This wallet address is already registered to ${otherUserInfo}. Each wallet address can only be registered to one user.` 
        });
      }
    }
    
    // Create new wallet entry (store in lowercase)
    const stmt = db.prepare('INSERT INTO wallets (user_id, address, label) VALUES (?, ?, ?)');
    const info = await stmt.run(req.user.id, normalizedAddress, label || null);
    const wallet = await db.prepare('SELECT * FROM wallets WHERE id = ?').get(info.lastInsertRowid);
    res.json({ success: true, wallet });
  } catch (err) {
    console.error('Wallet registration error:', err);
    if (String(err.message).includes('unique') || String(err.code) === '23505') {
      return res.status(400).json({ error: 'Wallet address already registered to another user' });
    }
    res.status(500).json({ error: `Failed to register wallet: ${err.message || 'Unknown error'}` });
  }
});

// Internal FDA Transfers (Zero Fee)
apiRouter.get('/internal/balance', authMiddleware, async (req, res) => {
  const balanceRow = await db
    .prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?')
    .get(req.user.id);
  const totalBalance = balanceRow ? parseFloat(balanceRow.fda_balance) : 0;
  
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
  
  // Since balance is already deducted when creating offers, available = totalBalance
  // The locked amount is already included in the deduction
  const available = totalBalance;
  
  // Get holding FDA amount setting
  const holdingSetting = await db.prepare('SELECT value FROM settings WHERE key = ?').get('holding_fda_amount');
  const holdingAmount = holdingSetting ? parseFloat(holdingSetting.value) : 0;
  const usable = Math.max(0, available - holdingAmount - holdingLocked);
  
  // Since balance is deducted when creating offers, the available balance
  // is the current balance in DB (it's already been reduced by locked amount)
  // The total original balance = current balance + locked amount
  res.json({ 
    balance: totalBalance + locked, // Total original balance (current + locked)
    available: totalBalance, // Available balance (already deducted, so just use totalBalance)
    locked: locked,
    holdingLocked: holdingLocked, // Amount locked in holding periods
    total: totalBalance + locked, // Total original balance
    holding: holdingAmount,
    usable: Math.max(0, totalBalance - holdingAmount - holdingLocked) // Usable after holding requirement and holding periods
  });
});

// Add FDA tokens to internal balance (for testing/deposits)
apiRouter.post('/internal/add-balance', authMiddleware, async (req, res) => {
  try {
    console.log('Add balance request:', { userId: req.user.id, body: req.body });
    const { amount } = req.body;
    
    if (amount === undefined || amount === null || amount === '') {
      return res.status(400).json({ error: 'Amount is required' });
    }
    
    const amountNum = Number(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: 'Valid amount greater than 0 is required' });
    }
    
    console.log('Processing add balance:', { userId: req.user.id, amount: amountNum });

    // Get or create balance
    let balanceRow = await db
      .prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?')
      .get(req.user.id);
    
    if (!balanceRow) {
      // Create new balance record
      const now = new Date().toISOString();
      const insertStmt = db.prepare('INSERT INTO internal_balances (user_id, fda_balance, updated_at) VALUES (?, ?, ?)');
      await insertStmt.run(req.user.id, amountNum, now);
      balanceRow = { fda_balance: amountNum };
    } else {
      // Update existing balance
      const now = new Date().toISOString();
      const updateStmt = db.prepare(
        'UPDATE internal_balances SET fda_balance = fda_balance + ?, updated_at = ? WHERE user_id = ?'
      );
      const updateResult = await updateStmt.run(amountNum, now, req.user.id);
      
      if (updateResult.changes === 0) {
        return res.status(500).json({ error: 'Failed to update balance. No rows affected.' });
      }
      
      // Get updated balance
      balanceRow = await db
        .prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?')
        .get(req.user.id);
    }

    const newBalance = balanceRow ? parseFloat(balanceRow.fda_balance) : amountNum;
    
    console.log('Balance added successfully:', { userId: req.user.id, amount: amountNum, newBalance });
    
    res.json({ 
      success: true, 
      balance: newBalance, 
      message: `Added ${amountNum} FDA to your internal balance` 
    });
  } catch (err) {
    console.error('Add balance error:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ 
      error: `Failed to add balance: ${err.message || 'Database error'}` 
    });
  }
});

// Add FDA balance by FDA User ID - GET endpoint for testing (NO AUTH - REMOVE AFTER TESTING!)
apiRouter.get('/admin/add-fda-balance', async (req, res) => {
  try {
    const { fdauserid, fda } = req.query;
    const fda_user_id = fdauserid;
    const fda_balance = fda;
    
    // Validate input
    if (!fda_user_id) {
      return res.status(400).json({ error: 'FDA user ID is required' });
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
    
    console.log(`\n[========================================]`);
    console.log(`[ADMIN] 💰 Adding FDA balance for FDA User ID: ${fda_user_id}`);
    console.log(`[ADMIN] Amount: ${balanceNum} FDA`);
    console.log(`[========================================]\n`);
    
    // Find user by FDA user ID
    const userRow = await db
      .prepare('SELECT id, fda_user_id, email, phone FROM users WHERE fda_user_id = ?')
      .get(fda_user_id);
    
    if (!userRow) {
      console.log(`[ADMIN] ❌ User not found with FDA User ID: ${fda_user_id}`);
      return res.status(404).json({ 
        error: 'User not found',
        message: `No user found with FDA User ID: ${fda_user_id}. Please ensure the user has logged in first.`
      });
    }
    
    const localUserId = userRow.id;
    console.log(`[ADMIN] ✅ User found:`);
    console.log(`  Local User ID: ${localUserId}`);
    console.log(`  FDA User ID: ${userRow.fda_user_id}`);
    console.log(`  Email: ${userRow.email || 'N/A'}`);
    console.log(`  Phone: ${userRow.phone || 'N/A'}`);
    
    // Get or create balance record
    let balanceRow = await db
      .prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?')
      .get(localUserId);
    
    const now = new Date().toISOString();
    
    if (!balanceRow) {
      // Create new balance record
      console.log(`[ADMIN] Creating new balance record for user ${localUserId}`);
      const insertStmt = db.prepare('INSERT INTO internal_balances (user_id, fda_balance, updated_at) VALUES (?, ?, ?)');
      await insertStmt.run(localUserId, balanceNum, now);
      balanceRow = { fda_balance: balanceNum };
    } else {
      // Update existing balance
      console.log(`[ADMIN] Updating existing balance: ${balanceRow.fda_balance} + ${balanceNum}`);
      const updateStmt = db.prepare(
        'UPDATE internal_balances SET fda_balance = fda_balance + ?, updated_at = ? WHERE user_id = ?'
      );
      const updateResult = await updateStmt.run(balanceNum, now, localUserId);
      
      if (updateResult.changes === 0) {
        console.error(`[ADMIN] ❌ Failed to update balance. No rows affected.`);
        return res.status(500).json({ error: 'Failed to update balance. No rows affected.' });
      }
      
      // Get updated balance
      balanceRow = await db
        .prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?')
        .get(localUserId);
    }
    
    const newBalance = balanceRow ? parseFloat(balanceRow.fda_balance) : balanceNum;
    
    console.log(`[ADMIN] ✅ Balance added successfully:`);
    console.log(`  Previous Balance: ${(newBalance - balanceNum).toFixed(8)} FDA`);
    console.log(`  Amount Added: ${balanceNum.toFixed(8)} FDA`);
    console.log(`  New Balance: ${newBalance.toFixed(8)} FDA`);
    console.log(`[========================================]\n`);
    
    res.json({ 
      success: true,
      message: `Successfully added ${balanceNum} FDA to user's balance`,
      user: {
        localUserId: localUserId,
        fdaUserId: userRow.fda_user_id,
        email: userRow.email,
        phone: userRow.phone
      },
      balance: {
        amountAdded: balanceNum,
        previousBalance: (newBalance - balanceNum),
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
  const { toAddress, amount, note } = req.body;
  
  if (!toAddress) {
    return res.status(400).json({ error: 'Recipient address is required' });
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than zero' });
  }
  
  try {
    // Find recipient user by wallet address
    const walletRow = await db
      .prepare('SELECT user_id FROM wallets WHERE address = ?')
      .get(toAddress);
    
    if (!walletRow) {
      return res.status(404).json({ error: 'Recipient wallet address not found in FDA system' });
    }
    
    const toUserId = walletRow.user_id;
    
    if (toUserId === req.user.id) {
      return res.status(400).json({ error: 'Cannot transfer to yourself' });
    }
    
    // Get or create sender balance
    let senderBalance = await db
      .prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?')
      .get(req.user.id);
    
    if (!senderBalance) {
      await db.prepare('INSERT INTO internal_balances (user_id, fda_balance) VALUES (?, 0)').run(req.user.id);
      senderBalance = { fda_balance: 0 };
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
    const available = parseFloat(senderBalance.fda_balance) - locked;
    
    // Get holding FDA amount setting
    const holdingSetting = await db.prepare('SELECT value FROM settings WHERE key = ?').get('holding_fda_amount');
    const holdingAmount = holdingSetting ? parseFloat(holdingSetting.value) : 0;
    const usableBalance = Math.max(0, available - holdingAmount);
    
    if (parseFloat(senderBalance.fda_balance) < amount) {
      return res.status(400).json({ 
        error: `Insufficient balance. You have ${senderBalance.fda_balance} FDA, but trying to send ${amount}` 
      });
    }
    
    if (usableBalance < amount) {
      return res.status(400).json({ 
        error: `Cannot transfer. You must maintain a minimum holding balance of ${holdingAmount} FDA. Available: ${available.toFixed(18)} FDA, Usable: ${usableBalance.toFixed(18)} FDA, Required: ${amount} FDA.` 
      });
    }
    
    // Get or create recipient balance
    let recipientBalance = await db
      .prepare('SELECT fda_balance FROM internal_balances WHERE user_id = ?')
      .get(toUserId);
    
    if (!recipientBalance) {
      await db.prepare('INSERT INTO internal_balances (user_id, fda_balance) VALUES (?, 0)').run(toUserId);
      recipientBalance = { fda_balance: 0 };
    }
    
    // Perform transfer in a transaction
    const transfer = await db.transaction(async () => {
      const now = new Date().toISOString();
      // Deduct from sender
      await db.prepare(
        'UPDATE internal_balances SET fda_balance = fda_balance - ?, updated_at = ? WHERE user_id = ?'
      ).run(amount, now, req.user.id);
      
      // Add to recipient
      await db.prepare(
        'UPDATE internal_balances SET fda_balance = fda_balance + ?, updated_at = ? WHERE user_id = ?'
      ).run(amount, now, toUserId);
      
      // Record transfer
      const insertTransfer = db.prepare(
        'INSERT INTO internal_transfers (from_user_id, to_user_id, amount, note) VALUES (?, ?, ?, ?)'
      );
      const info = await insertTransfer.run(req.user.id, toUserId, amount, note || null);
      
      return await db.prepare('SELECT * FROM internal_transfers WHERE id = ?').get(info.lastInsertRowid);
    });
    
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


