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
const SHEET_OPERATEURS = 'Operateurs';

// Étapes de production
const ETAPES_PROD = [
  { code:'PAO',        label:'PAO / Conception',  progress:20 },
  { code:'BAT',        label:'BAT validé',         progress:35 },
  { code:'ACHAT',      label:'Achat matières',     progress:55 },
  { code:'PRODUCTION', label:'Production atelier', progress:75 },
  { code:'FINITION',   label:'Finition',           progress:90 },
  { code:'LIVRE',      label:'Livré',              progress:100 },
];

// ============================================================
// ROUTEUR — POST
// ============================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result;

    // POS existant — inchangé
    if      (action === 'login')             result = handleLogin(data);
    else if (action === 'getProducts')       result = handleGetProducts();
    else if (action === 'saveProduct')       result = handleSaveProduct(data);
    else if (action === 'deleteProduct')     result = handleDeleteProduct(data);
    else if (action === 'addSale')           result = handleAddSale(data);
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
    else if (action === 'getOperateurs')     result = handleGetOperateurs();
    else if (action === 'saveOperateur')     result = handleSaveOperateur(data);
    else if (action === 'attribuerTache')    result = handleAttribuerTache(data);
    else if (action === 'getTaches')         result = handleGetTaches(data);
    else if (action === 'deleteTache')       result = handleDeleteTache(data);
    else if (action === 'pointerAction')     result = handlePointerAction(data);
    else if (action === 'getDashboard')      result = handleGetDashboard();
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
      else if (action === 'saveProduct')       result = handleSaveProduct(data);
      else if (action === 'deleteProduct')     result = handleDeleteProduct(data);
      else if (action === 'stockMove')         result = handleStockMove(data);
      else if (action === 'saveUser')          result = handleSaveUser(data);
      else if (action === 'deleteUser')        result = handleDeleteUser(data);
      else if (action === 'addReservation')    result = handleAddReservation(data);
      else if (action === 'updateReservation') result = handleUpdateReservation(data);
      else if (action === 'addCommande')       result = handleAddCommande(data);
      else if (action === 'updateCommande')    result = handleUpdateCommande(data);
      else if (action === 'attribuerTache')    result = handleAttribuerTache(data);
      else if (action === 'pointerAction')     result = handlePointerAction(data);
      else if (action === 'saveOperateur')     result = handleSaveOperateur(data);
      else if (action === 'deleteTache')       result = handleDeleteTache(data);
      else result = { ok:false, error:'Action payload inconnue: ' + action };
      return jsonResp(result);
    } catch(err) {
      return jsonResp({ ok:false, error:'Payload invalide: ' + err.message });
    }
  }

  try {
    const action = e.parameter.action || 'ping';
    if (action === 'ping')            return jsonResp({ ok:true, message:'FOREVER MG POS actif ✅' });
    if (action === 'login')           return jsonResp(handleLogin({ username:e.parameter.username||'', password:e.parameter.password||'' }));
    if (action === 'getProducts')     return jsonResp(handleGetProducts());
    if (action === 'getSales')        return jsonResp(handleGetSales(e.parameter));
    if (action === 'getUsers')        return jsonResp(handleGetUsers());
    if (action === 'getReservations') return jsonResp(handleGetReservations());
    if (action === 'getCommandes')    return jsonResp(handleGetCommandes());
    if (action === 'getDossiers')     return jsonResp(handleGetDossiers(e.parameter));
    if (action === 'getOperateurs')   return jsonResp(handleGetOperateurs());
    if (action === 'getTaches')       return jsonResp(handleGetTaches(e.parameter));
    if (action === 'getDashboard')    return jsonResp(handleGetDashboard());
    if (action === 'initSheets')      return jsonResp(initSheets());
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
  ensureSheet(ss, SHEET_SALES,      ['ID','Date','Heure','Article','Quantite','Prix_Unitaire','Sous_Total','Total_Vente','Paiement','Fournisseur','Reference','Caissier']);
  ensureSheet(ss, SHEET_STOCK_LOG,  ['Date','Article','Type','Quantite','Stock_Avant','Stock_Apres','Motif','Caissier']);
  ensureSheet(ss, SHEET_USERS,      ['Username','MotDePasse','Role','Nom','Actif']);
  ensureSheet(ss, SHEET_RESERVATIONS,['ID','Date','Client','Tel','Produit','Quantite','Acompte','Statut','Notes','Caissier']);
  ensureSheet(ss, SHEET_COMMANDES,  ['ID','Date','Fournisseur','Produit','Quantite','PrixUnit','Total','Statut','Notes','Admin']);

  // Nouvelles feuilles production
  ensureSheet(ss, SHEET_DOSSIERS,   ['ID','NumeroDossier','Client','Produit','Quantite','Statut','Progression','DateCreation','DateLivraison','Priorite','SourceVente','Notes']);
  ensureSheet(ss, SHEET_TACHES,     ['ID','DossierID','NumeroDossier','Etape','EtapeLabel','Operateur','Statut','DateAssignation','DateDebut','DateFin','Commentaire','AssignePar']);
  ensureSheet(ss, SHEET_OPERATEURS, ['Nom','Role','Actif']);

  // Opérateurs de démonstration si vide
  const osh = ss.getSheetByName(SHEET_OPERATEURS);
  if (osh.getLastRow() < 2) {
    osh.appendRow(['Marie', 'operateur', 'oui']);
    osh.appendRow(['Jean',  'operateur', 'oui']);
    osh.appendRow(['Paul',  'operateur', 'oui']);
  }

  return { ok:true, message:'Feuilles initialisées ✅' };
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
  const ss   = getSS();
  const sh   = ss.getSheetByName(SHEET_USERS);
  if (!sh) return { ok:false, error:'Feuille Utilisateurs introuvable' };
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]).trim().toLowerCase() === String(data.username).trim().toLowerCase()
     && String(r[1]).trim() === String(data.password).trim()
     && String(r[4]||'oui').trim().toLowerCase() !== 'non') {
      return { ok:true, user:{ username:r[0], role:r[2], nom:r[3]||r[0] } };
    }
  }
  return { ok:false, error:'Identifiants incorrects' };
}

