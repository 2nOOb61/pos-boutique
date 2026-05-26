# FOREVER MG — Style Guide & Design System
> Copiez ce contenu dans Claude pour appliquer le même design sur toutes vos apps.

---

## IDENTITÉ VISUELLE

**Marque :** FOREVER MG  
**Style :** Handcraft Premium · Liquid Glass · Earth Tones  
**Ambiance :** Artisanal, chaud, élégant, professionnel

---

## PALETTE DE COULEURS

### Couleurs principales
| Rôle | Nom | Hex | Usage |
|------|-----|-----|-------|
| Primary | Vert forêt | `#073D37` | Boutons principaux, header, accents |
| Secondary | Orange artisan | `#ED6F2C` | CTA, badges actifs, highlights |
| Background | Beige chaud | `#E4DDD2` | Fond de l'app |
| Surface | Blanc | `#FFFFFF` | Cards, modals, panneaux |
| Surface 2 | Beige clair | `#F3EEE7` | Inputs, fonds secondaires, hover |
| Surface 3 | Beige moyen | `#D6CEC2` | Bordures, dividers |

### Couleurs sémantiques
| Rôle | Hex | Usage |
|------|-----|-------|
| Texte principal | `#1A1A1A` | Corps de texte |
| Texte secondaire | `#666666` | Labels, sous-titres, muted |
| Bordure | `#D6CEC2` | Contours de cards, inputs |
| Succès / Vert | `#073D37` | Badges OK, toasts succès |
| Erreur / Rouge | `#C9492D` | Erreurs, suppressions, alertes |
| Alerte / Orange | `#ED6F2C` | Stock faible, avertissements |

### Variantes d'opacité (pour ombres & tints)
```
Vert forêt   : rgba(7, 61, 55, 0.03 / 0.05 / 0.08 / 0.10 / 0.12 / 0.15 / 0.20 / 0.25 / 0.30)
Orange artisan: rgba(237, 111, 44, 0.07 / 0.10 / 0.12 / 0.15 / 0.35 / 0.40)
Rouge erreur  : rgba(201, 73, 45, 0.10 / 0.12 / 0.15)
```

### Variables CSS complètes
```css
:root {
  /* Fonds */
  --bg:       #E4DDD2;
  --surface:  #FFFFFF;
  --surface2: #F3EEE7;
  --surface3: #D6CEC2;

  /* Couleurs */
  --accent:   #073D37;   /* Vert forêt — primary */
  --accent2:  #ED6F2C;   /* Orange artisan — CTA */
  --accent3:  #073D37;   /* Alias accent */

  /* Texte */
  --text:   #1A1A1A;
  --muted:  #666666;

  /* UI */
  --border: #D6CEC2;
  --shadow: 0 8px 24px rgba(7, 61, 55, 0.08);

  /* Sémantiques */
  --green:  #073D37;
  --red:    #C9492D;
  --yellow: #ED6F2C;

  /* Liquid Glass */
  --glass-bg:     rgba(255, 255, 255, 0.72);
  --glass-border: rgba(7, 61, 55, 0.12);
  --glass-shadow: 0 8px 32px rgba(7, 61, 55, 0.10), 0 1px 0 rgba(255, 255, 255, 0.6) inset;

  /* Transitions */
  --transition-sm: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-md: all 250ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-lg: all 400ms cubic-bezier(0.4, 0, 0.2, 1);

  /* Rayons */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --radius-xl: 24px;

  /* Espacements */
  --space-xs:  4px;
  --space-sm:  8px;
  --space-md:  16px;
  --space-lg:  24px;
  --space-xl:  32px;
  --space-2xl: 48px;
  --space-3xl: 64px;
}
```

---

## TYPOGRAPHIE

### Polices Google Fonts
```html
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap" rel="stylesheet">
```

### Hiérarchie
| Rôle | Police | Poids | Taille |
|------|--------|-------|--------|
| Logo / Brand | Montserrat | 700–800 | 18–28px |
| Titres H1–H3 | Montserrat | 600–800 | 20–36px |
| Titres sections | Syne | 700–800 | 15–20px |
| Boutons principaux | Montserrat | 700 | 13–16px |
| Corps de texte | DM Sans | 400–500 | 14–16px |
| Labels | DM Sans | 500–600 | 11–13px |
| Chiffres / Mono | DM Mono | 400–500 | 12–18px |

### Règles typographiques
- **Line-height corps :** 1.6
- **Line-height titres :** 1.2–1.3
- **Taille minimum mobile :** 16px (inputs) pour éviter le zoom iOS
- **Longueur de ligne max :** 68 caractères (`max-width: 68ch`)
- **Letter-spacing labels :** 0.5px (uppercase)

