/* Shared UI, API client and route controller for the local auction platform. */
const $ = (selector) => document.querySelector(selector);
const main = $('#main'),
  dialog = $('#modal');
const previewDialog = document.createElement('dialog');
previewDialog.setAttribute('aria-labelledby', 'preview-title');
document.body.append(previewDialog);
const state = {
  user: null,
  categories: [],
  notifications: [],
  config: { google_enabled: false },
  clockOffset: 0,
  routeVersion: 0,
  authVersion: 0,
  authPending: false,
  editor: null,
  detail: null,
  chat: null,
  socket: null,
};
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const money = (value) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value || 0);
const date = (value) =>
  new Date(value).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const now = () => Date.now() + state.clockOffset;
const labels = {
  draft: 'Borrador',
  scheduled: 'Programada',
  active: 'Activa',
  finalized: 'Finalizada',
  cancelled: 'Cancelada',
  suspended: 'Suspendida',
  pending: 'Pendiente de contacto',
  coordinating: 'En coordinacion',
  completed: 'Completada',
  incident: 'Incidencia',
  usuario: 'Cliente',
  subastador: 'Subastador',
  admin: 'Administrador',
  new: 'Nuevo',
  like_new: 'Como nuevo',
  used: 'Usado',
  restored: 'Restaurado',
};
const categoryName = (id) => state.categories.find((item) => item.id === id)?.name || id;
function icons() {
  window.lucide?.createIcons();
}
function toast(message, error = false) {
  const node = document.createElement('div');
  node.className = `toast${error ? ' error' : ''}`;
  node.textContent = message;
  $('#toasts').append(node);
  setTimeout(() => node.remove(), 6000);
}
async function api(route, options = {}) {
  const response = await fetch(`/api${route}`, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(30000),
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error?.message || 'No se pudo completar la solicitud.');
    error.status = response.status;
    throw error;
  }
  return result.data;
}
function route() {
  const value = location.hash.slice(1) || '/';
  const [pathname, query = ''] = value.split('?');
  return { path: pathname, params: new URLSearchParams(query) };
}
function navigate(path) {
  if (location.hash === `#${path}`) render();
  else location.hash = path;
}
function countdown(end, start = null) {
  const diff =
    (start && new Date(start).getTime() > now() ? new Date(start) : new Date(end)).getTime() -
    now();
  if (diff <= 0) return 'Finalizada';
  const total = Math.floor(diff / 1000),
    d = Math.floor(total / 86400),
    h = Math.floor((total % 86400) / 3600),
    m = Math.floor((total % 3600) / 60),
    s = total % 60;
  return `${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function requireAccount(role) {
  if (!state.user) {
    navigate('/login');
    return false;
  }
  if (role && state.user.role !== role) {
    main.innerHTML = empty('Esta seccion necesita una cuenta de subastador.', 'shield');
    return false;
  }
  return true;
}
function empty(message, name = 'package-search') {
  return `<div class="empty">${icon(name)}<h3>${esc(message)}</h3><a class="text-link" href="#/explore">Explorar subastas</a></div>`;
}
function field(name, label, value = '', type = 'text', extra = '') {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function passwordField(name, label) {
  return `<label>${label}<div class="password-input"><input name="${name}" type="password" minlength="8" maxlength="128" required autocomplete="${name === 'current_password' ? 'current-password' : 'new-password'}"><button type="button" data-action="password-toggle" title="Mostrar u ocultar contrasena" aria-label="Mostrar u ocultar contrasena">${icon('eye')}</button></div></label>`;
}
function modal(title, html) {
  dialog.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="Cerrar ventana">${icon('x')}</button></div>${html}`;
  if (!dialog.open) dialog.showModal();
  icons();
}
function confirmDialog(title, message, callback, label = 'Confirmar', danger = false) {
  modal(
    title,
    `<p>${esc(message)}</p><p class="form-status" role="alert"></p><div class="modal-actions"><button class="button" data-action="close-modal">Cancelar</button><button class="button ${danger ? 'danger' : 'primary'}" id="confirm-action">${label}</button></div>`,
  );
  $('#confirm-action').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await callback();
      dialog.close();
    } catch (error) {
      dialog.querySelector('.form-status').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}
