// ============================================================
// SHA-256 (WebCrypto API — natif dans tous les navigateurs modernes)
// ============================================================
async function sha256(str) {
  const msgBuffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => ('0' + b.toString(16)).slice(-2)).join('');
}

// ============================================================
// DATA & STATE
// ============================================================
// Utilisateurs locaux (persistés dans localStorage)
let localUsers = [
  { username:'admin',    pass:'1234', role:'admin',    label:'Administrateur', actif:true },
  { username:'caissier', pass:'0000', role:'caissier', label:'Caissier',       actif:true }
];
let editingUserId = null; // index dans localUsers

let currentUser = null;
let cart = [];
let paymentMode = 'cash';
let selectedProvider = 'MVola';
let editingProductId = null;
let editingProductImage = null;

// Demo products
let products = [
  { id:1, name:'Riz 1kg', cat:'Alimentation', emoji:'🍚', code:'001', price:2500, cost:1800, stock:50, minStock:10 },
  { id:2, name:'Huile 1L', cat:'Alimentation', emoji:'🫙', code:'002', price:4500, cost:3200, stock:24, minStock:5 },
  { id:3, name:'Sucre 1kg', cat:'Alimentation', emoji:'🧂', code:'003', price:2000, cost:1500, stock:3, minStock:5 },
  { id:4, name:'Coca-Cola 1.5L', cat:'Boissons', emoji:'🥤', code:'004', price:3500, cost:2500, stock:0, minStock:6 },
  { id:5, name:'Eau minérale', cat:'Boissons', emoji:'💧', code:'005', price:1500, cost:900, stock:36, minStock:12 },
  { id:6, name:'Savon Protex', cat:'Hygiène', emoji:'🧼', code:'006', price:1800, cost:1200, stock:18, minStock:5 },
  { id:7, name:'Lait concentré', cat:'Alimentation', emoji:'🥛', code:'007', price:2200, cost:1600, stock:8, minStock:10 },
  { id:8, name:'Bougie x10', cat:'Autres', emoji:'🕯️', code:'008', price:1200, cost:700, stock:30, minStock:5 },
];

let sales = [
  { id:1, date:new Date(Date.now()-86400000).toISOString(), items:[{name:'Riz 1kg',qty:2,price:2500},{name:'Huile 1L',qty:1,price:4500}], total:9500, method:'cash', given:10000, change:500 },
  { id:2, date:new Date(Date.now()-3600000).toISOString(), items:[{name:'Savon Protex',qty:3,price:1800}], total:5400, method:'mobile', provider:'MVola', ref:'TX9876' },
];

let nextId = 9;
let nextSaleId = 3;

let reservations = [];
let nextReservationId = 1;
let resPaymentMode = 'cash';
let resSelectedProvider = 'MVola';
let finPaymentMode = 'cash';
let finSelectedProvider = 'MVola';
let currentFinalizeResId = null;

