// ============================================================
// SHA-256 (WebCrypto API — natif dans tous les navigateurs modernes)
// ============================================================
async function sha256(str) {
  const msgBuffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => ('0' + b.toString(16)).slice(-2)).join('');
}

// Migration des mots de passe localUsers : passe du texte clair au hash SHA-256
// Appelée une seule fois au démarrage ; après, tous les .pass sont des hex 64 chars
async function _migrateLocalUserPasswords() {
  let migrated = false;
  for (const u of localUsers) {
    if (u.pass && u.pass.length < 60) { // pas encore un hash
      u.pass = await sha256(u.pass);
      migrated = true;
    }
  }
  if (migrated) {
    try { localStorage.setItem('pos-users', JSON.stringify(localUsers)); } catch(e) {}
  }
}

// ============================================================
// VERSION APP — incrémenter à chaque déploiement pour déclencher
// le vidage automatique du cache sur tous les navigateurs clients
// ============================================================
const APP_VERSION = '2.1.0';

// ============================================================
// RYTHME DE PRODUCTION — déclaré ici pour être sûrement initialisé
// avant tout appel de fonction (évite la TDZ dans le bloc init)
// ============================================================
// Polling notifications — déclarés en tête pour éviter TDZ
var _notifRetryQueue   = [];
var _notifPollInterval = null;
var notifications      = (function() {
  try { var r = localStorage.getItem('pos-notifications'); return r ? JSON.parse(r) : []; } catch(e) { return []; }
}());

var RYTHME_DEFAULTS = {
  ACHAT:         1440,  // 24h
  PAO:           480,   // 8h
  BAT:           240,   // 4h
  RETOUR_CLIENT: 2880,  // 48h
  MODIFICATIONS: 240,   // 4h
  PRODUCTION:    480,   // 8h
  FINITION:      240,   // 4h
  LIVRE:         480,   // 8h
};
var rythmeProduction = (function() {
  try {
    var raw   = localStorage.getItem('pos-rythme-production');
    var saved = raw ? JSON.parse(raw) : {};
    var res   = {};
    for (var code in RYTHME_DEFAULTS) {
      var v = saved[code];
      // Migration heures→minutes : si valeur <= 999 et défaut > 60, l'ancienne valeur était en heures
      if (v != null && v <= 100 && RYTHME_DEFAULTS[code] >= 60) v = v * 60;
      res[code] = (v != null ? v : RYTHME_DEFAULTS[code]);
    }
    return res;
  } catch(e) { return {}; }
}());

// ============================================================
// DATA & STATE
// ============================================================
// Utilisateurs locaux (persistés dans localStorage)
let localUsers = [
  { username:'admin',        pass:'1234', role:'admin',        label:'Administrateur',    actif:true },
  { username:'caissier',     pass:'0000', role:'caissier',     label:'Caissier',          actif:true },
  { username:'utilisateur',  pass:'1111', role:'utilisateur',  label:'Utilisateur',       actif:true },
  { username:'gestionnaire', pass:'2222', role:'gestionnaire', label:'Gestionnaire Stock', actif:true },
  { username:'comptable',    pass:'3333', role:'comptable',    label:'Comptable',         actif:true },
  { username:'chef_atelier', pass:'4444', role:'chef_atelier', label:'Chef Atelier',      actif:true },
  { username:'pao',          pass:'5555', role:'pao',          label:'Graphiste PAO',     actif:true },
  { username:'finition',     pass:'6666', role:'finition',     label:'Finisheur',         actif:true },
  { username:'livreur',      pass:'7777', role:'livreur',      label:'Livreur',           actif:true },
];

const ROLE_LABELS = {
  admin:         'Administrateur',
  caissier:      'Caissier',
  commerciale:   'Commerciale',
  utilisateur:   'Utilisateur',
  gestionnaire:  'Gestionnaire Stock',
  comptable:     'Comptable',
  chef_atelier:  'Chef Atelier',
  operateur_prod:'Opérateur Prod',
  machiniste:    'Machiniste',
  pao:           'Graphiste PAO',
  finition:      'Finisheur',
  livreur:       'Livreur',
};

const ROLE_ICONS = {
  admin: '', caissier: '', commerciale: '', utilisateur: '', gestionnaire: '', comptable: '',
  chef_atelier: '', operateur_prod: '', machiniste: '', pao: '', finition: '', livreur: ''
};

const PAGE_ACCESS = {
  caisse:       ['admin','caissier','commerciale','utilisateur','gestionnaire'],
  reservations: ['admin','caissier','commerciale','utilisateur','gestionnaire','comptable'],
  commandes:    ['admin','caissier','commerciale','gestionnaire','comptable','livreur'],
  stock:        ['admin','gestionnaire'],
  stats:        ['admin','comptable'],
  config:       ['admin'],
  users:        ['admin'],
  attribution:  ['admin','chef_atelier','operateur_prod','machiniste','pao','finition','livreur'],
  production:   ['admin','chef_atelier','operateur_prod','machiniste','pao','finition','livreur','caissier','commerciale','utilisateur','gestionnaire','comptable'],
};
let editingUserId = null; // index dans localUsers

let currentUser = null;
let cart = [];
let heldCarts = [];
let paymentMode = 'cash';
let selectedProvider = 'MVola';
let editingProductId = null;
let editingProductImage = null;

let products = [];

let sales = [];

let nextId = 1;
let nextSaleId = 1;

let reservations = [];
let resAttachments   = []; // { name, type, data (base64) }
let dossierComments  = []; // tous les commentaires chargés
let commentAttachments = []; // pièces jointes du commentaire en cours
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
// Comparaison insensible à la casse et aux espaces — utilisée pour matcher les opérateurs
function _sameOp(a, b) { return (a||'').trim().toLowerCase() === (b||'').trim().toLowerCase(); }
function now() { return new Date().toLocaleString('fr-MG'); }

// ── Sécurité : protection XSS pour les données utilisateur ──
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Stockage local sécurisé (protection QuotaExceededError) ──
function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch(e) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      showToast(' Stockage local saturé — synchronisation forcée recommandée', 'error');
      console.error('localStorage quota exceeded pour la clé:', key);
    }
  }
}
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
  //  Envoyer le mot de passe en CLAIR au backend (le serveur se charge du hashage)
  if (APPS_SCRIPT_URL) {
    const r = await loginViaScript(u, p);
    if (r && r.ok) {
      loginOk = true; userInfo = r.user;
      // Garantir que label est toujours une vraie valeur (le Sheet peut renvoyer
      // undefined, null, ou la chaîne "undefined" si le champ était vide)
      if (!userInfo.label || userInfo.label === 'undefined') {
        userInfo.label = userInfo.username || u;
      }
      // Mettre à jour / créer le compte local avec le hash du mot de passe
      // → permet le login offline même après effacement du localStorage
      const luIdx = localUsers.findIndex(x => x.username.toLowerCase() === u);
      if (luIdx >= 0) {
        localUsers[luIdx].pass  = pHashed;
        localUsers[luIdx].label = userInfo.label;
        localUsers[luIdx].role  = userInfo.role;
        if (userInfo.actif !== undefined) localUsers[luIdx].actif = userInfo.actif;
      } else {
        localUsers.push({ username: u, pass: pHashed, role: userInfo.role, label: userInfo.label, actif: true });
      }
      try { localStorage.setItem('pos-users', JSON.stringify(localUsers)); } catch(e) {}
    } else if (r && !r.ok) {
      const errMsg = r.error || '';
      const isCredError = errMsg.toLowerCase().includes('identifiant') ||
                          errMsg.toLowerCase().includes('mot de passe') ||
                          errMsg.toLowerCase().includes('incorrect') ||
                          errMsg.toLowerCase().includes('password');
      if (!isCredError) {
        showToast(' Google Sheets inaccessible — connexion locale. ' + errMsg, 'info');
      }
      // isCredError : ne pas retourner ici — tenter le fallback local d'abord
      // (les utilisateurs créés localement non encore synchronisés au Sheet)
    }
  }

  // Fallback local : accepte le mot de passe en clair OU son hash SHA-256
  if (!loginOk) {
    const lu = localUsers.find(x =>
      x.username.toLowerCase() === u &&
      (x.pass === p || x.pass === pHashed) &&
      x.actif !== false
    );
    if (lu) {
      const lbl = (lu.label && lu.label !== 'undefined') ? lu.label : (lu.username || u);
      loginOk = true; userInfo = { username: lu.username, role: lu.role, label: lbl };
    }
  }

  btn.disabled = false; btn.textContent = 'Se connecter';

  if (loginOk && userInfo) {
    currentUser = userInfo;
    document.getElementById('currentUserLabel').textContent = currentUser.label;
    document.getElementById('loginScreen').style.display='none';
    document.getElementById('app').style.display='flex';
    document.getElementById('bottomNav').style.display='block';
    err.style.display='none';
    _renderNotifBell();
    showToast(`Bonjour, ${currentUser.label} ! `);
    // Charger les notifications des collègues en arrière-plan + démarrer le polling
    loadNotifsFromGAS();
    _startNotifPolling();
    // Charger les données depuis le Sheet
    if (APPS_SCRIPT_URL) {
      await loadProductsFromScript();
      await loadSalesFromScript();
      await loadUsersFromScript();
      await loadReservationsFromScript();
      await loadCommandesFromScript();
      await syncPendingOfflineSales();
      saveData(); // Persister l'état fusionné après tous les chargements
    }
    applyRolePermissions(currentUser.role);
    updatePendingBadge();
    updateResBadge();
    renderProducts();
    renderStockTable();
    renderStats();
    // Rediriger vers la première page accessible selon le rôle
    const startPage = Object.keys(PAGE_ACCESS).find(p => PAGE_ACCESS[p].includes(currentUser.role)) || 'caisse';
    showPage(startPage, null, null);
    if (window.innerWidth <= 768) switchCaisseTab('products');
  } else {
    err.textContent = ' Identifiant ou mot de passe incorrect';
    err.style.display='block';
  }
}
document.getElementById('loginPass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
function doLogout() {
  _stopNotifPolling();
  closeNotifPanel();
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
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  if (window.innerWidth <= 768) {
    // Mobile : ouvrir/fermer le drawer
    const isOpen = sidebar.classList.toggle('mobile-open');
    const overlay = document.getElementById('navOverlay');
    if (overlay) overlay.classList.toggle('open', isOpen);
  } else {
    // Desktop : réduire/agrandir la sidebar
    sidebar.classList.toggle('collapsed');
  }
}

function closeMobileNav() {
  document.getElementById('sidebar')?.classList.remove('mobile-open');
  const overlay = document.getElementById('navOverlay');
  if (overlay) overlay.classList.remove('open');
}

function showPage(id, btn, bnavBtn) {
  // Fermer le drawer mobile à chaque navigation
  if (window.innerWidth <= 768) closeMobileNav();
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
  if (id==='stats')        { renderStats(); _autoRefreshStats(); _loadProdStats(); }
  if (id==='config')       { renderConfigPage(); renderRythmeConfig(); }
  if (id==='users')        renderUsersPage();
  if (id==='reservations') { _ensureDossierLinks(); renderReservations(); _autoRefreshReservations(); _loadTachesQuietly().then(renderReservations); }
  if (id==='attribution')  {
    // Reset uniquement à la navigation (pas lors des changements de filtre)
    if (!_pendingSelectDossierId) {
      selectedDossier = null;
      const _ap = document.getElementById('attrPanel');
      if (_ap) _ap.innerHTML = `<div style="text-align:center;color:var(--color-text-muted);padding:60px 24px"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 12px;display:block;opacity:.4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><p style="font-size:14px">Sélectionnez un dossier<br>pour assigner les étapes</p></div>`;
    }
    loadDossiers(); initModulesProduction();
  }
  if (id==='production')   { loadTaches(); _autoRefreshProduction(); initModulesProduction(); }
  if (id==='patron')       { renderPatronDashboard(); _autoRefreshPatron(); }
  if (id==='commandes')    { _ensureDossierLinks(); renderCommandes(); _autoRefreshCommandes(); _loadTachesQuietly().then(renderCommandes); }
  // Garde d'accès par rôle
  if (currentUser) {
    const allowed = PAGE_ACCESS[id];
    if (allowed && !allowed.includes(currentUser.role)) {
      const fallback = Object.keys(PAGE_ACCESS).find(p => PAGE_ACCESS[p].includes(currentUser.role)) || 'caisse';
      showPage(fallback, null, null);
      showToast(' Accès non autorisé pour votre rôle', 'error');
      return;
    }
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
        ? `<img class="product-img" src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy" />`
        : `<span class="product-emoji">${p.emoji||''}</span>`}
      <div class="product-name">${escapeHtml(p.name)}</div>
      <div class="product-price">${fmt(p.price)}</div>
      <div class="product-stock ${p.stock===0?'stock-out':p.stock<=p.minStock?'stock-low':''}">
        ${p.stock===0?' Rupture':p.stock<=p.minStock?` Stock: ${p.stock}`:`Stock: ${p.stock}`}
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
  renderHeldCarts();
}

function holdCurrentCart() {
  if (cart.length === 0) { showToast('Le panier est vide', 'error'); return; }
  const remise   = parseFloat(document.getElementById('cartRemise')?.value)   || 0;
  const accompte = parseFloat(document.getElementById('cartAccompte')?.value) || 0;
  heldCarts.push({
    id:        Date.now(),
    items:     cart.map(i => ({ ...i })),
    remise,
    accompte,
    createdAt: new Date().toISOString()
  });
  clearCart();
  showToast(`Panier #${heldCarts.length} mis en attente`);
}

function recallHeldCart(index) {
  const held = heldCarts[index];
  if (!held) return;
  if (cart.length > 0) {
    const remise   = parseFloat(document.getElementById('cartRemise')?.value)   || 0;
    const accompte = parseFloat(document.getElementById('cartAccompte')?.value) || 0;
    heldCarts.push({ id: Date.now(), items: cart.map(i => ({ ...i })), remise, accompte, createdAt: new Date().toISOString() });
  }
  cart = held.items.map(i => ({ ...i }));
  heldCarts.splice(index, 1);
  const ri = document.getElementById('cartRemise');   if (ri) ri.value = held.remise   || '';
  const ai = document.getElementById('cartAccompte'); if (ai) ai.value = held.accompte || '';
  renderCart();
  renderHeldCarts();
  showToast('Panier rappelé');
}

function deleteHeldCart(index) {
  heldCarts.splice(index, 1);
  renderHeldCarts();
}

function renderHeldCarts() {
  const bar = document.getElementById('heldCartsBar');
  if (!bar) return;
  if (heldCarts.length === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  bar.innerHTML = `
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">
      En attente
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${heldCarts.map((hc, i) => {
        const total = hc.items.reduce((s, it) => s + it.price * it.qty, 0);
        const qty   = hc.items.reduce((s, it) => s + it.qty, 0);
        return `<div
          onclick="recallHeldCart(${i})"
          onmouseover="this.style.background='rgba(232,131,74,0.22)'"
          onmouseout="this.style.background='rgba(232,131,74,0.10)'"
          style="cursor:pointer;display:flex;align-items:center;gap:6px;background:rgba(232,131,74,0.10);border:1.5px solid var(--accent2);border-radius:10px;padding:5px 10px;transition:.15s;user-select:none">
          <span style="font-size:12px;font-weight:700;color:var(--accent2)">#${i + 1}</span>
          <span style="font-size:11px;color:var(--text);white-space:nowrap">${qty} art. — ${fmt(total)}</span>
          <button onclick="event.stopPropagation();deleteHeldCart(${i})"
            style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:15px;padding:0 0 0 3px;line-height:1;transition:.15s"
            onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--muted)'"
            title="Supprimer ce panier">×</button>
        </div>`;
      }).join('')}
    </div>`;
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
  if(cart.length===0) { el.innerHTML='<div class="cart-empty"><span class="icon"></span>Le panier est vide</div>'; return; }
  el.innerHTML = cart.map(i=>`
    <div class="cart-item">
      <span style="font-size:20px">${i.emoji||''}</span>
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
      <button class="btn-remove" onclick="removeFromCart(${i.id})"></button>
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
  // Reset type client
  setClientType('pay', 'particulier');
  document.getElementById('payClientCompany').value = '';
  // Reset livraison
  setDeliveryMode('retrait');
  document.getElementById('deliveryAddress').value = '';
  document.getElementById('deliveryFee').value = '';
  document.getElementById('deliveryDate').value = '';
  switchPayTab(mode);
  openModal('paymentModal');
}

// ── Type client (Particulier / Corporate) ──
function setClientType(ctx, type) {
  const isCorp = type === 'corporate';
  const prefix = ctx === 'res' ? 'res' : 'pay';
  const btnP = document.getElementById(`${prefix}BtnParticulier`);
  const btnC = document.getElementById(`${prefix}BtnCorporate`);
  const inp  = document.getElementById(`${prefix}ClientCompany`);
  if (btnP) { btnP.style.background = isCorp ? '#fff' : '#1a4a3a'; btnP.style.color = isCorp ? '#78716c' : '#fff'; btnP.style.borderColor = isCorp ? '#e5e3df' : '#1a4a3a'; }
  if (btnC) { btnC.style.background = isCorp ? '#2563eb' : '#fff'; btnC.style.color = isCorp ? '#fff' : '#78716c'; btnC.style.borderColor = isCorp ? '#2563eb' : '#e5e3df'; }
  if (inp)  { inp.style.display = isCorp ? 'block' : 'none'; if (!isCorp) inp.value = ''; }
}

// ── Livraison / Retrait ──
function setDeliveryMode(mode) {
  const isLiv = mode === 'livraison';
  // Boutons toggle
  const btnR = document.getElementById('btnModeRetrait');
  const btnL = document.getElementById('btnModeLivraison');
  if (btnR) {
    btnR.style.background  = isLiv ? '#fff'     : '#1a4a3a';
    btnR.style.color       = isLiv ? '#78716c'  : '#fff';
    btnR.style.borderColor = isLiv ? '#e5e3df'  : '#1a4a3a';
  }
  if (btnL) {
    btnL.style.background  = isLiv ? '#e8834a'  : '#fff';
    btnL.style.color       = isLiv ? '#fff'     : '#78716c';
    btnL.style.borderColor = isLiv ? '#e8834a'  : '#e5e3df';
  }
  // Champs livraison
  const fields = document.getElementById('deliveryFields');
  if (fields) fields.style.display = isLiv ? 'block' : 'none';
  if (isLiv) updateDeliveryTotal();
}

function updateDeliveryTotal() {
  const fee = parseFloat(document.getElementById('deliveryFee')?.value) || 0;
  const due = getDue();
  const el  = document.getElementById('totalAvecLivraison');
  if (el) el.textContent = fmt(due + fee);
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
  const clientName    = document.getElementById('clientName').value.trim();
  const clientContact = document.getElementById('clientContact').value.trim();
  const isCorp        = document.getElementById('payBtnCorporate')?.style.background === 'rgb(37, 99, 235)';
  const clientType    = isCorp ? 'corporate' : 'particulier';
  const clientCompany = isCorp ? (document.getElementById('payClientCompany')?.value.trim() || '') : '';
  // Livraison
  const isLiv          = document.getElementById('btnModeLivraison')?.style.background === 'rgb(232, 131, 74)';
  const deliveryMode   = isLiv ? 'livraison' : 'retrait';
  const deliveryAddress= isLiv ? (document.getElementById('deliveryAddress')?.value.trim() || '') : '';
  const deliveryFee    = isLiv ? (parseFloat(document.getElementById('deliveryFee')?.value) || 0) : 0;
  const deliveryDate   = isLiv ? (document.getElementById('deliveryDate')?.value || '') : '';
  if (isLiv && !deliveryAddress) {
    showToast("Veuillez saisir l'adresse de livraison.", 'error');
    return;
  }
  const totalWithDelivery = net + deliveryFee;
  const due = getDue() + deliveryFee;
  if(paymentMode==='cash') {
    const given = parseFloat(document.getElementById('givenAmount').value)||0;
    if(given < due) { showToast('Montant insuffisant !','error'); return; }
    recordSale(totalWithDelivery, 'cash', given, given-due, null, null, rem, acc, clientName, clientContact, deliveryMode, deliveryAddress, deliveryFee, deliveryDate, clientType, clientCompany);
  } else {
    const ref = document.getElementById('mobileRef').value.trim();
    recordSale(totalWithDelivery, 'mobile', due, 0, selectedProvider, ref, rem, acc, clientName, clientContact, deliveryMode, deliveryAddress, deliveryFee, deliveryDate, clientType, clientCompany);
  }
}
function recordSale(total, method, given, change, provider, ref, remise=0, accompte=0, clientName='', clientContact='', deliveryMode='retrait', deliveryAddress='', deliveryFee=0, deliveryDate='', clientType='particulier', clientCompany='') {
  // Vérification stock local avant de valider
  for (const item of cart) {
    const p = products.find(pr => pr.id === item.id);
    if (p && p.stock < item.qty) {
      showToast(` Stock insuffisant pour "${p.name}" : ${p.stock} dispo, ${item.qty} demandé(s)`, 'error');
      return;
    }
  }
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
    method, given, change, provider, ref,
    deliveryMode, deliveryAddress, deliveryFee, deliveryDate,
    clientType, clientCompany
  };
  sales.unshift(sale);
  printTicket(sale);
  saveData();
  if (window._posBroadcast) window._posBroadcast('sale-added', { id: sale.id });
  closeModal('paymentModal');
  const msg = method==='cash' ? 'Monnaie: '+fmt(change) : 'Ref: '+(ref||'—');
  showToast(` Vente enregistrée ! ${msg}`);
  clearCart();
  renderProducts();
  renderStockTable();
  renderStats();
  syncToAppsScript(sale);
}

// ============================================================
// RÉSERVATIONS — UPLOAD DRIVE
// ============================================================
async function _uploadReservationAttachments(reservationId, attachments) {
  const res = reservations.find(r => String(r.id) === String(reservationId));
  if (!res) return;
  showLoader(`Upload ${attachments.length} pièce(s) jointe(s)...`);
  const uploaded = [];
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    showLoader(`Upload ${i + 1}/${attachments.length} : ${att.name}`);
    try {
      const r = await apiCall({ action:'uploadFile', fileName:att.name, mimeType:att.type, base64Data:att.data });
      if (r && r.ok) {
        uploaded.push({ name:r.fileName||att.name, type:att.type, fileId:r.fileId, viewUrl:r.viewUrl, dlUrl:r.dlUrl });
      } else {
        uploaded.push({ name:att.name, type:att.type, data:att.data }); // fallback local
      }
    } catch(e) {
      uploaded.push({ name:att.name, type:att.type, data:att.data });
    }
  }
  hideLoader();
  res.attachments = uploaded;
  saveData();
  renderReservations();
  showToast(` ${uploaded.length} pièce(s) jointe(s) uploadée(s) sur Drive`);
  // Re-syncer vers GAS avec les metadata Drive (fileId/viewUrl) maintenant disponibles
  syncReservationAttachmentsToGAS(res);
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
  resAttachments = [];
  renderResAttachments();
  switchResPayTab('cash');
  // Reset type client
  setClientType('res', 'particulier');
  document.getElementById('resClientCompany').value = '';
  // Reset livraison
  setResDeliveryMode('retrait');
  document.getElementById('resDeliveryAddress').value = '';
  document.getElementById('resDeliveryFee').value = '';
  document.getElementById('resDeliveryDate').value = '';
  openModal('reservationModal');
}

function setResDeliveryMode(mode) {
  const isLiv = mode === 'livraison';
  const btnR = document.getElementById('resBtnModeRetrait');
  const btnL = document.getElementById('resBtnModeLivraison');
  if (btnR) { btnR.style.background = isLiv?'#fff':'#1a4a3a'; btnR.style.color = isLiv?'#78716c':'#fff'; btnR.style.borderColor = isLiv?'#e5e3df':'#1a4a3a'; }
  if (btnL) { btnL.style.background = isLiv?'#e8834a':'#fff'; btnL.style.color = isLiv?'#fff':'#78716c'; btnL.style.borderColor = isLiv?'#e8834a':'#e5e3df'; }
  const fields = document.getElementById('resDeliveryFields');
  if (fields) fields.style.display = isLiv ? 'block' : 'none';
}

function setCmdDeliveryMode(mode) {
  const isLiv = mode === 'livraison';
  const btnR = document.getElementById('cmdBtnModeRetrait');
  const btnL = document.getElementById('cmdBtnModeLivraison');
  if (btnR) { btnR.style.background = isLiv?'#fff':'#1a4a3a'; btnR.style.color = isLiv?'#78716c':'#fff'; btnR.style.borderColor = isLiv?'#e5e3df':'#1a4a3a'; }
  if (btnL) { btnL.style.background = isLiv?'#e8834a':'#fff'; btnL.style.color = isLiv?'#fff':'#78716c'; btnL.style.borderColor = isLiv?'#e8834a':'#e5e3df'; }
  const fields = document.getElementById('cmdDeliveryFields');
  if (fields) fields.style.display = isLiv ? 'block' : 'none';
  updateCmdTotals();
}

async function addResAttachments(files) {
  if (!files || !files.length) return;
  const MAX = 6;
  if (resAttachments.length >= MAX) { showToast(`Maximum ${MAX} pièces jointes`, 'error'); return; }
  const remaining = MAX - resAttachments.length;
  for (const file of Array.from(files).slice(0, remaining)) {
    if (file.size > 8 * 1024 * 1024) { showToast(`${file.name} trop volumineux (max 8 Mo)`, 'error'); continue; }
    try {
      let data;
      if (file.type.startsWith('image/')) {
        data = await _resizeImage(file, 1200, 1200);
      } else {
        data = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = e => res(e.target.result);
          r.onerror = rej;
          r.readAsDataURL(file);
        });
      }
      resAttachments.push({ name: file.name, type: file.type, data });
    } catch(e) { showToast('Erreur lecture : ' + file.name, 'error'); }
  }
  renderResAttachments();
  document.getElementById('resAttachmentsInput').value = '';
}

function removeResAttachment(idx) {
  resAttachments.splice(idx, 1);
  renderResAttachments();
}

function renderResAttachments() {
  const c = document.getElementById('resAttachmentsPreviews');
  if (!c) return;
  if (!resAttachments.length) { c.innerHTML = ''; return; }
  c.innerHTML = resAttachments.map((a, i) => {
    const isImg = a.type.startsWith('image/');
    const thumb = isImg
      ? `<img src="${a.data}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1.5px solid var(--color-border);display:block" />`
      : `<div style="width:64px;height:64px;border-radius:8px;border:1.5px solid var(--color-border);background:var(--color-bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px">
           <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--color-primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
           <span style="font-size:9px;color:var(--color-text-muted);text-transform:uppercase;font-weight:700">${a.name.split('.').pop()}</span>
         </div>`;
    return `<div style="position:relative;display:inline-block;cursor:pointer" onclick="window.open('${a.data}','_blank')" title="${a.name}">
      ${thumb}
      <button onclick="event.stopPropagation();removeResAttachment(${i})" style="position:absolute;top:-6px;right:-6px;background:var(--color-danger,#dc2626);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1">×</button>
    </div>`;
  }).join('');
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

  // Type client
  const isResCorp     = document.getElementById('resBtnCorporate')?.style.background === 'rgb(37, 99, 235)';
  const clientType    = isResCorp ? 'corporate' : 'particulier';
  const clientCompany = isResCorp ? (document.getElementById('resClientCompany')?.value.trim() || '') : '';
  // Livraison
  const isLiv          = document.getElementById('resBtnModeLivraison')?.style.background === 'rgb(232, 131, 74)';
  const deliveryMode   = isLiv ? 'livraison' : 'retrait';
  const deliveryAddress= isLiv ? (document.getElementById('resDeliveryAddress')?.value.trim() || '') : '';
  const deliveryFee    = isLiv ? (parseFloat(document.getElementById('resDeliveryFee')?.value) || 0) : 0;
  const deliveryDate   = isLiv ? (document.getElementById('resDeliveryDate')?.value || '') : '';
  if (isLiv && !deliveryAddress) { showToast("Veuillez saisir l'adresse de livraison.", 'error'); return; }

  if (resPaymentMode === 'cash') {
    const given = parseFloat(document.getElementById('resGiven').value) || 0;
    if (given < acc) { showToast('Montant remis insuffisant pour l\'acompte !', 'error'); return; }
    const change = given - acc;
    saveReservation(acc, 'cash', given, change, null, null, clientName, clientContact, deliveryMode, deliveryAddress, deliveryFee, deliveryDate, clientType, clientCompany);
  } else {
    const ref = document.getElementById('resMobileRef').value.trim();
    saveReservation(acc, 'mobile', acc, 0, resSelectedProvider, ref, clientName, clientContact, deliveryMode, deliveryAddress, deliveryFee, deliveryDate, clientType, clientCompany);
  }
}

function saveReservation(accompte, depositMethod, given, change, provider, ref, clientName, clientContact, deliveryMode='retrait', deliveryAddress='', deliveryFee=0, deliveryDate='', clientType='particulier', clientCompany='') {
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
    saleId: null,
    attachments: resAttachments.map(a => ({ name: a.name, type: a.type, data: a.data })),
    deliveryMode, deliveryAddress, deliveryFee, deliveryDate,
    clientType, clientCompany
  };

  const _resDossier = _createDossierFromSource('reservation', reservation);
  reservation.dossierId = _resDossier.id;
  reservations.unshift(reservation);
  saveData();
  syncReservationToSheets(reservation);
  printReservationTicket(reservation);
  closeModal('reservationModal');
  _addNotification({
    dossierId:     reservation.dossierId,
    numeroDossier: _resDossier.numeroDossier,
    etapeCode:     'RESERVE',
    etapeLabel:    'Réservation créée',
    operateur:     currentUser?.label || 'Caissier',
    message:       `Nouvelle réservation ${_resDossier.numeroDossier} — ${clientName} — ${reservation.items.map(i=>i.name).join(', ')}`
  });
  showToast(` Réservation #${reservation.id} créée — Acompte ${fmt(accompte)}`);
  // Upload des pièces jointes vers Drive (après fermeture du modal)
  if (resAttachments.length && APPS_SCRIPT_URL) {
    _uploadReservationAttachments(reservation.id, [...resAttachments]);
  }
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
    showToast(' Erreur chargement réservations — données locales affichées', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = ' Actualiser'; }
    renderReservations();
    updateResBadge();
  }
}

async function manualRefreshReservations() {
  if (!APPS_SCRIPT_URL) { showToast(' URL Apps Script non configurée', 'error'); return; }
  _lastResRefresh = 0;
  await _autoRefreshReservations();
  showToast(' Réservations actualisées');
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
    container.innerHTML = `<div class="res-empty"> Aucune réservation ${filter === 'pending' ? 'en attente' : ''}</div>`;
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
      <button class="btn-finalize" onclick="openFinalizeModal('${r.id}')"> Finaliser</button>
      <button class="btn-cancel-res" onclick="cancelReservation('${r.id}')"> Annuler</button>
      <button class="btn-reprint-res" onclick="printReservationTicket(reservations.find(x=>String(x.id)==='${r.id}'))" title="Réimprimer"></button>
    ` : `<button class="btn-reprint-res" onclick="printReservationTicket(reservations.find(x=>String(x.id)==='${r.id}'))" title="Réimprimer"></button>`;

    return `
    <div class="res-card">
      <div class="res-card-header">
        <div>
          <div class="res-card-client"> ${escapeHtml(r.clientName)} <span style="font-size:12px;color:var(--muted);font-weight:400">#${r.id}</span></div>
          ${r.clientContact ? `<div class="res-card-contact"> ${escapeHtml(r.clientContact)}</div>` : ''}
        </div>
        <div style="text-align:right">
          <span class="res-status ${statusClass}">${statusLabel}</span>
          <div class="res-card-date">${dateStr}</div>
        </div>
      </div>
      <div class="res-items" style="line-height:1.8"> ${itemsStr}</div>
      <div class="res-amounts">
        <div class="res-amount-item"><span class="lbl">Total</span><span class="val">${fmt(r.total)}</span></div>
        <div class="res-amount-item"><span class="lbl">Acompte versé</span><span class="val" style="color:var(--green)">${fmt(r.accompte)}</span></div>
        <div class="res-amount-item"><span class="lbl">Restant dû</span><span class="val" style="color:${r.status==='pending'?'var(--accent)':'var(--muted)'}">${fmt(r.restant)}</span></div>
      </div>
      <div class="res-actions">${actions}</div>
      ${r.status === 'pending' && r.dossierId ? _buildCardProductionSection(r.dossierId) : ''}
    </div>`;
    } catch(e) {
      console.error('renderReservations card #' + r.id + ':', e);
      return `<div class="res-card" style="color:var(--muted);font-size:13px;padding:12px"> Réservation #${r.id} — erreur affichage: ${e.message}</div>`;
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
  const r = reservations.find(x => String(x.id) === String(id));
  if (!r) return;
  currentFinalizeResId = id;
  document.getElementById('finalizeClientInfo').textContent = ` ${r.clientName}${r.clientContact ? ' — ' + r.clientContact : ''}`;
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
  const r = reservations.find(x => String(x.id) === String(currentFinalizeResId));
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
  const r = reservations.find(x => String(x.id) === String(currentFinalizeResId));
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
  _addNotification({
    dossierId:     r.dossierId || '',
    numeroDossier: `RES-${String(r.id).padStart(3,'0')}`,
    etapeCode:     'PAYE',
    etapeLabel:    'Réservation finalisée',
    operateur:     currentUser?.label || 'Caissier',
    message:       `Réservation #${r.id} finalisée — ${r.clientName} — solde payé`
  });
  closeModal('finalizeModal');
  printTicket(sale);
  showToast(` Vente #${sale.id} enregistrée — Réservation #${r.id} finalisée !`);
  renderReservations();
  updateResBadge();
  _deleteTachesForDossier(r.dossierId);
}

// ============================================================
// RÉSERVATIONS — ANNULER
// ============================================================
function cancelReservation(id) {
  const r = reservations.find(x => String(x.id) === String(id));
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
  _addNotification({
    dossierId:     r.dossierId || '',
    numeroDossier: `RES-${String(r.id).padStart(3,'0')}`,
    etapeCode:     'ANNULE',
    etapeLabel:    'Réservation annulée',
    operateur:     currentUser?.label || 'Admin',
    message:       `Réservation #${r.id} annulée — ${r.clientName}`
  });
  showToast(`Réservation #${r.id} annulée — stock restitué`, 'info');
  syncReservationCompleteToSheets(r);
  // Supprimer les taches du dossier pour éviter contamination si l'ID est réutilisé
  _deleteTachesForDossier(r.dossierId);
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
    document.getElementById('tPayMethod').textContent    = ' Espèces remis';
    document.getElementById('tGiven').textContent        = fmt(sale.given);
    document.getElementById('tChangeRow').style.display = 'flex';
    document.getElementById('tChange').textContent       = fmt(sale.change);
  } else {
    document.getElementById('tPayMethod').textContent    = ` ${sale.provider}`;
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
    ${sale.deliveryMode === 'livraison'
      ? `<div class="row"><span>Mode</span><span>Livraison</span></div>
         <div class="row"><span>Adresse</span><span>${sale.deliveryAddress||''}</span></div>
         ${sale.deliveryFee > 0 ? `<div class="row"><span>Frais livraison</span><span>+${fmt(sale.deliveryFee)}</span></div>` : ''}
         ${sale.deliveryDate ? `<div class="row"><span>Date livraison</span><span>${new Date(sale.deliveryDate).toLocaleDateString('fr-FR')}</span></div>` : ''}`
      : `<div class="row"><span>Mode</span><span>Retrait boutique</span></div>`
    }
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
    <hr style="${st.sepSolid}"/>
    <div style="text-align:center;font-size:11pt;font-weight:bold;letter-spacing:.08em;font-family:${st.font};margin:4px 0">BON DE RESERVATION</div>
    <hr style="${st.sepSolid}"/>
    ${tc.ticketShowNum !== false ? `<div class="row"><span>Reservation N°</span><span>#${res.id}</span></div>` : ''}
    <div class="row"><span>Date</span><span>${dateStr}</span></div>
    ${tc.ticketShowCaissier !== false ? `<div class="row"><span>Caissier</span><span>${res.caissier||''}</span></div>` : ''}
    ${res.clientName    ? `<div class="row"><span>Client</span><span>${res.clientName}</span></div>` : ''}
    ${res.clientContact ? `<div class="row"><span>Contact</span><span>${res.clientContact}</span></div>` : ''}
    ${res.deliveryMode === 'livraison'
      ? `<div class="row"><span>Mode</span><span>Livraison</span></div>
         <div class="row"><span>Adresse</span><span>${res.deliveryAddress||''}</span></div>
         ${res.deliveryFee > 0 ? `<div class="row"><span>Frais livraison</span><span>+${fmt(res.deliveryFee)}</span></div>` : ''}
         ${res.deliveryDate ? `<div class="row"><span>Date livraison</span><span>${new Date(res.deliveryDate+'T00:00:00').toLocaleDateString('fr-FR')}</span></div>` : ''}`
      : `<div class="row"><span>Mode</span><span>Retrait boutique</span></div>`
    }
    <hr style="${st.sepLight}"/>
    <div class="items-section">
      ${(Array.isArray(res.items)?res.items:[]).map(i=>`<div class="row"><span>${i.name||'?'} <em style="color:#777">x${Number(i.qty)||1}</em></span><span>${((Number(i.price)||0)*(Number(i.qty)||1)).toLocaleString()} Ar</span></div>`).join('')}
    </div>
    <hr style="${st.sepLight}"/>
    ${tc.ticketShowSubtotal !== false ? `<div class="row"><span>Sous-total</span><span>${fmt(res.subtotal)}</span></div>` : ''}
    ${res.remise>0 ? `<div class="row"><span>Remise</span><span>-${fmt(res.remise)}</span></div>` : ''}
    <div style="background:${st.color}18;border:1px solid ${st.color};border-radius:4px;padding:4px 6px;margin:4px 0">
      <div class="row bold" style="color:${st.color}"><span>TOTAL A PAYER</span><span>${fmt(res.total)}</span></div>
    </div>
    <div style="border:1px solid #333;border-radius:4px;padding:5px 8px;margin:4px 0">
      <div class="row bold"><span>ACOMPTE VERSE</span><span>${fmt(res.accompte)}</span></div>
      <div class="row bold"><span>RESTE DU</span><span>${fmt(res.restant)}</span></div>
    </div>
    <hr style="${st.sepLight}"/>
    ${tc.ticketShowPayDetail !== false
      ? (res.depositMethod === 'cash'
        ? `<div class="row"><span>Especes remis</span><span>${fmt(res.depositGiven)}</span></div>
           <div class="row"><span>Monnaie rendue</span><span>${fmt(res.depositChange)}</span></div>`
        : `<div class="row"><span>Paiement mobile (${res.depositProvider})</span><span>${res.depositRef||''}</span></div>`)
      : ''}
    <hr style="${st.sepSolid}"/>
    <div class="footer">A recuperer sur presentation de ce bon</div>
    <div class="footer">${tc.footer||'Merci de votre confiance !'}</div>`;

  _openTicketWindow(html, 'Reservation #' + res.id);
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
    mode === 'stock' ? ' Scanner pour ajouter ou créer un article' : ' Scanner un article (caisse)';
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
      showToast(' Aucune caméra détectée', 'error');
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
    showToast(' Impossible d\'accéder à la caméra — utilisez la saisie manuelle', 'info');
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
      resultBox.textContent = ' ' + p.name;
      addToCart(p.id);
      showToast(' ' + p.name + ' ajouté au panier');
      closeScanner();
    } else {
      resultBox.textContent = ' Article introuvable : ' + code;
      resultBox.style.color = 'var(--red)';
      actionBtn.textContent = ' Créer cet article';
      actionBtn.style.display = 'block';
      actionBtn.style.background = 'var(--accent)';
      actionBtn.onclick = () => { closeScanner(); openProductModal(null, code); };
    }
  } else { // mode stock
    if (p) {
      resultBox.textContent = ' ' + p.name + ' — Stock : ' + p.stock;
      actionBtn.textContent = ' Ajuster le stock';
      actionBtn.style.display = 'block';
      actionBtn.style.background = 'var(--accent3)';
      actionBtn.onclick = () => { closeScanner(); openMouvement(p.id); };
    } else {
      resultBox.textContent = '🆕 Code inconnu : ' + code;
      resultBox.style.color = 'var(--yellow)';
      actionBtn.textContent = ' Créer cet article avec ce code';
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
    <td><span style="margin-right:6px">${p.emoji||''}</span>${escapeHtml(p.name)}</td>
    <td>${escapeHtml(p.cat)}</td>
    <td class="td-mono">${escapeHtml(p.code)}</td>
    <td class="td-mono">${fmt(p.price)}</td>
    <td class="td-mono">${fmt(p.cost)}</td>
    <td class="td-mono" style="font-weight:600">${p.stock}</td>
    <td><span class="badge ${badge}">${status}</span></td>
    <td>
      <button class="btn-icon btn-edit" onclick="editProduct(${p.id})" title="Modifier"></button>
      <button class="btn-icon btn-delete" onclick="deleteProduct(${p.id})" title="Supprimer"></button>
    </td>
  </tr>`).join('');
  if (cardsEl) cardsEl.innerHTML = rows.map(({p,badge,status,stockColor})=>`
    <div class="stock-card">
      <div class="stock-card-top">
        <div>
          <div class="stock-card-name">${p.emoji||''} ${escapeHtml(p.name)}</div>
          <div class="stock-card-cat">${escapeHtml(p.cat)} · ${escapeHtml(p.code)}</div>
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
        <button style="background:rgba(7,61,55,0.10);color:var(--accent)" onclick="editProduct(${p.id})"> Modifier</button>
        <button style="background:rgba(255,71,87,0.12);color:var(--red)" onclick="deleteProduct(${p.id})"> Supprimer</button>
      </div>
    </div>`).join('');
}
function openProductModal(id=null, prefillCode=null) {
  editingProductId = id;
  document.getElementById('productModalTitle').textContent = id ? ' Modifier l\'article' : ' Nouvel article';
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
  if (!file) return;
  // Prévisualisation locale immédiate
  const reader = new FileReader();
  reader.onload = async e => {
    const prev = document.getElementById('pImagePreview');
    prev.src = e.target.result; prev.style.display = 'block';
    document.getElementById('pImageClear').style.display = 'block';
    if (APPS_SCRIPT_URL) {
      // Upload vers Google Drive → URL accessible sur tous les postes
      const driveUrl = await uploadImageToDrive(file);
      if (driveUrl) {
        editingProductImage = driveUrl;
        prev.src = driveUrl;
        showToast(' Image sauvegardée sur Google Drive');
      } else {
        editingProductImage = e.target.result; // fallback base64 local
        showToast(' Upload Drive échoué — image visible sur ce poste uniquement', 'error');
      }
    } else {
      editingProductImage = e.target.result;
    }
  };
  reader.readAsDataURL(file);
}

