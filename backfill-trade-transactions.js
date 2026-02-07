import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'fda_wallet',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'admin',
});

async function backfillTransactions() {
  const client = await pool.connect();
  try {
    console.log('🔄 Starting transaction backfill for completed trades...\n');

    // Get all completed trades that don't have a transaction record
    const trades = await client.query(`
      SELECT t.*, 
             COALESCE(t.fee_rate, 0.01) as fee_rate,
             COALESCE(t.fee_amount, t.amount * COALESCE(t.fee_rate, 0.01)) as fee_amount
      FROM trades t
      WHERE t.status = 'COMPLETED' 
        AND t.released_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM internal_transfers it
          WHERE it.from_user_id = t.seller_id 
            AND it.to_user_id = t.buyer_id
            AND it.note LIKE '%P2P Trade #' || t.id || '%'
        )
      ORDER BY t.id
    `);

    console.log(`Found ${trades.rows.length} completed trades without transaction records\n`);

    if (trades.rows.length === 0) {
      console.log('✅ All completed trades already have transaction records!');
      return;
    }

    let created = 0;
    let errors = 0;

    for (const trade of trades.rows) {
      try {
        const fee = parseFloat(trade.fee_amount) || (parseFloat(trade.amount) * (parseFloat(trade.fee_rate) || 0.01));
        const amountToBuyer = parseFloat(trade.amount) - fee;

        // Create transaction record
        await client.query(`
          INSERT INTO internal_transfers (from_user_id, to_user_id, amount, note, created_at)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          trade.seller_id,
          trade.buyer_id,
          amountToBuyer,
          `P2P Trade #${trade.id} - ${parseFloat(trade.amount).toFixed(8)} FDA (Fee: ${fee.toFixed(8)} FDA)`,
          trade.released_at || trade.created_at
        ]);

        created++;
        console.log(`✅ Created transaction for Trade #${trade.id} (${parseFloat(trade.amount).toFixed(8)} FDA)`);
      } catch (err) {
        errors++;
        console.error(`❌ Error creating transaction for Trade #${trade.id}:`, err.message);
      }
    }

    console.log(`\n✅ Backfill complete!`);
    console.log(`   Created: ${created} transactions`);
    console.log(`   Errors: ${errors}`);
  } catch (err) {
    console.error('❌ Error during backfill:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

backfillTransactions();
