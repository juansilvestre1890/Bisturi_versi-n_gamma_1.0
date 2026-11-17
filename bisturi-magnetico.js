// Bisturí magnético: un lazo que se pega a los bordes de la superficie, como el lazo magnético
// de Photoshop. Bordes = cambios de color, aristas marcadas y surcos.
//  1) Se toca la figura para empezar y se arrastra cerca del borde: la línea busca el camino
//     más "barato" sobre las aristas de la malla, y los bordes marcados son más baratos.
//  2) Mientras se arrastra se ponen puntos de anclaje solos. «Quitar punto» borra el último tramo.
//  3) Al volver al inicio el lazo se cierra y se marca en verde la zona encerrada (la parte
//     más pequeña; «Invertir» elige la otra).
//  4) «Hacer el corte» separa esa zona como pieza cerrada, cortando exactamente por la línea.
import { soldar, topologia, orientar } from './nucleo-malla.js?v=2.10';
import { separar } from './separacion-inteligente.js?v=20261117a';

export function setupBisturiMagnetico(ctx) {
  const { THREE, scene, camera, renderer, orbit, status } = ctx;
  const $ = id => document.getElementById(id);
  const lienzo = renderer.domElement, caja = lienzo.parentElement;
  let activo = false, girar = false, datos = null, ocupado = false;
  // Estado del lazo
  let tramos = [], inicio = -1, ultimo = -1, vivo = null, cerrado = false, invertido = false, seleccion = null;
  const cache = new WeakMap();

  // ---------- barras sobre la vista ----------
  const barra = (lado, html) => { const d = document.createElement('div'); d.className = 'bisturi-barra ' + lado; d.hidden = true; d.innerHTML = html; caja.append(d); ['pointerdown', 'pointerup', 'pointermove', 'wheel'].forEach(t => d.addEventListener(t, e => e.stopPropagation())); return d; };
  const abajo = barra('abajo', `<p class="bisturi-info bm-info">Toca la figura donde quieres empezar y arrastra cerca del borde.</p>
    <button type="button" class="secondary bm-quitar">Quitar punto</button>
    <button type="button" class="secondary bm-invertir" disabled>Invertir</button>
    <button type="button" class="secondary bm-borrar">Borrar</button>
    <button type="button" class="secondary bm-girar" title="Mientras está activo, arrastrar gira la vista">Girar vista</button>
    <button type="button" class="bm-cortar" disabled>Hacer el corte</button>`);
  const arriba = barra('arriba', `<label>Fuerza del imán <input class="bm-fuerza" type="range" min="0" max="30" step="1" value="12"></label>`);
  const q = s => abajo.querySelector(s) || arriba.querySelector(s);
  const info = t => { q('.bm-info').textContent = t; };

  // ---------- preparación de la malla ----------
  function preparar(mesh) {
    const c = cache.get(mesh.geometry); if (c && c.mesh === mesh) return c;
    mesh.updateWorldMatrix(true, false);
    const sopa = ctx.soupInFrame(mesh, mesh.matrixWorld), s = soldar(sopa, 1e-6), m = orientar(s.malla).malla, topo = topologia(m);
    const nT = sopa.length / 9, inv = new Int32Array(nT).fill(-1); s.origen.forEach((o, i) => { inv[o] = i; });
    const P = m.pos, T = m.tri, nf = T.length / 3, nV = P.length / 3;
    const claves0 = ctx.faceColorKeys(mesh.geometry), mats0 = ctx.faceMaterials(mesh.geometry);
    const clave = new Int32Array(nf), mat = new Int16Array(nf), area = new Float64Array(nf), fn = new Float32Array(nf * 3), vn = new Float32Array(nV * 3);
    for (let f = 0; f < nf; f++) {
      clave[f] = claves0[s.origen[f]]; mat[f] = mats0[s.origen[f]] ?? 0;
      const a = 3 * T[3 * f], b = 3 * T[3 * f + 1], c2 = 3 * T[3 * f + 2];
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c2] - P[a], vy = P[c2 + 1] - P[a + 1], vz = P[c2 + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
      area[f] = l / 2; fn[3 * f] = nx / l; fn[3 * f + 1] = ny / l; fn[3 * f + 2] = nz / l;
      for (const v of [a, b, c2]) { vn[v] += nx; vn[v + 1] += ny; vn[v + 2] += nz; }
    }
    for (let v = 0; v < nV; v++) { const l = Math.hypot(vn[3 * v], vn[3 * v + 1], vn[3 * v + 2]) || 1; vn[3 * v] /= l; vn[3 * v + 1] /= l; vn[3 * v + 2] /= l; }
    // Grafo de vértices (cada arista una vez por sentido) con su "fuerza de borde" 0..1.
    const grado = new Int32Array(nV + 1);
    for (let h = 0; h < T.length; h++) { const g = topo.gemela[h]; if (g < 0 || h < g) { grado[T[h] + 1]++; grado[T[3 * ((h / 3) | 0) + (h + 1) % 3] + 1]++; } }
    for (let v = 0; v < nV; v++) grado[v + 1] += grado[v];
    const vec = new Int32Array(grado[nV]), largo = new Float32Array(grado[nV]), fuerzaB = new Float32Array(grado[nV]), lleno = grado.slice(0, nV);
    for (let h = 0; h < T.length; h++) {
      const g = topo.gemela[h]; if (!(g < 0 || h < g)) continue;
      const f = (h / 3) | 0, a = T[h], b = T[3 * f + (h + 1) % 3];
      let s1 = 1;
      if (g >= 0) {
        const F = (g / 3) | 0;
        const color = clave[f] !== clave[F] ? 1 : 0;
        const cos = Math.max(-1, Math.min(1, fn[3 * f] * fn[3 * F] + fn[3 * f + 1] * fn[3 * F + 1] + fn[3 * f + 2] * fn[3 * F + 2]));
        // ¿Surco (cóncavo)? El centro de la cara vecina queda delante de esta cara.
        const c = 3 * T[3 * F + (g % 3 + 2) % 3];
        const conc = fn[3 * f] * (P[c] - P[3 * a]) + fn[3 * f + 1] * (P[c + 1] - P[3 * a + 1]) + fn[3 * f + 2] * (P[c + 2] - P[3 * a + 2]) > 0;
        // Los surcos (uniones como brazo-cuerpo) atraen más que las aristas salientes.
        const ang = Math.min(1, Math.acos(cos) / 0.6) * (conc ? 1 : 0.45);
        s1 = Math.max(color, ang);
      }
      const L = Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
      for (const [x, y] of [[a, b], [b, a]]) { const k = lleno[x]++; vec[k] = y; largo[k] = L; fuerzaB[k] = s1; }
    }
    const fuerzaV = new Float32Array(nV); for (let v = 0; v < nV; v++) for (let k = grado[v]; k < grado[v + 1]; k++) if (fuerzaB[k] > fuerzaV[v]) fuerzaV[v] = fuerzaB[k];
    const caja3 = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(P, 3));
    const d = { mesh, geo: mesh.geometry, m, topo, inv, mat, area, vn, grado, vec, largo, fuerzaB, fuerzaV, nV, diag: caja3.getSize(new THREE.Vector3()).length(),
      g: new Float64Array(nV), previo: new Int32Array(nV), sello: new Int32Array(nV), cerradoV: new Int32Array(nV), marca: 0 };
    cache.set(mesh.geometry, d);
    return d;
  }

  // ---------- camino magnético (A*) ----------
  function camino(d, desde, hasta) {
    if (desde === hasta) return [desde];
    const K = Number(q('.bm-fuerza').value), P = d.m.pos;
    const sello = ++d.marca, { g, previo, grado, vec, largo, fuerzaB } = d;
    const hx = P[3 * hasta], hy = P[3 * hasta + 1], hz = P[3 * hasta + 2];
    const h = v => Math.hypot(P[3 * v] - hx, P[3 * v + 1] - hy, P[3 * v + 2] - hz);
    const heap = [], push = (f, v) => { heap.push([f, v]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    d.sello[desde] = sello; g[desde] = 0; previo[desde] = -1; push(h(desde), desde);
    let expandidos = 0;
    while (heap.length) {
      const [, v] = pop();
      if (d.cerradoV[v] === sello) continue; d.cerradoV[v] = sello;
      if (v === hasta) break;
      if (++expandidos > 600000) return null;
      for (let k = grado[v]; k < grado[v + 1]; k++) {
        const w = vec[k], debil = 1 - fuerzaB[k], c = g[v] + largo[k] * (1 + K * debil * debil);
        if (d.sello[w] !== sello || c < g[w]) { d.sello[w] = sello; g[w] = c; previo[w] = v; push(c + h(w), w); }
      }
    }
    if (d.cerradoV[hasta] !== sello) return null;
    const r = []; for (let v = hasta; v >= 0; v = previo[v]) r.push(v); return r.reverse();
  }

  // ---------- dibujo ----------
  const matLinea = new THREE.LineBasicMaterial({ color: 0x00e5ff, depthTest: false, transparent: true, opacity: .95 });
  const matVivo = new THREE.LineBasicMaterial({ color: 0xffe066, depthTest: false, transparent: true, opacity: .95 });
  const linea = new THREE.Line(new THREE.BufferGeometry(), matLinea), lineaViva = new THREE.Line(new THREE.BufferGeometry(), matVivo);
  const punto = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x2ee67a, depthTest: false }));
  const zona = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x2ee67a, transparent: true, opacity: .45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  for (const o of [linea, lineaViva, punto, zona]) { o.visible = false; o.raycast = () => {}; o.renderOrder = 40; o.frustumCulled = false; scene.add(o); }
  zona.renderOrder = 35;
  const posLinea = verts => {
    const d = datos, P = d.m.pos, e = d.diag * 0.002, a = new Float32Array(verts.length * 3);
    verts.forEach((v, i) => { a[3 * i] = P[3 * v] + d.vn[3 * v] * e; a[3 * i + 1] = P[3 * v + 1] + d.vn[3 * v + 1] * e; a[3 * i + 2] = P[3 * v + 2] + d.vn[3 * v + 2] * e; });
    return new THREE.BufferAttribute(a, 3);
  };
  // Recorrido completo, sin idas y vueltas: si la línea vuelve a pasar por un vértice, se quita el lazo intermedio.
  const recorrido = () => {
    const r = []; for (const t of tramos) { if (r.length) r.pop(); r.push(...t); }
    const cierra = cerrado && r.length > 2 && r[0] === r.at(-1), lista = cierra ? r.slice(0, -1) : r;
    const pila = [], pos = new Map();
    for (const v of lista) { const i = pos.get(v); if (i !== undefined) { while (pila.length > i + 1) pos.delete(pila.pop()); continue; } pos.set(v, pila.length); pila.push(v); }
    if (cierra) pila.push(pila[0]);
    return pila;
  };
  function dibujar() {
    const r = recorrido();
    linea.visible = r.length > 1; if (linea.visible) { linea.geometry.dispose(); linea.geometry = new THREE.BufferGeometry(); linea.geometry.setAttribute('position', posLinea(r)); }
    lineaViva.visible = !!(vivo && vivo.length > 1 && !cerrado); if (lineaViva.visible) { lineaViva.geometry.dispose(); lineaViva.geometry = new THREE.BufferGeometry(); lineaViva.geometry.setAttribute('position', posLinea(vivo)); }
    punto.visible = inicio >= 0 && !cerrado;
    if (punto.visible) { const P = datos.m.pos; punto.position.set(P[3 * inicio], P[3 * inicio + 1], P[3 * inicio + 2]); punto.scale.setScalar(datos.diag * 0.008); }
    zona.visible = !!seleccion;
    if (seleccion) {
      const { m } = datos, T = m.tri, P = m.pos; let n = 0; for (let f = 0; f < seleccion.length; f++) n += seleccion[f];
      const a = new Float32Array(n * 9); let k = 0;
      for (let f = 0; f < seleccion.length; f++) if (seleccion[f]) for (let j = 0; j < 3; j++) { const v = T[3 * f + j]; a[k++] = P[3 * v]; a[k++] = P[3 * v + 1]; a[k++] = P[3 * v + 2]; }
      zona.geometry.dispose(); zona.geometry = new THREE.BufferGeometry(); zona.geometry.setAttribute('position', new THREE.BufferAttribute(a, 3));
    }
    q('.bm-quitar').disabled = !tramos.length;
    q('.bm-invertir').disabled = !seleccion;
    q('.bm-cortar').disabled = !seleccion;
  }

  // ---------- zona encerrada ----------
  function calcularZona() {
    const d = datos, T = d.m.tri, nf = T.length / 3, r = recorrido(), nV = d.nV;
    const corte = new Set(); for (let i = 0; i + 1 < r.length; i++) { const a = r[i], b = r[i + 1]; corte.add(Math.min(a, b) * nV + Math.max(a, b)); }
    const comp = new Int32Array(nf).fill(-1), areas = [], tocan = new Set(); let n = 0;
    for (let s = 0; s < nf; s++) {
      if (comp[s] >= 0) continue; comp[s] = n; let A = 0; const pila = [s];
      while (pila.length) {
        const f = pila.pop(); A += d.area[f];
        for (let k = 0; k < 3; k++) {
          const a = T[3 * f + k], b = T[3 * f + (k + 1) % 3];
          if (corte.has(Math.min(a, b) * nV + Math.max(a, b))) { tocan.add(n); continue; }
          const g = d.topo.gemela[3 * f + k]; if (g < 0) continue; const F = (g / 3) | 0;
          if (comp[F] < 0) { comp[F] = n; pila.push(F); }
        }
      }
      areas.push(A); n++;
    }
    const cand = [...tocan].sort((a, b) => areas[a] - areas[b]);
    if (cand.length < 2) return false;
    const elegidas = new Set(invertido ? cand.slice(1) : [cand[0]]);
    seleccion = new Uint8Array(nf); for (let f = 0; f < nf; f++) if (elegidas.has(comp[f])) seleccion[f] = 1;
    return true;
  }
  function cerrar() {
    if (cerrado || tramos.length < 1 || ultimo === inicio) return;
    const c = camino(datos, ultimo, inicio); if (!c) return info('No se pudo cerrar el contorno: acerca más la línea al punto de inicio.');
    tramos.push(c); ultimo = inicio; vivo = null; cerrado = true; invertido = false;
    if (!calcularZona()) {
      tramos.pop(); ultimo = tramos.length ? tramos[tramos.length - 1].at(-1) : inicio; cerrado = false; seleccion = null; dibujar();
      return info('La línea no rodea una parte: haz que dé toda la vuelta a lo que quieres separar (por ejemplo, todo el contorno del brazo).');
    }
    dibujar();
    info('Contorno cerrado: la zona verde será la nueva pieza. «Invertir» elige la otra parte; «Hacer el corte» la separa.');
    status('Bisturí magnético: contorno cerrado. Pulsa «Hacer el corte» para separar la zona verde.');
    ctx.abrirVista();
  }
  function reiniciar(mensaje = true) {
    if (ctx.enVista) ctx.cerrarVista(false);
    tramos = []; inicio = ultimo = -1; vivo = null; cerrado = false; invertido = false; seleccion = null;
    if (datos) dibujar(); else for (const o of [linea, lineaViva, punto, zona]) o.visible = false;
    for (const b of ['.bm-quitar', '.bm-invertir', '.bm-cortar']) q(b).disabled = true;
    if (mensaje) info('Toca la figura donde quieres empezar y arrastra cerca del borde.');
  }

  // ---------- puntero ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function golpe(e, soloMalla) {
    const r = lienzo.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const lista = soloMalla ? [soloMalla] : ctx.meshes.filter(m => m.visible && !m.userData.bisturiAlignmentPin);
    const h = ray.intersectObjects(lista, false)[0]; if (!h || h.faceIndex == null) return null;
    return h;
  }
  function verticeDe(d, h) {
    const f = d.inv[h.faceIndex]; if (f < 0) return -1;
    const P = d.m.pos, T = d.m.tri; let mejor = -1, dm = Infinity;
    for (let k = 0; k < 3; k++) { const v = T[3 * f + k], x = Math.hypot(P[3 * v] - h.point.x, P[3 * v + 1] - h.point.y, P[3 * v + 2] - h.point.z); if (x < dm) { dm = x; mejor = v; } }
    return imantar(d, mejor, h.point);
  }
  // Como en el lazo magnético: dentro de un pequeño radio, el punto salta al borde más marcado.
  function imantar(d, v0, p) {
    const K = Number(q('.bm-fuerza').value); if (!K) return v0;
    // Radio de búsqueda: unos 12 a 32 píxeles en pantalla según la fuerza del imán.
    const cam = camera.position, dCam = Math.hypot(cam.x - p.x, cam.y - p.y, cam.z - p.z), alto = lienzo.getBoundingClientRect().height || 600;
    const mundoPorPx = camera.isPerspectiveCamera ? 2 * dCam * Math.tan(camera.fov * Math.PI / 360) / alto : (camera.top - camera.bottom) / camera.zoom / alto;
    const R = mundoPorPx * (12 + 20 * K / 30), P = d.m.pos, R2 = R * R;
    const dist2 = v => (P[3 * v] - p.x) ** 2 + (P[3 * v + 1] - p.y) ** 2 + (P[3 * v + 2] - p.z) ** 2;
    let mejor = v0, puntos = d.fuerzaV[v0] - 0.35 * Math.sqrt(dist2(v0)) / R;
    const visto = new Set([v0]), cola = [v0];
    while (cola.length && visto.size < 4000) {
      const v = cola.shift();
      for (let k = d.grado[v]; k < d.grado[v + 1]; k++) {
        const w = d.vec[k]; if (visto.has(w)) continue; visto.add(w);
        const d2 = dist2(w); if (d2 > R2) continue; cola.push(w);
        const pt = d.fuerzaV[w] - 0.35 * Math.sqrt(d2) / R; if (pt > puntos) { puntos = pt; mejor = w; }
      }
    }
    return d.fuerzaV[mejor] >= 0.5 ? mejor : v0;
  }
  const pantalla = v => { const P = datos.m.pos, p = new THREE.Vector3(P[3 * v], P[3 * v + 1], P[3 * v + 2]).project(camera), r = lienzo.getBoundingClientRect(); return [r.left + (p.x + 1) / 2 * r.width, r.top + (1 - p.y) / 2 * r.height]; };
  // Cerca del inicio: en pantalla y también sobre la superficie (no vale el inicio tapado por detrás).
  const cercaInicio = e => {
    if (inicio < 0 || tramos.length < 2) return false;
    const [x, y] = pantalla(inicio); if (Math.hypot(e.clientX - x, e.clientY - y) > 22) return false;
    const h = golpe(e, datos.mesh); if (!h) return false;
    const P = datos.m.pos; return Math.hypot(h.point.x - P[3 * inicio], h.point.y - P[3 * inicio + 1], h.point.z - P[3 * inicio + 2]) < datos.diag * 0.03;
  };
  let trazo = null, pendiente = null, rafId = 0;
  function seguir(e) {
    if (cerrado) return;
    if (cercaInicio(e)) { if (vivo && vivo.length > 1) { tramos.push(vivo); ultimo = vivo.at(-1); vivo = null; } try { lienzo.releasePointerCapture(trazo); } catch {} trazo = null; orbit.enabled = true; cerrar(); return; }
    const h = golpe(e, datos.mesh); if (!h) return;
    const v = verticeDe(datos, h); if (v < 0 || v === (vivo ? vivo.at(-1) : ultimo)) return;
    const c = camino(datos, ultimo, v); if (!c) return;
    vivo = c;
    // Punto de anclaje automático cuando el tramo se alarga.
    let L = 0; const P = datos.m.pos; for (let i = 1; i < c.length; i++) L += Math.hypot(P[3 * c[i]] - P[3 * c[i - 1]], P[3 * c[i] + 1] - P[3 * c[i - 1] + 1], P[3 * c[i] + 2] - P[3 * c[i - 1] + 2]);
    if (L > datos.diag * 0.06) { tramos.push(c); ultimo = v; vivo = null; }
    dibujar();
  }
  caja.addEventListener('pointerdown', e => {
    if (!activo || girar || ocupado || e.target !== lienzo || e.button !== 0 || !e.isPrimary || ctx.enVista) return;
    if (cerrado) { info('El contorno ya está cerrado: «Hacer el corte», «Invertir» o «Borrar» para empezar otro.'); return; }
    const h = golpe(e, datos && tramos.length ? datos.mesh : null); if (!h) return;
    e.stopPropagation(); e.preventDefault();
    if (!datos || datos.mesh !== h.object || datos.geo !== h.object.geometry || inicio < 0) {
      try { status('Preparando el bisturí magnético…'); datos = preparar(h.object); } catch (err) { console.error(err); return status('No se pudo preparar la pieza: ' + err.message); }
      reiniciar(false);
    }
    const v = verticeDe(datos, h); if (v < 0) return;
    if (inicio < 0) { inicio = ultimo = v; info('Arrastra cerca del borde. Vuelve al punto verde para cerrar el contorno.'); status(`Bisturí magnético sobre «${datos.mesh.name}».`); }
    trazo = e.pointerId; try { lienzo.setPointerCapture(e.pointerId); } catch {}
    orbit.enabled = false; dibujar();
  }, { capture: true });
  caja.addEventListener('pointermove', e => {
    if (!activo || trazo !== e.pointerId) return; e.stopPropagation();
    pendiente = e; if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; const ev = pendiente; pendiente = null; if (ev && trazo !== null) seguir(ev); });
  }, { capture: true });
  const fin = e => {
    if (trazo !== e.pointerId) return; trazo = null; orbit.enabled = true; try { lienzo.releasePointerCapture(e.pointerId); } catch {}
    e.stopPropagation();
    if (cerrado) return;
    if (vivo && vivo.length > 1) { tramos.push(vivo); ultimo = vivo.at(-1); vivo = null; }
    dibujar();
    if (tramos.length) info('Sigue desde el último punto, o vuelve al punto verde para cerrar. Usa «Girar vista» para rodear la figura.');
  };
  caja.addEventListener('pointerup', fin, { capture: true });
  caja.addEventListener('pointercancel', fin, { capture: true });

  // ---------- botones ----------
  q('.bm-quitar').onclick = () => {
    if (!tramos.length) return;
    if (ctx.enVista) ctx.cerrarVista(false);
    tramos.pop(); cerrado = false; seleccion = null; vivo = null;
    ultimo = tramos.length ? tramos[tramos.length - 1].at(-1) : inicio;
    dibujar(); info(tramos.length ? 'Último tramo quitado. Sigue desde el punto donde termina la línea.' : 'Sigue desde el punto verde.');
  };
  q('.bm-invertir').onclick = () => {
    if (!cerrado) return; const vista = ctx.enVista; if (vista) ctx.cerrarVista(false);
    invertido = !invertido; calcularZona(); dibujar(); if (vista) ctx.abrirVista();
  };
  q('.bm-borrar').onclick = () => reiniciar();
  q('.bm-girar').onclick = () => { girar = !girar; q('.bm-girar').classList.toggle('activo', girar); info(girar ? 'Girar vista: arrastra para mover la cámara. Vuelve a tocar «Girar vista» para seguir trazando.' : 'Sigue trazando desde el último punto.'); };
  q('.bm-fuerza').addEventListener('pointerdown', e => e.stopPropagation());

  async function cortarAhora() {
    const d = datos; if (!d || !seleccion || !ctx.meshes.includes(d.mesh) || d.mesh.geometry !== d.geo) { reiniciar(); status('La pieza cambió; vuelve a trazar el contorno.'); return false; }
    const partes = await separar(d.m, seleccion, d.mat, { progreso: status });
    partes.sort((a, b) => a.etiqueta - b.etiqueta);
    const base = d.mesh.name;
    ctx.aplicar(d.mesh, partes, i => partes[i].etiqueta === 1 ? `${base} · pieza` : base);
    return true;
  }
  const vista = ctx.vistaPorCorte(cortarAhora);
  vista.texto = 'Vista previa: así quedaría la pieza. Pulsa «Hacer el corte» para separarla o desmarca «Demostración».';
  const vI = vista.iniciar.bind(vista), vT = vista.terminar.bind(vista);
  vista.iniciar = async () => { const ok = await vI(); if (ok) for (const o of [linea, zona]) o.visible = false; return ok; };
  vista.terminar = c => { const r = vT(c); if (!c && datos && ctx.meshes.includes(datos.mesh)) dibujar(); return r; };
  q('.bm-cortar').onclick = async () => {
    if (ocupado || !seleccion) return;
    ocupado = true; q('.bm-cortar').disabled = true;
    try {
      if (ctx.enVista) ctx.cerrarVista(true);
      else if (!await cortarAhora()) return;
      const nombre = datos?.mesh?.name; datos = null; reiniciar(false);
      info('Corte hecho. Toca otra figura para trazar un nuevo contorno.');
      status('Bisturí magnético: corte hecho. La zona marcada es ahora una pieza aparte. «Deshacer» lo devuelve.');
    } catch (err) {
      console.error(err);
      status('No se pudo cortar: ' + err.message + (/cerrado/.test(err.message) ? ' Usa «Reparar malla» y vuelve a intentarlo.' : ''));
      if (/cerrado/.test(err.message) && datos) ctx.revisar?.([datos.mesh]);
    } finally { ocupado = false; if (seleccion) q('.bm-cortar').disabled = false; }
  };

  // ---------- activar / salir ----------
  function activar(on) {
    if (on === activo) return;
    if (on && ctx.busy()) { status('Vuelve a la vista ensamblada y desactiva Rayos X para usar el bisturí magnético.'); $('vBisturiMagnetico')?.classList.remove('activo'); return; }
    activo = on;
    abajo.hidden = arriba.hidden = !on;
    if (on) { ctx.registrarVista(vista); ctx.onActivo?.(true); status('Bisturí magnético: toca la figura y arrastra cerca del borde de la parte que quieres separar.'); }
    else { ctx.soltarVista(vista); reiniciar(false); datos = null; girar = false; q('.bm-girar').classList.remove('activo'); trazo = null; orbit.enabled = true; }
  }
  window.addEventListener('cajon-abierto', e => activar(e.detail === 'bisturiMagnetico'));
  for (const id of ['vSeleccionar', 'vMover', 'vRotar', 'vEscalar', 'vCortePlano']) $(id)?.addEventListener('click', () => { if (activo) { window.dispatchEvent(new CustomEvent('cajon-abierto', { detail: null })); } });
  const api = { activar, get activo() { return activo; }, get estado() { return { tramos: tramos.length, cerrado, seleccion: seleccion ? seleccion.reduce((s, x) => s + x, 0) : 0, inicio, ultimo }; }, cerrar, recorrido, camino: (a, b) => camino(datos, a, b), get datos() { return datos; } };
  window.bisturiMagnetico = api;
  return api;
}
