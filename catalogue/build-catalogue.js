#!/usr/bin/env node
/**
 * build-catalogue.js — Catalogue de PRIX et de MESURES reconstitue a partir des
 * donnees reelles du POS FOREVER MG.
 *
 * Pourquoi : ni la feuille Produits (24 fiches) ni les Commandes ne portent de
 * tarif structure. Le prix pratique vit dans les 2 900 lignes d'articles des
 * ventes et des commandes, et les dimensions dans le texte libre. Ce script
 * rassemble les deux et en sort un catalogue consultable.
 *
 * Usage :
 *   node catalogue/build-catalogue.js            # telecharge depuis l'API GAS
 *   node catalogue/build-catalogue.js --cache    # reutilise catalogue/.cache
 *
 * Sorties (dossier catalogue/) :
 *   catalogue.json          donnees completes (familles, modeles, mesures, prix)
 *   catalogue-articles.csv  une ligne par modele d'article
 *   catalogue-mesures.csv   une ligne par mesure observee avec son prix
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { extraireMesures, libelleMesure, aMesureUtile, normTexte } = require('./mesures.js');
const { FAMILLES, FAMILLE_AUTRE, familleDe, matieresDe, optionsDe, modeleDe, cle,
        MATIERES, OPTIONS } = require('./familles.js');

const API = 'https://script.google.com/macros/s/AKfycbx94vamSaYqKyD3CNbdvy3Ue7wl4DJkANdRWBmkt483NKzp1Wk1aEkTazS_Dtc8YekIug/exec';
const DIR = __dirname;
const CACHE = path.join(DIR, '.cache');
const UTILISE_CACHE = process.argv.includes('--cache');

/* ------------------------------------------------------------------ */
/* Lecture des sources                                                 */
/* ------------------------------------------------------------------ */

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpJson(res.headers.location).then(resolve, reject);
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', d => { buf += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error('Reponse illisible (' + buf.slice(0, 200) + ')')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(300000, () => req.destroy(new Error('timeout API')));
  });
}

async function source(action, params) {
  const fichier = path.join(CACHE, action + '.json');
  if (UTILISE_CACHE && fs.existsSync(fichier)) {
    return JSON.parse(fs.readFileSync(fichier, 'utf8'));
  }
  const url = API + '?action=' + action + (params ? '&' + params : '');
  process.stdout.write('  ' + action + ' ... ');
  const data = await httpJson(url);
  if (!data || data.ok === false) throw new Error(action + ' : ' + (data && data.error));
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(fichier, JSON.stringify(data));
  console.log('ok');
  return data;
}

/* ------------------------------------------------------------------ */
/* Outils                                                             */
/* ------------------------------------------------------------------ */

// Lignes de test laissees dans le classeur : a exclure de tout comptage.
const RE_TEST = /^(?:test\d*|testhist|essai\d*|aaa+|xxx+)$/i;

function estTest(nom) {
  return RE_TEST.test(String(nom || '').trim());
}

/** Date d'une ligne, ramenee a « yyyy-mm-dd » quelle que soit la source. */
function dateIso(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);          // ventes : « 27/11/2026 »
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

function mediane(arr) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : Math.round((a[i - 1] + a[i]) / 2);
}

function quantile(arr, q) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const bas = Math.floor(pos);
  const haut = Math.ceil(pos);
  if (bas === haut) return a[bas];
  return Math.round(a[bas] + (a[haut] - a[bas]) * (pos - bas));
}

/** Prix le plus souvent pratique, et sa part dans les observations. */
function modePrix(prix) {
  const freq = new Map();
  prix.forEach(p => freq.set(p, (freq.get(p) || 0) + 1));
  let best = null, n = 0;
  for (const [p, c] of freq) {
    if (c > n || (c === n && best != null && p > best)) { best = p; n = c; }
  }
  return { valeur: best, occurrences: n, part: prix.length ? n / prix.length : 0 };
}

