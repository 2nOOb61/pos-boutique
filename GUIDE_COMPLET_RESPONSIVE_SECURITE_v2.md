# 🛡️📱 GUIDE COMPLET — RESPONSIVE & SÉCURITÉ v2
> Instructions permanentes pour Claude — À coller dans tes préférences système  
> Contexte : Atelier FOREVER MG · GAS · GitHub Pages · HTML apps  
> Version : v2 — Corrections issues des screenshots réels (nav mobile, KPI cards, boutons panier)

---

# PARTIE 1 — RESPONSIVE DESIGN
> Tout code frontend doit fonctionner parfaitement sur smartphone Android (360–414px), tablette et PC

---

## R1. RÈGLE FONDAMENTALE — MOBILE FIRST

**3 breakpoints obligatoires :**

| Nom      | Largeur        | Cible                  |
|----------|----------------|------------------------|
| Mobile   | < 768px        | Smartphone (défaut)    |
| Tablette | 768px – 1024px | iPad, tablette         |
| Desktop  | > 1024px       | PC, grand écran        |

> ⚠️ **Mobile first** = écrire le CSS mobile EN PREMIER, puis surcharger pour les grands écrans.  
> Ne jamais partir du desktop et tout casser en mobile.

---

## R2. CSS — BASE OBLIGATOIRE

### Toujours dans `<head>` (en tout premier)
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
```

> ⚠️ `maximum-scale=1.0` empêche le zoom accidentel sur double-tap (important pour les apps POS/caisse)

### Variables CSS systématiques
```css
:root {
  /* Couleurs FOREVER MG */
  --color-primary:    #2d6a4f;   /* vert foncé header */
  --color-accent:     #e07b20;   /* orange boutons */
  --color-accent-bg:  #fdf0e0;   /* fond orange clair */
  --color-bg:         #f0ebe3;   /* fond général beige */
  --color-card:       #ffffff;
  --color-text:       #1a1a1a;
  --color-muted:      #666666;
  --color-border:     #e0d8d0;
  --color-success:    #2d6a4f;
  --color-danger:     #c0392b;

  /* Espacements */
  --spacing-xs:  4px;
  --spacing-sm:  8px;
  --spacing-md:  16px;
  --spacing-lg:  24px;
  --spacing-xl:  32px;

  /* Typographie */
  --font-sm:   13px;
  --font-md:   15px;
  --font-lg:   18px;
  --font-xl:   22px;

  /* Composants */
  --radius:         10px;
  --radius-sm:      6px;
  --radius-lg:      16px;
  --shadow:         0 2px 8px rgba(0,0,0,0.10);
  --shadow-card:    0 1px 4px rgba(0,0,0,0.08);
  --header-height:  60px;
  --bottom-nav-h:   60px;   /* hauteur barre navigation bas mobile */
  --sidebar-width:  240px;
}
```

### Reset minimal obligatoire
```css
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: var(--font-md);
  line-height: 1.5;
  background: var(--color-bg);
  color: var(--color-text);
  overflow-x: hidden;
  /* Espace en bas pour la bottom nav mobile */
  padding-bottom: var(--bottom-nav-h);
}
img, video { max-width: 100%; height: auto; }
a { color: inherit; text-decoration: none; }
```

---

## R3. MEDIA QUERIES — MOBILE FIRST

```css
/* ════ MOBILE (défaut — écrit en premier) ════ */
.container {
  width: 100%;
  padding: var(--spacing-md);
}

/* ════ TABLETTE ════ */
@media (min-width: 768px) {
  .container {
    max-width: 900px;
    margin: 0 auto;
    padding: var(--spacing-lg);
  }
}

/* ════ DESKTOP ════ */
@media (min-width: 1024px) {
  .container {
    max-width: 1200px;
    padding: var(--spacing-xl);
  }
  body {
    padding-bottom: 0; /* plus de bottom nav sur desktop */
  }
}
```

---

## R4. NAVIGATION — PATTERN FOREVER MG ✅ CORRIGÉ

> **Problème observé dans les screenshots** : la navigation en grille (Caisse, Réservations, Commandes, Stock…) était désordonnée sur mobile. Voici le pattern correct.

### Header fixe en haut
```css
.app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--color-primary);
  color: white;
  height: var(--header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--spacing-md);
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
}
.app-header .logo {
  font-weight: 700;
  font-size: var(--font-lg);
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}
.app-header .header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}
.btn-header {
  background: rgba(255,255,255,0.15);
  border: none;
  color: white;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--font-sm);
  cursor: pointer;
  min-height: 36px;
}
```

### Menu latéral déroulant (hamburger) — mobile
```css
/* Menu hamburger burger */
.hamburger-btn {
  background: none;
  border: none;
  color: white;
  font-size: 22px;
  cursor: pointer;
  padding: 8px;
  min-height: 44px;
  min-width: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Overlay + drawer */
.nav-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 200;
}
.nav-overlay.open { display: block; }

