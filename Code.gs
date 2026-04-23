// ============================================================
// BOUTIQUE POS — Google Apps Script Backend
// Copiez tout ce code dans script.google.com
// Remplacez SHEET_ID par l'ID de votre Google Sheet
// Déployez : Déployer → Nouveau déploiement → Application Web
//   → Exécuter en tant que : Moi
//   → Accès : Tout le monde
// ============================================================

const SHEET_ID = '1Lsf_OhhuKYlSE3S_OpJwzUEy78LBdFDj_1dmYuT70eo';

// Noms des feuilles
const SHEET_PRODUCTS  = 'Produits';
const SHEET_SALES     = 'Ventes';
const SHEET_STOCK_LOG = 'MouvementsStock';
const SHEET_USERS     = 'Utilisateurs';

// ============================================================
// ROUTEUR PRINCIPAL — POST
// ============================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result;

    if      (action === 'login')         result = handleLogin(data);
    else if (action === 'getProducts')   result = handleGetProducts();
    else if (action === 'saveProduct')   result = handleSaveProduct(data);
    else if (action === 'deleteProduct') result = handleDeleteProduct(data);
    else if (action === 'addSale')       result = handleAddSale(data);
    else if (action === 'stockMove')     result = handleStockMove(data);
    else if (action === 'getSales')      result = handleGetSales(data);
    else if (action === 'getUsers')      result = handleGetUsers();
    else if (action === 'saveUser')      result = handleSaveUser(data);
    else if (action === 'deleteUser')    result = handleDeleteUser(data);
    else result = { ok: false, error: 'Action inconnue: ' + action };

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ============================================================
// ROUTEUR PRINCIPAL — GET
// ============================================================
function doGet(e) {
  // Écritures passées via ?payload=JSON (contournement CORS)
  if (e.parameter.payload) {
    try {
      const data = JSON.parse(e.parameter.payload);
      const action = data.action;
      let result;
      if      (action === 'addSale')      result = handleAddSale(data);
      else if (action === 'saveProduct')  result = handleSaveProduct(data);
      else if (action === 'deleteProduct')result = handleDeleteProduct(data);
      else if (action === 'stockMove')    result = handleStockMove(data);
      else if (action === 'saveUser')     result = handleSaveUser(data);
      else if (action === 'deleteUser')   result = handleDeleteUser(data);
      else result = { ok: false, error: 'Action payload inconnue: ' + action };
      return jsonResponse(result);
    } catch(err) {
      return jsonResponse({ ok: false, error: 'Payload invalide: ' + err.message });
    }
  }

  const action = e.parameter.action || 'ping';
  if (action === 'ping')        return jsonResponse({ ok: true, message: 'POS Backend actif ✅' });
  if (action === 'login')       return jsonResponse(handleLogin({ username: e.parameter.username || '', password: e.parameter.password || '' }));
  if (action === 'getProducts') return jsonResponse(handleGetProducts());
  if (action === 'getSales')    return jsonResponse(handleGetSales(e.parameter));
  if (action === 'getUsers')    return jsonResponse(handleGetUsers());
  if (action === 'initSheets')  return jsonResponse(initSheets());
  return jsonResponse({ ok: false, error: 'Action GET inconnue: ' + action });
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// INITIALISATION ET MIGRATION DES FEUILLES
// ============================================================
function initSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // ── Produits ────────────────────────────────────────────────
  let sp = ss.getSheetByName(SHEET_PRODUCTS);
  if (!sp) {
    sp = ss.insertSheet(SHEET_PRODUCTS);
    sp.appendRow(['ID','Nom','Categorie','Emoji','Code','Prix_Vente','Prix_Achat','Stock','Stock_Min','Date_MAJ']);
    sp.getRange(1,1,1,10).setBackground('#0a0e1a').setFontColor('#00e5a0').setFontWeight('bold');
    const demo = [
      [1,'Riz 1kg','Alimentation','🍚','001',2500,1800,50,10,new Date()],
      [2,'Huile 1L','Alimentation','🫙','002',4500,3200,24,5,new Date()],
      [3,'Sucre 1kg','Alimentation','🧂','003',2000,1500,3,5,new Date()],
      [4,'Coca-Cola 1.5L','Boissons','🥤','004',3500,2500,12,6,new Date()],
      [5,'Eau minérale','Boissons','💧','005',1500,900,36,12,new Date()],
      [6,'Savon Protex','Hygiène','🧼','006',1800,1200,18,5,new Date()],
    ];
    demo.forEach(r => sp.appendRow(r));
  }

  // ── Ventes (16 colonnes) ────────────────────────────────────
  let sv = ss.getSheetByName(SHEET_SALES);
  const VENTES_HEADERS = [
    'ID','Date','Heure','Article','Quantite','Prix_Unitaire',
    'Sous_Total_Article','Sous_Total_Vente','Remise','Net_A_Payer',
    'Accompte','Reste_Du','Mode_Paiement','Fournisseur_Mobile','Reference','Caissier'
  ];
  if (!sv) {
    sv = ss.insertSheet(SHEET_SALES);
    sv.appendRow(VENTES_HEADERS);
    sv.getRange(1,1,1,VENTES_HEADERS.length).setBackground('#0a0e1a').setFontColor('#00e5a0').setFontWeight('bold');
  } else {
    // Migration : ajouter les colonnes manquantes si feuille existante (ancienne version 12 col)
    const existingHeaders = sv.getRange(1, 1, 1, sv.getLastColumn()).getValues()[0];
    if (existingHeaders.length < VENTES_HEADERS.length) {
      const missing = VENTES_HEADERS.slice(existingHeaders.length);
      const startCol = existingHeaders.length + 1;
      sv.getRange(1, startCol, 1, missing.length).setValues([missing])
        .setBackground('#0a0e1a').setFontColor('#00e5a0').setFontWeight('bold');
    }
  }

  // ── MouvementsStock ─────────────────────────────────────────
  let sm = ss.getSheetByName(SHEET_STOCK_LOG);
  if (!sm) {
    sm = ss.insertSheet(SHEET_STOCK_LOG);
    sm.appendRow(['Date','Article','Type','Quantite','Stock_Avant','Stock_Apres','Motif','Caissier']);
    sm.getRange(1,1,1,8).setBackground('#0a0e1a').setFontColor('#00e5a0').setFontWeight('bold');
  }

  // ── Utilisateurs ────────────────────────────────────────────
  let su = ss.getSheetByName(SHEET_USERS);
  if (!su) {
    su = ss.insertSheet(SHEET_USERS);
    su.appendRow(['Username','MotDePasse','Role','Nom','Actif']);
    su.getRange(1,1,1,5).setBackground('#0a0e1a').setFontColor('#00e5a0').setFontWeight('bold');
    su.appendRow(['admin','1234','admin','Administrateur',true]);
    su.appendRow(['caissier','0000','caissier','Caissier',true]);
  }

  return { ok: true, message: 'Feuilles initialisées / migrées ✅' };
}

