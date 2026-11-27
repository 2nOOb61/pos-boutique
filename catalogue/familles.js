/**
 * familles.js — Taxonomie des articles FOREVER MG.
 *
 * Les noms d'articles du POS sont de la saisie libre : 932 libelles distincts
 * pour ~2 950 lignes, avec coquilles (« Ecriteaau », « Carte de vsite »),
 * majuscules, malgache et francais melanges. Aucune colonne categorie n'est
 * remplie cote Commandes / Ventes.
 *
 * On range donc chaque ligne par MOTS-CLES, regle la plus specifique d'abord
 * (une « plaque signaletique » part en Signaletique, pas en Plaque). L'ordre
 * du tableau EST la priorite : ne pas trier.
 */

const FAMILLES = [
  { code: 'CARTE_VISITE', nom: 'Cartes de visite', icone: 'CreditCard',
    mots: ['carte de visite', 'carte de vsite', 'carte de vistie', 'carte visite',
           'cartes de visite', 'carte sgs', 'cv recto'] },
  { code: 'CARTE_DIVERSE', nom: 'Cartes & badges nominatifs', icone: 'Contact',
    mots: ['carte de fidelite', 'carte fidelite', 'badge', 'carte membre',
           'carte d acces', 'porte badge'] },
  { code: 'INVITATION', nom: 'Invitations & faire-part', icone: 'Mail',
    mots: ['invitation', 'faire part', 'faire-part', 'carton d invitation'] },
  { code: 'ENVELOPPE', nom: 'Enveloppes', icone: 'Mail',
    mots: ['enveloppe'] },
  { code: 'MENU', nom: 'Menus & cartes de table', icone: 'ClipboardList',
    mots: ['menu', 'nom de table', 'marque place', 'numero de table'] },
  { code: 'CALENDRIER', nom: 'Calendriers', icone: 'CalendarDays',
    mots: ['calendrier', 'perpetuel'] },
  { code: 'IMPRESSION', nom: 'Impression & tirages', icone: 'Printer',
    mots: ['impression', 'impresion', 'imression', 'retirage', 'flyer', 'affiche',
           'brochure', 'depliant', 'papier a4', 'papier a3', 'bristol', 'portrait',
           'portait', 'quadri', 'photocopie', 'scan', 'marque page', 'bloc note',
           'facturier', 'carnet', 'bon de commande', 'certificat', 'diplome',
           'attestation', 'carte de voeux', 'livret', 'classeur', 'intercalaire',
           'blocnote', 'note book', 'notebook', 'catalogue', 'planning'] },
  { code: 'AUTOCOLLANT', nom: 'Autocollants & etiquettes', icone: 'Sticker',
    mots: ['autocollant', 'autcollant', 'autocollany', 'autocolant', 'sticker',
           'etiquette', 'adhesif', 'vinyle', 'vynile', 'one way', 'givre',
           'microperfore', 'film'] },
  { code: 'ENSEIGNE', nom: 'Enseignes & caissons', icone: 'Store',
    mots: ['enseigne', 'caisson', 'comptoir', 'habillage', 'claustra', 'totem',
           'lumineuse', 'lumineux'] },
  { code: 'LETTRAGE', nom: 'Lettrages & logos 3D', icone: 'Type',
    mots: ['lettrage', 'lettrine', 'lettre 3d', 'lettres 3d', 'logo 3d',
           'logo signalitique', 'logo signaletique'] },
  { code: 'ECRITEAU', nom: 'Ecriteaux', icone: 'MessageSquare',
    mots: ['ecriteau', 'ecriteaau', 'ecriteaux', 'ecritau', 'verset'] },
  { code: 'SIGNALETIQUE', nom: 'Plaques & signaletique', icone: 'SignpostBig',
    mots: ['plaque', 'panneau', 'pancarte', 'signalitique', 'signaletique',
           'picto', 'numero de chambre', 'numero de porte', 'plaques',
           'par etage', 'interphone', 'boite aux lettres', 'piquet',
           'plaqe', 'paque carre', 'nom de chambre', 'plan de table'] },
  { code: 'MAP_MADA', nom: 'Maps Madagascar', icone: 'Map',
    mots: ['map mada', 'map madagascar', 'map monde', 'map', 'carte du monde',
           'carte de madagascar', 'carte mada', 'carte bongolava',
           'carte talata', 'carte region', 'madagascar led'] },
  { code: 'CADRE', nom: 'Cadres & tableaux', icone: 'Image',
    mots: ['cadre', 'tableau', 'multicouche', 'sous verre', 'sous-verre',
           'passe partout', 'poster'] },
  { code: 'TROPHEE', nom: 'Trophees & medailles', icone: 'Trophy',
    mots: ['trophee', 'trophe', 'tropee', 'trophhe', 'medaille', 'coupe', 'pins',
           'recompense', 'statuette'] },
  { code: 'MONTRE', nom: 'Montres', icone: 'Clock',
    mots: ['montre', 'ontre'] },
  { code: 'PORTE_CLE', nom: 'Porte-cles', icone: 'KeyRound',
    mots: ['porte cle', 'porte-cle', 'portecle', 'porte cé', 'porte c '] },
  { code: 'OBJET_PUB', nom: 'Mugs, gourdes & objets', icone: 'Coffee',
    mots: ['mug', 'gourde', 'tasse', 'bouteille', 'thermos', 'verre', 'bol',
           'briquet', 'cendrier', 'tapis de souris', 'cle usb', 'power bank',
           'parapluie', 'eventail', 'decapsuleur', 'chope', 'cup ', 'cup gasy',
           'tapis souris', 'tapis de souris', 'stanley', 'jeton', 'mouchoir',
           'echiquier', 'toupie'] },
  { code: 'TEXTILE', nom: 'Textile & broderie', icone: 'Shirt',
    mots: ['t shirt', 't-shirt', 'tshirt', 'tee shirt', 'tee-shirt', 'polo',
           'sweat', 'capuche', 'casquette', 'tote bag', 'totebag', 'tablier',
           'gilet', 'chasuble', 'echarpe', 'bonnet', 'broderie', 'borderie',
           'textile', 'uniforme', 'blouse', 'maillot', 'pantalon', 'chaussette',
           'pochon', 'tool pouch', 'ceinture'] },
  { code: 'STYLO', nom: 'Stylos & ecriture', icone: 'PenTool',
    mots: ['stylo', 'crayon', 'feutre', 'marqueur'] },
  { code: 'EMBALLAGE', nom: 'Coffrets, boites & emballages', icone: 'Package',
    mots: ['coffret', 'boite', 'boîte', 'sachet', 'panier', 'pochette',
           'emballage', 'carton', 'bonboniere', 'bonbonniere', 'tube a epice',
           'tube', 'corbeille', 'malette', 'mallette', 'sac '] },
  { code: 'URNE', nom: 'Urnes', icone: 'Vote',
    mots: ['urne'] },
  { code: 'LIVRE_OR', nom: "Livres d'or", icone: 'BookOpen',
    mots: ['livre d or', "livre d'or", 'livre dor', 'livbre d or',
           'guest book', 'wedding book'] },
  { code: 'DECO', nom: 'Deco & mobilier', icone: 'Lamp',
    mots: ['deco', 'decoration', 'mural', 'murale', 'etagere', 'luisette',
           'dock', 'presentoir', 'pose livre', 'porte serviette', 'horloge',
           'lampe', 'veilleuse', 'miroir', 'range', 'porte photo', 'photophore',
           'arche', 'chevalet', 'socle', 'support', 'pied', 'entretoise',
           'magnet', 'aimant', 'luminaire', 'porte nom', 'porte document',
           'porte addition', 'porte bague', 'porte alliance', 'porte mouchoir',
           'porte manteau', 'porte papier', 'porte manette', 'porte telephone',
           'porte gaciere', 'porte bouteille', 'porte boucle', 'porte gateau',
           'plateau', 'sous plat', 'sous-plat', 'abat jour', 'centre de table',
           'figurine', 'arbre', 'noeud en bois', 'tete de zebu', 'caketopper',
           'cake topper', 'accroche porte', 'pack toilette', 'pack accessoire',
           'vide poche', 'avion'] },
  { code: 'FUNERAIRE', nom: 'Croix & funeraire', icone: 'Cross',
    mots: ['croix', 'stele', 'plaque funeraire', 'couronne'] },
  { code: 'GRAND_FORMAT', nom: 'Baches, oriflammes & stands', icone: 'Flag',
    mots: ['bache', 'oriflamme', 'drapeau', 'banderole', 'roll up', 'rollup',
           'kakemono', 'photobooth', 'photo booth', 'stand', 'parasol', 'tente',
           'backdrop', 'arriere plan', 'banniere', 'plv'] },
  { code: 'PRESTATION', nom: 'Prestations & options', icone: 'Settings',
    mots: ['conception', 'graphisme', 'maquette', 'bat', 'gravure', 'decoupe',
           'pose', 'installation', 'deplacement', 'transport', 'livraison',
           'frais', 'rajout', 'supplement', 'retouche', 'echantillon',
           'main d oeuvre', 'montage', 'demontage', 'reparation', 'acompte',
           'avance', 'remise', 'service', 'vernissage', 'pelliculage',
           'plastification', 'laminage', 'faconnage', 'desinstallation',
           'prise de mesure', 'rectif', 'express', 'logo avec led'] },

  // --- Replis de fin de liste : evalues en dernier, apres toutes les regles
  // specifiques. « Carte FRANCINE », « Carte rond », « Carte 15*10cm » : des
  // cartes imprimees nominatives, trop nombreuses pour rester en « Autres ».
  { code: 'CARTE_DIVERSE', nom: 'Cartes & badges nominatifs', icone: 'Contact',
    mots: ['carte'] },
];

