// ============================================================
// FOREVER MG — Système Unifié POS + Attribution + Production
// Google Apps Script — Code.gs
// ============================================================

const SHEET_ID = '1Lsf_OhhuKYlSE3S_OpJwzUEy78LBdFDj_1dmYuT70eo'; // ← votre ID existant

// Feuilles existantes POS
const SHEET_PRODUCTS     = 'Produits';
const SHEET_SALES        = 'Ventes';
const SHEET_STOCK_LOG    = 'MouvementsStock';
const SHEET_USERS        = 'Utilisateurs';
const SHEET_RESERVATIONS = 'Réservations';
const SHEET_COMMANDES    = 'Commandes';

// Nouvelles feuilles
const SHEET_DOSSIERS   = 'Dossiers';
const SHEET_TACHES     = 'Taches';
const SHEET_JOURNAL    = 'JournalAcces'; // audit log : qui fait quoi et quand

// En-têtes de la feuille Dossiers, partagés par tous les points de création
// (vente, manuel, autre) pour éviter tout décalage de colonnes si l'un diverge.
const DOSSIER_HEADERS = ['ID','NumeroDossier','Client','Produit','Quantite','Statut',
  'Progression','DateCreation','DateLivraison','Priorite','SourceVente','Notes'];

// ── Audit : enregistrement des actions critiques ───────────
function _logAction_(action, user, detail) {
  try {
    const ss = getSS();
    const sh = ensureSheet(ss, SHEET_JOURNAL,
      ['Timestamp','Utilisateur','Action','Detail','IP_Approx']);
    sh.appendRow([new Date(), String(user||'anonyme'), String(action), String(detail||''), '']);
    // Limiter à 5 000 entrées : supprimer les plus anciennes si besoin
    const last = sh.getLastRow();
    if (last > 5001) sh.deleteRows(2, last - 5001);
  } catch(e) {} // ne jamais planter l'app pour un log
}

// Étapes de production
// ⚠️ L'ORDRE doit rester IDENTIQUE à ETAPES_CONFIG (app.js) : majProgressionDossier_
// fait avancer le statut du dossier vers ETAPES_PROD[idx+1] quand une tâche se termine.
// Codes = clés persistées dans la feuille Taches : ne jamais renommer un code existant.
const ETAPES_PROD = [
  { code:'VALID_CMD',     label:'Validation commande (commerciale)', progress:10  },
  { code:'PAO',           label:'Conception / Simulation (PAO)',     progress:20  },
  { code:'RETOUR_CLIENT', label:'Validation client (commerciale)',   progress:30  },
  { code:'MODIFICATIONS', label:'Modifications (PAO)',               progress:40  },
  { code:'VALID_CLIENT2', label:'Validation client (commerciale)',   progress:50  },
  { code:'BAT',           label:'BAT physique (PAO+prod+finition)',  progress:60  },
  { code:'ACHAT',         label:'Achat (si besoin acheteur)',        progress:70  },
  { code:'PRODUCTION',    label:'Production (machine / impression / laser)', progress:80 },
  { code:'FINITION',      label:'Finition',                          progress:90  },
  { code:'LIVRE',         label:'Livraison',                         progress:100 },
];

// ── Sécurité : hashage SHA-256 des mots de passe ──────────
function _hashPwd_(pwd) {
  const SALT = PropertiesService.getScriptProperties().getProperty('PWD_SALT') || 'FMG_SALT_2024';
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    pwd + SALT,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(b) {
    var h = (b < 0 ? b + 256 : b).toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
}

// ── Sécurité : rate limiting basé sur CacheService ────────
function _rateLimitCheck_(identifier) {
  var cache = CacheService.getScriptCache();
  var key   = 'rl_' + String(identifier || 'anon').replace(/[^a-zA-Z0-9]/g,'_').substring(0, 40);
  var count = Number(cache.get(key) || 0);
  if (count >= 60) throw new Error('Trop de requêtes. Réessayez dans une minute.');
  cache.put(key, String(count + 1), 60);
}

// ============================================================
// ROUTEUR — POST
// ============================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    _rateLimitCheck_(data.username || data.caissier || data.operateur || 'anon');
    const action = data.action;
    let result;

    // POS existant — inchangé
    if      (action === 'login')             result = handleLogin(data);
    else if (action === 'getProducts')       result = handleGetProducts();
    else if (action === 'saveProduct')       result = handleSaveProduct(data);
    else if (action === 'deleteProduct')     result = handleDeleteProduct(data);
    else if (action === 'addSale')           result = handleAddSale(data);
    else if (action === 'deleteSale')        result = handleDeleteSale(data);
    else if (action === 'stockMove')         result = handleStockMove(data);
    else if (action === 'getSales')          result = handleGetSales(data);
    else if (action === 'getUsers')          result = handleGetUsers();
    else if (action === 'saveUser')          result = handleSaveUser(data);
    else if (action === 'deleteUser')        result = handleDeleteUser(data);
    else if (action === 'addReservation')    result = handleAddReservation(data);
    else if (action === 'updateReservation') result = handleUpdateReservation(data);
    else if (action === 'getReservations')   result = handleGetReservations();
    else if (action === 'addCommande')       result = handleAddCommande(data);
    else if (action === 'updateCommande')    result = handleUpdateCommande(data);
    else if (action === 'getCommandes')      result = handleGetCommandes();
    // Nouveaux modules
    else if (action === 'getDossiers')       result = handleGetDossiers(data);
    else if (action === 'saveDossier')       result = handleSaveDossier(data);
    else if (action === 'updateDossier')     result = handleUpdateDossier(data);
    else if (action === 'creerDossierManuel') result = handleCreerDossierManuel(data);
    else if (action === 'saveTacheLibre')    result = handleSaveTacheLibre(data);
    else if (action === 'setTacheLibrePhotos') result = handleSetTacheLibrePhotos(data);
    else if (action === 'attribuerTache')    result = handleAttribuerTache(data);
    else if (action === 'getTaches')         result = handleGetTaches(data);
    else if (action === 'deleteTache')       result = handleDeleteTache(data);
    else if (action === 'pointerAction')     result = handlePointerAction(data);
    else if (action === 'getDashboard')      result = handleGetDashboard();
    else if (action === 'getControlPatron')  result = handleGetControlPatron(data);
    else if (action === 'uploadFile')        result = handleUploadFile(data);
    else if (action === 'getDriveFolderUrl') result = handleGetDriveFolderUrl();
    else if (action === 'clearAllData')      result = handleClearAllData(data);
    else if (action === 'addComment')        result = handleAddComment(data);
    else if (action === 'saveNotif')         result = handleSaveNotif(data);
    else if (action === 'saveModif')         result = handleSaveModif(data);
    else if (action === 'resolveModif')      result = handleResolveModif(data);
    else if (action === 'getModifs')         result = handleGetModifs(data);
    else if (action === 'saveShopConfig')    result = handleSaveShopConfig(data);
    else if (action === 'saveRythme')        result = handleSaveRythme(data);
    else result = { ok:false, error:'Action inconnue: ' + action };

    return jsonResp(result);
  } catch(err) {
    return jsonResp({ ok:false, error: err.message });
  }
}

// ============================================================
// ROUTEUR — GET (inchangé + nouvelles routes)
// ============================================================
function doGet(e) {
  if (e.parameter.payload) {
    try {
      const data = JSON.parse(e.parameter.payload);
      const action = data.action;
      let result;
      if      (action === 'addSale')           result = handleAddSale(data);
      else if (action === 'deleteSale')        result = handleDeleteSale(data);
      else if (action === 'saveProduct')       result = handleSaveProduct(data);
      else if (action === 'deleteProduct')     result = handleDeleteProduct(data);
      else if (action === 'stockMove')         result = handleStockMove(data);
      else if (action === 'saveUser')          result = handleSaveUser(data);
      else if (action === 'deleteUser')        result = handleDeleteUser(data);
      else if (action === 'addReservation')             result = handleAddReservation(data);
      else if (action === 'updateReservation')          result = handleUpdateReservation(data);
      else if (action === 'updateReservationAttachments') result = handleUpdateReservationAttachments(data);
      else if (action === 'addCommande')       result = handleAddCommande(data);
      else if (action === 'updateCommande')    result = handleUpdateCommande(data);
      else if (action === 'updateDossier')     result = handleUpdateDossier(data);
      else if (action === 'attribuerTache')    result = handleAttribuerTache(data);
      else if (action === 'pointerAction')     result = handlePointerAction(data);
      else if (action === 'deleteTache')       result = handleDeleteTache(data);
      else if (action === 'addComment')        result = handleAddComment(data);
      else if (action === 'saveNotif')         result = handleSaveNotif(data);
      else if (action === 'saveModif')         result = handleSaveModif(data);
      else if (action === 'resolveModif')      result = handleResolveModif(data);
      else if (action === 'saveShopConfig')    result = handleSaveShopConfig(data);
      else if (action === 'saveRythme')        result = handleSaveRythme(data);
      else if (action === 'clearAllData')      result = handleClearAllData(data);
      else if (action === 'saveTacheLibre')    result = handleSaveTacheLibre(data);
      else if (action === 'setTacheLibrePhotos') result = handleSetTacheLibrePhotos(data);
      else if (action === 'saveDossier')       result = handleSaveDossier(data);
      else if (action === 'creerDossierManuel') result = handleCreerDossierManuel(data);
      else if (action === 'getControlPatron')   result = handleGetControlPatron(data);
      else result = { ok:false, error:'Action payload inconnue: ' + action };
      return jsonResp(result);
    } catch(err) {
      return jsonResp({ ok:false, error:'Payload invalide: ' + err.message });
    }
  }

  try {
    const action = e.parameter.action || 'ping';
    if (action === 'ping')            return jsonResp({ ok:true, message:'FOREVER MG POS actif ' });
    if (action === 'login')           return jsonResp(handleLogin({ username:e.parameter.username||'', password:e.parameter.password||'' }));
    if (action === 'getProducts')     return jsonResp(handleGetProducts());
    if (action === 'getSales')        return jsonResp(handleGetSales(e.parameter));
    if (action === 'getUsers')        return jsonResp(handleGetUsers());
    if (action === 'getReservations') return jsonResp(handleGetReservations());
    if (action === 'getCommandes')    return jsonResp(handleGetCommandes());
    if (action === 'getDossiers')     return jsonResp(handleGetDossiers(e.parameter));
    if (action === 'getTaches')       return jsonResp(handleGetTaches(e.parameter));
    if (action === 'getDashboard')    return jsonResp(handleGetDashboard());
    if (action === 'getControlPatron') return jsonResp(handleGetControlPatron(e.parameter));
    if (action === 'migrateCommandeIds') return jsonResp(migrateCommandeIds());
    if (action === 'migrateDedupDossiers') return jsonResp(migrateDedupDossiers());
    if (action === 'diagCommandeErrors') return jsonResp(diagCommandeErrors());
    if (action === 'fixCommandeErrors')  return jsonResp(fixCommandeErrors());
    if (action === 'getComments')     return jsonResp(handleGetComments(e.parameter));
    if (action === 'getNotifs')       return jsonResp(handleGetNotifs(e.parameter));
    if (action === 'getModifs')       return jsonResp(handleGetModifs(e.parameter));
    if (action === 'getShopConfig')   return jsonResp(handleGetShopConfig());
    if (action === 'getRythme')       return jsonResp(handleGetRythme());
    if (action === 'initSheets')      return jsonResp(initSheets());
    if (action === 'setupBackup')     return jsonResp(createDailyBackupTrigger());
    if (action === 'runBackupNow')    return jsonResp(dailyBackup());
    if (action === 'getJournal')        return jsonResp(handleGetJournal(e.parameter));
    if (action === 'getDriveFolderUrl') return jsonResp(handleGetDriveFolderUrl());
    if (action === 'getSharedFiles')    return jsonResp(handleGetSharedFiles());
    return jsonResp({ ok:false, error:'Action GET inconnue: ' + action });
  } catch(err) {
    return jsonResp({ ok:false, error:'GET error: ' + err.message });
  }
}