---

## STYLE LIQUID GLASS

### Principe
Effet verre fluide sur fond beige chaud — translucidité subtile, ombres teintées vert, transitions douces.

### Cards / Panneaux
```css
.card {
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(7, 61, 55, 0.12);
  border-radius: 16px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 8px 32px rgba(7, 61, 55, 0.10),
              0 1px 0 rgba(255, 255, 255, 0.6) inset;
  transition: all 250ms cubic-bezier(0.4, 0, 0.2, 1);
}

.card:hover {
  transform: translateY(-3px);
  border-color: rgba(7, 61, 55, 0.25);
  box-shadow: 0 16px 40px rgba(7, 61, 55, 0.14),
              0 1px 0 rgba(255, 255, 255, 0.7) inset;
}
```

### Modals
```css
.modal {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(7, 61, 55, 0.12);
  border-radius: 24px;
  box-shadow: 0 32px 80px rgba(7, 61, 55, 0.15),
              0 1px 0 rgba(255, 255, 255, 0.8) inset;
}

.modal-overlay {
  background: rgba(7, 61, 55, 0.45);
  backdrop-filter: blur(6px);
}
```

---

## COMPOSANTS

### Bouton Principal (Vert)
```css
.btn-primary {
  background: #073D37;
  color: #FFFFFF;
  border: none;
  border-radius: 12px;
  padding: 13px 24px;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  transition: all 200ms ease;
  position: relative;
  overflow: hidden;
}
.btn-primary::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255,255,255,0.10) 0%, transparent 100%);
  pointer-events: none;
}
.btn-primary:hover {
  background: #0E5A51;
  box-shadow: 0 8px 22px rgba(7, 61, 55, 0.25);
  transform: translateY(-1px);
}
.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  pointer-events: none;
}
```

### Bouton CTA (Orange)
```css
.btn-cta {
  background: #ED6F2C;
  color: #FFFFFF;
  border: none;
  border-radius: 12px;
  padding: 13px 24px;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  cursor: pointer;
  transition: all 200ms ease;
}
.btn-cta:hover {
  background: #F47B38;
  box-shadow: 0 8px 22px rgba(237, 111, 44, 0.35);
  transform: translateY(-1px);
}
```

### Bouton Secondaire (Outline)
```css
.btn-secondary {
  background: #F3EEE7;
  color: #1A1A1A;
  border: 1px solid #D6CEC2;
  border-radius: 12px;
  padding: 13px 20px;
  font-weight: 600;
  cursor: pointer;
  transition: all 200ms ease;
}
.btn-secondary:hover {
  border-color: #073D37;
  color: #073D37;
}
```

### Input / Select
```css
input, select, textarea {
  background: #F3EEE7;
  border: 1px solid #D6CEC2;
  border-radius: 12px;
  padding: 12px 16px;
  font-family: 'DM Sans', sans-serif;
  font-size: 15px;
  color: #1A1A1A;
  transition: all 200ms ease;
  outline: none;
}
input:focus, select:focus, textarea:focus {
  border-color: #073D37;
  box-shadow: 0 0 0 3px rgba(7, 61, 55, 0.12);
}
input.error {
  border-color: #C9492D;
  box-shadow: 0 0 0 3px rgba(201, 73, 45, 0.15);
}
/* Mobile: empêcher le zoom iOS */
@media (max-width: 768px) {
  input, select, textarea { font-size: 16px !important; }
}
```

### Badge / Tag
```css
.badge-success { background: rgba(7, 61, 55, 0.10);   color: #073D37; border-radius: 20px; padding: 3px 10px; font-size: 11px; font-weight: 600; }
.badge-warning { background: rgba(237, 111, 44, 0.12); color: #ED6F2C; border-radius: 20px; padding: 3px 10px; font-size: 11px; font-weight: 600; }
.badge-danger  { background: rgba(201, 73, 45, 0.10);  color: #C9492D; border-radius: 20px; padding: 3px 10px; font-size: 11px; font-weight: 600; }
```

### Header / Topbar
```css
.topbar {
  background: #073D37;
  color: #FFFFFF;
  height: 64px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}
/* Boutons nav sur header vert */
.nav-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.82);
  border-radius: 12px;
  padding: 10px 18px;
  font-family: 'Montserrat', sans-serif;
  font-weight: 500;
  transition: all 150ms ease;
}
.nav-btn:hover  { background: rgba(255, 255, 255, 0.08); color: #FFFFFF; }
.nav-btn.active { background: rgba(237, 111, 44, 0.16);  color: #FFFFFF; }
```