const FAMILLE_AUTRE = { code: 'AUTRE', nom: 'Autres articles', icone: 'Package' };

/** Matieres / supports reconnus, pour une seconde cle de lecture du prix. */
const MATIERES = [
  { code: 'BOIS_MASSIF', nom: 'Bois massif', mots: ['bois massif', 'massif'] },
  { code: 'BOIS', nom: 'Bois', mots: ['bois', 'mdf', 'contreplaque', 'ctp', 'bambou'] },
  { code: 'PLEXI', nom: 'Plexi / acrylique', mots: ['plexi', 'plexis', 'acrylique', 'acryique', 'pmma'] },
  { code: 'METAL', nom: 'Metal', mots: ['metal', 'inox', 'laiton', 'aluminium', 'alu '] },
  { code: 'ALUCOBOND', nom: 'Alucobond', mots: ['alucobond', 'alucobon'] },
  { code: 'PVC', nom: 'PVC', mots: ['pvc', 'forex'] },
  { code: 'PAPIER', nom: 'Papier / carton', mots: ['ppb', 'pcb', 'pcm', 'bristol', 'couche', 'offset', 'papier', 'antemoro', 'carton'] },
  { code: 'VINYLE', nom: 'Vinyle / adhesif', mots: ['vinyle', 'vynile', 'adhesif', 'autocollant', 'one way', 'givre'] },
  { code: 'TISSU', nom: 'Tissu', mots: ['coton', 'polyester', 'tissu', 'jersey', 'grs', 'gr '] },
  { code: 'CUIR', nom: 'Cuir', mots: ['cuir', 'simili'] },
  { code: 'VERRE', nom: 'Verre / ceramique', mots: ['verre', 'ceramique', 'porcelaine'] },
];