async function uploadImageToDrive(file) {
  try {
    // Compression agressive 80x80 / qualité 0.4 pour tenir dans l'URL GET d'Apps Script
    const compressed = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const max = 80;
          let w = img.width, h = img.height;
          if (w > max || h > max) { const r = Math.min(max/w, max/h); w = Math.round(w*r); h = Math.round(h*r); }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.4));
        };
        img.onerror = reject;
        img.src = ev.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const [header, data] = compressed.split(',');
    const mimeType = header.match(/:(.*?);/)[1];
    showLoader('Upload vers Google Drive...');
    const r = await apiCall({ action: 'saveImage', imageData: data, mimeType, filename: file.name });
    hideLoader();
    if (r && r.ok && r.url) return r.url;
    console.warn('saveImage échec:', JSON.stringify(r));
  } catch (e) {
    console.warn('uploadImageToDrive:', e);
    hideLoader();
  }
  return null;
}
function clearProductImage() {
  editingProductImage = null;
  _resetImagePreview();
}
function editProduct(id) { openProductModal(id); }
function deleteProduct(id) {
  if(!confirm('Supprimer cet article ?')) return;
  products = products.filter(p=>p.id!==id);
  localStorage.removeItem(`pos-prod-img-${id}`);
  saveData();
  renderStockTable(); renderProducts();
  deleteProductFromScript(id);
  showToast('Article supprimé');
}
function saveProduct() {
  const name  = document.getElementById('pName').value.trim();
  const price = parseFloat(document.getElementById('pPrice').value) || 0;
  const stock = parseInt(document.getElementById('pStock').value) || 0;
  if (!name)      { showToast('Nom requis', 'error'); return; }
  if (name.length > 200) { showToast('Nom trop long (max 200 caractères)', 'error'); return; }
  if (price < 0)  { showToast('Le prix ne peut pas être négatif', 'error'); return; }
  if (stock < 0)  { showToast('Le stock ne peut pas être négatif', 'error'); return; }
  const data = {
    name, cat:document.getElementById('pCat').value,
    emoji:document.getElementById('pEmoji').value||'',
    code:document.getElementById('pCode').value.trim()||String(nextId),
    price, cost:parseFloat(document.getElementById('pCost').value)||0,
    stock, minStock:parseInt(document.getElementById('pMinStock').value)||5,
    image:editingProductImage||null
  };
  if(editingProductId) {
    Object.assign(products.find(p=>p.id===editingProductId), data);
    showToast('Article mis à jour ');
  } else {
    products.push({ id:nextId++, ...data });
    showToast('Article ajouté ');
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
  const emoji = document.getElementById('qaEmoji').value || '';
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
  showToast(`${emoji} ${name} ajouté au panier `);
}

// ============================================================
// MOUVEMENT
// ============================================================
function openMouvement(productId=null) {
  const sel = document.getElementById('mouvProduct');
  sel.innerHTML = products.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} (stock: ${p.stock})</option>`).join('');
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
  showToast(`${type==='in'?' Entrée':' Sortie'} : ${qty} x ${p.name}`);
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
    day:   ' Ventes du jour — ' + new Date().toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', year:'numeric'}),
    month: ' Ventes du mois — ' + new Date().toLocaleDateString('fr-FR', {month:'long', year:'numeric'}),
    stock: ' Détail du stock',
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
    ? `<div style="font-size:11px;color:var(--muted)"> ${s.clientName}${s.clientContact ? ' · ' + s.clientContact : ''}</div>`
    : '';
  return `<tr>
    <td><div>${dateStr}</div>${client}</td>
    <td style="font-size:12px;max-width:200px">${items}</td>
    <td style="white-space:nowrap">${s.method==='cash'?' Espèces':' '+(s.provider||'Mobile')}</td>
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
    ${_kpi(' Espèces',     fmt(cash),         'var(--text)',   'var(--surface2)')}
    ${_kpi(' Mobile',      fmt(mob),          'var(--text)',   'var(--surface2)')}
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
    ${_kpi(' Espèces',     fmt(cash),          'var(--text)',   'var(--surface2)')}
    ${_kpi(' Mobile',      fmt(mob),           'var(--text)',   'var(--surface2)')}
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
      ? `<span class="badge badge-out"> Épuisé</span>`
      : p.stock <= p.minStock
        ? `<span class="badge badge-low"> Faible</span>`
        : `<span class="badge badge-ok"> OK</span>`;
    const stockColor = p.stock<=0?'var(--red)':p.stock<=p.minStock?'var(--yellow)':'var(--green)';
    return `<tr>
      <td><div style="font-weight:600">${p.emoji||''} ${p.name}</div><div style="font-size:11px;color:var(--muted)">${p.cat||''} · ${p.code||''}</div></td>
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
    return '<div style="text-align:center;color:var(--green);padding:24px;font-weight:600"> Aucune créance en cours.</div>';
  const total = list.reduce((s,v) => s + (Number(v.due)||0), 0);
  const rows  = list.map(s => {
    const d      = parseSaleDate(s.date);
    const dateStr = d ? d.toLocaleString('fr-FR') : '—';
    const items  = (s.items||[]).map(i => `${i.name||'?'} ×${i.qty||1}`).join(', ');
    const client = s.clientName
      ? `<div style="font-size:11px;color:var(--muted)"> ${s.clientName}${s.clientContact?' · '+s.clientContact:''}</div>` : '';
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
    showToast(' Erreur de chargement — données locales affichées', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = ' Actualiser depuis Sheets'; }
    renderStats();   // toujours afficher, même en cas d'erreur réseau
  }
}

// Bouton manuel — ignore le cooldown
async function manualRefreshStats() {
  if (!APPS_SCRIPT_URL) {
    showToast(' URL Apps Script non configurée', 'error');
    return;
  }
  _lastStatsRefresh = 0;
  await _autoRefreshStats();
  if (sales.length > 0) showToast(` ${sales.length} vente(s) chargée(s)`);
}

// ============================================================
// STATS
// ── Export CSV des ventes ───────────────────────────────────
function exportVentesCSV() {
  if (!sales || sales.length === 0) { showToast('Aucune vente à exporter', 'error'); return; }
  const BOM   = '﻿'; // UTF-8 BOM pour Excel
  const lines = ['Date,Heure,Client,Article,Qté,Prix unitaire,Total vente,Mode,Référence,Caissier'];
  sales.forEach(s => {
    (s.items || []).forEach(item => {
      lines.push([
        s.date        || '',
        s.time        || '',
        '"' + (s.clientName || '').replace(/"/g, '""') + '"',
        '"' + (item.name    || '').replace(/"/g, '""') + '"',
        item.qty      || 1,
        item.price    || 0,
        s.total       || 0,
        s.method === 'cash' ? 'Espèces' : 'Mobile Money',
        '"' + (s.ref || s.provider || '').replace(/"/g, '""') + '"',
        '"' + (s.caissier || '').replace(/"/g, '""') + '"'
      ].join(','));
    });
  });
  const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'ventes_' + new Date().toISOString().split('T')[0] + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(` Export CSV : ${sales.length} vente(s)`);
}

function exportStockCSV() {
  if (!products || products.length === 0) { showToast('Aucun produit à exporter', 'error'); return; }
  const BOM   = '﻿';
  const lines = ['ID,Nom,Catégorie,Code,Prix vente,Prix achat,Stock actuel,Stock min'];
  products.forEach(p => {
    lines.push([
      p.id, '"' + (p.name||'').replace(/"/g,'""') + '"',
      '"' + (p.cat||'').replace(/"/g,'""') + '"',
      p.code||'', p.price||0, p.cost||0, p.stock||0, p.minStock||0
    ].join(','));
  });
  const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'stock_' + new Date().toISOString().split('T')[0] + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(` Export CSV : ${products.length} produit(s)`);
}

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
          <span style="font-weight:700"> ${r.clientName}</span>
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
        <button onclick="manualRefreshStats()" style="padding:8px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;color:var(--muted);cursor:pointer;font-size:13px"> Recharger depuis Sheets</button>
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
          ? `<button class="btn-icon" onclick="openEditSaleModal(${s.id})" title="Modifier" style="margin-left:4px"></button>
             <button class="btn-icon" onclick="openDeleteSaleModal(${s.id})" title="Supprimer" style="margin-left:2px;color:var(--red)"></button>`
          : '';
        return `<tr>
          <td>${dateStr}</td>
          <td>${items.map(i=>`${i.name||'?'} x${i.qty||1}`).join(', ')}</td>
          <td>${s.method==='cash'?' Espèces':` ${s.provider||'Mobile'}`}</td>
          <td class="td-mono" style="font-weight:600;color:var(--accent)">${fmt(total)}</td>
          ${dueCell}
          <td><button class="btn-icon" onclick="reprintTicket(${s.id})" title="Réimprimer"></button></td>
          <td style="white-space:nowrap">${adminActions}</td>
        </tr>`;
      }).join('');
    }
  }

  // Bouton Export CSV ventes (affiché uniquement s'il y a des ventes)
  const exportWrap = document.getElementById('statsExportWrap');
  if (exportWrap) {
    exportWrap.style.display = sales.length > 0 ? 'flex' : 'none';
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
  html += `<div class="section-title"> Résumé</div>
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-label">Chiffre d'affaires</div><div class="kpi-val" style="color:#007a45">${fmt(ca)}</div></div>
    <div class="kpi"><div class="kpi-label">Transactions</div><div class="kpi-val" style="color:#1a6ec7">${list.length}</div></div>
    <div class="kpi"><div class="kpi-label"> Espèces</div><div class="kpi-val">${fmt(cash)}</div></div>
    <div class="kpi"><div class="kpi-label"> Mobile Money</div><div class="kpi-val">${fmt(mob)}</div></div>
    ${due > 0 ? `<div class="kpi"><div class="kpi-label">Reste à percevoir</div><div class="kpi-val" style="color:#c00">${fmt(due)}</div></div>` : ''}
  </div>`;

  // --- ARTICLES ---
  if (articles.length > 0) {
    html += `<div class="section-title"> Détail par article</div>
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
    html += `<div class="section-title"> Détail des ventes (${list.length})</div>
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
        ? ` Espèces${s.given>0 ? `<br><small>Reçu: ${fmt(s.given)} · Rendu: ${fmt(s.change)}</small>` : ''}`
        : ` ${s.provider||'Mobile'}${s.ref ? `<br><small>Réf: ${s.ref}</small>` : ''}`;
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
    html += `<div class="section-title"> Détail des ventes</div><p style="color:#888;text-align:center">Aucune vente sur cette période.</p>`;
  }

  // --- RÉSERVATIONS EN ATTENTE ---
  if (pendingRes.length > 0) {
    html += `<div class="section-title"> Réservations en attente (${pendingRes.length})</div>
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
        ? ' Espèces'
        : ` ${r.depositProvider||'Mobile'}${r.depositRef?`<br><small>Réf: ${r.depositRef}</small>`:''}`;
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
  if (!from || !to) { showToast(' Veuillez sélectionner une date de début et de fin.', 'error'); return; }
  if (from > to)    { showToast(' La date de début doit être avant la date de fin.', 'error'); return; }
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
  const rankEmoji = i => i === 0 ? '' : i === 1 ? '' : i === 2 ? '' : String(i + 1);

  const rows = articles.map((a, i) => {
    const qty   = Number(a.qty)   || 0;
    const price = Number(a.price) || 0;
    const total = Number(a.total) || 0;
    const pct   = Math.round(total / maxTotal * 100);
    const share = grandTotal > 0 ? Math.round(total / grandTotal * 100) : 0;
    return `<tr>
      <td><span class="bs-rank ${rankClass(i)}">${rankEmoji(i)}</span></td>
      <td>
        <div style="font-weight:600;color:var(--text)">${escapeHtml(a.name || '?')}</div>
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
    container.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:16px;text-align:center"> Erreur: ${e.message}</div>`;
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
    showToast(' Réservé aux administrateurs');
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
  showToast(' Vente #' + _editingSaleId + ' modifiée localement');
  _editingSaleId = null;
}

function openDeleteSaleModal(id) {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast(' Réservé aux administrateurs');
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
  showToast(' Vente #' + deletedId + ' supprimée localement');
}

// ============================================================
// PWA — Service Worker + Install + Offline
// ============================================================
let deferredPrompt = null;
let swRegistration = null;

async function forceAppUpdate() {
  showLoader('Mise à jour en cours...');
  try {
    // Vider tous les caches SW
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    // Désenregistrer le service worker
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch(e) { console.warn('forceUpdate error:', e); }
  // Recharger avec cache brisé
  window.location.reload(true);
}

function showUpdateBanner() {
  let banner = document.getElementById('swUpdateBanner');
  if (banner) return;

  let countdown = 8;
  banner = document.createElement('div');
  banner.id = 'swUpdateBanner';

  const _refresh = () => {
    const msgSpan = banner.querySelector('#swBannerMsg');
    if (msgSpan) msgSpan.textContent = `Mise à jour disponible — rechargement dans ${countdown}s`;
  };

  banner.innerHTML = `
    <span id="swBannerMsg" style="flex:1;font-size:13px;font-weight:500">
      Mise à jour disponible — rechargement dans ${countdown}s
    </span>
    <button onclick="forceAppUpdate()"
      style="background:#fff;color:#1a4a3a;border:none;border-radius:8px;
             padding:6px 14px;font-size:13px;font-weight:700;cursor:pointer;flex-shrink:0">
      Maintenant
    </button>
    <button onclick="clearInterval(window._swBannerTimer);this.closest('#swUpdateBanner').remove()"
      style="background:none;border:none;color:rgba(255,255,255,0.7);font-size:18px;
             cursor:pointer;padding:0 4px;flex-shrink:0" title="Plus tard">×</button>`;

  Object.assign(banner.style, {
    position:'fixed', bottom:'80px', left:'50%', transform:'translateX(-50%)',
    background:'#1a4a3a', color:'#fff', borderRadius:'14px', padding:'10px 14px',
    display:'flex', alignItems:'center', gap:'10px', zIndex:'9999',
    boxShadow:'0 4px 20px rgba(0,0,0,0.25)', maxWidth:'380px', width:'calc(100% - 32px)'
  });
  document.body.appendChild(banner);

  // Compte à rebours — auto-reload uniquement si panier vide
  window._swBannerTimer = setInterval(() => {
    if (cart && cart.length > 0) {
      // Panier en cours : stopper le décompte, informer l'utilisateur
      clearInterval(window._swBannerTimer);
      const msgSpan = banner.querySelector('#swBannerMsg');
      if (msgSpan) msgSpan.textContent = 'Mise à jour prête — actualisez après votre vente';
      return;
    }
    countdown--;
    if (countdown <= 0) {
      clearInterval(window._swBannerTimer);
      forceAppUpdate();
    } else {
      _refresh();
    }
  }, 1000);
}

// ── Vider le cache automatiquement si la version a changé ──
async function _autoClearCache() {
  const stored = localStorage.getItem('pos-app-version');
  if (stored === APP_VERSION) return; // Même version → rien à faire

  console.log(`[Cache] v${stored || '?'} → v${APP_VERSION} — Nettoyage automatique`);

  //  Sauvegarder les données critiques AVANT tout nettoyage
  const _savedConfig     = localStorage.getItem('pos-config');
  const _savedConfigBak  = localStorage.getItem('pos-config-backup');
  const _savedCategories = localStorage.getItem('pos-categories');
  const _savedUsers      = localStorage.getItem('pos-users');

  try {
    // 1. Vider les caches SW via message
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
    }
    // 2. Vider directement depuis la page (double sécurité)
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    // 3. Désenregistrer l'ancien SW pour forcer une réinstallation propre
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch(e) { console.warn('[Cache] Erreur nettoyage:', e); }

  //  Restaurer les données critiques après nettoyage (au cas où le navigateur les aurait effacées)
  try {
    if (_savedConfig)     localStorage.setItem('pos-config', _savedConfig);
    if (_savedConfigBak)  localStorage.setItem('pos-config-backup', _savedConfigBak);
    if (_savedCategories) localStorage.setItem('pos-categories', _savedCategories);
    if (_savedUsers)      localStorage.setItem('pos-users', _savedUsers);
  } catch(e) {}

  // Mémoriser la nouvelle version
  localStorage.setItem('pos-app-version', APP_VERSION);

  // Recharger seulement si ce n'est pas la toute première installation
  if (stored) {
    showToast(' Nouvelle version — cache vidé, rechargement...', 'info');
    setTimeout(() => window.location.reload(true), 1800);
  }
}

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
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Nouveau SW prêt : ne pas activer si une transaction est en cours
            if (cart && cart.length > 0) {
              // Panier non vide — signaler sans forcer
              showUpdateBanner();
              window._pendingSWWorker = newWorker;
            } else {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          } else if (newWorker.state === 'installed') {
            // Premier install
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(err => console.log('[PWA] SW error:', err));

    // Quand le nouveau SW prend le contrôle → afficher la bannière
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      showUpdateBanner();
    });

    // Message du SW (SW_UPDATED envoyé depuis activate)
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'SW_UPDATED') showUpdateBanner();
      if (event.data?.type === 'SYNC_REQUIRED') syncPendingSales?.();
    });
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
    showToast(' Application installée avec succès !');
    deferredPrompt = null;
  });

  // Online/Offline
  window.addEventListener('offline', () => document.getElementById('offlineBadge').classList.add('show'));
  window.addEventListener('online', () => {
    document.getElementById('offlineBadge').classList.remove('show');
    showToast(' Connexion rétablie — synchronisation...');
    syncPendingOfflineSales();
  });
  if (!navigator.onLine) document.getElementById('offlineBadge').classList.add('show');
}

function installPWA() {
  if (!deferredPrompt) {
    showToast(' Pour iOS: Safari → Partager → Sur l\'écran d\'accueil', 'info');
    return;
  }
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(choice => {
    if (choice.outcome === 'accepted') showToast(' Installation en cours...');
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
    // Images stockées séparément (trop lourdes pour pos-products, effacées par le sync Sheet)
    const productsWithoutImages = products.map(({ image, ...rest }) => rest);
    localStorage.setItem('pos-products', JSON.stringify(productsWithoutImages));
    products.forEach(p => {
      if (p.image) {
        try { localStorage.setItem(`pos-prod-img-${p.id}`, p.image); }
        catch(e) { console.warn('Image produit trop lourde:', p.name); }
      }
    });
    // Recalibration anti-collision (multi-onglets ou rechargement rapide)
    if (sales.length > 0) {
      const maxSaleId = Math.max(...sales.map(s => Number(s.id) || 0));
      if (maxSaleId >= nextSaleId) nextSaleId = maxSaleId + 1;
    }
    if (commandes.length > 0) {
      const maxCmdId = Math.max(...commandes.map(c => Number(c.id) || 0));
      if (maxCmdId >= nextCommandeId) nextCommandeId = maxCmdId + 1;
    }
    if (reservations.length > 0) {
      const maxResId = Math.max(...reservations.map(r => Number(r.id) || 0));
      if (maxResId >= nextReservationId) nextReservationId = maxResId + 1;
    }
    safeLocalSet('pos-heldCarts', JSON.stringify(heldCarts));
    safeLocalSet('pos-sales', JSON.stringify(sales));
    localStorage.setItem('pos-nextId', String(nextId));
    localStorage.setItem('pos-nextSaleId', String(nextSaleId));
    safeLocalSet('pos-reservations', JSON.stringify(reservations));
    localStorage.setItem('pos-nextResId', String(nextReservationId));
    // Photos séparées pour éviter de dépasser la limite localStorage
    const cmdWithoutPhotos = commandes.map(c => ({ ...c, photos: [] }));
    safeLocalSet('pos-commandes', JSON.stringify(cmdWithoutPhotos));
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
    if (p) {
      products = JSON.parse(p);
      // Réattacher les images stockées séparément
      products.forEach(prod => {
        const img = localStorage.getItem(`pos-prod-img-${prod.id}`);
        if (img) prod.image = img;
      });
    }
    const hc = localStorage.getItem('pos-heldCarts');
    if (hc) heldCarts = JSON.parse(hc);
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

    // Recalibration depuis les données réelles pour éviter les doublons
    if (sales.length > 0) {
      const maxSaleId = Math.max(...sales.map(s => Number(s.id) || 0));
      if (maxSaleId >= nextSaleId) nextSaleId = maxSaleId + 1;
    }
    if (commandes.length > 0) {
      const maxCmdId = Math.max(...commandes.map(c => Number(c.id) || 0));
      if (maxCmdId >= nextCommandeId) nextCommandeId = maxCmdId + 1;
    }
    if (reservations.length > 0) {
      const maxResId = Math.max(...reservations.map(r => Number(r.id) || 0));
      if (maxResId >= nextReservationId) nextReservationId = maxResId + 1;
    }
  } catch(e) { console.warn('loadData error:', e); }
}

function saveUsers() {
  safeLocalSet('pos-users', JSON.stringify(localUsers));
}

function loadUsers() {
  try {
    const u = localStorage.getItem('pos-users');
    if (u) {
      const defaults = localUsers; // valeurs initiales avec pass avant écrasement
      const stored   = JSON.parse(u);
      // Restaurer le pass depuis les défauts si le stockage l'a perdu
      localUsers = stored.map(su => {
        const def = defaults.find(d => d.username === su.username);
        const patched = { ...su };
        const badLabel = !patched.label || patched.label === 'undefined';
        if (badLabel) patched.label = def?.label || su.username;
        if (!patched.pass && def?.pass) patched.pass = def.pass;
        return patched;
      });
    }
  } catch(e) {}
}

// ============================================================
// PERMISSIONS PAR RÔLE
// ============================================================
function applyRolePermissions(role) {
  // Système data-roles : affiche/masque selon le rôle
  document.querySelectorAll('[data-roles]').forEach(el => {
    const allowed = el.dataset.roles.split(',');
    el.style.display = allowed.includes(role) ? '' : 'none';
  });
  // Compatibilité legacy admin-only
  const isAdmin = role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    if (!el.hasAttribute('data-roles')) el.style.display = isAdmin ? '' : 'none';
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
    const roleLabel = ROLE_LABELS[u.role] || u.role;
    const roleIcon  = ROLE_ICONS[u.role]  || '';
    const isMe = currentUser && u.username === currentUser.username;
    const isLastAdmin = u.role === 'admin' && localUsers.filter(x => x.role === 'admin' && x.actif !== false).length === 1;
    return `
    <div class="user-card">
      <div class="user-card-top">
        <div class="user-avatar role-${u.role}">${roleIcon}</div>
        <div class="user-card-info">
          <div class="user-card-name">${u.label || u.username}${isMe ? ' <span style="font-size:11px;color:var(--accent)">(vous)</span>' : ''}</div>
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
        <button class="btn-edit-user" onclick="openUserModal(${idx})"> Modifier</button>
        ${!isMe && !isLastAdmin
          ? `<button class="btn-del-user" onclick="deleteUser(${idx})"> Supprimer</button>`
          : `<button class="btn-toggle-user" onclick="toggleUserActive(${idx})" ${isMe?'disabled':''}>
               ${u.actif!==false?'⏸ Désactiver':'▶ Activer'}</button>`}
      </div>
    </div>`;
  }).join('');
}