// ============================================================
// PRODUITS — identique à l'original
// ============================================================
function handleGetProducts() {
  const sh   = getSS().getSheetByName(SHEET_PRODUCTS);
  const rows = sh.getDataRange().getValues();
  const products = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    products.push({ id:r[0], name:r[1], cat:r[2], emoji:r[3], code:r[4],
      price:Number(r[5]), cost:Number(r[6]), stock:Number(r[7]), minStock:Number(r[8]) });
  }
  return { ok:true, products };
}

function handleSaveProduct(data) {
  const ss = getSS(); const sh = ss.getSheetByName(SHEET_PRODUCTS);
  const p = data.product;
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == p.id) {
      sh.getRange(i+1,1,1,10).setValues([[p.id,p.name,p.cat||p.category,p.emoji||'📦',p.code,p.price,p.cost||p.buyPrice||0,p.stock,p.minStock,new Date()]]);
      return { ok:true };
    }
  }
  const newId = rows.length > 1 ? Math.max(...rows.slice(1).map(r=>Number(r[0])||0))+1 : 1;
  sh.appendRow([newId,p.name,p.cat||p.category||'',p.emoji||'📦',p.code||'',p.price,p.cost||0,p.stock||0,p.minStock||5,new Date()]);
  return { ok:true, id:newId };
}

function handleDeleteProduct(data) {
  const sh = getSS().getSheetByName(SHEET_PRODUCTS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == data.id) { sh.deleteRow(i+1); return { ok:true }; }
  }
  return { ok:false, error:'Produit introuvable' };
}

