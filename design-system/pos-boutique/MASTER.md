# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Pos Boutique
**Generated:** 2026-05-22 10:59:09
**Category:** E-commerce Luxury

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable (projet) |
|------|-----|-----------------------|
| Primary | `#073D37` | `--accent` — Vert forêt profond |
| Secondary | `#ED6F2C` | `--accent2` — Orange chaud |
| CTA/Accent | `#ED6F2C` | `--accent2` — Orange chaud |
| Background | `#E4DDD2` | `--bg` — Beige chaud |
| Surface | `#FFFFFF` | `--surface` — Blanc |
| Surface 2 | `#F3EEE7` | `--surface2` — Beige clair |
| Surface 3 | `#D6CEC2` | `--surface3` — Beige moyen |
| Text | `#1A1A1A` | `--text` — Presque noir |
| Muted | `#666666` | `--muted` — Gris moyen |
| Border | `#D6CEC2` | `--border` — Beige moyen |
| Error/Red | `#C9492D` | `--red` — Rouge terre |

**Color Notes:** Vert forêt + Orange artisan + Beige naturel — palette handcraft premium

### Typography

- **Heading Font:** Montserrat (déjà utilisé dans le projet)
- **Body Font:** DM Sans (déjà utilisé dans le projet)
- **Logo/Brand Font:** Syne (déjà utilisé)
- **Mood:** modern handcraft, premium artisan, élégant, clean
- **Weights utilisés:** 300, 400, 500, 600, 700, 800

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&family=DM+Sans:wght@300;400;500;600;700&family=Syne:wght@700;800&display=swap');
```

### Spacing Variables

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(7,61,55,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(7,61,55,0.08)` | Cards, boutons |
| `--shadow-lg` | `0 10px 24px rgba(7,61,55,0.12)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 40px rgba(7,61,55,0.15)` | Hero, cartes en avant |

**Note:** Ombres teintées vert forêt pour cohérence avec la palette.

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #073D37;
  color: #FFFFFF;
  padding: 12px 24px;
  border-radius: 12px;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(7,61,55,0.30);
}

/* CTA / Action Button */
.btn-cta {
  background: #ED6F2C;
  color: #FFFFFF;
  padding: 12px 24px;
  border-radius: 12px;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-cta:hover {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(237,111,44,0.35);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #073D37;
  border: 2px solid #073D37;
  padding: 12px 24px;
  border-radius: 12px;
  font-family: 'Montserrat', sans-serif;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-secondary:hover {
  background: #073D37;
  color: #FFFFFF;
}
```

### Cards

```css
.card {
  background: #FFFFFF;
  border: 1px solid #D6CEC2;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 6px rgba(7,61,55,0.08);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: 0 10px 24px rgba(7,61,55,0.12);
  transform: translateY(-2px);
  border-color: #073D37;
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  background: #F3EEE7;
  border: 1px solid #D6CEC2;
  border-radius: 12px;
  font-size: 15px;
  font-family: 'DM Sans', sans-serif;
  color: #1A1A1A;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #073D37;
  outline: none;
  box-shadow: 0 0 0 3px rgba(7,61,55,0.12);
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Liquid Glass

**Keywords:** Flowing glass, morphing, smooth transitions, fluid effects, translucent, animated blur, iridescent, chromatic aberration

**Best For:** Premium SaaS, high-end e-commerce, creative platforms, branding experiences, luxury portfolios

**Key Effects:** Morphing elements (SVG/CSS), fluid animations (400-600ms curves), dynamic blur (backdrop-filter), color transitions

### Page Pattern

**Pattern Name:** Feature-Rich Showcase

- **CTA Placement:** Above fold
- **Section Order:** Hero > Features > CTA

---

## Anti-Patterns (Do NOT Use)

- ❌ Vibrant & Block-based
- ❌ Playful colors

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
