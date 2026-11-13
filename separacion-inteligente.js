// Separación inteligente.
// 1) Propone las piezas: cada zona conectada de un mismo color y cada parte suelta es una pieza.
//    (No reconoce qué es una cabeza o un brazo: se guía por colores y partes sueltas.)
// 2) Las muestra en colores distintos y deja editarlas con el pincel: pieza activa, borrador,
//    «Nueva pieza».
// 3) «Separar» corta exactamente por el borde entre colores y deja piezas cerradas
//    («Objeto 1», «Objeto 2»…); «Cancelar» deja el modelo como estaba.
import { soldar, topologia, componentes, orientar, extraer, centroides } from './nucleo-malla.js?v=2.10';
import { pincel } from './nucleo-seleccion.js?v=2.10';
import { cortarPorSeleccion } from './nucleo-corte.js?v=2.10';

const PALETA = [0xff6b6b, 0x4ecdc4, 0xffd166, 0x9b5de5, 0x06d6a0, 0xf78c6b, 0x118ab2, 0xef476f, 0xa7c957, 0xffa3e1, 0x8d99ae, 0xe9c46a, 0x00bbf9, 0xc77dff, 0x90be6d, 0xff9f1c];
const colorDe = i => PALETA[i % PALETA.length];

// Propuesta automática de etiquetas por cara (malla soldada).
export function proponer(m, topo, claves, { maxPiezas = 16 } = {}) {
  const nf = m.tri.length / 3, et = new Int32Array(nf).fill(-1);
  let n = 0;
  for (let s = 0; s < nf; s++) {
    if (et[s] >= 0) continue;
    et[s] = n; const pila = [s];
    while (pila.length) {
      const f = pila.pop();
      for (let k = 0; k < 3; k++) { const g = topo.gemela[3 * f + k]; if (g < 0) continue; const F = (g / 3) | 0; if (et[F] < 0 && claves[F] === claves[f]) { et[F] = n; pila.push(F); } }
    }
    n++;
  }
  // Área por etiqueta.
  const P = m.pos, T = m.tri, area = new Float64Array(nf);
  for (let f = 0; f < nf; f++) {
    const a = 3 * T[3 * f], b = 3 * T[3 * f + 1], c = 3 * T[3 * f + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    area[f] = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  const fusionar = () => {
    const A = new Float64Array(n); let total = 0; for (let f = 0; f < nf; f++) { A[et[f]] += area[f]; total += area[f]; }
    // Vecinos por aristas compartidas.
    const vec = Array.from({ length: n }, () => new Map());
    for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) { const g = topo.gemela[3 * f + k]; if (g < 0) continue; const F = (g / 3) | 0, a = et[f], b = et[F]; if (a !== b) vec[a].set(b, (vec[a].get(b) || 0) + 1); }
    const vivos = [...Array(n).keys()].filter(i => A[i] > 0).sort((a, b) => A[a] - A[b]);
    const destino = new Int32Array(n).map((_, i) => i);
    let quedan = vivos.length;
    for (const i of vivos) {
      const pequena = A[i] < total * 0.004;
      if (!pequena && quedan <= maxPiezas) break;
      let mejor = -1, cuenta = 0; for (const [j, c] of vec[i]) if (c > cuenta && destino[j] === j) { mejor = j; cuenta = c; }
      if (mejor < 0) continue; // parte suelta sin vecinos: se queda como pieza
      destino[i] = mejor; quedan--;
      for (const [j, c] of vec[i]) if (j !== mejor) { vec[mejor].set(j, (vec[mejor].get(j) || 0) + c); vec[j].set(mejor, (vec[j].get(mejor) || 0) + c); }
      A[mejor] += A[i];
    }
    const raiz = i => { while (destino[i] !== i) i = destino[i]; return i; };
    for (let f = 0; f < nf; f++) et[f] = raiz(et[f]);
  };
  fusionar();
  // Partes sueltas que siguen siendo demasiadas: se juntan las más pequeñas con la más grande.
  const renumerar = () => {
    const A = new Map(); for (let f = 0; f < nf; f++) A.set(et[f], (A.get(et[f]) || 0) + area[f]);
    const orden = [...A.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]), nuevo = new Map();
    orden.forEach((e, i) => nuevo.set(e, Math.min(i, maxPiezas - 1)));
    for (let f = 0; f < nf; f++) et[f] = nuevo.get(et[f]);
    return Math.min(orden.length, maxPiezas);
  };
  const total = renumerar();
  return { etiquetas: et, total, area };
}

