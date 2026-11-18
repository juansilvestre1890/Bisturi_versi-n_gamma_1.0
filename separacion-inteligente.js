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
// Corte con profundidad fija (tapón): la zona marcada se separa como una pieza de grosor D.
// La cara interior es la misma zona metida D mm hacia dentro (según la normal) y unas paredes la
// unen con el borde. El resto recibe exactamente la cara interior y las paredes al revés, así las
// dos piezas encajan y quedan cerradas.
export function cortarConProfundidad(malla, mask, D, col, { comprobar = null, nombre = 'la pieza' } = {}) {
  const P = malla.pos, T = malla.tri, nf = T.length / 3, nV = P.length / 3;
  const vn = new Float64Array(nV * 3);
  for (let f = 0; f < nf; f++) {
    const a = T[3 * f], b = T[3 * f + 1], c = T[3 * f + 2];
    const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { vn[3 * v] += nx; vn[3 * v + 1] += ny; vn[3 * v + 2] += nz; }
  }
  for (let v = 0; v < nV; v++) { const l = Math.hypot(vn[3 * v], vn[3 * v + 1], vn[3 * v + 2]) || 1; vn[3 * v] /= l; vn[3 * v + 1] /= l; vn[3 * v + 2] /= l; }
  // Vértices de la zona y su copia metida hacia dentro.
  const nuevo = new Int32Array(nV).fill(-1); let n2 = nV;
  for (let f = 0; f < nf; f++) if (mask[f]) for (let k = 0; k < 3; k++) { const v = T[3 * f + k]; if (nuevo[v] < 0) nuevo[v] = n2++; }
  const pos = new Float64Array(n2 * 3); pos.set(P);
  const muestras = [];
  for (let v = 0; v < nV; v++) if (nuevo[v] >= 0) {
    const w = nuevo[v]; pos[3 * w] = P[3 * v] - D * vn[3 * v]; pos[3 * w + 1] = P[3 * v + 1] - D * vn[3 * v + 1]; pos[3 * w + 2] = P[3 * v + 2] - D * vn[3 * v + 2];
    muestras.push(v);
  }
  // La pieza no puede ser más gruesa que la figura en esa zona.
  if (comprobar) {
    const paso = Math.max(1, Math.floor(muestras.length / 600));
    for (let i = 0; i < muestras.length; i += paso) { const v = muestras[i]; if (!comprobar([P[3 * v], P[3 * v + 1], P[3 * v + 2]], [vn[3 * v], vn[3 * v + 1], vn[3 * v + 2]], D)) throw new Error(`La profundidad de ${nombre} (${D} mm) atraviesa la figura: bájala.`); }
  }
  // Aristas del borde de la zona (orientadas como en la cara de la zona).
  const clave = (a, b) => a * n2 + b, aristas = new Set();
  for (let f = 0; f < nf; f++) if (mask[f]) for (let k = 0; k < 3; k++) aristas.add(clave(T[3 * f + k], T[3 * f + (k + 1) % 3]));
  const pieza = [], resto = [], colP = [], colR = [];
  let cP = -1, cR = -1; { const cuenta = [new Map(), new Map()]; for (let f = 0; f < nf; f++) { const m = cuenta[mask[f] ? 0 : 1]; m.set(col[f], (m.get(col[f]) || 0) + 1); } cP = [...cuenta[0]].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0; cR = [...cuenta[1]].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0; }
  for (let f = 0; f < nf; f++) {
    const a = T[3 * f], b = T[3 * f + 1], c = T[3 * f + 2];
    if (!mask[f]) { resto.push(a, b, c); colR.push(col[f]); continue; }
    pieza.push(a, b, c); colP.push(col[f]);
    const A = nuevo[a], B = nuevo[b], C = nuevo[c];
    pieza.push(C, B, A); colP.push(cP);   // cara interior de la pieza (hacia dentro)
    resto.push(A, B, C); colR.push(cR);   // misma cara para el resto (hacia fuera del resto)
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      if (aristas.has(clave(y, x))) continue; // arista interior de la zona
      const X = nuevo[x], Y = nuevo[y];
      pieza.push(y, x, X, y, X, Y); colP.push(cP, cP);
      resto.push(X, x, y, Y, X, y); colR.push(cR, cR);
    }
  }
  const compactar = tri => { const mapa = new Int32Array(n2).fill(-1), lista = []; const t = Uint32Array.from(tri, v => { if (mapa[v] < 0) { mapa[v] = lista.length; lista.push(v); } return mapa[v]; }); const p = new Float32Array(lista.length * 3); lista.forEach((v, i) => { p[3 * i] = pos[3 * v]; p[3 * i + 1] = pos[3 * v + 1]; p[3 * i + 2] = pos[3 * v + 2]; }); return { pos: p, tri: t }; };
  return { piezas: [{ lado: 'seleccion', malla: compactar(pieza), color: Int16Array.from(colP) }, { lado: 'resto', malla: compactar(resto), color: Int16Array.from(colR) }] };
}