function openUserModal(idx=null) {
  editingUserId = idx;
  const isNew = idx === null;
  document.getElementById('userModalTitle').textContent = isNew ? ' Nouvel utilisateur' : ' Modifier l\'utilisateur';
  document.getElementById('uPassLabel').textContent = isNew ? 'Mot de passe' : 'Nouveau mot de passe (laisser vide = inchangé)';
  document.getElementById('uPass').placeholder = isNew ? '••••••' : '(inchangé)';
  document.getElementById('uPass').type = 'password';
  document.getElementById('passVisBtn').textContent = '';
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
  btn.textContent = inp.type === 'password' ? '' : '';
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
    showToast(` Utilisateur ${label} créé`);
  } else {
    const u = localUsers[editingUserId];
    u.label = label;
    u.role  = role;
    u.actif = actif;
    if (passHashed) u.pass = passHashed;
    showToast(` ${label} mis à jour`);
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
  showToast(u.actif ? ` ${u.label} activé` : `⏸ ${u.label} désactivé`);
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
  showToast(` Synchronisation de ${pending.length} vente(s) en attente...`, 'info');
  const succeeded = [];
  const failed    = [];
  const MAX_RETRIES = 3;

  for (const sale of pending) {
    sale.caissier = sale.caissier || (currentUser ? currentUser.username : 'caissier');
    let attempt = 0;
    let ok = false;
    while (attempt < MAX_RETRIES && !ok) {
      try {
        const r = await apiCall({ action: 'addSale', sale });
        if (r && r.ok) { ok = true; }
        else if (attempt < MAX_RETRIES - 1) {
          await new Promise(res => setTimeout(res, Math.pow(2, attempt) * 1000)); // 1s, 2s, 4s
        }
      } catch(e) {
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(res => setTimeout(res, Math.pow(2, attempt) * 1000));
        }
      }
      attempt++;
    }
    if (ok) succeeded.push(sale); else failed.push(sale);
  }

  if (failed.length > 0) {
    safeLocalSet('pos-pending-sales', JSON.stringify(failed));
    showToast(` ${succeeded.length} sync. — ${failed.length} encore en attente`, 'error');
    if (failed.length >= 5) console.error('Ventes non synchronisées après', MAX_RETRIES, 'tentatives :', failed);
  } else {
    localStorage.removeItem('pos-pending-sales');
    showToast(` ${succeeded.length} vente(s) synchronisée(s) dans Google Sheets`);
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
let APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx94vamSaYqKyD3CNbdvy3Ue7wl4DJkANdRWBmkt483NKzp1Wk1aEkTazS_Dtc8YekIug/exec';
localStorage.setItem('pos-script-url', APPS_SCRIPT_URL);
let syncEnabled = !!APPS_SCRIPT_URL;

// ============================================================
// AIRTABLE — COMMANDES
// ============================================================
let AIRTABLE_API_KEY  = localStorage.getItem('pos-airtable-key')  || '';
let AIRTABLE_BASE_ID  = localStorage.getItem('pos-airtable-base') || '';
const AIRTABLE_TABLE  = 'Commandes';

async function _airtableCall(method, recordId, fields) {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) return null;
  const base = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`;
  const url  = recordId ? `${base}/${recordId}` : base;
  const body = recordId
    ? JSON.stringify({ fields })
    : JSON.stringify({ records: [{ fields }] });
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body
    });
    if (!res.ok) { console.warn('Airtable HTTP', res.status, await res.text()); return null; }
    return await res.json();
  } catch(e) { console.warn('Airtable error:', e.message); return null; }
}

function _cmdToAirtableFields(cmd) {
  const articles = (cmd.items || [])
    .map(i => `${i.qty}x ${i.name}${i.custom ? ' (libre)' : ''} — ${fmt(i.price)}`)
    .join('\n');
  const nbPhotos = (cmd.photos || []).length;
  return {
    'Nom':            cmd.clientName       || '',
    'Date livraison': cmd.dateLivraison    || '',
    'Articles':       articles             || '',
    'Notes':          cmd.notes            || '',
    'Statut':         cmd.status === 'completed' ? 'termine'
                    : cmd.status === 'cancelled'  ? 'annule'
                    : 'en attente',
    'Photos':         nbPhotos > 0 ? `${nbPhotos} photo(s) — voir app POS` : ''
  };
}

async function syncCommandeToAirtable(cmd) {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) return;
  const res = await _airtableCall('POST', null, _cmdToAirtableFields(cmd));
  if (res?.records?.[0]?.id) {
    cmd.airtableId = res.records[0].id;
    saveData();
  } else {
    console.warn('Airtable sync commande échouée');
  }
}

async function syncCmdUpdateToAirtable(cmd) {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !cmd.airtableId) return;
  await _airtableCall('PATCH', cmd.airtableId, {
    'Statut': cmd.status === 'completed' ? 'termine'
            : cmd.status === 'cancelled'  ? 'annule'
            : 'en attente'
  });
}

function openAirtableSettings() {
  showPage('config', null, null);
  setTimeout(() => {
    const section = document.getElementById('airtableConfigSection');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      section.style.outline = '2px solid var(--accent2)';
      section.style.borderRadius = '14px';
      setTimeout(() => { section.style.outline = ''; }, 1800);
    }
  }, 120);
}

function saveAirtableConfig() {
  const key  = (document.getElementById('cfgAirtableKey')?.value  || '').trim();
  const base = (document.getElementById('cfgAirtableBase')?.value || '').trim();
  AIRTABLE_API_KEY = key;
  AIRTABLE_BASE_ID = base;
  localStorage.setItem('pos-airtable-key',  key);
  localStorage.setItem('pos-airtable-base', base);
  _updateAirtableBtn();
}

function _updateAirtableBtn() {
  const btn = document.getElementById('btnAirtable');
  if (!btn) return;
  const connected = !!(AIRTABLE_API_KEY && AIRTABLE_BASE_ID);
  btn.style.borderColor = connected ? 'rgba(26,74,58,0.4)'    : 'rgba(232,131,74,0.4)';
  btn.style.color       = connected ? 'var(--accent)'          : 'var(--accent2)';
  btn.title             = connected ? 'Airtable connecté '   : 'Configurer Airtable';
}

function _loadAirtableConfigFields() {
  const k = document.getElementById('cfgAirtableKey');
  const b = document.getElementById('cfgAirtableBase');
  if (k) k.value = AIRTABLE_API_KEY;
  if (b) b.value = AIRTABLE_BASE_ID;
  const status = document.getElementById('airtableStatus');
  if (status) status.textContent = (AIRTABLE_API_KEY && AIRTABLE_BASE_ID) ? ' Configuré' : 'Non configuré';
}

async function testAirtableConnection() {
  const statusEl = document.getElementById('airtableStatus');
  if (statusEl) statusEl.textContent = '⏳ Test en cours...';
  showLoader('Test Airtable...');
  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}?maxRecords=1`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` } });
    hideLoader();
    if (res.ok) {
      showToast(' Airtable connecté !');
      if (statusEl) statusEl.textContent = ' Connexion OK';
      _updateAirtableBtn();
    } else {
      const err = await res.json();
      const msg = err?.error?.message || 'Erreur ' + res.status;
      showToast(' Airtable : ' + msg, 'error');
      if (statusEl) statusEl.textContent = ' ' + msg;
    }
  } catch(e) {
    hideLoader();
    showToast(' Airtable inaccessible : ' + e.message, 'error');
    if (statusEl) statusEl.textContent = ' ' + e.message;
  }
}

// ── Requête générique ─────────────────────────────────────
// Lectures : GET ?action=xxx  (réponse JSON lisible)
// Écritures : GET ?payload=JSON  (Apps Script lit e.parameter.payload)
async function apiCall(payload) {
  if (!APPS_SCRIPT_URL) return null;

  // ── LECTURES & LOGIN : requête GET avec params individuels ─
  const getActions = ['getProducts', 'getSales', 'ping', 'initSheets', 'login', 'getUsers', 'getReservations', 'getCommandes', 'getDossiers', 'getOperateurs', 'getTaches', 'getDashboard', 'getComments', 'getNotifs', 'getShopConfig', 'getRythme'];
  if (getActions.includes(payload.action)) {
    try {
      let url = APPS_SCRIPT_URL + '?action=' + payload.action;
      if (payload.limit)     url += '&limit='     + encodeURIComponent(payload.limit);
      if (payload.username)  url += '&username='  + encodeURIComponent(payload.username);
      if (payload.password)  url += '&password='  + encodeURIComponent(payload.password);
      if (payload.statut)    url += '&statut='    + encodeURIComponent(payload.statut);
      if (payload.dossierId) url += '&dossierId=' + encodeURIComponent(payload.dossierId);
      if (payload.operateur) url += '&operateur=' + encodeURIComponent(payload.operateur);
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
    // Restaurer les images : priorité à l'URL Drive (stockée dans le Sheet),
    // sinon fallback sur l'image locale (base64 localStorage)
    products = r.products.map(p => {
      if (p.image) return p; // URL Drive déjà dans le Sheet
      const img = localStorage.getItem(`pos-prod-img-${p.id}`);
      return img ? { ...p, image: img } : p;
    });
    nextId = Math.max(...products.map(p => p.id)) + 1;
    saveData();
    showToast(' ' + products.length + ' articles chargés depuis Google Sheets');
    return true;
  }
  return false;
}

// ── Sauvegarder un produit vers Sheet ───────────────────
async function saveProductToScript(product) {
  if (!APPS_SCRIPT_URL) return;
  // Ne jamais envoyer le base64 via GET (URL trop longue → Failed to fetch)
  // Seules les URLs Drive (https://...) sont synchronisées dans le Sheet
  const payload = { ...product };
  if (payload.image && payload.image.startsWith('data:')) payload.image = '';
  const r = await apiCall({ action: 'saveProduct', product: payload });
  if (r && r.ok && r.id && !product.id) {
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
    showToast(' Hors ligne — vente mise en file d\'attente', 'info');
    return;
  }
  sale.caissier = currentUser ? currentUser.username : 'caissier';
  const r = await apiCall({ action: 'addSale', sale });
  if (r && r.ok) {
    showToast(' Vente enregistrée dans Google Sheets ');
  } else {
    const errMsg = r ? (r.error || 'Erreur inconnue') : 'Connexion impossible';
    console.error('Sync vente échouée:', errMsg);
    savePendingSale(sale);
    updatePendingBadge();
    showToast(' Google Sheets inaccessible — vente mise en file. ' + errMsg, 'error');
  }
}

// ── Envoyer une réservation vers Sheet ───────────────────
async function syncReservationToSheets(res) {
  if (!APPS_SCRIPT_URL) return;
  // Envoyer uniquement les champs nécessaires — exclure base64 et champs inutiles pour GAS
  const payload = {
    id:              res.id,
    date:            res.date,
    caissier:        currentUser ? currentUser.username : (res.caissier || 'caissier'),
    clientName:      res.clientName,
    clientContact:   res.clientContact,
    items:           res.items,
    subtotal:        res.subtotal,
    remise:          res.remise,
    total:           res.total,
    accompte:        res.accompte,
    restant:         res.restant,
    depositMethod:   res.depositMethod,
    depositProvider: res.depositProvider,
    depositRef:      res.depositRef,
    deliveryMode:    res.deliveryMode,
    deliveryAddress: res.deliveryAddress,
    deliveryFee:     res.deliveryFee,
    deliveryDate:    res.deliveryDate,
    clientType:      res.clientType,
    clientCompany:   res.clientCompany,
    // Métadonnées pièces jointes (fileId/URL Drive uniquement, jamais le base64)
    attachments:     (res.attachments || []).map(a => ({
      name: a.name || '', type: a.type || '',
      fileId: a.fileId || '', viewUrl: a.viewUrl || '', dlUrl: a.dlUrl || ''
    })).filter(a => a.fileId || a.viewUrl),
  };
  const r = await apiCall({ action: 'addReservation', reservation: payload });
  if (!r || !r.ok) {
    console.warn('Sync réservation échouée:', r?.error || 'Connexion impossible');
    showToast('Réservation enregistrée localement — sync GAS échouée', 'warning');
  }
}

// ── Mettre à jour le statut d'une réservation dans Sheet ─
async function syncReservationCompleteToSheets(res) {
  if (!APPS_SCRIPT_URL) return;
  await apiCall({ action: 'updateReservation', id: res.id, status: res.status, dateFinalisation: res.dateFinalisation || '', saleId: res.saleId || '' });
}

// Met à jour uniquement la colonne Attachments_JSON dans le Sheet
async function syncReservationAttachmentsToGAS(res) {
  if (!APPS_SCRIPT_URL) return;
  const meta = (res.attachments || [])
    .map(a => ({ name:a.name||'', type:a.type||'', fileId:a.fileId||'', viewUrl:a.viewUrl||'', dlUrl:a.dlUrl||'' }))
    .filter(a => a.fileId || a.viewUrl);
  if (!meta.length) return;
  await apiCall({ action: 'updateReservationAttachments', id: res.id, attachments: meta });
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
  }
  saveData();
}

// ── Charger les utilisateurs depuis Sheet ────────────────
async function syncAllUsersToSheet() {
  if (!APPS_SCRIPT_URL) return;
  showLoader('Synchronisation des utilisateurs...');
  let ok = 0;
  for (const u of localUsers) {
    try { await apiCall({ action: 'saveUser', user: u }); ok++; } catch(e) {}
  }
  hideLoader();
  showToast(`${ok} utilisateur(s) synchronisé(s) vers le Sheet`);
}

async function loadUsersFromScript() {
  if (!APPS_SCRIPT_URL) return;
  const r = await apiCall({ action: 'getUsers' });
  // Sheet vide → pousser tous les utilisateurs locaux pour initialiser le Sheet
  if (r && r.ok && Array.isArray(r.users) && r.users.length === 0) {
    await syncAllUsersToSheet();
    return;
  }
  if (r && r.ok && Array.isArray(r.users) && r.users.length > 0) {
    // Fusionner : le Sheet fait autorité pour rôle/label/actif,
    // mais on conserve le hash du mot de passe stocké localement
    // (le Sheet ne renvoie jamais les mots de passe en clair)
    const sheetUsernames = new Set(r.users.map(u => u.username.toLowerCase()));
    const localOnly = localUsers.filter(u => !sheetUsernames.has(u.username.toLowerCase()));
    localUsers = [
      ...r.users.map(su => {
        const local = localUsers.find(lu => lu.username.toLowerCase() === su.username.toLowerCase());
        const patched = { ...su };
        if (!patched.pass  && local?.pass)  patched.pass  = local.pass;
        const badLabel = !patched.label || patched.label === 'undefined';
        const goodLocal = local?.label && local.label !== 'undefined';
        if (badLabel) patched.label = goodLocal ? local.label : su.username;
        return patched;
      }),
      ...localOnly
    ];
    saveUsers();
  }
}

// ── Charger les réservations depuis Sheet ────────────────
async function loadReservationsFromScript() {
  if (!APPS_SCRIPT_URL) return;
  showLoader('Chargement des réservations...');
  const r = await apiCall({ action: 'getReservations' });
  hideLoader();
  if (!r || !r.ok || !Array.isArray(r.reservations)) { saveData(); return; }

  // Sheet vide (effacé volontairement) → le Sheet fait autorité, vider le local
  if (r.reservations.length === 0) {
    reservations = [];
    nextReservationId = 1;
    saveData();
    return;
  }

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
  // ET réinjecter les pièces jointes locales (GAS ne les stocke pas dans la feuille)
  const sheetIds  = new Set(deduped.map(res => String(res.id)));
  const localOnly = reservations.filter(res => !sheetIds.has(String(res.id)));
  const mergedFromSheet = deduped.map(res => {
    const local = reservations.find(lr => String(lr.id) === String(res.id));
    // Préserver les attachments et dossierId locaux que GAS ne connaît pas
    return {
      ...res,
      attachments: (local?.attachments?.length ? local.attachments : res.attachments) || [],
      dossierId:   local?.dossierId || res.dossierId || '',
    };
  });
  reservations = [...mergedFromSheet, ...localOnly];

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
    el.innerHTML = '<span style="animation:spin 1s linear infinite;display:inline-block"></span><span id="syncLoaderMsg"></span>';
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
    ' Google Sheets — Que voulez-vous faire ?\n\n' +
    '1 → Changer l\'URL du script\n' +
    '2 → Tester la connexion\n' +
    '3 → Initialiser les feuilles (1ère utilisation)\n' +
    '4 → Synchroniser les ventes en attente\n' +
    '5 → RESTAURER toutes les données depuis le Sheet\n' +
    '6 →  RESET COMPLET — Effacer toutes les données locales\n\n' +
    'Tapez le numéro :',
    '2'
  );
  if (!choice) return;
  if (choice.trim() === '1') {
    const url = prompt(' Nouvelle URL Apps Script Web App :', APPS_SCRIPT_URL);
    if (url === null) return;
    APPS_SCRIPT_URL = url.trim();
    localStorage.setItem('pos-script-url', APPS_SCRIPT_URL);
    syncEnabled = !!APPS_SCRIPT_URL;
    if (APPS_SCRIPT_URL) { showToast(' URL enregistrée !'); testScriptConnection(); }
    else showToast(' Sync désactivée', 'info');
  } else if (choice.trim() === '2') {
    testScriptConnection();
  } else if (choice.trim() === '3') {
    initSheetsFromApp();
  } else if (choice.trim() === '4') {
    syncPendingOfflineSales();
  } else if (choice.trim() === '5') {
    forceRestoreFromSheet();
  } else if (choice.trim() === '6') {
    resetCompletPOS();
  }
}

async function resetCompletPOS() {
  const step1 = confirm(
    ' RESET COMPLET DU POS \n\n' +
    'Cela va effacer TOUTES les données locales :\n' +
    '• Produits, ventes, réservations, commandes\n' +
    '• Tâches, notifications, panier en cours\n' +
    '• Comptes utilisateurs (sauf admin/1234)\n\n' +
    'Les données Google Sheets ne sont PAS effacées.\n\n' +
    'Continuer ?'
  );
  if (!step1) return;

  const step2 = confirm('Dernière confirmation — Effacer toutes les données locales du POS ?');
  if (!step2) return;

  showLoader('Réinitialisation en cours...');

  // Sauvegarder l'URL du script et la config boutique avant de tout effacer
  const scriptUrl  = localStorage.getItem('pos-script-url');
  const appVersion = localStorage.getItem('pos-app-version');

  // Effacer tout le localStorage
  localStorage.clear();

  // Restaurer uniquement les éléments essentiels pour que l'app redémarre
  if (scriptUrl)  localStorage.setItem('pos-script-url', scriptUrl);
  if (appVersion) localStorage.setItem('pos-app-version', appVersion);

  localStorage.setItem('pos-products',      JSON.stringify([]));
  localStorage.setItem('pos-sales',         JSON.stringify([]));
  localStorage.setItem('pos-reservations',  JSON.stringify([]));
  localStorage.setItem('pos-commandes',     JSON.stringify([]));
  localStorage.setItem('pos-taches',        JSON.stringify([]));
  localStorage.setItem('pos-notifications', JSON.stringify([]));
  localStorage.setItem('pos-nextId',        '1');
  localStorage.setItem('pos-nextSaleId',    '1');
  localStorage.setItem('pos-nextResId',     '1');
  localStorage.setItem('pos-nextCmdId',     '1');

  hideLoader();
  showToast(' Données effacées — rechargement...', 'info');
  setTimeout(() => window.location.reload(true), 1500);
}

async function forceRestoreFromSheet() {
  if (!APPS_SCRIPT_URL) { showToast('URL Apps Script non configurée', 'error'); return; }
  if (!confirm('Restaurer toutes les données depuis Google Sheets ?\nLes données locales seront remplacées par celles du Sheet.')) return;
  showLoader('Restauration en cours...');
  try {
    await loadProductsFromScript();
    await loadSalesFromScript();
    await loadUsersFromScript();
    await loadReservationsFromScript();
    await loadCommandesFromScript();
    saveData();
    hideLoader();
    renderProducts();
    renderStockTable();
    renderStats();
    showToast('Données restaurées depuis Google Sheets', 'success');
  } catch(e) {
    hideLoader();
    showToast('Erreur lors de la restauration : ' + e.message, 'error');
  }
}

async function testScriptConnection() {
  showLoader('Diagnostic en cours...');
  const log = [];

  // 1. Ping (GET lisible)
  try {
    const res  = await fetch(APPS_SCRIPT_URL + '?action=ping');
    const data = JSON.parse(await res.text());
    log.push(data.ok ? ' Script accessible' : ' Script KO: ' + data.error);
  } catch(e) { log.push(' Script inaccessible: ' + e.message); }

  // 2. Lecture produits
  try {
    const res  = await fetch(APPS_SCRIPT_URL + '?action=getProducts');
    const data = JSON.parse(await res.text());
    if (data.ok)    log.push(' Produits: ' + data.products.length + ' articles lus');
    else            log.push(' Produits: ' + data.error + ' → lancez option 3');
  } catch(e) { log.push(' Lecture produits: ' + e.message); }

  // 3. Test écriture no-cors (ne peut pas lire la réponse → on vérifie via lecture)
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'ping' })
    });
    log.push(' Écriture POST envoyée (no-cors OK)');
  } catch(e) { log.push(' Écriture POST: ' + e.message); }

  hideLoader();
  alert(' Diagnostic Google Sheets\n\n' + log.join('\n') +
    '\n\n━━━━━━━━━━━━━━━━━━━━━\n' +
    '→ Si "Script inaccessible" : vérifiez l\'URL\n' +
    '→ Si "Feuille introuvable" : faites option 3 (Initialiser)\n' +
    '→ Si tout est  mais ventes absentes : vérifiez les logs Apps Script');
}

async function initSheetsFromApp() {
  showLoader('Initialisation des feuilles Google Sheets...');
  try {
    const res = await fetch(APPS_SCRIPT_URL + '?action=initSheets');
    const text = await res.text();
    const data = JSON.parse(text);
    hideLoader();
    if (data.ok) {
      showToast(' Feuilles initialisées ! Chargement des données...');
      await loadProductsFromScript();
      await loadSalesFromScript();
      renderProducts(); renderStockTable(); renderStats();
    } else {
      showToast(' Erreur init : ' + (data.error || ''), 'error');
    }
  } catch (e) {
    hideLoader();
    showToast(' Erreur : ' + e.message, 'error');
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
    // 1. Essayer pos-config (clé principale)
    let c = localStorage.getItem('pos-config');
    // 2. Fallback sur pos-config-backup si la clé principale est vide/absente
    if (!c) c = localStorage.getItem('pos-config-backup');
    const k = localStorage.getItem('pos-categories');
    if (c) {
      shopConfig = { ...shopConfig, ...JSON.parse(c) };
      // Restaurer la clé principale si elle manquait
      localStorage.setItem('pos-config', c);
    }
    if (k) categories = JSON.parse(k);
  } catch(e) {}
}

async function loadConfigFromGAS() {
  if (!APPS_SCRIPT_URL) return;
  // Si on a déjà une config avec un nom personnalisé, ne pas écraser
  if (shopConfig.name && shopConfig.name !== 'MA BOUTIQUE') return;
  try {
    const r = await apiCall({ action: 'getShopConfig' });
    if (r && r.ok && r.config && typeof r.config === 'object') {
      shopConfig = { ...shopConfig, ...r.config };
      _persistConfig();
      // Rafraîchir la page config si ouverte
      if (document.getElementById('cfgShopName')) renderConfigPage();
    }
  } catch(e) { /* silencieux — GAS peut ne pas supporter cette action */ }
}

function saveConfig() {
  shopConfig.name    = document.getElementById('cfgShopName').value || 'MA BOUTIQUE';
  shopConfig.address = document.getElementById('cfgAddress').value  || 'Antananarivo, Madagascar';
  shopConfig.phone   = document.getElementById('cfgPhone').value    || '';
  shopConfig.footer  = document.getElementById('cfgFooter').value   || 'Merci de votre visite !';
  _persistConfig();
  syncConfigToGAS();
  showToast(' Boutique enregistrée', 'success');
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
  syncConfigToGAS();
  renderTicketPreview();
}

function _persistConfig() {
  const json = JSON.stringify(shopConfig);
  // Double écriture : clé principale + clé de secours
  try { localStorage.setItem('pos-config', json); } catch(e) {}
  try { localStorage.setItem('pos-config-backup', json); } catch(e) {}
}

async function syncConfigToGAS() {
  if (!APPS_SCRIPT_URL) return;
  const statusEl = document.getElementById('cfgSyncStatus');
  if (statusEl) statusEl.textContent = '⏳ Synchronisation...';
  try {
    // Exclure le logo (trop lourd) de la sync GAS
    const { ticketLogo, ...configWithoutLogo } = shopConfig;
    const r = await apiCall({ action: 'saveShopConfig', config: configWithoutLogo });
    if (statusEl) {
      if (r && r.ok) {
        statusEl.textContent = ' Synchronisé — tous les postes';
        statusEl.style.color = '#16a34a';
      } else {
        statusEl.textContent = ' Sauvegardé localement';
        statusEl.style.color = '#78716c';
      }
      setTimeout(() => { if (statusEl) { statusEl.textContent = ''; } }, 4000);
    }
  } catch(e) {
    if (statusEl) {
      statusEl.textContent = ' Sauvegardé localement';
      statusEl.style.color = '#78716c';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);
    }
  }
}

function exportConfig() {
  const { ticketLogo, ...rest } = shopConfig;
  const data = { config: rest, categories, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pos-config-${new Date().toLocaleDateString('fr-FR').replace(/\//g,'-')}.json`;
  a.click();
  showToast('Config exportée', 'success');
}

function importConfig() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.config) { showToast('Fichier invalide', 'error'); return; }
        shopConfig = { ...shopConfig, ...data.config };
        if (data.categories && Array.isArray(data.categories)) categories = data.categories;
        _persistConfig();
        try { localStorage.setItem('pos-categories', JSON.stringify(categories)); } catch(e) {}
        renderConfigPage();
        showToast(' Config importée et appliquée', 'success');
      } catch(err) { showToast('Erreur lecture fichier', 'error'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

function renderConfigPage() {
  // Version affichée dans la section cache
  const vLabel = document.getElementById('appVersionLabel');
  if (vLabel) vLabel.textContent = `v${APP_VERSION}`;
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
  // Airtable
  _loadAirtableConfigFields();
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
      <button onclick="removeCategory('${c}')" title="Supprimer"></button>
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
  showToast(' Catégorie ajoutée');
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
        <span class="article-config-card-emoji">${p.emoji||''}</span>
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
        <button class="btn-save-article" onclick="saveArticleConfig(${p.id})"> Enregistrer</button>
        <button class="btn-icon btn-edit" onclick="editProduct(${p.id})" title="Édition complète" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px"></button>
        <button class="btn-del-article" onclick="deleteProduct(${p.id})"></button>
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
  showToast(` ${p.name} mis à jour`);
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
  if (document.getElementById('cmdFraisLivraison')) document.getElementById('cmdFraisLivraison').value = '';
  setCmdDeliveryMode('retrait');
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
          <td id="cmdRowTotal_${i}" style="padding:7px 6px;text-align:right;font-family:'DM Mono',monospace;white-space:nowrap">${fmt(item.qty * item.price)}</td>
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
      <span>${p.emoji || ''} ${p.name}</span>
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
  cmdModalItems.forEach((item, idx) => {
    const cell = document.getElementById(`cmdRowTotal_${idx}`);
    if (cell) cell.textContent = fmt((item.qty || 1) * (item.price || 0));
  });
  const subtotal  = cmdModalItems.reduce((s, i) => s + ((i.qty || 1) * (i.price || 0)), 0);
  const remise    = Math.max(0, Math.min(subtotal, parseFloat(document.getElementById('cmdRemise')?.value) || 0));
  const fraisLiv  = parseFloat(document.getElementById('cmdFraisLivraison')?.value) || 0;
  const total     = Math.max(0, subtotal - remise + fraisLiv);
  const accompte  = Math.max(0, Math.min(total, parseFloat(document.getElementById('cmdAccompte')?.value) || 0));
  const restant   = Math.max(0, total - accompte);
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
  const isCmdLiv      = document.getElementById('cmdBtnModeLivraison')?.style.background === 'rgb(232, 131, 74)';
  const cmdDelivMode  = isCmdLiv ? 'livraison' : 'retrait';
  const adresse       = isCmdLiv ? (document.getElementById('cmdAdresse')?.value.trim() || '') : '';
  const fraisLiv      = isCmdLiv ? (parseFloat(document.getElementById('cmdFraisLivraison')?.value) || 0) : 0;
  const dateLiv       = isCmdLiv ? (document.getElementById('cmdDateLivraison')?.value || '') : '';
  if (isCmdLiv && !adresse) { showToast("Veuillez saisir l'adresse de livraison.", 'error'); return; }
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
    deliveryMode:     cmdDelivMode,
    adresseLivraison: adresse,
    fraisLivraison:   fraisLiv,
    dateLivraison:    dateLiv,
    items:            cmdModalItems.map(i => ({ name: i.name.trim(), qty: i.qty, price: i.price, custom: !!i.custom })),
    notes,
    photos:           [...cmdModalPhotos],
    subtotal, remise, total: total + fraisLiv, accompte, restant: Math.max(0, total + fraisLiv - accompte),
    depositMethod:    cmdPayMode,
    depositProvider, depositRef,
    status:           'pending',
    dateFinalisation: null,
    saleId:           null
  };

  const _cmdDossier = _createDossierFromSource('commande', commande);
  commande.dossierId = _cmdDossier.id;
  commandes.unshift(commande);
  saveData();
  syncCommandeToSheets(commande);
  syncCommandeToAirtable(commande);
  _addNotification({
    dossierId:     commande.dossierId,
    numeroDossier: _cmdDossier.numeroDossier,
    etapeCode:     'RESERVE',
    etapeLabel:    'Commande créée',
    operateur:     currentUser?.label || 'Caissier',
    message:       `Nouvelle commande ${_cmdDossier.numeroDossier} — ${clientName} — ${commande.items.map(i=>i.name).join(', ')}`
  });
  closeModal('commandeModal');
  showToast(` Commande #${commande.id} créée — ${clientName}`);
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
  catch(e) { showToast(' Erreur chargement commandes', 'error'); }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = ' Actualiser'; }
    renderCommandes();
    updateCmdBadge();
  }
}

async function manualRefreshCommandes() {
  if (!APPS_SCRIPT_URL) { showToast(' URL Apps Script non configurée', 'error'); return; }
  _lastCmdRefresh = 0;
  await _autoRefreshCommandes();
  showToast(' Commandes actualisées');
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
    container.innerHTML = `<div style="text-align:center;color:var(--muted);padding:48px 20px;font-size:15px"> Aucune commande ${filter==='pending'?'en cours':''}</div>`;
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
          ${c.adresseLivraison ? ` ${c.adresseLivraison}` : ''}
          ${c.dateLivraison ? ` &nbsp; Livraison : <strong>${new Date(c.dateLivraison+'T00:00:00').toLocaleDateString('fr-FR')}</strong>` : ''}
        </div>` : '';

      const notesHtml = c.notes ? `<div class="cmd-notes"> ${c.notes}</div>` : '';

      const photosHtml = (c.photos||[]).length > 0
        ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${(c.photos||[]).map(src=>`<img src="${src}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:pointer" onclick="window.open(this.src,'_blank')" />`).join('')}</div>` : '';

      const actions = c.status === 'pending'
        ? `<button class="btn-finalize" onclick="openCmdFinalizeModal('${c.id}')"> Finaliser</button>
           <button class="btn-cancel-res" onclick="cancelCommande('${c.id}')"> Annuler</button>`
        : '';

      return `
      <div class="cmd-card">
        <div class="cmd-card-header">
          <div>
            <div class="cmd-card-client"> ${c.clientName} <span style="font-size:12px;color:var(--muted);font-weight:400">#${c.id}</span></div>
            ${c.clientContact ? `<div style="font-size:13px;color:var(--muted)"> ${c.clientContact}</div>` : ''}
          </div>
          <div style="text-align:right">
            <span class="cmd-status ${statusClass}">${statusLabel}</span>
            <div class="cmd-card-date">${dateStr}</div>
          </div>
        </div>
        ${deliveryHtml}
        <div class="cmd-items"> ${itemsStr}</div>
        ${notesHtml}
        ${photosHtml}
        <div class="res-amounts" style="margin-top:12px">
          <div class="res-amount-item"><span class="lbl">Total</span><span class="val">${fmt(c.total)}</span></div>
          <div class="res-amount-item"><span class="lbl">Acompte versé</span><span class="val" style="color:var(--green)">${fmt(c.accompte)}</span></div>
          <div class="res-amount-item"><span class="lbl">Restant dû</span><span class="val" style="color:${c.status==='pending'?'var(--accent2)':'var(--muted)'}">${fmt(c.restant)}</span></div>
        </div>
        ${actions ? `<div class="res-actions">${actions}</div>` : ''}
        ${c.status === 'pending' && c.dossierId ? _buildCardProductionSection(c.dossierId) : ''}
      </div>`;
    } catch(e) {
      return `<div class="cmd-card" style="color:var(--muted);font-size:13px;padding:12px"> Commande #${c.id} — erreur: ${e.message}</div>`;
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
  const c = commandes.find(x => String(x.id) === String(id));
  if (!c) return;
  currentCmdFinalizeId = id;
  document.getElementById('cmdFinalClientInfo').textContent = ` ${c.clientName}${c.clientContact?' — '+c.clientContact:''}`;
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
  const c = commandes.find(x => String(x.id) === String(currentCmdFinalizeId));
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
  const c = commandes.find(x => String(x.id) === String(currentCmdFinalizeId));
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
  c.items.forEach(item => {
    if (!item.custom) {
      const p = products.find(pr => pr.name === item.name);
      if (p) p.stock = Math.max(0, p.stock - item.qty);
    }
  });
  sales.unshift(sale);
  c.status           = 'completed';
  c.dateFinalisation = new Date().toISOString();
  c.saleId           = sale.id;
  saveData();
  renderProducts();
  renderStockTable();
  renderStats();
  syncToAppsScript(sale);
  syncCmdUpdateToSheets(c);
  syncCmdUpdateToAirtable(c);
  _addNotification({
    dossierId:     c.dossierId || '',
    numeroDossier: `CMD-${String(c.id).padStart(3,'0')}`,
    etapeCode:     'PAYE',
    etapeLabel:    'Commande livrée',
    operateur:     currentUser?.label || 'Caissier',
    message:       `Commande #${c.id} livrée — ${c.clientName} — paiement complet`
  });
  closeModal('cmdFinalizeModal');
  printTicket(sale);
  showToast(` Vente #${sale.id} enregistrée — Commande #${c.id} livrée !`);
  renderCommandes();
  updateCmdBadge();
}

// ============================================================
// COMMANDES — ANNULER
// ============================================================
function cancelCommande(id) {
  const c = commandes.find(x => String(x.id) === String(id));
  if (!c || c.status !== 'pending') return;
  if (!confirm(`Annuler la commande #${c.id} de ${c.clientName} ?`)) return;
  c.status = 'cancelled';
  saveData();
  renderCommandes();
  updateCmdBadge();
  syncCmdUpdateToSheets(c);
  syncCmdUpdateToAirtable(c);
  _addNotification({
    dossierId:     c.dossierId || '',
    numeroDossier: `CMD-${String(c.id).padStart(3,'0')}`,
    etapeCode:     'ANNULE',
    etapeLabel:    'Commande annulée',
    operateur:     currentUser?.label || 'Admin',
    message:       `Commande #${c.id} annulée — ${c.clientName}`
  });
  showToast(`Commande #${c.id} annulée`, 'info');
  _deleteTachesForDossier(c.dossierId);
}