// Separación exacta: devuelve [{etiqueta, mallas:[{pos,tri,color}]}].
export async function separar(m, etiquetas, mat, { progreso = () => {} } = {}) {
  const nf = m.tri.length / 3, col = new Int16Array(nf);
  for (let f = 0; f < nf; f++) col[f] = etiquetas[f] * 64 + (mat[f] & 63);
  const usadas = [...new Set(etiquetas)];
  const area = new Map(); for (let f = 0; f < nf; f++) area.set(etiquetas[f], (area.get(etiquetas[f]) || 0) + 1);
  usadas.sort((a, b) => area.get(a) - area.get(b)); // la más grande queda como resto
  const ultima = usadas.pop();
  // Cada parte suelta por separado: si es de una sola pieza no hace falta cortarla.
  const comp = componentes(m, topologia(m)), grupos = Array.from({ length: comp.n }, () => []);
  for (let f = 0; f < nf; f++) grupos[comp.id[f]].push(f);
  let cola = grupos.map(caras => ({ malla: extraer(m.pos, m.tri, caras), col: Int16Array.from(caras, f => col[f]) }));
  const salida = new Map(); const meter = (e, x) => { let l = salida.get(e); if (!l) salida.set(e, l = []); l.push(x); };
  let paso = 0;
  for (const L of usadas) {
    paso++; const sig = [];
    for (const p of cola) {
      const mask = Uint8Array.from(p.col, c => ((c / 64) | 0) === L ? 1 : 0), n = mask.reduce((s, x) => s + x, 0);
      if (!n) { sig.push(p); continue; }
      if (n === mask.length) { meter(L, p); continue; }
      progreso(`Separando la pieza ${paso} de ${usadas.length}…`);
      await new Promise(r => setTimeout(r, 0));
      const r = cortarPorSeleccion(p.malla, mask, { color: p.col });
      for (const q of r.piezas) (q.lado === 'seleccion' ? meter(L, { malla: q.malla, col: q.color }) : sig.push({ malla: q.malla, col: q.color }));
    }
    cola = sig;
  }
  for (const p of cola) meter(ultima, p);
  return [...salida.entries()].map(([etiqueta, mallas]) => ({ etiqueta, mallas }));
}