function jsonResp(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSS() { return SpreadsheetApp.openById(SHEET_ID); }

// ============================================================
// INIT — crée les nouvelles feuilles sans toucher aux existantes
// ============================================================
function initSheets() {
  const ss = getSS();

  // Feuilles existantes POS (préservées telles quelles)
  ensureSheet(ss, SHEET_PRODUCTS,   ['ID','Nom','Categorie','Emoji','Code','Prix_Vente','Prix_Achat','Stock','Stock_Min','Date_MAJ']);
  ensureSheet(ss, SHEET_SALES,      ['ID','Date','Heure','Article','Quantite','Prix_Unitaire','Sous_Total','Total_Vente','Paiement','Fournisseur','Reference','Caissier','Titulaire_Cheque','Date_Cheque']);
  ensureSheet(ss, SHEET_STOCK_LOG,  ['Date','Article','Type','Quantite','Stock_Avant','Stock_Apres','Motif','Caissier']);
  ensureSheet(ss, SHEET_USERS,      ['Username','MotDePasse','Role','Nom','Actif']);
  // Réservations — ajouter col 22 Attachments_JSON si absente
  const resSh = ss.getSheetByName(SHEET_RESERVATIONS) || ss.insertSheet(SHEET_RESERVATIONS);
  const resHeaders = resSh.getLastColumn() > 0 ? resSh.getRange(1,1,1,resSh.getLastColumn()).getValues()[0] : [];
  if (!resHeaders.includes('Attachments_JSON')) {
    const col = Math.max(resHeaders.length, 21) + 1;
    resSh.getRange(1, col).setValue('Attachments_JSON');
  }
  ensureSheet(ss, SHEET_RESERVATIONS,['ID','Date','Heure','Client_Nom','Client_Contact','Article','Quantite','Prix_Unitaire','Sous_Total_Article','Sous_Total_Vente','Remise','Net_A_Payer','Accompte','Restant','Mode_Depot','Fournisseur_Mobile','Reference','Caissier','Statut','Date_Finalisation','Vente_ID','Attachments_JSON','Mode_Livraison','Adresse_Livraison','Frais_Livraison','Date_Livraison']);
  // Commandes client — mise à jour de l'en-tête si besoin
  const cmdSh = ss.getSheetByName(SHEET_COMMANDES) || ss.insertSheet(SHEET_COMMANDES);
  cmdSh.getRange(1, 1, 1, 24).setValues([['ID','Date','Caissier','Client_Nom','Client_Contact','Articles','Mode_Livraison','Adresse_Livraison','Frais_Livraison','Date_Livraison','Sous_Total','Remise','Total','Accompte','Restant','Mode_Depot','Fournisseur_Mobile','Reference','Notes','Statut','Date_Finalisation','Vente_ID','Date_Livraison_Prod','Date_BAT']]);

  // Nouvelles feuilles production
  ensureSheet(ss, SHEET_DOSSIERS, DOSSIER_HEADERS);
  ensureSheet(ss, SHEET_TACHES,     ['ID','DossierID','NumeroDossier','Etape','EtapeLabel','Operateur','Statut','DateAssignation','DateDebut','DateFin','Commentaire','AssignePar','Priorite','Echeance','Photos']);

  return { ok:true, message:'Feuilles initialisées ' };
}

function ensureSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1,1,1,headers.length)
      .setBackground('#1a4a3a').setFontColor('#ffffff').setFontWeight('bold');
  }
  return sh;
}

// ============================================================
// AUTH — identique à l'original
// ============================================================
function handleLogin(data) {
  const ss         = getSS();
  const sh         = ss.getSheetByName(SHEET_USERS);
  if (!sh) return { ok:false, error:'Feuille Utilisateurs introuvable' };
  const rows       = sh.getDataRange().getValues();
  const inputUser  = String(data.username || '').trim().toLowerCase();
  const inputPwd   = String(data.password  || '').trim();
  const inputHash  = _hashPwd_(inputPwd);

  for (let i = 1; i < rows.length; i++) {
    const r          = rows[i];
    const storedUser = String(r[0] || '').trim().toLowerCase();
    const storedPwd  = String(r[1] || '').trim();
    const isActif    = String(r[4] || 'oui').trim().toLowerCase() !== 'non';

    if (storedUser !== inputUser || !isActif) continue;
    if (!storedPwd) continue; // compte sans mot de passe défini → connexion impossible (sécurité)

    // Hash 64 hex → comparaison sécurisée ; sinon plaintext (migration progressive)
    const isHashed = /^[0-9a-f]{64}$/i.test(storedPwd);
    const matches  = isHashed ? (storedPwd === inputHash) : (storedPwd === inputPwd);

    if (matches) {
      if (!isHashed) {
        // Migrer le mot de passe en clair vers le hash lors de la première connexion
        try { sh.getRange(i + 1, 2).setValue(inputHash); } catch(e) {}
      }
      _logAction_('LOGIN_OK', r[0], 'Rôle: ' + r[2]);
      return { ok:true, user:{ username:r[0], role:r[2], label:r[3]||r[0] } };
    }
  }
  _logAction_('LOGIN_FAIL', inputUser, 'Tentative échouée');
  return { ok:false, error:'Identifiants incorrects' };
}

// ============================================================
// PRODUITS — identique à l'original
// ============================================================
function handleGetProducts() {
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'products_v1';
  const cached   = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  const sh       = getSS().getSheetByName(SHEET_PRODUCTS);
  const rows     = sh.getDataRange().getValues();
  const products = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    products.push({ id:r[0], name:r[1], cat:r[2], emoji:r[3], code:r[4],
      price:Number(r[5]), cost:Number(r[6]), stock:Number(r[7]), minStock:Number(r[8]) });
  }
  const result = { ok:true, products };
  try { cache.put(cacheKey, JSON.stringify(result), 300); } catch(e) {} // 5 min
  return result;
}

function handleSaveProduct(data) {
  const p = data.product;
  if (!p || !String(p.name||'').trim()) return { ok:false, error:'Nom de produit requis' };
  if (Number(p.price) < 0)             return { ok:false, error:'Le prix ne peut pas être négatif' };
  if (p.stock !== undefined && Number(p.stock) < 0) return { ok:false, error:'Le stock ne peut pas être négatif' };
  p.name = String(p.name).trim().substring(0, 200); // limiter la longueur

  const ss = getSS(); const sh = ss.getSheetByName(SHEET_PRODUCTS);
  const rows = sh.getDataRange().getValues();
  CacheService.getScriptCache().remove('products_v1'); // invalider le cache
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == p.id) {
      sh.getRange(i+1,1,1,10).setValues([[p.id,p.name,p.cat||p.category,p.emoji||'',p.code,p.price,p.cost||p.buyPrice||0,p.stock,p.minStock,new Date()]]);
      return { ok:true };
    }
  }
  const newId = rows.length > 1 ? Math.max(...rows.slice(1).map(r=>Number(r[0])||0))+1 : 1;
  sh.appendRow([newId,p.name,p.cat||p.category||'',p.emoji||'',p.code||'',p.price,p.cost||0,p.stock||0,p.minStock||5,new Date()]);
  return { ok:true, id:newId };
}

function handleDeleteProduct(data) {
  const sh = getSS().getSheetByName(SHEET_PRODUCTS);
  const rows = sh.getDataRange().getValues();
  CacheService.getScriptCache().remove('products_v1'); // invalider le cache
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == data.id) {
      _logAction_('PRODUIT_DELETE', data.deletedBy||'admin', 'ID:' + data.id + ' Nom:' + rows[i][1]);
      sh.deleteRow(i+1); return { ok:true };
    }
  }
  return { ok:false, error:'Produit introuvable' };
}

// ============================================================
// VENTES — avec création automatique de dossier production
// ============================================================
function handleAddSale(data) {
  const sale = data.sale;
  if (!sale || !Array.isArray(sale.items) || sale.items.length === 0) {
    return { ok:false, error:'Vente invalide : panier vide' };
  }
  for (const item of sale.items) {
    if (!String(item.name||'').trim()) return { ok:false, error:'Article sans nom détecté' };
    if (Number(item.qty) <= 0)         return { ok:false, error:'Quantité invalide pour : ' + item.name };
    if (Number(item.price) < 0)        return { ok:false, error:'Prix invalide pour : ' + item.name };
  }

  const ss = getSS();
  const sh = ss.getSheetByName(SHEET_SALES);
  const d  = new Date(sale.date);
  const tz   = Session.getScriptTimeZone();
  const dateS = Utilities.formatDate(d, tz, 'dd/MM/yyyy');
  const timeS = Utilities.formatDate(d, tz, 'HH:mm:ss');
  const modePaiement = sale.method === 'cash'   ? 'Espèces'
                     : sale.method === 'cheque' ? 'Chèque'
                     : 'Mobile Money';

  // Infos chèque (colonnes 13-14). Pour un chèque : provider=banque, ref=numéro (déjà écrits) ;
  // titulaire + date du chèque stockés en plus.
  let chequeDateS = '';
  if (sale.method === 'cheque' && sale.chequeDate) {
    const cd = new Date(String(sale.chequeDate) + 'T00:00:00');
    chequeDateS = isNaN(cd.getTime()) ? String(sale.chequeDate) : Utilities.formatDate(cd, tz, 'dd/MM/yyyy');
  }
  // La feuille Ventes a pu être créée avant l'ajout de ces 2 colonnes → poser l'en-tête si absent.
  if (sh.getLastColumn() < 14) {
    sh.getRange(1, 13, 1, 2).setValues([['Titulaire_Cheque','Date_Cheque']])
      .setBackground('#1a4a3a').setFontColor('#ffffff').setFontWeight('bold');
  }

  // Écriture batch : une seule requête Sheets pour tous les articles (x5-10 plus rapide)
  const batchRows = sale.items.map(item => [
    sale.id, dateS, timeS, item.name, item.qty, item.price,
    item.price * item.qty, sale.total,
    modePaiement, sale.provider||'', sale.ref||'', sale.caissier||'',
    sale.chequeTitulaire||'', chequeDateS
  ]);
  if (batchRows.length > 0) {
    const lastRow = sh.getLastRow();
    sh.getRange(lastRow + 1, 1, batchRows.length, 14).setValues(batchRows);
  }

  // Stock + log (gardés séquentiels pour le LockService)
  sale.items.forEach(item => {
    updateStock_(ss, item.name, -item.qty);
    logStock_(ss, item.name, 'Vente', -item.qty, 'Vente #'+sale.id, sale.caissier||'');
  });

  //  Création automatique des dossiers de production
  creerDossiersFromVente_(ss, sale);

  _logAction_('VENTE', sale.caissier||'caissier',
    'ID:' + sale.id + ' Total:' + sale.total + ' Articles:' + sale.items.length);
  CacheService.getScriptCache().remove('dashboard_v1'); // invalider le dashboard
  return { ok:true, saleId:sale.id };
}

// Supprime toutes les lignes de la vente `id` (multi-lignes/article) de la feuille Ventes.
// Utilisé par la « dé-finalisation » admin d'une commande (corriger une facture finalisée
// par erreur sans laisser de doublon dans Ventes). Sous lock, du bas vers le haut.
function handleDeleteSale(data) {
  const id = String((data && data.id) || '');
  if (!id) return { ok:false, error:'id manquant' };
  const sh = getSS().getSheetByName(SHEET_SALES);
  if (!sh) return { ok:false, error:'Feuille Ventes introuvable' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000);
    const rows = sh.getDataRange().getValues();
    let deleted = 0;
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][0]) === id) { sh.deleteRow(i + 1); deleted++; }
    }
    _logAction_('VENTE_SUPPR', (data && data.by) || 'admin', 'ID:' + id + ' lignes:' + deleted);
    CacheService.getScriptCache().remove('dashboard_v1');
    return { ok:true, deleted };
  } finally { try { lock.releaseLock(); } catch(e) {} }
}