// ============================================================
// COMMANDES — SYNC GOOGLE SHEETS
// ============================================================
async function syncCommandeToSheets(cmd) {
  if (!APPS_SCRIPT_URL) return;
  // Exclure les photos base64 du payload GAS
  const payload = {
    id:              cmd.id,
    date:            cmd.date,
    caissier:        cmd.caissier,
    clientName:      cmd.clientName,
    clientContact:   cmd.clientContact,
    items:           cmd.items,
    deliveryMode:    cmd.deliveryMode,
    adresseLivraison:cmd.adresseLivraison,
    fraisLivraison:  cmd.fraisLivraison,
    dateLivraison:   cmd.dateLivraison,
    subtotal:        cmd.subtotal,
    remise:          cmd.remise,
    total:           cmd.total,
    accompte:        cmd.accompte,
    restant:         cmd.restant,
    depositMethod:   cmd.depositMethod,
    depositProvider: cmd.depositProvider,
    depositRef:      cmd.depositRef,
    notes:           cmd.notes,
  };
  const r = await apiCall({ action: 'addCommande', commande: payload });
  if (!r || !r.ok) {
    console.warn('Sync commande échouée:', r?.error || 'Connexion impossible');
    showToast('Commande enregistrée localement — sync GAS échouée', 'warning');
  }
}

async function syncCmdUpdateToSheets(cmd) {
  if (!APPS_SCRIPT_URL) return;
  await apiCall({ action: 'updateCommande', id: cmd.id, status: cmd.status, dateFinalisation: cmd.dateFinalisation || '', saleId: cmd.saleId || '' });
}

async function loadCommandesFromScript() {
  if (!APPS_SCRIPT_URL) return;
  const r = await apiCall({ action: 'getCommandes' });
  if (r && r.ok && Array.isArray(r.commandes) && r.commandes.length > 0) {
    const sheetIds  = new Set(r.commandes.map(c => String(c.id)));
    const localOnly = commandes.filter(c => !sheetIds.has(String(c.id)));
    // Réinjecter photos et dossierId locaux (GAS ne les stocke pas)
    const merged = r.commandes.map(c => {
      const local = commandes.find(lc => String(lc.id) === String(c.id));
      return {
        ...c,
        photos:      (local?.photos?.length      ? local.photos      : c.photos)      || [],
        dossierId: local?.dossierId || c.dossierId || '',
      };
    });
    commandes = [...merged, ...localOnly];
    commandes.sort((a, b) => (parseSaleDate(b.date)||0) - (parseSaleDate(a.date)||0));
    if (commandes.length > 0) nextCommandeId = Math.max(...commandes.map(c => Number(c.id))) + 1;
  }
  saveData();
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
  showToast(` Export CSV — ${list.length} vente(s)`);
}

// ============================================================
// INIT
// ============================================================
let tachesLibres = []; // doit être déclaré avant loadTachesLibres()
loadConfig();
loadData();
loadUsers();
_migrateLocalUserPasswords(); // hash les mots de passe en clair au premier démarrage
loadTachesLibres();
loadCommentsLocal();
loadNotifications();
initPWA();
_autoClearCache();
// Charger la config depuis GAS au démarrage (sync multi-postes)
loadConfigFromGAS(); // Vide le cache automatiquement si nouvelle version déployée
loadRythmeFromGAS(); // Sync rythme de production depuis Google Sheets
renderCart();
renderHeldCarts();

_updateAirtableBtn();

// ============================================================
// MODULE ATTRIBUTION & PRODUCTION — FOREVER MG
// Ajout au système POS existant
// ============================================================

// --- ÉTAT ---
let dossiers = [];
let operateurs = [];
let taches = [];
// tachesLibres est déclaré avant le bloc INIT (ligne ~4116) pour éviter la TDZ
let selectedDossier = null;
let pendingAttrib = null;
let _dossierView = 'list'; // 'list' | 'card'
let pendingPointage = null;
let prodFilter = 'TOUS';
let opFilterVal = 'TOUS';
let _prodView   = 'tasks'; // 'tasks' | 'charge'
let attrDateFilter = { mois: '', annee: '' };
let prodDateFilter = { mois: '', annee: '' };

const ETAPES_CONFIG = [
  { code:'ACHAT',         label:'Achat (si besoin)',  short:'Achat',   color:'#d97706', icon:'1' },
  { code:'PAO',           label:'PAO / Conception',  short:'PAO',     color:'#6c63ff', icon:'2' },
  { code:'BAT',           label:'BAT physique',       short:'BAT',     color:'#2563eb', icon:'3' },
  { code:'RETOUR_CLIENT', label:'Retour client',      short:'Retour',  color:'#0891b2', icon:'4' },
  { code:'MODIFICATIONS', label:'Modifications',      short:'Modifs',  color:'#7c3aed', icon:'5' },
  { code:'PRODUCTION',    label:'Opérateur machine',  short:'Machine', color:'#e8834a', icon:'6' },
  { code:'FINITION',      label:'Finition',           short:'Finition',color:'#1a4a3a', icon:'7' },
  { code:'LIVRE',         label:'Livraison',          short:'Livré',   color:'#16a34a', icon:'8' },
];

// ============================================================
// RYTHME DE PRODUCTION — DÉLAIS CIBLES PAR ÉTAPE
// ============================================================

// RYTHME_DEFAULTS et rythmeProduction sont déclarés en tête de fichier (ligne ~17)

function saveRythmeProduction() {
  localStorage.setItem('pos-rythme-production', JSON.stringify(rythmeProduction));
  if (APPS_SCRIPT_URL) {
    apiCall({ action: 'saveRythme', rythme: rythmeProduction }).catch(() => {});
  }
}

async function loadRythmeFromGAS() {
  if (!APPS_SCRIPT_URL) return;
  try {
    const r = await apiCall({ action: 'getRythme' });
    if (r?.ok && r.rythme && typeof r.rythme === 'object') {
      rythmeProduction = { ...rythmeProduction, ...r.rythme };
      localStorage.setItem('pos-rythme-production', JSON.stringify(rythmeProduction));
      if (document.getElementById('rythmeConfigContainer')?.children.length) renderRythmeConfig();
    }
  } catch(e) { /* silencieux */ }
}

function _parseFrDate(str) {
  if (!str) return null;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0));
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function _getTacheRetardInfo(t) {
  if (t.statut !== 'EN_COURS' || t.dossierId === 'LIBRE') return { isRetard: false };
  const delai = rythmeProduction[t.etapeCode];
  if (!delai) return { isRetard: false };
  const debut = _parseFrDate(t.dateDebut);
  if (!debut) return { isRetard: false };
  const minutesEcoulees = (Date.now() - debut.getTime()) / 60000;
  const depassement     = Math.round(minutesEcoulees - delai);
  return { isRetard: minutesEcoulees > delai, minutesEcoulees: Math.round(minutesEcoulees), delai, depassement };
}

function renderRythmeConfig() {
  const container = document.getElementById('rythmeConfigContainer');
  if (!container) return;
  const steps = [
    { code:'ACHAT',         label:'Achat (si besoin)',  color:'#d97706' },
    { code:'PAO',           label:'PAO / Conception',   color:'#6c63ff' },
    { code:'BAT',           label:'BAT physique',       color:'#2563eb' },
    { code:'RETOUR_CLIENT', label:'Retour client',      color:'#0891b2' },
    { code:'MODIFICATIONS', label:'Modifications',      color:'#7c3aed' },
    { code:'PRODUCTION',    label:'Opérateur machine',  color:'#e8834a' },
    { code:'FINITION',      label:'Finition',           color:'#1a4a3a' },
    { code:'LIVRE',         label:'Livraison',          color:'#16a34a' },
  ];
  container.innerHTML = steps.map(e => {
    const delai = rythmeProduction[e.code] ?? RYTHME_DEFAULTS[e.code] ?? 8;
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f0eeeb">
      <div style="width:10px;height:10px;border-radius:50%;background:${e.color};flex-shrink:0"></div>
      <span style="flex:1;font-size:13px;font-weight:500;color:#1c1917">${e.label}</span>
      <div style="display:flex;align-items:center;gap:6px">
        <input type="number" min="1" max="999" value="${delai}"
          style="width:68px;padding:6px 10px;border-radius:8px;border:1px solid #e5e3df;font-size:13px;font-weight:600;text-align:center;background:#fff;color:#1c1917"
          oninput="rythmeProduction['${e.code}']=Math.max(1,+this.value||1);saveRythmeProduction();showToast('Rythme mis à jour')" />
        <span style="font-size:12px;color:#78716c;white-space:nowrap">mn max</span>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// DOSSIERS — LIAISON COMMANDES & RÉSERVATIONS
// ============================================================

function _createDossierFromSource(type, source) {
  const dossierId = `D_${type.toUpperCase()}_${source.id}`;
  const existing = dossiers.find(d => d.id === dossierId);
  if (existing) return existing;
  const prefix   = type === 'commande' ? 'CMD' : 'RES';
  const produit  = (source.items||[]).map(i => i.name).join(', ') || 'Articles';
  const quantite = (source.items||[]).reduce((s,i) => s + (i.qty||1), 0);
  const dossier  = {
    id: dossierId,
    numeroDossier: `${prefix}-${String(source.id).padStart(3,'0')}`,
    client:      source.clientName,
    produit,
    quantite,
    statut:      'CREE',
    progression: 0,
    dateCreation: new Date().toLocaleDateString('fr-FR'),
    priorite:    'Normale',
    sourceVente: `${type === 'commande' ? 'Commande' : 'Réservation'} #${source.id}`,
    sourceType:  type,
    sourceId:    source.id
  };
  dossiers.push(dossier);
  return dossier;
}

// Génère un dossierId stable et unique basé sur l'ID + date de création.
// Déterministe : se recalcule identiquement depuis les données GAS après restauration.
// Unique : deux réservations avec le même ID mais des dates différentes ont des dossierId distincts.
function _stableDossierId(type, source) {
  const prefix = type === 'commande' ? 'CMD' : 'RES';
  const datePart = source.date
    ? String(new Date(source.date).getTime()).slice(-9)
    : String(source.id).padStart(9, '0');
  return `D_${prefix}_${source.id}_${datePart}`;
}

function _ensureDossierLinks() {
  let needsSave = false;
  commandes.forEach(c => {
    const stable = _stableDossierId('commande', c);
    if (c.dossierId !== stable) { c.dossierId = stable; needsSave = true; }
    if (c.status === 'pending') _createDossierFromSource('commande', c);
  });
  reservations.forEach(r => {
    const stable = _stableDossierId('reservation', r);
    if (r.dossierId !== stable) { r.dossierId = stable; needsSave = true; }
    if (r.status === 'pending') _createDossierFromSource('reservation', r);
  });
  if (needsSave) saveData(); // persiste les nouveaux dossierId migrés
}

async function _loadTachesQuietly() {
  try {
    if (APPS_SCRIPT_URL) {
      const r = await apiCall({ action: 'getTaches' });
      if (r && r.ok) taches = _applyTacheBlocklist(r.taches);
      else if (!taches.length) {
        const raw = localStorage.getItem('pos-taches');
        taches = raw ? JSON.parse(raw) : [];
      }
    } else if (!taches.length) {
      const raw = localStorage.getItem('pos-taches');
      taches = raw ? JSON.parse(raw) : [];
    }
  } catch(e) {
    if (!taches.length) {
      try { const raw = localStorage.getItem('pos-taches'); taches = raw ? JSON.parse(raw) : []; } catch(e2) { taches = []; }
    }
  }
  // Purger les taches orphelines : dont le dossier source n'est plus en cours (pending)
  // Évite qu'une nouvelle réservation hérite des taches d'une ancienne avec le même ID
  _purgeOrphanTaches();
}

// ── Blocklist des taches supprimées (persiste contre le re-fetch GAS) ──
function _getTacheBlocklist() {
  try { return new Set(JSON.parse(localStorage.getItem('pos-tache-blocklist') || '[]')); } catch(e) { return new Set(); }
}
function _addToTacheBlocklist(ids) {
  if (!ids.length) return;
  const bl = _getTacheBlocklist();
  ids.forEach(id => bl.add(id));
  try { localStorage.setItem('pos-tache-blocklist', JSON.stringify([...bl])); } catch(e) {}
}
function _applyTacheBlocklist(list) {
  const bl = _getTacheBlocklist();
  return bl.size ? list.filter(t => !bl.has(t.id)) : list;
}

function _deleteTachesForDossier(dossierId) {
  if (!dossierId) return;
  // Mettre les IDs en blocklist pour bloquer le re-fetch GAS
  const idsToBlock = taches.filter(t => t.dossierId === dossierId).map(t => t.id);
  _addToTacheBlocklist(idsToBlock);
  // Retirer de la mémoire locale
  taches = taches.filter(t => t.dossierId !== dossierId);
  saveTaches();
  // Tenter la suppression dans GAS (best-effort)
  if (APPS_SCRIPT_URL) apiCall({ action: 'deleteTachesDossier', dossierId }).catch(() => {});
}

async function resetTachesDossier(dossierId) {
  if (!dossierId) return;
  if (!confirm('Réinitialiser toutes les tâches de ce dossier ?\nLes assignations et statuts seront effacés.')) return;
  _deleteTachesForDossier(dossierId);
  showToast('Tâches réinitialisées', 'info');
  renderAttrPanel([], dossierComments.filter(c => c.dossierId === dossierId));
}

function _purgeOrphanTaches() {
  // Construire l'ensemble des dossierId valides (réservations + commandes encore pending)
  const validIds = new Set([
    ...reservations.filter(r => r.status === 'pending').map(r => `D_RESERVATION_${r.id}`),
    ...commandes.filter(c => c.status === 'pending').map(c => `D_COMMANDE_${c.id}`),
    'LIBRE' // taches libres toujours valides
  ]);
  const before = taches.length;
  taches = taches.filter(t => t.dossierId === 'LIBRE' || validIds.has(t.dossierId));
  if (taches.length < before) {
    saveTaches();
    console.log(`[Taches] ${before - taches.length} tache(s) orpheline(s) purgée(s)`);
  }
}

function openAttribForDossier(dossierId) {
  // S'assurer que le dossier est bien dans dossiers[] (non persisté, reconstruit depuis source)
  _ensureDossierLinks();
  const d = dossiers.find(x => x.id === dossierId);
  if (!d) { showToast('Dossier introuvable', 'error'); return; }
  selectedDossier = d;
  // Stocker l'id avant showPage qui appelle loadDossiers() (async, recrée dossiers[])
  _pendingSelectDossierId = dossierId;
  showPage('attribution', null, null);
}

function _buildCardProductionSection(dossierId) {
  const dt = taches.filter(t => t.dossierId === dossierId);
  let doneCount = 0;
  const steps = ETAPES_CONFIG.map(e => {
    const te = dt.filter(t => t.etapeCode === e.code);
    let status = 'VIDE';
    // Toutes les tâches de l'étape doivent être TERMINE pour valider l'étape
    if (te.length > 0 && te.every(t => t.statut === 'TERMINE'))                  { status = 'TERMINE'; doneCount++; }
    else if (te.some(t => t.statut === 'EN_COURS' || t.statut === 'TERMINE'))     status = 'EN_COURS';
    else if (te.some(t => t.statut === 'A_FAIRE'))                                status = 'A_FAIRE';
    return { ...e, status, tachesEtape: te };
  });
  const pct = Math.round(doneCount / ETAPES_CONFIG.length * 100);
  const bg  = s => s==='TERMINE'?'#16a34a':s==='EN_COURS'?'#d97706':s==='A_FAIRE'?'#2563eb':'#f5f5f4';
  const bc  = s => s==='VIDE'?'#d6d3d1':bg(s);
  const tc  = s => s==='VIDE'?'#a8a29e':'#fff';
  const lc  = s => s==='TERMINE'?'#16a34a':'#e5e3df';
  const ic  = s => s==='TERMINE'?'':s==='EN_COURS'?'▶':s==='A_FAIRE'?'●':'';

  const progressBar = `<div style="display:flex;align-items:flex-start;overflow-x:auto;padding-bottom:2px">
    ${steps.map((s, i) => `<div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:38px;position:relative">
      ${i < steps.length-1 ? `<div style="position:absolute;top:11px;left:50%;width:100%;height:2px;background:${lc(s.status)}"></div>` : ''}
      <div style="width:22px;height:22px;border-radius:50%;border:2px solid ${bc(s.status)};background:${bg(s.status)};color:${tc(s.status)};display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;position:relative;z-index:1;flex-shrink:0">${s.status!=='VIDE'?ic(s.status):i+1}</div>
      <div style="font-size:7px;font-weight:500;color:${s.status==='VIDE'?'#a8a29e':s.status==='TERMINE'?'#16a34a':s.status==='EN_COURS'?'#d97706':'#2563eb'};margin-top:3px;text-align:center;line-height:1.2;max-width:38px;word-break:break-word">${s.short}</div>
    </div>`).join('')}
  </div>
  <div style="margin-top:6px;height:3px;background:#f0ede8;border-radius:99px;overflow:hidden">
    <div style="height:100%;width:${pct}%;background:${pct===100?'#16a34a':'#e8834a'};border-radius:99px;transition:width .4s"></div>
  </div>`;

  const assigned = steps.filter(s => s.tachesEtape.length > 0);
  const assignHtml = assigned.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">${
        assigned.flatMap(s => s.tachesEtape.map(t => {
          const col = t.statut==='TERMINE'?'#16a34a':t.statut==='EN_COURS'?'#d97706':'#2563eb';
          const bg2 = t.statut==='TERMINE'?'#dcfce7':t.statut==='EN_COURS'?'#fef3c7':'#dbeafe';
          const ic2 = t.statut==='TERMINE'?'':t.statut==='EN_COURS'?'▶':'●';
          return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:600;background:${bg2};color:${col};padding:2px 7px;border-radius:10px">${ic2} ${s.short} · ${t.operateur}</span>`;
        })).join('')
      }</div>`
    : `<div style="margin-top:6px;font-size:11px;color:#a8a29e;font-style:italic">Aucun opérateur assigné — cliquer Gérer pour attribuer</div>`;

  return `<div style="margin-top:12px;border-top:1px solid #f0ede8;padding-top:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:#78716c;text-transform:uppercase;letter-spacing:.06em">Production — ${pct}%</span>
      <button onclick="openAttribForDossier('${dossierId}')" style="font-size:11px;font-weight:600;color:#1a4a3a;background:#e8f4f0;border:1px solid rgba(26,74,58,.15);border-radius:6px;padding:3px 9px;cursor:pointer">Gérer attribution →</button>
    </div>
    ${progressBar}
    ${assignHtml}
  </div>`;
}

// ============================================================
// TÂCHES INDÉPENDANTES — persistance
// ============================================================
let tlPhotos = [];

function saveTachesLibres() {
  try { localStorage.setItem('pos-taches-libres', JSON.stringify(tachesLibres)); } catch(e) {}
}

function saveTaches() {
  try { localStorage.setItem('pos-taches', JSON.stringify(taches)); } catch(e) {}
}

function loadTachesLibres() {
  try {
    const raw = localStorage.getItem('pos-taches-libres');
    if (raw) tachesLibres = JSON.parse(raw);
  } catch(e) {}
}

// ============================================================
// NOTIFICATIONS D'AVANCEMENT
// ============================================================
// notifications est déclaré en tête de fichier (avec initialisation depuis localStorage)
function loadNotifications() { /* déjà chargé à l'init via var notifications = IIFE() */ }

function saveNotifications() {
  if (notifications.length > 100) notifications = notifications.slice(0, 100);
  try { localStorage.setItem('pos-notifications', JSON.stringify(notifications)); } catch(e) {}
}

// ── RETRY QUEUE : notifs non envoyées à GAS (réseau down, GAS indisponible) ──
// _notifRetryQueue et _notifPollInterval sont déclarés en tête de fichier

function _flushNotifRetryQueue() {
  if (!APPS_SCRIPT_URL || !_notifRetryQueue.length) return;
  const batch = _notifRetryQueue.splice(0);
  batch.forEach(notif => {
    apiCall({ action:'saveNotif', ...notif }).catch(() => {
      _notifRetryQueue.push(notif); // remet en queue si toujours en échec
    });
  });
}

function _addNotification({ dossierId, numeroDossier, etapeCode, etapeLabel, operateur, message }) {
  const notif = {
    id: `N_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    timestamp: new Date().toISOString(),
    dossierId, numeroDossier, etapeCode, etapeLabel, operateur,
    message: message || `${operateur} a terminé "${etapeLabel}" (${numeroDossier})`,
    readBy: [],
  };
  notifications.unshift(notif);
  saveNotifications();
  _renderNotifBell();
  if (APPS_SCRIPT_URL) {
    apiCall({ action:'saveNotif', ...notif }).catch(() => {
      _notifRetryQueue.push(notif); // retry au prochain poll si échec
    });
  }
}

// ── SINCE OPTIMISÉ : ne récupère que le delta depuis la dernière notif connue ──
function _getNotifSince() {
  if (notifications.length) {
    // Timestamp de la plus récente notif locale — on récupère juste ce qui est plus récent
    const latest = notifications.reduce((max, n) => n.timestamp > max ? n.timestamp : max, '');
    if (latest) return latest;
  }
  // Première fois : 48h seulement (pas 7 jours qui charge trop)
  return new Date(Date.now() - 48 * 3600 * 1000).toISOString();
}

// Charger les notifications depuis GAS (delta uniquement)
async function loadNotifsFromGAS() {
  if (!APPS_SCRIPT_URL) return;
  try {
    const since = _getNotifSince();
    const r = await apiCall({ action:'getNotifs', since });
    if (r && r.ok && Array.isArray(r.notifs) && r.notifs.length) {
      const localIds = new Set(notifications.map(n => n.id));
      const fresh = r.notifs.filter(n => !localIds.has(n.id));
      if (fresh.length) {
        notifications = [...fresh, ...notifications]
          .sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, 100);
        saveNotifications();
        _renderNotifBell();
        return fresh.length; // retourne le nb de nouvelles notifs
      }
    }
  } catch(e) {}
  return 0;
}

// ── POLLING AUTOMATIQUE : vérifie toutes les 30s sans intervention utilisateur ──

function _startNotifPolling() {
  if (_notifPollInterval) clearInterval(_notifPollInterval);
  _notifPollInterval = setInterval(async () => {
    if (document.hidden) return; // ne pas polluer quand l'onglet est en arrière-plan
    _flushNotifRetryQueue();
    const newCount = await loadNotifsFromGAS();
    if (newCount > 0 && document.getElementById('notifPanel')?.classList.contains('open')) {
      _renderNotifPanelList(); // rafraîchit le panneau si ouvert
    }
  }, 30000); // 30 secondes
}

function _stopNotifPolling() {
  if (_notifPollInterval) { clearInterval(_notifPollInterval); _notifPollInterval = null; }
}

// Reprendre le polling quand l'onglet redevient visible après une absence
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentUser && _notifPollInterval) {
    loadNotifsFromGAS(); // poll immédiat au retour de l'onglet
  }
});

// Lu/non-lu par timestamp par utilisateur (plus léger que readBy[])
function _getLastReadTs() {
  if (!currentUser) return Date.now();
  return parseInt(localStorage.getItem('pos-notif-ts-' + currentUser.username) || '0');
}

function _getUnreadCount() {
  if (!currentUser) return 0;
  const lastRead = _getLastReadTs();
  return notifications.filter(n => new Date(n.timestamp).getTime() > lastRead).length;
}

function _renderNotifBell() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  const count = _getUnreadCount();
  badge.style.display = count > 0 ? 'flex' : 'none';
  badge.textContent = count > 99 ? '99+' : String(count);
}

function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  panel.classList.contains('open') ? closeNotifPanel() : openNotifPanel();
}

function closeNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (panel) panel.classList.remove('open');
}

function markAllNotifRead() {
  if (!currentUser) return;
  localStorage.setItem('pos-notif-ts-' + currentUser.username, String(Date.now()));
  _renderNotifBell();
  _renderNotifPanelList();
}

function openNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  _renderNotifPanelList();
  panel.classList.add('open');
  // Refresh silencieux depuis GAS pour voir les actions des collègues
  loadNotifsFromGAS().then(() => _renderNotifPanelList());
}

function _renderNotifPanelList() {
  const list = document.getElementById('notifPanelList');
  const label = document.getElementById('notifCountLabel');
  if (!list) return;
  const unreadCt = _getUnreadCount();
  if (label) label.textContent = `${notifications.length} notification${notifications.length !== 1 ? 's' : ''} · ${unreadCt} non lue${unreadCt !== 1 ? 's' : ''}`;
  if (!notifications.length) {
    list.innerHTML = `<div style="padding:48px 20px;text-align:center">
      <div style="width:44px;height:44px;background:var(--color-primary-light);border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      </div>
      <p style="font-size:13px;font-weight:500;color:var(--color-text-muted)">Aucune notification</p>
      <p style="font-size:12px;color:var(--color-text-muted);margin-top:4px">Les avancements apparaîtront ici.</p>
    </div>`;
    return;
  }
  const lastRead = _getLastReadTs();
  // Icônes et couleurs pour chaque type d'événement
  const _ntMap = {
    RESERVE:     { icon:'', color:'#2563eb' },
    PAYE:        { icon:'', color:'#16a34a' },
    ANNULE:      { icon:'',  color:'#dc2626' },
    COMMENT:     { icon:'', color:'#7c3aed' },
    ATTRIBUTION: { icon:'', color:'#e8834a' },
    SELF_ASSIGN: { icon:'', color:'#e8834a' },
  };
  list.innerHTML = notifications.map(n => {
    const isUnread = new Date(n.timestamp).getTime() > lastRead;
    const dt = new Date(n.timestamp);
    const dateStr = dt.toLocaleDateString('fr-FR', { day:'2-digit', month:'short' });
    const timeStr = dt.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
    const typeConf  = _ntMap[n.etapeCode];
    const etapeConf = ETAPES_CONFIG.find(e => e.code === n.etapeCode);
    const icon  = n.dossierId === 'LIBRE' ? '' : (typeConf ? typeConf.icon : (etapeConf ? etapeConf.icon : ''));
    const color = n.dossierId === 'LIBRE' ? '#7c3aed' : (typeConf ? typeConf.color : (etapeConf ? etapeConf.color : '#16a34a'));
    return `<div class="notif-item ${isUnread ? 'notif-item--unread' : ''}">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <div style="width:30px;height:30px;border-radius:50%;background:${color}20;border:1.5px solid ${color};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:${color};flex-shrink:0;margin-top:1px">${icon}</div>
        <div style="flex:1;min-width:0">
          <p class="notif-item-msg">${n.message}</p>
          <p class="notif-item-meta">${dateStr} à ${timeStr}</p>
        </div>
        ${isUnread ? '<div style="width:7px;height:7px;border-radius:50%;background:var(--accent2);flex-shrink:0;margin-top:6px"></div>' : ''}
      </div>
    </div>`;
  }).join('');
}

async function addTLPhotos(files) {
  if (!files || files.length === 0) return;
  const remaining = 5 - tlPhotos.length;
  if (remaining <= 0) { showToast('Maximum 5 photos', 'error'); return; }
  for (const file of Array.from(files).slice(0, remaining)) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const dataUrl = await _resizeImage(file, 800, 800);
      tlPhotos.push(dataUrl);
    } catch(e) { showToast('Erreur lecture : ' + file.name, 'error'); }
  }
  renderTLPhotos();
  document.getElementById('tlPhotosInput').value = '';
}

function renderTLPhotos() {
  const c = document.getElementById('tlPhotosPreviews');
  if (!c) return;
  c.innerHTML = tlPhotos.map((src, i) => `
    <div style="position:relative;display:inline-block">
      <img src="${src}" style="width:80px;height:80px;object-fit:cover;border-radius:10px;border:2px solid var(--border);cursor:pointer" onclick="window.open(this.src,'_blank')" />
      <button onclick="removeTLPhoto(${i})" style="position:absolute;top:-6px;right:-6px;background:var(--red,#dc2626);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1">×</button>
    </div>`).join('');
}

function removeTLPhoto(index) {
  tlPhotos.splice(index, 1);
  renderTLPhotos();
}

function openTacheLibreModal() {
  tlPhotos = [];
  document.getElementById('tlTitre').value = '';
  document.getElementById('tlDesc').value = '';
  document.getElementById('tlPriorite').value = 'Normale';
  document.getElementById('tlEcheance').value = '';
  renderTLPhotos();
  const ul = document.getElementById('tlUserList');
  ul.innerHTML = localUsers.filter(u => u.actif !== false).map(u => `
    <label style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;font-size:13px;color:var(--color-text-primary);transition:background .12s" onmouseover="this.style.background='var(--color-primary-light)'" onmouseout="this.style.background=''">
      <input type="checkbox" value="${u.label}" style="accent-color:var(--color-primary);width:15px;height:15px;flex-shrink:0;cursor:pointer">
      <span>${u.label} <span style="color:var(--color-text-muted);font-size:11px">(${ROLE_LABELS[u.role]||u.role})</span></span>
    </label>`).join('');
  openModal('tacheLibreModal');
}