.nav-drawer {
  position: fixed;
  top: 0;
  left: -260px;
  width: 240px;
  height: 100vh;
  background: var(--color-primary);
  z-index: 201;
  transition: left 0.25s ease;
  overflow-y: auto;
  padding: var(--spacing-lg) 0;
}
.nav-drawer.open { left: 0; }

.nav-drawer-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: 14px var(--spacing-lg);
  color: rgba(255,255,255,0.85);
  font-size: var(--font-md);
  cursor: pointer;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  transition: background 0.15s;
}
.nav-drawer-item:hover,
.nav-drawer-item.active {
  background: rgba(255,255,255,0.15);
  color: white;
}
.nav-drawer-item .badge {
  margin-left: auto;
  background: var(--color-accent);
  color: white;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 20px;
  min-width: 20px;
  text-align: center;
}
```

```javascript
// JS minimal pour le hamburger
function toggleNav() {
  document.querySelector('.nav-drawer').classList.toggle('open');
  document.querySelector('.nav-overlay').classList.toggle('open');
}
document.querySelector('.nav-overlay').addEventListener('click', toggleNav);
```

### Bottom navigation (barre du bas) — mobile ✅
> Pattern vu dans les screenshots — à reproduire exactement comme ça
```css
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--bottom-nav-h);
  background: white;
  border-top: 1px solid var(--color-border);
  display: flex;
  z-index: 100;
  box-shadow: 0 -2px 8px rgba(0,0,0,0.08);
}
.bottom-nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 10px;
  color: var(--color-muted);
  padding: 6px 0;
  min-height: 44px;
  transition: color 0.15s;
}
.bottom-nav-item.active {
  color: var(--color-accent);
  font-weight: 600;
}
.bottom-nav-item .nav-icon {
  font-size: 20px;
  line-height: 1;
}
/* Desktop : cacher la bottom nav */
@media (min-width: 1024px) {
  .bottom-nav { display: none; }
}
```

---

## R5. KPI CARDS — PATTERN FOREVER MG ✅ CORRIGÉ

> **Problème observé** : les cards KPI (EN COURS, TOTAL ENGAGÉ, ACOMPTES REÇUS, RESTANT À PERCEVOIR) doivent s'afficher en grille 2×2 sur mobile, 4 colonnes sur desktop.

```css
/* ════ Grille KPI ════ */
.kpi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;   /* 2 colonnes sur mobile */
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}
@media (min-width: 768px) {
  .kpi-grid {
    grid-template-columns: repeat(4, 1fr);  /* 4 colonnes sur tablette+ */
    gap: var(--spacing-md);
  }
}