function creerDossiersFromVente_(ss, sale) {
  const sh = ss.getSheetByName(SHEET_DOSSIERS);
  if (!sh) return;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(6000); // verrou pour éviter les IDs dupliqués en cas de ventes simultanées
    const now    = new Date();
    const rows   = sh.getDataRange().getValues();
    const lastId = rows.length > 1
      ? Math.max(...rows.slice(1).map(r => Number(String(r[0]).replace('D','')) || 0))
      : 0;
    let nextId = lastId + 1;

    // Batch write : tous les dossiers en une seule requête
    const clientLabel = sale.clientName || sale.clientContact || sale.caissier || 'Client';
    const batchRows = sale.items.map(item => {
      const dossId = 'D' + String(nextId).padStart(4,'0');
      const row = [dossId, 'POS-'+sale.id+'-'+nextId, clientLabel,
        item.name, item.qty, 'CREE', 0, now, sale.deliveryDate||'', 'Normale', 'Vente #'+sale.id, ''];
      nextId++;
      return row;
    });
    if (batchRows.length > 0) {
      const lastRow = sh.getLastRow();
      sh.getRange(lastRow + 1, 1, batchRows.length, 12).setValues(batchRows);
    }
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// ── Dossier de production manuel (sans vente) ──────────────
function handleCreerDossierManuel(data) {
  const d = data.dossier;
  if (!d || !d.produit) return { ok:false, error:'Champ produit requis' };
  if (!d.quantite || Number(d.quantite) <= 0) return { ok:false, error:'Quantité invalide' };

  const ss  = getSS();
  const sh  = ensureSheet(ss, SHEET_DOSSIERS, DOSSIER_HEADERS);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(6000);
    const rows   = sh.getDataRange().getValues();
    const lastId = rows.length > 1
      ? Math.max(...rows.slice(1).map(r => Number(String(r[0]).replace(/[^\d]/g,'')) || 0))
      : 0;
    const dossId  = 'D' + String(lastId + 1).padStart(4,'0');
    const numDoss = 'MAN-' + String(lastId + 1).padStart(4,'0');
    const now     = new Date();
    const livDate = d.dateLivraison ? new Date(d.dateLivraison) : '';

    sh.appendRow([
      dossId,
      numDoss,
      d.client   || 'Interne',
      d.produit,
      Number(d.quantite),
      'CREE',
      0,
      now,
      livDate,
      d.priorite || 'Normale',
      'Manuel',
      d.notes    || ''
    ]);

    let stockInfo = { deduit: false };
    if (d.deduireStock && d.produit) {
      try {
        const newStock = updateStock_(ss, d.produit, -Number(d.quantite));
        if (newStock !== undefined) {
          logStock_(ss, d.produit, 'Sortie production', -Number(d.quantite),
            'Dossier manuel ' + numDoss, d.createdBy || 'admin');
          stockInfo = { deduit: true, newStock };
        }
      } catch(e) {
        stockInfo = { deduit: false, raison: e.message };
      }
    }

    _logAction_('DOSSIER_MANUEL', d.createdBy || 'admin',
      numDoss + ' — ' + d.produit + ' × ' + d.quantite);
    CacheService.getScriptCache().remove('dashboard_v1');

    return { ok:true, dossId, numDoss, stockInfo };
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

function handleGetSales(data) {
  const sh      = getSS().getSheetByName(SHEET_SALES);
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return { ok:true, sales:[] };

  const PAGE   = Number(data.limit) || 200;
  // Lire les N*3 dernières lignes (3x pour grouper les articles par ID de vente)
  const start  = Math.max(2, lastRow - PAGE * 3 + 1);
  const nRows  = lastRow - start + 1;
  const rows   = sh.getRange(start, 1, nRows, 12).getValues();

  const map   = {};
  const order = [];
  for (let i = 0; i < rows.length; i++) {
    const r  = rows[i];
    const id = String(r[0]);
    if (!id) continue;
    if (!map[id]) {
      map[id] = { id, date:r[1], time:r[2], total:Number(r[7]),
                  method:r[8], caissier:r[11], items:[] };
      order.push(id);
    }
    map[id].items.push({ name:r[3], qty:Number(r[4]), price:Number(r[5]) });
  }

  let sales = order.map(id => map[id]).reverse();

  // Filtre optionnel par date de début
  if (data.dateDebut) {
    const debut = new Date(data.dateDebut);
    sales = sales.filter(s => {
      const parts = String(s.date).split('/');
      if (parts.length === 3) {
        const d = new Date(parts[2] + '-' + parts[1] + '-' + parts[0]);
        return d >= debut;
      }
      return true;
    });
  }

  return { ok:true, sales: sales.slice(0, PAGE) };
}

// ============================================================
// STOCK
// ============================================================
function handleStockMove(data) {
  const ss    = getSS();
  const delta = data.type==='in' ? Number(data.qty) : -Number(data.qty);
  updateStock_(ss, data.productName, delta);
  logStock_(ss, data.productName, data.type==='in'?'Entrée':'Sortie', delta, data.reason||'', data.caissier||'');
  return { ok:true };
}

function updateStock_(ss, name, delta) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000);
    const sh   = ss.getSheetByName(SHEET_PRODUCTS);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === name) {
        const currentStock = Number(rows[i][7]);
        const newStock     = currentStock + delta;
        // Bloquer uniquement les ventes (delta négatif) qui mettraient le stock < 0
        if (newStock < 0 && delta < 0) {
          throw new Error('Stock insuffisant pour "' + name + '" : ' + currentStock + ' disponible(s)');
        }
        sh.getRange(i + 1, 8).setValue(newStock);
        sh.getRange(i + 1, 10).setValue(new Date());
        return newStock;
      }
    }
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

function logStock_(ss, name, type, delta, reason, caissier) {
  const sh = ss.getSheetByName(SHEET_STOCK_LOG);
  const prodSh = ss.getSheetByName(SHEET_PRODUCTS);
  const rows = prodSh.getDataRange().getValues();
  let stock = 0;
  for (let i = 1; i < rows.length; i++) { if (rows[i][1]===name) { stock=Number(rows[i][7]); break; } }
  sh.appendRow([new Date(), name, type, delta, stock-delta, stock, reason, caissier]);
}

// ============================================================
// UTILISATEURS
// ============================================================
function handleGetUsers() {
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'users_v1';
  const cached   = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  const sh    = getSS().getSheetByName(SHEET_USERS);
  const rows  = sh.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r[0]) continue;
    let _cp = null; try { if (r[5]) _cp = JSON.parse(r[5]); } catch(e) {}
    users.push({ username:r[0], role:r[2], label:r[3], actif:String(r[4]||'oui').toLowerCase()!=='non', hasPwd: !!String(r[1]||'').trim(), customPages: _cp });
  }
  const result = { ok:true, users };
  try { cache.put(cacheKey, JSON.stringify(result), 300); } catch(e) {}
  return result;
}

function handleSaveUser(data) {
  CacheService.getScriptCache().remove('users_v1'); // invalider le cache
  const ss  = getSS();
  const sh  = ss.getSheetByName(SHEET_USERS);
  const u   = data.user;
  // Hasher le mot de passe s'il est fourni en clair.
  // Champ attendu = "password". Compat ancien frontend qui envoyait "pass" :
  // on ne l'accepte QUE s'il est en clair (pas un hash 64-hex), car le hash local
  // est non salé et écraserait le vrai mot de passe lors d'une édition sans changement.
  let pwd = u.password || '';
  if (!pwd && u.pass && !/^[0-9a-f]{64}$/i.test(String(u.pass))) pwd = String(u.pass);
  if (pwd && !/^[0-9a-f]{64}$/i.test(pwd)) {
    pwd = _hashPwd_(pwd);
  }
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === String(u.username).toLowerCase()) {
      const storedPwd = pwd || rows[i][1];
      sh.getRange(i+1,1,1,6).setValues([[u.username, storedPwd, u.role, u.label||u.nom||u.username, u.actif!==false?'oui':'non', u.customPages ? JSON.stringify(u.customPages) : '']]);
      _logAction_('USER_UPDATE', data.editedBy||'admin', 'Modifié: ' + u.username + ' rôle:' + u.role);
      return { ok:true };
    }
  }
  sh.appendRow([u.username, pwd, u.role||'caissier', u.label||u.nom||u.username, 'oui', u.customPages ? JSON.stringify(u.customPages) : '']);
  _logAction_('USER_CREATE', data.editedBy||'admin', 'Créé: ' + u.username + ' rôle:' + (u.role||'caissier'));
  return { ok:true };
}

function handleDeleteUser(data) {
  CacheService.getScriptCache().remove('users_v1'); // invalider le cache
  const sh   = getSS().getSheetByName(SHEET_USERS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === String(data.username).toLowerCase()) {
      _logAction_('USER_DELETE', data.deletedBy||'admin', 'Supprimé: ' + data.username);
      sh.deleteRow(i+1); return { ok:true };
    }
  }
  return { ok:false, error:'Utilisateur introuvable' };
}

// ============================================================
// RÉSERVATIONS
// Colonnes sheet (21) :
// [0]ID [1]Date [2]Heure [3]Client_Nom [4]Client_Contact
// [5]Article [6]Quantite [7]Prix_Unitaire [8]Sous_Total_Article
// [9]Sous_Total_Vente [10]Remise [11]Net_A_Payer [12]Accompte
// [13]Restant [14]Mode_Depot [15]Fournisseur_Mobile [16]Reference
// [17]Caissier [18]Statut [19]Date_Finalisation [20]Vente_ID
// UNE LIGNE PAR ARTICLE — grouper par ID pour reconstruire la réservation
// ============================================================
function handleGetReservations() {
  const sh = getSS().getSheetByName(SHEET_RESERVATIONS);
  if (!sh) return { ok:true, reservations:[] };
  const rows = sh.getDataRange().getValues();
  const map = {};   // id → réservation
  const order = []; // ordre d'apparition des IDs
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    const id = String(r[0]);
    if (!map[id]) {
      const sheetStatut = String(r[18] || '');
      const status = (sheetStatut === 'Terminée' || sheetStatut === 'Terminé' || sheetStatut === 'completed')
        ? 'completed'
        : (sheetStatut === 'Annulée' || sheetStatut === 'Annulé' || sheetStatut === 'cancelled')
        ? 'cancelled'
        : 'pending';
      map[id] = {
        id,
        date:           r[1],
        clientName:     String(r[3] || ''),
        clientContact:  String(r[4] || ''),
        items:          [],
        subtotal:       Number(r[9])  || 0,
        remise:         Number(r[10]) || 0,
        total:          Number(r[11]) || 0,
        accompte:       Number(r[12]) || 0,
        acompte:        Number(r[12]) || 0,
        restant:        Number(r[13]) || 0,
        depositMethod:  String(r[14] || ''),
        depositProvider:String(r[15] || ''),
        depositRef:     String(r[16] || ''),
        caissier:       String(r[17] || ''),
        status,
        statut:         sheetStatut,
        dateFinalisation: r[19] || null,
        saleId:         r[20] || null,
        attachments:    (function() {
          try { return r[21] ? JSON.parse(String(r[21])) : []; } catch(e) { return []; }
        })(),
        deliveryMode:    String(r[22] || 'retrait'),
        deliveryAddress: String(r[23] || ''),
        deliveryFee:     Number(r[24]) || 0,
        deliveryDate:    _fmtDateCell_(r[25]),
      };
      order.push(id);
    }
    // Ajouter l'article à la liste items
    const articleName = String(r[5] || '');
    if (articleName) {
      map[id].items.push({
        name:  articleName,
        qty:   Number(r[6]) || 1,
        price: Number(r[7]) || 0,
      });
    }
  }
  const list = order.map(id => map[id]);
  return { ok:true, reservations: list.reverse() };
}

function handleAddReservation(data) {
  const ss = getSS();
  const sh = ss.getSheetByName(SHEET_RESERVATIONS);
  const r   = data.reservation;
  const now = new Date();
  const tz  = Session.getScriptTimeZone();
  const dateStr  = Utilities.formatDate(now, tz, 'dd/MM/yyyy');
  const heureStr = Utilities.formatDate(now, tz, 'HH:mm:ss');
  const id           = r.id ? String(r.id) : ('R' + now.getTime());
  const clientNom    = r.clientName    || r.client || '';
  const clientTel    = r.clientContact || r.tel    || '';
  const total        = r.total    || 0;
  const accompte     = r.accompte !== undefined ? r.accompte : (r.acompte || 0);
  const restant      = r.restant  !== undefined ? r.restant  : Math.max(0, total - accompte);
  const remise       = r.remise   || 0;
  const modeDepot    = r.depositMethod === 'cash'   ? 'Espèces'
                     : r.depositMethod === 'mobile' ? 'Mobile Money' : '';
  const fournisseur  = r.depositProvider || '';
  const reference    = r.depositRef      || '';
  const caissier     = r.caissier        || '';
  const items        = Array.isArray(r.items) ? r.items : [];
  // Infos livraison (cols 23-26, ajoutées) — migration auto si l'ancienne feuille s'arrête à 22
  const need = 26 - sh.getMaxColumns();
  if (need > 0) sh.insertColumnsAfter(sh.getMaxColumns(), need);
  const delivMode = r.deliveryMode    || 'retrait';
  const delivAddr = r.deliveryAddress || '';
  const delivFee  = Number(r.deliveryFee) || 0;
  const delivDate = r.deliveryDate    || '';

  // Métadonnées pièces jointes (fileId/URL Drive uniquement, pas de base64)
  var attachMeta = JSON.stringify(
    (Array.isArray(r.attachments) ? r.attachments : []).map(function(a) {
      return { name:a.name||'', type:a.type||'', fileId:a.fileId||'', viewUrl:a.viewUrl||'', dlUrl:a.dlUrl||'' };
    }).filter(function(a) { return a.fileId || a.viewUrl; })
  );

  if (items.length === 0) {
    // Aucun article — une ligne de repli
    sh.appendRow([id, dateStr, heureStr, clientNom, clientTel,
      '', 0, 0, 0, total, remise, total, accompte, restant,
      modeDepot, fournisseur, reference, caissier, 'En attente', '', '', attachMeta,
      delivMode, delivAddr, delivFee, delivDate]);
  } else {
    // Une ligne par article — Attachments_JSON uniquement sur la première ligne
    items.forEach(function(item, idx) {
      var sousTotal = (Number(item.price) || 0) * (Number(item.qty) || 0);
      sh.appendRow([id, dateStr, heureStr, clientNom, clientTel,
        item.name || '', Number(item.qty) || 1, Number(item.price) || 0,
        sousTotal, total, remise, total, accompte, restant,
        modeDepot, fournisseur, reference, caissier, 'En attente', '', '',
        idx === 0 ? attachMeta : '',
        delivMode, delivAddr, delivFee, delivDate]);
    });
  }
  return { ok:true, id };
}