function statsPrix(prix) {
  if (!prix.length) return null;
  const mode = modePrix(prix);
  const med = mediane(prix);
  return {
    n: prix.length,
    min: Math.min.apply(null, prix),
    q1: quantile(prix, 0.25),
    median: med,
    q3: quantile(prix, 0.75),
    max: Math.max.apply(null, prix),
    moyenne: Math.round(prix.reduce((a, b) => a + b, 0) / prix.length),
    modeValeur: mode.valeur,
    modeOccurrences: mode.occurrences,
    modePart: Math.round(mode.part * 100) / 100,
    // Prix de reference : le prix le plus pratique s'il domine vraiment
    // (>= 35 % des lignes), sinon la mediane, moins sensible aux gros chantiers.
    reference: (mode.part >= 0.35 && mode.occurrences >= 2) ? mode.valeur : med,
    referenceSource: (mode.part >= 0.35 && mode.occurrences >= 2) ? 'prix le plus pratique' : 'mediane',
  };
}

/* ------------------------------------------------------------------ */
/* Mesure d'une ligne : nom, puis perso, puis notes de la commande     */
/* ------------------------------------------------------------------ */

const MOTS_VIDES = new Set(['avec','sans','pour','des','les','une','par','sur','aux','plus',
  'personnalise','personnalisee','perso','bois','noir','blanc','rouge','bleu','dore','led',
  'grand','petit','simple','mada','madagascar','logo','nom','couleur','format','dimension']);

function motsCles(nom) {
  return cle(nom).split(' ').filter(w => w.length >= 4 && !MOTS_VIDES.has(w));
}

/**
 * Les notes de commande portent souvent LA dimension (« Dimension 240x30cm »),
 * mais une note couvre toute la commande. On ne s'en sert donc que si
 * l'attribution a CET article n'est pas douteuse :
 *   - commande a un seul article, ou
 *   - une ligne de la note cite un mot du nom de l'article.
 */
function mesureDeLigne(item, cmd) {
  const direct = extraireMesures(item.name);
  if (aMesureUtile(direct)) return { mesure: direct, source: 'nom' };

  if (item.perso) {
    const m = extraireMesures(item.perso);
    if (aMesureUtile(m)) return { mesure: m, source: 'perso' };
  }

  const notes = String((cmd && cmd.notes) || '') + '\n' + String((cmd && cmd.remarque) || '');
  if (!notes.trim()) return { mesure: direct || null, source: direct ? 'nom' : null };

  const lignes = notes.split(/[\n;]+/).map(s => s.trim()).filter(Boolean);
  const nbItems = (cmd && cmd.items ? cmd.items.length : 1);

  if (nbItems === 1) {
    for (const l of lignes) {
      const m = extraireMesures(l);
      if (aMesureUtile(m)) return { mesure: m, source: 'notes' };
    }
  } else {
    const mots = motsCles(item.name);
    for (const l of lignes) {
      const kl = cle(l);
      if (!mots.some(w => kl.indexOf(w) !== -1)) continue;
      const m = extraireMesures(l);
      if (aMesureUtile(m)) return { mesure: m, source: 'notes' };
    }
  }
  return { mesure: direct || null, source: direct ? 'nom' : null };
}

/* ------------------------------------------------------------------ */
/* Collecte des observations                                          */
/* ------------------------------------------------------------------ */