/* ════ Card individuelle ════ */
.kpi-card {
  background: var(--color-card);
  border-radius: var(--radius);
  padding: var(--spacing-md) var(--spacing-sm);
  text-align: center;
  box-shadow: var(--shadow-card);
  border: 1px solid var(--color-border);
  min-height: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.kpi-card .kpi-value {
  font-size: clamp(1.1rem, 4vw, 1.6rem);
  font-weight: 700;
  color: var(--color-accent);
  line-height: 1.2;
}
.kpi-card .kpi-value.neutral {
  color: var(--color-text);
}
.kpi-card .kpi-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
```

```html
<!-- Structure HTML des KPI cards -->
<div class="kpi-grid">
  <div class="kpi-card">
    <div class="kpi-value neutral">1</div>
    <div class="kpi-label">En cours</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-value">225 000 Ar</div>
    <div class="kpi-label">Total engagé</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-value neutral">0 Ar</div>
    <div class="kpi-label">Acomptes reçus</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-value">225 000 Ar</div>
    <div class="kpi-label">Restant à percevoir</div>
  </div>
</div>
```

---

## R6. CARDS COMMANDE / RÉSERVATION ✅ CORRIGÉ

> **Problème observé** : la card de commande (client, adresse, articles, total, acompte) doit être bien structurée sur mobile avec espacement correct.

```css
.order-card {
  background: var(--color-card);
  border-radius: var(--radius);
  padding: var(--spacing-md);
  box-shadow: var(--shadow-card);
  border: 1px solid var(--color-border);
  margin-bottom: var(--spacing-md);
}

/* En-tête de la card */
.order-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacing-sm);
}
.order-client-name {
  font-weight: 700;
  font-size: var(--font-md);
  display: flex;
  align-items: center;
  gap: 6px;
}
.order-client-phone {
  font-size: var(--font-sm);
  color: var(--color-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Badge statut */
.status-badge {
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  white-space: nowrap;
}
.status-badge.en-cours   { background: var(--color-accent-bg); color: var(--color-accent); }
.status-badge.livre      { background: #e8f5e9; color: #2e7d32; }
.status-badge.annule     { background: #fdecea; color: var(--color-danger); }
.status-badge.en-attente { background: #e3f2fd; color: #1565c0; }

/* Ligne adresse + livraison */
.order-meta {
  background: var(--color-bg);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: var(--font-sm);
  margin-bottom: var(--spacing-sm);
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}
.order-meta strong { color: var(--color-accent); }

/* Liste des articles */
.order-items {
  margin-bottom: var(--spacing-sm);
}
.order-item-line {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 4px 0;
  font-size: var(--font-sm);
  border-bottom: 1px solid var(--color-border);
}
.order-item-line:last-child { border-bottom: none; }
.order-item-name { flex: 1; }
.order-item-price { font-weight: 600; white-space: nowrap; margin-left: 8px; }

/* Note personnalisation */
.order-note {
  background: #fffde7;
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: var(--font-sm);
  margin-bottom: var(--spacing-sm);
  color: #666;
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

/* Footer totaux */
.order-totals {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
}
.order-total-item {
  background: var(--color-bg);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}
.order-total-item .label {
  font-size: 11px;
  color: var(--color-muted);
  text-transform: uppercase;
  font-weight: 600;
}
.order-total-item .value {
  font-size: var(--font-lg);
  font-weight: 700;
  color: var(--color-text);
  margin-top: 2px;
}

/* Actions sur la card */
.order-actions {
  display: flex;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
  flex-wrap: wrap;
}
.order-actions button {
  flex: 1;
  min-width: 100px;
}
```

---

## R7. MODULE CAISSE — PANIER ✅ CORRIGÉ

> **Problème observé** : le panier vide prenait trop de hauteur, les boutons de paiement (Espèces, Mobile, Réserver, Commander) doivent prendre toute la largeur et être bien espacés.

```css
/* ════ Layout caisse (2 colonnes sur desktop) ════ */
.caisse-layout {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}
@media (min-width: 1024px) {
  .caisse-layout {
    flex-direction: row;
    align-items: flex-start;
  }
  .caisse-articles { flex: 1.2; }
  .caisse-panier   { flex: 1; position: sticky; top: 70px; }
}

/* ════ Onglets Articles / Panier ════ */
.caisse-tabs {
  display: flex;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--color-border);
  margin-bottom: var(--spacing-md);
}
.caisse-tab {
  flex: 1;
  padding: 12px;
  text-align: center;
  font-weight: 600;
  font-size: var(--font-sm);
  cursor: pointer;
  background: var(--color-card);
  color: var(--color-muted);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  transition: all 0.15s;
}
.caisse-tab.active {
  background: var(--color-accent-bg);
  color: var(--color-accent);
}

/* ════ Panier ════ */
.panier-section {
  background: var(--color-card);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow-card);
}
.panier-header {
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  font-size: var(--font-lg);
}
.panier-body {
  min-height: 120px;   /* ← réduit : l'ancien était trop grand */
  max-height: 35vh;    /* ← limite la hauteur sur mobile */
  overflow-y: auto;
}

/* État vide du panier */
.panier-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-lg) var(--spacing-md);
  color: var(--color-muted);
  font-size: var(--font-sm);
  gap: var(--spacing-sm);
}
.panier-empty .empty-icon { font-size: 36px; opacity: 0.5; }

/* ════ Récapitulatif totaux ════ */
.panier-totaux {
  padding: var(--spacing-md);
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}
.panier-total-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-sm);
}
.panier-total-line.net-a-payer {
  font-size: var(--font-lg);
  font-weight: 700;
  padding-top: var(--spacing-sm);
  border-top: 2px solid var(--color-border);
  margin-top: 4px;
}
.panier-total-line.net-a-payer .montant {
  color: var(--color-accent);
}

/* Champ remise / acompte */
.panier-input-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  font-size: var(--font-sm);
}
.panier-input-line input {
  width: 110px;
  text-align: right;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-sm);
  min-height: 38px;
}

/* ════ Boutons de paiement ✅ ════ */
.panier-actions {
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  border-top: 1px solid var(--color-border);
}
.btn-paiement {
  width: 100%;
  min-height: 50px;          /* ← plus grand que 44px pour confort tactile */
  border: none;
  border-radius: var(--radius);
  font-size: var(--font-md);
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  transition: opacity 0.15s, transform 0.1s;
}
.btn-paiement:active { transform: scale(0.98); opacity: 0.85; }

.btn-especes  { background: var(--color-primary); color: white; }
.btn-mobile   { background: var(--color-accent);  color: white; }
.btn-reserver { background: var(--color-accent);  color: white; opacity: 0.85; }
.btn-commander{ background: var(--color-accent);  color: white; opacity: 0.75; }