function handleUpdateReservation(data) {
  const sh   = getSS().getSheetByName(SHEET_RESERVATIONS);
  const rows = sh.getDataRange().getValues();
  const rawStatus = data.statut || data.status;
  const sheetStatut = rawStatus === 'completed' ? 'Terminée'
                    : rawStatus === 'cancelled'  ? 'Annulée'
                    : (rawStatus || '');
  let updated = false;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(data.id)) continue;
    // Mettre à jour TOUTES les lignes de cette réservation (une par article)
    if (sheetStatut)     sh.getRange(i+1, 19).setValue(sheetStatut);   // col 19 = Statut
    if (data.dateFinalisation) sh.getRange(i+1, 20).setValue(data.dateFinalisation);
    if (data.saleId)     sh.getRange(i+1, 21).setValue(String(data.saleId));
    updated = true;
  }
  return updated ? { ok:true } : { ok:false, error:'Réservation introuvable' };
}

// Met à jour uniquement la colonne Attachments_JSON (col 22) pour une réservation
function handleUpdateReservationAttachments(data) {
  if (!data.id || !Array.isArray(data.attachments)) return { ok:false, error:'Paramètres manquants' };
  var sh   = getSS().getSheetByName(SHEET_RESERVATIONS);
  if (!sh) return { ok:false, error:'Feuille introuvable' };
  var rows = sh.getDataRange().getValues();
  var meta = JSON.stringify(data.attachments);
  var updated = false;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(data.id)) continue;
    // Écrire Attachments_JSON uniquement sur la première ligne de la réservation
    if (!updated) sh.getRange(i+1, 22).setValue(meta);
    updated = true;
    break; // une seule ligne suffit
  }
  return updated ? { ok:true } : { ok:false, error:'Réservation introuvable' };
}

// ============================================================
// COMMANDES — identiques à l'original
// ============================================================
// Parse la cellule "Pièces jointes" (JSON d'objets {name,type,fileId,viewUrl,dlUrl})
function _parseAttachments_(cell) {
  if (!cell) return [];
  try { const a = JSON.parse(cell); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}

// Formate une cellule de date en ISO 'yyyy-MM-dd'. Les cellules saisies via
// <input type="date"> ('2026-06-28') sont auto-converties en objets Date par Sheets
// (à minuit dans le fuseau du classeur) ; un simple String() renverrait une chaîne
// longue type "Sun Jun 28 2026 21:00:00 GMT+0000" — impossible à reparser côté front,
// et décalée d'un jour si on la lit en UTC. On formate donc avec le fuseau du classeur
// (round-trip exact). Si la cellule est déjà une chaîne (anciennes lignes texte), on la
// renvoie telle quelle.
function _fmtDateCell_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, getSS().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  // Anciennes cellules texte 'dd/MM/yyyy' → ISO (sortie uniforme yyyy-MM-dd)
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s;
}

// Variante affichage français 'dd/MM/yyyy' (mêmes garanties : fuseau du classeur,
// robuste si la cellule est déjà une chaîne). Pour les dates informatives (création).
function _fmtDateFr_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, getSS().getSpreadsheetTimeZone(), 'dd/MM/yyyy');
  }
  return String(v);
}

function handleGetCommandes() {
  const sh = getSS().getSheetByName(SHEET_COMMANDES);
  if (!sh) return { ok:true, commandes:[] };
  const rows = sh.getDataRange().getValues();
  // Détecter l'ancien format (colonne 3 = Fournisseur) vs nouveau (colonne 3 = Caissier)
  const isOldFormat = rows.length > 0 && String(rows[0][2] || '').toLowerCase() === 'fournisseur';
  if (isOldFormat) return { ok:true, commandes:[] };
  const map = {}, order = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    const id = String(r[0]);
    const rawStatut = String(r[19] || '');
    const status = (rawStatut === 'Terminée' || rawStatut === 'completed') ? 'completed'
                 : (rawStatut === 'Annulée'  || rawStatut === 'cancelled')  ? 'cancelled'
                 : 'pending';
    if (!map[id]) {
      map[id] = {
        id, date: r[1], caissier: String(r[2]||''),
        clientName: String(r[3]||''), clientContact: String(r[4]||''),
        items: [],
        deliveryMode: String(r[6]||'retrait'), adresseLivraison: String(r[7]||''),
        fraisLivraison: Number(r[8])||0, dateLivraison: _fmtDateCell_(r[9]),
        subtotal: Number(r[10])||0, remise: Number(r[11])||0,
        total: Number(r[12])||0, accompte: Number(r[13])||0, restant: Number(r[14])||0,
        depositMethod: String(r[15]||''), depositProvider: String(r[16]||''), depositRef: String(r[17]||''),
        notes: String(r[18]||''),
        status, statut: rawStatut,
        dateFinalisation: r[20] || null, saleId: r[21] || null,
        dateLivraisonProd: _fmtDateCell_(r[22]),
        dateBAT: _fmtDateCell_(r[23]),
        attachments: _parseAttachments_(r[24]),
        photos: []
      };
      order.push(id);
    }
    // Reconstruire items depuis la colonne Articles (format "nom×qty@prix")
    const articlesStr = String(r[5]||'');
    if (articlesStr && map[id].items.length === 0) {
      map[id].items = articlesStr.split('|').map(s => {
        const m = s.match(/^(.+)×(\d+)@(\d+)$/);
        return m ? { name:m[1], qty:Number(m[2]), price:Number(m[3]) } : { name:s, qty:1, price:0 };
      }).filter(i => i.name);
    }
  }
  return { ok:true, commandes: order.map(id => map[id]).reverse() };
}

// Détecte les cellules en erreur (#ERROR!, #REF!…) de la feuille Commandes + leur formule
// (lecture seule — sert à comprendre la source avant de corriger). Route ?action=diagCommandeErrors
var _CELL_ERR_RE_ = /^#(ERROR!|REF!|N\/A|VALUE!|NAME\?|DIV\/0!|NUM!|NULL!)/;
function diagCommandeErrors() {
  const sh = getSS().getSheetByName(SHEET_COMMANDES);
  if (!sh) return { ok:false, error:'Feuille Commandes introuvable' };
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok:true, count:0, cells:[] };
  const vals = sh.getRange(1,1,lastRow,lastCol).getValues();
  const fmls = sh.getRange(1,1,lastRow,lastCol).getFormulas();
  const out = [];
  for (let r = 1; r < lastRow; r++) {
    for (let c = 0; c < lastCol; c++) {
      const v = vals[r][c];
      if (typeof v === 'string' && _CELL_ERR_RE_.test(v)) {
        out.push({ row:r+1, col:c+1, id:vals[r][0], display:v, formula:fmls[r][c] || '' });
      }
    }
  }
  return { ok:true, count:out.length, cells:out.slice(0,200) };
}

// Corrige les cellules en erreur : récupère la valeur depuis la formule (=261… -> 261…),
// force le format TEXTE pour éviter une ré-interprétation en formule, sinon vide la cellule.
// Route ?action=fixCommandeErrors (idempotente). ⚠️ backup conseillé (?action=runBackupNow).
function fixCommandeErrors() {
  const sh = getSS().getSheetByName(SHEET_COMMANDES);
  if (!sh) return { ok:false, error:'Feuille Commandes introuvable' };
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok:true, fixed:0, report:[] };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const vals = sh.getRange(1,1,lastRow,lastCol).getValues();
    const fmls = sh.getRange(1,1,lastRow,lastCol).getFormulas();
    let fixed = 0; const report = [];
    for (let r = 1; r < lastRow; r++) {
      for (let c = 0; c < lastCol; c++) {
        const v = vals[r][c];
        if (typeof v !== 'string' || !_CELL_ERR_RE_.test(v)) continue;
        // getFormulas renvoie le texte saisi avec son préfixe (ex. "+261 34…").
        // On garde +/-/@ (légitimes dans un n° de tél / email) et on ne retire que le "=".
        const f = fmls[r][c] || '';
        const recovered = !f ? '' : (f.charAt(0) === '=' ? f.slice(1) : f);
        const cell = sh.getRange(r+1, c+1);
        cell.setNumberFormat('@'); // texte → "=…" n'est plus interprété comme formule
        cell.setValue(recovered);
        report.push({ row:r+1, col:c+1, id:vals[r][0], was:v, now:recovered });
        fixed++;
      }
    }
    return { ok:true, fixed, report:report.slice(0,200) };
  } finally { try { lock.releaseLock(); } catch(e) {} }
}

// Migration unique : rend uniques les ids de commandes en double (collisions inter-postes)
function migrateCommandeIds() {
  const sh = getSS().getSheetByName(SHEET_COMMANDES);
  if (!sh) return { ok:false, error:'Feuille Commandes introuvable' };
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok:true, fixed:0, total:0 };
  const idCells = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  const seen = {};
  let fixed = 0;
  const stamp = Date.now();
  for (let i = 0; i < idCells.length; i++) {
    const id = String(idCells[i][0] || '').trim();
    if (!id) continue;
    if (seen[id]) {
      const newId = 'CMD' + stamp + '-' + (i + 2) + '-' + Math.floor(Math.random() * 10000);
      sh.getRange(i + 2, 1).setValue(newId);
      seen[newId] = true;
      fixed++;
    } else {
      seen[id] = true;
    }
  }
  return { ok:true, fixed:fixed, total:idCells.length };
}