function updateHeader() {
  const account = state.user,
    unread = state.notifications.filter((item) => !item.is_read).length;
  const avatar = account?.avatar_url
    ? `<img class="avatar" src="${esc(account.avatar_url)}" alt="">`
    : esc(account?.full_name.slice(0, 1).toUpperCase());
  const accountMenu = account
    ? `<div class="dropdown account-menu"><button class="avatar" data-action="categories-menu" aria-label="Menu de mi cuenta" aria-expanded="false">${avatar}</button><div class="dropdown-menu"><a href="#/dashboard">Mi panel</a>${account.role === 'usuario' ? '<a href="#/dashboard?tab=bids">Mis pujas</a>' : account.role === 'subastador' ? '<a href="#/dashboard?tab=auctions">Mis subastas</a>' : '<a href="#/dashboard?tab=users">Administracion</a>'}<a href="#/dashboard?tab=settings">Configuracion</a><a href="#/dashboard" data-action="logout">Cerrar sesion</a></div></div>`
    : '';
  $('#header').innerHTML =
    `<div class="container header-inner"><a class="brand" href="#/"><span class="brand-mark">A</span>Aurum Subastas</a><nav class="nav" id="navigation" aria-label="Navegacion principal"><a href="#/">Inicio</a><a href="#/explore">Explorar subastas</a><div class="dropdown"><button data-action="categories-menu" aria-expanded="false">Categorias ${icon('chevron-down')}</button><div class="dropdown-menu">${state.categories.map((category) => `<a href="#/explore?category=${category.id}">${esc(category.name)} <small>(${category.count})</small></a>`).join('')}</div></div><a href="#/help">Como funciona</a></nav><div class="header-actions"><button class="icon-button" data-action="global-search" title="Buscar subastas" aria-label="Buscar subastas">${icon('search')}</button>${account ? `${account.role === 'subastador' ? '<a class="button primary sell-link" href="#/sell">Publicar</a>' : ''}<a class="icon-button notification-bell" title="Notificaciones" aria-label="Notificaciones, ${unread} sin leer" href="#/notifications">${icon('bell')}${unread ? `<small>${unread > 99 ? '99+' : unread}</small>` : ''}</a>${accountMenu}` : '<a class="login-link text-link" href="#/login">Iniciar sesion</a><a class="button primary register-link" href="#/register">Registrarse</a><a class="icon-button login-mobile" href="#/login" title="Mi cuenta" aria-label="Mi cuenta">' + icon('user-round') + '</a>'}<button class="icon-button mobile-toggle" data-action="mobile-menu" aria-label="Abrir menu" aria-expanded="false" aria-controls="navigation">${icon('menu')}</button></div></div>`;
  icons();
}
function footer() {
  $('#footer').className = 'site-footer';
  $('#footer').innerHTML =
    `<div class="container"><div class="footer-top"><div><a class="brand" href="#/"><span class="brand-mark">A</span>Aurum Subastas</a><p>Articulos con historia. Una comunidad para descubrir, ofertar y dar una nueva vida a cada pieza.</p><span class="connection" id="connection">Conectando</span></div><nav><h3>La plataforma</h3><a href="#/about">Sobre nosotros</a><a href="#/help">Preguntas frecuentes</a><a href="#/contact">Contacto y soporte</a></nav><nav><h3>Tu confianza</h3><a href="#/terms">Terminos de participacion</a><a href="#/privacy">Privacidad</a><a href="#/help">Seguridad y reclamos</a></nav></div><div class="footer-bottom"><span>&copy; ${new Date().getFullYear()} Aurum Subastas</span><span>Pesos chilenos · CLP</span></div></div>`;
}
function card(product) {
  const photos = product.product_images || [];
  return `<article class="auction-card"><a class="card-media" href="#/auction?id=${product.id}" aria-label="Ver ${esc(product.title)}">${photos.length ? photos.map((image, index) => `<img src="${esc(image.image_url)}" alt="${esc(product.title)}" loading="lazy" class="${index ? '' : 'active'}">`).join('') : `<span class="placeholder">${icon('image')}</span>`}<span class="media-badge">${product.is_featured ? 'Destacada · ' : ''}${labels[product.state]}</span></a><button class="icon-button favorite ${product.is_favorite ? 'selected' : ''}" data-action="favorite" data-id="${product.id}" data-selected="${product.is_favorite ? 1 : 0}" title="${product.is_favorite ? 'Quitar de' : 'Agregar a'} favoritos" aria-label="${product.is_favorite ? 'Quitar de' : 'Agregar a'} favoritos">${icon('heart')}</button><div class="card-body"><span class="card-category">${esc(categoryName(product.category))}</span><h3><a href="#/auction?id=${product.id}">${esc(product.title)}</a></h3><div class="card-facts"><span>${product.bid_count} pujas</span><span data-countdown="${product.ends_at}" ${product.state === 'scheduled' ? `data-start="${product.starts_at}"` : ''}>${countdown(product.ends_at, product.state === 'scheduled' ? product.starts_at : null)}</span></div><div class="card-price"><div><span>${product.bid_count ? 'Puja actual' : 'Precio inicial'}</span><strong>${money(product.current_price)}</strong></div><span>CLP</span></div><a class="button" href="#/auction?id=${product.id}">Ver subasta ${icon('arrow-up-right')}</a></div></article>`;
}
function categoryOptions(selected = '', all = false) {
  return `${all ? '<option value="">Todas las categorias</option>' : ''}${state.categories.map((category) => `<option value="${category.id}" ${category.id === selected ? 'selected' : ''}>${esc(category.name)}</option>`).join('')}`;
}
async function home(version) {
  const [stats, catalog] = await Promise.all([api('/stats'), api('/auctions')]);
  if (version !== state.routeVersion) return;
  const background = catalog.items.find((product) => product.image_url)?.image_url;
  main.innerHTML = `<section class="hero" id="home-hero"><div class="container"><p class="eyebrow">El valor de lo extraordinario</p><h1>Aurum Subastas</h1><p class="tagline">Cada puja es una oportunidad.</p><p class="copy">Descubre articulos unicos, participa en subastas y consigue tu proxima pieza favorita.</p><div class="actions"><a class="button primary" href="#/explore">Explorar subastas ${icon('arrow-right')}</a><a class="button" href="#/sell">Comenzar a vender</a></div></div></section><section class="stats-band"><div class="container stats">${[
    ['Subastas activas', stats.active],
    ['Productos publicados', stats.products],
    ['Usuarios registrados', stats.users],
    ['Subastas finalizadas', stats.finished],
  ]
    .map(
      ([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`,
    )
    .join(
      '',
    )}</div></section><section class="section container"><div class="section-head"><div><p class="eyebrow">Descubre el catalogo</p><h2>En subasta ahora</h2></div><a class="text-link" href="#/explore">Ver todas ${icon('arrow-right')}</a></div>${catalog.items.length ? `<div class="product-grid">${catalog.items.slice(0, 8).map(card).join('')}</div>` : empty('Aun no hay subastas activas.', 'package')}<div class="categories-strip">${state.categories
    .filter((category) => category.count > 0)
    .map(
      (category) =>
        `<a class="category-link" href="#/explore?category=${category.id}">${icon(category.icon)}${esc(category.name)}<small>${category.count}</small></a>`,
    )
    .join(
      '',
    )}</div></section><section class="how-band"><div class="container section"><p class="eyebrow">Tu proxima oportunidad</p><h2>Como funciona</h2>${steps()}</div></section>`;
  if (background) $('#home-hero').style.backgroundImage = `url("${background}")`;
}
function steps() {
  return `<div class="steps"><div><strong>01</strong><h3>Crea tu cuenta</h3><p>Elige cliente para realizar ofertas o subastador para publicar tus productos.</p><a class="text-link" href="#/register">Registrarse</a></div><div><strong>02</strong><h3>Encuentra tu pieza</h3><p>Consulta las fotos, el estado, las condiciones de entrega y el plazo de cada subasta.</p><a class="text-link" href="#/explore">Explorar el catalogo</a></div><div><strong>03</strong><h3>Oferta y coordina</h3><p>Al ganar, conversa con el vendedor y acuerda la entrega. Una adjudicacion no es un pago confirmado.</p><a class="text-link" href="#/dashboard">Ir a mi panel</a></div></div>`;
}
async function explore(params, version) {
  const select = (key, value) => (params.get(key) === value ? 'selected' : '');
  const filters = `<aside class="filters" id="filters"><h3>Filtros</h3><label>Categoria<select name="category">${categoryOptions(params.get('category'), true)}</select></label>${field('min', 'Precio minimo (CLP)', params.get('min') || '', 'number', 'min="0" step="1"')}${field('max', 'Precio maximo (CLP)', params.get('max') || '', 'number', 'min="0" step="1"')}<label>Estado<select name="state"><option value="active" ${select('state', 'active')}>Activas</option><option value="scheduled" ${select('state', 'scheduled')}>Programadas</option><option value="finalized" ${select('state', 'finalized')}>Finalizadas</option></select></label>${field('location', 'Ubicacion', params.get('location') || '')}<label>Fecha de cierre<select name="closing"><option value="">Cualquier fecha</option><option value="24" ${select('closing', '24')}>Proximas 24 horas</option><option value="168" ${select('closing', '168')}>Proximos 7 dias</option></select></label><label class="check"><input type="checkbox" name="featured" ${params.get('featured') === '1' ? 'checked' : ''}>Solo destacados</label><label class="check"><input type="checkbox" name="no_bids" ${params.get('no_bids') === '1' ? 'checked' : ''}>Sin pujas</label><button class="button" type="button" data-action="clear-filters">Limpiar filtros</button></aside>`;
  main.innerHTML = `<div class="container section"><div class="section-head"><div><p class="eyebrow">Tu siguiente descubrimiento</p><h1>Explorar subastas</h1></div><button class="button filter-mobile" data-action="filters">${icon('sliders-horizontal')}Filtros</button></div><form id="catalog-form"><div class="catalog-bar"><label class="search-input">${icon('search')}<input type="search" name="q" value="${esc(params.get('q') || '')}" placeholder="Nombre, descripcion, marca o categoria" aria-label="Buscar subastas"></label><select name="sort" aria-label="Ordenar subastas"><option value="featured">Destacados primero</option>${[
    ['recent', 'Mas recientes'],
    ['closing', 'Proximas a finalizar'],
    ['low', 'Menor precio'],
    ['high', 'Mayor precio'],
    ['popular', 'Mas pujas'],
  ]
    .map(([value, label]) => `<option value="${value}" ${select('sort', value)}>${label}</option>`)
    .join(
      '',
    )}</select></div><div class="catalog-layout">${filters}<div id="catalog-results"><div class="product-grid">${Array(6).fill('<div class="skeleton"></div>').join('')}</div></div></div></form></div>`;
  let timer;
  const form = $('#catalog-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    queryCatalog();
  });
  form.addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(queryCatalog, event.target.name === 'q' ? 350 : 100);
  });
  form.addEventListener('change', () => {
    clearTimeout(timer);
    queryCatalog();
  });
  const result = await api(`/auctions?${params}`);
  if (version !== state.routeVersion) return;
  showCatalog(result);
}
let catalogQuery = 0;
async function queryCatalog(page = 1) {
  const form = $('#catalog-form');
  if (!form) return;
  const params = new URLSearchParams();
  for (const [name, value] of new FormData(form))
    if (value) params.set(name, value === 'on' ? '1' : value);
  params.set('page', page);
  history.replaceState(null, '', `#/explore?${params}`);
  const version = state.routeVersion,
    query = ++catalogQuery;
  try {
    const result = await api(`/auctions?${params}`);
    if (version === state.routeVersion && query === catalogQuery) showCatalog(result);
  } catch (error) {
    toast(error.message, true);
  }
}
function showCatalog(result) {
  $('#catalog-results').innerHTML =
    `<p class="tiny muted" aria-live="polite">${result.total} resultado${result.total === 1 ? '' : 's'}</p>${result.items.length ? `<div class="product-grid">${result.items.map(card).join('')}</div>` : empty('Ninguna subasta coincide con tu busqueda.')}<div class="pagination"><button class="icon-button" data-action="page" data-page="${result.page - 1}" ${result.page <= 1 ? 'disabled' : ''} aria-label="Pagina anterior">${icon('chevron-left')}</button><span class="tiny">${result.page} / ${Math.max(1, Math.ceil(result.total / result.page_size))}</span><button class="icon-button" data-action="page" data-page="${result.page + 1}" ${result.page * result.page_size >= result.total ? 'disabled' : ''} aria-label="Pagina siguiente">${icon('chevron-right')}</button></div>`;
  icons();
}
function authScreen(type, params) {
  if (state.user && ['login', 'register'].includes(type)) {
    navigate('/dashboard');
    return;
  }
  const title = {
    login: 'Bienvenido de nuevo',
    register: 'Crea tu cuenta',
    forgot: 'Recupera tu acceso',
    reset: 'Nueva contrasena',
  }[type];
  const fields =
    type === 'register'
      ? `<div class="form-row">${field('first_name', 'Nombre', '', 'text', 'required minlength="2" maxlength="60" autocomplete="given-name"')}${field('last_name', 'Apellido', '', 'text', 'required minlength="2" maxlength="60" autocomplete="family-name"')}</div>${field('email', 'Correo electronico', '', 'email', 'required autocomplete="email" maxlength="254"')}<label>Tipo de cuenta<select name="role"><option value="usuario">Cliente · participar en subastas</option><option value="subastador">Subastador · publicar productos</option></select></label>${passwordField('password', 'Contrasena')}${passwordField('confirm_password', 'Repite tu contrasena')}<label class="check"><input type="checkbox" name="accept_terms" required>Acepto los <a class="text-link" href="#/terms">terminos de participacion</a></label>`
      : type === 'reset'
        ? `<input type="hidden" name="token" value="${esc(params.get('token'))}">${passwordField('password', 'Nueva contrasena')}${passwordField('confirm_password', 'Repite tu contrasena')}`
        : `${field('email', 'Correo electronico', '', 'email', 'required autocomplete="email"')}${type === 'login' ? passwordField('password', 'Contrasena') : ''}`;
  main.innerHTML = `<div class="auth-wrap"><section class="auth-card"><p class="eyebrow">Aurum Subastas</p><h1>${title}</h1><p class="tiny">${type === 'register' ? 'Encuentra tu lugar en la comunidad.' : type === 'login' ? 'Tus subastas te esperan.' : 'Te ayudamos a recuperar tu cuenta.'}</p><form class="form" data-form="${type}">${fields}${type === 'register' || type === 'reset' ? '<p class="tiny muted">Minimo 8 caracteres, con una letra y un numero.</p>' : ''}<p class="form-status" role="alert"></p><button class="button primary" type="submit">${{ login: 'Iniciar sesion', register: 'Crear cuenta', forgot: 'Solicitar recuperacion', reset: 'Cambiar contrasena' }[type]}</button></form>${state.config.google_enabled && ['login', 'register'].includes(type) ? `<div class="separator">${type === 'login' ? '<label class="check"><input type="checkbox" id="google-terms">Acepto los <a class="text-link" href="#/terms">terminos</a> para continuar con Google</label>' : ''}<button type="button" class="button" data-action="google-login">Continuar con Google</button></div>` : ''}${type === 'login' ? '<p class="auth-foot"><a class="text-link" href="#/forgot">Olvidaste tu contrasena?</a></p><p class="auth-foot">No tienes cuenta? <a class="text-link" href="#/register">Registrarse</a></p>' : type === 'register' ? '<p class="auth-foot">Ya tienes cuenta? <a class="text-link" href="#/login">Iniciar sesion</a></p>' : '<p class="auth-foot"><a class="text-link" href="#/login">Volver a iniciar sesion</a></p>'}</section></div>`;
}
async function detail(id, version) {
  const [product, history] = await Promise.all([
    api(`/auctions/${encodeURIComponent(id)}`),
    api(`/auctions/${encodeURIComponent(id)}/bids`),
  ]);
  if (version !== state.routeVersion) return;
  state.detail = product;
  const photos = product.product_images;
  main.innerHTML = `<div class="container section"><nav class="breadcrumb"><a href="#/">Inicio</a><span>/</span><a href="#/explore">Subastas</a><span>/</span><span>${esc(categoryName(product.category))}</span></nav><div class="detail-grid"><div><div class="gallery-main">${photos.length ? `<img id="gallery-main" src="${esc(photos[0].image_url)}" alt="${esc(product.title)}"><button class="icon-button" data-action="zoom" title="Ampliar imagen" aria-label="Ampliar imagen">${icon('expand')}</button>` : empty('Sin imagenes', 'image')}</div><div class="thumbs">${photos.map((photo, index) => `<button data-action="select-image" data-src="${esc(photo.image_url)}" class="${index ? '' : 'selected'}" aria-label="Ver imagen ${index + 1}"><img src="${esc(photo.image_url)}" alt="${esc(product.title)} imagen ${index + 1}"></button>`).join('')}</div></div><section class="detail-info"><p class="eyebrow">${esc(categoryName(product.category))}</p><h1>${esc(product.title)}</h1><p>${esc(product.description)}</p><div class="detail-meta"><div><small>Subastador</small><strong>${esc(product.seller_name)}</strong></div><div><small>Ubicacion</small><strong>${esc(product.location || 'No informada')}</strong></div><div><small>Estado del articulo</small><strong>${labels[product.condition]}</strong></div><div><small>Estado de subasta</small><span class="badge ${product.state}">${labels[product.state]}</span></div></div><div class="bid-panel"><span class="muted tiny">${product.bid_count ? 'Puja actual' : 'Precio inicial'} · CLP</span><strong class="amount" id="detail-price">${money(product.current_price)}</strong><div class="countdown" data-countdown="${product.ends_at}" ${product.state === 'scheduled' ? `data-start="${product.starts_at}"` : ''}>${countdown(product.ends_at, product.state === 'scheduled' ? product.starts_at : null)}</div><p class="tiny">${product.bid_count} pujas · ${product.participants} participantes<br>Incremento minimo: ${money(product.minimum_increment)}</p><div class="actions"><button class="button primary" data-action="bid" ${product.state !== 'active' ? 'disabled' : ''}>${product.state === 'active' ? 'Realizar puja' : labels[product.state]}</button><button class="icon-button favorite-inline ${product.is_favorite ? 'selected' : ''}" data-action="favorite" data-id="${product.id}" data-selected="${product.is_favorite ? 1 : 0}" title="Favoritos" aria-label="Favoritos">${icon('heart')}</button></div>${product.result ? `<p class="tiny separator">${product.result.winner_id ? 'Adjudicada por ' + money(product.result.final_amount) : 'Finalizada sin adjudicacion.'} ${product.result.winner_id === state.user?.id ? '<a class="text-link" href="#/dashboard?tab=deals">Coordinar la compra</a>' : ''}</p>` : ''}</div></section></div><div class="detail-lower"><section><h2>Detalles de la publicacion</h2><div class="facts-list">${[
    ['Precio inicial', money(product.starting_price)],
    ['Inicio', date(product.starts_at)],
    ['Cierre', date(product.ends_at)],
    ['Marca', product.brand || 'No informada'],
    ['Modelo', product.model || 'No informado'],
    ['Reserva', product.reserve_price ? money(product.reserve_price) : 'Sin reserva'],
  ]
    .map(([label, value]) => `<div><span>${label}</span>${esc(value)}</div>`)
    .join(
      '',
    )}</div><h3 class="separator">Caracteristicas</h3><p>${esc(product.features || 'Sin caracteristicas adicionales.')}</p><h3>Condiciones de entrega</h3><p>${esc(product.delivery_terms)}</p><button class="button" data-action="report" data-id="${product.id}">${icon('flag')}Reportar publicacion</button></section><section><h2>Historial de pujas</h2><div id="bid-history">${historyTable(history)}</div></section></div></div>`;
}
function historyTable(history) {
  return history.length
    ? `<table class="history"><thead><tr><th>Participante</th><th>Oferta</th><th>Fecha</th></tr></thead><tbody>${history.map((bid) => `<tr><td>${esc(bid.participant)}</td><td>${money(bid.amount)}</td><td>${date(bid.created_at)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="empty">Todavia no hay pujas. Puedes ser el primero.</p>';
}
function openBid() {
  if (!requireAccount()) return;
  if (state.user.role !== 'usuario') {
    toast('Solo las cuentas de cliente pueden realizar pujas.', true);
    return;
  }
  const product = state.detail;
  if (!product || product.state !== 'active') return;
  const minimum = product.current_price + product.minimum_increment;
  modal(
    'Confirmar tu oferta',
    `<p>${esc(product.title)}</p><div class="confirm-amount">${money(product.current_price)}</div><form class="form" data-form="bid"><input type="hidden" name="product_id" value="${product.id}"><input type="hidden" name="idempotency_key" value="${crypto.randomUUID()}">${field('amount', 'Tu oferta (CLP)', minimum, 'number', `required min="${minimum}" step="1"`)}<p class="tiny">Si tu oferta es aceptada y ganas, asumes el compromiso de coordinar la compra segun los terminos de participacion. No se realizara un cobro desde esta pagina.</p><p class="form-status" role="alert"></p><div class="actions"><button type="button" class="button" data-action="close-modal">Cancelar</button><button class="button primary" type="submit">Confirmar puja</button></div></form>`,
  );
}
function dashboardNav(tab) {
  const seller = state.user.role === 'subastador',
    admin = state.user.role === 'admin';
  const items = admin
    ? [
        ['summary', 'Resumen', 'layout-dashboard'],
        ['users', 'Usuarios', 'users'],
        ['auctions', 'Publicaciones', 'gavel'],
        ['reports', 'Reportes', 'flag'],
        ['audit', 'Auditoria', 'scroll-text'],
        ['settings', 'Mi perfil', 'user-round'],
      ]
    : [
        ['summary', 'Resumen', 'layout-dashboard'],
        [seller ? 'auctions' : 'bids', seller ? 'Mis subastas' : 'Mis pujas', 'gavel'],
        ...(!seller
          ? [
              ['won', 'Ganadas', 'trophy'],
              ['favorites', 'Favoritos', 'heart'],
            ]
          : []),
        ['deals', 'Acuerdos', 'messages-square'],
        ['settings', 'Mi perfil', 'user-round'],
      ];
  return `<nav class="dashboard-nav" aria-label="Panel personal">${items.map(([key, label, name]) => `<a class="${key === tab ? 'active' : ''}" href="#/dashboard?tab=${key}">${icon(name)}${label}</a>`).join('')}<a href="#/notifications">${icon('bell')}Notificaciones</a><a href="#/dashboard" data-action="logout">${icon('log-out')}Cerrar sesion</a></nav>`;
}
function statTiles(items) {
  return `<div class="dashboard-stats">${items.map(([label, value]) => `<div><strong>${esc(value)}</strong><span>${label}</span></div>`).join('')}</div>`;
}
function auctionTable(products) {
  if (!products.length) return empty('Todavia no tienes publicaciones.');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Producto</th><th>Oferta actual</th><th>Pujas</th><th>Cierre</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${products.map((product) => `<tr><td><div class="table-product">${product.image_url ? `<img src="${esc(product.image_url)}" alt="">` : ''}<div><a href="#/auction?id=${product.id}">${esc(product.title)}</a><small>${esc(categoryName(product.category))}</small></div></div></td><td>${money(product.current_price)}<small class="muted"> / ${money(product.starting_price)}</small></td><td>${product.bid_count}</td><td>${date(product.ends_at)}</td><td><span class="badge ${product.state}">${labels[product.state]}</span></td><td><div class="actions">${['draft', 'active', 'scheduled'].includes(product.state) ? `<button class="icon-button" data-action="edit-auction" data-id="${product.id}" ${product.bid_count ? 'disabled' : ''} title="${product.bid_count ? 'No se permite editar con pujas' : 'Editar'}" aria-label="Editar">${icon('pencil')}</button>${product.state === 'draft' ? `<button class="icon-button" data-action="publish-draft" data-id="${product.id}" title="Publicar" aria-label="Publicar">${icon('send')}</button>` : ''}<button class="icon-button" data-action="delete-auction" data-id="${product.id}" ${product.bid_count ? 'disabled' : ''} title="Eliminar" aria-label="Eliminar">${icon('trash-2')}</button>` : ''}<a class="icon-button" href="#/auction?id=${product.id}" title="Ver subasta" aria-label="Ver subasta">${icon('arrow-up-right')}</a></div></td></tr>`).join('')}</tbody></table></div>`;
}
function bidTable(bids) {
  if (!bids.length) return empty('Todavia no has participado en subastas.');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Subasta</th><th>Tu oferta</th><th>Oferta lider</th><th>Tu participacion</th><th>Tiempo restante</th></tr></thead><tbody>${bids
    .map((bid) => {
      const product = bid.products;
      const won = product.result?.winner_id === state.user.id;
      const leading = product.state === 'active' && bid.amount >= product.current_price;
      return `<tr><td><div class="table-product">${product.image_url ? `<img src="${esc(product.image_url)}" alt="">` : ''}<a href="#/auction?id=${product.id}">${esc(product.title)}</a></div></td><td>${money(bid.amount)}</td><td>${money(product.current_price)}</td><td><span class="${won || leading ? 'winning' : 'lost'}">${won ? 'Ganaste' : product.state === 'finalized' ? 'Sin adjudicacion a tu favor' : product.state === 'cancelled' ? 'Cancelada' : leading ? 'Vas liderando' : 'Superada'}</span></td><td data-countdown="${product.ends_at}">${countdown(product.ends_at)}</td></tr>`;
    })
    .join('')}</tbody></table></div>`;
}
function dealList(deals) {
  return deals.length
    ? `<div class="deal-list">${deals.map((deal) => `<article class="deal-row"><div><span class="badge">${labels[deal.status]}</span><h3>${esc(deal.products.title)}</h3><p>Con ${esc(state.user.id === deal.seller_id ? deal.buyer.full_name : deal.seller.full_name)} · ${money(deal.final_price)}</p><p>Comprador: ${deal.buyer_confirmed ? 'confirmado' : 'pendiente'} · Subastador: ${deal.seller_confirmed ? 'confirmado' : 'pendiente'}</p></div><button class="button primary" data-action="open-deal" data-id="${deal.id}">${icon('messages-square')}Abrir acuerdo</button></article>`).join('')}</div>`
    : empty('Todavia no tienes acuerdos pendientes.', 'messages-square');
}
async function dashboard(params, version) {
  if (!requireAccount()) return;
  const tab = params.get('tab') || 'summary';
  main.innerHTML = `<div class="container section"><div class="page-heading"><p class="eyebrow">${labels[state.user.role]}</p><h1>Hola, ${esc(state.user.first_name || state.user.full_name)}</h1></div><div class="dashboard-layout">${dashboardNav(tab)}<section id="dashboard-content"><div class="loading">Cargando tu actividad...</div></section></div></div>`;
  const target = $('#dashboard-content');
  if (tab === 'settings') {
    target.innerHTML = profileSettings();
    return;
  }
  if (state.user.role === 'admin') {
    const html = await adminContent(tab);
    if (version === state.routeVersion) target.innerHTML = html;
    return;
  }
  if (tab === 'favorites') {
    const products = await api('/favorites');
    if (version === state.routeVersion)
      target.innerHTML = `<h2>Mis favoritos</h2>${products.length ? `<div class="product-grid">${products.map(card).join('')}</div>` : empty('Aun no tienes favoritos.', 'heart')}`;
    return;
  }
  if (tab === 'deals' || tab === 'won') {
    const deals = await api('/deals');
    if (version === state.routeVersion)
      target.innerHTML = `<h2>${tab === 'won' ? 'Subastas ganadas' : 'Coordinacion de ventas'}</h2><p class="tiny">La adjudicacion no equivale a un pago. Confirma el acuerdo solo cuando ambas partes hayan concretado la entrega.</p>${dealList(tab === 'won' ? deals.filter((deal) => deal.buyer_id === state.user.id) : deals)}`;
    return;
  }
  const seller = state.user.role === 'subastador';
  const [items, deals] = await Promise.all([
    api(seller ? '/auctions/mine' : '/users/me/bids'),
    api('/deals'),
  ]);
  if (version !== state.routeVersion) return;
  const active = seller
    ? items.filter((item) => item.state === 'active')
    : items.filter((item) => item.products.state === 'active');
  const tiles = seller
    ? [
        ['Activas', active.length],
        ['Programadas', items.filter((item) => item.state === 'scheduled').length],
        ['Finalizadas', items.filter((item) => item.state === 'finalized').length],
        ['Ventas confirmadas', deals.filter((deal) => deal.status === 'completed').length],
        ['Pujas recibidas', items.reduce((sum, item) => sum + item.bid_count, 0)],
        ['Adjudicado', money(deals.reduce((sum, item) => sum + item.final_price, 0))],
      ]
    : [
        ['Participando', active.length],
        ['Liderando', active.filter((item) => item.amount >= item.products.current_price).length],
        ['Ganadas', deals.length],
        [
          'Perdidas',
          items.filter(
            (item) =>
              item.products.state === 'finalized' &&
              item.products.result?.winner_id !== state.user.id,
          ).length,
        ],
      ];
  target.innerHTML = `${tab === 'summary' ? statTiles(tiles) : ''}<div class="section-head"><h2>${seller ? 'Mis subastas' : 'Mis pujas'}</h2>${seller ? '<a href="#/sell" class="button primary">' + icon('plus') + 'Crear subasta</a>' : ''}</div>${seller ? auctionTable(items) : bidTable(items)}${tab === 'summary' && seller ? activityChart(items) : ''}`;
}
function activityChart(products) {
  const groups = ['draft', 'scheduled', 'active', 'finalized'];
  const values = groups.map((group) => products.filter((item) => item.state === group).length);
  const max = Math.max(...values, 1);
  return `<h3 class="separator">Estado de tus publicaciones</h3><div class="chart">${groups.map((group, index) => `<div class="chart-item"><span>${values[index]}</span><div class="chart-bar" data-height="${Math.max(2, (values[index] / max) * 100)}"></div><span>${labels[group]}</span></div>`).join('')}</div>`;
}
function profileSettings() {
  const account = state.user;
  return `<h2>Tu perfil</h2>${account.avatar_url ? `<img class="avatar profile-avatar" src="${esc(account.avatar_url)}" alt="Tu avatar">` : ''}<form class="form profile-form" data-form="profile"><div class="form-row">${field('first_name', 'Nombre', account.first_name, 'text', 'required minlength="2"')}${field('last_name', 'Apellido', account.last_name, 'text', 'required minlength="2"')}</div>${field('email', 'Correo', account.email, 'email', 'disabled')}<label>Avatar<input type="file" name="avatar" accept="image/jpeg,image/png"></label><label class="check"><input type="checkbox" name="notifications_enabled" ${account.notifications_enabled ? 'checked' : ''}>Activar avisos en tiempo real</label><p class="form-status" role="alert"></p><button class="button primary" type="submit">Guardar perfil</button></form><h3 class="separator">Cambiar contrasena</h3><form class="form profile-form" data-form="password">${passwordField('current_password', 'Contrasena actual')}${passwordField('password', 'Nueva contrasena')}${passwordField('confirm_password', 'Repite la nueva contrasena')}<p class="form-status" role="alert"></p><button class="button" type="submit">Cambiar contrasena y cerrar otras sesiones</button></form>`;
}
async function adminContent(tab) {
  if (tab === 'summary') {
    const stats = await api('/admin/stats');
    return `<h2>Estado de la plataforma</h2>${statTiles([
      ['Usuarios', stats.users],
      ['Subastadores', stats.sellers],
      ['Clientes', stats.clients],
      ['Subastas activas', stats.active],
      ['Finalizadas', stats.finished],
      ['Reportes pendientes', stats.reports],
      ['Volumen adjudicado', money(stats.volume)],
    ])}<p>Consulta publicaciones, reportes y actividad desde el panel de administracion.</p>`;
  }
  if (tab === 'users') {
    const users = await api('/admin/users');
    return `<h2>Gestion de usuarios</h2><form class="admin-toolbar" data-form="admin-search"><input name="q" placeholder="Buscar nombre o correo" aria-label="Buscar usuarios"><select name="role" aria-label="Filtrar por rol"><option value="">Todos los roles</option><option value="usuario">Clientes</option><option value="subastador">Subastadores</option><option value="admin">Administradores</option></select><button class="button">Buscar</button></form><div id="admin-users">${usersTable(users)}</div>`;
  }
  if (tab === 'auctions') {
    const products = await api('/admin/auctions');
    return `<h2>Moderacion de publicaciones</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>Publicacion</th><th>Subastador</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${products.map((item) => `<tr><td><a href="#/auction?id=${item.id}">${esc(item.title)}</a></td><td>${esc(item.seller_name)}</td><td>${labels[item.state]}</td><td><button class="button" data-action="moderate" data-id="${item.id}">Revisar</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  if (tab === 'reports') {
    const reports = await api('/admin/reports');
    return `<h2>Reportes e incidencias</h2>${reports.length ? `<div class="deal-list">${reports.map((item) => `<article class="deal-row"><div><span class="badge">${esc(item.status === 'pending' ? 'Pendiente' : item.status === 'reviewed' ? 'Revisado' : 'Descartado')}</span><h3>${esc(item.title)}</h3><p>${esc(item.reason)}</p><p>${esc(item.description)}</p></div>${item.status === 'pending' ? `<button class="button" data-action="review-report" data-id="${item.id}">Marcar revisado</button>` : ''}</article>`).join('')}</div>` : empty('No hay reportes.', 'shield-check')}`;
  }
  if (tab === 'audit') {
    const logs = await api('/admin/audit-logs');
    return `<h2>Registro de auditoria</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>Fecha</th><th>Accion</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>${logs.map((item) => `<tr><td>${date(item.created_at)}</td><td>${esc(item.action)}</td><td>${esc(item.entity_type)}</td><td>${esc(item.metadata)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return empty('Seccion no encontrada.');
}
function usersTable(users) {
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Usuario</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Accion</th></tr></thead><tbody>${users.map((user) => `<tr><td>${esc(user.full_name)}</td><td>${esc(user.email)}</td><td>${labels[user.role]}</td><td>${user.status === 'active' ? 'Activo' : 'Suspendido'}</td><td>${user.role !== 'admin' ? `<button class="button" data-action="user-status" data-id="${user.id}" data-status="${user.status === 'active' ? 'suspended' : 'active'}">${user.status === 'active' ? 'Suspender' : 'Reactivar'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function editorForm(product = null) {
  const value = product || {};
  return `<form data-form="auction" class="editor-form" id="auction-form"><section class="form-section"><h2>Informacion del producto</h2><div class="form-row">${field('title', 'Nombre del producto', value.title, 'text', 'required maxlength="160" minlength="2"')}${field('brand', 'Marca', value.brand, 'text', 'maxlength="100"')}<label class="full">Descripcion<textarea name="description" required minlength="5" maxlength="10000">${esc(value.description)}</textarea></label><label>Categoria<select name="category">${categoryOptions(value.category)}</select></label><label>Estado del producto<select name="condition">${['new', 'like_new', 'used', 'restored'].map((condition) => `<option value="${condition}" ${value.condition === condition ? 'selected' : ''}>${labels[condition]}</option>`).join('')}</select></label>${field('model', 'Modelo', value.model, 'text', 'maxlength="100"')}${field('location', 'Ubicacion general', value.location, 'text', 'maxlength="160"')}<label class="full">Caracteristicas<textarea name="features" maxlength="3000">${esc(value.features)}</textarea></label></div></section><section class="form-section"><h2>Fotografias</h2><p class="tiny">JPG o PNG · hasta 10 imagenes · 5 MB por imagen</p><label class="upload-zone">${icon('image-plus')}<p>Seleccionar imagenes del dispositivo</p><input type="file" id="auction-images" multiple accept="image/jpeg,image/png" aria-label="Agregar fotografias"></label><div class="image-manager" id="image-manager"></div></section><section class="form-section"><h2>Configuracion de la subasta</h2><div class="form-row">${field('starting_price', 'Precio inicial (CLP)', value.starting_price || '', 'number', 'required min="1" step="1"')}${field('minimum_increment', 'Incremento minimo (CLP)', value.minimum_increment || 1000, 'number', 'required min="1" step="1"')}${field('reserve_price', 'Precio de reserva (opcional)', value.reserve_price || '', 'number', 'min="1" step="1"')}${field('starts_at', 'Fecha de inicio', localDate(value.starts_at || new Date().toISOString()), 'datetime-local', 'required')}${field('ends_at', 'Fecha de cierre', value.ends_at ? localDate(value.ends_at) : '', 'datetime-local', 'required')}<label class="full">Condiciones de entrega<textarea name="delivery_terms" maxlength="3000">${esc(value.delivery_terms)}</textarea></label></div></section><p class="form-status" role="alert"></p><div class="actions"><button class="button primary" type="submit">${product ? 'Guardar cambios' : 'Publicar subasta'}</button>${!product ? '<button class="button" type="submit" data-draft="1">Guardar borrador</button>' : ''}<button class="button" type="button" data-action="preview-auction">Vista previa</button><a class="button" href="#/dashboard?tab=auctions">Cancelar</a></div></form>`;
}
function localDate(value) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
async function editor(id = null, inModal = false) {
  if (!requireAccount('subastador')) return;
  const product = id ? await api(`/auctions/${id}`) : null;
  if (product?.bid_count) {
    toast('No puedes editar una subasta con pujas.', true);
    return;
  }
  state.editor = {
    id,
    images: (product?.product_images || []).map((image) => ({
      ...image,
      preview: image.image_url,
    })),
  };
  if (inModal) {
    modal('Editar publicacion', editorForm(product));
    dialog.querySelector('.actions a').addEventListener('click', (event) => {
      event.preventDefault();
      dialog.close();
    });
  } else
    main.innerHTML = `<div class="container section"><nav class="breadcrumb"><a href="#/dashboard">Mi panel</a><span>/</span><span>Crear subasta</span></nav><h1>Publica tu proxima subasta</h1><div class="editor-layout">${editorForm(product)}<aside class="editor-aside"><p class="eyebrow">Una buena publicacion</p><h3>Todos los detalles cuentan</h3><p>Describe el estado real del articulo y cualquier defecto. Utiliza fotografias propias.</p><p>El primer archivo sera la imagen principal. Define las condiciones de entrega antes de recibir ofertas.</p><p>Con pujas aceptadas, la publicacion queda protegida frente a cambios.</p></aside></div></div>`;
  imageManager();
  icons();
}
function imageManager() {
  const target = $('#image-manager');
  if (!target || !state.editor) return;
  target.innerHTML = state.editor.images
    .map(
      (image, index) =>
        `<div class="image-tile"><img src="${esc(image.preview || image.image_url || image.data)}" alt="Imagen ${index + 1}">${index === 0 ? '<small>Principal</small>' : ''}<div class="image-actions"><button type="button" class="icon-button" data-action="image-left" data-index="${index}" ${index === 0 ? 'disabled' : ''} title="Mover antes" aria-label="Mover imagen antes">${icon('chevron-left')}</button><button type="button" class="icon-button" data-action="image-main" data-index="${index}" title="Hacer principal" aria-label="Hacer imagen principal">${icon('star')}</button><button type="button" class="icon-button" data-action="image-right" data-index="${index}" ${index === state.editor.images.length - 1 ? 'disabled' : ''} title="Mover despues" aria-label="Mover imagen despues">${icon('chevron-right')}</button><button type="button" class="icon-button" data-action="image-remove" data-index="${index}" title="Eliminar imagen" aria-label="Eliminar imagen">${icon('trash-2')}</button></div></div>`,
    )
    .join('');
  icons();
}
async function fileImage(file) {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024)
    throw new Error('Utiliza JPG o PNG de hasta 5 MB.');
  const raw = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Imagen invalida.'));
    image.src = raw;
  });
  if (image.width * image.height > 12000000) throw new Error('La imagen supera 12 megapixeles.');
  const ratio = Math.min(1, 1800 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * ratio);
  canvas.height = Math.round(image.height * ratio);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL(file.type, 0.85) };
}
function auctionData(form, draft = false) {
  const data = Object.fromEntries(new FormData(form));
  for (const name of ['starting_price', 'minimum_increment']) data[name] = Number(data[name]);
  data.reserve_price = data.reserve_price ? Number(data.reserve_price) : null;
  data.starts_at = new Date(data.starts_at).toISOString();
  data.ends_at = new Date(data.ends_at).toISOString();
  data.images = state.editor.images.map((image) =>
    image.id ? { id: image.id } : { data: image.data },
  );
  data.draft = draft;
  return data;
}
async function openDeal(id) {
  const [deal, messages] = await Promise.all([api(`/deals/${id}`), api(`/deals/${id}/messages`)]);
  state.chat = id;
  modal(
    'Coordinar la venta',
    `<h3>${esc(deal.products.title)}</h3><p class="tiny">${money(deal.final_price)} · ${labels[deal.status]}<br>La confirmacion expresa un acuerdo entre las partes; no acredita un pago procesado por Aurum.</p><div id="deal-confirmations">${dealConfirmations(deal)}</div><div class="chat-messages" id="chat-messages">${messagesHTML(messages)}</div><form class="chat-form" data-form="message"><input name="message" required maxlength="2000" placeholder="Escribe un mensaje..." aria-label="Mensaje"><button class="icon-button primary" type="submit" title="Enviar mensaje" aria-label="Enviar mensaje">${icon('send')}</button><p class="form-status" role="alert"></p></form><div class="modal-actions"><button class="button danger" data-action="deal-incident" data-id="${id}">${icon('flag')}Reportar incidencia</button><button class="button primary" data-action="deal-confirm" data-id="${id}" ${deal.status === 'completed' || (state.user.id === deal.buyer_id ? deal.buyer_confirmed : deal.seller_confirmed) ? 'disabled' : ''}>Confirmar entrega y acuerdo</button></div>`,
  );
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
}
function messagesHTML(messages) {
  return messages.length
    ? messages
        .map(
          (message) =>
            `<div class="message ${message.sender_id === state.user.id ? 'mine' : ''}"><strong class="tiny">${esc(message.sender_name)}</strong><p>${esc(message.message)}</p><small>${date(message.created_at)}</small></div>`,
        )
        .join('')
    : '<p class="muted tiny">Todavia no hay mensajes. Inicia la coordinacion.</p>';
}
function dealConfirmations(deal) {
  return `<div class="deal-confirmations"><span>Comprador: ${deal.buyer_confirmed ? 'confirmado' : 'pendiente'}</span><span>Subastador: ${deal.seller_confirmed ? 'confirmado' : 'pendiente'}</span></div>`;
}
async function notificationsScreen(version) {
  if (!requireAccount()) return;
  const notifications = await api('/notifications');
  if (version !== state.routeVersion) return;
  state.notifications = notifications;
  updateHeader();
  main.innerHTML = `<div class="container section"><div class="section-head"><h1>Notificaciones</h1><button class="button" data-action="read-all">${icon('check-check')}Marcar todas como leidas</button></div>${notifications.length ? notifications.map((item) => `<article class="notification-item ${item.is_read ? '' : 'unread'}">${icon(item.type === 'won' ? 'trophy' : 'bell')}<div class="content"><h3>${esc(item.title)}</h3><p>${esc(item.message)}</p><small class="muted">${date(item.created_at)}</small>${item.product_id ? `<div><a class="text-link tiny" href="#/auction?id=${item.product_id}">Ver subasta</a></div>` : ''}</div>${!item.is_read ? `<button class="icon-button" data-action="read-one" data-id="${item.id}" title="Marcar leida" aria-label="Marcar leida">${icon('check')}</button>` : ''}</article>`).join('') : empty('Estas al dia.', 'bell')}</div>`;
}
const legalPages = {
  about: {
    title: 'Sobre Aurum',
    html: '<p>Aurum conecta a personas que venden productos mediante subastas con clientes que quieren participar con ofertas. Cada publicacion describe sus propias condiciones y plazo.</p><p>La plataforma facilita las pujas y la coordinacion posterior. En esta version no cobra ni procesa pagos.</p>',
  },
  help: {
    title: 'Como funciona',
    html:
      steps() +
      '<h2>Que ocurre al finalizar?</h2><p>Gana la oferta mas alta aceptada que alcance la reserva, si existe. Sin ofertas o sin alcanzar la reserva, la subasta finaliza sin adjudicacion. Comprador y vendedor reciben un acuerdo para coordinarse.</p><h2>Si una parte no cumple</h2><p>Reporta una incidencia desde el acuerdo. La venta no se marca completada hasta que ambos confirmen. No se adjudica automaticamente al segundo participante. La administracion revisa el caso y puede suspender cuentas o publicaciones.</p><h2>Cancelar o editar</h2><p>Un subastador puede cancelar o eliminar publicaciones sin pujas. Con ofertas aceptadas, los cambios quedan bloqueados y requieren revision administrativa por un motivo justificado.</p><h2>Participacion segura</h2><p>Comprueba el articulo y acuerda la entrega antes de transferir dinero. Reporta publicaciones sospechosas desde su pagina de detalle. No compartas claves ni datos bancarios en el chat.</p>',
  },
  terms: {
    title: 'Terminos de participacion',
    html: '<p>Estas reglas corresponden a la version de desarrollo de Aurum. Deben completarse con la identidad y datos del operador antes de un lanzamiento publico.</p><h2>Publicaciones y ofertas</h2><p>El vendedor debe describir el producto de forma veraz y publicar fotografias autorizadas. Las ofertas son compromisos de coordinar la compra si resultan adjudicadas. Deben superar el precio lider por al menos el incremento definido.</p><h2>Cierre y adjudicacion</h2><p>El servidor decide el cierre y acepta ofertas de forma ordenada. Al finalizar gana la oferta valida mas alta que alcance la reserva. Sin oferta valida, no hay adjudicacion.</p><h2>Entrega, pagos y reclamos</h2><p>Las partes acuerdan entrega y pago mediante el acuerdo. Aurum no retiene dinero ni garantiza pagos. Si no se concreta la venta, utiliza el reporte de incidencia. Una confirmacion doble indica acuerdo entre las partes, no un pago verificado por la plataforma.</p><h2>Moderacion</h2><p>La administracion puede suspender usuarios o publicaciones y cancelar subastas por motivos documentados. Los reportes se revisan y las acciones sensibles quedan registradas.</p>',
  },
  privacy: {
    title: 'Privacidad',
    html: '<p>La version local guarda los datos en SQLite en el equipo donde se ejecuta el servidor. Las contrasenas se almacenan mediante Argon2id y las sesiones usan cookies HttpOnly.</p><h2>Informacion utilizada</h2><p>Guardamos nombre, apellido, correo, rol, avatar opcional, publicaciones, pujas, favoritos, notificaciones y mensajes relacionados con acuerdos. El historial publico de pujas utiliza identificadores anonimizados.</p><h2>Acceso a tus datos</h2><p>Solo los participantes acceden a los mensajes de su acuerdo. Los administradores acceden a la informacion necesaria para moderar. Las imagenes de publicaciones y avatares son publicas.</p><h2>Version de desarrollo</h2><p>Antes de publicar el servicio se deben completar los datos del responsable, canal de derechos, plazos de conservacion y politica aplicable. No uses esta version como aviso legal definitivo.</p>',
  },
  contact: {
    title: 'Contacto y soporte',
    html: '<p>Para una publicacion sospechosa utiliza Reportar publicacion desde su detalle. Para problemas de entrega o cumplimiento, abre el acuerdo y selecciona Reportar incidencia.</p><a class="button" href="#/dashboard?tab=deals">Mis acuerdos</a><h2>Contacto del operador</h2><p>El correo de soporte y las redes sociales oficiales todavia no se han definido. No se muestran enlaces a cuentas que no pertenecen a la plataforma.</p>',
  },
};
function information(path) {
  const page = legalPages[path];
  main.innerHTML = `<div class="container section legal"><p class="eyebrow">Aurum Subastas</p><h1>${page.title}</h1>${page.html}</div>`;
}

async function render() {
  if (previewDialog.open) previewDialog.close();
  const version = ++state.routeVersion;
  state.detail = null;
  state.chat = null;
  if (dialog.open) dialog.close();
  const { path, params } = route();
  main.innerHTML = '<div class="loading">Cargando...</div>';
  document.title = 'Aurum Subastas';
  try {
    if (path === '/') await home(version);
    else if (path === '/explore') await explore(params, version);
    else if (['/login', '/register', '/forgot', '/reset'].includes(path))
      authScreen(path.slice(1), params);
    else if (path === '/auction') await detail(params.get('id') || '', version);
    else if (path === '/dashboard') await dashboard(params, version);
    else if (path === '/sell') await editor();
    else if (path === '/notifications') await notificationsScreen(version);
    else if (legalPages[path.slice(1)]) information(path.slice(1));
    else main.innerHTML = empty('Pagina no encontrada.');
    if (version === state.routeVersion) {
      icons();
      document
        .querySelectorAll('[data-height]')
        .forEach((node) => (node.style.height = `${node.dataset.height}px`));
    }
  } catch (error) {
    if (version !== state.routeVersion) return;
    main.innerHTML = `<div class="container section">${empty(error.message, 'wifi-off')}<div class="actions"><button class="button" data-action="retry">Reintentar</button>${error.status === 401 ? '<a class="button primary" href="#/login">Iniciar sesion</a>' : ''}</div></div>`;
    icons();
  }
}

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const button = event.submitter;
  if (button?.disabled) return;
  const kind = form.dataset.form;
  const data = Object.fromEntries(new FormData(form));
  const status = form.querySelector('.form-status');
  if (status) status.textContent = '';
  if (button) button.disabled = true;
  try {
    if (['login', 'register'].includes(kind)) {
      state.authPending = true;
      state.authVersion++;
      clearTimeout(refreshTimer);
      data.accept_terms = data.accept_terms === 'on';
      state.user = await api(`/auth/${kind}`, { method: 'POST', body: data });
      state.notifications = await api('/notifications');
      updateHeader();
      state.socket?.disconnect().connect();
      navigate('/dashboard');
      toast(kind === 'login' ? 'Bienvenido a Aurum.' : 'Tu cuenta esta lista.');
    } else if (kind === 'forgot') {
      const result = await api('/auth/forgot-password', { method: 'POST', body: data });
      toast(result.message);
      form.reset();
    } else if (kind === 'reset') {
      await api('/auth/reset-password', { method: 'POST', body: data });
      state.user = null;
      updateHeader();
      navigate('/login');
      toast('Contrasena actualizada. Inicia sesion nuevamente.');
    } else if (kind === 'bid') {
      data.amount = Number(data.amount);
      await api(`/auctions/${data.product_id}/bids`, { method: 'POST', body: data });
      dialog.close();
      toast('Tu puja fue aceptada.');
      await render();
    } else if (kind === 'auction') {
      const payload = auctionData(form, button?.dataset.draft === '1');
      await api(state.editor.id ? `/auctions/${state.editor.id}` : '/auctions', {
        method: state.editor.id ? 'PATCH' : 'POST',
        body: payload,
      });
      dialog.close();
      state.editor = null;
      toast('Publicacion guardada.');
      navigate('/dashboard?tab=auctions');
    } else if (kind === 'profile') {
      data.notifications_enabled = data.notifications_enabled === 'on';
      const file = form.querySelector('[name=avatar]').files[0];
      if (file) data.avatar = await fileImage(file);
      state.user = await api('/users/me', { method: 'PATCH', body: data });
      updateHeader();
      toast('Perfil actualizado.');
    } else if (kind === 'password') {
      await api('/users/me/password', { method: 'PATCH', body: data });
      form.reset();
      state.socket?.disconnect().connect();
      toast('Contrasena actualizada. Las otras sesiones se cerraron.');
    } else if (kind === 'message') {
      await api(`/deals/${state.chat}/messages`, { method: 'POST', body: data });
      form.reset();
      await refreshChat();
    } else if (kind === 'report') {
      await api(`/auctions/${data.id}/report`, { method: 'POST', body: data });
      dialog.close();
      toast('Reporte enviado para revision.');
    } else if (kind === 'incident') {
      await api(`/deals/${data.id}/incident`, { method: 'POST', body: data });
      dialog.close();
      toast('Incidencia enviada.');
      render();
    } else if (kind === 'moderate') {
      data.featured = data.featured === 'on';
      await api(`/admin/auctions/${data.id}/moderation`, { method: 'PATCH', body: data });
      dialog.close();
      toast('Revision registrada.');
      render();
    } else if (kind === 'user-status') {
      await api(`/admin/users/${data.id}/status`, { method: 'PATCH', body: data });
      dialog.close();
      toast('Estado del usuario actualizado.');
      render();
    } else if (kind === 'admin-search') {
      const users = await api(`/admin/users?${new URLSearchParams(data)}`);
      $('#admin-users').innerHTML = usersTable(users);
      icons();
    } else if (kind === 'global-search') {
      dialog.close();
      navigate(`/explore?q=${encodeURIComponent(data.q)}`);
    }
  } catch (error) {
    if (status) status.textContent = error.message;
    else toast(error.message, true);
  } finally {
    state.authPending = false;
    if (button?.isConnected) button.disabled = false;
  }
});
document.addEventListener('change', async (event) => {
  if (event.target.id !== 'auction-images' || !state.editor) return;
  const files = Array.from(event.target.files);
  if (state.editor.images.length + files.length > 10) {
    toast('Puedes agregar hasta 10 imagenes.', true);
    event.target.value = '';
    return;
  }
  const editor = state.editor;
  const submits = Array.from(event.target.closest('form').querySelectorAll('[type=submit]'));
  submits.forEach((button) => (button.disabled = true));
  event.target.disabled = true;
  try {
    const prepared = await Promise.all(files.map(fileImage));
    if (state.editor === editor) {
      editor.images.push(...prepared);
      imageManager();
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    event.target.disabled = false;
    event.target.value = '';
    submits.forEach((button) => (button.disabled = false));
  }
});
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'logout') event.preventDefault();
  try {
    if (action === 'close-modal') dialog.close();
    else if (action === 'close-preview') previewDialog.close();
    else if (action === 'global-search')
      modal(
        'Buscar subastas',
        `<form class="form" data-form="global-search">${field('q', 'Que estas buscando?', '', 'search', 'required maxlength="160"')}<button class="button primary">Buscar</button></form>`,
      );
    else if (action === 'skip') {
      event.preventDefault();
      main.focus();
    } else if (action === 'google-login') {
      const accepted = $('[name=accept_terms]')?.checked || $('#google-terms')?.checked;
      if (!accepted) {
        toast('Acepta los terminos para continuar con Google.', true);
        return;
      }
      location.href = `/api/auth/google?role=${$('[name=role]')?.value || 'usuario'}&terms=1`;
    } else if (action === 'retry') render();
    else if (action === 'password-toggle') {
      const input = button.parentElement.querySelector('input');
      input.type = input.type === 'password' ? 'text' : 'password';
      button.setAttribute('aria-pressed', input.type === 'text');
    } else if (action === 'mobile-menu') {
      const open = $('#navigation').classList.toggle('open');
      button.setAttribute('aria-expanded', open);
    } else if (action === 'categories-menu') {
      const open = button.parentElement.classList.toggle('open');
      button.setAttribute('aria-expanded', open);
    } else if (action === 'filters') $('#filters').classList.toggle('open');
    else if (action === 'clear-filters') navigate('/explore');
    else if (action === 'page') queryCatalog(Number(button.dataset.page));
    else if (action === 'favorite') {
      if (!requireAccount()) return;
      await api(`/favorites/${button.dataset.id}`, {
        method: button.dataset.selected === '1' ? 'DELETE' : 'POST',
        body: {},
      });
      button.dataset.selected = button.dataset.selected === '1' ? '0' : '1';
      button.classList.toggle('selected', button.dataset.selected === '1');
      button.setAttribute('aria-pressed', button.dataset.selected === '1');
      toast(button.dataset.selected === '1' ? 'Agregado a favoritos.' : 'Quitado de favoritos.');
    } else if (action === 'bid') openBid();
    else if (action === 'select-image') {
      $('#gallery-main').src = button.dataset.src;
      document
        .querySelectorAll('.thumbs button')
        .forEach((item) => item.classList.toggle('selected', item === button));
    } else if (action === 'zoom')
      modal(
        'Fotografia del producto',
        `<img class="zoom-image" src="${esc($('#gallery-main').src)}" alt="${esc(state.detail.title)}">`,
      );
    else if (action === 'logout')
      confirmDialog(
        'Cerrar sesion',
        'Quieres cerrar tu sesion de Aurum?',
        async () => {
          await api('/auth/logout', { method: 'POST', body: {} });
          state.user = null;
          state.notifications = [];
          state.socket?.disconnect().connect();
          updateHeader();
          navigate('/login');
        },
        'Cerrar sesion',
      );
    else if (action === 'edit-auction') await editor(button.dataset.id, true);
    else if (action === 'delete-auction')
      confirmDialog(
        'Eliminar publicacion',
        'Esta accion elimina la publicacion y sus imagenes. Solo se permite si no ha recibido pujas.',
        async () => {
          await api(`/auctions/${button.dataset.id}`, { method: 'DELETE', body: {} });
          toast('Publicacion eliminada.');
          render();
        },
        'Eliminar publicacion',
        true,
      );
    else if (action === 'publish-draft')
      confirmDialog(
        'Publicar subasta',
        'La publicacion quedara disponible segun su fecha de inicio.',
        async () => {
          await api(`/auctions/${button.dataset.id}/publish`, { method: 'POST', body: {} });
          toast('Subasta publicada.');
          render();
        },
        'Publicar',
      );
    else if (action.startsWith('image-')) {
      const index = Number(button.dataset.index),
        images = state.editor.images;
      if (action === 'image-remove') images.splice(index, 1);
      if (action === 'image-main') images.unshift(...images.splice(index, 1));
      if (action === 'image-left' && index > 0)
        [images[index - 1], images[index]] = [images[index], images[index - 1]];
      if (action === 'image-right' && index < images.length - 1)
        [images[index + 1], images[index]] = [images[index], images[index + 1]];
      imageManager();
    } else if (action === 'preview-auction') {
      const form = $('#auction-form');
      if (!form.reportValidity()) return;
      const data = auctionData(form);
      const photo = state.editor.images[0];
      previewDialog.innerHTML = `<div class="modal-head"><h2 id="preview-title">Vista previa</h2><button type="button" class="icon-button" data-action="close-preview" aria-label="Cerrar vista previa">${icon('x')}</button></div>${photo ? `<img class="zoom-image" src="${esc(photo.preview || photo.image_url || photo.data)}" alt="${esc(data.title)}">` : ''}<p class="eyebrow">${esc(categoryName(data.category))}</p><h2>${esc(data.title)}</h2><p>${esc(data.description)}</p><strong class="confirm-amount">${money(data.starting_price)}</strong><p>Inicio: ${date(data.starts_at)}<br>Cierre: ${date(data.ends_at)}</p><h3>Condiciones de entrega</h3><p>${esc(data.delivery_terms)}</p>`;
      previewDialog.showModal();
      icons();
    } else if (action === 'open-deal') await openDeal(button.dataset.id);
    else if (action === 'deal-confirm')
      confirmDialog(
        'Confirmar entrega y acuerdo',
        'Confirma solo si has concretado la entrega y el acuerdo con la otra parte. Esto no acredita un pago procesado por Aurum.',
        async () => {
          await api(`/deals/${button.dataset.id}/confirm`, { method: 'POST', body: {} });
          toast('Tu confirmacion fue registrada.');
          render();
        },
      );
    else if (action === 'deal-incident')
      modal(
        'Reportar incidencia',
        `<form class="form" data-form="incident"><input type="hidden" name="id" value="${button.dataset.id}"><label>Describe el problema<textarea name="message" required minlength="5" maxlength="2000"></textarea></label><p class="form-status" role="alert"></p><button class="button danger">Enviar incidencia</button></form>`,
      );
    else if (action === 'report') {
      if (!requireAccount()) return;
      modal(
        'Reportar publicacion',
        `<form class="form" data-form="report"><input type="hidden" name="id" value="${button.dataset.id}"><label>Motivo<select name="reason"><option>Publicacion sospechosa</option><option>Producto prohibido o no autentico</option><option>Informacion incorrecta</option><option>Otro motivo</option></select></label><label>Descripcion<textarea name="description" maxlength="2000"></textarea></label><p class="form-status" role="alert"></p><button class="button primary">Enviar reporte</button></form>`,
      );
    } else if (action === 'read-all') {
      await api('/notifications/read-all', { method: 'PATCH', body: {} });
      render();
    } else if (action === 'read-one') {
      await api(`/notifications/${button.dataset.id}/read`, { method: 'PATCH', body: {} });
      render();
    } else if (action === 'moderate')
      modal(
        'Revisar publicacion',
        `<form class="form" data-form="moderate"><input type="hidden" name="id" value="${button.dataset.id}"><label>Accion<select name="state"><option value="suspended">Suspender</option><option value="cancelled">Cancelar</option><option value="active">Activar</option></select></label><label class="check"><input type="checkbox" name="featured">Destacar publicacion</label>${field('reason', 'Motivo', '', 'text', 'required minlength="5" maxlength="500"')}<p class="form-status" role="alert"></p><button class="button primary">Confirmar revision</button></form>`,
      );
    else if (action === 'user-status')
      modal(
        button.dataset.status === 'suspended' ? 'Suspender usuario' : 'Reactivar usuario',
        `<form class="form" data-form="user-status"><input type="hidden" name="id" value="${button.dataset.id}"><input type="hidden" name="status" value="${button.dataset.status}">${field('reason', 'Motivo', '', 'text', 'required minlength="5" maxlength="500"')}<p class="form-status" role="alert"></p><button class="button primary">Confirmar cambio</button></form>`,
      );
    else if (action === 'review-report') {
      await api(`/admin/reports/${button.dataset.id}`, {
        method: 'PATCH',
        body: { status: 'reviewed' },
      });
      toast('Reporte revisado.');
      render();
    }
  } catch (error) {
    toast(error.message, true);
  }
});
async function refreshChat() {
  if (!state.chat || !dialog.open || !$('#chat-messages')) return;
  const id = state.chat;
  const [deal, messages] = await Promise.all([api(`/deals/${id}`), api(`/deals/${id}/messages`)]);
  if (state.chat !== id || !$('#chat-messages')) return;
  $('#chat-messages').innerHTML = messagesHTML(messages);
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
  $('#deal-confirmations').innerHTML = dealConfirmations(deal);
}
let refreshTimer;
async function refresh() {
  if (state.authPending) return;
  const version = state.authVersion;
  try {
    const current = await api('/auth/me');
    if (version !== state.authVersion || state.authPending) return;
    if (state.user && !current) {
      state.user = null;
      state.notifications = [];
      updateHeader();
      if (dialog.open) dialog.close();
      toast('Tu sesion ha finalizado.');
      navigate('/login');
      return;
    }
    if (state.user) {
      const notifications = await api('/notifications');
      const prior = new Set(state.notifications.map((item) => item.id));
      if (state.user.notifications_enabled)
        for (const item of notifications.filter((item) => !prior.has(item.id)).slice(0, 2))
          toast(item.title);
      state.notifications = notifications;
      updateHeader();
    }
    state.categories = await api('/categories');
    if (state.chat && dialog.open) {
      await refreshChat();
      return;
    }
    if (state.detail) {
      const product = await api(`/auctions/${state.detail.id}`);
      if (product.current_price !== state.detail.current_price) {
        $('#detail-price').textContent = money(product.current_price);
        $('#detail-price').classList.add('price-flash');
        setTimeout(() => $('#detail-price')?.classList.remove('price-flash'), 1300);
        $('#bid-history').innerHTML = historyTable(await api(`/auctions/${product.id}/bids`));
      }
      if (product.state !== state.detail.state && !dialog.open) {
        await render();
        return;
      }
      state.detail = product;
      return;
    }
    if (
      !dialog.open &&
      !document.activeElement?.closest('form') &&
      ['/', '/dashboard', '/notifications'].includes(route().path)
    )
      await render();
  } catch {
    /* Socket reconnection triggers a new synchronization attempt. */
  }
}
window.addEventListener('hashchange', () => {
  $('#navigation')?.classList.remove('open');
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
});
dialog.addEventListener('close', () => {
  state.chat = null;
});
setInterval(() => {
  document
    .querySelectorAll('[data-countdown]')
    .forEach((node) => (node.textContent = countdown(node.dataset.countdown, node.dataset.start)));
  if (state.detail?.state === 'active' && new Date(state.detail.ends_at).getTime() <= now())
    document.querySelector('[data-action=bid]')?.setAttribute('disabled', '');
}, 1000);
setInterval(() => {
  document.querySelectorAll('.card-media').forEach((media) => {
    const photos = Array.from(media.querySelectorAll('img'));
    if (photos.length < 2) return;
    const index = photos.findIndex((photo) => photo.classList.contains('active'));
    photos[index]?.classList.remove('active');
    photos[(index + 1) % photos.length].classList.add('active');
  });
}, 10000);
async function init() {
  footer();
  try {
    const [account, categories, health, config] = await Promise.all([
      api('/auth/me'),
      api('/categories'),
      api('/health'),
      api('/config'),
    ]);
    state.user = account;
    state.categories = categories;
    state.config = config;
    state.clockOffset = new Date(health.server_time).getTime() - Date.now();
    if (account) state.notifications = await api('/notifications');
    updateHeader();
    await render();
    state.socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10000 });
    state.socket.on('sync', (event) => {
      state.clockOffset = new Date(event.server_time).getTime() - Date.now();
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, 250);
    });
    state.socket.on('connect', () => {
      $('#connection').textContent = 'En vivo';
      $('#connection').classList.remove('offline');
    });
    state.socket.on('disconnect', () => {
      $('#connection').textContent = 'Reconectando';
      $('#connection').classList.add('offline');
    });
    state.socket.on('refresh', (event) => {
      state.clockOffset = new Date(event.server_time).getTime() - Date.now();
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, 200);
    });
  } catch (error) {
    main.innerHTML = `<div class="container section">${empty('No se pudo conectar con el servidor local.', 'wifi-off')}<button class="button" id="reconnect">Reintentar</button></div>`;
    $('#reconnect').addEventListener('click', init);
    icons();
  }
}
init();