/* Bouton désactivé (panier vide) */
.btn-paiement:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}
```

---

## R8. FORMULAIRES RESPONSIVES

```css
.form-section {
  background: var(--color-card);
  border-radius: var(--radius);
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-md);
  box-shadow: var(--shadow-card);
}
.form-section-title {
  font-weight: 700;
  font-size: var(--font-md);
  margin-bottom: var(--spacing-md);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: var(--spacing-md);
}
.form-label {
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--color-muted);
}
.form-control {
  width: 100%;
  padding: 10px 14px;
  font-size: var(--font-md);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: white;
  color: var(--color-text);
  min-height: 46px;    /* ← ≥ 44px standard tactile */
  transition: border-color 0.15s;
}
.form-control:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(224, 123, 32, 0.15);
}
select.form-control { cursor: pointer; }
textarea.form-control { min-height: 80px; resize: vertical; }

/* 2 colonnes sur tablette+ */
@media (min-width: 768px) {
  .form-row-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-md);
  }
  .form-row-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--spacing-md);
  }
}
```

---

## R9. BOUTONS — SYSTÈME COMPLET

```css
/* Base */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 20px;
  min-height: 44px;     /* ← standard tactile obligatoire */
  border: none;
  border-radius: var(--radius);
  font-size: var(--font-md);
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  white-space: nowrap;
}
.btn:active { transform: scale(0.97); }

/* Variantes */
.btn-primary   { background: var(--color-accent);   color: white; }
.btn-secondary { background: var(--color-primary);  color: white; }
.btn-outline   { background: transparent; border: 1.5px solid var(--color-accent); color: var(--color-accent); }
.btn-ghost     { background: transparent; color: var(--color-muted); }
.btn-danger    { background: var(--color-danger);   color: white; }

/* Tailles */
.btn-sm  { min-height: 36px; padding: 6px 14px; font-size: var(--font-sm); }
.btn-lg  { min-height: 52px; padding: 14px 28px; font-size: var(--font-lg); }
.btn-full { width: 100%; }

/* Bouton flottant (+) */
.btn-fab {
  position: fixed;
  bottom: calc(var(--bottom-nav-h) + 16px);
  right: var(--spacing-md);
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--color-accent);
  color: white;
  border: none;
  font-size: 26px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(224,123,32,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  transition: transform 0.15s;
}
.btn-fab:active { transform: scale(0.92); }
@media (min-width: 1024px) {
  .btn-fab { bottom: var(--spacing-lg); }
}
```

---

## R10. TABLEAUX RESPONSIVES

### Approche A — Scroll horizontal (listes longues)
```css
.table-wrapper {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: var(--radius);
  box-shadow: var(--shadow-card);
}
table {
  min-width: 600px;
  width: 100%;
  border-collapse: collapse;
  background: var(--color-card);
}
th {
  background: var(--color-primary);
  color: white;
  padding: 12px 14px;
  text-align: left;
  font-size: var(--font-sm);
  font-weight: 600;
  white-space: nowrap;
}
td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-sm);
  vertical-align: middle;
}
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--color-bg); }
```

### Approche B — Carte mobile (affichage en carte sous 768px)
```css
@media (max-width: 767px) {
  table, thead, tbody, th, td, tr { display: block; }
  thead { display: none; }
  tr {
    margin-bottom: var(--spacing-sm);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--color-card);
    box-shadow: var(--shadow-card);
  }
  td {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--color-border);
    font-size: var(--font-sm);
  }
  td:last-child { border-bottom: none; }
  td::before {
    content: attr(data-label);
    font-weight: 600;
    color: var(--color-muted);
    font-size: 11px;
    text-transform: uppercase;
    margin-right: 8px;
    flex-shrink: 0;
  }
}
```

---

## R11. TYPOGRAPHIE RESPONSIVE

```css
h1 { font-size: clamp(1.4rem, 5vw, 2.2rem); font-weight: 700; line-height: 1.2; }
h2 { font-size: clamp(1.2rem, 4vw, 1.7rem); font-weight: 700; }
h3 { font-size: clamp(1rem,  3vw, 1.4rem);  font-weight: 600; }
p  { font-size: clamp(0.875rem, 2vw, 1rem); }

.text-xs  { font-size: 11px; }
.text-sm  { font-size: var(--font-sm); }
.text-md  { font-size: var(--font-md); }
.text-lg  { font-size: var(--font-lg); }
.text-xl  { font-size: var(--font-xl); }
.text-bold { font-weight: 700; }
.text-muted { color: var(--color-muted); }
.text-accent { color: var(--color-accent); }
.text-primary { color: var(--color-primary); }
```

---

## R12. SPÉCIFICITÉS GAS

```html
<!-- Template HTML GAS de base — FOREVER MG -->
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <style>
    /* ← Tout le CSS ici (pas de fichier externe dans GAS) */
    /* Inclure les variables :root + reset + composants nécessaires */
  </style>
</head>
<body>
  <!-- Contenu -->
  <script>/* JS ici */</script>
</body>
</html>
```

```css
/* Notes spécifiques GAS */

/* Sidebar GAS : max 300px imposé → concevoir en mode mobile par défaut */
body { font-size: 13px; padding: 8px; }
button { width: 100%; margin-bottom: 6px; }
select, input { width: 100%; }