function collecte(ventes, commandes, reservations) {
  const obs = [];

  (ventes || []).forEach(v => {
    (v.items || []).forEach(it => {
      if (estTest(it.name)) return;
      obs.push({
        source: 'vente', id: v.id, date: dateIso(v.date),
        nom: String(it.name || '').trim(),
        qty: Number(it.qty) || 1,
        prix: Number(it.price) || 0,
        client: v.clientName || '',
        annule: false,
        mesure: mesureDeLigne(it, null),
      });
    });
  });

  (commandes || []).forEach(c => {
    (c.items || []).forEach(it => {
      if (estTest(it.name)) return;
      const qty = Number(it.qty) || 1;
      let prix = Number(it.price) || 0;
      let prixDeduit = false;
      // 27 commandes portent un sous-total sans prix sur la ligne (prix saisi
      // au niveau de la commande). Quand il n'y a QU'UN article, le prix
      // unitaire se deduit sans ambiguite — sinon on laisse la ligne a 0.
      if (prix <= 0 && (c.items || []).length === 1 && Number(c.subtotal) > 0) {
        prix = Math.round(Number(c.subtotal) / qty);
        prixDeduit = true;
      }
      obs.push({
        source: 'commande', id: c.id, date: dateIso(c.date),
        nom: String(it.name || '').trim(),
        qty, prix, prixDeduit,
        client: c.clientName || '',
        annule: String(c.status || '').toLowerCase() === 'cancelled',
        mesure: mesureDeLigne(it, c),
      });
    });
  });

  (reservations || []).forEach(r => {
    const nom = String(r.article || r.item || '').trim();
    if (!nom || estTest(nom)) return;
    obs.push({
      source: 'reservation', id: r.id, date: dateIso(r.date),
      nom, qty: Number(r.qty || r.quantite) || 1,
      prix: Number(r.price || r.prixUnitaire) || 0,
      client: r.clientName || r.client || '',
      annule: /annul/i.test(String(r.statut || r.status || '')),
      mesure: mesureDeLigne({ name: nom }, null),
    });
  });

  return obs.filter(o => o.nom);
}

/* ------------------------------------------------------------------ */
/* Agregation                                                         */
/* ------------------------------------------------------------------ */

/** Cle de regroupement d'une mesure : ce qui distingue deux tailles vendues. */
function cleMesure(m) {
  if (!m) return '';
  if (m.dims) return 'd:' + m.dims.join('x');
  if (m.diametre != null) return 'o:' + m.diametre;
  if (m.hauteur != null || m.largeur != null || m.longueur != null) {
    return 'h:' + [m.longueur, m.largeur, m.hauteur].join('/');
  }
  if (m.coteCm != null) return 'c:' + m.coteCm;
  if (m.surfaceDeclareeM2 != null) return 's:' + m.surfaceDeclareeM2;
  if (m.format) return 'f:' + m.format;
  return '';
}

function nouvelleEntree(champs) {
  return Object.assign({ lignes: 0, qte: 0, ca: 0, prix: [], libelles: new Map(),
                         dates: [], mesures: new Map(), matieres: new Map(),
                         options: new Map(), clients: new Set(), annulees: 0,
                         offertes: 0 }, champs);
}

function ajoute(e, o) {
  e.lignes++;
  e.qte += o.qty;
  if (o.annule) { e.annulees++; return; }          // garde la trace, hors statistiques
  e.ca += o.prix * o.qty;
  if (o.prix > 0) e.prix.push(o.prix); else e.offertes++;
  e.libelles.set(o.nom, (e.libelles.get(o.nom) || 0) + 1);
  if (o.date) e.dates.push(o.date);
  if (o.client) e.clients.add(o.client);
  matieresDe(o.nom).forEach(c => e.matieres.set(c, (e.matieres.get(c) || 0) + 1));
  optionsDe(o.nom).forEach(c => e.options.set(c, (e.options.get(c) || 0) + 1));

  const m = o.mesure && o.mesure.mesure;
  const k = cleMesure(m);
  if (k) {
    let mm = e.mesures.get(k);
    if (!mm) {
      mm = { cle: k, libelle: libelleMesure(m), dims: m.dims || null,
             surfaceM2: m.surfaceM2 || null, diametre: m.diametre != null ? m.diametre : null,
             hauteur: m.hauteur != null ? m.hauteur : null,
             coteCm: m.coteCm != null ? m.coteCm : null,
             format: m.format || null, prix: [], lignes: 0, source: o.mesure.source };
      e.mesures.set(k, mm);
    }
    mm.lignes++;
    if (o.prix > 0) mm.prix.push(o.prix);
  }
}

function tri(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => ({ valeur: k, n: v }));
}