// Migration : supprime les lignes de dossiers EN DOUBLE (même source commande/réservation),
// héritées des anciens ids basés sur la date. Conserve le dossier le plus avancé (progression
// max) et RE-POINTE d'abord les tâches vers lui (aucune perte). Idempotente.
// Route GET ?action=migrateDedupDossiers. ⚠️ Faire un backup avant (?action=runBackupNow).
function migrateDedupDossiers() {
  const ss  = getSS();
  const shD = ss.getSheetByName(SHEET_DOSSIERS);
  if (!shD) return { ok:false, error:'Feuille Dossiers introuvable' };
  const lastRow = shD.getLastRow();
  if (lastRow < 2) return { ok:true, removed:0, total:0 };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const rows = shD.getDataRange().getValues(); // [0] = en-tête

    // Clé d'identité de la source d'une ligne dossier (col 11 = SourceVente)
    function srcKey(r) {
      const sv = String(r[10] || '');
      let m = sv.match(/Commande\s*#?\s*(\S+)/i);    if (m) return 'commande:' + m[1];
      m = sv.match(/R[ée]servation\s*#?\s*(\S+)/i);  if (m) return 'reservation:' + m[1];
      return null; // pas de source identifiable (ventes comptant, manuel…) → ne pas toucher
    }

    const groups = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[0]) continue;
      const k = srcKey(r);
      if (!k) continue;
      (groups[k] = groups[k] || []).push({ row: i + 1, id: String(r[0]), prog: Number(r[6]) || 0 });
    }

    const remap = {};        // id supprimé → id conservé
    const rowsToDelete = [];  // numéros de ligne (base 1)
    Object.keys(groups).forEach(function(k) {
      const g = groups[k];
      if (g.length < 2) return;
      let keep = g[0];
      g.forEach(function(x) { if (x.prog > keep.prog) keep = x; });
      g.forEach(function(x) {
        if (x.row === keep.row) return;
        remap[x.id] = keep.id;
        rowsToDelete.push(x.row);
      });
    });

    if (!rowsToDelete.length) return { ok:true, removed:0, total:lastRow - 1, remapped:0 };

    // 1) Re-pointer les tâches (col 2 = DossierID) vers le dossier conservé
    let tachesRepointed = 0;
    const shT = ss.getSheetByName(SHEET_TACHES);
    if (shT && shT.getLastRow() > 1) {
      const tRange = shT.getRange(2, 2, shT.getLastRow() - 1, 1);
      const tVals  = tRange.getValues();
      let changed = false;
      for (let i = 0; i < tVals.length; i++) {
        const cur = String(tVals[i][0] || '');
        if (remap[cur]) { tVals[i][0] = remap[cur]; changed = true; tachesRepointed++; }
      }
      if (changed) tRange.setValues(tVals);
    }

    // 2) Supprimer les lignes en double (du bas vers le haut pour préserver les indices)
    rowsToDelete.sort(function(a, b) { return b - a; }).forEach(function(rn) { shD.deleteRow(rn); });

    CacheService.getScriptCache().remove('dashboard_v1');
    return { ok:true, removed:rowsToDelete.length, total:lastRow - 1, remapped:tachesRepointed, groupes:Object.keys(remap).length };
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// Champs numériques ne devant jamais être négatifs (montants, quantités).
const MONTANTS_NON_NEGATIFS_ = ['fraisLivraison', 'subtotal', 'remise', 'total', 'accompte', 'restant'];
function _validerMontantsPositifs_(obj) {
  for (const champ of MONTANTS_NON_NEGATIFS_) {
    if (obj[champ] !== undefined && Number(obj[champ]) < 0) {
      return 'Montant invalide (' + champ + ' ne peut pas être négatif)';
    }
  }
  return null;
}

function handleAddCommande(data) {
  const sh = getSS().getSheetByName(SHEET_COMMANDES);
  if (!sh) return { ok:false, error:'Feuille Commandes introuvable' };
  const c = data.commande;
  const errMontant = _validerMontantsPositifs_(c || {});
  if (errMontant) return { ok:false, error: errMontant };
  const now = new Date();
  const tz  = Session.getScriptTimeZone();
  const id  = c.id ? String(c.id) : ('CMD' + now.getTime());
  const dateStr = Utilities.formatDate(now, tz, 'dd/MM/yyyy HH:mm');
  const items   = Array.isArray(c.items) ? c.items : [];
  // Sérialiser les articles en une seule cellule : "nom×qty@prix|..."
  const articlesStr = items.map(i => `${i.name||'?'}×${i.qty||1}@${i.price||0}`).join('|');
  sh.appendRow([
    id, dateStr, c.caissier||'',
    c.clientName||'', c.clientContact||'',
    articlesStr,
    c.deliveryMode||'retrait', c.adresseLivraison||'',
    Number(c.fraisLivraison)||0, c.dateLivraison||'',
    Number(c.subtotal)||0, Number(c.remise)||0,
    Number(c.total)||0, Number(c.accompte)||0, Number(c.restant)||0,
    c.depositMethod||'', c.depositProvider||'', c.depositRef||'',
    c.notes||'',
    'En attente', '', '',
    c.dateLivraisonProd||'',
    c.dateBAT||'',
    JSON.stringify(Array.isArray(c.attachments) ? c.attachments : [])
  ]);
  // Forcer nom + contact en TEXTE (un contact "+261 34…" serait sinon évalué en formule → #ERROR!)
  const _r = sh.getLastRow();
  _setTextCell_(sh, _r, 4, c.clientName||'');
  _setTextCell_(sh, _r, 5, c.clientContact||'');
  return { ok:true, id };
}

// Écrit une valeur en cellule TEXTE (format @) → un libellé commençant par "+", "=",
// "-" ou "@" (ex. numéro "+261 34…") n'est plus interprété comme une formule par Sheets.
function _setTextCell_(sh, row, col, val) {
  const cell = sh.getRange(row, col);
  cell.setNumberFormat('@');
  cell.setValue(val == null ? '' : String(val));
}

function handleUpdateCommande(data) {
  const sh = getSS().getSheetByName(SHEET_COMMANDES);
  if (!sh) return { ok:false, error:'Feuille Commandes introuvable' };
  const errMontant = _validerMontantsPositifs_(data || {});
  if (errMontant) return { ok:false, error: errMontant };
  const rows = sh.getDataRange().getValues();
  const rawStatus = data.statut || data.status;
  const sheetStatut = rawStatus === 'completed' ? 'Terminée'
                    : rawStatus === 'cancelled'  ? 'Annulée'
                    : (rawStatus || '');
  let updated = false;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(data.id)) continue;
    if (sheetStatut)          sh.getRange(i+1, 20).setValue(sheetStatut);
    if (data.dateFinalisation) sh.getRange(i+1, 21).setValue(data.dateFinalisation);
    if (data.saleId)           sh.getRange(i+1, 22).setValue(String(data.saleId));
    if (data.adresseLivraison !== undefined) sh.getRange(i+1, 8).setValue(data.adresseLivraison); // col H = Adresse_Livraison
    if (data.deliveryMode !== undefined)     sh.getRange(i+1, 7).setValue(data.deliveryMode);     // col G = Mode_Livraison
    if (data.dateLivraison !== undefined)     sh.getRange(i+1, 10).setValue(data.dateLivraison);     // col J = Date_Livraison (client)
    if (data.dateLivraisonProd !== undefined) sh.getRange(i+1, 23).setValue(data.dateLivraisonProd); // col W = Date_Livraison_Prod
    if (data.dateBAT !== undefined)           sh.getRange(i+1, 24).setValue(data.dateBAT);           // col X = Date_BAT
    if (data.fraisLivraison !== undefined)   sh.getRange(i+1, 9).setValue(Number(data.fraisLivraison)||0);  // col I = Frais_Livraison
    if (data.subtotal !== undefined)         sh.getRange(i+1, 11).setValue(Number(data.subtotal)||0);       // col K = Sous_Total
    if (data.total !== undefined)            sh.getRange(i+1, 13).setValue(Number(data.total)||0);          // col M = Total
    if (data.restant !== undefined)          sh.getRange(i+1, 15).setValue(Number(data.restant)||0);        // col O = Restant
    if (data.items !== undefined) {                                                          // col F = Articles ("nom×qty@prix|…")
      const _arts = (Array.isArray(data.items) ? data.items : [])
        .map(it => `${it.name||'?'}×${Math.round(Number(it.qty)||1)}@${Math.round(Number(it.price)||0)}`).join('|');
      sh.getRange(i+1, 6).setValue(_arts);
    }
    if (data.clientName !== undefined)       _setTextCell_(sh, i+1, 4, data.clientName);    // col D = Client_Nom (texte)
    if (data.clientContact !== undefined)    _setTextCell_(sh, i+1, 5, data.clientContact); // col E = Client_Contact (texte : évite #ERROR! sur "+261…")
    if (data.remise !== undefined)           sh.getRange(i+1, 12).setValue(Number(data.remise)||0);   // col L = Remise
    if (data.accompte !== undefined)         sh.getRange(i+1, 14).setValue(Number(data.accompte)||0); // col N = Accompte
    if (data.depositMethod !== undefined)    sh.getRange(i+1, 16).setValue(data.depositMethod);  // col P = Mode_Paiement (acompte)
    if (data.depositProvider !== undefined)  _setTextCell_(sh, i+1, 17, data.depositProvider);   // col Q = Opérateur Mobile Money — texte
    if (data.depositRef !== undefined)       _setTextCell_(sh, i+1, 18, data.depositRef);        // col R = Réf paiement (Mobile Money) — texte
    if (data.notes !== undefined)            sh.getRange(i+1, 19).setValue(data.notes);        // col S = Notes
    if (data.attachments !== undefined) {                                                      // col Y = Pièces_Jointes (JSON)
      const need = 25 - sh.getMaxColumns();
      if (need > 0) sh.insertColumnsAfter(sh.getMaxColumns(), need);
      sh.getRange(i+1, 25).setValue(JSON.stringify(Array.isArray(data.attachments) ? data.attachments : []));
    }
    updated = true;
  }
  return updated ? { ok:true } : { ok:false, error:'Commande introuvable' };
}

// ============================================================
// DOSSIERS PRODUCTION
// ============================================================
function handleGetDossiers(data) {
  const sh = getSS().getSheetByName(SHEET_DOSSIERS);
  if (!sh) return { ok:true, dossiers:[] };

  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return { ok:true, dossiers:[] };

  const LIMIT  = Number((data && data.limit)) || 300;
  const start  = Math.max(2, lastRow - LIMIT + 1);
  const nRows  = lastRow - start + 1;
  const rows   = sh.getRange(start, 1, nRows, 12).getValues();

  let list   = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; if (!r[0]) continue;
    const dc = _fmtDateFr_(r[7]);    // création : affichage dd/MM/yyyy (fuseau classeur)
    const dl = _fmtDateCell_(r[8]);  // livraison : ISO yyyy-MM-dd (harmonisé commandes/réservations)
    list.push({ id:r[0], numeroDossier:r[1], client:r[2], produit:r[3],
      quantite:Number(r[4]), statut:r[5], progression:Number(r[6]),
      dateCreation:dc, dateLivraison:dl, priorite:r[9], sourceVente:r[10], notes:r[11] });
  }

  if (data && data.statut && data.statut !== 'TOUS') {
    list = list.filter(d => d.statut === data.statut);
  }
  return { ok:true, dossiers:list.reverse() };
}

// ── Persistance dossier RES/CMD depuis le frontend ─────────
function handleSaveDossier(data) {
  const d  = data.dossier;
  if (!d || !d.id) return { ok:false, error:'dossier.id requis' };
  const ss  = getSS();
  const sh  = ensureSheet(ss, SHEET_DOSSIERS, DOSSIER_HEADERS);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(6000);
    const rows = sh.getDataRange().getValues();
    // Idempotent : ne pas créer de doublon
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(d.id)) {
        return { ok:true, created:false };
      }
    }
    const now = new Date();
    sh.appendRow([
      String(d.id),
      d.numeroDossier || '',
      d.client        || '',
      d.produit       || '',
      Number(d.quantite) || 1,
      d.statut        || 'CREE',
      Number(d.progression) || 0,
      d.dateCreation  ? new Date(d.dateCreation) : now,
      d.dateLivraison ? new Date(d.dateLivraison) : '',
      d.priorite      || 'Normale',
      d.sourceVente   || '',
      d.notes         || ''
    ]);
    _logAction_('DOSSIER_CREATE', data.createdBy || 'frontend',
      String(d.id) + ' ← ' + (d.sourceVente || ''));
    CacheService.getScriptCache().remove('dashboard_v1');
    return { ok:true, created:true };
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// Mise à jour ciblée d'un dossier existant (client / produit / quantité / date livraison).
// Utilisé quand un admin approuve une correction d'articles d'une commande.
function handleUpdateDossier(data) {
  const sh = getSS().getSheetByName(SHEET_DOSSIERS);
  if (!sh) return { ok:false, error:'Feuille Dossiers introuvable' };
  const rows = sh.getDataRange().getValues();
  let updated = false;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(data.id)) continue;
    if (data.client        !== undefined) sh.getRange(i+1, 3).setValue(data.client);          // col C = Client
    if (data.produit       !== undefined) sh.getRange(i+1, 4).setValue(data.produit);         // col D = Produit
    if (data.quantite      !== undefined) sh.getRange(i+1, 5).setValue(Number(data.quantite)||0); // col E = Quantite
    if (data.dateLivraison !== undefined) sh.getRange(i+1, 9).setValue(data.dateLivraison);   // col I = DateLivraison
    updated = true;
  }
  if (updated) CacheService.getScriptCache().remove('dashboard_v1');
  return updated ? { ok:true } : { ok:false, error:'Dossier introuvable' };
}