// ============================================================
// LOGIN
// ============================================================
function handleLogin(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_USERS);
  if (!sheet) return { ok: false, error: 'Feuille Utilisateurs introuvable. Lancez initSheets() d\'abord.' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const [username, pass, role, label, actif] = rows[i];
    if (
      username.toString().toLowerCase() === data.username.toLowerCase() &&
      pass.toString() === data.password &&
      actif !== false
    ) {
      return { ok: true, user: { username, role, label } };
    }
  }
  return { ok: false, error: 'Identifiant ou mot de passe incorrect' };
}

// ============================================================
// PRODUITS
// ============================================================
function handleGetProducts() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_PRODUCTS);
  if (!sheet) return { ok: false, error: 'Feuille Produits introuvable' };

  const rows = sheet.getDataRange().getValues();
  const products = [];
  for (let i = 1; i < rows.length; i++) {
    const [id, name, cat, emoji, code, price, cost, stock, minStock] = rows[i];
    if (!name) continue;
    products.push({
      id: Number(id), name, cat, emoji,
      code: String(code), price: Number(price), cost: Number(cost),
      stock: Number(stock), minStock: Number(minStock)
    });
  }
  return { ok: true, products };
}

function handleSaveProduct(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_PRODUCTS);
  if (!sheet) return { ok: false, error: 'Feuille Produits introuvable' };
  const p = data.product;
  const rows = sheet.getDataRange().getValues();
  const now = new Date();

  if (p.id) {
    for (let i = 1; i < rows.length; i++) {
      if (Number(rows[i][0]) === Number(p.id)) {
        sheet.getRange(i+1, 1, 1, 10).setValues([[
          p.id, p.name, p.cat, p.emoji||'📦', p.code,
          p.price, p.cost, p.stock, p.minStock, now
        ]]);
        return { ok: true, action: 'updated', id: p.id };
      }
    }
  }

  const maxId = rows.slice(1).reduce((m, r) => Math.max(m, Number(r[0]) || 0), 0);
  const newId = maxId + 1;
  sheet.appendRow([newId, p.name, p.cat, p.emoji||'📦', p.code||String(newId), p.price, p.cost, p.stock||0, p.minStock||5, now]);
  return { ok: true, action: 'created', id: newId };
}

