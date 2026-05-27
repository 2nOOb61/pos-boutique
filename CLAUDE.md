# CLAUDE.md — Design System Universel
# Auteur : FOREVER MG / Gino
# Usage : Copier ce fichier à la racine de chaque projet.
# Claude Code le lit automatiquement avant de générer quoi que ce soit.

---

## IDENTITÉ VISUELLE — FOREVER MG

Ce design system s'applique à TOUTES les apps, quel que soit le contenu.
Objectif : style corporate épuré, professionnel, cohérent — palette FOREVER MG.

---

## STACK TECHNIQUE OBLIGATOIRE

- **Framework** : React (functional components + hooks)
- **Style** : Tailwind CSS uniquement — pas de CSS inline sauf exception justifiée
- **Icônes** : `lucide-react` EXCLUSIVEMENT — jamais d'emojis, jamais d'autres libs
- **Fonts** : `DM Sans` (Google Fonts) — clean, moderne, lisible en dashboard
- **Pas de** : MUI, Chakra, Ant Design, Bootstrap, shadcn (sauf accord explicite)

```html
<!-- Toujours inclure dans le <head> -->
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

---

## PALETTE DE COULEURS

### Couleurs principales
```
--color-primary        : #1a4a3a   /* Vert forêt foncé — sidebar, header, boutons primaires */
--color-primary-hover  : #153d30   /* Hover état primaire */
--color-primary-light  : #e8f4f0   /* Fond teinté vert très clair */
--color-secondary      : #e8834a   /* Orange FOREVER MG — actions secondaires, accents */
--color-secondary-hover: #d4723b   /* Hover état secondaire */
--color-secondary-light: #fdf0e8   /* Fond teinté orange très clair */
```

### Couleurs sémantiques
```
--color-success        : #16a34a   /* Vert — statut approuvé, positif */
--color-success-bg     : #dcfce7
--color-warning        : #d97706   /* Ambre — en attente, pending */
--color-warning-bg     : #fef3c7
--color-danger         : #dc2626   /* Rouge — déductions, rejet, alerte */
--color-danger-bg      : #fee2e2
--color-info           : #2563eb   /* Bleu — information neutre */
--color-info-bg        : #dbeafe
```

### Couleurs neutres
```
--color-bg             : #f8f7f4   /* Fond général — beige très légèrement chaud */
--color-surface        : #ffffff   /* Surface cards */
--color-border         : #e5e3df   /* Bordures — légèrement chaud */
--color-text-primary   : #1c1917   /* Texte principal */
--color-text-secondary : #78716c   /* Texte secondaire, labels */
--color-text-muted     : #a8a29e   /* Texte désactivé, placeholder */
--color-sidebar-text   : #ffffff   /* Texte sidebar */
--color-sidebar-muted  : rgba(255,255,255,0.55) /* Texte sidebar inactif */
```

---

## TYPOGRAPHIE

```
/* Hiérarchie complète — DM Sans */

