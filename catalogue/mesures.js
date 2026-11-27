/**
 * mesures.js — Extraction des MESURES depuis le texte libre du POS.
 *
 * Le POS ne stocke aucune dimension structuree : tout est ecrit a la main dans
 * le nom de l'article, le champ `perso` de la ligne, ou les notes de commande
 * (« Dimension 240x30cm », « 1m50*90cm », « 20 cm de hauteur », « A6 »...).
 * Ce module ramene ce texte a des mesures normalisees en CENTIMETRES.
 *
 * Aucune dependance : utilisable en Node (generateur) comme dans app.js.
 */

/* ---------- normalisation texte ---------- */

function sansAccents(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normTexte(s) {
  return sansAccents(s)
    .toLowerCase()
    .replace(/[×✕]/g, 'x')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------- conversion d'une valeur + unite en cm ---------- */

const EN_CM = { mm: 0.1, cm: 1, m: 100 };

function versCm(valeur, unite) {
  const u = EN_CM[unite];
  return u ? valeur * u : null;
}

function nombre(txt) {
  // « 10.5 », « 14,8 », « 1..50 » (coquille reelle du POS)
  const n = parseFloat(String(txt).replace(/\.\./g, '.').replace(',', '.'));
  return isFinite(n) ? n : null;
}

/**
 * « 1m50 » = 150 cm, « 1m30 » = 130 cm — ecriture francaise courante dans les
 * commandes. A ne pas confondre avec « 1m » (100 cm) ni « 1.50m ».
 */
const RE_M_CM = /(\d+)\s*m\s*(\d{2})(?![\d.,])/i;

function litMetreCm(txt) {
  const m = RE_M_CM.exec(txt);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(m[2]);
}

/* ---------- gardes-fous : ce qui N'EST PAS une mesure ---------- */

// « Carte de Visite 50x8pcs », « A6 x 45 » : des QUANTITES, pas des dimensions.
const RE_QTE_APRES = /^\s*(?:pcs?|pces?|pieces?|ex|exemplaires?|pages?|unites?|cartes?|pers)\b/i;
// « format A6 x 45 » : un format papier suivi d'un nombre = un tirage.
const RE_FORMAT_AVANT = /\b(?:a[0-9]|format)\s*$/i;

/* ---------- extraction des dimensions ---------- */

/**
 * Trouve les groupes « a x b [x c] » avec unites eventuelles sur chaque terme
 * ou une seule fois a la fin. Renvoie des objets
 * { dims:[cm...], unite:'cm'|'m'|'mm'|null, brut:'...' }.
 */
function extraireGroupes(texteNorm) {
  const NB = '\\d+(?:[.,]\\d+)?(?:\\.\\.\\d+)?';
  // L'unite ne doit pas etre la premiere lettre du mot suivant : sans ce
  // garde-fou, « atao 10x12cm mitsangana » prenait le « m » de « mitsangana »
  // pour l'unite du groupe et lisait 1000 x 12. Seul le « x » du separateur
  // est tolere derriere (« 83cmx189cm »).
  const U = '(?:mm|cm|m)(?![a-wyz])';
  const re = new RegExp(
    '(' + NB + ')\\s*(' + U + ')?\\s*[x*]\\s*' +
    '(' + NB + ')\\s*(' + U + ')?' +
    '(?:\\s*[x*]\\s*(' + NB + ')\\s*(' + U + ')?)?' +
    '\\s*(' + U + ')?',
    'gi'
  );
  const out = [];
  let m;
  while ((m = re.exec(texteNorm)) !== null) {
    const apres = texteNorm.slice(re.lastIndex);
    const avant = texteNorm.slice(0, m.index);
    if (RE_QTE_APRES.test(apres)) continue;      // « 50x8pcs »
    if (RE_FORMAT_AVANT.test(avant)) continue;   // « format A6 x 45 »

    const vals = [nombre(m[1]), nombre(m[3]), m[5] != null ? nombre(m[5]) : null];
    const unites = [m[2], m[4], m[6]];
    const uniteFin = m[7] || null;

    // Unite de repli : la derniere unite ecrite dans le groupe, sinon le cm.
    // « 83cmx189cm » -> cm/cm ; « 8.3*0.95m » -> m pour les deux ;
    // « Ecriteau 110x110 » -> cm par defaut (usage constate en boutique).
    const uniteGroupe = uniteFin || unites.filter(Boolean).pop() || null;
    const dims = [];
    for (let i = 0; i < 3; i++) {
      if (vals[i] == null) continue;
      let u = unites[i] || uniteGroupe || 'cm';
      // Un « m » emprunte a un AUTRE terme ne s'applique pas a un nombre deja
      // grand : « 85*2m4 », c'est 85 cm par 2,4 m, pas 85 metres. Personne ne
      // commande une piece de plus de 50 m.
      if (!unites[i] && u === 'm' && vals[i] >= 50) u = 'cm';
      const cm = versCm(vals[i], u);
      if (cm == null) continue;
      dims.push(Math.round(cm * 10) / 10);
    }
    if (dims.length < 2) continue;
    out.push({ dims: dims.slice(0, 3), unite: uniteGroupe, brut: m[0].trim() });
  }
  return out;
}

/** « 1m50*90cm » : le premier terme se lit en m+cm, pas en « 1 x 50 ». */
function corrigeMetreCm(groupe) {
  const mc = litMetreCm(groupe.brut);
  if (mc == null) return groupe;
  const reste = groupe.brut.replace(RE_M_CM, ' ').match(/(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?/);
  if (!reste) return groupe;
  const v = nombre(reste[1]);
  if (v == null) return groupe;
  const cm2 = versCm(v, reste[2] || 'cm');
  if (cm2 == null) return groupe;
  return { dims: [mc, Math.round(cm2 * 10) / 10], unite: 'mixte', brut: groupe.brut };
}

/* ---------- mesures isolees ---------- */

const RE_DIAM = /(?:diam(?:etre)?\s*:?\s*)?(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*(?:de\s+)?diam(?:etre|\.)?|(?:ø)\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?/i;
const RE_HAUT = /(?:hauteur\s*(?:totale?)?\s*:?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?)|(?:(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*\(?\s*(?:de\s+)?hauteur)/i;
const RE_LARG = /(?:largeur\s*:?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?)|(?:(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*\(?\s*(?:de\s+)?largeur)/i;
const RE_LONG = /(?:longueur\s*:?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?)|(?:(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*\(?\s*(?:de\s+)?longueur)/i;
const RE_EPAIS = /(\d+(?:[.,]\d+)?)\s*mm\b/i;              // plexi 3mm, bois 10mm
const RE_SURF = /(\d+(?:[.,]\d+)?)\s*m\s*(?:2|²)\b/i; // etiquettes « 1m2 »
const RE_FORMAT = /\b(a[0-6])\b/i;                         // A4, A5, A6...
const RE_GRAMM = /(\d{2,3})\s*(?:grs?|gr|g)\b/i;           // 300g, 180grs
const RE_TAILLE = /\btaille\s*:?\s*(xxl|xl|xs|[sml])\b/i;

function litPaire(re, texte) {
  const m = re.exec(texte);
  if (!m) return null;
  for (let i = 1; i < m.length; i += 2) {
    if (m[i] != null) {
      const v = nombre(m[i]);
      if (v == null) continue;
      const cm = versCm(v, m[i + 1] || 'cm');
      if (cm != null) return Math.round(cm * 10) / 10;
    }
  }
  return null;
}

/* ---------- API publique ---------- */

/**
 * extraireMesures(texte) -> objet mesure, ou null si rien de lisible.
 * {
 *   dims:[L,l,(H)] en cm, type:'2D'|'3D',
 *   surfaceCm2, surfaceM2,            // seulement si 2D
 *   diametre, hauteur, largeur, longueur, epaisseurMm,
 *   surfaceDeclareeM2,                // « 1m2 » ecrit tel quel
 *   format:'A4', grammage:300, taille:'L',
 *   libelle:'240 x 30 cm'             // forme lisible, prete a afficher
 * }
 */
function extraireMesures(texte) {
  const t = normTexte(texte);
  if (!t) return null;

  const res = {};

  const mFmt0 = RE_FORMAT.exec(t);

  // Texte de travail pour les DIMENSIONS uniquement :
  //  - « 1m50 » / « 1m30 » deviennent « 150cm » / « 130cm » AVANT la recherche
  //    de groupes, sinon le moteur part de « 50*90 » et perd le metre ;
  //  - un format papier (« A6 x 45 ») est retire : ce « 45 » est un tirage,
  //    pas une largeur, et « a6 » ferait lire un « 6 » en premiere dimension.
  const tDim = t
    .replace(/(\d+)\s*m\s*(\d{2})(?![\d.,])/g, (s, a, b) => (Number(a) * 100 + Number(b)) + 'cm')
    .replace(/\ba[0-6]\b/g, ' ');

  const groupes = extraireGroupes(tDim).map(corrigeMetreCm);
  if (groupes.length) {
    // Plusieurs groupes (« superficie 5*3M - LOGO 256*200CM ») : on garde le
    // PREMIER, qui decrit l'article ; les autres partent dans `autresDims`.
    const g = groupes[0];
    res.dims = g.dims;
    res.type = g.dims.length === 3 ? '3D' : '2D';
    if (groupes.length > 1) res.autresDims = groupes.slice(1).map(x => x.dims);
    if (res.type === '2D') {
      res.surfaceCm2 = Math.round(g.dims[0] * g.dims[1] * 10) / 10;
      res.surfaceM2 = Math.round((res.surfaceCm2 / 10000) * 10000) / 10000;
    }
  }

  const diam = litPaire(RE_DIAM, t);
  if (diam != null) res.diametre = diam;
  const haut = litPaire(RE_HAUT, t);
  if (haut != null) res.hauteur = haut;
  const larg = litPaire(RE_LARG, t);
  if (larg != null) res.largeur = larg;
  const long = litPaire(RE_LONG, t);
  if (long != null) res.longueur = long;

  // Epaisseur : un « mm » isole, hors groupe de dimensions deja capte.
  const mEp = RE_EPAIS.exec(t);
  if (mEp && !(res.dims && new RegExp('[x*]\\s*' + mEp[1]).test(t))) {
    const v = nombre(mEp[1]);
    if (v != null && v <= 60) res.epaisseurMm = v;
  }

  const mSurf = RE_SURF.exec(t);
  if (mSurf) res.surfaceDeclareeM2 = nombre(mSurf[1]);
  if (mFmt0) res.format = mFmt0[1].toUpperCase();

  // Cote unique (« Trophee 18cm », « Urne en bois + plexi 20cm », « Montre 40cm ») :
  // tres frequent en boutique, c'est LA mesure de l'article. On ne la lit que si
  // rien de plus precis n'a ete trouve, et jamais sur un « mm » (= epaisseur).
  if (!res.dims && res.diametre == null && res.hauteur == null &&
      res.largeur == null && res.longueur == null) {
    const mS = /(?:^|[^a-z0-9.,])(\d+(?:[.,]\d+)?)\s*(cm|m)(?![a-z0-9])/i.exec(t);
    if (mS) {
      const cm = versCm(nombre(mS[1]), mS[2]);
      if (cm != null && cm > 0 && cm <= 2000) res.coteCm = Math.round(cm * 10) / 10;
    }
  }
  const mGr = RE_GRAMM.exec(t);
  if (mGr) {
    const g = Number(mGr[1]);
    if (g >= 60 && g <= 400) res.grammage = g;  // hors de cette plage ce n'est pas du papier
  }
  const mT = RE_TAILLE.exec(t);
  if (mT) res.taille = mT[1].toUpperCase();

  if (!Object.keys(res).length) return null;
  res.libelle = libelleMesure(res);
  return res;
}

function fmtNb(n) {
  return Number(n) % 1 === 0 ? String(Number(n)) : String(Number(n)).replace('.', ',');
}

/** Forme lisible d'une mesure, pour l'affichage catalogue. */
function libelleMesure(m) {
  if (!m) return '';
  const bouts = [];
  if (m.dims) bouts.push(m.dims.map(fmtNb).join(' × ') + ' cm');
  if (m.diametre != null) bouts.push('Ø ' + fmtNb(m.diametre) + ' cm');
  if (!m.dims) {
    if (m.longueur != null) bouts.push('L ' + fmtNb(m.longueur) + ' cm');
    if (m.largeur != null) bouts.push('l ' + fmtNb(m.largeur) + ' cm');
  }
  if (m.hauteur != null) bouts.push('h ' + fmtNb(m.hauteur) + ' cm');
  if (m.coteCm != null) bouts.push(fmtNb(m.coteCm) + ' cm');
  if (m.surfaceDeclareeM2 != null) bouts.push(fmtNb(m.surfaceDeclareeM2) + ' m²');
  if (m.epaisseurMm != null) bouts.push('ép. ' + fmtNb(m.epaisseurMm) + ' mm');
  if (m.format) bouts.push(m.format);
  if (m.grammage) bouts.push(m.grammage + ' g');
  if (m.taille) bouts.push('taille ' + m.taille);
  return bouts.join(' · ');
}

/** Une mesure dimensionnelle est-elle presente (dims, diametre, h, surface) ? */
function aMesureUtile(m) {
  return !!(m && (m.dims || m.diametre != null || m.hauteur != null ||
                  m.coteCm != null || m.surfaceDeclareeM2 != null || m.format));
}

if (typeof module !== 'undefined') {
  module.exports = { normTexte, sansAccents, extraireMesures, libelleMesure, aMesureUtile, fmtNb };
}