// Grosor aproximado del corte automático de una zona: lo que se aparta su superficie del plano
// de su borde (para mostrarlo al usuario).
export function profundidadAuto(m, mask) {
  const P = m.pos, T = m.tri, nf = T.length / 3, borde = new Set(), zona = new Set(), aristas = new Set();
  for (let f = 0; f < nf; f++) if (mask[f]) for (let k = 0; k < 3; k++) aristas.add(T[3 * f + k] + ':' + T[3 * f + (k + 1) % 3]);
  let nx = 0, ny = 0, nz = 0;
  for (let f = 0; f < nf; f++) if (mask[f]) for (let k = 0; k < 3; k++) {
    const a = T[3 * f + k], b = T[3 * f + (k + 1) % 3]; zona.add(a);
    if (!aristas.has(b + ':' + a)) { borde.add(a); borde.add(b); }
    if (k === 0) { const c = T[3 * f + 2]; const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2]; nx += uy * vz - uz * vy; ny += uz * vx - ux * vz; nz += ux * vy - uy * vx; }
  }
  if (!borde.size) return null;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  let cx = 0, cy = 0, cz = 0; for (const v of borde) { cx += P[3 * v]; cy += P[3 * v + 1]; cz += P[3 * v + 2]; } cx /= borde.size; cy /= borde.size; cz /= borde.size;
  let d = 0; for (const v of zona) d = Math.max(d, (P[3 * v] - cx) * nx + (P[3 * v + 1] - cy) * ny + (P[3 * v + 2] - cz) * nz);
  return d;
}

