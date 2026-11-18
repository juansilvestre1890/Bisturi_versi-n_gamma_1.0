// Interfaz «pantalla de inicio + mesa de trabajo».
// No crea funciones nuevas de edición: mueve los controles originales (con sus ids y
// manejadores intactos) a los paneles de cada botón y conecta los atajos de la mesa.
const $ = id => document.getElementById(id);
const almacen = $('almacen');
const api = () => window.bisturi;

// ---------- utilidades para tomar los controles originales ----------
const etiqueta = id => $(id)?.closest('label') || $(id);
function seccion(texto, raiz = almacen) {
  const h2 = [...raiz.querySelectorAll('h2')].find(h => h.textContent.trim().startsWith(texto));
  if (!h2) return [];
  const padre = h2.parentElement;
  if (padre.firstElementChild === h2 && !padre.matches('aside')) return [padre];
  const out = [h2];
  for (let n = h2.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) out.push(n);
  return out;
}
function grupo(titulo, nodos, nota) {
  const g = document.createElement('section');
  g.className = 'cajon-grupo';
  if (titulo) { const h = document.createElement('h3'); h.textContent = titulo; g.append(h); }
  if (nota) { const p = document.createElement('p'); p.className = 'hint nota'; p.textContent = nota; g.append(p); }
  for (const n of nodos.flat()) if (n) g.append(n);
  return g;
}
const boton = (texto, accion, clase = 'secondary full') => { const b = document.createElement('button'); b.type = 'button'; b.className = clase; b.textContent = texto; b.onclick = accion; return b; };

// ---------- paneles (cajones) ----------
const paneles = {};
function crearPaneles() {
  const tools = almacen.querySelector('.tools');
  const lanzadorCurvo = [...(tools?.querySelectorAll(':scope > button') || [])].find(b => /curvo/i.test(b.textContent));
  // Corte curvo: botón propio en la columna izquierda.
  if ($('hCorteCurvo')) $('hCorteCurvo').onclick = () => lanzadorCurvo?.click();
  // «Cortar región marcada» del Pincel: ahora corta con el Bisturí libre (toma la zona pintada).
  document.addEventListener('click', e => { if (!e.target.closest?.('#curveFromSelection,#mobileCurveFromSelection')) return; e.stopImmediatePropagation(); e.preventDefault(); cerrar(); $('vBisturiLibre')?.click(); }, true);

  // Separación inteligente es un botón directo (sin panel); el corte por plano es una herramienta
  // de la barra vertical. Sus controles originales siguen en el almacén para que el código los use.
  paneles.seleccion = { titulo: 'Selección', nodos: [
    grupo('Herramienta de selección', [$('brushTool'), $('wandTool'), $('magneticTool')]),
    grupo(null, [almacen.querySelector('.surface-tools')])
  ] };
  paneles.bisturi = { titulo: 'Bisturí', nodos: [grupo(null, [$('bisturiPlanoPanel')])] };
  paneles.bisturiLibre = { titulo: 'Bisturí libre', nodos: [grupo(null, [$('bisturiLibrePanel')])] };
  // Encastres en modo sencillo: tipo, cantidad, tamaño y un botón. Lo demás va en «Más opciones».
  {
    const f = almacen.querySelector('.connector-form'), lab = id => $(id).closest('label');
    // Tipos: cilindro (pin en una pieza y agujero en la otra), rectangular y cola de milano.
    const nombres = { circular: 'Cilindro', rectangular: 'Rectangular', dovetail: 'Cola de milano' };
    const sel = $('pegShape'); sel.querySelector('[value="alignment"]')?.remove();
    for (const o of sel.options) o.textContent = nombres[o.value] || o.textContent;
    sel.prepend(sel.querySelector('[value="circular"]')); sel.value = 'circular'; sel.dispatchEvent(new Event('change'));
    lab('pegShape').firstChild.textContent = 'Tipo';
    const tam = document.createElement('label'); tam.append('Tamaño (mm)');
    const inp = document.createElement('input'); inp.id = 'pegSize'; inp.type = 'number'; inp.min = '1'; inp.max = '40'; inp.step = '0.5'; inp.placeholder = 'Auto'; inp.inputMode = 'decimal'; tam.append(inp);
    const aplicar = $('pegApplyBtn'); aplicar.textContent = 'Agregar encastre'; aplicar.className = 'full';
    const mas = document.createElement('details'); mas.id = 'pegAvanzado'; mas.className = 'peg-avanzado';
    const res = document.createElement('summary'); res.textContent = 'Más opciones'; mas.append(res);
    mas.append($('pegDiameterLabel'), $('rectFields'), $('dovetailFields'), lab('pegDepth'), lab('pegClearance'), lab('pegMinWall'), lab('pegSpacing'), lab('pegOffsetU'), lab('pegOffsetV'), $('pegPreviewBtn'), $('pegTouchBtn'), $('pegResetBtn'), $('pegPreviewInfo'));
    mas.addEventListener('toggle', () => { inp.disabled = mas.open; tam.classList.toggle('apagado', mas.open); });
    const cantidad = lab('pegCount');
    f.replaceChildren(lab('pegShape'), cantidad, tam, aplicar, mas);
  }
  // «Quitar encastre» va dentro de Encastres 3D, al final del panel.
  const quitarEnc = $('aQuitarEncastre'); quitarEnc.className = 'secondary full quitar-encastre';
  paneles.encastres = { titulo: 'Encastres 3D', nodos: [grupo(null, [almacen.querySelector('.connector-form')]), grupo('Quitar', [quitarEnc])] };
  // Camas: «Ver cama en 3D» y «Mostrar todas las camas», y debajo la cama activa.
  $('bedViewSlot')?.replaceWith($('viewBed3D'));
  paneles.piezas = { titulo: 'Gestionar piezas', nodos: [
    grupo(null, seccion('Camas de impresión', almacen.querySelector('aside.right'))),
    grupo(null, seccion('Posición y giro', almacen.querySelector('aside.right')))
  ] };
  paneles.exportar = { titulo: 'Exportar piezas', nodos: [grupo(null, seccion('Exportación', almacen.querySelector('aside.right')))] };
  paneles.proyecto = { titulo: 'Proyecto', nodos: [
    grupo('Datos del proyecto', [etiqueta('projectName'), $('newBtn'), $('openBtn')]),
    grupo('Tamaño y boquilla', [etiqueta('height'), $('scaleBtn'), etiqueta('nozzle')]),
    grupo('Modelos de ejemplo', [$('demoBtn'), $('demoMushroomBtn'), $('demoPebbleBtn')])
  ] };
  // Cada panel tiene su contenedor propio para no mover nodos al abrir/cerrar.
  for (const [clave, p] of Object.entries(paneles)) {
    const c = document.createElement('div');
    c.className = 'cajon-panel'; c.dataset.panel = clave; c.hidden = true;
    for (const n of p.nodos) if (n) c.append(n);
    $('cajonCuerpo').append(c);
    p.el = c;
  }
}

