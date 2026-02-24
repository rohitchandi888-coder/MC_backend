-- ============================================
-- TRUNCATE ALL TABLES - START FRESH
-- ============================================
-- WARNING: This will delete ALL data from ALL tables!
-- Use with caution. This is irreversible.
-- ============================================

-- Disable foreign key checks temporarily
SET session_replication_role = 'replica';

-- Truncate all tables in correct order (respecting foreign keys)
-- Start with tables that have foreign keys, then parent tables

TRUNCATE TABLE 
  internal_transfers,
  disputes,
  trades,
  offers,
  fda_holdings,
  wallet_phrases,
  payment_methods,
  internal_balances,
  wallets,
  users,
  settings
CASCADE;

-- Re-enable foreign key checks
SET session_replication_role = 'origin';

-- Verify tables are empty
SELECT 
  'users' as table_name, COUNT(*) as row_count FROM users
UNION ALL
SELECT 'wallets', COUNT(*) FROM wallets
UNION ALL
SELECT 'internal_balances', COUNT(*) FROM internal_balances
UNION ALL
SELECT 'offers', COUNT(*) FROM offers
UNION ALL
SELECT 'trades', COUNT(*) FROM trades
UNION ALL
SELECT 'internal_transfers', COUNT(*) FROM internal_transfers
UNION ALL
SELECT 'wallet_phrases', COUNT(*) FROM wallet_phrases
UNION ALL
SELECT 'payment_methods', COUNT(*) FROM payment_methods
UNION ALL
SELECT 'fda_holdings', COUNT(*) FROM fda_holdings
UNION ALL
SELECT 'disputes', COUNT(*) FROM disputes
UNION ALL
SELECT 'settings', COUNT(*) FROM settings;

-- All tables should show 0 rows if truncation was successful
