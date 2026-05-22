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
const SHEET_PRODUCTS     = 'Produits';
const SHEET_SALES        = 'Ventes';
const SHEET_STOCK_LOG    = 'MouvementsStock';
const SHEET_USERS        = 'Utilisateurs';
const SHEET_RESERVATIONS = 'Réservations';
const SHEET_COMMANDES    = 'Commandes';

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
    else if (action === 'getCSV')            result = handleGetCSV(data);
    else if (action === 'saveImage')         result = handleSaveImage(data);
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
      else result = { ok: false, error: 'Action payload inconnue: ' + action };
      return jsonResponse(result);
    } catch(err) {
      return jsonResponse({ ok: false, error: 'Payload invalide: ' + err.message });
    }
  }

  try {
    const action = e.parameter.action || 'ping';
    if (action === 'ping')             return jsonResponse({ ok: true, message: 'POS Backend actif ✅' });
    if (action === 'login')            return jsonResponse(handleLogin({ username: e.parameter.username || '', password: e.parameter.password || '' }));
    if (action === 'getProducts')      return jsonResponse(handleGetProducts());
    if (action === 'getSales')         return jsonResponse(handleGetSales(e.parameter));
    if (action === 'getUsers')         return jsonResponse(handleGetUsers());
    if (action === 'getReservations')  return jsonResponse(handleGetReservations());
    if (action === 'getCommandes')     return jsonResponse(handleGetCommandes());
    if (action === 'initSheets')       return jsonResponse(initSheets());
    if (action === 'getCSV')           return handleGetCSVResponse(e.parameter);
    return jsonResponse({ ok: false, error: 'Action GET inconnue: ' + action });
  } catch(err) {
    return jsonResponse({ ok: false, error: 'GET error: ' + err.message });
  }
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
    'Accompte','Reste_Du','Mode_Paiement','Fournisseur_Mobile','Reference','Caissier',
    'Nom_Client','Contact_Client'
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
    su.appendRow(['admin', sha256('1234'), 'admin','Administrateur',true]);
    su.appendRow(['caissier', sha256('0000'), 'caissier','Caissier',true]);
  } else {
    // Migration : hacher les mots de passe en clair (longueur != 64 => pas encore hashé)
    const uRows = su.getDataRange().getValues();
    for (let i = 1; i < uRows.length; i++) {
      const pwd = String(uRows[i][1]);
      if (pwd.length !== 64) {
        su.getRange(i + 1, 2).setValue(sha256(pwd));
      }
    }
  }

  // ── Réservations ─────────────────────────────────────────────
  const RES_HEADERS = [
    'ID','Date','Heure','Client_Nom','Client_Contact','Article','Quantite','Prix_Unitaire',
    'Sous_Total_Article','Sous_Total_Vente','Remise','Net_A_Payer','Accompte','Restant',
    'Mode_Depot','Fournisseur_Mobile','Reference','Caissier','Statut','Date_Finalisation','Vente_ID'
  ];
  let sr = ss.getSheetByName(SHEET_RESERVATIONS);
  if (!sr) {
    sr = ss.insertSheet(SHEET_RESERVATIONS);
    sr.appendRow(RES_HEADERS);
    sr.getRange(1,1,1,RES_HEADERS.length).setBackground('#0a4d1a').setFontColor('#00e5a0').setFontWeight('bold');
  }

  // ── Commandes ─────────────────────────────────────────────
  const CMD_HEADERS = [
    'ID','Date','Heure','Client_Nom','Client_Contact','Adresse_Livraison','Date_Livraison',
    'Article','Quantite','Prix_Unitaire','Est_Personnalise','Sous_Total_Article',
    'Sous_Total_Commande','Remise','Net_A_Payer','Accompte','Restant',
    'Mode_Depot','Fournisseur_Mobile','Reference','Caissier',
    'Notes','Statut','Date_Finalisation','Vente_ID'
  ];
  let sc = ss.getSheetByName(SHEET_COMMANDES);
  if (!sc) {
    sc = ss.insertSheet(SHEET_COMMANDES);
    sc.appendRow(CMD_HEADERS);
    sc.getRange(1,1,1,CMD_HEADERS.length).setBackground('#1e1b4b').setFontColor('#c7d2fe').setFontWeight('bold');
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
  const hashedInput = sha256(data.password);
  for (let i = 1; i < rows.length; i++) {
    const [username, pass, role, label, actif] = rows[i];
    const storedPass = pass.toString();
    // Accepte le hash SHA-256 (64 hex) OU le mot de passe en clair (migration)
    const isMatch = storedPass === hashedInput || storedPass === data.password;
    if (
      username.toString().toLowerCase() === data.username.toLowerCase() &&
      isMatch &&
      actif !== false
    ) {
      // Migration à la volée : si le mot de passe était encore en clair, le hacher maintenant
      if (storedPass === data.password && storedPass.length !== 64) {
        sheet.getRange(i + 1, 2).setValue(hashedInput);
      }
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
// VENTES  (18 colonnes)
// ID | Date | Heure | Article | Quantite | Prix_Unitaire |
// Sous_Total_Article | Sous_Total_Vente | Remise | Net_A_Payer |
// Accompte | Reste_Du | Mode_Paiement | Fournisseur_Mobile | Reference | Caissier |
// Nom_Client | Contact_Client
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
      item.price * item.qty,       // Sous_Total_Article
      subtotal,                     // Sous_Total_Vente (avant remise)
      remise,                       // Remise
      netPayer,                     // Net_A_Payer (après remise)
      accompte,                     // Accompte
      resteDu,                      // Reste_Du
      methode,
      sale.provider      || '',
      sale.ref           || '',
      sale.caissier      || '',
      sale.clientName    || '',     // Nom_Client
      sale.clientContact || ''      // Contact_Client
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

  const limit  = Number(params.limit)  || 200;
  const offset = Number(params.offset) || 0;
  const allSales = Object.values(salesMap).reverse();
  const total  = allSales.length;
  const sales  = allSales.slice(offset, offset + limit);
  return { ok: true, sales, total, offset, limit };
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
      // Mise à jour — hasher le nouveau mot de passe s'il est fourni
      const newPass = u.pass ? sha256(u.pass) : rows[i][1];
      sheet.getRange(i+1, 1, 1, 5).setValues([[
        u.username, newPass, u.role, u.label,
        u.actif !== false
      ]]);
      return { ok: true, action: 'updated' };
    }
  }

  // Nouvel utilisateur
  if (!u.pass) return { ok: false, error: 'Mot de passe obligatoire pour un nouvel utilisateur' };
  sheet.appendRow([u.username, sha256(u.pass), u.role, u.label, u.actif !== false]);
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
// RÉSERVATIONS
// ID | Date | Heure | Client_Nom | Client_Contact | Article | Quantite | Prix_Unitaire |
// Sous_Total_Article | Sous_Total_Vente | Remise | Net_A_Payer | Accompte | Restant |
// Mode_Depot | Fournisseur_Mobile | Reference | Caissier | Statut | Date_Finalisation | Vente_ID
// ============================================================
function handleAddReservation(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_RESERVATIONS);
  if (!sheet) return { ok: false, error: 'Feuille "Réservations" introuvable. Lancez initSheets().' };

  const res = data.reservation;
  const d = new Date(res.date);
  const dateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'HH:mm:ss');

  const subtotal = Number(res.subtotal || res.total || 0);
  const remise   = Number(res.remise   || 0);
  const total    = Number(res.total    || 0);
  const accompte = Number(res.accompte || 0);
  const restant  = Number(res.restant  || 0);
  const methode  = res.depositMethod === 'cash' ? 'Espèces' : 'Mobile Money';

  res.items.forEach(item => {
    sheet.appendRow([
      res.id,
      dateStr,
      timeStr,
      res.clientName    || '',
      res.clientContact || '',
      item.name,
      item.qty,
      item.price,
      item.price * item.qty,
      subtotal,
      remise,
      total,
      accompte,
      restant,
      methode,
      res.depositProvider || '',
      res.depositRef      || '',
      res.caissier        || '',
      'En attente',
      '',
      ''
    ]);
  });

  return { ok: true, reservationId: res.id };
}