// ============================================================
// UTILS
// ============================================================
function fmt(n) { const v = Number(n); return (isNaN(v) ? 0 : v).toLocaleString('fr-MG') + ' Ar'; }
function now() { return new Date().toLocaleString('fr-MG'); }
function showToast(msg, type='success') {
  const t = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  t.appendChild(el);
  setTimeout(()=>el.remove(), 3500);
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ============================================================
// LOGIN
// ============================================================
async function doLogin() {
  const u = document.getElementById('loginUser').value.trim().toLowerCase();
  const p = document.getElementById('loginPass').value;
  const err = document.getElementById('loginError');
  const btn = document.querySelector('.btn-login');
  btn.disabled = true; btn.textContent = '⏳ Connexion...';

  let loginOk = false;
  let userInfo = null;

  // Hasher le mot de passe pour la comparaison locale uniquement
  const pHashed = await sha256(p);

  // Essayer Apps Script en premier si URL configurée
  // ⚠️ Envoyer le mot de passe en CLAIR au backend (le serveur se charge du hashage)
  if (APPS_SCRIPT_URL) {
    const r = await loginViaScript(u, p);
    if (r && r.ok) {
      loginOk = true; userInfo = r.user;
    } else if (r && !r.ok) {
      const errMsg = r.error || '';
      const isCredError = errMsg.toLowerCase().includes('identifiant') ||
                          errMsg.toLowerCase().includes('mot de passe') ||
                          errMsg.toLowerCase().includes('incorrect') ||
                          errMsg.toLowerCase().includes('password');
      if (isCredError) {
        btn.disabled = false; btn.textContent = 'Se connecter';
        err.textContent = '❌ ' + errMsg;
        err.style.display = 'block';
        return;
      }
      showToast('⚠️ Google Sheets inaccessible — connexion locale. ' + errMsg, 'info');
    }
  }

  // Fallback local : accepte le mot de passe en clair OU son hash SHA-256
  if (!loginOk) {
    const lu = localUsers.find(x =>
      x.username.toLowerCase() === u &&
      (x.pass === p || x.pass === pHashed) &&
      x.actif !== false
    );
    if (lu) { loginOk = true; userInfo = { username: lu.username, role: lu.role, label: lu.label }; }
  }

  btn.disabled = false; btn.textContent = 'Se connecter';

  if (loginOk && userInfo) {
    currentUser = userInfo;
    document.getElementById('currentUserLabel').textContent = currentUser.label;
    document.getElementById('loginScreen').style.display='none';
    document.getElementById('app').style.display='flex';
    document.getElementById('bottomNav').style.display='block';
    err.style.display='none';
    showToast(`Bonjour, ${currentUser.label} ! 👋`);
    // Charger les données depuis le Sheet
    if (APPS_SCRIPT_URL) {
      await loadProductsFromScript();
      await loadSalesFromScript();
      await loadUsersFromScript();
      await loadReservationsFromScript();
      await syncPendingOfflineSales();
    }
    applyRolePermissions(currentUser.role);
    updatePendingBadge();
    updateResBadge();
    renderProducts();
    renderStockTable();
    renderStats();
    if (window.innerWidth <= 768) switchCaisseTab('products');
  } else {
    err.textContent = '❌ Identifiant ou mot de passe incorrect';
    err.style.display='block';
  }
}
document.getElementById('loginPass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
function doLogout() {
  currentUser = null;
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('app').style.display='none';
  document.getElementById('bottomNav').style.display='none';
  document.getElementById('loginUser').value='';
  document.getElementById('loginPass').value='';
}

// ============================================================
// NAVIGATION
// ============================================================
function showPage(id, btn, bnavBtn) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.bnav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  if (btn) btn.classList.add('active');
  // Sync bottom nav
  const bnav = document.getElementById('bnav-'+id);
  if (bnav) bnav.classList.add('active');
  if (bnavBtn) bnavBtn.classList.add('active');
  // Sync top nav button too
  document.querySelectorAll('.nav-btn').forEach(b => {
    if (b.getAttribute('onclick') && b.getAttribute('onclick').includes("'"+id+"'")) b.classList.add('active');
  });
  if (id==='stats')        { renderStats(); _autoRefreshStats(); }
  if (id==='config')       renderConfigPage();
  if (id==='users')        renderUsersPage();
  if (id==='reservations') { renderReservations(); _autoRefreshReservations(); }
  if (id==='commandes')    { renderCommandes(); _autoRefreshCommandes(); }
  // Garde : caissier ne peut accéder qu'à caisse + réservations + commandes
  if (currentUser && currentUser.role !== 'admin' && id !== 'caisse' && id !== 'reservations' && id !== 'commandes') {
    showPage('caisse', null, null);
    showToast('⛔ Accès réservé aux administrateurs', 'error');
  }
}

function switchCaisseTab(tab) {
  const products = document.querySelector('.products-panel');
  const cart = document.querySelector('.cart-panel');
  const tabP = document.getElementById('tabProducts');
  const tabC = document.getElementById('tabCart');
  if (tab === 'products') {
    products.style.display = '';
    cart.style.display = 'none';
    tabP.classList.add('active'); tabC.classList.remove('active');
  } else {
    products.style.display = 'none';
    cart.style.display = '';
    tabP.classList.remove('active'); tabC.classList.add('active');
  }
}

// ============================================================
// PRODUCTS / CAISSE
// ============================================================
function renderProducts() {
  const q = (document.getElementById('searchInput').value||'').toLowerCase();
  const grid = document.getElementById('productsGrid');
  const filtered = products.filter(p => p.name.toLowerCase().includes(q) || p.code.includes(q));
  grid.innerHTML = filtered.map(p => `
    <div class="product-card ${p.stock===0?'out-of-stock':''}" onclick="addToCart(${p.id})">
      ${p.image
        ? `<img class="product-img" src="${p.image}" alt="${p.name}" loading="lazy" />`
        : `<span class="product-emoji">${p.emoji||'📦'}</span>`}
      <div class="product-name">${p.name}</div>
      <div class="product-price">${fmt(p.price)}</div>
      <div class="product-stock ${p.stock===0?'stock-out':p.stock<=p.minStock?'stock-low':''}">
        ${p.stock===0?'⛔ Rupture':p.stock<=p.minStock?`⚠️ Stock: ${p.stock}`:`Stock: ${p.stock}`}
      </div>
    </div>`).join('');
}
function filterProducts() { renderProducts(); }

function addToCart(id) {
  const prod = products.find(p=>p.id===id);
  if(!prod || prod.stock===0) return;
  const existing = cart.find(c=>c.id===id);
  if(existing) {
    if(existing.qty >= prod.stock) { showToast('Stock insuffisant !','error'); return; }
    existing.qty++;
  } else {
    cart.push({ id, name:prod.name, price:prod.price, qty:1, emoji:prod.emoji });
  }
  renderCart();
}
function removeFromCart(id) { cart = cart.filter(c=>c.id!==id); renderCart(); }
function changeQty(id, delta) {
  const item = cart.find(c=>c.id===id);
  if(!item) return;
  const prod = products.find(p=>p.id===id);
  item.qty += delta;
  if(item.qty < 1 || item.qty > prod.stock) { item.qty -= delta; showToast('Quantité invalide','error'); return; }
  renderCart();
}
function clearCart() {
  cart=[];
  const ri = document.getElementById('cartRemise'); if(ri) ri.value='';
  const ai = document.getElementById('cartAccompte'); if(ai) ai.value='';
  renderCart();
}
function getSubtotal() { return cart.reduce((s,i)=>s+i.price*i.qty,0); }
function getRemise()   { return Math.min(parseFloat(document.getElementById('cartRemise')?.value)||0, getSubtotal()); }
function getAccompte() { return Math.max(0, parseFloat(document.getElementById('cartAccompte')?.value)||0); }
function getNetTotal() { return Math.max(0, getSubtotal() - getRemise()); }
function getDue()      { return Math.max(0, getNetTotal() - getAccompte()); }
function getTotal()    { return getNetTotal(); }

function updateCartTotals() {
  const sub = getSubtotal();
  const rem = getRemise();
  const net = getNetTotal();
  const acc = getAccompte();
  const due = getDue();
  document.getElementById('subtotalVal').textContent = fmt(sub);
  document.getElementById('totalVal').textContent    = fmt(net);
  const remVal = document.getElementById('remiseVal');
  if (remVal) remVal.textContent = rem > 0 ? '-' + fmt(rem) : '';
  const accVal = document.getElementById('accompteVal');
  if (accVal) accVal.textContent = acc > 0 ? '-' + fmt(acc) : '';
  const dueRow = document.getElementById('cartDueRow');
  const dueEl  = document.getElementById('dueVal');
  if (dueRow && dueEl) {
    dueRow.style.display = acc > 0 ? 'flex' : 'none';
    dueEl.textContent = fmt(due);
  }
  // mobile tab badge
  const totalQty = cart.reduce((s,i)=>s+i.qty,0);
  const tabBadge = document.getElementById('caisseTabCartCount');
  if (tabBadge) tabBadge.textContent = totalQty;
}

function renderCart() {
  const el = document.getElementById('cartItems');
  const totalQty = cart.reduce((s,i)=>s+i.qty,0);
  document.getElementById('cartCount').textContent = totalQty;
  updateCartTotals();
  if(cart.length===0) { el.innerHTML='<div class="cart-empty"><span class="icon">🛍️</span>Le panier est vide</div>'; return; }
  el.innerHTML = cart.map(i=>`
    <div class="cart-item">
      <span style="font-size:20px">${i.emoji||'📦'}</span>
      <div class="cart-item-info">
        <div class="cart-item-name">${i.name}</div>
        <div class="cart-item-price">${fmt(i.price)} / unité</div>
      </div>
      <div class="cart-qty">
        <button class="qty-btn" onclick="changeQty(${i.id},-1)">−</button>
        <span class="qty-val">${i.qty}</span>
        <button class="qty-btn" onclick="changeQty(${i.id},1)">+</button>
      </div>
      <div class="cart-item-total">${fmt(i.price*i.qty)}</div>
      <button class="btn-remove" onclick="removeFromCart(${i.id})">🗑</button>
    </div>`).join('');
}

// ============================================================
// PAYMENT
// ============================================================
function openPayment(mode) {
  if(cart.length===0) { showToast('Le panier est vide !','error'); return; }
  paymentMode = mode;
  const due = getDue();
  const acc = getAccompte();
  const net = getNetTotal();
  document.getElementById('payAmount').textContent = fmt(due);
  const infoEl = document.getElementById('payAccompteInfo');
  if (acc > 0) {
    infoEl.style.display = 'block';
    infoEl.textContent = `Net ${fmt(net)} — Accompte ${fmt(acc)} — Reste dû ${fmt(due)}`;
    document.getElementById('payAmountLabel').textContent = 'Reste à régler maintenant';
  } else {
    infoEl.style.display = 'none';
    document.getElementById('payAmountLabel').textContent = 'Montant à régler';
  }
  document.getElementById('givenAmount').value='';
  document.getElementById('changeVal').textContent='0 Ar';
  document.getElementById('changeVal').className='val';
  document.getElementById('mobileRef').value='';
  document.getElementById('clientName').value='';
  document.getElementById('clientContact').value='';
  switchPayTab(mode);
  openModal('paymentModal');
}
function switchPayTab(mode) {
  paymentMode = mode;
  document.getElementById('cashSection').style.display = mode==='cash'?'block':'none';
  document.getElementById('mobileSection').style.display = mode==='mobile'?'block':'none';
  document.getElementById('tabCash').classList.toggle('active', mode==='cash');
  document.getElementById('tabMobile').classList.toggle('active', mode==='mobile');
}
function calcChange() {
  const given = parseFloat(document.getElementById('givenAmount').value)||0;
  const due = getDue();
  const change = given - due;
  const el = document.getElementById('changeVal');
  el.textContent = fmt(Math.abs(change));
  el.className = 'val ' + (change >= 0 ? 'positive':'negative');
}
function selectProvider(p) {
  selectedProvider = p;
  document.querySelectorAll('.provider-btn').forEach(b=>b.classList.remove('active'));
  const map = {'MVola':'provMvola','Airtel Money':'provAirtel','Orange Money':'provOrange','Bmoov':'provBmoov'};
  document.getElementById(map[p]).classList.add('active');
}
function confirmPayment() {
  const net = getNetTotal();
  const rem = getRemise();
  const acc = getAccompte();
  const due = getDue();
  const clientName    = document.getElementById('clientName').value.trim();
  const clientContact = document.getElementById('clientContact').value.trim();
  if(paymentMode==='cash') {
    const given = parseFloat(document.getElementById('givenAmount').value)||0;
    if(given < due) { showToast('Montant insuffisant !','error'); return; }
    recordSale(net, 'cash', given, given-due, null, null, rem, acc, clientName, clientContact);
  } else {
    const ref = document.getElementById('mobileRef').value.trim();
    recordSale(net, 'mobile', due, 0, selectedProvider, ref, rem, acc, clientName, clientContact);
  }
}
function recordSale(total, method, given, change, provider, ref, remise=0, accompte=0, clientName='', clientContact='') {
  cart.forEach(item => {
    const p = products.find(pr=>pr.id===item.id);
    if(p) p.stock -= item.qty;
  });
  const subtotal = getSubtotal();
  const sale = {
    id: nextSaleId++,
    date: new Date().toISOString(),
    caissier: currentUser?.label || 'Caissier',
    clientName, clientContact,
    items: cart.map(i=>({name:i.name,qty:i.qty,price:i.price})),
    subtotal, remise, total, accompte,
    due: Math.max(0, total - accompte),
    method, given, change, provider, ref
  };
  sales.unshift(sale);
  printTicket(sale);
  saveData();
  closeModal('paymentModal');
  const msg = method==='cash' ? 'Monnaie: '+fmt(change) : 'Ref: '+(ref||'—');
  showToast(`✅ Vente enregistrée ! ${msg}`);
  clearCart();
  renderProducts();
  renderStockTable();
  renderStats();
  syncToAppsScript(sale);
}

// ============================================================
// RÉSERVATIONS — CRÉER
// ============================================================
function openReservation() {
  if (cart.length === 0) { showToast('Le panier est vide !', 'error'); return; }
  const net = getNetTotal();
  document.getElementById('resTotal').textContent = fmt(net);
  document.getElementById('resClientName').value = '';
  document.getElementById('resClientContact').value = '';
  document.getElementById('resAccompte').value = '';
  document.getElementById('resRestantLabel').textContent = fmt(net);
  document.getElementById('resGiven').value = '';
  document.getElementById('resChangeVal').textContent = '0 Ar';
  document.getElementById('resMobileRef').value = '';
  resPaymentMode = 'cash';
  resSelectedProvider = 'MVola';
  switchResPayTab('cash');
  openModal('reservationModal');
}

function updateResRestant() {
  const net = getNetTotal();
  const acc = Math.max(0, parseFloat(document.getElementById('resAccompte').value) || 0);
  document.getElementById('resRestantLabel').textContent = fmt(Math.max(0, net - acc));
}

function switchResPayTab(mode) {
  resPaymentMode = mode;
  document.getElementById('resCashSection').style.display = mode === 'cash' ? 'block' : 'none';
  document.getElementById('resMobileSection').style.display = mode === 'mobile' ? 'block' : 'none';
  document.getElementById('tabResCash').classList.toggle('active', mode === 'cash');
  document.getElementById('tabResMobile').classList.toggle('active', mode === 'mobile');
}

function calcResChange() {
  const given = parseFloat(document.getElementById('resGiven').value) || 0;
  const acc   = Math.max(0, parseFloat(document.getElementById('resAccompte').value) || 0);
  const change = given - acc;
  const el = document.getElementById('resChangeVal');
  el.textContent = fmt(Math.abs(change));
  el.className = 'val ' + (change >= 0 ? 'positive' : 'negative');
}

function selectResProvider(p) {
  resSelectedProvider = p;
  document.querySelectorAll('#reservationModal .provider-btn').forEach(b => b.classList.remove('active'));
  const map = { 'MVola':'resProvMvola','Airtel Money':'resProvAirtel','Orange Money':'resProvOrange','Bmoov':'resProvBmoov' };
  if (map[p]) document.getElementById(map[p]).classList.add('active');
}

function confirmReservation() {
  const clientName    = document.getElementById('resClientName').value.trim();
  const clientContact = document.getElementById('resClientContact').value.trim();
  const acc           = Math.max(0, parseFloat(document.getElementById('resAccompte').value) || 0);
  const net           = getNetTotal();

  if (!clientName) { showToast('Le nom du client est obligatoire !', 'error'); return; }
  if (acc <= 0)    { showToast('L\'acompte doit être supérieur à 0 !', 'error'); return; }
  if (acc > net)   { showToast('L\'acompte ne peut pas dépasser le total !', 'error'); return; }

  if (resPaymentMode === 'cash') {
    const given = parseFloat(document.getElementById('resGiven').value) || 0;
    if (given < acc) { showToast('Montant remis insuffisant pour l\'acompte !', 'error'); return; }
    const change = given - acc;
    saveReservation(acc, 'cash', given, change, null, null, clientName, clientContact);
  } else {
    const ref = document.getElementById('resMobileRef').value.trim();
    saveReservation(acc, 'mobile', acc, 0, resSelectedProvider, ref, clientName, clientContact);
  }
}

function saveReservation(accompte, depositMethod, given, change, provider, ref, clientName, clientContact) {
  const subtotal = getSubtotal();
  const remise   = getRemise();
  const total    = getNetTotal();
  const restant  = Math.max(0, total - accompte);

  // Réduire le stock (article mis de côté)
  cart.forEach(item => {
    const p = products.find(pr => pr.id === item.id);
    if (p) p.stock -= item.qty;
  });

  const reservation = {
    id:            nextReservationId++,
    date:          new Date().toISOString(),
    caissier:      currentUser?.label || 'Caissier',
    clientName, clientContact,
    items:         cart.map(i => ({ name: i.name, qty: i.qty, price: i.price })),
    subtotal, remise, total, accompte, restant,
    depositMethod, depositProvider: provider || '', depositRef: ref || '',
    depositGiven: given, depositChange: change,
    status: 'pending',
    dateFinalisation: null,
    saleId: null
  };

  reservations.unshift(reservation);
  saveData();
  syncReservationToSheets(reservation);
  printReservationTicket(reservation);
  closeModal('reservationModal');
  showToast(`📋 Réservation #${reservation.id} créée — Acompte ${fmt(accompte)}`);
  clearCart();
  renderProducts();
  renderStockTable();
  updateResBadge();
}

// ============================================================
// RÉSERVATIONS — AFFICHER
// ============================================================
// ── Auto-refresh réservations (cooldown 45 s) ─────────────
let _lastResRefresh = 0;

async function _autoRefreshReservations() {
  if (!APPS_SCRIPT_URL) { renderReservations(); return; }
  const now = Date.now();
  if (now - _lastResRefresh < 45000) return;
  _lastResRefresh = now;
  const btn = document.getElementById('resRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Actualisation...'; }
  try {
    await loadReservationsFromScript();
  } catch(e) {
    console.warn('loadReservationsFromScript error:', e);
    showToast('⚠️ Erreur chargement réservations — données locales affichées', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Actualiser'; }
    renderReservations();
    updateResBadge();
  }
}

async function manualRefreshReservations() {
  if (!APPS_SCRIPT_URL) { showToast('⚠️ URL Apps Script non configurée', 'error'); return; }
  _lastResRefresh = 0;
  await _autoRefreshReservations();
  showToast('✅ Réservations actualisées');
}

function renderReservations() {
  const filter = document.getElementById('resFilter')?.value || 'pending';
  let list = reservations.filter(r => filter === 'all' ? true : r.status === filter);

  // Summary (pending only)
  const pending = reservations.filter(r => r.status === 'pending');
  document.getElementById('resSumCount').textContent   = pending.length;
  document.getElementById('resSumTotal').textContent   = fmt(pending.reduce((s, r) => s + (Number(r.total)   || 0), 0));
  document.getElementById('resSumAcc').textContent     = fmt(pending.reduce((s, r) => s + (Number(r.accompte) || 0), 0));
  document.getElementById('resSumRestant').textContent = fmt(pending.reduce((s, r) => s + (Number(r.restant)  || 0), 0));

  const container = document.getElementById('reservationsList');
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `<div class="res-empty">📋 Aucune réservation ${filter === 'pending' ? 'en attente' : ''}</div>`;
    return;
  }

  container.innerHTML = list.map(r => {
    try {
    const d = parseSaleDate(r.date);
    const dateStr = d ? d.toLocaleString('fr-FR') : '—';
    const statusLabel = { pending: 'En attente', completed: 'Finalisée', cancelled: 'Annulée' }[r.status] || r.status;
    const statusClass = { pending: 'res-status-pending', completed: 'res-status-completed', cancelled: 'res-status-cancelled' }[r.status] || '';
    const itemsStr = (Array.isArray(r.items) ? r.items : []).map(i => `${String(i.name||'?')} ×${Number(i.qty)||1} — ${fmt(Number(i.price)||0)}`).join('<br>') || '—';
    const actions = r.status === 'pending' ? `
      <button class="btn-finalize" onclick="openFinalizeModal(${r.id})">✅ Finaliser</button>
      <button class="btn-cancel-res" onclick="cancelReservation(${r.id})">❌ Annuler</button>
      <button class="btn-reprint-res" onclick="printReservationTicket(reservations.find(x=>x.id===${r.id}))" title="Réimprimer">🖨️</button>
    ` : `<button class="btn-reprint-res" onclick="printReservationTicket(reservations.find(x=>x.id===${r.id}))" title="Réimprimer">🖨️</button>`;

    return `
    <div class="res-card">
      <div class="res-card-header">
        <div>
          <div class="res-card-client">👤 ${r.clientName} <span style="font-size:12px;color:var(--muted);font-weight:400">#${r.id}</span></div>
          ${r.clientContact ? `<div class="res-card-contact">📞 ${r.clientContact}</div>` : ''}
        </div>
        <div style="text-align:right">
          <span class="res-status ${statusClass}">${statusLabel}</span>
          <div class="res-card-date">${dateStr}</div>
        </div>
      </div>
      <div class="res-items" style="line-height:1.8">📦 ${itemsStr}</div>
      <div class="res-amounts">
        <div class="res-amount-item"><span class="lbl">Total</span><span class="val">${fmt(r.total)}</span></div>
        <div class="res-amount-item"><span class="lbl">Acompte versé</span><span class="val" style="color:var(--green)">${fmt(r.accompte)}</span></div>
        <div class="res-amount-item"><span class="lbl">Restant dû</span><span class="val" style="color:${r.status==='pending'?'var(--accent)':'var(--muted)'}">${fmt(r.restant)}</span></div>
      </div>
      <div class="res-actions">${actions}</div>
    </div>`;
    } catch(e) {
      console.error('renderReservations card #' + r.id + ':', e);
      return `<div class="res-card" style="color:var(--muted);font-size:13px;padding:12px">⚠️ Réservation #${r.id} — erreur affichage: ${e.message}</div>`;
    }
  }).join('');
}

function updateResBadge() {
  const n = reservations.filter(r => r.status === 'pending').length;
  const badge = document.getElementById('navResBadge');
  if (badge) { badge.textContent = n; badge.style.display = n > 0 ? 'inline' : 'none'; }
}

// ============================================================
// RÉSERVATIONS — FINALISER
// ============================================================
function openFinalizeModal(id) {
  const r = reservations.find(x => x.id === id);
  if (!r) return;
  currentFinalizeResId = id;
  document.getElementById('finalizeClientInfo').textContent = `👤 ${r.clientName}${r.clientContact ? ' — ' + r.clientContact : ''}`;
  document.getElementById('finalTotal').textContent   = fmt(r.total);
  document.getElementById('finalAcc').textContent     = fmt(r.accompte);
  document.getElementById('finalRestant').textContent = fmt(r.restant);
  document.getElementById('finGiven').value = '';
  document.getElementById('finChangeVal').textContent = '0 Ar';
  document.getElementById('finMobileRef').value = '';
  finPaymentMode = 'cash';
  finSelectedProvider = 'MVola';
  switchFinPayTab('cash');
  openModal('finalizeModal');
}

function switchFinPayTab(mode) {
  finPaymentMode = mode;
  document.getElementById('finCashSection').style.display  = mode === 'cash'   ? 'block' : 'none';
  document.getElementById('finMobileSection').style.display = mode === 'mobile' ? 'block' : 'none';
  document.getElementById('tabFinCash').classList.toggle('active', mode === 'cash');
  document.getElementById('tabFinMobile').classList.toggle('active', mode === 'mobile');
}

function calcFinChange() {
  const r = reservations.find(x => x.id === currentFinalizeResId);
  if (!r) return;
  const given  = parseFloat(document.getElementById('finGiven').value) || 0;
  const change = given - r.restant;
  const el = document.getElementById('finChangeVal');
  el.textContent = fmt(Math.abs(change));
  el.className = 'val ' + (change >= 0 ? 'positive' : 'negative');
}

function selectFinProvider(p) {
  finSelectedProvider = p;
  document.querySelectorAll('#finalizeModal .provider-btn').forEach(b => b.classList.remove('active'));
  const map = { 'MVola':'finProvMvola','Airtel Money':'finProvAirtel','Orange Money':'finProvOrange','Bmoov':'finProvBmoov' };
  if (map[p]) document.getElementById(map[p]).classList.add('active');
}

function confirmFinalize() {
  const r = reservations.find(x => x.id === currentFinalizeResId);
  if (!r) return;

  if (finPaymentMode === 'cash') {
    const given = parseFloat(document.getElementById('finGiven').value) || 0;
    if (given < r.restant) { showToast('Montant insuffisant !', 'error'); return; }
    _doFinalize(r, 'cash', given, given - r.restant, null, null);
  } else {
    const ref = document.getElementById('finMobileRef').value.trim();
    _doFinalize(r, 'mobile', r.restant, 0, finSelectedProvider, ref);
  }
}

function _doFinalize(r, method, given, change, provider, ref) {
  // Créer la vente complète
  const sale = {
    id:            nextSaleId++,
    date:          new Date().toISOString(),
    caissier:      currentUser?.label || 'Caissier',
    clientName:    r.clientName,
    clientContact: r.clientContact,
    items:         r.items,
    subtotal:      r.subtotal,
    remise:        r.remise,
    total:         r.total,
    accompte:      r.accompte,
    due:           0,
    method, given, change,
    provider: provider || '',
    ref:      ref      || '',
    fromReservation: r.id
  };

  sales.unshift(sale);

  // Mettre à jour la réservation
  r.status           = 'completed';
  r.dateFinalisation = new Date().toISOString();
  r.saleId           = sale.id;

  saveData();
  renderStats();
  syncToAppsScript(sale);
  syncReservationCompleteToSheets(r);
  closeModal('finalizeModal');
  printTicket(sale);
  showToast(`✅ Vente #${sale.id} enregistrée — Réservation #${r.id} finalisée !`);
  renderReservations();
  updateResBadge();
}

// ============================================================
// RÉSERVATIONS — ANNULER
// ============================================================
function cancelReservation(id) {
  const r = reservations.find(x => x.id === id);
  if (!r || r.status !== 'pending') return;
  if (!confirm(`Annuler la réservation #${r.id} de ${r.clientName} ?\nLe stock sera restitué.`)) return;

  // Restituer le stock
  (Array.isArray(r.items) ? r.items : []).forEach(item => {
    const p = products.find(pr => pr.name === item.name);
    if (p) p.stock += Number(item.qty) || 0;
  });

  r.status = 'cancelled';
  saveData();
  renderProducts();
  renderStockTable();
  renderReservations();
  updateResBadge();
  showToast(`Réservation #${r.id} annulée — stock restitué`, 'info');
  syncReservationCompleteToSheets(r);
}

// ============================================================
// TICKET RÉSERVATION
// ============================================================
// ============================================================
// TICKET — FONCTIONS D'IMPRESSION (utilisent shopConfig)
// ============================================================
function _ticketStyles(tc) {
  const font  = tc.ticketFont || 'Arial';
  const color = tc.ticketColor || '#000000';
  const sep   = tc.ticketSep  || 'dashed';
  const sepSolid = sep === 'double'
    ? 'border:none;border-top:3px double #000;margin:6px 0'
    : `border:none;border-top:2px ${sep} #000;margin:6px 0`;
  const sepLight = sep === 'double'
    ? 'border:none;border-top:2px double #ccc;margin:5px 0'
    : `border:none;border-top:1px ${sep} #ccc;margin:5px 0`;
  return { font, color, sepSolid, sepLight };
}

function _ticketLogoHtml(tc) {
  if (!tc.ticketLogo) return '';
  const h   = { small: 40, medium: 70, large: 100 }[tc.ticketLogoSize || 'medium'];
  const align = { left:'left', right:'right', center:'center' }[tc.ticketLogoPos || 'center'];
  return `<div style="text-align:${align};margin-bottom:5px"><img src="${tc.ticketLogo}" style="height:${h}px;max-width:100%;object-fit:contain" /></div>`;
}

function _ticketShopHeader(tc, st) {
  return `
    ${_ticketLogoHtml(tc)}
    <div style="font-size:14pt;font-weight:bold;text-align:center;margin-bottom:2px;font-family:${st.font}">${tc.name}</div>
    ${tc.address ? `<div style="font-size:9pt;text-align:center;color:#555;margin-bottom:2px">${tc.address}</div>` : ''}
    ${tc.phone   ? `<div style="font-size:9pt;text-align:center;color:#555;margin-bottom:2px">Tél : ${tc.phone}</div>` : ''}`;
}

function _openTicketWindow(htmlBody, title='Ticket') {
  setTimeout(() => {
    const w = window.open('', '_blank', 'width=420,height=620');
    const tc = shopConfig;
    const font = tc.ticketFont || 'Arial';
    w.document.write(`<html><head><title>${title}</title><style>
      @page{size:10.5cm 15cm;margin:0.5cm}
      *{box-sizing:border-box}
      body{font-family:${font},sans-serif;font-size:10pt;margin:0;padding:0;width:10.5cm;color:#000}
      .row{display:flex;justify-content:space-between;align-items:baseline;padding:1px 0}
      .row span:first-child{color:#555}
      .row span:last-child{font-weight:500}
      .row.bold{font-weight:bold;font-size:11pt}
      .row.bold span:first-child{color:#000}
      .items-section .row{border-bottom:1px dotted #ccc;padding:3px 0}
      .items-section .row span:first-child{color:#000;flex:1;margin-right:8px}
      .items-section .row span:last-child{white-space:nowrap;font-weight:600}
      .footer{text-align:center;font-size:9pt;color:#555;margin-top:4px;font-style:italic}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body onload="window.print()">${htmlBody}</body></html>`);
    w.document.close();
  }, 200);
}

function printTicket(sale) {
  const tc  = shopConfig;
  const st  = _ticketStyles(tc);
  const dateStr = new Date(sale.date).toLocaleString('fr-MG');

  // Mise à jour du DOM ticket caché (pour compatibilité)
  document.getElementById('tDate').textContent        = dateStr;
  document.getElementById('tResponsable').textContent = sale.caissier || '';
  document.getElementById('tPhone').textContent       = tc.phone || '';
  const setRow = (rowId, valId, val) => {
    const r = document.getElementById(rowId);
    if (val) { r.style.display='flex'; document.getElementById(valId).textContent = val; }
    else r.style.display = 'none';
  };
  setRow('tClientRow',  'tClient',  sale.clientName);
  setRow('tContactRow', 'tContact', sale.clientContact);
  document.getElementById('tSubtotal').textContent = fmt(sale.subtotal ?? sale.total);
  document.getElementById('tTotal').textContent    = fmt(sale.total);
  document.getElementById('tItems').innerHTML = (Array.isArray(sale.items) ? sale.items : []).map(i =>
    `<div style="display:flex;justify-content:space-between"><span>${i.name||'?'} x${Number(i.qty)||1}</span><span>${((Number(i.price)||0)*(Number(i.qty)||1)).toLocaleString()} Ar</span></div>`).join('');
  if (sale.remise > 0) {
    document.getElementById('tRemiseRow').style.display = 'flex';
    document.getElementById('tRemise').textContent = '-' + fmt(sale.remise);
  } else document.getElementById('tRemiseRow').style.display = 'none';
  if (sale.accompte > 0) {
    document.getElementById('tAccompteRow').style.display = 'flex';
    document.getElementById('tAccompte').textContent = fmt(sale.accompte);
    document.getElementById('tDueRow').style.display = 'flex';
    document.getElementById('tDue').textContent = fmt(sale.due ?? 0);
  } else {
    document.getElementById('tAccompteRow').style.display = 'none';
    document.getElementById('tDueRow').style.display = 'none';
  }
  if (sale.method === 'cash') {
    document.getElementById('tPayMethod').textContent    = '💵 Espèces remis';
    document.getElementById('tGiven').textContent        = fmt(sale.given);
    document.getElementById('tChangeRow').style.display = 'flex';
    document.getElementById('tChange').textContent       = fmt(sale.change);
  } else {
    document.getElementById('tPayMethod').textContent    = `📱 ${sale.provider}`;
    document.getElementById('tGiven').textContent        = sale.ref || '';
    document.getElementById('tChangeRow').style.display = 'none';
  }
  document.getElementById('tFooter').textContent = tc.footer || 'Merci de votre visite !';

  const html = `
    ${_ticketShopHeader(tc, st)}
    <hr style="${st.sepSolid}"/>
    ${tc.ticketShowNum !== false ? `<div class="row"><span>Ticket N°</span><span>${sale.id}</span></div>` : ''}
    <div class="row"><span>Date</span><span>${dateStr}</span></div>
    ${tc.ticketShowCaissier !== false ? `<div class="row"><span>Caissier</span><span>${sale.caissier||''}</span></div>` : ''}
    ${sale.clientName    ? `<div class="row"><span>Client</span><span>${sale.clientName}</span></div>` : ''}
    ${sale.clientContact ? `<div class="row"><span>Contact</span><span>${sale.clientContact}</span></div>` : ''}
    <hr style="${st.sepLight}"/>
    <div class="items-section">
      ${(Array.isArray(sale.items)?sale.items:[]).map(i=>`<div class="row"><span>${i.name||'?'} <em style="color:#777">×${Number(i.qty)||1}</em></span><span>${((Number(i.price)||0)*(Number(i.qty)||1)).toLocaleString()} Ar</span></div>`).join('')}
    </div>
    <hr style="${st.sepLight}"/>
    ${tc.ticketShowSubtotal !== false ? `<div class="row"><span>Sous-total</span><span>${fmt(sale.subtotal??sale.total)}</span></div>` : ''}
    ${sale.remise>0 ? `<div class="row"><span>Remise</span><span style="color:#c00">-${fmt(sale.remise)}</span></div>` : ''}
    <div style="background:${st.color}18;border:1px solid ${st.color};border-radius:4px;padding:4px 6px;margin:4px 0">
      <div class="row bold" style="color:${st.color}"><span>NET À PAYER</span><span>${fmt(sale.total)}</span></div>
    </div>
    ${sale.accompte>0 ? `<div class="row"><span>Acompte versé</span><span>${fmt(sale.accompte)}</span></div>
    <div class="row bold" style="color:#c00"><span>RESTE DÛ</span><span>${fmt(sale.due??0)}</span></div>` : ''}
    <hr style="${st.sepLight}"/>
    ${tc.ticketShowPayDetail !== false
      ? (sale.method==='cash'
        ? `<div class="row"><span>Espèces reçus</span><span>${fmt(sale.given)}</span></div>
           <div class="row"><span>Monnaie rendue</span><span>${fmt(sale.change)}</span></div>`
        : `<div class="row"><span>Paiement mobile (${sale.provider})</span><span>${sale.ref||''}</span></div>`)
      : ''}
    <hr style="${st.sepSolid}"/>
    <div class="footer">${tc.footer||'Merci de votre visite !'}</div>`;

  _openTicketWindow(html, 'Ticket #' + sale.id);
}

function printReservationTicket(res) {
  if (!res) return;
  const tc  = shopConfig;
  const st  = _ticketStyles(tc);
  const dateStr = new Date(res.date).toLocaleString('fr-MG');

  const html = `
    ${_ticketShopHeader(tc, st)}
    <div style="background:#e8f7ee;border:2px solid #007a45;border-radius:4px;padding:5px;text-align:center;font-size:13pt;font-weight:bold;color:#007a45;margin:6px 0;font-family:${st.font}">📋 BON DE RÉSERVATION</div>
    <hr style="${st.sepSolid}"/>
    <div class="row"><span>Réservation N°</span><span><b>#${res.id}</b></span></div>
    <div class="row"><span>Date</span><span>${dateStr}</span></div>
    ${tc.ticketShowCaissier !== false ? `<div class="row"><span>Caissier</span><span>${res.caissier||''}</span></div>` : ''}
    ${res.clientName    ? `<div class="row"><span>Client</span><span>${res.clientName}</span></div>` : ''}
    ${res.clientContact ? `<div class="row"><span>Contact</span><span>${res.clientContact}</span></div>` : ''}
    <hr style="${st.sepLight}"/>
    <div class="items-section">
      ${(Array.isArray(res.items)?res.items:[]).map(i=>`<div class="row"><span>${i.name||'?'} <em style="color:#777">×${Number(i.qty)||1}</em></span><span>${((Number(i.price)||0)*(Number(i.qty)||1)).toLocaleString()} Ar</span></div>`).join('')}
    </div>
    <hr style="${st.sepLight}"/>
    ${tc.ticketShowSubtotal !== false ? `<div class="row"><span>Sous-total</span><span>${fmt(res.subtotal)}</span></div>` : ''}
    ${res.remise>0 ? `<div class="row"><span>Remise</span><span style="color:#c00">-${fmt(res.remise)}</span></div>` : ''}
    <div style="background:${st.color}18;border:1px solid ${st.color};border-radius:4px;padding:4px 6px;margin:4px 0">
      <div class="row bold" style="color:${st.color}"><span>TOTAL À PAYER</span><span>${fmt(res.total)}</span></div>
    </div>
    <div style="background:#e8f7ee;border:1px solid #007a45;border-radius:4px;padding:5px 8px;margin:4px 0">
      <div class="row bold" style="color:#007a45"><span>ACOMPTE VERSÉ</span><span>${fmt(res.accompte)}</span></div>
      <div class="row bold" style="color:#c00"><span>RESTE DÛ</span><span>${fmt(res.restant)}</span></div>
    </div>
    <hr style="${st.sepLight}"/>
    ${tc.ticketShowPayDetail !== false
      ? (res.depositMethod === 'cash'
        ? `<div class="row"><span>Espèces reçus</span><span>${fmt(res.depositGiven)}</span></div>
           <div class="row"><span>Monnaie rendue</span><span>${fmt(res.depositChange)}</span></div>`
        : `<div class="row"><span>Paiement mobile (${res.depositProvider})</span><span>${res.depositRef||''}</span></div>`)
      : ''}
    <hr style="${st.sepSolid}"/>
    <div class="footer">À récupérer sur présentation de ce bon</div>
    <div class="footer">${tc.footer||'Merci de votre confiance !'}</div>`;

  _openTicketWindow(html, 'Réservation #' + res.id);
}

// ============================================================
// SCANNER — html5-qrcode (caméra réelle)
// ============================================================
let html5QrCode = null;
let scannerRunning = false;
let scannerMode = 'caisse'; // 'caisse' | 'stock'

function openScanner(mode='caisse') {
  scannerMode = mode;
  document.getElementById('scannerLabel').textContent =
    mode === 'stock' ? '📦 Scanner pour ajouter ou créer un article' : '🛒 Scanner un article (caisse)';
  document.getElementById('scannerResult').style.display = 'none';
  document.getElementById('scanActionBtn').style.display = 'none';
  document.getElementById('manualCode').value = '';
  document.getElementById('scannerOverlay').classList.add('open');
  startCamera();
}

async function startCamera() {
  if (scannerRunning) return;
  try {
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode('qr-reader', {
        formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128]
      });
    }
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) {
      showToast('❌ Aucune caméra détectée', 'error');
      return;
    }
    // Préférer la caméra arrière
    const cam = cameras.find(c => /back|rear|environment/i.test(c.label)) || cameras[cameras.length - 1];
    await html5QrCode.start(
      cam.id,
      { fps: 10, qrbox: { width: 250, height: 180 }, aspectRatio: 1.0 },
      (decodedText) => { onScanSuccess(decodedText); },
      () => {} // ignore errors silencieux
    );
    scannerRunning = true;
  } catch (err) {
    console.warn('Caméra error:', err);
    showToast('⚠️ Impossible d\'accéder à la caméra — utilisez la saisie manuelle', 'info');
  }
}

