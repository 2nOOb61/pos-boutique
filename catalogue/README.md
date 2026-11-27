# Catalogue Prix & Mesures

Catalogue des prix pratiqués et des mesures de tous les articles, reconstitué
depuis les données réelles du POS.

Pourquoi ce dossier : la feuille `Produits` ne contient que 24 fiches tarifées,
alors que la boutique vend ~930 libellés différents. Le prix réel et les
dimensions vivent dans les lignes d'articles des `Ventes` et des `Commandes`,
en saisie libre. Ces scripts les en extraient.

## Lancer

```
node catalogue/build-catalogue.js           # lit l'API GAS (/exec) puis génère
node catalogue/build-catalogue.js --cache   # rejoue sur les données déjà téléchargées
```

Le script n'écrit **rien** dans le classeur : il n'appelle que les actions de
lecture `getProducts`, `getSales`, `getCommandes`, `getReservations`.

## Fichiers produits

| Fichier | Contenu |
|---|---|
| `catalogue.json` | tout : familles, articles, chaque mesure, chaque statistique de prix |
| `catalogue-web.json` | même chose allégée, c'est ce que lit la page de consultation |
| `catalogue-articles.csv` | une ligne par article — ouvrable dans Sheets / Excel |
| `catalogue-mesures.csv` | une ligne par mesure observée avec son prix et son Ar/m² |
| `.cache/` | réponses brutes de l'API, pour rejouer sans retélécharger (non versionné) |

## Code

| Fichier | Rôle |
|---|---|
| `mesures.js` | lit une dimension dans du texte libre et la ramène en cm (`1m50*90cm` → 150 × 90) |
| `familles.js` | range un libellé dans une des 28 familles, par mots-clés, et normalise le nom du modèle |
| `build-catalogue.js` | agrège les lignes, calcule les prix de référence, écrit les sorties |
| `catalogue-artifact.html` | page de consultation (source de l'artifact ; pas une page autonome, elle n'a pas de `<!doctype>`) |

## La page du POS

Le catalogue est aussi une **page de l'application** : `Catalogue`, dans le
groupe « Stock & Achats » de la barre latérale (rôles admin, gestionnaire,
commerciale, caissier, comptable, chef d'atelier). Elle recalcule tout
**côté navigateur** depuis les ventes et les commandes déjà chargées — aucun
appel GAS propre, aucune colonne, aucune feuille. Trois vues : Articles
(dépliables sur leurs mesures), Grilles de mesures, Fiches Produits ; plus un
export CSV de ce qui est filtré à l'écran.

⚠️ **Le module `CATALOGUE PRIX & MESURES` d'`app.js` double volontairement
`mesures.js` et `familles.js`** (préfixe `_cat`, `app.js` n'a pas de système de
modules). Les deux copies doivent rester identiques : une règle ajoutée d'un
côté doit l'être de l'autre, sinon la page et les CSV ne disent plus la même
chose. Le harnais de comparaison (voir `Vérifier` ci-dessous) est là pour ça.

## Vérifier

Pour contrôler que la page du POS et le générateur donnent bien les mêmes
chiffres, on extrait le module d'`app.js` et on le fait tourner sur les mêmes
données en Node, puis on compare au `catalogue.json` :

```
sed -n '/^\/\* =\+$/,$p' app.js > catalogue/.cache/module.js
```

Le module ne touche au DOM que dans `renderCatalogue()` : `_catData()` se
contente de lire les globales `sales`, `commandes`, `reservations`, `products`,
ce qui le rend testable hors navigateur.

`mesures.js` et `familles.js` ne dépendent de rien et tournent aussi bien dans
Node que dans le navigateur.

## Règles de calcul

- **Prix de référence** : le prix le plus souvent pratiqué s'il couvre au moins
  35 % des relevés (et au moins 2 lignes), sinon la médiane.
- Sont **exclues** des statistiques : les lignes à 0 Ar, les lignes de commandes
  annulées, et les lignes de test (`test1`, `TESTHIST`…).
- Quand une commande n'a **qu'un seul article** sans prix de ligne mais un
  sous-total, le prix unitaire en est déduit (27 cas).
- **Ar/m²** : seulement au-delà de 0,05 m² par pièce ; la valeur publiée pour
  une famille demande en plus au moins 3 pièces de plus de 0,25 m².

## Limites connues

- Environ **77 % des lignes n'ont aucune dimension saisie**. Une mesure absente
  ne veut pas dire que l'article n'en a pas.
- Un même libellé recouvre parfois deux produits (matière, finition, LED) :
  c'est ce qui explique les fourchettes larges. Toujours regarder min–max avant
  de retenir un prix.
- Le regroupement par mots-clés laisse ~2 % des lignes en « Autres articles ».

## Déploiement

Ce dossier est **hors du périmètre Apps Script** : `.claspignore` l'exclut, donc
`clasp push` ne l'envoie pas, et le générateur ne fait que lire l'API.

La **page du POS**, elle, est du front : elle part sur GitHub Pages par un
simple `git push origin main`, sans `clasp push` ni `clasp deploy` puisque
aucune action GAS n'a été ajoutée. Lot livré avec `APP_VERSION 248`,
`CACHE_NAME v248` et `?v=20261127-catalogue-prix-mesures`.