/* ❌ NE PAS utiliser position:fixed dans les sidebars GAS (buggy) */
/* ✅ Utiliser position:sticky pour les headers dans doGet */

/* ❌ NE PAS utiliser de CDN externes (bloqués dans certains contextes GAS) */
/* ✅ Inline tout le CSS et le JS */
```

---

## R13. CLASSES UTILITAIRES

```css
/* Visibilité */
.mobile-only  { display: block; }
.tablet-up    { display: none;  }
.desktop-only { display: none;  }
@media (min-width: 768px)  { .mobile-only { display: none; } .tablet-up { display: block; } }
@media (min-width: 1024px) { .desktop-only { display: block; } }

/* Flexbox */
.flex         { display: flex; }
.flex-col     { flex-direction: column; }
.flex-center  { align-items: center; justify-content: center; }
.flex-between { justify-content: space-between; align-items: center; }
.flex-wrap    { flex-wrap: wrap; }
.flex-1       { flex: 1; }

/* Gaps */
.gap-xs  { gap: var(--spacing-xs); }
.gap-sm  { gap: var(--spacing-sm); }
.gap-md  { gap: var(--spacing-md); }
.gap-lg  { gap: var(--spacing-lg); }

/* Texte */
.text-center  { text-align: center; }
.text-right   { text-align: right; }
.truncate     { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Espacements */
.mt-sm { margin-top: var(--spacing-sm); }
.mt-md { margin-top: var(--spacing-md); }
.mt-lg { margin-top: var(--spacing-lg); }
.mb-sm { margin-bottom: var(--spacing-sm); }
.mb-md { margin-bottom: var(--spacing-md); }
.mb-lg { margin-bottom: var(--spacing-lg); }
.p-sm  { padding: var(--spacing-sm); }
.p-md  { padding: var(--spacing-md); }
.p-lg  { padding: var(--spacing-lg); }
.w-full { width: 100%; }

/* Arrondi & ombre */
.rounded    { border-radius: var(--radius); }
.rounded-sm { border-radius: var(--radius-sm); }
.shadow     { box-shadow: var(--shadow); }
.card       { background: var(--color-card); border-radius: var(--radius); padding: var(--spacing-md); box-shadow: var(--shadow-card); }
```

---

## R14. CHECKLIST RESPONSIVE ✅

Avant de livrer un écran, vérifier point par point :

- [ ] `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">` dans `<head>`
- [ ] Variables `:root` incluses avec les couleurs FOREVER MG
- [ ] Aucune largeur fixe en `px` sur les conteneurs principaux
- [ ] Tous les éléments cliquables ≥ **44px de hauteur** (boutons, liens, items nav)
- [ ] Bottom nav présente et fixée en bas sur mobile
- [ ] Header sticky en haut
- [ ] KPI cards en grille 2×2 sur mobile, 4 colonnes sur desktop
- [ ] Tableaux avec `.table-wrapper` + `overflow-x: auto`
- [ ] Navigation : hamburger drawer OU bottom nav (pas menu inline désorganisé)
- [ ] Champs de formulaire `width: 100%`, `min-height: 44px` sur mobile
- [ ] Images avec `max-width: 100%`
- [ ] Texte lisible sans zoom (min 13px)
- [ ] Panier : `max-height: 35vh` + `overflow-y: auto` pour ne pas déborder
- [ ] Boutons paiement : `width: 100%`, `min-height: 50px`, espacés de 8px
- [ ] Testé mentalement à **360px** (Android entrée de gamme) et **1440px** (desktop)
- [ ] `body { padding-bottom: var(--bottom-nav-h) }` pour que le contenu ne passe pas sous la nav

---
---

# PARTIE 2 — SÉCURITÉ
> Defense in Depth : Authentification → Autorisation → Données → Audit

---

## ⚠️ MENACES RÉELLES DANS TON ENVIRONNEMENT

Pas de SQL → pas d'injection SQL. Les vraies menaces sont :

| Menace | Description | Protection |
|--------|-------------|------------|
| **Formula Injection** | `=IMPORTDATA(...)` exfiltre les données Sheets | `nettoyerTexte()` avec préfixe `'` |
| **XSS** | `<script>` injecté dans l'UI | `textContent` jamais `innerHTML` |
| **Privilege escalation** | Manipulation de paramètres GAS | Rôles vérifiés côté `.gs` uniquement |
| **Session forgery** | Token falsifié | Validation via `CacheService` GAS |
| **Quota exhaustion** | Appels abusifs = app bloquée | Rate limiting |
| **Secrets exposés** | Clés API dans le HTML | `PropertiesService` |

> ✅ **Ce que Google gère pour toi** : HTTPS forcé, CSRF intégré dans `google.script.run`, isolation des scripts, OAuth, backups Sheets automatiques.

---

## S1. AUTHENTIFICATION — QUI PEUT ACCÉDER

### GAS — Restriction par domaine
```javascript
function doGet(e) {
  const email = Session.getActiveUser().getEmail();
  if (!email) {
    return HtmlService.createHtmlOutput('<h2>Accès refusé — Connexion requise</h2>');
  }
  // Optionnel : restreindre à un domaine
  const DOMAINE = 'forevermg.com';
  if (!email.endsWith('@' + DOMAINE)) {
    return HtmlService.createHtmlOutput('<h2>Accès réservé à ' + DOMAINE + '</h2>');
  }
  return HtmlService.createTemplateFromFile('index').evaluate();
}
```

### GAS — Liste blanche d'emails (feuille CONFIG)
```javascript
// Feuille "CONFIG" col A = emails autorisés, col B = actif (OUI/NON)
function verifierAcces() {
  const email = Session.getActiveUser().getEmail();
  const config = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CONFIG');
  const emails = config.getRange('A2:A100').getValues().flat().filter(Boolean);
  if (!emails.includes(email)) throw new Error('Accès non autorisé : ' + email);
  return email;
}
```

### GitHub Pages — Pas d'auth native
```javascript
// Option recommandée : déléguer l'auth à un GAS doPost
// Option simple     : Cloudflare Access (gratuit, SSO Google)
// Option minimale   : mot de passe encodé base64 (sécurité faible)
const MDP = btoa('motdepasse2024');
function verifierMDP(saisie) { return btoa(saisie) === MDP; }
```

### Token de session (HTML standalone)
```javascript
// Côté GAS (.gs) :
function creerToken(email) {
  const token = Utilities.getUuid();
  CacheService.getUserCache().put('token_' + token, email, 3600); // 1h
  return token;
}
function validerToken(token) {
  const email = CacheService.getUserCache().get('token_' + token);
  if (!email) throw new Error('Session expirée — reconnectez-vous');
  return email;
}
// Côté HTML : sessionStorage.setItem('token', tokenRecu)
// Côté appel : google.script.run.maFonction(sessionStorage.getItem('token'), ...args)
```

---

## S2. AUTORISATION — RÔLES ET PERMISSIONS

### Structure de rôles (feuille UTILISATEURS)
```javascript
// Col A = email | Col B = rôle | Col C = actif (OUI/NON)
const ROLES = {
  ADMIN:     ['voir_tout', 'modifier_tout', 'supprimer', 'config', 'export'],
  MANAGER:   ['voir_tout', 'modifier_commandes', 'voir_rh', 'export'],
  OPERATEUR: ['voir_ses_taches', 'modifier_statut'],
  LECTURE:   ['voir_tout']
};

function getRoleUtilisateur(email) {
  const data = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName('UTILISATEURS').getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email && data[i][2] === 'OUI') return data[i][1];
  }
  return null;
}

function verifierPermission(permission) {
  const email = Session.getActiveUser().getEmail();
  const role = getRoleUtilisateur(email);
  if (!role || !ROLES[role]?.includes(permission)) {
    journaliser(email, 'ACCES_REFUSE', 'Permission : ' + permission);
    throw new Error('Permission refusée : ' + permission);
  }
  return { email, role };
}
```

### Pattern obligatoire pour chaque fonction GAS exposée
```javascript
function supprimerCommande(idCommande) {
  const { email } = verifierPermission('supprimer');      // 1. Permission
  if (!idCommande || typeof idCommande !== 'string')      // 2. Validation input
    throw new Error('ID invalide');
  journaliser(email, 'SUPPRESSION', 'Commande ' + idCommande); // 3. Journal
  // 4. Action
  return { succes: true };
}
```

### Filtrage des données selon le rôle (côté GAS uniquement)
```javascript
function getCommandes() {
  const email = Session.getActiveUser().getEmail();
  const role  = getRoleUtilisateur(email);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('COMMANDES');
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows    = data.slice(1);

  if (role === 'OPERATEUR') {
    const col = headers.indexOf('RESPONSABLE');
    return rows.filter(r => r[col] === email); // voit seulement ses lignes
  }
  return rows; // ADMIN / MANAGER : voit tout
}
```

### Masquage UI selon le rôle (côté client)
```javascript
function appliquerRoleUI(role) {
  if (role !== 'ADMIN' && role !== 'RH') {
    document.querySelectorAll('.col-salaire').forEach(el => el.style.display = 'none');
  }
  if (role === 'LECTURE') {
    document.querySelectorAll('.btn-modifier, .btn-supprimer').forEach(el => el.remove());
  }
}
```

---

## S3. PROTECTION DES DONNÉES & ANTI-INJECTION

### ⚡ Anti-Formula Injection (priorité haute)
```javascript
// Un utilisateur peut saisir =IMPORTDATA("http://...") dans un champ texte
// Sheets EXÉCUTERAIT cette formule → exfiltration de données !
function nettoyerTexte(valeur) {
  if (typeof valeur !== 'string') return '';
  return valeur
    .trim()
    .replace(/^([=+\-@\t\r])/, "'$1") // ← CRITIQUE : neutralise formules Sheets
    .replace(/[<>"`;]/g, '')           // supprime caractères dangereux HTML/JS
    .substring(0, 500);                // limite la longueur
}

