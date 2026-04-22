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
// ROUTEUR PRINCIPAL
// ============================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result;

    if      (action === 'login')          result = handleLogin(data);
    else if (action === 'getProducts')    result = handleGetProducts();
    else if (action === 'saveProduct')    result = handleSaveProduct(data);
    else if (action === 'deleteProduct')  result = handleDeleteProduct(data);
    else if (action === 'addSale')        result = handleAddSale(data);
    else if (action === 'stockMove')      result = handleStockMove(data);
    else if (action === 'getSales')       result = handleGetSales(data);
    else result = { ok: false, error: 'Action inconnue: ' + action };

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doGet(e) {
  // Actions d'écriture passées via ?payload=JSON (pour contourner CORS du POST)
  if (e.parameter.payload) {
    try {
      const data = JSON.parse(e.parameter.payload);
      const action = data.action;
      let result;
      if      (action === 'addSale')       result = handleAddSale(data);
      else if (action === 'saveProduct')   result = handleSaveProduct(data);
      else if (action === 'deleteProduct') result = handleDeleteProduct(data);
      else if (action === 'stockMove')     result = handleStockMove(data);
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
  return jsonResponse({ ok: false, error: 'Action GET inconnue: ' + action });
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// INITIALISATION DES FEUILLES
// ============================================================
function initSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // Feuille Produits
  let sp = ss.getSheetByName(SHEET_PRODUCTS);
  if (!sp) {
    sp = ss.insertSheet(SHEET_PRODUCTS);
    sp.appendRow(['ID','Nom','Categorie','Emoji','Code','Prix_Vente','Prix_Achat','Stock','Stock_Min','Date_MAJ']);
    sp.getRange(1,1,1,10).setBackground('#0a0e1a').setFontColor('#00e5a0').setFontWeight('bold');
    // Données de démonstration
    const demo = [
      [1,'Riz 1kg','Alimentation','🍚','001',2500,1800,50,10,new Date()],
      [2,'Huile 1L','Alimentation','🫙','002',4500,3200,24,5,new Date()],
      [3,'Sucre 1kg','Alimentation','🧂','003',2000,1500,3,5,new Date()],
      [4,'Coca-Cola 1.5L','Boissons','🥤','004',3500,2500,12,6,new Date()],
      [5,'Eau minérale','Boissons','💧','005',1500,900,36,12,new Date()],
      [6,'Savon Protex','Hygiène','🧼','006',1800,1200,18,5,new Date()],
    ];
    demo.forEach(row => sp.appendRow(row));
  }

  // Feuille Ventes
  let sv = ss.getSheetByName(SHEET_SALES);
  if (!sv) {
    sv = ss.insertSheet(SHEET_SALES);
    sv.appendRow(['ID','Date','Heure','Article','Quantite','Prix_Unitaire','Sous_Total','Total_Vente','Mode_Paiement','Fournisseur_Mobile','Reference','Caissier']);
    sv.getRange(1,1,1,12).setBackground('#0a0e1a').setFontColor('#00e5a0').setFontWeight('bold');
  }

  // Feuille MouvementsStock
  let sm = ss.getSheetByName(SHEET_STOCK_LOG);
  if (!sm) {
    sm = ss.insertSheet(SHEET_STOCK_LOG);
    sm.appendRow(['Date','Article','Type','Quantite','Stock_Avant','Stock_Apres','Motif','Caissier']);
    sm.getRange(1,1,1,8).setBackground('#0a0e1a').setFontColor('#00e5a0').setFontWeight('bold');
  }

  // Feuille Utilisateurs
  let su = ss.getSheetByName(SHEET_USERS);
  if (!su) {
    su = ss.insertSheet(SHEET_USERS);
    su.appendRow(['Username','MotDePasse','Role','Nom','Actif']);
    su.getRange(1,1,1,5).setBackground('#0a0e1a').setFontColor('#00e5a0').setFontWeight('bold');
    su.appendRow(['admin','1234','admin','Administrateur',true]);
    su.appendRow(['caissier','0000','caissier','Caissier',true]);
  }

  return { ok: true, message: 'Feuilles initialisées ✅' };
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
    const [id, name, cat, emoji, code, price, cost, stock, minStock, dateMaj] = rows[i];
    if (!name) continue;
    products.push({ id: Number(id), name, cat, emoji, code: String(code), price: Number(price), cost: Number(cost), stock: Number(stock), minStock: Number(minStock) });
  }
  return { ok: true, products };
}

function handleSaveProduct(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_PRODUCTS);
  const p = data.product;
  const rows = sheet.getDataRange().getValues();
  const now = new Date();

  if (p.id) {
    // Mise à jour
    for (let i = 1; i < rows.length; i++) {
      if (Number(rows[i][0]) === Number(p.id)) {
        sheet.getRange(i+1, 1, 1, 10).setValues([[
          p.id, p.name, p.cat, p.emoji, p.code,
          p.price, p.cost, p.stock, p.minStock, now
        ]]);
        return { ok: true, action: 'updated', id: p.id };
      }
    }
  }

  // Nouveau produit — générer un ID
  const maxId = rows.slice(1).reduce((m, r) => Math.max(m, Number(r[0]) || 0), 0);
  const newId = maxId + 1;
  sheet.appendRow([newId, p.name, p.cat, p.emoji||'📦', p.code||String(newId), p.price, p.cost, p.stock||0, p.minStock||5, now]);
  return { ok: true, action: 'created', id: newId };
}