// ============================================================
// VENTES — avec création automatique de dossier production
// ============================================================
function handleAddSale(data) {
  const ss   = getSS();
  const sh   = ss.getSheetByName(SHEET_SALES);
  const sale = data.sale;
  const d    = new Date(sale.date);
  const tz   = Session.getScriptTimeZone();
  const dateS = Utilities.formatDate(d, tz, 'dd/MM/yyyy');
  const timeS = Utilities.formatDate(d, tz, 'HH:mm:ss');

  sale.items.forEach(item => {
    sh.appendRow([sale.id, dateS, timeS, item.name, item.qty, item.price,
      item.price*item.qty, sale.total,
      sale.method==='cash' ? 'Espèces' : 'Mobile Money',
      sale.provider||'', sale.ref||'', sale.caissier||'']);
    updateStock_(ss, item.name, -item.qty);
    logStock_(ss, item.name, 'Vente', -item.qty, 'Vente #'+sale.id, sale.caissier||'');
  });

  // 🔗 Création automatique des dossiers de production
  creerDossiersFromVente_(ss, sale);

  return { ok:true, saleId:sale.id };
}

function creerDossiersFromVente_(ss, sale) {
  const sh   = ss.getSheetByName(SHEET_DOSSIERS);
  if (!sh) return;
  const now  = new Date();
  const rows = sh.getDataRange().getValues();
  const lastId = rows.length > 1 ? Math.max(...rows.slice(1).map(r=>Number(String(r[0]).replace('D',''))||0)) : 0;
  let nextId = lastId + 1;
  sale.items.forEach(item => {
    const dossId = 'D' + String(nextId).padStart(4,'0');
    sh.appendRow([dossId, 'POS-'+sale.id+'-'+nextId, sale.caissier||'Client',
      item.name, item.qty, 'CREE', 0, now, '', 'Normale', 'Vente #'+sale.id, '']);
    nextId++;
  });
}

function handleGetSales(data) {
  const sh   = getSS().getSheetByName(SHEET_SALES);
  const rows = sh.getDataRange().getValues();
  const map  = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; const id = String(r[0]);
    if (!map[id]) map[id] = { id, date:r[1], time:r[2], total:Number(r[7]), method:r[8], caissier:r[11], items:[] };
    map[id].items.push({ name:r[3], qty:Number(r[4]), price:Number(r[5]) });
  }
  let sales = Object.values(map).reverse().slice(0, Number(data.limit)||200);
  return { ok:true, sales };
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
  const sh = ss.getSheetByName(SHEET_PRODUCTS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === name) {
      const ns = Number(rows[i][7]) + delta;
      sh.getRange(i+1,8).setValue(ns);
      sh.getRange(i+1,10).setValue(new Date());
      return ns;
    }
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
  const sh = getSS().getSheetByName(SHEET_USERS);
  const rows = sh.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if(!r[0]) continue;
    users.push({ username:r[0], role:r[2], nom:r[3], actif:String(r[4]||'oui').toLowerCase()!=='non' });
  }
  return { ok:true, users };
}

function handleSaveUser(data) {
  const ss = getSS(); const sh = ss.getSheetByName(SHEET_USERS);
  const u = data.user;
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase()===String(u.username).toLowerCase()) {
      sh.getRange(i+1,1,1,5).setValues([[u.username, u.password||rows[i][1], u.role, u.nom||u.username, u.actif!==false?'oui':'non']]);
      return { ok:true };
    }
  }
  sh.appendRow([u.username, u.password||'', u.role||'caissier', u.nom||u.username, 'oui']);
  return { ok:true };
}

function handleDeleteUser(data) {
  const sh = getSS().getSheetByName(SHEET_USERS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase()===String(data.username).toLowerCase()) { sh.deleteRow(i+1); return {ok:true}; }
  }
  return { ok:false, error:'Utilisateur introuvable' };
}