async function stopCamera() {
  if (html5QrCode && scannerRunning) {
    try { await html5QrCode.stop(); } catch(e) {}
    scannerRunning = false;
  }
}

function onScanSuccess(code) {
  if (navigator.vibrate) navigator.vibrate(100);
  const resultBox = document.getElementById('scannerResult');
  const actionBtn = document.getElementById('scanActionBtn');
  resultBox.style.display = 'block';
  resultBox.style.color = 'var(--accent)';
  actionBtn.style.display = 'none';

  const p = products.find(pr => pr.code === code || String(pr.id) === code);

  if (scannerMode === 'caisse') {
    if (p) {
      resultBox.textContent = '✅ ' + p.name;
      addToCart(p.id);
      showToast('✅ ' + p.name + ' ajouté au panier');
      closeScanner();
    } else {
      resultBox.textContent = '❌ Article introuvable : ' + code;
      resultBox.style.color = 'var(--red)';
      actionBtn.textContent = '➕ Créer cet article';
      actionBtn.style.display = 'block';
      actionBtn.style.background = 'var(--accent)';
      actionBtn.onclick = () => { closeScanner(); openProductModal(null, code); };
    }
  } else { // mode stock
    if (p) {
      resultBox.textContent = '📦 ' + p.name + ' — Stock : ' + p.stock;
      actionBtn.textContent = '📥 Ajuster le stock';
      actionBtn.style.display = 'block';
      actionBtn.style.background = 'var(--accent3)';
      actionBtn.onclick = () => { closeScanner(); openMouvement(p.id); };
    } else {
      resultBox.textContent = '🆕 Code inconnu : ' + code;
      resultBox.style.color = 'var(--yellow)';
      actionBtn.textContent = '➕ Créer cet article avec ce code';
      actionBtn.style.display = 'block';
      actionBtn.style.background = 'var(--accent)';
      actionBtn.onclick = () => { closeScanner(); openProductModal(null, code); };
    }
  }
}

async function closeScanner() {
  await stopCamera();
  document.getElementById('scannerOverlay').classList.remove('open');
  document.getElementById('manualCode').value = '';
  document.getElementById('scannerResult').style.display = 'none';
}

function scanManual() {
  const code = document.getElementById('manualCode').value.trim();
  if (!code) return;
  document.getElementById('manualCode').value = '';
  onScanSuccess(code);
}

// ============================================================
// STOCK
// ============================================================
function renderStockTable() {
  const q = (document.getElementById('stockFilter').value||'').toLowerCase();
  const tbody = document.getElementById('stockTbody');
  const cardsEl = document.getElementById('stockCards');
  const filtered = products.filter(p=>p.name.toLowerCase().includes(q)||p.code.includes(q)||(p.cat||'').toLowerCase().includes(q));
  const rows = filtered.map(p=>{
    let badge, status, stockColor;
    if(p.stock===0) { badge='badge-out'; status='Rupture'; stockColor='var(--red)'; }
    else if(p.stock<=p.minStock) { badge='badge-low'; status='Faible'; stockColor='var(--yellow)'; }
    else { badge='badge-ok'; status='OK'; stockColor='var(--green)'; }
    return { p, badge, status, stockColor };
  });
  tbody.innerHTML = rows.map(({p,badge,status})=>`<tr>
    <td><span style="margin-right:6px">${p.emoji||'📦'}</span>${p.name}</td>
    <td>${p.cat}</td>
    <td class="td-mono">${p.code}</td>
    <td class="td-mono">${fmt(p.price)}</td>
    <td class="td-mono">${fmt(p.cost)}</td>
    <td class="td-mono" style="font-weight:600">${p.stock}</td>
    <td><span class="badge ${badge}">${status}</span></td>
    <td>
      <button class="btn-icon btn-edit" onclick="editProduct(${p.id})" title="Modifier">✏️</button>
      <button class="btn-icon btn-delete" onclick="deleteProduct(${p.id})" title="Supprimer">🗑</button>
    </td>
  </tr>`).join('');
  if (cardsEl) cardsEl.innerHTML = rows.map(({p,badge,status,stockColor})=>`
    <div class="stock-card">
      <div class="stock-card-top">
        <div>
          <div class="stock-card-name">${p.emoji||'📦'} ${p.name}</div>
          <div class="stock-card-cat">${p.cat} · ${p.code}</div>
        </div>
        <span class="badge ${badge}">${status}</span>
      </div>
      <div class="stock-card-row">
        <div class="stock-card-field"><span class="stock-card-field-label">Prix vente</span><span class="stock-card-field-val">${fmt(p.price)}</span></div>
        <div class="stock-card-field"><span class="stock-card-field-label">Prix achat</span><span class="stock-card-field-val">${fmt(p.cost)}</span></div>
        <div class="stock-card-field"><span class="stock-card-field-label">Stock</span><span class="stock-card-field-val" style="color:${stockColor}">${p.stock}</span></div>
        <div class="stock-card-field"><span class="stock-card-field-label">Min</span><span class="stock-card-field-val">${p.minStock}</span></div>
      </div>
      <div class="stock-card-actions">
        <button style="background:rgba(7,61,55,0.10);color:var(--accent)" onclick="editProduct(${p.id})">✏️ Modifier</button>
        <button style="background:rgba(255,71,87,0.12);color:var(--red)" onclick="deleteProduct(${p.id})">🗑 Supprimer</button>
      </div>
    </div>`).join('');
}
function openProductModal(id=null, prefillCode=null) {
  editingProductId = id;
  document.getElementById('productModalTitle').textContent = id ? '✏️ Modifier l\'article' : '➕ Nouvel article';
  syncCategorySelect();
  if(id) {
    const p = products.find(pr=>pr.id===id);
    document.getElementById('pName').value=p.name;
    document.getElementById('pCat').value=p.cat;
    document.getElementById('pEmoji').value=p.emoji||'';
    document.getElementById('pCode').value=p.code;
    document.getElementById('pPrice').value=p.price;
    document.getElementById('pCost').value=p.cost;
    document.getElementById('pStock').value=p.stock;
    document.getElementById('pMinStock').value=p.minStock||5;
    editingProductImage = p.image || null;
    if(editingProductImage) {
      const prev = document.getElementById('pImagePreview');
      prev.src = editingProductImage; prev.style.display='block';
      document.getElementById('pImageClear').style.display='block';
    } else { _resetImagePreview(); }
  } else {
    ['pName','pEmoji','pPrice','pCost','pStock'].forEach(f=>document.getElementById(f).value='');
    document.getElementById('pCode').value = prefillCode || '';
    document.getElementById('pMinStock').value=5;
    editingProductImage = null;
    _resetImagePreview();
    // Focus sur le nom si le code est déjà rempli
    setTimeout(()=>document.getElementById(prefillCode ? 'pName' : 'pCode').focus(), 100);
  }
  openModal('productModal');
}
function _resetImagePreview() {
  document.getElementById('pImage').value='';
  const prev = document.getElementById('pImagePreview');
  prev.src=''; prev.style.display='none';
  document.getElementById('pImageClear').style.display='none';
}
function previewProductImage(input) {
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    editingProductImage = e.target.result;
    const prev = document.getElementById('pImagePreview');
    prev.src = editingProductImage; prev.style.display='block';
    document.getElementById('pImageClear').style.display='block';
  };
  reader.readAsDataURL(file);
}
function clearProductImage() {
  editingProductImage = null;
  _resetImagePreview();
}
function editProduct(id) { openProductModal(id); }
function deleteProduct(id) {
  if(!confirm('Supprimer cet article ?')) return;
  products = products.filter(p=>p.id!==id);
  saveData();
  renderStockTable(); renderProducts();
  deleteProductFromScript(id);
  showToast('Article supprimé');
}
function saveProduct() {
  const name=document.getElementById('pName').value.trim();
  if(!name) { showToast('Nom requis','error'); return; }
  const data = {
    name, cat:document.getElementById('pCat').value,
    emoji:document.getElementById('pEmoji').value||'📦',
    code:document.getElementById('pCode').value.trim()||String(nextId),
    price:parseFloat(document.getElementById('pPrice').value)||0,
    cost:parseFloat(document.getElementById('pCost').value)||0,
    stock:parseInt(document.getElementById('pStock').value)||0,
    minStock:parseInt(document.getElementById('pMinStock').value)||5,
    image:editingProductImage||null
  };
  if(editingProductId) {
    Object.assign(products.find(p=>p.id===editingProductId), data);
    showToast('Article mis à jour ✅');
  } else {
    products.push({ id:nextId++, ...data });
    showToast('Article ajouté ✅');
  }
  closeModal('productModal');
  saveData();
  renderStockTable(); renderProducts();
  // Sync vers Sheet
  const syncProd = editingProductId ? products.find(p=>p.id===editingProductId) : products[products.length-1];
  if (syncProd) saveProductToScript(syncProd);
}

// ============================================================
// AJOUT RAPIDE AU PANIER (création article + stock + panier)
// ============================================================
function openQuickAddModal() {
  const sel = document.getElementById('qaCat');
  sel.innerHTML = categories.map(c => `<option>${c}</option>`).join('');
  ['qaName','qaEmoji','qaPrice'].forEach(f => document.getElementById(f).value = '');
  document.getElementById('qaQty').value = 1;
  document.getElementById('qaStock').value = 1;
  openModal('quickAddModal');
  setTimeout(() => document.getElementById('qaName').focus(), 100);
}
function saveQuickAdd() {
  const name = document.getElementById('qaName').value.trim();
  if (!name) { showToast('Nom requis', 'error'); return; }
  const price = parseFloat(document.getElementById('qaPrice').value) || 0;
  if (!price) { showToast('Prix de vente requis', 'error'); return; }
  const qty = Math.max(parseInt(document.getElementById('qaQty').value) || 1, 1);
  const stock = Math.max(parseInt(document.getElementById('qaStock').value) || qty, qty);
  const emoji = document.getElementById('qaEmoji').value || '📦';
  const cat = document.getElementById('qaCat').value;

  const newProduct = { id: nextId++, name, cat, emoji, code: String(nextId - 1), price, cost: 0, stock, minStock: 5 };
  products.push(newProduct);
  saveData();
  renderStockTable();
  renderProducts();
  saveProductToScript(newProduct);

  cart.push({ id: newProduct.id, name: newProduct.name, price: newProduct.price, qty, emoji: newProduct.emoji });
  renderCart();
  closeModal('quickAddModal');
  showToast(`${emoji} ${name} ajouté au panier ✅`);
}

// ============================================================
// MOUVEMENT
// ============================================================
function openMouvement(productId=null) {
  const sel = document.getElementById('mouvProduct');
  sel.innerHTML = products.map(p=>`<option value="${p.id}">${p.name} (stock: ${p.stock})</option>`).join('');
  if (productId) sel.value = productId;
  document.getElementById('mouvQty').value='';
  document.getElementById('mouvReason').value='';
  document.getElementById('mouvType').value='in';
  openModal('mouvModal');
}
function saveMouvement() {
  const id=parseInt(document.getElementById('mouvProduct').value);
  const qty=parseInt(document.getElementById('mouvQty').value)||0;
  const type=document.getElementById('mouvType').value;
  if(qty<=0) { showToast('Quantité invalide','error'); return; }
  const p=products.find(pr=>pr.id===id);
  if(!p) return;
  if(type==='in') p.stock+=qty;
  else { if(p.stock<qty){showToast('Stock insuffisant','error');return;} p.stock-=qty; }
  showToast(`${type==='in'?'📥 Entrée':'📤 Sortie'} : ${qty} x ${p.name}`);
  closeModal('mouvModal');
  saveData();
  renderStockTable(); renderProducts();
  syncStockMove(p.name, type, qty, document.getElementById('mouvReason').value || 'Manuel');
}

// Gère les dates malformées venant de Sheets : "2026-04-23TSat Dec 30 1899 08:52:31..."
function parseSaleDate(str) {
  if (!str) return null;
  const d = new Date(str);
  if (!isNaN(d)) return d;
  // Extraire YYYY-MM-DD + HH:MM:SS s'ils existent
  const dateM = str.match(/(\d{4}-\d{2}-\d{2})/);
  const timeM = str.match(/(\d{2}:\d{2}:\d{2})/);
  if (!dateM) return null;
  return new Date(dateM[1] + (timeM ? 'T' + timeM[1] : 'T00:00:00'));
}