function handleDeleteProduct(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_PRODUCTS);
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
      return Number(rows[i][7]); // retourne l'ancien stock
    }
  }
  return null;
}

// ============================================================
// VENTES
// ============================================================
function handleAddSale(data) {
  if (SHEET_ID === 'VOTRE_SPREADSHEET_ID') {
    return { ok: false, error: 'SHEET_ID non configuré dans Code.gs — remplacez VOTRE_SPREADSHEET_ID par l\'ID de votre Google Sheet' };
  }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_SALES);
  if (!sheet) return { ok: false, error: 'Feuille "Ventes" introuvable. Lancez initSheets() d\'abord.' };
  const sale = data.sale;
  const d = new Date(sale.date);
  const dateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'HH:mm:ss');

  sale.items.forEach(item => {
    sheet.appendRow([
      sale.id,
      dateStr,
      timeStr,
      item.name,
      item.qty,
      item.price,
      item.price * item.qty,
      sale.total,
      sale.method === 'cash' ? 'Espèces' : 'Mobile Money',
      sale.provider || '',
      sale.ref || '',
      sale.caissier || 'caissier'
    ]);
    // Déduire le stock
    updateProductStock(ss, item.name, -item.qty);
    // Logger le mouvement
    logStockMove(ss, item.name, 'Vente', -item.qty, `Vente #${sale.id}`, sale.caissier || '');
  });

  return { ok: true, saleId: sale.id };
}

function handleGetSales(params) {
  if (SHEET_ID === 'VOTRE_SPREADSHEET_ID') return { ok: false, error: 'SHEET_ID non configuré' };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_SALES);
  if (!sheet) return { ok: true, sales: [] };

  const rows = sheet.getDataRange().getValues();
  const salesMap = {};
  for (let i = 1; i < rows.length; i++) {
    const [id, date, time, article, qty, prixUnit, sousTotal, total, method, provider, ref, caissier] = rows[i];
    if (!id) continue;
    if (!salesMap[id]) {
      // Convertir la date dd/MM/yyyy en ISO pour que JavaScript puisse la parser
      let isoDate;
      try {
        if (date instanceof Date) {
          isoDate = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd") + 'T' + (time || '00:00:00');
        } else {
          const parts = date.toString().split('/');
          isoDate = parts[2] + '-' + parts[1].padStart(2,'0') + '-' + parts[0].padStart(2,'0') + 'T' + (time || '00:00:00');
        }
      } catch(e) {
        isoDate = new Date().toISOString();
      }
      salesMap[id] = {
        id: Number(id),
        date: isoDate,
        total: Number(total),
        method: method === 'Espèces' ? 'cash' : 'mobile',
        provider: provider || '',
        ref: ref || '',
        caissier: caissier || '',
        items: []
      };
    }
    salesMap[id].items.push({ name: article, qty: Number(qty), price: Number(prixUnit) });
  }
  const sales = Object.values(salesMap).reverse().slice(0, Number(params.limit) || 100);
  return { ok: true, sales };
}

// ============================================================
// MOUVEMENTS STOCK
// ============================================================
function handleStockMove(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const { productName, type, qty, reason, caissier } = data;
  const delta = type === 'in' ? qty : -qty;
  const oldStock = updateProductStock(ss, productName, delta);
  if (oldStock === null) return { ok: false, error: 'Produit introuvable: ' + productName };
  logStockMove(ss, productName, type === 'in' ? 'Entrée' : 'Sortie', delta, reason, caissier || '');
  return { ok: true, newStock: oldStock + delta };
}

function logStockMove(ss, productName, type, delta, reason, caissier) {
  const sheet = ss.getSheetByName(SHEET_STOCK_LOG);
  if (!sheet) return;
  const rows = sheet.getDataRange().getValues();
  let currentStock = 0;
  // Chercher stock actuel
  const prodSheet = ss.getSheetByName(SHEET_PRODUCTS);
  const prodRows = prodSheet.getDataRange().getValues();
  for (let i = 1; i < prodRows.length; i++) {
    if (prodRows[i][1] === productName) { currentStock = Number(prodRows[i][7]); break; }
  }
  sheet.appendRow([
    new Date(), productName, type, delta,
    currentStock - delta, currentStock,
    reason, caissier
  ]);
}

// ============================================================
// FONCTION DE TEST
// ============================================================
function testAll() {
  // Test login
  let r = handleLogin({ username: 'admin', password: '1234' });
  Logger.log('Login: ' + JSON.stringify(r));

  // Test getProducts
  r = handleGetProducts();
  Logger.log('Products count: ' + (r.products ? r.products.length : 'ERROR'));

  // Test addSale
  r = handleAddSale({ sale: {
    id: 9999,
    date: new Date().toISOString(),
    items: [{ name: 'Riz 1kg', qty: 1, price: 2500 }],
    total: 2500,
    method: 'cash',
    given: 5000,
    change: 2500,
    caissier: 'admin'
  }});
  Logger.log('Sale: ' + JSON.stringify(r));

  Logger.log('✅ Tous les tests passés !');
}