function saveTacheLibre() {
  const titre    = document.getElementById('tlTitre').value.trim();
  const desc     = document.getElementById('tlDesc').value.trim();
  const priorite = document.getElementById('tlPriorite').value;
  const echeance = document.getElementById('tlEcheance').value;
  if (!titre) { showToast('Le titre est obligatoire', 'error'); return; }
  const checked = [...document.querySelectorAll('#tlUserList input[type=checkbox]:checked')];
  if (!checked.length) { showToast('Sélectionnez au moins un utilisateur', 'error'); return; }
  const now = new Date().toLocaleDateString('fr-FR') + ' ' + new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
  let created = 0;
  checked.forEach(cb => {
    const t = {
      id:              `TL_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      dossierId:       'LIBRE',
      numeroDossier:   'LIBRE',
      titre,
      etapeCode:       'LIBRE',
      etapeLabel:      titre,
      operateur:       cb.value,
      statut:          'A_FAIRE',
      dateAssignation: now,
      dateDebut:       '',
      dateFin:         '',
      commentaire:     desc,
      echeance,
      priorite,
      photos:          [...tlPhotos]
    };
    tachesLibres.push(t);
    created++;
  });
  saveTachesLibres();
  closeModal('tacheLibreModal');
  showToast(`${created} tâche(s) indépendante(s) créée(s)`);
  renderTaches();
}

function deleteTacheLibre(id) {
  if (!confirm('Supprimer cette tâche indépendante ?')) return;
  tachesLibres = tachesLibres.filter(t => t.id !== id);
  saveTachesLibres();
  renderTaches();
  showToast('Tâche supprimée', 'info');
}

// --- INIT ---
// ============================================================
// FILTRE DATE — helpers communs
// ============================================================
function _parseFRDate(str) {
  if (!str) return null;
  // Formats: dd/MM/yyyy  ou  dd/MM/yyyy HH:mm  ou  ISO
  const p = str.split(/[\s/]/);
  if (p.length >= 3 && p[0].length <= 2) {
    // dd/MM/yyyy
    const d = new Date(+p[2], +p[1] - 1, +p[0]);
    return isNaN(d) ? null : d;
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function _matchDateFilter(dateStr, filter) {
  if (!filter.mois && !filter.annee) return true;
  const d = _parseFRDate(dateStr);
  if (!d) return true; // pas de date → on inclut
  if (filter.annee && d.getFullYear() !== +filter.annee) return false;
  if (filter.mois && (d.getMonth() + 1) !== +filter.mois) return false;
  return true;
}

function _populateYearSel(selId, dates) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const years = [...new Set(
    dates.map(s => { const d = _parseFRDate(s); return d ? d.getFullYear() : null; })
         .filter(Boolean)
  )].sort((a, b) => b - a);
  const cur = sel.value;
  // Garder l'option vide, remplacer le reste
  sel.innerHTML = '<option value="">Toutes années</option>'
    + years.map(y => `<option value="${y}"${cur == y ? ' selected' : ''}>${y}</option>`).join('');
}

// ── Attribution ──
function applyAttrDateFilter() {
  attrDateFilter.mois  = document.getElementById('attrMonthSel')?.value  || '';
  attrDateFilter.annee = document.getElementById('attrYearSel')?.value   || '';
  const hasFilter = attrDateFilter.mois || attrDateFilter.annee;
  const btn = document.getElementById('attrClearFilterBtn');
  if (btn) btn.style.display = hasFilter ? '' : 'none';
  renderDossiers();
}

function clearAttrDateFilter() {
  attrDateFilter = { mois: '', annee: '' };
  const ms = document.getElementById('attrMonthSel');  if (ms) ms.value = '';
  const ys = document.getElementById('attrYearSel');   if (ys) ys.value = '';
  const btn = document.getElementById('attrClearFilterBtn'); if (btn) btn.style.display = 'none';
  renderDossiers();
}

// ── Production ──
function applyProdDateFilter() {
  prodDateFilter.mois  = document.getElementById('prodMonthSel')?.value  || '';
  prodDateFilter.annee = document.getElementById('prodYearSel')?.value   || '';
  const hasFilter = prodDateFilter.mois || prodDateFilter.annee;
  const btn = document.getElementById('prodClearFilterBtn');
  if (btn) btn.style.display = hasFilter ? '' : 'none';
  renderTaches();
}

function clearProdDateFilter() {
  prodDateFilter = { mois: '', annee: '' };
  const ms = document.getElementById('prodMonthSel');  if (ms) ms.value = '';
  const ys = document.getElementById('prodYearSel');   if (ys) ys.value = '';
  const btn = document.getElementById('prodClearFilterBtn'); if (btn) btn.style.display = 'none';
  renderTaches();
}

// ============================================================
// IMPRESSION RAPPORTS
// ============================================================
const _MOIS_FR = ['','Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function _printWindow(title, bodyHtml) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { showToast('Autorisez les popups pour imprimer', 'error'); return; }
  w.document.write(`<!DOCTYPE html><html lang="fr"><head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'DM Sans',sans-serif;font-size:12px;color:#1c1917;background:#fff;padding:24px}
    .rpt-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #1a4a3a}
    .rpt-logo{font-size:18px;font-weight:700;color:#1a4a3a;letter-spacing:-.3px}
    .rpt-logo span{color:#e8834a}
    .rpt-meta{text-align:right;font-size:11px;color:#78716c}
    .rpt-title{font-size:16px;font-weight:700;color:#1c1917;margin-bottom:4px}
    .rpt-period{font-size:12px;color:#78716c;margin-bottom:16px}
    .kpi-row{display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap}
    .kpi-box{flex:1;min-width:100px;border:1px solid #e5e3df;border-radius:8px;padding:10px 14px}
    .kpi-box .kv{font-size:22px;font-weight:700;color:#1a4a3a}
    .kpi-box .kl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#a8a29e;margin-bottom:2px}
    table{width:100%;border-collapse:collapse;margin-bottom:20px}
    th{text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#78716c;padding:6px 8px;border-bottom:2px solid #e5e3df;white-space:nowrap}
    td{padding:6px 8px;border-bottom:1px solid #f5f4f2;font-size:11px;color:#1c1917;vertical-align:top}
    tr:last-child td{border-bottom:none}
    .badge{display:inline-block;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:600}
    .badge-green{background:#dcfce7;color:#16a34a}
    .badge-amber{background:#fef3c7;color:#d97706}
    .badge-blue{background:#dbeafe;color:#2563eb}
    .badge-red{background:#fee2e2;color:#dc2626}
    .badge-stone{background:#f5f5f4;color:#78716c}
    .section-title{font-size:13px;font-weight:700;color:#1a4a3a;margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e3df}
    .footer{margin-top:20px;padding-top:12px;border-top:1px solid #e5e3df;text-align:center;font-size:10px;color:#a8a29e}
    @media print{body{padding:0} .no-print{display:none}}
  </style>
</head><body>
  <div class="rpt-header">
    <div class="rpt-logo">FOREVER<span>MG</span></div>
    <div class="rpt-meta">Imprimé le ${new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}<br>à ${new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
  </div>
  ${bodyHtml}
  <div class="footer">FOREVER MG — Document généré automatiquement</div>
  <script>window.onload=()=>{window.print();}<\/script>
</body></html>`);
  w.document.close();
}

function printAttributionReport() {
  const moisLabel  = attrDateFilter.mois  ? _MOIS_FR[+attrDateFilter.mois]  : '';
  const anneeLabel = attrDateFilter.annee ? attrDateFilter.annee : '';
  const periodStr  = moisLabel && anneeLabel ? `${moisLabel} ${anneeLabel}`
                   : moisLabel ? moisLabel
                   : anneeLabel ? anneeLabel
                   : 'Tous les dossiers';

  // Filtrer la liste visible
  const list = dossiers.filter(d => _matchDateFilter(d.dateCreation, attrDateFilter));

  // KPI
  const total    = list.length;
  const enCours  = list.filter(d => d.progression > 0 && d.progression < 100).length;
  const termine  = list.filter(d => d.progression === 100 || d.statut === 'LIVRE').length;
  const urgent   = list.filter(d => d.priorite === 'Urgente').length;

  const kpis = `<div class="kpi-row">
    <div class="kpi-box"><div class="kl">Total dossiers</div><div class="kv">${total}</div></div>
    <div class="kpi-box"><div class="kl">En cours</div><div class="kv" style="color:#d97706">${enCours}</div></div>
    <div class="kpi-box"><div class="kl">Terminés</div><div class="kv" style="color:#16a34a">${termine}</div></div>
    <div class="kpi-box"><div class="kl">Urgents</div><div class="kv" style="color:#dc2626">${urgent}</div></div>
  </div>`;

  const rows = list.map(d => {
    const pct    = d.progression || 0;
    const etape  = ETAPES_CONFIG.find(e => e.code === d.statut);
    const etapeLbl = etape?.label || d.statut || '—';
    const prioBadge = d.priorite === 'Urgente' ? '<span class="badge badge-red">Urgente</span>'
      : d.priorite === 'Haute' ? '<span class="badge badge-amber">Haute</span>'
      : '<span class="badge badge-stone">Normale</span>';
    const pctBadge = pct === 100
      ? `<span class="badge badge-green">${pct}%</span>`
      : pct > 0
      ? `<span class="badge badge-amber">${pct}%</span>`
      : `<span class="badge badge-blue">${pct}%</span>`;
    // Tâches du dossier
    const dTaches = taches.filter(t => t.dossierId === d.id);
    const ops = [...new Set(dTaches.map(t => t.operateur).filter(Boolean))].join(', ') || '—';
    return `<tr>
      <td><strong>${d.numeroDossier}</strong></td>
      <td>${d.client || '—'}</td>
      <td>${d.produit || '—'}</td>
      <td>${d.quantite || '—'}</td>
      <td>${etapeLbl}</td>
      <td>${prioBadge}</td>
      <td>${pctBadge}</td>
      <td>${ops}</td>
      <td>${d.dateCreation || '—'}</td>
    </tr>`;
  }).join('');

  const table = total ? `<table>
    <thead><tr>
      <th>N° Dossier</th><th>Client</th><th>Produit</th><th>Qté</th>
      <th>Étape</th><th>Priorité</th><th>Avancement</th><th>Opérateurs</th><th>Date création</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>` : '<p style="color:#78716c;font-style:italic;text-align:center;padding:20px">Aucun dossier pour cette période</p>';

  _printWindow('Rapport Attribution — FOREVER MG', `
    <div class="rpt-title">Rapport d'Attribution des Dossiers</div>
    <div class="rpt-period">Période : ${periodStr}</div>
    ${kpis}
    <div class="section-title">Détail des dossiers (${total})</div>
    ${table}
  `);
}

function printProductionReport() {
  const moisLabel  = prodDateFilter.mois  ? _MOIS_FR[+prodDateFilter.mois]  : '';
  const anneeLabel = prodDateFilter.annee ? prodDateFilter.annee : '';
  const periodStr  = moisLabel && anneeLabel ? `${moisLabel} ${anneeLabel}`
                   : moisLabel ? moisLabel
                   : anneeLabel ? anneeLabel
                   : 'Toutes les tâches';

  const isAdminOrChef = ['admin','chef_atelier'].includes(currentUser?.role);
  const myLabel       = currentUser?.label || currentUser?.username || '';

  // Filtrer taches visibles + filtre date (par dateAssignation)
  let list = isAdminOrChef ? [...taches, ...tachesLibres]
           : [...taches, ...tachesLibres].filter(t => _sameOp(t.operateur, myLabel));
  list = list.filter(t => _matchDateFilter(t.dateAssignation, prodDateFilter));
  if (prodFilter !== 'TOUS') list = list.filter(t => t.statut === prodFilter);

  const total   = list.length;
  const aFaire  = list.filter(t => t.statut === 'A_FAIRE').length;
  const enCours = list.filter(t => t.statut === 'EN_COURS').length;
  const termine = list.filter(t => t.statut === 'TERMINE').length;

  const kpis = `<div class="kpi-row">
    <div class="kpi-box"><div class="kl">Total tâches</div><div class="kv">${total}</div></div>
    <div class="kpi-box"><div class="kl">À faire</div><div class="kv" style="color:#2563eb">${aFaire}</div></div>
    <div class="kpi-box"><div class="kl">En cours</div><div class="kv" style="color:#d97706">${enCours}</div></div>
    <div class="kpi-box"><div class="kl">Terminées</div><div class="kv" style="color:#16a34a">${termine}</div></div>
  </div>`;

  // Grouper par opérateur si admin
  let tableHtml = '';
  if (isAdminOrChef) {
    const byOp = {};
    list.forEach(t => {
      const op = t.operateur || 'Non assigné';
      if (!byOp[op]) byOp[op] = [];
      byOp[op].push(t);
    });
    tableHtml = Object.entries(byOp).sort(([a],[b])=>a.localeCompare(b)).map(([op, tlist]) => {
      const rows = tlist.map(t => _prodTacheRow(t)).join('');
      return `<div class="section-title">${op} (${tlist.length} tâche${tlist.length>1?'s':''})</div>
        <table><thead><tr><th>Dossier</th><th>Étape</th><th>Statut</th><th>Assigné le</th><th>Démarré le</th><th>Terminé le</th><th>Commentaire</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    }).join('');
  } else {
    const rows = list.map(t => _prodTacheRow(t)).join('');
    tableHtml = `<table><thead><tr><th>Dossier</th><th>Étape</th><th>Statut</th><th>Assigné le</th><th>Démarré le</th><th>Terminé le</th><th>Commentaire</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  if (!total) tableHtml = '<p style="color:#78716c;font-style:italic;text-align:center;padding:20px">Aucune tâche pour cette période</p>';

  _printWindow('Rapport Production — FOREVER MG', `
    <div class="rpt-title">Rapport de Suivi de Production</div>
    <div class="rpt-period">Période : ${periodStr}${!isAdminOrChef ? ' · Opérateur : ' + myLabel : ''}</div>
    ${kpis}
    ${tableHtml}
  `);
}

function _prodTacheRow(t) {
  const statutBadge = t.statut === 'TERMINE'
    ? '<span class="badge badge-green">Terminé</span>'
    : t.statut === 'EN_COURS'
    ? '<span class="badge badge-amber">En cours</span>'
    : '<span class="badge badge-blue">À faire</span>';
  const dossierRef = t.dossierId?.startsWith('TL_') ? ' Libre' : (t.numeroDossier || t.dossierId || '—');
  return `<tr>
    <td>${dossierRef}</td>
    <td>${t.etapeLabel || t.titre || '—'}</td>
    <td>${statutBadge}</td>
    <td>${t.dateAssignation || '—'}</td>
    <td>${t.dateDebut || '—'}</td>
    <td>${t.dateFin || '—'}</td>
    <td style="color:#78716c">${t.commentaire || ''}</td>
  </tr>`;
}

function initModulesProduction() {
  const isAdminOrChef = ['admin','chef_atelier'].includes(currentUser?.role);
  const sel = document.getElementById('opFilterSel');
  if (sel) {
    sel.style.display = isAdminOrChef ? '' : 'none';
    if (isAdminOrChef) {
      sel.innerHTML = '<option value="TOUS">Tous les opérateurs</option>';
      localUsers.filter(u => u.actif !== false).forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.label; opt.textContent = u.label;
        sel.appendChild(opt);
      });
    }
  }
}

// ============================================================
// COMMENTAIRES DOSSIER
// ============================================================
// Retourne l'URL d'une image Drive utilisable dans un <img src="">
// drive.google.com/uc?id=X sert le contenu brut — fiable pour "anyone with link"
function _driveImgSrc(att) {
  if (!att) return '';
  const fileId = att.fileId
    || (att.viewUrl ? (att.viewUrl.split('/d/')[1]||'').split('/')[0] : '')
    || (att.dlUrl   ? (att.dlUrl.split('id=')[1]||'').split('&')[0]  : '');
  if (fileId) return 'https://drive.google.com/uc?id=' + fileId;
  return att.data || ''; // fallback base64 local
}

function saveComments() {
  try { localStorage.setItem('pos-comments', JSON.stringify(dossierComments)); } catch(e) {}
}
function loadCommentsLocal() {
  try { const r = localStorage.getItem('pos-comments'); if (r) dossierComments = JSON.parse(r); } catch(e) {}
}

async function loadCommentsForDossier(dossierId) {
  if (!APPS_SCRIPT_URL) return dossierComments.filter(c => c.dossierId === dossierId);
  try {
    const r = await apiCall({ action:'getComments', dossierId });
    if (r && r.ok && Array.isArray(r.comments)) {
      // Merger : GAS fait autorité, garder les locaux non encore synchés
      const sheetIds = new Set(r.comments.map(c => c.id));
      const localOnly = dossierComments.filter(c => c.dossierId === dossierId && !sheetIds.has(c.id));
      const merged = [...r.comments, ...localOnly].sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp));
      // Mettre à jour dossierComments pour ce dossier
      dossierComments = [...dossierComments.filter(c => c.dossierId !== dossierId), ...merged];
      saveComments();
      return merged;
    }
  } catch(e) {}
  return dossierComments.filter(c => c.dossierId === dossierId);
}

function renderCommentsSection(dossierId, comments) {
  const container = document.getElementById('commentsSection');
  if (!container) return;
  const myLabel = currentUser?.label || currentUser?.username || '';

  const listHtml = comments.length
    ? comments.map(c => {
        const dt = new Date(c.timestamp);
        const dateStr = dt.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}) + ' ' + dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
        const isMe = c.author === myLabel;
        const highlighted = (c.text || '').replace(/(@[\wÀ-ÿ]+(?:\s+[\wÀ-ÿ]+)?)/g,
          '<span style="color:var(--color-secondary);font-weight:600">$1</span>');
        const attachHtml = (c.attachments||[]).length
          ? '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px">'
            + c.attachments.map(a => {
                const isImg   = (a.type||'').startsWith('image/');
                const viewUrl = a.viewUrl || a.data || '';
                const dlUrl   = a.dlUrl   || a.data || '';
                const thumbSrc = isImg ? _driveImgSrc(a) : '';
                const ext = (a.name||'').split('.').pop().toUpperCase();
                return '<div style="position:relative">'
                  + (isImg && thumbSrc
                      ? '<img src="'+thumbSrc+'" onclick="window.open(\''+viewUrl+'\',\'_blank\')" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--color-border);cursor:pointer" title="'+a.name+'" />'
                      : '<a href="'+viewUrl+'" target="_blank" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:44px;height:44px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg);text-decoration:none;color:var(--color-primary)">'
                        + '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
                        + '<span style="font-size:7px;font-weight:700">'+ext+'</span></a>')
                  + (a.dlUrl ? '<a href="'+dlUrl+'" download="'+a.name+'" title="Télécharger" style="position:absolute;bottom:-4px;right:-4px;background:var(--color-secondary);color:#fff;border-radius:50%;width:14px;height:14px;display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:8px">↓</a>' : '')
                  + '</div>';
              }).join('')
            + '</div>'
          : '';
        return '<div style="margin-bottom:10px">'
          + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">'
          +   '<span style="font-size:11px;font-weight:700;color:'+(isMe?'var(--color-secondary)':'var(--color-primary)')+'">'+c.author+'</span>'
          +   '<span style="font-size:10px;color:var(--color-text-muted)">'+dateStr+'</span>'
          + '</div>'
          + '<div style="background:'+(isMe?'#fdf0e8':'var(--color-bg)')+';border:1px solid '+(isMe?'rgba(232,131,74,.25)':'var(--color-border)')+';border-radius:8px;padding:8px 10px">'
          +   '<div style="font-size:13px;color:var(--color-text-primary);white-space:pre-wrap;word-break:break-word;line-height:1.5">'+highlighted+'</div>'
          +   attachHtml
          + '</div>'
          + '</div>';
      }).join('')
    : '<div style="font-size:12px;color:var(--color-text-muted);text-align:center;padding:10px 0;font-style:italic">Aucun commentaire</div>';

  container.innerHTML = `
    <div style="max-height:260px;overflow-y:auto;margin-bottom:10px;padding-right:4px">${listHtml}</div>
    <div style="position:relative">
      <textarea id="commentTextarea" onkeyup="handleCommentMention(event)"
        placeholder="Ajouter une note… tapez @ pour mentionner un utilisateur"
        style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:8px;font-size:13px;resize:vertical;min-height:56px;box-sizing:border-box;font-family:inherit;color:var(--color-text-primary);background:var(--color-surface)"
        onfocus="this.style.borderColor='var(--color-primary)'"
        onblur="this.style.borderColor='var(--color-border)'"></textarea>
      <div id="mentionDropdown" style="display:none;position:absolute;bottom:calc(100% + 4px);left:0;background:#fff;border:1px solid var(--color-border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:200;min-width:200px;max-height:180px;overflow-y:auto"></div>
    </div>
    <div id="commentAttachPreviews" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"></div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
      <label for="commentAttachInput" style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:var(--color-bg);color:var(--color-text-secondary);border:1px solid var(--color-border);border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;flex-shrink:0">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        Fichier
      </label>
      <input id="commentAttachInput" type="file" accept="image/*,.pdf,.doc,.docx" multiple style="display:none" onchange="addCommentAttachment(this.files)" />
      <div style="flex:1"></div>
      <button onclick="submitComment('${dossierId}')"
        style="display:inline-flex;align-items:center;gap:5px;padding:7px 16px;background:var(--color-primary);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Envoyer
      </button>
    </div>`;
}

function handleCommentMention(event) {
  const textarea = document.getElementById('commentTextarea');
  const dropdown = document.getElementById('mentionDropdown');
  if (!textarea || !dropdown) return;
  const text = textarea.value;
  const cursor = textarea.selectionStart;
  const before = text.substring(0, cursor);
  const match  = before.match(/@([\wÀ-ÿ]*)$/);
  if (!match) { dropdown.style.display = 'none'; return; }
  const query = match[1].toLowerCase();
  const results = localUsers.filter(u => u.actif !== false && (
    (u.label||'').toLowerCase().includes(query) || u.username.toLowerCase().includes(query)
  )).slice(0, 6);
  if (!results.length) { dropdown.style.display = 'none'; return; }
  dropdown.style.display = 'block';
  dropdown.innerHTML = results.map(u =>
    '<div onclick="insertMention(\''+encodeURIComponent(u.label||u.username)+'\')"'
    + ' style="padding:7px 12px;cursor:pointer;font-size:13px"'
    + ' onmouseover="this.style.background=\'var(--color-primary-light)\'"'
    + ' onmouseout="this.style.background=\'\'">'
    + '<span style="font-weight:600">'+(u.label||u.username)+'</span>'
    + ' <span style="font-size:11px;color:var(--color-text-muted)">'+(ROLE_LABELS[u.role]||u.role)+'</span>'
    + '</div>'
  ).join('');
}

function insertMention(encodedLabel) {
  const label = decodeURIComponent(encodedLabel);
  const textarea = document.getElementById('commentTextarea');
  const dropdown = document.getElementById('mentionDropdown');
  if (!textarea) return;
  const text   = textarea.value;
  const cursor = textarea.selectionStart;
  const before = text.substring(0, cursor).replace(/@([\wÀ-ÿ]*)$/, '@'+label+' ');
  textarea.value = before + text.substring(cursor);
  textarea.focus();
  textarea.setSelectionRange(before.length, before.length);
  if (dropdown) dropdown.style.display = 'none';
}

async function addCommentAttachment(files) {
  if (!files || !files.length) return;
  const MAX = 4;
  if (commentAttachments.length >= MAX) { showToast('Maximum 4 fichiers par commentaire', 'error'); return; }
  const remaining = MAX - commentAttachments.length;
  for (const file of Array.from(files).slice(0, remaining)) {
    if (file.size > 8*1024*1024) { showToast(file.name+' trop volumineux (max 8 Mo)', 'error'); continue; }
    try {
      const data = file.type.startsWith('image/')
        ? await _resizeImage(file, 1200, 1200)
        : await new Promise((res,rej) => { const r=new FileReader(); r.onload=e=>res(e.target.result); r.onerror=rej; r.readAsDataURL(file); });
      commentAttachments.push({ name:file.name, type:file.type, data });
    } catch(e) { showToast('Erreur : '+file.name, 'error'); }
  }
  renderCommentAttachments();
  const input = document.getElementById('commentAttachInput');
  if (input) input.value = '';
}

function removeCommentAttachment(idx) {
  commentAttachments.splice(idx, 1);
  renderCommentAttachments();
}

function renderCommentAttachments() {
  const c = document.getElementById('commentAttachPreviews');
  if (!c) return;
  if (!commentAttachments.length) { c.innerHTML = ''; return; }
  c.innerHTML = commentAttachments.map((a,i) => {
    const isImg = a.type.startsWith('image/');
    return '<div style="position:relative;display:inline-block">'
      + (isImg
          ? '<img src="'+a.data+'" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1.5px solid var(--color-border)" />'
          : '<div style="width:44px;height:44px;border-radius:6px;border:1.5px solid var(--color-border);background:var(--color-bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:var(--color-primary)">'
            + '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
            + '<span style="font-size:8px;font-weight:700">'+a.name.split('.').pop().toUpperCase()+'</span>'
            + '</div>')
      + '<button onclick="removeCommentAttachment('+i+')" style="position:absolute;top:-5px;right:-5px;background:#dc2626;color:#fff;border:none;border-radius:50%;width:16px;height:16px;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0">×</button>'
      + '</div>';
  }).join('');
}

async function submitComment(dossierId) {
  const textarea = document.getElementById('commentTextarea');
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text && !commentAttachments.length) { showToast('Commentaire vide', 'error'); return; }

  // Extraire les @mentions
  const mentions = [];
  const rx = /@([\wÀ-ÿ]+(?:\s+[\wÀ-ÿ]+)?)/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const u = localUsers.find(u => (u.label||u.username||'').toLowerCase() === m[1].toLowerCase());
    if (u && !mentions.includes(u.label||u.username)) mentions.push(u.label||u.username);
  }

  // Créer le commentaire immédiatement avec les previews locaux (base64)
  const comment = {
    id:            'CMT_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
    dossierId,
    numeroDossier: selectedDossier?.numeroDossier || '',
    author:        currentUser?.label || currentUser?.username || 'Anonyme',
    authorRole:    currentUser?.role || '',
    text,
    mentions,
    attachments:   commentAttachments.map(a => ({ name:a.name, type:a.type, data:a.data })),
    timestamp:     new Date().toISOString()
  };

  // ── 1. Afficher IMMÉDIATEMENT ──
  dossierComments.push(comment);
  saveComments();
  textarea.value = '';
  commentAttachments = [];
  renderCommentAttachments();
  const _refresh = () => {
    const updated = dossierComments.filter(c => c.dossierId === dossierId)
      .sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp));
    if (selectedDossier?.id === dossierId) renderCommentsSection(dossierId, updated);
    const countEl = document.getElementById('commentCount');
    if (countEl) countEl.textContent = updated.length;
  };
  _refresh();
  showToast('Commentaire envoyé');

  // Notification globale pour toute l'équipe (activité sur le dossier)
  _addNotification({
    dossierId,
    numeroDossier: comment.numeroDossier,
    etapeCode:     'COMMENT',
    etapeLabel:    'Commentaire',
    operateur:     comment.author,
    message:       `${comment.author} a commenté sur ${comment.numeroDossier}${text ? ' : "'+text.slice(0,70)+(text.length>70?'…':'')+'"' : ' (pièce jointe)'}`
  });
  // Notifications ciblées pour les @mentions
  mentions.forEach(lbl => {
    _addNotification({ dossierId, numeroDossier:comment.numeroDossier, etapeCode:'COMMENT', etapeLabel:'Commentaire',
      operateur:comment.author, message:`${comment.author} vous a mentionné dans ${comment.numeroDossier}: "${text.slice(0,60)}${text.length>60?'…':''}"` });
  });

  // ── 2. Upload Drive + sync GAS en arrière-plan (sans bloquer l'UI) ──
  if (!APPS_SCRIPT_URL) return;
  (async () => {
    if (comment.attachments.length) {
      const uploaded = [];
      for (const att of comment.attachments) {
        try {
          const r = await apiCall({ action:'uploadFile', fileName:att.name, mimeType:att.type, base64Data:att.data });
          uploaded.push(r?.ok ? { name:r.fileName||att.name, type:att.type, fileId:r.fileId, viewUrl:r.viewUrl, dlUrl:r.dlUrl } : att);
        } catch(e) { uploaded.push(att); }
      }
      // Remplacer les base64 locaux par les URLs Drive dans le commentaire
      comment.attachments = uploaded;
      saveComments();
      _refresh(); // re-render avec les URLs Drive (thumbnails Drive visibles par tous)
    }
    // Sauvegarder dans GAS (avec les URLs Drive finales)
    apiCall({ action:'addComment', ...comment });
  })();
}

// ============================================================
// PAGE ATTRIBUTION
// ============================================================
let _pendingSelectDossierId = null;

async function loadDossiers() {
  try {
    const filter = document.getElementById('dossierFilterSel')?.value || 'TOUS';
    if (APPS_SCRIPT_URL) {
      showLoader('Chargement des dossiers...');
      const r = await apiCall({ action:'getDossiers', statut:filter });
      hideLoader();
      if (r && r.ok) dossiers = r.dossiers;
      else dossiers = [];
    } else {
      dossiers = [];
    }
  } catch(e) {
    hideLoader();
    dossiers = [];
  }
  // Toujours fusionner les dossiers issus des commandes/réservations (non persistés)
  _ensureDossierLinks();
  _purgeOrphanTaches();
  renderDossiers();
  // Sélection différée depuis openAttribForDossier
  if (_pendingSelectDossierId) {
    const id = _pendingSelectDossierId;
    _pendingSelectDossierId = null;
    selectDossier(id);
  }
}

function renderDossiers() {
  const container = document.getElementById('dossierListContainer');
  if (!container) return;

  // Mettre à jour les tabs avec les compteurs
  _renderDossierTabs();

  // Peupler le sélecteur d'années depuis les dossiers existants
  _populateYearSel('attrYearSel', dossiers.map(d => d.dateCreation));

  // Filtre recherche client-side
  const search = (document.getElementById('dossierSearchInput')?.value || '').toLowerCase().trim();
  let list = dossiers;
  if (search) {
    list = dossiers.filter(d =>
      (d.numeroDossier || '').toLowerCase().includes(search) ||
      (d.client || '').toLowerCase().includes(search) ||
      (d.produit || '').toLowerCase().includes(search)
    );
  }
  // Filtre date
  if (attrDateFilter.mois || attrDateFilter.annee) {
    list = list.filter(d => _matchDateFilter(d.dateCreation, attrDateFilter));
  }

  const hasActiveFilter = search || attrDateFilter.mois || attrDateFilter.annee;
  if (!list.length) {
    container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:56px 16px;text-align:center">
      <div style="width:44px;height:44px;background:var(--color-bg);border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:12px">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      </div>
      <p style="font-size:13px;font-weight:500;color:var(--color-text-secondary)">Aucun dossier${hasActiveFilter?' trouvé':''}</p>
      <p style="font-size:11px;color:var(--color-text-muted);margin-top:3px">${hasActiveFilter?'Modifiez les filtres':'Les dossiers sont créés automatiquement lors des ventes'}</p>
    </div>`;
    return;
  }

  // Adapter le container selon le mode
  container.className = _dossierView === 'card' ? '' : 'dossier-list-wrap';

  if (_dossierView === 'card') {
    container.innerHTML = _renderDossierCardGrid(list);
    return;
  }

  container.innerHTML = list.map(d => {
    const etape      = ETAPES_CONFIG.find(e => e.code === d.statut);
    const pct        = d.progression || 0;
    const isUrgent   = d.priorite === 'Urgente';
    const isHaute    = d.priorite === 'Haute';
    const prioColor  = isUrgent ? '#dc2626' : isHaute ? '#d97706' : '#d6d3d1';
    const pctColor   = pct === 100 ? '#16a34a' : pct > 0 ? '#e8834a' : '#d6d3d1';
    const isSelected = selectedDossier?.id === d.id;
    const etapeColor = etape?.color || 'var(--color-primary)';
    const etapeShort = etape?.short || 'Créé';

    // Mini pipeline : 8 points colorés selon statut des tâches
    const dTaches   = taches.filter(t => t.dossierId === d.id);
    const pipeDots  = ETAPES_CONFIG.map(e => {
      const te = dTaches.filter(t => t.etapeCode === e.code);
      const s  = te.length === 0 ? 'vide'
        : te.every(t => t.statut === 'TERMINE') ? 'done'
        : te.some(t => t.statut === 'EN_COURS') ? 'encours'
        : 'todo';
      const bg = s==='done'?'#16a34a':s==='encours'?'#d97706':s==='todo'?'#2563eb':'#e5e3df';
      return `<span class="dossier-row__pipedot" style="background:${bg}" title="${e.short}"></span>`;
    }).join('');

    return `<div class="dossier-row ${isSelected?'dossier-row--selected':''}" onclick="selectDossier('${d.id}')">
      <div class="dossier-row__prio" style="background:${prioColor}"></div>
      <div class="dossier-row__main">
        <div class="dossier-row__top">
          <span class="dossier-row__num">${d.numeroDossier}</span>
          <span style="background:${etapeColor}18;color:${etapeColor};font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px;white-space:nowrap">${etapeShort}</span>
          ${isUrgent?`<span style="background:#fee2e2;color:#dc2626;font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px">URGENT</span>`:''}
          ${isHaute&&!isUrgent?`<span style="background:#fef3c7;color:#d97706;font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px">HAUTE</span>`:''}
        </div>
        <div class="dossier-row__client">${d.client}</div>
        <div class="dossier-row__produit">${d.produit} × ${d.quantite}</div>
      </div>
      <div class="dossier-row__right">
        <div class="dossier-row__pipe">${pipeDots}</div>
        <div class="dossier-row__meta">
          <div class="dossier-row__bar"><div class="dossier-row__bar-fill" style="width:${pct}%;background:${pctColor}"></div></div>
          <span class="dossier-row__pct" style="color:${pctColor}">${pct}%</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function _renderDossierTabs() {
  const el = document.getElementById('dossierStatusTabs');
  if (!el) return;
  const selVal = document.getElementById('dossierFilterSel')?.value || 'TOUS';
  const tabDefs = [
    { val:'TOUS',       label:'Tous' },
    { val:'CREE',       label:'Créés' },
    { val:'PAO',        label:'PAO' },
    { val:'BAT',        label:'BAT' },
    { val:'ACHAT',      label:'Achat' },
    { val:'PRODUCTION', label:'Production' },
    { val:'FINITION',   label:'Finition' },
  ];
  const counts = {};
  dossiers.forEach(d => { counts[d.statut] = (counts[d.statut]||0)+1; });
  el.innerHTML = tabDefs.map(t => {
    const count  = t.val === 'TOUS' ? dossiers.length : (counts[t.val] || 0);
    const active = selVal === t.val;
    return `<button class="dossier-tab ${active?'dossier-tab--active':''}" onclick="setDossierTab('${t.val}')">
      ${t.label}<span class="dossier-tab__count">${count}</span>
    </button>`;
  }).join('');
}

function setDossierTab(val) {
  const sel = document.getElementById('dossierFilterSel');
  if (sel) sel.value = val;
  loadDossiers();
}

function toggleDossierView(mode) {
  _dossierView = mode;
  // Mettre à jour les boutons toggle
  document.getElementById('viewToggleList')?.classList.toggle('view-toggle-btn--active', mode === 'list');
  document.getElementById('viewToggleCard')?.classList.toggle('view-toggle-btn--active', mode === 'card');
  // En vue carte : panel droit masqué jusqu'à sélection, liste prend toute la largeur
  const layout = document.getElementById('attrLayout');
  const right  = document.getElementById('attrRight');
  if (layout && right) {
    if (mode === 'card') {
      layout.style.gridTemplateColumns = '1fr';
      right.style.display = 'none';
    } else {
      layout.style.gridTemplateColumns = '';
      right.style.display = '';
    }
  }
  // Réinitialiser la sélection pour éviter un panel orphelin
  selectedDossier = null;
  renderDossiers();
}

function _renderDossierCardGrid(list) {
  if (!list.length) {
    return `<div style="display:flex;flex-direction:column;align-items:center;padding:56px 16px;text-align:center">
      <div style="width:44px;height:44px;background:var(--color-bg);border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:12px">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <p style="font-size:13px;font-weight:500;color:var(--color-text-secondary)">Aucun dossier</p>
      <p style="font-size:11px;color:var(--color-text-muted);margin-top:3px">Les dossiers sont créés automatiquement lors des ventes</p>
    </div>`;
  }

  const cards = list.map(d => {
    const isUrgent  = d.priorite === 'Urgente';
    const isHaute   = d.priorite === 'Haute';
    const pct       = d.progression || 0;
    const pctColor  = pct === 100 ? '#16a34a' : pct > 0 ? '#e8834a' : '#d6d3d1';
    const topColor  = isUrgent ? '#dc2626' : isHaute ? '#d97706' : pct === 100 ? '#16a34a' : 'var(--color-border)';
    const isSelected = selectedDossier?.id === d.id;
    const etape     = ETAPES_CONFIG.find(e => e.code === d.statut);

    // Pipeline complet avec opérateurs
    const dTaches = taches.filter(t => t.dossierId === d.id);
    const steps = ETAPES_CONFIG.map((e, i) => {
      const te = dTaches.filter(t => t.etapeCode === e.code);
      const s  = te.length === 0 ? 'vide'
        : te.every(t => t.statut === 'TERMINE') ? 'done'
        : te.some(t => t.statut === 'EN_COURS')  ? 'encours'
        : 'todo';
      const dotBg     = s==='done'?'#16a34a':s==='encours'?'#d97706':s==='todo'?'#2563eb':'#f5f5f4';
      const dotBorder = s==='done'?'#16a34a':s==='encours'?'#d97706':s==='todo'?'#2563eb':'#d6d3d1';
      const dotColor  = s==='vide'?'#a8a29e':'#fff';
      const ic        = s==='done'?'':s==='encours'?'▶':s==='todo'?'●':'';
      const lineColor = s==='done'?'#16a34a30':'#e5e3df';
      const labelColor = s==='done'?'#16a34a':s==='encours'?'#d97706':s==='todo'?'#2563eb':'#c2bdb8';
      const ops = te.map(t => t.operateur).join(',');
      return { e, s, dotBg, dotBorder, dotColor, ic, lineColor, labelColor, ops, i };
    });

    const stepsHtml = steps.map(({ e, s, dotBg, dotBorder, dotColor, ic, lineColor, labelColor, ops, i }) => `
      <div class="dossier-card-v2__step">
        ${i < steps.length-1 ? `<div class="dossier-card-v2__step-line" style="background:${lineColor}"></div>` : ''}
        <div class="dossier-card-v2__step-dot" style="background:${dotBg};border-color:${dotBorder};color:${dotColor}">
          ${ic || (i+1)}
        </div>
        <div class="dossier-card-v2__step-label" style="color:${labelColor}">${e.short}</div>
        ${ops ? `<div class="dossier-card-v2__step-op">${ops}</div>` : ''}
      </div>`).join('');

    // Badges priorité + statut
    const prioBadge = isUrgent
      ? `<span style="background:#fee2e2;color:#dc2626;font-size:9px;font-weight:700;padding:2px 6px;border-radius:6px">URGENT</span>`
      : isHaute
        ? `<span style="background:#fef3c7;color:#d97706;font-size:9px;font-weight:700;padding:2px 6px;border-radius:6px">HAUTE</span>`
        : '';
    const etapeBadge = etape
      ? `<span style="background:${etape.color}18;color:${etape.color};font-size:9px;font-weight:700;padding:2px 6px;border-radius:6px">${etape.short}</span>`
      : `<span style="background:var(--color-primary-light);color:var(--color-primary);font-size:9px;font-weight:700;padding:2px 6px;border-radius:6px">Créé</span>`;

    // Date livraison
    let dateHtml = '';
    if (d.dateLivraison) {
      const dlDate = new Date(d.dateLivraison.split('/').reverse().join('-'));
      const today  = new Date(); today.setHours(0,0,0,0);
      const diff   = Math.round((dlDate - today) / 86400000);
      const isLate = diff < 0;
      const txt    = isLate
        ? `${Math.abs(diff)}j de retard`
        : diff === 0 ? 'Aujourd\'hui !'
        : `${diff}j restants`;
      dateHtml = `<span class="dossier-card-v2__date ${isLate?'dossier-card-v2__date--late':''}">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${d.dateLivraison} · ${txt}
      </span>`;
    } else {
      dateHtml = `<span class="dossier-card-v2__date">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${d.dateCreation || '—'}
      </span>`;
    }

    return `<div class="dossier-card-v2 ${isSelected?'dossier-card-v2--selected':''}" onclick="selectDossier('${d.id}')">
      <div class="dossier-card-v2__top-bar" style="background:${topColor}"></div>
      <div class="dossier-card-v2__header">
        <div class="dossier-card-v2__meta">
          <span class="dossier-card-v2__num">${d.numeroDossier}</span>
          <div class="dossier-card-v2__badges">${etapeBadge}${prioBadge}</div>
        </div>
        <div class="dossier-card-v2__client">${d.client}</div>
        <div class="dossier-card-v2__produit">${d.produit} <span style="color:var(--color-text-muted)">× ${d.quantite}</span></div>
      </div>
      <div class="dossier-card-v2__body">
        <div class="dossier-card-v2__pipeline-label">Pipeline de production</div>
        <div class="dossier-card-v2__steps">${stepsHtml}</div>
        <div class="dossier-card-v2__progress-row">
          <div class="dossier-card-v2__progress-bar">
            <div class="dossier-card-v2__progress-fill" style="width:${pct}%;background:${pctColor}"></div>
          </div>
          <span class="dossier-card-v2__pct" style="color:${pctColor}">${pct}%</span>
        </div>
      </div>
      <div class="dossier-card-v2__footer">
        ${dateHtml}
        <button class="dossier-card-v2__action" onclick="event.stopPropagation();selectDossier('${d.id}')">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          Attribuer
        </button>
      </div>
    </div>`;
  }).join('');

  return `<div class="dossier-grid">${cards}</div>`;
}

async function selectDossier(id) {
  selectedDossier = dossiers.find(d => d.id === id);
  // En vue carte : faire apparaître le panel droit et réduire la grille
  if (_dossierView === 'card') {
    const layout = document.getElementById('attrLayout');
    const right  = document.getElementById('attrRight');
    if (layout) layout.style.gridTemplateColumns = '1fr 420px';
    if (right)  right.style.display = '';
  }
  renderDossiers();
  // Mobile : masquer la liste, afficher le panneau détail
  document.querySelector('.attr-layout')?.classList.add('dossier-selected');

  // ── 1. Affichage IMMÉDIAT depuis les données locales (zéro délai) ──
  const localTaches   = taches.filter(t => t.dossierId === id);
  const localComments = dossierComments.filter(c => c.dossierId === id)
    .sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
  renderAttrPanel(localTaches, localComments);

  // ── 2. Refresh silencieux depuis GAS en arrière-plan ──
  if (!APPS_SCRIPT_URL) return;
  Promise.all([
    apiCall({ action:'getTaches', dossierId:id }),
    loadCommentsForDossier(id)
  ]).then(([r1, c1]) => {
    if (selectedDossier?.id !== id) return; // l'opérateur a changé de dossier entre-temps
    const freshTaches   = r1?.ok ? _applyTacheBlocklist(r1.taches.filter(t => t.dossierId === id)) : localTaches;
    const freshComments = c1 || localComments;
    // Ne re-rendre que si quelque chose a changé
    const sameT = JSON.stringify(freshTaches)   === JSON.stringify(localTaches);
    const sameC = JSON.stringify(freshComments) === JSON.stringify(localComments);
    if (!sameT || !sameC) renderAttrPanel(freshTaches, freshComments);
  }).catch(() => {});
}

function backToDossierList() {
  document.querySelector('.attr-layout')?.classList.remove('dossier-selected');
  selectedDossier = null;
  renderDossiers();
}

function renderAttrPanel(tachesD, commentsD = []) {
  const panel = document.getElementById('attrPanel');
  if (!panel || !selectedDossier) return;
  const d = selectedDossier;

  // Récupérer la source (réservation ou commande) pour afficher les vrais détails
  let sourceHtml = '';
  if (d.sourceType && d.sourceId) {
    const src = d.sourceType === 'reservation'
      ? reservations.find(r => String(r.id) === String(d.sourceId))
      : commandes.find(c => String(c.id) === String(d.sourceId));
    if (src) {
      const items = (src.items || []);
      const itemsHtml = items.length
        ? items.map(i => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--color-border)">
            <span style="font-size:13px;color:var(--color-text-primary);font-weight:500">${i.name}</span>
            <span style="font-size:12px;color:var(--color-text-secondary)">× ${i.qty || 1}</span>
          </div>`).join('')
        : `<div style="font-size:13px;color:var(--color-text-muted);font-style:italic">Aucun article</div>`;

      const contactLine = src.clientContact
        ? `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--color-text-secondary);margin-top:6px">
             <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.37 2 2 0 0 1 3.6 1.17h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6.16 6.16l.91-.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
             ${src.clientContact}
           </div>`
        : '';

      const finRow = '';

      const notesRow = src.notes
        ? `<div style="margin-top:8px;padding:8px 10px;background:var(--color-warning-bg);border-radius:8px;font-size:12px;color:var(--color-text-primary);border-left:3px solid var(--color-warning)">
             <strong>Notes :</strong> ${src.notes}
           </div>`
        : '';

      const attachList = (src.attachments || []);
      const attachRow = attachList.length
        ? `<div style="margin-top:10px">
             <div style="font-size:11px;font-weight:700;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Pièces jointes (${attachList.length})</div>
             <div style="display:flex;flex-direction:column;gap:6px">
               ${attachList.map(a => {
                 const isImg   = (a.type || '').startsWith('image/');
                 const ext     = (a.name || 'fichier').split('.').pop().toUpperCase();
                 const viewUrl = a.viewUrl || a.data || '';
                 const dlUrl   = a.dlUrl   || a.data || '';
                 const thumbSrc = isImg ? _driveImgSrc(a) : '';
                 const iconSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
                 const eyeSvg  = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
                 const dlSvg   = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
                 return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--color-bg);border:1px solid var(--color-border);border-radius:8px">'
                   + (isImg && thumbSrc
                     ? '<img src="' + thumbSrc + '" style="width:40px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0;border:1px solid var(--color-border)" />'
                     : '<div style="width:40px;height:40px;background:var(--color-primary-light);border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;flex-shrink:0;color:var(--color-primary)">' + iconSvg + '<span style="font-size:8px;font-weight:700">' + ext + '</span></div>')
                   + '<span style="flex:1;min-width:0;font-size:12px;font-weight:500;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + a.name + '">' + a.name + '</span>'
                   + '<div style="display:flex;gap:5px;flex-shrink:0">'
                   +   '<a href="' + viewUrl + '" target="_blank" title="Visualiser dans un nouvel onglet" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;background:var(--color-primary-light);color:var(--color-primary);border:1px solid rgba(26,74,58,.2);border-radius:6px;text-decoration:none;font-size:11px;font-weight:600">' + eyeSvg + ' Voir</a>'
                   +   '<a href="' + dlUrl + '" download="' + a.name + '" target="_blank" title="Télécharger" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;background:#fdf0e8;color:#e8834a;border:1px solid rgba(232,131,74,.2);border-radius:6px;text-decoration:none;font-size:11px;font-weight:600">' + dlSvg + ' DL</a>'
                   + '</div>'
                   + '</div>';
               }).join('')}
             </div>
           </div>`
        : '';

      const srcIcon = d.sourceType === 'reservation'
        ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
        : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';
      const srcLabel = d.sourceType === 'reservation' ? 'Réservation' : 'Commande';
      sourceHtml = `
        <div class="attr-source-card">
          <div class="attr-source-label">
            ${srcIcon} ${srcLabel} #${d.sourceId}
          </div>
          ${itemsHtml}
          ${contactLine}
          ${notesRow}
          ${attachRow}
        </div>`;
    }
  }

  const prioColor = d.priorite==='Urgente'?'var(--color-danger)':d.priorite==='Haute'?'var(--color-warning)':'var(--color-text-muted)';
  const prioBg    = d.priorite==='Urgente'?'var(--color-danger-bg)':d.priorite==='Haute'?'var(--color-warning-bg)':'var(--color-bg)';
  const pct       = d.progression || 0;
  const pctColor  = pct===100?'var(--color-success)':pct>0?'var(--color-secondary)':'var(--color-text-muted)';

  panel.innerHTML = `
    <div class="attr-panel-header">
      <button class="btn-back-dossier" onclick="backToDossierList()" style="display:none;align-items:center;gap:4px;padding:5px 10px;border-radius:7px;background:var(--color-primary-light);color:var(--color-primary);border:1px solid rgba(26,74,58,.2);cursor:pointer;font-size:12px;font-weight:600;margin-bottom:10px">
        ← Retour
      </button>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div class="attr-panel-dossier-meta">
          <span>${d.numeroDossier}</span>
          ${d.sourceVente?`<span>·</span><span>${d.sourceVente}</span>`:''}
          ${d.dateCreation?`<span>·</span><span>${d.dateCreation}</span>`:''}
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="resetTachesDossier('${d.id}')" title="Réinitialiser les tâches"
            style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:7px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;cursor:pointer;font-size:11px;font-weight:600;flex-shrink:0">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.2"/></svg>
            Reset tâches
          </button>
          <button onclick="printDossier('${d.id}')" title="Imprimer le dossier"
            style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:7px;background:var(--color-primary);color:#fff;border:none;cursor:pointer;font-size:11px;font-weight:600;flex-shrink:0">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Imprimer
          </button>
        </div>
      </div>
      <div class="attr-panel-title">${d.produit}</div>
      <div class="attr-panel-sub">
        <span><strong style="color:var(--color-text-primary)">${d.client}</strong></span>
        <span style="color:var(--color-border)">·</span>
        <span>Qté : <strong style="color:var(--color-text-primary)">${d.quantite}</strong></span>
        <span style="color:var(--color-border)">·</span>
        <span style="background:${prioBg};color:${prioColor};font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px">${d.priorite}</span>
      </div>
      <div style="margin-top:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-muted)">Progression</span>
          <span style="font-size:11px;font-weight:700;color:${pctColor}">${pct}%</span>
        </div>
        <div style="height:4px;background:var(--color-border);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${pctColor};border-radius:4px;transition:width .4s"></div>
        </div>
      </div>
    </div>
    <div class="attr-panel-body">
      ${sourceHtml}
      <div class="attr-etapes-list">
    ${ETAPES_CONFIG.map(e => {
      const tachesEtape = tachesD.filter(t => t.etapeCode === e.code);
      const currentUser_role = currentUser?.role||'';
      const canAssign = ['admin','chef_atelier'].includes(currentUser_role);
      const etapeComplete = tachesEtape.length > 0 && tachesEtape.every(t => t.statut === 'TERMINE');
      const alreadySelfAssigned = tachesEtape.some(t => _sameOp(t.operateur, currentUser?.label));
      // Seul le rôle correspondant à l'étape peut s'auto-assigner
      const ROLE_ETAPE_MAP = { pao:'PAO', operateur_prod:'PRODUCTION', machiniste:'PRODUCTION', finition:'FINITION', livreur:'LIVRE' };
      const userEtape = ROLE_ETAPE_MAP[currentUser_role];
      const canSelfAssign = !canAssign && !etapeComplete && !alreadySelfAssigned && userEtape === e.code;
      const operateursHtml = tachesEtape.length
        ? tachesEtape.map(t => {
            const badge = t.statut==='TERMINE'
              ? `<span class="prod-badge" style="background:var(--color-success-bg);color:var(--color-success)">Terminé</span>`
              : t.statut==='EN_COURS'
              ? `<span class="prod-badge" style="background:var(--color-warning-bg);color:var(--color-warning)">En cours</span>`
              : `<span class="prod-badge" style="background:var(--color-info-bg);color:var(--color-info)">Assigné</span>`;
            return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:6px;margin-bottom:2px">${t.operateur} ${badge}</span>`;
          }).join('')
        : '<em style="color:var(--color-text-muted)">Non assigné</em>';
      const etapeIcon = etapeComplete
        ? `<span style="font-size:10px;font-weight:700;color:var(--color-success);background:var(--color-success-bg);padding:2px 8px;border-radius:20px;margin-left:6px"> Étape complète</span>`
        : '';
      return `<div class="etape-row-attr">
        <div style="width:28px;height:28px;border-radius:50%;background:${etapeComplete?'#16a34a':e.color}18;border:1.5px solid ${etapeComplete?'#16a34a':e.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;font-weight:700;color:${etapeComplete?'#16a34a':e.color}">${etapeComplete?'':e.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">
            <span style="font-size:13px;font-weight:600;color:var(--color-text-primary)">${e.label}</span>
            ${etapeIcon}
          </div>
          <div style="font-size:12px;color:var(--color-text-secondary);margin-top:3px;display:flex;flex-wrap:wrap;gap:2px">
            ${operateursHtml}
          </div>
        </div>
        ${canAssign
          ? `<button class="btn-attr-assign" onclick="openAttrib('${e.code}','${e.label}')">Assigner</button>`
          : canSelfAssign
          ? `<button class="btn-attr-assign" style="background:var(--color-secondary);border-color:var(--color-secondary)" onclick="selfAssign('${e.code}','${e.label}')">Je m'assigne</button>`
          : alreadySelfAssigned && !etapeComplete
          ? `<span style="font-size:11px;font-weight:600;color:var(--color-secondary);padding:4px 10px;background:var(--color-secondary-light);border-radius:6px"> Assigné</span>`
          : ''}
      </div>`;
    }).join('')}
      </div>
    </div>
    <div style="border-top:1px solid var(--color-border);padding:14px 18px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.06em;display:flex;align-items:center;gap:6px">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Commentaires &amp; notes
          <span style="background:var(--color-border);color:var(--color-text-secondary);font-size:10px;padding:1px 6px;border-radius:8px" id="commentCount">${commentsD.length}</span>
        </div>
        <button onclick="refreshComments('${d.id}')" id="refreshCommentsBtn"
          title="Voir les derniers commentaires des collègues"
          style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--color-bg);color:var(--color-text-secondary);border:1px solid var(--color-border);border-radius:6px;cursor:pointer;font-size:11px;font-weight:500">
          <svg id="refreshCommentsIcon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.2"/></svg>
          Actualiser
        </button>
      </div>
      <div id="commentsSection"></div>
    </div>
  `;
  // Initialiser la section commentaires
  commentAttachments = [];
  renderCommentsSection(d.id, commentsD);
}

function printDossier(dossierId) {
  _ensureDossierLinks();
  const d = dossiers.find(x => x.id === dossierId) || selectedDossier;
  if (!d) { showToast('Dossier introuvable', 'error'); return; }

  // Source (réservation ou commande)
  let src = null;
  if (d.sourceType && d.sourceId) {
    src = d.sourceType === 'reservation'
      ? reservations.find(r => String(r.id) === String(d.sourceId))
      : commandes.find(c => String(c.id) === String(d.sourceId));
  }

  const tachesD = taches.filter(t => t.dossierId === d.id);
  const tc = shopConfig || {};
  const shopName = tc.name || 'FOREVER MG';
  const shopPhone = tc.phone || '';
  const shopAddress = tc.address || '';

  // ── Articles
  const items = src?.items || [];
  const itemsHtml = items.length
    ? items.map(i => `
        <tr>
          <td style="padding:7px 10px;border-bottom:1px solid #e5e3df;font-size:12pt;color:#1c1917;font-weight:500">${i.name || '?'}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e5e3df;text-align:center;font-size:12pt;font-weight:700;color:#1a4a3a">${i.qty || 1}</td>
          ${i.custom ? `<td style="padding:7px 10px;border-bottom:1px solid #e5e3df;font-size:10pt;color:#78716c;font-style:italic">Personnalisé</td>` : '<td></td>'}
        </tr>`).join('')
    : `<tr><td colspan="3" style="padding:10px;color:#a8a29e;font-style:italic;font-size:11pt">Aucun article</td></tr>`;

  // ── Pipeline de production
  const pipelineHtml = ETAPES_CONFIG.map(e => {
    const te = tachesD.filter(t => t.etapeCode === e.code);
    const done = te.length > 0 && te.every(t => t.statut === 'TERMINE');
    const inProgress = te.some(t => t.statut === 'EN_COURS');
    const assigned = te.length > 0;
    const statusColor = done ? '#16a34a' : inProgress ? '#d97706' : assigned ? '#2563eb' : '#a8a29e';
    const statusBg    = done ? '#dcfce7'  : inProgress ? '#fef3c7'  : assigned ? '#dbeafe'  : '#f5f5f4';
    const statusLabel = done ? 'Terminé'  : inProgress ? 'En cours' : assigned ? 'Assigné'  : 'Non assigné';
    const ops = te.map(t => t.operateur).join(', ') || '—';
    return `
      <tr>
        <td style="padding:7px 10px;border-bottom:1px solid #e5e3df;font-size:11pt;font-weight:600;color:#1c1917">${e.label}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e5e3df;font-size:10pt;color:#78716c">${ops}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e5e3df;text-align:center">
          <span style="background:${statusBg};color:${statusColor};font-size:9pt;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap">${statusLabel}</span>
        </td>
      </tr>`;
  }).join('');

  // ── Images et pièces jointes
  const attachments = src?.attachments || [];
  const photos = src?.photos || [];
  const allImages = [
    ...attachments.filter(a => (a.type || '').startsWith('image/')).map(a => ({ src: _driveImgSrc(a) || a.data || '', name: a.name })),
    ...photos.filter(p => p.data || p.url).map(p => ({ src: p.data || p.url || '', name: p.name || 'Photo' }))
  ].filter(img => img.src);
  const nonImageAttach = attachments.filter(a => !(a.type || '').startsWith('image/'));

  const imagesHtml = allImages.length
    ? `<div style="margin-bottom:28px">
        <h2 style="font-size:12pt;font-weight:700;color:#1a4a3a;border-left:3px solid #e8834a;padding-left:10px;margin-bottom:12px;text-transform:uppercase;letter-spacing:.05em">Images & Photos</h2>
        <div style="display:flex;flex-wrap:wrap;gap:10px">
          ${allImages.map(img => `
            <div style="text-align:center">
              <img src="${img.src}" style="width:160px;height:120px;object-fit:cover;border-radius:8px;border:1px solid #e5e3df;display:block" />
              <div style="font-size:8pt;color:#78716c;margin-top:4px;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${img.name}</div>
            </div>`).join('')}
        </div>
      </div>`
    : '';

  const nonImageHtml = nonImageAttach.length
    ? `<div style="margin-bottom:28px">
        <h2 style="font-size:12pt;font-weight:700;color:#1a4a3a;border-left:3px solid #e8834a;padding-left:10px;margin-bottom:12px;text-transform:uppercase;letter-spacing:.05em">Fichiers joints</h2>
        ${nonImageAttach.map(a => `<div style="padding:6px 10px;background:#f8f7f4;border:1px solid #e5e3df;border-radius:6px;font-size:10pt;color:#1c1917;margin-bottom:6px"> ${a.name}</div>`).join('')}
      </div>`
    : '';

  // ── Infos livraison/retrait
  const deliveryHtml = src?.deliveryMode === 'livraison'
    ? `<div style="padding:10px 14px;background:#fdf0e8;border:1px solid rgba(232,131,74,.3);border-radius:8px;margin-bottom:14px">
        <div style="font-size:10pt;font-weight:700;color:#e8834a;margin-bottom:4px">LIVRAISON À DOMICILE</div>
        ${src.deliveryAddress ? `<div style="font-size:11pt;color:#1c1917">${src.deliveryAddress}</div>` : ''}
        ${src.deliveryDate ? `<div style="font-size:10pt;color:#78716c;margin-top:3px">Date prévue : <strong>${new Date(src.deliveryDate+'T00:00:00').toLocaleDateString('fr-FR')}</strong></div>` : ''}
      </div>`
    : src
    ? `<div style="padding:8px 14px;background:#e8f4f0;border:1px solid rgba(26,74,58,.2);border-radius:8px;margin-bottom:14px;font-size:10pt;color:#1a4a3a;font-weight:600">RETRAIT EN BOUTIQUE</div>`
    : '';

  // ── Notes
  const notesHtml = src?.notes
    ? `<div style="padding:10px 14px;background:#fef3c7;border-left:3px solid #d97706;border-radius:6px;margin-bottom:14px;font-size:11pt;color:#1c1917"><strong>Notes :</strong> ${src.notes}</div>`
    : '';

  // ── Priorité / statut
  const prioColor = d.priorite==='Urgente'?'#dc2626':d.priorite==='Haute'?'#d97706':'#16a34a';
  const prioBg    = d.priorite==='Urgente'?'#fee2e2':d.priorite==='Haute'?'#fef3c7':'#dcfce7';
  const etapeCur  = ETAPES_CONFIG.find(e => e.code === d.statut);
  const pct       = d.progression || 0;

  const html = `
    <!DOCTYPE html><html lang="fr"><head>
    <meta charset="UTF-8">
    <title>Dossier ${d.numeroDossier}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'DM Sans', Arial, sans-serif; background: #fff; color: #1c1917; padding: 30px; font-size: 12pt; }
      @media print {
        body { padding: 15px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .no-print { display: none !important; }
      }
    </style>
    </head><body>

    <!-- EN-TÊTE BOUTIQUE -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a4a3a;padding-bottom:14px;margin-bottom:22px">
      <div>
        <div style="font-size:18pt;font-weight:800;color:#1a4a3a;letter-spacing:-.02em">${shopName}</div>
        ${shopPhone ? `<div style="font-size:10pt;color:#78716c;margin-top:2px">${shopPhone}</div>` : ''}
        ${shopAddress ? `<div style="font-size:10pt;color:#78716c">${shopAddress}</div>` : ''}
      </div>
      <div style="text-align:right">
        <div style="font-size:20pt;font-weight:900;color:#1a4a3a;letter-spacing:-.03em">${d.numeroDossier}</div>
        <div style="font-size:9pt;color:#78716c;margin-top:2px">Créé le ${d.dateCreation || '—'}</div>
        <div style="font-size:9pt;color:#78716c">Imprimé le ${new Date().toLocaleDateString('fr-FR', {day:'2-digit',month:'long',year:'numeric'})}</div>
      </div>
    </div>

    <!-- FICHE CLIENT & STATUT -->
    <div style="display:flex;gap:16px;margin-bottom:22px">
      <div style="flex:1;padding:14px 16px;background:#f8f7f4;border-radius:10px;border:1px solid #e5e3df">
        <div style="font-size:9pt;font-weight:700;color:#78716c;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Client</div>
        <div style="font-size:14pt;font-weight:700;color:#1c1917">${src?.clientName || d.client || '—'}</div>
        ${src?.clientContact ? `<div style="font-size:11pt;color:#78716c;margin-top:4px"> ${src.clientContact}</div>` : ''}
        ${src?.clientType ? `<div style="font-size:10pt;color:#78716c;margin-top:2px">${src.clientType}</div>` : ''}
      </div>
      <div style="padding:14px 16px;background:#f8f7f4;border-radius:10px;border:1px solid #e5e3df;min-width:180px">
        <div style="font-size:9pt;font-weight:700;color:#78716c;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Statut dossier</div>
        <div style="font-size:11pt;font-weight:700;color:${etapeCur?.color||'#1a4a3a'};margin-bottom:6px">${etapeCur?.label || d.statut || 'Créé'}</div>
        <div style="height:6px;background:#e5e3df;border-radius:6px;overflow:hidden;margin-bottom:6px">
          <div style="height:100%;width:${pct}%;background:${pct===100?'#16a34a':pct>0?'#e8834a':'#e5e3df'};border-radius:6px"></div>
        </div>
        <div style="font-size:10pt;color:#78716c">Progression : <strong>${pct}%</strong></div>
        <div style="margin-top:8px">
          <span style="background:${prioBg};color:${prioColor};font-size:9pt;font-weight:700;padding:2px 10px;border-radius:10px">${d.priorite || 'Normale'}</span>
        </div>
      </div>
    </div>

    ${deliveryHtml}
    ${notesHtml}

    <!-- ARTICLES -->
    <div style="margin-bottom:28px">
      <h2 style="font-size:12pt;font-weight:700;color:#1a4a3a;border-left:3px solid #e8834a;padding-left:10px;margin-bottom:12px;text-transform:uppercase;letter-spacing:.05em">
        Articles commandés — Qté totale : ${d.quantite}
      </h2>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e3df;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#1a4a3a;color:#fff">
            <th style="padding:8px 10px;text-align:left;font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Article</th>
            <th style="padding:8px 10px;text-align:center;font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em;width:80px">Qté</th>
            <th style="padding:8px 10px;text-align:left;font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em;width:120px">Note</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
    </div>

    ${imagesHtml}
    ${nonImageHtml}

    <!-- PIPELINE PRODUCTION -->
    <div style="margin-bottom:28px">
      <h2 style="font-size:12pt;font-weight:700;color:#1a4a3a;border-left:3px solid #e8834a;padding-left:10px;margin-bottom:12px;text-transform:uppercase;letter-spacing:.05em">Suivi de production</h2>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e3df;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#f8f7f4">
            <th style="padding:8px 10px;text-align:left;font-size:10pt;font-weight:700;color:#78716c;text-transform:uppercase;letter-spacing:.06em">Étape</th>
            <th style="padding:8px 10px;text-align:left;font-size:10pt;font-weight:700;color:#78716c;text-transform:uppercase;letter-spacing:.06em">Opérateur(s)</th>
            <th style="padding:8px 10px;text-align:center;font-size:10pt;font-weight:700;color:#78716c;text-transform:uppercase;letter-spacing:.06em;width:100px">Statut</th>
          </tr>
        </thead>
        <tbody>${pipelineHtml}</tbody>
      </table>
    </div>

    <!-- PIED DE PAGE -->
    <div style="border-top:1px solid #e5e3df;padding-top:12px;margin-top:20px;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:9pt;color:#a8a29e">${shopName} — Document interne</div>
      <div style="font-size:9pt;color:#a8a29e">${d.numeroDossier} · ${d.sourceVente || ''}</div>
    </div>

    </body></html>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { showToast('Popup bloqué — autorisez les popups pour ce site', 'error'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

async function refreshComments(dossierId) {
  const btn  = document.getElementById('refreshCommentsBtn');
  const icon = document.getElementById('refreshCommentsIcon');
  if (btn) btn.disabled = true;
  if (icon) icon.style.animation = 'spin 0.7s linear infinite';
  try {
    const fresh = await loadCommentsForDossier(dossierId);
    if (selectedDossier?.id === dossierId) {
      renderCommentsSection(dossierId, fresh || []);
      const countEl = document.getElementById('commentCount');
      if (countEl) countEl.textContent = (fresh||[]).length;
    }
  } catch(e) {}
  if (icon) icon.style.animation = '';
  if (btn) btn.disabled = false;
}

function openAttrib(etapeCode, etapeLabel) {
  if (!selectedDossier) return;
  pendingAttrib = { etapeCode, etapeLabel };
  document.getElementById('attribContextText').textContent = `${selectedDossier.numeroDossier} — ${etapeLabel}`;
  document.getElementById('attribComment').value = '';
  _renderAttribUserList();
  openModal('attribModal');
  // Recharger les utilisateurs depuis GAS en arrière-plan pour avoir la liste complète
  if (APPS_SCRIPT_URL) {
    loadUsersFromScript().then(() => _renderAttribUserList()).catch(() => {});
  }
}

function _renderAttribUserList() {
  const list  = document.getElementById('attribOpList');
  const users = localUsers.filter(u => u.actif !== false);
  list.innerHTML = users.length ? users.map(u => {
    const displayName = u.label || u.username;
    return `
    <label style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;font-size:13px;color:var(--color-text-primary);transition:background .12s" onmouseover="this.style.background='var(--color-primary-light)'" onmouseout="this.style.background=''">
      <input type="checkbox" value="${displayName}" style="accent-color:var(--color-primary);width:15px;height:15px;flex-shrink:0;cursor:pointer">
      <span>${displayName} <span style="color:var(--color-text-muted);font-size:11px">(${ROLE_LABELS[u.role] || u.role})</span></span>
    </label>`;
  }).join('')
  : '<div style="color:var(--color-text-muted);font-size:13px;padding:12px">Aucun utilisateur actif</div>';
}

async function confirmAttribution() {
  if (!selectedDossier || !pendingAttrib) return;
  const checked = [...document.querySelectorAll('#attribOpList input[type=checkbox]:checked')];
  if (!checked.length) { showToast('Sélectionnez au moins un opérateur', 'error'); return; }
  const commentaire = document.getElementById('attribComment').value;
  const assignePar  = currentUser?.username || 'Admin';
  let allOk = true;
  for (const cb of checked) {
    const payload = {
      action: 'attribuerTache',
      dossierId: selectedDossier.id,
      numeroDossier: selectedDossier.numeroDossier,
      etapeCode: pendingAttrib.etapeCode,
      operateur: cb.value,
      commentaire,
      assignePar
    };
    let r;
    if (APPS_SCRIPT_URL) { r = await apiCall(payload); }
    else { r = { ok: true }; }
    if (r && r.ok) {
      // Mettre à jour taches[] en mémoire (et localStorage) dans tous les cas
      // pour que la page Production ait les données sans attendre un rechargement depuis le backend
      const existing = taches.find(x =>
        x.dossierId === selectedDossier.id &&
        x.etapeCode === pendingAttrib.etapeCode &&
        x.operateur === cb.value
      );
      if (!existing) {
        taches.push({
          id: r.tacheId || `T_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          dossierId: selectedDossier.id,
          numeroDossier: selectedDossier.numeroDossier,
          etapeCode: pendingAttrib.etapeCode,
          etapeLabel: pendingAttrib.etapeLabel,
          operateur: cb.value,
          commentaire,
          assignePar,
          statut: 'A_FAIRE',
          dateAssignation: new Date().toLocaleDateString('fr-FR'),
          dateDebut: '',
          dateFin: '',
        });
      }
      // Notification pour toute l'équipe
      _addNotification({
        dossierId:     selectedDossier.id,
        numeroDossier: selectedDossier.numeroDossier,
        etapeCode:     'ATTRIBUTION',
        etapeLabel:    pendingAttrib.etapeLabel,
        operateur:     currentUser?.label || 'Admin',
        message:       `${currentUser?.label||'Admin'} a assigné ${cb.value} à "${pendingAttrib.etapeLabel}" — ${selectedDossier.numeroDossier}`
      });
    } else { showToast(`Erreur pour ${cb.value}: ${r?.error||'inconnu'}`, 'error'); allOk = false; }
  }
  saveTaches();
  if (allOk) showToast(`${checked.length} opérateur(s) assigné(s)`);
  closeModal('attribModal');
  selectDossier(selectedDossier.id);
}

async function selfAssign(etapeCode, etapeLabel) {
  if (!selectedDossier || !currentUser) return;
  const operateur = currentUser.label || currentUser.username;
  if (!operateur) { showToast('Impossible : nom opérateur introuvable', 'error'); return; }
  const payload = {
    action:        'attribuerTache',
    dossierId:     selectedDossier.id,
    numeroDossier: selectedDossier.numeroDossier,
    etapeCode,
    operateur,
    commentaire:   '',
    assignePar:    currentUser.username
  };
  let r;
  if (APPS_SCRIPT_URL) {
    r = await apiCall(payload);
  } else {
    r = { ok: true };
  }
  if (r && r.ok) {
    // Mettre à jour taches[] dans tous les cas pour que Production soit synchrone
    const existing = taches.find(x =>
      x.dossierId === selectedDossier.id &&
      x.etapeCode === etapeCode &&
      x.operateur === operateur
    );
    if (!existing) {
      taches.push({
        id:              r.tacheId || `T_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        dossierId:       selectedDossier.id,
        numeroDossier:   selectedDossier.numeroDossier,
        etapeCode,
        etapeLabel,
        operateur,
        commentaire:     '',
        assignePar:      currentUser.username,
        statut:          'A_FAIRE',
        dateAssignation: new Date().toLocaleDateString('fr-FR'),
        dateDebut:       '',
        dateFin:         '',
      });
      saveTaches();
    }
    _addNotification({
      dossierId:     selectedDossier.id,
      numeroDossier: selectedDossier.numeroDossier,
      etapeCode:     'SELF_ASSIGN',
      etapeLabel,
      operateur,
      message:       `${operateur} s'est assigné à "${etapeLabel}" — ${selectedDossier.numeroDossier}`
    });
    showToast(` Vous êtes assigné à "${etapeLabel}"`);
    selectDossier(selectedDossier.id);
  } else {
    showToast(`Erreur : ${r?.error || 'inconnu'}`, 'error');
  }
}

function openOperateurModal() {
  const users = localUsers.filter(u => u.actif !== false);
  document.getElementById('opListEl').innerHTML = users.length
    ? users.map(u => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface2);border-radius:8px;margin-bottom:6px">
        <div style="width:32px;height:32px;border-radius:50%;background:var(--color-primary);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;flex-shrink:0">${(u.label||'?')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--color-text-primary)">${u.label || u.username}</div>
          <div style="font-size:11px;color:var(--color-text-muted)">${ROLE_LABELS[u.role] || u.role}</div>
        </div>
        <span class="prod-badge" style="background:var(--color-primary-light);color:var(--color-primary);font-size:10px">${u.username}</span>
      </div>`).join('')
    : '<div style="color:var(--color-text-muted);font-size:13px;text-align:center;padding:16px">Aucun utilisateur actif</div>';
  openModal('operateurModal');
}

// ============================================================
// PAGE PRODUCTION
// ============================================================
async function loadTaches() {
  try {
    const isAdminOrChef = ['admin','chef_atelier'].includes(currentUser?.role);
    opFilterVal = isAdminOrChef
      ? (document.getElementById('opFilterSel')?.value || 'TOUS')
      : (currentUser?.label || currentUser?.username || 'TOUS');
    if (APPS_SCRIPT_URL) {
      showLoader('Chargement...');
      // Admin/chef : filtrer par opérateur côté backend si sélectionné
      // Opérateur : récupérer TOUTES les tâches puis filtrer côté client
      // (évite les disparitions dues à un nom d'opérateur mal stocké dans le Sheet)
      const apiParams = { action:'getTaches' };
      if (isAdminOrChef && opFilterVal && opFilterVal !== 'TOUS') apiParams.operateur = opFilterVal;
      const r = await apiCall(apiParams);
      hideLoader();
      if (r && r.ok && Array.isArray(r.taches) && r.taches.length > 0) {
        // Fusionner : backend fait autorité, conserver les tâches locales absentes du backend
        const backendIds = new Set(r.taches.map(t => t.id));
        const localOnly  = taches.filter(t => !backendIds.has(t.id));
        taches = [...r.taches, ...localOnly];
        saveTaches();
      } else if (!r || !r.ok) {
        // Erreur réseau : fallback localStorage
        try { const raw = localStorage.getItem('pos-taches'); taches = raw ? JSON.parse(raw) : []; } catch(e) { taches = []; }
      }
      // Si r.ok mais r.taches vide : garder les taches actuelles (ne pas écraser)
    } else {
      try {
        const raw = localStorage.getItem('pos-taches');
        taches = raw ? JSON.parse(raw) : [];
      } catch(e) { taches = []; }
    }
  } catch(e) {
    hideLoader();
    try {
      const raw = localStorage.getItem('pos-taches');
      taches = raw ? JSON.parse(raw) : [];
    } catch(e2) { taches = []; }
  }
  renderTaches();
}

let _lastProdRefresh = 0;

async function _autoRefreshProduction() {
  if (!APPS_SCRIPT_URL) { renderTaches(); return; }
  const now = Date.now();
  if (now - _lastProdRefresh < 45000) return;
  _lastProdRefresh = now;
  try {
    // Recharger tâches ET dossiers en parallèle pour garder la vue à jour
    const [rT, rD] = await Promise.all([
      apiCall({ action: 'getTaches' }),
      apiCall({ action: 'getDossiers', statut: 'TOUS' }),
    ]);
    if (rT && rT.ok && Array.isArray(rT.taches) && rT.taches.length > 0) {
      const backendIds = new Set(rT.taches.map(t => t.id));
      const localOnly  = taches.filter(t => !backendIds.has(t.id));
      taches = [...rT.taches, ...localOnly];
      saveTaches();
    }
    if (rD && rD.ok && Array.isArray(rD.dossiers)) {
      dossiers = rD.dossiers;
      _ensureDossierLinks();
    }
  } catch(e) { /* silencieux — on garde les données locales */ }
  renderTaches();
}

async function refreshTaches(btn) {
  if (btn) {
    btn.disabled = true;
    const svg = btn.querySelector('svg');
    if (svg) svg.style.animation = 'spin 0.8s linear infinite';
  }
  await loadTaches();
  if (btn) {
    btn.disabled = false;
    const svg = btn.querySelector('svg');
    if (svg) svg.style.animation = '';
  }
  showToast('Tâches actualisées');
}

function setProdFilter(f, btn) {
  prodFilter = f;
  document.querySelectorAll('.prod-filter-btn').forEach(b => b.classList.remove('prod-filter-btn--active'));
  btn.classList.add('prod-filter-btn--active');
  renderTaches();
}

function _buildProgressBar(dossierId) {
  const dt = taches.filter(t => t.dossierId === dossierId);
  let doneCount = 0;
  const steps = ETAPES_CONFIG.map(e => {
    const te = dt.filter(t => t.etapeCode === e.code);
    let status = 'VIDE';
    if (te.length > 0 && te.every(t => t.statut === 'TERMINE'))              { status = 'TERMINE'; doneCount++; }
    else if (te.some(t => t.statut === 'EN_COURS' || t.statut === 'TERMINE')) status = 'EN_COURS';
    else if (te.some(t => t.statut === 'A_FAIRE'))                            status = 'A_FAIRE';
    return { ...e, status };
  });
  const pct      = Math.round(doneCount / ETAPES_CONFIG.length * 100);
  const pctColor = pct===100?'#16a34a':pct>0?'#e8834a':'#a8a29e';
  const bg  = s => s==='TERMINE'?'#16a34a':s==='EN_COURS'?'#d97706':s==='A_FAIRE'?'#2563eb':'#f5f5f4';
  const bc  = s => s==='VIDE'?'#e5e3df':bg(s);
  const tc  = s => s==='VIDE'?'#a8a29e':'#fff';
  const lc  = s => s==='TERMINE'?'#16a34a30':'#e5e3df';
  const ic  = s => s==='TERMINE'?'':s==='EN_COURS'?'▶':s==='A_FAIRE'?'●':'';
  const ops = s => {
    const t0 = dt.filter(t => t.etapeCode === s.code);
    if (!t0.length) return '';
    return `<div style="font-size:9px;color:var(--color-text-muted);margin-top:2px;text-align:center;max-width:44px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t0.map(t=>t.operateur).join(',')}</div>`;
  };
  return `<div style="background:#fff;border:1.5px solid var(--color-border);border-radius:12px;padding:12px 14px;margin-bottom:10px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <span style="font-size:10px;font-weight:700;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.06em">Pipeline de production</span>
      <span style="font-size:12px;font-weight:800;color:${pctColor}">${pct}%</span>
    </div>
    <div style="display:flex;align-items:flex-start;overflow-x:auto;padding-bottom:2px;gap:0">
      ${steps.map((s, i) => `<div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:40px;position:relative">
        ${i < steps.length-1 ? `<div style="position:absolute;top:11px;left:50%;width:100%;height:2px;background:${lc(s.status)};z-index:0"></div>` : ''}
        <div style="width:22px;height:22px;border-radius:50%;border:2px solid ${bc(s.status)};background:${bg(s.status)};color:${tc(s.status)};display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;position:relative;z-index:1;flex-shrink:0">${s.status!=='VIDE'?ic(s.status):i+1}</div>
        <div style="font-size:8px;font-weight:600;color:${s.status==='VIDE'?'#c2bdb8':s.status==='TERMINE'?'#16a34a':s.status==='EN_COURS'?'#d97706':'#2563eb'};margin-top:3px;text-align:center;line-height:1.2;max-width:44px;word-break:break-word">${s.short}</div>
        ${ops(s)}
      </div>`).join('')}
    </div>
    <div style="margin-top:10px;height:3px;background:#f0ede8;border-radius:99px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${pctColor};border-radius:99px;transition:width .4s"></div>
    </div>
  </div>`;
}

function _buildMonDashboard() {
  if (!currentUser) return '';
  const myLabel  = currentUser.label || currentUser.username || '';
  const myTaches = [...taches, ...tachesLibres].filter(t => _sameOp(t.operateur, myLabel));
  if (!myTaches.length) return '';

  const blocking = myTaches.filter(t => {
    if (t.statut !== 'A_FAIRE') return false;
    if (t.dossierId === 'LIBRE') return true;
    const si = ETAPES_CONFIG.findIndex(e => e.code === t.etapeCode);
    for (let i = 0; i < si; i++) {
      const prev = ETAPES_CONFIG[i];
      const pt = taches.filter(x => x.dossierId === t.dossierId && x.etapeCode === prev.code);
      if (pt.length && !pt.every(x => x.statut === 'TERMINE')) return false;
    }
    return true;
  });
  const inProgress = myTaches.filter(t => t.statut === 'EN_COURS');
  const done       = myTaches.filter(t => t.statut === 'TERMINE');

  const alertBadge = blocking.length
    ? `<span style="background:var(--color-danger-bg);color:var(--color-danger);font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px">${blocking.length} prête(s) à démarrer</span>`
    : inProgress.length
      ? `<span style="background:var(--color-warning-bg);color:var(--color-warning);font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px">${inProgress.length} en cours</span>`
      : `<span style="background:var(--color-success-bg);color:var(--color-success);font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px">Tout à jour</span>`;

  const cards = myTaches.map(t => {
    const etape     = ETAPES_CONFIG.find(e => e.code === t.etapeCode) || { color:'#888', icon:'?', label:t.etapeLabel||'Tâche' };
    const isAFaire  = t.statut === 'A_FAIRE';
    const isEC      = t.statut === 'EN_COURS';
    const isDone    = t.statut === 'TERMINE';
    let isBlocked = false; let blockedBy = '';
    if (isAFaire && t.dossierId !== 'LIBRE') {
      const si = ETAPES_CONFIG.findIndex(e => e.code === t.etapeCode);
      for (let i = 0; i < si; i++) {
        const prev = ETAPES_CONFIG[i];
        const pt = taches.filter(x => x.dossierId === t.dossierId && x.etapeCode === prev.code);
        if (pt.length && !pt.every(x => x.statut === 'TERMINE')) { isBlocked = true; blockedBy = prev.short || prev.label; break; }
      }
    }
    const canStart = isAFaire && !isBlocked;
    const bg      = isBlocked?'#fafafa':isAFaire?'var(--color-danger-bg)':isDone?'var(--color-success-bg)':'var(--color-warning-bg)';
    const border  = isBlocked?'#e5e3df':isAFaire?'#fca5a5':isDone?'#86efac':'#fcd34d';
    const sTxt    = isBlocked?`Attend : ${blockedBy}`:isAFaire?'À démarrer':isEC?'En cours':'Terminé';
    const sColor  = isBlocked?'var(--color-text-muted)':isAFaire?'var(--color-danger)':isEC?'var(--color-warning)':'var(--color-success)';
    const btn = canStart
      ? `<button onclick="pointerStart('${t.id}')" class="mon-task-card__btn" style="background:var(--color-primary);color:#fff">▶ Démarrer</button>`
      : isEC
        ? `<button onclick="openPointage('${t.id}','${t.etapeCode||''}','${t.numeroDossier||t.titre||''}')" class="mon-task-card__btn" style="background:var(--color-success);color:#fff"> Terminer</button>`
        : '';
    return `<div class="mon-task-card" style="background:${bg};border-color:${border}">
      <div class="mon-task-card__num">${t.dossierId==='LIBRE'?'Tâche libre':(t.numeroDossier||'')}</div>
      <div class="mon-task-card__etape" style="color:${etape.color}">${etape.label}</div>
      <div class="mon-task-card__status" style="color:${sColor}">${sTxt}</div>
      ${btn}
    </div>`;
  }).join('');

  return `<div class="mon-dashboard">
    <div class="mon-dashboard-head">
      <div>
        <div class="mon-dashboard-name">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:4px;vertical-align:middle"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Mes tâches — ${myLabel}
        </div>
        <div class="mon-dashboard-sub">${myTaches.length} tâche(s) · ${done.length} terminée(s) · ${inProgress.length} en cours</div>
      </div>
      ${alertBadge}
    </div>
    <div class="mon-dashboard-cards">${cards}</div>
  </div>`;
}

function _tacheRow(t) {
  const isLibre = t.dossierId === 'LIBRE';
  const etape   = isLibre
    ? { color:'#7c3aed', icon:'', label:t.titre||'Tâche libre', short:'Libre' }
    : (ETAPES_CONFIG.find(e => e.code === t.etapeCode) || { color:'#888', icon:'?', label:t.etapeLabel, short:'?' });
  const isEC   = t.statut === 'EN_COURS';
  const isDone = t.statut === 'TERMINE';
  const isAdminOrChef = ['admin','chef_atelier'].includes(currentUser?.role);
  const canInteract   = isAdminOrChef || _sameOp(t.operateur, currentUser?.label);

  let isStepBlocked = false; let blockedByStep = '';
  if (!isLibre && !isEC && !isDone) {
    const si = ETAPES_CONFIG.findIndex(e => e.code === t.etapeCode);
    for (let i = 0; i < si; i++) {
      const prev = ETAPES_CONFIG[i];
      const pt   = taches.filter(x => x.dossierId === t.dossierId && x.etapeCode === prev.code);
      if (pt.length && !pt.every(x => x.statut === 'TERMINE')) { isStepBlocked = true; blockedByStep = prev.short||prev.label; break; }
    }
  }

  const actions = isDone
    ? `<span class="prod-badge" style="background:var(--color-success-bg);color:var(--color-success);padding:5px 10px;font-size:11px"> Terminé</span>`
    : isEC
      ? (canInteract
          ? `<button class="btn-prod-done" onclick="openPointage('${t.id}','${t.etapeCode||''}','${(t.titre||t.numeroDossier||'').replace(/'/g,"\\'")}')"> Terminer</button>`
          : `<span style="font-size:10px;font-weight:600;color:var(--color-warning);padding:4px 8px;background:var(--color-warning-bg);border-radius:6px;white-space:nowrap">En cours</span>`)
      : isStepBlocked
        ? `<span style="font-size:10px;font-weight:600;color:var(--color-text-muted);padding:4px 8px;background:#f5f5f4;border:1px solid #e5e3df;border-radius:6px;white-space:nowrap" title="Attend l'étape : ${blockedByStep}">⏸ ${blockedByStep}</span>`
        : (canInteract
            ? `<button class="btn-prod-start" onclick="pointerStart('${t.id}')">▶ Démarrer</button>`
            : `<span style="font-size:10px;font-weight:600;color:var(--color-text-muted);padding:4px 8px;background:#f5f5f4;border-radius:6px;white-space:nowrap">${t.operateur}</span>`);

  const deleteBtn = isLibre && isAdminOrChef && !isDone
    ? `<button onclick="deleteTacheLibre('${t.id}')" style="width:24px;height:24px;border:none;background:var(--color-danger-bg);color:var(--color-danger);border-radius:6px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;line-height:1">×</button>`
    : '';
  const voirBtn = !isLibre
    ? `<button onclick="openAttribForDossier('${t.dossierId}')" title="Voir les détails du dossier" style="padding:4px 8px;border-radius:6px;background:var(--color-primary-light);color:var(--color-primary);border:1px solid rgba(26,74,58,.18);cursor:pointer;font-size:10px;font-weight:600;white-space:nowrap;flex-shrink:0">→</button>`
    : '';

  const prioColor = t.priorite==='Urgente'?'var(--color-danger)':t.priorite==='Haute'?'var(--color-warning)':'';
  const prioBadge = isLibre && t.priorite && t.priorite!=='Normale'
    ? `<span style="font-size:9px;font-weight:700;color:${prioColor};background:${t.priorite==='Urgente'?'var(--color-danger-bg)':'var(--color-warning-bg)'};padding:1px 5px;border-radius:6px;margin-left:4px">${t.priorite}</span>` : '';

  const subLine = isLibre
    ? `${t.operateur}${t.echeance?' · Échéance : <strong>'+new Date(t.echeance+'T00:00:00').toLocaleDateString('fr-FR')+'</strong>':''}`
    : `${t.operateur} · ${isEC?'Démarré '+t.dateDebut:isDone?'Terminé '+t.dateFin:'Assigné '+t.dateAssignation}`;

  const retardInfo   = _getTacheRetardInfo(t);
  const retardBadge  = retardInfo.isRetard
    ? `<span style="font-size:10px;font-weight:700;color:#dc2626;background:#fee2e2;padding:3px 8px;border-radius:6px;white-space:nowrap;border:1px solid #fca5a5;flex-shrink:0" title="Délai dépassé de ${retardInfo.depassement}mn"> EN RETARD +${retardInfo.depassement}mn</span>`
    : '';
  const retardStyle  = retardInfo.isRetard ? 'border-left:3px solid #dc2626;' : '';

  return `<div class="tache-card ${isEC?'tache-card--encours':''} ${isDone?'tache-card--done':''}" style="${retardStyle}">
    <div class="tache-card__icon" style="background:${etape.color}15;border-color:${etape.color};color:${etape.color}">${etape.icon}</div>
    <div class="tache-card__body">
      <div class="tache-card__label" style="color:${etape.color}">${isLibre?t.titre:t.etapeLabel}${prioBadge}</div>
      ${isLibre&&t.commentaire?`<div style="font-size:10px;color:var(--color-text-muted);margin-bottom:2px;white-space:pre-wrap">${t.commentaire}</div>`:''}
      ${isLibre&&t.photos?.length?`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px;margin-bottom:2px">${t.photos.map(src=>`<img src="${src}" onclick="window.open(this.src,'_blank')" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--color-border);cursor:pointer" />`).join('')}</div>`:''}
      <div class="tache-card__sub">${subLine}</div>
    </div>
    <div class="tache-card__actions">${retardBadge}${actions}${voirBtn}${deleteBtn}</div>
  </div>`;
}

function toggleProdView(mode) {
  _prodView = mode;
  document.getElementById('prodViewTasks')?.classList.toggle('view-toggle-btn--active', mode === 'tasks');
  document.getElementById('prodViewCharge')?.classList.toggle('view-toggle-btn--active', mode === 'charge');
  // Masquer les filtres statut en vue charge (non pertinents)
  const fb = document.getElementById('prodFilterBar');
  if (fb) fb.style.display = mode === 'charge' ? 'none' : '';
  // Masquer la mini barre charge en vue charge (redondant)
  const wl = document.getElementById('opWorkloadContainer');
  if (wl) wl.style.display = mode === 'charge' ? 'none' : '';
  renderTaches();
}

function _renderChargeView() {
  const container = document.getElementById('tachesContainer');
  if (!container) return;

  const isAdminOrChef = ['admin','chef_atelier'].includes(currentUser?.role);
  const allTaches     = [...taches, ...tachesLibres];

  // Construire la map opérateur → leurs tâches
  const opMap = {};
  allTaches.forEach(t => {
    if (!t.operateur) return;
    if (!opMap[t.operateur]) opMap[t.operateur] = [];
    opMap[t.operateur].push(t);
  });

  // Si pas admin/chef : n'afficher que sa propre carte
  const myLabel = currentUser?.label || currentUser?.username || '';
  const opKeys  = isAdminOrChef
    ? Object.keys(opMap).sort()
    : (opMap[myLabel] ? [myLabel] : []);

  if (!opKeys.length) {
    container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;padding:64px 0;text-align:center">
      <div style="width:44px;height:44px;background:var(--color-bg);border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:12px">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </div>
      <p style="font-size:13px;font-weight:500;color:var(--color-text-secondary)">Aucune tâche assignée</p>
    </div>`;
    return;
  }

  // KPI globaux (admin seulement)
  let kpiHtml = '';
  if (isAdminOrChef) {
    const totalOps      = opKeys.length;
    const totalActifs   = allTaches.filter(t => t.statut !== 'TERMINE').length;
    const totalEnCours  = allTaches.filter(t => t.statut === 'EN_COURS').length;
    const urgentDossiers = [...new Set(
      taches.filter(t => {
        const d = dossiers.find(x => x.id === t.dossierId);
        return d?.priorite === 'Urgente' && t.statut !== 'TERMINE';
      }).map(t => t.dossierId)
    )].length;
    const maxCharge = Math.max(...opKeys.map(op => opMap[op].filter(t => t.statut !== 'TERMINE').length), 1);
    const surcharges = opKeys.filter(op => {
      const actif = opMap[op].filter(t => t.statut !== 'TERMINE').length;
      return actif / maxCharge >= 0.85;
    }).length;

    kpiHtml = `<div class="charge-kpi-bar">
      <div class="charge-kpi-card">
        <div class="charge-kpi-card__val">${totalOps}</div>
        <div class="charge-kpi-card__label">Opérateurs actifs</div>
      </div>
      <div class="charge-kpi-card charge-kpi-card--warn">
        <div class="charge-kpi-card__val">${totalActifs}</div>
        <div class="charge-kpi-card__label">Tâches en file</div>
      </div>
      <div class="charge-kpi-card charge-kpi-card--ok">
        <div class="charge-kpi-card__val">${totalEnCours}</div>
        <div class="charge-kpi-card__label">En cours maintenant</div>
      </div>
      ${urgentDossiers ? `<div class="charge-kpi-card charge-kpi-card--alert">
        <div class="charge-kpi-card__val">${urgentDossiers}</div>
        <div class="charge-kpi-card__label">Dossiers urgents actifs</div>
      </div>` : ''}
      ${surcharges ? `<div class="charge-kpi-card charge-kpi-card--alert">
        <div class="charge-kpi-card__val">${surcharges}</div>
        <div class="charge-kpi-card__label">Opérateur(s) surchargé(s)</div>
      </div>` : ''}
    </div>`;
  }

  // Grille des cartes opérateurs
  const maxActif = Math.max(...opKeys.map(op => opMap[op].filter(t => t.statut !== 'TERMINE').length), 1);

  const ROLE_LABELS_LOCAL = { admin:'Admin', chef_atelier:'Chef atelier', operateur_prod:'Opérateur', machiniste:'Machiniste', pao:'PAO', finition:'Finition', livreur:'Livreur', caissier:'Caissier', commerciale:'Commercial', comptable:'Comptable', gestionnaire:'Gestionnaire', utilisateur:'Utilisateur' };

  const cards = opKeys.map(op => {
    const opTaches   = opMap[op];
    const aFaire     = opTaches.filter(t => t.statut === 'A_FAIRE');
    const enCours    = opTaches.filter(t => t.statut === 'EN_COURS');
    const termine    = opTaches.filter(t => t.statut === 'TERMINE');
    const actif      = aFaire.length + enCours.length;
    const pct        = Math.round(actif / maxActif * 100);
    const overloaded = pct >= 85;

    // Trouver le rôle depuis localUsers
    const userObj  = (localUsers || []).find(u => (u.label || u.username) === op);
    const roleLabel = userObj ? (ROLE_LABELS_LOCAL[userObj.role] || userObj.role) : '';

    const avatar = op.charAt(0).toUpperCase();
    const barColor = overloaded ? 'var(--color-danger)' : actif > 0 ? 'var(--color-primary)' : '#d6d3d1';

    // Construire les lignes de tâches (en cours d'abord, puis à faire, puis terminées)
    const renderTaskRows = (list, statut) => list.map(t => {
      const isEC   = statut === 'EN_COURS';
      const isDone = statut === 'TERMINE';
      const etape  = t.dossierId === 'LIBRE'
        ? { color:'#7c3aed', label: t.titre || 'Tâche libre' }
        : (ETAPES_CONFIG.find(e => e.code === t.etapeCode) || { color:'#888', label: t.etapeLabel || '?' });
      const dotBg  = isEC ? '#d97706' : isDone ? '#16a34a' : '#2563eb';
      const d = dossiers.find(x => x.id === t.dossierId);
      const isUrgent = d?.priorite === 'Urgente';
      const btn = isEC && (isAdminOrChef || _sameOp(op, myLabel))
        ? `<button class="charge-task-btn" onclick="openPointage('${t.id}','${t.etapeCode||''}','${(t.numeroDossier||t.titre||'').replace(/'/g,"\\'")}'); event.stopPropagation();" style="background:var(--color-success-bg);color:var(--color-success)"></button>`
        : t.statut === 'A_FAIRE' && (isAdminOrChef || _sameOp(op, myLabel))
          ? `<button class="charge-task-btn" onclick="pointerStart('${t.id}'); event.stopPropagation();" style="background:var(--color-primary-light);color:var(--color-primary)">▶</button>`
          : '';
      return `<div class="charge-task-row ${isEC?'charge-task-row--encours':''} ${isDone?'charge-task-row--done':''}" onclick="openAttribForDossier('${t.dossierId}')">
        <span class="charge-task-dot" style="background:${dotBg}"></span>
        <span class="charge-task-etape" style="color:${etape.color}">${etape.label}${isUrgent?'&nbsp;<span style="color:var(--color-danger);font-size:9px;font-weight:800">⬤</span>':''}</span>
        <span class="charge-task-num">${t.dossierId==='LIBRE'?'Libre':(t.numeroDossier||'')}</span>
        ${btn}
      </div>`;
    }).join('');

    const enCoursSection = enCours.length ? `
      <div class="charge-section-hd" style="color:var(--color-warning)">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--color-warning);display:inline-block"></span>
        En cours (${enCours.length})
      </div>
      ${renderTaskRows(enCours,'EN_COURS')}` : '';

    const aFaireSection = aFaire.length ? `
      <div class="charge-section-hd" style="color:var(--color-info)">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--color-info);display:inline-block"></span>
        À faire (${aFaire.length})
      </div>
      ${renderTaskRows(aFaire,'A_FAIRE')}` : '';

    const termineSection = termine.length ? `
      <div class="charge-section-hd" style="color:var(--color-text-muted)">
        <span style="width:7px;height:7px;border-radius:50%;background:#d6d3d1;display:inline-block"></span>
        Terminées (${termine.length})
      </div>
      ${renderTaskRows(termine.slice(-3),'TERMINE')}
      ${termine.length > 3 ? `<div style="font-size:11px;color:var(--color-text-muted);padding:2px 7px">+${termine.length-3} autres terminées</div>` : ''}` : '';

    const emptyHtml = !actif && !termine.length
      ? `<div class="charge-card__empty">Aucune tâche assignée</div>` : '';

    return `<div class="charge-card ${overloaded?'charge-card--overloaded':''} ${actif===0?'charge-card--idle':''}">
      <div class="charge-card__header">
        <div class="charge-card__top">
          <div class="charge-card__avatar">${avatar}</div>
          <div>
            <div class="charge-card__name">${op}</div>
            ${roleLabel?`<div class="charge-card__role">${roleLabel}</div>`:''}
          </div>
          ${overloaded?`<span style="margin-left:auto;font-size:9px;font-weight:700;background:var(--color-danger-bg);color:var(--color-danger);padding:2px 7px;border-radius:8px;white-space:nowrap">Surchargé</span>`:''}
        </div>
        <div class="charge-card__bar-row">
          <span class="charge-card__bar-lbl">Charge</span>
          <span class="charge-card__bar-count" style="color:${barColor}">${actif} tâche${actif>1?'s':''} active${actif>1?'s':''}</span>
        </div>
        <div class="charge-card__bar-bg">
          <div class="charge-card__bar-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
      </div>
      <div class="charge-card__kpis">
        <div class="charge-kpi-cell">
          <div class="charge-kpi-cell__val" style="color:var(--color-info)">${aFaire.length}</div>
          <div class="charge-kpi-cell__lbl">À faire</div>
        </div>
        <div class="charge-kpi-cell">
          <div class="charge-kpi-cell__val" style="color:var(--color-warning)">${enCours.length}</div>
          <div class="charge-kpi-cell__lbl">En cours</div>
        </div>
        <div class="charge-kpi-cell">
          <div class="charge-kpi-cell__val" style="color:var(--color-success)">${termine.length}</div>
          <div class="charge-kpi-cell__lbl">Terminées</div>
        </div>
      </div>
      <div class="charge-card__tasks">
        ${enCoursSection}${aFaireSection}${termineSection}${emptyHtml}
      </div>
    </div>`;
  }).join('');

  container.innerHTML = kpiHtml + `<div class="charge-grid">${cards}</div>`;
}

function _buildOpWorkload() {
  const isAdminOrChef = ['admin','chef_atelier'].includes(currentUser?.role);
  if (!isAdminOrChef) return '';
  const counts = {};
  [...taches, ...tachesLibres].forEach(t => {
    if (t.statut === 'TERMINE' || !t.operateur) return;
    if (!counts[t.operateur]) counts[t.operateur] = { aFaire:0, enCours:0 };
    if (t.statut === 'A_FAIRE')   counts[t.operateur].aFaire++;
    else if (t.statut === 'EN_COURS') counts[t.operateur].enCours++;
  });
  const ops = Object.entries(counts);
  if (!ops.length) return '';
  const maxCount = Math.max(...ops.map(([,v]) => v.aFaire + v.enCours), 1);

  const cards = ops.sort((a,b) => (b[1].aFaire+b[1].enCours)-(a[1].aFaire+a[1].enCours)).map(([name, v]) => {
    const total      = v.aFaire + v.enCours;
    const pct        = Math.round(total / maxCount * 100);
    const overloaded = pct >= 85;
    const avatar     = name.charAt(0).toUpperCase();
    return `<div class="op-workload-card ${overloaded?'op-workload-card--overloaded':''}">
      <div class="op-workload-card__avatar">${avatar}</div>
      <div class="op-workload-card__name">${name}</div>
      <div class="op-workload-card__count">${total}</div>
      <div class="op-workload-card__sub">tâches actives</div>
      <div class="op-workload-bar-bg"><div class="op-workload-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  return `<div class="op-workload-section">
    <div class="op-workload-title">Charge opérateurs</div>
    <div class="op-workload-row">${cards}</div>
  </div>`;
}

function renderTaches() {
  const container = document.getElementById('tachesContainer');
  if (!container) return;

  if (_prodView === 'charge') {
    _renderChargeView();
    return;
  }

  // Mettre à jour la barre charge opérateurs
  const wlEl = document.getElementById('opWorkloadContainer');
  if (wlEl) wlEl.innerHTML = _buildOpWorkload();

  const dash          = _buildMonDashboard();
  const isAdminOrChef = ['admin','chef_atelier'].includes(currentUser?.role);
  const myLabel       = currentUser?.label || currentUser?.username || '';

  // Peupler le sélecteur d'années depuis les tâches
  _populateYearSel('prodYearSel', [...taches, ...tachesLibres].map(t => t.dateAssignation));

  let dossierList = isAdminOrChef ? taches : taches.filter(t => _sameOp(t.operateur, myLabel));
  if (prodFilter === 'EN_RETARD') dossierList = dossierList.filter(t => _getTacheRetardInfo(t).isRetard);
  else if (prodFilter !== 'TOUS') dossierList = dossierList.filter(t => t.statut === prodFilter);
  if (prodDateFilter.mois || prodDateFilter.annee)
    dossierList = dossierList.filter(t => _matchDateFilter(t.dateAssignation, prodDateFilter));

  let libreList = isAdminOrChef ? tachesLibres : tachesLibres.filter(t => _sameOp(t.operateur, myLabel));
  if (prodFilter === 'EN_RETARD') libreList = [];
  else if (prodFilter !== 'TOUS') libreList = libreList.filter(t => t.statut === prodFilter);
  if (prodDateFilter.mois || prodDateFilter.annee)
    libreList = libreList.filter(t => _matchDateFilter(t.dateAssignation, prodDateFilter));

  // Mettre à jour les compteurs dans les boutons filtre (sur données non filtrées par date)
  const allVisible = [...taches, ...tachesLibres].filter(t => isAdminOrChef || _sameOp(t.operateur, myLabel));
  const retardCount = taches.filter(t => (isAdminOrChef || _sameOp(t.operateur, myLabel)) && _getTacheRetardInfo(t).isRetard).length;
  const _cnt = s => s === 'EN_RETARD' ? retardCount : allVisible.filter(t => s==='TOUS'||t.statut===s).length;
  ['TOUS','A_FAIRE','EN_COURS','TERMINE','EN_RETARD'].forEach(s => {
    const sfx = {'TOUS':'Tous','A_FAIRE':'AFaire','EN_COURS':'EnCours','TERMINE':'Termine','EN_RETARD':'Retard'}[s];
    const el  = document.getElementById(`prodCount${sfx}`);
    if (el) { el.textContent = _cnt(s); el.style.display = _cnt(s)?'':'none'; }
  });

  if (!dossierList.length && !libreList.length) {
    container.innerHTML = dash + `<div style="display:flex;flex-direction:column;align-items:center;padding:64px 0;text-align:center">
      <div style="width:44px;height:44px;background:var(--color-bg);border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:12px">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <p style="font-size:13px;font-weight:500;color:var(--color-text-secondary)">Aucune tâche${prodFilter!=='TOUS'?' dans ce filtre':''}</p>
    </div>`;
    return;
  }

  // Section tâches libres
  const libreHtml = libreList.length ? `
    <div class="prod-group" style="border-color:#e9d5ff">
      <div class="prod-group-header" style="background:#faf5ff">
        <div class="prod-group-left">
          <span style="font-size:14px;color:#7c3aed"></span>
          <span class="prod-group-info" style="color:#7c3aed">Tâches indépendantes</span>
        </div>
        <span style="background:#f3e8ff;color:#7c3aed;font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px">${libreList.length}</span>
      </div>
      <div class="prod-group-tasks">${libreList.map(_tacheRow).join('')}</div>
    </div>` : '';

  // Grouper par dossier
  const groups = {};
  dossierList.forEach(t => {
    if (!groups[t.dossierId]) groups[t.dossierId] = { numeroDossier:t.numeroDossier, taches:[] };
    groups[t.dossierId].taches.push(t);
  });

  const groupsHtml = Object.entries(groups).map(([dossierId, g]) => {
    const d          = dossiers.find(x => x.id === dossierId);
    const isUrgent   = d?.priorite === 'Urgente';
    const isHaute    = d?.priorite === 'Haute';
    const prio       = isUrgent?`<span style="background:#fee2e2;color:#dc2626;font-size:9px;font-weight:700;padding:1px 5px;border-radius:6px">URGENT</span>`:isHaute?`<span style="background:#fef3c7;color:#d97706;font-size:9px;font-weight:700;padding:1px 5px;border-radius:6px">HAUTE</span>`:'';
    const client     = d?.client ? `<span class="prod-group-info">${d.client}</span>` : '';
    const produit    = d?.produit ? `<span style="font-size:11px;color:var(--color-text-secondary)">${d.produit}</span>` : '';
    const borderClr  = isUrgent?'#fca5a5':isHaute?'#fcd34d':'var(--color-border)';
    const doneCount  = g.taches.filter(t=>t.statut==='TERMINE').length;
    const total      = g.taches.length;
    return `<div class="prod-group" style="border-color:${borderClr}">
      <div class="prod-group-header">
        <div class="prod-group-left" style="min-width:0">
          <span class="prod-group-num">${g.numeroDossier}</span>
          ${prio}
          ${client}
          ${produit}
        </div>
        <span style="font-size:11px;font-weight:600;color:var(--color-text-muted);flex-shrink:0">${doneCount}/${total}</span>
      </div>
      <div style="padding:8px 10px 0">${_buildProgressBar(dossierId)}</div>
      <div class="prod-group-tasks">${g.taches.map(_tacheRow).join('')}</div>
    </div>`;
  }).join('');

  container.innerHTML = dash + libreHtml + groupsHtml;
}

async function pointerStart(tacheId) {
  const isLibre = tacheId.startsWith('TL_');
  const isAdminOrChef = ['admin','chef_atelier'].includes(currentUser?.role);
  const t = isLibre ? tachesLibres.find(x => x.id === tacheId) : taches.find(x => x.id === tacheId);
  if (!t) return;
  // Guard 1 : seul l'opérateur assigné (ou admin/chef) peut démarrer la tâche
  if (!isAdminOrChef && !_sameOp(t.operateur, currentUser?.label)) {
    showToast('Vous ne pouvez pas démarrer une tâche qui ne vous est pas assignée.', 'error');
    return;
  }
  // Guard 2 : toutes les étapes précédentes du même dossier doivent être terminées
  if (!isLibre) {
    const si = ETAPES_CONFIG.findIndex(e => e.code === t.etapeCode);
    for (let i = 0; i < si; i++) {
      const prev = ETAPES_CONFIG[i];
      const pt = taches.filter(x => x.dossierId === t.dossierId && x.etapeCode === prev.code);
      if (pt.length && !pt.every(x => x.statut === 'TERMINE')) {
        showToast(`Impossible de démarrer : "${prev.label}" n'est pas encore terminée.`, 'error');
        return;
      }
    }
  }
  let r;
  if (APPS_SCRIPT_URL && !isLibre) { r = await apiCall({ action:'pointerAction', tacheId, action_:'START' }); }
  else { r = { ok:true }; }
  if (r && r.ok) {
    if (t) { t.statut = 'EN_COURS'; t.dateDebut = new Date().toLocaleString('fr-FR'); }
    if (isLibre) saveTachesLibres(); else saveTaches();
    // Notification de début de tâche visible par tous
    _addNotification({
      dossierId:     t.dossierId,
      numeroDossier: isLibre ? 'Tâche libre' : t.numeroDossier,
      etapeCode:     isLibre ? 'LIBRE' : t.etapeCode,
      etapeLabel:    isLibre ? t.titre : t.etapeLabel,
      operateur:     currentUser?.label || t.operateur,
      message:       isLibre
        ? `${currentUser?.label} a commencé la tâche libre "${t.titre}"`
        : `${currentUser?.label} a commencé l'étape "${t.etapeLabel}" — dossier ${t.numeroDossier}`,
    });
    renderTaches();
    showToast('Tâche démarrée');
  }
}

function openPointage(tacheId, etapeCode, numeroDossier) {
  pendingPointage = { tacheId, etapeCode, numeroDossier };
  document.getElementById('pointageContextText').textContent =
    `${numeroDossier} — ${ETAPES_CONFIG.find(e=>e.code===etapeCode)?.label || etapeCode}`;
  document.getElementById('pointageCommentInput').value = '';
  openModal('pointageModal');
}

async function confirmPointage() {
  if (!pendingPointage) return;
  const { tacheId, etapeCode } = pendingPointage;
  const isLibre = tacheId.startsWith('TL_');
  const isAdminOrChef = ['admin','chef_atelier'].includes(currentUser?.role);
  // Vérifier que l'utilisateur courant est l'opérateur assigné ou admin/chef
  const tCheck = isLibre ? tachesLibres.find(x => x.id === tacheId) : taches.find(x => x.id === tacheId);
  if (tCheck && !isAdminOrChef && tCheck.operateur !== currentUser?.label) {
    showToast('Vous ne pouvez pas terminer une tâche qui ne vous est pas assignée.', 'error');
    closeModal('pointageModal');
    return;
  }
  const comment = document.getElementById('pointageCommentInput').value;
  let r;
  if (APPS_SCRIPT_URL && !isLibre) { r = await apiCall({ action:'pointerAction', tacheId, action_:'END', etapeCode, commentaire:comment }); }
  else { r = { ok:true }; }
  if (r && r.ok) {
    const t = isLibre ? tachesLibres.find(x => x.id === tacheId) : taches.find(x => x.id === tacheId);
    if (t) { t.statut = 'TERMINE'; t.dateFin = new Date().toLocaleDateString('fr-FR'); t.commentaire = comment || t.commentaire; }
    if (isLibre) saveTachesLibres(); else saveTaches();

    // Vérifier si le dossier est maintenant complet à 100%
    let dossierComplet = false;
    if (!isLibre && t) {
      const tachesD = taches.filter(x => x.dossierId === t.dossierId);
      // Calculer le même pct que _buildProgressBar : chaque étape compte 1 si TOUS ses opérateurs ont terminé
      let doneCount = 0;
      for (const e of ETAPES_CONFIG) {
        const te = tachesD.filter(x => x.etapeCode === e.code);
        if (te.length > 0 && te.every(x => x.statut === 'TERMINE')) doneCount++;
      }
      const pct = Math.round(doneCount / ETAPES_CONFIG.length * 100);
      if (pct === 100) {
        dossierComplet = true;
        // Mettre à jour le statut du dossier
        const d = dossiers.find(x => x.id === t.dossierId);
        if (d) { d.statut = 'LIVRE'; d.progression = 100; }
      }
    }

    // Notification d'avancement visible par tous
    if (t) {
      _addNotification({
        dossierId:     t.dossierId,
        numeroDossier: isLibre ? 'Tâche libre' : t.numeroDossier,
        etapeCode:     isLibre ? 'LIBRE' : t.etapeCode,
        etapeLabel:    isLibre ? t.titre : t.etapeLabel,
        operateur:     currentUser?.label || t.operateur,
        message:       dossierComplet
          ? `Dossier ${t.numeroDossier} terminé à 100% — toutes les étapes sont complètes`
          : isLibre
          ? `${currentUser?.label} a terminé la tâche libre "${t.titre}"`
          : `${currentUser?.label} a terminé l'étape "${t.etapeLabel}" — dossier ${t.numeroDossier}`,
      });
    }
    renderTaches();
    closeModal('pointageModal');
    showToast(dossierComplet ? 'Dossier complet à 100% — prêt à livrer !' : 'Tâche terminée ');
  }
}

// ============================================================
// STATS — KPI production (appelé depuis showPage via _loadProdStats)
// ============================================================
async function _loadProdStats() {
  if (APPS_SCRIPT_URL) {
    const r = await apiCall({ action:'getDashboard' });
    if (r && r.ok) renderProdKpis(r);
  } else {
    renderProdKpis({
      ventes:    { total:485000, nb:12 },
      dossiers:  { total:8, cree:3, enCours:4, livre:1 },
      operateurs:[{ nom:'Marie', aFaire:2, enCours:1, termine:5 }, { nom:'Jean', aFaire:1, enCours:2, termine:3 }]
    });
  }
}

function renderProdKpis(data) {
  const block = document.getElementById('prodStatsBlock');
  if (!block) return;
  const { dossiers:d, operateurs:ops } = data;
  block.innerHTML = `
    <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--color-border)">
      <h2 style="font-size:15px;font-weight:700;color:var(--color-text-primary);margin-bottom:14px">Production</h2>
      <div class="kpi-grid-mini">
        <div class="kpi-card-mini"><div class="kpi-mini-label">Total dossiers</div><div class="kpi-mini-val">${d?.total||0}</div></div>
        <div class="kpi-card-mini"><div class="kpi-mini-label">Créés</div><div class="kpi-mini-val" style="color:var(--color-info)">${d?.cree||0}</div></div>
        <div class="kpi-card-mini"><div class="kpi-mini-label">En cours</div><div class="kpi-mini-val" style="color:var(--color-warning)">${d?.enCours||0}</div></div>
        <div class="kpi-card-mini"><div class="kpi-mini-label">Livrés</div><div class="kpi-mini-val" style="color:var(--color-success)">${d?.livre||0}</div></div>
      </div>
      ${ops?.length ? `
      <div style="margin-top:14px">
        <div style="font-size:13px;font-weight:600;color:var(--color-text-primary);margin-bottom:8px">Charge opérateurs</div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;overflow:hidden">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid var(--color-border)">
              <th style="text-align:left;padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--color-text-muted)">Opérateur</th>
              <th style="text-align:center;padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--color-text-muted)">À faire</th>
              <th style="text-align:center;padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--color-text-muted)">En cours</th>
              <th style="text-align:center;padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--color-text-muted)">Terminé</th>
            </tr></thead>
            <tbody>
              ${ops.map(o=>`<tr style="border-bottom:1px solid var(--color-border)">
                <td style="padding:8px 12px;font-size:13px;font-weight:600;color:var(--color-text-primary)">${o.nom}</td>
                <td style="padding:8px 12px;text-align:center"><span class="prod-badge" style="background:var(--color-info-bg);color:var(--color-info)">${o.aFaire}</span></td>
                <td style="padding:8px 12px;text-align:center"><span class="prod-badge" style="background:var(--color-warning-bg);color:var(--color-warning)">${o.enCours}</span></td>
                <td style="padding:8px 12px;text-align:center"><span class="prod-badge" style="background:var(--color-success-bg);color:var(--color-success)">${o.termine}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
    </div>`;
}

// ============================================================
// PATRON DASHBOARD — Vue globale admin
// ============================================================
let _lastPatronRefresh = 0;

async function _autoRefreshPatron() {
  if (!APPS_SCRIPT_URL) { renderPatronDashboard(); return; }
  const now = Date.now();
  if (now - _lastPatronRefresh < 45000) return;
  _lastPatronRefresh = now;
  try {
    const [rT, rD] = await Promise.all([
      apiCall({ action: 'getTaches' }),
      apiCall({ action: 'getDossiers', statut: 'TOUS' }),
    ]);
    if (rT && rT.ok && Array.isArray(rT.taches) && rT.taches.length > 0) {
      const ids = new Set(rT.taches.map(t => t.id));
      taches = [...rT.taches, ...taches.filter(t => !ids.has(t.id))];
    }
    if (rD && rD.ok && Array.isArray(rD.dossiers)) {
      dossiers = rD.dossiers;
      _ensureDossierLinks();
    }
  } catch(e) {}
  renderPatronDashboard();
}

async function refreshPatronDashboard(btn) {
  _lastPatronRefresh = 0;
  if (btn) { btn.disabled = true; document.getElementById('patronRefreshIcon').style.animation = 'spin .8s linear infinite'; }
  await _autoRefreshPatron();
  if (btn) { btn.disabled = false; document.getElementById('patronRefreshIcon').style.animation = ''; }
  showToast('Tableau de bord actualisé');
}

function renderPatronDashboard() {
  const body = document.getElementById('patronDashboardBody');
  if (!body) return;

  // ── Données de base ──
  const now       = new Date();
  const todayStr  = now.toDateString();
  const monthKey  = now.toISOString().slice(0, 7);
  const weekAgo   = new Date(now - 7 * 864e5);

  const todaySales  = sales.filter(s => { const d = parseSaleDate(s.date); return d && d.toDateString() === todayStr; });
  const monthSales  = sales.filter(s => saleDateKey(s.date).startsWith(monthKey));
  const totalToday  = todaySales.reduce((a, s) => a + (Number(s.total) || 0), 0);
  const totalMonth  = monthSales.reduce((a, s) => a + (Number(s.total) || 0), 0);
  const totalCreances = sales.reduce((a, s) => a + (Number(s.due) || 0), 0);
  const nbCreances  = sales.filter(s => (Number(s.due) || 0) > 0).length;
  const pendingRes  = reservations.filter(r => r.status === 'pending');
  const pendingCmd  = commandes.filter(c => c.status === 'pending');
  const dossiersActifs = dossiers.filter(d => d.statut !== 'LIVRE');
  const stockAlertes = products.filter(p => p.stock <= p.minStock && p.stock >= 0);
  const resCreances  = reservations.filter(r => (Number(r.restant) || 0) > 0 && r.status === 'pending');
  const totalResCreances = resCreances.reduce((a, r) => a + (Number(r.restant) || 0), 0);

  // Mise à jour sous-titre
  const subEl = document.getElementById('patronSubtitle');
  if (subEl) subEl.textContent = now.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const lastEl = document.getElementById('patronLastRefresh');
  if (lastEl) lastEl.textContent = 'Mis à jour à ' + now.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });

  // ── KPI ──
  const kpiHtml = `
  <div class="pdb-kpi-grid">
    ${_pdbKpi('Ventes aujourd\'hui', fmt(totalToday), todaySales.length + ' transaction' + (todaySales.length > 1 ? 's' : ''), '#1a4a3a')}
    ${_pdbKpi('Ventes ce mois', fmt(totalMonth), monthSales.length + ' transactions', '#2563eb')}
    ${_pdbKpi('Dossiers actifs', dossiersActifs.length, dossiers.filter(d => d.priorite === 'Urgente').length + ' urgent(s)', '#d97706')}
    ${_pdbKpi('Réservations', pendingRes.length, 'en attente', '#7c3aed')}
    ${_pdbKpi('Commandes', pendingCmd.length, 'en attente', '#0891b2')}
    ${_pdbKpi('Créances', fmt(totalCreances + totalResCreances), nbCreances + resCreances.length + ' dossier(s)', '#dc2626')}
    ${_pdbKpi('Stock alertes', stockAlertes.length, 'sous seuil minimum', '#ea580c')}
    ${_pdbKpi('Tâches en cours', taches.filter(t => t.statut === 'EN_COURS').length + tachesLibres.filter(t => t.statut === 'EN_COURS').length, 'tous opérateurs', '#16a34a')}
  </div>`;

  // ── Ventes par caissier (ce mois) ──
  const byCaissier = {};
  monthSales.forEach(s => {
    const c = s.caissier || 'Inconnu';
    if (!byCaissier[c]) byCaissier[c] = { nb: 0, total: 0 };
    byCaissier[c].nb++;
    byCaissier[c].total += Number(s.total) || 0;
  });
  const caissierList = Object.entries(byCaissier).sort((a, b) => b[1].total - a[1].total);
  const maxCaissier  = Math.max(...caissierList.map(c => c[1].total), 1);
  const caissierRows = caissierList.length
    ? caissierList.map(([nom, d]) => {
        const pct = Math.round(d.total / maxCaissier * 100);
        const moy = d.nb ? Math.round(d.total / d.nb) : 0;
        return `<tr>
          <td><span style="font-weight:600">${nom}</span></td>
          <td style="text-align:center"><span style="background:#e8f4f0;color:#1a4a3a;padding:2px 8px;border-radius:12px;font-weight:700;font-size:11px">${d.nb}</span></td>
          <td><div class="pdb-bar-wrap"><div class="pdb-bar-fill" style="width:${pct}%"></div></div>${fmt(d.total)}</td>
          <td style="color:#78716c">${fmt(moy)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="4"><div class="pdb-empty"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:.4"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>Aucune vente ce mois</div></td></tr>`;

  const caissierHtml = `
  <div class="pdb-section">
    <div class="pdb-section-head">
      <div><div class="pdb-section-title">Ventes par caissier — ce mois</div><div class="pdb-section-sub">${monthSales.length} transactions · ${fmt(totalMonth)}</div></div>
      <span class="pdb-section-badge" style="background:#e8f4f0;color:#1a4a3a">${caissierList.length} caissier(s)</span>
    </div>
    <table class="pdb-table">
      <thead><tr><th>Caissier</th><th style="text-align:center">Nb ventes</th><th>Total (Ar)</th><th>Panier moyen</th></tr></thead>
      <tbody>${caissierRows}</tbody>
    </table>
  </div>`;

  // ── Charge opérateurs ──
  const allTaches = [...taches, ...tachesLibres];
  const opMap = {};
  allTaches.forEach(t => {
    if (!t.operateur) return;
    if (!opMap[t.operateur]) opMap[t.operateur] = { aFaire: 0, enCours: 0, termine: 0, total: 0 };
    opMap[t.operateur].total++;
    if (t.statut === 'A_FAIRE')  opMap[t.operateur].aFaire++;
    if (t.statut === 'EN_COURS') opMap[t.operateur].enCours++;
    if (t.statut === 'TERMINE')  opMap[t.operateur].termine++;
  });
  const opList = Object.entries(opMap).sort((a, b) => b[1].enCours - a[1].enCours);
  const opRows = opList.length
    ? opList.map(([nom, d]) => {
        const pct = d.total ? Math.round(d.termine / d.total * 100) : 0;
        return `<tr>
          <td><span style="font-weight:600">${nom}</span></td>
          <td style="text-align:center"><span style="background:#dbeafe;color:#2563eb;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:700">${d.aFaire}</span></td>
          <td style="text-align:center"><span style="background:#fef3c7;color:#d97706;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:700">${d.enCours}</span></td>
          <td style="text-align:center"><span style="background:#dcfce7;color:#16a34a;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:700">${d.termine}</span></td>
          <td><div class="pdb-bar-wrap" style="width:100px"><div class="pdb-bar-fill" style="width:${pct}%;background:${pct===100?'#16a34a':'#1a4a3a'}"></div></div><span style="font-size:11px;color:#78716c">${pct}%</span></td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="5"><div class="pdb-empty">Aucune tâche assignée</div></td></tr>`;

  const opsHtml = `
  <div class="pdb-section">
    <div class="pdb-section-head">
      <div><div class="pdb-section-title">Charge des opérateurs</div><div class="pdb-section-sub">${allTaches.length} tâches au total</div></div>
      <span class="pdb-section-badge" style="background:#fef3c7;color:#d97706">${allTaches.filter(t=>t.statut==='EN_COURS').length} en cours</span>
    </div>
    <table class="pdb-table">
      <thead><tr><th>Opérateur</th><th style="text-align:center">À faire</th><th style="text-align:center">En cours</th><th style="text-align:center">Terminé</th><th>Avancement</th></tr></thead>
      <tbody>${opRows}</tbody>
    </table>
  </div>`;

  // ── Suivi dossiers de production ──
  const urgents = dossiersActifs.filter(d => d.priorite === 'Urgente');
  const dossierRows = dossiersActifs.length
    ? dossiersActifs.slice(0, 15).map(d => {
        const pct  = d.progression || 0;
        const etape = ETAPES_CONFIG?.find(e => e.code === d.statut);
        const etapeLabel = etape?.short || d.statut || '—';
        const etapeColor = etape?.color || '#1a4a3a';
        const urgBadge = d.priorite === 'Urgente' ? '<span style="background:#fee2e2;color:#dc2626;font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px;margin-left:4px">URGENT</span>' : '';
        const pctColor = pct === 100 ? '#16a34a' : pct > 0 ? '#d97706' : '#a8a29e';
        return `<div class="pdb-dossier-row">
          <div style="min-width:90px"><span style="font-size:11px;font-weight:700;color:#1a4a3a">${d.numeroDossier}</span>${urgBadge}</div>
          <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:#1c1917;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d.client || '—'}</div><div style="font-size:11px;color:#78716c">${d.produit || ''}</div></div>
          <div style="min-width:70px;text-align:right"><span style="background:${etapeColor}18;color:${etapeColor};font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px">${etapeLabel}</span></div>
          <div style="min-width:110px;display:flex;align-items:center;gap:6px">
            <div class="pdb-prog-wrap"><div class="pdb-prog-fill" style="width:${pct}%;background:${pctColor}"></div></div>
            <span style="font-size:11px;font-weight:700;color:${pctColor};min-width:28px">${pct}%</span>
          </div>
        </div>`;
      }).join('')
    : `<div class="pdb-empty"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:.4"><polyline points="20 6 9 17 4 12"/></svg>Aucun dossier actif</div>`;

  const prodHtml = `
  <div class="pdb-section">
    <div class="pdb-section-head">
      <div><div class="pdb-section-title">Suivi des dossiers de production</div><div class="pdb-section-sub">${dossiersActifs.length} dossier(s) actif(s)</div></div>
      ${urgents.length ? `<span class="pdb-section-badge" style="background:#fee2e2;color:#dc2626">${urgents.length} urgent(s)</span>` : `<span class="pdb-section-badge" style="background:#dcfce7;color:#16a34a">Aucun urgent</span>`}
    </div>
    <div>${dossierRows}</div>
    ${dossiersActifs.length > 15 ? `<div style="text-align:center;padding:10px;font-size:12px;color:#78716c">+ ${dossiersActifs.length - 15} autres dossiers — voir page Attribution</div>` : ''}
  </div>`;

  // ── Réservations en attente ──
  const resRows = pendingRes.length
    ? pendingRes.slice(0, 8).map(r => {
        const items = (r.items || []).slice(0, 2).map(i => `${i.name} ×${i.qty}`).join(', ');
        const tag = r.clientType === 'corporate'
          ? `<span style="background:#dbeafe;color:#2563eb;font-size:9px;font-weight:700;padding:1px 5px;border-radius:6px">CORP</span>`
          : '';
        return `<div style="padding:9px 14px;border-bottom:1px solid #fafaf9;font-size:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div><span style="font-weight:700">${r.clientName || '—'}</span> ${tag} <span style="color:#78716c;font-size:11px">${items}</span></div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-weight:700;color:#1a4a3a">${fmt(r.total)}</div>
              <div style="font-size:10px;color:#dc2626">Reste : ${fmt(r.restant || 0)}</div>
            </div>
          </div>
        </div>`;
      }).join('')
    : `<div class="pdb-empty">Aucune réservation en attente</div>`;

  // ── Commandes en attente ──
  const cmdRows = pendingCmd.length
    ? pendingCmd.slice(0, 8).map(c => {
        const items = (c.items || []).slice(0, 2).map(i => `${i.name} ×${i.qty}`).join(', ');
        const tag = c.clientType === 'corporate'
          ? `<span style="background:#dbeafe;color:#2563eb;font-size:9px;font-weight:700;padding:1px 5px;border-radius:6px">CORP</span>`
          : '';
        return `<div style="padding:9px 14px;border-bottom:1px solid #fafaf9;font-size:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div><span style="font-weight:700">${c.clientName || '—'}</span> ${tag} <span style="color:#78716c;font-size:11px">${items}</span></div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-weight:700;color:#1a4a3a">${fmt(c.total)}</div>
              <div style="font-size:10px;color:#78716c">Reste : ${fmt(c.restant || 0)}</div>
            </div>
          </div>
        </div>`;
      }).join('')
    : `<div class="pdb-empty">Aucune commande en attente</div>`;

  const resCmdHtml = `
  <div class="pdb-two-col">
    <div class="pdb-section">
      <div class="pdb-section-head">
        <div><div class="pdb-section-title">Réservations en attente</div></div>
        <span class="pdb-section-badge" style="background:#f3e8ff;color:#7c3aed">${pendingRes.length}</span>
      </div>
      ${resRows}
    </div>
    <div class="pdb-section">
      <div class="pdb-section-head">
        <div><div class="pdb-section-title">Commandes en attente</div></div>
        <span class="pdb-section-badge" style="background:#e0f2fe;color:#0891b2">${pendingCmd.length}</span>
      </div>
      ${cmdRows}
    </div>
  </div>`;

  // ── Alertes stock ──
  const stockRows = stockAlertes.length
    ? stockAlertes.map(p => {
        const pct = p.minStock > 0 ? Math.min(100, Math.round(p.stock / p.minStock * 100)) : 0;
        const col = p.stock === 0 ? '#dc2626' : p.stock <= p.minStock ? '#d97706' : '#16a34a';
        return `<tr>
          <td><span style="font-weight:600">${p.name}</span></td>
          <td style="text-align:center"><span style="font-weight:700;color:${col};font-size:13px">${p.stock}</span></td>
          <td style="text-align:center;color:#78716c">${p.minStock}</td>
          <td>${p.stock === 0 ? '<span style="background:#fee2e2;color:#dc2626;font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px">RUPTURE</span>' : '<span style="background:#fef3c7;color:#d97706;font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px">BAS</span>'}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="4"><div class="pdb-empty" style="padding:20px">Aucune alerte stock</div></td></tr>`;

  const stockHtml = `
  <div class="pdb-section">
    <div class="pdb-section-head">
      <div><div class="pdb-section-title">Alertes stock</div><div class="pdb-section-sub">Articles sous seuil minimum</div></div>
      <span class="pdb-section-badge" style="background:${stockAlertes.length ? '#fee2e2' : '#dcfce7'};color:${stockAlertes.length ? '#dc2626' : '#16a34a'}">${stockAlertes.length} article(s)</span>
    </div>
    <table class="pdb-table">
      <thead><tr><th>Article</th><th style="text-align:center">Stock actuel</th><th style="text-align:center">Seuil min</th><th>Statut</th></tr></thead>
      <tbody>${stockRows}</tbody>
    </table>
  </div>`;

  // ── Créances (ventes + réservations) ──
  const creanceSales = sales.filter(s => (Number(s.due) || 0) > 0).slice(0, 6);
  const creanceRows = [...creanceSales.map(s => ({
    nom: s.clientName || '—', contact: s.clientContact || '', montant: s.total, restant: Number(s.due) || 0, date: s.date, type: 'Vente'
  })), ...resCreances.slice(0, 6).map(r => ({
    nom: r.clientName || '—', contact: r.clientContact || '', montant: r.total, restant: Number(r.restant) || 0, date: r.date, type: 'Réservation'
  }))].sort((a, b) => b.restant - a.restant);

  const creanceHtml = creanceRows.length
    ? creanceRows.map(c => `<tr>
        <td><span style="font-weight:600">${c.nom}</span>${c.contact ? `<div style="font-size:10px;color:#78716c">${c.contact}</div>` : ''}</td>
        <td><span style="background:${c.type==='Vente'?'#e8f4f0':'#f3e8ff'};color:${c.type==='Vente'?'#1a4a3a':'#7c3aed'};font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px">${c.type}</span></td>
        <td style="text-align:right">${fmt(c.montant)}</td>
        <td style="text-align:right"><span style="font-weight:700;color:#dc2626">${fmt(c.restant)}</span></td>
      </tr>`).join('')
    : `<tr><td colspan="4"><div class="pdb-empty">Aucune créance</div></td></tr>`;

  const totalCr = creanceRows.reduce((a, c) => a + c.restant, 0);
  const creancesHtml = `
  <div class="pdb-section">
    <div class="pdb-section-head">
      <div><div class="pdb-section-title">Créances — Restes à encaisser</div><div class="pdb-section-sub">Total : ${fmt(totalCr)}</div></div>
      <span class="pdb-section-badge" style="background:#fee2e2;color:#dc2626">${creanceRows.length} dossier(s)</span>
    </div>
    <table class="pdb-table">
      <thead><tr><th>Client</th><th>Type</th><th style="text-align:right">Total</th><th style="text-align:right">Reste dû</th></tr></thead>
      <tbody>${creanceHtml}</tbody>
    </table>
  </div>`;

  // ── Activité récente (timeline) ──
  const events = [
    ...sales.slice(0, 20).map(s => ({ ts: new Date(s.date||0), label: `Vente #${s.id} — ${s.clientName||'Client'} — ${fmt(s.total)}`, sub: `Caissier : ${s.caissier||'—'}`, color: '#16a34a' })),
    ...reservations.slice(0, 10).map(r => ({ ts: new Date(r.date||0), label: `Réservation — ${r.clientName||'Client'} — ${fmt(r.total)}`, sub: `Acompte : ${fmt(r.accompte)} · Reste : ${fmt(r.restant||0)}`, color: '#7c3aed' })),
    ...commandes.slice(0, 10).map(c => ({ ts: new Date(c.date||0), label: `Commande — ${c.clientName||'Client'} — ${fmt(c.total)}`, sub: `Statut : ${c.status === 'pending' ? 'En attente' : 'Traitée'}`, color: '#0891b2' })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 20);

  const activityHtml = events.length
    ? events.map(e => {
        const dateStr = isNaN(e.ts) ? '—' : e.ts.toLocaleDateString('fr-FR', { day:'2-digit', month:'short' }) + ' ' + e.ts.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
        return `<div class="pdb-activity-item">
          <div class="pdb-activity-dot" style="background:${e.color}"></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;color:#1c1917">${e.label}</div>
            <div style="font-size:11px;color:#78716c">${e.sub}</div>
          </div>
          <div style="font-size:10px;color:#a8a29e;white-space:nowrap;flex-shrink:0">${dateStr}</div>
        </div>`;
      }).join('')
    : `<div class="pdb-empty">Aucune activité récente</div>`;

  const actHtml = `
  <div class="pdb-section">
    <div class="pdb-section-head">
      <div><div class="pdb-section-title">Activité récente</div><div class="pdb-section-sub">Ventes · Réservations · Commandes</div></div>
    </div>
    ${activityHtml}
  </div>`;

  // ── Ventes des 7 derniers jours (mini chart) ──
  const days7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const ds = d.toDateString();
    const tot = sales.filter(s => { const sd = parseSaleDate(s.date); return sd && sd.toDateString() === ds; }).reduce((a, s) => a + (Number(s.total) || 0), 0);
    days7.push({ label: d.toLocaleDateString('fr-FR', { weekday:'short', day:'numeric' }), tot });
  }
  const maxDay = Math.max(...days7.map(d => d.tot), 1);
  const chartBars = days7.map(d => {
    const h = Math.max(4, Math.round(d.tot / maxDay * 80));
    const isToday = d.label === new Date().toLocaleDateString('fr-FR', { weekday:'short', day:'numeric' });
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
      <span style="font-size:9px;color:#78716c;white-space:nowrap">${d.tot > 0 ? fmt(d.tot) : ''}</span>
      <div style="width:100%;background:${d.tot > 0 ? (isToday ? '#e8834a' : '#1a4a3a') : '#f5f4f2'};border-radius:4px 4px 0 0;height:${h}px;transition:height .3s"></div>
      <span style="font-size:9px;color:${isToday ? '#e8834a' : '#78716c'};font-weight:${isToday ? '700' : '400'}">${d.label}</span>
    </div>`;
  }).join('');

  const chartHtml = `
  <div class="pdb-section" style="margin-bottom:20px">
    <div class="pdb-section-head">
      <div><div class="pdb-section-title">Ventes — 7 derniers jours</div></div>
      <span class="pdb-section-badge" style="background:#e8f4f0;color:#1a4a3a">${fmt(days7.reduce((a,d)=>a+d.tot,0))}</span>
    </div>
    <div style="display:flex;align-items:flex-end;gap:6px;padding:16px 16px 8px;height:130px">
      ${chartBars}
    </div>
  </div>`;

  // ── Assemblage final ──
  body.innerHTML = kpiHtml + chartHtml + caissierHtml + opsHtml + prodHtml + resCmdHtml + creancesHtml + stockHtml + actHtml;
}

function _pdbKpi(label, val, sub, color) {
  return `<div class="pdb-kpi pdb-kpi-accent" style="--ka:${color}">
    <div class="pdb-kpi-label">${label}</div>
    <div class="pdb-kpi-val" style="color:${color}">${val}</div>
    <div class="pdb-kpi-sub">${sub}</div>
  </div>`;
}

// ============================================================
// GESTIONNAIRE D'ERREURS GLOBAL
// Capture les erreurs non gérées sans planter silencieusement
// ============================================================
window.addEventListener('error', (e) => {
  // Ignorer les erreurs de réseau (GAS fetch failed, CDN inaccessible)
  if (e.message && (e.message.includes('fetch') || e.message.includes('network') || e.message.includes('Script error'))) return;
  console.error('[POS] Erreur non gérée:', e.message, e.filename + ':' + e.lineno);
  // Afficher un toast discret pour les erreurs inattendues (pas réseau)
  if (typeof showToast === 'function') {
    showToast(' Erreur inattendue — rechargez si l\'app se comporte anormalement', 'error');
  }
});

window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e.reason?.message || e.reason || '');
  // Ignorer les erreurs de réseau silencieuses
  if (!msg || msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('failed to fetch')
   || msg.toLowerCase().includes('networkerror') || msg.toLowerCase().includes('load failed')) {
    e.preventDefault(); return;
  }
  console.error('[POS] Promise rejetée:', msg);
  e.preventDefault(); // empêcher le log navigateur non formaté
});

// ============================================================
// SYNC CROSS-ONGLETS — BroadcastChannel
// Quand un onglet sauvegarde des données, les autres se mettent à jour
// ============================================================
(function() {
  if (typeof BroadcastChannel === 'undefined') return;
  const _posBus = new BroadcastChannel('pos-sync');

  // Écouter les messages des autres onglets
  _posBus.onmessage = function(e) {
    const { type } = e.data || {};
    if (type === 'sale-added')        { loadData(); renderStats(); }
    if (type === 'product-changed')   { loadData(); renderProducts(); renderStockTable(); }
    if (type === 'reservation-added') { loadData(); renderReservations(); }
  };

  // Exposer une fonction pour notifier les autres onglets
  window._posBroadcast = function(type, payload) {
    try { _posBus.postMessage({ type, payload }); } catch(e) {}
  };
})();

// initModulesProduction est appelé lazily depuis showPage (attribution/production)