// Retourne la portion YYYY-MM-DD pour les comparaisons startsWith
function saleDateKey(str) {
  if (!str) return '';
  const m = String(str).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

// ============================================================
// DÉTAIL DES CARTES STATISTIQUES
// ============================================================
let _openStatType = null;

function openStatDetail(type) {
  const panel = document.getElementById('statDetailPanel');
  if (!panel) return;
  // Même carte = fermer
  if (_openStatType === type && panel.style.display !== 'none') {
    closeStatDetail();
    return;
  }
  _openStatType = type;
  ['Day','Month','Stock','Due'].forEach(t => {
    const c = document.getElementById('statCard' + t);
    if (c) c.classList.toggle('active', t.toLowerCase() === type);
  });
  const titles = {
    day:   '💰 Ventes du jour — ' + new Date().toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', year:'numeric'}),
    month: '📅 Ventes du mois — ' + new Date().toLocaleDateString('fr-FR', {month:'long', year:'numeric'}),
    stock: '📦 Détail du stock',
    due:   '⏳ Créances — reste à percevoir'
  };
  document.getElementById('statDetailTitle').textContent = titles[type];
  document.getElementById('statDetailBody').innerHTML = _buildStatDetail(type);
  panel.style.display = 'block';
  // Relancer l'animation
  panel.style.animation = 'none';
  void panel.offsetHeight;
  panel.style.animation = '';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeStatDetail() {
  const panel = document.getElementById('statDetailPanel');
  if (panel) panel.style.display = 'none';
  ['Day','Month','Stock','Due'].forEach(t => {
    const c = document.getElementById('statCard' + t);
    if (c) c.classList.remove('active');
  });
  _openStatType = null;
}

function _buildStatDetail(type) {
  if (type === 'day')   return _detailDay();
  if (type === 'month') return _detailMonth();
  if (type === 'stock') return _detailStock();
  if (type === 'due')   return _detailDue();
  return '';
}

/* ── KPI badge helper ── */
function _kpi(label, value, color, bg) {
  return `<div class="detail-kpi" style="background:${bg};border-color:${color}">
    <div style="font-size:11px;color:var(--muted);margin-bottom:2px">${label}</div>
    <div style="font-family:'DM Mono',monospace;font-weight:800;font-size:18px;color:${color}">${value}</div>
  </div>`;
}

/* ── Ligne de vente réutilisable ── */
function _saleRow(s) {
  const d = parseSaleDate(s.date);
  const dateStr = d ? d.toLocaleString('fr-FR') : '—';
  const items   = (s.items || []).map(i => `${i.name||'?'} ×${i.qty||1}`).join(', ');
  const total   = Number(s.total)   || 0;
  const due     = Number(s.due)     || 0;
  const client  = s.clientName
    ? `<div style="font-size:11px;color:var(--muted)">👤 ${s.clientName}${s.clientContact ? ' · ' + s.clientContact : ''}</div>`
    : '';
  return `<tr>
    <td><div>${dateStr}</div>${client}</td>
    <td style="font-size:12px;max-width:200px">${items}</td>
    <td style="white-space:nowrap">${s.method==='cash'?'💵 Espèces':'📱 '+(s.provider||'Mobile')}</td>
    <td class="td-mono" style="text-align:right;font-weight:700;color:var(--accent)">${fmt(total)}</td>
    <td class="td-mono" style="text-align:right;font-weight:${due>0?700:400};color:${due>0?'var(--red)':'var(--muted)'}">${due>0?fmt(due):'—'}</td>
  </tr>`;
}

function _salesTableWrap(salesArr) {
  if (salesArr.length === 0)
    return '<div style="text-align:center;color:var(--muted);padding:24px">Aucune vente sur cette période.</div>';
  return `<div class="detail-table-wrap">
    <table>
      <thead><tr>
        <th>Date / Client</th><th>Articles</th><th>Paiement</th>
        <th style="text-align:right">Total</th><th style="text-align:right">Reste dû</th>
      </tr></thead>
      <tbody>${salesArr.map(_saleRow).join('')}</tbody>
    </table></div>`;
}

/* ── Ventes du jour ── */
function _detailDay() {
  const today = new Date().toDateString();
  const list  = sales.filter(s => { const d = parseSaleDate(s.date); return d && d.toDateString() === today; });
  const ca    = list.reduce((s,v) => s + (Number(v.total)||0), 0);
  const due   = list.reduce((s,v) => s + (Number(v.due)||0),   0);
  const cash  = list.filter(s => s.method==='cash').reduce((s,v) => s + (Number(v.total)||0), 0);
  const mob   = list.filter(s => s.method!=='cash').reduce((s,v) => s + (Number(v.total)||0), 0);
  return `<div class="detail-kpi-row">
    ${_kpi('CA du jour',     fmt(ca),          'var(--accent)', 'rgba(7,61,55,0.07)')}
    ${_kpi('Transactions',   list.length,       'var(--blue)',   'rgba(237,111,44,0.07)')}
    ${_kpi('💵 Espèces',     fmt(cash),         'var(--text)',   'var(--surface2)')}
    ${_kpi('📱 Mobile',      fmt(mob),          'var(--text)',   'var(--surface2)')}
    ${due > 0 ? _kpi('Reste à percevoir', fmt(due), 'var(--red)', 'rgba(255,71,87,.07)') : ''}
  </div>${_salesTableWrap(list)}`;
}

/* ── Ventes du mois ── */
function _detailMonth() {
  const key  = new Date().toISOString().slice(0, 7);
  const list = sales.filter(s => saleDateKey(s.date).startsWith(key));
  const ca   = list.reduce((s,v) => s + (Number(v.total)||0), 0);
  const due  = list.reduce((s,v) => s + (Number(v.due)||0),   0);
  const cash = list.filter(s => s.method==='cash').reduce((s,v) => s + (Number(v.total)||0), 0);
  const mob  = list.filter(s => s.method!=='cash').reduce((s,v) => s + (Number(v.total)||0), 0);
  return `<div class="detail-kpi-row">
    ${_kpi('CA du mois',     fmt(ca),           'var(--accent)', 'rgba(7,61,55,0.07)')}
    ${_kpi('Transactions',   list.length,        'var(--blue)',   'rgba(237,111,44,0.07)')}
    ${_kpi('💵 Espèces',     fmt(cash),          'var(--text)',   'var(--surface2)')}
    ${_kpi('📱 Mobile',      fmt(mob),           'var(--text)',   'var(--surface2)')}
    ${due > 0 ? _kpi('Reste à percevoir', fmt(due), 'var(--red)', 'rgba(255,71,87,.07)') : ''}
  </div>${_salesTableWrap(list)}`;
}

/* ── Articles en stock ── */
function _detailStock() {
  if (products.length === 0)
    return '<div style="text-align:center;color:var(--muted);padding:24px">Aucun article enregistré.</div>';
  const low   = products.filter(p => p.stock > 0 && p.stock <= p.minStock).length;
  const out   = products.filter(p => p.stock <= 0).length;
  const valV  = products.reduce((s,p) => s + p.stock * (p.price||0), 0);
  const valA  = products.reduce((s,p) => s + p.stock * (p.cost||0),  0);
  const sorted = [...products].sort((a,b) => {
    const sa = a.stock<=0?0:a.stock<=a.minStock?1:2;
    const sb = b.stock<=0?0:b.stock<=b.minStock?1:2;
    return sa - sb;
  });
  const rows = sorted.map(p => {
    const badge = p.stock <= 0
      ? `<span class="badge badge-out">⛔ Épuisé</span>`
      : p.stock <= p.minStock
        ? `<span class="badge badge-low">⚠️ Faible</span>`
        : `<span class="badge badge-ok">✅ OK</span>`;
    const stockColor = p.stock<=0?'var(--red)':p.stock<=p.minStock?'var(--yellow)':'var(--green)';
    return `<tr>
      <td><div style="font-weight:600">${p.emoji||'📦'} ${p.name}</div><div style="font-size:11px;color:var(--muted)">${p.cat||''} · ${p.code||''}</div></td>
      <td class="td-mono" style="text-align:right">${fmt(p.price||0)}</td>
      <td class="td-mono" style="text-align:right;color:var(--muted)">${fmt(p.cost||0)}</td>
      <td style="text-align:right">
        <span style="font-family:'DM Mono',monospace;font-weight:700;color:${stockColor}">${p.stock}</span>
        <span style="font-size:11px;color:var(--muted)"> / min ${p.minStock}</span>
      </td>
      <td>${badge}</td>
    </tr>`;
  }).join('');
  return `<div class="detail-kpi-row">
    ${_kpi('Total articles',  products.length,  'var(--accent)', 'rgba(7,61,55,0.07)')}
    ${low>0 ? _kpi('Stock faible', low,         'var(--yellow)', 'rgba(255,184,48,.07)') : ''}
    ${out>0 ? _kpi('Épuisés',      out,         'var(--red)',    'rgba(255,71,87,.07)')  : ''}
    ${_kpi('Valeur (vente)',  fmt(valV),         'var(--blue)',   'rgba(237,111,44,0.07)')}
    ${_kpi('Valeur (achat)',  fmt(valA),         'var(--muted)',  'var(--surface2)')}
  </div>
  <div class="detail-table-wrap">
    <table>
      <thead><tr>
        <th>Article</th>
        <th style="text-align:right">Prix vente</th>
        <th style="text-align:right">Prix achat</th>
        <th style="text-align:right">Stock</th>
        <th>Statut</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/* ── Créances (reste à payer) ── */
function _detailDue() {
  const list  = sales.filter(s => (Number(s.due)||0) > 0);
  if (list.length === 0)
    return '<div style="text-align:center;color:var(--green);padding:24px;font-weight:600">✅ Aucune créance en cours.</div>';
  const total = list.reduce((s,v) => s + (Number(v.due)||0), 0);
  const rows  = list.map(s => {
    const d      = parseSaleDate(s.date);
    const dateStr = d ? d.toLocaleString('fr-FR') : '—';
    const items  = (s.items||[]).map(i => `${i.name||'?'} ×${i.qty||1}`).join(', ');
    const client = s.clientName
      ? `<div style="font-size:11px;color:var(--muted)">👤 ${s.clientName}${s.clientContact?' · '+s.clientContact:''}</div>` : '';
    return `<tr>
      <td><div>${dateStr}</div>${client}</td>
      <td style="font-size:12px;max-width:180px">${items}</td>
      <td class="td-mono" style="text-align:right">${fmt(Number(s.total)||0)}</td>
      <td class="td-mono" style="text-align:right;color:var(--muted)">${fmt(Number(s.accompte)||0)}</td>
      <td class="td-mono" style="text-align:right;font-weight:800;color:var(--red)">${fmt(Number(s.due)||0)}</td>
    </tr>`;
  }).join('');
  return `<div class="detail-kpi-row">
    ${_kpi('Total à percevoir', fmt(total), 'var(--red)',    'rgba(255,71,87,.07)')}
    ${_kpi('Créances',          list.length, 'var(--yellow)', 'rgba(255,184,48,.07)')}
  </div>
  <div class="detail-table-wrap">
    <table>
      <thead><tr>
        <th>Date / Client</th><th>Articles</th>
        <th style="text-align:right">Total</th>
        <th style="text-align:right">Acompte</th>
        <th style="text-align:right">Reste dû</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ============================================================
// AUTO-REFRESH STATS (avec cooldown 45 s pour ne pas spammer Sheets)
// ============================================================
let _lastStatsRefresh = 0;

async function _autoRefreshStats() {
  if (!APPS_SCRIPT_URL) { renderStats(); return; }
  const now = Date.now();
  if (now - _lastStatsRefresh < 45000) return;   // cooldown 45 s
  _lastStatsRefresh = now;

  const btn = document.getElementById('statsRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Actualisation...'; }

  try {
    await loadSalesFromScript();
  } catch(e) {
    console.warn('loadSalesFromScript error:', e);
    showToast('⚠️ Erreur de chargement — données locales affichées', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Actualiser depuis Sheets'; }
    renderStats();   // toujours afficher, même en cas d'erreur réseau
  }
}

// Bouton manuel — ignore le cooldown
async function manualRefreshStats() {
  if (!APPS_SCRIPT_URL) {
    showToast('⚠️ URL Apps Script non configurée', 'error');
    return;
  }
  _lastStatsRefresh = 0;
  await _autoRefreshStats();
  if (sales.length > 0) showToast(`✅ ${sales.length} vente(s) chargée(s)`);
}

// ============================================================
// STATS
// ============================================================
function renderStats() {
  try { _renderStatsInner(); } catch(e) { console.error('renderStats crash:', e); renderBestSales(_bsPeriod); }
}
function _renderStatsInner() {
  const today = new Date().toDateString();
  const thisMonth = new Date().toISOString().slice(0,7);
  const todaySales = sales.filter(s => { const d = parseSaleDate(s.date); return d && d.toDateString()===today; });
  const monthSales = sales.filter(s => saleDateKey(s.date).startsWith(thisMonth));
  const todayTotal = todaySales.reduce((s,i)=>s+(Number(i.total)||0),0);
  const monthTotal = monthSales.reduce((s,i)=>s+(Number(i.total)||0),0);

  // Créances : ventes avec un reste dû > 0
  const duesSales = sales.filter(s => (Number(s.due) || 0) > 0);
  const totalDue  = duesSales.reduce((s,i) => s + (Number(i.due) || 0), 0);

  document.getElementById('statToday').textContent = fmt(todayTotal);
  document.getElementById('statTodayCount').textContent = todaySales.length+' transactions';
  document.getElementById('statMonth').textContent = fmt(monthTotal);
  document.getElementById('statMonthCount').textContent = monthSales.length+' transactions';
  document.getElementById('statItems').textContent = products.length;
  document.getElementById('statLow').textContent = products.filter(p=>p.stock<=p.minStock).length+' en alerte';
  document.getElementById('statDue').textContent = fmt(totalDue);
  document.getElementById('statDueCount').textContent = duesSales.length+' créance'+(duesSales.length>1?'s':'');

  // Bloc réservations en attente dans les stats
  const pendingRes = reservations.filter(r => r.status === 'pending');
  const resBlock   = document.getElementById('statsReservationsBlock');
  const resList    = document.getElementById('statsResList');
  if (resBlock && resList) {
    resBlock.style.display = pendingRes.length > 0 ? 'block' : 'none';
    resList.innerHTML = pendingRes.map(r => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--surface);border-radius:10px;margin-bottom:6px;font-size:13px">
        <div>
          <span style="font-weight:700">👤 ${r.clientName}</span>
          <span style="color:var(--muted);margin-left:8px">${(r.items||[]).map(i=>(i.name||'?')+' ×'+(i.qty||1)).join(', ')}</span>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;color:var(--accent)">${fmt(r.total)}</div>
          <div style="font-size:11px;color:var(--green)">Acompte: ${fmt(r.accompte)}</div>
        </div>
      </div>`).join('');
  }

  // Bar chart - last 7 days
  const chart = document.getElementById('barChart');
  const days = [];
  for(let i=6;i>=0;i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    const ds = d.toDateString();
    const total = sales.filter(s=>{ const d=parseSaleDate(s.date); return d && d.toDateString()===ds; }).reduce((a,b)=>a+(Number(b.total)||0),0);
    days.push({ label:d.toLocaleDateString('fr-MG',{weekday:'short'}), total });
  }
  const max = Math.max(...days.map(d=>d.total),1);
  chart.innerHTML = days.map(d=>`
    <div class="bar-item">
      <div class="bar" style="height:${Math.round(d.total/max*100)}%;background:${d.total===0?'var(--surface3)':'var(--accent)'}"></div>
      <span class="bar-label">${d.label}</span>
    </div>`).join('');

  // Monthly chart — last 6 months
  const monthChart = document.getElementById('monthChart');
  const monthTable = document.getElementById('monthTable');
  if (monthChart && monthTable) {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7);
      const label = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
      const mSales = sales.filter(s => saleDateKey(s.date).startsWith(key));
      const total = mSales.reduce((s, v) => s + (Number(v.total) || 0), 0);
      const count = mSales.length;
      months.push({ key, label, total, count });
    }
    const maxM = Math.max(...months.map(m => m.total), 1);
    monthChart.innerHTML = months.map(m => `
      <div class="bar-item">
        <div class="bar" style="height:${Math.round(m.total/maxM*100)}%;background:${m.total===0?'var(--surface3)':'var(--blue)'}"></div>
        <span class="bar-label">${m.label}</span>
      </div>`).join('');
    monthTable.innerHTML = months.filter(m => m.total > 0).map(m => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface2);border-radius:10px;font-size:13px">
        <span style="color:var(--muted);min-width:70px">${m.label}</span>
        <span style="color:var(--muted)">${m.count} vente${m.count>1?'s':''}</span>
        <span style="font-family:'DM Mono',monospace;font-weight:700;color:var(--blue)">${fmt(m.total)}</span>
      </div>`).join('') || '<div style="color:var(--muted);font-size:13px;text-align:center;padding:12px">Aucune vente sur cette période</div>';
  }

  // History — remplir le tableau EN PREMIER avant tout autre appel
  const tbody = document.getElementById('historyTbody');
  if (tbody) {
    if (sales.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:28px">
        <div style="margin-bottom:10px">Aucune vente enregistrée</div>
        <button onclick="manualRefreshStats()" style="padding:8px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;color:var(--muted);cursor:pointer;font-size:13px">🔄 Recharger depuis Sheets</button>
      </td></tr>`;
    } else {
      const isAdmin = currentUser && currentUser.role === 'admin';
      tbody.innerHTML = sales.slice(0, 50).map(s => {
        const due   = Number(s.due)   || 0;
        const total = Number(s.total) || 0;
        const items = Array.isArray(s.items) ? s.items : [];
        const d = parseSaleDate(s.date);
        const dateStr = d ? d.toLocaleString('fr-FR') : '—';
        const dueCell = due > 0
          ? `<td class="td-mono" style="font-weight:700;color:var(--red)">${fmt(due)}</td>`
          : `<td class="td-mono" style="color:var(--muted)">—</td>`;
        const adminActions = isAdmin
          ? `<button class="btn-icon" onclick="openEditSaleModal(${s.id})" title="Modifier" style="margin-left:4px">✏️</button>
             <button class="btn-icon" onclick="openDeleteSaleModal(${s.id})" title="Supprimer" style="margin-left:2px;color:var(--red)">🗑️</button>`
          : '';
        return `<tr>
          <td>${dateStr}</td>
          <td>${items.map(i=>`${i.name||'?'} x${i.qty||1}`).join(', ')}</td>
          <td>${s.method==='cash'?'💵 Espèces':`📱 ${s.provider||'Mobile'}`}</td>
          <td class="td-mono" style="font-weight:600;color:var(--accent)">${fmt(total)}</td>
          ${dueCell}
          <td><button class="btn-icon" onclick="reprintTicket(${s.id})" title="Réimprimer">🖨️</button></td>
          <td style="white-space:nowrap">${adminActions}</td>
        </tr>`;
      }).join('');
    }
  }

  // Meilleures ventes et panneau détail — après le tableau
  renderBestSales(_bsPeriod);
  if (_openStatType) {
    try {
      const body = document.getElementById('statDetailBody');
      if (body) body.innerHTML = _buildStatDetail(_openStatType);
    } catch(e) { console.warn('statDetail error:', e); }
  }
} // end _renderStatsInner
function reprintTicket(id) {
  const s = sales.find(s=>s.id===id);
  if(s) printTicket(s);
}

// ============================================================
// RAPPORT DE VENTES — IMPRESSION (jour / mois)
// ============================================================

function _openReportWindow(htmlBody, title) {
  setTimeout(() => {
    const w = window.open('', '_blank', 'width=940,height=720');
    w.document.write(`<html><head><title>${title}</title><style>
      @page{size:A4;margin:1.5cm 2cm}
      *{box-sizing:border-box}
      body{font-family:Arial,sans-serif;font-size:10pt;margin:0;padding:0;color:#000}
      table{width:100%;border-collapse:collapse;margin-bottom:16px}
      th{background:#f0f0f0;font-weight:700;padding:6px 8px;text-align:left;border:1px solid #ddd;font-size:9pt}
      td{padding:5px 8px;border:1px solid #eee;font-size:9pt;vertical-align:top}
      tr:nth-child(even) td{background:#fafafa}
      .mono{font-family:'Courier New',monospace;font-weight:700}
      .right{text-align:right}
      .center{text-align:center}
      .section-title{font-size:12pt;font-weight:800;margin:18px 0 8px;padding-bottom:4px;border-bottom:2px solid #000}
      .kpi-row{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
      .kpi{flex:1;min-width:120px;border:1px solid #ddd;border-radius:6px;padding:8px 12px}
      .kpi-label{font-size:8pt;color:#666;margin-bottom:3px}
      .kpi-val{font-size:14pt;font-weight:800}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body onload="window.print()">${htmlBody}</body></html>`);
    w.document.close();
  }, 200);
}

function _buildReportHtml(period, customRange) {
  const tc  = shopConfig;
  const now = new Date();
  let periodLabel, reportTitle, list;

  if (customRange) {
    const { from, to } = customRange;
    const fromDate = new Date(from + 'T00:00:00');
    const toDate   = new Date(to   + 'T23:59:59');
    const fmtDate  = d => d.toLocaleDateString('fr-FR', {day:'numeric', month:'long', year:'numeric'});
    periodLabel  = `Du ${fmtDate(fromDate)} au ${fmtDate(toDate)}`;
    reportTitle  = 'RAPPORT DE VENTES — PÉRIODE PERSONNALISÉE';
    list = sales.filter(s => {
      const d = parseSaleDate(s.date);
      return d && d >= fromDate && d <= toDate;
    });
  } else {
    const isDay = period === 'day';
    periodLabel = isDay
      ? now.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', year:'numeric'})
      : now.toLocaleDateString('fr-FR', {month:'long', year:'numeric'});
    reportTitle = isDay ? 'RAPPORT DE VENTES DU JOUR' : 'RAPPORT DE VENTES DU MOIS';
    list = _filterSalesByPeriod(period);
  }
  const ca   = list.reduce((s,v) => s + (Number(v.total)||0), 0);
  const due  = list.reduce((s,v) => s + (Number(v.due)||0),   0);
  const cash = list.filter(s => s.method==='cash').reduce((s,v) => s + (Number(v.total)||0), 0);
  const mob  = list.filter(s => s.method!=='cash').reduce((s,v) => s + (Number(v.total)||0), 0);

  const articles   = _aggregateArticles(list);
  const grandTotal = articles.reduce((s,a) => s + (Number(a.total)||0), 0);
  const grandQty   = articles.reduce((s,a) => s + (Number(a.qty)||0),   0);

  const pendingRes = reservations.filter(r => r.status === 'pending');

  // --- EN-TÊTE ---
  let html = `<div style="text-align:center;margin-bottom:12px">
    ${tc.ticketLogo ? `<img src="${tc.ticketLogo}" style="height:60px;max-width:100%;object-fit:contain;margin-bottom:6px"><br>` : ''}
    <div style="font-size:18pt;font-weight:800">${tc.name || 'Ma Boutique'}</div>
    ${tc.address ? `<div style="font-size:9pt;color:#555">${tc.address}</div>` : ''}
    ${tc.phone   ? `<div style="font-size:9pt;color:#555">Tél : ${tc.phone}</div>` : ''}
    <div style="font-size:13pt;font-weight:800;margin-top:8px;text-transform:uppercase;border:2px solid #000;padding:5px 18px;display:inline-block;border-radius:4px">${reportTitle}</div>
    <div style="font-size:10pt;color:#333;margin-top:4px">${periodLabel}</div>
    <div style="font-size:8pt;color:#888">Édité le ${now.toLocaleString('fr-FR')}</div>
  </div>
  <hr style="border:none;border-top:2px solid #000;margin:10px 0"/>`;

  // --- RÉSUMÉ KPI ---
  html += `<div class="section-title">📊 Résumé</div>
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-label">Chiffre d'affaires</div><div class="kpi-val" style="color:#007a45">${fmt(ca)}</div></div>
    <div class="kpi"><div class="kpi-label">Transactions</div><div class="kpi-val" style="color:#1a6ec7">${list.length}</div></div>
    <div class="kpi"><div class="kpi-label">💵 Espèces</div><div class="kpi-val">${fmt(cash)}</div></div>
    <div class="kpi"><div class="kpi-label">📱 Mobile Money</div><div class="kpi-val">${fmt(mob)}</div></div>
    ${due > 0 ? `<div class="kpi"><div class="kpi-label">Reste à percevoir</div><div class="kpi-val" style="color:#c00">${fmt(due)}</div></div>` : ''}
  </div>`;

  // --- ARTICLES ---
  if (articles.length > 0) {
    html += `<div class="section-title">📦 Détail par article</div>
    <table>
      <thead><tr>
        <th class="center">#</th><th>Article</th>
        <th class="right">Qté</th><th class="right">Prix unit.</th>
        <th class="right">Total</th><th class="right">% CA</th>
      </tr></thead><tbody>`;
    articles.forEach((a, i) => {
      const pct = grandTotal > 0 ? ((a.total / grandTotal) * 100).toFixed(1) : '0.0';
      html += `<tr>
        <td class="center">${i+1}</td>
        <td><strong>${a.name}</strong></td>
        <td class="right mono">${a.qty}</td>
        <td class="right mono">${fmt(a.price)}</td>
        <td class="right mono">${fmt(a.total)}</td>
        <td class="right" style="color:#888">${pct}%</td>
      </tr>`;
    });
    html += `<tr style="background:#e8f4ec;font-weight:800">
      <td colspan="2"><strong>TOTAL</strong></td>
      <td class="right mono">${grandQty}</td><td></td>
      <td class="right mono" style="color:#007a45">${fmt(grandTotal)}</td>
      <td class="right">100%</td>
    </tr></tbody></table>`;
  }

  // --- DÉTAIL DES VENTES ---
  if (list.length > 0) {
    html += `<div class="section-title">🧾 Détail des ventes (${list.length})</div>
    <table>
      <thead><tr>
        <th>Date / Heure</th><th>Client</th><th>Articles</th>
        <th>Moyen de paiement</th>
        <th class="right">Total</th><th class="right">Acompte</th><th class="right">Reste dû</th>
      </tr></thead><tbody>`;
    list.forEach(s => {
      const d       = parseSaleDate(s.date);
      const dateStr = d ? d.toLocaleString('fr-FR') : '—';
      const items   = (Array.isArray(s.items)?s.items:[])
        .map(i => `${i.name||'?'} ×${Number(i.qty)||1} <em style="color:#666">(${fmt((Number(i.price)||0)*(Number(i.qty)||1))})</em>`)
        .join('<br>');
      const payDetail = s.method === 'cash'
        ? `💵 Espèces${s.given>0 ? `<br><small>Reçu: ${fmt(s.given)} · Rendu: ${fmt(s.change)}</small>` : ''}`
        : `📱 ${s.provider||'Mobile'}${s.ref ? `<br><small>Réf: ${s.ref}</small>` : ''}`;
      const dueVal = Number(s.due)||0;
      const accVal = Number(s.accompte)||0;
      html += `<tr>
        <td style="white-space:nowrap;font-size:8.5pt">${dateStr}</td>
        <td>${s.clientName
          ? `<strong>${s.clientName}</strong>${s.clientContact?`<br><small>${s.clientContact}</small>`:''}`
          : '—'}</td>
        <td style="font-size:8pt">${items}</td>
        <td style="white-space:nowrap;font-size:8.5pt">${payDetail}</td>
        <td class="right mono" style="color:#007a45;font-weight:700">${fmt(Number(s.total)||0)}</td>
        <td class="right mono">${accVal>0 ? fmt(accVal) : '—'}</td>
        <td class="right mono" style="${dueVal>0?'color:#c00;font-weight:700':'color:#888'}">${dueVal>0?fmt(dueVal):'—'}</td>
      </tr>`;
    });
    const totalAcc = list.reduce((s,v)=>s+(Number(v.accompte)||0),0);
    html += `<tr style="background:#e8f4ec;font-weight:800">
      <td colspan="4"><strong>TOTAL</strong></td>
      <td class="right mono" style="color:#007a45">${fmt(ca)}</td>
      <td class="right mono">${totalAcc>0?fmt(totalAcc):'—'}</td>
      <td class="right mono" style="${due>0?'color:#c00':''}">${due>0?fmt(due):'—'}</td>
    </tr></tbody></table>`;
  } else {
    html += `<div class="section-title">🧾 Détail des ventes</div><p style="color:#888;text-align:center">Aucune vente sur cette période.</p>`;
  }

  // --- RÉSERVATIONS EN ATTENTE ---
  if (pendingRes.length > 0) {
    html += `<div class="section-title">📋 Réservations en attente (${pendingRes.length})</div>
    <table>
      <thead><tr>
        <th>N°</th><th>Date</th><th>Client</th><th>Articles</th>
        <th>Acompte versé</th>
        <th class="right">Total</th><th class="right">Acompte</th><th class="right">Restant dû</th>
      </tr></thead><tbody>`;
    pendingRes.forEach(r => {
      const d       = parseSaleDate(r.date);
      const dateStr = d ? d.toLocaleDateString('fr-FR') : '—';
      const items   = (Array.isArray(r.items)?r.items:[]).map(i=>`${i.name||'?'} ×${Number(i.qty)||1}`).join('<br>');
      const payAcc  = r.depositMethod==='cash'
        ? '💵 Espèces'
        : `📱 ${r.depositProvider||'Mobile'}${r.depositRef?`<br><small>Réf: ${r.depositRef}</small>`:''}`;
      html += `<tr>
        <td class="center">#${r.id}</td>
        <td style="white-space:nowrap">${dateStr}</td>
        <td>${r.clientName||'—'}${r.clientContact?`<br><small>${r.clientContact}</small>`:''}</td>
        <td style="font-size:8pt">${items}</td>
        <td style="font-size:8.5pt">${payAcc}</td>
        <td class="right mono;font-weight:700">${fmt(Number(r.total)||0)}</td>
        <td class="right mono" style="color:#007a45">${fmt(Number(r.accompte)||0)}</td>
        <td class="right mono" style="color:#c00;font-weight:700">${fmt(Number(r.restant)||0)}</td>
      </tr>`;
    });
    const resTotal   = pendingRes.reduce((s,r)=>s+(Number(r.total)||0),0);
    const resAcc     = pendingRes.reduce((s,r)=>s+(Number(r.accompte)||0),0);
    const resRestant = pendingRes.reduce((s,r)=>s+(Number(r.restant)||0),0);
    html += `<tr style="background:#f7eeee;font-weight:800">
      <td colspan="5"><strong>TOTAL</strong></td>
      <td class="right mono">${fmt(resTotal)}</td>
      <td class="right mono" style="color:#007a45">${fmt(resAcc)}</td>
      <td class="right mono" style="color:#c00">${fmt(resRestant)}</td>
    </tr></tbody></table>`;
  }

  // --- PIED DE PAGE ---
  html += `<hr style="border:none;border-top:1px solid #ccc;margin:20px 0 8px"/>
  <div style="text-align:center;font-size:8.5pt;color:#666">${tc.footer||'Merci de votre visite !'}</div>`;

  return html;
}

function printReportDay() {
  _openReportWindow(
    _buildReportHtml('day'),
    'Rapport du jour — ' + new Date().toLocaleDateString('fr-FR')
  );
}

function printReportMonth() {
  _openReportWindow(
    _buildReportHtml('month'),
    'Rapport du mois — ' + new Date().toLocaleDateString('fr-FR', {month:'long', year:'numeric'})
  );
}

function printReportCustom() {
  const from = document.getElementById('reportDateFrom').value;
  const to   = document.getElementById('reportDateTo').value;
  if (!from || !to) { showToast('⚠️ Veuillez sélectionner une date de début et de fin.', 'error'); return; }
  if (from > to)    { showToast('⚠️ La date de début doit être avant la date de fin.', 'error'); return; }
  const label = new Date(from+'T00:00:00').toLocaleDateString('fr-FR') + ' → ' + new Date(to+'T00:00:00').toLocaleDateString('fr-FR');
  _openReportWindow(_buildReportHtml(null, {from, to}), 'Rapport — ' + label);
}

// ============================================================
// MEILLEURES VENTES PAR ARTICLE (local uniquement)
// ============================================================
let _bsPeriod = 'day';

function switchBestSalesPeriod(period) {
  _bsPeriod = period;
  ['day','month','year'].forEach(p => {
    const btn = document.getElementById('bsTab' + p.charAt(0).toUpperCase() + p.slice(1));
    if (btn) btn.classList.toggle('active', p === period);
  });
  renderBestSales(period);
}

function _filterSalesByPeriod(period) {
  const today      = new Date().toDateString();
  const thisMonth  = new Date().toISOString().slice(0, 7);
  const thisYear   = new Date().getFullYear().toString();
  return sales.filter(s => {
    const d = parseSaleDate(s.date);
    if (!d) return false;
    if (period === 'day')   return d.toDateString() === today;
    if (period === 'month') return saleDateKey(s.date).startsWith(thisMonth);
    return saleDateKey(s.date).startsWith(thisYear);
  });
}

function _aggregateArticles(filtered) {
  const map = {};
  filtered.forEach(sale => {
    (Array.isArray(sale.items) ? sale.items : []).forEach(item => {
      if (!item) return;
      const name = String(item.name ?? '?').trim() || '?';
      if (!map[name]) map[name] = { name, qty: 0, price: 0, total: 0, txCount: 0 };
      const q = Number(item.qty)   || 1;
      const p = Number(item.price) || 0;
      map[name].qty     += q;
      map[name].total   += q * p;
      map[name].price    = p;     // prix le plus récent
      map[name].txCount += 1;
    });
  });
  return Object.values(map).sort((a, b) => b.total - a.total);
}

function renderBestSales(period) {
  const container = document.getElementById('bestSalesContent');
  if (!container) return;

  try {
  const filtered  = _filterSalesByPeriod(period);
  const articles  = _aggregateArticles(filtered);

  const periodLabel = { day: "aujourd'hui", month: 'ce mois', year: 'cette année' }[period] || period;

  if (articles.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:13px;padding:24px 0">Aucune vente ${periodLabel}.</div>`;
    return;
  }

  const maxTotal   = Math.max(articles[0].total || 0, 1);
  const grandTotal = articles.reduce((s, a) => s + (Number(a.total) || 0), 0);
  const grandQty   = articles.reduce((s, a) => s + (Number(a.qty)   || 0), 0);

  const rankClass = i => i === 0 ? 'bs-rank-1' : i === 1 ? 'bs-rank-2' : i === 2 ? 'bs-rank-3' : 'bs-rank-n';
  const rankEmoji = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);

  const rows = articles.map((a, i) => {
    const qty   = Number(a.qty)   || 0;
    const price = Number(a.price) || 0;
    const total = Number(a.total) || 0;
    const pct   = Math.round(total / maxTotal * 100);
    const share = grandTotal > 0 ? Math.round(total / grandTotal * 100) : 0;
    return `<tr>
      <td><span class="bs-rank ${rankClass(i)}">${rankEmoji(i)}</span></td>
      <td>
        <div style="font-weight:600;color:var(--text)">${a.name || '?'}</div>
        <div class="bs-bar-bg"><div class="bs-bar-fill" style="width:${pct}%"></div></div>
      </td>
      <td style="text-align:right;font-family:'DM Mono',monospace;white-space:nowrap">
        <div style="font-weight:700">${qty}</div>
        <div style="font-size:11px;color:var(--muted)">unité${qty>1?'s':''}</div>
      </td>
      <td style="text-align:right;font-family:'DM Mono',monospace;white-space:nowrap">
        <div>${fmt(price)}</div>
        <div style="font-size:11px;color:var(--muted)">/ unité</div>
      </td>
      <td style="text-align:right;font-family:'DM Mono',monospace;white-space:nowrap">
        <div style="font-weight:700;color:var(--accent)">${fmt(total)}</div>
        <div style="font-size:11px;color:var(--muted)">${share}% du CA</div>
      </td>
    </tr>`;
  }).join('');

  const totalRow = `<tr style="background:var(--surface2)">
    <td colspan="2" style="font-weight:700;font-size:13px;padding:10px 12px">
      Total — ${articles.length} article${articles.length>1?'s':''} · ${filtered.length} vente${filtered.length>1?'s':''}
    </td>
    <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:700;padding:10px 12px">${grandQty}</td>
    <td></td>
    <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:800;color:var(--accent);padding:10px 12px">${fmt(grandTotal)}</td>
  </tr>`;

  container.innerHTML = `
    <div class="bs-table-wrap">
      <table>
        <thead><tr>
          <th style="width:36px">#</th>
          <th>Article</th>
          <th style="text-align:right">Qté</th>
          <th style="text-align:right">Prix unit.</th>
          <th style="text-align:right">Montant</th>
        </tr></thead>
        <tbody>${rows}${totalRow}</tbody>
      </table>
    </div>`;
  } catch(e) {
    container.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:16px;text-align:center">⚠️ Erreur: ${e.message}</div>`;
    console.error('renderBestSales:', e);
  }
}

// ============================================================
// MODIFIER / SUPPRIMER UNE VENTE — local uniquement (Sheets inchangé)
// ============================================================
let _editingSaleId = null;
let _deletingSaleId = null;

function openEditSaleModal(id) {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('⛔ Réservé aux administrateurs');
    return;
  }
  const s = sales.find(s => s.id === id);
  if (!s) return;
  _editingSaleId = id;

  document.getElementById('editSaleIdLabel').textContent = '#' + id;
  document.getElementById('editClientName').value    = s.clientName    || '';
  document.getElementById('editClientContact').value = s.clientContact || '';
  document.getElementById('editRemise').value         = s.remise    || 0;
  document.getElementById('editAccompte').value       = s.accompte  || 0;
  document.getElementById('editMethod').value         = s.method    || 'cash';

  // Items — chaque article affiche qty + prix éditables
  document.getElementById('editSaleItems').innerHTML =
    (s.items || []).map((item, idx) => `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.name || '?'}</span>
        <input type="number" min="1" value="${Number(item.qty)||1}"
          style="width:60px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);text-align:center"
          oninput="updateEditItem(${idx},'qty',this.value)" title="Quantité" />
        <input type="number" min="0" value="${Number(item.price)||0}"
          style="width:90px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);text-align:right"
          oninput="updateEditItem(${idx},'price',this.value)" title="Prix unitaire (Ar)" />
        <span style="color:var(--muted);font-size:11px">Ar</span>
      </div>`).join('');

  toggleEditPayFields();
  if (s.method === 'mobile') {
    document.getElementById('editProvider').value = s.provider || 'MVola';
    document.getElementById('editRef').value      = s.ref      || '';
  }

  recalcEditSale();
  openModal('editSaleModal');
}

function updateEditItem(idx, field, value) {
  const s = sales.find(s => s.id === _editingSaleId);
  if (!s || !Array.isArray(s.items) || !s.items[idx]) return;
  s.items[idx][field] = Math.max(field === 'qty' ? 1 : 0, Number(value) || 0);
  recalcEditSale();
}

function recalcEditSale() {
  const s = sales.find(s => s.id === _editingSaleId);
  if (!s) return;
  const subtotal = (s.items || []).reduce((t, i) => t + (Number(i.qty)||1) * (Number(i.price)||0), 0);
  const remise   = Math.max(0, Math.min(subtotal, Number(document.getElementById('editRemise').value)   || 0));
  const total    = Math.max(0, subtotal - remise);
  const accompte = Math.max(0, Math.min(total,    Number(document.getElementById('editAccompte').value) || 0));
  const due      = Math.max(0, total - accompte);

  document.getElementById('editPreviewSubtotal').textContent = fmt(subtotal);
  document.getElementById('editPreviewRemise').textContent   = fmt(remise);
  document.getElementById('editPreviewTotal').textContent    = fmt(total);
  document.getElementById('editPreviewDue').textContent      = fmt(due);
}

function toggleEditPayFields() {
  const isMobile = document.getElementById('editMethod').value === 'mobile';
  document.getElementById('editMobileFields').style.display = isMobile ? '' : 'none';
}

function saveEditSale() {
  const s = sales.find(s => s.id === _editingSaleId);
  if (!s) return;

  const subtotal = (s.items || []).reduce((t, i) => t + (Number(i.qty)||1) * (Number(i.price)||0), 0);
  const remise   = Math.max(0, Math.min(subtotal, Number(document.getElementById('editRemise').value)   || 0));
  const total    = Math.max(0, subtotal - remise);
  const accompte = Math.max(0, Math.min(total,    Number(document.getElementById('editAccompte').value) || 0));
  const due      = Math.max(0, total - accompte);
  const method   = document.getElementById('editMethod').value;

  s.clientName    = document.getElementById('editClientName').value.trim();
  s.clientContact = document.getElementById('editClientContact').value.trim();
  s.subtotal  = subtotal;
  s.remise    = remise;
  s.total     = total;
  s.accompte  = accompte;
  s.due       = due;
  s.method    = method;
  if (method === 'mobile') {
    s.provider = document.getElementById('editProvider').value;
    s.ref      = document.getElementById('editRef').value.trim();
  }

  saveData();
  closeModal('editSaleModal');
  renderStats();
  showToast('✅ Vente #' + _editingSaleId + ' modifiée localement');
  _editingSaleId = null;
}

function openDeleteSaleModal(id) {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('⛔ Réservé aux administrateurs');
    return;
  }
  _deletingSaleId = id;
  document.getElementById('deleteSaleIdLabel').textContent = '#' + id;
  openModal('deleteSaleModal');
}

function confirmDeleteSale() {
  if (!_deletingSaleId) return;
  sales = sales.filter(s => s.id !== _deletingSaleId);
  const deletedId = _deletingSaleId;
  _deletingSaleId = null;
  saveData();
  closeModal('deleteSaleModal');
  renderStats();
  showToast('🗑️ Vente #' + deletedId + ' supprimée localement');
}

// ============================================================
// PWA — Service Worker + Install + Offline
// ============================================================
let deferredPrompt = null;
let swRegistration = null;

function initPWA() {
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
      swRegistration = reg;
      // Vérifier une mise à jour immédiatement et toutes les 60s
      reg.update();
      setInterval(() => reg.update(), 60000);
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          // Nouveau SW prêt : l'activer immédiatement sans bannière
          if (newWorker.state === 'installed') {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(err => console.log('[PWA] SW error:', err));
  }

  // Install prompt
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    // Show banner after 3s if not dismissed
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (!dismissed) {
      setTimeout(() => document.getElementById('installBanner').classList.add('show'), 3000);
    }
  });

  window.addEventListener('appinstalled', () => {
    document.getElementById('installBanner').classList.remove('show');
    showToast('✅ Application installée avec succès !');
    deferredPrompt = null;
  });

  // Online/Offline
  window.addEventListener('offline', () => document.getElementById('offlineBadge').classList.add('show'));
  window.addEventListener('online', () => {
    document.getElementById('offlineBadge').classList.remove('show');
    showToast('🌐 Connexion rétablie — synchronisation...');
    syncPendingOfflineSales();
  });
  if (!navigator.onLine) document.getElementById('offlineBadge').classList.add('show');
}

function installPWA() {
  if (!deferredPrompt) {
    showToast('📱 Pour iOS: Safari → Partager → Sur l\'écran d\'accueil', 'info');
    return;
  }
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(choice => {
    if (choice.outcome === 'accepted') showToast('✅ Installation en cours...');
    deferredPrompt = null;
    document.getElementById('installBanner').classList.remove('show');
  });
}

function dismissInstall() {
  document.getElementById('installBanner').classList.remove('show');
  localStorage.setItem('pwa-install-dismissed', '1');
}

function applyUpdate() {
  if (swRegistration && swRegistration.waiting) {
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
  window.location.reload();
}

// ============================================================
// LOCALSTORAGE — Persistance des données
// ============================================================
function saveData() {
  try {
    localStorage.setItem('pos-products', JSON.stringify(products));
    localStorage.setItem('pos-sales', JSON.stringify(sales));
    localStorage.setItem('pos-nextId', String(nextId));
    localStorage.setItem('pos-nextSaleId', String(nextSaleId));
    localStorage.setItem('pos-reservations', JSON.stringify(reservations));
    localStorage.setItem('pos-nextResId', String(nextReservationId));
    // Photos séparées pour éviter de dépasser la limite localStorage
    const cmdWithoutPhotos = commandes.map(c => ({ ...c, photos: [] }));
    localStorage.setItem('pos-commandes', JSON.stringify(cmdWithoutPhotos));
    localStorage.setItem('pos-nextCmdId', String(nextCommandeId));
    // Photos stockées séparément par commande ID
    commandes.forEach(c => {
      if (c.photos && c.photos.length > 0) {
        try { localStorage.setItem(`pos-cmd-photos-${c.id}`, JSON.stringify(c.photos)); }
        catch(e) { /* photos trop lourdes, on ignore */ }
      }
    });
  } catch(e) { console.warn('localStorage full?', e); }
}

function loadData() {
  try {
    const p = localStorage.getItem('pos-products');
    const s = localStorage.getItem('pos-sales');
    const ni = localStorage.getItem('pos-nextId');
    const ns = localStorage.getItem('pos-nextSaleId');
    const r  = localStorage.getItem('pos-reservations');
    const nr = localStorage.getItem('pos-nextResId');
    if (p) products = JSON.parse(p);
    if (s) sales = JSON.parse(s);
    if (ni) nextId = parseInt(ni);
    if (ns) nextSaleId = parseInt(ns);
    if (r)  reservations = JSON.parse(r);
    if (nr) nextReservationId = parseInt(nr);
    const cmds  = localStorage.getItem('pos-commandes');
    const ncid  = localStorage.getItem('pos-nextCmdId');
    if (cmds) {
      commandes = JSON.parse(cmds);
      // Réattacher les photos
      commandes.forEach(c => {
        try {
          const photos = localStorage.getItem(`pos-cmd-photos-${c.id}`);
          if (photos) c.photos = JSON.parse(photos);
          else c.photos = c.photos || [];
        } catch(e) { c.photos = []; }
      });
    }
    if (ncid) nextCommandeId = parseInt(ncid);
  } catch(e) { console.warn('loadData error:', e); }
}

function saveUsers() {
  try { localStorage.setItem('pos-users', JSON.stringify(localUsers)); } catch(e) {}
}

function loadUsers() {
  try {
    const u = localStorage.getItem('pos-users');
    if (u) localUsers = JSON.parse(u);
  } catch(e) {}
}

// ============================================================
// PERMISSIONS PAR RÔLE
// ============================================================
function applyRolePermissions(role) {
  const isAdmin = role === 'admin';
  // Top nav & bottom nav: montrer/cacher les éléments admin-only
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
  // Bouton Google Sheets (admin only)
  const sheetsBtn = document.querySelector('[onclick="openScriptSettings()"]');
  if (sheetsBtn) sheetsBtn.style.display = isAdmin ? '' : 'none';
}

// ============================================================
// GESTION DES UTILISATEURS
// ============================================================
function renderUsersPage() {
  const grid = document.getElementById('usersGrid');
  const count = document.getElementById('usersCount');
  if (!grid) return;
  count.textContent = `${localUsers.length} compte(s)`;
  grid.innerHTML = localUsers.map((u, idx) => {
    const roleLabel = u.role === 'admin' ? 'Administrateur' : 'Caissier';
    const isMe = currentUser && u.username === currentUser.username;
    const isLastAdmin = u.role === 'admin' && localUsers.filter(x => x.role === 'admin' && x.actif !== false).length === 1;
    return `
    <div class="user-card">
      <div class="user-card-top">
        <div class="user-avatar role-${u.role}">${u.role === 'admin' ? '👑' : '🛒'}</div>
        <div class="user-card-info">
          <div class="user-card-name">${u.label}${isMe ? ' <span style="font-size:11px;color:var(--accent)">(vous)</span>' : ''}</div>
          <div class="user-card-username">@${u.username}</div>
        </div>
      </div>
      <div class="user-card-meta">
        <span class="badge badge-${u.role}">${roleLabel}</span>
        ${u.actif !== false
          ? '<span class="badge badge-ok">Actif</span>'
          : '<span class="badge badge-inactive">Inactif</span>'}
      </div>
      <div class="user-card-actions">
        <button class="btn-edit-user" onclick="openUserModal(${idx})">✏️ Modifier</button>
        ${!isMe && !isLastAdmin
          ? `<button class="btn-del-user" onclick="deleteUser(${idx})">🗑 Supprimer</button>`
          : `<button class="btn-toggle-user" onclick="toggleUserActive(${idx})" ${isMe?'disabled':''}>
               ${u.actif!==false?'⏸ Désactiver':'▶ Activer'}</button>`}
      </div>
    </div>`;
  }).join('');
}

function openUserModal(idx=null) {
  editingUserId = idx;
  const isNew = idx === null;
  document.getElementById('userModalTitle').textContent = isNew ? '➕ Nouvel utilisateur' : '✏️ Modifier l\'utilisateur';
  document.getElementById('uPassLabel').textContent = isNew ? 'Mot de passe' : 'Nouveau mot de passe (laisser vide = inchangé)';
  document.getElementById('uPass').placeholder = isNew ? '••••••' : '(inchangé)';
  document.getElementById('uPass').type = 'password';
  document.getElementById('passVisBtn').textContent = '👁';
  if (isNew) {
    document.getElementById('uUsername').value = '';
    document.getElementById('uUsername').disabled = false;
    document.getElementById('uLabel').value = '';
    document.getElementById('uPass').value = '';
    document.getElementById('uRole').value = 'caissier';
    document.getElementById('uActif').checked = true;
  } else {
    const u = localUsers[idx];
    document.getElementById('uUsername').value = u.username;
    document.getElementById('uUsername').disabled = true;
    document.getElementById('uLabel').value = u.label;
    document.getElementById('uPass').value = '';
    document.getElementById('uRole').value = u.role;
    document.getElementById('uActif').checked = u.actif !== false;
  }
  openModal('userModal');
}

function togglePassVis() {
  const inp = document.getElementById('uPass');
  const btn = document.getElementById('passVisBtn');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
}

async function saveUser() {
  const username = document.getElementById('uUsername').value.trim().toLowerCase();
  const label    = document.getElementById('uLabel').value.trim();
  const pass     = document.getElementById('uPass').value;
  const role     = document.getElementById('uRole').value;
  const actif    = document.getElementById('uActif').checked;
  const isNew    = editingUserId === null;

  if (!username) { showToast('Identifiant obligatoire', 'error'); return; }
  if (!label)    { showToast('Nom complet obligatoire', 'error'); return; }
  if (isNew && !pass) { showToast('Mot de passe obligatoire', 'error'); return; }

  // Vérifier unicité du username (seulement pour les nouveaux)
  if (isNew && localUsers.find(u => u.username.toLowerCase() === username)) {
    showToast('Cet identifiant existe déjà', 'error'); return;
  }

  // Empêcher de retirer le rôle admin au dernier admin
  if (!isNew) {
    const u = localUsers[editingUserId];
    const otherAdmins = localUsers.filter((x,i) => i !== editingUserId && x.role === 'admin' && x.actif !== false);
    if (u.role === 'admin' && role !== 'admin' && otherAdmins.length === 0) {
      showToast('Impossible : c\'est le dernier administrateur actif', 'error'); return;
    }
  }

  // Hasher le mot de passe pour le stockage local et l'envoi API
  const passHashed = pass ? await sha256(pass) : null;

  if (isNew) {
    localUsers.push({ username, pass: passHashed, role, label, actif });
    showToast(`✅ Utilisateur ${label} créé`);
  } else {
    const u = localUsers[editingUserId];
    u.label = label;
    u.role  = role;
    u.actif = actif;
    if (passHashed) u.pass = passHashed;
    showToast(`✅ ${label} mis à jour`);
  }

  saveUsers();
  closeModal('userModal');
  renderUsersPage();
  // Sync vers Google Sheet — envoyer le mot de passe en clair (server le hashera)
  const syncIdx = isNew ? localUsers.length - 1 : editingUserId;
  const syncUser = { ...localUsers[syncIdx], pass: pass || undefined };
  if (syncUser.username) saveUserToScript(syncUser);
}

function deleteUser(idx) {
  const u = localUsers[idx];
  if (!confirm(`Supprimer l'utilisateur "${u.label}" (@${u.username}) ?`)) return;
  const username = u.username;
  localUsers.splice(idx, 1);
  saveUsers();
  renderUsersPage();
  showToast(`Utilisateur supprimé`);
  deleteUserFromScript(username);
}

function toggleUserActive(idx) {
  const u = localUsers[idx];
  const otherAdmins = localUsers.filter((x,i) => i !== idx && x.role === 'admin' && x.actif !== false);
  if (u.role === 'admin' && u.actif !== false && otherAdmins.length === 0) {
    showToast('Impossible : c\'est le dernier administrateur actif', 'error'); return;
  }
  u.actif = u.actif === false ? true : false;
  saveUsers();
  renderUsersPage();
  showToast(u.actif ? `✅ ${u.label} activé` : `⏸ ${u.label} désactivé`);
  saveUserToScript(u);
}

// Ventes en attente (hors ligne)
function savePendingSale(sale) {
  const pending = JSON.parse(localStorage.getItem('pos-pending-sales') || '[]');
  pending.push(sale);
  localStorage.setItem('pos-pending-sales', JSON.stringify(pending));
}

async function syncPendingOfflineSales() {
  if (!APPS_SCRIPT_URL) return;
  const pending = JSON.parse(localStorage.getItem('pos-pending-sales') || '[]');
  if (pending.length === 0) return;
  showToast(`🔄 Synchronisation de ${pending.length} vente(s) en attente...`, 'info');
  const succeeded = [];
  const failed = [];
  for (const sale of pending) {
    sale.caissier = sale.caissier || (currentUser ? currentUser.username : 'caissier');
    const r = await apiCall({ action: 'addSale', sale });
    if (r && r.ok) {
      succeeded.push(sale);
    } else {
      failed.push(sale);
    }
  }
  if (failed.length > 0) {
    localStorage.setItem('pos-pending-sales', JSON.stringify(failed));
    showToast(`⚠️ ${succeeded.length} sync. — ${failed.length} encore en attente`, 'error');
  } else {
    localStorage.removeItem('pos-pending-sales');
    showToast(`✅ ${succeeded.length} vente(s) synchronisée(s) dans Google Sheets`);
  }
  updatePendingBadge();
}

function updatePendingBadge() {
  const pending = JSON.parse(localStorage.getItem('pos-pending-sales') || '[]');
  const badge = document.getElementById('pendingBadge');
  if (!badge) return;
  if (pending.length > 0) {
    document.getElementById('pendingCount').textContent = pending.length;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// ============================================================
// GOOGLE APPS SCRIPT — CONNEXION COMPLÈTE
// ============================================================
let APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxFsymwddqXY-_iUJwFsTTWowmsXgtheFDX8YGpDeU5sIk8sjJ_z5_DkDaOnK8rX5bmOg/exec';
localStorage.setItem('pos-script-url', APPS_SCRIPT_URL);
let syncEnabled = !!APPS_SCRIPT_URL;

// ── Requête générique ─────────────────────────────────────
// Lectures : GET ?action=xxx  (réponse JSON lisible)
// Écritures : GET ?payload=JSON  (Apps Script lit e.parameter.payload)
async function apiCall(payload) {
  if (!APPS_SCRIPT_URL) return null;

  // ── LECTURES & LOGIN : requête GET avec params individuels ─
  const getActions = ['getProducts', 'getSales', 'ping', 'initSheets', 'login', 'getUsers', 'getReservations', 'getCommandes'];
  if (getActions.includes(payload.action)) {
    try {
      let url = APPS_SCRIPT_URL + '?action=' + payload.action;
      if (payload.limit)    url += '&limit='    + encodeURIComponent(payload.limit);
      if (payload.username) url += '&username=' + encodeURIComponent(payload.username);
      if (payload.password) url += '&password=' + encodeURIComponent(payload.password);
      const res  = await fetch(url);
      const text = await res.text();
      try { return JSON.parse(text); }
      catch(e) { console.warn('GET réponse non-JSON:', text.substring(0,200)); return null; }
    } catch(e) { console.warn('GET error:', e.message); return null; }
  }

  // ── ÉCRITURES : GET ?payload=JSON ───────────────────────
  // Apps Script lit e.parameter.payload dans doGet → pas de CORS
  try {
    const encoded = encodeURIComponent(JSON.stringify(payload));
    const url = APPS_SCRIPT_URL + '?payload=' + encoded;
    const res  = await fetch(url);
    const text = await res.text();
    try { return JSON.parse(text); }
    catch(e) { return { ok: true }; }
  } catch(e) {
    console.warn('apiCall write error:', e.message);
    return null;
  }
}

// ── Login via Apps Script ─────────────────────────────────
async function loginViaScript(username, password) {
  if (!APPS_SCRIPT_URL) return null;
  showLoader('Connexion...');
  const r = await apiCall({ action: 'login', username, password });
  hideLoader();
  return r;
}

// ── Charger produits depuis Sheet ────────────────────────
async function loadProductsFromScript() {
  if (!APPS_SCRIPT_URL) return false;
  showLoader('Chargement des produits...');
  const r = await apiCall({ action: 'getProducts' });
  hideLoader();
  if (r && r.ok && r.products.length > 0) {
    products = r.products;
    nextId = Math.max(...products.map(p => p.id)) + 1;
    saveData();
    showToast('✅ ' + products.length + ' articles chargés depuis Google Sheets');
    return true;
  }
  return false;
}

// ── Sauvegarder un produit vers Sheet ───────────────────
async function saveProductToScript(product) {
  if (!APPS_SCRIPT_URL) return;
  const r = await apiCall({ action: 'saveProduct', product });
  if (r && r.ok && r.id && !product.id) {
    // Mettre à jour l'ID généré par le Sheet
    const p = products.find(pr => pr.name === product.name && !pr.syncedId);
    if (p) { p.id = r.id; p.syncedId = true; saveData(); }
  }
}

// ── Supprimer un produit du Sheet ────────────────────────
async function deleteProductFromScript(id) {
  if (!APPS_SCRIPT_URL) return;
  await apiCall({ action: 'deleteProduct', id });
}

// ── Envoyer une vente vers Sheet ─────────────────────────
async function syncToAppsScript(sale) {
  if (!APPS_SCRIPT_URL) return;
  if (!navigator.onLine) {
    savePendingSale(sale);
    updatePendingBadge();
    showToast('📡 Hors ligne — vente mise en file d\'attente', 'info');
    return;
  }
  sale.caissier = currentUser ? currentUser.username : 'caissier';
  const r = await apiCall({ action: 'addSale', sale });
  if (r && r.ok) {
    showToast('☁️ Vente enregistrée dans Google Sheets ✅');
  } else {
    const errMsg = r ? (r.error || 'Erreur inconnue') : 'Connexion impossible';
    console.error('Sync vente échouée:', errMsg);
    savePendingSale(sale);
    updatePendingBadge();
    showToast('⚠️ Google Sheets inaccessible — vente mise en file. ' + errMsg, 'error');
  }
}

// ── Envoyer une réservation vers Sheet ───────────────────
async function syncReservationToSheets(res) {
  if (!APPS_SCRIPT_URL) return;
  res.caissier = currentUser ? currentUser.username : 'caissier';
  const r = await apiCall({ action: 'addReservation', reservation: res });
  if (!r || !r.ok) {
    console.warn('Sync réservation échouée:', r?.error || 'Connexion impossible');
  }
}

// ── Mettre à jour le statut d'une réservation dans Sheet ─
async function syncReservationCompleteToSheets(res) {
  if (!APPS_SCRIPT_URL) return;
  await apiCall({ action: 'updateReservation', id: res.id, status: res.status, dateFinalisation: res.dateFinalisation || '', saleId: res.saleId || '' });
}

// ── Mouvement de stock vers Sheet ────────────────────────
async function syncStockMove(productName, type, qty, reason) {
  if (!APPS_SCRIPT_URL) return;
  await apiCall({
    action: 'stockMove',
    productName, type, qty, reason,
    caissier: currentUser ? currentUser.username : ''
  });
}

// ── Charger l'historique des ventes depuis Sheet (pagination offset) ─────
async function loadSalesFromScript(fullReload = false) {
  if (!APPS_SCRIPT_URL) return;
  showLoader('Chargement des ventes...');
  let allRemote = [];
  const PAGE = 500;
  let offset = 0;
  // Charger jusqu'à 2000 ventes par pages de 500
  while (offset < 2000) {
    const r = await apiCall({ action: 'getSales', limit: PAGE, offset });
    if (!r || !r.ok || !Array.isArray(r.sales)) break;
    allRemote = allRemote.concat(r.sales);
    if (r.sales.length < PAGE) break;  // dernière page
    offset += PAGE;
  }
  hideLoader();
  if (allRemote.length > 0) {
    const sheetIds = new Set(allRemote.map(s => String(s.id)));
    const localOnly = sales.filter(s => !sheetIds.has(String(s.id)));
    sales = [...allRemote, ...localOnly];
    sales.sort((a, b) => {
      const da = parseSaleDate(a.date), db = parseSaleDate(b.date);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return db - da;
    });
    saveData();
  }
}

// ── Charger les utilisateurs depuis Sheet ────────────────
async function loadUsersFromScript() {
  if (!APPS_SCRIPT_URL) return;
  const r = await apiCall({ action: 'getUsers' });
  if (r && r.ok && Array.isArray(r.users) && r.users.length > 0) {
    // Fusionner : le Sheet fait autorité, on garde les locaux absents du Sheet
    const sheetUsernames = new Set(r.users.map(u => u.username.toLowerCase()));
    const localOnly = localUsers.filter(u => !sheetUsernames.has(u.username.toLowerCase()));
    localUsers = [...r.users, ...localOnly];
    saveUsers();
  }
}

// ── Charger les réservations depuis Sheet ────────────────
async function loadReservationsFromScript() {
  if (!APPS_SCRIPT_URL) return;
  showLoader('Chargement des réservations...');
  const r = await apiCall({ action: 'getReservations' });
  hideLoader();
  if (!r || !r.ok || !Array.isArray(r.reservations) || r.reservations.length === 0) return;

  // Dédupliquer les articles par nom au sein de chaque réservation (doublon possible dans le Sheet)
  const deduped = r.reservations.map(res => {
    const seen = new Set();
    const items = (Array.isArray(res.items) ? res.items : []).filter(i => {
      const key = String(i.name ?? '').trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...res, items };
  });

  // Merger : Sheets fait autorité — conserver les réservations locales absentes du Sheet
  const sheetIds = new Set(deduped.map(res => String(res.id)));
  const localOnly = reservations.filter(res => !sheetIds.has(String(res.id)));
  reservations = [...deduped, ...localOnly];

  // Trier par date décroissante
  reservations.sort((a, b) => {
    const da = new Date(a.date), db = new Date(b.date);
    return db - da;
  });

  // Recalibrer nextReservationId pour éviter les collisions avec d'autres postes
  const maxId = reservations.reduce((m, res) => Math.max(m, Number(res.id) || 0), 0);
  if (maxId >= nextReservationId) nextReservationId = maxId + 1;

  saveData();
}

// ── Sauvegarder un utilisateur vers Sheet ────────────────
async function saveUserToScript(user) {
  if (!APPS_SCRIPT_URL) return;
  await apiCall({ action: 'saveUser', user });
}

// ── Supprimer un utilisateur du Sheet ────────────────────
async function deleteUserFromScript(username) {
  if (!APPS_SCRIPT_URL) return;
  await apiCall({ action: 'deleteUser', username });
}

// ── UI Loader ─────────────────────────────────────────────
function showLoader(msg) {
  let el = document.getElementById('syncLoader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'syncLoader';
    el.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);background:#073D37;border:1px solid rgba(255,255,255,0.20);color:#FFFFFF;padding:10px 20px;border-radius:20px;font-size:13px;z-index:1600;display:flex;gap:8px;align-items:center;';
    el.innerHTML = '<span style="animation:spin 1s linear infinite;display:inline-block">⚙️</span><span id="syncLoaderMsg"></span>';
    document.body.appendChild(el);
    const style = document.createElement('style');
    style.textContent = '@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }
  document.getElementById('syncLoaderMsg').textContent = msg;
  el.style.display = 'flex';
}
function hideLoader() {
  const el = document.getElementById('syncLoader');
  if (el) el.style.display = 'none';
}

// ── Paramètres Apps Script (modal) ──────────────────────
function openScriptSettings() {
  const choice = prompt(
    '⚙️ Google Sheets — Que voulez-vous faire ?\n\n' +
    '1 → Changer l\'URL du script\n' +
    '2 → Tester la connexion\n' +
    '3 → Initialiser les feuilles (1ère utilisation)\n' +
    '4 → Synchroniser les ventes en attente\n\n' +
    'Tapez le numéro :',
    '2'
  );
  if (!choice) return;
  if (choice.trim() === '1') {
    const url = prompt('🔗 Nouvelle URL Apps Script Web App :', APPS_SCRIPT_URL);
    if (url === null) return;
    APPS_SCRIPT_URL = url.trim();
    localStorage.setItem('pos-script-url', APPS_SCRIPT_URL);
    syncEnabled = !!APPS_SCRIPT_URL;
    if (APPS_SCRIPT_URL) { showToast('✅ URL enregistrée !'); testScriptConnection(); }
    else showToast('⚠️ Sync désactivée', 'info');
  } else if (choice.trim() === '2') {
    testScriptConnection();
  } else if (choice.trim() === '3') {
    initSheetsFromApp();
  } else if (choice.trim() === '4') {
    syncPendingOfflineSales();
  }
}

async function testScriptConnection() {
  showLoader('Diagnostic en cours...');
  const log = [];

  // 1. Ping (GET lisible)
  try {
    const res  = await fetch(APPS_SCRIPT_URL + '?action=ping');
    const data = JSON.parse(await res.text());
    log.push(data.ok ? '✅ Script accessible' : '❌ Script KO: ' + data.error);
  } catch(e) { log.push('❌ Script inaccessible: ' + e.message); }

  // 2. Lecture produits
  try {
    const res  = await fetch(APPS_SCRIPT_URL + '?action=getProducts');
    const data = JSON.parse(await res.text());
    if (data.ok)    log.push('✅ Produits: ' + data.products.length + ' articles lus');
    else            log.push('⚠️ Produits: ' + data.error + ' → lancez option 3');
  } catch(e) { log.push('❌ Lecture produits: ' + e.message); }

  // 3. Test écriture no-cors (ne peut pas lire la réponse → on vérifie via lecture)
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'ping' })
    });
    log.push('✅ Écriture POST envoyée (no-cors OK)');
  } catch(e) { log.push('❌ Écriture POST: ' + e.message); }

  hideLoader();
  alert('🔍 Diagnostic Google Sheets\n\n' + log.join('\n') +
    '\n\n━━━━━━━━━━━━━━━━━━━━━\n' +
    '→ Si "Script inaccessible" : vérifiez l\'URL\n' +
    '→ Si "Feuille introuvable" : faites option 3 (Initialiser)\n' +
    '→ Si tout est ✅ mais ventes absentes : vérifiez les logs Apps Script');
}

async function initSheetsFromApp() {
  showLoader('Initialisation des feuilles Google Sheets...');
  try {
    const res = await fetch(APPS_SCRIPT_URL + '?action=initSheets');
    const text = await res.text();
    const data = JSON.parse(text);
    hideLoader();
    if (data.ok) {
      showToast('✅ Feuilles initialisées ! Chargement des données...');
      await loadProductsFromScript();
      await loadSalesFromScript();
      renderProducts(); renderStockTable(); renderStats();
    } else {
      showToast('❌ Erreur init : ' + (data.error || ''), 'error');
    }
  } catch (e) {
    hideLoader();
    showToast('❌ Erreur : ' + e.message, 'error');
  }
}

// ============================================================
// CONFIGURATION — Boutique, Catégories, Articles
// ============================================================
let shopConfig = {
  name:'MA BOUTIQUE', address:'Antananarivo, Madagascar', phone:'', footer:'Merci de votre visite !',
  ticketLogo: null,
  ticketLogoPos: 'center',
  ticketLogoSize: 'medium',
  ticketColor: '#000000',
  ticketFont: 'Arial',
  ticketSep: 'dashed',
  ticketShowNum: true,
  ticketShowCaissier: true,
  ticketShowSubtotal: true,
  ticketShowPayDetail: true
};
let categories = ['Alimentation','Boissons','Hygiène','Électronique','Vêtements','Autres'];

function loadConfig() {
  try {
    const c = localStorage.getItem('pos-config');
    const k = localStorage.getItem('pos-categories');
    if (c) shopConfig = { ...shopConfig, ...JSON.parse(c) };
    if (k) categories = JSON.parse(k);
  } catch(e) {}
}

function saveConfig() {
  shopConfig.name    = document.getElementById('cfgShopName').value || 'MA BOUTIQUE';
  shopConfig.address = document.getElementById('cfgAddress').value  || 'Antananarivo, Madagascar';
  shopConfig.phone   = document.getElementById('cfgPhone').value    || '';
  shopConfig.footer  = document.getElementById('cfgFooter').value   || 'Merci de votre visite !';
  _persistConfig();
  showToast('✅ Boutique enregistrée', 'success');
}

function saveTicketConfig() {
  shopConfig.ticketLogoPos       = document.getElementById('cfgLogoPos')?.value        || 'center';
  shopConfig.ticketLogoSize      = document.getElementById('cfgLogoSize')?.value       || 'medium';
  shopConfig.ticketColor         = document.getElementById('cfgTicketColor')?.value    || '#000000';
  shopConfig.ticketFont          = document.getElementById('cfgTicketFont')?.value     || 'Arial';
  shopConfig.ticketSep           = document.getElementById('cfgSepStyle')?.value       || 'dashed';
  shopConfig.ticketShowNum       = document.getElementById('cfgShowTicketNum')?.checked  ?? true;
  shopConfig.ticketShowCaissier  = document.getElementById('cfgShowCaissier')?.checked   ?? true;
  shopConfig.ticketShowSubtotal  = document.getElementById('cfgShowSubtotal')?.checked   ?? true;
  shopConfig.ticketShowPayDetail = document.getElementById('cfgShowPayDetail')?.checked  ?? true;
  _persistConfig();
  renderTicketPreview();
}

function _persistConfig() {
  localStorage.setItem('pos-config', JSON.stringify(shopConfig));
}

function renderConfigPage() {
  // Boutique
  document.getElementById('cfgShopName').value = shopConfig.name;
  document.getElementById('cfgAddress').value  = shopConfig.address;
  document.getElementById('cfgPhone').value    = shopConfig.phone;
  document.getElementById('cfgFooter').value   = shopConfig.footer;
  // Ticket
  const lpos  = document.getElementById('cfgLogoPos');
  const lsize = document.getElementById('cfgLogoSize');
  const lcol  = document.getElementById('cfgTicketColor');
  const lfont = document.getElementById('cfgTicketFont');
  const lsep  = document.getElementById('cfgSepStyle');
  if (lpos)  lpos.value  = shopConfig.ticketLogoPos  || 'center';
  if (lsize) lsize.value = shopConfig.ticketLogoSize  || 'medium';
  if (lcol)  lcol.value  = shopConfig.ticketColor     || '#000000';
  if (lfont) lfont.value = shopConfig.ticketFont      || 'Arial';
  if (lsep)  lsep.value  = shopConfig.ticketSep       || 'dashed';
  const setChk = (id, val) => { const el = document.getElementById(id); if(el) el.checked = val !== false; };
  setChk('cfgShowTicketNum',  shopConfig.ticketShowNum);
  setChk('cfgShowCaissier',   shopConfig.ticketShowCaissier);
  setChk('cfgShowSubtotal',   shopConfig.ticketShowSubtotal);
  setChk('cfgShowPayDetail',  shopConfig.ticketShowPayDetail);
  // Logo
  _applyLogoPreview(shopConfig.ticketLogo);
  // Catégories + articles
  renderCategories();
  renderConfigArticles();
  syncCategorySelect();
  // Prévisualisation
  renderTicketPreview();
}

// ============================================================
// TICKET — PERSONNALISATION
// ============================================================
function handleLogoUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 512000) { showToast('Image trop grande (max 500 Ko)', 'error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    shopConfig.ticketLogo = e.target.result;
    _persistConfig();
    _applyLogoPreview(shopConfig.ticketLogo);
    renderTicketPreview();
  };
  reader.readAsDataURL(file);
}

function _applyLogoPreview(src) {
  const img  = document.getElementById('logoPreviewImg');
  const hint = document.getElementById('logoUploadHint');
  const row  = document.getElementById('logoClearRow');
  const opts = document.getElementById('logoOptionsRow');
  if (!img) return;
  if (src) {
    img.src = src;
    img.style.display = 'block';
    if (hint) hint.style.display = 'none';
    if (row)  row.style.display  = 'block';
    if (opts) opts.style.display = 'block';
  } else {
    img.src = '';
    img.style.display = 'none';
    if (hint) hint.style.display = 'block';
    if (row)  row.style.display  = 'none';
    if (opts) opts.style.display = 'none';
  }
}

function removeLogo() {
  shopConfig.ticketLogo = null;
  _persistConfig();
  _applyLogoPreview(null);
  const input = document.getElementById('logoFileInput');
  if (input) input.value = '';
  renderTicketPreview();
  showToast('Logo supprimé', 'info');
}

function _ticketSepCss(style) {
  const map = { dashed:'dashed', solid:'solid', dotted:'dotted', double:'double' };
  const s = map[style] || 'dashed';
  return s === 'double'
    ? 'border:none;border-top:3px double #999;margin:5px 0'
    : `border:none;border-top:1px ${s} #999;margin:5px 0`;
}

function _logoSizePx(size) {
  return { small: 40, medium: 70, large: 100 }[size] || 70;
}

function _ticketHeaderHtml(tc) {
  const logoH = _logoSizePx(tc.ticketLogoSize || 'medium');
  const logoAlign = { left:'left', right:'right', center:'center' }[tc.ticketLogoPos || 'center'];
  const logoHtml = tc.ticketLogo
    ? `<div style="text-align:${logoAlign};margin-bottom:4px"><img src="${tc.ticketLogo}" style="height:${logoH}px;max-width:100%;object-fit:contain;border-radius:3px" /></div>`
    : '';
  return `${logoHtml}
    <div style="font-size:14pt;font-weight:bold;text-align:center;margin-bottom:2px;font-family:${tc.ticketFont||'Arial'}">${tc.name}</div>
    ${tc.address ? `<div style="font-size:9pt;text-align:center;color:#555;margin-bottom:2px">${tc.address}</div>` : ''}
    ${tc.phone   ? `<div style="font-size:9pt;text-align:center;color:#555;margin-bottom:2px">Tél : ${tc.phone}</div>` : ''}`;
}

function renderTicketPreview() {
  const frame = document.getElementById('ticketPreviewFrame');
  if (!frame) return;
  const tc = shopConfig;
  const sep = _ticketSepCss(tc.ticketSep);
  const font = tc.ticketFont || 'Arial';
  const color = tc.ticketColor || '#000000';
  const logoH = _logoSizePx(tc.ticketLogoSize || 'medium');
  const logoAlign = { left:'left', right:'right', center:'center' }[tc.ticketLogoPos || 'center'];

  frame.style.fontFamily = font;
  frame.innerHTML = `
    ${tc.ticketLogo ? `<div style="text-align:${logoAlign};margin-bottom:6px"><img src="${tc.ticketLogo}" style="height:${logoH}px;max-width:100%;object-fit:contain;border-radius:3px" /></div>` : ''}
    <div class="p-shop-name" style="font-family:${font}">${tc.name || 'MA BOUTIQUE'}</div>
    ${tc.address ? `<div class="p-shop-info">${tc.address}</div>` : ''}
    ${tc.phone   ? `<div class="p-shop-info">Tél : ${tc.phone}</div>` : ''}
    <hr style="${sep}">
    ${tc.ticketShowNum !== false      ? `<div class="p-row"><span>Ticket N°</span><span>0001</span></div>` : ''}
    <div class="p-row"><span>Date</span><span>${new Date().toLocaleDateString('fr-FR')}</span></div>
    ${tc.ticketShowCaissier !== false  ? `<div class="p-row"><span>Caissier</span><span>Admin</span></div>` : ''}
    <hr style="${sep}">
    <div class="p-item"><span>Article exemple ×2</span><span>5 000 Ar</span></div>
    <div class="p-item"><span>Autre article ×1</span><span>2 500 Ar</span></div>
    <hr style="${sep}">
    ${tc.ticketShowSubtotal !== false  ? `<div class="p-row"><span>Sous-total</span><span>7 500 Ar</span></div>` : ''}
    <div style="background:${color}1a;border:1px solid ${color};border-radius:3px;padding:4px 6px;margin:4px 0">
      <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:11pt;color:${color}"><span>NET À PAYER</span><span>7 500 Ar</span></div>
    </div>
    <hr style="${sep}">
    ${tc.ticketShowPayDetail !== false ? `<div class="p-row"><span>Espèces reçus</span><span>10 000 Ar</span></div>
    <div class="p-row"><span>Monnaie</span><span>2 500 Ar</span></div>` : ''}
    <hr style="${sep}">
    <div class="p-footer">${tc.footer || 'Merci de votre visite !'}</div>
  `;
}

function renderCategories() {
  const el = document.getElementById('categoriesList');
  el.innerHTML = categories.map(c => `
    <span class="cat-tag">
      ${c}
      <button onclick="removeCategory('${c}')" title="Supprimer">✕</button>
    </span>`).join('');
}

function addCategory() {
  const input = document.getElementById('newCatInput');
  const val = input.value.trim();
  if (!val) return;
  if (categories.includes(val)) { showToast('Catégorie déjà existante','info'); return; }
  categories.push(val);
  localStorage.setItem('pos-categories', JSON.stringify(categories));
  input.value = '';
  renderCategories();
  syncCategorySelect();
  showToast('✅ Catégorie ajoutée');
}

function removeCategory(cat) {
  if (!confirm(`Supprimer la catégorie "${cat}" ?`)) return;
  categories = categories.filter(c => c !== cat);
  localStorage.setItem('pos-categories', JSON.stringify(categories));
  renderCategories();
  syncCategorySelect();
  showToast('Catégorie supprimée');
}

function syncCategorySelect() {
  const sel = document.getElementById('pCat');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = categories.map(c => `<option${c===current?' selected':''}>${c}</option>`).join('');
}

function renderConfigArticles() {
  const q = (document.getElementById('configSearch')?.value || '').toLowerCase();
  const grid = document.getElementById('configArticlesGrid');
  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(q) || (p.cat||'').toLowerCase().includes(q) || p.code.includes(q)
  );
  if (filtered.length === 0) {
    grid.innerHTML = '<div style="color:var(--muted);padding:20px;grid-column:1/-1;text-align:center">Aucun article trouvé</div>';
    return;
  }
  grid.innerHTML = filtered.map(p => `
    <div class="article-config-card">
      <div class="article-config-card-header">
        <span class="article-config-card-emoji">${p.emoji||'📦'}</span>
        <div class="article-config-card-info">
          <div class="article-config-card-name">${p.name}</div>
          <div class="article-config-card-cat">${p.cat} · Code: ${p.code}</div>
        </div>
      </div>
      <div class="article-config-fields">
        <div class="article-config-field">
          <label>Prix vente (Ar)</label>
          <input type="number" id="cfg_price_${p.id}" value="${p.price}" min="0" />
        </div>
        <div class="article-config-field">
          <label>Prix achat (Ar)</label>
          <input type="number" id="cfg_cost_${p.id}" value="${p.cost}" min="0" />
        </div>
        <div class="article-config-field">
          <label>Stock actuel</label>
          <input type="number" id="cfg_stock_${p.id}" value="${p.stock}" min="0" />
        </div>
        <div class="article-config-field">
          <label>Stock min (alerte)</label>
          <input type="number" id="cfg_min_${p.id}" value="${p.minStock||5}" min="0" />
        </div>
      </div>
      <div class="article-config-actions">
        <button class="btn-save-article" onclick="saveArticleConfig(${p.id})">💾 Enregistrer</button>
        <button class="btn-icon btn-edit" onclick="editProduct(${p.id})" title="Édition complète" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px">✏️</button>
        <button class="btn-del-article" onclick="deleteProduct(${p.id})">🗑</button>
      </div>
    </div>`).join('');
}

function saveArticleConfig(id) {
  const p = products.find(pr => pr.id === id);
  if (!p) return;
  p.price    = parseFloat(document.getElementById('cfg_price_' + id).value) || p.price;
  p.cost     = parseFloat(document.getElementById('cfg_cost_'  + id).value) || p.cost;
  p.stock    = parseInt(document.getElementById('cfg_stock_'   + id).value) || 0;
  p.minStock = parseInt(document.getElementById('cfg_min_'     + id).value) || 5;
  saveData();
  renderProducts();
  renderStockTable();
  saveProductToScript(p);
  showToast(`✅ ${p.name} mis à jour`);
}

// ============================================================
// COMMANDES — ÉTAT
// ============================================================
let commandes = [];
let nextCommandeId = 1;
let cmdModalItems = [];
let cmdModalPhotos = [];
let cmdPayMode = 'cash';
let cmdProvider = 'MVola';
let currentCmdFinalizeId = null;
let cmdFinalPayMode = 'cash';
let cmdFinalProvider = 'MVola';
let _lastCmdRefresh = 0;

// Ferme le dropdown stock si clic en dehors
document.addEventListener('click', e => {
  const dd = document.getElementById('cmdStockDropdown');
  const input = document.getElementById('cmdStockSearch');
  if (dd && input && !dd.contains(e.target) && e.target !== input) dd.style.display = 'none';
});

// ============================================================
// COMMANDES — MODAL CRÉATION
// ============================================================
function openCommandeModal(fromCart) {
  cmdModalItems = [];
  cmdModalPhotos = [];
  cmdPayMode = 'cash';
  cmdProvider = 'MVola';

  document.getElementById('cmdClientName').value = '';
  document.getElementById('cmdClientContact').value = '';
  document.getElementById('cmdAdresse').value = '';
  document.getElementById('cmdDateLivraison').value = '';
  document.getElementById('cmdNotes').value = '';
  document.getElementById('cmdRemise').value = '';
  document.getElementById('cmdAccompte').value = '';
  document.getElementById('cmdGiven').value = '';
  document.getElementById('cmdMobileRef').value = '';
  document.getElementById('cmdChangeVal').textContent = '0 Ar';
  document.getElementById('cmdPhotosPreviews').innerHTML = '';
  document.getElementById('cmdPhotosInput').value = '';
  document.getElementById('cmdStockSearch').value = '';
  document.getElementById('cmdStockDropdown').style.display = 'none';

  if (fromCart && cart.length > 0) {
    cart.forEach(item => cmdModalItems.push({ name: item.name, qty: item.qty, price: item.price, custom: false }));
  }

  renderCmdItemsTable();
  updateCmdTotals();
  switchCmdPayTab('cash');
  openModal('commandeModal');
}

function renderCmdItemsTable() {
  const container = document.getElementById('cmdItemsList');
  if (!container) return;
  if (cmdModalItems.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--muted);padding:14px;font-size:13px">Aucun article — utilisez la recherche ou "Article libre"</div>';
    return;
  }
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:var(--surface2)">
        <th style="text-align:left;padding:7px 6px">Article</th>
        <th style="text-align:center;padding:7px 6px;width:65px">Qté</th>
        <th style="text-align:right;padding:7px 6px;width:110px">Prix unit. (Ar)</th>
        <th style="text-align:right;padding:7px 6px;width:90px">S-total</th>
        <th style="width:28px"></th>
      </tr></thead>
      <tbody>${cmdModalItems.map((item, i) => `
        <tr style="border-bottom:1px solid var(--border)">
          <td style="padding:7px 6px">
            ${item.custom
              ? `<input value="${item.name.replace(/"/g,'&quot;')}" oninput="cmdModalItems[${i}].name=this.value" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:13px" placeholder="Nom de l'article" />`
              : `<span>${item.name}</span>`}
            ${item.custom ? '<span style="font-size:10px;color:var(--accent2);margin-left:3px">libre</span>' : ''}
          </td>
          <td style="padding:7px 6px;text-align:center">
            <input type="number" value="${item.qty}" min="1"
              oninput="cmdModalItems[${i}].qty=Math.max(1,parseInt(this.value)||1);updateCmdTotals()"
              style="width:55px;padding:4px 6px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:13px;text-align:center" />
          </td>
          <td style="padding:7px 6px">
            <input type="number" value="${item.price}" min="0"
              oninput="cmdModalItems[${i}].price=Math.max(0,parseFloat(this.value)||0);updateCmdTotals()"
              style="width:100px;padding:4px 8px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:13px;text-align:right" />
          </td>
          <td style="padding:7px 6px;text-align:right;font-family:'DM Mono',monospace;white-space:nowrap">${fmt(item.qty * item.price)}</td>
          <td style="padding:7px 4px;text-align:center">
            <button onclick="removeCmdItem(${i})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:17px;padding:2px 4px;line-height:1" title="Supprimer">×</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function removeCmdItem(index) {
  cmdModalItems.splice(index, 1);
  renderCmdItemsTable();
  updateCmdTotals();
}

function addCmdCustomItem() {
  cmdModalItems.push({ name: '', qty: 1, price: 0, custom: true });
  renderCmdItemsTable();
  updateCmdTotals();
}

function filterCmdStock() {
  const q = (document.getElementById('cmdStockSearch')?.value || '').toLowerCase();
  const dd = document.getElementById('cmdStockDropdown');
  if (!dd) return;
  const filtered = products.filter(p => !q || p.name.toLowerCase().includes(q) || (p.code || '').includes(q));
  if (filtered.length === 0) { dd.style.display = 'none'; return; }
  dd.style.display = 'block';
  dd.innerHTML = filtered.slice(0, 8).map(p => `
    <div class="cmd-stock-item" onclick="addCmdItemFromStock(${p.id})">
      <span>${p.emoji || '📦'} ${p.name}</span>
      <span style="font-family:'DM Mono',monospace;color:var(--muted);font-size:12px">${fmt(p.price)}</span>
    </div>`).join('');
}

function addCmdItemFromStock(id) {
  const p = products.find(pr => pr.id === id);
  if (!p) return;
  const existing = cmdModalItems.find(i => i.name === p.name && !i.custom);
  if (existing) { existing.qty++; }
  else { cmdModalItems.push({ name: p.name, qty: 1, price: p.price, custom: false }); }
  document.getElementById('cmdStockSearch').value = '';
  document.getElementById('cmdStockDropdown').style.display = 'none';
  renderCmdItemsTable();
  updateCmdTotals();
}

function updateCmdTotals() {
  const subtotal = cmdModalItems.reduce((s, i) => s + ((i.qty || 1) * (i.price || 0)), 0);
  const remise   = Math.max(0, Math.min(subtotal, parseFloat(document.getElementById('cmdRemise')?.value) || 0));
  const total    = Math.max(0, subtotal - remise);
  const accompte = Math.max(0, Math.min(total, parseFloat(document.getElementById('cmdAccompte')?.value) || 0));
  const restant  = Math.max(0, total - accompte);
  if (document.getElementById('cmdSubtotalVal')) document.getElementById('cmdSubtotalVal').textContent = fmt(subtotal);
  if (document.getElementById('cmdTotalVal'))    document.getElementById('cmdTotalVal').textContent    = fmt(total);
  if (document.getElementById('cmdRestantVal'))  document.getElementById('cmdRestantVal').textContent  = fmt(restant);
  calcCmdChange();
}

function switchCmdPayTab(mode) {
  cmdPayMode = mode;
  document.getElementById('cmdCashSection').style.display   = mode === 'cash'   ? 'block' : 'none';
  document.getElementById('cmdMobileSection').style.display = mode === 'mobile' ? 'block' : 'none';
  document.getElementById('tabCmdCash').classList.toggle('active', mode === 'cash');
  document.getElementById('tabCmdMobile').classList.toggle('active', mode === 'mobile');
}

function calcCmdChange() {
  const given    = parseFloat(document.getElementById('cmdGiven')?.value) || 0;
  const accompte = Math.max(0, parseFloat(document.getElementById('cmdAccompte')?.value) || 0);
  const change   = given - accompte;
  const el = document.getElementById('cmdChangeVal');
  if (el) { el.textContent = fmt(Math.abs(change)); el.className = 'val ' + (change >= 0 ? 'positive' : 'negative'); }
}

function selectCmdProvider(p) {
  cmdProvider = p;
  document.querySelectorAll('#commandeModal .provider-btn').forEach(b => b.classList.remove('active'));
  const map = { 'MVola':'cmdProvMvola','Airtel Money':'cmdProvAirtel','Orange Money':'cmdProvOrange','Bmoov':'cmdProvBmoov' };
  if (map[p]) document.getElementById(map[p]).classList.add('active');
}

async function addCmdPhotos(files) {
  if (!files || files.length === 0) return;
  const remaining = 5 - cmdModalPhotos.length;
  if (remaining <= 0) { showToast('Maximum 5 photos par commande', 'error'); return; }
  for (const file of Array.from(files).slice(0, remaining)) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const dataUrl = await _resizeImage(file, 600, 600);
      cmdModalPhotos.push(dataUrl);
    } catch(e) { showToast('Erreur lecture: ' + file.name, 'error'); }
  }
  renderCmdPhotos();
  document.getElementById('cmdPhotosInput').value = '';
}

function _resizeImage(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW || h > maxH) { const r = Math.min(maxW/w, maxH/h); w = Math.round(w*r); h = Math.round(h*r); }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderCmdPhotos() {
  const container = document.getElementById('cmdPhotosPreviews');
  if (!container) return;
  container.innerHTML = cmdModalPhotos.map((src, i) => `
    <div style="position:relative;display:inline-block">
      <img src="${src}" style="width:80px;height:80px;object-fit:cover;border-radius:10px;border:2px solid var(--border)" />
      <button onclick="removeCmdPhoto(${i})" style="position:absolute;top:-6px;right:-6px;background:var(--red);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1">×</button>
    </div>`).join('');
}

function removeCmdPhoto(index) {
  cmdModalPhotos.splice(index, 1);
  renderCmdPhotos();
}

function saveCommande() {
  const clientName    = document.getElementById('cmdClientName').value.trim();
  const clientContact = document.getElementById('cmdClientContact').value.trim();
  const adresse       = document.getElementById('cmdAdresse').value.trim();
  const dateLiv       = document.getElementById('cmdDateLivraison').value;
  const notes         = document.getElementById('cmdNotes').value.trim();
  const remise        = Math.max(0, parseFloat(document.getElementById('cmdRemise').value) || 0);
  const accompte      = Math.max(0, parseFloat(document.getElementById('cmdAccompte').value) || 0);

  if (!clientName) { showToast('Le nom du client est obligatoire !', 'error'); return; }
  if (cmdModalItems.length === 0) { showToast('Ajoutez au moins un article !', 'error'); return; }
  for (const item of cmdModalItems) {
    if (!item.name.trim()) { showToast('Tous les articles doivent avoir un nom', 'error'); return; }
  }

  const subtotal = cmdModalItems.reduce((s, i) => s + ((i.qty||1) * (i.price||0)), 0);
  const total    = Math.max(0, subtotal - remise);
  const restant  = Math.max(0, total - accompte);

  if (accompte > total) { showToast("L'acompte ne peut pas dépasser le total !", 'error'); return; }

  let depositProvider = '', depositRef = '';
  if (accompte > 0) {
    if (cmdPayMode === 'cash') {
      const given = parseFloat(document.getElementById('cmdGiven').value) || 0;
      if (given < accompte) { showToast('Montant remis insuffisant !', 'error'); return; }
    } else {
      depositProvider = cmdProvider;
      depositRef = document.getElementById('cmdMobileRef').value.trim();
    }
  }

  const commande = {
    id:               nextCommandeId++,
    date:             new Date().toISOString(),
    caissier:         currentUser?.username || 'caissier',
    clientName, clientContact,
    adresseLivraison: adresse,
    dateLivraison:    dateLiv,
    items:            cmdModalItems.map(i => ({ name: i.name.trim(), qty: i.qty, price: i.price, custom: !!i.custom })),
    notes,
    photos:           [...cmdModalPhotos],
    subtotal, remise, total, accompte, restant,
    depositMethod:    cmdPayMode,
    depositProvider, depositRef,
    status:           'pending',
    dateFinalisation: null,
    saleId:           null
  };

  commandes.unshift(commande);
  saveData();
  syncCommandeToSheets(commande);
  closeModal('commandeModal');
  showToast(`🧾 Commande #${commande.id} créée — ${clientName}`);
  updateCmdBadge();

  if (cart.length > 0 && commande.items.some(ci => cart.find(c2 => c2.name === ci.name))) {
    if (confirm('Vider le panier maintenant ?')) clearCart();
  }
}

// ============================================================
// COMMANDES — PAGE / AFFICHAGE
// ============================================================
async function _autoRefreshCommandes() {
  if (!APPS_SCRIPT_URL) { renderCommandes(); return; }
  const now = Date.now();
  if (now - _lastCmdRefresh < 45000) return;
  _lastCmdRefresh = now;
  const btn = document.getElementById('cmdRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Actualisation...'; }
  try { await loadCommandesFromScript(); }
  catch(e) { showToast('⚠️ Erreur chargement commandes', 'error'); }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Actualiser'; }
    renderCommandes();
    updateCmdBadge();
  }
}

async function manualRefreshCommandes() {
  if (!APPS_SCRIPT_URL) { showToast('⚠️ URL Apps Script non configurée', 'error'); return; }
  _lastCmdRefresh = 0;
  await _autoRefreshCommandes();
  showToast('✅ Commandes actualisées');
}

function renderCommandes() {
  const filter = document.getElementById('cmdFilter')?.value || 'pending';
  const list = commandes.filter(c => filter === 'all' ? true : c.status === filter);

  const pending = commandes.filter(c => c.status === 'pending');
  if (document.getElementById('cmdSumCount'))   document.getElementById('cmdSumCount').textContent   = pending.length;
  if (document.getElementById('cmdSumTotal'))   document.getElementById('cmdSumTotal').textContent   = fmt(pending.reduce((s,c)=>s+(Number(c.total)||0),0));
  if (document.getElementById('cmdSumAcc'))     document.getElementById('cmdSumAcc').textContent     = fmt(pending.reduce((s,c)=>s+(Number(c.accompte)||0),0));
  if (document.getElementById('cmdSumRestant')) document.getElementById('cmdSumRestant').textContent = fmt(pending.reduce((s,c)=>s+(Number(c.restant)||0),0));

  const container = document.getElementById('commandesList');
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--muted);padding:48px 20px;font-size:15px">🧾 Aucune commande ${filter==='pending'?'en cours':''}</div>`;
    return;
  }

  container.innerHTML = list.map(c => {
    try {
      const d = parseSaleDate(c.date);
      const dateStr = d ? d.toLocaleString('fr-FR') : '—';
      const statusLabel = { pending:'En cours', completed:'Livrée', cancelled:'Annulée' }[c.status] || c.status;
      const statusClass = { pending:'cmd-status-pending', completed:'cmd-status-completed', cancelled:'cmd-status-cancelled' }[c.status] || '';
      const itemsStr = (c.items||[]).map(i=>`${i.name} ×${i.qty} — ${fmt(i.price)}`).join('<br>')||'—';

      const deliveryHtml = (c.adresseLivraison || c.dateLivraison) ? `
        <div class="cmd-card-delivery">
          ${c.adresseLivraison ? `📍 ${c.adresseLivraison}` : ''}
          ${c.dateLivraison ? ` &nbsp;🗓️ Livraison : <strong>${new Date(c.dateLivraison+'T00:00:00').toLocaleDateString('fr-FR')}</strong>` : ''}
        </div>` : '';

      const notesHtml = c.notes ? `<div class="cmd-notes">📝 ${c.notes}</div>` : '';

      const photosHtml = (c.photos||[]).length > 0
        ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${(c.photos||[]).map(src=>`<img src="${src}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:pointer" onclick="window.open(this.src,'_blank')" />`).join('')}</div>` : '';

      const actions = c.status === 'pending'
        ? `<button class="btn-finalize" onclick="openCmdFinalizeModal(${c.id})">✅ Finaliser</button>
           <button class="btn-cancel-res" onclick="cancelCommande(${c.id})">❌ Annuler</button>`
        : '';

      return `
      <div class="cmd-card">
        <div class="cmd-card-header">
          <div>
            <div class="cmd-card-client">👤 ${c.clientName} <span style="font-size:12px;color:var(--muted);font-weight:400">#${c.id}</span></div>
            ${c.clientContact ? `<div style="font-size:13px;color:var(--muted)">📞 ${c.clientContact}</div>` : ''}
          </div>
          <div style="text-align:right">
            <span class="cmd-status ${statusClass}">${statusLabel}</span>
            <div class="cmd-card-date">${dateStr}</div>
          </div>
        </div>
        ${deliveryHtml}
        <div class="cmd-items">📦 ${itemsStr}</div>
        ${notesHtml}
        ${photosHtml}
        <div class="res-amounts" style="margin-top:12px">
          <div class="res-amount-item"><span class="lbl">Total</span><span class="val">${fmt(c.total)}</span></div>
          <div class="res-amount-item"><span class="lbl">Acompte versé</span><span class="val" style="color:var(--green)">${fmt(c.accompte)}</span></div>
          <div class="res-amount-item"><span class="lbl">Restant dû</span><span class="val" style="color:${c.status==='pending'?'var(--accent2)':'var(--muted)'}">${fmt(c.restant)}</span></div>
        </div>
        ${actions ? `<div class="res-actions">${actions}</div>` : ''}
      </div>`;
    } catch(e) {
      return `<div class="cmd-card" style="color:var(--muted);font-size:13px;padding:12px">⚠️ Commande #${c.id} — erreur: ${e.message}</div>`;
    }
  }).join('');
}

