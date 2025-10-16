const { Pool } = require('pg');

// Parse connection string manually to avoid IPv6 issues
const pool = new Pool({
  user: 'postgres',
  password: process.env.DB_PASSWORD, // We'll set this separately
  host: 'db.mlujgvsuldodbboncqec.supabase.co',
  port: 5432,
  database: 'postgres',
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000,
});

// Test connection on startup
pool.on('connect', () => {
  console.log('✅ Connected to Supabase database');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
});

module.exports = pool;