export function setupSeparacionInteligente(ctx) {
  const { THREE, scene, renderer, camera, orbit, status } = ctx;
  const $ = id => document.getElementById(id);
  const lienzo = renderer.domElement, caja = lienzo.parentElement;
  let estado = null; // {target, m, topo, cent, origen, inv, etiquetas, total, activa, vista, ...}

  // ---------- barra inferior ----------
  const barra = document.createElement('div');
  barra.className = 'si-barra'; barra.hidden = true;
  barra.innerHTML = `<div class="si-fila si-arriba"><div class="si-piezas" role="group" aria-label="Pieza activa"></div>
      <span class="si-fin"><button type="button" class="si-cancelar secondary">Cancelar</button>
      <button type="button" class="si-separar">Separar</button></span></div>
    <div class="si-fila">
      <button type="button" class="si-borrador" title="Borrador: devuelve las caras a Objeto 1">Borrador</button>
      <button type="button" class="si-nueva">+ Nueva pieza</button>
      <label class="si-tam">Pincel <input type="range" min="0.5" max="15" step="0.5" value="4"></label>
      <button type="button" class="si-girar" title="Mientras está activo, arrastrar gira la vista en vez de pintar">Girar vista</button>
    </div>`;
  caja.append(barra);
  ['pointerdown', 'pointerup', 'pointermove', 'wheel'].forEach(t => barra.addEventListener(t, e => e.stopPropagation()));
  const q = s => barra.querySelector(s);

  function pintarChips() {
    const host = q('.si-piezas'); host.replaceChildren();
    const usadas = new Set(estado.etiquetas);
    for (let i = 0; i < estado.total; i++) {
      if (!usadas.has(i) && i !== estado.activa) continue;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'si-chip' + (i === estado.activa ? ' activo' : '');
      const sw = document.createElement('span'); sw.className = 'si-muestra'; sw.style.background = '#' + colorDe(i).toString(16).padStart(6, '0');
      b.append(sw, `Objeto ${i + 1}`); b.onclick = () => { estado.activa = i; pintarChips(); };
      host.append(b);
    }
    q('.si-borrador').classList.toggle('activo', estado.activa === -1);
  }
  q('.si-borrador').onclick = () => { if (!estado) return; estado.activa = -1; pintarChips(); };
  q('.si-nueva').onclick = () => { if (!estado) return; estado.activa = estado.total++; pintarChips(); status(`Objeto ${estado.activa + 1}: pinta sobre el modelo las zonas que van en esta pieza.`); };
  q('.si-girar').onclick = () => { if (!estado) return; estado.girar = !estado.girar; q('.si-girar').classList.toggle('activo', estado.girar); };
  q('.si-cancelar').onclick = () => { salir(); status('Separación inteligente cancelada; el modelo no cambió.'); };
  q('.si-separar').onclick = () => ejecutar();

  // ---------- vista previa coloreada ----------
  function crearVista() {
    const { m } = estado, nf = m.tri.length / 3, pos = new Float32Array(nf * 9), colA = new Float32Array(nf * 9);
    for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) { const v = m.tri[3 * f + k]; pos.set(m.pos.subarray(3 * v, 3 * v + 3), 9 * f + 3 * k); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colA, 3)); g.computeVertexNormals();
    const vista = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, metalness: 0, side: THREE.DoubleSide }));
    vista.raycast = () => {}; vista.renderOrder = 2;
    scene.add(vista); estado.vista = vista;
    colorear(null);
  }
  const tmp = new THREE.Color();
  function colorear(caras) {
    const a = estado.vista.geometry.getAttribute('color'), arr = a.array, lista = caras || estado.etiquetas.keys();
    for (const f of lista) { const e = estado.etiquetas[f]; tmp.setHex(colorDe(e)).convertSRGBToLinear(); for (let k = 0; k < 3; k++) { arr[9 * f + 3 * k] = tmp.r; arr[9 * f + 3 * k + 1] = tmp.g; arr[9 * f + 3 * k + 2] = tmp.b; } }
    a.needsUpdate = true;
  }

  // ---------- pincel ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function golpe(e) {
    const r = lienzo.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObject(estado.target, false)[0];
    if (!h || h.faceIndex == null) return null;
    const f = estado.inv[h.faceIndex]; return f >= 0 ? { f, punto: h.point } : null;
  }
  function pintar(e) {
    const g = golpe(e); if (!g) return;
    const valor = estado.activa === -1 ? 0 : estado.activa;
    const radio = estado.diag * Number(q('.si-tam input').value) / 100;
    const cambiadas = pincel(estado.topo, estado.cent, estado.etiquetas, g.f, g.punto.toArray(), radio, valor);
    if (cambiadas.length) { colorear(cambiadas); estado.cambios = true; }
  }
  let trazo = null;
  caja.addEventListener('pointerdown', e => {
    if (!estado || e.target !== lienzo || estado.girar || e.button !== 0 || !e.isPrimary) return;
    e.stopPropagation(); e.preventDefault();
    trazo = e.pointerId; try { lienzo.setPointerCapture(e.pointerId); } catch {}
    orbit.enabled = false; pintar(e);
  }, { capture: true });
  caja.addEventListener('pointermove', e => { if (!estado || trazo !== e.pointerId) return; e.stopPropagation(); pintar(e); }, { capture: true });
  const fin = e => { if (trazo !== e.pointerId) return; trazo = null; orbit.enabled = true; try { lienzo.releasePointerCapture(e.pointerId); } catch {} if (estado) { e.stopPropagation(); pintarChips(); } };
  caja.addEventListener('pointerup', fin, { capture: true });
  caja.addEventListener('pointercancel', fin, { capture: true });

  // ---------- ciclo ----------
  function iniciar() {
    if (estado) { salir(); return; }
    if (ctx.busy()) return status('Vuelve a la vista ensamblada y desactiva Rayos X para usar la Separación inteligente.');
    const visibles = ctx.meshes.filter(x => x.visible && !x.userData.bisturiAlignmentPin);
    const target = ctx.selected && ctx.meshes.includes(ctx.selected) ? ctx.selected : visibles.length === 1 ? visibles[0] : null;
    if (!target) return status(ctx.meshes.length ? 'Selecciona la pieza que quieres separar.' : 'Abre un modelo para usar la Separación inteligente.');
    window.dispatchEvent(new CustomEvent('cajon-abierto', { detail: null }));
    target.updateWorldMatrix(true, false);
    const sopa = ctx.soupInFrame(target, target.matrixWorld), s = soldar(sopa, 1e-6), m = orientar(s.malla).malla, topo = topologia(m);
    const nT = sopa.length / 9, inv = new Int32Array(nT).fill(-1); s.origen.forEach((o, i) => { inv[o] = i; });
    const claves0 = ctx.faceColorKeys(target.geometry), mats0 = ctx.faceMaterials(target.geometry);
    const nf = m.tri.length / 3, claves = new Int32Array(nf), mat = new Int16Array(nf);
    for (let f = 0; f < nf; f++) { claves[f] = claves0[s.origen[f]]; mat[f] = mats0[s.origen[f]] ?? 0; }
    const p = proponer(m, topo, claves);
    const b = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(m.pos, 3));
    estado = { target, m, topo, cent: centroides(m), inv, mat, etiquetas: p.etiquetas, total: Math.max(p.total, 1), activa: p.total > 1 ? 1 : 0, girar: false, diag: b.getSize(new THREE.Vector3()).length(), geo: target.geometry };
    target.visible = false; ctx.onActivo?.(true);
    crearVista(); pintarChips();
    barra.hidden = false; $('hInteligente')?.classList.add('activo');
    status(p.total > 1
      ? `Se proponen ${p.total} piezas (por colores y partes sueltas). Elige una pieza y pinta para corregir; luego pulsa «Separar».`
      : 'No se encontraron colores ni partes sueltas. Pulsa «+ Nueva pieza» y pinta la zona que quieres separar; luego «Separar».');
  }
  function salir() {
    if (!estado) return;
    const { vista, target } = estado;
    scene.remove(vista); vista.geometry.dispose(); vista.material.dispose();
    if (ctx.meshes.includes(target)) target.visible = true;
    estado = null; trazo = null; orbit.enabled = true;
    barra.hidden = true; $('hInteligente')?.classList.remove('activo'); ctx.onActivo?.(false);
  }
  async function ejecutar() {
    if (!estado || estado.ocupado) return;
    const usadas = new Set(estado.etiquetas);
    if (usadas.size < 2) return status('Solo hay una pieza: pulsa «+ Nueva pieza» y pinta la zona que quieres separar.');
    if (!ctx.meshes.includes(estado.target) || estado.target.geometry !== estado.geo) { salir(); return status('La pieza cambió; vuelve a pulsar «Separación inteligente».'); }
    estado.ocupado = true; barra.querySelectorAll('button').forEach(x => x.disabled = true);
    try {
      const partes = await separar(estado.m, estado.etiquetas, estado.mat, { progreso: status });
      partes.sort((a, b) => a.etiqueta - b.etiqueta);
      const target = estado.target; salir();
      ctx.aplicar(target, partes);
      status(`Separación hecha: ${partes.length} pieza(s), «Objeto 1» a «Objeto ${partes.length}». Toca el nombre de una pieza en la lista para cambiarlo.`);
    } catch (err) {
      console.error(err);
      if (estado) { estado.ocupado = false; barra.querySelectorAll('button').forEach(x => x.disabled = false); }
      status('No se pudo separar: ' + err.message + (/cerrado/.test(err.message) ? ' Usa «Reparar malla» y vuelve a intentarlo.' : ''));
      if (/cerrado/.test(err.message) && estado) { const t = estado.target; salir(); ctx.revisar?.([t]); }
    }
  }
  $('hInteligente')?.addEventListener('click', iniciar);
  window.addEventListener('cajon-abierto', e => { if (e.detail) salir(); });
  const api = { iniciar, salir, get activo() { return !!estado; }, get estado() { return estado; }, separarAhora: ejecutar };
  window.bisturiInteligente = api;
  return api;
}