function updateCmdBadge() {
  const n = commandes.filter(c => c.status === 'pending').length;
  const badge = document.getElementById('navCmdBadge');
  if (badge) { badge.textContent = n; badge.style.display = n > 0 ? 'inline' : 'none'; }
}

// ============================================================
// COMMANDES — FINALISER
// ============================================================
function openCmdFinalizeModal(id) {
  const c = commandes.find(x => x.id === id);
  if (!c) return;
  currentCmdFinalizeId = id;
  document.getElementById('cmdFinalClientInfo').textContent = `👤 ${c.clientName}${c.clientContact?' — '+c.clientContact:''}`;
  document.getElementById('cmdFinalTotal').textContent   = fmt(c.total);
  document.getElementById('cmdFinalAcc').textContent     = fmt(c.accompte);
  document.getElementById('cmdFinalRestant').textContent = fmt(c.restant);
  document.getElementById('cmdFinGiven').value = '';
  document.getElementById('cmdFinChangeVal').textContent = '0 Ar';
  document.getElementById('cmdFinMobileRef').value = '';
  cmdFinalPayMode = 'cash';
  cmdFinalProvider = 'MVola';
  switchCmdFinPayTab('cash');
  openModal('cmdFinalizeModal');
}

function switchCmdFinPayTab(mode) {
  cmdFinalPayMode = mode;
  document.getElementById('cmdFinCashSection').style.display  = mode==='cash'   ? 'block' : 'none';
  document.getElementById('cmdFinMobileSection').style.display = mode==='mobile' ? 'block' : 'none';
  document.getElementById('tabCmdFinCash').classList.toggle('active', mode==='cash');
  document.getElementById('tabCmdFinMobile').classList.toggle('active', mode==='mobile');
}