function handleUpdateReservation(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_RESERVATIONS);
  if (!sheet) return { ok: false, error: 'Feuille "Réservations" introuvable.' };

  const rows = sheet.getDataRange().getValues();
  const statusLabel = data.status === 'completed' ? 'Finalisée' : 'Annulée';
  let updated = 0;

  for (let i = 1; i < rows.length; i++) {
    if (Number(rows[i][0]) === Number(data.id)) {
      sheet.getRange(i + 1, 19).setValue(statusLabel);
      if (data.dateFinalisation) {
        try {
          const df = new Date(data.dateFinalisation);
          sheet.getRange(i + 1, 20).setValue(
            Utilities.formatDate(df, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
          );
        } catch(e) {}
      }
      if (data.saleId) sheet.getRange(i + 1, 21).setValue(data.saleId);
      updated++;
    }
  }

  return { ok: true, updated };
}

function handleGetReservations() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_RESERVATIONS);
  if (!sheet) return { ok: true, reservations: [] };

  const rows = sheet.getDataRange().getValues();
  const resMap = {};

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = r[0];
    if (!id) continue;
    if (!resMap[id]) {
      let isoDate;
      try {
        const tz = Session.getScriptTimeZone();
        const timeStr = r[2] instanceof Date
          ? Utilities.formatDate(r[2], tz, 'HH:mm:ss') : (r[2] || '00:00:00').toString();
        if (r[1] instanceof Date) {
          isoDate = Utilities.formatDate(r[1], tz, 'yyyy-MM-dd') + 'T' + timeStr;
        } else {
          const parts = r[1].toString().split('/');
          isoDate = parts[2] + '-' + parts[1].padStart(2,'0') + '-' + parts[0].padStart(2,'0') + 'T' + timeStr;
        }
      } catch(e) { isoDate = new Date().toISOString(); }

      const statusRaw = (r[18] || '').toString();
      const status = statusRaw === 'Finalisée' ? 'completed' : statusRaw === 'Annulée' ? 'cancelled' : 'pending';

      resMap[id] = {
        id: Number(id),
        date: isoDate,
        clientName:    r[3]  || '',
        clientContact: r[4]  || '',
        subtotal:      Number(r[9]  || 0),
        remise:        Number(r[10] || 0),
        total:         Number(r[11] || 0),
        accompte:      Number(r[12] || 0),
        restant:       Number(r[13] || 0),
        depositMethod: r[14] === 'Espèces' ? 'cash' : 'mobile',
        depositProvider: r[15] || '',
        depositRef:    r[16] || '',
        caissier:      r[17] || '',
        status,
        dateFinalisation: r[19] || null,
        saleId:        r[20] || null,
        items: []
      };
    }
    resMap[id].items.push({ name: r[5], qty: Number(r[6]), price: Number(r[7]) });
  }

  const reservations = Object.values(resMap).reverse();
  return { ok: true, reservations };
}