// ============================================================
// RÉSERVATIONS
// ============================================================
function handleGetReservations() {
  const sh = getSS().getSheetByName(SHEET_RESERVATIONS);
  if (!sh) return { ok:true, reservations:[] };
  const rows = sh.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if(!r[0]) continue;
    const produitStr = String(r[4] || '');
    // Reconstruire le tableau items depuis "Article x2, Article2 x1"
    const items = produitStr ? produitStr.split(', ').map(s => {
      const m = s.match(/^(.+) x(\d+)$/);
      return m ? { name: m[1], qty: Number(m[2]), price: 0 } : { name: s, qty: 1, price: 0 };
    }) : [];
    const sheetStatut = String(r[7] || '');
    const status = sheetStatut === 'Terminé' ? 'completed'
                 : sheetStatut === 'Annulé'  ? 'cancelled'
                 : 'pending';
    list.push({
      id: r[0], date: r[1],
      clientName: r[2], clientContact: r[3],
      items, quantite: Number(r[5]),
      accompte: Number(r[6]), acompte: Number(r[6]),
      status, statut: sheetStatut,
      notes: r[8], caissier: r[9],
      subtotal: 0, remise: 0, total: 0, restant: 0,
    });
  }
  return { ok:true, reservations:list.reverse() };
}

function handleAddReservation(data) {
  const ss = getSS(); const sh = ss.getSheetByName(SHEET_RESERVATIONS);
  const r = data.reservation; const now = new Date();
  const id = r.id ? String(r.id) : ('R' + now.getTime());
  const client   = r.clientName   || r.client  || '';
  const tel      = r.clientContact || r.tel     || '';
  const produit  = Array.isArray(r.items)
    ? r.items.map(i => `${i.name} x${i.qty}`).join(', ')
    : (r.produit || '');
  const quantite = Array.isArray(r.items)
    ? r.items.reduce((s, i) => s + (Number(i.qty) || 0), 0)
    : (r.quantite || 1);
  const acompte  = r.accompte !== undefined ? r.accompte : (r.acompte || 0);
  sh.appendRow([id, Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd/MM/yyyy'),
    client, tel, produit, quantite, acompte, 'En attente', r.notes || '', r.caissier || '']);
  return { ok:true, id };
}

function handleUpdateReservation(data) {
  const sh = getSS().getSheetByName(SHEET_RESERVATIONS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      const rawStatus = data.statut || data.status;
      if (rawStatus) {
        const sheetStatut = rawStatus === 'completed' ? 'Terminé'
                          : rawStatus === 'cancelled'  ? 'Annulé'
                          : rawStatus;
        sh.getRange(i+1, 8).setValue(sheetStatut);
      }
      if (data.notes) sh.getRange(i+1, 9).setValue(data.notes);
      return { ok:true };
    }
  }
  return { ok:false, error:'Réservation introuvable' };
}

// ============================================================
// COMMANDES — identiques à l'original
// ============================================================
function handleGetCommandes() {
  const sh = getSS().getSheetByName(SHEET_COMMANDES);
  if (!sh) return { ok:true, commandes:[] };
  const rows = sh.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if(!r[0]) continue;
    list.push({ id:r[0], date:r[1], fournisseur:r[2], produit:r[3],
      quantite:Number(r[4]), prixUnit:Number(r[5]), total:Number(r[6]),
      statut:r[7], notes:r[8], admin:r[9] });
  }
  return { ok:true, commandes:list.reverse() };
}

function handleAddCommande(data) {
  const sh = getSS().getSheetByName(SHEET_COMMANDES);
  const c = data.commande; const now = new Date();
  const id = 'C'+now.getTime();
  const total = (c.quantite||0)*(c.prixUnit||0);
  sh.appendRow([id, Utilities.formatDate(now,Session.getScriptTimeZone(),'dd/MM/yyyy'),
    c.fournisseur, c.produit, c.quantite||0, c.prixUnit||0, total, 'En cours', c.notes||'', c.admin||'']);
  return { ok:true, id };
}

function handleUpdateCommande(data) {
  const sh = getSS().getSheetByName(SHEET_COMMANDES);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]===data.id) {
      if (data.statut) sh.getRange(i+1,8).setValue(data.statut);
      if (data.notes)  sh.getRange(i+1,9).setValue(data.notes);
      if (data.statut==='Reçue') {
        updateStock_(getSS(), rows[i][3], Number(rows[i][4]));
        logStock_(getSS(), rows[i][3], 'Entrée', Number(rows[i][4]), 'Commande '+data.id, data.admin||'');
      }
      return { ok:true };
    }
  }
  return { ok:false, error:'Commande introuvable' };
}