function calcCmdFinChange() {
  const c = commandes.find(x => x.id === currentCmdFinalizeId);
  if (!c) return;
  const given  = parseFloat(document.getElementById('cmdFinGiven').value) || 0;
  const change = given - c.restant;
  const el = document.getElementById('cmdFinChangeVal');
  el.textContent = fmt(Math.abs(change));
  el.className = 'val ' + (change >= 0 ? 'positive' : 'negative');
}

function selectCmdFinProvider(p) {
  cmdFinalProvider = p;
  document.querySelectorAll('#cmdFinalizeModal .provider-btn').forEach(b => b.classList.remove('active'));
  const map = { 'MVola':'cmdFinProvMvola','Airtel Money':'cmdFinProvAirtel','Orange Money':'cmdFinProvOrange','Bmoov':'cmdFinProvBmoov' };
  if (map[p]) document.getElementById(map[p]).classList.add('active');
}

function confirmCmdFinalize() {
  const c = commandes.find(x => x.id === currentCmdFinalizeId);
  if (!c) return;
  if (cmdFinalPayMode === 'cash') {
    const given = parseFloat(document.getElementById('cmdFinGiven').value) || 0;
    if (given < c.restant) { showToast('Montant insuffisant !', 'error'); return; }
    _doCmdFinalize(c, 'cash', given, given - c.restant, null, null);
  } else {
    const ref = document.getElementById('cmdFinMobileRef').value.trim();
    _doCmdFinalize(c, 'mobile', c.restant, 0, cmdFinalProvider, ref);
  }
}