Page title (h1)     : text-2xl font-semibold text-stone-900 tracking-tight
Section title (h2)  : text-lg font-semibold text-stone-800
Card title          : text-base font-semibold text-stone-800
KPI value           : text-3xl font-bold text-stone-900
KPI label           : text-xs font-medium uppercase tracking-widest text-stone-400
Table header (th)   : text-xs font-semibold uppercase tracking-wide text-stone-400
Table cell (td)     : text-sm text-stone-700
Label form          : text-sm font-medium text-stone-700
Body / description  : text-sm text-stone-500
Montant positif     : text-sm font-semibold text-stone-800
Montant négatif     : text-sm font-semibold text-red-600
```

---

## LAYOUT PRINCIPAL (Desktop + Mobile)

### Structure Desktop
```
┌─────────────────────────────────────────────┐
│  SIDEBAR (w-52, bg-[#1a4a3a], fixed, h-full) │
│  ┌──────────────────────────────────────────┐│
│  │  Logo + App Name  (pt-6 px-4)            ││
│  │  ─────────────────────                   ││
│  │  Nav Items (mt-6)                        ││
│  │  [icon] Label          ← inactif         ││
│  │  ████ [icon] Label     ← actif           ││
│  │  ...                                     ││
│  │  ─────────────────────                   ││
│  │  Compliance Status (bottom)              ││
│  │  [icon] Sign Out                         ││
│  └──────────────────────────────────────────┘│
│                                              │
│  MAIN CONTENT (ml-52, bg-[#f8f7f4])         │
│  ┌──────────────────────────────────────────┐│
│  │  TOP BAR : PageTitle + Period + User     ││
│  │  ─────────────────────────────           ││
│  │  CONTENT AREA (p-6)                      ││
│  │  [KPI Cards Row]                         ││
│  │  [Section Cards]                         ││
│  └──────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

### Structure Mobile
```
- Pas de sidebar → Bottom Navigation Bar
- bg-[#1a4a3a] pour la bottom bar
- Icônes + labels courts
- Item actif : text-[#e8834a] ou indicateur orange
- Top bar compacte : logo + titre + actions
```

---

## COMPOSANTS — RÈGLES STRICTES

### Sidebar Nav Item
```jsx
// INACTIF
<div className="flex items-center gap-3 px-4 py-2.5 rounded-lg mx-2 
                text-white/55 hover:bg-white/10 hover:text-white 
                cursor-pointer transition-all duration-150">
  <Icon className="w-4 h-4" strokeWidth={1.5} />
  <span className="text-sm font-medium">Label</span>
</div>

// ACTIF
<div className="flex items-center gap-3 px-4 py-2.5 rounded-lg mx-2 
                bg-white/15 text-white border-l-2 border-[#e8834a]
                cursor-pointer">
  <Icon className="w-4 h-4" strokeWidth={1.5} />
  <span className="text-sm font-semibold">Label</span>
</div>
```

### KPI Card
```jsx
<div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5">
  <p className="text-xs font-medium uppercase tracking-widest text-stone-400 mb-1">
    LABEL KPI
  </p>
  <p className="text-3xl font-bold text-stone-900">
    123 456 Ar
  </p>
  <p className="text-xs text-stone-400 mt-1">Sous-label ou période</p>
</div>
```

### Section Card
```jsx
<div className="bg-white rounded-xl border border-stone-200 shadow-sm">
  {/* Header */}
  <div className="flex items-center justify-between px-6 py-4 
                  border-b border-stone-100">
    <div>
      <h2 className="text-base font-semibold text-stone-800">Titre Section</h2>
      <p className="text-xs text-stone-400 mt-0.5">Sous-titre descriptif</p>
    </div>
    <button className="flex items-center gap-1.5 bg-[#1a4a3a] text-white 
                       text-sm font-medium px-3 py-1.5 rounded-lg 
                       hover:bg-[#153d30] transition-colors">
      <Plus className="w-3.5 h-3.5" strokeWidth={2} />
      Action
    </button>
  </div>
  {/* Contenu */}
  <div className="p-6">
    {/* ... */}
  </div>
</div>
```

### Table Standard
```jsx
<div className="overflow-x-auto">
  <table className="w-full">
    <thead>
      <tr className="border-b border-stone-100">
        <th className="text-left text-xs font-semibold uppercase tracking-wide 
                       text-stone-400 pb-3 px-4">
          Colonne
        </th>
      </tr>
    </thead>
    <tbody className="divide-y divide-stone-50">
      <tr className="hover:bg-stone-50 transition-colors">
        <td className="py-3.5 px-4 text-sm text-stone-700">Valeur</td>
      </tr>
    </tbody>
  </table>
</div>
```

### Badges de Statut
```jsx
// Règle : rounded-full, text-xs, font-medium, jamais de border

// Approuvé / Actif / Succès
<span className="bg-green-100 text-green-700 px-2.5 py-0.5 
                 rounded-full text-xs font-medium">
  Approuvé
</span>

// En attente / Pending
<span className="bg-amber-100 text-amber-700 px-2.5 py-0.5 
                 rounded-full text-xs font-medium">
  En attente
</span>

// Rejeté / Erreur
<span className="bg-red-100 text-red-700 px-2.5 py-0.5 
                 rounded-full text-xs font-medium">
  Rejeté
</span>

// Info / Neutre
<span className="bg-stone-100 text-stone-600 px-2.5 py-0.5 
                 rounded-full text-xs font-medium">
  Neutre
</span>

// Counter badge (ex: "1 Pending")
<span className="bg-[#e8834a] text-white px-2 py-0.5 
                 rounded-full text-xs font-semibold">
  1
</span>
```

### Boutons
```jsx
// Primaire (vert)
<button className="flex items-center gap-2 bg-[#1a4a3a] text-white 
                   text-sm font-medium px-4 py-2 rounded-lg 
                   hover:bg-[#153d30] transition-colors shadow-sm">
  <Icon className="w-4 h-4" strokeWidth={1.5} />
  Action principale
</button>

// Secondaire (orange)
<button className="flex items-center gap-2 bg-[#e8834a] text-white 
                   text-sm font-medium px-4 py-2 rounded-lg 
                   hover:bg-[#d4723b] transition-colors shadow-sm">
  Action secondaire
</button>

// Danger
<button className="flex items-center gap-2 bg-red-500 text-white 
                   text-sm font-medium px-4 py-2 rounded-lg 
                   hover:bg-red-600 transition-colors">
  Rejeter
</button>

// Ghost / Outline
<button className="flex items-center gap-2 border border-stone-200 
                   text-stone-600 text-sm font-medium px-4 py-2 
                   rounded-lg hover:bg-stone-50 transition-colors">
  Action tertiaire
</button>
```

### Champs de Formulaire
```jsx
<div className="space-y-1">
  <label className="text-sm font-medium text-stone-700">
    Label du champ
  </label>
  <input
    className="w-full px-3 py-2 text-sm bg-white border border-stone-200 
               rounded-lg text-stone-800 placeholder:text-stone-400
               focus:outline-none focus:ring-2 focus:ring-[#1a4a3a]/20 
               focus:border-[#1a4a3a] transition-colors"
    placeholder="Placeholder..."
  />
</div>
```

### État Vide (Empty State)
```jsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <div className="w-12 h-12 bg-stone-100 rounded-xl flex items-center 
                  justify-center mb-3">
    <Icon className="w-6 h-6 text-stone-400" strokeWidth={1.5} />
  </div>
  <p className="text-sm font-medium text-stone-500">Aucun enregistrement</p>
  <p className="text-xs text-stone-400 mt-0.5">
    Les données apparaîtront ici.
  </p>
</div>
```

### Modal / Dialog
```jsx
// Overlay
<div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 
                flex items-center justify-center p-4">
  {/* Panel */}
  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
    {/* Header modal */}
    <div className="flex items-center justify-between p-6 
                    border-b border-stone-100">
      <h3 className="text-base font-semibold text-stone-800">Titre Modal</h3>
      <button className="w-8 h-8 flex items-center justify-center 
                         rounded-lg hover:bg-stone-100 text-stone-400 
                         transition-colors">
        <X className="w-4 h-4" strokeWidth={1.5} />
      </button>
    </div>
    {/* Corps */}
    <div className="p-6 space-y-4">
      {/* contenu */}
    </div>
    {/* Footer */}
    <div className="flex justify-end gap-2 px-6 pb-6">
      {/* boutons */}
    </div>
  </div>
</div>
```

---

## ICÔNES — RÉFÉRENCE PAR MODULE

Utiliser UNIQUEMENT Lucide React. strokeWidth={1.5} partout.

```
Dashboard       → LayoutDashboard
Employés        → Users
Présence / DTR  → Clock
Paie            → CreditCard
Contributions   → Shield
Congés          → CalendarDays
Prêts           → Wallet
Utilisateurs    → UserCog
ESS Portal      → Monitor
Caisse / POS    → ShoppingCart
Stock           → Package
Commandes       → ClipboardList
Réservations    → BookOpen
Stats           → BarChart2
Config          → Settings
Connexion       → LogIn
Déconnexion     → LogOut
Ajouter         → Plus
Modifier        → Pencil
Supprimer       → Trash2
Recherche       → Search
Filtre          → Filter
Export          → Download
Imprimer        → Printer
Valider         → Check
Rejeter         → X
Alerte          → AlertTriangle
Info            → Info
Succès          → CheckCircle2
Refresh         → RefreshCw
Flèche retour   → ArrowLeft
```

---

## MONTANTS EN ARIARY

```jsx
// Formater tous les montants en Ariary malgache
const formatMGA = (amount) => {
  return new Intl.NumberFormat('fr-MG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' Ar';
};

// Montant positif/neutre
<span className="text-sm font-semibold text-stone-800">
  {formatMGA(125000)}  {/* → 125 000 Ar */}
</span>

// Montant négatif / déduction
<span className="text-sm font-semibold text-red-600">
  -{formatMGA(3441)}
</span>

// Grand montant KPI
<p className="text-3xl font-bold text-stone-900">
  {formatMGA(1250000)}
</p>
```

---

## RÈGLES ABSOLUES — NE JAMAIS VIOLER

1. **Icônes** : Lucide React uniquement, strokeWidth={1.5}, jamais d'emojis dans l'UI
2. **Couleurs** : Rester dans la palette définie, pas de couleurs arbitraires
3. **Sidebar active** : Toujours indiquer l'item actif avec `border-l-2 border-[#e8834a]`
4. **Montants négatifs** : Toujours en `text-red-600`, jamais en noir
5. **Arrondis** : cards `rounded-xl`, boutons `rounded-lg`, badges `rounded-full`
6. **Ombres** : `shadow-sm` sur les cards, `shadow-md` sur les modals, jamais plus
7. **Espacement** : padding cards `p-5` ou `p-6`, gap entre sections `space-y-6`
8. **États vides** : Toujours afficher un empty state avec icône + message
9. **Responsive** : Desktop = sidebar latérale, Mobile = bottom navigation
10. **Langue** : Interface en français, labels en français

---

## EXEMPLE TOP BAR

```jsx
<div className="flex items-center justify-between px-6 py-4 
                bg-white border-b border-stone-200">
  {/* Gauche : Titre + Période */}
  <div className="flex items-center gap-3">
    <h1 className="text-xl font-semibold text-stone-900">
      Nom du Module
    </h1>
    <span className="text-xs font-medium bg-stone-100 text-stone-500 
                     px-2.5 py-1 rounded-full">
      Mai 2026
    </span>
  </div>
  {/* Droite : User info */}
  <div className="flex items-center gap-2">
    <div className="text-right">
      <p className="text-sm font-semibold text-stone-800">Admin</p>
      <p className="text-xs text-stone-400">Super Admin</p>
    </div>
    <div className="w-8 h-8 bg-[#1a4a3a] rounded-full flex items-center 
                    justify-center text-white text-sm font-semibold">
      A
    </div>
  </div>
</div>
```

---

## NOTE FINALE POUR CLAUDE

Chaque fois que tu génères une interface dans ce projet :
- Lis ce fichier en premier
- Applique le design system sans exception
- Ne propose pas d'autres polices, couleurs ou librairies
- Si un composant n'est pas listé ici, créé-le dans l'esprit de ce système
- Le style est : **corporate épuré, professionnel, chaleureux grâce au vert et à l'orange FOREVER MG**