function finalise(e) {
  const prixStats = statsPrix(e.prix);
  const mesures = [...e.mesures.values()].map(m => {
    const st = statsPrix(m.prix);
    const out = {
      libelle: m.libelle, lignes: m.lignes, source: m.source,
      dims: m.dims, surfaceM2: m.surfaceM2, diametre: m.diametre,
      hauteur: m.hauteur, coteCm: m.coteCm, format: m.format,
      prix: st,
    };
    if (st && m.surfaceM2 > 0) {
      out.arParM2 = Math.round(st.reference / m.surfaceM2);
    }
    return out;
  }).sort((a, b) => b.lignes - a.lignes);

  const dates = e.dates.slice().sort();
  // Ar/m2 : seulement sur les pieces assez grandes pour que le prix suive la
  // surface. Un trophee de 20x15 cm donne 7 000 000 Ar/m2 et n'a aucun sens
  // comme reference de tarif au metre carre.
  const arM2 = mesures.filter(m => m.arParM2 > 0 && m.surfaceM2 >= 0.05);

  return {
    nom: e.nom, code: e.code, famille: e.famille, familleNom: e.familleNom,
    lignes: e.lignes, qte: e.qte, ca: e.ca,
    annulees: e.annulees, offertes: e.offertes,
    clients: e.clients.size,
    premiere: dates[0] || '', derniere: dates[dates.length - 1] || '',
    prix: prixStats,
    libellesFrequents: tri(e.libelles, 6),
    matieres: tri(e.matieres, 4),
    options: tri(e.options, 4),
    mesures,
    mesuresConnues: mesures.reduce((a, m) => a + m.lignes, 0),
    // On ne publie un Ar/m2 de famille que s'il porte sur plusieurs pieces de
    // grand format : sur des petites pieces le prix ne suit pas la surface.
    arParM2Median: (() => {
      const grand = arM2.filter(m => m.surfaceM2 >= 0.25);
      return grand.length >= 3 ? mediane(grand.map(m => m.arParM2)) : null;
    })(),
  };
}

function agrege(obs) {
  const parFamille = new Map();
  const parModele = new Map();

  obs.forEach(o => {
    const f = familleDe(o.nom);
    const mod = modeleDe(o.nom) || cle(o.nom);

    if (!parFamille.has(f.code)) {
      parFamille.set(f.code, nouvelleEntree({ code: f.code, nom: f.nom, famille: f.code, familleNom: f.nom }));
    }
    ajoute(parFamille.get(f.code), o);

    const kMod = f.code + '|' + mod;
    if (!parModele.has(kMod)) {
      parModele.set(kMod, nouvelleEntree({ code: kMod, nom: mod, famille: f.code, familleNom: f.nom }));
    }
    ajoute(parModele.get(kMod), o);
  });

  const familles = [...parFamille.values()].map(finalise).sort((a, b) => b.ca - a.ca);
  const modeles = [...parModele.values()].map(finalise)
    .map(m => {
      // Nom d'affichage : le libelle reel le plus employe, pas la cle normalisee.
      m.libelle = (m.libellesFrequents[0] && m.libellesFrequents[0].valeur) || m.nom;
      return m;
    })
    .sort((a, b) => b.lignes - a.lignes || b.ca - a.ca);

  return { familles, modeles };
}

/* ------------------------------------------------------------------ */
/* Sorties                                                            */
/* ------------------------------------------------------------------ */

function csv(lignes) {
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + lignes.map(l => l.map(esc).join(';')).join('\r\n') + '\r\n';
}