export async function separar(m, etiquetas, mat, { progreso = () => {}, profundidades = null, comprobar = null } = {}) {
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
      const D = profundidades?.get(L);
      const r = D > 0 ? cortarConProfundidad(p.malla, mask, D, p.col, { comprobar, nombre: `«Objeto ${L + 1}»` }) : cortarPorSeleccion(p.malla, mask, { color: p.col });
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
      <button type="button" class="si-agregar" title="Pinta sobre el modelo para agregar zonas al color elegido">Agregar</button>
      <button type="button" class="si-quitar" title="Pinta sobre el modelo para quitar zonas (vuelven a «Objeto 1»)">Quitar</button>
      <button type="button" class="si-nueva">+ Nueva pieza</button>
      <label class="si-tam">Pincel <input type="range" min="0.5" max="15" step="0.5" value="4"></label>
    </div>`;
  caja.append(barra);
  ['pointerdown', 'pointerup', 'pointermove', 'wheel'].forEach(t => barra.addEventListener(t, e => e.stopPropagation()));
  const q = s => barra.querySelector(s);

  // ---------- profundidad de la pieza elegida (barra arriba de la vista) ----------
  const barraProf = document.createElement('div');
  barraProf.className = 'si-prof'; barraProf.hidden = true;
  barraProf.innerHTML = `<span class="si-muestra"></span><span class="si-prof-titulo"></span>
    <label class="si-prof-campo" title="Profundidad de la separación"><input type="number" min="0.2" step="0.5" inputmode="decimal" aria-label="Profundidad en mm"> mm</label>
    <button type="button" class="secondary si-prof-auto" title="Volver a la profundidad automática">Auto</button>`;
  caja.append(barraProf);
  ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'keydown'].forEach(t => barraProf.addEventListener(t, e => e.stopPropagation()));
  const qp = s => barraProf.querySelector(s);
  function opcionesCorte() {
    const t0 = estado?.target, ray = new THREE.Raycaster(), o = new THREE.Vector3(), d = new THREE.Vector3(), eps = (estado?.diag || 1) * 1e-4;
    // Para el rayo hacia dentro hacen falta las dos caras de los triángulos.
    let t = null; if (t0) { t0.updateWorldMatrix(true, false); t = new THREE.Mesh(t0.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); t.matrixWorld.copy(t0.matrixWorld); t.matrixAutoUpdate = false; }
    return {
      profundidades: estado?.prof,
      // ¿Cabe la profundidad? Un rayo hacia dentro no debe salir por el otro lado de la figura.
      comprobar: t ? (p, n, D) => { o.set(p[0] - n[0] * eps, p[1] - n[1] * eps, p[2] - n[2] * eps); d.set(-n[0], -n[1], -n[2]); ray.set(o, d); ray.near = 0; ray.far = D * 1.02; return !ray.intersectObject(t, false).length; } : null
    };
  }
  // Tipo de pieza: la base (la más grande) se queda con el resto; una parte suelta se separa entera.
  function tipoDe(i) {
    const cuenta = new Map(); for (const e of estado.etiquetas) cuenta.set(e, (cuenta.get(e) || 0) + 1);
    if (!cuenta.has(i)) return 'vacia';
    const mayor = [...cuenta].sort((a, b) => b[1] - a[1])[0][0]; if (mayor === i) return 'base';
    if (!estado.comp) estado.comp = componentes(estado.m, estado.topo);
    const id = estado.comp.id, mezcla = new Set();
    for (let f = 0; f < id.length; f++) if (estado.etiquetas[f] === i) mezcla.add(id[f]);
    for (let f = 0; f < id.length; f++) if (mezcla.has(id[f]) && estado.etiquetas[f] !== i) return 'zona';
    return 'entera';
  }
  function mostrarProfundidad() {
    const i = estado?.activa;
    const tipo = estado && i !== null && i >= 0 ? tipoDe(i) : null;
    // Solo las zonas pintadas sobre la figura tienen profundidad; la base y las partes sueltas no.
    if (tipo !== 'zona') { barraProf.hidden = true; return; }
    barraProf.hidden = false;
    qp('.si-muestra').style.background = '#' + colorDe(i).toString(16).padStart(6, '0');
    const D = estado.prof.get(i), editable = tipo === 'zona', campo = qp('input');
    qp('.si-prof-titulo').textContent = 'Profundidad';
    qp('.si-prof-campo').hidden = !editable;
    qp('.si-prof-auto').hidden = !editable || !(D > 0);
    if (editable) {
      campo.value = D > 0 ? D : '';
      if (!(D > 0)) { const a = profundidadAuto(estado.m, Uint8Array.from(estado.etiquetas, e => e === i ? 1 : 0)); campo.placeholder = a != null ? a.toFixed(1) : 'Auto'; }
    }
  }
  qp('input').addEventListener('change', e => {
    if (!estado || estado.activa === null || estado.activa < 0) return;
    const v = Number(String(e.target.value).replace(',', '.'));
    if (v > 0) estado.prof.set(estado.activa, Math.round(v * 100) / 100); else estado.prof.delete(estado.activa);
    estado.version = (estado.version || 0) + 1; mostrarProfundidad(); demoAlDia();
  });
  // Mientras se escribe (o con las flechas) la demostración se actualiza sola, sin esperar a salir del campo.
  qp('input').addEventListener('input', e => {
    if (!estado || estado.activa === null || estado.activa < 0) return;
    const v = Number(String(e.target.value).replace(',', '.'));
    if (!(v > 0) && e.target.value !== '') return;
    const antes = estado.prof.get(estado.activa);
    if (v > 0) estado.prof.set(estado.activa, Math.round(v * 100) / 100); else estado.prof.delete(estado.activa);
    if (estado.prof.get(estado.activa) !== antes) { estado.version = (estado.version || 0) + 1; demoAlDia(); }
  });
  qp('.si-prof-auto').onclick = () => { if (!estado || estado.activa === null) return; estado.prof.delete(estado.activa); estado.version = (estado.version || 0) + 1; mostrarProfundidad(); demoAlDia(); };
  // Demostración en tiempo real: al cambiar un dato se calculan las piezas nuevas y luego se cambian,
  // así la vista previa no desaparece mientras se calcula.
  let esperaDemo = null, calculandoDemo = false, otraVez = false;
  function demoAlDia() {
    if (!estado || !ctx.enVista) return;
    clearTimeout(esperaDemo); esperaDemo = setTimeout(recalcularDemo, 250);
  }
  async function recalcularDemo() {
    if (!estado || !ctx.enVista) return;
    if (calculandoDemo) { otraVez = true; return; }
    calculandoDemo = true;
    try {
      const version = estado.version;
      if (estado.cachePartes?.version !== version) {
        let partes = null;
        try { partes = await separar(estado.m, estado.etiquetas, estado.mat, opcionesCorte()); } catch (err) { console.warn('Vista previa:', err.message); }
        if (!estado || estado.version !== version) return;
        if (partes) estado.cachePartes = { version, partes };
      }
      if (ctx.enVista) await ctx.rehacerVista();
    } finally {
      calculandoDemo = false;
      if (otraVez) { otraVez = false; demoAlDia(); }
    }
  }

  function pintarChips() {
    if (!estado?.herr) window.bisturiPincel?.ocultar();
    const host = q('.si-piezas'); host.replaceChildren();
    const usadas = new Set(estado.etiquetas);
    for (let i = 0; i < estado.total; i++) {
      if (!usadas.has(i) && i !== estado.activa) continue;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'si-chip' + (i === estado.activa ? ' activo' : '');
      const sw = document.createElement('span'); sw.className = 'si-muestra'; sw.style.background = '#' + colorDe(i).toString(16).padStart(6, '0');
      b.append(sw, `Objeto ${i + 1}`); b.onclick = () => elegir(i);
      host.append(b);
    }
    q('.si-agregar').classList.toggle('activo', estado.herr === 'agregar');
    q('.si-quitar').classList.toggle('activo', estado.herr === 'quitar');
    q('.si-agregar').disabled = estado.activa === null;
    q('.si-quitar').disabled = estado.activa === 0;
    modoPintar(!!estado.herr);
    if (estado.vista && estado.resalte !== estado.activa) { estado.resalte = estado.activa; colorear(null); }
    mostrarProfundidad();
  }
  // Tocar otra vez la pieza activa (o el borrador) la deselecciona: sin nada elegido, arrastrar gira la vista.
  function elegir(i) {
    if (!estado) return;
    // Al elegir otro color el pincel queda apagado: «Agregar» o «Quitar» se activan a mano.
    estado.activa = estado.activa === i ? null : i; estado.herr = null; pintarChips();
    // Con el pincel apagado la demostración sigue a la vista (si está marcada): se puede ajustar
    // la profundidad del color elegido y ver el cambio al momento.
    ctx.abrirVista();
    if (estado.activa === null) return;
    status(`Objeto ${estado.activa + 1}: pulsa «Agregar» para pintar zonas en esta pieza o «Quitar» para sacarlas.`);
  }
  function herramienta(h) {
    if (!estado) return;
    estado.herr = estado.herr === h ? null : h;
    if (estado.herr) ctx.cerrarVista(false); else ctx.abrirVista();
    pintarChips();
    if (!estado.herr) return;
    const L = estado.activa;
    status(h === 'agregar' ? `Agregar: lo que pintes pasa a «Objeto ${L + 1}». Dos dedos (o botón derecho) giran la vista.`
      : L === null ? 'Quitar: lo que pintes vuelve a «Objeto 1».' : `Quitar: lo que pintes de «Objeto ${L + 1}» vuelve a «Objeto 1».`);
  }
  q('.si-agregar').onclick = () => herramienta('agregar');
  q('.si-quitar').onclick = () => herramienta('quitar');
  q('.si-nueva').onclick = () => { if (!estado) return; estado.activa = estado.total++; estado.herr = null; pintarChips(); status(`Objeto ${estado.activa + 1}: pulsa «Agregar» y pinta sobre el modelo las zonas que van en esta pieza.`); };
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
  // ---------- modos de «Vista» (Objeto, Rayos X, Malla) sobre el objeto coloreado ----------
  const matAristas = new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: .55, depthWrite: false });
  const matVertices = new THREE.PointsMaterial({ color: 0xffd166, size: 3.5, sizeAttenuation: false, depthWrite: false });
  function mallasVisibles() { return estado ? [estado.vista, ...(partesVista || []).map(p => p.malla)] : []; }
  function quitarMalla(malla) {
    const v = malla.userData.siMalla; if (!v) return;
    malla.remove(v.lineas, v.puntos); v.lineas.geometry.dispose(); v.puntos.geometry.dispose(); malla.userData.siMalla = null;
  }
  function aplicarModo() {
    if (!estado) return;
    const modo = ctx.modoVista || 'objeto', rayos = modo === 'rayos', malla = modo === 'malla';
    for (const m of mallasVisibles()) {
      const mat = m.material;
      if (mat.transparent !== rayos) { mat.transparent = rayos; mat.needsUpdate = true; }
      mat.opacity = rayos ? .35 : 1; mat.depthWrite = !rayos;
      if (malla && !m.userData.siMalla) {
        const g = m.geometry, n = g.getAttribute('position').count / 3;
        const lineas = new THREE.LineSegments(n > 600000 ? new THREE.EdgesGeometry(g, 20) : new THREE.WireframeGeometry(g), matAristas);
        const pg = new THREE.BufferGeometry(); pg.setAttribute('position', g.getAttribute('position'));
        const puntos = new THREE.Points(pg, matVertices);
        for (const o of [lineas, puntos]) { o.raycast = () => {}; o.renderOrder = 6; }
        m.add(lineas, puntos); m.userData.siMalla = { lineas, puntos };
      } else if (!malla) quitarMalla(m);
    }
  }
  window.addEventListener('bisturi-modo-vista', aplicarModo);
  const tmp = new THREE.Color(), APAGADO = new THREE.Color(0x2b3a52).convertSRGBToLinear();
  // La pieza que se está trabajando se ve con su color; las demás quedan apagadas.
  function colorear(caras) {
    const a = estado.vista.geometry.getAttribute('color'), arr = a.array, lista = caras || estado.etiquetas.keys();
    const sel = estado.activa != null && estado.activa >= 0 ? estado.activa : null;
    for (const f of lista) {
      const e = estado.etiquetas[f]; tmp.setHex(colorDe(e)).convertSRGBToLinear();
      if (sel !== null && e !== sel) { const l = .2126 * tmp.r + .7152 * tmp.g + .0722 * tmp.b; tmp.setRGB(l, l, l).lerp(APAGADO, .55); }
      for (let k = 0; k < 3; k++) { arr[9 * f + 3 * k] = tmp.r; arr[9 * f + 3 * k + 1] = tmp.g; arr[9 * f + 3 * k + 2] = tmp.b; }
    }
    a.needsUpdate = true;
  }
  function coloresPlenos() {
    const n = estado.etiquetas.length, C = new Float32Array(n * 9);
    for (let f = 0; f < n; f++) { tmp.setHex(colorDe(estado.etiquetas[f])).convertSRGBToLinear(); for (let k = 0; k < 3; k++) C.set([tmp.r, tmp.g, tmp.b], 9 * f + 3 * k); }
    return C;
  }

  // ---------- «Explosión»: cada pieza propuesta se aparta del resto (sin separar todavía) ----------
  const TEXTO_VISTA = 'Vista previa lista: marca «Demostración» y mueve el deslizador para ver las piezas separadas. «Separar» las separa; toca una pieza para pintarla.';
  let partesVista = null;
  // La pieza más grande se queda quieta y cada una de las demás se aparta de ella la misma distancia.
  function distribuir(tam) {
    const vol = b => { const t = b.getSize(new THREE.Vector3()); return t.x * t.y * t.z; };
    let base = partesVista[0];
    for (const p of partesVista) if (vol(p.malla.geometry.boundingBox) > vol(base.malla.geometry.boundingBox)) base = p;
    const cb = base.malla.geometry.boundingBox.getCenter(new THREE.Vector3());
    partesVista.forEach((p, i) => {
      if (p === base) { p.d.set(0, 0, 0); return; }
      p.d.copy(p.malla.geometry.boundingBox.getCenter(new THREE.Vector3())).sub(cb);
      if (p.d.length() < tam * 0.02) p.d.set(Math.cos(i * 2.4), .4, Math.sin(i * 2.4));
      p.d.normalize().multiplyScalar(tam * 0.25);
    });
  }
  const vistaSep = {
    texto: TEXTO_VISTA,
    async iniciar() {
      if (!estado) return false;
      const g = estado.vista.geometry, P = g.getAttribute('position').array, C = coloresPlenos(), nf = P.length / 9;
      const grupos = new Map(); for (let f = 0; f < nf; f++) { const e = estado.etiquetas[f]; let l = grupos.get(e); if (!l) grupos.set(e, l = []); l.push(f); }
      if (grupos.size < 2) { status('Solo hay una pieza: pulsa «+ Nueva pieza» y pinta la zona que quieres separar.'); return false; }
      const total = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position')), centro = total.getCenter(new THREE.Vector3()), tam = total.getSize(new THREE.Vector3()).length();
      partesVista = [];
      let i = 0;
      // Vista previa real: se calcula la separación exacta (piezas cerradas, con su tapa) sin aplicarla.
      // Si la malla no lo permite, se muestran las zonas sin tapa.
      let partes = estado.cachePartes?.version === estado.version ? estado.cachePartes.partes : null;
      if (!partes) {
        try { partes = await separar(estado.m, estado.etiquetas, estado.mat, opcionesCorte()); estado.cachePartes = { version: estado.version, partes }; }
        catch (err) { if (/atraviesa/.test(err.message)) { status('No se pudo mostrar la vista previa: ' + err.message); return false; } console.warn('Vista previa sin tapas:', err.message); partes = null; }
        if (!estado) return false;
      }
      if (partes) {
        for (const p of partes) {
          let n = 0; for (const x of p.mallas) n += x.malla.tri.length / 3;
          const pos = new Float32Array(n * 9); let k = 0;
          for (const x of p.mallas) { const P2 = x.malla.pos, T = x.malla.tri; for (let t = 0; t < T.length; t++) { const v = T[t]; pos[k++] = P2[3 * v]; pos[k++] = P2[3 * v + 1]; pos[k++] = P2[3 * v + 2]; } }
          const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); gg.computeVertexNormals();
          const malla = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: colorDe(p.etiqueta), roughness: .6, metalness: 0, flatShading: true })); malla.raycast = () => {};
          gg.computeBoundingBox(); i++;
          scene.add(malla); partesVista.push({ malla, d: new THREE.Vector3(), propio: true, etiqueta: p.etiqueta });
        }
        distribuir(tam); estado.vista.visible = false; aplicarModo();
        return true;
      }
      for (const [etiqueta, caras] of grupos) {
        const pos = new Float32Array(caras.length * 9), col = new Float32Array(caras.length * 9);
        caras.forEach((f, k) => { pos.set(P.subarray(9 * f, 9 * f + 9), 9 * k); col.set(C.subarray(9 * f, 9 * f + 9), 9 * k); });
        const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); gg.setAttribute('color', new THREE.BufferAttribute(col, 3)); gg.computeVertexNormals();
        const malla = new THREE.Mesh(gg, estado.vista.material); malla.raycast = () => {};
        gg.computeBoundingBox(); i++;
        scene.add(malla); partesVista.push({ malla, d: new THREE.Vector3(), etiqueta });
      }
      distribuir(tam); estado.vista.visible = false; aplicarModo();
      return true;
    },
    fijar(a) { for (const p of partesVista || []) p.malla.position.copy(p.d).multiplyScalar(a); },
    objetos() { return (partesVista || []).map(p => p.malla); },
    terminar() {
      for (const p of partesVista || []) { quitarMalla(p.malla); scene.remove(p.malla); p.malla.geometry.dispose(); if (p.propio) p.malla.material.dispose(); }
      partesVista = null; if (estado) estado.vista.visible = true; return null;
    }
  };

  // ---------- pincel ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function golpe(e) {
    const r = lienzo.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObject(estado.target, false)[0];
    if (!h || h.faceIndex == null) return null;
    const f = estado.inv[h.faceIndex]; return f >= 0 ? { f, punto: h.point, normal: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null } : null;
  }
  // Quitar con un color elegido: solo cambia las caras de ese color (pasan a «Objeto 1»).
  function pincelQuitar(topo, cent, mask, f0, punto, radio, L) {
    const r2 = radio * radio, visto = new Set([f0]), pila = [f0], cambiadas = [];
    while (pila.length) {
      const f = pila.pop();
      if (mask[f] === L) { mask[f] = 0; cambiadas.push(f); }
      for (let k = 0; k < 3; k++) {
        const h = topo.gemela[3 * f + k]; if (h < 0) continue; const F = (h / 3) | 0;
        if (visto.has(F)) continue; visto.add(F);
        const dx = cent[3 * F] - punto[0], dy = cent[3 * F + 1] - punto[1], dz = cent[3 * F + 2] - punto[2];
        if (dx * dx + dy * dy + dz * dz <= r2) pila.push(F);
      }
    }
    return cambiadas;
  }
  function pintar(e) {
    const g = golpe(e); if (!g || !estado.herr) return;
    const radio = estado.diag * Number(q('.si-tam input').value) / 100;
    const quitar = estado.herr === 'quitar', L = estado.activa;
    window.bisturiPincel?.mostrar(e, g.punto, radio, g.normal, quitar);
    const cambiadas = quitar && L !== null ? pincelQuitar(estado.topo, estado.cent, estado.etiquetas, g.f, g.punto.toArray(), radio, L)
      : pincel(estado.topo, estado.cent, estado.etiquetas, g.f, g.punto.toArray(), radio, quitar ? 0 : L);
    if (cambiadas.length) { colorear(cambiadas); estado.cambios = true; estado.version = (estado.version || 0) + 1; }
  }
  // Dos toques seguidos sobre una zona de la pieza elegida la deseleccionan entera: el primer toque
  // se deshace y la zona tocada pasa a la pieza que la rodea.
  let ultimoToque = null;
  function toque(e) {
    const ahora = performance.now();
    if (ultimoToque && ahora - ultimoToque.t < 400 && Math.hypot(e.clientX - ultimoToque.x, e.clientY - ultimoToque.y) < 30) {
      estado.etiquetas.set(ultimoToque.antes); const prev = ultimoToque; ultimoToque = null;
      const g = golpe(e), L = estado.herr === 'agregar' ? estado.activa : null;
      if (g && L !== null && estado.etiquetas[g.f] === L) deseleccionar(g.f, L);
      else { colorear(null); estado.version++; }
      pintarChips(); return;
    }
    const antes = estado.etiquetas.slice();
    pintar(e); pintarChips();
    ultimoToque = { t: ahora, x: e.clientX, y: e.clientY, antes };
  }
  function deseleccionar(f0, L) {
    const et = estado.etiquetas, gem = estado.topo.gemela, zona = [f0], visto = new Uint8Array(et.length); visto[f0] = 1;
    const vecinos = new Map();
    for (let i = 0; i < zona.length; i++) {
      const f = zona[i];
      for (let k = 0; k < 3; k++) {
        const h = gem[3 * f + k]; if (h < 0) continue; const F = (h / 3) | 0;
        if (et[F] === L) { if (!visto[F]) { visto[F] = 1; zona.push(F); } }
        else vecinos.set(et[F], (vecinos.get(et[F]) || 0) + 1);
      }
    }
    let destino = [...vecinos].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (destino === undefined) { const c = new Map(); for (const x of et) if (x !== L) c.set(x, (c.get(x) || 0) + 1); destino = [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0; }
    for (const f of zona) et[f] = destino;
    colorear(null); estado.version++; estado.cambios = true;
    status(`Zona quitada de «Objeto ${L + 1}».`);
  }
  // Con una pieza elegida: un dedo (o el botón izquierdo) pinta; dos dedos (o el botón derecho)
  // giran y acercan la vista. Así se puede girar la pieza sin dejar de editar.
  let trazo = null, original = null; const dedos = new Set();
  function modoPintar(on) {
    if (on && !original) {
      original = { L: orbit.mouseButtons.LEFT, R: orbit.mouseButtons.RIGHT, U: orbit.touches.ONE, D: orbit.touches.TWO };
      orbit.mouseButtons.LEFT = null; orbit.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
      orbit.touches.ONE = null; orbit.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    } else if (!on && original) {
      orbit.mouseButtons.LEFT = original.L; orbit.mouseButtons.RIGHT = original.R; orbit.touches.ONE = original.U; orbit.touches.TWO = original.D; original = null;
    }
  }
  const pintando = () => !!estado?.herr && !ctx.enVista;
  // El trazo empieza al mover un poco el dedo: si en ese momento llega un segundo dedo, es un giro y no se pinta.
  let espera = null;
  caja.addEventListener('pointerdown', e => {
    if (e.target === lienzo) dedos.add(e.pointerId);
    if (!pintando() || e.target !== lienzo) return;
    if (dedos.size > 1) { trazo = null; espera = null; return; } // segundo dedo: la vista gira
    if (e.button !== 0) return;
    espera = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), e };
  }, { capture: true });
  // Pincel encendido sin pulsar (ratón o lápiz): se ve el área que marcará.
  const vistaPincel = e => {
    if (!estado || !pintando() || e.pointerType === 'touch' || e.buttons || trazo != null || e.target !== lienzo) return;
    const g = golpe(e);
    if (g) window.bisturiPincel?.mostrar(e, g.punto, estado.diag * Number(q('.si-tam input').value) / 100, g.normal, estado.herr === 'quitar');
    else window.bisturiPincel?.ocultar();
  };
  lienzo.addEventListener('pointerleave', () => { if (trazo == null) window.bisturiPincel?.ocultar(); });
  caja.addEventListener('pointermove', e => {
    vistaPincel(e);
    if (!estado || dedos.size > 1) return;
    if (espera && espera.id === e.pointerId && (performance.now() - espera.t > 90 || Math.hypot(e.clientX - espera.x, e.clientY - espera.y) > 8)) { trazo = espera.id; pintar(espera.e); espera = null; }
    if (trazo === e.pointerId) pintar(e);
  }, { capture: true });
  const fin = e => {
    dedos.delete(e.pointerId);
    if (e.pointerType === 'touch') window.bisturiPincel?.ocultar(900);
    if (espera && espera.id === e.pointerId) { espera = null; if (pintando()) toque(e); return; } // un toque pinta; dos toques seguidos deseleccionan
    if (trazo !== e.pointerId) return; trazo = null;
    if (estado) pintarChips();
  };
  caja.addEventListener('pointerup', fin, { capture: true });
  caja.addEventListener('pointercancel', fin, { capture: true });

  // Con el pincel apagado, dos toques sobre el modelo (o sobre una pieza de la demostración) eligen ese color.
  let toqueIni = null, toqueAnt = null;
  function etiquetaEn(e) {
    if (ctx.enVista && partesVista) {
      const r = lienzo.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = []; for (const p of partesVista) { p.malla.updateMatrixWorld(true); const h = []; THREE.Mesh.prototype.raycast.call(p.malla, ray, h); for (const x of h) hits.push({ d: x.distance, p }); }
      hits.sort((a, b) => a.d - b.d); return hits.length ? hits[0].p.etiqueta : null;
    }
    const g = golpe(e); return g ? estado.etiquetas[g.f] : null;
  }
  caja.addEventListener('pointerdown', e => {
    if (!estado || pintando() || e.target !== lienzo || dedos.size > 1 || e.button !== 0) { toqueIni = null; return; }
    toqueIni = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
  }, { capture: true });
  caja.addEventListener('pointerup', e => {
    const ini = toqueIni; toqueIni = null;
    if (!estado || !ini || ini.id !== e.pointerId || pintando()) return;
    if (e.timeStamp - ini.t > 300 || Math.hypot(e.clientX - ini.x, e.clientY - ini.y) > 8) { toqueAnt = null; return; }
    const ant = toqueAnt; toqueAnt = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    if (!ant || e.timeStamp - ant.t > 400 || Math.hypot(e.clientX - ant.x, e.clientY - ant.y) > 30) return;
    toqueAnt = null;
    const L = etiquetaEn(e); if (L == null) return;
    elegir(L);
  }, { capture: true });

  // ---------- ciclo ----------
  function iniciar() {
    if (estado) { salir(); return; }
    if ((ctx.ocupadoSinVista || ctx.busy)()) return status('Vuelve a la vista ensamblada para usar la Separación inteligente.');
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
    estado = { version: 0, cachePartes: null, prof: new Map(), target, m, topo, cent: centroides(m), inv, mat, etiquetas: p.etiquetas, total: Math.max(p.total, 1), activa: p.total > 1 ? null : 0, diag: b.getSize(new THREE.Vector3()).length(), geo: target.geometry };
    target.visible = false; ctx.onActivo?.(true);
    barra.querySelectorAll('button').forEach(x => x.disabled = false);
    crearVista(); aplicarModo(); pintarChips(); ctx.registrarVista(vistaSep);
    barra.hidden = false; $('hInteligente')?.classList.add('activo');
    if (p.total > 1) { status(`Se proponen ${p.total} piezas (por colores y partes sueltas). Marca «Demostración» para verlas separadas; toca una pieza para pintarla; luego «Separar».`); vistaSep.texto = `Se proponen ${p.total} piezas (por colores y partes sueltas). Marca «Demostración» para verlas separadas; para corregir, toca una pieza y pinta; luego «Separar».`; ctx.abrirVista().then(() => { vistaSep.texto = TEXTO_VISTA; }); }
    else status('No se encontraron colores ni partes sueltas. Pulsa «+ Nueva pieza» y pinta la zona que quieres separar; luego «Separar».');
  }
  function salir() {
    if (!estado) return;
    ctx.soltarVista(vistaSep);
    const { vista, target } = estado;
    quitarMalla(vista); scene.remove(vista); vista.geometry.dispose(); vista.material.dispose();
    if (ctx.meshes.includes(target)) target.visible = true;
    estado = null; trazo = null; orbit.enabled = true; modoPintar(false); window.bisturiPincel?.ocultar();
    barra.hidden = true; barraProf.hidden = true; $('hInteligente')?.classList.remove('activo'); ctx.onActivo?.(false);
  }
  async function ejecutar() {
    if (!estado || estado.ocupado) return;
    if (ctx.enVista) ctx.cerrarVista(false);
    const usadas = new Set(estado.etiquetas);
    if (usadas.size < 2) return status('Solo hay una pieza: pulsa «+ Nueva pieza» y pinta la zona que quieres separar.');
    if (!ctx.meshes.includes(estado.target) || estado.target.geometry !== estado.geo) { salir(); return status('La pieza cambió; vuelve a pulsar «Separación inteligente».'); }
    estado.ocupado = true; barra.querySelectorAll('button').forEach(x => x.disabled = true);
    try {
      const partes = estado.cachePartes?.version === estado.version ? estado.cachePartes.partes : await separar(estado.m, estado.etiquetas, estado.mat, { ...opcionesCorte(), progreso: status });
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