let abierto = null;
function abrir(clave, titulo) {
  const p = paneles[clave];
  if (!p) return;
  if (abierto === clave && !titulo) { cerrar(); return; }
  for (const q of Object.values(paneles)) q.el.hidden = q !== p;
  $('cajonTitulo').textContent = titulo || p.titulo;
  $('cajon').hidden = false;
  abierto = clave;
  window.dispatchEvent(new CustomEvent('cajon-abierto', { detail: clave }));
  document.body.classList.add('cajon-abierto');
  window.dispatchEvent(new Event('resize'));
  if (matchMedia('(max-width:820px)').matches) document.querySelector('.escena').scrollIntoView({ block: 'start' });
  document.querySelectorAll('[data-cajon]').forEach(b => b.classList.toggle('activo', b.dataset.cajon === clave && (!titulo || b.dataset.titulo === titulo || !b.dataset.titulo)));
  $('cajonCuerpo').scrollTop = 0;
}
// Al terminar la acción principal de una ventana, la ventana se cierra sola.
const CIERRAN_VENTANA = ['newBtn', 'demoBtn', 'demoMushroomBtn', 'demoPebbleBtn', 'scaleBtn',
  'exportPlacedBed', 'exportBed', 'exportBedsReport', 'exportBtn', 'reportBtn',
  'pegApplyBtn', 'aQuitarEncastre',
  'showAllBedsPanel', 'viewBed3D', 'assignBed', 'autoLayout', 'applyPlace', 'centerBedView'];
function cierreAutomatico() {
  document.addEventListener('click', e => {
    const b = e.target.closest?.('button'); if (!b || !CIERRAN_VENTANA.includes(b.id) || !b.closest('#cajon')) return;
    setTimeout(() => { if (!$('cajon').hidden) cerrar(); }, 0);
  });
  // Abrir un modelo: se cierra cuando se elige el archivo.
  $('file')?.addEventListener('change', () => setTimeout(cerrar, 0));
}
function cerrar() {
  const antes = abierto;
  $('cajon').hidden = true; abierto = null;
  if (antes) window.dispatchEvent(new CustomEvent('cajon-cerrado', { detail: antes }));
  document.body.classList.remove('cajon-abierto');
  window.dispatchEvent(new Event('resize'));
  document.querySelectorAll('[data-cajon].activo').forEach(b => b.classList.remove('activo'));
}