function ecrisCsvArticles(modeles) {
  const l = [['Famille', 'Article (libelle le plus employe)', 'Lignes', 'Qte vendue',
              'Prix reference (Ar)', 'Base du prix', 'Prix min', 'Prix median', 'Prix max',
              'Mesures connues', 'Mesures observees', 'Matiere', 'Options',
              'Ar/m2 median', 'CA (Ar)', 'Clients', 'Premiere vente', 'Derniere vente']];
  modeles.forEach(m => {
    l.push([
      m.familleNom, m.libelle, m.lignes, m.qte,
      m.prix ? m.prix.reference : '', m.prix ? m.prix.referenceSource : '',
      m.prix ? m.prix.min : '', m.prix ? m.prix.median : '', m.prix ? m.prix.max : '',
      m.mesuresConnues,
      m.mesures.slice(0, 6).map(x => x.libelle).join(' | '),
      m.matieres.map(x => x.valeur).join(' '),
      m.options.map(x => x.valeur).join(' '),
      m.arParM2Median || '', m.ca, m.clients, m.premiere, m.derniere,
    ]);
  });
  fs.writeFileSync(path.join(DIR, 'catalogue-articles.csv'), csv(l));
}

function ecrisCsvMesures(modeles) {
  const l = [['Famille', 'Article', 'Mesure', 'Largeur (cm)', 'Hauteur/Long. (cm)',
              'Profondeur (cm)', 'Diametre (cm)', 'Surface (m2)', 'Format',
              'Lignes', 'Prix reference (Ar)', 'Prix min', 'Prix max', 'Ar/m2', 'Lu dans']];
  modeles.forEach(m => {
    m.mesures.forEach(x => {
      const d = x.dims || [];
      l.push([
        m.familleNom, m.libelle, x.libelle,
        d[0] != null ? d[0] : '', d[1] != null ? d[1] : (x.hauteur != null ? x.hauteur : (x.coteCm != null ? x.coteCm : '')),
        d[2] != null ? d[2] : '', x.diametre != null ? x.diametre : '',
        x.surfaceM2 != null ? x.surfaceM2 : '', x.format || '',
        x.lignes, x.prix ? x.prix.reference : '', x.prix ? x.prix.min : '',
        x.prix ? x.prix.max : '', x.arParM2 || '', x.source || '',
      ]);
    });
  });
  fs.writeFileSync(path.join(DIR, 'catalogue-mesures.csv'), csv(l));
}

/**
 * catalogue-web.json : meme contenu, allege pour la page de consultation.
 * Le JSON complet fait plus d'un Mo (il garde chaque libelle et chaque date) :
 * trop lourd a embarquer dans une page, d'ou cette version aux clefs courtes.
 */
function ecrisJsonWeb(cat) {
  const P = p => p ? { n: p.n, min: p.min, med: p.median, max: p.max,
                       ref: p.reference, src: p.referenceSource === 'mediane' ? 'med' : 'mode' } : null;
  const M = m => ({ l: m.libelle, n: m.lignes, s: m.surfaceM2 || null,
                    m2: m.arParM2 || null, p: P(m.prix), src: m.source });
  const web = {
    genere: cat.genere,
    perimetre: cat.perimetre,
    referentiels: cat.referentiels,
    familles: cat.familles.map(f => ({
      code: f.famille, nom: f.familleNom, lignes: f.lignes, qte: f.qte, ca: f.ca,
      prix: P(f.prix), m2: f.arParM2Median,
      mesures: f.mesures.filter(m => m.prix).slice(0, 24).map(M),
      matieres: f.matieres, options: f.options,
      premiere: f.premiere, derniere: f.derniere, clients: f.clients,
    })),
    articles: cat.modeles.map(m => ({
      f: m.famille, nom: m.libelle, lignes: m.lignes, qte: m.qte, ca: m.ca,
      prix: P(m.prix), m2: m.arParM2Median,
      mesures: m.mesures.slice(0, 12).map(M),
      mat: m.matieres.map(x => x.valeur), opt: m.options.map(x => x.valeur),
      cl: m.clients, d1: m.premiere, d2: m.derniere,
      alt: m.libellesFrequents.slice(1, 4).map(x => x.valeur),
      off: m.offertes, ann: m.annulees,
    })),
    fiches: cat.fichesProduits,
  };
  fs.writeFileSync(path.join(DIR, 'catalogue-web.json'), JSON.stringify(web));
}