// ============================================================
// TÂCHES — ATTRIBUTION
// ============================================================
function handleAttribuerTache(data) {
  // Validation des entrées
  if (!data.dossierId)  return { ok:false, error:'dossierId requis' };
  if (!data.etapeCode)  return { ok:false, error:'etapeCode requis' };
  if (!data.operateur)  return { ok:false, error:'operateur requis' };
  const validEtapes = ETAPES_PROD.map(function(e) { return e.code; });
  if (!validEtapes.includes(data.etapeCode)) {
    return { ok:false, error:'etapeCode invalide : ' + data.etapeCode };
  }

  const ss   = getSS();
  const sh   = ss.getSheetByName(SHEET_TACHES);
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000);
    const now  = new Date();
    const rows = sh.getDataRange().getValues();

    // Supprimer les doublons (même dossier + étape + opérateur)
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][1] === data.dossierId && rows[i][3] === data.etapeCode && rows[i][5] === data.operateur) {
        sh.deleteRow(i + 1);
      }
    }
    // Relire après suppression pour avoir le bon dernier ID
    const rowsAfter = sh.getDataRange().getValues();
    const lastId = rowsAfter.length > 1
      ? Math.max(...rowsAfter.slice(1).map(function(r) { return Number(String(r[0]).replace('T','')) || 0; }))
      : 0;
    const tId   = 'T' + String(lastId + 1).padStart(4, '0');
    const etape = ETAPES_PROD.find(function(e) { return e.code === data.etapeCode; }) || { label:data.etapeCode };
    sh.appendRow([tId, data.dossierId, data.numeroDossier, data.etapeCode, etape.label,
      data.operateur, 'A_FAIRE', now, '', '', data.commentaire||'', data.assignePar||'Admin']);

    _logAction_('TACHE_ATTRIB', data.assignePar||'admin',
      data.operateur + ' → ' + data.etapeCode + ' (dossier:' + data.dossierId + ')');
    CacheService.getScriptCache().remove('dashboard_v1'); // invalider le dashboard
    return { ok:true, tacheId:tId };
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// ── Tâche libre (indépendante) — sync depuis app.js ────────
function handleSaveTacheLibre(data) {
  const t = data.tache;
  if (!t || !t.id)  return { ok:false, error:'tache.id requis' };
  if (!t.operateur) return { ok:false, error:'operateur requis' };

  const ss = getSS();
  const sh = ensureSheet(ss, SHEET_TACHES,
    ['ID','DossierID','NumeroDossier','EtapeCode','EtapeLabel','Operateur',
     'Statut','DateAssignation','DateDebut','DateFin','Commentaire','AssignePar',
     'Priorite','Echeance','Photos']);

  // Photos = data URLs base64 dans un tableau. On les stocke en JSON dans une cellule,
  // MAIS la limite Google Sheets est de 50 000 caractères/cellule : au-delà on n'écrit
  // pas les photos (elles restent en local côté app) pour ne pas faire échouer le write.
  const photosJson = _serializeTacheLibrePhotos_(t.photos);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(6000);
    // Idempotent : ne pas créer de doublon. Si la ligne existe déjà, on complète
    // les colonnes Priorite/Echeance/Photos si elles sont vides (backfill migration).
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(t.id)) {
        const r = rows[i];
        if (!r[12] && (t.priorite || t.echeance || photosJson)) {
          sh.getRange(i + 1, 13, 1, 3).setValues([[t.priorite || '', t.echeance || '', photosJson]]);
        }
        return { ok:true, created:false };
      }
    }
    sh.appendRow([
      String(t.id),
      'LIBRE',
      'LIBRE',
      'LIBRE',
      t.etapeLabel || t.titre || 'Tâche libre',
      t.operateur,
      'A_FAIRE',
      new Date(),
      '', '',
      t.commentaire || '',
      data.createdBy || 'admin',
      t.priorite || '',
      t.echeance || '',
      photosJson
    ]);
    _logAction_('TACHE_LIBRE_CREATE', data.createdBy || 'admin',
      String(t.id) + ' → ' + t.operateur);
    CacheService.getScriptCache().remove('dashboard_v1');
    return { ok:true, created:true };
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// Sérialise le tableau de photos en JSON borné à la limite cellule Sheets.
// En pratique le front envoie des métadonnées Drive (fileId/URL, ~qq centaines d'octets),
// pas du base64 : ça rentre toujours. Le garde-fou 45k protège contre un base64 accidentel.
// Retourne '' si absent ou trop volumineux (les photos restent alors en local seulement).
function _serializeTacheLibrePhotos_(photos) {
  if (!Array.isArray(photos) || !photos.length) return '';
  try {
    const json = JSON.stringify(photos);
    return json.length <= 45000 ? json : ''; // marge sous la limite Sheets de 50 000
  } catch (e) {
    return '';
  }
}

// Met à jour uniquement la colonne Photos (15) d'une tâche libre — appelée par le front
// après l'upload asynchrone des photos sur Drive (URLs courtes qui remplacent le base64).
function handleSetTacheLibrePhotos(data) {
  if (!data.tacheId) return { ok:false, error:'tacheId requis' };
  const ss = getSS();
  const sh = ss.getSheetByName(SHEET_TACHES);
  if (!sh) return { ok:false, error:'Feuille Taches introuvable' };
  const photosJson = _serializeTacheLibrePhotos_(data.photos);
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(6000);
    const ids = sh.getRange(2, 1, Math.max(0, sh.getLastRow() - 1), 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(data.tacheId)) {
        sh.getRange(i + 2, 15).setValue(photosJson);
        return { ok:true };
      }
    }
    return { ok:false, error:'Tâche introuvable' };
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

function handleGetTaches(data) {
  const sh = getSS().getSheetByName(SHEET_TACHES);
  if (!sh) return { ok:true, taches:[] };

  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return { ok:true, taches:[] };

  // Lecture paginée depuis la fin de la feuille. Largeur = colonnes réellement présentes
  // (min 12) : les feuilles antérieures aux colonnes Priorite/Echeance/Photos ont 12 cols,
  // les nouvelles en ont 15 → on lit ce qui existe et on défend les index manquants.
  const nCols  = Math.max(12, sh.getLastColumn());
  const LIMIT  = Number((data && data.limit)) || 500;
  const start  = Math.max(2, lastRow - LIMIT + 1);
  const nRows  = lastRow - start + 1;
  const rows   = sh.getRange(start, 1, nRows, nCols).getValues();

  const tz  = Session.getScriptTimeZone();
  const fmt = function(dt) { return dt ? Utilities.formatDate(new Date(dt), tz, 'dd/MM/yyyy HH:mm') : ''; };
  // Epoch absolu (ms) pour le chronomètre : immunise le minuteur contre tout écart
  // de fuseau entre le script (appsscript.json) et le téléphone de l'opérateur.
  // Sans ça, le front reparsait la chaîne "dd/MM/yyyy HH:mm" (formatée en TZ script)
  // comme heure locale → le minuteur sautait de l'écart de fuseau après le polling.
  const ms  = function(dt) { if (!dt) return null; const d = new Date(dt); return isNaN(d.getTime()) ? null : d.getTime(); };
  let list  = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; if (!r[0]) continue;
    const t = { id:r[0], dossierId:r[1], numeroDossier:r[2], etapeCode:r[3], etapeLabel:r[4],
      operateur:r[5], statut:r[6], dateAssignation:fmt(r[7]), dateDebut:fmt(r[8]),
      dateFin:fmt(r[9]), commentaire:r[10], assignePar:r[11],
      startTs:ms(r[8]), endTs:ms(r[9]) };
    // Champs spécifiques aux tâches libres (colonnes 13-15, absentes des tâches normales)
    if (r[12]) t.priorite = r[12];
    // Échéance : Sheets peut avoir auto-converti "yyyy-MM-dd" en Date → re-formater en
    // chaîne yyyy-MM-dd (le front fait `new Date(echeance+'T00:00:00')`).
    if (r[13]) t.echeance = (r[13] instanceof Date)
      ? Utilities.formatDate(r[13], tz, 'yyyy-MM-dd')
      : String(r[13]);
    if (r[14]) { try { t.photos = JSON.parse(r[14]); } catch (e) {} }
    if (data && data.operateur && data.operateur !== 'TOUS' && t.operateur !== data.operateur) continue;
    if (data && data.dossierId && t.dossierId !== data.dossierId) continue;
    list.push(t);
  }
  return { ok:true, taches:list };
}

function handleDeleteTache(data) {
  const sh = getSS().getSheetByName(SHEET_TACHES);
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length-1; i >= 1; i--) {
    if (rows[i][0]===data.id) {
      // Nettoyer les fichiers Drive référencés par la tâche (photos des tâches libres)
      // AVANT de supprimer la ligne — sinon ils resteraient orphelins dans POS_PiecesJointes.
      _deleteTacheDriveFiles_(rows[i][14]);
      sh.deleteRow(i+1);
      return {ok:true};
    }
  }
  return { ok:false, error:'Tâche introuvable' };
}

// Supprime (best-effort) les fichiers Drive dont les métadonnées sont stockées dans la
// colonne Photos (JSON). Silencieux : un fichier déjà supprimé ne doit pas bloquer la suppression.
function _deleteTacheDriveFiles_(photosCell) {
  if (!photosCell) return;
  let photos;
  try { photos = JSON.parse(photosCell); } catch (e) { return; }
  if (!Array.isArray(photos)) return;
  photos.forEach(function(p) {
    const fileId = p && p.fileId;
    if (!fileId) return;
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* déjà supprimé/introuvable */ }
  });
}

// ============================================================
// POINTAGE PRODUCTION
// ============================================================
function handlePointerAction(data) {
  if (!data.tacheId) return { ok:false, error:'tacheId requis' };
  if (!data.action_) return { ok:false, error:'action_ requise' };
  const validActions = ['START','END','VALIDER'];
  if (!validActions.includes(data.action_)) {
    return { ok:false, error:'action_ invalide : ' + data.action_ };
  }

  const ss   = getSS();
  const sh   = ss.getSheetByName(SHEET_TACHES);
  const now  = new Date();
  const rows = sh.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] !== data.tacheId) continue;

    // Batch write : une seule requête getRange/setValues au lieu de 3 setValue séparés
    const rowData = rows[i].slice();
    if (data.action_ === 'START') {
      rowData[6] = 'EN_COURS';
      rowData[8] = now;
      // rowData.length (pas 12 en dur) : préserve les colonnes 13-15 (Priorite/Echeance/
      // Photos) des tâches libres, sinon setValues échoue (largeur ≠ celle du range).
      sh.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      _logAction_('TACHE_START', data.operateur||String(rows[i][5]),
        'Tâche:' + data.tacheId + ' étape:' + rows[i][3]);
    } else {
      rowData[6]  = 'TERMINE';
      rowData[9]  = now;
      if (data.commentaire) rowData[10] = data.commentaire;
      sh.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      _logAction_('TACHE_FIN', data.operateur||String(rows[i][5]),
        'Tâche:' + data.tacheId + ' étape:' + rows[i][3]);
      const dossierId_  = rows[i][1];
      const etapeCode_  = data.etapeCode || rows[i][3];
      // Relire les tâches après écriture pour avoir l'état à jour
      const allRows     = sh.getDataRange().getValues();
      const tachesEtape = allRows.slice(1).filter(function(r) {
        return r[1] === dossierId_ && r[3] === etapeCode_;
      });
      const toutesTerminees = tachesEtape.length > 0 &&
        tachesEtape.every(function(r) { return r[6] === 'TERMINE'; });
      if (toutesTerminees) {
        majProgressionDossier_(ss, dossierId_, etapeCode_);
      }
    }
    CacheService.getScriptCache().remove('dashboard_v1'); // invalider le dashboard
    return { ok:true };
  }
  return { ok:false, error:'Tâche introuvable' };
}

function majProgressionDossier_(ss, dossierId, etapeCode) {
  const sh  = ss.getSheetByName(SHEET_DOSSIERS);
  if (!sh) return;
  const idx = ETAPES_PROD.findIndex(function(e) { return e.code === etapeCode; });
  if (idx < 0) return;
  const next = ETAPES_PROD[idx + 1];

  // Recherche le dossier sur toute la feuille (pas seulement les dossiers récents :
  // un dossier ancien ne se voyait plus mettre à jour sa progression au-delà des 200
  // dernières lignes). TextFinder évite de rapatrier toutes les colonnes en mémoire.
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return;
  const match = sh.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(dossierId).matchEntireCell(true).findNext();
  if (!match) return;
  const rowNum = match.getRow();

  const nouveauStatut = next ? next.code : 'LIVRE';
  const progression   = ETAPES_PROD[idx].progress;
  sh.getRange(rowNum, 6, 1, 2).setValues([[nouveauStatut, progression]]);
  if (nouveauStatut === 'LIVRE') {
    sh.getRange(rowNum, 9, 1, 1).setValue(new Date()); // DateLivraison (col 9)
  }
}

// ============================================================
// DASHBOARD UNIFIÉ
// ============================================================
function handleGetDashboard() {
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'dashboard_v1';
  const cached   = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }

  const ss  = getSS();

  // Ventes : lire les 2 000 dernières lignes seulement (KPI du mois courant)
  let totalVentes = 0, nbVentes = 0;
  const shVentes  = ss.getSheetByName(SHEET_SALES);
  if (shVentes && shVentes.getLastRow() > 1) {
    const vLast  = shVentes.getLastRow();
    const vStart = Math.max(2, vLast - 1999);
    const venteRows = shVentes.getRange(vStart, 1, vLast - vStart + 1, 8).getValues();
    const seen = {};
    for (let i = 0; i < venteRows.length; i++) {
      const id = String(venteRows[i][0]);
      if (!seen[id]) { seen[id] = true; nbVentes++; totalVentes += Number(venteRows[i][7]) || 0; }
    }
  }

  // Dossiers : lire les 500 derniers
  const kpi = { total:0, cree:0, enCours:0, livre:0 };
  const shDoss = ss.getSheetByName(SHEET_DOSSIERS);
  if (shDoss && shDoss.getLastRow() > 1) {
    const dLast  = shDoss.getLastRow();
    const dStart = Math.max(2, dLast - 499);
    const dossRows = shDoss.getRange(dStart, 1, dLast - dStart + 1, 6).getValues();
    for (let i = 0; i < dossRows.length; i++) {
      const r = dossRows[i]; if (!r[0]) continue; kpi.total++;
      const s = String(r[5]);
      if (s === 'CREE') kpi.cree++;
      else if (s === 'LIVRE') kpi.livre++;
      else kpi.enCours++;
    }
  }

  // Tâches : lire les 500 dernières
  const opStats = {};
  const shTaches = ss.getSheetByName(SHEET_TACHES);
  if (shTaches && shTaches.getLastRow() > 1) {
    const tLast  = shTaches.getLastRow();
    const tStart = Math.max(2, tLast - 499);
    const tacheRows = shTaches.getRange(tStart, 1, tLast - tStart + 1, 7).getValues();
    for (let i = 0; i < tacheRows.length; i++) {
      const r = tacheRows[i]; if (!r[0]) continue;
      const op = String(r[5]);
      if (!opStats[op]) opStats[op] = { nom:op, aFaire:0, enCours:0, termine:0 };
      if (r[6] === 'A_FAIRE')   opStats[op].aFaire++;
      if (r[6] === 'EN_COURS')  opStats[op].enCours++;
      if (r[6] === 'TERMINE')   opStats[op].termine++;
    }
  }

  const result = {
    ok:true,
    ventes:     { total:totalVentes, nb:nbVentes },
    dossiers:   kpi,
    operateurs: Object.values(opStats)
  };
  try { cache.put(cacheKey, JSON.stringify(result), 180); } catch(e) {} // cache 3 min
  return result;
}