### Table
```css
table { width: 100%; border-collapse: collapse; }
th {
  background: #F3EEE7;
  color: #666666;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 14px 16px;
  border-bottom: 1px solid #D6CEC2;
}
td { padding: 13px 16px; font-size: 14px; border-bottom: 1px solid #D6CEC2; }
tr:hover td { background: rgba(7, 61, 55, 0.03); }
```

### Toast / Notification
```css
.toast {
  background: #FFFFFF;
  border-radius: 14px;
  padding: 12px 18px;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
.toast-success { border: 1.5px solid #073D37; color: #073D37; }
.toast-error   { border: 1.5px solid #C9492D; color: #C9492D; }
.toast-info    { border: 1.5px solid #ED6F2C; color: #ED6F2C; }
```

### Skeleton Loader
```css
.skeleton {
  background: linear-gradient(90deg, #F3EEE7 25%, #E4DDD2 50%, #F3EEE7 75%);
  background-size: 200% 100%;
  animation: skeleton-pulse 1.4s ease-in-out infinite;
  border-radius: 10px;
  color: transparent !important;
}
@keyframes skeleton-pulse {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

---

## OMBRES

```css
--shadow-sm: 0 1px 2px rgba(7, 61, 55, 0.05);
--shadow-md: 0 4px 6px rgba(7, 61, 55, 0.08);
--shadow-lg: 0 10px 24px rgba(7, 61, 55, 0.12);
--shadow-xl: 0 20px 40px rgba(7, 61, 55, 0.15);
```

---

## BONNES PRATIQUES UX

```css
/* Respect de la préférence de mouvement */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

/* Focus clavier visible */
:focus-visible {
  outline: 2px solid #073D37;
  outline-offset: 3px;
  border-radius: 4px;
}
:focus:not(:focus-visible) { outline: none; }

/* Touch targets min 44×44px */
@media (max-width: 768px) {
  button { min-height: 44px; min-width: 44px; }
}

/* Pas de scroll horizontal */
html, body { overflow-x: hidden; }

/* Bouton désactivé */
button:disabled { opacity: 0.55; cursor: not-allowed; pointer-events: none; }
```

---

## STRUCTURE DE PAGE TYPE

```
┌─────────────────────────────────────────┐
│  TOPBAR (#073D37) — Logo + Nav + User   │  h: 64px, sticky
├─────────────────────────────────────────┤
│                                         │
│  CONTENU (#E4DDD2 background)           │  padding: 24px
│  ┌───────────────┐  ┌───────────────┐  │
│  │  Card Glass   │  │  Card Glass   │  │  bg: rgba(255,255,255,0.72)
│  │  #FFFFFF/72%  │  │  #FFFFFF/72%  │  │  border: rgba(7,61,55,0.12)
│  └───────────────┘  └───────────────┘  │  blur(8px)
│                                         │
├─────────────────────────────────────────┤
│  BOTTOM NAV (#073D37) — mobile only     │  h: 52px+safe-area
└─────────────────────────────────────────┘
```

---

## PROMPT CLAUDE — DESIGN COHÉRENT

Copiez ce prompt dans Claude pour un nouveau projet :

```
Utilise le design system FOREVER MG pour cette app :

COULEURS :
- Primary (boutons, header) : #073D37 (vert forêt)
- CTA / Accent (highlights, badges actifs) : #ED6F2C (orange artisan)
- Background : #E4DDD2 (beige chaud)
- Surface / Cards : #FFFFFF
- Surface secondaire / Inputs : #F3EEE7 (beige clair)
- Bordures : #D6CEC2
- Texte : #1A1A1A
- Texte secondaire : #666666
- Erreur : #C9492D

STYLE :
- Liquid Glass : backdrop-filter blur(8px) sur les cards
- Ombres teintées vert : rgba(7,61,55,0.08–0.15)
- Transitions cubic-bezier(0.4,0,0.2,1) à 150–400ms
- Border-radius : 8px (sm) / 12px (md) / 18px (lg) / 24px (xl)
- Header sticky vert forêt avec nav transparente

TYPOGRAPHIE (Google Fonts) :
- Titres / Boutons : Montserrat 600–800
- Corps : DM Sans 400–500
- Brand / Logo : Syne 700–800
- Monospace / Chiffres : DM Mono 400–500
- Line-height : 1.6 pour le corps

UX :
- prefers-reduced-motion respecté
- focus-visible outline 2px #073D37
- Touch targets ≥44×44px mobile
- font-size 16px mobile (anti-zoom iOS)
- Boutons disabled : opacity 0.55 + pointer-events none
```