function nettoyerNombre(valeur) {
  const n = parseFloat(valeur);
  if (isNaN(n)) throw new Error('Valeur numérique invalide');
  return n;
}

function nettoyerEmail(valeur) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur)) throw new Error('Email invalide');
  return valeur.toLowerCase().trim();
}

function nettoyerDate(valeur) {
  const d = new Date(valeur);
  if (isNaN(d.getTime())) throw new Error('Date invalide');
  return d;
}

// Usage obligatoire avant toute écriture en Sheets :
function ajouterClient(nom, email, montant) {
  verifierPermission('modifier_commandes');
  const nomPropre     = nettoyerTexte(nom);
  const emailPropre   = nettoyerEmail(email);
  const montantPropre = nettoyerNombre(montant);
  // ... écriture
}
```

### ⚡ Anti-XSS (priorité haute)
```javascript
// ❌ DANGEREUX — exécute du JS malveillant si la donnée contient <script>
element.innerHTML = donneeDepuisSheets;

// ✅ SÛRS — traitent toujours comme texte brut
element.textContent = donneeDepuisSheets;
element.innerText   = donneeDepuisSheets;

// ✅ Si construction HTML obligatoire — échapper manuellement
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}
// Usage : element.innerHTML = '<b>' + escapeHtml(donnee) + '</b>';
```

### Secrets — PropertiesService uniquement
```javascript
// ❌ INTERDIT dans le HTML/JS client
const API_KEY = 'AIzaSy...';
const SPREADSHEET_ID = '1BxiM...';