// ============================================================
// CONTRÔLE PATRON — agrégation financière par période
// Ventes (terminées, encaissées) + Commandes/Réservations EN COURS
// (non finalisées). Pas de double compte : une commande/réservation
// finalisée (Vente_ID rempli) est déjà comptée dans Ventes.
// Filtre [from,to] en epoch ms (calculés côté client selon la période).
// ============================================================
function handleGetControlPatron(data) {
  data = data || {};
  var from = (data.from !== undefined && data.from !== null && data.from !== '') ? Number(data.from) : null;
  var to   = (data.to   !== undefined && data.to   !== null && data.to   !== '') ? Number(data.to)   : null;
  function inRange_(v) {
    if (from === null && to === null) return true;
    var d = _ctrlParseDate(v);
    if (!d) return false;
    var t = d.getTime();
    if (from !== null && t < from) return false;
    if (to   !== null && t > to)   return false;
    return true;
  }

  var ss = getSS();
  var totals = { engage:0, encaisse:0, restant:0, nbVentes:0, nbEnCours:0 };
  var parCais = {}, parClient = {};
  function cais_(nom) {
    var n = String(nom || '').trim() || 'Inconnu';
    if (!parCais[n]) parCais[n] = { nom:n, nb:0, nbVentes:0, engage:0, encaisse:0, restant:0 };
    return parCais[n];
  }
  function client_(nom) {
    var n = String(nom || '').trim() || 'Sans nom';
    if (!parClient[n]) parClient[n] = { client:n, nb:0, engage:0, accompte:0, restant:0 };
    return parClient[n];
  }

  // ── Ventes (terminées) — multi-lignes par ID ──
  var shV = ss.getSheetByName(SHEET_SALES);
  if (shV && shV.getLastRow() > 1) {
    var vRows = shV.getRange(2, 1, shV.getLastRow() - 1, 12).getValues();
    var vSeen = {};
    for (var i = 0; i < vRows.length; i++) {
      var vid = String(vRows[i][0]); if (!vid || vSeen[vid]) continue;
      vSeen[vid] = true;
      if (!inRange_(vRows[i][1])) continue;
      var tot = Number(vRows[i][7]) || 0;
      totals.engage += tot; totals.encaisse += tot; totals.nbVentes++;
      var cv = cais_(vRows[i][11]); cv.nb++; cv.nbVentes++; cv.engage += tot; cv.encaisse += tot;
    }
  }

  // ── Commandes EN COURS (Statut != Annulée, Vente_ID vide) ──
  var shC = ss.getSheetByName(SHEET_COMMANDES);
  if (shC && shC.getLastRow() > 1) {
    var cRows = shC.getRange(2, 1, shC.getLastRow() - 1, 22).getValues();
    for (var j = 0; j < cRows.length; j++) {
      var rc = cRows[j]; if (!rc[0]) continue;
      if (String(rc[21] || '').trim()) continue;                 // finalisée → dans Ventes
      var stC = String(rc[19] || '');
      if (stC === 'Annulée' || stC === 'Annulé') continue;
      if (!inRange_(rc[1])) continue;
      var tC = Number(rc[12]) || 0, aC = Number(rc[13]) || 0, reC = Number(rc[14]) || 0;
      totals.engage += tC; totals.encaisse += aC; totals.restant += reC; totals.nbEnCours++;
      var ccC = cais_(rc[2]); ccC.nb++; ccC.engage += tC; ccC.encaisse += aC; ccC.restant += reC;
      var clC = client_(rc[3]); clC.nb++; clC.engage += tC; clC.accompte += aC; clC.restant += reC;
    }
  }

  // ── Réservations EN COURS — multi-lignes par ID ──
  var shR = ss.getSheetByName(SHEET_RESERVATIONS);
  if (shR && shR.getLastRow() > 1) {
    var rRows = shR.getRange(2, 1, shR.getLastRow() - 1, 22).getValues();
    var rSeen = {};
    for (var k = 0; k < rRows.length; k++) {
      var rr = rRows[k]; var rid = String(rr[0]); if (!rid || rSeen[rid]) continue;
      rSeen[rid] = true;
      if (String(rr[20] || '').trim()) continue;                 // finalisée → dans Ventes
      var stR = String(rr[18] || '');
      if (stR === 'Annulée' || stR === 'Annulé') continue;
      if (!inRange_(rr[1])) continue;
      var tR = Number(rr[11]) || 0, aR = Number(rr[12]) || 0, reR = Number(rr[13]) || 0;
      totals.engage += tR; totals.encaisse += aR; totals.restant += reR; totals.nbEnCours++;
      var ccR = cais_(rr[17]); ccR.nb++; ccR.engage += tR; ccR.encaisse += aR; ccR.restant += reR;
      var clR = client_(rr[3]); clR.nb++; clR.engage += tR; clR.accompte += aR; clR.restant += reR;
    }
  }

  var caissiers = Object.keys(parCais).map(function(x){ return parCais[x]; })
    .sort(function(a, b){ return b.engage - a.engage; });
  var clients = Object.keys(parClient).map(function(x){ return parClient[x]; })
    .filter(function(c){ return c.restant > 0; })
    .sort(function(a, b){ return b.restant - a.restant; });

  // ── VENTES PAR JOUR : chaque entrée POS comptée comme une vente à sa DATE D'ENTRÉE ──
  // (commandes + réservations + ventes comptant ; chaque transaction comptée une seule fois)
  var parJour = {};
  var tz = Session.getScriptTimeZone();
  function jourKey_(v) { var d = _ctrlParseDate(v); return d ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : null; }
  function addJour_(v, montant) {
    var j = jourKey_(v); if (!j) return;
    if (!parJour[j]) parJour[j] = { jour:j, nb:0, montant:0 };
    parJour[j].nb++; parJour[j].montant += (Number(montant) || 0);
  }
  var finalizedIds = {};
  if (shC && shC.getLastRow() > 1) {
    var cJ = shC.getRange(2, 1, shC.getLastRow() - 1, 22).getValues();
    for (var ja = 0; ja < cJ.length; ja++) {
      var rcj = cJ[ja]; if (!rcj[0]) continue;
      var vidc = String(rcj[21] || '').trim(); if (vidc) finalizedIds[vidc] = true;
      var stc = String(rcj[19] || ''); if (stc === 'Annulée' || stc === 'Annulé') continue;
      if (!inRange_(rcj[1])) continue;
      addJour_(rcj[1], rcj[12]);
    }
  }
  if (shR && shR.getLastRow() > 1) {
    var rJ = shR.getRange(2, 1, shR.getLastRow() - 1, 22).getValues();
    var rSeenJ = {};
    for (var jb = 0; jb < rJ.length; jb++) {
      var rrj = rJ[jb]; var ridj = String(rrj[0]); if (!ridj || rSeenJ[ridj]) continue; rSeenJ[ridj] = true;
      var vidr = String(rrj[20] || '').trim(); if (vidr) finalizedIds[vidr] = true;
      var str = String(rrj[18] || ''); if (str === 'Annulée' || str === 'Annulé') continue;
      if (!inRange_(rrj[1])) continue;
      addJour_(rrj[1], rrj[11]);
    }
  }
  if (shV && shV.getLastRow() > 1) {
    var vJ = shV.getRange(2, 1, shV.getLastRow() - 1, 12).getValues();
    var vSeenJ = {};
    for (var jc = 0; jc < vJ.length; jc++) {
      var vrj = vJ[jc]; var vidj = String(vrj[0]); if (!vidj || vSeenJ[vidj]) continue; vSeenJ[vidj] = true;
      if (finalizedIds[vidj]) continue;     // déjà comptée via sa commande/réservation
      if (!inRange_(vrj[1])) continue;
      addJour_(vrj[1], vrj[7]);
    }
  }
  var jours = Object.keys(parJour).map(function(k){ return parJour[k]; })
    .sort(function(a, b){ return a.jour < b.jour ? 1 : (a.jour > b.jour ? -1 : 0); });

  return { ok:true, totals:totals, parCaissier:caissiers, parClient:clients, parJour:jours };
}

function _ctrlParseDate(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = String(v || '').trim(); if (!s) return null;
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  var d = new Date(s); return isNaN(d.getTime()) ? null : d;
}

// ============================================================
// COMMENTAIRES DOSSIER
// ============================================================
const SHEET_COMMENTS = 'Commentaires';

function handleGetComments(data) {
  const dossierId = data.dossierId || '';
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ensureSheet(ss, SHEET_COMMENTS,
    ['ID','DossierID','NumeroDossier','Auteur','Role','Texte','Mentions','Attachments','Timestamp']);
  const rows = sh.getDataRange().getValues().slice(1);
  const comments = rows
    .filter(r => !dossierId || String(r[1]) === String(dossierId))
    .map(r => ({
      id:            String(r[0]),
      dossierId:     String(r[1]),
      numeroDossier: String(r[2]),
      author:        String(r[3]),
      authorRole:    String(r[4]),
      text:          String(r[5]),
      mentions:      _safeParse(r[6], []),
      attachments:   _safeParse(r[7], []),
      timestamp:     String(r[8])
    }));
  return { ok: true, comments };
}

function handleAddComment(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ensureSheet(ss, SHEET_COMMENTS,
    ['ID','DossierID','NumeroDossier','Auteur','Role','Texte','Mentions','Attachments','Timestamp']);
  const id = data.id || ('CMT_' + Date.now() + '_' + Math.random().toString(36).slice(2,6));
  sh.appendRow([
    id,
    data.dossierId     || '',
    data.numeroDossier || '',
    data.author        || '',
    data.authorRole    || '',
    data.text          || '',
    JSON.stringify(data.mentions     || []),
    JSON.stringify(data.attachments  || []),
    data.timestamp     || new Date().toISOString()
  ]);
  return { ok: true, commentId: id };
}

function _safeParse(val, fallback) {
  try { return val ? JSON.parse(val) : fallback; } catch(e) { return fallback; }
}

// ============================================================
// EFFACER TOUTES LES DONNÉES (garde Utilisateurs / Config / Journal)
// ============================================================
function handleClearAllData(data) {
  // Onglets de données à vider (on conserve les en-têtes, ligne 1)
  const sheetsToClear = [
    SHEET_PRODUCTS, SHEET_SALES, SHEET_STOCK_LOG,
    SHEET_RESERVATIONS, SHEET_COMMANDES,
    SHEET_DOSSIERS, SHEET_TACHES,
    SHEET_COMMENTS, SHEET_NOTIFS
  ];
  // Option : effacer aussi la messagerie / commentaires ? (par défaut oui)
  const ss = getSS();
  const cleared = [];
  sheetsToClear.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow > 1 && lastCol > 0) {
      sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
      cleared.push(name);
    }
  });
  return { ok:true, cleared, message: 'Données effacées : ' + (cleared.join(', ') || 'aucune') };
}

// ============================================================
// UPLOAD FICHIERS → GOOGLE DRIVE
// ============================================================
const ALLOWED_MIMES_  = [
  'image/jpeg','image/png','image/webp','image/gif','application/pdf',
  'application/msword',                                                       // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  // .docx
  'application/vnd.ms-excel',                                                 // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        // .xlsx
  'text/csv'                                                                  // .csv
];
const MAX_FILE_BYTES_ = 10 * 1024 * 1024; // 10 Mo

// Déduit le type MIME depuis l'extension du fichier — certains navigateurs n'envoient
// pas file.type pour les .docx/.xlsx (vide ou "application/octet-stream").
const EXT_MIMES_ = {
  jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif',
  pdf:'application/pdf',
  doc:'application/msword',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv:'text/csv'
};
function _mimeFromExt_(fileName) {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  return EXT_MIMES_[ext] || '';
}