function handleDeleteProduct(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_PRODUCTS);
  if (!sheet) return { ok: false, error: 'Feuille Produits introuvable' };
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (Number(rows[i][0]) === Number(data.id)) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Produit introuvable' };
}

function updateProductStock(ss, productName, delta) {
  const sheet = ss.getSheetByName(SHEET_PRODUCTS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === productName) {
      const newStock = Math.max(0, Number(rows[i][7]) + delta);
      sheet.getRange(i+1, 8).setValue(newStock);
      sheet.getRange(i+1, 10).setValue(new Date());
      return Number(rows[i][7]);
    }
  }
  return null;
}

// ============================================================
// VENTES  (16 colonnes)
// ID | Date | Heure | Article | Quantite | Prix_Unitaire |
// Sous_Total_Article | Sous_Total_Vente | Remise | Net_A_Payer |
// Accompte | Reste_Du | Mode_Paiement | Fournisseur_Mobile | Reference | Caissier
// ============================================================
function handleAddSale(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_SALES);
  if (!sheet) return { ok: false, error: 'Feuille "Ventes" introuvable. Lancez initSheets() d\'abord.' };

  const sale = data.sale;
  const d = new Date(sale.date);
  const dateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'HH:mm:ss');

  const subtotal  = Number(sale.subtotal  || sale.total || 0);
  const remise    = Number(sale.remise    || 0);
  const netPayer  = Number(sale.total     || 0);
  const accompte  = Number(sale.accompte  || 0);
  const resteDu   = Number(sale.due       || 0);
  const methode   = sale.method === 'cash' ? 'Espèces' : 'Mobile Money';

  sale.items.forEach(item => {
    sheet.appendRow([
      sale.id,
      dateStr,
      timeStr,
      item.name,
      item.qty,
      item.price,
      item.price * item.qty,   // Sous_Total_Article
      subtotal,                 // Sous_Total_Vente (avant remise)
      remise,                   // Remise
      netPayer,                 // Net_A_Payer (après remise)
      accompte,                 // Accompte
      resteDu,                  // Reste_Du
      methode,
      sale.provider || '',
      sale.ref      || '',
      sale.caissier || ''
    ]);
    updateProductStock(ss, item.name, -item.qty);
    logStockMove(ss, item.name, 'Vente', -item.qty, 'Vente #' + sale.id, sale.caissier || '');
  });

  return { ok: true, saleId: sale.id };
}

function handleGetSales(params) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_SALES);
  if (!sheet) return { ok: true, sales: [] };

  const rows = sheet.getDataRange().getValues();
  const salesMap = {};

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = r[0];
    if (!id) continue;

    // Compatibilité ancienne structure (12 col) et nouvelle (16 col)
    const date       = r[1];
    const time       = r[2];
    const article    = r[3];
    const qty        = r[4];
    const prixUnit   = r[5];
    // col 6 = Sous_Total_Article
    const isNewFmt   = r.length >= 16;
    const subtotal   = isNewFmt ? Number(r[7]  || 0) : Number(r[7] || 0);
    const remise     = isNewFmt ? Number(r[8]  || 0) : 0;
    const netPayer   = isNewFmt ? Number(r[9]  || 0) : Number(r[7] || 0);
    const accompte   = isNewFmt ? Number(r[10] || 0) : 0;
    const resteDu    = isNewFmt ? Number(r[11] || 0) : 0;
    const method     = isNewFmt ? r[12] : r[8];
    const provider   = isNewFmt ? r[13] : r[9];
    const ref        = isNewFmt ? r[14] : r[10];
    const caissier   = isNewFmt ? r[15] : r[11];

    if (!salesMap[id]) {
      let isoDate;
      try {
        const tz = Session.getScriptTimeZone();
        const timeStr = time instanceof Date
          ? Utilities.formatDate(time, tz, 'HH:mm:ss')
          : (time ? time.toString() : '00:00:00');
        if (date instanceof Date) {
          isoDate = Utilities.formatDate(date, tz, 'yyyy-MM-dd') + 'T' + timeStr;
        } else {
          const parts = date.toString().split('/');
          isoDate = parts[2] + '-' + parts[1].padStart(2,'0') + '-' + parts[0].padStart(2,'0') + 'T' + timeStr;
        }
      } catch(e) { isoDate = new Date().toISOString(); }

      salesMap[id] = {
        id:       Number(id),
        date:     isoDate,
        subtotal, remise,
        total:    netPayer,
        accompte, due: resteDu,
        method:   method === 'Espèces' ? 'cash' : 'mobile',
        provider: provider || '',
        ref:      ref      || '',
        caissier: caissier || '',
        items:    []
      };
    }
    salesMap[id].items.push({ name: article, qty: Number(qty), price: Number(prixUnit) });
  }

  const limit = Number(params.limit) || 100;
  const sales = Object.values(salesMap).reverse().slice(0, limit);
  return { ok: true, sales };
}