/** Options recurrentes qui changent le prix a mesure egale. */
const OPTIONS = [
  { code: 'LED', nom: 'LED / lumineux', mots: ['led', 'lumineu', 'flash', 'neon', 'retroeclair'] },
  { code: 'TROIS_D', nom: 'Relief 3D', mots: ['3d', 'relief', 'multicouche', 'superpose'] },
  { code: 'GRAVURE', nom: 'Gravure', mots: ['gravure', 'grave', 'gravee'] },
  { code: 'RECTO_VERSO', nom: 'Recto-verso', mots: ['recto verso', 'r/v', 'recto-verso'] },
  { code: 'PERSONNALISE', nom: 'Personnalise', mots: ['personnalis', 'perso ', 'sur mesure'] },
];

function sansAccents(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function cle(s) {
  return sansAccents(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Un mot-cle compte s'il commence un mot du libelle : « trophee » attrape
 * « trophees », « map mada » attrape « map madagascar », mais « cle » tout seul
 * n'attrape pas « boucle ». Le suffixe reste libre, les coquilles de fin de mot
 * etant la regle dans ces saisies.
 */
function contientMot(k, mot) {
  return (' ' + k).indexOf(' ' + cle(mot)) !== -1;
}

/** Famille d'un libelle d'article (premiere regle qui matche). */
function familleDe(nom) {
  const k = cle(nom);
  for (const f of FAMILLES) {
    if (f.mots.some(m => contientMot(k, m))) return f;
  }
  return FAMILLE_AUTRE;
}

function trouveTous(liste, texte) {
  const k = cle(texte);
  const out = [];
  for (const e of liste) {
    if (e.mots.some(m => contientMot(k, m))) out.push(e.code);
  }
  return out;
}

const matieresDe = txt => trouveTous(MATIERES, txt);
const optionsDe = txt => trouveTous(OPTIONS, txt);

/**
 * Libelle de MODELE : le nom debarrasse de ce qui n'identifie pas l'article
 * (dimensions, quantites, references de fichier, noms de clients en fin de
 * libelle). Deux saisies differentes du meme produit doivent tomber dessus.
 */
function modeleDe(nom) {
  let k = cle(nom);
  k = k
    // mesures et dimensions
    .replace(/\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?\s*[x*]\s*\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?(?:\s*[x*]\s*\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?)?/g, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*(?:mm|cm|m2|m)\b/g, ' ')
    .replace(/\b\d+\s*(?:grs?|gr|g)\b/g, ' ')
    .replace(/\bdimension[s]?\b|\bdimenssion\b|\bformat\b|\bsuperficie\b|\bhauteur\b|\blargeur\b|\blongueur\b|\bdiametre\b|\bepaisseur\b/g, ' ')
    // quantites et references de fichier
    .replace(/\b\d+\s*(?:pcs?|pces?|pieces?|ex|pages?|lot|unites?)\b/g, ' ')
    .replace(/\b(?:ai|rar|zip|pdf|cdr|psd|jpg|png)\b/g, ' ')
    .replace(/\b\d{2,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Pluriels : « invitations » et « invitation », « ecriteaux » et « ecriteau »
  // sont le meme article saisi deux fois. On ramene au singulier, sauf les mots
  // de 4 lettres ou moins ou le « s » peut etre porteur (« gras », « bas »).
  k = k.split(' ').map(w => {
    if (w.length > 5 && /aux$/.test(w)) return w.slice(0, -3) + 'au';
    if (w.length > 4 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }).join(' ');
  return k || cle(nom);
}

if (typeof module !== 'undefined') {
  module.exports = { FAMILLES, FAMILLE_AUTRE, MATIERES, OPTIONS,
                     familleDe, matieresDe, optionsDe, modeleDe, cle, sansAccents };
}