function _doCmdFinalize(c, method, given, change, provider, ref) {
  const sale = {
    id:            nextSaleId++,
    date:          new Date().toISOString(),
    caissier:      currentUser?.label || 'Caissier',
    clientName:    c.clientName,
    clientContact: c.clientContact,
    items:         c.items.map(i => ({ name: i.name, qty: i.qty, price: i.price })),
    subtotal:      c.subtotal,
    remise:        c.remise,
    total:         c.total,
    accompte:      c.accompte,
    due:           0,
    method, given, change,
    provider: provider || '',
    ref:      ref      || '',
    fromCommande: c.id
  };
  sales.unshift(sale);
  c.status           = 'completed';
  c.dateFinalisation = new Date().toISOString();
  c.saleId           = sale.id;
  saveData();
  renderStats();
  syncToAppsScript(sale);
  syncCmdUpdateToSheets(c);
  closeModal('cmdFinalizeModal');
  printTicket(sale);
  showToast(`✅ Vente #${sale.id} enregistrée — Commande #${c.id} livrée !`);
  renderCommandes();
  updateCmdBadge();
}

// ============================================================
// COMMANDES — ANNULER
// ============================================================
function cancelCommande(id) {
  const c = commandes.find(x => x.id === id);
  if (!c || c.status !== 'pending') return;
  if (!confirm(`Annuler la commande #${c.id} de ${c.clientName} ?`)) return;
  c.status = 'cancelled';
  saveData();
  renderCommandes();
  updateCmdBadge();
  syncCmdUpdateToSheets(c);
  showToast(`Commande #${c.id} annulée`, 'info');
}

