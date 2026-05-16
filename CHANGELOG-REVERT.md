# Changements (réduction des requêtes serveur) – Revert si besoin

Si quelque chose ne fonctionne plus, tu peux annuler les changements en suivant ce qui suit.

---

## Fichier modifié : `public/index.html`

### 1. Double appel à `loadAllPositions()` au démarrage

**Modifications :**
- Dans **trySetPseudo()** : on ne appelle plus `loadAllPositions()` juste après `initGeolocationAndSync()`. Le chargement se fait uniquement dans le callback de la géolocalisation (succès ou erreur).
- Dans **initApp()** (quand un pseudo est déjà enregistré) : idem, plus d’appel immédiat à `loadAllPositions()`, seulement `initGeolocationAndSync()`.

**Pour revenir en arrière :**
- Dans `trySetPseudo()`, après `initGeolocationAndSync();`, rajouter la ligne :  
  `loadAllPositions();`
- Dans `initApp()`, dans le `if (stored && stored.trim())`, après `initGeolocationAndSync();`, rajouter :  
  `loadAllPositions();`

**Effet si on revient en arrière :** deux séries de requêtes au chargement (positions + leaderboard + last-joined + top-scores) au lieu d’une.

---

### 2. Un seul `setInterval` au lieu de deux

**Modification :**
- Suppression de `setInterval(loadNewPositionsOnly, 10000)`.
- Il ne reste que : `setInterval(loadAllPositions, 60000);`

**Pour revenir en arrière :**
- Après la ligne  
  `setInterval(loadAllPositions, 60000);`  
  rajouter :  
  `// Nouveaux points seulement toutes les 10 s (n'actualise pas les marqueurs existants)`  
  `setInterval(loadNewPositionsOnly, 10000);`

**Effet si on revient en arrière :** environ 3 requêtes toutes les 10 s en plus du refresh toutes les 60 s (plus de chevauchement à la 60e seconde).

---

## Comportement après les corrections

- **Premier chargement / « Let’s go » :** une seule série de requêtes une fois la géoloc obtenue (ou en cas d’erreur de géoloc).
- **En continu :** un seul refresh complet toutes les 60 secondes (positions + leaderboard + last-joined + top-scores).

La fonction `loadNewPositionsOnly` est toujours présente dans le fichier mais n’est plus appelée ; tu peux la réactiver en rétablissant le second `setInterval` ci-dessus.