// ============================================================
// SHA-256 (natif Apps Script via Utilities)
// ============================================================
function sha256(text) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8
  );
  return raw.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// ============================================================
// COMMANDES
// ID | Date | Heure | Client_Nom | Client_Contact | Adresse_Livraison | Date_Livraison |
// Article | Quantite | Prix_Unitaire | Est_Personnalise | Sous_Total_Article |
// Sous_Total_Commande | Remise | Net_A_Payer | Accompte | Restant |
// Mode_Depot | Fournisseur_Mobile | Reference | Caissier |
// Notes | Statut | Date_Finalisation | Vente_ID
// ============================================================
function handleAddCommande(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_COMMANDES);
  if (!sheet) return { ok: false, error: 'Feuille "Commandes" introuvable. Lancez initSheets().' };

  const cmd = data.commande;
  const d = new Date(cmd.date);
  const tz = Session.getScriptTimeZone();
  const dateStr = Utilities.formatDate(d, tz, 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(d, tz, 'HH:mm:ss');

  const subtotal = Number(cmd.subtotal || 0);
  const remise   = Number(cmd.remise   || 0);
  const total    = Number(cmd.total    || 0);
  const accompte = Number(cmd.accompte || 0);
  const restant  = Number(cmd.restant  || 0);
  const methode  = cmd.depositMethod === 'cash' ? 'Espèces' : 'Mobile Money';

  (cmd.items || []).forEach(item => {
    sheet.appendRow([
      cmd.id,
      dateStr,
      timeStr,
      cmd.clientName         || '',
      cmd.clientContact      || '',
      cmd.adresseLivraison   || '',
      cmd.dateLivraison      || '',
      item.name,
      item.qty,
      item.price,
      item.custom ? 'Oui' : 'Non',
      item.price * item.qty,
      subtotal,
      remise,
      total,
      accompte,
      restant,
      methode,
      cmd.depositProvider    || '',
      cmd.depositRef         || '',
      cmd.caissier           || '',
      cmd.notes              || '',
      'En cours',
      '',
      ''
    ]);
  });

  return { ok: true, commandeId: cmd.id };
}

