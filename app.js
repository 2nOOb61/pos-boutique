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
// File de reprise : uploads Drive des photos de tâches libres échoués (réseau/GAS down).
// Persistée en localStorage → survit au rechargement, vidangée par _startNotifPolling.
var _tlPhotoQueue = (function(){ try { return JSON.parse(localStorage.getItem('pos-tl-photo-queue')||'[]'); } catch(e){ return []; } })();
var _notifPopupArmed   = false; // pop-ups activés après le chargement initial (évite le backlog au login ; insensible aux horloges)
var _notifAudioCtx     = null; // contexte Web Audio pour le son de notification
// Pop-ups à l'écran : file navigable (les plus récentes en tête) + page courante.
// Permet de feuilleter les anciennes notifs sans devoir les fermer.
var _notifPopQueue     = [];
var _notifPopPage      = 0;
var _NOTIF_POP_PER_PAGE = 4;
var notifications      = (function() {
  try { var r = localStorage.getItem('pos-notifications'); return r ? JSON.parse(r) : []; } catch(e) { return []; }
}());

var RYTHME_DEFAULTS = {
  VALID_CMD:     120,   // 2h  — validation commande (commerciale)
  PAO:           480,   // 8h  — conception / simulation
  RETOUR_CLIENT: 2880,  // 48h — 1re validation client
  MODIFICATIONS: 240,   // 4h
  VALID_CLIENT2: 2880,  // 48h — 2e validation client
  BAT:           240,   // 4h  — BAT physique
  ACHAT:         1440,  // 24h — achat (si besoin)
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

const PAGE_LABELS = {
  caisse:          'Caisse / Vente rapide',
  reservations:    'Réservations',
  commandes:       'Commandes',
  livraisons:      'Livraisons',
  stock:           'Stock',
  stats:           'Statistiques',
  finances:        'Finances',
  'mon-dashboard': 'Mon tableau de bord',
  attribution:     'Attribution / Dossiers',
  production:      'Production / Tâches',
  messagerie:      'Messagerie',
  config:          'Configuration (admin)',
  users:           'Gestion utilisateurs (admin)',
};

const PAGE_ACCESS = {
  caisse:         ['admin','caissier','commerciale','utilisateur','gestionnaire'],
  reservations:   ['admin','caissier','commerciale','utilisateur','gestionnaire','comptable'],
  commandes:      ['admin','caissier','commerciale','gestionnaire','comptable','livreur'],
  livraisons:     ['admin','caissier','commerciale','gestionnaire','comptable','livreur','chef_atelier','operateur_prod','machiniste','finition'],
  stock:          ['admin','gestionnaire'],
  stats:          ['admin','comptable'],
  finances:       ['admin','comptable','gestionnaire'],
  perf:           ['admin','chef_atelier','gestionnaire'],
  'mon-dashboard':['admin','caissier','commerciale','utilisateur','gestionnaire','comptable'],
  config:         ['admin'],
  users:          ['admin'],
  attribution:    ['admin','chef_atelier','operateur_prod','machiniste','pao','finition','livreur','commerciale'],
  blocages:       ['admin','chef_atelier','commerciale','gestionnaire'],
  production:     ['admin','chef_atelier','operateur_prod','machiniste','pao','finition','livreur','caissier','commerciale','utilisateur','gestionnaire','comptable'],
  calendrier:     ['admin','commerciale','chef_atelier','gestionnaire'],
  messagerie:     ['admin','chef_atelier','operateur_prod','machiniste','pao','finition','livreur','caissier','commerciale','utilisateur','gestionnaire','comptable'],
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
let arretsCaisse = [];
let encaissements = [];   // journal des entrées d'argent (ventes + acomptes/soldes commandes)

let nextId = 1;
// Id GLOBALEMENT unique (timestamp + aléatoire) — évite les collisions entre postes/caissiers
function _genUid(prefix){ return (prefix||'') + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
let nextSaleId = 1;
let nextArretId = 1;
let nextEncId = 1;

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

// Libellé du mode de paiement d'une vente (Espèces / Mobile / Chèque)
function _payLabel(s) {
  if (!s) return '';
  if (s.method === 'cash')   return 'Espèces';
  if (s.method === 'cheque') return 'Chèque' + (s.provider ? ' ' + s.provider : '') + (s.ref ? ' · N°' + s.ref : '');
  return s.provider || 'Mobile Money';
}
// Comparaison insensible à la casse et aux espaces — utilisée pour matcher les opérateurs
function _sameOp(a, b) { return (a||'').trim().toLowerCase() === (b||'').trim().toLowerCase(); }
// Cloisonnement Production / Attribution : seuls admin, chef d'atelier et commercial
// (suivi global, lecture seule) voient le travail de TOUS les opérateurs. Les autres
// (operateur_prod, machiniste, pao, finition, livreur…) ne voient que LE LEUR.
function _canSeeAllOps() { return ['admin','chef_atelier','commerciale'].includes(currentUser?.role); }
function _myOpLabel() { return currentUser?.label || currentUser?.username || ''; }
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
        userInfo.label = userInfo.nom || userInfo.username || u;
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
    loadNotifsFromGAS().then(function(){ _notifPopupArmed = true; }); // pop-ups actifs une fois le backlog chargé
    _startNotifPolling();
    // Charger les données depuis le Sheet
    _initDriveFolderUrl();  // Récupérer l'URL du dossier Drive (fallback direct)
    loadConfigFromGAS();    // Récupère aussi driveFolderUrl via ShopConfig
    // ── AFFICHAGE IMMÉDIAT depuis le cache local (instantané même en réseau
    //    lent / haute latence). On NE BLOQUE PLUS sur les appels serveur :
    //    avant, 5 chargements GAS étaient attendus EN SÉRIE avant tout rendu
    //    (~2 s chacun en latence → ~10 s d'écran blanc après connexion). ──
    applyRolePermissions(currentUser.role);
    updatePendingBadge();
    updateResBadge();
    renderProducts();
    renderStockTable();
    renderStats();
    // Rediriger vers la première page accessible selon le rôle
    const _ep0 = _effectivePages(currentUser);
    const startPage = Object.keys(PAGE_ACCESS).find(p => _ep0.includes(p)) || 'caisse';
    showPage(startPage, null, null);
    if (window.innerWidth <= 768) switchCaisseTab('products');

    // ── Rafraîchir depuis le serveur EN PARALLÈLE et EN ARRIÈRE-PLAN (non bloquant) ──
    if (APPS_SCRIPT_URL) {
      Promise.all([
        loadProductsFromScript().catch(() => {}),
        loadSalesFromScript().catch(() => {}),
        loadUsersFromScript().catch(() => {}),
        loadReservationsFromScript().catch(() => {}),
        loadCommandesFromScript().catch(() => {}),
        loadModifsFromScript().catch(() => {}),
      ]).then(() => syncPendingOfflineSales().catch(() => {}))
        .then(() => {
          saveData(); // Persister l'état fusionné
          // Re-rendu avec les données fraîches (l'app était déjà affichée)
          renderProducts();
          renderStockTable();
          renderStats();
          updatePendingBadge();
          updateResBadge();
        }).catch(() => {});
      // Précharger le fil de messagerie pour le badge non-lus
      loadCommentsForDossier(MSG_GLOBAL_ID).then(() => _updateMsgBadge()).catch(() => {});
    }
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
  if (id==='stats')           { renderStats(); Promise.all([loadSalesFromScript(true, true), loadReservationsFromScript(), loadCommandesFromScript()]).then(renderStats).catch(()=>renderStats()); _loadProdStats(); }
  if (id==='mon-dashboard')  { renderMonDashboard(); }
  if (id==='config')         { renderConfigPage(); renderRythmeConfig(); renderObjectifsConfig(); }
  if (id==='users')        renderUsersPage();
  if (id==='reservations') { _ensureDossierLinks(); renderReservations(); _lastResRefresh = 0; _autoRefreshReservations(); _loadTachesQuietly().then(renderReservations); }
  if (id==='attribution')  {
    // Reset uniquement à la navigation (pas lors des changements de filtre)
    if (!_pendingSelectDossierId) {
      selectedDossier = null;
      const _ap = document.getElementById('attrPanel');
      if (_ap) _ap.innerHTML = `<div style="text-align:center;color:var(--color-text-muted);padding:60px 24px"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 12px;display:block;opacity:.4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><p style="font-size:14px">Sélectionnez un dossier<br>pour assigner les étapes</p></div>`;
    }
    loadDossiers(); initModulesProduction();
  }
  if (id==='blocages')     { renderBlocages(); if (APPS_SCRIPT_URL) Promise.all([loadDossiers(), _loadTachesQuietly()]).then(renderBlocages).catch(()=>renderBlocages()); }
  if (id==='production')   { _setupProdViewToggle(); loadTaches(); _autoRefreshProduction(); initModulesProduction(); }
  if (id==='calendrier')   { _ensureDossierLinks(); renderCalendrier(); if (APPS_SCRIPT_URL) Promise.all([loadCommandesFromScript(), loadReservationsFromScript()]).then(() => { _ensureDossierLinks(); renderCalendrier(); }).catch(()=>{}); }
  if (id==='messagerie')   { loadMessagerie(); _autoRefreshMessagerie(); }
  if (id==='patron')       { renderControlFinance(); renderPatronEncaissements(); renderPatronDashboard(); _autoRefreshPatron(); loadEncaissementsFromScript().then(renderPatronEncaissements).catch(()=>{}); }
  if (id==='commandes')    { _ensureDossierLinks(); renderCommandes(); _lastCmdRefresh = 0; _autoRefreshCommandes(); _loadTachesQuietly().then(renderCommandes); }
  if (id==='livraisons')   { renderLivraisons(); if (APPS_SCRIPT_URL) Promise.all([loadCommandesFromScript(), loadReservationsFromScript()]).then(() => { updateDeliveryBadge(); renderLivraisons(); }).catch(()=>{}); }
  if (id==='finances')     { _ensureDossierLinks(); renderFinances(); if (APPS_SCRIPT_URL) loadCommandesFromScript().then(() => { _ensureDossierLinks(); renderFinances(); }).catch(()=>{}); }
  if (id==='perf')         { _ensureDossierLinks(); renderPerf(); if (APPS_SCRIPT_URL) _loadTachesQuietly().then(() => { _ensureDossierLinks(); renderPerf(); }).catch(()=>{}); }
  // Garde d'accès (rôle ou overrides personnalisés)
  if (currentUser) {
    const ep = _effectivePages(currentUser);
    if (PAGE_ACCESS[id] && !ep.includes(id)) {
      const fallback = Object.keys(PAGE_ACCESS).find(p => ep.includes(p)) || 'caisse';
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
  const _cb = document.getElementById('chequeBank');   if (_cb) _cb.value = '';
  const _cn = document.getElementById('chequeNumber'); if (_cn) _cn.value = '';
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
  const chequeSec = document.getElementById('chequeSection');
  if (chequeSec) chequeSec.style.display = mode==='cheque'?'block':'none';
  document.getElementById('tabCash').classList.toggle('active', mode==='cash');
  document.getElementById('tabMobile').classList.toggle('active', mode==='mobile');
  const tabCheque = document.getElementById('tabCheque');
  if (tabCheque) tabCheque.classList.toggle('active', mode==='cheque');
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
let _confirmingPayment = false;
function confirmPayment() {
  // P0 : anti double-soumission (double-clic / Entrée répétée) — empêche la vente fantôme/doublée
  if (_confirmingPayment) return;
  if (!Array.isArray(cart) || cart.length === 0) { showToast('Le panier est vide.', 'error'); return; }
  _confirmingPayment = true;
  try {
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
  } else if(paymentMode==='cheque') {
    const bank   = document.getElementById('chequeBank').value.trim();
    const number = document.getElementById('chequeNumber').value.trim();
    if(!bank)   { showToast('Veuillez saisir la banque du chèque.', 'error'); return; }
    if(!number) { showToast('Veuillez saisir le numéro du chèque.', 'error'); return; }
    // provider = banque, ref = numéro du chèque (réutilise le schéma de vente)
    recordSale(totalWithDelivery, 'cheque', due, 0, bank, number, rem, acc, clientName, clientContact, deliveryMode, deliveryAddress, deliveryFee, deliveryDate, clientType, clientCompany);
  } else {
    let ref = document.getElementById('mobileRef').value.trim();
    if (!ref) ref = 'INT-' + Date.now(); // P1 : référence interne si non saisie (réconciliation)
    recordSale(totalWithDelivery, 'mobile', due, 0, selectedProvider, ref, rem, acc, clientName, clientContact, deliveryMode, deliveryAddress, deliveryFee, deliveryDate, clientType, clientCompany);
  }
  } finally { _confirmingPayment = false; }
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
  // Journal d'encaissement : la part RÉELLEMENT payée maintenant (total − reste dû)
  _recordEncaissement({
    source: 'vente', refId: sale.id, refLabel: '#' + sale.id,
    client: clientName || 'Client comptant',
    montant: Math.max(0, (Number(total) || 0) - (Number(sale.due) || 0)),
    method, provider, ref,
    type: (Number(sale.due) || 0) > 0 ? 'acompte' : 'comptant',
    resteApres: Number(sale.due) || 0
  });
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
// JOURNAL DES ENCAISSEMENTS — entrées d'argent réelles
// (ventes rapides + acomptes/soldes/paiements de commandes).
// Sert de source unique à la fiche d'encaissement / arrêt de caisse.
// ============================================================

// Référence lisible d'une commande (CMD-001 du dossier lié, sinon repli court)
function _cmdRef(c) {
  if (!c) return '';
  const ds = (typeof dossiers !== 'undefined' ? dossiers : []);
  const d  = ds.find(x => String(x.id) === String(c.dossierId));
  return (d && d.numeroDossier) || ('CMD-' + String(c.id).slice(-4).toUpperCase());
}

// Montant déjà encaissé pour une commande (journal si présent, sinon accompte legacy)
function _cmdEncaisse(c) {
  const evts = encaissements.filter(e => e.source === 'commande' && String(e.refId) === String(c.id));
  if (evts.length) return evts.reduce((a, b) => a + (Number(b.montant) || 0), 0);
  return Number(c.accompte) || 0;   // repli commandes créées avant le journal
}

// Reste dû réel d'une commande (total − déjà encaissé)
function _cmdReste(c) {
  return Math.max(0, (Number(c.total) || 0) - _cmdEncaisse(c));
}

// Enregistre une entrée d'argent dans le journal (+ persistance + sync best-effort)
function _recordEncaissement(evt) {
  const montant = Math.max(0, Number(evt.montant) || 0);
  if (montant <= 0) return null;
  const e = {
    id:            nextEncId++,
    date:          evt.date || new Date().toISOString(),
    caissier:      evt.caissier || currentUser?.username || 'caissier',
    caissierLabel: evt.caissierLabel || currentUser?.label || currentUser?.username || 'Caissier',
    source:        evt.source || 'vente',                 // vente|commande|reservation
    refId:         evt.refId != null ? evt.refId : '',
    refLabel:      evt.refLabel || (evt.source === 'vente' ? ('#' + evt.refId) : String(evt.refId)),
    client:        (evt.client || '').trim() || 'Client comptant',
    montant,
    method:        evt.method || 'cash',                  // cash|mobile|cheque
    provider:      evt.provider || '',
    ref:           evt.ref || '',
    type:          evt.type || 'comptant',                // comptant|acompte|solde|paiement
    resteApres:    Math.max(0, Number(evt.resteApres) || 0)
  };
  encaissements.unshift(e);
  try {
    localStorage.setItem('pos-encaissements', JSON.stringify(encaissements));
    localStorage.setItem('pos-nextEncId', String(nextEncId));
  } catch (_) {}
  syncEncaissementToSheets(e);
  return e;
}

async function syncEncaissementToSheets(e) {
  if (!APPS_SCRIPT_URL || !navigator.onLine) return;
  try { await apiCall({ action: 'addEncaissement', encaissement: e }); }
  catch (err) { console.warn('Sync encaissement GAS:', err); }
}

// Clé stable d'un encaissement (dédup local ↔ serveur)
function _encKey(e) { return String(e.caissier || '') + '|' + String(e.id || ''); }

// Charge les encaissements du serveur et les fusionne dans le journal local.
// Admin = tous les caissiers (vue patron) ; autres = seulement les leurs.
async function loadEncaissementsFromScript() {
  if (!APPS_SCRIPT_URL) return;
  try {
    const isAdmin = currentUser?.role === 'admin';
    const params  = { action: 'getEncaissements', limit: 3000 };
    if (!isAdmin) params.caissier = currentUser?.username || '';
    const r = await apiCall(params);
    if (!r || !r.ok || !Array.isArray(r.encaissements)) return;
    const have = new Set(encaissements.map(_encKey));
    let added = 0;
    r.encaissements.forEach(se => {
      const k = _encKey(se);
      if (have.has(k)) return;
      // Reconstituer une date ISO à partir de dd/MM/yyyy + HH:mm:ss (le local raisonne en ISO)
      let iso = se.date;
      const p = String(se.date || '').split('/');
      if (p.length === 3) iso = `${p[2]}-${p[1]}-${p[0]}T${se.time || '00:00:00'}`;
      encaissements.push({ ...se, date: iso });
      have.add(k); added++;
    });
    if (added) { try { localStorage.setItem('pos-encaissements', JSON.stringify(encaissements)); } catch (_) {} }
  } catch (e) { console.warn('load encaissements:', e); }
}

// Récupère les arrêts de caisse (clôtures) depuis le serveur → multi-appareils + vue patron.
// admin = tous les arrêts ; sinon uniquement les siens. Fusion sans doublon (id+caissier).
async function loadArretsFromScript() {
  if (!APPS_SCRIPT_URL) return;
  try {
    const isAdmin = currentUser?.role === 'admin';
    const params  = { action: 'getArretsCaisse', limit: 1000 };
    if (!isAdmin) params.caissier = currentUser?.username || '';
    const r = await apiCall(params);
    if (!r || !r.ok || !Array.isArray(r.arrets)) return;
    const key  = a => String(a.id) + '|' + String(a.caissier || '');
    const have = new Set(arretsCaisse.map(key));
    let added = 0;
    r.arrets.forEach(sa => {
      if (have.has(key(sa))) return;
      // Reconstituer une date ISO à partir de dd/MM/yyyy + HH:mm:ss (le local raisonne en ISO)
      let iso = sa.date;
      const p = String(sa.date || '').split('/');
      if (p.length === 3) iso = `${p[2]}-${p[1]}-${p[0]}T${sa.time || '00:00:00'}`;
      arretsCaisse.push({ ...sa, date: iso });
      have.add(key(sa)); added++;
      const n = parseInt(sa.id, 10);
      if (!isNaN(n) && n >= nextArretId) nextArretId = n + 1;   // évite les collisions d'ID entre postes
    });
    if (added) {
      arretsCaisse.sort((a, b) => new Date(b.date) - new Date(a.date));
      try {
        localStorage.setItem('pos-arrets',      JSON.stringify(arretsCaisse));
        localStorage.setItem('pos-nextArretId', String(nextArretId));
      } catch (_) {}
    }
  } catch (e) { console.warn('load arrêts caisse:', e); }
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
  document.getElementById('resNotes').value = '';
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
  updateResTotals();
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

// Frais de livraison saisis (comptés seulement si mode livraison actif).
function _resFee() {
  const isLiv = document.getElementById('resBtnModeLivraison')?.style.background === 'rgb(232, 131, 74)';
  return isLiv ? (parseFloat(document.getElementById('resDeliveryFee')?.value) || 0) : 0;
}
// NET À PAYER réservation = articles − remise + frais de livraison (comme les commandes).
function _resNetTotal() { return getNetTotal() + _resFee(); }

function updateResTotals() {
  const net = _resNetTotal();
  const acc = Math.max(0, parseFloat(document.getElementById('resAccompte')?.value) || 0);
  const rt = document.getElementById('resTotal');        if (rt) rt.textContent = fmt(net);
  const rr = document.getElementById('resRestantLabel');  if (rr) rr.textContent = fmt(Math.max(0, net - acc));
}
function updateResRestant() { updateResTotals(); }

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
  if (acc > _resNetTotal()) { showToast('L\'acompte ne peut pas dépasser le total !', 'error'); return; }

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

  const notes = (document.getElementById('resNotes')?.value || '').trim();

  if (resPaymentMode === 'cash') {
    const given = parseFloat(document.getElementById('resGiven').value) || 0;
    if (given < acc) { showToast('Montant remis insuffisant pour l\'acompte !', 'error'); return; }
    const change = given - acc;
    saveReservation(acc, 'cash', given, change, null, null, clientName, clientContact, deliveryMode, deliveryAddress, deliveryFee, deliveryDate, clientType, clientCompany, notes);
  } else {
    const ref = document.getElementById('resMobileRef').value.trim();
    saveReservation(acc, 'mobile', acc, 0, resSelectedProvider, ref, clientName, clientContact, deliveryMode, deliveryAddress, deliveryFee, deliveryDate, clientType, clientCompany, notes);
  }
}

function saveReservation(accompte, depositMethod, given, change, provider, ref, clientName, clientContact, deliveryMode='retrait', deliveryAddress='', deliveryFee=0, deliveryDate='', clientType='particulier', clientCompany='', notes='') {
  const subtotal = getSubtotal();
  const remise   = getRemise();
  // NET À PAYER = articles − remise + frais de livraison (uniformisé avec les commandes)
  const total    = getNetTotal() + (deliveryMode === 'livraison' ? (Number(deliveryFee) || 0) : 0);
  const restant  = Math.max(0, total - accompte);

  // Réduire le stock (article mis de côté)
  cart.forEach(item => {
    const p = products.find(pr => pr.id === item.id);
    if (p) p.stock -= item.qty;
  });

  const reservation = {
    id:            _genUid('R'),
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
    clientType, clientCompany,
    notes
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
  const _rq = (document.getElementById('resSearch')?.value||'').trim().toLowerCase();
  let list = reservations.filter(r => filter === 'all' ? true : r.status === filter);
  if (_rq) list = list.filter(r => ((r.clientName||'')+' '+(r.clientContact||'')+' '+(Array.isArray(r.items)?r.items:[]).map(i=>i.name||'').join(' ')).toLowerCase().includes(_rq));

  // Summary (pending only)
  const pending = reservations.filter(r => r.status === 'pending');
  document.getElementById('resSumCount').textContent   = pending.length;
  document.getElementById('resSumTotal').textContent   = fmt(pending.reduce((s, r) => s + (Number(r.total)   || 0), 0));
  document.getElementById('resSumAcc').textContent     = fmt(pending.reduce((s, r) => s + (Number(r.accompte) || 0), 0));
  document.getElementById('resSumRestant').textContent = fmt(pending.reduce((s, r) => s + (Number(r.restant)  || 0), 0));

  const container = document.getElementById('reservationsList');
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = `<div class="res-empty">Aucune réservation${_rq?` pour « ${_rq} »`:(filter === 'pending' ? ' en attente' : '')}</div>`;
    return;
  }

  list.sort((a,b)=>{const da=parseSaleDate(a.date),db=parseSaleDate(b.date);if(!da&&!db)return 0;if(!da)return 1;if(!db)return -1;return db-da;});
  const _rgroups=[]; const _rmap={};
  list.forEach(r=>{ const k=_histDayKey(r.date); if(!_rmap[k]){_rmap[k]={key:k,date:r.date,rows:[],total:0};_rgroups.push(_rmap[k]);} _rmap[k].rows.push(r); _rmap[k].total+=Number(r.total)||0; });

  const _pSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
  const _dSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';

  container.innerHTML = _rgroups.map((_g,_gi)=>{
    const gid='rg'+_gi;
    const _ghdr=`<div class="cmd-group" id="rgrp-${gid}" onclick="toggleResGroup('${gid}')"><svg class="gchev" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>${_histDayLabel(_g.date)}<span class="gcount">${_g.rows.length}</span><span class="gtotal">${fmt(_g.total)}</span></div>`;
    const _gcards=_g.rows.map(r => {
      try {
        const d = parseSaleDate(r.date);
        const timeStr = d ? d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '—';
        const statusLabel = { pending: 'En attente', completed: 'Finalisée', cancelled: 'Annulée' }[r.status] || r.status;
        const statusClass = { pending: 'res-status-pending', completed: 'res-status-completed', cancelled: 'res-status-cancelled' }[r.status] || '';
        const itemsStr = (Array.isArray(r.items) ? r.items : []).map(i => `${escapeHtml(String(i.name||'?'))} ×${Number(i.qty)||1} — ${fmt(Number(i.price)||0)}`).join('<br>') || '—';
        const itemCount = (Array.isArray(r.items)?r.items:[]).length;
        const printBtn = `<button class="hist-print-btn" onclick="printReservationTicket(reservations.find(x=>String(x.id)==='${r.id}'))" title="Imprimer le ticket">${_pSvg}<span>Imprimer</span></button>`;
        const finalizeBtn = r.status === 'pending' ? `<button class="btn-finalize" onclick="openFinalizeModal('${r.id}')">Finaliser</button>` : '';
        const kebab = r.status === 'pending'
          ? `<div class="kebab-wrap"><button class="kebab-btn" aria-label="Plus d'actions" aria-haspopup="true" onclick="toggleKebab('res${r.id}',event)">${_dSvg}</button><div class="kebab-menu" id="kb-res${r.id}" role="menu"><button class="kebab-item danger" role="menuitem" onclick="closeAllKebabs();cancelReservation('${r.id}')">${_kebabIcon('trash')}<span>Annuler la réservation</span></button></div></div>`
          : '';
        return `
        <div class="res-card" data-rgrp="${gid}">
          <div class="res-card-header">
            <div style="min-width:0">
              <div class="res-card-client">${escapeHtml(r.clientName||'Client')} <span style="font-size:11px;color:var(--muted);font-weight:400">#${_factureNum(r)}</span></div>
              <div style="font-size:12px;color:var(--muted)">${r.clientContact ? escapeHtml(r.clientContact)+' · ' : ''}${timeStr}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <span class="res-status ${statusClass}">${statusLabel}</span>
              <div style="font-size:18px;font-weight:800;color:var(--text);margin-top:5px">${fmt(r.total)}</div>
            </div>
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:13px">
            <span style="color:var(--muted)">Acompte <b style="color:var(--green)">${fmt(r.accompte)}</b></span>
            <span style="color:var(--muted)">Restant <b style="color:${r.status==='pending'?'var(--red)':'var(--muted)'}">${fmt(r.restant)}</b></span>
          </div>
          <button class="cmd-detail-toggle" id="res-det-btn-${r.id}" onclick="toggleResDetail('${r.id}')">
            <svg class="hist-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            Détails (${itemCount} article${itemCount>1?'s':''})
          </button>
          <div class="cmd-detail" id="res-det-${r.id}">
            <div class="res-items" style="line-height:1.8">${itemsStr}</div>
          </div>
          <div class="res-actions" style="margin-top:10px">${finalizeBtn}${printBtn}${kebab}</div>
          ${r.status === 'pending' && r.dossierId ? _buildCardProductionSection(r.dossierId) : ''}
        </div>`;
      } catch(e) {
        console.error('renderReservations card #' + r.id + ':', e);
        return `<div class="res-card" style="color:var(--muted);font-size:13px;padding:12px"> Réservation #${r.id} — erreur affichage: ${e.message}</div>`;
      }
    }).join('');
    return _ghdr + _gcards;
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
    caissier:      r.caissier || currentUser?.username || 'caissier',
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
  // Ne supprimer les tâches que si toutes sont terminées (production achevée)
  const tachesDossier   = taches.filter(function(t) { return t.dossierId === r.dossierId; });
  const toutesTerminees = tachesDossier.length === 0 ||
    tachesDossier.every(function(t) { return t.statut === 'TERMINE'; });
  if (toutesTerminees) {
    _deleteTachesForDossier(r.dossierId);
  } else {
    console.info('[Finalise] Tâches encore en cours pour dossier', r.dossierId, '— conservation.');
  }
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

// Numéro de facture/reçu LISIBLE et NUMÉRIQUE (sans lettres). Les ids internes
// commande/réservation sont des uid « C… »/« R… » (uniques multi-appareils) → on
// n'affiche PAS l'uid. Dérivé de la date de création → stable à la réimpression,
// cohérent entre le ticket et la carte. Format AAMMJJ-HHMMSS.
function _factureNum(obj){
  const d = (obj && parseSaleDate(obj.date)) || new Date();
  const p = n => String(n).padStart(2, '0');
  return p(d.getFullYear() % 100) + p(d.getMonth() + 1) + p(d.getDate())
       + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function _openTicketWindow(htmlBody, title='Ticket') {
  const w = window.open('', '_blank', 'width=420,height=620');
  if (!w) { alert("Impression bloquée : autorisez les fenêtres pop-up pour ce site, puis réessayez."); return; }
  setTimeout(() => {
    const tc = shopConfig;
    const font = tc.ticketFont || 'Arial';
    w.document.write(`<html><head><title>${title}</title><style>
      @page{size:10cm 15cm;margin:0.3cm}
      *{box-sizing:border-box}
      body{font-family:${font},sans-serif;font-size:10pt;margin:0;padding:0;width:9.4cm;color:#000}
      .row{display:flex;justify-content:space-between;align-items:baseline;padding:1px 0}
      .row span:first-child{color:#555}
      .row span:last-child{font-weight:500;text-align:right;min-width:0}
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
  } else if (sale.method === 'cheque') {
    document.getElementById('tPayMethod').textContent    = `Chèque ${sale.provider||''}`.trim();
    document.getElementById('tGiven').textContent        = sale.ref ? 'N° ' + sale.ref : '';
    document.getElementById('tChangeRow').style.display = 'none';
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
      ${(Array.isArray(sale.items)?sale.items:[]).map(i=>`<div class="row"><span>${i.name||'?'} <em style="color:#777">${(Number(i.price)||0).toLocaleString()} Ar × ${Number(i.qty)||1}</em></span><span>${((Number(i.price)||0)*(Number(i.qty)||1)).toLocaleString()} Ar</span></div>`).join('')}
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
        : sale.method==='cheque'
        ? `<div class="row"><span>Chèque — Banque</span><span>${sale.provider||''}</span></div>
           <div class="row"><span>N° du chèque</span><span>${sale.ref||''}</span></div>
           ${sale.chequeTitulaire ? `<div class="row"><span>Titulaire</span><span>${sale.chequeTitulaire}</span></div>` : ''}
           ${sale.chequeDate ? `<div class="row"><span>Date du chèque</span><span>${new Date(sale.chequeDate).toLocaleDateString('fr-FR')}</span></div>` : ''}`
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
    ${tc.ticketShowNum !== false ? `<div class="row"><span>Reservation N°</span><span>${_factureNum(res)}</span></div>` : ''}
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
      ${(Array.isArray(res.items)?res.items:[]).map(i=>`<div class="row"><span>${i.name||'?'} <em style="color:#777">${(Number(i.price)||0).toLocaleString()} Ar × ${Number(i.qty)||1}</em></span><span>${((Number(i.price)||0)*(Number(i.qty)||1)).toLocaleString()} Ar</span></div>`).join('')}
    </div>
    <hr style="${st.sepLight}"/>
    ${tc.ticketShowSubtotal !== false ? `<div class="row"><span>Sous-total</span><span>${fmt(res.subtotal)}</span></div>` : ''}
    ${res.remise>0 ? `<div class="row"><span>Remise</span><span>-${fmt(res.remise)}</span></div>` : ''}
    ${Number(res.deliveryFee)>0 ? `<div class="row"><span>Frais de livraison</span><span>+${fmt(res.deliveryFee)}</span></div>` : ''}
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

  _openTicketWindow(html, 'Reservation ' + _factureNum(res));
}

function printCommandeTicket(cmd) {
  if (!cmd) return;
  const tc  = shopConfig;
  const st  = _ticketStyles(tc);
  st.color  = '#000';   // facture en monochrome (noir & blanc), indépendamment de la couleur configurée
  const dateStr = (parseSaleDate(cmd.date) || new Date()).toLocaleString('fr-MG');
  // Code de suivi interne (ex. #13692) capté en saisie rapide. Fallback : extrait
  // depuis les notes ("Réf. client #…") pour les commandes rechargées depuis le Sheet.
  const _suivi = cmd.codeSuivi || (cmd.notes ? ((cmd.notes.match(/R[ée]f\.?\s*client\s*#?(\d+)/i) || [])[1] || '') : '');

  const html = `
    ${_ticketShopHeader(tc, st)}
    <hr style="${st.sepSolid}"/>
    ${tc.ticketShowNum !== false ? `<div class="row"><span>Facture N°</span><span>${_factureNum(cmd)}</span></div>` : ''}
    ${_suivi ? `<div class="row"><span>Code suivi</span><span>#${_suivi}</span></div>` : ''}
    <div class="row"><span>Date</span><span>${dateStr}</span></div>
    ${tc.ticketShowCaissier !== false ? `<div class="row"><span>Caissier</span><span>${cmd.caissier||''}</span></div>` : ''}
    ${cmd.clientName    ? `<div class="row"><span>Client</span><span>${cmd.clientName}</span></div>` : ''}
    ${cmd.clientContact ? `<div class="row"><span>Contact</span><span>${cmd.clientContact}</span></div>` : ''}
    ${cmd.adresseLivraison
      ? `<div class="row"><span>Livraison</span><span style="flex:1;margin-left:10px">${cmd.adresseLivraison}</span></div>`
      : `<div class="row"><span>Mode</span><span>Retrait boutique</span></div>`}
    ${cmd.dateLivraison ? `<div class="row"><span>Date livraison</span><span>${new Date(cmd.dateLivraison+'T00:00:00').toLocaleDateString('fr-FR')}</span></div>` : ''}
    <hr style="${st.sepLight}"/>
    <div class="items-section">
      ${(Array.isArray(cmd.items)?cmd.items:[]).map(i=>`<div class="row"><span>${i.name||'?'} <em style="color:#777">${(Number(i.price)||0).toLocaleString()} Ar × ${Number(i.qty)||1}</em></span><span>${((Number(i.price)||0)*(Number(i.qty)||1)).toLocaleString()} Ar</span></div>`).join('')}
    </div>
    <hr style="${st.sepLight}"/>
    ${tc.ticketShowSubtotal !== false && cmd.subtotal ? `<div class="row"><span>Sous-total</span><span>${fmt(cmd.subtotal)}</span></div>` : ''}
    ${cmd.remise>0 ? `<div class="row"><span>Remise</span><span>-${fmt(cmd.remise)}</span></div>` : ''}
    ${Number(cmd.fraisLivraison)>0 ? `<div class="row"><span>Frais de livraison</span><span>+${fmt(cmd.fraisLivraison)}</span></div>` : ''}
    <div style="background:${st.color}18;border:1px solid ${st.color};border-radius:4px;padding:4px 6px;margin:4px 0">
      <div class="row bold" style="color:${st.color}"><span>TOTAL A PAYER</span><span>${fmt(cmd.total)}</span></div>
    </div>
    <div style="border:1px solid #333;border-radius:4px;padding:5px 8px;margin:4px 0">
      <div class="row bold"><span>ACOMPTE VERSE</span><span>${fmt(cmd.accompte)}</span></div>
      <div class="row bold"><span>RESTE DU</span><span>${fmt(cmd.restant)}</span></div>
    </div>
    <hr style="${st.sepSolid}"/>
    <div class="footer">A recuperer sur presentation de cette facture</div>
    <div class="footer">${tc.footer||'Merci de votre confiance !'}</div>`;

  _openTicketWindow(html, 'Facture ' + _factureNum(cmd));
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
    <td style="white-space:nowrap">${_payLabel(s)}</td>
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
  const cash   = list.filter(s => s.method==='cash').reduce((s,v) => s + (Number(v.total)||0), 0);
  const cheque = list.filter(s => s.method==='cheque').reduce((s,v) => s + (Number(v.total)||0), 0);
  const mob    = list.filter(s => s.method!=='cash' && s.method!=='cheque').reduce((s,v) => s + (Number(v.total)||0), 0);
  return `<div class="detail-kpi-row">
    ${_kpi('CA du jour',     fmt(ca),          'var(--accent)', 'rgba(7,61,55,0.07)')}
    ${_kpi('Transactions',   list.length,       'var(--blue)',   'rgba(237,111,44,0.07)')}
    ${_kpi(' Espèces',     fmt(cash),         'var(--text)',   'var(--surface2)')}
    ${_kpi(' Mobile',      fmt(mob),          'var(--text)',   'var(--surface2)')}
    ${cheque > 0 ? _kpi(' Chèque', fmt(cheque), 'var(--text)', 'var(--surface2)') : ''}
    ${due > 0 ? _kpi('Reste à percevoir', fmt(due), 'var(--red)', 'rgba(255,71,87,.07)') : ''}
  </div>${_salesTableWrap(list)}`;
}

/* ── Ventes du mois ── */
function _detailMonth() {
  const key  = new Date().toISOString().slice(0, 7);
  const list = sales.filter(s => saleDateKey(s.date).startsWith(key));
  const ca   = list.reduce((s,v) => s + (Number(v.total)||0), 0);
  const due  = list.reduce((s,v) => s + (Number(v.due)||0),   0);
  const cash   = list.filter(s => s.method==='cash').reduce((s,v) => s + (Number(v.total)||0), 0);
  const cheque = list.filter(s => s.method==='cheque').reduce((s,v) => s + (Number(v.total)||0), 0);
  const mob    = list.filter(s => s.method!=='cash' && s.method!=='cheque').reduce((s,v) => s + (Number(v.total)||0), 0);
  return `<div class="detail-kpi-row">
    ${_kpi('CA du mois',     fmt(ca),           'var(--accent)', 'rgba(7,61,55,0.07)')}
    ${_kpi('Transactions',   list.length,        'var(--blue)',   'rgba(237,111,44,0.07)')}
    ${_kpi(' Espèces',     fmt(cash),          'var(--text)',   'var(--surface2)')}
    ${_kpi(' Mobile',      fmt(mob),           'var(--text)',   'var(--surface2)')}
    ${cheque > 0 ? _kpi(' Chèque', fmt(cheque), 'var(--text)', 'var(--surface2)') : ''}
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
        '"' + _payLabel(s).replace(/"/g, '""') + '"',
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
  renderHistoryList();

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
  // Tableau ventes par caissier (admin/comptable uniquement)
  renderCaissierStats();
} // end _renderStatsInner
function reprintTicket(id) {
  const s = sales.find(s=>String(s.id)===String(id));
  if(s) printTicket(s);
  else alert("Vente introuvable pour réimpression (recharge la page).");
}

// ===== Historique fusionné : kebab (overflow menu) + progressive disclosure =====
function _kebabIcon(name){
  const s='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  if(name==='edit')  return s+'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  if(name==='trash') return s+'<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  if(name==='open')  return s+'<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  if(name==='cash')  return s+'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>';
  if(name==='eye')   return s+'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  if(name==='print') return s+'<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
  if(name==='reset') return s+'<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.2"/></svg>';
  return '';
}
function toggleHistDetail(uid){
  const r=document.getElementById('hr-'+uid), d=document.getElementById('hd-'+uid);
  if(!r||!d) return;
  const open=d.classList.toggle('open');
  r.classList.toggle('open', open);
}
function toggleCmdDetail(id){
  const d=document.getElementById('cmd-det-'+id), b=document.getElementById('cmd-det-btn-'+id);
  if(!d) return;
  const open=d.classList.toggle('open');
  if(b) b.classList.toggle('open', open);
}
// Corriger l'adresse de livraison d'une commande (depuis le menu ⋮) — écrit dans le Sheet
function editCommandeAddress(id){
  const c = commandes.find(x => String(x.id) === String(id));
  if (!c) { showToast('Commande introuvable', 'error'); return; }
  const v = prompt("Adresse de livraison pour « " + (c.clientName || 'commande') + " »\n(laisser vide = Retrait boutique) :", c.adresseLivraison || '');
  if (v === null) return; // annulé
  const addr = v.trim();
  c.adresseLivraison = addr;
  c.deliveryMode = addr ? 'livraison' : 'retrait';
  saveData();
  renderCommandes();
  if (APPS_SCRIPT_URL) {
    apiCall({ action:'updateCommande', id: c.id, adresseLivraison: addr, deliveryMode: c.deliveryMode })
      .then(r => { if (r && r.ok) showToast('Adresse enregistrée'); else showToast('Erreur enregistrement', 'error'); })
      .catch(() => showToast('Erreur réseau', 'error'));
  }
}
// Corriger les frais de livraison d'une commande (recalcule sous-total/total/reste depuis les articles)
function editCommandeFrais(id){
  const c = commandes.find(x => String(x.id) === String(id));
  if (!c) { showToast('Commande introuvable', 'error'); return; }
  const v = prompt("Frais de livraison (Ar) pour « " + (c.clientName || 'commande') + " »\n(0 = aucun) :", String(Number(c.fraisLivraison)||0));
  if (v === null) return; // annulé
  const frais = Math.max(0, parseInt(String(v).replace(/[^\d]/g,''), 10) || 0);
  const itemsSum = (c.items||[]).reduce((s,i)=>s+(Number(i.qty)||0)*(Number(i.price)||0), 0);
  const remise = Number(c.remise)||0;
  const newSub = itemsSum > 0 ? itemsSum : (Number(c.subtotal)||0);
  const newTotal = itemsSum > 0 ? (itemsSum - remise + frais) : ((Number(c.total)||0) - (Number(c.fraisLivraison)||0) + frais);
  const newRestant = Math.max(0, newTotal - (Number(c.accompte)||0));
  c.fraisLivraison = frais; c.subtotal = newSub; c.total = newTotal; c.restant = newRestant;
  saveData();
  renderCommandes();
  if (APPS_SCRIPT_URL) {
    apiCall({ action:'updateCommande', id: c.id, fraisLivraison: frais, subtotal: newSub, total: newTotal, restant: newRestant })
      .then(r => { if (r && r.ok) showToast('Frais de livraison enregistrés'); else showToast('Erreur enregistrement', 'error'); })
      .catch(() => showToast('Erreur réseau', 'error'));
  }
}
// Corriger une date de livraison d'une commande (depuis le menu ⋮). Format AAAA-MM-JJ.
function _editCommandeDate(id, field, label) {
  const c = commandes.find(x => String(x.id) === String(id));
  if (!c) { showToast('Commande introuvable', 'error'); return; }
  const v = prompt(label + " pour « " + (c.clientName || 'commande') + " »\nFormat AAAA-MM-JJ (laisser vide = aucune) :", c[field] || '');
  if (v === null) return; // annulé
  const val = v.trim();
  if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) { showToast('Format attendu : AAAA-MM-JJ', 'error'); return; }
  c[field] = val;
  c._dateEditedAt = Date.now(); // protège l'édition d'un écrasement par un reload GAS périmé
  // Répercuter sur le dossier lié → visible dans la vue Production
  const dos = dossiers.find(d => d.sourceType === 'commande' && String(d.sourceId) === String(c.id));
  if (dos) dos[field] = val;
  saveData();
  renderCommandes();
  try { renderLivraisons(); } catch(e) {} // mise à jour immédiate de la page Livraisons
  if (APPS_SCRIPT_URL) {
    const payload = { action:'updateCommande', id: c.id };
    payload[field] = val;
    apiCall(payload)
      .then(r => { if (r && r.ok) showToast(label + ' enregistrée'); else showToast('Erreur enregistrement', 'error'); })
      .catch(() => showToast('Erreur réseau', 'error'));
  }
}
function editCommandeDateClient(id){ _editCommandeDate(id, 'dateLivraison',     'Date de livraison client'); }
function editCommandeDateProd(id){   _editCommandeDate(id, 'dateLivraisonProd', 'Date de livraison production'); }
function editCommandeDateBAT(id){     _editCommandeDate(id, 'dateBAT',           'Date de BAT'); }
function closeAllKebabs(){
  document.querySelectorAll('.kebab-menu.open').forEach(m=>m.classList.remove('open'));
  // Rétablir l'empilement normal des cartes/lignes précédemment élevées
  document.querySelectorAll('.kebab-elevated').forEach(el=>el.classList.remove('kebab-elevated'));
}
function toggleKebab(uid, ev){
  if(ev) ev.stopPropagation();
  const m=document.getElementById('kb-'+uid);
  if(!m) return;
  const wasOpen=m.classList.contains('open');
  closeAllKebabs();
  if(!wasOpen){
    m.classList.add('open');
    // Les cartes ont un `backdrop-filter`/`transform` → chacune crée un contexte
    // d'empilement, donc le menu (position:absolute) est « piégé » derrière la carte
    // suivante. On élève la carte hôte au-dessus des suivantes le temps de l'ouverture.
    const host = m.closest('.cmd-card,.res-card,.user-card,.stat-card,.dossier-row,.dossier-card-v2,.pcf-card,.pcf-row,.hist-card,.hist-row,.pt-item,.prod-group,.deliv-item,tr,li') || m.parentElement;
    if(host) host.classList.add('kebab-elevated');
  }
}
document.addEventListener('click', closeAllKebabs);
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ closeAllKebabs(); closeDrawers(); } });

// ===== Historique : recherche + filtre type + regroupement par date =====
function _histDayKey(v){ const d=parseSaleDate(v); return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : 'zzzz'; }
function _histDayLabel(v){
  const d=parseSaleDate(v); if(!d) return 'Date inconnue';
  const t=new Date(); t.setHours(0,0,0,0);
  const dd=new Date(d); dd.setHours(0,0,0,0);
  const diff=Math.round((t-dd)/86400000);
  if(diff===0) return "Aujourd'hui";
  if(diff===1) return "Hier";
  const lbl=d.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  return lbl.charAt(0).toUpperCase()+lbl.slice(1);
}
function toggleHistGroup(gid){
  const hdr=document.getElementById('grp-'+gid);
  if(!hdr) return;
  const collapsed=hdr.classList.toggle('collapsed');
  document.querySelectorAll('[data-grp="'+gid+'"]').forEach(el=>{ el.style.display = collapsed ? 'none' : ''; });
}
function toggleCmdGroup(gid){
  const hdr=document.getElementById('cgrp-'+gid);
  if(!hdr) return;
  const collapsed=hdr.classList.toggle('collapsed');
  document.querySelectorAll('[data-cgrp="'+gid+'"]').forEach(el=>{ el.style.display = collapsed ? 'none' : ''; });
}
function toggleResGroup(gid){
  const hdr=document.getElementById('rgrp-'+gid);
  if(!hdr) return;
  const collapsed=hdr.classList.toggle('collapsed');
  document.querySelectorAll('[data-rgrp="'+gid+'"]').forEach(el=>{ el.style.display = collapsed ? 'none' : ''; });
}
function toggleResDetail(id){
  const d=document.getElementById('res-det-'+id), b=document.getElementById('res-det-btn-'+id);
  if(!d) return;
  const open=d.classList.toggle('open');
  if(b) b.classList.toggle('open', open);
}
function renderHistoryList(){
  const tbody=document.getElementById('historyTbody');
  if(!tbody) return;
  const isAdmin=currentUser && currentUser.role==='admin';
  const _esc=v=>String(v==null?'':v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const q=(document.getElementById('histSearch')?.value||'').trim().toLowerCase();
  const typeF=document.getElementById('histTypeFilter')?.value||'all';

  if((sales||[]).length===0 && (commandes||[]).length===0 && (reservations||[]).length===0){
    tbody.innerHTML=`<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:28px"><div style="margin-bottom:10px">Aucune vente enregistrée</div><button onclick="manualRefreshStats()" style="padding:8px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;color:var(--muted);cursor:pointer;font-size:13px">Recharger depuis Sheets</button></td></tr>`;
    return;
  }

  const all=[];
  (sales||[]).forEach(s=>all.push({date:s.date,type:'Vente',tcol:'#1a4a3a',client:s.clientName||'',contact:s.clientContact||'',itemsArr:(Array.isArray(s.items)?s.items:[]),pay:_payLabel(s),total:Number(s.total)||0,due:Number(s.due)||0,print:`reprintTicket('${s.id}')`,kebab:isAdmin?[{label:'Modifier',icon:'edit',act:`openEditSaleModal('${s.id}')`},{label:'Supprimer',icon:'trash',danger:true,act:`openDeleteSaleModal('${s.id}')`}]:[]}));
  (commandes||[]).filter(c=>c.status!=='cancelled').forEach(c=>all.push({date:c.date,type:'Cmd rapide',tcol:'#0891b2',client:c.clientName||'',contact:c.clientContact||'',itemsArr:(Array.isArray(c.items)?c.items:[]),pay:'Commande',total:Number(c.total)||0,due:Number(c.restant)||0,print:`printCommandeTicket(commandes.find(x=>String(x.id)==='${c.id}'))`,kebab:[{label:'Ouvrir dans Commandes',icon:'open',act:`showPage('commandes')`}]}));
  (reservations||[]).filter(r=>r.status!=='cancelled').forEach(r=>all.push({date:r.date,type:'Réserv.',tcol:'#7c3aed',client:r.clientName||'',contact:r.clientContact||'',itemsArr:(Array.isArray(r.items)?r.items:[]),pay:'Réservation',total:Number(r.total)||0,due:Number(r.restant)||0,print:`printReservationTicket(reservations.find(x=>String(x.id)==='${r.id}'))`,kebab:[{label:'Ouvrir dans Réservations',icon:'open',act:`showPage('reservations')`}]}));

  let list=all.filter(r=>{
    if(typeF!=='all' && r.type!==typeF) return false;
    if(q){ const hay=(r.client+' '+r.itemsArr.map(it=>it.name||'').join(' ')+' '+r.pay).toLowerCase(); if(!hay.includes(q)) return false; }
    return true;
  });
  list.sort((a,b)=>{const da=parseSaleDate(a.date),db=parseSaleDate(b.date);if(!da&&!db)return 0;if(!da)return 1;if(!db)return -1;return db-da;});
  list=list.slice(0,300);

  if(!list.length){
    tbody.innerHTML=`<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:28px">Aucun résultat${q?` pour « ${_esc(q)} »`:''}.</td></tr>`;
    return;
  }

  const _printSvg='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
  const _dotsSvg='<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';

  const groups=[]; const gmap={};
  list.forEach(r=>{ const k=_histDayKey(r.date); if(!gmap[k]){gmap[k]={key:k,date:r.date,rows:[],total:0};groups.push(gmap[k]);} gmap[k].rows.push(r); gmap[k].total+=r.total; });

  tbody.innerHTML = groups.map((g,gi)=>{
    const gid='g'+gi;
    const header=`<tr class="hist-group" id="grp-${gid}" onclick="toggleHistGroup('${gid}')"><td colspan="5"><svg class="gchev" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>${_histDayLabel(g.date)}<span class="gcount">${g.rows.length}</span><span class="gtotal">${fmt(g.total)}</span></td></tr>`;
    const rowsHtml=g.rows.map((row,ri)=>{
      const uid=gid+'_'+ri;
      const d=parseSaleDate(row.date);
      const timeStr=d?d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'—';
      const itemsSummary=row.itemsArr.map(it=>`${_esc(it.name||'?')}×${Number(it.qty)||1}`).join(', ')||'—';
      const primary=row.client?_esc(row.client):(row.type==='Vente'?'Vente comptant':'—');
      const dueHtml=row.due>0?`<span class="hist-due-pill">${fmt(row.due)}</span>`:'';
      const kebabHtml=(row.kebab&&row.kebab.length)?`<div class="kebab-wrap"><button class="kebab-btn" aria-label="Plus d'actions" aria-haspopup="true" onclick="toggleKebab('${uid}',event)">${_dotsSvg}</button><div class="kebab-menu" id="kb-${uid}" role="menu">${row.kebab.map(k=>`<button class="kebab-item ${k.danger?'danger':''}" role="menuitem" onclick="closeAllKebabs();${k.act}">${_kebabIcon(k.icon)}<span>${k.label}</span></button>`).join('')}</div></div>`:'';
      const detail=`<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:6px">Détail de la transaction</div>${row.itemsArr.length?row.itemsArr.map(it=>`<div class="di"><span>${_esc(it.name||'?')} × ${Number(it.qty)||1}</span><span>${fmt((Number(it.price)||0)*(Number(it.qty)||1))}</span></div>`).join(''):'<div class="di"><span>Pas de détail d\'article</span><span></span></div>'}${row.contact?`<div class="di"><span>Contact</span><span>${_esc(row.contact)}</span></div>`:''}<div class="di"><span>Paiement</span><span>${_esc(row.pay)}</span></div>${row.due>0?`<div class="di"><span>Reste dû</span><span style="color:var(--red);font-weight:700">${fmt(row.due)}</span></div>`:`<div class="di"><span>Statut</span><span style="color:var(--green);font-weight:700">Soldé</span></div>`}`;
      return `<tr class="hist-row" id="hr-${uid}" data-grp="${gid}" onclick="toggleHistDetail('${uid}')">
        <td class="c-date" data-label="Heure">${timeStr}</td>
        <td class="c-trans" data-label="Transaction"><div style="display:flex;align-items:flex-start;gap:8px"><svg class="hist-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg><div style="min-width:0"><div class="hist-client">${primary}</div><div class="hist-sub"><span class="hist-badge" style="background:${row.tcol}1a;color:${row.tcol}">${row.type}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px">${itemsSummary}</span></div></div></div></td>
        <td class="c-total hist-cell-num hist-total" data-label="Total">${fmt(row.total)}</td>
        <td class="c-due hist-cell-num" data-label="Reste dû">${dueHtml}</td>
        <td class="c-actions" onclick="event.stopPropagation()"><div class="hist-actions"><button class="hist-print-btn" onclick="${row.print}" title="Imprimer le ticket">${_printSvg}<span>Imprimer</span></button>${kebabHtml}</div></td>
      </tr>
      <tr class="hist-detail-row" data-grp="${gid}"><td colspan="5"><div class="hist-detail" id="hd-${uid}">${detail}</div></td></tr>`;
    }).join('');
    return header+rowsHtml;
  }).join('');
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
  const cash   = list.filter(s => s.method==='cash').reduce((s,v) => s + (Number(v.total)||0), 0);
  const cheque = list.filter(s => s.method==='cheque').reduce((s,v) => s + (Number(v.total)||0), 0);
  const mob    = list.filter(s => s.method!=='cash' && s.method!=='cheque').reduce((s,v) => s + (Number(v.total)||0), 0);

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
    ${cheque > 0 ? `<div class="kpi"><div class="kpi-label"> Chèque</div><div class="kpi-val">${fmt(cheque)}</div></div>` : ''}
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
    // Arrêts de caisse
    safeLocalSet('pos-arrets', JSON.stringify(arretsCaisse));
    localStorage.setItem('pos-nextArretId', String(nextArretId));
    // Journal des encaissements
    safeLocalSet('pos-encaissements', JSON.stringify(encaissements));
    localStorage.setItem('pos-nextEncId', String(nextEncId));
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
    const obj = localStorage.getItem('pos-objectifs');
    if (obj) objectifs = JSON.parse(obj);
    const ar  = localStorage.getItem('pos-arrets');
    const nai = localStorage.getItem('pos-nextArretId');
    if (ar)  arretsCaisse = JSON.parse(ar);
    if (nai) nextArretId  = parseInt(nai);
    const enc  = localStorage.getItem('pos-encaissements');
    const nei  = localStorage.getItem('pos-nextEncId');
    if (enc) encaissements = JSON.parse(enc);
    if (nei) nextEncId = parseInt(nei);
    if (encaissements.length > 0) {
      const maxEncId = Math.max(...encaissements.map(e => Number(e.id) || 0));
      if (maxEncId >= nextEncId) nextEncId = maxEncId + 1;
    }

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
// PERMISSIONS PAR RÔLE  (+ overrides personnalisés par user)
// ============================================================

// Retourne la liste effective des pages accessibles pour un utilisateur.
// Si l'utilisateur a un champ customPages défini, on l'utilise ;
// sinon on retombe sur PAGE_ACCESS[role].
function _effectivePages(u) {
  if (u && Array.isArray(u.customPages) && u.customPages.length > 0) return u.customPages;
  return u ? Object.keys(PAGE_ACCESS).filter(p => PAGE_ACCESS[p].includes(u.role)) : [];
}

function applyRolePermissions(role) {
  const ep = currentUser ? _effectivePages(currentUser) : null;
  // Système data-roles : affiche/masque selon le rôle (ou accès effectif pour les nav-btn)
  document.querySelectorAll('[data-roles]').forEach(el => {
    const allowed  = el.dataset.roles.split(',');
    const onclick  = el.getAttribute('onclick') || '';
    const pageM    = onclick.match(/showPage\(['"]([^'"]+)['"]/);
    if (ep && pageM) {
      el.style.display = ep.includes(pageM[1]) ? '' : 'none';
    } else {
      el.style.display = allowed.includes(role) ? '' : 'none';
    }
  });
  const isAdmin = role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    if (!el.hasAttribute('data-roles')) el.style.display = isAdmin ? '' : 'none';
  });
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
        ${u.hasPwd === false
          ? '<span class="badge" style="background:#fee2e2;color:#dc2626" title="Ce compte n\'a pas de mot de passe — il ne peut pas se connecter. Cliquez sur Modifier pour en définir un.">⚠ Mot de passe manquant</span>'
          : ''}
        ${Array.isArray(u.customPages) && u.customPages.length
          ? '<span class="badge perm-custom-badge" title="Accès personnalisés (différents du rôle)">✦ Accès personnalisé</span>'
          : ''}
      </div>
      <div class="user-card-actions">
        <button class="btn-edit-user" onclick="openUserModal(${idx})"> Modifier</button>
        <button class="btn-perm-user" onclick="openPermissionsModal(${idx})" title="Gérer les pages accessibles"> Autorisations</button>
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
  // Sync vers Google Sheet — mot de passe EN CLAIR sous le champ "password"
  // (le serveur le hashera, salé). On n'envoie PAS le champ "pass" (hash local
  // non salé) qui écraserait le mot de passe serveur lors d'une édition sans
  // changement. Si pass est vide (édition sans changement) → champ omis → serveur garde l'ancien.
  const base = localUsers[isNew ? localUsers.length - 1 : editingUserId];
  const syncUser = { username: base.username, role: base.role, label: base.label, actif: base.actif, password: pass || undefined };
  if (syncUser.username) saveUserToScript(syncUser);
}

// ── Personnalisation des autorisations par opérateur ────────
let _permEditingIdx = null;

function openPermissionsModal(idx) {
  _permEditingIdx = idx;
  const u = localUsers[idx];
  document.getElementById('permModalTitle').textContent = `Autorisations — ${u.label || u.username}`;

  const effectiveP = _effectivePages(u);
  const rolePages  = Object.keys(PAGE_ACCESS).filter(p => PAGE_ACCESS[p].includes(u.role));

  document.getElementById('permPagesList').innerHTML = Object.keys(PAGE_LABELS).map(pageId => {
    const isAdminLocked = (pageId === 'config' || pageId === 'users') && u.role !== 'admin';
    const isChecked     = effectiveP.includes(pageId);
    const isDefault     = rolePages.includes(pageId);
    return `<label class="perm-row${isAdminLocked ? ' perm-row-locked' : ''}">
      <div class="perm-row-left">
        <div>
          <div class="perm-label">${PAGE_LABELS[pageId]}</div>
          <div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap">
            ${isDefault     ? '<span class="perm-badge perm-badge-default">rôle par défaut</span>' : ''}
            ${isAdminLocked ? '<span class="perm-badge perm-badge-locked">admin seulement</span>' : ''}
          </div>
        </div>
      </div>
      <label class="toggle" style="flex-shrink:0" onclick="event.stopPropagation()">
        <input type="checkbox" class="perm-cb" data-page="${pageId}"
               ${isChecked ? 'checked' : ''} ${isAdminLocked ? 'disabled' : ''} />
        <span class="toggle-slider"></span>
      </label>
    </label>`;
  }).join('');

  openModal('permissionsModal');
}

function resetPermissions() {
  const u = localUsers[_permEditingIdx];
  const rolePages = Object.keys(PAGE_ACCESS).filter(p => PAGE_ACCESS[p].includes(u.role));
  document.querySelectorAll('.perm-cb').forEach(cb => {
    if (!cb.disabled) cb.checked = rolePages.includes(cb.dataset.page);
  });
}

async function savePermissions() {
  const u       = localUsers[_permEditingIdx];
  const checked = [...document.querySelectorAll('.perm-cb')]
    .filter(cb => !cb.disabled && cb.checked)
    .map(cb => cb.dataset.page);

  const rolePages = Object.keys(PAGE_ACCESS).filter(p => PAGE_ACCESS[p].includes(u.role));
  const isSameAsRole = checked.length === rolePages.length
    && checked.every(p => rolePages.includes(p))
    && rolePages.every(p => checked.includes(p));

  u.customPages = isSameAsRole ? null : checked;

  saveUsers();
  closeModal('permissionsModal');
  renderUsersPage();
  showToast(`Autorisations de ${u.label || u.username} mises à jour`);

  // Si c'est l'utilisateur courant → recalculer la nav immédiatement
  if (currentUser && currentUser.username === u.username) {
    currentUser.customPages = u.customPages;
    applyRolePermissions(currentUser.role);
  }

  if (APPS_SCRIPT_URL) {
    saveUserToScript({ username: u.username, role: u.role, label: u.label, actif: u.actif, customPages: u.customPages });
  }
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
  try { updateDeliveryBadge(); } catch(e) {}
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
  const getActions = ['getProducts', 'getSales', 'ping', 'initSheets', 'login', 'getUsers', 'getReservations', 'getCommandes', 'getEncaissements', 'getArretsCaisse', 'getDossiers', 'getTaches', 'getDashboard', 'getControlPatron', 'getComments', 'getNotifs', 'getModifs', 'getShopConfig', 'getRythme', 'getDriveFolderUrl', 'getSharedFiles'];
  if (getActions.includes(payload.action)) {
    try {
      let url = APPS_SCRIPT_URL + '?action=' + payload.action;
      if (payload.limit)     url += '&limit='     + encodeURIComponent(payload.limit);
      if (payload.username)  url += '&username='  + encodeURIComponent(payload.username);
      if (payload.password)  url += '&password='  + encodeURIComponent(payload.password);
      if (payload.statut)    url += '&statut='    + encodeURIComponent(payload.statut);
      if (payload.dossierId) url += '&dossierId=' + encodeURIComponent(payload.dossierId);
      if (payload.operateur) url += '&operateur=' + encodeURIComponent(payload.operateur);
      if (payload.caissier)  url += '&caissier='  + encodeURIComponent(payload.caissier);
      if (payload.from != null) url += '&from=' + encodeURIComponent(payload.from);
      if (payload.to   != null) url += '&to='   + encodeURIComponent(payload.to);
      // Cache-buster : GAS edge-cache les GET ~15 s → renverrait des données périmées
      // juste après une écriture (ex. date modifiée). URL unique = réponse fraîche.
      url += '&_cb=' + Date.now();
      const res  = await fetch(url);
      const text = await res.text();
      try { return JSON.parse(text); }
      catch(e) { console.warn('GET réponse non-JSON:', text.substring(0,200)); return null; }
    } catch(e) { console.warn('GET error:', e.message); return null; }
  }

  // ── UPLOADS / GROS PAYLOADS : POST (route vers doPost) ──
  // uploadFile n'existe que dans doPost + le base64 peut dépasser la limite
  // de longueur d'URL d'un GET. Content-Type text/plain = pas de préflight CORS.
  const postActions = ['uploadFile'];
  if (postActions.includes(payload.action) || (payload.base64Data && payload.base64Data.length > 6000)) {
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      try { return JSON.parse(text); }
      catch(e) { return { ok: false, error: 'Réponse non-JSON' }; }
    } catch(e) {
      console.warn('apiCall POST error:', e.message);
      return null;
    }
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
  // Une vente issue d'une commande/réservation reste attribuée au commercial qui
  // l'a créée (le comptable ne fait que finaliser l'encaissement du reste).
  if (sale.fromCommande || sale.fromReservation) {
    sale.caissier = sale.caissier || (currentUser ? currentUser.username : 'caissier');
  } else {
    sale.caissier = currentUser ? currentUser.username : 'caissier';
  }
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
async function loadSalesFromScript(fullReload = false, serverTruth = false) {
  if (!APPS_SCRIPT_URL) return;
  showLoader('Chargement des ventes...');
  let allRemote = [];
  let gotResponse = false;
  const PAGE = 500;
  let offset = 0;
  // Charger jusqu'à 2000 ventes par pages de 500
  while (offset < 2000) {
    const r = await apiCall({ action: 'getSales', limit: PAGE, offset });
    if (!r || !r.ok || !Array.isArray(r.sales)) break;
    gotResponse = true;
    allRemote = allRemote.concat(r.sales);
    if (r.sales.length < PAGE) break;  // dernière page
    offset += PAGE;
  }
  hideLoader();
  const sortByDate = (a, b) => {
    const da = parseSaleDate(a.date), db = parseSaleDate(b.date);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  };
  if (serverTruth && gotResponse) {
    // Le serveur fait foi : dédoublonner et jeter le cache local périmé (ghosts)
    const seen = new Set();
    sales = allRemote.filter(s => { const k = String(s.id); if (seen.has(k)) return false; seen.add(k); return true; });
    sales.sort(sortByDate);
  } else if (allRemote.length > 0) {
    const sheetIds = new Set(allRemote.map(s => String(s.id)));
    const localOnly = sales.filter(s => !sheetIds.has(String(s.id)));
    sales = [...allRemote, ...localOnly];
    sales.sort(sortByDate);
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
        if (!patched.label && patched.nom) patched.label = patched.nom; // compat ancien champ nom
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
    // Préserver les attachments et dossierId locaux que GAS ne connaît pas ;
    // pour les anciennes réservations (colonnes livraison vides côté GAS), garder le local
    return {
      ...res,
      attachments: (local?.attachments?.length ? local.attachments : res.attachments) || [],
      dossierId:   local?.dossierId || res.dossierId || '',
      deliveryMode:    res.deliveryMode    || local?.deliveryMode    || 'retrait',
      deliveryAddress: res.deliveryAddress || local?.deliveryAddress || '',
      deliveryFee:     res.deliveryFee     || local?.deliveryFee     || 0,
      deliveryDate:    res.deliveryDate    || local?.deliveryDate    || '',
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
function openDriveFolder() {
  const modal = document.getElementById('sharedFilesModal');
  if (!modal) return;
  modal.style.display = 'flex';

  // Collecter tous les fichiers Drive depuis les réservations et commandes locales
  const files = [];
  const seen  = new Set();

  const sources = [
    ...(reservations || []).map(r => ({ context: r.client || r.id, date: r.date, atts: r.attachments })),
    ...(commandes    || []).map(c => ({ context: c.clientNom || c.id, date: c.date, atts: c.attachments }))
  ];

  sources.forEach(({ context, date, atts }) => {
    if (!Array.isArray(atts)) return;
    atts.forEach(a => {
      const key = a.fileId || a.viewUrl;
      if (!key || seen.has(key)) return;
      seen.add(key);
      files.push({ name: a.name || 'fichier', type: a.type || '', viewUrl: a.viewUrl || '', dlUrl: a.dlUrl || '', context, date });
    });
  });

  // Trier par date décroissante
  files.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  renderSharedFilesList(files);
}

function renderSharedFilesList(files) {
  const list = document.getElementById('sharedFilesList');
  if (!list) return;

  if (!files.length) {
    list.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:#a8a29e;">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:.3;display:block;margin:0 auto 12px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <p style="margin:0;font-size:14px;font-weight:500;color:#78716c;">Aucun fichier partagé</p>
        <p style="margin:6px 0 0;font-size:12px;">Les pièces jointes des réservations et commandes apparaîtront ici</p>
      </div>`;
    return;
  }

  const isPdf = t => (t||'').includes('pdf');
  const icon  = t => isPdf(t)
    ? `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#dc2626" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`
    : `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#2563eb" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

  list.innerHTML = files.map(f => `
    <div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid #f5f4f2;">
      <div style="flex-shrink:0;width:38px;height:38px;background:#f5f4f2;border-radius:9px;display:flex;align-items:center;justify-content:center;">
        ${icon(f.type)}
      </div>
      <div style="flex:1;min-width:0;">
        <p style="margin:0;font-size:13px;font-weight:500;color:#1c1917;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.name}</p>
        <p style="margin:2px 0 0;font-size:11px;color:#a8a29e;">${f.context || ''} · ${f.date ? new Date(f.date).toLocaleDateString('fr-FR') : ''}</p>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        ${f.viewUrl ? `<a href="${f.viewUrl}" target="_blank" rel="noopener" style="padding:6px 11px;background:#e8f4f0;color:#1a4a3a;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;">Voir</a>` : ''}
        ${f.dlUrl   ? `<a href="${f.dlUrl}"   target="_blank" rel="noopener" style="padding:6px 11px;background:#1a4a3a;color:#fff;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;">↓</a>` : ''}
      </div>
    </div>`).join('');
}

function closeSharedFiles() {
  const modal = document.getElementById('sharedFilesModal');
  if (modal) modal.style.display = 'none';
}

async function _initDriveFolderUrl() {
  if (!APPS_SCRIPT_URL) return;
  if (localStorage.getItem('pos-drive-folder-url')) return;
  try {
    const r = await apiCall({ action: 'getDriveFolderUrl' });
    if (r && r.ok && r.url) {
      localStorage.setItem('pos-drive-folder-url', r.url);
    }
  } catch(e) { /* silencieux */ }
}

function openScriptSettings() {
  const choice = prompt(
    ' Google Sheets — Que voulez-vous faire ?\n\n' +
    '1 → Changer l\'URL du script\n' +
    '2 → Tester la connexion\n' +
    '3 → Initialiser les feuilles (1ère utilisation)\n' +
    '4 → Synchroniser les ventes en attente\n' +
    '5 → SYNCHRONISER (miroir) — refléter exactement le Sheet\n' +
    '     (les éléments supprimés du Sheet sont retirés du POS)\n' +
    '6 →  RESET COMPLET — Effacer toutes les données locales\n' +
    '7 →  TOUT EFFACER (Sheet + POS) — produits, ventes, dossiers, tâches…\n\n' +
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
  } else if (choice.trim() === '7') {
    clearAllDataServerAndLocal();
  }
}

// Efface les données du Google Sheet ET du POS (produits, ventes, dossiers, tâches…)
// Conserve : utilisateurs, configuration boutique, journal
async function clearAllDataServerAndLocal() {
  if (!APPS_SCRIPT_URL) { showToast('URL Apps Script non configurée', 'error'); return; }
  const ok1 = confirm(
    ' TOUT EFFACER — Sheet + POS \n\n' +
    'Cela va effacer DÉFINITIVEMENT dans Google Sheets ET dans le POS :\n' +
    '• Produits, ventes, mouvements de stock\n' +
    '• Réservations, commandes\n' +
    '• Dossiers, tâches (production/attribution)\n' +
    '• Commentaires / messagerie, notifications\n\n' +
    'Conservés : comptes utilisateurs, configuration boutique.\n\n' +
    'Cette action est IRRÉVERSIBLE. Continuer ?'
  );
  if (!ok1) return;
  const ok2 = confirm('Dernière confirmation — Tout effacer côté Sheet ET POS ?');
  if (!ok2) return;

  showLoader('Effacement du Google Sheet...');
  try {
    const r = await apiCall({ action: 'clearAllData' });
    if (!r || !r.ok) {
      hideLoader();
      showToast('Échec côté Sheet : ' + ((r && r.error) || 'redéployez GAS (action clearAllData)'), 'error');
      return;
    }
    // Vider le local
    products = []; sales = []; reservations = []; commandes = []; taches = []; dossiers = [];
    dossierComments = dossierComments.filter(() => false);
    saveData();
    if (typeof saveTaches === 'function') saveTaches();
    if (typeof saveComments === 'function') saveComments();
    hideLoader();
    showToast('Tout effacé (Sheet + POS) — rechargement…', 'success');
    setTimeout(() => window.location.reload(true), 1500);
  } catch(e) {
    hideLoader();
    showToast('Erreur : ' + e.message, 'error');
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
  if (!confirm('Synchroniser le POS avec Google Sheets ?\n\nLe POS reflètera EXACTEMENT le contenu du Sheet :\n• Les éléments SUPPRIMÉS du Sheet seront aussi retirés du POS\n• Les éléments présents dans le Sheet seront chargés\n\nContinuer ?')) return;
  showLoader('Synchronisation miroir en cours...');
  try {
    // 1. Pré-vider les tableaux locaux → les fonctions de chargement laisseront
    //    vide si le Sheet est vide, et normaliseront correctement s'il y a des données
    products     = [];
    sales        = [];
    reservations = [];
    commandes    = [];
    taches       = [];
    dossiers     = [];

    // 2. Recharger depuis le Sheet (avec normalisation intégrée)
    await loadProductsFromScript();
    await loadSalesFromScript();
    await loadUsersFromScript();
    await loadReservationsFromScript();
    await loadCommandesFromScript();

    // 3. Tâches : miroir direct du Sheet (vide si Sheet vide)
    const rT = await apiCall({ action:'getTaches' });
    taches = (rT && rT.ok && Array.isArray(rT.taches)) ? rT.taches : [];
    if (typeof saveTaches === 'function') saveTaches();

    // 4. Persister + re-render toutes les vues
    saveData();
    _ensureDossierLinks();
    hideLoader();
    renderProducts();
    renderStockTable();
    renderStats();
    if (typeof renderReservations === 'function') renderReservations();
    if (typeof renderCommandes === 'function') renderCommandes();
    if (typeof updateResBadge === 'function') updateResBadge();
    if (typeof updateCmdBadge === 'function') updateCmdBadge();
    showToast('POS synchronisé avec Google Sheets', 'success');
  } catch(e) {
    hideLoader();
    showToast('Erreur lors de la synchronisation : ' + e.message, 'error');
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
  try {
    const r = await apiCall({ action: 'getShopConfig' });
    if (r && r.ok && r.config && typeof r.config === 'object') {
      shopConfig = { ...shopConfig, ...r.config };
      _persistConfig();
      // Sauvegarder l'URL du dossier Drive si présente
      if (r.config.driveFolderUrl) {
        localStorage.setItem('pos-drive-folder-url', r.config.driveFolderUrl);
      }
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

function saveDriveUrl() {
  const url = (document.getElementById('cfgDriveUrl')?.value || '').trim();
  if (url) {
    localStorage.setItem('pos-drive-folder-url', url);
    shopConfig.driveFolderUrl = url;
    _persistConfig();
    syncConfigToGAS(); // Sync vers GAS → tous les opérateurs la recevront
  }
}

function testDriveUrl() {
  const url = (document.getElementById('cfgDriveUrl')?.value || '').trim();
  if (!url) { showToast('Collez d\'abord une URL Drive', 'error'); return; }
  localStorage.setItem('pos-drive-folder-url', url);
  shopConfig.driveFolderUrl = url;
  _persistConfig();
  syncConfigToGAS();
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  showToast('URL Drive sauvegardée et ouverte', 'success');
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
  const driveEl = document.getElementById('cfgDriveUrl');
  if (driveEl) driveEl.value = localStorage.getItem('pos-drive-folder-url') || shopConfig.driveFolderUrl || '';
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
let srParsedData = null;
let objectifs    = {}; // { username: montantMensuel }

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
  if (document.getElementById('cmdDateLivraisonProd')) document.getElementById('cmdDateLivraisonProd').value = '';
  if (document.getElementById('cmdDateBAT')) document.getElementById('cmdDateBAT').value = '';
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
  if (remaining <= 0) { showToast('Maximum 5 pièces jointes par commande', 'error'); return; }
  for (const file of Array.from(files).slice(0, remaining)) {
    if (file.size > 8 * 1024 * 1024) { showToast(file.name + ' trop volumineux (max 8 Mo)', 'error'); continue; }
    try {
      // Images : compressées (600×600 jpeg). Documents (PDF/Word/Excel) : lus tels quels.
      const isImg = (file.type || '').startsWith('image/');
      const data  = isImg
        ? await _resizeImage(file, 600, 600)
        : await new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsDataURL(file); });
      cmdModalPhotos.push({ name: file.name, type: file.type || '', data });
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
  container.innerHTML = cmdModalPhotos.map((p, i) => {
    const isStr = typeof p === 'string';
    const data  = isStr ? p : (p && p.data) || '';
    const type  = isStr ? 'image/jpeg' : ((p && p.type) || '');
    const name  = isStr ? 'Photo' : ((p && p.name) || 'fichier');
    const isImg = type.startsWith('image/') || isStr; // les anciennes entrées (string) sont des photos
    const thumb = isImg
      ? `<img src="${data}" style="width:80px;height:80px;object-fit:cover;border-radius:10px;border:2px solid var(--border)" />`
      : `<div style="width:80px;height:80px;border-radius:10px;border:2px solid var(--border);background:var(--surface2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--accent2);padding:4px;box-sizing:border-box">
           <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
           <span style="font-size:9px;font-weight:700;text-transform:uppercase">${name.split('.').pop()}</span>
           <span style="font-size:8px;color:var(--muted);max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>
         </div>`;
    return `<div style="position:relative;display:inline-block">
      ${thumb}
      <button onclick="removeCmdPhoto(${i})" style="position:absolute;top:-6px;right:-6px;background:var(--red);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1">×</button>
    </div>`;
  }).join('');
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
  // Dates de livraison : disponibles quel que soit le mode (retrait ou livraison)
  const dateLiv       = document.getElementById('cmdDateLivraison')?.value || '';
  const dateLivProd   = document.getElementById('cmdDateLivraisonProd')?.value || '';
  const dateBAT       = document.getElementById('cmdDateBAT')?.value || '';
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
  const netTotal = total + fraisLiv; // NET À PAYER = articles − remise + frais de livraison
  const restant  = Math.max(0, netTotal - accompte);

  // Comparer l'acompte au NET À PAYER (frais de livraison inclus), pas au sous-total
  if (accompte > netTotal) { showToast("L'acompte ne peut pas dépasser le total !", 'error'); return; }

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
    id:               _genUid('C'),
    date:             new Date().toISOString(),
    caissier:         currentUser?.username || 'caissier',
    clientName, clientContact,
    deliveryMode:     cmdDelivMode,
    adresseLivraison: adresse,
    fraisLivraison:   fraisLiv,
    dateLivraison:     dateLiv,
    dateLivraisonProd: dateLivProd,
    dateBAT:           dateBAT,
    items:            cmdModalItems.map(i => ({ name: i.name.trim(), qty: i.qty, price: i.price, custom: !!i.custom })),
    notes,
    photos:           [...cmdModalPhotos],
    subtotal, remise, total: netTotal, accompte, restant,
    depositMethod:    cmdPayMode,
    depositProvider, depositRef,
    status:           'pending',
    dateFinalisation: null,
    saleId:           null
  };

  const _cmdDossier = _createDossierFromSource('commande', commande);
  commande.dossierId = _cmdDossier.id;
  commandes.unshift(commande);
  // Journal d'encaissement : l'acompte encaissé à la création (le cas échéant)
  if (accompte > 0) {
    _recordEncaissement({
      source: 'commande', refId: commande.id,
      refLabel: _cmdDossier.numeroDossier || _cmdRef(commande),
      client: clientName, montant: accompte,
      method: cmdPayMode, provider: depositProvider, ref: depositRef,
      type: restant > 0 ? 'acompte' : 'solde', resteApres: restant
    });
  }
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
  try { await loadCommandesFromScript(); await loadModifsFromScript(); }
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
  // Résumé KPIs (basé sur les commandes en cours) — inchangé
  const pending = commandes.filter(c => c.status === 'pending');
  if (document.getElementById('cmdSumCount'))   document.getElementById('cmdSumCount').textContent   = pending.length;
  if (document.getElementById('cmdSumTotal'))   document.getElementById('cmdSumTotal').textContent   = fmt(pending.reduce((s,c)=>s+(Number(c.total)||0),0));
  if (document.getElementById('cmdSumAcc'))     document.getElementById('cmdSumAcc').textContent     = fmt(pending.reduce((s,c)=>s+(Number(c.accompte)||0),0));
  if (document.getElementById('cmdSumRestant')) document.getElementById('cmdSumRestant').textContent = fmt(pending.reduce((s,c)=>s+(Number(c.restant)||0),0));
  // Ancien filtre/recherche → remplacés par la toolbar cockpit
  ['cmdSearch','cmdFilter'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  _ensureDossierLinks();
  renderCmdCockpit();
}

// ── Ancien rendu en cartes groupées (conservé pour référence / rollback) ────
function _renderCommandesLegacy() {
  const filter = document.getElementById('cmdFilter')?.value || 'pending';
  const _cq = (document.getElementById('cmdSearch')?.value||'').trim().toLowerCase();
  let list = commandes.filter(c => filter === 'all' ? true : c.status === filter);
  if (_cq) list = list.filter(c => ((c.clientName||'')+' '+(c.clientContact||'')+' '+(c.items||[]).map(i=>i.name||'').join(' ')).toLowerCase().includes(_cq));

  const container = document.getElementById('commandesList');
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--muted);padding:48px 20px;font-size:15px">Aucune commande${_cq?` pour « ${_cq} »`:(filter==='pending'?' en cours':'')}</div>`;
    return;
  }

  list.sort((a,b)=>{const da=parseSaleDate(a.date),db=parseSaleDate(b.date);if(!da&&!db)return 0;if(!da)return 1;if(!db)return -1;return db-da;});
  const _cgroups=[]; const _cmap={};
  list.forEach(c=>{ const k=_histDayKey(c.date); if(!_cmap[k]){_cmap[k]={key:k,date:c.date,rows:[],total:0};_cgroups.push(_cmap[k]);} _cmap[k].rows.push(c); _cmap[k].total+=Number(c.total)||0; });

  container.innerHTML = _cgroups.map((_g,_gi)=>{
    const gid='cg'+_gi;
    const _ghdr=`<div class="cmd-group" id="cgrp-${gid}" onclick="toggleCmdGroup('${gid}')"><svg class="gchev" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>${_histDayLabel(_g.date)}<span class="gcount">${_g.rows.length}</span><span class="gtotal">${fmt(_g.total)}</span></div>`;
    const _gcards=_g.rows.map(c => {
    try {
      const d = parseSaleDate(c.date);
      const dateStr = d ? d.toLocaleString('fr-FR') : '—';
      const statusLabel = { pending:'En cours', completed:'Livrée', cancelled:'Annulée' }[c.status] || c.status;
      const statusClass = { pending:'cmd-status-pending', completed:'cmd-status-completed', cancelled:'cmd-status-cancelled' }[c.status] || '';
      const itemsStr = (c.items||[]).map(i=>`${i.name} ×${i.qty} — ${fmt(i.price)}`).join('<br>')||'—';

      const deliveryHtml = (c.adresseLivraison || c.dateLivraison || c.dateBAT || c.dateLivraisonProd) ? `
        <div class="cmd-card-delivery">
          ${c.adresseLivraison ? ` ${c.adresseLivraison}` : ''}
          ${_dispDate(c.dateLivraison) ? ` &nbsp; Client : <strong>${_dispDate(c.dateLivraison)}</strong>` : ''}
          ${_dispDate(c.dateBAT) ? ` &nbsp; <span style="color:#2563eb">BAT : <strong>${_dispDate(c.dateBAT)}</strong></span>` : ''}
          ${_dispDate(c.dateLivraisonProd) ? ` &nbsp; <span style="color:#e8834a">Production : <strong>${_dispDate(c.dateLivraisonProd)}</strong></span>` : ''}
        </div>` : '';

      const notesHtml = c.notes ? `<div class="cmd-notes"> ${c.notes}</div>` : '';

      // Photos locales (base64) + pièces jointes Drive partagées
      const _cmdAtts = [
        ...(c.photos||[]).map(src => {
          if (typeof src === 'string') return { img: src, href: src, name: 'Photo' };
          const isImg = (src.type||'').startsWith('image/');
          return { img: isImg ? (src.data||'') : '', href: src.data||'', name: src.name||'fichier' };
        }),
        ...(c.attachments||[]).map(a => {
          const isImg = (a.type||'').startsWith('image/');
          return { img: isImg ? _driveImgSrc(a) : '', href: a.viewUrl||a.dlUrl||a.data||'', name: a.name||'fichier' };
        })
      ].filter(a => a.img || a.href);
      const photosHtml = _cmdAtts.length
        ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${_cmdAtts.map(a =>
            a.img
              ? `<img src="${a.img}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:pointer" onclick="window.open('${a.href||a.img}','_blank')" title="${a.name}" />`
              : `<a href="${a.href}" target="_blank" title="${a.name}" style="width:64px;height:64px;border-radius:8px;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--accent2);text-decoration:none">${(a.name||'').split('.').pop().toUpperCase()}</a>`
          ).join('')}</div>` : '';

      const itemCount = (c.items||[]).length;
      const _pSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
      const _dSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
      const printBtn = `<button class="hist-print-btn" onclick="printCommandeTicket(commandes.find(x=>String(x.id)==='${c.id}'))" title="Imprimer le bon de commande">${_pSvg}<span>Imprimer</span></button>`;
      const finalizeBtn = c.status === 'pending' ? `<button class="btn-finalize" onclick="openCmdFinalizeModal('${c.id}')">Finaliser</button>` : '';
      // Règles de modification :
      //  • Facture FINALISÉE → réservée à l'ADMIN (édition + « Dé-finaliser pour corriger »).
      //  • En cours, commercial → dates directes + demande validée admin pour les montants.
      //  • En cours, autres rôles → édition directe.
      const _isCommercial = currentUser?.role === 'commerciale';
      const _isAdmin      = currentUser?.role === 'admin';
      const _editDates =
          `<button class="kebab-item" role="menuitem" onclick="closeAllKebabs();editCommandeDateClient('${c.id}')">${_kebabIcon('edit')}<span>Modifier date livraison client</span></button>`
        + `<button class="kebab-item" role="menuitem" onclick="closeAllKebabs();editCommandeDateBAT('${c.id}')">${_kebabIcon('edit')}<span>Modifier date BAT</span></button>`
        + `<button class="kebab-item" role="menuitem" onclick="closeAllKebabs();editCommandeDateProd('${c.id}')">${_kebabIcon('edit')}<span>Modifier date production</span></button>`;
      const _editFull =
          `<button class="kebab-item" role="menuitem" onclick="closeAllKebabs();editCommandeAddress('${c.id}')">${_kebabIcon('edit')}<span>Modifier l'adresse</span></button>`
        + `<button class="kebab-item" role="menuitem" onclick="closeAllKebabs();editCommandeFrais('${c.id}')">${_kebabIcon('cash')}<span>Modifier les frais de livraison</span></button>`
        + _editDates;
      let kebabItems;
      if (c.status === 'completed') {
        kebabItems = _isAdmin
          ? _editFull + `<button class="kebab-item danger" role="menuitem" onclick="closeAllKebabs();definaliserCommande('${c.id}')">${_kebabIcon('reset')}<span>Dé-finaliser (corriger)</span></button>`
          : '';
      } else if (_isCommercial) {
        kebabItems = _editDates
          + `<button class="kebab-item" role="menuitem" onclick="closeAllKebabs();requestCommandeModif('${c.id}')">${_kebabIcon('edit')}<span>Demander une modification (montants…)</span></button>`
          + (c.status === 'pending' ? `<button class="kebab-item danger" role="menuitem" onclick="closeAllKebabs();requestCommandeCancel('${c.id}')">${_kebabIcon('trash')}<span>Demander l'annulation</span></button>` : '');
      } else {
        // Admin (et autres rôles habilités) : édition directe de TOUTE la commande + articles
        const _adminEditAll = _isAdmin
          ? `<button class="kebab-item" role="menuitem" onclick="closeAllKebabs();editCommandeAdmin('${c.id}')">${_kebabIcon('edit')}<span>Modifier la commande (tout + articles)</span></button>`
          : '';
        kebabItems = _adminEditAll + _editFull
          + (c.status === 'pending' ? `<button class="kebab-item danger" role="menuitem" onclick="closeAllKebabs();cancelCommande('${c.id}')">${_kebabIcon('trash')}<span>Annuler la commande</span></button>` : '');
      }
      const kebab = kebabItems ? `<div class="kebab-wrap">
             <button class="kebab-btn" aria-label="Plus d'actions" aria-haspopup="true" onclick="toggleKebab('cmd${c.id}',event)">${_dSvg}</button>
             <div class="kebab-menu" id="kb-cmd${c.id}" role="menu">${kebabItems}</div>
           </div>` : '';

      const _pmod = _pendingModFor(c.id);
      const modBanner = _pmod ? _buildModBanner(c, _pmod) : '';

      return `
      <div class="cmd-card" data-cgrp="${gid}">
        <div class="cmd-card-header">
          <div style="min-width:0">
            <div class="cmd-card-client">${c.clientName||'Client'} <span style="font-size:11px;color:var(--muted);font-weight:400">#${_factureNum(c)}</span></div>
            <div style="font-size:12px;color:var(--muted)">${c.clientContact ? c.clientContact+' · ' : ''}${dateStr}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <span class="cmd-status ${statusClass}">${statusLabel}</span>
            <div style="font-size:18px;font-weight:800;color:var(--text);margin-top:5px">${fmt(c.total)}</div>
          </div>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:13px">
          <span style="color:var(--muted)">Acompte <b style="color:var(--green)">${fmt(c.accompte)}</b></span>
          <span style="color:var(--muted)">Restant <b style="color:${c.status==='pending'?'var(--red)':'var(--muted)'}">${fmt(c.restant)}</b></span>
        </div>
        ${modBanner}
        <button class="cmd-detail-toggle" id="cmd-det-btn-${c.id}" onclick="toggleCmdDetail('${c.id}')">
          <svg class="hist-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          Détails (${itemCount} article${itemCount>1?'s':''})
        </button>
        <div class="cmd-detail" id="cmd-det-${c.id}">
          ${deliveryHtml}
          <div class="cmd-items">${itemsStr}</div>
          ${notesHtml}
          ${photosHtml}
        </div>
        <div class="res-actions" style="margin-top:10px">${finalizeBtn}${printBtn}${kebab}</div>
        ${c.status === 'pending' && c.dossierId ? _buildCardProductionSection(c.dossierId) : ''}
      </div>`;
    } catch(e) {
      return `<div class="cmd-card" style="color:var(--muted);font-size:13px;padding:12px"> Commande #${c.id} — erreur: ${e.message}</div>`;
    }
    }).join('');
    return _ghdr + _gcards;
  }).join('');
}

function updateCmdBadge() {
  const n = commandes.filter(c => c.status === 'pending').length;
  const badge = document.getElementById('navCmdBadge');
  if (badge) { badge.textContent = n; badge.style.display = n > 0 ? 'inline' : 'none'; }
}

// ════════════════════════════════════════════════════════════
// COCKPIT COMMANDES — même principe que le cockpit Production :
// tableau compact (une ligne = une commande), toolbar sticky (filtres +
// tri + recherche + densité), cartes d'alerte (livraisons urgentes),
// panneau latéral détail au clic. Couleurs : rouge=retard/impayé,
// orange=proche échéance, vert=soldé/livrée, gris=annulée.
// ════════════════════════════════════════════════════════════
let _cmdFilter   = 'EN_COURS'; // TOUS|EN_COURS|RETARD|AUJ|SEMAINE|IMPAYE|LIVREE|ANNULEE
let _cmdCaissier = 'TOUS';
let _cmdMode     = 'TOUS';     // TOUS|livraison|retrait
let _cmdSearch   = '';
let _cmdSort     = { key:'date', dir:'desc' }; // date|echeance|total|restant|client|statut
let _cmdDensity  = 'compact';
let _cmdLimit    = 60;
const _CMD_PAGE  = 60;

function _buildCommandeRows() {
  return (Array.isArray(commandes) ? commandes : []).map(c => {
    const dcmd = parseSaleDate(c.date);
    const ymd  = _toIsoDate(c.dateLivraison || '');
    const days = ymd ? _daysUntil(ymd) : null;
    const total   = Number(c.total) || 0;
    const restant = _cmdReste(c);          // reste réel (journal d'encaissements)
    const paid    = restant <= 0;
    // Progression production (si dossier lié)
    let prodPct = null;
    if (c.dossierId) {
      const dt = (Array.isArray(taches) ? taches : []).filter(t => t.dossierId === c.dossierId);
      if (dt.length) {
        prodPct = _dossierPct(dt, (Array.isArray(dossiers) ? dossiers : []).find(x => x.id === c.dossierId));
      }
    }
    let bucket = 'FUTUR';
    if (c.status === 'cancelled')      bucket = 'ANNULEE';
    else if (c.status === 'completed') bucket = 'LIVREE';
    else if (days != null && days < 0) bucket = 'RETARD';
    else if (days === 0)               bucket = 'AUJ';
    else if (days === 1)               bucket = 'DEMAIN';
    else if (days != null && days <= 7) bucket = 'SEMAINE';
    return {
      c, id: c.id,
      ref: '#' + _factureNum(c),
      client: c.clientName || 'Client',
      contact: c.clientContact || '',
      commercial: _resolveOperatorLabel(c.caissier || ''),
      dcmd, dateStr: dcmd ? dcmd.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' }) : '—',
      ymd, days,
      mode: c.deliveryMode === 'livraison' ? 'livraison' : 'retrait',
      items: c.items || [], nItems: (c.items||[]).length,
      produit: (c.items||[]).map(i => i.name).filter(Boolean).join(', '),
      total, accompte: _cmdEncaisse(c), restant, paid,
      status: c.status, bucket, prodPct,
      dossierId: c.dossierId || '',
    };
  });
}

function _cmdBucketMatch(r, k) {
  if (k === 'TOUS')     return true;
  if (k === 'EN_COURS') return r.status === 'pending';
  if (k === 'RETARD')   return r.status === 'pending' && r.days != null && r.days < 0;
  if (k === 'AUJ')      return r.status === 'pending' && r.days === 0;
  if (k === 'SEMAINE')  return r.status === 'pending' && r.days != null && r.days >= 0 && r.days <= 7;
  if (k === 'IMPAYE')   return r.status === 'pending' && r.restant > 0;
  if (k === 'LIVREE')   return r.status === 'completed';
  if (k === 'ANNULEE')  return r.status === 'cancelled';
  return true;
}

function _cmdFilterRows(rows) {
  let out = rows.filter(r => _cmdBucketMatch(r, _cmdFilter));
  if (_cmdCaissier !== 'TOUS') out = out.filter(r => _sameOp(r.commercial, _cmdCaissier) || _sameOp(r.c.caissier, _cmdCaissier));
  if (_cmdMode !== 'TOUS')     out = out.filter(r => r.mode === _cmdMode);
  const q = _cmdSearch.trim().toLowerCase();
  if (q) out = out.filter(r => (r.client + ' ' + r.contact + ' ' + r.produit + ' ' + r.ref).toLowerCase().includes(q));
  return out;
}

function _cmdSortRows(rows) {
  const { key, dir } = _cmdSort;
  const sign = dir === 'desc' ? -1 : 1;
  const order = { pending:0, completed:1, cancelled:2 };
  const dt = r => r.dcmd ? r.dcmd.getTime() : 0;
  const cmp = ({
    date:     (a,b) => dt(a) - dt(b),
    echeance: (a,b) => (a.days==null?1e9:a.days) - (b.days==null?1e9:b.days),
    total:    (a,b) => a.total - b.total,
    restant:  (a,b) => a.restant - b.restant,
    client:   (a,b) => a.client.localeCompare(b.client,'fr'),
    statut:   (a,b) => (order[a.status]??9) - (order[b.status]??9),
  })[key] || (() => 0);
  return rows.sort((a,b) => (sign * cmp(a,b)) || (dt(b) - dt(a)));
}

function renderCmdCockpit() {
  const container = document.getElementById('commandesList');
  if (!container) return;
  const all = _buildCommandeRows();
  const cnt = k => all.filter(r => _cmdBucketMatch(r, k)).length;
  const caisSet = [...new Set(all.map(r => r.commercial).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
  container.innerHTML =
    `<div class="pcok">
      ${_cmdToolbar(cnt, caisSet)}
      ${_cmdAlertCards(all)}
      <div id="cmdCockpitBody"></div>
    </div>`;
  _cmdRenderBody();
}

function _cmdRenderBody() {
  const body = document.getElementById('cmdCockpitBody');
  if (!body) return;
  const filtered = _cmdSortRows(_cmdFilterRows(_buildCommandeRows()));
  const page = filtered.slice(0, _cmdLimit);
  const totalSum = filtered.reduce((s,r)=>s+r.total,0);
  const restSum  = filtered.reduce((s,r)=>s+r.restant,0);
  const filteredLbl = (_cmdFilter!=='TOUS'||_cmdCaissier!=='TOUS'||_cmdMode!=='TOUS'||_cmdSearch) ? ' · filtré' : '';
  const count = `<div class="pcok-count">${filtered.length} commande${filtered.length>1?'s':''}${filteredLbl} · Total ${fmt(totalSum)}${restSum>0?` · Restant ${fmt(restSum)}`:''}</div>`;
  const more = filtered.length > _cmdLimit
    ? `<div class="pcok-more"><button onclick="_cmdShowMore()">Afficher plus (${filtered.length - _cmdLimit} restants)</button></div>` : '';
  body.innerHTML = count + _cmdTable(page) + more;
}

function _cmdToolbar(cnt, caisSet) {
  const chips = [
    ['TOUS','Toutes'], ['EN_COURS','En cours'], ['RETARD','En retard'], ['AUJ',"Aujourd'hui"], ['SEMAINE','Cette semaine'], ['IMPAYE','Impayés'], ['LIVREE','Livrées'], ['ANNULEE','Annulées']
  ].map(([k,lbl]) => {
    const active = _cmdFilter === k;
    const warn = (k==='RETARD'||k==='IMPAYE');
    return `<button class="pcok-chip ${active?'pcok-chip--active':''} ${warn?'pcok-chip--warn':''}" onclick="_cmdSetFilter('${k}')">${lbl}<span class="pcok-chip-n">${cnt(k)}</span></button>`;
  }).join('');
  const caisOpts = ['<option value="TOUS">Tous les commerciaux</option>']
    .concat(caisSet.map(o => `<option value="${_pcokEsc(o)}" ${_cmdCaissier===o?'selected':''}>${_pcokEsc(o)}</option>`)).join('');
  const modeOpts = [['TOUS','Tous les modes'],['livraison','Livraison'],['retrait','Retrait']]
    .map(([v,l]) => `<option value="${v}" ${_cmdMode===v?'selected':''}>${l}</option>`).join('');
  const sortOpts = [
    ['date','Date'], ['echeance','Livraison'], ['total','Montant'], ['restant','Restant dû'], ['client','Client'], ['statut','Statut']
  ].map(([k,l]) => `<option value="${k}" ${_cmdSort.key===k?'selected':''}>Trier : ${l}</option>`).join('');
  const dirIcon = _cmdSort.dir === 'asc' ? '↑' : '↓';
  return `<div class="pcok-toolbar">
    <div class="pcok-chips">${chips}</div>
    <div class="pcok-controls">
      <div class="pcok-search">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" placeholder="Rechercher client, article, réf…" value="${_pcokEsc(_cmdSearch)}" oninput="_cmdSetSearch(this.value)" />
      </div>
      <select class="select-input" onchange="_cmdSetCaissier(this.value)" title="Filtrer par commercial">${caisOpts}</select>
      <select class="select-input" onchange="_cmdSetMode(this.value)" title="Filtrer par mode">${modeOpts}</select>
      <select class="select-input" onchange="_cmdSetSort(this.value)" title="Trier">${sortOpts}</select>
      <button class="pcok-iconbtn" title="Sens du tri" onclick="_cmdToggleSortDir()">${dirIcon}</button>
      <button class="pcok-iconbtn pcok-density" title="Vue compacte / détaillée" onclick="_cmdToggleDensity()">${_cmdDensity==='compact'?'Détaillé':'Compact'}</button>
    </div>
  </div>`;
}

function _cmdAlertCards(rows) {
  const alert = rows.filter(r => r.status==='pending' && (r.bucket==='RETARD'||r.bucket==='AUJ'||r.bucket==='DEMAIN'))
    .sort((a,b) => (a.days==null?1e9:a.days) - (b.days==null?1e9:b.days))
    .slice(0, 8);
  if (!alert.length) return '';
  const cards = alert.map(r => {
    const late = r.days != null && r.days < 0;
    const accent = late ? '#dc2626' : '#e8834a';
    const bg = late ? '#fef2f2' : '#fff8f3';
    const cd = r.days == null ? '' : late ? `${Math.abs(r.days)}j de retard` : r.days===0 ? "Aujourd'hui" : 'Demain';
    return `<button class="pcok-alert" style="border-left:3px solid ${accent};background:${bg}" onclick="openCmdDrawer('${r.id}')">
      <div class="pcok-alert-top"><span style="color:${accent};font-weight:800">${cd}</span>${r.restant>0?`<span class="pcok-alert-pct" style="color:#dc2626">Reste ${fmt(r.restant)}</span>`:'<span class="pcok-alert-pct" style="color:#16a34a">Soldé</span>'}</div>
      <div class="pcok-alert-client">${_pcokEsc(r.client)}</div>
      <div class="pcok-alert-step">${r.mode==='livraison'?'Livraison':'Retrait'} · ${fmt(r.total)}</div>
    </button>`;
  }).join('');
  return `<div class="pcok-alerts"><div class="pcok-alerts-title">Livraisons urgentes <span>${alert.length}</span></div><div class="pcok-alerts-row">${cards}</div></div>`;
}

function _cmdTable(rows) {
  if (!rows.length) return `<div class="pcok-empty">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4"><polyline points="20 6 9 17 4 12"/></svg>
    <p>Aucune commande${_cmdFilter!=='TOUS'||_cmdSearch?' dans ce filtre':''}</p>
  </div>`;
  const det = _cmdDensity === 'detaille';
  const th = (key, label, cls='') => {
    const active = key && _cmdSort.key === key;
    const arrow = active ? (_cmdSort.dir==='asc' ? ' ↑' : ' ↓') : '';
    return `<th class="pcok-th ${cls} ${active?'pcok-th--active':''}" ${key?`onclick="_cmdSetSort('${key}')" style="cursor:pointer"`:''}>${label}${arrow}</th>`;
  };
  const head = `<tr>
    ${th('statut','')}
    ${th('client','Réf / Client')}
    ${det ? th('date','Date') : ''}
    ${th('echeance','Livraison')}
    ${det ? th('', 'Articles') : ''}
    ${th('total','Total','pcok-num')}
    ${th('restant','Restant','pcok-num')}
    ${det ? th('', 'Prod.') : ''}
    ${th('statut','Statut')}
    <th class="pcok-th"></th>
  </tr>`;
  return `<div class="pcok-tablewrap"><table class="pcok-table"><thead>${head}</thead><tbody>${rows.map(_cmdRow).join('')}</tbody></table></div>`;
}

function _cmdRow(r) {
  const det = _cmdDensity === 'detaille';
  const dotC = r.status==='cancelled'?'#a8a29e':r.status==='completed'?'#16a34a':(r.days!=null&&r.days<0)?'#dc2626':(r.days===0||r.days===1)?'#e8834a':'#2563eb';
  const dot = `<span class="pcok-prio" style="background:${dotC}"></span>`;
  // Livraison échéance + retard
  let ech = '—', echC = 'var(--color-text-secondary)';
  if (r.ymd) {
    ech = new Date(r.ymd+'T00:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'});
    if (r.status==='pending') {
      if (r.days<0) echC='#dc2626'; else if (r.days===0||r.days===1) echC='#e8834a';
    }
  }
  let retTxt='', retC='#78716c';
  if (r.status==='completed') { retTxt='Livrée'; retC='#16a34a'; }
  else if (r.status==='cancelled') { retTxt='Annulée'; retC='#a8a29e'; }
  else if (r.days==null) { retTxt='—'; retC='#a8a29e'; }
  else if (r.days<0) { retTxt=`+${Math.abs(r.days)}j`; retC='#dc2626'; }
  else if (r.days===0) { retTxt='Auj.'; retC='#e8834a'; }
  else if (r.days===1) { retTxt='Demain'; retC='#e8834a'; }
  else if (r.days<=7) { retTxt=`${r.days}j`; retC='#d97706'; }
  else { retTxt=`${r.days}j`; retC='#78716c'; }
  const echCell = `<div style="color:${echC};font-weight:600">${ech}</div><div class="pcok-ret" style="color:${retC};background:${retC}1a;margin-top:2px">${retTxt}</div>`;
  const restC = r.status!=='pending' ? '#a8a29e' : r.restant>0 ? '#dc2626' : '#16a34a';
  const restTxt = r.restant>0 ? fmt(r.restant) : (r.status==='pending'?'Soldé':'—');
  const prodCell = r.prodPct==null ? '<span class="pcok-muted">—</span>'
    : `<div class="pcok-prog"><div class="pcok-prog-bar"><div style="width:${r.prodPct}%;background:${r.prodPct===100?'#16a34a':'#e8834a'}"></div></div><span class="pcok-prog-n" style="color:${r.prodPct===100?'#16a34a':'#e8834a'}">${r.prodPct}%</span></div>`;
  const stMap = { pending:['#d97706','#fef3c7','En cours'], completed:['#16a34a','#dcfce7','Livrée'], cancelled:['#78716c','#f5f5f4','Annulée'] };
  const [sc,sb,sl] = stMap[r.status] || ['#78716c','#f5f5f4','—'];
  const statut = `<span class="pcok-badge" style="color:${sc};background:${sb}">${sl}</span>`;
  // Demande de modification / annulation en attente → pastille visible (validation dans le drawer)
  const _pmod = _pendingModFor(r.id);
  const modChip = _pmod ? `<span class="pcok-badge" style="color:#b45309;background:#fef3c7;margin-left:4px" title="Demande ${_pmod.type==='cancel'?"d'annulation":'de modification'} en attente — ouvrir pour valider">⏳ ${_pmod.type==='cancel'?'Annul.':'Modif'}</span>` : '';
  const modeChip = `<span style="font-size:9px;font-weight:700;color:${r.mode==='livraison'?'#c2410c':'#1a4a3a'}">${r.mode==='livraison'?'LIV':'RET'}</span>`;
  const accent = r.status==='cancelled' ? '' : r.status==='completed' ? '' : (r.days!=null&&r.days<0) ? 'inset 3px 0 0 #dc2626' : (r.days===0||r.days===1) ? 'inset 3px 0 0 #e8834a' : r.restant>0 ? 'inset 3px 0 0 #d97706' : '';
  return `<tr class="pcok-row ${r.status==='cancelled'?'pcok-row--done':''}" ${accent?`style="box-shadow:${accent}"`:''} onclick="openCmdDrawer('${r.id}')">
    <td class="pcok-td-prio">${dot}</td>
    <td class="pcok-td-client"><div class="pcok-client">${_pcokEsc(r.client)} ${modeChip}</div><div class="pcok-ref">${_pcokEsc(r.ref)}${r.contact?' · '+_pcokEsc(r.contact):''}</div></td>
    ${det ? `<td class="pcok-td-ech">${r.dateStr}</td>` : ''}
    <td class="pcok-td-ech">${echCell}</td>
    ${det ? `<td class="pcok-muted">${r.nItems} art.</td>` : ''}
    <td class="pcok-num" style="font-weight:700">${fmt(r.total)}</td>
    <td class="pcok-num" style="color:${restC};font-weight:700">${restTxt}</td>
    ${det ? `<td class="pcok-td-prog">${prodCell}</td>` : ''}
    <td class="pcok-td-statut">${statut}${modChip}</td>
    <td class="pcok-td-act"><svg class="pcok-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></td>
  </tr>`;
}

// ── Drawer détail commande ─────────────────────────────────────────────────
function openCmdDrawer(id) {
  const c = commandes.find(x => String(x.id) === String(id));
  const drawer = document.getElementById('cmdDrawer');
  const body   = document.getElementById('cmdDrawerBody');
  if (!c || !drawer || !body) return;
  closeDrawers();
  body.innerHTML = _cmdDrawerContent(c);
  drawer.classList.add('open');
  document.body.classList.add('pcok-drawer-open');
  _ensureChronoTick();
}

function _cmdDrawerContent(c) {
  const r = _buildCommandeRows().find(x => String(x.id) === String(c.id)) || {};
  const _pmod = _pendingModFor(c.id); // demande en attente → bandeau + boutons valider/refuser (admin)
  const dCmd = r.dcmd ? r.dcmd.toLocaleString('fr-FR') : '—';
  const stMap = { pending:['#d97706','#fef3c7','En cours'], completed:['#16a34a','#dcfce7','Livrée'], cancelled:['#78716c','#f5f5f4','Annulée'] };
  const [sc,sb,sl] = stMap[c.status] || ['#78716c','#f5f5f4','—'];
  const livTxt = r.ymd ? new Date(r.ymd+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long'}) : '';
  const dtxt = r.days==null ? '' : r.days<0 ? `${Math.abs(r.days)}j de retard` : r.days===0 ? "Aujourd'hui" : r.days===1 ? 'Demain' : `${r.days}j`;
  const dCol = r.days!=null && r.days<0 ? '#dc2626' : (r.days===0||r.days===1) ? '#e8834a' : '#16a34a';
  const itemsHtml = (c.items||[]).map(i => `<div class="pcok-drawer-item"><span>${_pcokEsc(i.name)} × ${i.qty}</span><b>${fmt((Number(i.price)||0)*(Number(i.qty)||1))}</b></div>`).join('') || '<div class="pcok-muted" style="font-size:12px">Aucun article</div>';
  const datesHtml = [
    _dispDate(c.dateLivraison) ? `<div class="pcok-drawer-item"><span>Livraison client</span><b>${_dispDate(c.dateLivraison)}</b></div>` : '',
    _dispDate(c.dateBAT) ? `<div class="pcok-drawer-item"><span style="color:#2563eb">BAT</span><b>${_dispDate(c.dateBAT)}</b></div>` : '',
    _dispDate(c.dateLivraisonProd) ? `<div class="pcok-drawer-item"><span style="color:#e8834a">Production</span><b>${_dispDate(c.dateLivraisonProd)}</b></div>` : '',
  ].join('');
  const modeHtml = `<div class="pcok-drawer-item"><span>Mode</span><b>${r.mode==='livraison'?'Livraison':'Retrait boutique'}</b></div>${c.adresseLivraison?`<div class="pcok-drawer-item"><span>Adresse</span><b style="text-align:right;white-space:normal">${_pcokEsc(c.adresseLivraison)}</b></div>`:''}`;
  // Pièces jointes (photos locales + Drive)
  const atts = [
    ...(c.photos||[]).map(src => typeof src==='string' ? { img:src, href:src, name:'Photo' } : { img:(src.type||'').startsWith('image/')?(src.data||''):'', href:src.data||'', name:src.name||'fichier' }),
    ...(c.attachments||[]).map(a => ({ img:(a.type||'').startsWith('image/')?_driveImgSrc(a):'', href:a.viewUrl||a.dlUrl||a.data||'', name:a.name||'fichier' }))
  ].filter(a => a.img || a.href);
  const photosHtml = atts.length ? `<div class="pcok-drawer-photos">${atts.map(a => a.img
    ? `<img src="${a.img}" onclick="window.open('${a.href||a.img}','_blank')" title="${_pcokEsc(a.name)}" />`
    : `<a href="${a.href}" target="_blank" title="${_pcokEsc(a.name)}">${(a.name||'').split('.').pop().toUpperCase()}</a>`).join('')}</div>` : '';
  const pipe = r.dossierId ? _cmdPipelineHtml(r.dossierId) : '';
  return `<div class="pcok-drawer-head">
      <div style="min-width:0">
        <div class="pcok-drawer-ref">${_pcokEsc(r.ref||'')}${r.commercial?' · '+_pcokEsc(r.commercial):''}</div>
        <div class="pcok-drawer-client">${_pcokEsc(c.clientName||'Client')}</div>
      </div>
      <button class="pcok-drawer-close" onclick="closeDrawers()" aria-label="Fermer">×</button>
    </div>
    <div class="pcok-drawer-meta">
      <span class="pcok-badge" style="color:${sc};background:${sb}">${sl}</span>
      ${c.clientContact?`<span style="font-size:12.5px;color:var(--color-text-secondary)">${_pcokEsc(c.clientContact)}</span>`:''}
      <span style="font-size:11px;color:var(--color-text-muted);margin-left:auto">${dCmd}</span>
    </div>
    ${livTxt?`<div class="pcok-drawer-ech" style="color:${dCol};margin-bottom:12px">Livraison : ${livTxt}${dtxt?' · '+dtxt:''}</div>`:''}
    ${_pmod ? _buildModBanner(c, _pmod) : ''}
    <div class="pcok-pay">
      <div class="pcok-pay-c"><div class="pcok-pay-l">Total</div><div class="pcok-pay-v">${fmt(c.total)}</div></div>
      <div class="pcok-pay-c"><div class="pcok-pay-l">Encaissé</div><div class="pcok-pay-v" style="color:#16a34a">${fmt(_cmdEncaisse(c))}</div></div>
      <div class="pcok-pay-c"><div class="pcok-pay-l">Restant</div><div class="pcok-pay-v" style="color:${_cmdReste(c)>0?'#dc2626':'#16a34a'}">${fmt(_cmdReste(c))}</div></div>
    </div>
    <div class="pcok-drawer-pipe-title">Articles (${(c.items||[]).length})</div>
    <div class="pcok-drawer-items">${itemsHtml}</div>
    <div class="pcok-drawer-pipe-title">Livraison</div>
    <div class="pcok-drawer-items">${modeHtml}${datesHtml}</div>
    ${c.notes?`<div class="pcok-drawer-note">${_pcokEsc(c.notes)}</div>`:''}
    ${photosHtml}
    ${pipe}
    ${_cmdDrawerActions(c)}`;
}

function _cmdPipelineHtml(dossierId) {
  const r = _buildDossierRows().find(x => x.dossierId === dossierId);
  if (!r) return '';
  return `<div class="pcok-drawer-pipe-title">Production — ${r.pct}%</div>
    <div class="pcok-drawer-prog"><div class="pcok-prog-bar"><div style="width:${r.pct}%;background:${r.pct===100?'#16a34a':'#e8834a'}"></div></div><span>${r.pct}%</span></div>
    <div class="pcok-drawer-pipe">${_pcokStepsHtml(r.steps)}</div>`;
}

function _cmdDrawerActions(c) {
  const isCommercial = currentUser?.role === 'commerciale';
  const isAdmin      = currentUser?.role === 'admin';
  const canAttrib    = PAGE_ACCESS.attribution.includes(currentUser?.role);
  const btns = [];
  if (c.status === 'pending' && _cmdReste(c) > 0)
    btns.push(`<button class="pcok-btn" style="color:#16a34a;border-color:rgba(22,163,74,.4)" onclick="closeDrawers();openEncaisseModal('${c.id}')">Encaisser</button>`);
  if (c.status === 'pending')
    btns.push(`<button class="pcok-btn pcok-btn--primary" onclick="closeDrawers();openCmdFinalizeModal('${c.id}')">Finaliser</button>`);
  btns.push(`<button class="pcok-btn" onclick="printCommandeTicket(commandes.find(x=>String(x.id)==='${c.id}'))">Imprimer</button>`);
  if (c.dossierId && canAttrib)
    btns.push(`<button class="pcok-btn" onclick="closeDrawers();openAttribForDossier('${c.dossierId}')">Production →</button>`);
  // Modifications de dates (toujours utiles)
  btns.push(`<button class="pcok-btn" onclick="closeDrawers();editCommandeDateClient('${c.id}')">Date livraison</button>`);
  btns.push(`<button class="pcok-btn" onclick="closeDrawers();editCommandeDateProd('${c.id}')">Date production</button>`);
  if (c.status === 'completed' && isAdmin)
    btns.push(`<button class="pcok-btn" style="color:#dc2626" onclick="closeDrawers();definaliserCommande('${c.id}')">Dé-finaliser</button>`);
  else if (isCommercial && c.status === 'pending') {
    btns.push(`<button class="pcok-btn" onclick="closeDrawers();requestCommandeModif('${c.id}')">Demander modif</button>`);
    btns.push(`<button class="pcok-btn" style="color:#dc2626" onclick="closeDrawers();requestCommandeCancel('${c.id}')">Demander annulation</button>`);
  } else if (!isCommercial && c.status === 'pending') {
    if (isAdmin)
      btns.push(`<button class="pcok-btn pcok-btn--primary" onclick="closeDrawers();editCommandeAdmin('${c.id}')">Modifier (tout)</button>`);
    btns.push(`<button class="pcok-btn" onclick="closeDrawers();editCommandeAddress('${c.id}')">Adresse</button>`);
    btns.push(`<button class="pcok-btn" onclick="closeDrawers();editCommandeFrais('${c.id}')">Frais livraison</button>`);
    btns.push(`<button class="pcok-btn" style="color:#dc2626" onclick="closeDrawers();cancelCommande('${c.id}')">Annuler</button>`);
  }
  return `<div class="pcok-drawer-actions pcok-drawer-actions--wrap">${btns.join('')}</div>`;
}

// ── Setters cockpit commandes ──────────────────────────────────────────────
function _cmdSetFilter(k){ _cmdFilter = k; _cmdLimit = _CMD_PAGE; renderCmdCockpit(); }
function _cmdSetCaissier(v){ _cmdCaissier = v; _cmdLimit = _CMD_PAGE; renderCmdCockpit(); }
function _cmdSetMode(v){ _cmdMode = v; _cmdLimit = _CMD_PAGE; renderCmdCockpit(); }
function _cmdSetSort(k){
  if (_cmdSort.key === k) _cmdSort.dir = _cmdSort.dir==='asc' ? 'desc' : 'asc';
  else { _cmdSort.key = k; _cmdSort.dir = (k==='client') ? 'asc' : 'desc'; }
  renderCmdCockpit();
}
function _cmdToggleSortDir(){ _cmdSort.dir = _cmdSort.dir==='asc' ? 'desc' : 'asc'; renderCmdCockpit(); }
function _cmdToggleDensity(){ _cmdDensity = _cmdDensity==='compact' ? 'detaille' : 'compact'; renderCmdCockpit(); }
function _cmdSetSearch(v){ _cmdSearch = v; _cmdLimit = _CMD_PAGE; _cmdRenderBody(); }
function _cmdShowMore(){ _cmdLimit += _CMD_PAGE; _cmdRenderBody(); }

// ============================================================
// COMMANDES — FINALISER
// ============================================================
function openCmdFinalizeModal(id) {
  const c = commandes.find(x => String(x.id) === String(id));
  if (!c) return;
  currentCmdFinalizeId = id;
  document.getElementById('cmdFinalClientInfo').textContent = ` ${c.clientName}${c.clientContact?' — '+c.clientContact:''}`;
  document.getElementById('cmdFinalTotal').textContent   = fmt(c.total);
  document.getElementById('cmdFinalAcc').textContent     = fmt(_cmdEncaisse(c));   // déjà encaissé (journal)
  document.getElementById('cmdFinalRestant').textContent = fmt(_cmdReste(c));      // reste réel
  document.getElementById('cmdFinGiven').value = '';
  document.getElementById('cmdFinChangeVal').textContent = '0 Ar';
  document.getElementById('cmdFinMobileRef').value = '';
  const _cb = document.getElementById('cmdFinChequeBank');       if (_cb) _cb.value = '';
  const _cn = document.getElementById('cmdFinChequeNumber');     if (_cn) _cn.value = '';
  const _ct = document.getElementById('cmdFinChequeTitulaire');  if (_ct) _ct.value = '';
  const _cd = document.getElementById('cmdFinChequeDate');       if (_cd) _cd.value = '';
  cmdFinalPayMode = 'cash';
  cmdFinalProvider = 'MVola';
  switchCmdFinPayTab('cash');
  openModal('cmdFinalizeModal');
}

function switchCmdFinPayTab(mode) {
  cmdFinalPayMode = mode;
  document.getElementById('cmdFinCashSection').style.display  = mode==='cash'   ? 'block' : 'none';
  document.getElementById('cmdFinMobileSection').style.display = mode==='mobile' ? 'block' : 'none';
  const chequeSec = document.getElementById('cmdFinChequeSection');
  if (chequeSec) chequeSec.style.display = mode==='cheque' ? 'block' : 'none';
  document.getElementById('tabCmdFinCash').classList.toggle('active', mode==='cash');
  document.getElementById('tabCmdFinMobile').classList.toggle('active', mode==='mobile');
  const tabCheque = document.getElementById('tabCmdFinCheque');
  if (tabCheque) tabCheque.classList.toggle('active', mode==='cheque');
}

function calcCmdFinChange() {
  const c = commandes.find(x => String(x.id) === String(currentCmdFinalizeId));
  if (!c) return;
  const given  = parseFloat(document.getElementById('cmdFinGiven').value) || 0;
  const change = given - _cmdReste(c);
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
  const reste = _cmdReste(c);   // reste réel (journal) — robuste aux refresh serveur
  if (cmdFinalPayMode === 'cash') {
    const given = parseFloat(document.getElementById('cmdFinGiven').value) || 0;
    if (given < reste) { showToast('Montant insuffisant !', 'error'); return; }
    _doCmdFinalize(c, 'cash', given, given - reste, null, null);
  } else if (cmdFinalPayMode === 'cheque') {
    const bank      = document.getElementById('cmdFinChequeBank').value.trim();
    const number    = document.getElementById('cmdFinChequeNumber').value.trim();
    const titulaire = document.getElementById('cmdFinChequeTitulaire').value.trim();
    const dateCheque= document.getElementById('cmdFinChequeDate').value;
    if (!bank)   { showToast('Veuillez saisir la banque du chèque.', 'error'); return; }
    if (!number) { showToast('Veuillez saisir le numéro du chèque.', 'error'); return; }
    // provider = banque, ref = numéro du chèque (réutilise le schéma de vente) ; titulaire + date stockés en extra
    _doCmdFinalize(c, 'cheque', reste, 0, bank, number, { titulaire, date: dateCheque });
  } else {
    const ref = document.getElementById('cmdFinMobileRef').value.trim();
    _doCmdFinalize(c, 'mobile', reste, 0, cmdFinalProvider, ref);
  }
}

// ============================================================
// ENCAISSER — paiement partiel d'une commande (acompte complémentaire)
// Money-only : n'affecte NI le stock NI le statut. La finalisation reste
// l'événement de livraison qui solde et déduit le stock.
// ============================================================
let currentEncaisseId = null;

function openEncaisseModal(id) {
  const c = commandes.find(x => String(x.id) === String(id));
  if (!c) return;
  currentEncaisseId = c.id;
  const reste = _cmdReste(c);
  const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.textContent = v; };
  set('encClientInfo', `${c.clientName}${c.clientContact ? ' — ' + c.clientContact : ''}`);
  set('encRefLabel',   _cmdRef(c));
  set('encTotal',      fmt(c.total));
  set('encDejaVal',    fmt(_cmdEncaisse(c)));
  set('encResteVal',   fmt(reste));
  const mEl = document.getElementById('encMontant');
  if (mEl) { mEl.value = reste || ''; mEl.max = reste; }
  const methEl = document.getElementById('encMethod');   if (methEl) methEl.value = 'cash';
  const refEl  = document.getElementById('encRefInput'); if (refEl)  refEl.value = '';
  updateEncaisseApercu();
  openModal('encaisseModal');
}

function updateEncaisseApercu() {
  const c = commandes.find(x => String(x.id) === String(currentEncaisseId));
  if (!c) return;
  const reste   = _cmdReste(c);
  const montant = Math.min(Math.max(0, Number(document.getElementById('encMontant')?.value) || 0), reste);
  const after   = Math.max(0, reste - montant);
  const el = document.getElementById('encApresVal');
  if (el) { el.textContent = fmt(after); el.style.color = after > 0 ? '#dc2626' : '#16a34a'; }
  const lbl = document.getElementById('encTypeLabel');
  if (lbl) lbl.textContent = after > 0 ? 'Acompte (reste dû après)' : 'Solde — commande payée intégralement';
}

function validerEncaissement() {
  const c = commandes.find(x => String(x.id) === String(currentEncaisseId));
  if (!c) return;
  const reste   = _cmdReste(c);
  const montant = Math.min(Math.max(0, Number(document.getElementById('encMontant')?.value) || 0), reste);
  if (montant <= 0) { showToast('Saisissez un montant à encaisser.', 'error'); return; }
  const method  = document.getElementById('encMethod')?.value || 'cash';
  const refTxt  = document.getElementById('encRefInput')?.value?.trim() || '';
  const after   = Math.max(0, reste - montant);

  // Backfill : commande ancienne (aucun événement) avec acompte d'origine → l'inscrire
  // au journal (daté de la création, donc hors fiche du jour) pour que le total reste juste.
  const hasEvents = encaissements.some(e => e.source === 'commande' && String(e.refId) === String(c.id));
  const baseAcc   = Number(c.accompte) || 0;
  if (!hasEvents && baseAcc > 0) {
    _recordEncaissement({
      source: 'commande', refId: c.id, refLabel: _cmdRef(c),
      client: c.clientName, montant: baseAcc, method: c.depositMethod || 'cash',
      provider: c.depositProvider || '', ref: c.depositRef || '',
      type: 'acompte', resteApres: Math.max(0, (Number(c.total) || 0) - baseAcc),
      date: c.date
    });
  }

  _recordEncaissement({
    source: 'commande', refId: c.id, refLabel: _cmdRef(c),
    client: c.clientName, montant,
    method, ref: refTxt,
    type: after > 0 ? 'paiement' : 'solde', resteApres: after
  });

  // Mise à jour des montants de la commande (accompte cumulé / reste)
  c.accompte = (Number(c.accompte) || 0) + montant;
  c.restant  = after;
  c._dateEditedAt = Date.now();
  saveData();
  syncCmdUpdateToSheets(c);
  try { syncCmdUpdateToAirtable(c); } catch (e) {}
  _addNotification({
    dossierId: c.dossierId || '', numeroDossier: _cmdRef(c),
    etapeCode: 'ENCAISSE', etapeLabel: after > 0 ? 'Acompte encaissé' : 'Commande soldée',
    operateur: currentUser?.label || 'Caissier',
    message: `${fmt(montant)} encaissé sur ${_cmdRef(c)} — ${c.clientName}${after > 0 ? ` — reste ${fmt(after)}` : ' — soldée'}`
  });
  closeModal('encaisseModal');
  showToast(`${fmt(montant)} encaissé — ${after > 0 ? 'reste ' + fmt(after) : 'commande soldée'}`);
  renderCommandes();
  updateCmdBadge();
  if (document.getElementById('page-mon-dashboard')?.classList.contains('active')) renderMonDashboard();
  _refreshArretIfOpen();   // si lancé depuis l'arrêt de caisse : la fiche du jour intègre ce solde
}

function _doCmdFinalize(c, method, given, change, provider, ref, chequeInfo) {
  const sale = {
    id:            nextSaleId++,
    date:          new Date().toISOString(),
    caissier:      c.caissier || currentUser?.username || 'caissier',
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
  if (method === 'cheque' && chequeInfo) {
    sale.chequeBank      = provider || '';
    sale.chequeNumber    = ref      || '';
    sale.chequeTitulaire = chequeInfo.titulaire || '';
    sale.chequeDate      = chequeInfo.date      || '';
  }
  c.items.forEach(item => {
    if (!item.custom) {
      const p = products.find(pr => pr.name === item.name);
      if (p) p.stock = Math.max(0, p.stock - item.qty);
    }
  });
  sales.unshift(sale);
  // Journal d'encaissement : le SOLDE réellement encaissé maintenant (reste dû, pas le total)
  const _resteSolde = _cmdReste(c);
  if (_resteSolde > 0) {
    _recordEncaissement({
      source: 'commande', refId: c.id, refLabel: _cmdRef(c),
      client: c.clientName, montant: _resteSolde,
      method, provider: provider || '', ref: ref || '',
      type: 'solde', resteApres: 0
    });
  }
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
  _refreshArretIfOpen();   // si lancé depuis l'arrêt de caisse : la fiche du jour intègre le solde
}

// ── Dé-finaliser une commande (ADMIN uniquement) ───────────────────────────
// Corrige une facture finalisée par erreur : supprime la vente liée (local + GAS),
// restitue le stock, repasse la commande en « en cours » pour pouvoir la corriger
// puis la re-finaliser proprement.
function definaliserCommande(id) {
  if (currentUser?.role !== 'admin') { showToast('Réservé à l\'administrateur', 'error'); return; }
  const c = commandes.find(x => String(x.id) === String(id));
  if (!c || c.status !== 'completed') { showToast('Commande non finalisée', 'error'); return; }
  if (!confirm(`Dé-finaliser la commande de ${c.clientName || 'client'} ?\n\nLa vente liée sera supprimée et la commande repassera en « en cours » pour correction. Vous pourrez ensuite la re-finaliser.`)) return;

  const saleId = c.saleId;
  if (saleId != null && saleId !== '') {
    // Restituer le stock déduit à la finalisation
    const sale = sales.find(s => String(s.id) === String(saleId));
    if (sale && Array.isArray(sale.items)) {
      sale.items.forEach(item => {
        if (item.custom) return;
        const p = products.find(pr => pr.name === item.name);
        if (p) p.stock = (Number(p.stock) || 0) + (Number(item.qty) || 0);
      });
    }
    sales = sales.filter(s => String(s.id) !== String(saleId));
    if (APPS_SCRIPT_URL) apiCall({ action: 'deleteSale', id: saleId, by: currentUser?.username || 'admin' }).catch(() => {});
  }

  // Annuler l'encaissement du SOLDE enregistré à la finalisation (l'acompte reste acquis)
  encaissements = encaissements.filter(e => !(e.source === 'commande' && String(e.refId) === String(c.id) && e.type === 'solde'));

  c.status = 'pending';
  c.dateFinalisation = null;
  c.saleId = null;
  c._dateEditedAt = Date.now();
  saveData();
  renderProducts(); renderStockTable(); renderStats(); renderCommandes(); updateCmdBadge();
  try { renderFinances(); } catch(e) {}
  syncCmdUpdateToSheets(c);
  _addNotification({
    dossierId: c.dossierId || '', numeroDossier: c.numeroDossier || `CMD-${c.id}`,
    etapeCode: 'MODIF', etapeLabel: 'Facture dé-finalisée',
    operateur: currentUser?.label || 'Admin',
    message: `Facture de ${c.clientName} dé-finalisée par l'admin pour correction`
  });
  showToast('Commande dé-finalisée — corrigez puis re-finalisez');
}

// ============================================================
// COMMANDES — ANNULER
// ============================================================
// Annulation effective d'une commande (stock + statut + sync + notif). Sans confirmation.
function _applyCommandeCancel(c) {
  if (!c) return;
  // Restituer le stock pour les articles en catalogue (identique à cancelReservation)
  (Array.isArray(c.items) ? c.items : []).forEach(function(item) {
    if (item.custom) return;
    const p = products.find(function(pr) { return pr.name === item.name; });
    if (p) p.stock = (p.stock || 0) + (Number(item.qty) || 0);
  });
  c.status = 'cancelled';
  saveData();
  renderProducts();
  renderStockTable();
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
  _deleteTachesForDossier(c.dossierId);
}

function cancelCommande(id) {
  const c = commandes.find(x => String(x.id) === String(id));
  if (!c || c.status !== 'pending') return;
  if (!confirm(`Annuler la commande #${c.id} de ${c.clientName} ?`)) return;
  _applyCommandeCancel(c);
  showToast(`Commande #${c.id} annulée`, 'info');
}

// ============================================================
// COMMANDES — DEMANDES DE MODIFICATION (commercial → validation admin)
// ============================================================
function _fmtModDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}
function _modVal(key, v) {
  if (key === 'depositMethod') return _depositLabel(v);
  if (key === 'deliveryMode') return v === 'livraison' ? 'Livraison' : (v === 'retrait' ? 'Retrait boutique' : (v || '—'));
  if (CMD_MODIF_NUMKEYS.includes(key)) return fmt(Number(v) || 0);
  return (v === '' || v == null) ? '—' : String(v);
}

// Bandeau affiché sur la carte commande quand une demande est en attente
function _buildModBanner(c, mod) {
  const isAdmin = currentUser?.role === 'admin';
  const who = `${mod.auteurLabel || mod.auteur || 'Commercial'} · ${_fmtModDate(mod.timestamp)}`;
  let detail;
  if (mod.type === 'cancel') {
    detail = `<div class="mod-title"> Demande d'annulation</div>${mod.reason ? `<div class="mod-reason">« ${mod.reason} »</div>` : ''}`;
  } else {
    const _fmtItems = arr => (Array.isArray(arr) && arr.length)
      ? arr.map(i => `${i.name} ×${i.qty} @ ${fmt(i.price)}`).join('<br>')
      : '—';
    const lines = Object.entries(mod.changes || {}).map(([k, v]) =>
      k === 'items'
        ? `<div class="mod-diff mod-diff--items"><span class="mod-diff-label">${v.label || 'Articles'}</span><div class="mod-old">${_fmtItems(v.old)}</div><span class="mod-arrow">→</span><div class="mod-new">${_fmtItems(v.new)}</div></div>`
        : `<div class="mod-diff"><span class="mod-diff-label">${v.label || k}</span><span class="mod-old">${_modVal(k, v.old)}</span><span class="mod-arrow">→</span><span class="mod-new">${_modVal(k, v.new)}</span></div>`
    ).join('');
    detail = `<div class="mod-title"> Modification demandée</div>${mod.reason ? `<div class="mod-reason">« ${mod.reason} »</div>` : ''}<div class="mod-diffs">${lines}</div>`;
  }
  const actions = isAdmin
    ? `<div class="mod-actions">
         <button class="mod-btn mod-btn-approve" onclick="approveCommandeModif('${mod.id}')">✓ Approuver</button>
         <button class="mod-btn mod-btn-reject" onclick="rejectCommandeModif('${mod.id}')">✕ Refuser</button>
       </div>`
    : `<div class="mod-pending-tag"> En attente de validation admin</div>`;
  return `<div class="cmd-mod-banner ${mod.type === 'cancel' ? 'cmd-mod-banner--cancel' : ''}">
    ${detail}
    <div class="mod-who">${who}</div>
    ${actions}
  </div>`;
}

let _modifCmdId = null;
let _modifMode = 'request'; // 'request' = commercial (validé par l'admin) · 'direct' = admin (appliqué tout de suite)

// Entrées : commercial → demande validée par l'admin ; admin → édition directe
function requestCommandeModif(id) { _openCmdEditForm(id, 'request'); }
function editCommandeAdmin(id) {
  if (currentUser?.role !== 'admin') { showToast('Réservé à l\'admin', 'error'); return; }
  _openCmdEditForm(id, 'direct');
}

// Ouvre le formulaire d'édition de commande (partagé demande / édition directe)
function _openCmdEditForm(id, mode) {
  const c = commandes.find(x => String(x.id) === String(id));
  if (!c) { showToast('Commande introuvable', 'error'); return; }
  _modifCmdId = id;
  _modifMode = (mode === 'direct') ? 'direct' : 'request';
  const fields = CMD_MODIF_FIELDS.map(f => {
    const raw = c[f.key] ?? '';
    const val = String(raw).replace(/"/g, '&quot;');
    if (f.type === 'textarea')
      return `<label class="modif-field"><span>${f.label}</span><textarea id="mf_${f.key}" rows="2">${String(raw)}</textarea></label>`;
    if (f.type === 'select') {
      const opts = [['','— Non défini']].concat(f.options || [])
        .map(([ov, ol]) => `<option value="${ov}" ${String(raw) === String(ov) ? 'selected' : ''}>${ol}</option>`).join('');
      return `<label class="modif-field"><span>${f.label}</span><select id="mf_${f.key}">${opts}</select></label>`;
    }
    const inputType = f.type === 'number' ? 'number' : (f.type === 'date' ? 'date' : 'text');
    return `<label class="modif-field"><span>${f.label}</span><input id="mf_${f.key}" type="${inputType}" value="${val}" ${f.type === 'number' ? 'min="0"' : ''}></label>`;
  }).join('');
  // Édition des articles (corriger la saisie : libellé / qté / prix unitaire)
  _modifItems = (c.items || []).map(i => ({ name: i.name || '', qty: Math.round(Number(i.qty) || 0), price: Math.round(Number(i.price) || 0) }));
  const itemsSection =
    `<div class="modif-field">
       <span>Articles — corriger qté / prix / libellé</span>
       <div id="mf_items"></div>
       <button type="button" class="mf-add-item" onclick="_modifAddItem()">+ Ajouter un article</button>
       <div class="mf-items-total">Sous-total calculé : <strong id="mf_items_sum">0</strong> Ar</div>
     </div>`;
  // La note pour l'admin n'a de sens que pour une demande (pas l'édition directe admin)
  const reasonField = _modifMode === 'direct' ? '' :
    `<label class="modif-field"><span>Note pour l'admin (optionnel)</span><textarea id="mf_reason" rows="2" placeholder="Pourquoi cette modification ?"></textarea></label>`;
  const body = document.getElementById('cmdModifBody');
  if (body) body.innerHTML = fields + itemsSection + reasonField;
  _renderModifItems();
  const isDirect = _modifMode === 'direct';
  const title = document.getElementById('cmdModifTitle');
  if (title) title.textContent = (isDirect ? 'Modifier la commande — ' : 'Demande de modification — ') + (c.clientName || 'commande');
  const notice = document.getElementById('cmdModifNotice');
  if (notice) notice.style.display = isDirect ? 'none' : '';
  const submitBtn = document.getElementById('cmdModifSubmitBtn');
  if (submitBtn) submitBtn.textContent = isDirect ? 'Enregistrer les modifications' : 'Envoyer la demande';
  openModal('cmdModifModal');
}

// ── Édition des lignes d'articles dans la demande de modification ──
let _modifItems = [];
function _renderModifItems() {
  const wrap = document.getElementById('mf_items');
  if (!wrap) return;
  wrap.innerHTML = _modifItems.length
    ? _modifItems.map((it, idx) => `
      <div class="mf-item-row">
        <input class="mf-item-name" type="text" value="${String(it.name).replace(/"/g,'&quot;')}" placeholder="Article" oninput="_modifItemChange(${idx},'name',this.value)">
        <input class="mf-item-qty" type="number" min="0" value="${it.qty}" title="Quantité" oninput="_modifItemChange(${idx},'qty',this.value)">
        <input class="mf-item-price" type="number" min="0" value="${it.price}" title="Prix unitaire (Ar)" oninput="_modifItemChange(${idx},'price',this.value)">
        <button type="button" class="mf-item-del" onclick="_modifRemoveItem(${idx})" title="Supprimer l'article">×</button>
      </div>`).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:4px 0">Aucun article</div>';
  _modifUpdateItemsSum();
}
function _modifUpdateItemsSum() {
  const sum = _modifItems.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const el = document.getElementById('mf_items_sum');
  if (el) el.textContent = fmt(sum);
}
function _modifItemChange(idx, key, val) {
  if (!_modifItems[idx]) return;
  _modifItems[idx][key] = key === 'name' ? val : Math.max(0, Math.round(parseFloat(val) || 0));
  _modifUpdateItemsSum(); // pas de re-render → garde le focus dans le champ
}
function _modifAddItem() { _modifItems.push({ name: '', qty: 1, price: 0 }); _renderModifItems(); }
function _modifRemoveItem(idx) { _modifItems.splice(idx, 1); _renderModifItems(); }

// Envoie la demande : ne garde que les champs réellement modifiés (diff)
function submitCommandeModif() {
  const c = commandes.find(x => String(x.id) === String(_modifCmdId));
  if (!c) { closeModal('cmdModifModal'); return; }
  const changes = {};
  CMD_MODIF_FIELDS.forEach(f => {
    const el = document.getElementById('mf_' + f.key);
    if (!el) return;
    let nv, ov;
    if (f.type === 'number') {
      nv = Math.max(0, parseFloat(el.value) || 0);
      ov = Number(c[f.key]) || 0;
    } else {
      nv = String(el.value).trim();
      ov = String(c[f.key] ?? '');
    }
    if (String(nv) !== String(ov)) changes[f.key] = { old: ov, new: nv, label: f.label };
  });
  // Diff des articles (libellé / qté / prix)
  const _normItems = arr => (arr || []).map(i => ({ name: String(i.name).trim(), qty: Math.round(Number(i.qty) || 0), price: Math.round(Number(i.price) || 0) })).filter(i => i.name);
  const newItems = _normItems(_modifItems);
  const oldItems = _normItems(c.items);
  if (JSON.stringify(newItems) !== JSON.stringify(oldItems)) {
    changes.items = { old: oldItems, new: newItems, label: 'Articles' };
  }
  if (!Object.keys(changes).length) { showToast('Aucune modification détectée', 'info'); return; }

  // ── Mode admin : appliqué immédiatement, sans validation ──
  if (_modifMode === 'direct') {
    _applyCommandeChanges(c, changes);
    closeModal('cmdModifModal');
    renderCommandes();
    if (typeof updateCmdBadge === 'function') updateCmdBadge();
    _addNotification({
      dossierId: c.dossierId || '', numeroDossier: `CMD-${String(c.id).padStart(3,'0')}`,
      etapeCode: 'MODIF', etapeLabel: 'Commande modifiée',
      operateur: currentUser?.label || 'Admin',
      message: `${currentUser?.label || 'Admin'} a modifié la commande de ${c.clientName}`
    });
    showToast('Commande modifiée');
    return;
  }

  // ── Mode commercial : demande envoyée à l'admin pour validation ──
  const reason = (document.getElementById('mf_reason')?.value || '').trim();
  const mod = {
    id: 'M_' + Date.now(),
    commandeId: String(c.id),
    timestamp: new Date().toISOString(),
    auteur: currentUser?.username || '',
    auteurLabel: currentUser?.label || currentUser?.username || 'Commercial',
    type: 'edit',
    changes,
    reason,
    statut: 'pending'
  };
  commandeMods = commandeMods.filter(m => !(String(m.commandeId) === String(c.id) && m.statut === 'pending'));
  commandeMods.unshift(mod);
  closeModal('cmdModifModal');
  renderCommandes();
  if (APPS_SCRIPT_URL) {
    apiCall({ action: 'saveModif', id: mod.id, commandeId: mod.commandeId, timestamp: mod.timestamp, auteur: mod.auteur, auteurLabel: mod.auteurLabel, type: mod.type, changes: mod.changes, reason: mod.reason })
      .catch(() => {});
  }
  _addNotification({
    dossierId: c.dossierId || '', numeroDossier: `CMD-${String(c.id).padStart(3,'0')}`,
    etapeCode: 'MODIF', etapeLabel: 'Demande de modification',
    operateur: mod.auteurLabel,
    message: `${mod.auteurLabel} demande une modification sur la commande de ${c.clientName} — validation requise`
  });
  showToast('Demande envoyée à l\'admin');
}

// Demande d'annulation (commercial)
function requestCommandeCancel(id) {
  const c = commandes.find(x => String(x.id) === String(id));
  if (!c || c.status !== 'pending') return;
  const reason = prompt(`Demander l'annulation de la commande de ${c.clientName} ?\nMotif (visible par l'admin) :`, '');
  if (reason === null) return;
  const mod = {
    id: 'M_' + Date.now(), commandeId: String(c.id), timestamp: new Date().toISOString(),
    auteur: currentUser?.username || '', auteurLabel: currentUser?.label || currentUser?.username || 'Commercial',
    type: 'cancel', changes: {}, reason: reason.trim(), statut: 'pending'
  };
  commandeMods = commandeMods.filter(m => !(String(m.commandeId) === String(c.id) && m.statut === 'pending'));
  commandeMods.unshift(mod);
  renderCommandes();
  if (APPS_SCRIPT_URL) {
    apiCall({ action: 'saveModif', id: mod.id, commandeId: mod.commandeId, timestamp: mod.timestamp, auteur: mod.auteur, auteurLabel: mod.auteurLabel, type: mod.type, changes: {}, reason: mod.reason })
      .catch(() => {});
  }
  _addNotification({
    dossierId: c.dossierId || '', numeroDossier: `CMD-${String(c.id).padStart(3,'0')}`,
    etapeCode: 'MODIF', etapeLabel: 'Demande d\'annulation',
    operateur: mod.auteurLabel,
    message: `${mod.auteurLabel} demande l'annulation de la commande de ${c.clientName} — validation requise`
  });
  showToast('Demande d\'annulation envoyée');
}

// ── Application d'un jeu de changements à une commande ──────────────────────
// Point d'entrée unique du process de modification : applique les champs, recalcule
// les montants dérivés, déduit le mode de remise, répercute sur le dossier de
// production lié et synchronise Google Sheets. Utilisé aussi bien par l'édition
// directe (admin) que par la validation d'une demande (commercial) → comportement
// strictement identique dans les deux cas.
function _applyCommandeChanges(c, changes) {
  changes = changes || {};
  Object.entries(changes).forEach(([k, v]) => { c[k] = v.new; });
  if ('dateLivraison' in changes || 'dateLivraisonProd' in changes) c._dateEditedAt = Date.now();
  // Recalcul des montants dérivés à partir des articles (ajout/retrait/qté/prix)
  const itemsSum = (c.items || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  c.subtotal = itemsSum > 0 ? itemsSum : (Number(c.subtotal) || 0);
  c.total    = Math.max(0, c.subtotal - (Number(c.remise) || 0) + (Number(c.fraisLivraison) || 0));
  c.restant  = Math.max(0, c.total - (Number(c.accompte) || 0));
  // Mode de remise : explicite s'il a été modifié, sinon déduit de l'adresse
  if (!('deliveryMode' in changes) && 'adresseLivraison' in changes)
    c.deliveryMode = c.adresseLivraison ? 'livraison' : 'retrait';
  // Répercuter dates / articles / client sur le dossier de production lié
  const dos = dossiers.find(d => d.sourceType === 'commande' && String(d.sourceId) === String(c.id));
  if (dos) {
    if ('dateLivraison' in changes)     dos.dateLivraison = c.dateLivraison;
    if ('dateLivraisonProd' in changes) dos.dateLivraisonProd = c.dateLivraisonProd;
    if ('clientName' in changes)        dos.client = c.clientName;
    if ('items' in changes) {
      dos.produit  = (c.items || []).map(i => i.name).join(', ') || 'Articles';
      dos.quantite = (c.items || []).reduce((s, i) => s + (Number(i.qty) || 1), 0);
    }
    if (APPS_SCRIPT_URL && ('items' in changes || 'clientName' in changes || 'dateLivraison' in changes || 'dateLivraisonProd' in changes)) {
      apiCall({ action: 'updateDossier', id: dos.id, client: dos.client, produit: dos.produit, quantite: dos.quantite, dateLivraison: dos.dateLivraison }).catch(() => {});
    }
  }
  saveData();
  if (APPS_SCRIPT_URL) {
    apiCall({ action: 'updateCommande', id: c.id,
      clientName: c.clientName, clientContact: c.clientContact,
      adresseLivraison: c.adresseLivraison, deliveryMode: c.deliveryMode,
      fraisLivraison: c.fraisLivraison, dateLivraison: c.dateLivraison, dateLivraisonProd: c.dateLivraisonProd, dateBAT: c.dateBAT,
      remise: c.remise, accompte: c.accompte, notes: c.notes,
      depositMethod: c.depositMethod, depositProvider: c.depositProvider, depositRef: c.depositRef,
      items: ('items' in changes) ? c.items : undefined,
      subtotal: c.subtotal, total: c.total, restant: c.restant
    }).catch(() => {});
  }
}

// ── Validation admin ───────────────────────────────────────
function approveCommandeModif(modId) {
  if (currentUser?.role !== 'admin') { showToast('Réservé à l\'admin', 'error'); return; }
  const mod = commandeMods.find(m => m.id === modId);
  if (!mod || mod.statut !== 'pending') return;
  const c = commandes.find(x => String(x.id) === String(mod.commandeId));
  if (!c) { showToast('Commande introuvable', 'error'); return; }

  if (mod.type === 'cancel') {
    _applyCommandeCancel(c);
  } else {
    _applyCommandeChanges(c, mod.changes);
  }
  mod.statut = 'approved';
  mod.resoluPar = currentUser?.label || 'Admin';
  mod.resoluLe = new Date().toISOString();
  if (typeof closeDrawers === 'function') closeDrawers(); // ferme le drawer cockpit si ouvert (évite un affichage périmé)
  renderCommandes();
  if (APPS_SCRIPT_URL) apiCall({ action: 'resolveModif', id: mod.id, statut: 'approved', resoluPar: mod.resoluPar }).catch(() => {});
  _addNotification({
    dossierId: c.dossierId || '', numeroDossier: `CMD-${String(c.id).padStart(3,'0')}`,
    etapeCode: 'MODIF', etapeLabel: 'Modification validée',
    operateur: mod.resoluPar,
    message: `Demande de ${mod.auteurLabel} approuvée sur la commande de ${c.clientName}`
  });
  showToast('Modification appliquée');
}

function rejectCommandeModif(modId) {
  if (currentUser?.role !== 'admin') { showToast('Réservé à l\'admin', 'error'); return; }
  const mod = commandeMods.find(m => m.id === modId);
  if (!mod || mod.statut !== 'pending') return;
  const c = commandes.find(x => String(x.id) === String(mod.commandeId));
  const motif = prompt('Motif du refus (optionnel, visible par le commercial) :', '');
  if (motif === null) return;
  mod.statut = 'rejected';
  mod.resoluPar = currentUser?.label || 'Admin';
  mod.resoluLe = new Date().toISOString();
  mod.motif = motif.trim();
  if (typeof closeDrawers === 'function') closeDrawers(); // ferme le drawer cockpit si ouvert
  renderCommandes();
  if (APPS_SCRIPT_URL) apiCall({ action: 'resolveModif', id: mod.id, statut: 'rejected', resoluPar: mod.resoluPar, motif: mod.motif }).catch(() => {});
  _addNotification({
    dossierId: c?.dossierId || '', numeroDossier: c ? `CMD-${String(c.id).padStart(3,'0')}` : '',
    etapeCode: 'MODIF', etapeLabel: 'Modification refusée',
    operateur: mod.resoluPar,
    message: `Demande de ${mod.auteurLabel} refusée${mod.motif ? ' — ' + mod.motif : ''}`
  });
  showToast('Demande refusée', 'info');
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
    dateLivraison:    cmd.dateLivraison,
    dateLivraisonProd: cmd.dateLivraisonProd,
    dateBAT:          cmd.dateBAT,
    subtotal:        cmd.subtotal,
    remise:          cmd.remise,
    total:           cmd.total,
    accompte:        cmd.accompte,
    restant:         cmd.restant,
    depositMethod:   cmd.depositMethod,
    depositProvider: cmd.depositProvider,
    depositRef:      cmd.depositRef,
    notes:           cmd.notes,
    // Pièces jointes déjà sur Drive (metadata seulement, jamais le base64)
    attachments:     (cmd.attachments || []).filter(a => a && a.fileId),
  };
  const r = await apiCall({ action: 'addCommande', commande: payload });
  if (!r || !r.ok) {
    console.warn('Sync commande échouée:', r?.error || 'Connexion impossible');
    showToast('Commande enregistrée localement — sync GAS échouée', 'warning');
  }
  // Uploader les photos sur Drive (en arrière-plan) → pièces jointes partagées,
  // visibles par TOUS les opérateurs sur tous les postes (pas seulement en local).
  if (cmd.photos && cmd.photos.length) _uploadCommandeAttachments(cmd.id, [...cmd.photos]);
}

// Upload des photos d'une commande sur Drive → pièces jointes partagées (atelier).
// Réutilise l'action générique 'uploadFile' (comme réservations/commentaires).
async function _uploadCommandeAttachments(commandeId, photos) {
  if (!APPS_SCRIPT_URL || !Array.isArray(photos) || !photos.length) return;
  const uploaded = [];
  for (let i = 0; i < photos.length; i++) {
    const item     = photos[i];
    const isObj    = item && typeof item === 'object';
    const dataUrl  = isObj ? (item.data || '') : (typeof item === 'string' ? item : '');
    if (!dataUrl) continue;
    const type     = (isObj && item.type) ? item.type : 'image/jpeg';
    const origName = (isObj && item.name) ? item.name : '';
    const ext      = origName.includes('.') ? origName.split('.').pop() : ((type.split('/')[1]) || 'jpg');
    const name     = `commande-${commandeId}-${i + 1}.${ext}`;
    try {
      const r = await apiCall({ action:'uploadFile', fileName:name, mimeType:type, base64Data:dataUrl });
      uploaded.push(r && r.ok
        ? { name:r.fileName||name, type, fileId:r.fileId, viewUrl:r.viewUrl, dlUrl:r.dlUrl }
        : { name, type, data:dataUrl }); // fallback base64 local si l'upload échoue
    } catch(e) {
      uploaded.push({ name, type, data:dataUrl });
    }
  }
  if (!uploaded.length) return;
  const cmd = commandes.find(c => String(c.id) === String(commandeId));
  if (!cmd) return;
  cmd.attachments = [...(cmd.attachments || []), ...uploaded];
  // Tout est sur Drive → libérer les copies base64 locales (source de vérité = Drive)
  if (uploaded.every(a => a.fileId)) {
    cmd.photos = [];
    try { localStorage.removeItem(`pos-cmd-photos-${cmd.id}`); } catch(e) {}
  }
  saveData();
  // Rafraîchir les vues éventuellement ouvertes
  try { renderCommandes(); } catch(e) {}
  if (selectedDossier && String(selectedDossier.sourceId) === String(cmd.id)) {
    try { selectDossier(selectedDossier.id); } catch(e) {}
  }
  // Persister les metadata Drive dans le Sheet → visibles par tous les postes
  const driveAtts = cmd.attachments.filter(a => a && a.fileId);
  if (driveAtts.length) apiCall({ action:'updateCommande', id:cmd.id, attachments:driveAtts }).catch(()=>{});
  const okCount = uploaded.filter(a => a.fileId).length;
  if (okCount) showToast(`${okCount} pièce(s) jointe(s) partagée(s) avec l'atelier`);
}

async function syncCmdUpdateToSheets(cmd) {
  if (!APPS_SCRIPT_URL) return;
  await apiCall({ action: 'updateCommande', id: cmd.id, status: cmd.status, dateFinalisation: cmd.dateFinalisation || '', saleId: cmd.saleId || '', accompte: cmd.accompte, restant: cmd.restant });
}

// ============================================================
// DEMANDES DE MODIFICATION DE COMMANDE (commerciaux → validation admin)
// ============================================================
let commandeMods = []; // demandes récentes (pending / approved / rejected / superseded)

// Champs qu'un commercial peut demander à modifier (avec validation admin)
const _DEPOSIT_METHOD_OPTS = [['cash','Espèces'],['mobile','Mobile Money'],['cheque','Chèque']];
function _depositLabel(v){ const o = _DEPOSIT_METHOD_OPTS.find(x => x[0] === v); return o ? o[1] : (v ? String(v) : '—'); }
const _DELIVERY_MODE_OPTS = [['retrait','Retrait boutique'],['livraison','Livraison']];
const CMD_MODIF_FIELDS = [
  { key:'clientName',       label:'Nom client',            type:'text' },
  { key:'clientContact',    label:'Contact',               type:'text' },
  { key:'accompte',         label:'Acompte (Ar)',          type:'number' },
  { key:'depositMethod',    label:'Mode de paiement acompte', type:'select', options:_DEPOSIT_METHOD_OPTS },
  { key:'depositProvider',  label:'Opérateur Mobile Money', type:'text' },
  { key:'depositRef',       label:'Référence Mobile Money', type:'text' },
  { key:'remise',           label:'Remise (Ar)',           type:'number' },
  { key:'deliveryMode',     label:'Mode de remise',        type:'select', options:_DELIVERY_MODE_OPTS },
  { key:'adresseLivraison', label:'Adresse de livraison',  type:'text' },
  { key:'fraisLivraison',   label:'Frais de livraison (Ar)',type:'number' },
  { key:'dateLivraison',    label:'Date livraison client', type:'date' },
  { key:'dateLivraisonProd',label:'Date production',       type:'date' },
  { key:'dateBAT',          label:'Date BAT',              type:'date' },
  { key:'notes',            label:'Notes',                 type:'textarea' },
];
const CMD_MODIF_NUMKEYS = ['accompte','remise','fraisLivraison'];

// Demande en attente pour une commande (la plus récente)
function _pendingModFor(commandeId) {
  return commandeMods.find(m => String(m.commandeId) === String(commandeId) && m.statut === 'pending');
}

async function loadModifsFromScript() {
  if (!APPS_SCRIPT_URL) return;
  const r = await apiCall({ action: 'getModifs' });
  if (r && r.ok && Array.isArray(r.modifs)) commandeMods = r.modifs;
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
      // Édition de date très récente non encore propagée (GAS peut renvoyer l'ancienne
      // valeur le temps que l'écriture + l'edge-cache se règlent) → garder le local 20 s.
      const freshEdit = local && local._dateEditedAt && (Date.now() - local._dateEditedAt < 20000);
      return {
        ...c,
        photos:      (local?.photos?.length      ? local.photos      : c.photos)      || [],
        // Pièces jointes : GAS (Drive) fait autorité, fallback local si non encore synchro
        attachments: (c.attachments?.length ? c.attachments : (local?.attachments || [])) || [],
        dossierId: local?.dossierId || c.dossierId || '',
        ...(freshEdit ? {
          dateLivraison:     local.dateLivraison,
          dateLivraisonProd: local.dateLivraisonProd,
          dateBAT:           local.dateBAT,
          _dateEditedAt:     local._dateEditedAt
        } : {}),
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
let taches = [];
// tachesLibres est déclaré avant le bloc INIT (ligne ~4116) pour éviter la TDZ
let selectedDossier = null;
let pendingAttrib = null;
let _dossierView = 'list'; // 'list' | 'card'
let pendingPointage = null;
let prodFilter = 'TOUS';
let opFilterVal = 'TOUS';
let _prodView   = 'tasks'; // 'tasks' | 'charge'
let _prodExpanded = new Set(); // dossierId des groupes dépliés (repliés par défaut = vue compacte)
let _opWorkloadOpen = false; // section "Charge opérateurs" repliée par défaut (vue compacte)
let attrDateFilter = { mois: '', annee: '' };
let prodDateFilter = { mois: '', annee: '' };

// ── Cockpit Production (vue responsable : tableau compact de dossiers) ──────
// État de la vue cockpit. filter = bucket d'échéance/statut ; sort = colonne + sens.
let _cockpitFilter  = 'TOUS';   // TOUS | RETARD | AUJ | DEMAIN | SEMAINE | TERMINE
let _cockpitOp      = 'TOUS';   // filtre responsable
let _cockpitShift   = 'TOUS';   // filtre équipe : TOUS | Jour | Nuit
let _cockpitEtape   = 'TOUS';   // filtre étape actuelle (code)
let _cockpitSearch  = '';       // recherche client / produit / réf
let _cockpitSort    = { key:'echeance', dir:'asc' }; // echeance|retard|operateur|statut|progression|priorite
let _cockpitDensity = 'compact'; // compact | detaille
let _cockpitOpsOpen = false;    // heatmap opérateurs repliée par défaut
let _cockpitLimit   = 60;       // pagination : nb de lignes affichées (pas à pas)
const _COCKPIT_PAGE = 60;

// Pipeline de production — l'ORDRE de ce tableau pilote tout l'affichage du flux.
// Les `code` sont des clés persistées dans les tâches (t.etapeCode) et la feuille
// Taches : ne JAMAIS renommer un code existant (orphelinerait les tâches). On peut
// réordonner et ajouter librement (etapeCode = texte libre côté backend).
const ETAPES_CONFIG = [
  { code:'VALID_CMD',     label:'Validation commande (commerciale)', short:'Valid. cmd', color:'#0d9488', icon:'1'  },
  { code:'PAO',           label:'Conception / Simulation (PAO)',     short:'PAO',        color:'#6c63ff', icon:'2'  },
  { code:'RETOUR_CLIENT', label:'Validation client (commerciale)',   short:'Valid. 1',   color:'#0891b2', icon:'3'  },
  { code:'MODIFICATIONS', label:'Modifications (PAO)',               short:'Modifs',     color:'#7c3aed', icon:'4'  },
  { code:'VALID_CLIENT2', label:'Validation client (commerciale)',   short:'Valid. 2',   color:'#0e7490', icon:'5'  },
  { code:'BAT',           label:'BAT physique (PAO+prod+finition)',  short:'BAT',        color:'#2563eb', icon:'6'  },
  { code:'ACHAT',         label:'Achat (si besoin acheteur)',        short:'Achat',      color:'#d97706', icon:'7'  },
  { code:'PRODUCTION',    label:'Production (machine / impression / laser)', short:'Machine', color:'#e8834a', icon:'8' },
  { code:'FINITION',      label:'Finition',                          short:'Finition',   color:'#1a4a3a', icon:'9'  },
  { code:'LIVRE',         label:'Livraison',                         short:'Livré',      color:'#16a34a', icon:'10' },
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
  // Dérivé d'ETAPES_CONFIG (source de vérité unique) → reste aligné sur le pipeline.
  const steps = ETAPES_CONFIG.map(e => ({ code:e.code, label:e.label, color:e.color }));
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
  const dossierId = _stableDossierId(type, source);
  const oldId     = `D_${type.toUpperCase()}_${source.id}`; // ancien format (rétrocompat)
  const wantKey   = type + ':' + String(source.id);
  // Réutiliser TOUT dossier existant représentant la même source (id canonique, ancien
  // format, OU id basé sur la date hérité via _dossierSourceKey) → empêche les doublons.
  const existing  = dossiers.find(d =>
    d.id === dossierId || d.id === oldId || _dossierSourceKey(d) === wantKey);
  if (existing) {
    // Restaurer sourceType/sourceId absents sur les dossiers chargés depuis GAS
    if (!existing.sourceType) existing.sourceType = type;
    if (existing.sourceId === undefined || existing.sourceId === null) existing.sourceId = source.id;
    return existing;
  }
  const prefix   = type === 'commande' ? 'CMD' : 'RES';
  const produit  = (source.items||[]).map(i => i.name).join(', ') || 'Articles';
  const quantite = (source.items||[]).reduce((s,i) => s + (i.qty||1), 0);
  const dossier  = {
    id: dossierId,
    // Référence LISIBLE dérivée de la date (= n° de facture du ticket), pas de l'uid interne.
    numeroDossier: `${prefix}-${_factureNum(source)}`,
    client:      source.clientName,
    produit,
    quantite,
    statut:      'CREE',
    progression: 0,
    dateCreation: new Date().toLocaleDateString('fr-FR'),
    priorite:    'Normale',
    sourceVente: `${type === 'commande' ? 'Commande' : 'Réservation'} #${source.id}`,
    sourceType:  type,
    sourceId:    source.id,
    dateLivraison:     source.dateLivraison || source.deliveryDate || '',
    dateLivraisonProd: source.dateLivraisonProd || '',
    dateBAT:           source.dateBAT || ''
  };
  dossiers.push(dossier);
  // Persister dans Sheets pour visibilité multi-postes
  if (APPS_SCRIPT_URL) {
    apiCall({
      action:    'saveDossier',
      dossier:   dossier,
      createdBy: (window.currentUser && currentUser.label) || 'frontend'
    }).catch(function() {
      console.warn('[Dossier] Sync GAS échouée pour', dossier.id);
    });
  }
  return dossier;
}

// Recopie les dates de livraison (client + production) depuis la commande/réservation
// source vers son dossier. Idempotent — appelé au rendu (Production/Attribution) pour que
// la date de production soit visible par tous, même après rechargement depuis GAS (elle
// n'est pas stockée côté feuille Dossiers : la source de vérité est la commande).
function _syncDossierDates() {
  if (!Array.isArray(dossiers)) return;
  const _seq = _buildSeqMaps();
  dossiers.forEach(d => {
    if (!d || !d.sourceType || d.sourceId === undefined || d.sourceId === null) return;
    const src = d.sourceType === 'reservation'
      ? (typeof reservations !== 'undefined' ? reservations : []).find(r => String(r.id) === String(d.sourceId))
      : (typeof commandes    !== 'undefined' ? commandes    : []).find(c => String(c.id) === String(d.sourceId));
    if (!src) return;
    const cli  = src.dateLivraison || src.deliveryDate || '';
    const prod = src.dateLivraisonProd || '';
    const bat  = src.dateBAT || '';
    if (cli)  d.dateLivraison     = cli;
    if (prod) d.dateLivraisonProd = prod;
    if (bat)  d.dateBAT           = bat;
    if (src.caissier) d.caissier  = src.caissier; // commercial créateur (pour l'affichage)
    // Référence SÉQUENTIELLE (CMD-001 / RES-001) au lieu de l'uid interne — cohérente
    // partout et « qui se suit ». Normalise aussi les anciens dossiers. Affichage seul.
    const ref = _seqRefOf(d.sourceType, d.sourceId, _seq);
    if (!ref || ref.endsWith('—')) return;           // source absente des maps → ne pas écraser
    if (d.numeroDossier !== ref) d.numeroDossier = ref;
    // Propager la référence canonique aux tâches liées. Leur `numeroDossier` est un
    // instantané figé à l'assignation : il divergeait de l'Attribution (qui lit le
    // dossier live) dès que la numérotation séquentielle se décalait — p.ex. une commande
    // synchronisée depuis un autre poste avec une date antérieure repousse tous les rangs
    // suivants. Résultat : Attribution, Production et fiche imprimée affichaient 3 réf.
    // différentes pour un même dossier. Ici on réaligne (mémoire seule, pas de resync GAS).
    if (Array.isArray(taches)) {
      taches.forEach(t => { if (t.dossierId === d.id && t.numeroDossier !== ref) t.numeroDossier = ref; });
    }
  });
}

// Génère un dossierId stable basé UNIQUEMENT sur l'id de la source.
// ⚠️ Ne PLUS inclure la date : `source.date` perd ses millisecondes après un aller-retour
// GAS (le Sheet stocke à la seconde) → `getTime()` changeait → 2 ids pour la même commande
// → DOUBLONS de dossiers. Les ids source sont désormais uniques (`_genUid`), donc l'id seul
// suffit. Voir _dossierSourceKey / _dedupDossiers pour la réconciliation des anciens doublons.
function _stableDossierId(type, source) {
  const prefix = type === 'commande' ? 'CMD' : 'RES';
  return `D_${prefix}_${source.id}`;
}

// Clé d'identité de la SOURCE d'un dossier (commande/réservation) — quelle que soit la
// provenance/format de son id. Permet de détecter qu'un dossier représente la même
// commande qu'un autre (id canonique, ancien format, ou id basé sur la date hérité).
function _dossierSourceKey(d) {
  if (!d) return null;
  if (d.sourceType && d.sourceId !== undefined && d.sourceId !== null && d.sourceId !== '')
    return d.sourceType + ':' + String(d.sourceId);
  const sv = String(d.sourceVente || '');
  let m = sv.match(/Commande\s*#?\s*(\S+)/i);   if (m) return 'commande:' + m[1];
  m = sv.match(/R[ée]servation\s*#?\s*(\S+)/i); if (m) return 'reservation:' + m[1];
  return null;
}

// Fusionne les dossiers en double (même source) déjà présents en mémoire (typiquement
// hérités de GAS avec des ids basés sur la date). Conserve le plus avancé et re-pointe
// ses tâches vers le dossier conservé pour ne RIEN perdre.
function _dedupDossiers() {
  if (!Array.isArray(dossiers) || dossiers.length < 2) return;
  const byKey = new Map();
  const remap = {};
  const out = [];
  for (const d of dossiers) {
    if (!d) continue;
    const key = _dossierSourceKey(d) || ('id:' + String(d.id));
    const kept = byKey.get(key);
    if (!kept) { byKey.set(key, d); out.push(d); continue; }
    // doublon de la même source → garder le plus avancé, re-mapper l'autre
    if ((Number(d.progression) || 0) > (Number(kept.progression) || 0)) {
      kept.progression = d.progression; kept.statut = d.statut;
    }
    if (String(d.id) !== String(kept.id)) remap[d.id] = kept.id;
  }
  if (Object.keys(remap).length) {
    if (Array.isArray(taches)) taches.forEach(t => { if (t && remap[t.dossierId]) t.dossierId = remap[t.dossierId]; });
    dossiers = out;
  }
}

function _ensureDossierLinks() {
  let needsSave = false;
  commandes.forEach(c => {
    if (c.status === 'pending') {
      // Pointer la commande vers l'id RÉEL du dossier (réutilisé si déjà présent) — évite
      // de référencer un id recalculé alors qu'un dossier d'un autre format existe déjà.
      const dos = _createDossierFromSource('commande', c);
      if (dos && c.dossierId !== dos.id) { c.dossierId = dos.id; needsSave = true; }
    } else {
      const stable = _stableDossierId('commande', c);
      if (c.dossierId !== stable) { c.dossierId = stable; needsSave = true; }
    }
  });
  reservations.forEach(r => {
    if (r.status === 'pending') {
      const dos = _createDossierFromSource('reservation', r);
      if (dos && r.dossierId !== dos.id) { r.dossierId = dos.id; needsSave = true; }
    } else {
      const stable = _stableDossierId('reservation', r);
      if (r.dossierId !== stable) { r.dossierId = stable; needsSave = true; }
    }
  });
  _dedupDossiers(); // fusionne les doublons hérités (mêmes source) + re-pointe les tâches
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

// Un dossier clôturé (LIVRE) ou à 100 % est considéré terminé : tout le pipeline
// s'affiche alors comme complet, même sans aucune tâche attribuée (clôture admin).
function _dossierClosed(d) {
  return !!d && (d.statut === 'LIVRE' || Number(d.progression) === 100);
}

// Progression réelle d'un dossier = étapes terminées ÷ étapes APPLICABLES (celles ayant
// au moins une tâche assignée). Aligne le frontend sur le serveur (_computeDossierProgress_).
// Corrige le double défaut de l'ancien calcul `done / 10` : sous-évaluation (un dossier
// simple entièrement fini plafonnait à 30-40 %) ET, côté serveur, sur-évaluation (une
// étape tardive terminée gonflait le % pour des étapes jamais travaillées).
function _dossierPct(dt, d) {
  if (_dossierClosed(d)) return 100;
  let done = 0, applicable = 0;
  for (const e of ETAPES_CONFIG) {
    const te = dt.filter(t => t.etapeCode === e.code);
    if (!te.length) continue;
    applicable++;
    if (te.every(t => t.statut === 'TERMINE')) done++;
  }
  return applicable ? Math.round(done / applicable * 100) : (Number(d && d.progression) || 0);
}

// Clôture administrative : passe le dossier à LIVRE / 100 % même sans attribution.
// Réservé admin / chef d'atelier. Marque aussi ses éventuelles tâches en cours comme
// terminées pour que le pipeline (calculé sur les tâches) reste cohérent partout.
async function cloturerDossier(dossierId) {
  if (!dossierId) return;
  if (!['admin','chef_atelier'].includes(currentUser?.role)) {
    showToast('Action réservée à l’administrateur.', 'error');
    return;
  }
  const d = (Array.isArray(dossiers) ? dossiers : []).find(x => x.id === dossierId) || selectedDossier;
  if (!d) { showToast('Dossier introuvable', 'error'); return; }
  if (_dossierClosed(d)) { showToast('Dossier déjà clôturé', 'info'); return; }
  const nbTaches = taches.filter(t => t.dossierId === dossierId).length;
  const warn = nbTaches === 0
    ? 'Aucune tâche n’a été attribuée à ce dossier.\n\nLe clôturer quand même (LIVRÉ, 100 %) ?'
    : 'Clôturer ce dossier ? Il passera à LIVRÉ (100 %) et ses tâches en cours seront marquées terminées.';
  if (!confirm(warn)) return;

  // Persistance serveur (best-effort) — la source de vérité reste la feuille Dossiers.
  if (APPS_SCRIPT_URL) {
    const r = await apiCall({ action:'cloturerDossier', id:dossierId, par:currentUser?.label || 'admin' });
    if (r && r.ok === false) { showToast('Clôture refusée : ' + (r.error||''), 'error'); return; }
  }

  // Mise à jour optimiste locale : dossier + toutes ses tâches → TERMINE.
  d.statut = 'LIVRE';
  d.progression = 100;
  let changed = false;
  taches.forEach(t => {
    if (t.dossierId === dossierId && t.statut !== 'TERMINE') {
      t.statut = 'TERMINE';
      if (!t.dateFin) { t.dateFin = new Date().toLocaleString('fr-FR'); t.endTs = Date.now(); }
      changed = true;
    }
  });
  if (changed) saveTaches();
  if (selectedDossier && selectedDossier.id === dossierId) selectedDossier = d;

  _addNotification({
    dossierId,
    numeroDossier: d.numeroDossier || dossierId,
    etapeCode:     'LIVRE',
    etapeLabel:    'Clôture',
    operateur:     currentUser?.label || 'admin',
    message:       `Dossier ${d.numeroDossier || dossierId} clôturé par ${currentUser?.label || 'admin'} (100 %)`,
  });

  showToast('Dossier clôturé (100 %)');
  closeAllKebabs();
  // Rafraîchir la vue active (Attribution ou Production)
  if (selectedDossier && selectedDossier.id === dossierId) {
    renderAttrPanel(taches.filter(t => t.dossierId === dossierId), dossierComments.filter(c => c.dossierId === dossierId));
  }
  if (typeof renderDossiers === 'function' && document.getElementById('dossierListContainer')) renderDossiers();
  if (typeof renderTaches === 'function' && document.getElementById('tachesContainer')) renderTaches();
  if (typeof closeDrawers === 'function') closeDrawers();
}

function _purgeOrphanTaches() {
  // Base : les ids des dossiers RÉELLEMENT présents (couvre tous les formats hérités,
  // y compris les ids basés sur la date) → ne JAMAIS purger une tâche d'un dossier existant.
  const validIds = new Set(Array.isArray(dossiers) ? dossiers.map(d => d.id) : []);
  validIds.add('LIBRE');
  // + recomputés depuis les sources (résilience si les dossiers GAS n'ont pas chargé)
  reservations.filter(r => r.status === 'pending').forEach(r => {
    validIds.add(`D_RESERVATION_${r.id}`);
    validIds.add(_stableDossierId('reservation', r));
  });
  commandes.filter(c => c.status === 'pending').forEach(c => {
    validIds.add(`D_COMMANDE_${c.id}`);
    validIds.add(_stableDossierId('commande', c));
  });
  const before = taches.length;
  taches = taches.filter(t => t.dossierId === 'LIBRE' || validIds.has(t.dossierId));
  if (taches.length < before) {
    saveTaches();
    console.log(`[Taches] ${before - taches.length} tache(s) orpheline(s) purgée(s)`);
  }
}

async function openAttribForDossier(dossierId) {
  // 1. Reconstruire les dossiers depuis les sources locales (réservations/commandes)
  _ensureDossierLinks();
  let d = dossiers.find(x => x.id === dossierId);

  // 2. Pas trouvé localement → charger depuis GAS (la page Production ne charge pas les dossiers)
  if (!d && APPS_SCRIPT_URL) {
    try {
      const r = await apiCall({ action:'getDossiers', statut:'TOUS' });
      if (r && r.ok && Array.isArray(r.dossiers)) {
        // Fusionner sans écraser les dossiers locaux reconstruits
        const ids = new Set(dossiers.map(x => x.id));
        r.dossiers.forEach(x => { if (!ids.has(x.id)) dossiers.push(x); });
      }
    } catch(e) {}
    _ensureDossierLinks();
    d = dossiers.find(x => x.id === dossierId);
  }

  // 3. Toujours pas trouvé → reconstruire un dossier minimal depuis la tâche
  if (!d) {
    const t = taches.find(x => x.dossierId === dossierId);
    if (t) {
      d = {
        id: dossierId,
        numeroDossier: t.numeroDossier || dossierId,
        client:      t.client || '—',
        produit:     t.produit || t.titre || 'Articles',
        quantite:    t.quantite || '',
        statut:      'CREE',
        progression: 0,
        dateCreation: t.dateAssignation || new Date().toLocaleDateString('fr-FR'),
        priorite:    t.priorite || 'Normale',
        sourceVente: '',
        reconstructed: true
      };
      dossiers.push(d);
    }
  }

  if (!d) { showToast('Dossier introuvable', 'error'); return; }

  // 4. Si l'utilisateur n'a pas accès à l'Attribution → vue lecture seule
  const canAttrib = PAGE_ACCESS.attribution.includes(currentUser?.role);
  if (!canAttrib) {
    showDossierReadOnly(d);
    return;
  }

  selectedDossier = d;
  _pendingSelectDossierId = dossierId;
  showPage('attribution', null, null);
}

// Vue lecture seule d'un dossier (pour les rôles sans accès Attribution)
function showDossierReadOnly(d) {
  const dt = taches.filter(t => t.dossierId === d.id);
  const clos = _dossierClosed(d);
  const steps = ETAPES_CONFIG.map(e => {
    const te = dt.filter(t => t.etapeCode === e.code);
    let status = 'VIDE';
    if (clos)                                                                status = 'TERMINE';
    else if (te.length > 0 && te.every(t => t.statut === 'TERMINE'))          status = 'TERMINE';
    else if (te.some(t => t.statut === 'EN_COURS' || t.statut === 'TERMINE')) status = 'EN_COURS';
    else if (te.some(t => t.statut === 'A_FAIRE'))                            status = 'A_FAIRE';
    return { e, status, te };
  });
  const done = steps.filter(s => s.status === 'TERMINE').length;
  const applicable = steps.filter(s => s.te && s.te.length).length;
  const pct  = clos ? 100 : (applicable ? Math.round(done / applicable * 100) : 0);
  const col  = s => s==='TERMINE'?'#16a34a':s==='EN_COURS'?'#d97706':s==='A_FAIRE'?'#2563eb':'#d6d3d1';

  const stepsHtml = steps.map(s => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--color-border)">
      <span style="width:10px;height:10px;border-radius:50%;background:${col(s.status)};flex-shrink:0"></span>
      <span style="flex:1;font-size:13px;color:var(--color-text-primary)">${s.e.label}</span>
      <span style="font-size:11px;font-weight:600;color:${col(s.status)}">${s.status==='TERMINE'?'Terminé':s.status==='EN_COURS'?'En cours':s.status==='A_FAIRE'?'À faire':'—'}</span>
      ${s.te.length ? `<span style="font-size:11px;color:var(--color-text-muted)">${(_canSeeAllOps() ? s.te.map(t=>t.operateur) : s.te.map(t=>_sameOp(t.operateur,_myOpLabel())?t.operateur:'Opérateur')).filter(Boolean).join(', ')}</span>` : ''}
    </div>`).join('');

  let overlay = document.getElementById('dossierReadOnlyModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'dossierReadOnlyModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div style="background:var(--color-surface);border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.18);width:100%;max-width:480px;max-height:85vh;overflow-y:auto" onclick="event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--color-border)">
        <div>
          <h3 style="margin:0;font-size:15px;font-weight:600;color:var(--color-text-primary)">${d.numeroDossier||'Dossier'}</h3>
          <p style="margin:2px 0 0;font-size:12px;color:var(--color-text-muted)">${d.client||'—'}</p>
        </div>
        <button onclick="document.getElementById('dossierReadOnlyModal').style.display='none'" style="background:none;border:none;cursor:pointer;padding:6px;color:var(--color-text-muted);font-size:18px;line-height:1">×</button>
      </div>
      <div style="padding:18px 22px">
        <div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap">
          <div><p style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-muted);margin:0">Produit</p><p style="font-size:13px;font-weight:500;color:var(--color-text-primary);margin:2px 0 0">${d.produit||'—'}</p></div>
          ${d.quantite?`<div><p style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-muted);margin:0">Quantité</p><p style="font-size:13px;font-weight:500;color:var(--color-text-primary);margin:2px 0 0">${d.quantite}</p></div>`:''}
          <div><p style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-muted);margin:0">Progression</p><p style="font-size:13px;font-weight:700;color:${pct===100?'#16a34a':'#e8834a'};margin:2px 0 0">${pct}%</p></div>
        </div>
        <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-muted);margin:0 0 6px">Étapes de production</p>
        ${stepsHtml}
      </div>
    </div>`;
}

function _buildCardProductionSection(dossierId) {
  const dt = taches.filter(t => t.dossierId === dossierId);
  const clos = _dossierClosed((Array.isArray(dossiers) ? dossiers : []).find(x => x.id === dossierId));
  let doneCount = 0;
  const steps = ETAPES_CONFIG.map(e => {
    const te = dt.filter(t => t.etapeCode === e.code);
    let status = 'VIDE';
    // Toutes les tâches de l'étape doivent être TERMINE pour valider l'étape
    // (ou dossier clôturé par l'admin → pipeline complet même sans tâche)
    if (clos)                                                                    { status = 'TERMINE'; doneCount++; }
    else if (te.length > 0 && te.every(t => t.statut === 'TERMINE'))             { status = 'TERMINE'; doneCount++; }
    else if (te.some(t => t.statut === 'EN_COURS' || t.statut === 'TERMINE'))     status = 'EN_COURS';
    else if (te.some(t => t.statut === 'A_FAIRE'))                                status = 'A_FAIRE';
    return { ...e, status, tachesEtape: te };
  });
  const applicable = steps.filter(s => s.tachesEtape && s.tachesEtape.length).length;
  const pct = clos ? 100 : (applicable ? Math.round(doneCount / applicable * 100) : 0);
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

// Fusion dédoublonnée taches (Sheet, autorité pour statut/dates) + tachesLibres
// (local, complète les champs non persistés côté Sheet : titre/priorite/echeance/photos).
// Les tâches libres écrivent aussi dans SHEET_TACHES (DossierID='LIBRE'), donc dès
// qu'un getTaches les récupère, elles existent dans `taches` ET `tachesLibres` avec le
// même id → sans fusion elles s'affichaient en double partout où le code combinait les
// deux tableaux (cartes Charge de travail, page Production, KPI...).
function _allTachesMerged() {
  if (!tachesLibres.length) return taches;
  const localById = new Map(tachesLibres.map(t => [t.id, t]));
  const merged = taches.map(t => {
    const local = localById.get(t.id);
    if (!local) return t;
    localById.delete(t.id);
    return { ...t,
      titre:    local.titre    || t.titre,
      priorite: local.priorite || t.priorite,
      echeance: local.echeance || t.echeance,
      photos:   local.photos   || t.photos };
  });
  return [...merged, ...localById.values()]; // tâches locales pas encore remontées du Sheet
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
  try { showNotifPopup(notif); _notifSound(); } catch(e) {} // pop-up immédiat pour l'action de l'utilisateur courant
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
async function loadNotifsFromGAS(spawnPopups) {
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
        if (spawnPopups) _spawnNotifPopups(fresh); // pop-ups persistants pour les notifs des collègues
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
    _flushTlPhotoQueue();
    const newCount = await loadNotifsFromGAS(true);
    if (newCount > 0 && document.getElementById('notifPanel')?.classList.contains('open')) {
      _renderNotifPanelList(); // rafraîchit le panneau si ouvert
    }
    // Rafraîchir la messagerie (fil commun) + badge non-lus
    _autoRefreshMessagerie();
    // Rafraîchir la page active (Attribution / Production) : les nouvelles
    // attributions apparaissent en direct, sans action manuelle
    try { _autoRefreshActivePage(); } catch(e) { /* silencieux */ }
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

// ════════════════════════════════════════════════════════════
// POP-UPS DE NOTIFICATION PERSISTANTS
// Restent affichés jusqu'à ce que l'utilisateur les ferme (il ne rate rien).
// Déclenchés par le polling pour les actions des AUTRES (jamais les siennes).
// ════════════════════════════════════════════════════════════
function _notifPopStack() {
  let el = document.getElementById('notifPopStack');
  if (!el) {
    el = document.createElement('div');
    el.id = 'notifPopStack';
    el.className = 'notif-pop-stack';
    document.body.appendChild(el);
  }
  return el;
}

function _notifPopColors(n) {
  const msg = n.message || '';
  const code = n.etapeCode || '';
  if (code === 'COMMENT' || msg.indexOf('@') !== -1)       return { np:'#7c3aed', npbg:'#f3e8ff' };
  if (code === 'ANNULE'  || /annul/i.test(msg))            return { np:'#dc2626', npbg:'#fee2e2' };
  if (/termin|100%|complet|livr/i.test(msg))               return { np:'#16a34a', npbg:'#dcfce7' };
  if (code === 'RESERVE' || /commande|r[ée]serv/i.test(msg)) return { np:'#2563eb', npbg:'#dbeafe' };
  return { np:'#e8834a', npbg:'#fff0e6' };
}

// Empile une notif dans la file d'affichage puis (re)dessine le pager.
function showNotifPopup(n) {
  if (!n) return;
  if (n.id && _notifPopQueue.some(x => x && x.id === n.id)) return; // anti-doublon
  _notifPopQueue.unshift(n);   // plus récent en tête
  _notifPopPage = 0;           // une nouvelle notif ramène sur la page la plus récente
  _renderNotifPops();
}

// Retire une notif précise de la file (bouton × d'une carte).
function _closeNotifPop(n) {
  const i = _notifPopQueue.indexOf(n);
  if (i !== -1) _notifPopQueue.splice(i, 1);
  _renderNotifPops();
}

// Vide toute la file (bouton « Tout fermer »).
function _closeAllNotifPops() {
  _notifPopQueue = [];
  _notifPopPage = 0;
  _renderNotifPops();
}

// Construit l'élément DOM d'une carte de notification.
function _buildNotifPopEl(n) {
  const c = _notifPopColors(n);
  const dt = n.timestamp ? new Date(n.timestamp) : new Date();
  const timeStr = isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
  const meta = (n.operateur ? n.operateur + ' · ' : '') + timeStr;
  const pop = document.createElement('div');
  pop.className = 'notif-pop';
  if (n.id) pop.dataset.nid = n.id;
  pop.style.setProperty('--np', c.np);
  pop.style.setProperty('--npbg', c.npbg);
  pop.innerHTML =
      '<div class="notif-pop__ic"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>'
    + '<div class="notif-pop__body"><div class="notif-pop__msg"></div><div class="notif-pop__meta"></div></div>'
    + '<button class="notif-pop__close" aria-label="Fermer">&times;</button>';
  pop.querySelector('.notif-pop__msg').textContent  = n.message || 'Nouvelle notification';
  pop.querySelector('.notif-pop__meta').textContent = meta;
  pop.querySelector('.notif-pop__close').addEventListener('click', (e) => { e.stopPropagation(); _closeNotifPop(n); });
  pop.addEventListener('click', () => {
    if (n.dossierId) { try { openAttribForDossier(n.dossierId); } catch(e){} }
    else            { try { openNotifPanel(); } catch(e){} }
    _closeNotifPop(n);
  });
  return pop;
}

// (Re)dessine la pile de pop-ups : barre de navigation (‹ page / total ›) + une page de cartes.
function _renderNotifPops() {
  const stack = _notifPopStack();
  stack.innerHTML = '';
  const total = _notifPopQueue.length;
  if (!total) return;
  const perPage   = _NOTIF_POP_PER_PAGE;
  const pageCount = Math.ceil(total / perPage);
  if (_notifPopPage > pageCount - 1) _notifPopPage = pageCount - 1;
  if (_notifPopPage < 0) _notifPopPage = 0;

  if (total >= 2) {
    const start = _notifPopPage * perPage + 1;
    const end   = Math.min(total, (_notifPopPage + 1) * perPage);
    const nav = document.createElement('div');
    nav.className = 'notif-pop-nav';
    nav.innerHTML =
        '<div class="notif-pop-nav__pager">'
      +   '<button class="notif-pop-nav__btn" data-act="older" ' + (_notifPopPage >= pageCount - 1 ? 'disabled' : '') + ' aria-label="Notifications plus anciennes" title="Plus anciennes">&#8249;</button>'
      +   '<span class="notif-pop-nav__count">' + start + '–' + end + ' / ' + total + '</span>'
      +   '<button class="notif-pop-nav__btn" data-act="newer" ' + (_notifPopPage <= 0 ? 'disabled' : '') + ' aria-label="Notifications plus récentes" title="Plus récentes">&#8250;</button>'
      + '</div>'
      + '<button class="notif-pop-nav__all">✕ Tout fermer</button>';
    nav.querySelector('[data-act="older"]').addEventListener('click', (e) => { e.stopPropagation(); if (_notifPopPage < pageCount - 1) { _notifPopPage++; _renderNotifPops(); } });
    nav.querySelector('[data-act="newer"]').addEventListener('click', (e) => { e.stopPropagation(); if (_notifPopPage > 0) { _notifPopPage--; _renderNotifPops(); } });
    nav.querySelector('.notif-pop-nav__all').addEventListener('click', (e) => { e.stopPropagation(); _closeAllNotifPops(); });
    stack.appendChild(nav);
  }

  _notifPopQueue
    .slice(_notifPopPage * perPage, _notifPopPage * perPage + perPage)
    .forEach(n => stack.appendChild(_buildNotifPopEl(n)));
}

// Son de notification — chime court généré en Web Audio (aucun fichier externe).
// Désactivable via localStorage 'pos-notif-sound' = 'off'.
function _notifSound() {
  if (localStorage.getItem('pos-notif-sound') === 'off') return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_notifAudioCtx) _notifAudioCtx = new AC();
    const ctx = _notifAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    [[880, 0], [1174.66, 0.12]].forEach(function(p) {
      const freq = p[0], t = p[1];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.18, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.34);
    });
  } catch(e) {}
}

// Affiche les pop-ups pour les notifs nouvelles pendant la session (pas le backlog, pas les siennes)
function _spawnNotifPopups(fresh) {
  if (!_notifPopupArmed || !Array.isArray(fresh) || !fresh.length) return; // pas avant le chargement du backlog
  const myLabel = currentUser?.label || currentUser?.username || '';
  const toShow = fresh
    .filter(n => n && !_sameOp(n.operateur, myLabel)) // exclut ses propres actions (déjà pop-uppées localement)
    .sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp))
    .slice(-6); // au plus 6 d'un coup ; le reste reste dans la cloche
  if (!toShow.length) return;
  toShow.forEach(showNotifPopup);
  _notifSound(); // un seul son par lot
}

// Débloquer l'audio (politique autoplay des navigateurs) au 1er geste utilisateur
document.addEventListener('click', function() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && !_notifAudioCtx) _notifAudioCtx = new AC();
    if (_notifAudioCtx && _notifAudioCtx.state === 'suspended') _notifAudioCtx.resume();
  } catch(e) {}
}, { once:true });

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
  const photos = [...tlPhotos];
  const createdTasks = [];
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
      photos:          [...photos] // base64 local → affichage instantané
    };
    tachesLibres.push(t);
    createdTasks.push(t);
    // Sync GAS pour visibilité cross-appareil (operateur.html, autres postes).
    // On N'envoie PAS le base64 lourd : les photos partent sur Drive en arrière-plan
    // (voir _uploadAndSyncTacheLibrePhotos) puis leurs URLs remplacent la cellule.
    if (APPS_SCRIPT_URL) {
      apiCall({
        action:    'saveTacheLibre',
        tache:     { ...t, photos: [] },
        createdBy: currentUser?.label || 'admin'
      }).catch(() => {});
    }
  });
  saveTachesLibres();
  closeModal('tacheLibreModal');
  showToast(`${createdTasks.length} tâche(s) indépendante(s) créée(s)`);
  renderTaches();
  // Upload des photos sur Drive (une seule fois, partagé) puis persistance des URLs.
  // En cas d'échec (réseau/GAS down) → file de reprise persistante (voir _flushTlPhotoQueue).
  if (APPS_SCRIPT_URL && photos.length) {
    _uploadAndSyncTacheLibrePhotos(createdTasks, photos).then(ok => {
      if (!ok) _enqueueTlPhotoJob(createdTasks.map(t => t.id), photos);
    });
  }
}

// Upload les photos d'une tâche libre sur Drive (via l'action générique 'uploadFile',
// même infra que les pièces jointes de commande). Renvoie { uploaded, allOk } :
// - uploaded : métadonnées Drive {name,type,fileId,viewUrl,dlUrl} (petites, stockables au Sheet)
// - allOk    : true seulement si TOUTES les photos ont été traitées (aucun échec réseau)
async function _uploadTacheLibrePhotos(photos) {
  if (!APPS_SCRIPT_URL || !Array.isArray(photos) || !photos.length) return { uploaded:[], allOk:false };
  const uploaded = [];
  let allOk = true;
  for (let i = 0; i < photos.length; i++) {
    const item    = photos[i];
    const dataUrl = typeof item === 'string' ? item : (item && item.data) || '';
    // Déjà une métadonnée Drive (re-sync) → conserver telle quelle
    if (item && typeof item === 'object' && item.fileId) { uploaded.push(item); continue; }
    if (!dataUrl || dataUrl.indexOf('data:') !== 0) continue; // entrée invalide → ignorée (pas un échec)
    const type = (dataUrl.split(';')[0].split(':')[1]) || 'image/jpeg';
    const ext  = (type.split('/')[1] || 'jpg');
    const name = `tachelibre-${Date.now()}-${i + 1}.${ext}`;
    try {
      const r = await apiCall({ action:'uploadFile', fileName:name, mimeType:type, base64Data:dataUrl });
      if (r && r.ok) uploaded.push({ name:r.fileName || name, type, fileId:r.fileId, viewUrl:r.viewUrl, dlUrl:r.dlUrl });
      else allOk = false; // GAS a répondu KO → à reprendre
    } catch(e) { allOk = false; } // réseau KO → à reprendre
  }
  return { uploaded, allOk };
}

// Après création : upload Drive + remplace le base64 local par les URLs + persiste au Sheet.
// Retourne true si tout a réussi, false si une reprise est nécessaire (base64 conservé en local).
async function _uploadAndSyncTacheLibrePhotos(tasks, photos) {
  const { uploaded, allOk } = await _uploadTacheLibrePhotos(photos);
  // On ne bascule sur Drive que si TOUTES les photos ont été uploadées (évite un état mixte)
  if (!allOk || !uploaded.length) return false;
  tasks.forEach(t => { t.photos = uploaded; }); // source de vérité = Drive (libère le base64)
  saveTachesLibres();
  try { renderTaches(); } catch(e) {}
  // Persister les URLs dans le Sheet ; si un setTacheLibrePhotos échoue, on signale une reprise
  const results = await Promise.all(tasks.map(t =>
    apiCall({ action:'setTacheLibrePhotos', tacheId:t.id, photos:uploaded })
      .then(r => r && r.ok).catch(() => false)
  ));
  return results.every(Boolean);
}

// ── File de reprise des uploads photos (tâches libres) ──
function _saveTlPhotoQueue() {
  try { localStorage.setItem('pos-tl-photo-queue', JSON.stringify(_tlPhotoQueue)); } catch(e) {}
}

function _enqueueTlPhotoJob(ids, photos) {
  if (!ids || !ids.length || !photos || !photos.length) return;
  _tlPhotoQueue.push({ ids, photos, ts: Date.now() });
  if (_tlPhotoQueue.length > 20) _tlPhotoQueue = _tlPhotoQueue.slice(-20); // borne mémoire
  _saveTlPhotoQueue();
}

// Rejoue les jobs d'upload en attente. Appelée par le polling 30s + au retour de connexion.
async function _flushTlPhotoQueue() {
  if (!APPS_SCRIPT_URL || !_tlPhotoQueue.length) return;
  const jobs = _tlPhotoQueue.splice(0);
  _saveTlPhotoQueue();
  for (const job of jobs) {
    // Retrouver les tâches encore présentes (certaines ont pu être supprimées entre-temps)
    const tasks = (job.ids || []).map(id => tachesLibres.find(t => t.id === id)).filter(Boolean);
    if (!tasks.length) continue; // toutes supprimées → job abandonné
    const ok = await _uploadAndSyncTacheLibrePhotos(tasks, job.photos);
    if (!ok) { _tlPhotoQueue.push(job); _saveTlPhotoQueue(); } // toujours KO → remettre en file
  }
}

// <img> pour une photo de tâche libre — gère les 2 formats : chaîne base64 (local/legacy)
// ou métadonnée Drive {fileId,...} (via _driveImgSrc/_driveImgFallback, mêmes que commandes).
function _tacheLibrePhotoImg(p) {
  const isObj = p && typeof p === 'object';
  const src   = isObj ? _driveImgSrc(p) : p;
  const fb    = isObj ? _driveImgFallback(p) : '';
  const onerr = fb ? ` onerror="this.onerror=null;this.src='${fb}'"` : '';
  return `<img src="${src}"${onerr} onclick="event.stopPropagation();window.open(this.src,'_blank')" />`;
}

function deleteTacheLibre(id) {
  if (!confirm('Supprimer cette tâche indépendante ?')) return;
  tachesLibres = tachesLibres.filter(t => t.id !== id);
  saveTachesLibres();
  // Sync suppression dans GAS
  if (APPS_SCRIPT_URL) {
    apiCall({ action:'deleteTache', id }).catch(() => {});
  }
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
  if (typeof _syncDossierDates === 'function') _syncDossierDates();  // réf. canoniques avant impression
  const moisLabel  = attrDateFilter.mois  ? _MOIS_FR[+attrDateFilter.mois]  : '';
  const anneeLabel = attrDateFilter.annee ? attrDateFilter.annee : '';
  const periodStr  = moisLabel && anneeLabel ? `${moisLabel} ${anneeLabel}`
                   : moisLabel ? moisLabel
                   : anneeLabel ? anneeLabel
                   : 'Tous les dossiers';

  // Filtrer la liste visible (+ cloisonnement : un opérateur ne voit que ses dossiers)
  const list = _attribVisibleDossiers().filter(d => _matchDateFilter(d.dateCreation, attrDateFilter));

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
    const _opsSrc = _canSeeAllOps() ? dTaches : dTaches.filter(t => _sameOp(t.operateur, _myOpLabel()));
    const ops = [...new Set(_opsSrc.map(t => t.operateur).filter(Boolean))].join(', ') || '—';
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
  let list = isAdminOrChef ? _allTachesMerged()
           : _allTachesMerged().filter(t => _sameOp(t.operateur, myLabel));
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

// Petit badge Jour/Nuit réutilisable (cockpit, listes).
function _shiftBadge(shift) {
  if (shift === 'Nuit') return '<span class="shift-badge shift-nuit">🌙 Nuit</span>';
  if (shift === 'Jour') return '<span class="shift-badge shift-jour">☀️ Jour</span>';
  return '';
}

// ── FEUILLE DE TRAVAIL JOUR / NUIT (contrôle manuel imprimable) ──────────────
// Liste les tâches encore à faire ou en cours, groupées par équipe (Jour/Nuit)
// puis par opérateur, avec des colonnes vierges « Fait » et « Visa » pour un
// pointage manuel sur papier. Admin/chef = tout ; opérateur = ses tâches.
function printFeuilleTravail(shiftFilter) {
  if (typeof _syncDossierDates === 'function') _syncDossierDates();
  const isAdminOrChef = ['admin','chef_atelier'].includes(currentUser?.role);
  const myLabel = currentUser?.label || currentUser?.username || '';

  // Index dossier pour enrichir chaque tâche (client / produit / échéance).
  const dMap = {};
  (Array.isArray(dossiers) ? dossiers : []).forEach(d => { dMap[d.id] = d; });

  // Tâches actives (à faire + en cours), visibles selon le rôle.
  let list = _allTachesMerged().filter(t => t.statut === 'A_FAIRE' || t.statut === 'EN_COURS');
  if (!isAdminOrChef) list = list.filter(t => _sameOp(t.operateur, myLabel));
  if (shiftFilter === 'Jour' || shiftFilter === 'Nuit') list = list.filter(t => (t.shift || '') === shiftFilter);

  const now      = new Date();
  const dateStr  = now.toLocaleDateString('fr-FR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
  const heureStr = now.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });

  // Groupes d'équipe à afficher, dans l'ordre.
  const shiftOrder = shiftFilter ? [shiftFilter] : ['Jour', 'Nuit', ''];
  const shiftTitle = { 'Jour':'☀️  ÉQUIPE DE JOUR', 'Nuit':'🌙  ÉQUIPE DE NUIT', '':'⏱️  Sans équipe assignée' };

  let sections = '';
  shiftOrder.forEach(sh => {
    const inShift = list.filter(t => (t.shift || '') === sh);
    if (!inShift.length && sh === '') return; // on masque « sans équipe » s'il est vide
    // Groupé par opérateur
    const byOp = {};
    inShift.forEach(t => { const op = t.operateur || 'Non assigné'; (byOp[op] = byOp[op] || []).push(t); });
    const opBlocks = Object.entries(byOp).sort(([a],[b]) => a.localeCompare(b)).map(([op, tl]) => {
      const rows = tl.map(t => {
        const d = dMap[t.dossierId] || {};
        const ref = t.dossierId && String(t.dossierId).startsWith('TL_') ? 'Libre' : (t.numeroDossier || t.dossierId || '—');
        const prod = d.produit ? `${d.produit}${d.quantite ? ' ×' + d.quantite : ''}` : (t.titre || '—');
        const ech  = d.echeance || d.dateLivraisonProd || d.dateLivraison || t.echeance || '';
        const echStr = ech ? (_dispDate ? _dispDate(ech) : ech) : '—';
        const prio = t.priorite || d.priorite || 'Normale';
        const prioBadge = prio === 'Urgente' ? '<span class="badge badge-red">Urgente</span>'
          : prio === 'Haute' ? '<span class="badge badge-amber">Haute</span>' : '';
        const statut = t.statut === 'EN_COURS' ? '<span class="badge badge-amber">En cours</span>' : '';
        return `<tr>
          <td><strong>${ref}</strong></td>
          <td>${d.client || '—'}</td>
          <td>${prod}</td>
          <td>${t.etapeLabel || t.titre || '—'} ${statut}</td>
          <td>${echStr} ${prioBadge}</td>
          <td class="ctrl-box"></td>
          <td class="ctrl-visa"></td>
        </tr>`;
      }).join('');
      return `<div class="op-block">
        <div class="op-name">${op} <span class="op-count">${tl.length} tâche${tl.length > 1 ? 's' : ''}</span></div>
        <table class="ft-table">
          <thead><tr>
            <th style="width:12%">N° Dossier</th><th style="width:18%">Client</th><th style="width:22%">Produit</th>
            <th style="width:22%">Étape</th><th style="width:14%">Échéance / Prio</th>
            <th style="width:6%">Fait ✓</th><th style="width:6%">Visa</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }).join('');
    sections += `<div class="shift-section">
      <div class="shift-head">${shiftTitle[sh]} <span class="shift-count">${inShift.length} tâche${inShift.length > 1 ? 's' : ''}</span></div>
      ${inShift.length ? opBlocks : '<p style="color:#78716c;font-style:italic;padding:8px 0">Aucune tâche.</p>'}
    </div>`;
  });

  if (!sections) sections = '<p style="color:#78716c;font-style:italic;text-align:center;padding:24px">Aucune tâche active à dispatcher.</p>';

  _printWindow('Feuille de travail — FOREVER MG', `
    <style>
      .shift-section { margin-bottom:22px; page-break-inside:avoid; }
      .shift-head { font-size:15px; font-weight:800; color:#1c1917; background:#f5f5f4; border-left:4px solid #e8834a;
        padding:8px 12px; border-radius:4px; margin-bottom:10px; }
      .shift-count { font-weight:600; font-size:12px; color:#78716c; }
      .op-block { margin:0 0 14px 0; page-break-inside:avoid; }
      .op-name { font-size:13px; font-weight:700; color:#292524; margin-bottom:4px; }
      .op-count { font-weight:500; font-size:11px; color:#a8a29e; }
      table.ft-table { width:100%; border-collapse:collapse; font-size:11px; }
      table.ft-table th { background:#fafaf9; border:1px solid #d6d3d1; padding:5px 6px; text-align:left; font-size:10px; text-transform:uppercase; color:#57534e; }
      table.ft-table td { border:1px solid #e7e5e4; padding:6px; vertical-align:top; }
      td.ctrl-box, td.ctrl-visa { height:26px; }
      td.ctrl-box { background:repeating-linear-gradient(45deg,#fff,#fff 6px,#fafafa 6px,#fafafa 7px); }
    </style>
    <div class="rpt-title">Feuille de Travail — Contrôle</div>
    <div class="rpt-period">${dateStr} · éditée à ${heureStr}${!isAdminOrChef ? ' · ' + myLabel : ''}</div>
    ${sections}
    <div style="margin-top:24px;display:flex;justify-content:space-between;font-size:12px;color:#57534e">
      <div>Chef d'atelier : _____________________</div>
      <div>Visa contrôle : _____________________</div>
    </div>
  `);
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
  _injectBtnDossierManuel();
}

function _injectBtnDossierManuel() {
  if (document.getElementById('btnDossierManuel')) return;
  const topbar = document.querySelector('#page-attribution .page-topbar');
  if (!topbar) return;
  const btn = document.createElement('button');
  btn.id = 'btnDossierManuel';
  btn.style.cssText = 'background:#e8834a;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:\'DM Sans\',sans-serif';
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Dossier manuel`;
  btn.onclick = openDossierManuelModal;
  topbar.appendChild(btn);
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
  // L'endpoint thumbnail s'affiche de façon fiable dans <img> (uc?id= est bloqué par Google)
  if (fileId) return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';
  return att.data || ''; // fallback base64 local
}

// URL de secours si la vignette Drive échoue (lh3) — utilisée dans onerror
function _driveImgFallback(att) {
  if (!att) return '';
  const fileId = att.fileId
    || (att.viewUrl ? (att.viewUrl.split('/d/')[1]||'').split('/')[0] : '')
    || (att.dlUrl   ? (att.dlUrl.split('id=')[1]||'').split('&')[0]  : '');
  return fileId ? 'https://lh3.googleusercontent.com/d/' + fileId + '=w400' : '';
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
  // Rend UNIQUEMENT le fil de commentaires (historique) dans le body scrollable.
  // Le formulaire de saisie (textarea + Envoyer) vit dans le footer fixe du
  // panneau, rendu une seule fois par renderAttrPanel — il n'est pas régénéré ici,
  // pour rester toujours visible et conserver la saisie en cours.
  const container = document.getElementById('commentsList');
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
                const fbSrc    = isImg ? _driveImgFallback(a) : '';
                const ext = (a.name||'').split('.').pop().toUpperCase();
                return '<div style="position:relative">'
                  + (isImg && thumbSrc
                      ? '<img src="'+thumbSrc+'" onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src=\''+fbSrc+'\'}" onclick="window.open(\''+viewUrl+'\',\'_blank\')" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--color-border);cursor:pointer" title="'+a.name+'" />'
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

  container.innerHTML = listHtml;
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
// MESSAGERIE — Fil commun de l'équipe (+ pièces jointes)
// Canal global : dossierId = '__GLOBAL__' (réutilise getComments/addComment)
// ============================================================
const MSG_GLOBAL_ID = '__GLOBAL__';
let msgAttachments = [];      // pièces jointes du message en cours
let _lastMsgRefresh = 0;

function _msgList() {
  return dossierComments
    .filter(c => c.dossierId === MSG_GLOBAL_ID)
    .sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
}

async function loadMessagerie() {
  renderMessagerieList(_msgList()); // affichage immédiat depuis le cache
  if (APPS_SCRIPT_URL) {
    const fresh = await loadCommentsForDossier(MSG_GLOBAL_ID);
    renderMessagerieList(fresh || _msgList());
  }
  _markMessagerieRead();
}

function renderMessagerieList(messages) {
  const box = document.getElementById('msgGlobalList');
  if (!box) return;
  const myLabel = currentUser?.label || currentUser?.username || '';
  const wasNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;

  if (!messages.length) {
    box.innerHTML = '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--color-text-muted);padding:50px 20px;text-align:center">'
      + '<div style="width:48px;height:48px;background:var(--color-bg);border-radius:14px;display:flex;align-items:center;justify-content:center;margin-bottom:12px"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>'
      + '<p style="font-size:14px;font-weight:500;color:var(--color-text-secondary);margin:0">Aucun message</p>'
      + '<p style="font-size:12px;margin:4px 0 0">Démarrez la conversation de l\'équipe</p></div>';
    return;
  }

  box.innerHTML = messages.map(c => {
    const dt = new Date(c.timestamp);
    const dateStr = dt.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}) + ' ' + dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    const isMe = c.author === myLabel;
    const highlighted = (c.text || '').replace(/(@[\wÀ-ÿ]+(?:\s+[\wÀ-ÿ]+)?)/g,
      '<span style="color:var(--color-secondary);font-weight:600">$1</span>');
    const attachHtml = (c.attachments||[]).length
      ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">'
        + c.attachments.map(a => {
            const isImg   = (a.type||'').startsWith('image/');
            const viewUrl = a.viewUrl || a.data || '';
            const dlUrl   = a.dlUrl   || a.data || '';
            const thumbSrc = isImg ? _driveImgSrc(a) : '';
            const fbSrc    = isImg ? _driveImgFallback(a) : '';
            const ext = (a.name||'').split('.').pop().toUpperCase();
            return '<div style="position:relative">'
              + (isImg && thumbSrc
                  ? '<img src="'+thumbSrc+'" onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src=\''+fbSrc+'\'}" onclick="window.open(\''+viewUrl+'\',\'_blank\')" style="width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid var(--color-border);cursor:pointer" title="'+a.name+'" />'
                  : '<a href="'+viewUrl+'" target="_blank" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:52px;height:52px;border-radius:8px;border:1px solid var(--color-border);background:var(--color-bg);text-decoration:none;color:var(--color-primary)">'
                    + '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
                    + '<span style="font-size:7px;font-weight:700">'+ext+'</span></a>')
              + (a.dlUrl ? '<a href="'+dlUrl+'" download="'+a.name+'" title="Télécharger" style="position:absolute;bottom:-4px;right:-4px;background:var(--color-secondary);color:#fff;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:9px">↓</a>' : '')
              + '</div>';
          }).join('')
        + '</div>'
      : '';
    return '<div style="display:flex;flex-direction:column;align-items:'+(isMe?'flex-end':'flex-start')+';margin-bottom:14px">'
      + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">'
      +   '<span style="font-size:11px;font-weight:700;color:'+(isMe?'var(--color-secondary)':'var(--color-primary)')+'">'+c.author+'</span>'
      +   '<span style="font-size:10px;color:var(--color-text-muted)">'+dateStr+'</span>'
      + '</div>'
      + '<div style="max-width:78%;background:'+(isMe?'#fdf0e8':'var(--color-surface)')+';border:1px solid '+(isMe?'rgba(232,131,74,.25)':'var(--color-border)')+';border-radius:12px;padding:9px 12px">'
      +   (c.text ? '<div style="font-size:14px;color:var(--color-text-primary);white-space:pre-wrap;word-break:break-word;line-height:1.5">'+highlighted+'</div>' : '')
      +   attachHtml
      + '</div>'
      + '</div>';
  }).join('');

  if (wasNearBottom) box.scrollTop = box.scrollHeight;
}

function handleMsgMention(event) {
  const textarea = document.getElementById('msgGlobalText');
  const dropdown = document.getElementById('msgMentionDropdown');
  if (!textarea || !dropdown) return;
  const before = textarea.value.substring(0, textarea.selectionStart);
  const match  = before.match(/@([\wÀ-ÿ]*)$/);
  if (!match) { dropdown.style.display = 'none'; return; }
  const query = match[1].toLowerCase();
  const results = localUsers.filter(u => u.actif !== false && (
    (u.label||'').toLowerCase().includes(query) || u.username.toLowerCase().includes(query)
  )).slice(0, 6);
  if (!results.length) { dropdown.style.display = 'none'; return; }
  dropdown.style.display = 'block';
  dropdown.innerHTML = results.map(u =>
    '<div onclick="insertMsgMention(\''+encodeURIComponent(u.label||u.username)+'\')"'
    + ' style="padding:7px 12px;cursor:pointer;font-size:13px"'
    + ' onmouseover="this.style.background=\'var(--color-primary-light)\'"'
    + ' onmouseout="this.style.background=\'\'">'
    + '<span style="font-weight:600">'+(u.label||u.username)+'</span>'
    + ' <span style="font-size:11px;color:var(--color-text-muted)">'+(ROLE_LABELS[u.role]||u.role)+'</span>'
    + '</div>'
  ).join('');
}

function insertMsgMention(encodedLabel) {
  const label = decodeURIComponent(encodedLabel);
  const textarea = document.getElementById('msgGlobalText');
  const dropdown = document.getElementById('msgMentionDropdown');
  if (!textarea) return;
  const text   = textarea.value;
  const cursor = textarea.selectionStart;
  const before = text.substring(0, cursor).replace(/@([\wÀ-ÿ]*)$/, '@'+label+' ');
  textarea.value = before + text.substring(cursor);
  textarea.focus();
  textarea.setSelectionRange(before.length, before.length);
  if (dropdown) dropdown.style.display = 'none';
}

async function addMsgAttachment(files) {
  if (!files || !files.length) return;
  const MAX = 4;
  if (msgAttachments.length >= MAX) { showToast('Maximum 4 fichiers par message', 'error'); return; }
  const remaining = MAX - msgAttachments.length;
  for (const file of Array.from(files).slice(0, remaining)) {
    if (file.size > 8*1024*1024) { showToast(file.name+' trop volumineux (max 8 Mo)', 'error'); continue; }
    try {
      const data = file.type.startsWith('image/')
        ? await _resizeImage(file, 1200, 1200)
        : await new Promise((res,rej) => { const r=new FileReader(); r.onload=e=>res(e.target.result); r.onerror=rej; r.readAsDataURL(file); });
      msgAttachments.push({ name:file.name, type:file.type, data });
    } catch(e) { showToast('Erreur : '+file.name, 'error'); }
  }
  renderMsgAttachments();
  const input = document.getElementById('msgGlobalAttachInput');
  if (input) input.value = '';
}

function removeMsgAttachment(idx) {
  msgAttachments.splice(idx, 1);
  renderMsgAttachments();
}

function renderMsgAttachments() {
  const c = document.getElementById('msgGlobalAttachPreviews');
  if (!c) return;
  if (!msgAttachments.length) { c.innerHTML = ''; return; }
  c.innerHTML = msgAttachments.map((a,i) => {
    const isImg = a.type.startsWith('image/');
    return '<div style="position:relative;display:inline-block">'
      + (isImg
          ? '<img src="'+a.data+'" style="width:48px;height:48px;object-fit:cover;border-radius:8px;border:1.5px solid var(--color-border)" />'
          : '<div style="width:48px;height:48px;border-radius:8px;border:1.5px solid var(--color-border);background:var(--color-bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:var(--color-primary)">'
            + '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
            + '<span style="font-size:8px;font-weight:700">'+a.name.split('.').pop().toUpperCase()+'</span>'
            + '</div>')
      + '<button onclick="removeMsgAttachment('+i+')" style="position:absolute;top:-5px;right:-5px;background:#dc2626;color:#fff;border:none;border-radius:50%;width:16px;height:16px;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0">×</button>'
      + '</div>';
  }).join('');
}

async function submitMsgGlobal() {
  const textarea = document.getElementById('msgGlobalText');
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text && !msgAttachments.length) { showToast('Message vide', 'error'); return; }

  // Extraire les @mentions
  const mentions = [];
  const rx = /@([\wÀ-ÿ]+(?:\s+[\wÀ-ÿ]+)?)/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const u = localUsers.find(u => (u.label||u.username||'').toLowerCase() === m[1].toLowerCase());
    if (u && !mentions.includes(u.label||u.username)) mentions.push(u.label||u.username);
  }

  const message = {
    id:            'MSG_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
    dossierId:     MSG_GLOBAL_ID,
    numeroDossier: 'MESSAGERIE',
    author:        currentUser?.label || currentUser?.username || 'Anonyme',
    authorRole:    currentUser?.role || '',
    text,
    mentions,
    attachments:   msgAttachments.map(a => ({ name:a.name, type:a.type, data:a.data })),
    timestamp:     new Date().toISOString()
  };

  // 1. Affichage immédiat
  dossierComments.push(message);
  saveComments();
  textarea.value = '';
  msgAttachments = [];
  renderMsgAttachments();
  renderMessagerieList(_msgList());
  _markMessagerieRead();

  // Notifications ciblées pour les @mentions
  mentions.forEach(lbl => {
    _addNotification({ dossierId:MSG_GLOBAL_ID, numeroDossier:'Messagerie', etapeCode:'MESSAGE', etapeLabel:'Messagerie',
      operateur:message.author, message:`${message.author} vous a mentionné : "${text.slice(0,60)}${text.length>60?'…':''}"` });
  });

  // 2. Upload Drive + sync GAS en arrière-plan
  if (!APPS_SCRIPT_URL) return;
  (async () => {
    if (message.attachments.length) {
      const uploaded = [];
      for (const att of message.attachments) {
        try {
          const r = await apiCall({ action:'uploadFile', fileName:att.name, mimeType:att.type, base64Data:att.data });
          uploaded.push(r?.ok ? { name:r.fileName||att.name, type:att.type, fileId:r.fileId, viewUrl:r.viewUrl, dlUrl:r.dlUrl } : att);
        } catch(e) { uploaded.push(att); }
      }
      message.attachments = uploaded;
      saveComments();
      renderMessagerieList(_msgList());
    }
    apiCall({ action:'addComment', ...message });
  })();
}

async function refreshMessagerie(btn) {
  if (btn) {
    btn.disabled = true;
    const svg = btn.querySelector('svg');
    if (svg) svg.style.animation = 'spin 0.8s linear infinite';
  }
  _lastMsgRefresh = 0;
  await loadMessagerie();
  if (btn) {
    btn.disabled = false;
    const svg = btn.querySelector('svg');
    if (svg) svg.style.animation = '';
  }
}

async function _autoRefreshMessagerie() {
  if (!APPS_SCRIPT_URL) return;
  const now = Date.now();
  if (now - _lastMsgRefresh < 20000) return;
  _lastMsgRefresh = now;
  const fresh = await loadCommentsForDossier(MSG_GLOBAL_ID);
  // Ne re-render que si la page est active
  if (document.getElementById('page-messagerie')?.classList.contains('active')) {
    renderMessagerieList(fresh || _msgList());
    _markMessagerieRead();
  } else {
    _updateMsgBadge();
  }
}

// ── Badge non-lus ──
function _msgLastReadTs() {
  if (!currentUser) return Date.now();
  return parseInt(localStorage.getItem('pos-msg-ts-' + currentUser.username) || '0');
}
function _markMessagerieRead() {
  if (!currentUser) return;
  localStorage.setItem('pos-msg-ts-' + currentUser.username, String(Date.now()));
  _updateMsgBadge();
}
function _updateMsgBadge() {
  const badge = document.getElementById('navMsgBadge');
  if (!badge) return;
  const myLabel = currentUser?.label || currentUser?.username || '';
  const lastRead = _msgLastReadTs();
  const unread = _msgList().filter(c => c.author !== myLabel && new Date(c.timestamp).getTime() > lastRead).length;
  if (unread > 0) { badge.textContent = unread > 99 ? '99+' : unread; badge.style.display = 'inline-block'; }
  else { badge.style.display = 'none'; }
}

// ============================================================
// PAGE ATTRIBUTION
// ============================================================
let _pendingSelectDossierId = null;

// ── Modale création dossier manuel ─────────────────────────
function openDossierManuelModal() {
  let modal = document.getElementById('dossierManuelModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dossierManuelModal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;align-items:center;justify-content:center;padding:16px';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.2)" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #e5e3df">
          <div>
            <h3 style="margin:0;font-size:15px;font-weight:700;color:#1c1917">Nouveau dossier manuel</h3>
            <p style="margin:2px 0 0;font-size:12px;color:#a8a29e">Production sans vente POS</p>
          </div>
          <button onclick="closeDossierManuelModal()" style="background:none;border:none;cursor:pointer;font-size:20px;color:#a8a29e;line-height:1;padding:4px">×</button>
        </div>
        <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px">
          <div>
            <label style="font-size:12px;font-weight:600;color:#78716c;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em">Produit / Description *</label>
            <input id="dmProduit" type="text" placeholder="Ex: Carte de visite 500ex, T-shirt brodé..."
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e3df;border-radius:8px;font-size:14px;font-family:'DM Sans',sans-serif;outline:none;color:#1c1917;background:#fff;box-sizing:border-box"/>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="font-size:12px;font-weight:600;color:#78716c;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em">Quantité *</label>
              <input id="dmQty" type="number" min="1" value="1"
                style="width:100%;padding:10px 12px;border:1.5px solid #e5e3df;border-radius:8px;font-size:14px;font-family:'DM Sans',sans-serif;outline:none;color:#1c1917;background:#fff;box-sizing:border-box"/>
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#78716c;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em">Priorité</label>
              <select id="dmPriorite" style="width:100%;padding:10px 12px;border:1.5px solid #e5e3df;border-radius:8px;font-size:14px;font-family:'DM Sans',sans-serif;outline:none;color:#1c1917;background:#fff;box-sizing:border-box">
                <option value="Normale">Normale</option>
                <option value="Haute">Haute</option>
                <option value="Urgente">Urgente</option>
              </select>
            </div>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;color:#78716c;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em">Client (optionnel)</label>
            <input id="dmClient" type="text" placeholder="Nom du client ou 'Interne'"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e3df;border-radius:8px;font-size:14px;font-family:'DM Sans',sans-serif;outline:none;color:#1c1917;background:#fff;box-sizing:border-box"/>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;color:#78716c;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em">Date de livraison souhaitée</label>
            <input id="dmDateLiv" type="date"
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e3df;border-radius:8px;font-size:14px;font-family:'DM Sans',sans-serif;outline:none;color:#1c1917;background:#fff;box-sizing:border-box"/>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;color:#78716c;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em">Notes</label>
            <textarea id="dmNotes" rows="2" placeholder="Instructions, spécifications particulières..."
              style="width:100%;padding:10px 12px;border:1.5px solid #e5e3df;border-radius:8px;font-size:14px;font-family:'DM Sans',sans-serif;outline:none;resize:none;color:#1c1917;background:#fff;box-sizing:border-box"></textarea>
          </div>
          <div style="display:flex;align-items:center;gap:10px;padding:12px;background:#f8f7f4;border-radius:8px;border:1px solid #e5e3df">
            <input type="checkbox" id="dmDeduireStock" style="width:16px;height:16px;cursor:pointer;accent-color:#1a4a3a"/>
            <div>
              <label for="dmDeduireStock" style="font-size:13px;font-weight:600;color:#1c1917;cursor:pointer">Déduire du stock catalogue</label>
              <div style="font-size:11px;color:#a8a29e;margin-top:2px">Si le produit existe dans votre catalogue, le stock sera réduit de la quantité</div>
            </div>
          </div>
        </div>
        <div style="padding:14px 22px;border-top:1px solid #e5e3df;display:flex;gap:10px;justify-content:flex-end">
          <button onclick="closeDossierManuelModal()" style="padding:10px 18px;border:1.5px solid #e5e3df;background:none;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;color:#78716c;cursor:pointer">Annuler</button>
          <button onclick="saveDossierManuel()" style="padding:10px 20px;background:#1a4a3a;color:#fff;border:none;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer">Créer le dossier</button>
        </div>
      </div>`;
    modal.onclick = closeDossierManuelModal;
    document.body.appendChild(modal);
  }
  ['dmProduit','dmClient','dmNotes','dmDateLiv'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const dmQty = document.getElementById('dmQty');
  if (dmQty) dmQty.value = 1;
  const dmPrio = document.getElementById('dmPriorite');
  if (dmPrio) dmPrio.value = 'Normale';
  const dmStock = document.getElementById('dmDeduireStock');
  if (dmStock) dmStock.checked = false;

  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('dmProduit')?.focus(), 100);
}

function closeDossierManuelModal() {
  const modal = document.getElementById('dossierManuelModal');
  if (modal) modal.style.display = 'none';
}

async function saveDossierManuel() {
  const produit  = document.getElementById('dmProduit')?.value.trim();
  const qty      = parseInt(document.getElementById('dmQty')?.value) || 0;
  const priorite = document.getElementById('dmPriorite')?.value || 'Normale';
  const client   = document.getElementById('dmClient')?.value.trim() || 'Interne';
  const dateLiv  = document.getElementById('dmDateLiv')?.value || '';
  const notes    = document.getElementById('dmNotes')?.value.trim() || '';
  const deduire  = document.getElementById('dmDeduireStock')?.checked || false;

  if (!produit) { showToast('Le nom du produit est requis', 'error'); return; }
  if (qty <= 0)  { showToast('La quantité doit être supérieure à 0', 'error'); return; }

  if (!APPS_SCRIPT_URL) {
    showToast('URL GAS non configurée — dossier créé localement uniquement', 'warning');
    _createDossierManuelLocal({ produit, qty, priorite, client, dateLiv, notes });
    closeDossierManuelModal();
    return;
  }

  showToast('Création du dossier...', 'info');
  const r = await apiCall({
    action: 'creerDossierManuel',
    dossier: {
      produit,
      quantite:      qty,
      priorite,
      client,
      dateLivraison: dateLiv,
      notes,
      deduireStock:  deduire,
      createdBy:     currentUser?.label || 'admin'
    }
  });

  if (!r || !r.ok) {
    showToast('Erreur création : ' + (r?.error || 'Connexion impossible'), 'error');
    return;
  }

  const dossierLocal = {
    id:            r.dossId,
    numeroDossier: r.numDoss,
    client,
    produit,
    quantite:      qty,
    statut:        'CREE',
    progression:   0,
    dateCreation:  new Date().toLocaleDateString('fr-FR'),
    dateLivraison: dateLiv,
    priorite,
    sourceVente:   'Manuel',
    notes
  };
  dossiers.unshift(dossierLocal);

  if (deduire && r.stockInfo?.deduit) {
    const p = products.find(pr => pr.name === produit);
    if (p) {
      p.stock = Math.max(0, p.stock - qty);
      renderProducts();
      renderStockTable();
    }
  }

  closeDossierManuelModal();
  const stockMsg = deduire
    ? (r.stockInfo?.deduit ? ' — stock déduit' : ' — article non trouvé dans le catalogue')
    : '';
  showToast(`Dossier ${r.numDoss} créé${stockMsg}`);

  await loadDossiers();

  if (r.dossId) {
    setTimeout(() => selectDossier(r.dossId), 500);
  }
}

function _createDossierManuelLocal({ produit, qty, priorite, client, dateLiv, notes }) {
  const tmpId   = 'MAN_LOCAL_' + Date.now();
  const numDoss = 'MAN-LOCAL-' + String(dossiers.length + 1).padStart(3,'0');
  const d = {
    id: tmpId, numeroDossier: numDoss,
    client, produit, quantite: qty,
    statut: 'CREE', progression: 0,
    dateCreation:  new Date().toLocaleDateString('fr-FR'),
    dateLivraison: dateLiv,
    priorite, sourceVente: 'Manuel', notes
  };
  dossiers.unshift(d);
  loadDossiers();
  showToast('Dossier créé localement (sync GAS au prochain rechargement)');
}

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

// ── Virtual scroll — liste des dossiers (20 000+ items) ─────────────────
// Seules les lignes visibles + un buffer sont dans le DOM.
// Deux spacers (top/bottom) maintiennent la hauteur totale du scrollbar.
const _VS_ROW_H = 86;   // hauteur estimée par ligne px (contenu + gap 10px)
const _VS_BUF   = 8;    // lignes de tampon hors viewport
let _vsData = [], _vsOuter = null, _vsWrap = null, _vsTop = null, _vsBtm = null, _vsRaf = false;

function _vsInit(list) {
  const outer = document.getElementById('dossierListContainer');
  if (!outer) return;
  _vsData  = list;
  _vsOuter = outer;

  // Nettoyer : on retire l'event listener précédent en remplaçant onscroll
  outer.innerHTML = '';
  outer.className = '';
  outer.onscroll  = null;
  const fresh = outer.cloneNode(false);
  outer.parentNode.replaceChild(fresh, outer);
  _vsOuter = fresh;

  _vsTop  = document.createElement('div');
  _vsWrap = document.createElement('div');
  _vsWrap.className = 'dossier-list-wrap';
  _vsBtm  = document.createElement('div');
  fresh.appendChild(_vsTop);
  fresh.appendChild(_vsWrap);
  fresh.appendChild(_vsBtm);

  fresh.addEventListener('scroll', _vsOnScroll, { passive: true });
  _vsRender();
}

function _vsOnScroll() {
  if (_vsRaf) return;
  _vsRaf = true;
  requestAnimationFrame(() => { _vsRaf = false; _vsRender(); });
}

function _vsRender() {
  if (!_vsOuter || !_vsWrap) return;
  const scrollTop = _vsOuter.scrollTop;
  const viewH     = _vsOuter.clientHeight || 600;
  const total     = _vsData.length;
  const start     = Math.max(0, Math.floor(scrollTop / _VS_ROW_H) - _VS_BUF);
  const end       = Math.min(total, Math.ceil((scrollTop + viewH) / _VS_ROW_H) + _VS_BUF);

  _vsTop.style.height = `${start * _VS_ROW_H}px`;
  _vsBtm.style.height = `${(total - end) * _VS_ROW_H}px`;
  _vsWrap.innerHTML   = _vsData.slice(start, end).map(_renderDossierRow).join('');
}

// Rendu natif (toutes les lignes) — scroll fluide, hauteurs variables OK.
// Utilisé en-dessous du seuil de virtualisation (cf. renderDossiers).
function _vsRenderAll(list) {
  const outer = document.getElementById('dossierListContainer');
  if (!outer) return;
  outer.removeEventListener('scroll', _vsOnScroll); // au cas où un virtual-scroll tournait
  _vsOuter = null; _vsWrap = null;
  outer.className = 'dossier-list-wrap';
  outer.innerHTML = list.map(_renderDossierRow).join('');
}
// ────────────────────────────────────────────────────────────────────────────

function _renderDossierRow(d) {
  const _dotsRow = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
  const etape      = ETAPES_CONFIG.find(e => e.code === d.statut);
  const pct        = d.progression || 0;
  const isUrgent   = d.priorite === 'Urgente';
  const isHaute    = d.priorite === 'Haute';
  const prioColor  = isUrgent ? '#dc2626' : isHaute ? '#d97706' : '#d6d3d1';
  const pctColor   = pct === 100 ? '#16a34a' : pct > 0 ? '#e8834a' : '#d6d3d1';
  const isSelected = selectedDossier?.id === d.id;
  const etapeColor = etape?.color || 'var(--color-primary)';
  const etapeShort = etape?.short || 'Créé';

  const dTaches  = taches.filter(t => t.dossierId === d.id);
  const _clos    = _dossierClosed(d);
  const pipeDots = ETAPES_CONFIG.map(e => {
    const te = dTaches.filter(t => t.etapeCode === e.code);
    const s  = _clos ? 'done'
      : te.length === 0 ? 'vide'
      : te.every(t => t.statut === 'TERMINE') ? 'done'
      : te.some(t  => t.statut === 'EN_COURS') ? 'encours'
      : 'todo';
    const bg = s==='done'?'#16a34a':s==='encours'?'#d97706':s==='todo'?'#2563eb':'#e5e3df';
    return `<span class="dossier-row__pipedot" style="background:${bg}" title="${e.short}"></span>`;
  }).join('');

  const noteHtml = (function(){
    const src = d.sourceType==='reservation'
      ? reservations.find(r => String(r.id)===String(d.sourceId))
      : commandes.find(c => String(c.id)===String(d.sourceId));
    return src && src.notes
      ? `<div style="font-size:10px;color:#b45309;background:#fff8ed;border-radius:5px;padding:2px 6px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px" title="${src.notes.replace(/"/g,'&quot;')}">✏ ${src.notes}</div>`
      : '';
  })();

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
      ${noteHtml}
    </div>
    <div class="dossier-row__right">
      <div class="dossier-row__pipe">${pipeDots}</div>
      <div class="dossier-row__meta">
        <div class="dossier-row__bar"><div class="dossier-row__bar-fill" style="width:${pct}%;background:${pctColor}"></div></div>
        <span class="dossier-row__pct" style="color:${pctColor}">${pct}%</span>
      </div>
    </div>
    <div class="kebab-wrap dossier-row__kebab">
      <button class="kebab-btn" aria-label="Plus d'actions" aria-haspopup="true" onclick="toggleKebab('dos${d.id}',event)">${_dotsRow}</button>
      <div class="kebab-menu" id="kb-dos${d.id}" role="menu">
        <button class="kebab-item" role="menuitem" onclick="event.stopPropagation();closeAllKebabs();selectDossier('${d.id}')">${_kebabIcon('eye')}<span>Ouvrir / attribuer</span></button>
        <button class="kebab-item" role="menuitem" onclick="event.stopPropagation();closeAllKebabs();printDossier('${d.id}')">${_kebabIcon('print')}<span>Imprimer le dossier</span></button>
        ${['admin','chef_atelier'].includes(currentUser?.role) && !_dossierClosed(d) ? `<button class="kebab-item" role="menuitem" onclick="event.stopPropagation();closeAllKebabs();cloturerDossier('${d.id}')"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span>Clôturer le dossier</span></button>` : ''}
        ${['admin','chef_atelier'].includes(currentUser?.role) ? `<button class="kebab-item danger" role="menuitem" onclick="event.stopPropagation();closeAllKebabs();resetTachesDossier('${d.id}')">${_kebabIcon('reset')}<span>Réinitialiser les tâches</span></button>` : ''}
      </div>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
// COCKPIT ATTRIBUTION — même principe que Production/Commandes :
// tableau compact (une ligne = un dossier), toolbar sticky (filtres rapides
// + tri + densité), le panneau d'attribution à droite sert de détail.
// Emphase « À attribuer » (étape courante sans opérateur). Couleurs :
// rouge=retard, orange=proche échéance / à attribuer, bleu=en cours, vert=terminé.
// ════════════════════════════════════════════════════════════
let _attrFilter  = 'TOUS';  // TOUS|A_ATTRIBUER|EN_COURS|RETARD|TERMINE
let _attrSort    = { key:'echeance', dir:'asc' }; // echeance|retard|progression|client|priorite|etape
let _attrDensity = 'compact';
let _attrLimit   = 80;
const _ATTR_PAGE = 80;

function _buildAttrRow(d) {
  const dt = (Array.isArray(taches) ? taches : []).filter(t => t.dossierId === d.id);
  const clos = _dossierClosed(d); // clôture admin → 100 % même sans (ou avec partielle) attribution
  const pct = _dossierPct(dt, d);
  const isDone = clos || pct === 100;
  // Étape actuelle = statut serveur du dossier (avance via majProgressionDossier_)
  const curStep  = ETAPES_CONFIG.find(e => e.code === d.statut) || null;
  const curTasks = curStep ? dt.filter(t => t.etapeCode === curStep.code) : [];
  const assigned = [...new Set(curTasks.filter(t => t.statut !== 'TERMINE').map(t => t.operateur).filter(Boolean))];
  const needsAssign = !isDone && curTasks.length === 0;
  const taskRetard  = dt.some(t => _getTacheRetardInfo(t).isRetard);
  const ymd  = _toIsoDate(d.dateLivraisonProd || '');
  const days = ymd ? _daysUntil(ymd) : null;
  const deadlineLate = days != null && days < 0;
  const hasEnCours = dt.some(t => t.statut === 'EN_COURS');
  const prio = d.priorite || 'Normale';
  const prioRank = prio === 'Urgente' ? 0 : prio === 'Haute' ? 1 : 2;
  const etapeIdx = ETAPES_CONFIG.findIndex(e => e.code === d.statut);
  return {
    d, id: d.id, ref: d.numeroDossier || d.id, client: d.client || '—',
    produit: d.produit || '', quantite: d.quantite || '',
    priorite: prio, prioRank, curStep, assigned, needsAssign,
    pct, isDone, hasEnCours, taskRetard, ymd, days, deadlineLate,
    etapeIdx: etapeIdx < 0 ? 99 : etapeIdx,
  };
}

function _attrMatch(r, k) {
  if (k === 'TOUS')        return true;
  if (k === 'A_ATTRIBUER') return r.needsAssign;
  if (k === 'EN_COURS')    return !r.isDone && r.hasEnCours;
  if (k === 'RETARD')      return !r.isDone && (r.deadlineLate || r.taskRetard);
  if (k === 'TERMINE')     return r.isDone;
  return true;
}

function _attrSortRows(rows) {
  const { key, dir } = _attrSort;
  const sign = dir === 'desc' ? -1 : 1;
  const dk = r => r.days == null ? 1e9 : r.days;
  const cmp = ({
    echeance:    (a,b) => dk(a) - dk(b),
    retard:      (a,b) => dk(a) - dk(b),
    progression: (a,b) => a.pct - b.pct,
    client:      (a,b) => a.client.localeCompare(b.client,'fr'),
    priorite:    (a,b) => a.prioRank - b.prioRank,
    etape:       (a,b) => a.etapeIdx - b.etapeIdx,
  })[key] || (() => 0);
  return rows.sort((a,b) => (sign * cmp(a,b)) || (dk(a) - dk(b)));
}

function _renderAttrCockpit(list) {
  const container = document.getElementById('dossierListContainer');
  if (!container) return;
  const all = list.map(_buildAttrRow);
  const cnt = k => all.filter(r => _attrMatch(r, k)).length;
  const filtered = _attrSortRows(all.filter(r => _attrMatch(r, _attrFilter)));
  const page = filtered.slice(0, _attrLimit);

  const chips = [
    ['TOUS','Tous'], ['A_ATTRIBUER','À attribuer'], ['EN_COURS','En cours'], ['RETARD','En retard'], ['TERMINE','Terminés']
  ].map(([k,lbl]) => `<button class="pcok-chip ${_attrFilter===k?'pcok-chip--active':''} ${(k==='A_ATTRIBUER'||k==='RETARD')?'pcok-chip--warn':''}" onclick="_attrSetFilter('${k}')">${lbl}<span class="pcok-chip-n">${cnt(k)}</span></button>`).join('');
  const sortOpts = [
    ['echeance','Échéance'], ['retard','Retard'], ['progression','Progression'], ['client','Client'], ['priorite','Priorité'], ['etape','Étape']
  ].map(([k,l]) => `<option value="${k}" ${_attrSort.key===k?'selected':''}>Trier : ${l}</option>`).join('');
  const dirIcon = _attrSort.dir === 'asc' ? '↑' : '↓';
  const toolbar = `<div class="pcok-toolbar pcok-toolbar--attr">
    <div class="pcok-chips">${chips}</div>
    <div class="pcok-controls">
      <select class="select-input" onchange="_attrSetSort(this.value)" title="Trier">${sortOpts}</select>
      <button class="pcok-iconbtn" title="Sens du tri" onclick="_attrToggleSortDir()">${dirIcon}</button>
      <button class="pcok-iconbtn pcok-density" title="Vue compacte / détaillée" onclick="_attrToggleDensity()">${_attrDensity==='compact'?'Détaillé':'Compact'}</button>
    </div>
  </div>`;

  const count = `<div class="pcok-count">${filtered.length} dossier${filtered.length>1?'s':''}${_attrFilter!=='TOUS'?' · filtré':''}</div>`;
  const more = filtered.length > _attrLimit
    ? `<div class="pcok-more"><button onclick="_attrShowMore()">Afficher plus (${filtered.length - _attrLimit} restants)</button></div>` : '';
  const table = page.length ? `<div class="pcok-tablewrap"><table class="pcok-table"><thead>${_attrThead()}</thead><tbody>${page.map(_attrRow).join('')}</tbody></table></div>`
    : `<div class="pcok-empty"><p>Aucun dossier dans ce filtre</p></div>`;

  container.innerHTML = `<div class="pcok pcok--attr">${toolbar}${count}${table}${more}</div>`;
  _fitAttrLayout();
}

function _attrThead() {
  const det = _attrDensity === 'detaille';
  const th = (key, label) => {
    const active = key && _attrSort.key === key;
    const arrow = active ? (_attrSort.dir==='asc' ? ' ↑' : ' ↓') : '';
    return `<th class="pcok-th ${active?'pcok-th--active':''}" ${key?`onclick="_attrSetSort('${key}')" style="cursor:pointer"`:''}>${label}${arrow}</th>`;
  };
  return `<tr>
    ${th('priorite','!')}
    ${th('client','Réf / Client')}
    ${det ? th('', 'Produit') : ''}
    ${th('etape','Étape')}
    ${th('echeance','Échéance')}
    ${th('retard','Retard')}
    ${th('', 'Responsable')}
    ${th('progression','Prog.')}
    <th class="pcok-th"></th>
  </tr>`;
}

function _attrRow(r) {
  const det = _attrDensity === 'detaille';
  const prioC = r.priorite==='Urgente'?'#dc2626':r.priorite==='Haute'?'#d97706':'#d6d3d1';
  const prio = `<span class="pcok-prio" style="background:${prioC}" title="${r.priorite}"></span>`;
  const stC = r.curStep ? r.curStep.color : (r.isDone ? '#16a34a' : '#a8a29e');
  const stLbl = r.curStep ? (r.curStep.short || r.curStep.label) : (r.isDone ? 'Livré' : 'Créé');
  const stepChip = `<span class="pcok-step" style="color:${stC};background:${stC}15;border-color:${stC}55">${_pcokEsc(stLbl)}</span>`;
  const ech = r.ymd ? new Date(r.ymd+'T00:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) : '—';
  let retC='#78716c', retTxt='—';
  if (r.isDone)            { retC='#16a34a'; retTxt='Terminé'; }
  else if (r.days==null)  { retC = r.taskRetard?'#dc2626':'#a8a29e'; retTxt = r.taskRetard?'Retard':'—'; }
  else if (r.days<0)      { retC='#dc2626'; retTxt=`+${Math.abs(r.days)}j`; }
  else if (r.days===0)    { retC='#e8834a'; retTxt='Auj.'; }
  else if (r.days===1)    { retC='#e8834a'; retTxt='Demain'; }
  else if (r.days<=7)     { retC='#d97706'; retTxt=`${r.days}j`; }
  else                    { retC='#78716c'; retTxt=`${r.days}j`; }
  const retBadge = `<span class="pcok-ret" style="color:${retC};background:${retC}1a">${retTxt}</span>`;
  const resp = r.needsAssign
    ? '<span class="pcok-toassign">À attribuer</span>'
    : (r.assigned.length ? `${_pcokEsc(r.assigned[0])}${r.assigned.length>1?` <span class="pcok-muted">+${r.assigned.length-1}</span>`:''}` : (r.isDone ? '<span class="pcok-muted">—</span>' : '<span class="pcok-muted">—</span>'));
  const pctC = r.pct===100?'#16a34a':r.pct>0?'#e8834a':'#a8a29e';
  const prog = `<div class="pcok-prog"><div class="pcok-prog-bar"><div style="width:${r.pct}%;background:${pctC}"></div></div><span class="pcok-prog-n" style="color:${pctC}">${r.pct}%</span></div>`;
  const accent = r.isDone ? '' : r.needsAssign ? 'inset 3px 0 0 #e8834a' : (r.days!=null&&r.days<0) ? 'inset 3px 0 0 #dc2626' : r.hasEnCours ? 'inset 3px 0 0 #2563eb' : '';
  const sel = selectedDossier?.id === r.id ? 'pcok-row--sel' : '';
  const _dots = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
  const kebab = `<div class="kebab-wrap"><button class="kebab-btn" aria-label="Plus d'actions" onclick="toggleKebab('dos${r.id}',event)">${_dots}</button><div class="kebab-menu" id="kb-dos${r.id}" role="menu">
    <button class="kebab-item" role="menuitem" onclick="event.stopPropagation();closeAllKebabs();selectDossier('${r.id}')">${_kebabIcon('eye')}<span>Ouvrir / attribuer</span></button>
    <button class="kebab-item" role="menuitem" onclick="event.stopPropagation();closeAllKebabs();printDossier('${r.id}')">${_kebabIcon('print')}<span>Imprimer le dossier</span></button>
    ${['admin','chef_atelier'].includes(currentUser?.role) ? `<button class="kebab-item danger" role="menuitem" onclick="event.stopPropagation();closeAllKebabs();resetTachesDossier('${r.id}')">${_kebabIcon('reset')}<span>Réinitialiser les tâches</span></button>` : ''}
  </div></div>`;
  return `<tr class="pcok-row ${sel}" id="attrrow-${r.id}" ${accent?`style="box-shadow:${accent}"`:''} onclick="selectDossier('${r.id}')">
    <td class="pcok-td-prio">${prio}</td>
    <td class="pcok-td-client"><div class="pcok-client">${_pcokEsc(r.client)}</div><div class="pcok-ref">${_pcokEsc(r.ref)}</div></td>
    ${det ? `<td class="pcok-td-prod">${_pcokEsc(r.produit)||'<span class="pcok-muted">—</span>'}${r.quantite?` <span class="pcok-muted">× ${r.quantite}</span>`:''}</td>` : ''}
    <td class="pcok-td-step">${stepChip}</td>
    <td class="pcok-td-ech">${ech}</td>
    <td class="pcok-td-ret">${retBadge}</td>
    <td class="pcok-td-resp">${resp}</td>
    <td class="pcok-td-prog">${prog}</td>
    <td class="pcok-td-act" onclick="event.stopPropagation()">${kebab}</td>
  </tr>`;
}

// Surligne la ligne sélectionnée sans reconstruire toute la table (préserve le scroll)
function _attrSyncSelectedRow() {
  document.querySelectorAll('#dossierListContainer .pcok-row--sel').forEach(el => el.classList.remove('pcok-row--sel'));
  if (selectedDossier) {
    const el = document.getElementById('attrrow-' + selectedDossier.id);
    if (el) el.classList.add('pcok-row--sel');
  }
}

function _attrSetFilter(k){ _attrFilter = k; _attrLimit = _ATTR_PAGE; renderDossiers(); }
function _attrSetSort(k){
  if (_attrSort.key === k) _attrSort.dir = _attrSort.dir==='asc' ? 'desc' : 'asc';
  else { _attrSort.key = k; _attrSort.dir = (k==='client'||k==='etape') ? 'asc' : 'asc'; }
  renderDossiers();
}
function _attrToggleSortDir(){ _attrSort.dir = _attrSort.dir==='asc' ? 'desc' : 'asc'; renderDossiers(); }
function _attrToggleDensity(){ _attrDensity = _attrDensity==='compact' ? 'detaille' : 'compact'; renderDossiers(); }
function _attrShowMore(){ _attrLimit += _ATTR_PAGE; renderDossiers(); }

// Cloisonnement Attribution : la liste des dossiers visibles par l'utilisateur courant.
// admin / chef / commercial → tous ; opérateur → uniquement ceux où il a une tâche.
// Ajuste dynamiquement la hauteur des colonnes Attribution (liste + panneau) pour
// qu'elles remplissent EXACTEMENT l'espace disponible sous l'en-tête, quelle que
// soit la hauteur d'écran ou du bloc de filtres. Corrige le panneau d'attribution
// qui débordait sous le pli (offsets fixes calc(100vh - 96px) inadaptés).
function _fitAttrLayout() {
  const layout = document.getElementById('attrLayout');
  if (!layout || document.getElementById('page-attribution')?.classList.contains('active') === false) return;
  const left  = document.getElementById('attrLeft');
  const right = document.getElementById('attrRight');
  const panel = document.getElementById('attrPanel');
  // Mobile (<901px) : layout empilé → on retire toute hauteur forcée
  if (window.innerWidth < 901) {
    [left, right, panel].forEach(el => { if (el) { el.style.height = ''; el.style.maxHeight = ''; } });
    return;
  }
  const top = layout.getBoundingClientRect().top; // position réelle sous l'en-tête
  const h = Math.max(360, Math.round(window.innerHeight - top - 12));
  if (left)  left.style.height = h + 'px';
  if (right) { right.style.maxHeight = h + 'px'; right.style.height = h + 'px'; }
  if (panel) { panel.style.maxHeight = h + 'px'; panel.style.height = h + 'px'; }
}
let _fitAttrRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(_fitAttrRaf);
  _fitAttrRaf = requestAnimationFrame(_fitAttrLayout);
});

// ════════════════════════════════════════════════════════════
// BLOCAGES — pour chaque commande en retard : à QUELLE étape elle
// est coincée et QUI doit agir. Réutilise _buildAttrRow (source de
// vérité unique du pipeline) + les styles .pcok du cockpit Attribution.
// ════════════════════════════════════════════════════════════
// Responsable métier par étape (inverse de ROLE_ETAPE_MAP, lisible humain).
const _BLOC_ETAPE_RESP = {
  VALID_CMD:     'Commercial',
  PAO:           'PAO',
  RETOUR_CLIENT: 'Commercial / Client',
  MODIFICATIONS: 'PAO',
  VALID_CLIENT2: 'Commercial / Client',
  BAT:           'PAO / Prod / Finition',
  ACHAT:         'Acheteur',
  PRODUCTION:    'Machiniste / Opérateur',
  FINITION:      'Finition',
  LIVRE:         'Livreur',
};
// Étapes clôturées par une validation commerciale (bouton « ✓ Valider »).
const _BLOC_VALID_STEPS = { VALID_CMD: 1, RETOUR_CLIENT: 1, VALID_CLIENT2: 1 };

let _blocFilter = 'TOUS'; // TOUS | ECHEANCE | SLA | AATTRIBUER
let _blocSort   = 'retard'; // retard | echeance | etape

// Diagnostique la cause du blocage + l'action précise attendue.
function _buildBlocRow(r) {
  const dt   = (Array.isArray(taches) ? taches : []).filter(t => t.dossierId === r.id);
  const step = r.curStep;
  const curTasks = step ? dt.filter(t => t.etapeCode === step.code) : [];
  const enCours  = curTasks.filter(t => t.statut === 'EN_COURS');
  const aFaire   = curTasks.filter(t => t.statut === 'A_FAIRE');
  const isValid  = !!(step && _BLOC_VALID_STEPS[step.code]);
  const resp     = step ? (_BLOC_ETAPE_RESP[step.code] || '—') : '—';
  const lbl      = step ? (step.short || step.label) : '';

  let cause, action, sev; // sev : 3=critique 2=à faire 1=en cours
  if (!step) {
    cause  = 'Étape non déterminée';
    action = 'Ouvrir le dossier et vérifier le pipeline';
    sev = 2;
  } else if (r.needsAssign || curTasks.length === 0) {
    cause  = `« ${lbl} » non attribuée`;
    action = isValid
      ? `Le commercial doit prendre puis valider « ${lbl} »`
      : `Chef d'atelier : assigner « ${lbl} » à un ${resp}`;
    sev = 3;
  } else if (isValid) {
    cause  = `En attente de validation — « ${lbl} »`;
    action = `Commercial : cliquer « ✓ Valider » sur « ${lbl} » (Attribution)`;
    sev = 2;
  } else if (enCours.length) {
    cause  = r.taskRetard ? `« ${lbl} » en cours — délai dépassé` : `« ${lbl} » en cours`;
    action = `${resp} : terminer « ${lbl} » (bouton Terminer)`;
    sev = r.taskRetard ? 3 : 1;
  } else if (aFaire.length) {
    cause  = `« ${lbl} » assignée, pas démarrée`;
    action = `${resp} : démarrer puis terminer « ${lbl} »`;
    sev = 2;
  } else {
    cause  = `« ${lbl} » terminée, dossier non avancé`;
    action = `Chef d'atelier : faire avancer le dossier à l'étape suivante`;
    sev = 2;
  }
  const who = r.assigned && r.assigned.length ? r.assigned.join(', ')
    : (r.needsAssign ? 'À attribuer' : resp);
  return { ...r, cause, action, resp, who, sev };
}

function _blocMatch(r, k) {
  if (k === 'TOUS')       return true;
  if (k === 'ECHEANCE')   return r.deadlineLate;
  if (k === 'SLA')        return r.taskRetard;
  if (k === 'AATTRIBUER') return r.needsAssign;
  return true;
}

function _blocSortRows(rows) {
  const dk = r => r.days == null ? 1e9 : r.days; // plus négatif = plus en retard → en tête
  const cmp = {
    retard:   (a, b) => (dk(a) - dk(b)) || (b.sev - a.sev),
    echeance: (a, b) => dk(a) - dk(b),
    etape:    (a, b) => a.etapeIdx - b.etapeIdx,
  }[_blocSort] || (() => 0);
  return rows.slice().sort(cmp);
}

function renderBlocages() {
  const container = document.getElementById('blocagesContainer');
  if (!container) return;
  const base = (Array.isArray(dossiers) ? dossiers : [])
    .map(_buildAttrRow)
    .map(_buildBlocRow)
    // Un blocage = dossier non terminé ET (échéance dépassée OU délai interne dépassé OU non attribué)
    .filter(r => !r.isDone && (r.deadlineLate || r.taskRetard || r.needsAssign));

  const cnt = k => base.filter(r => _blocMatch(r, k)).length;
  const rows = _blocSortRows(base.filter(r => _blocMatch(r, _blocFilter)));

  // Cartes de synthèse
  const cards = [
    ['Total blocages', base.length, '#dc2626'],
    ['Échéance dépassée', cnt('ECHEANCE'), '#dc2626'],
    ['Délai interne dépassé', cnt('SLA'), '#d97706'],
    ['À attribuer', cnt('AATTRIBUER'), '#e8834a'],
  ].map(([lbl, n, c]) => `<div class="bloc-card"><div class="bloc-card-n" style="color:${c}">${n}</div><div class="bloc-card-l">${lbl}</div></div>`).join('');

  const chips = [
    ['TOUS', 'Tous'], ['ECHEANCE', 'Échéance dépassée'], ['SLA', 'Délai interne'], ['AATTRIBUER', 'À attribuer'],
  ].map(([k, l]) => `<button class="pcok-chip ${_blocFilter === k ? 'pcok-chip--active' : ''} ${k !== 'TOUS' ? 'pcok-chip--warn' : ''}" onclick="_blocSetFilter('${k}')">${l}<span class="pcok-chip-n">${cnt(k)}</span></button>`).join('');
  const sortOpts = [['retard', 'Retard'], ['echeance', 'Échéance'], ['etape', 'Étape']]
    .map(([k, l]) => `<option value="${k}" ${_blocSort === k ? 'selected' : ''}>Trier : ${l}</option>`).join('');

  const toolbar = `<div class="pcok-toolbar">
    <div class="pcok-chips">${chips}</div>
    <div class="pcok-controls">
      <select class="select-input" onchange="_blocSetSort(this.value)" title="Trier">${sortOpts}</select>
      <button class="pcok-iconbtn" title="Rafraîchir" onclick="refreshBlocages()">⟳</button>
    </div>
  </div>`;

  const body = rows.length ? rows.map(r => {
    const prioC = r.priorite === 'Urgente' ? '#dc2626' : r.priorite === 'Haute' ? '#d97706' : '#d6d3d1';
    const stC   = r.curStep ? r.curStep.color : '#a8a29e';
    const stLbl = r.curStep ? (r.curStep.short || r.curStep.label) : 'Créé';
    const ech   = r.ymd ? new Date(r.ymd + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—';
    let retC = '#78716c', retTxt = '—';
    if (r.days == null)   { retC = r.taskRetard ? '#d97706' : '#a8a29e'; retTxt = r.taskRetard ? 'Délai' : '—'; }
    else if (r.days < 0)  { retC = '#dc2626'; retTxt = `+${Math.abs(r.days)}j`; }
    else if (r.days === 0){ retC = '#e8834a'; retTxt = 'Auj.'; }
    else if (r.days === 1){ retC = '#e8834a'; retTxt = 'Demain'; }
    else                  { retC = '#d97706'; retTxt = `${r.days}j`; }
    const sevC = r.sev === 3 ? '#dc2626' : r.sev === 2 ? '#d97706' : '#2563eb';
    return `<tr class="pcok-row" style="box-shadow:inset 3px 0 0 ${sevC}" onclick="openAttribForDossier('${r.id}')">
      <td class="pcok-td-prio"><span class="pcok-prio" style="background:${prioC}" title="${r.priorite}"></span></td>
      <td class="pcok-td-client"><div class="pcok-client">${_pcokEsc(r.client)}</div><div class="pcok-ref">${_pcokEsc(r.ref)}</div></td>
      <td class="pcok-td-ech">${ech}</td>
      <td class="pcok-td-ret"><span class="pcok-ret" style="color:${retC};background:${retC}1a">${retTxt}</span></td>
      <td class="pcok-td-step"><span class="pcok-step" style="color:${stC};background:${stC}15;border-color:${stC}55">${_pcokEsc(stLbl)}</span></td>
      <td class="bloc-td-cause">${_pcokEsc(r.cause)}</td>
      <td class="bloc-td-who">${_pcokEsc(r.who)}</td>
      <td class="bloc-td-action"><span class="bloc-action" style="border-color:${sevC};color:${sevC}">${_pcokEsc(r.action)}</span></td>
    </tr>`;
  }).join('') : '';

  const table = rows.length ? `<div class="pcok-tablewrap"><table class="pcok-table"><thead><tr>
    <th class="pcok-th">!</th>
    <th class="pcok-th">Réf / Client</th>
    <th class="pcok-th">Échéance</th>
    <th class="pcok-th">Retard</th>
    <th class="pcok-th">Étape bloquée</th>
    <th class="pcok-th">Cause</th>
    <th class="pcok-th">Qui doit agir</th>
    <th class="pcok-th">Action à faire</th>
  </tr></thead><tbody>${body}</tbody></table></div>`
    : `<div class="pcok-empty"><p>🎉 Aucune commande bloquée — tout le pipeline est à jour.</p></div>`;

  const count = `<div class="pcok-count">${rows.length} commande${rows.length > 1 ? 's' : ''} bloquée${rows.length > 1 ? 's' : ''}${_blocFilter !== 'TOUS' ? ' · filtré' : ''} · cliquez une ligne pour ouvrir le dossier</div>`;
  container.innerHTML = `<div class="bloc-cards">${cards}</div><div class="pcok">${toolbar}${count}${table}</div>`;
}

function _blocSetFilter(k) { _blocFilter = k; renderBlocages(); }
function _blocSetSort(v)   { _blocSort = v; renderBlocages(); }
function refreshBlocages() {
  if (APPS_SCRIPT_URL) {
    Promise.all([loadDossiers(), _loadTachesQuietly()]).then(renderBlocages).catch(() => renderBlocages());
  } else {
    renderBlocages();
  }
}

function _attribVisibleDossiers() {
  if (_canSeeAllOps()) return dossiers;
  const my = _myOpLabel();
  return dossiers.filter(d => taches.some(t => t.dossierId === d.id && _sameOp(t.operateur, my)));
}

function renderDossiers() {
  const container = document.getElementById('dossierListContainer');
  if (!container) return;
  _syncDossierDates();

  // Mettre à jour les tabs avec les compteurs
  _renderDossierTabs();

  // Peupler le sélecteur d'années depuis les dossiers existants
  _populateYearSel('attrYearSel', dossiers.map(d => d.dateCreation));

  // Filtre recherche client-side
  const search = (document.getElementById('dossierSearchInput')?.value || '').toLowerCase().trim();
  // Cloisonnement : un opérateur ne voit que les dossiers où il a une tâche assignée
  let list = _attribVisibleDossiers();
  if (search) {
    list = list.filter(d =>
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
  if (_dossierView === 'card') {
    container.className = '';
    container.innerHTML = _renderDossierCardGrid(list);
    return;
  }

  // Vue liste = COCKPIT : tableau compact de dossiers (même principe que
  // Production/Commandes) + toolbar sticky. Le panneau d'attribution à droite
  // sert de détail. Pagination (au lieu du virtual-scroll : lignes de table).
  container.className = '';
  _renderAttrCockpit(list);
}

function _renderDossierTabs() {
  const el = document.getElementById('dossierStatusTabs');
  if (!el) return;
  const selVal = document.getElementById('dossierFilterSel')?.value || 'TOUS';
  // Onglets de filtre = ordre du pipeline (cf. ETAPES_CONFIG). On filtre sur d.statut
  // (qui avance via majProgressionDossier_ backend). LIVRE volontairement absent (vue Terminés).
  const tabDefs = [
    { val:'TOUS',          label:'Tous' },
    { val:'CREE',          label:'Créés' },
    { val:'VALID_CMD',     label:'Valid. cmd' },
    { val:'PAO',           label:'PAO' },
    { val:'RETOUR_CLIENT', label:'Valid. 1' },
    { val:'MODIFICATIONS', label:'Modifs' },
    { val:'VALID_CLIENT2', label:'Valid. 2' },
    { val:'BAT',           label:'BAT' },
    { val:'ACHAT',         label:'Achat' },
    { val:'PRODUCTION',    label:'Production' },
    { val:'FINITION',      label:'Finition' },
  ];
  const _visibles = _attribVisibleDossiers();
  const counts = {};
  _visibles.forEach(d => { counts[d.statut] = (counts[d.statut]||0)+1; });
  el.innerHTML = tabDefs.map(t => {
    const count  = t.val === 'TOUS' ? _visibles.length : (counts[t.val] || 0);
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
      // Cloisonnement : un opérateur ne voit que son propre nom sous les étapes
      const ops = (_canSeeAllOps() ? te : te.filter(t => _sameOp(t.operateur, _myOpLabel()))).map(t => t.operateur).join(',');
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
      const _iso   = _toIsoDate(d.dateLivraison);
      const dlDate = new Date(_iso + 'T00:00:00');
      const today  = new Date(); today.setHours(0,0,0,0);
      const diff   = Math.round((dlDate - today) / 86400000);
      const isLate = diff < 0;
      const txt    = isLate
        ? `${Math.abs(diff)}j de retard`
        : diff === 0 ? 'Aujourd\'hui !'
        : `${diff}j restants`;
      const _disp  = isNaN(dlDate.getTime()) ? d.dateLivraison : dlDate.toLocaleDateString('fr-FR');
      dateHtml = `<span class="dossier-card-v2__date ${isLate?'dossier-card-v2__date--late':''}">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${_disp} · ${txt}
      </span>`;
    } else {
      dateHtml = `<span class="dossier-card-v2__date">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${_cleanDate(d.dateCreation) || '—'}
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
  // Mise à jour légère : surligner la ligne sélectionnée sans tout re-rendre
  if (_dossierView === 'card') renderDossiers(); else _attrSyncSelectedRow();
  // Mobile : masquer la liste, afficher le panneau détail
  document.querySelector('.attr-layout')?.classList.add('dossier-selected');

  // ── 1. Affichage IMMÉDIAT depuis les données locales (zéro délai) ──
  const localTaches   = taches.filter(t => t.dossierId === id);
  const localComments = dossierComments.filter(c => c.dossierId === id)
    .sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
  renderAttrPanel(localTaches, localComments);
  _fitAttrLayout();

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
        ? `<div style="margin-top:10px;padding:10px 12px;background:#fff8ed;border-radius:9px;border:1.5px solid #f5a623;position:relative">
             <div style="display:flex;align-items:center;gap:5px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#b45309;margin-bottom:5px">
               <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
               Briefing client
             </div>
             <div style="font-size:12.5px;color:#1c1917;line-height:1.55;white-space:pre-wrap">${src.notes}</div>
           </div>`
        : '';

      // Pièces jointes du dossier = pièces Drive (src.attachments, visibles par tous)
      // + photos base64 locales legacy/en attente d'upload (src.photos).
      const attachList = [
        ...(src.attachments || []),
        ...((src.photos || []).map((p, pi) => {
          if (typeof p === 'string') return { name: 'Photo ' + (pi + 1), type: 'image/jpeg', data: p };
          return { name: (p && p.name) || ('Photo ' + (pi + 1)), type: (p && p.type) || '', data: (p && (p.data || p.url)) || '' };
        }).filter(a => a.data))
      ];
      const attachRow = attachList.length
        ? `<details class="attr-files">
             <summary>
               <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
               Pièces jointes (${attachList.length})
               <svg class="attr-files__chev" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
             </summary>
             <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
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
           </details>`
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

  // Commercial créateur du dossier (depuis la commande/réservation source)
  const _src = (d.sourceType && d.sourceId)
    ? (d.sourceType === 'reservation'
        ? reservations.find(r => String(r.id) === String(d.sourceId))
        : commandes.find(c => String(c.id) === String(d.sourceId)))
    : null;
  const _commercial = _resolveOperatorLabel((_src && _src.caissier) || d.caissier || '');

  panel.innerHTML = `
    <div class="attr-panel-header">
      <button class="btn-back-dossier" onclick="backToDossierList()" style="display:none;align-items:center;gap:4px;padding:5px 10px;border-radius:7px;background:var(--color-primary-light);color:var(--color-primary);border:1px solid rgba(26,74,58,.2);cursor:pointer;font-size:12px;font-weight:600;margin-bottom:10px">
        ← Retour
      </button>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div class="attr-panel-dossier-meta">
          <span>${d.numeroDossier}</span>
          ${d.sourceVente?`<span>·</span><span>${d.sourceVente}</span>`:''}
          ${_cleanDate(d.dateCreation)?`<span>·</span><span>${_cleanDate(d.dateCreation)}</span>`:''}
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button onclick="printDossier('${d.id}')" title="Imprimer le dossier"
            style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:7px;background:var(--color-primary);color:#fff;border:none;cursor:pointer;font-size:11px;font-weight:600;flex-shrink:0">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Imprimer
          </button>
          ${['admin','chef_atelier'].includes(currentUser?.role) ? `<div class="kebab-wrap">
            <button class="kebab-btn" aria-label="Plus d'actions" aria-haspopup="true" onclick="toggleKebab('attrh${d.id}',event)"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>
            <div class="kebab-menu" id="kb-attrh${d.id}" role="menu">
              ${!_dossierClosed(d) ? `<button class="kebab-item" role="menuitem" onclick="closeAllKebabs();cloturerDossier('${d.id}')"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span>Clôturer le dossier</span></button>` : ''}
              <button class="kebab-item danger" role="menuitem" onclick="closeAllKebabs();resetTachesDossier('${d.id}')">${_kebabIcon('reset')}<span>Réinitialiser les tâches</span></button>
            </div>
          </div>` : ''}
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
      ${_commercial ? `<div style="margin-top:8px;display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:9px;background:var(--color-primary-light);border:1px solid rgba(26,74,58,.2)">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#1a4a3a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <span style="font-size:11px;color:var(--color-text-secondary)">Commercial : <strong style="color:#1a4a3a;font-weight:700">${_commercial}</strong></span>
      </div>` : ''}
      <div class="attr-date-chips">${(() => { const _bat = _toIsoDate(d.dateBAT); return _bat ? `<div style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:9px;background:#eaf1fb;border:1px solid rgba(37,99,235,.3)">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>
        <span style="font-size:12px;font-weight:700;color:#1d4ed8">BAT : ${new Date(_bat+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'short'})}</span>
        ${(()=>{const dd=_daysUntil(_bat);return dd==null?'':`<span style="font-size:11px;font-weight:800;color:${dd<0?'#dc2626':dd<=2?'#e8834a':'#1a4a3a'}">${dd<0?Math.abs(dd)+'j de retard':dd===0?"aujourd'hui":dd===1?'demain':dd+'j restants'}</span>`;})()}
      </div>` : ''; })()}
      ${(() => { const _ldc = _toIsoDate(d.dateLivraison); return _ldc ? `<div style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:9px;background:#e8f4f0;border:1px solid rgba(26,74,58,.25)">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#1a4a3a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span style="font-size:12px;font-weight:700;color:#1a4a3a">Livraison client : ${new Date(_ldc+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'short'})}</span>
        ${(()=>{const dd=_daysUntil(_ldc);return dd==null?'':`<span style="font-size:11px;font-weight:800;color:${dd<0?'#dc2626':dd<=2?'#e8834a':'#1a4a3a'}">${dd<0?Math.abs(dd)+'j de retard':dd===0?"aujourd'hui":dd===1?'demain':dd+'j restants'}</span>`;})()}
      </div>` : ''; })()}
      ${(() => { const _prd = _toIsoDate(d.dateLivraisonProd); return _prd ? `<div style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:9px;background:#fff0e6;border:1px solid rgba(232,131,74,.3)">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#e8834a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
        <span style="font-size:12px;font-weight:700;color:#c2410c">Livraison production : ${new Date(_prd+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'short'})}</span>
        ${(()=>{const dd=_daysUntil(_prd);return dd==null?'':`<span style="font-size:11px;font-weight:800;color:${dd<0?'#dc2626':dd<=2?'#e8834a':'#1a4a3a'}">${dd<0?Math.abs(dd)+'j de retard':dd===0?"aujourd'hui":dd===1?'demain':dd+'j restants'}</span>`;})()}
      </div>` : ''; })()}</div>
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
      // Dossier clôturé (clôture admin) → toutes les étapes sont complètes, même non attribuées.
      const dossierClos = _dossierClosed(d);
      const etapeComplete = dossierClos || (tachesEtape.length > 0 && tachesEtape.every(t => t.statut === 'TERMINE'));
      const alreadySelfAssigned = tachesEtape.some(t => _sameOp(t.operateur, currentUser?.label));
      // Étapes qu'un rôle peut s'auto-assigner (le BAT physique = PAO+prod+finition,
      // donc partagé par ces 3 rôles). Un rôle peut couvrir plusieurs étapes du flux.
      const ROLE_ETAPE_MAP = {
        commerciale:    ['VALID_CMD','RETOUR_CLIENT','VALID_CLIENT2'],
        pao:            ['PAO','MODIFICATIONS','BAT'],
        operateur_prod: ['PRODUCTION','BAT'],
        machiniste:     ['PRODUCTION','BAT'],
        finition:       ['FINITION','BAT'],
        livreur:        ['LIVRE'],
      };
      const userEtapes = ROLE_ETAPE_MAP[currentUser_role] || [];
      const canSelfAssign = !canAssign && !etapeComplete && !alreadySelfAssigned && userEtapes.includes(e.code);
      // Le commercial valide ses propres étapes (VALID_CMD / RETOUR_CLIENT /
      // VALID_CLIENT2) directement depuis l'Attribution : il n'a pas la vue
      // opérateur (il est routé vers le cockpit lecture seule en Production) et
      // resterait donc bloqué « Assigné » sans pouvoir terminer l'étape.
      const myTaskEtape   = tachesEtape.find(t => _sameOp(t.operateur, currentUser?.label));
      const canSelfComplete = alreadySelfAssigned && !etapeComplete
        && currentUser_role === 'commerciale' && userEtapes.includes(e.code);
      // Cloisonnement : un opérateur ne voit que son propre nom ; le travail des
      // collègues garde son badge de statut (utile pour le déblocage) mais sans nom.
      const _seeAllOps = _canSeeAllOps();
      const operateursHtml = tachesEtape.length
        ? tachesEtape.map(t => {
            const badge = t.statut==='TERMINE'
              ? `<span class="prod-badge" style="background:var(--color-success-bg);color:var(--color-success)">Terminé</span>`
              : t.statut==='EN_COURS'
              ? `<span class="prod-badge" style="background:var(--color-warning-bg);color:var(--color-warning)">En cours</span>`
              : `<span class="prod-badge" style="background:var(--color-info-bg);color:var(--color-info)">Assigné</span>`;
            const _name = (_seeAllOps || _sameOp(t.operateur, currentUser?.label)) ? t.operateur : 'Opérateur';
            return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:6px;margin-bottom:2px">${_name} ${badge}</span>`;
          }).join('')
        : (dossierClos
            ? '<em style="color:var(--color-success)">Clôturé (sans attribution)</em>'
            : '<em style="color:var(--color-text-muted)">Non assigné</em>');
      const etapeIcon = etapeComplete
        ? `<span style="font-size:10px;font-weight:700;color:var(--color-success);background:var(--color-success-bg);padding:2px 8px;border-radius:20px;margin-left:6px"> Étape complète</span>`
        : '';
      return `<div class="etape-row-attr">
        <div style="width:18px;height:18px;border-radius:50%;background:${etapeComplete?'#16a34a':e.color}18;border:1.5px solid ${etapeComplete?'#16a34a':e.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:9px;font-weight:700;color:${etapeComplete?'#16a34a':e.color}">${etapeComplete?'✓':e.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">
            <span style="font-size:12px;font-weight:600;color:var(--color-text-primary)">${e.label}</span>
            ${etapeIcon}
          </div>
          <div style="font-size:11px;color:var(--color-text-secondary);margin-top:1px;display:flex;flex-wrap:wrap;gap:2px">
            ${operateursHtml}
          </div>
        </div>
        ${dossierClos
          ? ''
          : canAssign
          ? `<button class="btn-attr-assign" onclick="openAttrib('${e.code}','${e.label}')">Assigner</button>`
          : canSelfAssign
          ? `<button class="btn-attr-assign" style="background:var(--color-secondary);border-color:var(--color-secondary)" onclick="selfAssign('${e.code}','${e.label}')">Je m'assigne</button>`
          : canSelfComplete
          ? `<button class="btn-attr-assign" style="background:#16a34a;border-color:#16a34a" onclick="attrValiderEtape('${e.code}','${(e.label||'').replace(/'/g,"\\'")}')">✓ Valider</button>`
          : alreadySelfAssigned && !etapeComplete
          ? `<span style="font-size:11px;font-weight:600;color:var(--color-secondary);padding:4px 10px;background:var(--color-secondary-light);border-radius:6px"> Assigné</span>`
          : ''}
      </div>`;
    }).join('')}
      </div>
      <div style="padding:14px 0 2px;border-top:1px solid var(--color-border);margin-top:12px">
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
        <div id="commentsList"></div>
      </div>
    </div>
    <div class="attr-panel-footer">
      <div style="position:relative">
        <textarea id="commentTextarea" onkeyup="handleCommentMention(event)"
          placeholder="Ajouter une note… tapez @ pour mentionner un utilisateur"
          style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:8px;font-size:13px;resize:vertical;min-height:48px;box-sizing:border-box;font-family:inherit;color:var(--color-text-primary);background:var(--color-surface)"
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
        <input id="commentAttachInput" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" multiple style="display:none" onchange="addCommentAttachment(this.files)" />
        <div style="flex:1"></div>
        <button onclick="submitComment('${d.id}')"
          style="display:inline-flex;align-items:center;gap:5px;padding:7px 16px;background:var(--color-primary);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Envoyer
        </button>
      </div>
    </div>
  `;
  // Initialiser le fil de commentaires (le footer de saisie est déjà rendu ci-dessus)
  commentAttachments = [];
  renderCommentsSection(d.id, commentsD);
}

function printDossier(dossierId) {
  _ensureDossierLinks();
  // Normaliser la référence (CMD-001…) AVANT l'impression : sinon la fiche pouvait afficher
  // l'ancienne réf date/uid alors que l'Attribution montrait déjà la réf séquentielle.
  if (typeof _syncDossierDates === 'function') _syncDossierDates();
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
    // Cloisonnement : impression côté opérateur n'affiche que son nom
    const ops = (_canSeeAllOps() ? te : te.filter(t => _sameOp(t.operateur, _myOpLabel()))).map(t => t.operateur).join(', ') || '—';
    return `
      <tr>
        <td style="padding:7px 10px;border-bottom:1px solid #e5e3df;font-size:11pt;font-weight:600;color:#1c1917">${e.label}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e5e3df;font-size:10pt;color:#78716c">${ops}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e5e3df;text-align:center">
          <span style="background:${statusBg};color:${statusColor};font-size:9pt;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap">${statusLabel}</span>
        </td>
      </tr>`;
  }).join('');

  // ── Images et pièces jointes (formulaire + commentaires du dossier)
  const attachments = src?.attachments || [];
  const photos = src?.photos || [];
  // Pièces jointes du fil de discussion du dossier
  const commentAtts = dossierComments
    .filter(c => c.dossierId === d.id)
    .flatMap(c => (c.attachments || []).map(a => ({ ...a, _author: c.author })));
  const commentImgs    = commentAtts.filter(a => (a.type || '').startsWith('image/'));
  const commentNonImgs = commentAtts.filter(a => !(a.type || '').startsWith('image/'));

  const allImages = [
    ...attachments.filter(a => (a.type || '').startsWith('image/')).map(a => ({ src: _driveImgSrc(a) || a.data || '', name: a.name })),
    ...photos.filter(p => p.data || p.url).map(p => ({ src: p.data || p.url || '', name: p.name || 'Photo' })),
    ...commentImgs.map(a => ({ src: _driveImgSrc(a) || a.data || '', name: (a._author ? a._author + ' — ' : '') + (a.name || 'Image') }))
  ].filter(img => img.src);
  const nonImageAttach = [
    ...attachments.filter(a => !(a.type || '').startsWith('image/')),
    ...commentNonImgs.map(a => ({ ...a, name: (a._author ? a._author + ' — ' : '') + (a.name || 'Fichier') }))
  ];

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
        <div style="font-size:9pt;color:#78716c;margin-top:2px">Créé le ${_cleanDate(d.dateCreation) || '—'}</div>
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
        ${d.dateBAT ? `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #e5e3df"><div style="font-size:9pt;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:.06em">BAT (épreuve)</div><div style="font-size:13pt;font-weight:800;color:#1d4ed8;margin-top:2px">${new Date(d.dateBAT+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</div></div>` : ''}
        ${d.dateLivraisonProd ? `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #e5e3df"><div style="font-size:9pt;font-weight:700;color:#e8834a;text-transform:uppercase;letter-spacing:.06em">Livraison production</div><div style="font-size:13pt;font-weight:800;color:#c2410c;margin-top:2px">${new Date(d.dateLivraisonProd+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</div></div>` : ''}
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
  // Attendre le chargement de TOUTES les images (Drive) avant d'imprimer
  const _doPrint = () => { try { w.focus(); w.print(); } catch(e) {} };
  if (allImages.length) {
    const imgs = Array.from(w.document.images || []);
    let pending = imgs.length;
    if (!pending) { setTimeout(_doPrint, 300); return; }
    let printed = false;
    const done = () => { if (printed) return; if (--pending <= 0) { printed = true; _doPrint(); } };
    imgs.forEach(im => {
      if (im.complete) { done(); }
      else { im.addEventListener('load', done); im.addEventListener('error', done); }
    });
    // Sécurité : imprimer quand même après 5s max si une image bloque
    setTimeout(() => { if (!printed) { printed = true; _doPrint(); } }, 5000);
  } else {
    setTimeout(_doPrint, 400);
  }
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

// Équipe par défaut selon l'heure : Nuit de 18h à 6h, Jour sinon.
function _defaultShift() {
  const h = new Date().getHours();
  return (h >= 18 || h < 6) ? 'Nuit' : 'Jour';
}

function openAttrib(etapeCode, etapeLabel) {
  if (!selectedDossier) return;
  pendingAttrib = { etapeCode, etapeLabel };
  document.getElementById('attribContextText').textContent = `${selectedDossier.numeroDossier} — ${etapeLabel}`;
  document.getElementById('attribComment').value = '';
  // Présélection de l'équipe selon l'heure courante (l'admin peut changer).
  const _shift = _defaultShift();
  document.querySelectorAll('#attribShiftSel input[name=attribShift]').forEach(r => { r.checked = (r.value === _shift); });
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
  const shift = document.querySelector('#attribShiftSel input[name=attribShift]:checked')?.value || _defaultShift();
  let allOk = true;
  for (const cb of checked) {
    const payload = {
      action: 'attribuerTache',
      dossierId: selectedDossier.id,
      numeroDossier: selectedDossier.numeroDossier,
      etapeCode: pendingAttrib.etapeCode,
      operateur: cb.value,
      commentaire,
      assignePar,
      shift
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
          shift,
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
    assignePar:    currentUser.username,
    shift:         _defaultShift()
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
        shift:           payload.shift,
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

// Valide (= termine) une étape de validation commerciale directement depuis le
// panneau Attribution. Le commercial n'ayant pas la vue opérateur (bouton
// Démarrer/Terminer), c'est ici qu'il boucle son étape. On pointe côté serveur
// (action END, qui met à jour la progression du dossier) puis on rafraîchit.
async function attrValiderEtape(etapeCode, etapeLabel) {
  if (!selectedDossier || !currentUser) return;
  const myLabel = currentUser.label || currentUser.username;
  const t = taches.find(x =>
    x.dossierId === selectedDossier.id &&
    x.etapeCode === etapeCode &&
    _sameOp(x.operateur, myLabel)
  );
  if (!t) { showToast('Tâche introuvable — assignez-vous d\'abord à l\'étape', 'error'); return; }
  if (t.statut === 'TERMINE') { showToast('Étape déjà validée', 'info'); return; }
  // Garde : toutes les étapes précédentes du dossier doivent être terminées
  const si = ETAPES_CONFIG.findIndex(e => e.code === etapeCode);
  for (let i = 0; i < si; i++) {
    const prev = ETAPES_CONFIG[i];
    const pt = taches.filter(x => x.dossierId === selectedDossier.id && x.etapeCode === prev.code);
    if (pt.length && !pt.every(x => x.statut === 'TERMINE')) {
      showToast(`Impossible de valider : "${prev.label}" n'est pas encore terminée.`, 'error');
      return;
    }
  }
  let r;
  if (APPS_SCRIPT_URL) {
    r = await apiCall({ action:'pointerAction', tacheId:t.id, action_:'END', etapeCode, operateur:myLabel, commentaire:'' });
  } else {
    r = { ok:true };
  }
  if (r && r.ok) {
    if (!t.dateDebut) { t.dateDebut = new Date().toLocaleString('fr-FR'); t.startTs = Date.now(); }
    t.statut = 'TERMINE';
    t.dateFin = new Date().toLocaleString('fr-FR');
    t.endTs = Date.now();
    saveTaches();
    _addNotification({
      dossierId:     selectedDossier.id,
      numeroDossier: selectedDossier.numeroDossier,
      etapeCode,
      etapeLabel,
      operateur:     myLabel,
      message:       `${myLabel} a validé l'étape "${etapeLabel}" — ${selectedDossier.numeroDossier}`
    });
    showToast(`✓ "${etapeLabel}" validée`);
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

// ════════════════════════════════════════════════════════════
// RAFRAÎCHISSEMENT LIVE de la page active (Attribution / Production)
// Branché sur le polling 30s → les nouvelles attributions (dossiers,
// étapes assignées, progression) apparaissent sans action manuelle.
// Silencieux (pas de loader), préserve le scroll, ne re-rend que si
// quelque chose a réellement changé (signature) pour ne pas perturber.
// ════════════════════════════════════════════════════════════
let _lastLiveRefresh = 0;
let _liveSig = '';

function _liveSig_() {
  const dPart = dossiers.map(d => d.id+'|'+d.statut+'|'+(d.progression||0)+'|'+(d.priorite||'')).join(',');
  const tPart = taches.map(t => t.id+'|'+(t.etapeCode||'')+'|'+(t.statut||'')+'|'+(t.operateur||'')).join(',');
  return dPart + '##' + tPart;
}

async function _autoRefreshActivePage() {
  const onCal  = document.getElementById('page-calendrier')?.classList.contains('active');
  const onAttr = document.getElementById('page-attribution')?.classList.contains('active');
  const onProd = document.getElementById('page-production')?.classList.contains('active');
  if (!onCal && !onAttr && !onProd) return;
  if (!APPS_SCRIPT_URL) return;
  const now = Date.now();
  if (now - _lastLiveRefresh < 20000) return;
  _lastLiveRefresh = now;
  // Calendrier : recharge commandes + réservations (source des événements) puis
  // re-rend. renderCalendrier ne remplace que les grilles (#calMonthProd/#calMonthClient)
  // → le mois affiché (_calRef), les filtres, les jours dépliés et le drawer sont préservés.
  if (onCal) {
    try {
      await Promise.all([loadCommandesFromScript(), loadReservationsFromScript()]);
      _ensureDossierLinks();
      renderCalendrier();
    } catch(e) { /* silencieux — on garde les données locales */ }
    return;
  }
  try {
    const filter = document.getElementById('dossierFilterSel')?.value || 'TOUS';
    const [rD, rT] = await Promise.all([
      apiCall({ action:'getDossiers', statut: filter }),
      apiCall({ action:'getTaches' }),
    ]);
    // Fusionner les tâches serveur avec les tâches locales non encore synchronisées
    if (rT && rT.ok && Array.isArray(rT.taches)) {
      const backendIds = new Set(rT.taches.map(t => t.id));
      const localOnly  = taches.filter(t => !backendIds.has(t.id));
      taches = [...rT.taches, ...localOnly];
      saveTaches();
    }
    if (rD && rD.ok && Array.isArray(rD.dossiers)) dossiers = rD.dossiers;
    _ensureDossierLinks();
    _purgeOrphanTaches();

    const sig = _liveSig_();
    if (sig === _liveSig) return; // rien de neuf → on ne touche pas au DOM
    _liveSig = sig;

    if (document.getElementById('page-attribution')?.classList.contains('active')) {
      const cont = document.getElementById('dossierListContainer');
      const st = cont ? cont.scrollTop : 0;
      renderDossiers();
      const cont2 = document.getElementById('dossierListContainer');
      if (cont2) cont2.scrollTop = st; // préserve la position de défilement
      // Rafraîchir le panneau si un dossier est sélectionné
      if (selectedDossier) {
        const still = dossiers.find(d => d.id === selectedDossier.id);
        if (still) {
          selectedDossier = still;
          const dt = _applyTacheBlocklist(taches.filter(t => t.dossierId === selectedDossier.id));
          const dc = dossierComments.filter(c => c.dossierId === selectedDossier.id)
            .sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
          renderAttrPanel(dt, dc);
        }
      }
    } else if (document.getElementById('page-production')?.classList.contains('active')) {
      renderTaches();
    }
  } catch(e) { /* silencieux — on garde les données locales */ }
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
  // Cloisonnement : un opérateur ne voit que SON nom sous les étapes du pipeline.
  // admin / chef d'atelier / commercial (suivi global) voient tous les opérateurs.
  const _canSeeAllOps = ['admin','chef_atelier','commerciale'].includes(currentUser?.role);
  const _myLabel = currentUser?.label || currentUser?.username || '';
  const clos = _dossierClosed((Array.isArray(dossiers) ? dossiers : []).find(x => x.id === dossierId));
  let doneCount = 0;
  const steps = ETAPES_CONFIG.map(e => {
    const te = dt.filter(t => t.etapeCode === e.code);
    let status = 'VIDE';
    if (clos)                                                                { status = 'TERMINE'; doneCount++; }
    else if (te.length > 0 && te.every(t => t.statut === 'TERMINE'))         { status = 'TERMINE'; doneCount++; }
    else if (te.some(t => t.statut === 'EN_COURS' || t.statut === 'TERMINE')) status = 'EN_COURS';
    else if (te.some(t => t.statut === 'A_FAIRE'))                            status = 'A_FAIRE';
    return { ...e, status };
  });
  const pct      = _dossierPct(dt, (Array.isArray(dossiers) ? dossiers : []).find(x => x.id === dossierId));
  const pctColor = pct===100?'#16a34a':pct>0?'#e8834a':'#a8a29e';
  const bg  = s => s==='TERMINE'?'#16a34a':s==='EN_COURS'?'#d97706':s==='A_FAIRE'?'#2563eb':'#f5f5f4';
  const bc  = s => s==='VIDE'?'#e5e3df':bg(s);
  const tc  = s => s==='VIDE'?'#a8a29e':'#fff';
  const lc  = s => s==='TERMINE'?'#16a34a30':'#e5e3df';
  const ic  = s => s==='TERMINE'?'':s==='EN_COURS'?'▶':s==='A_FAIRE'?'●':'';
  const ops = s => {
    let t0 = dt.filter(t => t.etapeCode === s.code);
    if (!_canSeeAllOps) t0 = t0.filter(t => _sameOp(t.operateur, _myLabel));
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
  const myTaches = _allTachesMerged().filter(t => _sameOp(t.operateur, myLabel));
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
        ? `<button onclick="openPointage('${t.id}','${t.etapeCode||''}','${(t.dossierId==='LIBRE'?(t.titre||t.etapeLabel):t.numeroDossier)||''}')" class="mon-task-card__btn" style="background:var(--color-success);color:#fff"> Terminer</button>`
        : '';
    return `<div class="mon-task-card" style="background:${bg};border-color:${border}">
      <div class="mon-task-card__num">${t.dossierId==='LIBRE'?'Tâche libre':(t.numeroDossier||'')}</div>
      <div class="mon-task-card__etape" style="color:${etape.color}">${etape.label}</div>
      <div class="mon-task-card__status" style="color:${sColor}">${sTxt}</div>
      ${isEC?_chronoBadge(t,'mon'):''}
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

// ============================================================
// CHRONOMÈTRE & TEMPS DE PRODUCTION PAR OPÉRATEUR
// ============================================================
// Parse une date de tâche → ms epoch. Gère les formats GAS ("dd/MM/yyyy HH:mm"),
// toLocaleString fr-FR ("dd/MM/yyyy, HH:mm:ss" ou "dd/MM/yyyy HH:mm:ss"),
// date seule ("dd/MM/yyyy") et ISO. Renvoie null si illisible.
function _parseTacheTs(s) {
  if (s == null) return null;
  if (typeof s === 'number') return s;
  s = String(s).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d.getTime(); }
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return isNaN(d) ? null : d.getTime();
}
function _tacheStartMs(t) {
  if (t && typeof t.startTs === 'number') return t.startTs;
  return _parseTacheTs(t && t.dateDebut);
}
function _tacheEndMs(t) {
  if (t && typeof t.endTs === 'number') return t.endTs;
  return _parseTacheTs(t && t.dateFin);
}
// Durée de production d'une tâche (ms). En cours = maintenant − début ; terminée = fin − début.
function _tacheDureeMs(t, now) {
  now = now || Date.now();
  const s = _tacheStartMs(t);
  if (!s) return 0;
  if (t.statut === 'EN_COURS') return Math.max(0, now - s);
  if (t.statut === 'TERMINE') { const e = _tacheEndMs(t); return (e && e > s) ? e - s : 0; }
  return 0;
}
// Format durée longue (KPI) : "1h 23m", "12m 05s", "45s".
function _fmtDuree(ms) {
  if (!ms || ms < 0) ms = 0;
  const tot = Math.floor(ms / 1000);
  const h = Math.floor(tot / 3600), m = Math.floor((tot % 3600) / 60), s = tot % 60;
  if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
  if (m > 0) return m + 'm ' + String(s).padStart(2, '0') + 's';
  return s + 's';
}
// Format chrono live : "1:23:45" / "12:05".
function _fmtChrono(ms) {
  if (!ms || ms < 0) ms = 0;
  const tot = Math.floor(ms / 1000);
  const h = Math.floor(tot / 3600), m = Math.floor((tot % 3600) / 60), s = tot % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
}
// Temps de production cumulé par opérateur (toutes tâches chargées). Map label → ms.
function _operatorTimes(now) {
  now = now || Date.now();
  const map = {};
  const all = _allTachesMerged();
  for (const t of all) {
    const op = (t.operateur || '').trim();
    if (!op) continue;
    const d = _tacheDureeMs(t, now);
    if (d <= 0) continue;
    map[op] = (map[op] || 0) + d;
  }
  return map;
}
// Badge chronomètre HTML pour une tâche en cours (mis à jour par _chronoTick).
function _chronoBadge(t, variant) {
  const s = _tacheStartMs(t);
  if (!s) return '';
  const cls = variant ? ' prod-chrono--' + variant : '';
  return `<span class="prod-chrono${cls}" data-chrono-start="${s}" title="Temps écoulé depuis le démarrage">${_fmtChrono(Date.now() - s)}</span>`;
}
// Tick global (1s) : met à jour les chronos de carte + les temps opérateurs du KPI.
let _chronoTimer = null;
function _hasRunningTache() {
  return (taches || []).some(t => t.statut === 'EN_COURS')
      || (tachesLibres || []).some(t => t.statut === 'EN_COURS');
}
function _chronoTick() {
  const now = Date.now();
  const chronos = document.querySelectorAll('.prod-chrono[data-chrono-start]');
  chronos.forEach(el => {
    const s = +el.getAttribute('data-chrono-start');
    if (s) el.textContent = _fmtChrono(now - s);
  });
  const opCells = document.querySelectorAll('.op-prodtime[data-op-label]');
  if (opCells.length) {
    const times = _operatorTimes(now);
    opCells.forEach(el => {
      const lbl = el.getAttribute('data-op-label');
      el.textContent = _fmtDuree(times[lbl] || 0);
    });
  }
  if (!chronos.length && !_hasRunningTache()) { clearInterval(_chronoTimer); _chronoTimer = null; }
}
function _ensureChronoTick() {
  if (_chronoTimer) return;
  if (!_hasRunningTache()) return;
  _chronoTimer = setInterval(_chronoTick, 1000);
}

// En-tête du tableau compact des travaux (une instance par groupe-dossier).
const _PT_THEAD = `<tr>
  <th>Étape</th><th>Client</th><th>Opérateur</th><th>Statut</th><th></th>
</tr>`;

function _tacheRow(t) {
  const isLibre = t.dossierId === 'LIBRE';
  const etape   = isLibre
    ? { color:'#7c3aed', icon:'', label:t.titre||t.etapeLabel||'Tâche libre', short:'Libre' }
    : (ETAPES_CONFIG.find(e => e.code === t.etapeCode) || { color:'#888', icon:'?', label:t.etapeLabel, short:'?' });
  // Nom du client du dossier — visibilité directe pour l'opérateur sur chaque tâche
  const _dosT       = isLibre ? null : dossiers.find(x => x.id === t.dossierId);
  const clientName  = _dosT?.client || '';
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
          ? `<button class="btn-prod-done" onclick="openPointage('${t.id}','${t.etapeCode||''}','${(t.titre||t.etapeLabel||t.numeroDossier||'').replace(/'/g,"\\'")}')"> Terminer</button>`
          : `<span style="font-size:10px;font-weight:600;color:var(--color-warning);padding:4px 8px;background:var(--color-warning-bg);border-radius:6px;white-space:nowrap">En cours</span>`)
      : isStepBlocked
        ? `<span style="font-size:10px;font-weight:600;color:var(--color-text-muted);padding:4px 8px;background:#f5f5f4;border:1px solid #e5e3df;border-radius:6px;white-space:nowrap" title="Attend l'étape : ${blockedByStep}">⏸ ${blockedByStep}</span>`
        : (canInteract
            ? `<button class="btn-prod-start" onclick="pointerStart('${t.id}')">▶ Démarrer</button>`
            : `<span style="font-size:10px;font-weight:600;color:var(--color-text-muted);padding:4px 8px;background:#f5f5f4;border-radius:6px;white-space:nowrap">${t.operateur}</span>`);

  // — 80/20 : actions secondaires regroupées dans un menu kebab ⋮ —
  const _dots = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
  const kbItems = [];
  if (!isLibre) {
    kbItems.push(`<button class="kebab-item" role="menuitem" onclick="event.stopPropagation();closeAllKebabs();openAttribForDossier('${t.dossierId}')">${_kebabIcon('eye')}<span>Voir le dossier</span></button>`);
    kbItems.push(`<button class="kebab-item" role="menuitem" onclick="event.stopPropagation();closeAllKebabs();printDossier('${t.dossierId}')">${_kebabIcon('print')}<span>Imprimer le dossier</span></button>`);
  }
  if (isLibre && isAdminOrChef && !isDone) {
    kbItems.push(`<button class="kebab-item danger" role="menuitem" onclick="event.stopPropagation();closeAllKebabs();deleteTacheLibre('${t.id}')">${_kebabIcon('trash')}<span>Supprimer la tâche</span></button>`);
  }
  const kebab = kbItems.length
    ? `<div class="kebab-wrap"><button class="kebab-btn" aria-label="Plus d'actions" aria-haspopup="true" onclick="toggleKebab('pt${t.id}',event)">${_dots}</button><div class="kebab-menu" id="kb-pt${t.id}" role="menu">${kbItems.join('')}</div></div>`
    : '';

  const prioColor = t.priorite==='Urgente'?'var(--color-danger)':t.priorite==='Haute'?'var(--color-warning)':'';
  const prioBadge = isLibre && t.priorite && t.priorite!=='Normale'
    ? `<span style="font-size:9px;font-weight:700;color:${prioColor};background:${t.priorite==='Urgente'?'var(--color-danger-bg)':'var(--color-warning-bg)'};padding:1px 5px;border-radius:6px;margin-left:4px">${t.priorite}</span>` : '';

  const clientChip = clientName
    ? `<span class="pt-client" title="Client : ${clientName}">👤 ${clientName}</span>` : '<span style="color:var(--color-text-muted)">—</span>';
  // Ligne de date : l'opérateur a désormais sa propre colonne, pas besoin de le répéter ici.
  const subLine = isLibre
    ? (t.echeance ? 'Échéance : <strong>'+new Date(t.echeance+'T00:00:00').toLocaleDateString('fr-FR')+'</strong>' : '')
    : (isEC ? 'Démarré '+t.dateDebut : isDone ? 'Terminé '+t.dateFin : 'Assigné '+t.dateAssignation);

  const retardInfo   = _getTacheRetardInfo(t);
  const retardStyle  = retardInfo.isRetard ? 'border-left:3px solid #dc2626;' : '';

  // — Détail repliable (Progressive Disclosure) —
  const _dt = (l,v)=>v?`<div><div class="pt-dt-l">${l}</div><div class="pt-dt-v">${v}</div></div>`:'';
  const retardChip = retardInfo.isRetard
    ? `<span class="pt-retard" title="Délai dépassé de ${retardInfo.depassement}mn">+${retardInfo.depassement}mn</span>` : '';
  const detail = `
      <div class="pt-detail-grid">
        ${!isLibre?_dt('Client', clientName||'—'):''}
        ${_dt('Opérateur', t.operateur||'—')}
        ${!isLibre?_dt('Dossier', t.numeroDossier||t.dossierId):''}
        ${_dt('Assigné le', t.dateAssignation)}
        ${_dt('Démarré le', t.dateDebut)}
        ${_dt('Terminé le', t.dateFin)}
        ${retardInfo.isRetard?_dt('Retard', '+'+retardInfo.depassement+' mn'):''}
      </div>
      ${t.commentaire?`<div class="pt-note">${t.commentaire}</div>`:''}
      ${isLibre&&t.photos?.length?`<div class="pt-photos">${t.photos.map(_tacheLibrePhotoImg).join('')}</div>`:''}`;

  return `<tr class="pt-row ${isEC?'pt-row--encours':''} ${isDone?'pt-row--done':''}" id="ptr-${t.id}" onclick="togglePtDetail('${t.id}')">
    <td class="pt-td-etape" data-label="Étape" style="${retardStyle}">
      <span class="tache-card__icon" style="background:${etape.color}15;border-color:${etape.color};color:${etape.color}">${etape.icon}</span>
      <span class="pt-td-label" style="color:${etape.color}">${isLibre?(t.titre||t.etapeLabel):t.etapeLabel}</span>
      ${prioBadge}${_shiftBadge(t.shift)}
      <svg class="pt-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </td>
    <td class="pt-td-client" data-label="Client">${clientChip}</td>
    <td class="pt-td-op" data-label="Opérateur">
      <div class="pt-td-op-name">${t.operateur||'—'}</div>
      ${subLine?`<div class="tache-card__sub">${subLine}</div>`:''}
    </td>
    <td class="pt-td-status" data-label="Statut">${retardChip}${isEC?_chronoBadge(t):''}</td>
    <td class="pt-td-action" data-label="Action" onclick="event.stopPropagation()">${actions}${kebab}</td>
  </tr>
  <tr class="pt-detail-row"><td colspan="5"><div class="pt-detail" id="ptd-${t.id}">${detail}</div></td></tr>`;
}

function togglePtDetail(id){
  const row = document.getElementById('ptr-' + id);
  const det = document.getElementById('ptd-' + id);
  if (!det) return;
  const open = det.classList.toggle('open');
  if (row) row.classList.toggle('open', open);
}

// Le bouton « Mes tâches » n'a de sens que pour les rôles routés vers le cockpit
// global (admin / chef / commercial) : les opérateurs voient déjà leurs seules
// tâches par défaut. Appelé à l'ouverture de la page Production.
function _setupProdViewToggle() {
  const canAll = ['admin','chef_atelier','commerciale'].includes(currentUser?.role);
  const btn = document.getElementById('prodViewMine');
  if (btn) btn.style.display = canAll ? '' : 'none';
}

function toggleProdView(mode) {
  _prodView = mode;
  document.getElementById('prodViewTasks')?.classList.toggle('view-toggle-btn--active', mode === 'tasks');
  document.getElementById('prodViewMine')?.classList.toggle('view-toggle-btn--active', mode === 'mine');
  document.getElementById('prodViewCharge')?.classList.toggle('view-toggle-btn--active', mode === 'charge');
  // Masquer les filtres statut en vue charge (non pertinents)
  const fb = document.getElementById('prodFilterBar');
  if (fb) fb.style.display = mode === 'charge' ? 'none' : '';
  // Masquer la mini barre charge en vue charge (redondant)
  const wl = document.getElementById('opWorkloadContainer');
  if (wl) wl.style.display = mode === 'charge' ? 'none' : '';
  // Le bouton déplier/replier ne concerne que la vue tâches
  const et = document.getElementById('prodExpandToggle');
  if (et) et.style.display = mode === 'charge' ? 'none' : '';
  renderTaches();
}

function _renderChargeView() {
  const container = document.getElementById('tachesContainer');
  if (!container) return;

  const isAdminOrChef = ['admin','chef_atelier'].includes(currentUser?.role);
  const canViewAllProd = isAdminOrChef || currentUser?.role === 'commerciale'; // commerciaux : suivi en lecture seule
  const allTaches     = _allTachesMerged();

  // Construire la map opérateur → leurs tâches
  const opMap = {};
  allTaches.forEach(t => {
    if (!t.operateur) return;
    if (!opMap[t.operateur]) opMap[t.operateur] = [];
    opMap[t.operateur].push(t);
  });

  // Si pas admin/chef : n'afficher que sa propre carte
  const myLabel = currentUser?.label || currentUser?.username || '';
  const opKeys  = canViewAllProd
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
        ? { color:'#7c3aed', label: t.titre || t.etapeLabel || 'Tâche libre' }
        : (ETAPES_CONFIG.find(e => e.code === t.etapeCode) || { color:'#888', label: t.etapeLabel || '?' });
      const dotBg  = isEC ? '#d97706' : isDone ? '#16a34a' : '#2563eb';
      const d = dossiers.find(x => x.id === t.dossierId);
      const isUrgent = d?.priorite === 'Urgente';
      const btn = isEC && (isAdminOrChef || _sameOp(op, myLabel))
        ? `<button class="charge-task-btn" onclick="openPointage('${t.id}','${t.etapeCode||''}','${((t.dossierId==='LIBRE'?(t.titre||t.etapeLabel):t.numeroDossier)||'').replace(/'/g,"\\'")}'); event.stopPropagation();" style="background:var(--color-success-bg);color:var(--color-success)"></button>`
        : t.statut === 'A_FAIRE' && (isAdminOrChef || _sameOp(op, myLabel))
          ? `<button class="charge-task-btn" onclick="pointerStart('${t.id}'); event.stopPropagation();" style="background:var(--color-primary-light);color:var(--color-primary)">▶</button>`
          : '';
      const clientLbl = d?.client ? `<span class="charge-task-client" title="Client : ${d.client}">${d.client}</span>` : '';
      return `<div class="charge-task-row ${isEC?'charge-task-row--encours':''} ${isDone?'charge-task-row--done':''}" onclick="openAttribForDossier('${t.dossierId}')">
        <span class="charge-task-dot" style="background:${dotBg}"></span>
        <span class="charge-task-etape" style="color:${etape.color}">${etape.label}${isUrgent?'&nbsp;<span style="color:var(--color-danger);font-size:9px;font-weight:800">⬤</span>':''}</span>
        ${clientLbl}
        <span class="charge-task-num">${t.dossierId==='LIBRE'?'Libre':(t.numeroDossier||'')}</span>
        ${isEC?_chronoBadge(t,'charge'):''}
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
  _ensureChronoTick();
}

function _buildOpWorkload() {
  const isAdminOrChef = ['admin','chef_atelier'].includes(currentUser?.role);
  if (!isAdminOrChef) return '';
  const counts = {};
  _allTachesMerged().forEach(t => {
    if (t.statut === 'TERMINE' || !t.operateur) return;
    if (!counts[t.operateur]) counts[t.operateur] = { aFaire:0, enCours:0 };
    if (t.statut === 'A_FAIRE')   counts[t.operateur].aFaire++;
    else if (t.statut === 'EN_COURS') counts[t.operateur].enCours++;
  });
  const ops = Object.entries(counts);
  if (!ops.length) return '';
  const maxCount = Math.max(...ops.map(([,v]) => v.aFaire + v.enCours), 1);

  const sorted = ops.sort((a,b) => (b[1].aFaire+b[1].enCours)-(a[1].aFaire+a[1].enCours));
  const overloadedCount = sorted.filter(([,v]) => Math.round((v.aFaire+v.enCours) / maxCount * 100) >= 85).length;

  const cards = sorted.map(([name, v]) => {
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

  const summary = overloadedCount
    ? `<span class="op-workload-summary op-workload-summary--warn">${overloadedCount} en surcharge</span>`
    : `<span class="op-workload-summary">${sorted.length} opérateur${sorted.length>1?'s':''} actifs</span>`;

  return `<div class="op-workload-section ${_opWorkloadOpen?'op-workload-section--open':''}">
    <button class="op-workload-toggle" onclick="toggleOpWorkload()" aria-expanded="${_opWorkloadOpen}">
      <span class="op-workload-title">Charge opérateurs</span>
      ${summary}
      ${_chevSvg('op-workload-toggle-chev')}
    </button>
    <div class="op-workload-row">${cards}</div>
  </div>`;
}

function toggleOpWorkload(){
  _opWorkloadOpen = !_opWorkloadOpen;
  const wl = document.getElementById('opWorkloadContainer');
  if (wl) wl.innerHTML = _buildOpWorkload();
}

// Évite d'afficher « 01/01/1970 » (epoch 0 = date absente) : renvoie '' si la date est
// vide, invalide ou tombe en 1970. Pour les chaînes déjà formatées (dd/MM/yyyy).
function _cleanDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (!s || /\b1970\b/.test(s)) return '';
  return s;
}

// ── Échéances de livraison PRODUCTION (vue partagée — visible par TOUS les opérateurs) ──
function _daysUntil(ymd) {
  if (!ymd) return null;
  const d = new Date(_toIsoDate(ymd) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((d - today) / 86400000);
}

// Normalise une date vers le format ISO 'AAAA-MM-JJ' (laisse l'ISO intact,
// convertit 'JJ/MM/AAAA' → ISO). Les dates de livraison peuvent arriver dans
// les deux formats selon la source (commande/réservation = ISO, dossiers GAS = JJ/MM/AAAA).
function _toIsoDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  // Chaîne Date JS héritée du cache (ex. "Sun Jun 28 2026 21:00:00 GMT+0000") :
  // non convertible côté front sans le fuseau d'origine (risque de décalage d'un jour).
  // Le backend renvoie désormais de l'ISO → on masque plutôt que d'afficher "Invalid Date".
  if (/GMT|[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d/.test(s)) return '';
  return s;
}

// Affiche une date (quelle que soit sa source) au format fr-FR, ou '' si illisible.
function _dispDate(v) {
  const iso = _toIsoDate(v);
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR');
}

// Résout le nom affichable d'un opérateur/commercial à partir d'un identifiant
// stocké (qui peut être un username OU un label selon la source). Retourne le
// label utilisateur si trouvé, sinon la valeur d'origine.
function _resolveOperatorLabel(who) {
  if (!who) return '';
  const s = String(who).trim().toLowerCase();
  const u = (typeof localUsers !== 'undefined' ? localUsers : []).find(x =>
    String(x.username || '').trim().toLowerCase() === s ||
    String(x.label    || '').trim().toLowerCase() === s);
  return u ? (u.label || u.username || who) : who;
}

// ============================================================
// PAGE LIVRAISONS (sidebar gauche) — vue agrégée commandes + réservations,
// regroupée par date. UX : hiérarchie (hero + KPIs), scanabilité (groupes
// repliables colorés), progressive disclosure (ligne → détail), kebab menu,
// table responsive → cartes mobile (pcf-*), 80/20 (action « Ouvrir » directe).
// ============================================================
// Cockpit Livraisons : mêmes principes que le cockpit Commandes/Production
// (chips de filtre + cartes d'alerte + tableau compact + drawer latéral).
// filter : ACTIVE|RETARD|AUJ|SEMAINE|SANS_DATE|TERMINE|TOUS
// groupBy : quelle date fait foi pour l'échéance (client|prod)
// date : filtre optionnel sur une date d'échéance précise (ISO 'AAAA-MM-JJ', '' = toutes)
let _delivState = { filter: 'ACTIVE', mode: 'all', groupBy: 'client', sort: 'echeance', dir: 'asc', density: 'compact', q: '', date: '' };
const _DELIV_PAGE = 80;
let _delivLimit = _DELIV_PAGE;

const _DELIV_MONEY_ROLES = ['admin','caissier','commerciale','comptable','gestionnaire'];

// Liste normalisée des livraisons depuis commandes + réservations (hors annulées).
function _collectDeliveries() {
  const out = [];
  const _seq = _buildSeqMaps();
  (Array.isArray(commandes) ? commandes : []).forEach(c => {
    if (!c || c.status === 'cancelled') return;
    out.push({
      kind: 'commande', id: c.id, date: c.date,
      ref:        _seqRefOf('commande', c.id, _seq),
      client:     c.clientName || c.client || 'Client',
      contact:    c.clientContact || '',
      commercial: _resolveOperatorLabel(c.caissier || ''),
      items:      c.items || [],
      total:      Number(c.total) || 0,
      status:     c.status,
      mode:       c.deliveryMode === 'livraison' ? 'livraison' : 'retrait',
      address:    c.adresseLivraison || '',
      notes:      c.notes || '',
      dateClient: _toIsoDate(c.dateLivraison || ''),
      dateProd:   _toIsoDate(c.dateLivraisonProd || ''),
      dossierId:  c.dossierId || ''
    });
  });
  (Array.isArray(reservations) ? reservations : []).forEach(r => {
    if (!r || r.status === 'cancelled') return;
    out.push({
      kind: 'reservation', id: r.id, date: r.date,
      ref:        _seqRefOf('reservation', r.id, _seq),
      client:     r.clientName || 'Client',
      contact:    r.clientContact || '',
      commercial: _resolveOperatorLabel(r.caissier || ''),
      items:      r.items || [],
      total:      Number(r.total) || 0,
      status:     r.status,
      mode:       r.deliveryMode === 'livraison' ? 'livraison' : 'retrait',
      address:    r.deliveryAddress || '',
      notes:      r.notes || '',
      dateClient: _toIsoDate(r.deliveryDate || ''),
      dateProd:   '',
      dossierId:  r.dossierId || ''
    });
  });
  return out;
}

// Libellé + métadonnées d'un groupe-date pour le drawer.
function _delivDateLabel(iso) {
  if (!iso) return { label: 'Sans date de livraison', tag: '', cls: 'none', sort: 9e15 };
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return { label: iso, tag: '', cls: 'none', sort: 9e15 - 1 };
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((d - today) / 86400000);
  const base = d.toLocaleDateString('fr-FR', { weekday:'long', day:'2-digit', month:'long' });
  let label = base.charAt(0).toUpperCase() + base.slice(1);
  if (diff === 0)      label = "Aujourd'hui · " + label;
  else if (diff === 1) label = 'Demain · ' + label;
  else if (diff === -1)label = 'Hier · ' + label;
  const tag = diff < 0 ? Math.abs(diff)+'j de retard' : diff === 0 ? "aujourd'hui" : diff === 1 ? 'demain' : diff+'j';
  const cls = diff < 0 ? 'late' : diff <= 2 ? 'soon' : 'ok';
  return { label, tag, cls, sort: d.getTime() };
}

function setDelivFilter(v)  { _delivState.filter = v; _delivLimit = _DELIV_PAGE; renderLivraisons(); }
function setDelivMode(v)     { _delivState.mode = v;   _delivLimit = _DELIV_PAGE; renderLivraisons(); }
function setDelivGroupBy(v)  { _delivState.groupBy = v; renderLivraisons(); }
function setDelivSort(v)     { if (_delivState.sort === v) _delivState.dir = _delivState.dir === 'asc' ? 'desc' : 'asc'; else { _delivState.sort = v; _delivState.dir = 'asc'; } renderLivraisons(); }
function toggleDelivSortDir(){ _delivState.dir = _delivState.dir === 'asc' ? 'desc' : 'asc'; renderLivraisons(); }
function toggleDelivDensity(){ _delivState.density = _delivState.density === 'compact' ? 'detaille' : 'compact'; renderLivraisons(); }
function setDelivSearch(v)   { _delivState.q = v;      _delivLimit = _DELIV_PAGE; renderLivraisons(); }
function setDelivDate(v)     { _delivState.date = _toIsoDate(v || ''); _delivLimit = _DELIV_PAGE; renderLivraisons(); }
function clearDelivDate()    { _delivState.date = ''; _delivLimit = _DELIV_PAGE; renderLivraisons(); }
function delivShowMore()     { _delivLimit += _DELIV_PAGE; renderLivraisons(); }

async function _openDeliverySource(kind, id, dossierId) {
  const ep = (typeof _effectivePages === 'function') ? _effectivePages(currentUser) : [];
  if (dossierId && ep.includes('attribution')) { try { await openAttribForDossier(dossierId); } catch(e){} return; }
  if (kind === 'commande'    && ep.includes('commandes'))    { showPage('commandes', null, null);    return; }
  if (kind === 'reservation' && ep.includes('reservations')) { showPage('reservations', null, null); return; }
  if (ep.includes('production')) showPage('production', null, null);
}

// Copie un récap texte de la livraison dans le presse-papier (action secondaire kebab).
function _livCopy(kind, id) {
  const x = _collectDeliveries().find(d => d.kind === kind && String(d.id) === String(id));
  if (!x) return;
  const showMoney = _DELIV_MONEY_ROLES.includes(currentUser?.role);
  const txt = [
    (kind === 'reservation' ? 'Réservation' : 'Commande') + ' — ' + x.client,
    x.contact ? 'Contact : ' + x.contact : '',
    'Articles : ' + ((x.items || []).map(i => `${i.name} ×${i.qty || 1}`).join(', ') || '—'),
    x.mode === 'livraison' ? 'Livraison : ' + (x.address || '—') : 'Retrait boutique',
    _dispDate(x.dateClient) ? 'Livraison client : ' + _dispDate(x.dateClient) : '',
    _dispDate(x.dateProd)   ? 'Production : '      + _dispDate(x.dateProd)   : '',
    x.commercial ? 'Commercial : ' + x.commercial : '',
    showMoney ? 'Total : ' + fmt(x.total) : ''
  ].filter(Boolean).join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText)
    navigator.clipboard.writeText(txt).then(() => showToast('Récap copié')).catch(() => showToast('Copie impossible', 'error'));
  else showToast('Copie non supportée', 'error');
}

// Enrichit chaque livraison d'une échéance (selon la date qui fait foi), d'un
// nombre de jours restants/de retard et d'un « bucket » de planification.
function _delivBuildRows() {
  return _collectDeliveries().map(x => {
    const primary = _delivState.groupBy === 'prod'
      ? (x.dateProd || x.dateClient)
      : (x.dateClient || x.dateProd);
    const ymd  = _toIsoDate(primary || '');
    const days = ymd ? _daysUntil(ymd) : null;
    let bucket;
    if (x.status === 'cancelled')       bucket = 'ANNULEE';
    else if (x.status === 'completed')  bucket = 'TERMINE';
    else if (!ymd)                      bucket = 'SANS_DATE';
    else if (days < 0)                  bucket = 'RETARD';
    else if (days === 0)                bucket = 'AUJ';
    else if (days === 1)                bucket = 'DEMAIN';
    else if (days <= 7)                 bucket = 'SEMAINE';
    else                                bucket = 'FUTUR';
    return { ...x, ymd, days, bucket };
  });
}

// ============================================================
// CALENDRIER — double vue (production + échéance client)
// Accès : admin, commerciaux, responsables (chef_atelier / gestionnaire).
// Source unique = _collectDeliveries() (commandes + réservations, dates normalisées).
// ============================================================
let _calRef = (function(){ const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
const _CAL_MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const _CAL_DOWS   = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const _CAL_LINK_SVG = '<span class="cal-chip-link" title="Lié à sa livraison"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-.8.8"/><path d="M15 12a4 4 0 0 0-5.7 0L6.7 14.6a4 4 0 0 0 5.7 5.7l.8-.8"/></svg></span>';

// État des filtres communs aux deux calendriers.
let _calFilters = { client:'', status:'', resp:'', type:'', q:'' };
// Cache des paires production↔livraison + délais courts, recalculé à chaque rendu.
let _calPair = { linked:{}, short:{} };
// Journées dépliées (clé = 'prod:iso' / 'client:iso') → affiche toutes les commandes du jour.
let _calExpanded = new Set();

// Déplie / replie une journée pour afficher toutes ses commandes.
function calToggleDay(kind, iso){
  const key = kind+':'+iso;
  if(_calExpanded.has(key)) _calExpanded.delete(key); else _calExpanded.add(key);
  renderCalendrier();
}

function setCalFilter(field, value){
  if(!(field in _calFilters)) return;
  _calFilters[field] = (value||'').trim ? value.trim() : (value||'');
  renderCalendrier();
}

// Filtres hors statut (utilisés aussi pour les KPI).
function _calMatchesBase(e){
  const f = _calFilters;
  if(f.client && e.client !== f.client) return false;
  if(f.resp && (e.commercial||'') !== f.resp) return false;
  if(f.type){
    if((f.type==='commande'||f.type==='reservation') && e.kind !== f.type) return false;
    if((f.type==='livraison'||f.type==='retrait') && e.mode !== f.type) return false;
  }
  if(f.q){
    const q = f.q.toLowerCase();
    const hay = (String(e.client||'')+' '+String(e.ref||'')+' '+(e.items||[]).map(i=>i.name).join(' ')+' '+String(e.commercial||'')).toLowerCase();
    if(!hay.includes(q)) return false;
  }
  return true;
}

// Écart en jours entre deux dates ISO (b - a). null si invalide.
function _calGapDays(a, b){
  if(!a || !b) return null;
  const da = new Date(a+'T00:00:00'), db = new Date(b+'T00:00:00');
  if(isNaN(da.getTime()) || isNaN(db.getTime())) return null;
  return Math.round((db - da) / 86400000);
}

// Détecte les commandes présentes dans les deux calendriers (lien) et celles
// dont la production est trop proche de la livraison (délai court).
function _calBuildPairs(){
  const linked = {}, short = {};
  _collectDeliveries().forEach(x=>{
    if(x.status==='cancelled') return;
    if(x.dateProd && x.dateClient){
      const key = x.kind+':'+x.id;
      linked[key] = true;
      const gap = _calGapDays(x.dateProd, x.dateClient);
      if(gap!==null && gap <= 1) short[key] = true;   // prod le même jour, la veille, ou après la livraison
    }
  });
  return { linked, short };
}

// KPI compacts calculés sur l'ensemble des livraisons (hors filtre statut).
function _calComputeKpis(){
  const today = _calTodayIso();
  let retardProd=0, retardLiv=0, prodAuj=0, livAuj=0, sansDate=0;
  _collectDeliveries().forEach(x=>{
    if(x.status==='cancelled') return;
    if(!_calMatchesBase(x)) return;
    const done = x.status==='completed';
    const dp = x.dateProd, dc = x.dateClient;
    if(dp && !done && dp <  today) retardProd++;
    if(dc && !done && dc <  today) retardLiv++;
    if(dp && !done && dp === today) prodAuj++;
    if(dc && !done && dc === today) livAuj++;
    if(!dp && !dc) sansDate++;
  });
  return { retardProd, retardLiv, prodAuj, livAuj, sansDate };
}

// Remplit les listes déroulantes Client / Responsable en préservant la sélection.
function _calPopulateFilters(){
  const dels = _collectDeliveries().filter(x=>x.status!=='cancelled');
  const clients = [...new Set(dels.map(x=>x.client).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
  const resps   = [...new Set(dels.map(x=>x.commercial).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
  const fill = (id, label, values, current) => {
    const sel = document.getElementById(id);
    if(!sel) return;
    sel.innerHTML = `<option value="">${label}</option>` + values.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    sel.value = current && values.includes(current) ? current : '';
    if(sel.value !== current) _calFilters[id==='calFilterClient'?'client':'resp'] = sel.value;
  };
  fill('calFilterClient', 'Client', clients, _calFilters.client);
  fill('calFilterResp',   'Responsable', resps, _calFilters.resp);
  const st = document.getElementById('calFilterStatut'); if(st) st.value = _calFilters.status;
  const tp = document.getElementById('calFilterType');   if(tp) tp.value = _calFilters.type;
}

// Injecte les valeurs des KPI dans la ligne compacte.
function _calRenderKpis(){
  const k = _calComputeKpis();
  const set = (id,v)=>{ const el=document.getElementById(id); if(el) el.textContent = v; };
  set('calKpiRetardProd', k.retardProd);
  set('calKpiRetardLiv',  k.retardLiv);
  set('calKpiProdAuj',    k.prodAuj);
  set('calKpiLivAuj',     k.livAuj);
  set('calKpiSansDate',   k.sansDate);
}

function calShift(delta){ _calRef = new Date(_calRef.getFullYear(), _calRef.getMonth()+delta, 1); renderCalendrier(); }
function calToday(){ const d = new Date(); _calRef = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendrier(); }
function _calTodayIso(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

// Liste d'événements pour un calendrier. kind='prod' → date de production ;
// kind='client' → date de livraison/retrait client. Enrichit avec la progression du dossier.
function _calEvents(kind){
  const dossById = {};
  (Array.isArray(dossiers)?dossiers:[]).forEach(d=>{ if(d&&d.id) dossById[d.id]=d; });
  return _collectDeliveries().map(x=>{
    const ymd = kind==='prod' ? _toIsoDate(x.dateProd||'') : _toIsoDate(x.dateClient||'');
    if(!ymd) return null;
    const dos = x.dossierId ? dossById[x.dossierId] : null;
    return {
      ymd, client:x.client, ref:x.ref, total:x.total, status:x.status,
      kind:x.kind, id:x.id, dossierId:x.dossierId||'', commercial:x.commercial||'',
      items:x.items||[],
      progression: dos ? (Number(dos.progression)||0) : null
    };
  }).filter(Boolean);
}

// Groupe les événements d'un calendrier par jour, limité au mois affiché.
function _calByDay(kind){
  const year = _calRef.getFullYear(), month = _calRef.getMonth();
  const todayIso = _calTodayIso();
  const byDay = {};
  _calEvents(kind).forEach(e=>{
    if(e.status==='cancelled') return;
    const d = new Date(e.ymd+'T00:00:00');
    if(isNaN(d.getTime()) || d.getFullYear()!==year || d.getMonth()!==month) return;
    if(!_calMatchesBase(e)) return;
    const st = _calFilters.status;
    if(st){
      const done = e.status==='completed';
      const late = !done && e.ymd < todayIso;
      if(st==='completed' && !done) return;
      if(st==='active'    && (done || late)) return;
      if(st==='late'      && !late) return;
    }
    (byDay[e.ymd] = byDay[e.ymd]||[]).push(e);
  });
  return byDay;
}

// Rendu HTML d'une grille mensuelle (affichage écran).
function _calRenderMonth(kind){
  const year = _calRef.getFullYear(), month = _calRef.getMonth();
  const todayIso = _calTodayIso();
  const byDay = _calByDay(kind);
  const first = new Date(year, month, 1);
  const startDow = (first.getDay()+6)%7;          // 0 = lundi
  const dim = new Date(year, month+1, 0).getDate();
  const totalCells = Math.ceil((startDow+dim)/7)*7;
  let grid = '';
  let day = 1 - startDow;
  for(let i=0;i<totalCells;i++,day++){
    if(day<1 || day>dim){ grid += '<div class="cal-day cal-day-out"></div>'; continue; }
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const evs = byDay[iso] || [];
    const isToday = iso===todayIso;
    const dayKey  = kind+':'+iso;
    const expanded = _calExpanded.has(dayKey);
    const shown   = expanded ? evs : evs.slice(0,4);
    const chips = shown.map(e=>{
      const done  = e.status==='completed';
      const late  = !done && iso < todayIso;
      const key   = e.kind+':'+e.id;
      const linked = !!_calPair.linked[key];
      const short  = !!_calPair.short[key] && !done;
      const base  = kind==='prod' ? 'prod' : 'liv';
      const cls   = done?'done':late?'late':base;
      const items = e.items||[];
      const first = items.length ? items[0].name + (items.length>1?' +'+(items.length-1):'') : '';
      const qty   = items.reduce((s,i)=>s+(Number(i.qty)||1),0);
      const dot   = done?'#9ca3af':late?'#d97706':short?'#dc2626':(kind==='prod'?'#7c3aed':'#0d9488');
      const art   = items.map(i=>`${i.name} ×${i.qty||1}`).join(', ');
      const tip   = `${e.client}${art?' — '+art:''}${short?' — délai court (production proche de la livraison)':''}`;
      return `<button type="button" class="cal-chip cal-chip--${cls}${linked?' cal-chip-linked':''}${short?' cal-chip-urgent':''}" onclick="_calOpenDetail('${e.kind}','${e.id}','${e.dossierId}')" title="${escapeHtml(tip)}">
        <span class="cal-chip-head"><span class="cal-chip-client">${escapeHtml(e.client)}</span><span class="cal-chip-badges">${linked?_CAL_LINK_SVG:''}${qty?`<span class="cal-chip-qty">×${qty}</span>`:''}</span></span>
        ${first?`<span class="cal-chip-items">${escapeHtml(first)}</span>`:''}
        <span class="cal-chip-foot"><span class="cal-dot" style="background:${dot}"></span>${short?'<span class="cal-chip-warn">Délai court</span>':''}</span></button>`;
    }).join('');
    let more = '';
    if(evs.length>4){
      more = expanded
        ? `<span class="cal-more cal-more-less" onclick="calToggleDay('${kind}','${iso}')">▲ Réduire</span>`
        : `<span class="cal-more" onclick="calToggleDay('${kind}','${iso}')">+${evs.length-4} autres</span>`;
    }
    grid += `<div class="cal-day${isToday?' cal-day-today':''}${evs.length?' cal-day-has':''}${expanded?' cal-day-open':''}">
      <span class="cal-daynum">${day}</span>
      <div class="cal-chips">${chips}${more}</div>
    </div>`;
  }
  const head = '<div class="cal-week-head">'+_CAL_DOWS.map(d=>`<div class="cal-dow">${d}</div>`).join('')+'</div>';
  return head + '<div class="cal-days">'+grid+'</div>';
}

function renderCalendrier(){
  if(!document.getElementById('page-calendrier')) return;
  if(typeof _syncDossierDates==='function') _syncDossierDates();
  _calPair = _calBuildPairs();
  _calPopulateFilters();
  _calRenderKpis();
  const lbl = document.getElementById('calMonthLabel');
  if(lbl) lbl.textContent = _CAL_MONTHS[_calRef.getMonth()]+' '+_calRef.getFullYear();
  const p = document.getElementById('calMonthProd');   if(p) p.innerHTML = _calRenderMonth('prod');
  const c = document.getElementById('calMonthClient'); if(c) c.innerHTML = _calRenderMonth('client');
}

// Ouvre la source (dossier/commande/réservation) au clic sur un événement.
function _calOpen(kind, id, dossierId){
  if(typeof _openDeliverySource==='function') _openDeliverySource(kind, id, dossierId);
}

// Ouvre le panneau détail à droite au clic sur une commande planifiée.
function _calOpenDetail(kind, id, dossierId){
  const x = _collectDeliveries().find(d => d.kind===kind && String(d.id)===String(id));
  const body = document.getElementById('calDrawerBody');
  const drawer = document.getElementById('calDrawer');
  if(!x || !body || !drawer){ if(typeof _openDeliverySource==='function') _openDeliverySource(kind, id, dossierId); return; }
  const today = _calTodayIso();
  const done  = x.status==='completed';
  const key   = x.kind+':'+x.id;
  const short = !!_calPair.short[key] && !done;
  const lateLiv = x.dateClient && !done && x.dateClient < today;
  let badge, bg, fg;
  if(done)        { badge='Terminé';   bg='#f3f4f6'; fg='#4b5563'; }
  else if(short)  { badge='Urgent';    bg='#fbecec'; fg='#a32d2d'; }
  else if(lateLiv){ badge='En retard'; bg='#faeeda'; fg='#854f0b'; }
  else            { badge='En cours';  bg='#e4f3ec'; fg='#0f6e56'; }
  const showMoney = _DELIV_MONEY_ROLES.includes(currentUser?.role);
  const items = x.items||[];
  const prod  = items.length ? items.map(i=>`${i.name} ×${i.qty||1}`).join(', ') : '—';
  const qty   = items.reduce((s,i)=>s+(Number(i.qty)||1),0) || '—';
  const dProd = _dispDate(x.dateProd) || 'Non planifiée';
  const dCli  = _dispDate(x.dateClient) || 'Non planifiée';
  const gap   = _calGapDays(x.dateProd, x.dateClient);
  const modeLabel = x.mode==='livraison' ? 'Livraison' + (x.address?' — '+x.address:'') : 'Retrait boutique';
  const svg = (p)=>`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  body.innerHTML = `
    <div class="cal-dt-head">
      <div>
        <div class="cal-dt-client">${escapeHtml(x.client)}</div>
        <div class="cal-dt-ref">${escapeHtml(x.ref||'')} · ${x.kind==='reservation'?'Réservation':'Commande'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="cal-dt-badge" style="background:${bg};color:${fg}">${badge}</span>
        <button class="cal-dt-close" onclick="closeDrawers()" aria-label="Fermer">&times;</button>
      </div>
    </div>
    ${short?`<div class="cal-dt-alert">${svg('<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>')} Délai court — la production est proche de la livraison${gap!==null?` (${gap<=0?'même jour ou après':'1 jour d\'écart'})`:''}.</div>`:''}
    <div class="cal-dt-fields">
      <div class="cal-dt-f"><label>${svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>')}Client</label><span>${escapeHtml(x.client)}${x.contact?` · ${escapeHtml(x.contact)}`:''}</span></div>
      <div class="cal-dt-f"><label>${svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>')}Produit / tâche</label><span>${escapeHtml(prod)}</span></div>
      <div class="cal-dt-f"><label>${svg('<path d="M3 7h18"/><path d="M6 7v13h12V7"/><path d="M9 7V4h6v3"/>')}Quantité</label><span>${qty}</span></div>
      <div class="cal-dt-f"><label>${svg('<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/>')}Date production</label><span>${dProd}</span></div>
      <div class="cal-dt-f"><label>${svg('<rect x="1" y="6" width="13" height="11" rx="1"/><path d="M14 9h4l3 3v5h-7z"/>')}Date livraison</label><span>${dCli}${lateLiv?' · <span style="color:#a32d2d">en retard</span>':''}</span></div>
      <div class="cal-dt-f"><label>${svg('<path d="M12 3v3"/><circle cx="12" cy="9" r="3"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>')}Mode</label><span>${escapeHtml(modeLabel)}</span></div>
      <div class="cal-dt-f"><label>${svg('<circle cx="12" cy="8" r="3.2"/><path d="M5 20a7 7 0 0 1 14 0"/>')}Responsable</label><span>${escapeHtml(x.commercial||'Non attribué')}</span></div>
      ${showMoney?`<div class="cal-dt-f"><label>${svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 10h4a2 2 0 0 1 0 4H9"/>')}Total</label><span>${fmt(x.total)}</span></div>`:''}
      <div class="cal-dt-f"><label>${svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>')}Commentaires</label><span class="cal-dt-note">${escapeHtml(x.notes || 'Aucun commentaire.')}</span></div>
    </div>
    <div class="cal-dt-acts">
      <button class="cal-dt-btn primary" onclick="closeDrawers(); _openDeliverySource('${x.kind}','${x.id}','${x.dossierId||''}')">${svg('<path d="M11 4h9"/><path d="M11 9h9"/><path d="M4 4l3 3-3 3"/><path d="M11 14h9M4 14l3 3-3 3"/>')} Ouvrir la fiche</button>
      <button class="cal-dt-btn" onclick="_delivPrintOne('${x.kind}','${x.id}')">${svg('<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>')} Imprimer le bon</button>
    </div>`;
  document.querySelectorAll('.pcok-drawer.open').forEach(d=>d.classList.remove('open'));
  drawer.classList.add('open');
  document.body.classList.add('pcok-drawer-open');
}

// Impression A4 paysage des deux calendriers du mois affiché.
function printCalendrier(){
  const shop = (typeof shopConfig !== 'undefined' && shopConfig && shopConfig.name) || 'FOREVER MG';
  const monthLbl = _CAL_MONTHS[_calRef.getMonth()]+' '+_calRef.getFullYear();
  const year = _calRef.getFullYear(), month = _calRef.getMonth();
  const todayIso = _calTodayIso();
  function tableFor(kind){
    const byDay = _calByDay(kind);
    const first = new Date(year, month, 1);
    const startDow = (first.getDay()+6)%7;
    const dim = new Date(year, month+1, 0).getDate();
    const totalCells = Math.ceil((startDow+dim)/7)*7;
    let day = 1 - startDow;
    let rows = '';
    for(let w=0; w<totalCells/7; w++){
      let tds='';
      for(let dd=0; dd<7; dd++, day++){
        if(day<1||day>dim){ tds += '<td class="out"></td>'; continue; }
        const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const evs = byDay[iso] || [];
        const items = evs.map(e=>{
          const done = e.status==='completed';
          const late = !done && iso < todayIso;
          const art = (e.items||[]).map(i=>`${i.name} ×${i.qty||1}`).join(', ');
          return `<div class="ev ${late?'late':''}${done?' done':''}"><b>${escapeHtml(e.client)}</b>${art?'<br>'+escapeHtml(art):''}</div>`;
        }).join('');
        tds += `<td class="${iso===todayIso?'today':''}"><div class="dn">${day}</div>${items}</td>`;
      }
      rows += '<tr>'+tds+'</tr>';
    }
    return `<table><thead><tr>${_CAL_DOWS.map(d=>`<th>${d}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  }
  const w = window.open('', '_blank', 'width=1200,height=900');
  if(!w){ alert("Impression bloquée : autorisez les fenêtres pop-up pour ce site, puis réessayez."); return; }
  const stamp = new Date().toLocaleDateString('fr-FR')+' '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  w.document.write(`<html><head><meta charset="utf-8"><title>Calendrier ${monthLbl}</title><style>
    @page{size:A4 landscape;margin:7mm}
    body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0;font-size:9px}
    h1{font-size:15px;margin:0}
    .sub{color:#555;font-size:9.5px;margin:2px 0 6px}
    h2{font-size:12px;margin:10px 0 4px;padding:4px 8px;border-radius:4px;color:#fff}
    h2.prod{background:#7c3aed}h2.client{background:#0f766e}
    table{width:100%;border-collapse:collapse;table-layout:fixed;page-break-inside:avoid}
    th{background:#e9e9e9;font-size:8px;text-transform:uppercase;border:1px solid #999;padding:2px}
    td{border:1px solid #bbb;height:78px;vertical-align:top;padding:2px 3px;width:14.28%;overflow:hidden}
    td.out{background:#f6f6f6}
    td.today{background:#fff7ed}
    .dn{font-weight:bold;font-size:9px;color:#444;margin-bottom:2px}
    .ev{font-size:7.5px;line-height:1.25;margin-bottom:1.5px;padding:1px 2px;border-radius:2px;background:#eef2ff;border-left:2px solid #6366f1;word-wrap:break-word;overflow:hidden}
    .ev.late{background:#fef2f2;border-left-color:#dc2626;color:#991b1b}
    .ev.done{background:#f0fdf4;border-left-color:#16a34a;color:#166534}
    .cal2{page-break-before:always}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body onload="window.print()">
    <h1>${shop} — CALENDRIER ${monthLbl.toUpperCase()}</h1>
    <div class="sub">Édité le ${stamp}</div>
    <h2 class="prod">🏭 Production — dates planifiées</h2>
    ${tableFor('prod')}
    <div class="cal2"></div>
    <h2 class="client">📦 Échéances client — livraison / retrait</h2>
    ${tableFor('client')}
  </body></html>`);
  w.document.close();
}

function _delivBucketMatch(r, k) {
  if (k === 'TOUS')     return r.status !== 'cancelled';
  if (k === 'ACTIVE')   return r.status === 'pending';
  if (k === 'RETARD')   return r.status === 'pending' && r.days != null && r.days < 0;
  if (k === 'AUJ')      return r.status === 'pending' && r.days === 0;
  if (k === 'SEMAINE')  return r.status === 'pending' && r.days != null && r.days >= 0 && r.days <= 7;
  if (k === 'SANS_DATE')return r.status === 'pending' && !r.ymd;
  if (k === 'TERMINE')  return r.status === 'completed';
  return true;
}

function _delivFilterRows(rows) {
  let out = rows.filter(r => _delivBucketMatch(r, _delivState.filter));
  if (_delivState.mode !== 'all') out = out.filter(r => r.mode === _delivState.mode);
  if (_delivState.date) out = out.filter(r => r.ymd === _delivState.date);
  const q = (_delivState.q || '').trim().toLowerCase();
  if (q) out = out.filter(r => (r.client + ' ' + (r.commercial || '') + ' ' + (r.items || []).map(i => i.name).join(' ') + ' ' + (r.address || '') + ' ' + (r.ref || '')).toLowerCase().includes(q));
  return out;
}

function _delivSortRows(rows) {
  const { sort, dir } = _delivState;
  const sign = dir === 'desc' ? -1 : 1;
  const cmp = ({
    echeance:   (a, b) => (a.days == null ? 1e9 : a.days) - (b.days == null ? 1e9 : b.days),
    client:     (a, b) => String(a.client).localeCompare(String(b.client), 'fr'),
    commercial: (a, b) => String(a.commercial || '').localeCompare(String(b.commercial || ''), 'fr'),
    total:      (a, b) => a.total - b.total,
  })[sort] || (() => 0);
  return rows.slice().sort((a, b) => (sign * cmp(a, b)) || ((a.days == null ? 1e9 : a.days) - (b.days == null ? 1e9 : b.days)));
}

// Texte + couleur du retard/échéance (partagé tableau ↔ drawer ↔ impression).
function _delivRetInfo(r) {
  if (r.status === 'completed') return { txt: 'Livrée', col: '#16a34a' };
  if (r.status === 'cancelled') return { txt: 'Annulée', col: '#a8a29e' };
  if (r.days == null)           return { txt: 'Sans date', col: '#a8a29e' };
  if (r.days < 0)               return { txt: `+${Math.abs(r.days)}j retard`, col: '#dc2626' };
  if (r.days === 0)             return { txt: "Auj.", col: '#e8834a' };
  if (r.days === 1)             return { txt: 'Demain', col: '#e8834a' };
  if (r.days <= 7)              return { txt: `${r.days}j`, col: '#d97706' };
  return { txt: `${r.days}j`, col: '#78716c' };
}

function renderLivraisons() {
  const root = document.getElementById('livraisonsContent');
  if (!root) return;
  const all = _delivBuildRows();
  const cnt = k => all.filter(r => _delivBucketMatch(r, k)).length;
  root.innerHTML = `<div class="pcok">
      ${_delivToolbar(cnt)}
      ${_delivAlertCards(all)}
      <div id="delivCockpitBody"></div>
    </div>`;
  _delivRenderBody();
}

function _delivRenderBody() {
  const body = document.getElementById('delivCockpitBody');
  if (!body) return;
  const showMoney = _DELIV_MONEY_ROLES.includes(currentUser?.role);
  const filtered = _delivSortRows(_delivFilterRows(_delivBuildRows()));
  const page = filtered.slice(0, _delivLimit);
  const lateN = filtered.filter(r => r.status === 'pending' && r.days != null && r.days < 0).length;
  const totalSum = filtered.reduce((s, r) => s + r.total, 0);
  const dateLbl = _delivState.date ? ` · échéance ${_dispDate(_delivState.date)}` : '';
  const filteredLbl = (_delivState.filter !== 'ACTIVE' || _delivState.mode !== 'all' || _delivState.q || _delivState.date) ? ' · filtré' : '';
  const count = `<div class="pcok-count">${filtered.length} livraison${filtered.length > 1 ? 's' : ''}${filteredLbl}${dateLbl}${lateN ? ` · <span style="color:#dc2626;font-weight:700">${lateN} en retard</span>` : ''}${showMoney ? ` · Total ${fmt(totalSum)}` : ''}</div>`;
  const more = filtered.length > _delivLimit
    ? `<div class="pcok-more"><button onclick="delivShowMore()">Afficher plus (${filtered.length - _delivLimit} restants)</button></div>` : '';
  body.innerHTML = count + _delivTable(page, showMoney) + more;
}

function _delivToolbar(cnt) {
  const chips = [
    ['ACTIVE', 'En cours'], ['RETARD', 'En retard'], ['AUJ', "Aujourd'hui"], ['SEMAINE', 'Cette semaine'], ['SANS_DATE', 'Sans date'], ['TERMINE', 'Livrées'], ['TOUS', 'Toutes']
  ].map(([k, lbl]) => {
    const active = _delivState.filter === k;
    const warn = (k === 'RETARD');
    return `<button class="pcok-chip ${active ? 'pcok-chip--active' : ''} ${warn ? 'pcok-chip--warn' : ''}" onclick="setDelivFilter('${k}')">${lbl}<span class="pcok-chip-n">${cnt(k)}</span></button>`;
  }).join('');
  const groupOpts = [['client', 'Échéance client'], ['prod', 'Échéance production']]
    .map(([v, l]) => `<option value="${v}" ${_delivState.groupBy === v ? 'selected' : ''}>${l}</option>`).join('');
  const modeOpts = [['all', 'Tous les modes'], ['livraison', 'Livraison'], ['retrait', 'Retrait']]
    .map(([v, l]) => `<option value="${v}" ${_delivState.mode === v ? 'selected' : ''}>${l}</option>`).join('');
  const sortOpts = [['echeance', 'Échéance'], ['client', 'Client'], ['commercial', 'Commercial'], ['total', 'Montant']]
    .map(([k, l]) => `<option value="${k}" ${_delivState.sort === k ? 'selected' : ''}>Trier : ${l}</option>`).join('');
  const dirIcon = _delivState.dir === 'asc' ? '↑' : '↓';
  const dateFilter = `<div class="pcok-datefilter${_delivState.date ? ' pcok-datefilter--active' : ''}" title="Filtrer sur une date d'échéance précise">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <input type="date" value="${_delivState.date || ''}" onchange="setDelivDate(this.value)" aria-label="Date d'échéance" />
        ${_delivState.date ? `<button class="pcok-datefilter-clear" title="Effacer la date" onclick="clearDelivDate()">×</button>` : ''}
      </div>`;
  return `<div class="pcok-toolbar">
    <div class="pcok-chips">${chips}</div>
    <div class="pcok-controls">
      <div class="pcok-search">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" placeholder="Rechercher client, article, commercial…" value="${_pcokEsc(_delivState.q)}" oninput="setDelivSearch(this.value)" />
      </div>
      <select class="select-input" onchange="setDelivGroupBy(this.value)" title="Date d'échéance">${groupOpts}</select>
      ${dateFilter}
      <select class="select-input" onchange="setDelivMode(this.value)" title="Filtrer par mode">${modeOpts}</select>
      <select class="select-input" onchange="setDelivSort(this.value)" title="Trier">${sortOpts}</select>
      <button class="pcok-iconbtn" title="Sens du tri" onclick="toggleDelivSortDir()">${dirIcon}</button>
      <button class="pcok-iconbtn pcok-density" title="Vue compacte / détaillée" onclick="toggleDelivDensity()">${_delivState.density === 'compact' ? 'Détaillé' : 'Compact'}</button>
      <button class="pcok-iconbtn" title="Imprimer le planning de livraison" onclick="printLivraisons()">Imprimer</button>
    </div>
  </div>`;
}

function _delivAlertCards(rows) {
  const alert = rows.filter(r => r.status === 'pending' && (r.bucket === 'RETARD' || r.bucket === 'AUJ' || r.bucket === 'DEMAIN'))
    .sort((a, b) => (a.days == null ? 1e9 : a.days) - (b.days == null ? 1e9 : b.days))
    .slice(0, 8);
  if (!alert.length) return '';
  const cards = alert.map(r => {
    const late = r.days != null && r.days < 0;
    const accent = late ? '#dc2626' : '#e8834a';
    const bg = late ? '#fef2f2' : '#fff8f3';
    const cd = r.days == null ? '' : late ? `${Math.abs(r.days)}j de retard` : r.days === 0 ? "Aujourd'hui" : 'Demain';
    return `<button class="pcok-alert" style="border-left:3px solid ${accent};background:${bg}" onclick="openDelivDrawer('${r.kind}','${r.id}')">
      <div class="pcok-alert-top"><span style="color:${accent};font-weight:800">${cd}</span><span class="pcok-alert-pct" style="color:${r.mode === 'livraison' ? '#c2410c' : '#1a4a3a'}">${r.mode === 'livraison' ? 'Livraison' : 'Retrait'}</span></div>
      <div class="pcok-alert-client">${_pcokEsc(r.client)}</div>
      <div class="pcok-alert-step">${(r.items || []).length} article(s)${r.commercial ? ' · ' + _pcokEsc(r.commercial) : ''}</div>
    </button>`;
  }).join('');
  return `<div class="pcok-alerts"><div class="pcok-alerts-title">Livraisons urgentes <span>${alert.length}</span></div><div class="pcok-alerts-row">${cards}</div></div>`;
}

function _delivTable(rows, showMoney) {
  if (!rows.length) return `<div class="pcok-empty">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
    <p>Aucune livraison${_delivState.filter !== 'ACTIVE' || _delivState.q ? ' dans ce filtre' : ''}</p>
  </div>`;
  const det = _delivState.density === 'detaille';
  const th = (key, label, cls = '') => {
    const active = key && _delivState.sort === key;
    const arrow = active ? (_delivState.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th class="pcok-th ${cls} ${active ? 'pcok-th--active' : ''}" ${key ? `onclick="setDelivSort('${key}')" style="cursor:pointer"` : ''}>${label}${arrow}</th>`;
  };
  const head = `<tr>
    ${th('', '')}
    ${th('client', 'Réf / Client')}
    ${th('echeance', 'Échéance')}
    ${det ? th('', 'Articles') : ''}
    ${th('', 'Mode')}
    ${det ? th('', 'Adresse') : ''}
    ${th('commercial', 'Commercial')}
    ${showMoney ? th('total', 'Total', 'pcok-num') : ''}
    <th class="pcok-th"></th>
  </tr>`;
  return `<div class="pcok-tablewrap"><table class="pcok-table"><thead>${head}</thead><tbody>${rows.map(r => _delivRow(r, showMoney, det)).join('')}</tbody></table></div>`;
}

function _delivRow(r, showMoney, det) {
  const dotC = r.status === 'cancelled' ? '#a8a29e' : r.status === 'completed' ? '#16a34a'
    : (r.days != null && r.days < 0) ? '#dc2626' : (r.days === 0 || r.days === 1) ? '#e8834a' : r.days == null ? '#a8a29e' : '#2563eb';
  const dot = `<span class="pcok-prio" style="background:${dotC}"></span>`;
  let ech = '—', echC = 'var(--color-text-secondary)';
  if (r.ymd) {
    ech = new Date(r.ymd + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    if (r.status === 'pending') { if (r.days < 0) echC = '#dc2626'; else if (r.days === 0 || r.days === 1) echC = '#e8834a'; }
  }
  const ret = _delivRetInfo(r);
  const echCell = `<div style="color:${echC};font-weight:600">${ech}</div><div class="pcok-ret" style="color:${ret.col};background:${ret.col}1a;margin-top:2px">${ret.txt}</div>`;
  const modeChip = `<span style="font-size:10px;font-weight:700;color:${r.mode === 'livraison' ? '#c2410c' : '#1a4a3a'}">${r.mode === 'livraison' ? 'Livraison' : 'Retrait'}</span>`;
  const first = (r.items || [])[0];
  const shortItems = !(r.items || []).length ? '—' : (r.items.length === 1 ? `${first.name} ×${first.qty || 1}` : `${first.name} +${r.items.length - 1}`);
  const typeLabel = r.kind === 'reservation' ? 'Réservation' : 'Commande';
  const accent = r.status === 'pending' && r.days != null && r.days < 0 ? 'inset 3px 0 0 #dc2626'
    : (r.status === 'pending' && (r.days === 0 || r.days === 1)) ? 'inset 3px 0 0 #e8834a' : '';
  return `<tr class="pcok-row ${r.status !== 'pending' ? 'pcok-row--done' : ''}" ${accent ? `style="box-shadow:${accent}"` : ''} onclick="openDelivDrawer('${r.kind}','${r.id}')">
    <td class="pcok-td-prio">${dot}</td>
    <td class="pcok-td-client"><div class="pcok-client">${_pcokEsc(r.client)}</div><div class="pcok-ref">${_pcokEsc(r.ref)} · ${typeLabel}</div></td>
    <td class="pcok-td-ech">${echCell}</td>
    ${det ? `<td class="pcok-muted">${_pcokEsc(shortItems)}</td>` : ''}
    <td>${modeChip}</td>
    ${det ? `<td class="pcok-muted" style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.mode === 'livraison' ? _pcokEsc(r.address || '—') : 'Boutique'}</td>` : ''}
    <td class="pcok-muted">${_pcokEsc(r.commercial || '—')}</td>
    ${showMoney ? `<td class="pcok-num" style="font-weight:700">${fmt(r.total)}</td>` : ''}
    <td class="pcok-td-act"><svg class="pcok-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></td>
  </tr>`;
}

// ── Drawer détail livraison ────────────────────────────────────────────────
function openDelivDrawer(kind, id) {
  const r = _delivBuildRows().find(x => x.kind === kind && String(x.id) === String(id));
  const drawer = document.getElementById('delivDrawer');
  const body   = document.getElementById('delivDrawerBody');
  if (!r || !drawer || !body) return;
  closeDrawers();
  body.innerHTML = _delivDrawerContent(r);
  drawer.classList.add('open');
  document.body.classList.add('pcok-drawer-open');
}

function _delivDrawerContent(r) {
  const showMoney = _DELIV_MONEY_ROLES.includes(currentUser?.role);
  const livTxt = r.ymd ? new Date(r.ymd + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' }) : 'Sans date';
  const dtxt = r.days == null ? '' : r.days < 0 ? `${Math.abs(r.days)}j de retard` : r.days === 0 ? "Aujourd'hui" : r.days === 1 ? 'Demain' : `${r.days}j`;
  const dCol = r.days != null && r.days < 0 ? '#dc2626' : (r.days === 0 || r.days === 1) ? '#e8834a' : '#16a34a';
  const stMap = { pending: ['#d97706', '#fef3c7', 'En cours'], completed: ['#16a34a', '#dcfce7', 'Livrée'], cancelled: ['#78716c', '#f5f5f4', 'Annulée'] };
  const [sc, sb, sl] = stMap[r.status] || ['#78716c', '#f5f5f4', '—'];
  const itemsHtml = (r.items || []).map(i => `<div class="pcok-drawer-item"><span>${_pcokEsc(i.name)} × ${i.qty || 1}</span>${showMoney ? `<b>${fmt((Number(i.price) || 0) * (Number(i.qty) || 1))}</b>` : ''}</div>`).join('') || '<div class="pcok-muted" style="font-size:12px">Aucun article</div>';
  const modeHtml = `<div class="pcok-drawer-item"><span>Mode</span><b>${r.mode === 'livraison' ? 'Livraison' : 'Retrait boutique'}</b></div>${r.mode === 'livraison' && r.address ? `<div class="pcok-drawer-item"><span>Adresse</span><b style="text-align:right;white-space:normal">${_pcokEsc(r.address)}</b></div>` : ''}`;
  const datesHtml = [
    _dispDate(r.dateClient) ? `<div class="pcok-drawer-item"><span>Livraison client</span><b>${_dispDate(r.dateClient)}</b></div>` : '',
    _dispDate(r.dateProd)   ? `<div class="pcok-drawer-item"><span style="color:#e8834a">Production</span><b>${_dispDate(r.dateProd)}</b></div>` : '',
  ].join('');
  const pipe = r.dossierId ? _cmdPipelineHtml(r.dossierId) : '';
  return `<div class="pcok-drawer-head">
      <div style="min-width:0">
        <div class="pcok-drawer-ref">${_pcokEsc(r.ref)}${r.commercial ? ' · ' + _pcokEsc(r.commercial) : ''}</div>
        <div class="pcok-drawer-client">${_pcokEsc(r.client)}</div>
      </div>
      <button class="pcok-drawer-close" onclick="closeDrawers()" aria-label="Fermer">×</button>
    </div>
    <div class="pcok-drawer-meta">
      <span class="pcok-badge" style="color:${sc};background:${sb}">${sl}</span>
      <span class="pcok-badge" style="color:${r.mode === 'livraison' ? '#c2410c' : '#1a4a3a'};background:${r.mode === 'livraison' ? '#ffedd5' : '#dcfce7'}">${r.mode === 'livraison' ? 'Livraison' : 'Retrait'}</span>
      ${r.contact ? `<span style="font-size:12.5px;color:var(--color-text-secondary)">${_pcokEsc(r.contact)}</span>` : ''}
    </div>
    <div class="pcok-drawer-ech" style="color:${dCol};margin-bottom:12px">Échéance : ${livTxt}${dtxt ? ' · ' + dtxt : ''}</div>
    <div class="pcok-drawer-pipe-title">Articles (${(r.items || []).length})</div>
    <div class="pcok-drawer-items">${itemsHtml}</div>
    <div class="pcok-drawer-pipe-title">Livraison</div>
    <div class="pcok-drawer-items">${modeHtml}${datesHtml}</div>
    ${pipe}
    ${_delivDrawerActions(r)}`;
}

function _delivDrawerActions(r) {
  const isCmd = r.kind === 'commande';
  const canAttrib = (typeof PAGE_ACCESS !== 'undefined') && PAGE_ACCESS.attribution && PAGE_ACCESS.attribution.includes(currentUser?.role);
  const btns = [];
  btns.push(`<button class="pcok-btn pcok-btn--primary" onclick="_delivPrintOne('${r.kind}','${r.id}')">Imprimer le bon</button>`);
  btns.push(`<button class="pcok-btn" onclick="closeDrawers();_openDeliverySource('${r.kind}','${r.id}','${r.dossierId}')">Ouvrir le dossier</button>`);
  if (isCmd) {
    btns.push(`<button class="pcok-btn" onclick="closeDrawers();editCommandeDateClient('${r.id}')">Date livraison</button>`);
    btns.push(`<button class="pcok-btn" onclick="closeDrawers();editCommandeDateProd('${r.id}')">Date production</button>`);
  }
  btns.push(`<button class="pcok-btn" onclick="_livCopy('${r.kind}','${r.id}')">Copier le récap</button>`);
  return `<div class="pcok-drawer-actions pcok-drawer-actions--wrap">${btns.join('')}</div>`;
}

// ── Impression : planning de livraison (A4 paysage, groupé par date d'échéance,
// retards visibles, colonnes vides à remplir à la main pour le suivi terrain).
function printLivraisons() {
  const rows = _delivSortRows(_delivFilterRows(_delivBuildRows()));
  if (!rows.length) { showToast('Aucune livraison à imprimer', 'error'); return; }
  const showMoney = _DELIV_MONEY_ROLES.includes(currentUser?.role);
  const shop = (typeof shopConfig !== 'undefined' && shopConfig && shopConfig.name) || 'FOREVER MG';
  const filterLbl = { ACTIVE: 'En cours', RETARD: 'En retard', AUJ: "Aujourd'hui", SEMAINE: 'Cette semaine', SANS_DATE: 'Sans date', TERMINE: 'Livrées', TOUS: 'Toutes' }[_delivState.filter] || '';
  const modeLbl = _delivState.mode === 'all' ? 'tous modes' : (_delivState.mode === 'livraison' ? 'livraison' : 'retrait');
  const late = rows.filter(r => r.status === 'pending' && r.days != null && r.days < 0).length;

  const groups = {}; const order = [];
  rows.forEach(r => { const k = r.ymd || '~'; if (!groups[k]) { groups[k] = { ymd: r.ymd, rows: [] }; order.push(k); } groups[k].rows.push(r); });
  order.sort((a, b) => { const ga = groups[a].ymd, gb = groups[b].ymd; if (!ga) return 1; if (!gb) return -1; return ga < gb ? -1 : ga > gb ? 1 : 0; });

  let seq = 0;
  const cols = showMoney ? 13 : 12;
  const body = order.map(k => {
    const g = groups[k];
    const meta = _delivDateLabel(g.ymd);
    const rws = g.rows.map(r => {
      seq++;
      const items = (r.items || []).map(i => `${i.name} ×${i.qty || 1}`).join(', ') || '—';
      const modeAddr = r.mode === 'livraison' ? ('Livraison' + (r.address ? ' — ' + r.address : '')) : 'Retrait boutique';
      const ret = _delivRetInfo(r);
      const lateCls = (r.status === 'pending' && r.days != null && r.days < 0) ? ' class="late b"' : (r.status === 'pending' && (r.days === 0 || r.days === 1)) ? ' class="soon b"' : '';
      return `<tr>
        <td class="c b">${seq}</td>
        <td${lateCls}>${ret.txt}</td>
        <td>${r.client}<div class="ref">${r.ref} · ${r.kind === 'reservation' ? 'Réservation' : 'Commande'}</div></td>
        <td>${r.contact || ''}</td>
        <td>${items}</td>
        <td>${modeAddr}</td>
        <td>${r.commercial || ''}</td>
        ${showMoney ? `<td class="r b">${fmt(r.total)}</td>` : ''}
        <td></td><td></td><td></td><td class="c"></td>
      </tr>`;
    }).join('');
    return `<tr class="grp"><td colspan="${cols}">${meta.label}${meta.tag ? ` — ${meta.tag}` : ''} · ${g.rows.length} livraison(s)</td></tr>${rws}`;
  }).join('');

  const w = window.open('', '_blank', 'width=1200,height=900');
  if (!w) { alert("Impression bloquée : autorisez les fenêtres pop-up pour ce site, puis réessayez."); return; }
  setTimeout(() => {
    w.document.write(`<html><head><meta charset="utf-8"><title>Planning de livraison</title><style>
      @page{size:A4 landscape;margin:8mm}
      *{box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0;font-size:10px}
      h1{font-size:15px;margin:0}
      .sub{color:#555;font-size:10px;margin:2px 0 8px}
      table{width:100%;border-collapse:collapse;table-layout:fixed}
      th,td{border:1px solid #555;padding:3px 4px;vertical-align:top;word-wrap:break-word}
      th{background:#e9e9e9;font-size:8.5px;text-transform:uppercase;text-align:center}
      td{height:30px}
      .c{text-align:center}.r{text-align:right;white-space:nowrap}.b{font-weight:bold}
      .ref{font-size:8px;color:#777;margin-top:1px}
      .grp td{background:#1a4a3a;color:#fff;font-weight:bold;font-size:10.5px;height:auto;text-transform:none}
      .late{color:#c00}.soon{color:#c2410c}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body onload="window.print()">
      <h1>${shop} — PLANNING DE LIVRAISON</h1>
      <div class="sub">${filterLbl} · ${modeLbl} · échéance ${_delivState.groupBy === 'prod' ? 'production' : 'client'}${_delivState.date ? ' · date ' + _dispDate(_delivState.date) : ''} · ${rows.length} livraison(s)${late ? ` · ${late} en retard` : ''} · édité le ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
      <table>
        <colgroup><col style="width:3%"><col style="width:7%"><col style="width:15%"><col style="width:9%"><col style="width:17%"><col style="width:15%"><col style="width:9%">${showMoney ? '<col style="width:7%">' : ''}<col style="width:8%"><col style="width:6%"><col style="width:9%"><col style="width:4%"></colgroup>
        <thead><tr>
          <th>N°</th><th>Retard</th><th>Client / Réf</th><th>Contact</th><th>Articles</th><th>Mode / Adresse</th><th>Commercial</th>${showMoney ? '<th>Total</th>' : ''}
          <th>Livreur</th><th>Heure sortie</th><th>Reçu par</th><th>✓</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </body></html>`);
    w.document.close();
  }, 200);
}

// Impression d'un bon de livraison individuel (avec zones à signer pour le suivi manuel).
function _delivPrintOne(kind, id) {
  const r = _delivBuildRows().find(x => x.kind === kind && String(x.id) === String(id));
  if (!r) return;
  const showMoney = _DELIV_MONEY_ROLES.includes(currentUser?.role);
  const shop = (typeof shopConfig !== 'undefined' && shopConfig && shopConfig.name) || 'FOREVER MG';
  const items = (r.items || []).map(i => `<tr><td>${i.name}</td><td class="c">${i.qty || 1}</td>${showMoney ? `<td class="r">${fmt((Number(i.price) || 0) * (Number(i.qty) || 1))}</td>` : ''}</tr>`).join('')
    || `<tr><td colspan="${showMoney ? 3 : 2}" class="muted c">Aucun article</td></tr>`;
  const ech = r.ymd ? (() => { const d = new Date(r.ymd + 'T00:00:00'); const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); })() : 'Sans date';
  const ret = _delivRetInfo(r);
  const body = `
    <h1>${shop} — Bon de livraison</h1>
    <div class="sub">${r.ref} · ${r.kind === 'reservation' ? 'Réservation' : 'Commande'} · édité le ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
    <table style="margin-bottom:10px"><tbody>
      <tr><th style="width:32%">Client</th><td>${r.client}${r.contact ? ' — ' + r.contact : ''}</td></tr>
      <tr><th>Mode</th><td>${r.mode === 'livraison' ? 'Livraison' : 'Retrait boutique'}</td></tr>
      ${r.mode === 'livraison' ? `<tr><th>Adresse</th><td>${r.address || '—'}</td></tr>` : ''}
      <tr><th>Échéance</th><td>${ech} — <b>${ret.txt}</b></td></tr>
      ${_dispDate(r.dateProd) ? `<tr><th>Date production</th><td>${_dispDate(r.dateProd)}</td></tr>` : ''}
      <tr><th>Commercial</th><td>${r.commercial || '—'}</td></tr>
    </tbody></table>
    <h2>Articles</h2>
    <table><thead><tr><th>Désignation</th><th class="c">Qté</th>${showMoney ? '<th class="r">Montant</th>' : ''}</tr></thead><tbody>${items}</tbody></table>
    ${showMoney ? `<table style="margin-top:6px"><tbody><tr style="font-weight:bold;border-top:2px solid #1a4a3a"><td>TOTAL</td><td></td><td class="r">${fmt(r.total)}</td></tr></tbody></table>` : ''}
    <div style="margin-top:30px;display:flex;gap:40px;font-size:11px">
      <div style="flex:1">Livreur : ______________________<br><br>Date / heure de sortie : ______________</div>
      <div style="flex:1">Reçu par (nom + signature) :<br><br>___________________________________</div>
    </div>
    <div class="foot">Bon de livraison — suivi manuel des sorties</div>`;
  _pcfOpenReportWindow(body, 'Bon de livraison — ' + r.ref);
}

// Badge nav Livraisons : nb de livraisons en cours dues sous 1 jour (retard/auj./demain).
function updateDeliveryBadge() {
  const badge = document.getElementById('navDelivBadge');
  if (!badge) return;
  const today = new Date(); today.setHours(0,0,0,0);
  let urgent = 0;
  _collectDeliveries().forEach(x => {
    if (x.status !== 'pending') return;
    const iso = x.dateClient || x.dateProd;
    if (!iso) return;
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return;
    if (Math.round((d - today) / 86400000) <= 1) urgent++;
  });
  if (urgent > 0) { badge.textContent = urgent; badge.style.display = ''; }
  else badge.style.display = 'none';
}

// ============================================================
// PAGE FINANCES — registre de toutes les commandes (engagé / acompte / restant),
// numéros séquentiels (références qui se suivent), groupé par date, état de
// livraison, impression A4. UX pcf-* (hero/KPIs, scanabilité, disclosure, kebab,
// table responsive → cartes mobile, 80/20).
// ============================================================
let _finState = { period: 'all', pay: 'all', q: '', from: '', to: '' };
let _finItemOpen = new Set();
function setFinPeriod(v) { _finState.period = v; _finState.from = ''; _finState.to = ''; renderFinances(); }
// IMPORTANT : ne PAS re-render ici. renderFinances() reconstruit tout le panneau
// (root.innerHTML) → l'<input type=date> en cours de saisie est détruit et le curseur
// saute (surtout au moment où l'année se complète, ce qui déclenche onchange). On met
// juste à jour l'état ; le re-render se fait au blur (quand on quitte le champ).
function setFinFrom(v)   { _finState.from = v; _finState.period = null; }
function setFinTo(v)     { _finState.to = v;   _finState.period = null; }
function commitFinDates(){ renderFinances(); }
function setFinClearDates() { _finState.from = ''; _finState.to = ''; _finState.period = 'all'; renderFinances(); }
function setFinPay(v)    { _finState.pay = v;    renderFinances(); }
function setFinSearch(v) { _finState.q = v;      renderFinances(); }
function toggleFinItem(id) { if (_finItemOpen.has(id)) _finItemOpen.delete(id); else _finItemOpen.add(id); renderFinances(); }

// Numérotation séquentielle STABLE des opérations (par date de création, sur TOUS les
// enregistrements y compris annulés → ne se décale pas quand on annule/filtre). Partagée
// par Finances / Attribution / Production / Livraisons → références cohérentes partout.
function _buildSeqMaps() {
  const mk = arr => {
    const m = new Map();
    (Array.isArray(arr) ? arr : []).slice()
      .sort((a, b) => (parseSaleDate(a.date) || 0) - (parseSaleDate(b.date) || 0))
      .forEach((o, i) => m.set(String(o.id), i + 1));
    return m;
  };
  return { cmd: mk(commandes), res: mk(reservations) };
}
function _seqRefOf(kind, id, maps) {
  const m = (kind === 'reservation') ? maps.res : maps.cmd;
  const n = m.get(String(id));
  return (kind === 'reservation' ? 'RES' : 'CMD') + '-' + (n ? String(n).padStart(3, '0') : '—');
}

function _finPeriodRange() {
  // Plage de dates personnalisée (Du / Au) prioritaire sur les périodes prédéfinies.
  if (_finState.from || _finState.to) {
    return {
      from: _finState.from ? new Date(_finState.from + 'T00:00:00') : null,
      to:   _finState.to   ? new Date(_finState.to   + 'T23:59:59') : null
    };
  }
  const now = new Date();
  if (_finState.period === 'week')  { const f = new Date(now); f.setDate(f.getDate() - 6); f.setHours(0,0,0,0); return { from: f, to: null }; }
  if (_finState.period === 'month') { return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null }; }
  return { from: null, to: null };
}

// Libellé de la période courante (pour l'en-tête des impressions).
function _finPeriodLabel() {
  if (_finState.from || _finState.to) {
    const f = _finState.from ? new Date(_finState.from + 'T00:00:00').toLocaleDateString('fr-FR') : '…';
    const t = _finState.to   ? new Date(_finState.to   + 'T00:00:00').toLocaleDateString('fr-FR') : "aujourd'hui";
    return `Du ${f} au ${t}`;
  }
  return _finState.period === 'week' ? '7 derniers jours' : _finState.period === 'month' ? 'Ce mois' : 'Toutes les opérations';
}

// État de livraison (commande OU réservation) dérivé du dossier de production lié.
function _finDelivState(kind, o) {
  const dos = (Array.isArray(dossiers) ? dossiers : []).find(d => d.sourceType === kind && String(d.sourceId) === String(o.id));
  const prog = dos ? (Number(dos.progression) || 0) : 0;
  const mode = o.deliveryMode === 'livraison' ? 'Livraison' : 'Retrait';
  let label, color;
  if (o.status === 'completed' || prog >= 100 || (dos && dos.statut === 'LIVRE')) { label = 'Livrée'; color = '#16a34a'; }
  else if (prog > 0) { label = 'En production'; color = '#e8834a'; }
  else { label = 'À traiter'; color = '#2563eb'; }
  return { label, color, prog, mode };
}

// Entrée normalisée (commande ou réservation) pour le registre financier.
function _finEntry(kind, o, maps) {
  return {
    kind, id: String(o.id), obj: o, date: o.date,
    ref: _seqRefOf(kind, o.id, maps),
    client: o.clientName || 'Client', contact: o.clientContact || '',
    total: Number(o.total) || 0,
    accompte: Number(o.accompte != null ? o.accompte : o.acompte) || 0,
    restant: Number(o.restant) || 0,
    deliveryMode: o.deliveryMode,
    deliveryDate: kind === 'reservation' ? o.deliveryDate : o.dateLivraison,
    address: kind === 'reservation' ? o.deliveryAddress : o.adresseLivraison,
    items: o.items || []
  };
}

// Construit le registre (commandes + réservations non annulées), trié par date, filtré.
// La numérotation (_seqRefOf) est globale/stable, indépendante des filtres.
function _finBuild() {
  const maps = _buildSeqMaps();
  let entries = [];
  (Array.isArray(commandes) ? commandes : []).filter(c => c && c.status !== 'cancelled').forEach(c => entries.push(_finEntry('commande', c, maps)));
  (Array.isArray(reservations) ? reservations : []).filter(r => r && r.status !== 'cancelled').forEach(r => entries.push(_finEntry('reservation', r, maps)));
  entries.sort((a, b) => (parseSaleDate(a.date) || 0) - (parseSaleDate(b.date) || 0));
  const { from, to } = _finPeriodRange();
  const q = (_finState.q || '').trim().toLowerCase();
  const list = entries.filter(e => {
    const d = parseSaleDate(e.date);
    if (from && d && d < from) return false;
    if (to && d && d > to) return false;
    if (_finState.pay === 'unpaid' && !(e.restant > 0)) return false;
    if (_finState.pay === 'paid' && e.restant > 0) return false;
    if (q && !((e.client + ' ' + e.contact + ' ' + e.ref).toLowerCase().includes(q))) return false;
    return true;
  });
  return { list };
}

function _finPrintArg(e) {
  return e.kind === 'reservation'
    ? `printReservationTicket(reservations.find(x=>String(x.id)==='${e.id}'))`
    : `printCommandeTicket(commandes.find(x=>String(x.id)==='${e.id}'))`;
}

function _finRow(e, colspan) {
  const rid = e.kind + '_' + e.id;
  const open = _finItemOpen.has(rid);
  const ds = _finDelivState(e.kind, e.obj);
  const reste = e.restant;
  const kindColor = e.kind === 'reservation' ? '#e8834a' : '#1a4a3a';
  const seqNum = (e.ref.split('-')[1] || '');
  const truck = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>';
  const shop  = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/></svg>';
  const etat = `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:${ds.color}1a;color:${ds.color};white-space:nowrap">${ds.mode === 'Livraison' ? truck : shop} ${ds.mode} · ${ds.label}</span>`;
  const chev = '<svg class="pcf-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  const kbid = 'fin' + rid;
  const dt = (l, v) => v ? `<div class="pcf-dt"><div class="pcf-dt-l">${l}</div><div class="pcf-dt-v" style="font-size:13px">${v}</div></div>` : '';
  const itemsFull = (e.items || []).map(i => `${i.name} ×${i.qty || 1}`).join(', ') || '—';
  const printArg = _finPrintArg(e);
  const detail = `<tr class="pcf-detail-row"><td colspan="${colspan}"><div class="pcf-detail ${open ? 'open' : ''}">
      <div class="pcf-detail-grid">
        ${dt('Type', e.kind === 'reservation' ? 'Réservation' : 'Commande')}
        ${dt('Réf. facture', e.obj.numeroDossier || (e.ref))}
        ${dt('Contact', e.contact)}
        ${dt('Articles', itemsFull)}
        ${e.deliveryMode === 'livraison' ? dt('Adresse', e.address || '—') : dt('Mode', 'Retrait boutique')}
        ${dt('Livraison client', _dispDate(e.deliveryDate))}
        ${dt('Avancement', ds.prog + ' %')}
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="deliv-open-btn" onclick="event.stopPropagation();${printArg}">Imprimer la facture</button>
        <button class="pcf-export-btn" onclick="event.stopPropagation();showPage('${e.kind === 'reservation' ? 'reservations' : 'commandes'}')">Voir le détail</button>
      </div>
    </div></td></tr>`;
  return `<tr class="pcf-row ${open ? 'open' : ''}" onclick="toggleFinItem('${rid}')">
    <td class="pcf-c-main" data-label="N°">
      <div style="display:flex;align-items:center;gap:9px;min-width:0">
        ${chev}
        <span class="pcf-rank" style="background:${kindColor}1a;color:${kindColor}">${seqNum}</span>
        <div style="min-width:0">
          <div class="pcf-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.client}</div>
          <div style="font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums">${e.ref}</div>
        </div>
      </div>
    </td>
    <td data-label="État">${etat}</td>
    <td class="pcf-num" data-label="Total engagé">${fmt(e.total)}</td>
    <td class="pcf-num" data-label="Acompte" style="color:#16a34a">${fmt(e.accompte)}</td>
    <td class="pcf-num" data-label="Restant" style="${reste > 0 ? 'color:#dc2626;font-weight:800' : 'color:var(--muted)'}">${fmt(reste)}</td>
    <td class="pcf-c-act" onclick="event.stopPropagation()">
      <div class="kebab-wrap" style="display:inline-block;vertical-align:middle">
        <button class="kebab-btn" aria-label="Plus d'actions" onclick="toggleKebab('${kbid}',event)"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>
        <div class="kebab-menu" id="kb-${kbid}" role="menu">
          <button class="kebab-item" role="menuitem" onclick="closeAllKebabs();${printArg}">${_kebabIcon('print')}<span>Imprimer la facture</span></button>
          <button class="kebab-item" role="menuitem" onclick="closeAllKebabs();showPage('${e.kind === 'reservation' ? 'reservations' : 'commandes'}')">${_kebabIcon('eye')}<span>Voir le détail</span></button>
        </div>
      </div>
    </td>
  </tr>${detail}`;
}

function renderFinances() {
  const root = document.getElementById('financesContent');
  if (!root) return;
  const colspan = 6;
  const { list } = _finBuild();

  const tEng = list.reduce((s, e) => s + e.total, 0);
  const tAcc = list.reduce((s, e) => s + e.accompte, 0);
  const tRes = list.reduce((s, e) => s + e.restant, 0);
  const rate = tEng > 0 ? Math.round(tAcc / tEng * 100) : 0;
  const nb = list.length;
  const panier = nb ? Math.round(tEng / nb) : 0;

  const seg = (val, cur, label, fn) => `<button class="pcf-seg ${cur === val ? 'active' : ''}" onclick="${fn}('${val}')">${label}</button>`;
  let html = `
    <div class="pcf-toolbar">
      <div class="pcf-segs">${seg('all', _finState.period, 'Tout', 'setFinPeriod')}${seg('month', _finState.period, 'Ce mois', 'setFinPeriod')}${seg('week', _finState.period, '7 jours', 'setFinPeriod')}</div>
      <div class="pcf-segs" style="gap:7px;align-items:center;padding:4px 9px">
        <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">Du</span>
        <input type="date" id="finDateFrom" value="${_finState.from || ''}" oninput="setFinFrom(this.value)" onblur="commitFinDates()" style="border:none;background:transparent;font-size:12px;font-weight:600;color:var(--text);font-family:inherit;outline:none;width:122px" />
        <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">Au</span>
        <input type="date" id="finDateTo" value="${_finState.to || ''}" oninput="setFinTo(this.value)" onblur="commitFinDates()" style="border:none;background:transparent;font-size:12px;font-weight:600;color:var(--text);font-family:inherit;outline:none;width:122px" />
        ${(_finState.from || _finState.to) ? `<button onclick="setFinClearDates()" title="Effacer la plage de dates" style="border:none;background:var(--surface);color:var(--muted);cursor:pointer;font-size:15px;line-height:1;padding:2px 7px;border-radius:6px">×</button>` : ''}
      </div>
      <div class="pcf-segs">${seg('all', _finState.pay, 'Toutes', 'setFinPay')}${seg('unpaid', _finState.pay, 'À solder', 'setFinPay')}${seg('paid', _finState.pay, 'Soldées', 'setFinPay')}</div>
      <div class="pcf-tools">
        <button class="pcf-export-btn" onclick="printFicheSortie()"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Fiche de sortie</button>
        <button class="pcf-export-btn" onclick="printFinances()"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Imprimer</button>
      </div>
    </div>
    <div class="pcf-hero">
      <div>
        <div class="pcf-hero-label">Total engagé · ${nb} opération(s)</div>
        <div class="pcf-hero-val">${fmt(tEng)}</div>
        <div class="pcf-hero-meta">Panier moyen ${fmt(panier)} · commandes + réservations</div>
      </div>
      <div class="pcf-gauge">
        <div class="pcf-gauge-top"><span>Taux d'encaissement</span><strong>${rate}%</strong></div>
        <div class="pcf-gauge-bar"><div class="pcf-gauge-fill" style="width:${rate}%"></div></div>
        <div class="pcf-gauge-legend">
          <span><i class="pcf-dot" style="background:#bfe3d4"></i>Encaissé <b>${fmt(tAcc)}</b></span>
          <span><i class="pcf-dot" style="background:#ff8f8f"></i>À percevoir <b>${fmt(tRes)}</b></span>
        </div>
      </div>
    </div>
    <div class="pcf-kpis">
      <div class="pcf-kpi" style="--kc:#1a4a3a"><div class="pcf-kpi-label">Total engagé</div><div class="pcf-kpi-val">${fmt(tEng)}</div><div class="pcf-kpi-sub">${nb} opération(s)</div></div>
      <div class="pcf-kpi" style="--kc:#16a34a"><div class="pcf-kpi-label">Acompte reçu</div><div class="pcf-kpi-val" style="color:#16a34a">${fmt(tAcc)}</div><div class="pcf-kpi-sub">${rate}% encaissé</div></div>
      <div class="pcf-kpi" style="--kc:#dc2626"><div class="pcf-kpi-label">Restant à percevoir</div><div class="pcf-kpi-val" style="color:#dc2626">${fmt(tRes)}</div><div class="pcf-kpi-sub">${list.filter(e => e.restant > 0).length} à solder</div></div>
      <div class="pcf-kpi" style="--kc:#2563eb"><div class="pcf-kpi-label">Panier moyen</div><div class="pcf-kpi-val">${fmt(panier)}</div><div class="pcf-kpi-sub">par opération</div></div>
    </div>`;

  if (!list.length) {
    html += `<div class="pcf-empty">Aucune opération sur cette période.</div>`;
    root.innerHTML = html;
    return;
  }

  // Groupes par jour (ordre chronologique croissant — les N° se suivent de haut en bas)
  const groups = {}; const order = [];
  list.forEach(e => { const k = _histDayKey(e.date); if (!groups[k]) { groups[k] = { date: e.date, rows: [], eng: 0, acc: 0, res: 0 }; order.push(k); } const g = groups[k]; g.rows.push(e); g.eng += e.total; g.acc += e.accompte; g.res += e.restant; });
  order.sort((a, b) => (parseSaleDate(groups[a].date) || 0) - (parseSaleDate(groups[b].date) || 0));

  html += order.map(k => {
    const g = groups[k];
    return `<div class="pcf-card">
      <div class="pcf-card-head">
        <div class="ic" style="background:#1a4a3a14;color:#1a4a3a"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
        <div style="flex:1;min-width:0"><div class="pcf-card-title">${_histDayLabel(g.date)}</div><div class="pcf-card-sub">${g.rows.length} opération(s) · engagé ${fmt(g.eng)} · reste ${fmt(g.res)}</div></div>
        <span class="pcf-card-badge" style="background:#1a4a3a14;color:#1a4a3a">${fmt(g.eng)}</span>
      </div>
      <table class="pcf-table">
        <thead><tr><th>N° / Client</th><th>État livraison</th><th class="pcf-num">Total engagé</th><th class="pcf-num">Acompte</th><th class="pcf-num">Restant</th><th></th></tr></thead>
        <tbody>${g.rows.map(e => _finRow(e, colspan)).join('')}</tbody>
      </table>
    </div>`;
  }).join('');

  root.innerHTML = html;
}

// Impression A4 du registre financier (réutilise la fenêtre report de la vue patron).
function printFinances() {
  const { list } = _finBuild();
  if (!list.length) { showToast('Aucune opération à imprimer', 'error'); return; }
  const tEng = list.reduce((s, e) => s + e.total, 0);
  const tAcc = list.reduce((s, e) => s + e.accompte, 0);
  const tRes = list.reduce((s, e) => s + e.restant, 0);
  const shop = (shopConfig && shopConfig.name) || 'FOREVER MG';
  const periodLbl = _finPeriodLabel();

  const groups = {}; const order = [];
  list.forEach(e => { const k = _histDayKey(e.date); if (!groups[k]) { groups[k] = { date: e.date, rows: [], eng: 0, acc: 0, res: 0 }; order.push(k); } const g = groups[k]; g.rows.push(e); g.eng += e.total; g.acc += e.accompte; g.res += e.restant; });
  order.sort((a, b) => (parseSaleDate(groups[a].date) || 0) - (parseSaleDate(groups[b].date) || 0));

  let body = `<h1>${shop} — Suivi financier</h1>
    <div class="sub">${periodLbl} · ${list.length} opération(s) (commandes + réservations) · édité le ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR')}</div>
    <div class="kpis">
      <div class="kpi"><div class="l">Total engagé</div><div class="v">${fmt(tEng)}</div></div>
      <div class="kpi"><div class="l">Acompte reçu</div><div class="v g">${fmt(tAcc)}</div></div>
      <div class="kpi"><div class="l">Restant à percevoir</div><div class="v rd">${fmt(tRes)}</div></div>
    </div>`;

  body += order.map(k => {
    const g = groups[k];
    const rows = g.rows.map(e => {
      const ds = _finDelivState(e.kind, e.obj);
      return `<tr>
        <td>${e.ref}</td>
        <td>${e.client}</td>
        <td>${ds.mode} · ${ds.label}</td>
        <td class="r">${fmt(e.total)}</td>
        <td class="r g">${fmt(e.accompte)}</td>
        <td class="r ${e.restant > 0 ? 'rd' : 'muted'}">${fmt(e.restant)}</td>
      </tr>`;
    }).join('');
    return `<h2>${_histDayLabel(g.date)} — engagé ${fmt(g.eng)} · acompte ${fmt(g.acc)} · reste ${fmt(g.res)}</h2>
      <table><thead><tr><th>N°</th><th>Client</th><th>État livraison</th><th class="r">Total engagé</th><th class="r">Acompte</th><th class="r">Restant</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }).join('');

  body += `<table style="margin-top:14px"><tbody><tr style="font-weight:bold;border-top:2px solid #1a4a3a">
    <td>TOTAL GÉNÉRAL</td><td></td><td></td>
    <td class="r">${fmt(tEng)}</td><td class="r g">${fmt(tAcc)}</td><td class="r rd">${fmt(tRes)}</td></tr></tbody></table>
    <div class="foot">Document interne — suivi manuel des encaissements</div>`;

  _pcfOpenReportWindow(body, 'Suivi financier');
}

// Impression « FICHE DE SORTIE » (registre manuel paiements/livraison, format paysage A4).
// Pré-remplit ce qu'on connaît (N° séquentiel, Client, Total, Avance date+mode+montant) ;
// laisse vides les colonnes à remplir à la main (Reste à payer par mode, Livreur, Date de
// sortie, Remarque, Donneur, Récept.).
function printFicheSortie() {
  const { list } = _finBuild();
  if (!list.length) { showToast('Aucune opération à imprimer', 'error'); return; }
  const shop = (shopConfig && shopConfig.name) || 'FOREVER MG';
  const periodLbl = _finPeriodLabel();

  const rows = list.map((e, i) => {
    const m  = e.obj.depositMethod === 'mobile' ? 'mobile' : e.obj.depositMethod === 'cheque' ? 'cheque' : 'cash';
    const av = e.accompte;
    const dateAv = av > 0 ? (parseSaleDate(e.date) || new Date()).toLocaleDateString('fr-FR') : '';
    return `<tr>
      <td class="c b">${i + 1}</td>
      <td>${e.client}<div class="ref">${e.ref}</div></td>
      <td class="r b">${fmt(e.total)}</td>
      <td class="c">${dateAv}</td>
      <td class="r">${m === 'cash'   && av ? fmt(av) : ''}</td>
      <td class="r">${m === 'mobile' && av ? fmt(av) : ''}</td>
      <td class="r">${m === 'cheque' && av ? fmt(av) : ''}</td>
      <td></td><td></td><td></td>
      <td></td><td class="c">${_dispDate(e.deliveryDate)}</td><td></td><td></td><td></td>
    </tr>`;
  }).join('');

  const w = window.open('', '_blank', 'width=1200,height=900');
  if (!w) { alert("Impression bloquée : autorisez les fenêtres pop-up pour ce site, puis réessayez."); return; }
  setTimeout(() => {
    w.document.write(`<html><head><meta charset="utf-8"><title>Fiche de sortie</title><style>
      @page{size:A4 landscape;margin:8mm}
      *{box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0;font-size:10px}
      h1{font-size:15px;margin:0}
      .sub{color:#555;font-size:10px;margin:2px 0 8px}
      table{width:100%;border-collapse:collapse;table-layout:fixed}
      th,td{border:1px solid #555;padding:3px 4px;vertical-align:top;word-wrap:break-word}
      th{background:#e9e9e9;font-size:8.5px;text-transform:uppercase;text-align:center}
      td{height:30px}
      .c{text-align:center}.r{text-align:right;white-space:nowrap}.b{font-weight:bold}
      .ref{font-size:8px;color:#777;margin-top:1px}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body onload="window.print()">
      <h1>${shop} — FICHE DE SORTIE</h1>
      <div class="sub">${periodLbl} · ${list.length} opération(s) · édité le ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR')}</div>
      <table>
        <colgroup><col style="width:3%"><col style="width:13%"><col style="width:8%"><col style="width:7%"><col style="width:6%"><col style="width:6%"><col style="width:6%"><col style="width:6%"><col style="width:6%"><col style="width:6%"><col style="width:8%"><col style="width:7%"><col style="width:8%"><col style="width:6%"><col style="width:6%"></colgroup>
        <thead>
          <tr>
            <th rowspan="2">N°</th><th rowspan="2">Client</th><th rowspan="2">Total</th>
            <th colspan="4">Avance</th>
            <th colspan="3">Reste à payer</th>
            <th rowspan="2">Livreur</th><th rowspan="2">Date de sortie</th><th rowspan="2">Remarque</th><th rowspan="2">Donneur</th><th rowspan="2">Récept.</th>
          </tr>
          <tr>
            <th>Date</th><th>Espèce</th><th>Mobile M</th><th>Chèque</th>
            <th>Espèce</th><th>Mobile M</th><th>Chèque</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>`);
    w.document.close();
  }, 200);
}

// ============================================================
// PERFORMANCE / ÉVALUATION OPÉRATEURS — page dédiée (design system pcf-*)
// Mesure, par tâche attribuée : le délai de démarrage (attribution → début)
// et la durée d'exécution (début → fin). Agrégé par opérateur, imprimable.
// ============================================================
let _perfState = { period: 'all', search: '', from: '', to: '' };
let _perfOpen  = new Set();
let _perfLast  = null;

function setPerfPeriod(p) { _perfState.period = p; if (p !== 'range') { _perfState.from = ''; _perfState.to = ''; } renderPerf(); }
function setPerfFrom(v)   { _perfState.from = v; _perfState.period = 'range'; }
function setPerfTo(v)     { _perfState.to = v; _perfState.period = 'range'; }
function commitPerfDates(){ renderPerf(); }
function setPerfClearDates(){ _perfState.from = ''; _perfState.to = ''; _perfState.period = 'all'; renderPerf(); }
function setPerfSearch(v) { _perfState.search = v; renderPerf(); }
function togglePerfOp(key){ if (_perfOpen.has(key)) _perfOpen.delete(key); else _perfOpen.add(key); renderPerf(); }

// Format d'un délai/durée pouvant dépasser l'heure ou le jour.
function _fmtDelai(ms) {
  if (ms == null) return '—';
  if (ms < 0) ms = 0;
  const tot = Math.floor(ms / 1000);
  const d = Math.floor(tot / 86400), h = Math.floor((tot % 86400) / 3600), m = Math.floor((tot % 3600) / 60), s = tot % 60;
  if (d > 0) return d + 'j ' + h + 'h';
  if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
  if (m > 0) return m + 'm ' + String(s).padStart(2, '0') + 's';
  return s + 's';
}
function _perfPeriodLabel() {
  if (_perfState.from || _perfState.to) return 'Du ' + (_perfState.from || '…') + ' au ' + (_perfState.to || '…');
  return { all: 'Tout l\'historique', month: 'Ce mois-ci', week: '7 derniers jours' }[_perfState.period] || 'Tout l\'historique';
}

function _perfBuild() {
  const now = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const inPeriod = (ts) => {
    if (_perfState.from || _perfState.to) {
      if (ts == null) return false;
      const d = new Date(ts);
      if (_perfState.from && d < new Date(_perfState.from + 'T00:00:00')) return false;
      if (_perfState.to   && d > new Date(_perfState.to   + 'T23:59:59')) return false;
      return true;
    }
    if (_perfState.period === 'all') return true;
    if (ts == null) return false;
    if (_perfState.period === 'week')  return ts >= today.getTime() - 6 * 86400000;
    if (_perfState.period === 'month') { const d = new Date(ts), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth(); }
    return true;
  };

  const map = {};
  const all = _allTachesMerged();
  for (const t of all) {
    const opRaw = (t.operateur || '').trim();
    if (!opRaw) continue;
    const aMs = _parseTacheTs(t.dateAssignation);
    if (!inPeriod(aMs)) continue;
    const sMs = _tacheStartMs(t);
    const eMs = _tacheEndMs(t);
    const started = t.statut === 'EN_COURS' || t.statut === 'TERMINE';
    const done = t.statut === 'TERMINE';
    const startDelay = (started && aMs && sMs && sMs >= aMs) ? sMs - aMs : null;
    const exec = done ? ((sMs && eMs && eMs >= sMs) ? eMs - sMs : null)
                      : (t.statut === 'EN_COURS' && sMs ? now - sMs : null);
    const key = _pcfSlug(_resolveOperatorLabel(opRaw)) || _pcfSlug(opRaw);
    if (!map[key]) map[key] = { key, nom: _resolveOperatorLabel(opRaw), raw: opRaw,
      nbAssigned: 0, nbStarted: 0, nbDone: 0, nbEnCours: 0,
      sumDelay: 0, nDelay: 0, sumExec: 0, nExec: 0, totalTime: 0, tasks: [] };
    const o = map[key];
    o.nbAssigned++;
    if (started) o.nbStarted++;
    if (done) o.nbDone++;
    if (t.statut === 'EN_COURS') o.nbEnCours++;
    if (startDelay != null) { o.sumDelay += startDelay; o.nDelay++; }
    if (done && exec != null) { o.sumExec += exec; o.nExec++; }
    o.totalTime += _tacheDureeMs(t, now);
    const dos = t.dossierId === 'LIBRE' ? null : dossiers.find(x => x.id === t.dossierId);
    o.tasks.push({ t, aMs, sMs, eMs, started, done, startDelay, exec, statut: t.statut,
      label: t.dossierId === 'LIBRE' ? (t.titre || t.etapeLabel || 'Tâche libre') : (t.etapeLabel || t.etapeCode || 'Tâche'),
      num: t.dossierId === 'LIBRE' ? 'Libre' : (t.numeroDossier || ''),
      client: (dos && dos.client) || '' });
  }

  let ops = Object.values(map);
  const q = (_perfState.search || '').trim().toLowerCase();
  if (q) ops = ops.filter(o => o.nom.toLowerCase().includes(q) || o.raw.toLowerCase().includes(q));
  ops.forEach(o => {
    o.avgDelay = o.nDelay ? o.sumDelay / o.nDelay : null;
    o.avgExec  = o.nExec  ? o.sumExec  / o.nExec  : null;
    o.tasks.sort((a, b) => (b.aMs || 0) - (a.aMs || 0));
  });
  ops.sort((a, b) => (b.nbDone - a.nbDone) || ((a.avgExec == null ? Infinity : a.avgExec) - (b.avgExec == null ? Infinity : b.avgExec)));

  const totals = ops.reduce((s, o) => {
    s.nbAssigned += o.nbAssigned; s.nbDone += o.nbDone; s.nbEnCours += o.nbEnCours;
    s.sumDelay += o.sumDelay; s.nDelay += o.nDelay; s.sumExec += o.sumExec; s.nExec += o.nExec; s.totalTime += o.totalTime;
    return s;
  }, { nbAssigned: 0, nbDone: 0, nbEnCours: 0, sumDelay: 0, nDelay: 0, sumExec: 0, nExec: 0, totalTime: 0 });
  totals.avgDelay = totals.nDelay ? totals.sumDelay / totals.nDelay : null;
  totals.avgExec  = totals.nExec  ? totals.sumExec  / totals.nExec  : null;
  return { ops, totals };
}

function renderPerf() {
  const root = document.getElementById('perfContent');
  if (!root) return;
  const { ops, totals } = _perfBuild();
  _perfLast = { ops, totals, periodLabel: _perfPeriodLabel() };

  const rate = totals.nbAssigned > 0 ? Math.round(totals.nbDone / totals.nbAssigned * 100) : 0;
  const fastest = ops.filter(o => o.avgExec != null).sort((a, b) => a.avgExec - b.avgExec)[0];

  const seg = (val, label) => `<button class="pcf-seg ${_perfState.period === val ? 'active' : ''}" onclick="setPerfPeriod('${val}')">${label}</button>`;
  let html = `
    <div class="pcf-toolbar">
      <div class="pcf-segs">${seg('all', 'Tout')}${seg('month', 'Ce mois')}${seg('week', '7 jours')}</div>
      <div class="pcf-segs" style="gap:7px;align-items:center;padding:4px 9px">
        <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">Du</span>
        <input type="date" id="perfDateFrom" value="${_perfState.from || ''}" oninput="setPerfFrom(this.value)" onblur="commitPerfDates()" style="border:none;background:transparent;font-size:12px;font-weight:600;color:var(--text);font-family:inherit;outline:none;width:122px" />
        <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">Au</span>
        <input type="date" id="perfDateTo" value="${_perfState.to || ''}" oninput="setPerfTo(this.value)" onblur="commitPerfDates()" style="border:none;background:transparent;font-size:12px;font-weight:600;color:var(--text);font-family:inherit;outline:none;width:122px" />
        ${(_perfState.from || _perfState.to) ? `<button onclick="setPerfClearDates()" title="Effacer la plage" style="border:none;background:var(--surface);color:var(--muted);cursor:pointer;font-size:15px;line-height:1;padding:2px 7px;border-radius:6px">×</button>` : ''}
      </div>
      <div class="pcf-tools">
        <button class="pcf-export-btn" onclick="printPerf()"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Imprimer le bilan</button>
      </div>
    </div>
    <div class="pcf-hero">
      <div>
        <div class="pcf-hero-label">Durée moyenne d'exécution · ${totals.nbDone} tâche(s) terminée(s)</div>
        <div class="pcf-hero-val">${totals.avgExec != null ? _fmtDelai(totals.avgExec) : '—'}</div>
        <div class="pcf-hero-meta">Délai moyen de démarrage ${totals.avgDelay != null ? _fmtDelai(totals.avgDelay) : '—'} · ${ops.length} opérateur(s)</div>
      </div>
      <div class="pcf-gauge">
        <div class="pcf-gauge-top"><span>Taux de réalisation</span><strong>${rate}%</strong></div>
        <div class="pcf-gauge-bar"><div class="pcf-gauge-fill" style="width:${rate}%"></div></div>
        <div class="pcf-gauge-legend">
          <span><i class="pcf-dot" style="background:#bfe3d4"></i>Terminées <b>${totals.nbDone}</b></span>
          <span><i class="pcf-dot" style="background:#fcd34d"></i>En cours <b>${totals.nbEnCours}</b></span>
        </div>
      </div>
    </div>
    <div class="pcf-kpis">
      ${_pcfKpi('Délai moyen de démarrage', totals.avgDelay != null ? _fmtDelai(totals.avgDelay) : '—', 'attribution → début', '#2563eb')}
      ${_pcfKpi('Durée moyenne d\'exécution', totals.avgExec != null ? _fmtDelai(totals.avgExec) : '—', 'début → fin', '#1a4a3a')}
      ${_pcfKpi('Tâches terminées', String(totals.nbDone), totals.nbAssigned + ' attribuée(s)', '#16a34a')}
      ${_pcfKpi('Plus rapide', fastest ? fastest.nom : '—', fastest ? 'exéc. moy. ' + _fmtDelai(fastest.avgExec) : 'aucune donnée', '#7c3aed')}
    </div>`;

  if (!ops.length) {
    html += `<div class="pcf-empty">Aucune tâche attribuée sur cette période.</div>`;
    root.innerHTML = html;
    return;
  }

  html += `<div class="pcf-card">
    <div class="pcf-card-head">
      <div class="ic" style="background:#1a4a3a14;color:#1a4a3a">${_pcfIcon('users')}</div>
      <div style="flex:1;min-width:0"><div class="pcf-card-title">Performance par opérateur</div><div class="pcf-card-sub">${_perfPeriodLabel()} · cliquez une ligne pour le détail des tâches</div></div>
    </div>
    <table class="pcf-table">
      <thead><tr><th>Opérateur</th><th class="pcf-num">Terminées</th><th class="pcf-num">Démarrage moy.</th><th class="pcf-num">Exécution moy.</th><th class="pcf-num">Temps total</th><th></th></tr></thead>
      <tbody>${ops.map((o, i) => _perfOpRow(o, i)).join('')}</tbody>
    </table>
  </div>`;

  root.innerHTML = html;
  _ensureChronoTick();
}

function _perfOpRow(o, idx) {
  const open = _perfOpen.has(o.key);
  const chev = '<svg class="pcf-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  const rankColor = idx === 0 ? '#16a34a' : idx === 1 ? '#2563eb' : idx === 2 ? '#7c3aed' : '#78716c';
  const avatar = (o.nom || '?').charAt(0).toUpperCase();
  const kbid = 'perf' + o.key;
  const dot = o.nbEnCours ? ' <span style="color:#d97706;font-size:11px" title="A une tâche en cours">●</span>' : '';

  // Détail repliable — tableau des tâches de l'opérateur (Progressive Disclosure)
  const taskRows = o.tasks.map(tk => {
    const st = tk.statut === 'TERMINE' ? { c: '#16a34a', l: 'Terminée' }
            : tk.statut === 'EN_COURS' ? { c: '#d97706', l: 'En cours' }
            : { c: '#78716c', l: 'À faire' };
    const execCell = tk.statut === 'EN_COURS'
      ? _chronoBadge(tk.t)
      : (tk.exec != null ? _fmtDelai(tk.exec) : '—');
    return `<tr>
      <td data-label="Tâche"><div style="font-weight:700">${tk.label}</div><div style="font-size:10.5px;color:var(--muted)">${tk.num}${tk.client ? ' · ' + tk.client : ''}</div></td>
      <td data-label="Assignée" style="font-size:11.5px">${tk.t.dateAssignation || '—'}</td>
      <td class="pcf-num" data-label="Démarrage" style="color:#2563eb">${tk.startDelay != null ? _fmtDelai(tk.startDelay) : (tk.started ? '—' : 'pas démarrée')}</td>
      <td class="pcf-num" data-label="Exécution" style="color:#1a4a3a;font-weight:700">${execCell}</td>
      <td data-label="Statut"><span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:8px;background:${st.c}1a;color:${st.c};white-space:nowrap">${st.l}</span></td>
    </tr>`;
  }).join('');

  const detail = `<tr class="pcf-detail-row"><td colspan="6"><div class="pcf-detail ${open ? 'open' : ''}">
      <div style="overflow-x:auto"><table class="perf-subtable">
        <thead><tr><th>Tâche</th><th>Assignée le</th><th class="pcf-num">Délai démarrage</th><th class="pcf-num">Durée exécution</th><th>Statut</th></tr></thead>
        <tbody>${taskRows || `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:14px">Aucune tâche</td></tr>`}</tbody>
      </table></div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="deliv-open-btn" onclick="event.stopPropagation();printPerfOp('${o.key}')">Imprimer la fiche d'évaluation</button>
        <button class="pcf-export-btn" onclick="event.stopPropagation();_perfCopyOp('${o.key}')">Copier le récap</button>
      </div>
    </div></td></tr>`;

  return `<tr class="pcf-row ${open ? 'open' : ''}" onclick="togglePerfOp('${o.key}')">
    <td class="pcf-c-main" data-label="Opérateur">
      <div style="display:flex;align-items:center;gap:9px;min-width:0">
        ${chev}
        <span class="pcf-rank" style="background:${rankColor}1a;color:${rankColor}">${avatar}</span>
        <div style="min-width:0">
          <div class="pcf-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${o.nom}${dot}</div>
          <div style="font-size:10.5px;color:var(--muted)">${o.nbAssigned} attribuée(s) · ${o.nbEnCours} en cours</div>
        </div>
      </div>
    </td>
    <td class="pcf-num" data-label="Terminées">${o.nbDone}</td>
    <td class="pcf-num" data-label="Démarrage moy." style="color:#2563eb">${o.avgDelay != null ? _fmtDelai(o.avgDelay) : '—'}</td>
    <td class="pcf-num" data-label="Exécution moy." style="color:#1a4a3a;font-weight:700">${o.avgExec != null ? _fmtDelai(o.avgExec) : '—'}</td>
    <td class="pcf-num" data-label="Temps total"><span class="op-prodtime" data-op-label="${o.raw}">${_fmtDuree(o.totalTime)}</span></td>
    <td class="pcf-c-act" onclick="event.stopPropagation()">
      <div class="kebab-wrap" style="display:inline-block;vertical-align:middle">
        <button class="kebab-btn" aria-label="Plus d'actions" onclick="toggleKebab('${kbid}',event)"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>
        <div class="kebab-menu" id="kb-${kbid}" role="menu">
          <button class="kebab-item" role="menuitem" onclick="closeAllKebabs();printPerfOp('${o.key}')">${_kebabIcon('print')}<span>Imprimer la fiche</span></button>
          <button class="kebab-item" role="menuitem" onclick="closeAllKebabs();_perfCopyOp('${o.key}')">${_kebabIcon('eye')}<span>Copier le récap</span></button>
        </div>
      </div>
    </td>
  </tr>${detail}`;
}

function _perfCopyOp(key) {
  const o = (_perfLast && _perfLast.ops || []).find(x => x.key === key);
  if (!o) return;
  _pcfCopy(`Évaluation opérateur : ${o.nom}\nPériode : ${_perfPeriodLabel()}\n`
    + `Tâches attribuées : ${o.nbAssigned}\nTerminées : ${o.nbDone}\nEn cours : ${o.nbEnCours}\n`
    + `Délai moyen de démarrage : ${o.avgDelay != null ? _fmtDelai(o.avgDelay) : '—'}\n`
    + `Durée moyenne d'exécution : ${o.avgExec != null ? _fmtDelai(o.avgExec) : '—'}\n`
    + `Temps de production total : ${_fmtDuree(o.totalTime)}`);
}

// Impression — bilan global (tous opérateurs).
function printPerf() {
  const { ops, totals } = _perfBuild();
  if (!ops.length) { showToast('Aucune tâche à imprimer', 'error'); return; }
  const shop = (typeof shopConfig !== 'undefined' && shopConfig && shopConfig.name) || 'FOREVER MG';
  const esc = _cfEsc;
  const rows = ops.map((o, i) => `<tr>
    <td class="c">${i + 1}</td><td>${esc(o.nom)}</td>
    <td class="c">${o.nbAssigned}</td><td class="c">${o.nbDone}</td><td class="c">${o.nbEnCours}</td>
    <td class="r">${o.avgDelay != null ? _fmtDelai(o.avgDelay) : '—'}</td>
    <td class="r">${o.avgExec != null ? _fmtDelai(o.avgExec) : '—'}</td>
    <td class="r">${_fmtDuree(o.totalTime)}</td>
  </tr>`).join('');
  const body = `
    <h1>${esc(shop)} — Bilan de performance opérateurs</h1>
    <div class="sub">${esc(_perfPeriodLabel())} · ${ops.length} opérateur(s) · édité le ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR')}</div>
    <div class="kpis">
      <div class="kpi"><div class="l">Délai moyen démarrage</div><div class="v">${totals.avgDelay != null ? _fmtDelai(totals.avgDelay) : '—'}</div></div>
      <div class="kpi"><div class="l">Durée moyenne exécution</div><div class="v g">${totals.avgExec != null ? _fmtDelai(totals.avgExec) : '—'}</div></div>
      <div class="kpi"><div class="l">Tâches terminées</div><div class="v">${totals.nbDone} / ${totals.nbAssigned}</div></div>
    </div>
    <h2>Classement par opérateur</h2>
    <table><thead><tr><th class="c">#</th><th>Opérateur</th><th class="c">Attribuées</th><th class="c">Terminées</th><th class="c">En cours</th><th class="r">Démarrage moy.</th><th class="r">Exécution moy.</th><th class="r">Temps total</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="foot">Indicateurs : « démarrage » = délai entre l'attribution et le début · « exécution » = durée entre le début et la fin de la tâche.</div>`;
  _pcfOpenReportWindow(body, 'Bilan performance — ' + _perfPeriodLabel());
}

// Impression — fiche d'évaluation détaillée d'UN opérateur (toutes ses tâches).
function printPerfOp(key) {
  const { ops } = _perfBuild();
  const o = ops.find(x => x.key === key);
  if (!o) { showToast('Opérateur introuvable', 'error'); return; }
  const shop = (typeof shopConfig !== 'undefined' && shopConfig && shopConfig.name) || 'FOREVER MG';
  const esc = _cfEsc;
  const rows = o.tasks.map(tk => {
    const stl = tk.statut === 'TERMINE' ? 'Terminée' : tk.statut === 'EN_COURS' ? 'En cours' : 'À faire';
    return `<tr>
      <td>${esc(tk.label)}<div style="font-size:9px;color:#999">${esc(tk.num)}${tk.client ? ' · ' + esc(tk.client) : ''}</div></td>
      <td class="c">${esc(tk.t.dateAssignation || '—')}</td>
      <td class="c">${esc(tk.t.dateDebut || '—')}</td>
      <td class="c">${esc(tk.t.dateFin || '—')}</td>
      <td class="r">${tk.startDelay != null ? _fmtDelai(tk.startDelay) : '—'}</td>
      <td class="r">${tk.exec != null ? _fmtDelai(tk.exec) : '—'}</td>
      <td class="c">${stl}</td>
    </tr>`;
  }).join('');
  const body = `
    <h1>${esc(shop)} — Fiche d'évaluation</h1>
    <div class="sub">Opérateur : <b>${esc(o.nom)}</b> · ${esc(_perfPeriodLabel())} · édité le ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR')}</div>
    <div class="kpis">
      <div class="kpi"><div class="l">Tâches attribuées</div><div class="v">${o.nbAssigned}</div></div>
      <div class="kpi"><div class="l">Terminées</div><div class="v g">${o.nbDone}</div></div>
      <div class="kpi"><div class="l">Délai moyen démarrage</div><div class="v">${o.avgDelay != null ? _fmtDelai(o.avgDelay) : '—'}</div></div>
      <div class="kpi"><div class="l">Durée moyenne exécution</div><div class="v">${o.avgExec != null ? _fmtDelai(o.avgExec) : '—'}</div></div>
    </div>
    <h2>Détail des tâches</h2>
    <table><thead><tr><th>Tâche</th><th class="c">Assignée</th><th class="c">Démarrée</th><th class="c">Terminée</th><th class="r">Délai démar.</th><th class="r">Durée exéc.</th><th class="c">Statut</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="c muted">Aucune tâche</td></tr>'}</tbody></table>
    <div style="margin-top:26px;display:flex;gap:40px">
      <div style="flex:1">Appréciation : <div style="border-bottom:1px solid #999;height:18px;margin-top:18px"></div><div style="border-bottom:1px solid #999;height:18px;margin-top:14px"></div></div>
      <div style="width:200px">Signature responsable :<div style="border:1px solid #999;height:60px;margin-top:6px;border-radius:4px"></div></div>
    </div>
    <div class="foot">« Démarrage » = délai attribution → début · « Exécution » = durée début → fin.</div>`;
  _pcfOpenReportWindow(body, 'Fiche évaluation — ' + o.nom);
}

function _prodDeadlineChip(ymd) {
  const days = _daysUntil(ymd);
  const late = days != null && days < 0;
  const soon = days != null && days >= 0 && days <= 2;
  const c  = late ? '#dc2626' : soon ? '#e8834a' : '#1a4a3a';
  const bg = late ? '#fee2e2' : soon ? '#fff0e6' : '#e8f4f0';
  const dateStr = new Date(ymd + 'T00:00:00').toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' });
  const cd = days == null ? '' : late ? ` · ${Math.abs(days)}j retard` : days===0 ? ' · auj.' : days===1 ? ' · demain' : ` · ${days}j`;
  return `<span title="Livraison production" style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:800;color:${c};background:${bg};padding:1px 6px;border-radius:6px;white-space:nowrap">Prod ${dateStr}${cd}</span>`;
}

// Dossiers ayant une date de livraison PRODUCTION, triés par urgence. Rendu en haut de la
// page Production pour tous les rôles → chaque opérateur voit l'échéancier de l'atelier.
function _buildProdDeadlines() {
  if (!Array.isArray(dossiers)) return '';
  // Cloisonnement : un opérateur ne voit QUE les échéances des dossiers où il a une tâche
  // (et seulement son nom). admin / chef d'atelier / commercial voient toutes les échéances.
  const _canSeeAll = ['admin','chef_atelier','commerciale'].includes(currentUser?.role);
  const _myLabel   = currentUser?.label || currentUser?.username || '';
  const rows = dossiers
    .filter(d => d && d.dateLivraisonProd)
    .filter(d => _canSeeAll || taches.some(t => t.dossierId === d.id && _sameOp(t.operateur, _myLabel)))
    .map(d => {
      const dt = taches.filter(t => t.dossierId === d.id);
      const pct  = _dossierPct(dt, d);
      const days = _daysUntil(d.dateLivraisonProd);
      const opsSrc = _canSeeAll ? dt : dt.filter(t => _sameOp(t.operateur, _myLabel));
      const ops  = [...new Set(opsSrc.map(t => t.operateur).filter(Boolean))];
      return { d, pct, days, ops };
    })
    .filter(x => x.pct < 100 && x.d.statut !== 'LIVRE')
    .sort((a,b) => (a.days==null?1e9:a.days) - (b.days==null?1e9:b.days));

  if (!rows.length) return '';

  const cards = rows.slice(0, 40).map(({ d, pct, days, ops }) => {
    const late = days != null && days < 0;
    const soon = days != null && days >= 0 && days <= 2;
    const accent = late ? '#dc2626' : soon ? '#e8834a' : '#1a4a3a';
    const bgAcc  = late ? '#fef2f2' : soon ? '#fff8f3' : 'var(--color-surface)';
    const cd = days == null ? '' : late ? `${Math.abs(days)}j de retard` : days===0 ? "Aujourd'hui" : days===1 ? 'Demain' : `${days}j restants`;
    const dateStr = new Date(d.dateLivraisonProd + 'T00:00:00').toLocaleDateString('fr-FR', { weekday:'short', day:'2-digit', month:'short' });
    const opsStr = ops.length ? ops.join(', ') : 'Non assigné';
    return `<div class="prodd-card" style="border-left:3px solid ${accent};background:${bgAcc}" onclick="openAttribForDossier('${d.id}')">
      <div class="prodd-top">
        <span class="prodd-date" style="color:${accent}">${dateStr}</span>
        ${cd?`<span class="prodd-count" style="color:${accent}">${cd}</span>`:''}
      </div>
      <div class="prodd-client">${d.client||'—'}</div>
      <div class="prodd-prod">${d.produit||''}</div>
      <div class="prodd-foot">
        <div class="prodd-bar"><div style="width:${pct}%;background:${accent}"></div></div>
        <span class="prodd-pct">${pct}%</span>
      </div>
      <div class="prodd-ops">${opsStr}</div>
    </div>`;
  }).join('');

  const lateCount = rows.filter(x => x.days != null && x.days < 0).length;
  return `<div class="prodd-section">
    <div class="prodd-head">
      <div class="prodd-title">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
        Échéances production
      </div>
      <span class="prodd-sub">${rows.length} travaux planifiés${lateCount?` · <b style="color:#dc2626">${lateCount} en retard</b>`:''}</span>
    </div>
    <div class="prodd-scroll">${cards}</div>
  </div>`;
}

function renderTaches() {
  const container = document.getElementById('tachesContainer');
  if (!container) return;
  _syncDossierDates();

  if (_prodView === 'charge') {
    _renderChargeView();
    return;
  }

  // Vue COCKPIT (responsable : admin / chef / commercial) — tableau compact de
  // dossiers + panneau détail au clic. Remplace la liste de tâches groupées.
  const _canViewAllProd = ['admin','chef_atelier','commerciale'].includes(currentUser?.role);
  if (_prodView === 'tasks' && _canViewAllProd) {
    _ensureDossierLinks();
    renderProdCockpit();
    return;
  }

  // ── Vue opérateur (ses propres tâches) : restaurer les barres statiques ──
  const _fs = document.getElementById('prodFiltersSticky'); if (_fs) _fs.style.display = '';
  const _et = document.getElementById('prodExpandToggle'); if (_et) _et.style.display = '';

  // Mettre à jour la barre charge opérateurs
  const wlEl = document.getElementById('opWorkloadContainer');
  if (wlEl) { wlEl.style.display = ''; wlEl.innerHTML = _buildOpWorkload(); }

  const dash          = _buildMonDashboard();
  const deadlines     = _buildProdDeadlines();
  const isAdminOrChef = ['admin','chef_atelier'].includes(currentUser?.role);
  // Les commerciaux suivent TOUTE la production en lecture seule (pas d'action — géré par canInteract).
  // En vue « Mes tâches » (_prodView==='mine'), on force le filtrage sur ses propres tâches
  // pour que le responsable/commercial retrouve et pointe ce qui lui est assigné.
  const canViewAllProd = (isAdminOrChef || currentUser?.role === 'commerciale') && _prodView !== 'mine';
  const myLabel       = currentUser?.label || currentUser?.username || '';

  // Peupler le sélecteur d'années depuis les tâches (fusion dédoublonnée Sheet + local)
  const _merged = _allTachesMerged();
  _populateYearSel('prodYearSel', _merged.map(t => t.dateAssignation));

  // Les tâches libres (dossierId LIBRE) ont leur propre section plus bas : on les exclut
  // du groupement par dossier pour ne pas créer un faux "dossier LIBRE" en doublon.
  let dossierList = _merged.filter(t => t.dossierId !== 'LIBRE');
  if (!canViewAllProd) dossierList = dossierList.filter(t => _sameOp(t.operateur, myLabel));
  if (prodFilter === 'EN_RETARD') dossierList = dossierList.filter(t => _getTacheRetardInfo(t).isRetard);
  else if (prodFilter !== 'TOUS') dossierList = dossierList.filter(t => t.statut === prodFilter);
  if (prodDateFilter.mois || prodDateFilter.annee)
    dossierList = dossierList.filter(t => _matchDateFilter(t.dateAssignation, prodDateFilter));

  let libreList = _merged.filter(t => t.dossierId === 'LIBRE');
  if (!canViewAllProd) libreList = libreList.filter(t => _sameOp(t.operateur, myLabel));
  if (prodFilter === 'EN_RETARD') libreList = [];
  else if (prodFilter !== 'TOUS') libreList = libreList.filter(t => t.statut === prodFilter);
  if (prodDateFilter.mois || prodDateFilter.annee)
    libreList = libreList.filter(t => _matchDateFilter(t.dateAssignation, prodDateFilter));

  // Mettre à jour les compteurs dans les boutons filtre (sur données non filtrées par date)
  const allVisible = _merged.filter(t => canViewAllProd || _sameOp(t.operateur, myLabel));
  const retardCount = _merged.filter(t => (canViewAllProd || _sameOp(t.operateur, myLabel)) && _getTacheRetardInfo(t).isRetard).length;
  const _cnt = s => s === 'EN_RETARD' ? retardCount : allVisible.filter(t => s==='TOUS'||t.statut===s).length;
  ['TOUS','A_FAIRE','EN_COURS','TERMINE','EN_RETARD'].forEach(s => {
    const sfx = {'TOUS':'Tous','A_FAIRE':'AFaire','EN_COURS':'EnCours','TERMINE':'Termine','EN_RETARD':'Retard'}[s];
    const el  = document.getElementById(`prodCount${sfx}`);
    if (el) { el.textContent = _cnt(s); el.style.display = _cnt(s)?'':'none'; }
  });

  if (!dossierList.length && !libreList.length) {
    container.innerHTML = deadlines + dash + `<div style="display:flex;flex-direction:column;align-items:center;padding:64px 0;text-align:center">
      <div style="width:44px;height:44px;background:var(--color-bg);border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:12px">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <p style="font-size:13px;font-weight:500;color:var(--color-text-secondary)">Aucune tâche${prodFilter!=='TOUS'?' dans ce filtre':''}</p>
    </div>`;
    _ensureChronoTick();
    return;
  }

  // Section tâches libres
  const libreOpen = _prodExpanded.has('LIBRE');
  const libreHtml = libreList.length ? `
    <div class="prod-group ${libreOpen?'prod-group--open':''}" id="pg-LIBRE" style="border-color:#e9d5ff">
      <div class="prod-group-header" onclick="toggleProdGroup('LIBRE')" style="background:#faf5ff;cursor:pointer">
        <div class="prod-group-left">
          <span style="font-size:14px;color:#7c3aed"></span>
          <span class="prod-group-info" style="color:#7c3aed">Tâches indépendantes</span>
        </div>
        <div class="prod-group-right">
          <span style="background:#f3e8ff;color:#7c3aed;font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px">${libreList.length}</span>
          ${_chevSvg('prod-group-chev')}
        </div>
      </div>
      <div class="prod-group-tasks"><table class="prod-task-table"><thead>${_PT_THEAD}</thead><tbody>${libreList.map(_tacheRow).join('')}</tbody></table></div>
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
    const isOpen     = _prodExpanded.has(dossierId);
    return `<div class="prod-group ${isOpen?'prod-group--open':''}" id="pg-${dossierId}" style="border-color:${borderClr}">
      <div class="prod-group-header" onclick="toggleProdGroup('${dossierId}')" style="cursor:pointer">
        <div class="prod-group-left" style="min-width:0">
          <span class="prod-group-num">${(d && d.numeroDossier) || g.numeroDossier}</span>
          ${prio}
          ${client}
          ${produit}
          ${d && d.dateLivraisonProd ? _prodDeadlineChip(d.dateLivraisonProd) : ''}
        </div>
        <div class="prod-group-right">
          <span style="font-size:11px;font-weight:600;color:var(--color-text-muted)">${doneCount}/${total}</span>
          ${_chevSvg('prod-group-chev')}
        </div>
      </div>
      ${isOpen ? `<div class="prod-group-progress">${_buildProgressBar(dossierId)}</div>` : ''}
      <div class="prod-group-tasks"><table class="prod-task-table"><thead>${_PT_THEAD}</thead><tbody>${g.taches.map(_tacheRow).join('')}</tbody></table></div>
    </div>`;
  }).join('');

  container.innerHTML = deadlines + dash + libreHtml + groupsHtml;
  _syncProdExpandBtn();
  _ensureChronoTick();
}

// ── Cartes-dossiers repliables (vue compacte production) ────────────────────
function _chevSvg(cls){
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
}

function toggleProdGroup(id){
  const g = document.getElementById('pg-' + id);
  if (!g) return;
  const open = g.classList.toggle('prod-group--open');
  if (open) _prodExpanded.add(id); else _prodExpanded.delete(id);
  // Pipeline complet : généré à la demande dès la 1ère ouverture (panneau détail au clic),
  // plutôt qu'à chaque rendu — évite de le calculer/afficher pour des dossiers repliés.
  if (open && id !== 'LIBRE' && !g.querySelector('.prod-group-progress')) {
    const tasksWrap = g.querySelector('.prod-group-tasks');
    if (tasksWrap) tasksWrap.insertAdjacentHTML('beforebegin', `<div class="prod-group-progress">${_buildProgressBar(id)}</div>`);
  }
  _syncProdExpandBtn();
}

function toggleAllProdGroups(){
  const ids = [...document.querySelectorAll('.prod-group[id^="pg-"]')].map(el => el.id.slice(3));
  if (!ids.length) return;
  const anyCollapsed = ids.some(id => !_prodExpanded.has(id));
  if (anyCollapsed) ids.forEach(id => _prodExpanded.add(id));
  else ids.forEach(id => _prodExpanded.delete(id));
  renderTaches();
}

function _syncProdExpandBtn(){
  const lbl = document.getElementById('prodExpandLabel');
  if (!lbl) return;
  const ids = [...document.querySelectorAll('.prod-group[id^="pg-"]')].map(el => el.id.slice(3));
  const allOpen = ids.length > 0 && ids.every(id => _prodExpanded.has(id));
  lbl.textContent = allOpen ? 'Tout replier' : 'Tout déplier';
}

// ════════════════════════════════════════════════════════════
// COCKPIT PRODUCTION — vue responsable (tableau compact de dossiers)
// Tous les travaux d'un coup : priorité, échéance, retard/jours restants,
// client, produit, étape actuelle, responsable, progression, statut.
// Le pipeline complet s'ouvre dans un panneau latéral au clic sur la ligne.
// Filtres/tri sticky, cartes d'alerte (retard/aujourd'hui/demain), heatmap
// opérateurs compacte. Couleurs : rouge=retard critique, orange=proche
// échéance, bleu=étape active, vert=terminé, gris=futur.
// ════════════════════════════════════════════════════════════
function _pcokEsc(v){ return String(v==null?'':v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// Une ligne par dossier ayant des tâches (hors LIBRE), avec toutes les
// métriques d'affichage/tri. Source = tâches fusionnées + méta dossier.
function _buildDossierRows() {
  const merged = _allTachesMerged().filter(t => t.dossierId && t.dossierId !== 'LIBRE');
  const byDossier = {};
  merged.forEach(t => { (byDossier[t.dossierId] = byDossier[t.dossierId] || []).push(t); });

  return Object.entries(byDossier).map(([dossierId, dt]) => {
    const d = (Array.isArray(dossiers) ? dossiers : []).find(x => x.id === dossierId) || {};
    const clos = _dossierClosed(d); // clôture admin → pipeline complet même sans tâche
    let done = 0;
    const steps = ETAPES_CONFIG.map(e => {
      const te = dt.filter(t => t.etapeCode === e.code);
      let status = 'VIDE';
      if (clos)                                                                { status = 'TERMINE'; done++; }
      else if (te.length && te.every(t => t.statut === 'TERMINE'))             { status = 'TERMINE'; done++; }
      else if (te.some(t => t.statut === 'EN_COURS' || t.statut === 'TERMINE')) status = 'EN_COURS';
      else if (te.some(t => t.statut === 'A_FAIRE'))                            status = 'A_FAIRE';
      return { e, status, te };
    });
    const applicable = steps.filter(s => s.te && s.te.length).length;
    const pct = clos ? 100 : (applicable ? Math.round(done / applicable * 100) : 0);
    // Étape actuelle = 1re EN_COURS, sinon 1re A_FAIRE
    const cur = steps.find(s => s.status === 'EN_COURS') || steps.find(s => s.status === 'A_FAIRE') || null;
    let responsables = [];
    if (cur) {
      responsables = [...new Set(cur.te.filter(t => t.statut !== 'TERMINE').map(t => t.operateur).filter(Boolean))];
      if (!responsables.length) responsables = [...new Set(cur.te.map(t => t.operateur).filter(Boolean))];
    }
    const taskRetard = dt.some(t => _getTacheRetardInfo(t).isRetard);
    const ymd  = _toIsoDate(d.dateLivraisonProd || '');
    const days = ymd ? _daysUntil(ymd) : null;
    const deadlineLate = days != null && days < 0;
    const isDone = pct === 100 || d.statut === 'LIVRE';
    let bucket = 'FUTUR';
    if (isDone) bucket = 'TERMINE';
    else if (deadlineLate || (taskRetard && days == null)) bucket = 'RETARD';
    else if (days === 0) bucket = 'AUJ';
    else if (days === 1) bucket = 'DEMAIN';
    else if (days != null && days <= 7) bucket = 'SEMAINE';
    const statut = isDone ? 'TERMINE'
      : (bucket === 'RETARD' || taskRetard) ? 'RETARD'
      : steps.some(s => s.status === 'EN_COURS') ? 'EN_COURS' : 'A_FAIRE';
    const prio = d.priorite || 'Normale';
    const prioRank = prio === 'Urgente' ? 0 : prio === 'Haute' ? 1 : 2;
    return {
      dossierId, d,
      ref: d.numeroDossier || dt[0]?.numeroDossier || dossierId,
      client: d.client || dt[0]?.client || '—',
      produit: d.produit || dt[0]?.produit || dt[0]?.titre || '',
      priorite: prio, prioRank, ymd, days, deadlineLate, taskRetard,
      curStep: cur ? cur.e : null, responsables,
      pct, steps, bucket, statut, isDone,
      _hasRunning: dt.some(t => t.statut === 'EN_COURS'),
    };
  });
}

function _cockpitBucketMatch(r, k) {
  if (k === 'TOUS')    return true;
  if (k === 'RETARD')  return !r.isDone && (r.bucket === 'RETARD' || r.taskRetard || r.deadlineLate);
  if (k === 'AUJ')     return r.days === 0 && !r.isDone;
  if (k === 'DEMAIN')  return r.days === 1 && !r.isDone;
  if (k === 'SEMAINE') return r.days != null && r.days >= 0 && r.days <= 7 && !r.isDone;
  if (k === 'TERMINE') return r.isDone;
  return true;
}

function _cockpitFilterRows(rows) {
  let out = rows.filter(r => _cockpitBucketMatch(r, _cockpitFilter));
  if (_cockpitOp !== 'TOUS')
    out = out.filter(r => r.responsables.some(o => _sameOp(o, _cockpitOp)) || r.steps.some(s => s.te.some(t => _sameOp(t.operateur, _cockpitOp))));
  if (_cockpitShift !== 'TOUS')
    out = out.filter(r => r.steps.some(s => s.te.some(t => (t.shift || '') === _cockpitShift)));
  if (_cockpitEtape !== 'TOUS')
    out = out.filter(r => r.curStep && r.curStep.code === _cockpitEtape);
  const q = _cockpitSearch.trim().toLowerCase();
  if (q) out = out.filter(r => (r.client + ' ' + r.produit + ' ' + r.ref).toLowerCase().includes(q));
  return out;
}

function _cockpitSortRows(rows) {
  const { key, dir } = _cockpitSort;
  const sign = dir === 'desc' ? -1 : 1;
  const order = { RETARD:0, EN_COURS:1, A_FAIRE:2, TERMINE:3 };
  const dkey = a => a.days == null ? 1e9 : a.days;
  const cmp = ({
    echeance:    (a,b) => dkey(a) - dkey(b),
    retard:      (a,b) => dkey(a) - dkey(b),
    operateur:   (a,b) => (a.responsables[0]||'￿').localeCompare(b.responsables[0]||'￿','fr'),
    statut:      (a,b) => (order[a.statut]??9) - (order[b.statut]??9),
    progression: (a,b) => a.pct - b.pct,
    priorite:    (a,b) => a.prioRank - b.prioRank,
  })[key] || (() => 0);
  return rows.sort((a,b) => (sign * cmp(a,b)) || (dkey(a) - dkey(b)));
}

function renderProdCockpit() {
  const container = document.getElementById('tachesContainer');
  if (!container) return;
  // Masquer les barres "tâches" statiques + le bouton déplier (non pertinents ici)
  const fs = document.getElementById('prodFiltersSticky'); if (fs) fs.style.display = 'none';
  const wl = document.getElementById('opWorkloadContainer'); if (wl) wl.style.display = 'none';
  const et = document.getElementById('prodExpandToggle'); if (et) et.style.display = 'none';

  const all = _buildDossierRows();
  const cnt = k => all.filter(r => _cockpitBucketMatch(r, k)).length;
  const opsSet = [...new Set(all.flatMap(r => r.responsables))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'fr'));
  const etapesUsed = ETAPES_CONFIG.filter(e => all.some(r => r.curStep && r.curStep.code === e.code));

  container.innerHTML =
    `<div class="pcok">
      ${_cockpitToolbar(cnt, opsSet, etapesUsed, all)}
      ${_cockpitAlertCards(all)}
      ${_cockpitOpHeatmap()}
      <div id="pcokBody"></div>
    </div>`;
  _cockpitRenderBody();
}

// Ne re-rend que le tableau (préserve le focus de la recherche pendant la frappe)
function _cockpitRenderBody() {
  const body = document.getElementById('pcokBody');
  if (!body) return;
  const filtered = _cockpitSortRows(_cockpitFilterRows(_buildDossierRows()));
  const page = filtered.slice(0, _cockpitLimit);
  const filteredLbl = (_cockpitFilter!=='TOUS'||_cockpitOp!=='TOUS'||_cockpitShift!=='TOUS'||_cockpitEtape!=='TOUS'||_cockpitSearch) ? ' · filtré' : '';
  const count = `<div class="pcok-count">${filtered.length} dossier${filtered.length>1?'s':''}${filteredLbl}</div>`;
  const more = filtered.length > _cockpitLimit
    ? `<div class="pcok-more"><button onclick="_cockpitShowMore()">Afficher plus (${filtered.length - _cockpitLimit} restants)</button></div>` : '';
  body.innerHTML = count + _cockpitTable(page) + more;
  _ensureChronoTick();
}

function _cockpitToolbar(cnt, opsSet, etapesUsed, all) {
  const chips = [
    ['TOUS','Tous'], ['RETARD','En retard'], ['AUJ',"Aujourd'hui"], ['DEMAIN','Demain'], ['SEMAINE','Cette semaine'], ['TERMINE','Terminés']
  ].map(([k,lbl]) => {
    const active = _cockpitFilter === k;
    return `<button class="pcok-chip ${active?'pcok-chip--active':''} ${k==='RETARD'?'pcok-chip--warn':''}" onclick="_cockpitSetFilter('${k}')">${lbl}<span class="pcok-chip-n">${cnt(k)}</span></button>`;
  }).join('');
  // Chips équipe (Jour/Nuit) — filtre indépendant, compte les dossiers ayant ≥1 tâche du shift.
  const shiftCnt = sh => sh === 'TOUS' ? all.length
    : all.filter(r => r.steps.some(s => s.te.some(t => (t.shift || '') === sh))).length;
  const shiftChips = [['TOUS','Toutes'], ['Jour','☀️ Jour'], ['Nuit','🌙 Nuit']].map(([k,lbl]) => {
    const active = _cockpitShift === k;
    return `<button class="pcok-chip ${active?'pcok-chip--active':''}" onclick="_cockpitSetShift('${k}')">${lbl}<span class="pcok-chip-n">${shiftCnt(k)}</span></button>`;
  }).join('');
  const opOpts = ['<option value="TOUS">Tous les opérateurs</option>']
    .concat(opsSet.map(o => `<option value="${_pcokEsc(o)}" ${_cockpitOp===o?'selected':''}>${_pcokEsc(o)}</option>`)).join('');
  const etOpts = ['<option value="TOUS">Toutes les étapes</option>']
    .concat(etapesUsed.map(e => `<option value="${e.code}" ${_cockpitEtape===e.code?'selected':''}>${_pcokEsc(e.label)}</option>`)).join('');
  const sortOpts = [
    ['echeance','Échéance'], ['retard','Retard'], ['operateur','Opérateur'], ['statut','Statut'], ['progression','Progression'], ['priorite','Priorité']
  ].map(([k,l]) => `<option value="${k}" ${_cockpitSort.key===k?'selected':''}>Trier : ${l}</option>`).join('');
  const dirIcon = _cockpitSort.dir === 'asc' ? '↑' : '↓';
  return `<div class="pcok-toolbar">
    <div class="pcok-chips">${chips}<span class="pcok-chips-sep"></span>${shiftChips}</div>
    <div class="pcok-controls">
      <div class="pcok-search">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" placeholder="Rechercher client, produit, réf…" value="${_pcokEsc(_cockpitSearch)}" oninput="_cockpitSetSearch(this.value)" />
      </div>
      <select class="select-input" onchange="_cockpitSetOp(this.value)" title="Filtrer par opérateur">${opOpts}</select>
      <select class="select-input" onchange="_cockpitSetEtape(this.value)" title="Filtrer par étape">${etOpts}</select>
      <select class="select-input" onchange="_cockpitSetSort(this.value)" title="Trier">${sortOpts}</select>
      <button class="pcok-iconbtn" title="Sens du tri" onclick="_cockpitToggleSortDir()">${dirIcon}</button>
      <button class="pcok-iconbtn pcok-density" title="Vue compacte / détaillée" onclick="_cockpitToggleDensity()">${_cockpitDensity==='compact'?'Détaillé':'Compact'}</button>
    </div>
  </div>`;
}

function _cockpitAlertCards(rows) {
  const alert = rows.filter(r => !r.isDone && (r.bucket==='RETARD'||r.bucket==='AUJ'||r.bucket==='DEMAIN'))
    .sort((a,b) => (a.days==null?1e9:a.days) - (b.days==null?1e9:b.days))
    .slice(0, 8);
  if (!alert.length) return '';
  const cards = alert.map(r => {
    const late = r.days != null && r.days < 0;
    const accent = late ? '#dc2626' : '#e8834a';
    const bg = late ? '#fef2f2' : '#fff8f3';
    const cd = r.days == null ? (r.taskRetard ? 'Retard rythme' : '') : late ? `${Math.abs(r.days)}j de retard` : r.days===0 ? "Aujourd'hui" : 'Demain';
    const step = r.curStep ? _pcokEsc(r.curStep.short || r.curStep.label) : '—';
    return `<button class="pcok-alert" style="border-left:3px solid ${accent};background:${bg}" onclick="openProdDrawer('${r.dossierId}')">
      <div class="pcok-alert-top"><span style="color:${accent};font-weight:800">${cd}</span><span class="pcok-alert-pct">${r.pct}%</span></div>
      <div class="pcok-alert-client">${_pcokEsc(r.client)}</div>
      <div class="pcok-alert-step">${step}${r.responsables.length?' · '+_pcokEsc(r.responsables[0]):''}</div>
    </button>`;
  }).join('');
  return `<div class="pcok-alerts"><div class="pcok-alerts-title">Alertes <span>${alert.length}</span></div><div class="pcok-alerts-row">${cards}</div></div>`;
}

function _cockpitOpHeatmap() {
  const counts = {};
  _allTachesMerged().forEach(t => {
    if (t.statut === 'TERMINE' || !t.operateur) return;
    counts[t.operateur] = counts[t.operateur] || { a:0, e:0 };
    if (t.statut === 'A_FAIRE')   counts[t.operateur].a++;
    else if (t.statut === 'EN_COURS') counts[t.operateur].e++;
  });
  const ops = Object.entries(counts);
  if (!ops.length) return '';
  const max = Math.max(...ops.map(([,v]) => v.a + v.e), 1);
  const sorted = ops.sort((a,b) => (b[1].a+b[1].e) - (a[1].a+a[1].e));
  const overloaded = sorted.filter(([,v]) => (v.a+v.e)/max >= 0.85).length;
  const chips = sorted.map(([name, v]) => {
    const tot = v.a + v.e, ratio = tot / max;
    const bg = ratio>=0.85 ? '#fee2e2' : ratio>=0.6 ? '#fef3c7' : '#dcfce7';
    const cl = ratio>=0.85 ? '#dc2626' : ratio>=0.6 ? '#b45309' : '#16a34a';
    const dot = v.e > 0 ? '<span class="pcok-op-dot"></span>' : '';
    const esc = _pcokEsc(name).replace(/'/g, "\\'");
    return `<button class="pcok-op-chip" style="background:${bg};color:${cl}" onclick="_cockpitSetOp('${esc}')" title="${_pcokEsc(name)} — ${tot} tâche(s) active(s)">${dot}${_pcokEsc(name)} <b>${tot}</b></button>`;
  }).join('');
  const summary = overloaded ? `<span class="pcok-op-warn">${overloaded} en surcharge</span>` : `<span class="pcok-op-sum">${sorted.length} actifs</span>`;
  return `<div class="pcok-ops ${_cockpitOpsOpen?'pcok-ops--open':''}">
    <button class="pcok-ops-toggle" onclick="_cockpitToggleOps()">
      <span class="pcok-ops-title">Charge opérateurs</span>${summary}
      <svg class="pcok-ops-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="pcok-ops-row">${chips}</div>
  </div>`;
}

function _cockpitTable(rows) {
  if (!rows.length) return `<div class="pcok-empty">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4"><polyline points="20 6 9 17 4 12"/></svg>
    <p>Aucun dossier${_cockpitFilter!=='TOUS'||_cockpitSearch?' dans ce filtre':''}</p>
  </div>`;
  const det = _cockpitDensity === 'detaille';
  const th = (key, label) => {
    const active = key && _cockpitSort.key === key;
    const arrow = active ? (_cockpitSort.dir==='asc' ? ' ↑' : ' ↓') : '';
    return `<th class="pcok-th ${active?'pcok-th--active':''}" ${key?`onclick="_cockpitSetSort('${key}')" style="cursor:pointer"`:''}>${label}${arrow}</th>`;
  };
  const head = `<tr>
    ${th('priorite','!')}
    ${th('', 'Réf / Client')}
    ${det ? th('', 'Produit') : ''}
    ${th('echeance','Échéance')}
    ${th('retard','Retard')}
    ${th('', 'Étape')}
    ${th('operateur','Resp.')}
    ${th('progression','Prog.')}
    ${th('statut','Statut')}
    <th class="pcok-th"></th>
  </tr>`;
  return `<div class="pcok-tablewrap"><table class="pcok-table pcok-table--${_cockpitDensity}"><thead>${head}</thead><tbody>${rows.map(_cockpitRow).join('')}</tbody></table></div>`;
}

function _cockpitRow(r) {
  const det = _cockpitDensity === 'detaille';
  const prioC = r.priorite==='Urgente'?'#dc2626':r.priorite==='Haute'?'#d97706':'#d6d3d1';
  const prio = `<span class="pcok-prio" style="background:${prioC}" title="${r.priorite}"></span>`;
  const ech = r.ymd ? new Date(r.ymd+'T00:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) : '—';
  let retC = '#78716c', retTxt = '—';
  if (r.isDone)              { retC='#16a34a'; retTxt='Terminé'; }
  else if (r.days == null)   { retC = r.taskRetard?'#dc2626':'#a8a29e'; retTxt = r.taskRetard?'Retard':'—'; }
  else if (r.days < 0)       { retC='#dc2626'; retTxt=`+${Math.abs(r.days)}j`; }
  else if (r.days === 0)     { retC='#e8834a'; retTxt='Auj.'; }
  else if (r.days === 1)     { retC='#e8834a'; retTxt='Demain'; }
  else if (r.days <= 7)      { retC='#d97706'; retTxt=`${r.days}j`; }
  else                       { retC='#78716c'; retTxt=`${r.days}j`; }
  const retBadge = `<span class="pcok-ret" style="color:${retC};background:${retC}1a">${retTxt}</span>`;
  const stC = r.curStep ? r.curStep.color : '#a8a29e';
  const stepChip = r.curStep
    ? `<span class="pcok-step" style="color:${stC};background:${stC}15;border-color:${stC}55">${_pcokEsc(r.curStep.short || r.curStep.label)}</span>`
    : (r.isDone ? `<span class="pcok-step" style="color:#16a34a;background:#dcfce7;border-color:#bbf7d0">Livré</span>` : '<span class="pcok-muted">—</span>');
  const running = r._hasRunning ? '<span class="pcok-run-dot"></span>' : '';
  const resp = r.responsables.length
    ? `${_pcokEsc(r.responsables[0])}${r.responsables.length>1?` <span class="pcok-muted">+${r.responsables.length-1}</span>`:''}`
    : '<span class="pcok-muted">Non assigné</span>';
  const pctC = r.pct===100?'#16a34a':r.pct>0?'#e8834a':'#a8a29e';
  const prog = `<div class="pcok-prog"><div class="pcok-prog-bar"><div style="width:${r.pct}%;background:${pctC}"></div></div><span class="pcok-prog-n" style="color:${pctC}">${r.pct}%</span></div>`;
  const stMap = { RETARD:['#dc2626','#fee2e2','En retard'], EN_COURS:['#d97706','#fef3c7','En cours'], A_FAIRE:['#2563eb','#dbeafe','À faire'], TERMINE:['#16a34a','#dcfce7','Terminé'] };
  const [sc,sb,sl] = stMap[r.statut] || ['#78716c','#f5f5f4','—'];
  const statut = `<span class="pcok-badge" style="color:${sc};background:${sb}">${sl}</span>`;
  const accent = r.isDone ? '' : (r.days!=null && r.days<0) ? 'inset 3px 0 0 #dc2626' : (r.days===0||r.days===1) ? 'inset 3px 0 0 #e8834a' : r._hasRunning ? 'inset 3px 0 0 #2563eb' : '';
  return `<tr class="pcok-row ${r.isDone?'pcok-row--done':''}" ${accent?`style="box-shadow:${accent}"`:''} onclick="openProdDrawer('${r.dossierId}')">
    <td class="pcok-td-prio">${prio}</td>
    <td class="pcok-td-client"><div class="pcok-client">${_pcokEsc(r.client)}</div><div class="pcok-ref">${_pcokEsc(r.ref)}</div></td>
    ${det ? `<td class="pcok-td-prod">${_pcokEsc(r.produit) || '<span class="pcok-muted">—</span>'}</td>` : ''}
    <td class="pcok-td-ech">${ech}</td>
    <td class="pcok-td-ret">${retBadge}</td>
    <td class="pcok-td-step">${stepChip}</td>
    <td class="pcok-td-resp">${running}${resp}</td>
    <td class="pcok-td-prog">${prog}</td>
    <td class="pcok-td-statut">${statut}</td>
    <td class="pcok-td-act"><svg class="pcok-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></td>
  </tr>`;
}

// Rendu du pipeline vertical (partagé par les drawers Production & Commande)
function _pcokStepsHtml(steps) {
  return steps.map((s,i) => {
    const col = s.status==='TERMINE'?'#16a34a':s.status==='EN_COURS'?'#d97706':s.status==='A_FAIRE'?'#2563eb':'#d6d3d1';
    const lbl = s.status==='TERMINE'?'Terminé':s.status==='EN_COURS'?'En cours':s.status==='A_FAIRE'?'À faire':'—';
    const ops = [...new Set(s.te.map(t=>t.operateur).filter(Boolean))].join(', ');
    const retard = s.te.some(t => _getTacheRetardInfo(t).isRetard);
    return `<div class="pcok-dstep ${s.status==='EN_COURS'?'pcok-dstep--active':''}">
      <div class="pcok-dstep-rail">
        <span class="pcok-dstep-dot" style="background:${col}">${s.status==='TERMINE'?'✓':i+1}</span>
        ${i<steps.length-1?`<span class="pcok-dstep-line" style="background:${s.status==='TERMINE'?'#16a34a':'#e5e3df'}"></span>`:''}
      </div>
      <div class="pcok-dstep-body">
        <div class="pcok-dstep-head"><span class="pcok-dstep-lbl">${_pcokEsc(s.e.label)}</span><span class="pcok-dstep-st" style="color:${col}">${lbl}${retard?' · <b style="color:#dc2626">retard</b>':''}</span></div>
        ${ops?`<div class="pcok-dstep-ops">${_pcokEsc(ops)}</div>`:'<div class="pcok-dstep-ops pcok-muted">Non assigné</div>'}
      </div>
    </div>`;
  }).join('');
}

// ── Panneau latéral (drawer) : pipeline complet d'un dossier ────────────────
function openProdDrawer(dossierId) {
  _ensureDossierLinks();
  const r = _buildDossierRows().find(x => x.dossierId === dossierId);
  const drawer = document.getElementById('prodDrawer');
  const body   = document.getElementById('prodDrawerBody');
  if (!r || !drawer || !body) { openAttribForDossier(dossierId); return; }
  closeDrawers();
  body.innerHTML = _cockpitDrawerContent(r);
  drawer.classList.add('open');
  document.body.classList.add('pcok-drawer-open');
  _ensureChronoTick();
}
// Ferme tous les panneaux latéraux (Production + Commandes)
function closeDrawers() {
  document.querySelectorAll('.pcok-drawer.open').forEach(d => d.classList.remove('open'));
  document.body.classList.remove('pcok-drawer-open');
}
function closeProdDrawer() { closeDrawers(); }

function _cockpitDrawerContent(r) {
  const canAttrib = PAGE_ACCESS.attribution.includes(currentUser?.role);
  const ech  = r.ymd ? new Date(r.ymd+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long'}) : '—';
  const dtxt = r.days==null ? '' : r.days<0 ? `${Math.abs(r.days)}j de retard` : r.days===0 ? "Aujourd'hui" : r.days===1 ? 'Demain' : `${r.days}j restants`;
  const dCol = r.days!=null && r.days<0 ? '#dc2626' : (r.days===0||r.days===1) ? '#e8834a' : '#16a34a';
  const prioC  = r.priorite==='Urgente'?'#dc2626':r.priorite==='Haute'?'#d97706':'#78716c';
  const prioBg = r.priorite==='Urgente'?'#fee2e2':r.priorite==='Haute'?'#fef3c7':'#f5f5f4';
  const stepsHtml = _pcokStepsHtml(r.steps);
  return `<div class="pcok-drawer-head">
      <div style="min-width:0">
        <div class="pcok-drawer-ref">${_pcokEsc(r.ref)}</div>
        <div class="pcok-drawer-client">${_pcokEsc(r.client)}</div>
      </div>
      <button class="pcok-drawer-close" onclick="closeProdDrawer()" aria-label="Fermer">×</button>
    </div>
    <div class="pcok-drawer-meta">
      <span class="pcok-badge" style="color:${prioC};background:${prioBg}">${r.priorite}</span>
      <span class="pcok-drawer-ech" style="color:${dCol}">${ech}${dtxt?' · '+dtxt:''}</span>
    </div>
    ${r.produit?`<div class="pcok-drawer-prod">${_pcokEsc(r.produit)}</div>`:''}
    <div class="pcok-drawer-prog"><div class="pcok-prog-bar"><div style="width:${r.pct}%;background:${r.pct===100?'#16a34a':'#e8834a'}"></div></div><span>${r.pct}%</span></div>
    <div class="pcok-drawer-pipe-title">Pipeline de production</div>
    <div class="pcok-drawer-pipe">${stepsHtml}</div>
    <div class="pcok-drawer-actions">
      ${canAttrib?`<button class="pcok-btn pcok-btn--primary" onclick="closeProdDrawer();openAttribForDossier('${r.dossierId}')">Gérer l'attribution →</button>`:''}
      ${['admin','chef_atelier'].includes(currentUser?.role) && !r.isDone ? `<button class="pcok-btn" style="color:#16a34a;border-color:rgba(22,163,74,.4)" onclick="cloturerDossier('${r.dossierId}')">✓ Clôturer</button>` : ''}
      <button class="pcok-btn" onclick="printDossier('${r.dossierId}')">Imprimer</button>
    </div>`;
}

// ── Setters cockpit ─────────────────────────────────────────────────────────
function _cockpitSetFilter(k){ _cockpitFilter = k; _cockpitLimit = _COCKPIT_PAGE; renderProdCockpit(); }
function _cockpitSetOp(v){ _cockpitOp = v; _cockpitLimit = _COCKPIT_PAGE; renderProdCockpit(); }
function _cockpitSetShift(k){ _cockpitShift = k; _cockpitLimit = _COCKPIT_PAGE; renderProdCockpit(); }
function _cockpitSetEtape(v){ _cockpitEtape = v; _cockpitLimit = _COCKPIT_PAGE; renderProdCockpit(); }
function _cockpitSetSort(k){
  if (_cockpitSort.key === k) _cockpitSort.dir = _cockpitSort.dir==='asc' ? 'desc' : 'asc';
  else { _cockpitSort.key = k; _cockpitSort.dir = 'asc'; }
  renderProdCockpit();
}
function _cockpitToggleSortDir(){ _cockpitSort.dir = _cockpitSort.dir==='asc' ? 'desc' : 'asc'; renderProdCockpit(); }
function _cockpitToggleDensity(){ _cockpitDensity = _cockpitDensity==='compact' ? 'detaille' : 'compact'; renderProdCockpit(); }
function _cockpitToggleOps(){ _cockpitOpsOpen = !_cockpitOpsOpen; renderProdCockpit(); }
function _cockpitSetSearch(v){ _cockpitSearch = v; _cockpitLimit = _COCKPIT_PAGE; _cockpitRenderBody(); }
function _cockpitShowMore(){ _cockpitLimit += _COCKPIT_PAGE; _cockpitRenderBody(); }

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
  // Les tâches libres vivent aussi dans SHEET_TACHES (DossierID='LIBRE') : il faut
  // pointer côté serveur comme une tâche normale, sinon le statut reste bloqué à
  // A_FAIRE dans le Sheet (invisible/faux pour operateur.html et les autres appareils).
  if (APPS_SCRIPT_URL) { r = await apiCall({ action:'pointerAction', tacheId, action_:'START' }); }
  else { r = { ok:true }; }
  if (r && r.ok) {
    if (t) { t.statut = 'EN_COURS'; t.dateDebut = new Date().toLocaleString('fr-FR'); t.startTs = Date.now(); delete t.endTs; }
    if (isLibre) saveTachesLibres(); else saveTaches();
    // Notification de début de tâche visible par tous
    _addNotification({
      dossierId:     t.dossierId,
      numeroDossier: isLibre ? 'Tâche libre' : t.numeroDossier,
      etapeCode:     isLibre ? 'LIBRE' : t.etapeCode,
      etapeLabel:    isLibre ? (t.titre||t.etapeLabel) : t.etapeLabel,
      operateur:     currentUser?.label || t.operateur,
      message:       isLibre
        ? `${currentUser?.label} a commencé la tâche libre "${t.titre||t.etapeLabel}"`
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
  if (APPS_SCRIPT_URL) { r = await apiCall({ action:'pointerAction', tacheId, action_:'END', etapeCode, commentaire:comment }); }
  else { r = { ok:true }; }
  if (r && r.ok) {
    const t = isLibre ? tachesLibres.find(x => x.id === tacheId) : taches.find(x => x.id === tacheId);
    if (t) { t.statut = 'TERMINE'; t.dateFin = new Date().toLocaleString('fr-FR'); t.endTs = Date.now(); t.commentaire = comment || t.commentaire; }
    if (isLibre) saveTachesLibres(); else saveTaches();

    // Vérifier si le dossier est maintenant complet à 100%
    let dossierComplet = false;
    if (!isLibre && t) {
      const tachesD = taches.filter(x => x.dossierId === t.dossierId);
      // Complet = toutes les étapes APPLICABLES (ayant au moins une tâche) sont terminées
      // (modèle _dossierPct, aligné sur le serveur). Évite qu'un dossier « se complète »
      // via des étapes jamais assignées.
      const d = dossiers.find(x => x.id === t.dossierId);
      const pct = _dossierPct(tachesD, d);
      if (pct === 100) {
        dossierComplet = true;
        if (d) { d.statut = 'LIVRE'; d.progression = 100; }
      }
    }

    // Notification d'avancement visible par tous
    if (t) {
      _addNotification({
        dossierId:     t.dossierId,
        numeroDossier: isLibre ? 'Tâche libre' : t.numeroDossier,
        etapeCode:     isLibre ? 'LIBRE' : t.etapeCode,
        etapeLabel:    isLibre ? (t.titre||t.etapeLabel) : t.etapeLabel,
        operateur:     currentUser?.label || t.operateur,
        message:       dossierComplet
          ? `Dossier ${t.numeroDossier} terminé à 100% — toutes les étapes sont complètes`
          : isLibre
          ? `${currentUser?.label} a terminé la tâche libre "${t.titre||t.etapeLabel}"`
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
  const opTimes = _operatorTimes();
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
              <th style="text-align:right;padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--color-text-muted)" title="Temps de production cumulé (tâches terminées + en cours)">Temps prod</th>
            </tr></thead>
            <tbody>
              ${ops.map(o=>`<tr style="border-bottom:1px solid var(--color-border)">
                <td style="padding:8px 12px;font-size:13px;font-weight:600;color:var(--color-text-primary)">${o.nom}${o.enCours?' <span style="color:var(--color-warning);font-size:10px" title="A une tâche en cours">●</span>':''}</td>
                <td style="padding:8px 12px;text-align:center"><span class="prod-badge" style="background:var(--color-info-bg);color:var(--color-info)">${o.aFaire}</span></td>
                <td style="padding:8px 12px;text-align:center"><span class="prod-badge" style="background:var(--color-warning-bg);color:var(--color-warning)">${o.enCours}</span></td>
                <td style="padding:8px 12px;text-align:center"><span class="prod-badge" style="background:var(--color-success-bg);color:var(--color-success)">${o.termine}</span></td>
                <td style="padding:8px 12px;text-align:right;font-size:13px"><span class="op-prodtime" data-op-label="${o.nom}">${_fmtDuree(opTimes[o.nom]||0)}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
    </div>`;
  _ensureChronoTick();
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
  await loadEncaissementsFromScript().catch(()=>{});
  renderPatronDashboard();
  renderPatronEncaissements();
}

async function refreshPatronDashboard(btn) {
  _lastPatronRefresh = 0;
  if (btn) { btn.disabled = true; document.getElementById('patronRefreshIcon').style.animation = 'spin .8s linear infinite'; }
  await _autoRefreshPatron();
  renderControlFinance();
  if (btn) { btn.disabled = false; document.getElementById('patronRefreshIcon').style.animation = ''; }
  showToast('Tableau de bord actualisé');
}

// ============================================================
// CONTRÔLE FINANCIER PATRON — par période (semaine / mois / année / tout)
// Données agrégées CÔTÉ SERVEUR (action getControlPatron) pour couvrir
// TOUT l'historique, pas seulement les ventes chargées côté client.
// ============================================================
let _patronPeriod = { mode: 'month', anchor: new Date() };

function _cfEsc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
function _cfStartDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function _cfEndDay(d){ const x=new Date(d); x.setHours(23,59,59,999); return x; }

function _patronPeriodRange() {
  const mode = _patronPeriod.mode;
  const a = new Date(_patronPeriod.anchor);
  if (mode === 'all') return { from:null, to:null, label:"Tout l'historique" };
  if (mode === 'day') {
    const start = _cfStartDay(a), end = _cfEndDay(a);
    const lbl = a.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
    return { from:start.getTime(), to:end.getTime(), label: lbl.charAt(0).toUpperCase() + lbl.slice(1) };
  }
  if (mode === 'week') {
    const day = (a.getDay() + 6) % 7; // lundi = 0
    const start = _cfStartDay(new Date(a.getFullYear(), a.getMonth(), a.getDate() - day));
    const end   = _cfEndDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6));
    const f = d => d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' });
    return { from:start.getTime(), to:end.getTime(), label:'Semaine ' + f(start) + ' – ' + f(end) };
  }
  if (mode === 'year') {
    const start = _cfStartDay(new Date(a.getFullYear(), 0, 1));
    const end   = _cfEndDay(new Date(a.getFullYear(), 11, 31));
    return { from:start.getTime(), to:end.getTime(), label:'Année ' + a.getFullYear() };
  }
  const start = _cfStartDay(new Date(a.getFullYear(), a.getMonth(), 1));
  const end   = _cfEndDay(new Date(a.getFullYear(), a.getMonth() + 1, 0));
  const lbl = start.toLocaleDateString('fr-FR', { month:'long', year:'numeric' });
  return { from:start.getTime(), to:end.getTime(), label: lbl.charAt(0).toUpperCase() + lbl.slice(1) };
}

function setPatronPeriodMode(mode) {
  _patronPeriod.mode = mode;
  _patronPeriod.anchor = new Date();
  renderControlFinance();
  renderPatronEncaissements();
}
function shiftPatronPeriod(dir) {
  const a = new Date(_patronPeriod.anchor);
  if (_patronPeriod.mode === 'day')        a.setDate(a.getDate() + dir);
  else if (_patronPeriod.mode === 'week')  a.setDate(a.getDate() + dir * 7);
  else if (_patronPeriod.mode === 'year')  a.setFullYear(a.getFullYear() + dir);
  else if (_patronPeriod.mode === 'month') a.setMonth(a.getMonth() + dir);
  else return; // 'all' : pas de navigation
  _patronPeriod.anchor = a;
  renderControlFinance();
  renderPatronEncaissements();
}

// ── Refonte UX vue patron (pcf-*) : hiérarchie, scanabilité, progressive
//    disclosure, kebab, table responsive → cartes, 80/20. ──────────────────
let _pcfCais = [], _pcfCli = [], _pcfLast = null;
const _PCF_DOTS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';

function _pcfToolbar() {
  const mode = _patronPeriod.mode;
  const range = _patronPeriodRange();
  const seg = (m, lbl) => `<button class="pcf-seg${mode===m?' active':''}" onclick="setPatronPeriodMode('${m}')">${lbl}</button>`;
  const dis = mode === 'all';
  const csvIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  const prnIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
  const dlIcon  = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:-2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  return `<div class="pcf-toolbar">
    <div class="pcf-segs">${seg('day','Jour')}${seg('week','Semaine')}${seg('month','Mois')}${seg('year','Année')}${seg('all','Tout')}</div>
    <div class="pcf-tools">
      <div class="pcf-nav">
        <button onclick="shiftPatronPeriod(-1)" ${dis?'disabled':''} aria-label="Période précédente">‹</button>
        <span class="pcf-nav-label">${_cfEsc(range.label)}</span>
        <button onclick="shiftPatronPeriod(1)" ${dis?'disabled':''} aria-label="Période suivante">›</button>
      </div>
      <div class="kebab-wrap">
        <button class="pcf-export-btn" aria-haspopup="true" onclick="toggleKebab('pcfexp',event)">${dlIcon}Exporter</button>
        <div class="kebab-menu" id="kb-pcfexp" role="menu">
          <button class="kebab-item" role="menuitem" onclick="closeAllKebabs();exportControlFinanceCSV()">${csvIcon}<span>Exporter en CSV</span></button>
          <button class="kebab-item" role="menuitem" onclick="closeAllKebabs();printControlFinanceReport()">${prnIcon}<span>Imprimer / PDF</span></button>
        </div>
      </div>
    </div>
  </div>`;
}

function _pcfIcon(name){
  const s='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  if(name==='users')    return s+'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  if(name==='wallet')   return s+'<path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>';
  if(name==='calendar') return s+'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
  return '';
}

function _pcfKpi(label, val, sub, color){
  return `<div class="pcf-kpi" style="--kc:${color}">
    <div class="pcf-kpi-label">${label}</div>
    <div class="pcf-kpi-val" style="color:${color}">${val}</div>
    <div class="pcf-kpi-sub">${sub}</div>
  </div>`;
}

// Progressive disclosure — déplier une ligne (caissier/client)
function _pcfToggle(key){
  const r=document.getElementById('pcfr-'+key), d=document.getElementById('pcfd-'+key);
  if(!r||!d) return;
  const open=r.classList.toggle('open');
  d.classList.toggle('open', open);
}
function _pcfToggleMenu(key, ev){ if(ev) ev.stopPropagation(); closeAllKebabs(); _pcfToggle(key); }
function _pcfMore(cls, btn){ document.querySelectorAll('.'+cls).forEach(el=>{ el.style.display=''; }); if(btn) btn.style.display='none'; }

// Kebab — actions secondaires
function _pcfCopy(txt){
  const done=()=>{ if(typeof showToast==='function') showToast('Récapitulatif copié'); };
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(done).catch(()=>_pcfCopyFallback(txt,done)); }
    else _pcfCopyFallback(txt, done);
  }catch(e){ _pcfCopyFallback(txt, done); }
}
function _pcfCopyFallback(txt, done){
  try{ const ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done&&done(); }catch(e){}
}
function _pcfCopyCais(i, ev){
  if(ev) ev.stopPropagation(); closeAllKebabs();
  const c=_pcfCais[i]; if(!c) return;
  _pcfCopy(`Caissier : ${c.nom}\nPériode : ${_patronPeriodRange().label}\nOpérations : ${c.nb||0}\nEngagé : ${fmt(c.engage)}\nEncaissé : ${fmt(c.encaisse)}\nReste : ${fmt(c.restant)}`);
}
function _pcfCopyCli(i, ev){
  if(ev) ev.stopPropagation(); closeAllKebabs();
  const c=_pcfCli[i]; if(!c) return;
  _pcfCopy(`Client : ${c.client}\nDossiers : ${c.nb||0}\nEngagé : ${fmt(c.engage)}\nAcompte : ${fmt(c.accompte)}\nReste dû : ${fmt(c.restant)}`);
}
function _pcfVoirCommandes(i, ev){
  if(ev) ev.stopPropagation(); closeAllKebabs();
  const c=_pcfCli[i]; if(!c) return;
  showPage('commandes');
  const s=document.getElementById('cmdSearch'); if(s) s.value=c.client;
  if(typeof renderCommandes==='function') renderCommandes();
}

// ── Vue patron : encaissements par caissier (fiche d'encaissement centralisée) ──
// Lit le journal `encaissements` (fusionné depuis le serveur → tous les caissiers)
// sur la période patron sélectionnée. Détail dépliable = la fiche par caissier.
// Nature d'une entrée d'argent, du point de vue caisse :
//   acompte  = argent partiel reçu à la création d'une commande (reste dû plus tard)
//   solde    = reste encaissé à la livraison / règlement d'une dette existante
//   comptant = vente payée intégralement sur le champ
function _encNature(e) {
  const t = String(e && e.type || '').toLowerCase();
  if (t === 'acompte') return 'acompte';
  if (t === 'solde' || t === 'paiement') return 'solde';
  return 'comptant';
}

// « Entrées d'argent réelles » (arrêt de caisse consolidé, vue patron)
// Basé UNIQUEMENT sur le journal d'encaissements (argent physiquement reçu),
// ≠ CA engagé du Contrôle financier. Répond à : « combien est réellement rentré
// en caisse, et quelle part est un acompte du jour vs un solde de livraison ? »
function renderPatronEncaissements() {
  const box = document.getElementById('patronEncaissements');
  if (!box) return;
  const range = _patronPeriodRange();
  const inRange = e => {
    if (range.from == null) return true;
    const d = parseSaleDate(e.date); if (!d) return false;
    const t = d.getTime();
    return t >= range.from && t <= range.to;
  };
  const list = (Array.isArray(encaissements) ? encaissements : []).filter(inRange);
  const esc = _pcokEsc;

  // Totaux globaux (nature + moyen de paiement) + regroupements caissier / jour
  const T = { total:0, acompte:0, solde:0, comptant:0, cash:0, mobile:0, cheque:0, nb:0 };
  const byCais = {}, byDay = {};
  const dayKey = d => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '—';
  list.forEach(e => {
    const m = Number(e.montant) || 0;
    if (m <= 0) return;
    const nat = _encNature(e);
    const meth = e.method === 'cash' ? 'cash' : e.method === 'cheque' ? 'cheque' : 'mobile';
    T.total += m; T[nat] += m; T[meth] += m; T.nb++;

    const key = e.caissierLabel || e.caissier || 'Caissier';
    const g = byCais[key] || (byCais[key] = { nom:key, nb:0, total:0, acompte:0, solde:0, comptant:0, cash:0, mobile:0, cheque:0, lignes:[] });
    g.nb++; g.total += m; g[nat] += m; g[meth] += m; g.lignes.push(e);

    const dk = dayKey(parseSaleDate(e.date));
    const dd = byDay[dk] || (byDay[dk] = { key:dk, total:0, acompte:0, solde:0, comptant:0 });
    dd.total += m; dd[nat] += m;
  });

  const head = `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:4px">
      <h3 style="margin:0;font-size:15px;font-weight:800;color:var(--text)">Entrées d'argent réelles <span style="font-size:11px;font-weight:600;color:var(--muted)">· caisse</span></h3>
      <span style="font-size:12px;color:var(--muted)">${esc(range.label)} · Total <b style="color:#16a34a">${fmt(T.total)}</b></span>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:14px;line-height:1.5">Argent physiquement encaissé sur la période — acomptes du jour + soldes de livraison + comptant. Différent du <b>CA engagé</b> (valeur des commandes créées).</div>`;

  if (!T.nb) {
    box.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px">${head}
      <div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">Aucune entrée d'argent sur cette période</div></div>`;
    return;
  }

  const kpi = (lbl, val, col, sub) => `<div style="flex:1;min-width:120px;background:var(--surface2);border-radius:10px;padding:10px 12px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">${lbl}</div>
      <div style="font-size:16px;font-weight:800;color:${col};margin-top:2px">${fmt(val)}</div>
      ${sub ? `<div style="font-size:10px;color:var(--muted);margin-top:1px">${sub}</div>` : ''}</div>`;

  // Ventilation par NATURE (le cœur de la réponse au patron)
  const nature = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      ${kpi('Acomptes', T.acompte, '#b45309', 'nouvelles commandes')}
      ${kpi('Soldes / règlements', T.solde, '#1e40af', 'livraisons & restes')}
      ${kpi('Comptant', T.comptant, '#16a34a', 'payé intégral')}
      ${kpi('Total entré en caisse', T.total, '#0f766e', T.nb + ' encaissement' + (T.nb > 1 ? 's' : ''))}
    </div>`;

  // Ventilation par MOYEN de paiement
  const moyen = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      ${kpi('Espèces', T.cash, '#1a4a3a')}${kpi('Mobile Money', T.mobile, '#c2410c')}${T.cheque > 0 ? kpi('Chèque', T.cheque, '#1e40af') : ''}
    </div>`;

  // Détail par JOUR (utile car l'arrêt de caisse est quotidien) — si plusieurs jours
  const days = Object.values(byDay).filter(d => d.key !== '—').sort((a, b) => b.key.localeCompare(a.key));
  const dayLbl = k => { const p = k.split('-'); const d = new Date(+p[0], +p[1]-1, +p[2]); const s = d.toLocaleDateString('fr-FR', { weekday:'short', day:'2-digit', month:'short' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const perDay = days.length > 1 ? `<div style="border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden">
      <div style="padding:9px 12px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:var(--surface2)">Entrées par jour</div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="font-size:10px;color:var(--muted);text-align:right">
          <th style="padding:5px 10px;text-align:left">Jour</th><th style="padding:5px 8px">Acompte</th><th style="padding:5px 8px">Solde</th><th style="padding:5px 8px">Comptant</th><th style="padding:5px 10px">Total</th>
        </tr></thead>
        <tbody>${days.map(d => `<tr style="border-top:1px solid var(--border);font-size:12px">
          <td style="padding:6px 10px;font-weight:600">${dayLbl(d.key)}</td>
          <td style="padding:6px 8px;text-align:right;color:#b45309">${d.acompte ? fmt(d.acompte) : '—'}</td>
          <td style="padding:6px 8px;text-align:right;color:#1e40af">${d.solde ? fmt(d.solde) : '—'}</td>
          <td style="padding:6px 8px;text-align:right;color:#16a34a">${d.comptant ? fmt(d.comptant) : '—'}</td>
          <td style="padding:6px 10px;text-align:right;font-weight:800">${fmt(d.total)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>` : '';

  const natBadge = e => {
    const n = _encNature(e);
    const s = 'padding:2px 7px;border-radius:20px;font-size:10px;font-weight:800;white-space:nowrap';
    if (n === 'acompte') return `<span style="background:#fef3c7;color:#b45309;${s}">Acompte</span>`;
    if (n === 'solde')   return `<span style="background:#dbeafe;color:#1e40af;${s}">Solde</span>`;
    return `<span style="background:#dcfce7;color:#16a34a;${s}">Comptant</span>`;
  };

  // Détail par CAISSIER (dépliable)
  const groups = Object.values(byCais).sort((a, b) => b.total - a.total);
  const rows = groups.map(g => {
    const ligneRows = g.lignes.slice().sort((a, b) => new Date(a.date) - new Date(b.date)).map(l => {
      const obs = (Number(l.resteApres) || 0) > 0
        ? `<span style="color:#dc2626;font-weight:700">RAP ${fmt(l.resteApres)}</span>`
        : `<span style="color:#16a34a;font-weight:600">Soldé</span>`;
      const hh = l.time || (parseSaleDate(l.date) ? parseSaleDate(l.date).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }) : '');
      return `<tr style="border-top:1px solid var(--border)">
        <td style="padding:5px 8px;font-size:11px;color:var(--muted);white-space:nowrap">${esc(l.refLabel || ('#' + l.refId))}</td>
        <td style="padding:5px 8px;font-size:12px">${esc(l.client || 'Client comptant')}<span style="color:var(--muted);font-size:10px"> · ${esc(fmtMethLabel(l.method))}${hh ? ' · ' + hh : ''}</span></td>
        <td style="padding:5px 8px;text-align:center">${natBadge(l)}</td>
        <td style="padding:5px 8px;text-align:right;font-weight:700;white-space:nowrap">${fmt(l.montant)}</td>
        <td style="padding:5px 8px;text-align:right;font-size:11px;white-space:nowrap">${obs}</td>
      </tr>`;
    }).join('');
    const natSub = [g.acompte ? 'Acpt ' + fmt(g.acompte) : '', g.solde ? 'Solde ' + fmt(g.solde) : '', g.comptant ? 'Cpt ' + fmt(g.comptant) : ''].filter(Boolean).join(' · ');
    return `<details style="border:1px solid var(--border);border-radius:10px;margin-bottom:8px;overflow:hidden">
      <summary style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;cursor:pointer;list-style:none">
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--text)">${esc(g.nom)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${g.nb} encaissement${g.nb > 1 ? 's' : ''}${natSub ? ' · ' + natSub : ''}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:1px">Esp. ${fmt(g.cash)} · MM ${fmt(g.mobile)}${g.cheque > 0 ? ' · Chq ' + fmt(g.cheque) : ''}</div>
        </div>
        <div style="font-size:15px;font-weight:800;color:#16a34a;white-space:nowrap">${fmt(g.total)}</div>
      </summary>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid var(--border);background:var(--surface2)">
        <tbody>${ligneRows}</tbody>
      </table>
    </details>`;
  }).join('');

  box.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px">
      ${head}
      ${nature}
      ${moyen}
      ${perDay}
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:4px 0 8px">Détail par caissier</div>
      ${rows}
    </div>`;
}

function fmtMethLabel(m) { return m === 'cash' ? 'Espèces' : m === 'cheque' ? 'Chèque' : 'Mobile Money'; }

async function renderControlFinance() {
  const box = document.getElementById('patronControlFinance');
  if (!box) return;
  const detail = document.getElementById('patronControlDetail');
  const range = _patronPeriodRange();
  box.innerHTML = _pcfToolbar() + `<div class="pcf-loading">Calcul en cours…</div>`;
  if (detail) detail.innerHTML = '';

  let r = null;
  try { r = await apiCall({ action:'getControlPatron', from: range.from, to: range.to }); } catch(e) {}
  if (!r || !r.ok) {
    const _m = r ? (r.error || 'réponse ok=false') : 'aucune réponse (réseau)';
    box.innerHTML = _pcfToolbar() + `<div class="pcf-error">Impossible de charger le contrôle financier${APPS_SCRIPT_URL ? '' : ' (Apps Script non configuré)'} — <span style="font-family:monospace;font-size:12px">${_cfEsc(_m)}</span></div>`;
    if (detail) detail.innerHTML = '';
    return;
  }

  const t = r.totals || { engage:0, encaisse:0, restant:0, nbVentes:0, nbEnCours:0 };
  const nbOps   = (t.nbVentes||0) + (t.nbEnCours||0);
  const tauxEnc = t.engage>0 ? Math.round((t.encaisse||0)/t.engage*100) : 0;
  const panier  = nbOps>0 ? Math.round((t.engage||0)/nbOps) : 0;
  const cais  = (r.parCaissier||[]).slice().sort((a,b)=>(b.engage||0)-(a.engage||0));
  const cli   = (r.parClient||[]).slice().sort((a,b)=>(b.restant||0)-(a.restant||0));
  const jours = r.parJour || [];
  const topCais = cais[0];
  _pcfCais = cais; _pcfCli = cli;
  _pcfLast = { rangeLabel: range.label, totals: t, cais: cais, cli: cli, jours: jours };

  // ── HERO — métrique principale (Information Hierarchy + 80/20) ──
  const hero = `<div class="pcf-hero">
    <div class="pcf-hero-main">
      <div class="pcf-hero-label">Chiffre d'affaires · ${_cfEsc(range.label)}</div>
      <div class="pcf-hero-val">${fmt(t.engage)}</div>
      <div class="pcf-hero-meta">${nbOps} opération(s) · ${t.nbVentes||0} vente(s) comptant · ${t.nbEnCours||0} commande(s)/résa</div>
    </div>
    <div class="pcf-gauge">
      <div class="pcf-gauge-top"><span>Taux d'encaissement</span><strong>${tauxEnc}%</strong></div>
      <div class="pcf-gauge-bar"><div class="pcf-gauge-fill" style="width:${Math.min(100,tauxEnc)}%"></div></div>
      <div class="pcf-gauge-legend">
        <span><span class="pcf-dot" style="background:#7be0b8"></span>Encaissé <b>${fmt(t.encaisse)}</b></span>
        <span><span class="pcf-dot" style="background:#ffb4a8"></span>Reste <b>${fmt(t.restant)}</b></span>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:6px;line-height:1.4">Cumul sur les commandes de la période — <b>pas la caisse du jour</b>. Trésorerie réelle → « Entrées d'argent réelles » ci-dessous.</div>
    </div>
  </div>`;

  // ── KPIs secondaires ──
  const kpis = `<div class="pcf-kpis">
    ${_pcfKpi('Panier moyen', fmt(panier), 'par opération', '#2563eb')}
    ${_pcfKpi('Opérations', nbOps, (t.nbVentes||0)+' vente(s) · '+(t.nbEnCours||0)+' en cours', '#7c3aed')}
    ${_pcfKpi('Clients débiteurs', cli.length, fmt(t.restant)+' à recouvrer', '#dc2626')}
    ${_pcfKpi('Top caissier', topCais?_cfEsc(topCais.nom):'—', topCais?fmt(topCais.engage):'aucune vente', '#1a4a3a')}
  </div>`;

  box.innerHTML = _pcfToolbar() + hero + kpis;
  if (detail) detail.innerHTML = _pcfJoursCard(jours) + _pcfCaissierCard(cais, t) + _pcfClientCard(cli, t);
}

// ── Carte « Ventes par jour » (scanabilité + mini-barres + voir plus) ──
function _pcfJoursCard(jours){
  const _lbl = (j)=>{ const p=String(j).split('-'); const d=new Date(+p[0],+p[1]-1,+p[2]); const s=d.toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'short'}); return s.charAt(0).toUpperCase()+s.slice(1); };
  const arr = jours.slice().sort((a,b)=> String(b.jour).localeCompare(String(a.jour)));
  const maxM = Math.max(1, ...arr.map(j=>j.montant||0));
  const total = arr.reduce((a,j)=>a+(j.montant||0),0);
  const N=7;
  const rows = arr.map((j,i)=>{
    const w=Math.round((j.montant||0)/maxM*100);
    const hide=i>=N;
    return `<tr class="pcf-row${hide?' pcf-x-jour':''}"${hide?' style="display:none"':''} style="cursor:default">
      <td class="pcf-c-main" data-label="Jour"><span class="pcf-name">${_lbl(j.jour)}</span></td>
      <td class="pcf-num" data-label="Ventes">${j.nb||0}</td>
      <td class="pcf-num" data-label="Montant"><span class="pcf-minibar"><i style="width:${w}%;background:#1a4a3a"></i></span>${fmt(j.montant)}</td>
    </tr>`;
  }).join('');
  const more = arr.length>N ? `<button class="pcf-more" onclick="_pcfMore('pcf-x-jour',this)">Voir les ${arr.length-N} autres jours ›</button>` : '';
  const body = arr.length ? rows : `<tr><td colspan="3"><div class="pcf-empty">Aucune vente sur la période</div></td></tr>`;
  return `<div class="pcf-card">
    <div class="pcf-card-head">
      <div class="ic" style="background:#e8f4f0;color:#1a4a3a">${_pcfIcon('calendar')}</div>
      <div><div class="pcf-card-title">Ventes par jour</div><div class="pcf-card-sub">Chaque entrée POS comptée à sa date d'entrée</div></div>
      <span class="pcf-card-badge" style="background:#e8f4f0;color:#1a4a3a">${fmt(total)}</span>
    </div>
    <table class="pcf-table">
      <thead><tr><th>Jour</th><th class="pcf-num">Ventes</th><th class="pcf-num">Montant</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${more}
  </div>`;
}

// ── Carte « Performance par caissier » (responsive + disclosure + kebab) ──
function _pcfCaissierCard(cais, t){
  const maxEng = Math.max(1, ...cais.map(c=>c.engage||0));
  const totEng = cais.reduce((a,c)=>a+(c.engage||0),0) || 1;
  const N=8;
  const rankBg=['#fef3c7','#e5e7eb','#fde4cf'], rankFg=['#b45309','#4b5563','#9a3412'];
  const rows = cais.map((c,i)=>{
    const key='c'+i, uid='pcfc'+i;
    const share=Math.round((c.engage||0)/maxEng*100);
    const pct=Math.round((c.engage||0)/totEng*100);
    const nbVent=c.nbVentes||0, nbCmd=Math.max(0,(c.nb||0)-nbVent);
    const moy=(c.nb||0)?Math.round((c.engage||0)/c.nb):0;
    const encPct=(c.engage||0)>0?Math.round((c.encaisse||0)/c.engage*100):0;
    const rank = i<3
      ? `<span class="pcf-rank" style="background:${rankBg[i]};color:${rankFg[i]}">${i+1}</span>`
      : `<span class="pcf-rank" style="background:var(--surface2);color:var(--muted)">${i+1}</span>`;
    const hide=i>=N, hideCls=hide?' pcf-x-cais':'', hideSt=hide?' style="display:none"':'';
    return `<tr class="pcf-row${hideCls}" id="pcfr-${key}" onclick="_pcfToggle('${key}')"${hideSt}>
        <td class="pcf-c-main" data-label="Caissier">
          <span style="display:inline-flex;align-items:center;gap:9px">${rank}<span class="pcf-name">${_cfEsc(c.nom)}</span>
          <svg class="pcf-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
        </td>
        <td class="pcf-num" data-label="Opér.">${c.nb||0}</td>
        <td class="pcf-num" data-label="Engagé"><span class="pcf-minibar"><i style="width:${share}%;background:#1a4a3a"></i></span>${fmt(c.engage)}</td>
        <td class="pcf-num" data-label="Encaissé" style="color:#16a34a">${fmt(c.encaisse)}</td>
        <td class="pcf-num" data-label="Restant" style="color:${(c.restant||0)>0?'#dc2626':'var(--muted)'};font-weight:700">${fmt(c.restant)}</td>
        <td class="pcf-c-act">
          <div class="kebab-wrap" onclick="event.stopPropagation()">
            <button class="kebab-btn" aria-label="Actions" aria-haspopup="true" onclick="toggleKebab('${uid}',event)">${_PCF_DOTS}</button>
            <div class="kebab-menu" id="kb-${uid}" role="menu">
              <button class="kebab-item" role="menuitem" onclick="_pcfToggleMenu('${key}',event)">${_kebabIcon('open')}<span>Voir le détail</span></button>
              <button class="kebab-item" role="menuitem" onclick="_pcfCopyCais(${i},event)">${_kebabIcon('cash')}<span>Copier le récap</span></button>
            </div>
          </div>
        </td>
      </tr>
      <tr class="pcf-detail-row${hideCls}"${hideSt}><td colspan="6">
        <div class="pcf-detail" id="pcfd-${key}">
          <div class="pcf-detail-grid">
            <div class="pcf-dt"><div class="pcf-dt-l">Ventes comptant</div><div class="pcf-dt-v">${nbVent}</div></div>
            <div class="pcf-dt"><div class="pcf-dt-l">Commandes / résa</div><div class="pcf-dt-v">${nbCmd}</div></div>
            <div class="pcf-dt"><div class="pcf-dt-l">Panier moyen</div><div class="pcf-dt-v">${fmt(moy)}</div></div>
            <div class="pcf-dt"><div class="pcf-dt-l">Part du CA</div><div class="pcf-dt-v">${pct}%</div></div>
            <div class="pcf-dt"><div class="pcf-dt-l">Taux encaissé</div><div class="pcf-dt-v">${encPct}%</div></div>
          </div>
        </div>
      </td></tr>`;
  }).join('');
  const more = cais.length>N ? `<button class="pcf-more" onclick="_pcfMore('pcf-x-cais',this)">Voir les ${cais.length-N} autres caissiers ›</button>` : '';
  const body = cais.length ? rows : `<tr><td colspan="6"><div class="pcf-empty">Aucune vente sur la période</div></td></tr>`;
  return `<div class="pcf-card">
    <div class="pcf-card-head">
      <div class="ic" style="background:#e8f4f0;color:#1a4a3a">${_pcfIcon('users')}</div>
      <div><div class="pcf-card-title">Performance par caissier</div><div class="pcf-card-sub">Classé par CA · touchez une ligne pour le détail</div></div>
      <span class="pcf-card-badge" style="background:#e8f4f0;color:#1a4a3a">${cais.length} caissier(s)</span>
    </div>
    <table class="pcf-table">
      <thead><tr><th>Caissier</th><th class="pcf-num">Opér.</th><th class="pcf-num">Engagé</th><th class="pcf-num">Encaissé</th><th class="pcf-num">Restant</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${more}
  </div>`;
}

// ── Carte « À recouvrer par client » (responsive + disclosure + kebab) ──
function _pcfClientCard(cli, t){
  const maxRest = Math.max(1, ...cli.map(c=>c.restant||0));
  const N=8;
  const rows = cli.map((c,i)=>{
    const key='k'+i, uid='pcfk'+i;
    const share=Math.round((c.restant||0)/maxRest*100);
    const payPct=(c.engage||0)>0?Math.round((c.accompte||0)/c.engage*100):0;
    const hide=i>=N, hideCls=hide?' pcf-x-cli':'', hideSt=hide?' style="display:none"':'';
    return `<tr class="pcf-row${hideCls}" id="pcfr-${key}" onclick="_pcfToggle('${key}')"${hideSt}>
        <td class="pcf-c-main" data-label="Client">
          <span style="display:inline-flex;align-items:center;gap:9px"><span class="pcf-name">${_cfEsc(c.client)}</span>
          <svg class="pcf-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
        </td>
        <td class="pcf-num" data-label="Dossiers">${c.nb||0}</td>
        <td class="pcf-num" data-label="Engagé">${fmt(c.engage)}</td>
        <td class="pcf-num" data-label="Acompte" style="color:#16a34a">${fmt(c.accompte)}</td>
        <td class="pcf-num" data-label="Reste dû"><span class="pcf-minibar"><i style="width:${share}%;background:#dc2626"></i></span><span style="color:#dc2626;font-weight:800">${fmt(c.restant)}</span></td>
        <td class="pcf-c-act">
          <div class="kebab-wrap" onclick="event.stopPropagation()">
            <button class="kebab-btn" aria-label="Actions" aria-haspopup="true" onclick="toggleKebab('${uid}',event)">${_PCF_DOTS}</button>
            <div class="kebab-menu" id="kb-${uid}" role="menu">
              <button class="kebab-item" role="menuitem" onclick="_pcfVoirCommandes(${i},event)">${_kebabIcon('open')}<span>Voir ses commandes</span></button>
              <button class="kebab-item" role="menuitem" onclick="_pcfCopyCli(${i},event)">${_kebabIcon('cash')}<span>Copier le récap</span></button>
            </div>
          </div>
        </td>
      </tr>
      <tr class="pcf-detail-row${hideCls}"${hideSt}><td colspan="6">
        <div class="pcf-detail" id="pcfd-${key}">
          <div class="pcf-detail-grid">
            <div class="pcf-dt"><div class="pcf-dt-l">Dossiers en cours</div><div class="pcf-dt-v">${c.nb||0}</div></div>
            <div class="pcf-dt"><div class="pcf-dt-l">Total engagé</div><div class="pcf-dt-v">${fmt(c.engage)}</div></div>
            <div class="pcf-dt"><div class="pcf-dt-l">Déjà payé</div><div class="pcf-dt-v">${payPct}%</div></div>
            <div class="pcf-dt"><div class="pcf-dt-l">Reste dû</div><div class="pcf-dt-v" style="color:#dc2626">${fmt(c.restant)}</div></div>
          </div>
        </div>
      </td></tr>`;
  }).join('');
  const more = cli.length>N ? `<button class="pcf-more" onclick="_pcfMore('pcf-x-cli',this)">Voir les ${cli.length-N} autres clients ›</button>` : '';
  const body = cli.length ? rows : `<tr><td colspan="6"><div class="pcf-empty">Aucun reste à recouvrer 🎉</div></td></tr>`;
  return `<div class="pcf-card">
    <div class="pcf-card-head">
      <div class="ic" style="background:#fee2e2;color:#dc2626">${_pcfIcon('wallet')}</div>
      <div><div class="pcf-card-title">À recouvrer par client</div><div class="pcf-card-sub">Commandes / réservations non soldées</div></div>
      <span class="pcf-card-badge" style="background:#fee2e2;color:#dc2626">${fmt(t.restant)}</span>
    </div>
    <table class="pcf-table">
      <thead><tr><th>Client</th><th class="pcf-num">Dossiers</th><th class="pcf-num">Engagé</th><th class="pcf-num">Acompte</th><th class="pcf-num">Reste dû</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${more}
  </div>`;
}

// ── Export du contrôle financier (CSV + impression PDF), période affichée ──
function _pcfSlug(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'periode'; }

function exportControlFinanceCSV(){
  const d = _pcfLast;
  if (!d){ showToast('Aucune donnée à exporter — ouvrez la période', 'error'); return; }
  const BOM = '﻿';
  const q = v => '"' + String(v==null?'':v).replace(/"/g,'""') + '"';
  const num = n => Number(n)||0;
  const L = [];
  L.push(q("Contrôle financier — " + d.rangeLabel));
  L.push(q("Édité le " + new Date().toLocaleString('fr-FR')));
  L.push('');
  L.push(q('TOTAUX'));
  L.push([q("Chiffre d'affaires (engagé)"), num(d.totals.engage)].join(','));
  L.push([q('Encaissé'), num(d.totals.encaisse)].join(','));
  L.push([q('Reste à recouvrer'), num(d.totals.restant)].join(','));
  L.push([q('Ventes comptant'), num(d.totals.nbVentes)].join(','));
  L.push([q('Commandes/réservations en cours'), num(d.totals.nbEnCours)].join(','));
  L.push('');
  L.push(q('VENTES PAR JOUR'));
  L.push(['Jour','Nb ventes','Montant'].map(q).join(','));
  (d.jours||[]).forEach(j => L.push([q(j.jour), num(j.nb), num(j.montant)].join(',')));
  L.push('');
  L.push(q('PAR CAISSIER'));
  L.push(['Caissier','Opérations','Ventes comptant','Engagé','Encaissé','Restant'].map(q).join(','));
  (d.cais||[]).forEach(c => L.push([q(c.nom), num(c.nb), num(c.nbVentes), num(c.engage), num(c.encaisse), num(c.restant)].join(',')));
  L.push('');
  L.push(q('À RECOUVRER PAR CLIENT'));
  L.push(['Client','Dossiers','Engagé','Acompte','Reste dû'].map(q).join(','));
  (d.cli||[]).forEach(c => L.push([q(c.client), num(c.nb), num(c.engage), num(c.accompte), num(c.restant)].join(',')));

  const blob = new Blob([BOM + L.join('\n')], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'controle_financier_' + (_pcfSlug(d.rangeLabel) || 'periode') + '_' + new Date().toISOString().split('T')[0] + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Export CSV généré');
}

function _pcfOpenReportWindow(bodyHtml, title){
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w){ alert("Impression bloquée : autorisez les fenêtres pop-up pour ce site, puis réessayez."); return; }
  setTimeout(() => {
    w.document.write(`<html><head><meta charset="utf-8"><title>${title}</title><style>
      @page{size:A4;margin:14mm}
      *{box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;color:#1c1917;margin:0;font-size:12px}
      h1{font-size:18px;margin:0 0 2px}
      .sub{color:#78716c;font-size:12px;margin-bottom:14px}
      .kpis{display:flex;gap:10px;margin:0 0 4px;flex-wrap:wrap}
      .kpi{flex:1;min-width:120px;border:1px solid #e5e3df;border-radius:8px;padding:8px 11px}
      .kpi .l{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#a8a29e;font-weight:bold}
      .kpi .v{font-size:16px;font-weight:bold;margin-top:2px}
      h2{font-size:13px;margin:18px 0 6px;border-bottom:2px solid #1a4a3a;padding-bottom:3px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th{text-align:left;background:#f3f2ef;padding:5px 7px;font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:#555;border-bottom:1px solid #e5e3df}
      td{padding:5px 7px;border-bottom:1px solid #f0efed}
      .r{text-align:right;white-space:nowrap}
      .c{text-align:center}.muted{color:#a8a29e}
      .g{color:#16a34a}.rd{color:#dc2626;font-weight:bold}
      .foot{margin-top:18px;color:#a8a29e;font-size:10px;text-align:center}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body onload="window.print()">${bodyHtml}</body></html>`);
    w.document.close();
  }, 200);
}

function printControlFinanceReport(){
  const d = _pcfLast;
  if (!d){ showToast('Aucune donnée à imprimer — ouvrez la période', 'error'); return; }
  const t = d.totals || {};
  const nbOps = (t.nbVentes||0) + (t.nbEnCours||0);
  const taux  = t.engage>0 ? Math.round((t.encaisse||0)/t.engage*100) : 0;
  const shop  = (typeof shopConfig !== 'undefined' && shopConfig) ? shopConfig : {};
  const shopName = shop.name || 'Boutique';
  const esc = _cfEsc, money = n => fmt(n);
  const _jl = (j) => { const p=String(j).split('-'); const dt=new Date(+p[0],+p[1]-1,+p[2]); const s=dt.toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'short'}); return s.charAt(0).toUpperCase()+s.slice(1); };
  const jourRows = (d.jours||[]).length
    ? d.jours.map(j => `<tr><td>${esc(_jl(j.jour))}</td><td class="r">${j.nb||0}</td><td class="r">${money(j.montant)}</td></tr>`).join('')
    : `<tr><td colspan="3" class="c muted">Aucune vente sur la période</td></tr>`;
  const caisRows = (d.cais||[]).length
    ? d.cais.map((c,i) => `<tr><td class="c">${i+1}</td><td>${esc(c.nom)}</td><td class="r">${c.nb||0}</td><td class="r">${money(c.engage)}</td><td class="r g">${money(c.encaisse)}</td><td class="r rd">${money(c.restant)}</td></tr>`).join('')
    : `<tr><td colspan="6" class="c muted">Aucune vente sur la période</td></tr>`;
  const cliRows = (d.cli||[]).length
    ? d.cli.map(c => `<tr><td>${esc(c.client)}</td><td class="r">${c.nb||0}</td><td class="r">${money(c.engage)}</td><td class="r g">${money(c.accompte)}</td><td class="r rd">${money(c.restant)}</td></tr>`).join('')
    : `<tr><td colspan="5" class="c muted">Aucun reste à recouvrer</td></tr>`;
  const html = `
    <h1>${esc(shopName)} — Contrôle financier</h1>
    <div class="sub">Période : ${esc(d.rangeLabel)} · édité le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
    <div class="kpis">
      <div class="kpi"><div class="l">Chiffre d'affaires</div><div class="v">${money(t.engage)}</div></div>
      <div class="kpi"><div class="l">Encaissé (${taux}%)</div><div class="v g">${money(t.encaisse)}</div></div>
      <div class="kpi"><div class="l">Reste à recouvrer</div><div class="v rd">${money(t.restant)}</div></div>
      <div class="kpi"><div class="l">Opérations</div><div class="v">${nbOps}</div></div>
    </div>
    <h2>Ventes par jour</h2>
    <table><thead><tr><th>Jour</th><th class="r">Nb</th><th class="r">Montant</th></tr></thead><tbody>${jourRows}</tbody></table>
    <h2>Performance par caissier</h2>
    <table><thead><tr><th class="c">#</th><th>Caissier</th><th class="r">Opér.</th><th class="r">Engagé</th><th class="r">Encaissé</th><th class="r">Restant</th></tr></thead><tbody>${caisRows}</tbody></table>
    <h2>À recouvrer par client</h2>
    <table><thead><tr><th>Client</th><th class="r">Dossiers</th><th class="r">Engagé</th><th class="r">Acompte</th><th class="r">Reste dû</th></tr></thead><tbody>${cliRows}</tbody></table>
    <div class="foot">Rapport généré par le POS — ${esc(shopName)}</div>`;
  _pcfOpenReportWindow(html, 'Contrôle financier — ' + d.rangeLabel);
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
          <td data-label="Nb ventes" style="text-align:center"><span style="background:#e8f4f0;color:#1a4a3a;padding:2px 8px;border-radius:12px;font-weight:700;font-size:11px">${d.nb}</span></td>
          <td data-label="Total"><div class="pdb-bar-wrap"><div class="pdb-bar-fill" style="width:${pct}%"></div></div>${fmt(d.total)}</td>
          <td data-label="Panier moyen" style="color:#78716c">${fmt(moy)}</td>
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

  // ── Ventes par jour — détail par commercial (liste dépliable) ──
  // Le serveur stocke la date en « dd/MM/yyyy » (jour d'abord) — parseSaleDate/saleDateKey
  // (qui attendent l'ISO) la mal-interprètent. On passe par _parseFRDate qui gère
  // dd/MM/yyyy ET ISO, puis on dérive un jour LOCAL (cohérent avec « aujourd'hui »).
  const _localDayKey = str => {
    const d = _parseFRDate(str);
    if (!d || isNaN(d)) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const byDay = {};
  sales.forEach(s => {
    const key = _localDayKey(s.date);
    if (!key) return;
    (byDay[key] = byDay[key] || []).push(s);
  });
  const dayKeys = Object.keys(byDay).sort((a, b) => b.localeCompare(a));
  const jourRows = dayKeys.length
    ? dayKeys.map((key, idx) => {
        const daySales = byDay[key];
        const dayTotal = daySales.reduce((a, s) => a + (Number(s.total) || 0), 0);
        const dObj = new Date(key + 'T00:00:00');
        const dayLabel = isNaN(dObj) ? key : dObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        // Regrouper les ventes du jour par commercial (caissier)
        const byCom = {};
        daySales.forEach(s => {
          const c = s.caissier || 'Inconnu';
          (byCom[c] = byCom[c] || []).push(s);
        });
        const comBlocks = Object.entries(byCom)
          .sort((a, b) => b[1].reduce((x, s) => x + (Number(s.total) || 0), 0) - a[1].reduce((x, s) => x + (Number(s.total) || 0), 0))
          .map(([nom, arr]) => {
            const comTotal = arr.reduce((a, s) => a + (Number(s.total) || 0), 0);
            const _heureOf = s => {
              // Le serveur fournit s.time = « HH:mm:ss » ; sinon on lit l'heure de la date (ISO local)
              if (s.time && /\d{1,2}:\d{2}/.test(s.time)) return String(s.time).slice(0, 5);
              const d = _parseFRDate(s.date);
              return d && !isNaN(d) ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
            };
            const saleLines = arr
              .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
              .map(s => {
                const items = (s.items || []).map(i => `${i.name || '?'} ×${i.qty || 1}`).join(', ') || '—';
                const heure = _heureOf(s);
                return `<div class="pdb-day-sale">
                  <div style="min-width:0"><span style="color:#a8a29e">${heure}</span> <span style="font-weight:600;color:#1c1917">${s.clientName || 'Client'}</span> <span style="color:#78716c">${items}</span></div>
                  <div style="font-weight:700;color:#1a4a3a;white-space:nowrap">${fmt(s.total)}</div>
                </div>`;
              }).join('');
            return `<div class="pdb-day-com">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px">
                <span style="font-weight:700;font-size:12px;color:#1a4a3a">${nom} <span style="font-weight:400;color:#78716c;font-size:11px">· ${arr.length} vente(s)</span></span>
                <span style="font-weight:700;color:#1a4a3a;font-size:12px">${fmt(comTotal)}</span>
              </div>
              ${saleLines}
            </div>`;
          }).join('');

        return `<details class="pdb-day"${idx === 0 ? ' open' : ''}>
          <summary>
            <span class="pdb-day-title">${dayLabel}</span>
            <span style="display:flex;align-items:center;gap:10px;flex-shrink:0">
              <span style="font-size:11px;color:#78716c">${daySales.length} vente(s)</span>
              <span style="font-size:13px;font-weight:700;color:#1a4a3a">${fmt(dayTotal)}</span>
            </span>
          </summary>
          <div class="pdb-day-body">${comBlocks}</div>
        </details>`;
      }).join('')
    : `<div class="pdb-empty">Aucune vente enregistrée</div>`;

  const jourHtml = `
  <div class="pdb-section">
    <div class="pdb-section-head">
      <div><div class="pdb-section-title">Ventes par jour — détail par commercial</div><div class="pdb-section-sub">Touchez un jour pour voir le détail des ventes</div></div>
      <span class="pdb-section-badge" style="background:#e8f4f0;color:#1a4a3a">${dayKeys.length} jour(s)</span>
    </div>
    <div style="padding:12px 14px">${jourRows}</div>
  </div>`;

  // ── Charge opérateurs ──
  const allTaches = _allTachesMerged();
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
          <td data-label="À faire" style="text-align:center"><span style="background:#dbeafe;color:#2563eb;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:700">${d.aFaire}</span></td>
          <td data-label="En cours" style="text-align:center"><span style="background:#fef3c7;color:#d97706;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:700">${d.enCours}</span></td>
          <td data-label="Terminé" style="text-align:center"><span style="background:#dcfce7;color:#16a34a;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:700">${d.termine}</span></td>
          <td data-label="Avancement"><div class="pdb-bar-wrap" style="width:100px"><div class="pdb-bar-fill" style="width:${pct}%;background:${pct===100?'#16a34a':'#1a4a3a'}"></div></div><span style="font-size:11px;color:#78716c">${pct}%</span></td>
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
          <td data-label="Stock actuel" style="text-align:center"><span style="font-weight:700;color:${col};font-size:13px">${p.stock}</span></td>
          <td data-label="Seuil min" style="text-align:center;color:#78716c">${p.minStock}</td>
          <td data-label="Statut">${p.stock === 0 ? '<span style="background:#fee2e2;color:#dc2626;font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px">RUPTURE</span>' : '<span style="background:#fef3c7;color:#d97706;font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px">BAS</span>'}</td>
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
        <td data-label="Type"><span style="background:${c.type==='Vente'?'#e8f4f0':'#f3e8ff'};color:${c.type==='Vente'?'#1a4a3a':'#7c3aed'};font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px">${c.type}</span></td>
        <td data-label="Total" style="text-align:right">${fmt(c.montant)}</td>
        <td data-label="Reste dû" style="text-align:right"><span style="font-weight:700;color:#dc2626">${fmt(c.restant)}</span></td>
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
  body.innerHTML = kpiHtml + chartHtml + caissierHtml + jourHtml + opsHtml + prodHtml + resCmdHtml + creancesHtml + stockHtml + actHtml;
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
// OBJECTIFS COMMERCIAUX
// ============================================================
function saveObjectifs() {
  localStorage.setItem('pos-objectifs', JSON.stringify(objectifs));
}

function getObjectif(username) {
  return Number(objectifs[username] || 0);
}

function renderObjectifsConfig() {
  const container = document.getElementById('objectifsConfigContainer');
  if (!container) return;
  const users = (localUsers || []).filter(u => u.actif !== false && ['admin','caissier','commerciale','utilisateur','gestionnaire'].includes(u.role));
  if (users.length === 0) {
    container.innerHTML = '<p style="font-size:13px;color:var(--muted)">Aucun utilisateur trouvé. Ajoutez des utilisateurs d\'abord.</p>';
    return;
  }
  container.innerHTML = `
    <p style="font-size:13px;color:var(--muted);margin:0 0 14px;line-height:1.5">
      Définissez l'objectif de ventes mensuel (en Ar) pour chaque commercial / caissier.
    </p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
      ${users.map(u => `
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
          <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px">${_srEsc(u.label || u.username)}</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:10px">${u.username} · ${u.role}</div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="number" id="obj_${u.username}"
              value="${objectifs[u.username] || ''}"
              placeholder="Ex : 2000000"
              min="0" step="100000"
              style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);outline:none"
              oninput="objectifs['${u.username}'] = parseInt(this.value)||0; saveObjectifs()" />
            <span style="font-size:11px;color:var(--muted);white-space:nowrap">Ar/mois</span>
          </div>
        </div>`).join('')}
    </div>`;
}

// ============================================================
// VENTES PAR CAISSIER — section stats
// ============================================================
function renderCaissierStats() {
  const container = document.getElementById('statsCaissierContent');
  if (!container) return;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const today     = new Date().toDateString();
  const caissierMap = {};

  sales.forEach(s => {
    const name = (s.caissier || 'Inconnu').trim();
    if (!caissierMap[name]) caissierMap[name] = { ventesAuj: 0, ventesMois: 0, countMois: 0, total: 0, count: 0 };
    const t = Number(s.total) || 0;
    caissierMap[name].total += t;
    caissierMap[name].count++;
    const d = parseSaleDate(s.date);
    if (d && d.toDateString() === today)         caissierMap[name].ventesAuj += t;
    if (saleDateKey(s.date).startsWith(thisMonth)){ caissierMap[name].ventesMois += t; caissierMap[name].countMois++; }
  });

  const rows = Object.entries(caissierMap).sort((a, b) => b[1].ventesMois - a[1].ventesMois);
  if (rows.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">Aucune donnée de vente disponible.</div>';
    return;
  }
  container.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--surface2)">
            <th style="text-align:left;padding:9px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Caissier</th>
            <th style="text-align:right;padding:9px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Auj.</th>
            <th style="text-align:right;padding:9px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Ce mois</th>
            <th style="text-align:right;padding:9px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Trans.</th>
            <th style="text-align:right;padding:9px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Panier moy.</th>
            <th style="padding:9px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);min-width:130px">Objectif mois</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([name, d]) => {
            const obj   = getObjectif(name);
            const pct   = obj > 0 ? Math.min(100, Math.round(d.ventesMois / obj * 100)) : 0;
            const pColor= pct >= 100 ? '#16a34a' : pct >= 70 ? '#d97706' : obj > 0 ? '#dc2626' : 'var(--muted)';
            const panierMoy = d.countMois > 0 ? Math.round(d.ventesMois / d.countMois) : 0;
            return `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:10px 12px;font-weight:600;color:var(--text)">${_srEsc(name)}</td>
                <td style="padding:10px 12px;text-align:right;color:var(--muted)">${fmt(d.ventesAuj)}</td>
                <td style="padding:10px 12px;text-align:right;font-weight:700;color:var(--accent)">${fmt(d.ventesMois)}</td>
                <td style="padding:10px 12px;text-align:right;color:var(--muted)">${d.countMois}</td>
                <td style="padding:10px 12px;text-align:right;color:var(--muted)">${fmt(panierMoy)}</td>
                <td style="padding:10px 12px">
                  ${obj > 0 ? `
                    <div style="display:flex;align-items:center;gap:6px">
                      <div style="flex:1;background:var(--border);border-radius:100px;height:6px;overflow:hidden;min-width:60px">
                        <div style="background:${pColor};height:100%;width:${pct}%;border-radius:100px"></div>
                      </div>
                      <span style="font-size:11px;font-weight:700;color:${pColor};white-space:nowrap">${pct}%</span>
                    </div>
                    <div style="font-size:10px;color:var(--muted);margin-top:2px">${fmt(d.ventesMois)} / ${fmt(obj)}</div>`
                  : '<span style="font-size:11px;color:var(--muted)">—</span>'}
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ============================================================
// MON TABLEAU DE BORD — CAISSIER / COMMERCIAL
// ============================================================
function renderMonDashboard() {
  if (!currentUser) return;
  const period   = document.getElementById('dashPeriod')?.value || 'month';
  const username = currentUser.username;
  const label    = currentUser.label || username;
  const now      = new Date();
  const today    = now.toDateString();
  const thisMonth= now.toISOString().slice(0, 7);
  const thisYear = String(now.getFullYear());

  // Mon activité = ventes comptant + commandes + réservations qui me sont
  // attribuées. (Avant : seules les « Ventes » étaient comptées → dashboard à
  // zéro pour ceux qui travaillent surtout en commandes/réservations.)
  // Anti double-compte : on ne prend que les commandes/réservations « en cours »
  // (status pending) ; une fois finalisées elles deviennent une Vente (déjà comptée).
  const _norm   = v => String(v == null ? '' : v).trim().toLowerCase();
  const _meSet  = [username, label].filter(Boolean).map(_norm);
  const _isMine = name => _meSet.indexOf(_norm(name)) !== -1;
  const mySales = [
    ...sales.filter(s => _isMine(s.caissier)).map(s => ({
      date: s.date, total: Number(s.total) || 0, due: Number(s.due) || 0,
      items: s.items || [], clientName: s.clientName || '', method: s.method, type: 'Vente'
    })),
    ...commandes.filter(c => _isMine(c.caissier) && c.status === 'pending').map(c => ({
      date: c.date, total: Number(c.total) || 0, due: Number(c.restant) || 0,
      items: c.items || [], clientName: c.clientName || '', type: 'Commande'
    })),
    ...reservations.filter(r => _isMine(r.caissier) && r.status === 'pending').map(r => ({
      date: r.date, total: Number(r.total) || 0, due: Number(r.restant) || 0,
      items: r.items || [], clientName: r.clientName || '', type: 'Réservation'
    })),
  ];

  // Période sélectionnée
  let periodSales, periodLabel;
  if (period === 'day') {
    periodSales  = mySales.filter(s => { const d = parseSaleDate(s.date); return d && d.toDateString() === today; });
    periodLabel  = "Aujourd'hui";
  } else if (period === 'month') {
    periodSales  = mySales.filter(s => saleDateKey(s.date).startsWith(thisMonth));
    const ml     = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    periodLabel  = ml.charAt(0).toUpperCase() + ml.slice(1);
  } else {
    periodSales  = mySales.filter(s => saleDateKey(s.date).startsWith(thisYear));
    periodLabel  = `Année ${thisYear}`;
  }

  const totalPeriod = periodSales.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const countPeriod = periodSales.length;
  const avgBasket   = countPeriod > 0 ? Math.round(totalPeriod / countPeriod) : 0;

  // Stats du jour et du mois (toujours calculées pour l'objectif)
  const todaySales  = mySales.filter(s => { const d = parseSaleDate(s.date); return d && d.toDateString() === today; });
  const monthSales  = mySales.filter(s => saleDateKey(s.date).startsWith(thisMonth));
  const totalToday  = todaySales.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const totalMonth  = monthSales.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const countMonth  = monthSales.length;

  // Objectif mensuel
  const objMonth   = getObjectif(username);
  const progPct    = objMonth > 0 ? Math.min(100, Math.round(totalMonth / objMonth * 100)) : 0;
  const progColor  = progPct >= 100 ? '#16a34a' : progPct >= 70 ? '#d97706' : '#dc2626';
  const progBg     = progPct >= 100 ? '#dcfce7' : progPct >= 70 ? '#fef3c7' : '#fee2e2';

  // Graphique 7 jours (mes ventes)
  const days7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toDateString();
    const t  = mySales.filter(s => { const sd = parseSaleDate(s.date); return sd && sd.toDateString() === ds; })
                       .reduce((a, b) => a + (Number(b.total) || 0), 0);
    days7.push({ label: d.toLocaleDateString('fr-FR', { weekday: 'short' }), total: t });
  }
  const maxDay = Math.max(...days7.map(d => d.total), 1);

  // Mes 5 dernières transactions
  const last5 = [...mySales]
    .sort((a, b) => (parseSaleDate(b.date)?.getTime() || 0) - (parseSaleDate(a.date)?.getTime() || 0))
    .slice(0, 5);

  // Mise à jour header
  const greetEl = document.getElementById('dashCaissierGreet');
  const subEl   = document.getElementById('dashCaissierSub');
  if (greetEl) greetEl.textContent = `Bonjour, ${label}`;
  if (subEl)   subEl.textContent   = periodLabel;

  // Rendu du contenu
  const container = document.getElementById('dashCaissierContent');
  if (!container) return;

  container.innerHTML = `
    <!-- KPI Cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:12px;margin-bottom:16px">
      ${_dashKpi(period==='day'?"Mon CA auj.":(period==='month'?'Mon CA ce mois':'Mon CA cette année'), fmt(totalPeriod), countPeriod+' opération'+(countPeriod>1?'s':''), '#e8f4f0','#1a4a3a')}
      ${period!=='day'?_dashKpi("Aujourd'hui", fmt(totalToday), todaySales.length+' opération'+(todaySales.length>1?'s':''), '#dbeafe','#1e40af'):''}
      ${_dashKpi('Opérations', String(countPeriod), period==='day'?'ce jour':(period==='month'?'ce mois':'cette année'), '#fdf0e8','#c2410c')}
      ${_dashKpi('Panier moyen', fmt(avgBasket), 'par opération', '#f3e8ff','#7e22ce')}
    </div>

    <!-- Objectif mensuel -->
    ${objMonth > 0 ? `
    <div style="background:${progBg};border:1px solid ${progColor}44;border-radius:14px;padding:16px 20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:${progColor}">Objectif mensuel</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px">${fmt(totalMonth)} sur ${fmt(objMonth)}</div>
        </div>
        <div style="font-size:32px;font-weight:900;color:${progColor};line-height:1">${progPct}%</div>
      </div>
      <div style="background:${progColor}28;border-radius:100px;height:10px;overflow:hidden">
        <div style="background:${progColor};height:100%;width:${progPct}%;border-radius:100px;transition:.6s ease"></div>
      </div>
      ${progPct>=100?`<div style="font-size:12px;font-weight:700;color:${progColor};margin-top:8px;text-align:center">Objectif atteint ce mois !</div>`:''}
    </div>` : `
    <div style="background:var(--surface2);border:1px dashed var(--border);border-radius:14px;padding:14px 18px;margin-bottom:16px;text-align:center">
      <div style="font-size:13px;color:var(--muted)">Aucun objectif défini — demandez à votre administrateur de le configurer.</div>
    </div>`}

    <!-- Graphique 7 jours -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:14px">Mon activité — 7 derniers jours</div>
      <div style="display:flex;align-items:flex-end;height:90px;gap:3px">
        ${days7.map(d=>`
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">
            <div style="flex:1;width:100%;display:flex;align-items:flex-end;justify-content:center">
              <div style="width:78%;height:${Math.max(3,Math.round(d.total/maxDay*80))}px;background:${d.total>0?'var(--accent)':'var(--border)'};border-radius:4px 4px 0 0"></div>
            </div>
            <span style="font-size:9px;color:var(--muted)">${d.label}</span>
          </div>`).join('')}
      </div>
    </div>

    <!-- 5 dernières transactions -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden">
      <div style="padding:13px 16px;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;font-weight:700;color:var(--text)">Mes dernières opérations</span>
      </div>
      ${last5.length===0
        ? `<div style="text-align:center;padding:28px;color:var(--muted);font-size:13px">Aucune opération enregistrée</div>`
        : last5.map(s => {
            const d = parseSaleDate(s.date);
            const dateStr = d ? d.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
            const items = (s.items||[]).map(i=>`${i.name} ×${i.qty}`).join(', ') || '—';
            const ty   = s.type || 'Vente';
            const tcol = ty==='Vente' ? '#1a4a3a' : ty==='Commande' ? '#0891b2' : '#7c3aed';
            const tbg  = ty==='Vente' ? '#e8f4f0' : ty==='Commande' ? '#e0f2fe' : '#f3e8ff';
            const due  = Number(s.due)||0;
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border);gap:12px">
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
                  <span style="background:${tbg};color:${tcol};font-size:9px;font-weight:800;padding:1px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.03em;flex-shrink:0">${ty}</span>
                  <span style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.clientName||'—'}</span>
                </div>
                <div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${items}</div>
                <div style="font-size:11px;color:var(--muted)">${dateStr}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:14px;font-weight:700;color:var(--accent);white-space:nowrap">${fmt(s.total)}</div>
                ${due>0?`<div style="font-size:10px;color:#dc2626;white-space:nowrap">Reste ${fmt(due)}</div>`:''}
              </div>
            </div>`;
          }).join('')}
    </div>`;

  // Historique arrêts de caisse (section séparée dans le HTML)
  renderHistoriqueArrets();
  // Récupère les arrêts du serveur (multi-appareils) puis rafraîchit la liste
  loadArretsFromScript().then(() => {
    if (document.getElementById('page-mon-dashboard')?.classList.contains('active')) {
      renderHistoriqueArrets();
    }
  });
}

function _dashKpi(label, value, sub, bgColor, textColor) {
  return `
    <div style="background:${bgColor};border:1px solid ${textColor}20;border-radius:12px;padding:14px 16px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${textColor};opacity:.75;margin-bottom:6px;line-height:1.2">${label}</div>
      <div style="font-size:19px;font-weight:800;color:${textColor};line-height:1">${value}</div>
      <div style="font-size:11px;color:${textColor};opacity:.6;margin-top:4px">${sub}</div>
    </div>`;
}

// ============================================================
// ARRÊT DE CAISSE
// ============================================================

const BILLETAGE_DENOMS = [20000, 10000, 5000, 2000, 1000, 500, 200, 100];

function updateBilletage() {
  let total  = 0;
  let anyQty = false;
  BILLETAGE_DENOMS.forEach(d => {
    const input = document.getElementById(`arretBillet_${d}`);
    const subEl = document.getElementById(`arretBilletSub_${d}`);
    const qty   = Number(input?.value) || 0;
    if (qty > 0) anyQty = true;
    const sub   = qty * d;
    total += sub;
    if (subEl) subEl.textContent = sub > 0 ? fmt(sub) : '—';
  });

  const totalEl = document.getElementById('arretBilletageTotal');
  if (totalEl) {
    totalEl.textContent = fmt(total);
    totalEl.style.color = anyQty ? '#1a4a3a' : '#a8a29e';
  }

  // Mettre à jour le champ caché — déclenche updateArretEcart()
  const realEl = document.getElementById('arretEspecesReelles');
  if (realEl) realEl.value = anyQty ? String(total) : '';

  updateArretEcart();
}

function openArretCaisse() {
  if (!currentUser) return;
  renderArretCaisseModal();
  openModal('arretCaisseModal');
  // Récupère les encaissements du serveur (multi-appareils) puis rafraîchit la fiche
  // (résumé + liste + soldes en attente — ne réinitialise PAS fond de caisse / billetage / notes en cours de saisie)
  loadEncaissementsFromScript().then(() => { _refreshArretIfOpen(); }).catch(() => {});
}

// Fiche d'encaissement du jour pour le caissier courant.
// Source = journal `encaissements` (argent réellement reçu), avec repli sur les
// ventes du jour sans événement lié (robustesse transition / anciennes données).
function _getArretData() {
  const username = currentUser ? currentUser.username : '';
  const label    = currentUser ? (currentUser.label || username) : '';
  const today    = new Date().toDateString();
  const mine = e => (e.caissier === username || e.caissierLabel === label || e.caissier === label);

  // Encaissements du jour (journal)
  const evts = encaissements.filter(e => {
    const d = parseSaleDate(e.date);
    return d && d.toDateString() === today && mine(e);
  });

  // Repli : ventes du jour SANS encaissement lié (ex. faites avant l'ajout du journal)
  const covered = new Set(evts.filter(e => e.source === 'vente').map(e => String(e.refId)));
  const todaySales = sales.filter(s => {
    const d = parseSaleDate(s.date);
    return d && d.toDateString() === today && (s.caissier === username || s.caissier === label);
  });
  todaySales.forEach(s => {
    if (covered.has(String(s.id))) return;
    if (s.fromCommande) return;   // finalisation de commande : déjà couverte par ses encaissements (acompte + solde)
    const total = Number(s.total) || 0;
    const reste = Math.max(0, Number(s.due != null ? s.due : (total - (Number(s.accompte) || 0))) || 0);
    evts.push({
      id: 'S' + s.id, date: s.date, source: 'vente', refId: s.id, refLabel: '#' + s.id,
      client: (s.clientName || '').trim() || (s.clientCompany || '').trim() || 'Client comptant',
      montant: Math.max(0, total - reste), method: s.method || 'cash',
      type: reste > 0 ? 'acompte' : 'comptant', resteApres: reste
    });
  });

  const sumBy   = m => evts.filter(e => e.method === m).reduce((a, b) => a + (Number(b.montant) || 0), 0);
  const especes = sumBy('cash');
  const mobile  = sumBy('mobile');
  const cheque  = sumBy('cheque');

  const METHOD_LABEL = { cash: 'Espèces', mobile: 'Mobile Money', cheque: 'Chèque' };
  const TYPE_LABEL   = { comptant: 'Comptant', acompte: 'Acompte', solde: 'Solde', paiement: 'Paiement' };
  // Retrouve les articles (nom/qté/prix unitaire) de la source d'un encaissement
  const _itemsOf = e => {
    let src = null;
    if (e.source === 'commande')    src = commandes.find(c => String(c.id) === String(e.refId));
    else if (e.source === 'vente')  src = sales.find(s => String(s.id) === String(e.refId));
    return ((src && src.items) || []).map(i => ({
      name: i.name, qty: Number(i.qty) || 0, price: Number(i.price) || 0
    }));
  };
  // Ordre chronologique (comme la feuille papier)
  const lignes = evts.slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(e => ({
      num:       e.refLabel || ('#' + e.refId),
      client:    (e.client || '').trim() || 'Client comptant',
      caissier:  e.caissierLabel || _arretCaissierLabel(e.caissier) || label || '—',
      articles:  _itemsOf(e),
      methode:   METHOD_LABEL[e.method] || e.method || '—',
      typeLabel: TYPE_LABEL[e.type] || '',
      encaisse:  Number(e.montant) || 0,
      reste:     Math.max(0, Number(e.resteApres) || 0),
      acompte:   (Math.max(0, Number(e.resteApres) || 0)) > 0   // reste après → badge A + RAP
    }));

  return { todaySales, evts, especes, mobile, cheque, total: especes + mobile + cheque, lignes };
}

// Rend la fiche d'encaissement (liste détaillée) dans le modal d'arrêt de caisse
function _renderArretFiche(lignes) {
  const list  = document.getElementById('arretFicheList');
  const count = document.getElementById('arretFicheCount');
  if (!list) return;
  if (count) count.textContent = lignes.length ? (lignes.length + ' encaissement' + (lignes.length > 1 ? 's' : '')) : '';

  if (!lignes.length) {
    list.innerHTML = `<div style="text-align:center;padding:18px;color:var(--muted);font-size:12px">Aucun encaissement aujourd'hui</div>`;
    return;
  }

  const esc = s => (_pcokEsc ? _pcokEsc(s) : s);
  const rows = lignes.map(l => {
    const obs = l.acompte
      ? `<span style="background:#fef3c7;color:#b45309;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:800">A</span>
         <span style="font-size:11px;color:#dc2626;font-weight:700;white-space:nowrap">RAP ${fmt(l.reste)}</span>`
      : `<span style="background:#dcfce7;color:#16a34a;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:800">Soldé</span>`;
    const articles = (l.articles && l.articles.length)
      ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;line-height:1.45">${l.articles.map(a =>
          `${esc(a.name)} <b style="color:var(--text)">×${a.qty}</b> @ ${fmt(a.price)}`).join('<br>')}</div>`
      : '';
    return `<div style="display:grid;grid-template-columns:52px 1fr auto;gap:8px;align-items:start;padding:9px 12px;border-bottom:1px solid var(--border)">
      <span style="font-size:11px;font-weight:700;color:var(--muted)">${esc(l.num)}</span>
      <div style="min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.client)}</div>
        <div style="font-size:10px;color:var(--muted)">${l.methode}${l.caissier ? ` · <span title="Caissier">${esc(l.caissier)}</span>` : ''}</div>
        ${articles}
      </div>
      <div style="text-align:right">
        <div style="font-size:13px;font-weight:800;color:var(--text);white-space:nowrap">${fmt(l.encaisse)}</div>
        <div style="margin-top:2px;display:flex;gap:5px;align-items:center;justify-content:flex-end">${obs}</div>
      </div>
    </div>`;
  }).join('');

  const totalEnc = lignes.reduce((a, b) => a + (b.encaisse || 0), 0);
  const totalRap = lignes.reduce((a, b) => a + (b.reste || 0), 0);
  list.innerHTML = rows + `<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:10px 12px;background:var(--surface2);font-weight:800">
      <span style="font-size:12px;color:var(--text)">TOTAL${totalRap > 0 ? ` · RAP ${fmt(totalRap)}` : ''}</span>
      <span style="font-size:14px;color:#1a4a3a">${fmt(totalEnc)}</span>
    </div>`;
}

// Résout le nom lisible d'un caissier (username → label via localUsers)
function _arretCaissierLabel(username) {
  const u = String(username || '').trim();
  if (!u) return '';
  const found = (localUsers || []).find(x =>
    String(x.username || '').toLowerCase() === u.toLowerCase());
  return (found && (found.label || found.username)) || u;
}

// ── Encaisser un solde différé depuis l'arrêt de caisse ────────────────────
// Le client règle son reste (souvent un autre jour que l'acompte) : on retrouve
// sa commande, on l'encaisse/finalise, et l'événement rentre dans l'arrêt du jour.
// N'importe quel caissier peut solder la commande d'un collègue (le paiement
// entre dans SA caisse) → arrêt de caisse consolidé possible.
function renderArretSoldeResults(q) {
  const box = document.getElementById('arretSoldeResults');
  if (!box) return;
  const query = (q || '').trim().toLowerCase();
  const uname = currentUser?.username || '';
  // Qui peut solder la commande d'un COLLÈGUE (arrêt consolidé) : le paiement
  // tombe dans SA caisse via _recordEncaissement. Les autres rôles ne voient
  // que leurs propres soldes.
  const CAN_CLOSE_OTHERS = ['admin', 'caissier', 'commerciale', 'comptable'];
  const canOthers = CAN_CLOSE_OTHERS.includes(currentUser?.role);
  let list = commandes.filter(c =>
    c.status === 'pending' && _cmdReste(c) > 0 &&
    (canOthers || String(c.caissier || '') === String(uname))
  );
  if (query) {
    list = list.filter(c => {
      const hay = `${c.clientName || ''} ${c.clientContact || ''} ${_cmdRef(c)} ${_arretCaissierLabel(c.caissier)} #${c.id}`.toLowerCase();
      return hay.includes(query);
    });
  }
  list.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  // Compteur global (indépendant de la recherche) dans l'en-tête de carte
  const cntEl = document.getElementById('arretSoldeCount');
  if (cntEl) {
    const totalRap = list.reduce((a, c) => a + _cmdReste(c), 0);
    cntEl.textContent = query ? `${list.length} résultat${list.length > 1 ? 's' : ''}` : (list.length ? `${list.length} · RAP ${fmt(totalRap)}` : '');
  }

  if (!list.length) {
    box.innerHTML = `<div class="ac-empty">${query ? 'Aucune commande à solder pour cette recherche' : 'Aucun solde en attente'}</div>`;
    return;
  }

  const VIS = 5;
  const initial = s => ((String(s || 'C').trim()[0]) || 'C').toUpperCase();
  const rows = list.map((c, i) => {
    const reste = _cmdReste(c);
    // Caissier d'origine (affiché quand ce n'est pas l'utilisateur courant)
    const owner = _arretCaissierLabel(c.caissier);
    const isMine = String(c.caissier || '') === String(uname);
    const ownerTag = (!isMine && owner)
      ? `<span class="ac-cli-owner" title="Commande de ${escapeHtml(owner)}">${escapeHtml(owner)}</span>` : '';
    return `<div class="ac-cli-row${i >= VIS ? ' ac-extra ac-hidden' : ''}">
      <div class="ac-ava">${initial(c.clientName)}</div>
      <div class="ac-cli-n"><b>${escapeHtml(c.clientName || 'Client')}${ownerTag}</b><span>${escapeHtml(_cmdRef(c))}${c.clientContact ? ' · ' + escapeHtml(c.clientContact) : ''}</span></div>
      <div class="ac-cli-rap">${fmt(reste)}</div>
      <div class="ac-cli-act">
        <button class="ac-btn-enc" onclick="arretEncaisser('${c.id}')">Encaisser</button>
        <button class="ac-lnk-fin" onclick="arretFinaliser('${c.id}')">Finaliser</button>
      </div>
    </div>`;
  }).join('');

  const extra = list.length - VIS;
  const more = extra > 0
    ? `<button class="ac-more" data-n="${extra}" onclick="_arretToggleMore(this)">Voir plus (${extra}) ▾</button>`
    : '';
  box.innerHTML = rows + more;
}

// Déplie / replie les commandes au-delà des 5 premières dans l'arrêt de caisse
function _arretToggleMore(btn) {
  const box = document.getElementById('arretSoldeResults');
  if (!box) return;
  const willShow = !!box.querySelector('.ac-extra.ac-hidden');
  box.querySelectorAll('.ac-extra').forEach(r => r.classList.toggle('ac-hidden', !willShow));
  btn.textContent = willShow ? 'Voir moins ▴' : `Voir plus (${btn.dataset.n}) ▾`;
}

// Ouvre l'encaissement/finalisation AU-DESSUS de l'arrêt (z-index modal-overlay = 500)
function arretEncaisser(id) {
  const m = document.getElementById('encaisseModal'); if (m) m.style.zIndex = '600';
  openEncaisseModal(id);
}
function arretFinaliser(id) {
  const m = document.getElementById('cmdFinalizeModal'); if (m) m.style.zIndex = '600';
  openCmdFinalizeModal(id);
}

// Rafraîchit l'arrêt (totaux + fiche + résultats de recherche) s'il est ouvert.
// Appelé après un encaissement/finalisation lancé depuis le modal d'arrêt.
function _refreshArretIfOpen() {
  const modal = document.getElementById('arretCaisseModal');
  if (!modal || !modal.classList.contains('open')) return;
  const d = _getArretData();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('arretEspeces', fmt(d.especes));
  set('arretMobile',  fmt(d.mobile));
  set('arretCheque',  fmt(d.cheque));
  set('arretTotal',   fmt(d.total));
  set('arretNbTrans', d.lignes.length + ' encaissement' + (d.lignes.length > 1 ? 's' : ''));
  _renderArretFiche(d.lignes || []);
  updateArretEcart();
  const sEl = document.getElementById('arretSoldeSearch');
  renderArretSoldeResults(sEl ? sEl.value : '');
}

function renderArretCaisseModal() {
  const d   = _getArretData();
  const now = new Date();
  const dateStr  = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const heureStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const infoEl = document.getElementById('arretCaisseInfo');
  if (infoEl) infoEl.textContent = `${currentUser.label || currentUser.username} — ${dateStr} à ${heureStr}`;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('arretEspeces', fmt(d.especes));
  set('arretMobile',  fmt(d.mobile));
  set('arretCheque',  fmt(d.cheque));
  set('arretTotal',   fmt(d.total));
  set('arretNbTrans', d.lignes.length + ' encaissement' + (d.lignes.length > 1 ? 's' : ''));

  // Fiche d'encaissement détaillée
  _renderArretFiche(d.lignes || []);

  // Recherche « encaisser un solde différé » : champ vide + liste des soldes en attente
  const soldeSearch = document.getElementById('arretSoldeSearch');
  if (soldeSearch) soldeSearch.value = '';
  renderArretSoldeResults('');

  // Reset fond de caisse + notes
  ['arretFondCaisse', 'arretNotes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  // Reset billetage
  BILLETAGE_DENOMS.forEach(d => {
    const inp = document.getElementById(`arretBillet_${d}`);
    const sub = document.getElementById(`arretBilletSub_${d}`);
    if (inp) inp.value = '';
    if (sub) sub.textContent = '—';
  });
  const totEl = document.getElementById('arretBilletageTotal');
  if (totEl) { totEl.textContent = '0 Ar'; totEl.style.color = '#a8a29e'; }
  const realEl = document.getElementById('arretEspecesReelles');
  if (realEl) realEl.value = '';
  updateArretEcart();
}

function updateArretEcart() {
  const d = _getArretData();
  const fond           = Number(document.getElementById('arretFondCaisse')?.value)       || 0;
  const reelRaw        = document.getElementById('arretEspecesReelles')?.value ?? '';
  const especesReelles = reelRaw !== '' ? Number(reelRaw) : null;
  const theorique      = fond + d.especes;

  const theoriqueEl = document.getElementById('arretTheoriqueVal');
  const ecartEl     = document.getElementById('arretEcartVal');
  const ecartRow    = document.getElementById('arretEcartRow');

  if (theoriqueEl) theoriqueEl.textContent = fmt(theorique);

  if (especesReelles !== null) {
    const ecart = especesReelles - theorique;
    if (ecartEl) {
      if (ecart === 0) {
        ecartEl.textContent = 'Équilibré';
        ecartEl.style.color = '#16a34a';
      } else {
        ecartEl.textContent = (ecart > 0 ? '+' : '') + fmt(ecart);
        ecartEl.style.color = ecart > 0 ? '#16a34a' : '#dc2626';
      }
    }
    if (ecartRow) ecartRow.style.display = '';
  } else {
    if (ecartRow) ecartRow.style.display = 'none';
  }
  _syncArretKpis();
}

// Seuil de tolérance d'écart (Ar) : 0 = tout écart signalé en rouge.
// Passe-le à p.ex. 2000 pour tolérer les petites différences (orange).
const _ARRET_TOL = 0;

// Alimente le cockpit (bandeau KPI + récap colonne 3 + carte écart à états couleur).
// Point d'entrée unique appelé en fin de updateArretEcart() → couvre billetage,
// fond de caisse, ouverture du modal et refresh serveur (tous passent par là).
function _syncArretKpis() {
  const wrap = document.getElementById('kpiArretEcartWrap');
  if (!wrap) return; // cockpit non monté (sécurité)
  const d        = _getArretData();
  const fond     = Number(document.getElementById('arretFondCaisse')?.value) || 0;
  const reelRaw  = document.getElementById('arretEspecesReelles')?.value ?? '';
  const comptees = reelRaw !== '' ? Number(reelRaw) : null;
  const theo     = fond + d.especes;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };

  set('kpiArretTotal',    fmt(d.total));
  set('kpiArretTheo',     fmt(theo));
  set('kpiArretNb',       d.lignes.length);
  set('kpiArretComptees', comptees !== null ? fmt(comptees) : '—');
  set('arretEspecesEncaissees', fmt(d.especes));
  set('arretFondRecap',   fmt(fond));
  set('arretComptRecap',  comptees !== null ? fmt(comptees) : '—');

  const badge  = document.getElementById('arretEcartBadge');
  const ICON = {
    good: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    warn: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    bad:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    idle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>'
  };

  if (comptees === null) {
    wrap.className = 'ac-kpi ac-kpi-state ac-idle';
    set('kpiArretEcart', '—');
    set('kpiArretEcartPill', 'À compter');
    const card = document.getElementById('arretEcartCard'); if (card) card.className = 'ac-ecart ac-idle';
    if (badge) badge.innerHTML = ICON.idle;
    set('arretEcartLabel', 'En attente du comptage');
    set('arretEcartBigVal', '—');
    return;
  }

  const ecart = comptees - theo;
  const abs   = Math.abs(ecart);
  let state, label;
  if (ecart === 0)          { state = 'good'; label = 'Caisse équilibrée'; }
  else if (abs <= _ARRET_TOL) { state = 'warn'; label = ecart > 0 ? 'Léger surplus' : 'Léger manque'; }
  else                      { state = 'bad';  label = ecart > 0 ? 'Surplus de caisse' : 'Manque de caisse'; }
  const disp = (ecart > 0 ? '+' : '') + fmt(ecart);

  wrap.className = 'ac-kpi ac-kpi-state ac-' + state;
  set('kpiArretEcart', disp);
  set('kpiArretEcartPill', state === 'good' ? '✓ Équilibré' : disp);
  const card = document.getElementById('arretEcartCard'); if (card) card.className = 'ac-ecart ac-' + state;
  if (badge) badge.innerHTML = ICON[state];
  set('arretEcartLabel', label);
  set('arretEcartBigVal', disp);
}

// Imprime le rapport d'arrêt à partir de l'état courant SANS clôturer (aperçu).
function _printArretDraft() {
  if (!currentUser) return;
  const d        = _getArretData();
  const fond     = Number(document.getElementById('arretFondCaisse')?.value) || 0;
  const reelRaw  = document.getElementById('arretEspecesReelles')?.value ?? '';
  const especesR = reelRaw !== '' ? Number(reelRaw) : null;
  const notes    = document.getElementById('arretNotes')?.value?.trim() || '';
  const billetage = {};
  BILLETAGE_DENOMS.forEach(den => {
    const q = Number(document.getElementById(`arretBillet_${den}`)?.value) || 0;
    if (q > 0) billetage[den] = q;
  });
  printArretCaisse({
    date: new Date().toISOString(),
    caissier: currentUser.username,
    caissierLabel: currentUser.label || currentUser.username,
    nbTransactions: d.lignes.length,
    totalEspeces: d.especes, totalMobile: d.mobile, totalCheque: d.cheque, totalGeneral: d.total,
    fondCaisse: fond, billetage, especesReelles: especesR,
    ecart: especesR !== null ? especesR - (fond + d.especes) : null,
    notes, lignes: d.lignes || []
  });
}

function validerArretCaisse() {
  if (!currentUser) return;
  const d         = _getArretData();
  const fond      = Number(document.getElementById('arretFondCaisse')?.value) || 0;
  const reelRaw   = document.getElementById('arretEspecesReelles')?.value ?? '';
  const especesR  = reelRaw !== '' ? Number(reelRaw) : null;
  const notes     = document.getElementById('arretNotes')?.value?.trim() || '';
  const theorique = fond + d.especes;
  const ecart     = especesR !== null ? especesR - theorique : null;

  // Capturer le détail billetage
  const billetage = {};
  BILLETAGE_DENOMS.forEach(denom => {
    const qty = Number(document.getElementById(`arretBillet_${denom}`)?.value) || 0;
    if (qty > 0) billetage[denom] = qty;
  });

  const arret = {
    id:             nextArretId++,
    date:           new Date().toISOString(),
    caissier:       currentUser.username,
    caissierLabel:  currentUser.label || currentUser.username,
    nbTransactions: d.lignes.length,
    totalEspeces:   d.especes,
    totalMobile:    d.mobile,
    totalCheque:    d.cheque,
    totalGeneral:   d.total,
    fondCaisse:     fond,
    billetage,
    especesReelles: especesR,
    ecart,
    notes,
    lignes:         d.lignes || []   // fiche d'encaissement détaillée
  };

  arretsCaisse.unshift(arret);
  try {
    localStorage.setItem('pos-arrets',     JSON.stringify(arretsCaisse));
    localStorage.setItem('pos-nextArretId', String(nextArretId));
  } catch(e) {}

  closeModal('arretCaisseModal');
  showToast('Arrêt de caisse enregistré');
  printArretCaisse(arret);
  syncArretToSheets(arret);

  // Rafraîchir Mon Dashboard si affiché
  if (document.getElementById('page-mon-dashboard')?.classList.contains('active')) {
    renderMonDashboard();
  }
}

function printArretCaisse(arret) {
  if (!arret) return;
  const d         = new Date(arret.date);
  const dateStr   = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const heureStr  = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const theorique = (arret.fondCaisse || 0) + arret.totalEspeces;
  const ecartVal  = arret.ecart;

  let ecartBadge = '';
  if (ecartVal !== null) {
    if (ecartVal === 0)       ecartBadge = `<span class="badge badge-green">Équilibré</span>`;
    else if (ecartVal > 0)    ecartBadge = `<span class="badge badge-green">+${fmt(ecartVal)}</span>`;
    else                      ecartBadge = `<span class="badge badge-red">${fmt(ecartVal)}</span>`;
  }

  _printWindow(`Arrêt de caisse — ${arret.caissierLabel} — ${dateStr}`, `
    <div class="rpt-header">
      <div class="rpt-logo">FOREVER<span>MG</span></div>
      <div class="rpt-meta">
        <div style="font-size:14px;font-weight:700;color:#1c1917">ARRÊT DE CAISSE</div>
        <div>${dateStr} à ${heureStr}</div>
        <div>Caissier : <strong>${arret.caissierLabel}</strong></div>
      </div>
    </div>

    <p class="rpt-period">Clôture de la journée — ventes enregistrées au moment de l'arrêt</p>

    <div class="kpi-row">
      <div class="kpi-box"><div class="kl">Espèces</div><div class="kv">${fmt(arret.totalEspeces)}</div></div>
      <div class="kpi-box"><div class="kl">Mobile Money</div><div class="kv">${fmt(arret.totalMobile)}</div></div>
      ${arret.totalCheque > 0 ? `<div class="kpi-box"><div class="kl">Chèque</div><div class="kv">${fmt(arret.totalCheque)}</div></div>` : ''}
      <div class="kpi-box"><div class="kl">Total encaissé</div><div class="kv" style="color:#1a4a3a">${fmt(arret.totalGeneral)}</div></div>
      <div class="kpi-box"><div class="kl">Transactions</div><div class="kv">${arret.nbTransactions}</div></div>
    </div>

    ${(arret.lignes && arret.lignes.length) ? `
    <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#78716c;margin:16px 0 6px">Fiche d'encaissement</p>
    <table>
      <thead>
        <tr>
          <th style="width:56px">N° FC</th>
          <th>Client</th>
          <th>Caissier</th>
          <th>Articles</th>
          <th style="text-align:right">Encaissement</th>
          <th style="text-align:center;width:120px">Obs</th>
        </tr>
      </thead>
      <tbody>
        ${arret.lignes.map(l => `<tr>
          <td>${_pcokEsc(l.num)}</td>
          <td>${_pcokEsc(l.client)}${l.methode ? `<span style="color:#a8a29e;font-size:10px"> · ${_pcokEsc(l.methode)}</span>` : ''}</td>
          <td>${_pcokEsc(l.caissier || '—')}</td>
          <td style="font-size:11px">${(l.articles && l.articles.length)
            ? l.articles.map(a => `${_pcokEsc(a.name)} <strong>×${a.qty}</strong> <span style="color:#a8a29e">@ ${fmt(a.price)}</span>`).join('<br>')
            : '<span style="color:#a8a29e">—</span>'}</td>
          <td style="text-align:right;font-weight:600">${fmt(l.encaisse)}</td>
          <td style="text-align:center">${l.acompte ? `<strong>A</strong> · RAP ${fmt(l.reste)}` : 'Soldé'}</td>
        </tr>`).join('')}
        <tr style="font-weight:700;background:#f8f7f4">
          <td colspan="4">TOTAL${arret.lignes.reduce((a,b)=>a+(b.reste||0),0) > 0 ? ` · Reste à payer ${fmt(arret.lignes.reduce((a,b)=>a+(b.reste||0),0))}` : ''}</td>
          <td style="text-align:right">${fmt(arret.lignes.reduce((a,b)=>a+(b.encaisse||0),0))}</td>
          <td></td>
        </tr>
      </tbody>
    </table>` : ''}

    <table>
      <thead>
        <tr><th>Comptage de caisse</th><th style="text-align:right">Montant</th></tr>
      </thead>
      <tbody>
        <tr><td>Fond de caisse (début de journée)</td><td style="text-align:right">${fmt(arret.fondCaisse || 0)}</td></tr>
        <tr><td>Espèces encaissées (ventes)</td><td style="text-align:right">${fmt(arret.totalEspeces)}</td></tr>
        <tr style="font-weight:700;background:#f8f7f4"><td>Espèces théoriques en caisse</td><td style="text-align:right">${fmt(theorique)}</td></tr>
        ${arret.especesReelles !== null ? `<tr><td>Espèces comptées — billetage</td><td style="text-align:right">${fmt(arret.especesReelles)}</td></tr>` : ''}
        ${ecartVal !== null ? `<tr style="font-weight:700"><td>Écart de caisse</td><td style="text-align:right">${ecartBadge}</td></tr>` : ''}
      </tbody>
    </table>

    ${arret.billetage && Object.keys(arret.billetage).length > 0 ? `
    <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#78716c;margin:16px 0 6px">Détail du billetage</p>
    <table>
      <thead><tr><th>Coupure</th><th style="text-align:center">Quantité</th><th style="text-align:right">Sous-total</th></tr></thead>
      <tbody>
        ${BILLETAGE_DENOMS.filter(d => arret.billetage[d] > 0).map(d =>
          `<tr><td>${d >= 100 ? (Number(d).toLocaleString('fr-MG') + ' Ar') : (d + ' Ar')}</td>
               <td style="text-align:center">× ${arret.billetage[d]}</td>
               <td style="text-align:right;font-weight:600">${fmt(d * arret.billetage[d])}</td></tr>`
        ).join('')}
        <tr style="font-weight:700;background:#f8f7f4">
          <td colspan="2">Total billetage</td>
          <td style="text-align:right">${fmt(arret.especesReelles)}</td>
        </tr>
      </tbody>
    </table>` : ''}

    ${arret.notes ? `<p style="font-size:12px;color:#78716c;padding:10px 0;border-top:1px solid #e5e3df"><strong>Notes :</strong> ${arret.notes}</p>` : ''}
    <p style="font-size:11px;color:#a8a29e;text-align:center;margin-top:20px;border-top:1px solid #e5e3df;padding-top:12px">Document généré par FOREVER MG POS — Ne constitue pas un document comptable officiel</p>
  `);
}

async function syncArretToSheets(arret) {
  if (!APPS_SCRIPT_URL || !navigator.onLine) return;
  try { await apiCall({ action: 'addArretCaisse', arret }); }
  catch(e) { console.warn('Sync arrêt caisse GAS:', e); }
}

function renderHistoriqueArrets() {
  const container = document.getElementById('historiqueArretsContent');
  if (!container || !currentUser) return;

  const username = currentUser.username;
  const label    = currentUser.label || username;
  const isAdmin  = currentUser.role === 'admin';

  const list = isAdmin
    ? [...arretsCaisse]
    : arretsCaisse.filter(a => a.caissier === username || a.caissierLabel === label);

  if (list.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:28px;color:var(--muted);font-size:13px">Aucun arrêt de caisse enregistré</div>`;
    return;
  }

  container.innerHTML = list.slice(0, 15).map(a => {
    const d        = new Date(a.date);
    const dateStr  = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const heureStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    let ecartBadgeHtml = '';
    if (a.ecart === null || a.ecart === undefined) {
      ecartBadgeHtml = `<span style="font-size:11px;color:var(--muted)">Non compté</span>`;
    } else if (a.ecart === 0) {
      ecartBadgeHtml = `<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">Équilibré</span>`;
    } else if (a.ecart > 0) {
      ecartBadgeHtml = `<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">+${fmt(a.ecart)}</span>`;
    } else {
      ecartBadgeHtml = `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">${fmt(a.ecart)}</span>`;
    }

    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px solid var(--border);gap:12px;cursor:pointer;transition:.15s" onclick="printArretCaisse(arretsCaisse.find(x=>x.id===${a.id}))" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--text)">
          ${dateStr} à ${heureStr}
          ${isAdmin ? `<span style="font-size:11px;color:var(--muted);font-weight:400"> · ${a.caissierLabel}</span>` : ''}
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${a.nbTransactions} transaction${a.nbTransactions > 1 ? 's' : ''} · Total ${fmt(a.totalGeneral)}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        ${ecartBadgeHtml}
        <div style="font-size:11px;color:var(--muted);margin-top:3px">Esp. théor. ${fmt((a.fondCaisse||0)+a.totalEspeces)}</div>
      </div>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
  }).join('');
}

// ============================================================
// SAISIE RAPIDE COMMERCIALE
// ============================================================
function openSaisieRapideModal() {
  srParsedData = null;
  const el = document.getElementById('srTextInput');
  if (el) el.value = '';
  const prev = document.getElementById('srPreviewSection');
  if (prev) prev.style.display = 'none';
  const err = document.getElementById('srErrorMsg');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  const saveBtn = document.getElementById('srSaveBtn');
  if (saveBtn) saveBtn.disabled = true;
  openModal('saisieRapideModal');
}

function parseCommandeText(rawText) {
  const data = {
    clientId: '', clientName: '', clientContact: '',
    deliveryMode: 'retrait', adresseLivraison: '',
    items: [], total: 0, subtotal: 0, fraisLivraison: 0, accompte: 0, restant: 0, notes: ''
  };

  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let inAddress = false;
  for (const line of lines) {
    // Skip section headers like "Commandes :"
    if (/^Commandes\s*:?\s*$/i.test(line)) { inAddress = false; continue; }

    // "Client #13336" — numéro de référence client
    const clientIdMatch = line.match(/^Client\s+#(\d+)\s*$/i);
    if (clientIdMatch) { data.clientId = clientIdMatch[1]; continue; }

    // "Client : ANDRIAMAHEFA Harilala"
    const clientNameMatch = line.match(/^Client\s*:\s*(.+)$/i);
    if (clientNameMatch) { data.clientName = clientNameMatch[1].trim(); continue; }

    // "Contact : 34 63 103 49"
    const contactMatch = line.match(/^Contact\s*:\s*(.+)$/i);
    if (contactMatch) { data.clientContact = contactMatch[1].trim(); continue; }

    // "Lieu : Récupération en boutique" ou "Lieu : Livraison — adresse"
    const lieuMatch = line.match(/^Lieu\s*:\s*(.+)$/i);
    if (lieuMatch) {
      let lieu = lieuMatch[1].trim();
      // Le Lieu = adresse de LIVRAISON par défaut ; retrait uniquement si mention explicite
      if (/(retrait|boutique|sur\s*place|r[ée]cup)/i.test(lieu)) {
        data.deliveryMode = 'retrait';
        data.adresseLivraison = '';
        inAddress = false;
      } else {
        lieu = lieu.replace(/^livraison\s*[—–:\-]*\s*/i, '').trim() || lieu;
        data.deliveryMode = 'livraison';
        data.adresseLivraison = lieu;
        inAddress = true;
      }
      continue;
    }

    // "• bois × 1 (255000 Ar × 1 = 255000 Ar)"
    const itemMatch = line.match(/^[•\-\*]\s*(.+?)\s*[×xX]\s*(\d+)\s*\(([\d\s]+)\s*Ar/i);
    if (itemMatch) {
      inAddress = false;
      const price = parseInt(itemMatch[3].replace(/\s/g, ''), 10);
      if (!isNaN(price) && price > 0) {
        data.items.push({ name: itemMatch[1].trim(), qty: parseInt(itemMatch[2], 10) || 1, price, custom: true });
      }
      continue;
    }

    // "Total : 255000 Ar"
    const totalMatch = line.match(/^Total\s*:\s*([\d\s]+)\s*Ar\s*$/i);
    if (totalMatch) { data.total = parseInt(totalMatch[1].replace(/\s/g, ''), 10) || 0; continue; }

    // "Avance : 96600 Ar" ou "Acompte : ..."
    const avanceMatch = line.match(/^(?:Avance|Acompte|Advance)\s*:\s*([\d\s]+)\s*Ar\s*$/i);
    if (avanceMatch) { data.accompte = parseInt(avanceMatch[1].replace(/\s/g, ''), 10) || 0; continue; }

    // "Frais de livraison : 5000 Ar"
    const fraisMatch = line.match(/^Frais\s+de\s+livraison\s*:\s*([\d\s]+)\s*Ar/i);
    if (fraisMatch) { data.fraisLivraison = parseInt(fraisMatch[1].replace(/\s/g, ''), 10) || 0; continue; }

    // "Reste à payer : 158400 Ar"
    const resteMatch = line.match(/^Reste\s+[àaÀA]\s+payer\s*:\s*([\d\s]+)\s*Ar\s*$/i);
    if (resteMatch) { data.restant = parseInt(resteMatch[1].replace(/\s/g, ''), 10) || 0; continue; }

    // "Note : ..."
    const noteMatch = line.match(/^Notes?\s*:\s*(.+)$/i);
    if (noteMatch) { data.notes = (data.notes ? data.notes + ' — ' : '') + noteMatch[1].trim(); continue; }

    // Ligne non reconnue → continuation de l'adresse de livraison (ex. 2e ligne sous "Lieu :")
    if (inAddress && line) data.adresseLivraison = (data.adresseLivraison ? data.adresseLivraison + ' ' : '') + line;
  }

  // Sous-total = somme des articles ; intégrer les frais de livraison
  const _itemsSum = data.items.reduce((s, i) => s + i.qty * i.price, 0);
  data.subtotal = _itemsSum;
  if (data.total === 0) {
    data.total = _itemsSum + data.fraisLivraison;          // pas de "Total :" saisi
  } else if (data.total === _itemsSum && data.fraisLivraison > 0) {
    data.total = _itemsSum + data.fraisLivraison;          // "Total :" = articles seuls → ajouter les frais
  }
  if (data.restant === 0 && data.total > 0)
    data.restant = Math.max(0, data.total - data.accompte);

  // Stocker la référence client dans les notes
  if (data.clientId) {
    const ref = `Réf. client #${data.clientId}`;
    data.notes = data.notes ? `${ref} — ${data.notes}` : ref;
  }

  return data;
}

function _srEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function analyserSaisieRapide() {
  const text = (document.getElementById('srTextInput')?.value || '').trim();
  const errEl  = document.getElementById('srErrorMsg');
  const prevEl = document.getElementById('srPreviewSection');
  const saveBtn = document.getElementById('srSaveBtn');

  errEl.style.display = 'none';
  errEl.textContent = '';

  if (!text) {
    errEl.textContent = 'Collez le texte de la commande avant d\'analyser.';
    errEl.style.display = 'block';
    prevEl.style.display = 'none';
    saveBtn.disabled = true;
    return;
  }

  const data = parseCommandeText(text);

  if (!data.clientName) {
    errEl.textContent = 'Nom du client introuvable. Format attendu : « Client : Prénom Nom »';
    errEl.style.display = 'block';
    prevEl.style.display = 'none';
    saveBtn.disabled = true;
    return;
  }

  if (data.items.length === 0) {
    errEl.textContent = 'Aucun article détecté. Format attendu : « • article × 1 (255000 Ar × 1 = 255000 Ar) »';
    errEl.style.display = 'block';
    prevEl.style.display = 'none';
    saveBtn.disabled = true;
    return;
  }

  srParsedData = data;

  // Remplir l'aperçu
  document.getElementById('srPreviewClientName').value = data.clientName;
  document.getElementById('srPreviewContact').value    = data.clientContact;
  document.getElementById('srPreviewLieu').textContent = data.deliveryMode === 'livraison'
    ? 'Livraison' + (data.adresseLivraison ? ' — ' + data.adresseLivraison : '')
    : 'Récupération en boutique';

  document.getElementById('srPreviewItemsBody').innerHTML = data.items.map(i => `
    <tr style="border-top:1px solid var(--border)">
      <td style="padding:8px 10px;font-size:13px;color:var(--text)">${_srEsc(i.name)}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:center;color:var(--text)">${i.qty}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:right;color:var(--muted)">${fmt(i.price)}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:right;font-weight:700;color:var(--text)">${fmt(i.qty * i.price)}</td>
    </tr>`).join('');

  document.getElementById('srPreviewTotal').textContent    = fmt(data.total);
  document.getElementById('srPreviewAccompte').textContent = fmt(data.accompte);
  document.getElementById('srPreviewRestant').textContent  = fmt(data.restant);

  prevEl.style.display = 'block';
  saveBtn.disabled = false;
}

function saveCommandeRapide() {
  if (!srParsedData) return;

  // Prendre en compte les éventuelles corrections dans l'aperçu
  const editedName    = document.getElementById('srPreviewClientName')?.value.trim();
  const editedContact = document.getElementById('srPreviewContact')?.value.trim();
  if (editedName)    srParsedData.clientName    = editedName;
  if (editedContact !== undefined) srParsedData.clientContact = editedContact;

  if (!srParsedData.clientName)    { showToast('Le nom du client est obligatoire !', 'error'); return; }
  if (!srParsedData.items.length)  { showToast('Aucun article dans la commande !', 'error');   return; }

  const commande = {
    id:               _genUid('C'),
    date:             new Date().toISOString(),
    caissier:         currentUser?.username || 'commercial',
    clientName:       srParsedData.clientName,
    clientContact:    srParsedData.clientContact,
    deliveryMode:     srParsedData.deliveryMode,
    adresseLivraison: srParsedData.adresseLivraison,
    fraisLivraison:   srParsedData.fraisLivraison || 0,
    dateLivraison:    '',
    items:            srParsedData.items.map(i => ({ name: i.name, qty: i.qty, price: i.price, custom: true })),
    notes:            srParsedData.notes,
    codeSuivi:        srParsedData.clientId || '',
    photos:           [],
    subtotal:         srParsedData.subtotal || srParsedData.total,
    remise:           0,
    total:            srParsedData.total,
    accompte:         srParsedData.accompte,
    restant:          srParsedData.restant,
    depositMethod:    'cash',
    depositProvider:  '',
    depositRef:       '',
    status:           'pending',
    dateFinalisation: null,
    saleId:           null
  };

  const _cmdDossier = _createDossierFromSource('commande', commande);
  commande.dossierId = _cmdDossier.id;
  commandes.unshift(commande);
  // Journal d'encaissement : l'acompte encaissé à la création (le cas échéant)
  if ((Number(commande.accompte) || 0) > 0) {
    _recordEncaissement({
      source: 'commande', refId: commande.id,
      refLabel: _cmdDossier.numeroDossier || _cmdRef(commande),
      client: commande.clientName, montant: Number(commande.accompte) || 0,
      method: 'cash',
      type: (Number(commande.restant) || 0) > 0 ? 'acompte' : 'solde',
      resteApres: Number(commande.restant) || 0
    });
  }
  saveData();
  syncCommandeToSheets(commande);
  syncCommandeToAirtable(commande);
  _addNotification({
    dossierId:     commande.dossierId,
    numeroDossier: _cmdDossier.numeroDossier,
    etapeCode:     'RESERVE',
    etapeLabel:    'Commande créée — saisie rapide',
    operateur:     currentUser?.label || 'Commercial',
    message:       `Commande rapide ${_cmdDossier.numeroDossier} — ${commande.clientName} — ${commande.items.map(i=>i.name).join(', ')}`
  });

  closeModal('saisieRapideModal');
  showToast(`Commande #${commande.id} créée — ${commande.clientName}`);
  updateCmdBadge();
  renderCommandes();
  srParsedData = null;
}

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
