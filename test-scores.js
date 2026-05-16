// Script de test Supabase (table scores — exemple séparé)
const { pool } = require('./db.js');

async function ajouterScore() {
  try {
    const result = await pool.query(
      `INSERT INTO scores (player, score) VALUES ($1, $2) RETURNING *`,
      ['Alex', 100]
    );
    console.log('✅ Score ajouté :', result.rows[0]);
  } catch (err) {
    console.error('❌ Erreur ajout :', err.message);
  }
}

async function lireScores() {
  try {
    const result = await pool.query('SELECT * FROM scores ORDER BY created_at DESC');
    console.log('📊 Scores dans la base :');
    console.table(result.rows);
  } catch (err) {
    console.error('❌ Erreur lecture :', err.message);
  }
}

async function main() {
  await ajouterScore();
  await lireScores();
  await pool.end();
}

main();
