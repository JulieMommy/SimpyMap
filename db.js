// Connexion Supabase (PostgreSQL) — toutes les données passent par ce pool
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : undefined
});

pool.on('connect', () => {
  console.log('✅ Connexion Supabase (PostgreSQL) OK');
});

pool.on('error', (err) => {
  console.error('Erreur pool PostgreSQL:', err.message);
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      username TEXT,
      visits INTEGER DEFAULT 0,
      country TEXT,
      city TEXT,
      skin TEXT,
      "lastVisitDate" TEXT,
      "createdAt" TEXT,
      "updatedAt" TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS external_unlocks (
      "userId" TEXT NOT NULL,
      "skinId" TEXT NOT NULL,
      "unlockedAt" TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY ("userId", "skinId")
    )
  `);
}

module.exports = { pool, initSchema };