// ---------- pantalla de inicio ----------
function mostrarInicio() {
  $('inicioVolver').hidden = !api()?.modelLoaded;
  $('inicio').hidden = false; $('mesa').hidden = true;
}
function mostrarMesa() {
  $('inicio').hidden = true; $('mesa').hidden = false;
  window.dispatchEvent(new Event('resize'));
}

// ---------- ejes y datos del proyecto ----------
function dibujarEjes() {
  const c = $('ejes'), ctx = c.getContext('2d'), q = api()?.cameraQuaternion?.();
  if (!q || $('mesa').hidden) return;
  // Gira los ejes del mundo con la rotación inversa de la cámara (conjugado del cuaternión).
  const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
  const rot = ([vx, vy, vz]) => {
    const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
    return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
  };
  const ejes = [['X', [1, 0, 0], '#ff4d5e'], ['Y', [0, 1, 0], '#3ee07a'], ['Z', [0, 0, 1], '#3d8bff']].map(([n, v, col]) => [n, rot(v), col]).sort((a, b) => a[1][2] - b[1][2]);
  const s = c.width, m = s / 2, L = s * 0.32;
  ctx.clearRect(0, 0, s, s);
  for (const [n, v, col] of ejes) {
    const ex = m + v[0] * L, ey = m - v[1] * L;
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(m, m); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = col; ctx.font = '800 17px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(n, m + v[0] * (L + 14), m - v[1] * (L + 14));
  }
}
let formato = '—';
function actualizarDatos() {
  const a = api(); if (!a) return;
  const n = a.meshes.length;
  $('nPiezas').textContent = n;
  const t = a.modelSize?.();
  const alto = t ? `${(t.y / 10).toFixed(1)} cm` : '—';
  $('regla').hidden = !t; $('reglaValor').textContent = alto;
  $('vMover').classList.toggle('activo', a.tool === 'Mover' && a.transformMode === 'translate');
  $('vRotar').classList.toggle('activo', a.tool === 'Mover' && a.transformMode === 'rotate');
  $('vEscalar').classList.toggle('activo', a.tool === 'Mover' && a.transformMode === 'scale');
  $('vSeleccionar').classList.toggle('activo', a.tool === 'Seleccionar');
  $('vExplosion').classList.toggle('activo', !!a.explode); $('vRayosX').classList.toggle('activo', (a.modoVista || 'objeto') !== 'objeto');
  if (!a.explode && !a.herramientaVista && !$('separador').hidden) $('separador').hidden = true;
}