// ✅ Stocker via : Extensions > Apps Script > Paramètres > Propriétés de script
const props = PropertiesService.getScriptProperties();
const apiKey = props.getProperty('API_KEY');
```

### IDs internes — ne jamais exposer l'index de ligne Sheets
```javascript
// ❌ Un attaquant peut manipuler ligneIndex pour accéder à n'importe quelle ligne
return { ligneIndex: 42, data: ... };

// ✅ Utiliser un identifiant métier (CMD-2024-042, EMP-007, etc.)
return { idCommande: 'CMD-2024-042', data: ... };

// Retrouver la ligne par ID métier côté GAS :
function trouverLigne(sheet, idMetier) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === idMetier) return i + 1;
  }
  return null;
}
```

---

## S4. JOURNALISATION ET AUDIT

### Feuille JOURNAL — structure
```
Col A : Horodatage  → new Date()
Col B : Email       → Session.getActiveUser().getEmail()
Col C : Action      → 'CONNEXION' | 'CREATION' | 'MODIFICATION' | 'SUPPRESSION' | 'EXPORT' | 'ACCES_REFUSE'
Col D : Cible       → 'Commande CMD-2024-042'
Col E : Détail      → JSON.stringify({ avant, apres }) ou texte libre
```

### Fonction journaliser()
```javascript
function journaliser(email, action, cible, detail = '') {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let journal = ss.getSheetByName('JOURNAL');
    if (!journal) {
      journal = ss.insertSheet('JOURNAL');
      journal.appendRow(['Horodatage', 'Email', 'Action', 'Cible', 'Détail']);
      journal.setFrozenRows(1);
    }
    journal.appendRow([
      new Date(), email, action, cible,
      typeof detail === 'object' ? JSON.stringify(detail) : detail
    ]);
  } catch (err) {
    console.error('Erreur journal :', err.message); // ne jamais bloquer l'app
  }
}
```

---

## S5. SÉCURITÉ DES COMMUNICATIONS

### withSuccessHandler + withFailureHandler (obligatoire)
```javascript
// ❌ Aucune gestion d'erreur
google.script.run.maFonction(param);

// ✅ Toujours gérer les deux cas
google.script.run
  .withSuccessHandler(result => afficherResultat(result))
  .withFailureHandler(err => {
    afficherErreur('Une erreur est survenue. Contactez l\'administrateur.');
    console.error('Erreur GAS :', err.message);
  })
  .maFonction(param);
