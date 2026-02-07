// Script to check user balance and offers
import Database from 'better-sqlite3';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'fda_wallet.db');

const db = new Database(DB_PATH);

console.log('=== FDA Wallet Database Information ===\n');
console.log('Database Path:', DB_PATH);
console.log('\n');

// Get all users
console.log('=== USERS ===');
const users = db.prepare('SELECT id, email, phone, full_name, is_admin, created_at FROM users').all();
users.forEach(user => {
  console.log(`ID: ${user.id}`);
  console.log(`  Email: ${user.email || 'N/A'}`);
  console.log(`  Phone: ${user.phone || 'N/A'}`);
  console.log(`  Full Name: ${user.full_name || 'N/A'}`);
  console.log(`  Admin: ${user.is_admin ? 'Yes' : 'No'}`);
  console.log(`  Created: ${user.created_at}`);
  console.log('');
});

// Get all balances
console.log('=== INTERNAL BALANCES ===');
const balances = db.prepare(`
  SELECT 
    ib.user_id,
    u.email,
    u.phone,
    ib.fda_balance,
    ib.updated_at
  FROM internal_balances ib
  LEFT JOIN users u ON ib.user_id = u.id
  ORDER BY ib.user_id
`).all();

if (balances.length === 0) {
  console.log('No balances found.');
} else {
  balances.forEach(balance => {
    console.log(`User ID: ${balance.user_id} (${balance.email || balance.phone || 'N/A'})`);
    console.log(`  FDA Balance: ${balance.fda_balance}`);
    console.log(`  Last Updated: ${balance.updated_at}`);
    console.log('');
  });
}

// Get all offers
console.log('=== OFFERS ===');
const offers = db.prepare(`
  SELECT 
    o.id,
    o.maker_id,
    u.email,
    u.phone,
    o.type,
    o.asset_symbol,
    o.fiat_currency,
    o.price,
    o.amount,
    o.remaining,
    o.status,
    o.created_at
  FROM offers o
  LEFT JOIN users u ON o.maker_id = u.id
  ORDER BY o.created_at DESC
`).all();

if (offers.length === 0) {
  console.log('No offers found.');
} else {
  offers.forEach(offer => {
    console.log(`Offer ID: ${offer.id}`);
    console.log(`  Maker: User ${offer.maker_id} (${offer.email || offer.phone || 'N/A'})`);
    console.log(`  Type: ${offer.type}`);
    console.log(`  Asset: ${offer.asset_symbol}`);
    console.log(`  Fiat: ${offer.fiat_currency}`);
    console.log(`  Price: ${offer.price} ${offer.fiat_currency} per ${offer.asset_symbol}`);
    console.log(`  Amount: ${offer.amount} ${offer.asset_symbol}`);
    console.log(`  Remaining: ${offer.remaining} ${offer.asset_symbol}`);
    console.log(`  Status: ${offer.status}`);
    console.log(`  Created: ${offer.created_at}`);
    console.log('');
  });
}

// Calculate expected balance for each user
console.log('=== BALANCE CALCULATION ===');
const userBalances = db.prepare(`
  SELECT 
    u.id as user_id,
    u.email,
    u.phone,
    COALESCE(ib.fda_balance, 0) as current_balance,
    COALESCE(SUM(CASE WHEN o.type = 'SELL' AND o.status = 'OPEN' THEN o.remaining ELSE 0 END), 0) as locked_in_offers,
    COALESCE(ib.fda_balance, 0) + COALESCE(SUM(CASE WHEN o.type = 'SELL' AND o.status = 'OPEN' THEN o.remaining ELSE 0 END), 0) as available_balance
  FROM users u
  LEFT JOIN internal_balances ib ON u.id = ib.user_id
  LEFT JOIN offers o ON u.id = o.maker_id AND o.type = 'SELL' AND o.status = 'OPEN'
  GROUP BY u.id
  ORDER BY u.id
`).all();

userBalances.forEach(user => {
  console.log(`User ID: ${user.user_id} (${user.email || user.phone || 'N/A'})`);
  console.log(`  Current Balance in DB: ${user.current_balance} FDA`);
  console.log(`  Locked in OPEN SELL Offers: ${user.locked_in_offers} FDA`);
  console.log(`  Available Balance (Current + Locked): ${user.available_balance} FDA`);
  console.log('');
});

db.close();
console.log('=== End of Report ===');