// ---------- montaje ----------
function montar() {
  // Vista 3D, estado y lista de piezas.
  $('escenaVista').prepend($('viewport'));
  $('estadoFila').append($('status'));
  $('listaPiezas').append($('pieces'));
  document.body.append($('warning'));
  document.querySelector('.barra-vertical').after($('cajon'));
  crearPaneles(); cierreAutomatico();

  document.querySelectorAll('[data-cajon]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.herramienta) $(b.dataset.herramienta)?.click();
    abrir(b.dataset.cajon, b.dataset.titulo);
  }));
  $('cajonCerrar').onclick = cerrar;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && abierto) cerrar(); });

  // Barra superior / inicio.
  $('inicioVolver').onclick = mostrarMesa;
  $('inicioNuevo').onclick = () => { mostrarMesa(); if (api()?.modelLoaded) $('newBtn').click(); };
  $('inicioAbrir').onclick = () => $('file').click();
  // En algunas tabletas y vistas dentro de otras apps, el selector de archivos solo se abre si el dedo toca
  // directamente un <input type="file">. Por eso cada botón «Abrir» lleva encima un selector invisible;
  // lo elegido se pasa al selector principal como si se hubiera usado ese.
  // Con «accept» Android abre el gestor de archivos (no solo cámara y galería).
  for (const id of ['openBtn', 'inicioAbrir']) {
    const b = $(id); if (!b) continue;
    const sobre = document.createElement('input'); sobre.type = 'file'; sobre.multiple = true; sobre.accept = $('file').accept; sobre.className = 'archivo-sobre'; sobre.tabIndex = -1; sobre.setAttribute('aria-hidden', 'true');
    sobre.addEventListener('click', e => e.stopPropagation());
    sobre.addEventListener('change', () => {
      if (!sobre.files?.length) return;
      const principal = $('file');
      try { principal.files = sobre.files; principal.dispatchEvent(new Event('change', { bubbles: true })); }
      catch (_) { principal.dispatchEvent(Object.assign(new Event('change'), {})); }
      setTimeout(() => { sobre.value = ''; }, 0);
    });
    b.classList.add('con-archivo'); b.append(sobre);
  }
  $('file').addEventListener('change', e => {
    const f = [...e.target.files].find(x => /\.(stl|3mf|obj|fbx|glb)$/i.test(x.name));
    if (f) { formato = f.name.split('.').pop().toUpperCase(); mostrarMesa(); }
  }, { capture: true });
  for (const id of ['demoBtn', 'demoMushroomBtn', 'demoPebbleBtn']) $(id)?.addEventListener('click', () => { formato = 'Ejemplo'; });

  // Barra vertical.
  $('vSeleccionar').onclick = () => $('selectTool').click();
  $('vMover').onclick = () => api()?.setTransformMode('translate');
  $('vRotar').onclick = () => api()?.setTransformMode('rotate');
  $('vEscalar').onclick = () => api()?.setTransformMode('scale');
  $('vEncuadrar').onclick = () => api()?.fit();
  $('vExplosion').onclick = () => api()?.alternarVista();
  // Al entrar a una herramienta de corte o edición, el modelo vuelve a armarse: se sale de la explosión.
  const herramientasCorte = ['vCortePlano', 'vBisturi', 'vBisturiLibre', 'vBisturiMagnetico', 'vBisturiCurvo', 'hCorteCurvo', 'hInteligente', 'hSeleccion', 'hEncastres', 'vUnir'];
  document.addEventListener('click', e => {
    const b = e.target.closest?.('button'); if (!b || !herramientasCorte.includes(b.id)) return;
    // Separación inteligente respeta la vista elegida (Objeto, Rayos X o Malla).
    if (b.id !== 'hInteligente' && api()?.modoVista === 'rayos') api().setModoVista('objeto');
    if (api()?.explode && !api()?.vistaPrevia) { $('explodeBtn').click(); api()?.status?.('Explosión desactivada: el modelo vuelve a estar armado para cortar.'); }
  }, true);
  // «Vista»: menú con tres modos de ver la malla.
  const MODOS = [['objeto', 'Objeto'], ['rayos', 'Rayos X'], ['malla', 'Malla']];
  const menuVista = document.createElement('div'); menuVista.className = 'menu-vista'; menuVista.hidden = true; menuVista.setAttribute('role', 'menu');
  // Cada modo con su imagen (posiciones 6, 7 y 8 de la tira de iconos); el botón Vista muestra la del modo actual.
  const IMG_MODO = { objeto: 6, rayos: 7, malla: 8 };
  menuVista.innerHTML = MODOS.map(([k, t]) => `<button type="button" role="menuitemradio" data-modo="${k}"><span class="ico-img" style="--n:${IMG_MODO[k] ?? 6}" aria-hidden="true"></span>${t}</button>`).join('');
  const iconoVista = m => { const i = $('vRayosX').querySelector('.ico-img'); if (i) i.style.setProperty('--n', IMG_MODO[m] ?? 6); };
  window.addEventListener('bisturi-modo-vista', e => iconoVista(e.detail));
  const cerrarMenuVista = () => { menuVista.hidden = true; $('vRayosX').setAttribute('aria-expanded', 'false'); };
  $('vRayosX').setAttribute('aria-haspopup', 'menu');
  $('vRayosX').onclick = e => {
    e.stopPropagation();
    if (!menuVista.hidden) return cerrarMenuVista();
    const actual = api()?.modoVista || 'objeto';
    menuVista.querySelectorAll('[data-modo]').forEach(b => { b.classList.toggle('activo', b.dataset.modo === actual); b.setAttribute('aria-checked', b.dataset.modo === actual); });
    (document.fullscreenElement || document.body).append(menuVista);
    const r = $('vRayosX').getBoundingClientRect(), fs = document.fullscreenElement?.getBoundingClientRect() || { left: 0, top: 0 };
    menuVista.hidden = false;
    const ancho = menuVista.offsetWidth, alto = menuVista.offsetHeight;
    let x = r.right + 8, y = r.top;
    if (x + ancho > innerWidth - 8) { x = Math.max(8, r.left); y = r.bottom + 8; }
    y = Math.min(y, innerHeight - alto - 8);
    menuVista.style.left = (x - fs.left) + 'px'; menuVista.style.top = (y - fs.top) + 'px';
    $('vRayosX').setAttribute('aria-expanded', 'true');
  };
  menuVista.addEventListener('click', e => { const b = e.target.closest('[data-modo]'); if (!b) return; api()?.setModoVista(b.dataset.modo); cerrarMenuVista(); actualizarDatos?.(); });
  document.addEventListener('click', e => { if (!menuVista.hidden && !menuVista.contains(e.target)) cerrarMenuVista(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menuVista.hidden) cerrarMenuVista(); });
  $('vUnir').onclick = () => api()?.mergeVisiblePieces();
  // Deslizador de explosión: aparece con el botón Explosión y en las herramientas de corte.
  // «Demostración»: con la casilla marcada, el usuario separa las piezas con el deslizador.
  // Sin marcar, el deslizador no funciona y las piezas quedan juntas (en las herramientas de corte
  // tampoco se calcula la vista previa).
  let ultimoSeparar = 0.5, enHerramienta = false;
  const fijarSeparar = v => { $('separarRango').value = v; $('separarTxt').textContent = Math.round(v * 100) + ' %'; api()?.setExplode(v); };
  const pintarSeparador = (activa, demo) => { const on = activa && demo; $('separarRango').disabled = !on; $('separador').classList.toggle('apagado', !on); $('separarDemo').checked = !!demo; };
  $('separarDemo').addEventListener('change', e => {
    const on = e.target.checked;
    api()?.fijarDemo(on);
    if (!enHerramienta) { pintarSeparador(true, on); fijarSeparar(on ? ultimoSeparar : 0); }
  });
  $('separarRango').addEventListener('input', e => { if (!$('separarDemo').checked) return; ultimoSeparar = +e.target.value; fijarSeparar(ultimoSeparar); });
  window.addEventListener('bisturi-explosion', e => {
    const d = e.detail; enHerramienta = !!d.herramienta;
    $('separador').hidden = !(d.activa || enHerramienta);
    if (enHerramienta) { pintarSeparador(d.activa, d.demo); if (d.activa) { ultimoSeparar = d.cantidad; $('separarRango').value = d.cantidad; $('separarTxt').textContent = Math.round(d.cantidad * 100) + ' %'; } return; }
    if (!d.activa) return;
    const demo = !!api()?.demo; pintarSeparador(true, demo); fijarSeparar(demo ? ultimoSeparar : 0);
  });
  // En tablet vertical y teléfono el panel sale desde abajo y tapaba la barra «Separar piezas / Demostración»:
  // en ese caso la barra pasa al principio del panel abierto y vuelve a la vista al cerrarlo.
  const sep = $('separador'), sitioSep = document.createComment('separador');
  sep.before(sitioSep);
  function acomodarSeparador() {
    const enPanel = sep.classList.contains('en-panel');
    if (enPanel) { sitioSep.after(sep); sep.classList.remove('en-panel'); }
    const cajon = $('cajon');
    if (sep.hidden || cajon.hidden || !abierto) return;
    const a = sep.getBoundingClientRect(), b = cajon.getBoundingClientRect();
    const tapa = a.width && b.width && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    if (!tapa) return;
    const cuerpo = paneles[abierto]?.el; if (!cuerpo) return;
    cuerpo.prepend(sep); sep.classList.add('en-panel');
  }
  const acomodarLuego = () => requestAnimationFrame(acomodarSeparador);
  window.addEventListener('bisturi-explosion', acomodarLuego);
  window.addEventListener('cajon-abierto', acomodarLuego);
  window.addEventListener('cajon-cerrado', acomodarLuego);
  window.addEventListener('resize', acomodarLuego);
  // Bisturí y Bisturí libre en pantalla completa (allí no se ve el panel lateral).
  // Bisturí y Bisturí libre no abren panel: sus botones salen sobre la vista.
  document.querySelectorAll('[data-cajon-rapido]').forEach(b => b.onclick = () => {
    const clave = b.dataset.cajonRapido, activo = !b.classList.contains('activo');
    if (abierto) cerrar();
    window.dispatchEvent(new CustomEvent('cajon-abierto', { detail: activo ? clave : null }));
    document.querySelectorAll('[data-cajon-rapido]').forEach(x => x.classList.toggle('activo', activo && x.dataset.cajonRapido === clave));
  });
  window.addEventListener('cajon-abierto', e => { if (e.detail !== 'bisturi' && e.detail !== 'bisturiLibre' && e.detail !== 'bisturiMagnetico' && e.detail !== 'bisturiCurvo') document.querySelectorAll('[data-cajon-rapido].activo').forEach(x => x.classList.remove('activo')); });
  // En pantalla completa la barra de iconos pasa dentro de la vista (y vuelve a su sitio al salir).
  const barraV = document.querySelector('.barra-vertical'), sitioBarra = document.createComment('barra');
  barraV.before(sitioBarra);
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === $('escenaVista')) $('escenaVista').append(barraV);
    else { sitioBarra.after(barraV); document.querySelectorAll('[data-cajon-rapido].activo').forEach(x => x.classList.remove('activo')); }
    window.dispatchEvent(new Event('resize'));
  });

  // Nombre de la herramienta activa (esquina superior izquierda de la vista).
  const NOMBRES = [
    ['vCortePlano', 'Corte por plano'], ['vBisturi', 'Bisturí'], ['vBisturiLibre', 'Bisturí libre'],
    ['vBisturiMagnetico', 'Bisturí magnético'], ['vBisturiCurvo', 'Bisturí curvo'], ['hInteligente', 'Separación inteligente'],
    ['hSeleccion', 'Selección (Pincel)'], ['hEncastres', 'Encastres 3D'], ['vUnir', 'Unir piezas'],
    ['vExplosion', 'Explosión'], ['vMover', 'Mover'], ['vRotar', 'Girar'], ['vEscalar', 'Escalar'],
    ['vSeleccionar', 'Seleccionar']
  ];
  const etiqueta = document.createElement('div'); etiqueta.className = 'herr-activa'; etiqueta.hidden = true; etiqueta.setAttribute('role', 'status');
  const etiNombre = document.createElement('span'), etiSalir = document.createElement('button');
  etiSalir.type = 'button'; etiSalir.className = 'herr-salir'; etiSalir.textContent = '✕'; etiSalir.setAttribute('aria-label', 'Salir de la herramienta');
  etiqueta.append(etiNombre, etiSalir); $('escenaVista').append(etiqueta);
  let etiBoton = null;
  const actualizarEtiqueta = () => {
    const par = NOMBRES.find(([id]) => $(id)?.classList.contains('activo'));
    etiBoton = par ? $(par[0]) : null;
    etiqueta.hidden = !par;
    if (!par) return;
    if (etiNombre.textContent !== par[1]) {
      etiNombre.textContent = par[1];
      etiqueta.classList.remove('nueva'); void etiqueta.offsetWidth; etiqueta.classList.add('nueva');
    }
    // Solo las herramientas de corte y edición se pueden cerrar desde aquí.
    etiSalir.hidden = /^(vSeleccionar|vMover|vRotar|vEscalar)$/.test(par[0]);
  };
  etiSalir.onclick = () => {
    const chipBisturi = document.querySelector('.bisturi-chip:not([hidden])');
    if (chipBisturi) { chipBisturi.click(); return; }
    if (!etiBoton) return;
    if (etiBoton.dataset.cajonRapido) etiBoton.click();
    else if (etiBoton.dataset.cajon) { window.dispatchEvent(new CustomEvent('cajon-abierto', { detail: null })); cerrar(); }
    else etiBoton.click();
  };
  new MutationObserver(actualizarEtiqueta).observe(barraV, { subtree: true, attributes: true, attributeFilter: ['class'] });

  // Puntero de la herramienta: el icono de la herramienta activa acompaña al ratón o al dedo sobre la vista,
  // como los cursores de las aplicaciones de PC. Con ratón va pegado abajo a la derecha de la flecha;
  // con el dedo va arriba a la izquierda (para que el dedo no lo tape) y se desvanece al soltar.
  const vistaEl = $('escenaVista'), lienzo3d = () => vistaEl.querySelector('canvas');
  const puntero = document.createElement('div'); puntero.className = 'puntero-herr'; puntero.hidden = true; puntero.setAttribute('aria-hidden', 'true');
  vistaEl.append(puntero);
  let punteroDe = null, punteroT = 0;
  function iconoPuntero() {
    const b = etiBoton || $('vSeleccionar');
    if (b === punteroDe) return; punteroDe = b;
    const ico = b?.querySelector('.ico-img, .ico'); puntero.replaceChildren(ico ? ico.cloneNode(true) : '');
  }
  function moverPuntero(e) {
    if (!e.isPrimary || e.target !== lienzo3d()) { if (e.pointerType === 'mouse') puntero.hidden = true; return; }
    iconoPuntero();
    const r = vistaEl.getBoundingClientRect(), tactil = e.pointerType !== 'mouse';
    const x = e.clientX - r.left + (tactil ? -52 : 16), y = e.clientY - r.top + (tactil ? -64 : 18);
    puntero.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    puntero.classList.toggle('tactil', tactil); puntero.classList.remove('fuera'); puntero.hidden = false;
    clearTimeout(punteroT);
  }
  vistaEl.addEventListener('pointermove', moverPuntero, { capture: true, passive: true });
  vistaEl.addEventListener('pointerdown', moverPuntero, { capture: true, passive: true });
  const soltarPuntero = e => { if (e.pointerType === 'mouse') return; clearTimeout(punteroT); punteroT = setTimeout(() => puntero.classList.add('fuera'), 900); };
  vistaEl.addEventListener('pointerup', soltarPuntero, { capture: true, passive: true });
  vistaEl.addEventListener('pointercancel', soltarPuntero, { capture: true, passive: true });
  vistaEl.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') puntero.hidden = true; });
  new MutationObserver(() => { punteroDe = null; if (!puntero.hidden) iconoPuntero(); }).observe(barraV, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  // Indicadores de navegación (uno solo a la vez, según lo que hace la cámara; lo decide la vista 3D):
  //   girar → aros 3D (en la escena) · mover → mano cerrada · zoom → lupa con «+» o «−».
  const mano = document.createElement('div'); mano.className = 'mano-navegar'; mano.hidden = true; mano.setAttribute('aria-hidden', 'true');
  const LUPA = signo => `<svg class="lupa" viewBox="0 0 24 24"><path class="lupa-mango" d="M15.2 15.2l5.3 5.3"/><circle class="lupa-vidrio" cx="10" cy="10" r="6.6"/><path class="lupa-signo" d="M7 10h6${signo > 0 ? 'M10 7v6' : ''}"/></svg>`;
  mano.innerHTML = '<i class="mano-img"></i><span class="lupa-caja"></span>';
  vistaEl.append(mano);
  // Dónde va: junto al ratón, o entre los dedos.
  const dedosVista = new Map(); let pos = null, tactil = false, manoT = 0, manoCierra = 0, modoNav = null, signoNav = 0;
  function colocar() {
    if (!pos) return; const r = vistaEl.getBoundingClientRect();
    mano.style.transform = tactil ? `translate(${Math.round(pos.x - r.left - 28)}px, ${Math.round(pos.y - r.top - 28)}px)` : `translate(${Math.round(pos.x - r.left + 8)}px, ${Math.round(pos.y - r.top + 8)}px)`;
  }
  const seguirPos = e => {
    // Un gesto nuevo mientras la mano anterior se desvanece: se descarta la anterior.
    if (e.type === 'pointerdown' && congelada && e.target === lienzo3d() && dedosVista.size === 0) { clearTimeout(manoT); mano.hidden = true; mano.classList.remove('lupa-on', 'cerrada', 'fuera'); soltando = false; congelada = false; }
    if (e.pointerType === 'touch') {
      if (e.type === 'pointerdown' && e.target !== lienzo3d()) return;
      if (e.type !== 'pointerdown' && !dedosVista.has(e.pointerId)) return;
      dedosVista.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (congelada) return;
      const p = [...dedosVista.values()]; pos = { x: p.reduce((a, q) => a + q.x, 0) / p.length, y: p.reduce((a, q) => a + q.y, 0) / p.length }; tactil = true;
    } else { if (congelada) return; pos = { x: e.clientX, y: e.clientY }; tactil = false; }
    if (!mano.hidden) colocar();
  };
  vistaEl.addEventListener('pointerdown', seguirPos, { capture: true, passive: true });
  vistaEl.addEventListener('pointermove', seguirPos, { capture: true, passive: true });
  vistaEl.addEventListener('wheel', e => { pos = { x: e.clientX, y: e.clientY }; tactil = false; }, { capture: true, passive: true });
  // Se abre al soltar, se ve abierta un instante y se desvanece rápido.
  // Al soltar, la mano se queda quieta donde estaba (no salta al dedo que queda ni sigue al ratón).
  let soltando = false, congelada = false;
  function ocultarMano(espera) {
    clearTimeout(manoT); soltando = true;
    manoT = setTimeout(() => { mano.classList.add('fuera'); manoT = setTimeout(() => { mano.hidden = true; mano.classList.remove('lupa-on'); soltando = false; congelada = false; }, 160); }, espera);
  }
  // Al levantar el dedo o soltar el botón, la mano se abre en ese mismo momento.
  for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, e => {
    const eraGesto = dedosVista.has(e.pointerId) || e.pointerType === 'mouse';
    dedosVista.delete(e.pointerId);
    if (eraGesto && !mano.hidden && modoNav) congelada = true;
    if (modoNav === 'mover' && !mano.hidden && dedosVista.size < 2) { clearTimeout(manoCierra); mano.classList.remove('cerrada'); ocultarMano(250); }
  }, { capture: true, passive: true });
  window.addEventListener('bisturi-nav-modo', e => {
    const { modo, signo } = e.detail;
    if (modo === modoNav && signo === signoNav) return;
    const antes = modoNav; modoNav = modo; signoNav = signo; if (modo && congelada) { modoNav = antes; return; }   // tras soltar no se reactiva ni se mueve
    if (modo) { clearTimeout(manoT); soltando = false; }
    if (modo === 'mover' || modo === 'zoom') {
      mano.classList.toggle('lupa-on', modo === 'zoom'); mano.classList.toggle('raton', !tactil);
      if (modo === 'zoom') mano.querySelector('.lupa-caja').innerHTML = LUPA(signo);
      // Mano: aparece abierta y se cierra (agarra) un momento después.
      if (modo === 'mover' && antes !== 'mover') { mano.classList.remove('cerrada'); clearTimeout(manoCierra); manoCierra = setTimeout(() => { if (modoNav === 'mover') mano.classList.add('cerrada'); }, 300); }
      mano.classList.remove('fuera'); mano.hidden = false; colocar();
      puntero.classList.add('fuera');
    } else if (!mano.hidden) {
      // Al soltar, la mano se vuelve a abrir y luego se desvanece.
      clearTimeout(manoCierra);
      mano.classList.remove('cerrada');
      if (!soltando) ocultarMano(0);
    }
  });

  // Mientras se navega (girar / desplazar / acercar la vista) se ve el indicador 3D en la vista.
  let navegando = false, finNavegar = 0;
  window.addEventListener('bisturi-navegar', e => {
    clearTimeout(finNavegar);
    // El indicador de navegar es 3D y sale en la vista (centro de giro); el icono del puntero se aparta mientras.
    if (e.detail) { navegando = true; puntero.classList.add('navegando'); }
    else finNavegar = setTimeout(() => { navegando = false; puntero.classList.remove('navegando'); }, 250);
  });
  actualizarEtiqueta();

  // Acciones sobre la vista.
  $('vAtras').onclick = () => $('undoBtn').click();
  $('vRehacer').onclick = () => $('redoBtn').click();
  $('vCompleta').onclick = () => {
    const el = $('escenaVista');
    try { document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.(); } catch (_) {}
  };
  document.querySelectorAll('[data-vista]').forEach(b => b.onclick = () => {
    api()?.setView(b.dataset.vista);
    document.querySelectorAll('[data-vista]').forEach(x => x.classList.toggle('activa', x === b));
  });

  // Acciones del panel de piezas.
  $('aQuitarEncastre').onclick = () => api()?.quitarEncastre();
  $('aExportar').onclick = () => abrir('exportar');
  window.addEventListener('bisturi-menu-pieza', () => abrir('piezas'));


  // Aviso flotante sobre la vista 3D: solo para errores.
  const aviso = document.createElement('div'); aviso.id = 'aviso'; aviso.className = 'aviso'; aviso.hidden = true; aviso.setAttribute('role', 'status');
  const avisoTexto = document.createElement('span'), avisoCerrar = document.createElement('button');
  avisoCerrar.type = 'button'; avisoCerrar.className = 'aviso-cerrar'; avisoCerrar.setAttribute('aria-label', 'Cerrar aviso'); avisoCerrar.textContent = '×';
  aviso.append(avisoTexto, avisoCerrar); $('escenaVista').append(aviso);
  let avisoT = 0; avisoCerrar.onclick = () => { aviso.hidden = true; };
  // Solo se muestran los errores (algo que no se pudo hacer); los mensajes informativos no aparecen.
  new MutationObserver(() => {
    const t = $('status').textContent.trim();
    // Mientras se calcula la Demostración, la barra lo indica (puede tardar unos segundos).
    $('separador').classList.toggle('calculando', /^Calculando la vista previa/.test(t));
    // También se avisa cuando la Demostración no puede mostrar nada (para que no parezca que no funciona).
    const malo = /no se aplic|no se pudo|error|fall[óo]|no cabe|demasiado grande|rechazado|no se separaría|primero (dibuja|pon)|no atraviesa|se cruza/i.test(t);
    if (!t || !malo) { aviso.hidden = true; return; }
    avisoTexto.textContent = t; aviso.classList.toggle('malo', malo); aviso.hidden = false;
    clearTimeout(avisoT); avisoT = setTimeout(() => { aviso.hidden = true; }, malo ? 12000 : 7000);
  }).observe($('status'), { childList: true, characterData: true, subtree: true });

  setInterval(actualizarDatos, 400);
  (function bucle() { dibujarEjes(); requestAnimationFrame(bucle); })();
  actualizarDatos();
}

montar();