```

### Wrapper sécurisé pour toutes les fonctions GAS
```javascript
function maFonctionSecurisee(params) {
  try {
    verifierPermission('modifier_commandes');
    // ... logique métier
    return { succes: true, data: resultat };
  } catch (err) {
    console.error(err);
    return {
      succes: false,
      message: err.message.startsWith('Permission') || err.message.startsWith('Accès')
        ? err.message
        : 'Erreur serveur — veuillez réessayer'
    };
  }
}
```

### Rate limiting (anti-abus / quota GAS)
```javascript
function verifierRateLimit(email, action, maxParMinute = 10) {
  const cache = CacheService.getUserCache();
  const cle = 'rate_' + action + '_' + email;
  const compteur = parseInt(cache.get(cle) || '0');
  if (compteur >= maxParMinute) throw new Error('Trop de requêtes — attendez une minute');
  cache.put(cle, String(compteur + 1), 60);
}
```

---

## S6. CONFIGURATION GAS SÉCURISÉE

```
Web App GAS :
→ "Exécuter en tant que" : MOI (propriétaire) — recommandé
→ "Qui a accès"          : Utilisateurs du domaine (pas "Tout le monde" sauf nécessaire)
Si "Tout le monde" requis → implémenter vérifications S1 dans le code
```

---

## S7. CHECKLIST SÉCURITÉ ✅

**Authentification**
- [ ] `Session.getActiveUser().getEmail()` vérifié en début de chaque fonction GAS
- [ ] Liste blanche ou restriction domaine configurée
- [ ] Aucun secret dans le HTML/JS client

**Autorisation**
- [ ] Rôles définis si plusieurs types d'utilisateurs
- [ ] Chaque fonction GAS vérifie la permission AVANT d'agir
- [ ] Données filtrées selon le rôle côté GAS avant envoi client

**Injections & XSS**
- [ ] `nettoyerTexte()` avec préfixe `'` anti-formule sur tous les inputs texte
- [ ] `textContent` utilisé (jamais `innerHTML` sur données utilisateur)
- [ ] `escapeHtml()` si construction HTML avec données dynamiques

**Données**
- [ ] `PropertiesService` pour tous les secrets
- [ ] IDs métier exposés (jamais l'index de ligne Sheets)
- [ ] Colonnes sensibles masquées dans l'UI selon le rôle

**Journalisation**
- [ ] Feuille JOURNAL créée et fonctionnelle
- [ ] CRUD + exports + tentatives refusées journalisés

**Communication**
- [ ] `withFailureHandler` sur tous les `google.script.run`
- [ ] Messages d'erreur génériques côté client
- [ ] Rate limiting sur fonctions lourdes ou sensibles

---
---

# PARTIE 3 — PROMPT CLAUDE (à coller dans Préférences)

```
## RÈGLES PERMANENTES — RESPONSIVE + SÉCURITÉ — FOREVER MG

### RESPONSIVE (toutes les interfaces)

MOBILE FIRST obligatoire — écrire le CSS mobile en premier.

Variables :root FOREVER MG :
- --color-primary: #2d6a4f (vert header)
- --color-accent: #e07b20 (orange boutons)
- --color-bg: #f0ebe3 (fond beige)
- --color-card: #ffffff
- --bottom-nav-h: 60px

Règles :
- <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
- CSS Grid / Flexbox — jamais de largeurs fixes en px sur les conteneurs
- KPI cards : grille 2×2 mobile → 4 colonnes desktop (grid-template-columns: 1fr 1fr → repeat(4,1fr))
- Navigation : hamburger drawer OU bottom nav fixe — PAS de menu inline grille désorganisé
- Bottom nav : position:fixed, bottom:0, height:60px, flex, visible mobile seulement
- body { padding-bottom: 60px } pour que le contenu ne passe pas sous la bottom nav
- Panier : max-height:35vh + overflow-y:auto, boutons paiement width:100% min-height:50px
- Tableaux : wrapper overflow-x:auto sur mobile
- Éléments cliquables min 44px de hauteur (tactile)
- Typographie : clamp() pour tailles fluides
- GAS : CSS inline dans <style>, sidebar max 300px, éviter position:fixed

### SÉCURITÉ (tout code avec accès données)
- GAS : Session.getActiveUser().getEmail() vérifié en début de chaque fonction exposée
- Rôles si multi-utilisateurs : ADMIN / MANAGER / OPERATEUR / LECTURE
- Filtrer les données selon le rôle côté .gs avant envoi au client
- nettoyerTexte() avec replace(/^([=+\-@])/, "'$1") — anti-Formula Injection Sheets
- textContent uniquement (jamais innerHTML) sur données dynamiques — anti-XSS
- escapeHtml() si construction HTML avec données utilisateur
- Aucun secret dans HTML/JS → PropertiesService
- IDs métier exposés (jamais l'index de ligne Sheets)
- Journaliser CRUD + exports + accès refusés dans feuille JOURNAL
- withFailureHandler sur tous les google.script.run
- Messages d'erreur génériques côté client
- Rate limiting sur fonctions lourdes via CacheService

Applique toutes ces règles automatiquement sans que je te le rappelle.
```

---

*Guide v2 — Gino · Atelier FOREVER MG*  
*Corrections appliquées : nav mobile, KPI 2×2, panier max-height, boutons paiement, bottom nav padding*  
*Compatible : Google Apps Script · GitHub Pages · HTML pur*
