// Herramientas Bisturí.
//  · Bisturí: cada línea dibujada crea un plano de corte (un cuadrado en la vista). Se pueden
//    dibujar varios; el corte se hace al pulsar «Hacer el corte plano».
//  · Bisturí libre: se rodea una zona con puntos y queda marcada en verde (la parte que la app
//    reconoce, o lo que encierra el contorno). Se puede sumar otro contorno desde otra vista,
//    corregir con «Añadir»/«Quitar» o partir de lo pintado con el Pincel; «Hacer el corte»
//    la separa exacta por su borde. Con una profundidad escrita corta como molde.
// Un dedo dibuja; con dos dedos se gira y se acerca la vista como siempre.
import earcut from './earcut.js';

export function setupBisturi(ctx) {
  const { THREE, scene, camera, renderer } = ctx;
  const $ = id => document.getElementById(id);
  const lienzo = renderer.domElement, caja = lienzo.parentElement;
  let modo = null; // null | 'plano' | 'libre'
  let ocupado = false;

  // ---------- capa de dibujo ----------
  const capa = document.createElement('canvas');
  capa.className = 'bisturi-capa';
  Object.assign(capa.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 });
  caja.append(capa);
  const c2 = capa.getContext('2d');
  const ajustarCapa = () => { const r = caja.getBoundingClientRect(), k = Math.min(devicePixelRatio || 1, 2); capa.width = Math.round(r.width * k); capa.height = Math.round(r.height * k); c2.setTransform(k, 0, 0, k, 0, 0); };
  new ResizeObserver(ajustarCapa).observe(caja); ajustarCapa();
  const limpiarCapa = () => c2.clearRect(0, 0, capa.width, capa.height);
  const dibujarTrazo = (pts, cerrar) => {
    limpiarCapa(); if (pts.length < 2) return;
    c2.lineWidth = 3; c2.lineJoin = c2.lineCap = 'round'; c2.strokeStyle = '#ffb020'; c2.fillStyle = 'rgba(255,176,32,.18)';
    c2.beginPath(); c2.moveTo(pts[0].x, pts[0].y);
    if (cerrar) { for (const p of pts) c2.lineTo(p.x, p.y); c2.closePath(); c2.fill(); c2.stroke(); }
    else { const b = pts[pts.length - 1]; c2.lineTo(b.x, b.y); c2.stroke(); }
  };

  // ---------- aviso flotante de herramienta activa ----------
  const chip = document.createElement('button');
  chip.type = 'button'; chip.className = 'bisturi-chip'; chip.hidden = true;
  Object.assign(chip.style, { position: 'absolute', left: '12px', top: '12px', zIndex: 3, padding: '8px 14px', borderRadius: '999px', fontWeight: '700', fontSize: '14px' });
  caja.append(chip);
  const salir = () => window.dispatchEvent(new CustomEvent('cajon-abierto', { detail: null }));
  chip.onclick = salir;

  // ---------- planos ----------
  const grupoPlanos = new THREE.Group(); scene.add(grupoPlanos);
  const planos = [];
  const objetivos = () => ctx.selected && ctx.meshes.includes(ctx.selected) ? [ctx.selected] : ctx.meshes.filter(m => m.visible);
  const infoPlanos = () => { $('bisturiPlanoInfo').textContent = planos.length ? `${planos.length} plano(s) listo(s). Pulsa «Hacer el corte plano».` : 'Sin planos. Dibuja una línea sobre la figura.'; };
  const borrarPlanos = () => { for (const p of planos) { p.malla.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); grupoPlanos.remove(p.malla); } planos.length = 0; infoPlanos(); };

  function rayo(p) {
    const r = lienzo.getBoundingClientRect(), v = new THREE.Vector2((p.x / r.width) * 2 - 1, -(p.y / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(v, camera); return rc;
  }
  function cajaDe(lista) { const b = new THREE.Box3(); for (const m of lista) b.expandByObject(m); return b; }

  // El plano es un cuadrado del mismo tamaño que la línea dibujada: un lado sigue la línea y
  // el otro entra en la figura desde su superficie. Solo corta lo que ese cuadrado atraviesa.
  function crearPlano(a, b) {
    const lista = objetivos(); if (!lista.length) return ctx.status('Abre un modelo para usar el bisturí.');
    const ra = rayo(a).ray, rb = rayo(b).ray;
    const C = camera.position.clone(), f = camera.getWorldDirection(new THREE.Vector3());
    let zFront = Infinity;
    for (let i = 0; i <= 16; i++) { const t = i / 16, h = rayo({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }).intersectObjects(lista, false)[0]; if (h) zFront = Math.min(zFront, h.point.clone().sub(C).dot(f)); }
    if (!Number.isFinite(zFront)) return ctx.status('Esa línea no toca la figura. Dibújala encima de la parte que quieres cortar.');
    const aDepth = (r, z) => C.clone().addScaledVector(r.direction, z / r.direction.dot(f));
    const A3 = aDepth(ra, zFront), B3 = aDepth(rb, zFront), L = A3.distanceTo(B3);
    if (!(L > 0)) return;
    // El plano sigue la línea trazada y entra recto en la figura (perpendicular a la pantalla),
    // sin inclinarse por la perspectiva.
    const u = B3.clone().sub(A3).normalize(), w = f.clone().addScaledVector(u, -f.dot(u)).normalize();
    const normal = new THREE.Vector3().crossVectors(u, w).normalize(), point = A3.clone();
    // Largo = la línea dibujada; hondo = hasta atravesar la figura (el corte llega al otro lado).
    const caja3 = cajaDe(lista), esq = []; for (const x of [caja3.min.x, caja3.max.x]) for (const y of [caja3.min.y, caja3.max.y]) for (const z of [caja3.min.z, caja3.max.z]) esq.push(new THREE.Vector3(x, y, z));
    const medio = A3.clone().add(B3).multiplyScalar(.5), fondo = Math.max(...esq.map(v => v.clone().sub(medio).dot(w))) + 1, D = Math.max(L, fondo + 1);
    const centro = medio.clone().addScaledVector(w, D / 2 - 1);
    const geo = new THREE.PlaneGeometry(L, D);
    const malla = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff7a45, transparent: true, opacity: .35, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
    const borde = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffb020, depthTest: false }));
    malla.add(borde); malla.renderOrder = 20; borde.renderOrder = 21;
    malla.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, w, new THREE.Vector3().crossVectors(u, w)));
    malla.position.copy(centro);
    grupoPlanos.add(malla);
    planos.push({ normal, point, cuadrado: { centro: centro.toArray(), u: u.toArray(), w: w.toArray(), mitad: L / 2, mitadW: D / 2 }, malla });
    infoPlanos();
    ctx.status(`Plano ${planos.length} creado (${L.toFixed(1)} mm). Dibuja más o pulsa «Hacer el corte plano».`);
    if (modo === 'plano') ctx.abrirVista();
  }

  $('bisturiBorrar').onclick = () => { ctx.cerrarVista(false); borrarPlanos(); ctx.status('Planos borrados.'); };
  // «Explosión» en el Bisturí: vista previa del corte con los planos dibujados.
  const vista = ctx.vistaPorCorte(async () => {
    if (!planos.length) { ctx.status('Primero dibuja al menos una línea sobre la figura.'); return false; }
    const r = await ctx.cutWithPlanes(planos.map(p => ({ normal: p.normal, point: p.point, cuadrado: p.cuadrado })), objetivos());
    if (r.hechos) grupoPlanos.visible = false;
    return r.hechos > 0;
  });
  vista.texto = 'Vista previa del corte lista: marca «Demostración» y mueve el deslizador para ver las piezas separadas. «Hacer el corte plano» corta; un toque en la vista vuelve a dibujar.';
  const vistaOrig = vista.terminar.bind(vista);
  vista.terminar = conservar => { grupoPlanos.visible = true; const r = vistaOrig(conservar); if (conservar) borrarPlanos(); return r; };
  $('bisturiCortar').onclick = async () => {
    if (ocupado) return;
    if (ctx.enVista) { ctx.cerrarVista(true); ctx.status('Corte hecho tal como lo viste en la vista previa. «Deshacer» lo devuelve.'); return; }
    if (!planos.length) return ctx.status('Primero dibuja al menos una línea sobre la figura.');
    if (ctx.busy()) return ctx.status('Vuelve a la vista ensamblada del modelo y desactiva Rayos X.');
    ocupado = true; $('bisturiCortar').disabled = true;
    try {
      const r = await ctx.cutWithPlanes(planos.map(p => ({ normal: p.normal, point: p.point, cuadrado: p.cuadrado })), objetivos());
      if (!r.hechos) ctx.status('Ningún plano separó una parte. Dibuja la línea atravesando de lado a lado la parte que quieres cortar.');
      else { borrarPlanos(); ctx.status(`Corte hecho: ${r.hechos} corte(s); ahora hay ${r.piezas} pieza(s).` + (r.avisos.length ? ` El plano ${r.avisos.join(', ')} encontró partes que se cruzan en el modelo; revisa esas piezas en el laminador.` : '')); }
    } catch (e) { console.error(e); ctx.status('No se pudo cortar: ' + e.message); }
    finally { ocupado = false; $('bisturiCortar').disabled = false; }
  };

  // ---------- bisturí libre: contorno por puntos ----------
  // Cada toque pone un punto (nodo). Para cortar hay que cerrar el contorno tocando el primer
  // punto; si no se cierra, no se corta. Los puntos quedan pegados a la figura al girar la vista.
  const nodos = [];
  const proyectar = v => { const r = lienzo.getBoundingClientRect(), p = v.clone().project(camera); return { x: (p.x + 1) / 2 * r.width, y: (1 - p.y) / 2 * r.height, delante: p.z < 1 }; };
  const infoNodos = () => { $('bisturiLibreInfo').textContent = !nodos.length ? 'Sin puntos. Toca la figura para empezar.' : nodos.length < 3 ? `${nodos.length} punto(s). Sigue tocando alrededor de la zona.` : `${nodos.length} puntos. Toca el primer punto (verde) para cerrar y cortar.`; };
  function dibujarNodos() {
    limpiarCapa(); if (modo !== 'libre' || !nodos.length) return;
    const q = nodos.map(proyectar);
    c2.lineWidth = 2.5; c2.strokeStyle = '#ffb020'; c2.setLineDash([]);
    c2.beginPath(); q.forEach((p, i) => i ? c2.lineTo(p.x, p.y) : c2.moveTo(p.x, p.y)); c2.stroke();
    if (nodos.length >= 3) { c2.setLineDash([6, 6]); c2.beginPath(); c2.moveTo(q[q.length - 1].x, q[q.length - 1].y); c2.lineTo(q[0].x, q[0].y); c2.stroke(); c2.setLineDash([]); }
    q.forEach((p, i) => {
      c2.beginPath(); c2.arc(p.x, p.y, i === 0 ? 11 : 6, 0, Math.PI * 2);
      c2.fillStyle = i === 0 ? (nodos.length >= 3 ? '#16c45a' : '#ffb020') : '#fff'; c2.fill();
      c2.lineWidth = 2; c2.strokeStyle = '#0b1e3d'; c2.stroke();
    });
  }
  (function bucleNodos() { if (modo === 'libre' && nodos.length && !trazo) dibujarNodos(); requestAnimationFrame(bucleNodos); })();
  function tocarNodo(p) {
    if (deteccion) { quitarDeteccion(); ctx.status('Detección descartada. Sigue poniendo puntos o cierra el contorno.'); }
    if (nodos.length >= 3) { const q0 = proyectar(nodos[0]); if (Math.hypot(q0.x - p.x, q0.y - p.y) <= 30) return corteLibre(); }
    const lista = ctx.meshes.filter(m => m.visible); if (!lista.length) return ctx.status('Abre un modelo para usar el bisturí.');
    const r = rayo(p), h = r.intersectObjects(lista, false)[0], f = camera.getWorldDirection(new THREE.Vector3()), C = camera.position;
    let v;
    if (h) v = h.point.clone();
    else {
      // Fuera de la figura: a la misma profundidad que el último punto (o que el centro del modelo).
      const ref = nodos.length ? nodos[nodos.length - 1] : cajaDe(lista).getCenter(new THREE.Vector3()), z = ref.clone().sub(C).dot(f);
      v = C.clone().addScaledVector(r.ray.direction, z / r.ray.direction.dot(f));
    }
    nodos.push(v); infoNodos(); dibujarNodos(); actualizarBarraLibre();
  }
  const borrarNodos = () => { nodos.length = 0; infoNodos(); limpiarCapa(); if (typeof actualizarBarraLibre === 'function') actualizarBarraLibre(); };
  $('bisturiCerrar').onclick = () => { if (nodos.length < 3) return ctx.status('No se pudo cerrar: pon al menos 3 puntos alrededor de la zona.'); corteLibre(); };
  $('bisturiQuitarPunto').onclick = () => { nodos.pop(); infoNodos(); dibujarNodos(); actualizarBarraLibre(); };
  $('bisturiBorrarPuntos').onclick = () => { borrarNodos(); ctx.status('Puntos borrados.'); };

  // ---------- zona de corte (verde) ----------
  let zona = null, pincelZona = null, pintando = null;
  const cacheMalla = new WeakMap();
  function datosMalla(mesh) {
    const g = mesh.geometry; let d = cacheMalla.get(g); if (d) return d;
    const P = g.attributes.position.array, I = g.index ? g.index.array : null, n = (I ? I.length : P.length / 3) / 3;
    const tri = I || Uint32Array.from({ length: n * 3 }, (_, i) => i), cent = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
    const clave = v => Math.round(P[3 * v] * 1e4) + ',' + Math.round(P[3 * v + 1] * 1e4) + ',' + Math.round(P[3 * v + 2] * 1e4);
    const aristas = new Map(), adj = Array.from({ length: n }, () => []);
    for (let f = 0; f < n; f++) {
      const a = 3 * tri[3 * f], b = 3 * tri[3 * f + 1], c = 3 * tri[3 * f + 2];
      cent[3 * f] = (P[a] + P[b] + P[c]) / 3; cent[3 * f + 1] = (P[a + 1] + P[b + 1] + P[c + 1]) / 3; cent[3 * f + 2] = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nrm[3 * f] = nx / l; nrm[3 * f + 1] = ny / l; nrm[3 * f + 2] = nz / l;
      for (let k = 0; k < 3; k++) { const x = clave(tri[3 * f + k]), y = clave(tri[3 * f + (k + 1) % 3]), key = x < y ? x + '|' + y : y + '|' + x; const o = aristas.get(key); if (o === undefined) aristas.set(key, f); else { adj[f].push(o); adj[o].push(f); } }
    }
    d = { P, tri, n, cent, nrm, adj }; cacheMalla.set(g, d); return d;
  }
  // La zona se pinta sobre la pieza como su propio color (opaca e iluminada), no transparente.
  const verZona = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x2ee67a, emissive: 0x0b4a24, roughness: .55, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  verZona.matrixAutoUpdate = false; verZona.visible = false; verZona.renderOrder = 25; verZona.raycast = () => {}; scene.add(verZona);
  const cuentaZona = () => zona ? zona.caras.reduce((s, x) => s + x, 0) : 0;
  function zonaValida() { if (ctx.enVista) return !!zona; // durante la vista previa la pieza está cortada de forma provisional
    if (zona && (!ctx.meshes.includes(zona.target) || zona.target.geometry !== zona.geo)) zona = null; return !!zona; }
  function dibujarZona() {
    zonaValida();
    const n = cuentaZona();
    if (!zona || !n) { verZona.visible = false; actualizarBarraLibre(); return; }
    const d = datosMalla(zona.target), pos = new Float32Array(n * 9); let k = 0;
    for (let f = 0; f < d.n; f++) if (zona.caras[f]) for (let j = 0; j < 3; j++) { const v = 3 * d.tri[3 * f + j]; pos[k++] = d.P[v]; pos[k++] = d.P[v + 1]; pos[k++] = d.P[v + 2]; }
    verZona.geometry.dispose(); verZona.geometry = new THREE.BufferGeometry(); verZona.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); verZona.geometry.computeVertexNormals();
    zona.target.updateWorldMatrix(true, false); verZona.matrix.copy(zona.target.matrixWorld); verZona.matrixWorldNeedsUpdate = true; verZona.visible = !ctx.enVista;
    actualizarBarraLibre();
  }
  function ponerZona(target, caras, sumar = true) {
    zonaValida();
    if (ctx.enVista) ctx.cerrarVista(false);
    if (zona && sumar && zona.target === target) { for (let f = 0; f < caras.length; f++) if (caras[f]) zona.caras[f] = 1; }
    else zona = { target, geo: target.geometry, caras: Uint8Array.from(caras) };
    dibujarZona(); ctx.abrirVista();
  }
  function borrarZona() { if (ctx.enVista) ctx.cerrarVista(false); zona = null; pincelZona = null; dibujarZona(); }
  // Lo pintado con el Pincel (zona amarilla) pasa a ser la zona de corte.
  function zonaDesdePincel() {
    const lista = ctx.meshes.filter(m => m.visible && !m.userData.bisturiAlignmentPin), pref = ctx.selected && lista.includes(ctx.selected) ? [ctx.selected, ...lista] : lista;
    for (const m of pref) {
      const sel = window.bisturi?.surfaceFaces?.(m); if (!sel || !sel.size) continue;
      const d = datosMalla(m), caras = new Uint8Array(d.n); for (const f of sel) if (f < d.n) caras[f] = 1;
      ponerZona(m, caras, false); ctx.status(`Zona del Pincel lista para cortar en «${m.name}».`); return true;
    }
    return false;
  }
  // Sin nada que reconocer: lo que encierra el contorno, por el lado que mira la cámara.
  function zonaPorContorno(objetivo, q, semillas) {
    const d = datosMalla(objetivo); objetivo.updateWorldMatrix(true, false);
    const M = objetivo.matrixWorld, cam = camera.position.clone().applyMatrix4(M.clone().invert()), r = lienzo.getBoundingClientRect(), v = new THREE.Vector3();
    const dentro = (x, y) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const a = q[i], b = q[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
    const vale = f => {
      const cx = d.cent[3 * f], cy = d.cent[3 * f + 1], cz = d.cent[3 * f + 2];
      if (d.nrm[3 * f] * (cam.x - cx) + d.nrm[3 * f + 1] * (cam.y - cy) + d.nrm[3 * f + 2] * (cam.z - cz) <= 0) return false;
      v.set(cx, cy, cz).applyMatrix4(M).project(camera); return dentro((v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height);
    };
    const caras = new Uint8Array(d.n), pila = [];
    for (const f of semillas) if (f != null && f < d.n && !caras[f] && vale(f)) { caras[f] = 1; pila.push(f); }
    while (pila.length) { const f = pila.pop(); for (const g of d.adj[f]) if (!caras[g] && vale(g)) { caras[g] = 1; pila.push(g); } }
    return caras;
  }
  // «Añadir» / «Quitar»: pincel sobre la zona.
  // Caras que abarca el pincel en ese punto: radio de 22 px con ratón o lápiz; con el dedo, 34 px para que el círculo se vea alrededor de la yema.
  const radioPincel = e => e.pointerType === 'touch' ? 34 : 22;
  function carasPincel(e) {
    const lista = zonaValida() ? [zona.target] : ctx.meshes.filter(m => m.visible && !m.userData.bisturiAlignmentPin);
    const h = rayo(punto(e)).intersectObjects(lista, false)[0]; if (!h || h.faceIndex == null) return null;
    const objetivo = h.object, d = datosMalla(objetivo), M = objetivo.matrixWorld, pl = h.point.clone().applyMatrix4(M.clone().invert());
    const r = lienzo.getBoundingClientRect(), dist = camera.position.distanceTo(h.point), escala = new THREE.Vector3(); objetivo.getWorldScale(escala);
    const R = (camera.isPerspectiveCamera ? 2 * dist * Math.tan(camera.fov * Math.PI / 360) / r.height : (camera.top - camera.bottom) / camera.zoom / r.height) * radioPincel(e) / ((escala.x + escala.y + escala.z) / 3), R2 = R * R;
    const visto = new Set([h.faceIndex]), pila = [h.faceIndex], caras = [];
    while (pila.length) {
      const f = pila.pop(); caras.push(f);
      for (const g of d.adj[f]) { if (visto.has(g)) continue; visto.add(g); const dx = d.cent[3 * g] - pl.x, dy = d.cent[3 * g + 1] - pl.y, dz = d.cent[3 * g + 2] - pl.z; if (dx * dx + dy * dy + dz * dz <= R2) pila.push(g); }
    }
    return { objetivo, caras };
  }
  function pintarZona(e) {
    const c = carasPincel(e); if (!c) return;
    if (!zona) { if (pincelZona === 'quitar') return; zona = { target: c.objetivo, geo: c.objetivo.geometry, caras: new Uint8Array(datosMalla(c.objetivo).n) }; }
    const valor = pincelZona === 'quitar' ? 0 : 1; for (const f of c.caras) zona.caras[f] = valor;
    dibujarZona(); sombraPincel(e);
  }
  // Sombra del pincel: oscurece lo que abarcará antes de pintar (y mientras se pinta).
  const sombra = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  sombra.matrixAutoUpdate = false; sombra.visible = false; sombra.renderOrder = 26; sombra.raycast = () => {}; scene.add(sombra);
  const anillo = document.createElement('div'); anillo.className = 'anillo-pincel'; anillo.hidden = true; caja.append(anillo);
  let sombraT = 0;
  function sombraPincel(e) {
    clearTimeout(sombraT);
    const c = modo === 'libre' && pincelZona && !ctx.enVista ? carasPincel(e) : null;
    if (!c) { sombra.visible = false; anillo.hidden = true; return; }
    // Círculo del pincel en pantalla: siempre se ve el tamaño, aunque el dedo tape el centro.
    const rc = caja.getBoundingClientRect(), rp = radioPincel(e);
    anillo.style.width = anillo.style.height = 2 * rp + 'px';
    anillo.style.transform = `translate(${e.clientX - rc.left - rp}px,${e.clientY - rc.top - rp}px)`;
    anillo.classList.toggle('quitar', pincelZona === 'quitar'); anillo.hidden = false;
    const d = datosMalla(c.objetivo), pos = new Float32Array(c.caras.length * 9); let k = 0;
    for (const f of c.caras) for (let j = 0; j < 3; j++) { const v = 3 * d.tri[3 * f + j]; pos[k++] = d.P[v]; pos[k++] = d.P[v + 1]; pos[k++] = d.P[v + 2]; }
    sombra.geometry.dispose(); sombra.geometry = new THREE.BufferGeometry(); sombra.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    c.objetivo.updateWorldMatrix(true, false); sombra.matrix.copy(c.objetivo.matrixWorld); sombra.matrixWorldNeedsUpdate = true; sombra.visible = true;
  }
  const quitarSombra = (espera = 0) => { clearTimeout(sombraT); sombraT = setTimeout(() => { sombra.visible = false; anillo.hidden = true; window.bisturiRedibujar?.(); }, espera); };
  const zonaPara = () => ({ modo: 'zona', caras: zona.caras, target: zona.target, geometria: zona.geo });
  // Vista previa (Demostración) del corte por la zona.
  const vistaLibre = ctx.vistaPorCorte(async () => { if (!zonaValida() || !cuentaZona()) return false; await ctx.applyFreeZone(zonaPara()); return true; });
  vistaLibre.texto = 'Vista previa: así quedaría la pieza. Pulsa «Hacer el corte» para separarla.';
  { const vI = vistaLibre.iniciar.bind(vistaLibre), vT = vistaLibre.terminar.bind(vistaLibre);
    vistaLibre.iniciar = async () => { verZona.visible = false; const ok = await vI(); if (!ok) dibujarZona(); return ok; };
    vistaLibre.terminar = c => { const r = vT(c); if (c) zona = null; dibujarZona(); return r; }; }
  async function cortarZona() {
    if (!ocupado && ctx.enVista && zona) { ctx.cerrarVista(true); ctx.status('Pieza separada por el borde de la zona. «Deshacer» la devuelve.'); return; }
    if (ocupado || !zonaValida() || !cuentaZona()) return ctx.status('No se pudo cortar: primero marca la zona (contorno, «Añadir» o el Pincel).');
    ocupado = true; const f = camera.getWorldDirection(new THREE.Vector3());
    try { await ctx.applyFreeZone(zonaPara()); zona = null; pincelZona = null; dibujarZona(); ctx.status('Pieza separada por el borde de la zona; queda en su sitio. «Deshacer» la une de nuevo.'); }
    catch (e) { console.error(e); ctx.status('No se pudo cortar la zona: ' + e.message); }
    finally { ocupado = false; }
  }
  // Botones de la zona (en la barra del bisturí libre).
  const boton = (texto, clase, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = texto; if (clase) b.className = clase; b.onclick = fn; return b; };
  const bAnadir = boton('Añadir', 'secondary', () => { pincelZona = pincelZona === 'anadir' ? null : 'anadir'; if (pincelZona && ctx.enVista) ctx.cerrarVista(false); actualizarBarraLibre(); });
  const bQuitar = boton('Quitar', 'secondary', () => { pincelZona = pincelZona === 'quitar' ? null : 'quitar'; if (pincelZona && ctx.enVista) ctx.cerrarVista(false); actualizarBarraLibre(); });
  const bBorrarZona = boton('Borrar zona', 'secondary', () => { borrarZona(); ctx.status('Zona borrada.'); });
  const bCortarZona = boton('Hacer el corte', '', () => cortarZona());
  const bMas = boton('Más opciones', 'secondary', () => {
    // Curva ajustable y superficie guardada (antes en «Corte curvo»).
    const lanz = [...document.querySelectorAll('#almacen button, .left .tools > button')].find(b => /curvo/i.test(b.textContent)) || document.getElementById('curvedCutBtn');
    lanz?.click(); const modo2 = document.getElementById('curveMode'); if (modo2) { modo2.value = 'manual'; modo2.dispatchEvent(new Event('change')); }
  });
  function actualizarBarraLibre() {
    const hayZona = cuentaZona() > 0;
    bAnadir.classList.toggle('activo', pincelZona === 'anadir'); bQuitar.classList.toggle('activo', pincelZona === 'quitar');
    bQuitar.hidden = bBorrarZona.hidden = bCortarZona.hidden = !hayZona;
    $('bisturiQuitarPunto').hidden = $('bisturiBorrarPuntos').hidden = $('bisturiCerrar').hidden = !nodos.length;
    lienzo.style.cursor = modo === 'libre' && pincelZona ? 'cell' : modo ? 'crosshair' : '';
    if (modo !== 'libre' || !pincelZona) { sombra.visible = false; anillo.hidden = true; }
    if (modo === 'libre') $('bisturiLibreInfo').textContent = pincelZona ? (pincelZona === 'anadir' ? 'Añadir: pinta sobre la figura. Tócalo otra vez para dejar de pintar.' : 'Quitar: pinta sobre la zona verde. Tócalo otra vez para dejar de pintar.')
      : nodos.length ? $('bisturiLibreInfo').textContent
      : hayZona ? 'Zona verde lista. Puedes sumar otro contorno, corregir o «Hacer el corte».' : 'Toca alrededor de la zona para poner puntos, o usa «Añadir».';
  }

  // ---------- detección automática: vista previa y pregunta ----------
  let deteccion = null, vistaDet = null;
  const pregunta = document.createElement('div');
  pregunta.className = 'bisturi-pregunta'; pregunta.hidden = true;
  Object.assign(pregunta.style, { position: 'absolute', left: '50%', top: '92px', transform: 'translateX(-50%)', zIndex: 6, width: 'min(440px, calc(100% - 24px))', display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', borderRadius: '14px' });
  pregunta.innerHTML = '<span></span><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" data-r="si" style="flex:1">Sacar lo detectado</button><button type="button" data-r="no" class="secondary" style="flex:1">Usar solo mi contorno</button></div>';
  caja.append(pregunta);
  ['pointerdown', 'pointerup', 'pointermove'].forEach(t => pregunta.addEventListener(t, e => e.stopPropagation()));
  function quitarDeteccion() {
    deteccion = null; pregunta.hidden = true;
    if (vistaDet) { scene.remove(vistaDet); vistaDet.geometry.dispose(); vistaDet.material.dispose(); vistaDet = null; }
  }
  function mostrarDeteccion(det, f) {
    deteccion = { det, f };
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(det.vistaPrevia, 3));
    vistaDet = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2ee67a, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    vistaDet.renderOrder = 25; scene.add(vistaDet);
    const textos = {
      cuerpo: 'Encontré una pieza suelta dentro del contorno (en verde). Sale entera, sin cortar nada.',
      color: 'Encontré una zona de otro color (en verde). El corte sigue el borde del color.',
      forma: 'Encontré una parte rodeada por un surco (en verde). El corte sigue ese surco.'
    };
    pregunta.querySelector('span').textContent = textos[det.modo];
    pregunta.hidden = false;
    ctx.status(textos[det.modo] + ' Elige «Sacar lo detectado» o «Usar solo mi contorno».');
  }
  pregunta.querySelector('[data-r="no"]').onclick = () => { quitarDeteccion(); corteLibre(true); };
  pregunta.querySelector('[data-r="si"]').onclick = async () => {
    if (!deteccion || ocupado) return;
    const { det, f } = deteccion; quitarDeteccion();
    ocupado = true; ctx.status('Separando la pieza…'); await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
    try {
      await ctx.applyFreeZone(det);
      ocupado = false; borrarNodos();
      ctx.status(det.modo === 'cuerpo' ? 'Pieza suelta separada entera; queda en su sitio.' : 'Pieza separada por su borde; queda en su sitio. «Deshacer» la une de nuevo.');
    } catch (e) {
      console.error(e); ocupado = false;
      ctx.status('No pude separar lo detectado (' + e.message + '). Corto con tu contorno.');
      await corteLibre(true);
    }
  };

  async function corteLibre(usarContorno = false) {
    if (ocupado) return;
    quitarDeteccion();
    const q = nodos.map(proyectar);
    if (q.some(p => !p.delante)) return ctx.status('Algún punto quedó detrás de la cámara: gira la vista para ver todo el contorno.');
    let area = 0; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; area += a.x * b.y - b.x * a.y; }
    if (Math.abs(area / 2) < 150) return ctx.status('La zona es muy pequeña o los puntos están en línea: ponlos alrededor de la zona.');
    // Profundidad vacía («Auto»): la zona sigue la superficie y se corta por su borde.
    // Con un número: corte como molde, con la forma del contorno hacia dentro.
    const profundidad = Number(String($('bisturiProfundidad').value).replace(',', '.'));
    const molde = profundidad > 0;
    // Pieza tocada: la que más veces recibe el trazo y su interior.
    const lista = ctx.meshes.filter(m => m.visible); if (!lista.length) return ctx.status('Abre un modelo para usar el bisturí.');
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity; for (const p of q) { mnx = Math.min(mnx, p.x); mny = Math.min(mny, p.y); mxx = Math.max(mxx, p.x); mxy = Math.max(mxy, p.y); }
    const dentroPoli = (x, y) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const a = q[i], b = q[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
    // Muestras: el contorno cada 8 px (para saber qué hay sobre él) y una rejilla en el interior.
    const contornoDenso = []; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8)); for (let k = 0; k < n; k++) contornoDenso.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n }); }
    const muestras = [...contornoDenso]; for (let i = 1; i < 14; i++) for (let j = 1; j < 14; j++) { const x = mnx + (mxx - mnx) * i / 14, y = mny + (mxy - mny) * j / 14; if (dentroPoli(x, y)) muestras.push({ x, y }); }
    const votos = new Map(), golpes = [];
    const iBorde = [];
    muestras.forEach((p, i) => { const h = rayo(p).intersectObjects(lista, false)[0]; if (h) { votos.set(h.object, (votos.get(h.object) || 0) + 1); golpes.push(h); iBorde.push(i < contornoDenso.length); } });
    if (!golpes.length) return ctx.status('El trazo no toca la figura. Rodea una zona de la pieza.');
    const objetivo = [...votos].sort((a, b) => b[1] - a[1])[0][0];
    const f = camera.getWorldDirection(new THREE.Vector3()), C = camera.position.clone();
    // Primero se intenta reconocer la parte rodeada: pieza suelta, zona de color o surco.
    if (!molde) {
      ocupado = true; ctx.status('Buscando qué parte rodeaste…'); await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
      let det = null;
      try {
        let gc = 0, gx = 0; for (const p of q) { gc += p.x / q.length; gx += p.y / q.length; }
        const hc = rayo({ x: gc, y: gx }).intersectObject(objetivo, false)[0];
        const caras = golpes.map((h, i) => [h, iBorde[i]]).filter(([h]) => h.object === objetivo && h.faceIndex != null);
        det = ctx.detectFreeZone(objetivo, q.map(p => ({ x: p.x, y: p.y })), { interior: caras.filter(x => !x[1]).map(x => x[0].faceIndex), borde: caras.filter(x => x[1]).map(x => x[0].faceIndex), centro: hc?.faceIndex ?? null });
      } catch (e) { console.warn(e); }
      ocupado = false;
      const textos = { cuerpo: 'Encontré una pieza suelta dentro del contorno.', color: 'Encontré una zona de otro color.', forma: 'Encontré una parte rodeada por un surco.' };
      let caras = det ? det.caras : null;
      if (!caras) caras = zonaPorContorno(objetivo, q, golpes.filter(h => h.object === objetivo).map(h => h.faceIndex));
      if (!caras.some(x => x)) return ctx.status('No se pudo marcar la zona: el contorno no encierra ninguna parte visible de la figura.');
      ponerZona(objetivo, caras, true); borrarNodos(); actualizarBarraLibre();
      ctx.status((det ? textos[det.modo] + ' ' : '') + 'La zona quedó en verde. Corrígela con «Añadir»/«Quitar», suma otro contorno o pulsa «Hacer el corte».');
      return;
    }
    let zMin = Infinity, zMax = -Infinity;
    for (const h of golpes) if (h.object === objetivo) { const z = h.point.clone().sub(C).dot(f); zMin = Math.min(zMin, z); zMax = Math.max(zMax, z); }
    const tam = cajaDe([objetivo]).getSize(new THREE.Vector3()).length();
    const zNear = Math.max(camera.near * 2, zMin - Math.max(1, tam * 0.05)), zFar = zMax + profundidad;
    const holgura = Number($('bisturiHolgura').value);
    if (!(holgura >= 0 && holgura <= 2)) return ctx.status('La holgura debe estar entre 0 y 2 mm.');
    // Para que la pieza vuelva a entrar, las paredes del corte son paralelas a la dirección en
    // que sale (la de la vista), sin ensancharse con la perspectiva. La pieza se encoge la
    // holgura por los lados y por el fondo; el hueco conserva la forma exacta del contorno.
    const e1 = new THREE.Vector3().crossVectors(f, Math.abs(f.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(), e2 = new THREE.Vector3().crossVectors(e1, f);
    const contorno = q.map(p => { const d = rayo(p).ray.direction, P = C.clone().addScaledVector(d, zMin / d.dot(f)).sub(C); return [P.dot(e1), P.dot(e2)]; });
    const n = contorno.length;
    let sa = 0; for (let i = 0; i < n; i++) { const a = contorno[i], b = contorno[(i + 1) % n]; sa += a[0] * b[1] - b[0] * a[1]; }
    const interior = ([dx, dy]) => { const l = Math.hypot(dx, dy) || 1; return sa > 0 ? [-dy / l, dx / l] : [dy / l, -dx / l]; };
    const encoger = (poly, c) => poly.map((p, i) => {
      if (!c) return p;
      const a = poly[(i + n - 1) % n], b = poly[(i + 1) % n], n1 = interior([p[0] - a[0], p[1] - a[1]]), n2 = interior([b[0] - p[0], b[1] - p[1]]);
      let mx = n1[0] + n2[0], my = n1[1] + n2[1]; const ml = Math.hypot(mx, my); if (ml < 1e-9) { mx = n1[0]; my = n1[1]; } else { mx /= ml; my /= ml; }
      const k = c / Math.max(0.35, mx * n1[0] + my * n1[1]); return [p[0] + mx * k, p[1] + my * k];
    });
    const tris = earcut(contorno.flat());
    if (!tris.length) return ctx.status('No pude cerrar esa forma: los lados del contorno se cruzan. Quita puntos y vuelve a cerrarlo.');
    const solido = (poly, zA, zB) => {
      const at = (p, z) => C.clone().addScaledVector(e1, p[0]).addScaledVector(e2, p[1]).addScaledVector(f, z);
      const cerca = poly.map(p => at(p, zA)), lejos = poly.map(p => at(p, zB));
      const pos = [], push = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      for (let i = 0; i < tris.length; i += 3) {
        let [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
        const st = (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[c][0] - poly[a][0]) * (poly[b][1] - poly[a][1]);
        if ((st > 0) !== (sa > 0)) [b, c] = [c, b];
        push(cerca[a], cerca[c], cerca[b]); push(lejos[a], lejos[b], lejos[c]);
      }
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; push(cerca[i], cerca[j], lejos[j]); push(cerca[i], lejos[j], lejos[i]); }
      // Sentido hacia fuera: volumen positivo.
      let vol = 0; for (let i = 0; i < pos.length; i += 9) vol += pos[i] * (pos[i + 4] * pos[i + 8] - pos[i + 5] * pos[i + 7]) - pos[i + 1] * (pos[i + 3] * pos[i + 8] - pos[i + 5] * pos[i + 6]) + pos[i + 2] * (pos[i + 3] * pos[i + 7] - pos[i + 4] * pos[i + 6]);
      if (vol < 0) for (let i = 0; i < pos.length; i += 9) for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
    };
    const cortadores = { hueco: solido(contorno, zNear, zFar), pieza: solido(encoger(contorno, holgura), zNear - 0.5, zFar - holgura) };
    ocupado = true; ctx.status('Cortando la pieza…'); await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
    try {
      const r = await ctx.cutFreeShape(objetivo, cortadores, null);
      ctx.status(`Pieza sacada con ${profundidad} mm de profundidad y ${holgura} mm de holgura: queda en su sitio, dentro de su hueco. «Deshacer» la devuelve.` + (r.cerrada ? '' : ' Tiene algún borde abierto: revísala en el laminador.'));
    } catch (e) { console.error(e); ctx.status('No se pudo sacar la pieza: ' + e.message); }
    finally { ocupado = false; cortadores.hueco.dispose(); cortadores.pieza.dispose(); borrarNodos(); }
  }

  // ---------- entrada: un dedo dibuja, dos dedos mueven la vista ----------
  const activos = new Set(); let trazo = null, primero = null, pasar = false;
  const punto = e => { const r = lienzo.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  // Pasa el dedo que estaba retenido a la vista 3D (para girar o acercar).
  function cederVista() {
    trazo = null; if (modo === 'plano') limpiarCapa(); pasar = true;
    try { caja.releasePointerCapture(primero.pointerId); } catch (_) {}
    const sintetico = new PointerEvent('pointerdown', { pointerId: primero.pointerId, pointerType: primero.pointerType, isPrimary: true, clientX: primero.clientX, clientY: primero.clientY, button: 0, buttons: 1, bubbles: true, cancelable: true });
    sintetico.__bisturiPasa = true; lienzo.dispatchEvent(sintetico);
  }
  caja.addEventListener('pointerdown', e => {
    if (!modo || (e.target !== lienzo && !e.__bisturiPasa)) return; // solo los toques sobre la vista 3D
    if (ctx.enVista) { toqueVista = { x: e.clientX, y: e.clientY }; return; } // en la vista previa, arrastrar gira la vista; un toque la cierra para dibujar
    activos.add(e.pointerId);
    if (pasar || e.__bisturiPasa) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // botón derecho o rueda: vista
    if (ocupado) { e.stopPropagation(); return; }
    if (modo === 'libre' && pincelZona && !trazo) {
      e.stopPropagation(); e.preventDefault(); pintando = e.pointerId; try { caja.setPointerCapture(e.pointerId); } catch (_) {}
      pintarZona(e); return;
    }
    if (!trazo) {
      e.stopPropagation(); e.preventDefault();
      primero = e; trazo = [punto(e)];
      try { caja.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    // Segundo dedo: se cancela el trazo y la vista recibe los dos dedos.
    cederVista();
  }, { capture: true });
  caja.addEventListener('pointermove', e => {
    if (pintando === e.pointerId) { e.stopPropagation(); pintarZona(e); return; }
    if (modo === 'libre' && pincelZona && e.pointerType !== 'touch' && e.target === lienzo && !e.buttons && pintando == null) sombraPincel(e);
    if (!modo || pasar || !trazo || e.pointerId !== primero.pointerId) return;
    const p = punto(e);
    // Bisturí libre: un dedo nunca mueve la cámara (para girar o acercar se usan dos dedos o el botón derecho).
    // Si el dedo se arrastra, al soltar no se pone punto.
    if (modo === 'libre') { e.stopPropagation(); if (Math.hypot(p.x - trazo[0].x, p.y - trazo[0].y) > 12) trazo.arrastrado = true; return; }
    e.stopPropagation();
    trazo.push(p);
    dibujarTrazo([trazo[0], trazo[trazo.length - 1]], false);
  }, { capture: true });
  const fin = e => {
    activos.delete(e.pointerId);
    if (pintando === e.pointerId) { pintando = null; e.stopPropagation(); try { caja.releasePointerCapture(e.pointerId); } catch (_) {} if (e.pointerType === 'touch') quitarSombra(900); return; }
    if (pasar) { if (!activos.size) pasar = false; return; }
    if (!modo || !trazo || e.pointerId !== primero.pointerId) return;
    e.stopPropagation();
    const pts = trazo; trazo = null;
    if (e.type === 'pointercancel') { if (modo === 'plano') limpiarCapa(); return; }
    const a = pts[0], b = pts[pts.length - 1];
    if (modo === 'plano') { limpiarCapa(); if (Math.hypot(b.x - a.x, b.y - a.y) < 12) return; crearPlano(a, b); }
    else if (!pts.arrastrado) tocarNodo(a);
  };
  caja.addEventListener('pointerup', fin, { capture: true });
  let toqueVista = null;
  caja.addEventListener('pointerup', e => {
    if (!toqueVista) return; const t = toqueVista; toqueVista = null;
    if (modo === 'plano' && ctx.enVista && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 6) { ctx.cerrarVista(false); ctx.status('Modelo armado: dibuja la siguiente línea. La vista previa vuelve sola al crear el plano.'); }
  }, { capture: true });
  caja.addEventListener('pointercancel', fin, { capture: true });
  lienzo.addEventListener('pointerleave', () => quitarSombra());

  // ---------- barras sobre la vista (en lugar del panel lateral) ----------
  // Abajo: los botones de la herramienta activa. Arriba (bisturí libre): profundidad y holgura.
  const barra = (clase, nodosB) => { const d = document.createElement('div'); d.className = 'bisturi-barra ' + clase; d.hidden = true; for (const n of nodosB) if (n) d.append(n); caja.append(d); ['pointerdown', 'pointerup', 'pointermove'].forEach(t => d.addEventListener(t, e => e.stopPropagation())); return d; };
  const barraPlano = barra('abajo', [$('bisturiPlanoInfo'), $('bisturiCortar'), $('bisturiBorrar')]);
  $('bisturiCerrar').textContent = 'Cerrar contorno';
  const barraLibre = barra('abajo', [$('bisturiLibreInfo'), $('bisturiCerrar'), $('bisturiQuitarPunto'), $('bisturiBorrarPuntos'), bAnadir, bQuitar, bBorrarZona, bCortarZona, bMas]);
  const barraMedidas = barra('arriba', [$('bisturiProfundidad')?.closest('label'), $('bisturiHolgura')?.closest('label')]);
  [...barraPlano.querySelectorAll('button'), ...barraLibre.querySelectorAll('button')].forEach(b => b.classList.remove('full'));
  const barraLibreQ = () => barraLibre;

  // ---------- activar / desactivar ----------
  function activar(m) {
    if (modo === m) return;
    if (modo === 'plano' && m !== 'plano') borrarPlanos();
    if (modo === 'libre' && m !== 'libre') { nodos.length = 0; quitarDeteccion(); borrarZona(); ctx.soltarVista(vistaLibre); }
    modo = m; trazo = null; limpiarCapa();
    if (m === 'plano') ctx.registrarVista(vista); else ctx.soltarVista(vista);
    chip.hidden = !m;
    barraPlano.hidden = m !== 'plano'; barraLibreQ().hidden = barraMedidas.hidden = m !== 'libre';
    chip.textContent = m === 'plano' ? '✕ Salir del bisturí' : '✕ Salir del bisturí libre';
    lienzo.style.cursor = m ? 'crosshair' : '';
    if (!m) limpiarCapa();
    if (m === 'plano') { infoPlanos(); ctx.status('Bisturí: dibuja una línea cruzando la figura para crear un plano de corte.'); }
    if (m === 'libre') { ctx.registrarVista(vistaLibre); infoNodos(); ctx.status('Bisturí libre: toca alrededor de la zona para poner puntos y cierra tocando el primero.'); if (!zonaDesdePincel()) actualizarBarraLibre(); }
  }
  window.addEventListener('cajon-abierto', e => activar(e.detail === 'bisturi' ? 'plano' : e.detail === 'bisturiLibre' ? 'libre' : null));
  for (const id of ['vSeleccionar', 'vMover', 'vRotar', 'vEscalar', 'vCortePlano']) $(id)?.addEventListener('click', () => { if (modo) salir(); });
  infoPlanos();
}