// ============================================================
// COMMANDES — SYNC GOOGLE SHEETS
// ============================================================
async function syncCommandeToSheets(cmd) {
  if (!APPS_SCRIPT_URL) return;
  const r = await apiCall({ action: 'addCommande', commande: cmd });
  if (!r || !r.ok) console.warn('Sync commande échouée:', r?.error || 'Connexion impossible');
}

async function syncCmdUpdateToSheets(cmd) {
  if (!APPS_SCRIPT_URL) return;
  await apiCall({ action: 'updateCommande', id: cmd.id, status: cmd.status, dateFinalisation: cmd.dateFinalisation || '', saleId: cmd.saleId || '' });
}

async function loadCommandesFromScript() {
  if (!APPS_SCRIPT_URL) return;
  const r = await apiCall({ action: 'getCommandes' });
  if (r && r.ok && Array.isArray(r.commandes) && r.commandes.length > 0) {
    const sheetIds = new Set(r.commandes.map(c => String(c.id)));
    const localOnly = commandes.filter(c => !sheetIds.has(String(c.id)));
    commandes = [...r.commandes, ...localOnly];
    commandes.sort((a, b) => (parseSaleDate(b.date)||0) - (parseSaleDate(a.date)||0));
    if (commandes.length > 0) nextCommandeId = Math.max(...commandes.map(c => Number(c.id))) + 1;
    saveData();
  }
}

// ============================================================
// EXPORT CSV DES VENTES (côté frontend)
// ============================================================
function exportSalesCSV() {
  const from = document.getElementById('reportDateFrom')?.value || '';
  const to   = document.getElementById('reportDateTo')?.value   || '';
  let list = sales;
  if (from || to) {
    const fromDate = from ? new Date(from + 'T00:00:00') : null;
    const toDate   = to   ? new Date(to   + 'T23:59:59') : null;
    list = sales.filter(s => {
      const d = parseSaleDate(s.date);
      if (!d) return true;
      if (fromDate && d < fromDate) return false;
      if (toDate   && d > toDate)   return false;
      return true;
    });
  }
  if (list.length === 0) { showToast('Aucune vente sur cette période', 'error'); return; }

  const headers = ['ID','Date','Heure','Articles','Quantite','Prix_Unit','Sous_Total','Remise','Net_Payer','Accompte','Reste_Du','Paiement','Operateur','Reference','Caissier','Client','Contact'];
  const rows = [];
  list.forEach(s => {
    const d = parseSaleDate(s.date);
    const dateStr = d ? d.toLocaleDateString('fr-FR') : '';
    const timeStr = d ? d.toLocaleTimeString('fr-FR') : '';
    const items = Array.isArray(s.items) ? s.items : [];
    items.forEach(item => {
      rows.push([
        s.id, dateStr, timeStr,
        item.name || '', item.qty || 1, item.price || 0,
        (item.qty || 1) * (item.price || 0),
        s.remise || 0, s.total || 0, s.accompte || 0, s.due || 0,
        s.method === 'cash' ? 'Espèces' : 'Mobile Money',
        s.provider || '', s.ref || '',
        s.caissier || '', s.clientName || '', s.clientContact || ''
      ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';'));
    });
  });

  const csv = [headers.join(';'), ...rows].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `ventes_${(from || new Date().toISOString().slice(0,10))}_${(to || '')}.csv`
  });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  showToast(`✅ Export CSV — ${list.length} vente(s)`);
}

// ============================================================
// INIT
// ============================================================
loadConfig();
loadData();
loadUsers();
initPWA();
renderCart();