// ============================================================
// MOUVEMENTS STOCK
// ============================================================
function handleStockMove(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const { productName, type, qty, reason, caissier } = data;
  const delta = type === 'in' ? Number(qty) : -Number(qty);
  const oldStock = updateProductStock(ss, productName, delta);
  if (oldStock === null) return { ok: false, error: 'Produit introuvable: ' + productName };
  logStockMove(ss, productName, type === 'in' ? 'Entrée' : 'Sortie', delta, reason || '', caissier || '');
  return { ok: true, newStock: oldStock + delta };
}

function logStockMove(ss, productName, type, delta, reason, caissier) {
  const sheet = ss.getSheetByName(SHEET_STOCK_LOG);
  if (!sheet) return;
  const prodSheet = ss.getSheetByName(SHEET_PRODUCTS);
  const prodRows  = prodSheet.getDataRange().getValues();
  let currentStock = 0;
  for (let i = 1; i < prodRows.length; i++) {
    if (prodRows[i][1] === productName) { currentStock = Number(prodRows[i][7]); break; }
  }
  sheet.appendRow([new Date(), productName, type, delta, currentStock - delta, currentStock, reason, caissier]);
}

// ============================================================
// UTILISATEURS
// ============================================================
function handleGetUsers() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_USERS);
  if (!sheet) return { ok: false, error: 'Feuille Utilisateurs introuvable' };

  const rows = sheet.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < rows.length; i++) {
    const [username, pass, role, label, actif] = rows[i];
    if (!username) continue;
    // On renvoie le mot de passe (chiffré côté app si besoin futur) pour sync locale
    users.push({
      username: username.toString(),
      pass:     pass.toString(),
      role:     role.toString(),
      label:    label.toString(),
      actif:    actif !== false && actif !== 'FALSE'
    });
  }
  return { ok: true, users };
}

function handleSaveUser(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_USERS);
  if (!sheet) return { ok: false, error: 'Feuille Utilisateurs introuvable' };

  const u = data.user;
  if (!u || !u.username) return { ok: false, error: 'Données utilisateur manquantes' };

  const rows = sheet.getDataRange().getValues();

  // Chercher si l'utilisateur existe déjà
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0].toString().toLowerCase() === u.username.toLowerCase()) {
      // Mise à jour — mot de passe inchangé si non fourni
      const newPass = u.pass || rows[i][1];
      sheet.getRange(i+1, 1, 1, 5).setValues([[
        u.username, newPass, u.role, u.label,
        u.actif !== false
      ]]);
      return { ok: true, action: 'updated' };
    }
  }

  // Nouvel utilisateur
  if (!u.pass) return { ok: false, error: 'Mot de passe obligatoire pour un nouvel utilisateur' };
  sheet.appendRow([u.username, u.pass, u.role, u.label, u.actif !== false]);
  return { ok: true, action: 'created' };
}

function handleDeleteUser(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_USERS);
  if (!sheet) return { ok: false, error: 'Feuille Utilisateurs introuvable' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0].toString().toLowerCase() === (data.username || '').toLowerCase()) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Utilisateur introuvable' };
}

// ============================================================
// FONCTION DE TEST
// ============================================================
function testAll() {
  Logger.log('=== TEST BOUTIQUE POS ===');

  let r = handleLogin({ username: 'admin', password: '1234' });
  Logger.log('Login admin: ' + JSON.stringify(r));

  r = handleGetProducts();
  Logger.log('Produits: ' + (r.products ? r.products.length : 'ERREUR'));

  r = handleGetUsers();
  Logger.log('Utilisateurs: ' + (r.users ? r.users.length : 'ERREUR'));

  r = handleAddSale({ sale: {
    id: 9999,
    date: new Date().toISOString(),
    caissier: 'admin',
    items: [{ name: 'Riz 1kg', qty: 1, price: 2500 }],
    subtotal: 2500,
    remise: 200,
    total: 2300,
    accompte: 1000,
    due: 1300,
    method: 'cash',
    given: 1300,
    change: 0
  }});
  Logger.log('Vente test: ' + JSON.stringify(r));

  Logger.log('✅ Tests terminés !');
}