function _getPOSAttachmentsFolder() {
  const FOLDER_NAME = 'POS_PiecesJointes';
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
  // Rendre le dossier accessible à tous sans compte Google
  try {
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(e) { /* ignore si déjà configuré */ }
  return folder;
}

function handleGetDriveFolderUrl() {
  try {
    const folder = _getPOSAttachmentsFolder();
    const folderId = folder.getId();
    // URL directe — accessible sans compte Google (anyone with link)
    return {
      ok: true,
      url: 'https://drive.google.com/drive/folders/' + folderId + '?usp=sharing',
      folderId: folderId
    };
  } catch(e) {
    return { ok:false, error: e.message };
  }
}

function handleGetSharedFiles() {
  try {
    const folder = _getPOSAttachmentsFolder();
    const files  = [];
    const it     = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      files.push({
        id       : f.getId(),
        name     : f.getName(),
        mimeType : f.getMimeType(),
        size     : f.getSize(),
        date     : f.getDateCreated().toISOString(),
        viewUrl  : 'https://drive.google.com/uc?id=' + f.getId() + '&export=view',
        dlUrl    : 'https://drive.google.com/uc?id=' + f.getId() + '&export=download'
      });
    }
    // Plus récents en premier
    files.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { ok: true, files: files };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function handleUploadFile(data) {
  try {
    const fileName = data.fileName || ('fichier_' + Date.now());
    // Certains navigateurs n'envoient pas le type MIME des .docx/.xlsx (vide ou
    // application/octet-stream) → le déduire de l'extension du nom de fichier.
    let mimeType = data.mimeType || '';
    if (!mimeType || mimeType === 'application/octet-stream') {
      mimeType = _mimeFromExt_(fileName) || mimeType || 'application/octet-stream';
    }

    // Validation du type MIME
    if (!ALLOWED_MIMES_.includes(mimeType)) {
      return { ok:false, error:'Type de fichier non autorisé. Formats acceptés : images, PDF, Word, Excel.' };
    }

    const base64     = data.base64Data || '';
    const base64Pure = base64.includes(',') ? base64.split(',')[1] : base64;
    const bytes      = Utilities.base64Decode(base64Pure);

    // Validation de la taille (10 Mo max)
    if (bytes.length > MAX_FILE_BYTES_) {
      return { ok:false, error:'Fichier trop volumineux (max 10 Mo).' };
    }

    const blob   = Utilities.newBlob(bytes, mimeType, fileName);
    const folder = _getPOSAttachmentsFolder();
    const file   = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileId  = file.getId();
    const viewUrl = 'https://drive.google.com/file/d/' + fileId + '/view';
    const dlUrl   = 'https://drive.google.com/uc?id=' + fileId + '&export=download';
    return { ok:true, fileId, viewUrl, dlUrl, fileName };
  } catch(err) {
    return { ok:false, error: err.message };
  }
}

// ============================================================
// NOTIFICATIONS — partagées entre tous les opérateurs
// ============================================================
const SHEET_NOTIFS = 'Notifications';

function handleGetNotifs(data) {
  const since = data.since || '';
  const ss = getSS();
  const sh = ensureSheet(ss, SHEET_NOTIFS,
    ['ID','Timestamp','DossierID','NumeroDossier','EtapeCode','EtapeLabel','Operateur','Message']);

  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return { ok: true, notifs: [] };

  // Lire uniquement les 300 dernières lignes (appendRow ajoute en bas → les plus récentes y sont)
  // Évite le scan linéaire de toute la feuille quand elle grossit
  const startRow = Math.max(2, lastRow - 299);
  const numRows  = lastRow - startRow + 1;
  const rows = sh.getRange(startRow, 1, numRows, 8).getValues()
    .filter(r => r[0]); // ignorer lignes vides

  const notifs = rows
    .map(r => ({
      id:            String(r[0]),
      timestamp:     String(r[1]),
      dossierId:     String(r[2]),
      numeroDossier: String(r[3]),
      etapeCode:     String(r[4]),
      etapeLabel:    String(r[5]),
      operateur:     String(r[6]),
      message:       String(r[7]),
      readBy:        []
    }))
    .filter(n => !since || n.timestamp >= since)
    .slice(-50); // 50 dernières suffisent pour un poll delta
  return { ok: true, notifs };
}

function handleSaveNotif(data) {
  const ss = getSS();
  const sh = ensureSheet(ss, SHEET_NOTIFS,
    ['ID','Timestamp','DossierID','NumeroDossier','EtapeCode','EtapeLabel','Operateur','Message']);
  sh.appendRow([
    data.id            || ('N_' + Date.now()),
    data.timestamp     || new Date().toISOString(),
    data.dossierId     || '',
    data.numeroDossier || '',
    data.etapeCode     || '',
    data.etapeLabel    || '',
    data.operateur     || '',
    data.message       || ''
  ]);
  return { ok: true };
}

// ============================================================
// MODIFICATIONS COMMANDES — demandes commerciaux + validation admin
// ============================================================
const SHEET_MODIFS = 'ModifsCommandes';
const MODIFS_HEADERS = ['ID','CommandeID','Timestamp','Auteur','AuteurLabel','Type','Changes','Reason','Statut','ResoluPar','ResoluLe','Motif'];

function handleSaveModif(data) {
  const ss = getSS();
  const sh = ensureSheet(ss, SHEET_MODIFS, MODIFS_HEADERS);
  // Une seule demande en attente par commande : marquer les anciennes "superseded"
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === String(data.commandeId) && String(rows[i][8]) === 'pending') {
      sh.getRange(i + 1, 9).setValue('superseded');
    }
  }
  sh.appendRow([
    data.id            || ('M_' + Date.now()),
    String(data.commandeId || ''),
    data.timestamp     || new Date().toISOString(),
    data.auteur        || '',
    data.auteurLabel   || '',
    data.type          || 'edit',
    JSON.stringify(data.changes || {}),
    data.reason        || '',
    'pending', '', '', ''
  ]);
  return { ok: true };
}

function handleGetModifs(data) {
  const ss = getSS();
  const sh = ensureSheet(ss, SHEET_MODIFS, MODIFS_HEADERS);
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return { ok: true, modifs: [] };
  const startRow = Math.max(2, lastRow - 299);
  const rows = sh.getRange(startRow, 1, lastRow - startRow + 1, 12).getValues().filter(r => r[0]);
  const modifs = rows.map(r => ({
    id:          String(r[0]),
    commandeId:  String(r[1]),
    timestamp:   String(r[2]),
    auteur:      String(r[3]),
    auteurLabel: String(r[4]),
    type:        String(r[5]),
    changes:     (function(){ try { return JSON.parse(r[6] || '{}'); } catch(e) { return {}; } })(),
    reason:      String(r[7]),
    statut:      String(r[8]),
    resoluPar:   String(r[9]),
    resoluLe:    String(r[10]),
    motif:       String(r[11])
  }));
  return { ok: true, modifs };
}

function handleResolveModif(data) {
  const sh = getSS().getSheetByName(SHEET_MODIFS);
  if (!sh) return { ok: false, error: 'Feuille ModifsCommandes introuvable' };
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sh.getRange(i + 1, 9).setValue(data.statut || 'approved');
      sh.getRange(i + 1, 10).setValue(data.resoluPar || '');
      sh.getRange(i + 1, 11).setValue(new Date().toISOString());
      sh.getRange(i + 1, 12).setValue(data.motif || '');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Demande introuvable' };
}

// ============================================================
// CONFIG BOUTIQUE — partagée entre tous les postes
// ============================================================
const SHEET_CONFIG = 'ConfigBoutique';

function handleSaveShopConfig(data) {
  const ss = getSS();
  const sh = ensureSheet(ss, SHEET_CONFIG, ['Cle', 'Valeur', 'MiseAJour']);
  const config = data.config || {};
  const now = new Date();

  // Lire les lignes existantes pour savoir quelles clés existent déjà
  const rows = sh.getDataRange().getValues();
  const keyMap = {}; // cle → numéro de ligne (1-based)
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) keyMap[String(rows[i][0])] = i + 1;
  }

  // Sauvegarder chaque clé de la config (une ligne par clé)
  Object.entries(config).forEach(([key, val]) => {
    const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (keyMap[key]) {
      sh.getRange(keyMap[key], 2, 1, 2).setValues([[strVal, now]]);
    } else {
      sh.appendRow([key, strVal, now]);
    }
  });

  return { ok: true };
}

function handleGetShopConfig() {
  const ss = getSS();
  const sh = ss.getSheetByName(SHEET_CONFIG);
  if (!sh) return { ok: true, config: {} };

  const rows = sh.getDataRange().getValues();
  const config = {};
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][0] || '').trim();
    const val = rows[i][1];
    if (!key) continue;
    try {
      const parsed = JSON.parse(val);
      config[key] = parsed;
    } catch(e) {
      config[key] = val;
    }
  }
  // Toujours inclure l'URL du dossier Drive partagé
  try {
    const folder = _getPOSAttachmentsFolder();
    config.driveFolderUrl = 'https://drive.google.com/drive/folders/' + folder.getId() + '?usp=sharing';
  } catch(e) { /* silencieux */ }
  return { ok: true, config };
}

// ============================================================
// BACKUP AUTOMATIQUE — copie quotidienne dans Google Drive
// ============================================================

function dailyBackup() {
  try {
    const now        = new Date();
    const tz         = Session.getScriptTimeZone();
    const dateStr    = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const backupName = 'Backup_POS_' + dateStr;
    const folderName = 'POS_Backups';

    const folders = DriveApp.getFoldersByName(folderName);
    const folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

    // Supprimer les backups de plus de 30 jours
    const files = folder.getFiles();
    const limit = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    while (files.hasNext()) {
      const f = files.next();
      if (f.getDateCreated() < limit) f.setTrashed(true);
    }

    // Copier le fichier Sheets entier
    const file = DriveApp.getFileById(SHEET_ID);
    file.makeCopy(backupName, folder);

    _logAction_('BACKUP_AUTO', 'système', backupName + ' créé dans ' + folderName);
    return { ok:true, message:'Backup créé : ' + backupName };
  } catch(err) {
    _logAction_('BACKUP_ERREUR', 'système', err.message);
    return { ok:false, error:err.message };
  }
}

function createDailyBackupTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const exists   = triggers.some(t => t.getHandlerFunction() === 'dailyBackup');
  if (!exists) {
    ScriptApp.newTrigger('dailyBackup')
      .timeBased().atHour(2).everyDays(1).create();
  }
  return { ok:true, message:'Trigger backup quotidien ' + (exists ? 'déjà actif' : 'créé (2h du matin)') };
}

// ============================================================
// RYTHME DE PRODUCTION — sauvegarde / lecture
// ============================================================

function handleSaveRythme(data) {
  const ss  = getSS();
  const sh  = ensureSheet(ss, SHEET_CONFIG, ['Cle', 'Valeur', 'MiseAJour']);
  const key = 'rythme_production';
  const val = JSON.stringify(data.rythme || {});
  const now = new Date();

  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === key) {
      sh.getRange(i + 1, 2, 1, 2).setValues([[val, now]]);
      return { ok: true };
    }
  }
  sh.appendRow([key, val, now]);
  return { ok: true };
}

// ── Lecture du journal d'audit (admin uniquement côté frontend) ──
function handleGetJournal(params) {
  const ss = getSS();
  const sh = ss.getSheetByName(SHEET_JOURNAL);
  if (!sh) return { ok:true, entries:[] };
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return { ok:true, entries:[] };
  const limit   = Math.min(Number(params && params.limit) || 100, 500);
  const start   = Math.max(2, lastRow - limit + 1);
  const nRows   = lastRow - start + 1;
  const rows    = sh.getRange(start, 1, nRows, 5).getValues();
  const tz      = Session.getScriptTimeZone();
  const entries = rows
    .filter(r => r[0])
    .map(r => ({
      ts:      r[0] ? Utilities.formatDate(new Date(r[0]), tz, 'dd/MM/yyyy HH:mm:ss') : '',
      user:    String(r[1]),
      action:  String(r[2]),
      detail:  String(r[3])
    }))
    .reverse(); // plus récent en premier
  return { ok:true, entries };
}

function handleGetRythme() {
  const ss = getSS();
  const sh = ss.getSheetByName(SHEET_CONFIG);
  if (!sh) return { ok: true, rythme: null };

  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === 'rythme_production') {
      try   { return { ok: true, rythme: JSON.parse(rows[i][1]) }; }
      catch (e) { return { ok: true, rythme: null }; }
    }
  }
  return { ok: true, rythme: null };
}
