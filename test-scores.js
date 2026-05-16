// test-scores.js
import pool from './db.js';

// ======================
// 1. Ajouter une donnée
// ======================
async function ajouterScore() {
  try {
    const result = await pool.query(
      `INSERT INTO scores (player, score) 
       VALUES ($1, $2) 
       RETURNING *`,
      ['Alex', 100]
    );
    console.log("✅ Score ajouté :", result.rows[0]);
  } catch (err) {
    console.error("❌ Erreur ajout :", err.message);
  }
}

// ======================
// 2. Lire toutes les données
// ======================
async function lireScores() {
  try {
    const result = await pool.query('SELECT * FROM scores ORDER BY created_at DESC');
    console.log("📊 Scores dans la base :");
    console.table(result.rows);   // Affiche un beau tableau
  } catch (err) {
    console.error("❌ Erreur lecture :", err.message);
  }
}

// ======================
// Exécuter les deux
// ======================
async function main() {
  await ajouterScore();
  await lireScores();
  
  await pool.end(); // Ferme la connexion proprement
}

main();