function handleUpdateCommande(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_COMMANDES);
  if (!sheet) return { ok: false, error: 'Feuille "Commandes" introuvable.' };

  const rows = sheet.getDataRange().getValues();
  const statusLabel = data.status === 'completed' ? 'Livrée' : 'Annulée';
  let updated = 0;

  for (let i = 1; i < rows.length; i++) {
    if (Number(rows[i][0]) === Number(data.id)) {
      sheet.getRange(i + 1, 23).setValue(statusLabel);
      if (data.dateFinalisation) {
        try {
          const df = new Date(data.dateFinalisation);
          sheet.getRange(i + 1, 24).setValue(
            Utilities.formatDate(df, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
          );
        } catch(e) {}
      }
      if (data.saleId) sheet.getRange(i + 1, 25).setValue(data.saleId);
      updated++;
    }
  }
  return { ok: true, updated };
}

function handleGetCommandes() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_COMMANDES);
  if (!sheet) return { ok: true, commandes: [] };

  const rows = sheet.getDataRange().getValues();
  const cmdMap = {};

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = r[0];
    if (!id) continue;

    if (!cmdMap[id]) {
      let isoDate;
      try {
        const tz = Session.getScriptTimeZone();
        const timeStr = r[2] instanceof Date
          ? Utilities.formatDate(r[2], tz, 'HH:mm:ss') : (r[2] || '00:00:00').toString();
        if (r[1] instanceof Date) {
          isoDate = Utilities.formatDate(r[1], tz, 'yyyy-MM-dd') + 'T' + timeStr;
        } else {
          const parts = r[1].toString().split('/');
          isoDate = parts[2] + '-' + parts[1].padStart(2,'0') + '-' + parts[0].padStart(2,'0') + 'T' + timeStr;
        }
      } catch(e) { isoDate = new Date().toISOString(); }

      const statusRaw = (r[22] || '').toString();
      const status = statusRaw === 'Livrée' ? 'completed' : statusRaw === 'Annulée' ? 'cancelled' : 'pending';

      // Date livraison: colonne 7 (index 6)
      const dateLivRaw = r[6];
      let dateLivraison = '';
      if (dateLivRaw instanceof Date) {
        dateLivraison = Utilities.formatDate(dateLivRaw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else if (dateLivRaw) {
        dateLivraison = dateLivRaw.toString();
      }

      cmdMap[id] = {
        id:               Number(id),
        date:             isoDate,
        clientName:       r[3]  || '',
        clientContact:    r[4]  || '',
        adresseLivraison: r[5]  || '',
        dateLivraison,
        subtotal:         Number(r[12] || 0),
        remise:           Number(r[13] || 0),
        total:            Number(r[14] || 0),
        accompte:         Number(r[15] || 0),
        restant:          Number(r[16] || 0),
        depositMethod:    r[17] === 'Espèces' ? 'cash' : 'mobile',
        depositProvider:  r[18] || '',
        depositRef:       r[19] || '',
        caissier:         r[20] || '',
        notes:            r[21] || '',
        status,
        dateFinalisation: r[23] || null,
        saleId:           r[24] || null,
        photos:           [],
        items:            []
      };
    }
    cmdMap[id].items.push({
      name:   r[7]  || '',
      qty:    Number(r[8]  || 0),
      price:  Number(r[9]  || 0),
      custom: r[10] === 'Oui'
    });
  }

  const commandes = Object.values(cmdMap).reverse();
  return { ok: true, commandes };
}

