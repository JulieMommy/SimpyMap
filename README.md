# Juliemap

Carte du monde partagée où chaque visiteur apparaît avec un point sur la carte.

## Installation

Dans ce dossier (là où se trouve ce fichier) :

```bash
npm install
```

## Lancement en local

```bash
npm start
```

Puis ouvre ton navigateur à l’adresse :

- http://localhost:3000

## Fonctionnement

- Au premier chargement, un identifiant anonyme est créé et sauvegardé dans le navigateur.
- Le navigateur demande ta position (géolocalisation).
- Le serveur enregistre ta position dans une base SQLite (`data.db`).
- Tout le monde voit les points de tous les visiteurs sur la carte.

## Skin Drone

Quand on clique sur le skin « Drone » (verrouillé), une nouvelle page s’ouvre sur `https://juliemommy.pythonanywhere.com`. Le skin est débloqué automatiquement 20 secondes après le clic.

Les skins **BLACKED** et **Spiral** sont affichés verrouillés avec le libellé **5 €**.