// ============================================================
// DOSSIERS PRODUCTION
// ============================================================
function handleGetDossiers(data) {
  const sh = getSS().getSheetByName(SHEET_DOSSIERS);
  if (!sh) return { ok:true, dossiers:[] };
  const rows = sh.getDataRange().getValues();
  let list = [];
  const tz = Session.getScriptTimeZone();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if(!r[0]) continue;
    const dc = r[7] ? Utilities.formatDate(new Date(r[7]), tz, 'dd/MM/yyyy') : '';
    const dl = r[8] ? Utilities.formatDate(new Date(r[8]), tz, 'dd/MM/yyyy') : '';
    list.push({ id:r[0], numeroDossier:r[1], client:r[2], produit:r[3],
      quantite:Number(r[4]), statut:r[5], progression:Number(r[6]),
      dateCreation:dc, dateLivraison:dl, priorite:r[9], sourceVente:r[10], notes:r[11] });
  }
  if (data && data.statut && data.statut !== 'TOUS') list = list.filter(d=>d.statut===data.statut);
  return { ok:true, dossiers:list.reverse() };
}

// ============================================================
// OPÉRATEURS
// ============================================================
function handleGetOperateurs() {
  const sh = getSS().getSheetByName(SHEET_OPERATEURS);
  if (!sh) return { ok:true, operateurs:[] };
  const rows = sh.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || String(r[2]).toLowerCase()==='non') continue;
    list.push({ nom:r[0], role:r[1]||'operateur' });
  }
  return { ok:true, operateurs:list };
}

function handleSaveOperateur(data) {
  const sh = getSS().getSheetByName(SHEET_OPERATEURS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim()===String(data.nom).trim()) {
      sh.getRange(i+1,1,1,3).setValues([[data.nom, data.role||'operateur', 'oui']]);
      return { ok:true, message:'Opérateur mis à jour' };
    }
  }
  sh.appendRow([data.nom, data.role||'operateur', 'oui']);
  return { ok:true, message:'Opérateur créé' };
}

// ============================================================
// TÂCHES — ATTRIBUTION
// ============================================================
function handleAttribuerTache(data) {
  const ss = getSS(); const sh = ss.getSheetByName(SHEET_TACHES);
  const now = new Date();
  const rows = sh.getDataRange().getValues();
  // Supprimer doublon même dossier+étape+opérateur
  for (let i = rows.length-1; i >= 1; i--) {
    if (rows[i][1]===data.dossierId && rows[i][3]===data.etapeCode && rows[i][5]===data.operateur) sh.deleteRow(i+1);
  }
  const lastId = rows.length>1 ? Math.max(...rows.slice(1).map(r=>Number(String(r[0]).replace('T',''))||0)) : 0;
  const tId = 'T'+String(lastId+1).padStart(4,'0');
  const etape = ETAPES_PROD.find(e=>e.code===data.etapeCode)||{ label:data.etapeCode };
  sh.appendRow([tId, data.dossierId, data.numeroDossier, data.etapeCode, etape.label,
    data.operateur, 'A_FAIRE', now, '', '', data.commentaire||'', data.assignePar||'Admin']);
  return { ok:true, tacheId:tId };
}

function handleGetTaches(data) {
  const sh = getSS().getSheetByName(SHEET_TACHES);
  if (!sh) return { ok:true, taches:[] };
  const rows = sh.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const fmt = dt => dt ? Utilities.formatDate(new Date(dt),tz,'dd/MM/yyyy HH:mm') : '';
  let list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if(!r[0]) continue;
    const t = { id:r[0], dossierId:r[1], numeroDossier:r[2], etapeCode:r[3], etapeLabel:r[4],
      operateur:r[5], statut:r[6], dateAssignation:fmt(r[7]), dateDebut:fmt(r[8]),
      dateFin:fmt(r[9]), commentaire:r[10], assignePar:r[11] };
    if (data && data.operateur && data.operateur!=='TOUS' && t.operateur!==data.operateur) continue;
    if (data && data.dossierId && t.dossierId!==data.dossierId) continue;
    list.push(t);
  }
  return { ok:true, taches:list };
}