// ============================================================
// IMAGES — Sauvegarde dans Google Drive
// ============================================================
function handleSaveImage(data) {
  try {
    if (!data.imageData) return { ok: false, error: 'Aucune donnée image reçue' };

    // Décoder le base64 (avec ou sans header data:image/...)
    let base64Data = data.imageData;
    let mimeType   = data.mimeType || 'image/jpeg';
    if (base64Data.includes(',')) {
      const parts = base64Data.split(',');
      const header = parts[0];
      base64Data   = parts[1];
      const mimeMatch = header.match(/:(.*?);/);
      if (mimeMatch) mimeType = mimeMatch[1];
    }

    const bytes    = Utilities.base64Decode(base64Data);
    const ext      = mimeType.split('/')[1] || 'jpg';
    const filename = data.filename || ('img_' + Date.now() + '.' + ext);
    const blob     = Utilities.newBlob(bytes, mimeType, filename);

    // Dossier dédié dans Drive
    const folder = _getOrCreateFolder('POS_Boutique_Images');
    const file   = folder.createFile(blob);

    // Rendre accessible publiquement (lecture seule)
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileId  = file.getId();
    const viewUrl = 'https://drive.google.com/uc?export=view&id=' + fileId;

    return { ok: true, url: viewUrl, id: fileId };
  } catch (e) {
    return { ok: false, error: 'saveImage: ' + e.message };
  }
}

function _getOrCreateFolder(name) {
  const existing = DriveApp.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return DriveApp.createFolder(name);
}

// ============================================================
// EXPORT CSV DES VENTES
// ============================================================
function handleGetCSV(params) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_SALES);
  if (!sheet) return { ok: false, error: 'Feuille Ventes introuvable' };

  const rows  = sheet.getDataRange().getValues();
  const from  = params.from || '';
  const to    = params.to   || '';

  const csvLines = [rows[0].join(';')]; // en-tête
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    if (from || to) {
      const cellDate = r[1] instanceof Date ? r[1] : new Date(r[1]);
      if (isNaN(cellDate)) { csvLines.push(r.join(';')); continue; }
      const d = cellDate.toISOString().slice(0, 10);
      if (from && d < from) continue;
      if (to   && d > to)   continue;
    }
    csvLines.push(r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';'));
  }
  return { ok: true, csv: csvLines.join('\n'), rows: csvLines.length - 1 };
}

function handleGetCSVResponse(params) {
  const result = handleGetCSV(params);
  if (!result.ok) return jsonResponse(result);
  return ContentService
    .createTextOutput(result.csv)
    .setMimeType(ContentService.MimeType.CSV);
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
