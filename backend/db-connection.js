const { Pool } = require('pg');

// Parse the connection string to extract components
const connectionString = process.env.DATABASE_URL;

// Create pool with explicit IPv4 host to avoid IPv6 issues
const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  },
  // Explicitly set host to force IPv4 resolution
  host: 'db.mlujgvsuldodbboncqec.supabase.co',
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