function handleDeleteTache(data) {
  const sh = getSS().getSheetByName(SHEET_TACHES);
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length-1; i >= 1; i--) {
    if (rows[i][0]===data.id) { sh.deleteRow(i+1); return {ok:true}; }
  }
  return { ok:false, error:'Tâche introuvable' };
}

// ============================================================
// POINTAGE PRODUCTION
// ============================================================
function handlePointerAction(data) {
  const ss = getSS(); const sh = ss.getSheetByName(SHEET_TACHES);
  const now = new Date();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]===data.tacheId) {
      if (data.action_==='START') {
        sh.getRange(i+1,7).setValue('EN_COURS');
        sh.getRange(i+1,9).setValue(now);
      } else if (data.action_==='END'||data.action_==='VALIDER') {
        sh.getRange(i+1,7).setValue('TERMINE');
        sh.getRange(i+1,10).setValue(now);
        if (data.commentaire) sh.getRange(i+1,11).setValue(data.commentaire);
        majProgressionDossier_(ss, rows[i][1], data.etapeCode);
      }
      return { ok:true };
    }
  }
  return { ok:false, error:'Tâche introuvable' };
}

function majProgressionDossier_(ss, dossierId, etapeCode) {
  const sh = ss.getSheetByName(SHEET_DOSSIERS);
  const rows = sh.getDataRange().getValues();
  const idx = ETAPES_PROD.findIndex(e=>e.code===etapeCode);
  if (idx<0) return;
  const next = ETAPES_PROD[idx+1];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]===dossierId) {
      sh.getRange(i+1,6).setValue(next ? next.code : 'LIVRE');
      sh.getRange(i+1,7).setValue(ETAPES_PROD[idx].progress);
      return;
    }
  }
}

// ============================================================
// DASHBOARD UNIFIÉ
// ============================================================
function handleGetDashboard() {
  const ss = getSS();
  const dossRows  = (ss.getSheetByName(SHEET_DOSSIERS)||{getDataRange:()=>({getValues:()=>[[]]})}). getDataRange().getValues();
  const tacheRows = (ss.getSheetByName(SHEET_TACHES)||{getDataRange:()=>({getValues:()=>[[]]})}). getDataRange().getValues();
  const venteRows = (ss.getSheetByName(SHEET_SALES)||{getDataRange:()=>({getValues:()=>[[]]})}). getDataRange().getValues();

  let totalVentes=0, nbVentes=0;
  const seen = new Set();
  for (let i=1;i<venteRows.length;i++) {
    const id=String(venteRows[i][0]);
    if(!seen.has(id)){seen.add(id);nbVentes++;totalVentes+=Number(venteRows[i][7])||0;}
  }

  const kpi={total:0,cree:0,enCours:0,livre:0};
  for(let i=1;i<dossRows.length;i++){
    const r=dossRows[i]; if(!r[0]) continue; kpi.total++;
    const s=String(r[5]);
    if(s==='CREE') kpi.cree++;
    else if(s==='LIVRE') kpi.livre++;
    else kpi.enCours++;
  }

  const opStats={};
  for(let i=1;i<tacheRows.length;i++){
    const r=tacheRows[i]; if(!r[0]) continue;
    const op=String(r[5]);
    if(!opStats[op]) opStats[op]={nom:op,aFaire:0,enCours:0,termine:0};
    if(r[6]==='A_FAIRE')  opStats[op].aFaire++;
    if(r[6]==='EN_COURS') opStats[op].enCours++;
    if(r[6]==='TERMINE')  opStats[op].termine++;
  }

  return {
    ok:true,
    ventes:{total:totalVentes, nb:nbVentes},
    dossiers:kpi,
    operateurs:Object.values(opStats)
  };
}