/* ------------------------------------------------------------------ */
/* Programme                                                          */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('Lecture des donnees POS' + (UTILISE_CACHE ? ' (cache)' : ' (API GAS)'));
  const [produits, ventes, commandes, reservations] = await Promise.all([
    source('getProducts'),
    source('getSales', 'limit=10000'),
    source('getCommandes'),
    source('getReservations'),
  ]);

  const obs = collecte(ventes.sales, commandes.commandes, reservations.reservations);
  const { familles, modeles } = agrege(obs);

  // Fiches Produits : le seul tarif « officiel » existant, a confronter au terrain.
  const fiches = (produits.products || [])
    .filter(p => !estTest(p.name))
    .map(p => {
      const f = familleDe(p.name);
      const mes = extraireMesures(p.name);
      return {
        id: p.id, nom: p.name, famille: f.code, familleNom: f.nom,
        categorie: p.cat || '', prixVente: Number(p.price) || 0,
        prixAchat: Number(p.cost) || 0, stock: Number(p.stock) || 0,
        marge: (Number(p.price) || 0) - (Number(p.cost) || 0),
        mesure: aMesureUtile(mes) ? libelleMesure(mes) : '',
      };
    });

  const avecMesure = obs.filter(o => o.mesure && aMesureUtile(o.mesure.mesure));
  const parSource = {};
  avecMesure.forEach(o => { parSource[o.mesure.source] = (parSource[o.mesure.source] || 0) + 1; });

  const cat = {
    genere: new Date().toISOString(),
    perimetre: {
      ventes: (ventes.sales || []).length,
      commandes: (commandes.commandes || []).length,
      reservations: (reservations.reservations || []).length,
      lignesArticles: obs.length,
      lignesAnnulees: obs.filter(o => o.annule).length,
      lignesOffertes: obs.filter(o => !o.annule && o.prix <= 0).length,
      libellesDistincts: new Set(obs.map(o => o.nom)).size,
      modeles: modeles.length,
      familles: familles.length,
      lignesAvecMesure: avecMesure.length,
      mesureParSource: parSource,
      periode: {
        debut: obs.map(o => o.date).filter(Boolean).sort()[0] || '',
        fin: obs.map(o => o.date).filter(Boolean).sort().pop() || '',
      },
    },
    referentiels: {
      familles: FAMILLES.filter((f, i, a) => a.findIndex(x => x.code === f.code) === i)
        .map(f => ({ code: f.code, nom: f.nom, icone: f.icone }))
        .concat([{ code: FAMILLE_AUTRE.code, nom: FAMILLE_AUTRE.nom, icone: FAMILLE_AUTRE.icone }]),
      matieres: MATIERES.map(m => ({ code: m.code, nom: m.nom })),
      options: OPTIONS.map(o => ({ code: o.code, nom: o.nom })),
    },
    familles,
    modeles,
    fichesProduits: fiches,
  };

  fs.writeFileSync(path.join(DIR, 'catalogue.json'), JSON.stringify(cat, null, 1));
  ecrisCsvArticles(modeles);
  ecrisCsvMesures(modeles);
  ecrisJsonWeb(cat);

  console.log('\nCatalogue genere');
  console.log('  periode          : ' + cat.perimetre.periode.debut + ' -> ' + cat.perimetre.periode.fin);
  console.log('  lignes articles  : ' + cat.perimetre.lignesArticles +
              ' (' + cat.perimetre.libellesDistincts + ' libelles distincts)');
  console.log('  modeles retenus  : ' + modeles.length + ' dans ' + familles.length + ' familles');
  console.log('  lignes mesurees  : ' + avecMesure.length +
              ' (' + Math.round(avecMesure.length / obs.length * 100) + '%) ' +
              JSON.stringify(parSource));
  console.log('  fichiers         : catalogue.json, catalogue-web.json, ' +
              'catalogue-articles.csv, catalogue-mesures.csv');
}

main().catch(e => { console.error('ECHEC : ' + e.message); process.exit(1); });
