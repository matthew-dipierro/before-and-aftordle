const { Pool } = require('pg');

// Use IPv4-compatible pooler connection
const pool = new Pool({
  user: 'postgres.mlujgvsuldodbboncqec',
  password: process.env.DB_PASSWORD,
  host: 'aws-1-us-east-2.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  console.log('✅ Connected to Supabase database via pooler');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
});

module.exports = pool;
