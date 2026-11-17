// Bisturí curvo: se dibuja sobre la vista como el Bisturí, pero con puntos de control y
// manejadores (como la pluma de Photoshop). La curva atraviesa todo el modelo hacia el fondo,
// en la dirección en que se miraba al empezar a dibujar, y el corte sigue esa superficie curva.
//  · Tocar fuera de la curva pone un punto al final; si al ponerlo arrastras, sacas sus manejadores.
//  · Arrastrar un punto o un manejador lo mueve. Tocar la curva entre dos puntos añade uno ahí.
//  · Dos toques en un punto lo borran. «Esquina» cambia el punto elegido entre suave y pico.
//  · Dos dedos (o botón derecho) giran la vista; la curva queda pegada al modelo.

export function setupBisturiCurvo(ctx) {
  const { THREE, scene, camera, renderer, orbit, status } = ctx;
  const $ = id => document.getElementById(id);
  const lienzo = renderer.domElement, caja = lienzo.parentElement;
  let activo = false, ocupado = false;

  // Plano de dibujo (fijo desde el primer punto): origen O, ejes U, V y normal N (dirección del corte).
  let plano = null;
  // Puntos: posición y manejadores (desplazamientos) en coordenadas (u, v) del plano.
  let puntos = [], elegido = -1;

  // ---------- barra y capa de dibujo ----------
  const barra = document.createElement('div'); barra.className = 'bisturi-barra abajo'; barra.hidden = true;
  barra.innerHTML = `<p class="bisturi-info bc-info">Toca fuera de la figura para poner el primer punto.</p>
    <button type="button" class="secondary bc-esquina" disabled title="Punto elegido: curva suave o esquina (pico)">Esquina</button>
    <button type="button" class="secondary bc-quitar">Quitar punto</button>
    <button type="button" class="secondary bc-borrar">Borrar curva</button>
    <button type="button" class="bc-cortar" disabled>Hacer el corte</button>`;
  ['pointerdown', 'pointerup', 'pointermove', 'wheel'].forEach(t => barra.addEventListener(t, e => e.stopPropagation()));
  caja.append(barra);
  const q = s => barra.querySelector(s), info = t => { q('.bc-info').textContent = t; };
  const capa = document.createElement('canvas'); capa.className = 'bc-capa'; capa.hidden = true; caja.append(capa);
  const c2 = capa.getContext('2d');

  // Lámina translúcida que muestra la superficie de corte en 3D.
  const matLamina = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: .22, side: THREE.DoubleSide, depthWrite: false });
  const lamina = new THREE.Mesh(new THREE.BufferGeometry(), matLamina); lamina.visible = false; lamina.renderOrder = 8; lamina.raycast = () => {};
  scene.add(lamina);

  // ---------- geometría del modelo ----------
  const visibles = () => ctx.meshes.filter(m => m.visible);
  // Se cortan todas las piezas visibles que la curva atraviesa (para cortar solo una, oculta las demás).
  const objetivos = () => visibles();
  function cajaModelo(lista = visibles()) { const b = new THREE.Box3(); for (const m of lista) { m.updateWorldMatrix(true, false); b.expandByObject(m); } return b; }

  // ---------- conversión pantalla ↔ plano ----------
  const rect = () => lienzo.getBoundingClientRect();
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function enPlano(cx, cy) {
    const r = rect(); ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(plano.N, plano.O), p = new THREE.Vector3();
    if (Math.abs(ray.ray.direction.dot(plano.N)) < 0.08) return null; // de canto: no se puede dibujar
    if (!ray.ray.intersectPlane(pl, p)) return null;
    p.sub(plano.O); return { u: p.dot(plano.U), v: p.dot(plano.V) };
  }
  const aMundo = (u, v, w = 0) => plano.O.clone().addScaledVector(plano.U, u).addScaledVector(plano.V, v).addScaledVector(plano.N, w);
  function aPantalla(u, v, w = 0) { const r = rect(), p = aMundo(u, v, w).project(camera); return { x: (p.x + 1) / 2 * r.width, y: (1 - p.y) / 2 * r.height, z: p.z }; }
  function crearPlano() {
    const b = cajaModelo(); if (b.isEmpty()) return false;
    const N = new THREE.Vector3(); camera.getWorldDirection(N);
    const V = camera.up.clone().projectOnPlane(N); if (V.lengthSq() < 1e-8) V.set(0, 0, 1).projectOnPlane(N); V.normalize();
    const U = new THREE.Vector3().crossVectors(V, N).normalize();
    plano = { O: b.getCenter(new THREE.Vector3()), U, V, N, diag: b.getSize(new THREE.Vector3()).length() };
    return true;
  }

  // ---------- la curva (Bézier cúbica por tramos) ----------
  const bez = (a, b, c, d, t) => { const s = 1 - t; return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d; };
  function tramo(i, t) {
    const A = puntos[i], B = puntos[i + 1];
    return { u: bez(A.u, A.u + A.ou, B.u + B.iu, B.u, t), v: bez(A.v, A.v + A.ov, B.v + B.iv, B.v, t) };
  }
  function muestras(porTramo = 24) {
    const out = []; if (!puntos.length) return out;
    out.push({ u: puntos[0].u, v: puntos[0].v, i: 0, t: 0 });
    for (let i = 0; i + 1 < puntos.length; i++) for (let k = 1; k <= porTramo; k++) { const p = tramo(i, k / porTramo); out.push({ ...p, i, t: k / porTramo }); }
    return out;
  }
  // Dirección hacia fuera en cada extremo (para prolongar la curva fuera del modelo).
  function tangenteExtremo(final) {
    const s = muestras(); if (s.length < 2) return null;
    const a = final ? s[s.length - 2] : s[1], b = final ? s[s.length - 1] : s[0];
    let du = b.u - a.u, dv = b.v - a.v; const l = Math.hypot(du, dv); if (l < 1e-9) return null; return { u: du / l, v: dv / l };
  }

  // Manejadores de un punto. Si un manejador todavía no existe (punto puesto con un toque) se ofrece
  // uno «virtual» en la dirección de la curva, para poder tirar de él. El primer punto no tiene
  // manejador de entrada ni el último de salida (no cambiarían la curva).
  function manejadores(i) {
    const P = puntos[i], ant = puntos[i - 1], sig = puntos[i + 1], out = [];
    let tu = (sig ? sig.u : P.u) - (ant ? ant.u : P.u), tv = (sig ? sig.v : P.v) - (ant ? ant.v : P.v);
    const tl = Math.hypot(tu, tv) || 1; tu /= tl; tv /= tl;
    if (ant) { const real = Math.hypot(P.iu, P.iv) > 1e-9, L = Math.hypot(P.u - ant.u, P.v - ant.v) * 0.3; out.push({ k: 'i', du: real ? P.iu : -tu * L, dv: real ? P.iv : -tv * L, virtual: !real }); }
    if (sig) { const real = Math.hypot(P.ou, P.ov) > 1e-9, L = Math.hypot(sig.u - P.u, sig.v - P.v) * 0.3; out.push({ k: 'o', du: real ? P.ou : tu * L, dv: real ? P.ov : tv * L, virtual: !real }); }
    return out;
  }

  // ---------- dibujo ----------
  function dibujar() {
    if (!activo) { capa.hidden = true; return; }
    const r = rect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    capa.hidden = false;
    if (capa.width !== Math.round(r.width * dpr) || capa.height !== Math.round(r.height * dpr)) { capa.width = Math.round(r.width * dpr); capa.height = Math.round(r.height * dpr); }
    capa.style.width = r.width + 'px'; capa.style.height = r.height + 'px';
    c2.setTransform(dpr, 0, 0, dpr, 0, 0); c2.clearRect(0, 0, r.width, r.height);
    if (!plano || !puntos.length || ctx.enVista) return;
    const s = muestras().map(p => aPantalla(p.u, p.v));
    // Prolongaciones discontinuas: así se ve que el corte sigue recto fuera de la curva.
    c2.setLineDash([7, 6]); c2.lineWidth = 2; c2.strokeStyle = '#ffb020aa';
    for (const fin of [false, true]) {
      const t = tangenteExtremo(fin); if (!t) continue;
      const p0 = fin ? puntos[puntos.length - 1] : puntos[0], L = plano.diag, k = 1;
      const a = aPantalla(p0.u, p0.v), b = aPantalla(p0.u + k * t.u * L, p0.v + k * t.v * L);
      c2.beginPath(); c2.moveTo(a.x, a.y); c2.lineTo(b.x, b.y); c2.stroke();
    }
    c2.setLineDash([]); c2.lineWidth = 3; c2.strokeStyle = '#ffb020';
    c2.beginPath(); s.forEach((p, i) => i ? c2.lineTo(p.x, p.y) : c2.moveTo(p.x, p.y)); c2.stroke();
    // Manejadores del punto elegido (y de sus vecinos, más tenues).
    puntos.forEach((p, i) => {
      if (Math.abs(i - elegido) > 1 || elegido < 0) return;
      const a = aPantalla(p.u, p.v), fuerte = i === elegido;
      for (const m of manejadores(i)) {
        if (m.virtual && !fuerte) continue;
        const h = aPantalla(p.u + m.du, p.v + m.dv);
        c2.lineWidth = 2; c2.strokeStyle = fuerte ? '#7fd3ff' : '#7fd3ff66'; c2.setLineDash(m.virtual ? [4, 4] : []);
        c2.beginPath(); c2.moveTo(a.x, a.y); c2.lineTo(h.x, h.y); c2.stroke(); c2.setLineDash([]);
        c2.beginPath(); c2.arc(h.x, h.y, fuerte ? 8 : 5, 0, Math.PI * 2);
        if (m.virtual) { c2.fillStyle = '#0b1e3d'; c2.fill(); c2.lineWidth = 2.5; c2.strokeStyle = '#7fd3ff'; c2.stroke(); }
        else { c2.fillStyle = fuerte ? '#7fd3ff' : '#7fd3ff66'; c2.fill(); c2.lineWidth = 1.5; c2.strokeStyle = '#0b1e3d'; c2.stroke(); }
      }
    });
    puntos.forEach((p, i) => {
      const a = aPantalla(p.u, p.v), lado = i === elegido ? 13 : 10;
      c2.fillStyle = i === elegido ? '#ffb020' : '#ffffff'; c2.strokeStyle = '#0b1e3d'; c2.lineWidth = 2;
      c2.beginPath();
      if (p.esquina) c2.rect(a.x - lado / 2, a.y - lado / 2, lado, lado); else c2.arc(a.x, a.y, lado / 2 + 1, 0, Math.PI * 2);
      c2.fill(); c2.stroke();
    });
  }
  (function bucle() { if (activo) dibujar(); requestAnimationFrame(bucle); })();

  // ---------- cortador: lámina extruida → sólido cerrado ----------
  function poligonoCorte() {
    const s = muestras(32).map(p => ({ u: p.u, v: p.v }));
    if (s.length < 2) throw Error('Pon al menos dos puntos para dibujar la curva.');
    const L = plano.diag * 2.5;
    const t0 = tangenteExtremo(false), t1 = tangenteExtremo(true);
    s.unshift({ u: s[0].u + t0.u * L, v: s[0].v + t0.v * L });
    s.push({ u: s[s.length - 1].u + t1.u * L, v: s[s.length - 1].v + t1.v * L });
    // Se cierra por el lado al que la curva se asoma menos.
    const a = s[0], b = s[s.length - 1]; let cu = b.u - a.u, cv = b.v - a.v; const cl = Math.hypot(cu, cv) || 1; cu /= cl; cv /= cl;
    const nu = -cv, nv = cu; let mx = -Infinity, mn = Infinity;
    for (const p of s) { const d = (p.u - a.u) * nu + (p.v - a.v) * nv; mx = Math.max(mx, d); mn = Math.min(mn, d); }
    const lado = mx <= -mn ? 1 : -1, lejos = (lado > 0 ? mx : -mn) + L;
    const cierre = p => { const d = ((p.u - a.u) * nu + (p.v - a.v) * nv) * lado; return { u: p.u + nu * lado * (lejos - d), v: p.v + nv * lado * (lejos - d) }; };
    const pol = [...s, cierre(b), cierre(a)];
    // Quita puntos repetidos y comprueba que la curva no se cruce.
    const limpio = pol.filter((p, i) => { const o = pol[(i + pol.length - 1) % pol.length]; return Math.hypot(p.u - o.u, p.v - o.v) > plano.diag * 1e-6; });
    if (seCruza(limpio)) throw Error('La curva se cruza consigo misma; mueve los puntos o los manejadores para que no se cruce.');
    return limpio;
  }
  function seCruza(P) {
    const n = P.length, cruz = (a, b, c) => (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const c = P[j], d = P[(j + 1) % n];
        const d1 = cruz(a, b, c), d2 = cruz(a, b, d), d3 = cruz(c, d, a), d4 = cruz(c, d, b);
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
      }
    }
    return false;
  }
  function cortador(du = 0, dv = 0) {
    let pol = poligonoCorte().map(p => ({ u: p.u + du, v: p.v + dv }));
    let area = 0; for (let i = 0; i < pol.length; i++) { const a = pol[i], b = pol[(i + 1) % pol.length]; area += a.u * b.v - b.u * a.v; }
    if (area < 0) pol = pol.reverse();
    const n = pol.length, D = plano.diag * 1.5, pos = new Float32Array(n * 6), idx = [];
    pol.forEach((p, i) => { const f = aMundo(p.u, p.v, D), t = aMundo(p.u, p.v, -D); pos.set([f.x, f.y, f.z], 3 * i); pos.set([t.x, t.y, t.z], 3 * (n + i)); });
    const tri = THREE.ShapeUtils.triangulateShape(pol.map(p => new THREE.Vector2(p.u, p.v)), []);
    const P = i => new THREE.Vector3(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
    const orientado = (a, b, c, quiero) => { const nrm = new THREE.Vector3().crossVectors(P(b).sub(P(a)), P(c).sub(P(a))); return nrm.dot(quiero) >= 0 ? [a, b, c] : [a, c, b]; };
    for (const [a, b, c] of tri) { idx.push(...orientado(a, b, c, plano.N)); idx.push(...orientado(n + a, n + b, n + c, plano.N.clone().negate())); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(n + i, n + j, j, n + i, j, i); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    // Comprobación de orientación por volumen (debe ser positivo).
    let vol = 0; for (let k = 0; k < idx.length; k += 3) { const a = P(idx[k]), b = P(idx[k + 1]), c = P(idx[k + 2]); vol += a.dot(b.cross(c)); }
    if (vol < 0) { for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]]; g.setIndex(idx); }
    g.computeVertexNormals(); g.computeBoundingBox();
    return g;
  }

  // Lámina visible: la curva prolongada un poco y extruida a lo largo del modelo.
  function actualizarLamina() {
    if (!plano || puntos.length < 2) { lamina.visible = false; return; }
    const s = muestras(16), D = plano.diag * 0.6, pos = [], idx = [];
    s.forEach((p, i) => { const a = aMundo(p.u, p.v, D), b = aMundo(p.u, p.v, -D); pos.push(a.x, a.y, a.z, b.x, b.y, b.z); if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i + 1, 2 * i - 2, 2 * i + 1, 2 * i); });
    lamina.geometry.dispose(); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); lamina.geometry = g;
    lamina.visible = activo && !ctx.enVista;
  }
  function cambio() {
    actualizarLamina(); q('.bc-cortar').disabled = puntos.length < 2 || ocupado;
    if (ctx.enVista) ctx.rehacerVista?.();
  }

  // ---------- corte ----------
  async function cortarAhora() {
    if (!plano || puntos.length < 2) { status('Primero pon al menos dos puntos, uno a cada lado de la figura.'); return false; }
    let geo; try { geo = cortador(); } catch (e) { status('No se pudo cortar: ' + e.message); return false; }
    // Variantes desplazadas una diezmilésima: si el booleano deja algún defecto se prueba otra.
    const d = plano.diag * 1e-4, alternativas = [[d, d * 0.7], [-d * 0.6, d * 1.3]].map(([u, v]) => { const g = cortador(u, v); return { hueco: g, pieza: g }; });
    const bb = geo.boundingBox, lista = objetivos().filter(m => { m.updateWorldMatrix(true, false); return new THREE.Box3().setFromObject(m).intersectsBox(bb); });
    const marca = ctx.marcaDeshacer?.() ?? 0; let hechos = 0, ultimoError = '';
    lamina.visible = false;
    for (const m of lista) {
      try { await ctx.cutFreeShape(m, { hueco: geo, pieza: geo, alternativas }, null); hechos++; }
      catch (e) { if (!/no corta|abarca toda/.test(e.message)) { console.error(e); ultimoError = e.message; } }
    }
    ctx.unirDeshacer?.(marca);
    geo.dispose(); for (const a of alternativas) a.hueco.dispose();
    if (!hechos) { status(ultimoError ? 'No se pudo cortar: ' + ultimoError : 'La curva no atraviesa ninguna pieza. Dibuja la curva cruzando la figura de lado a lado.'); lamina.visible = activo; return false; }
    return true;
  }
  const vista = ctx.vistaPorCorte(cortarAhora);
  vista.texto = 'Vista previa del corte curvo: mueve el deslizador para ver las piezas separadas. «Hacer el corte» corta.';
  const vT = vista.terminar.bind(vista);
  vista.terminar = c => { const r = vT(c); lamina.visible = activo && !c && puntos.length > 1; return r; };
  q('.bc-cortar').onclick = async () => {
    if (ocupado || puntos.length < 2) return;
    if (ctx.enVista) { ctx.cerrarVista(true); reiniciar(); status('Corte curvo hecho tal como lo viste en la vista previa. «Deshacer» lo devuelve.'); return; }
    if (ctx.busy()) return status('Vuelve a la vista ensamblada del modelo y desactiva Rayos X.');
    ocupado = true; q('.bc-cortar').disabled = true; status('Cortando por la curva…');
    try { if (await cortarAhora()) { reiniciar(); status('Corte curvo hecho. «Deshacer» lo devuelve.'); } }
    catch (e) { console.error(e); status('No se pudo cortar: ' + e.message); }
    finally { ocupado = false; q('.bc-cortar').disabled = puntos.length < 2; }
  };
  q('.bc-borrar').onclick = () => { if (ctx.enVista) ctx.cerrarVista(false); reiniciar(); info('Curva borrada. Toca fuera de la figura para empezar otra.'); };
  // «Esquina»: el punto elegido pasa a pico (cada manejador por separado) o vuelve a suave.
  function pintarEsquina() { const P = puntos[elegido]; q('.bc-esquina').disabled = !P; q('.bc-esquina').classList.toggle('activo', !!P?.esquina); }
  q('.bc-esquina').onclick = () => {
    const P = puntos[elegido]; if (!P) return; if (ctx.enVista) ctx.cerrarVista(false);
    P.esquina = !P.esquina;
    if (!P.esquina) { const lo = Math.hypot(P.ou, P.ov), li = Math.hypot(P.iu, P.iv); if (lo > 1e-9 && li > 1e-9) { P.iu = -P.ou * li / lo; P.iv = -P.ov * li / lo; } }
    info(P.esquina ? 'Punto en esquina: cada manejador se mueve por separado.' : 'Punto suave: los manejadores se mueven juntos.');
    pintarEsquina(); cambio(); if (puntos.length > 1) ctx.abrirVista();
  };
  q('.bc-quitar').onclick = () => {
    if (!puntos.length) return; if (ctx.enVista) ctx.cerrarVista(false);
    puntos.splice(elegido >= 0 ? elegido : puntos.length - 1, 1); elegido = puntos.length - 1;
    if (!puntos.length) plano = null; cambio(); textoAyuda();
  };
  function reiniciar() { puntos = []; elegido = -1; plano = null; lamina.visible = false; q(".bc-cortar").disabled = true; textoAyuda(); pintarEsquina(); }
  function textoAyuda() {
    info(!puntos.length ? 'Toca fuera de la figura para poner el primer punto.'
      : puntos.length === 1 ? 'Pon el siguiente punto al otro lado de la figura. Arrastra al ponerlo para curvar.'
      : 'Arrastra puntos y manejadores para ajustar la curva. Dos toques en un punto lo borran.');
  }

  // ---------- interacción ----------
  // El gesto empieza tras mover un poco o esperar 90 ms: si llega un segundo dedo, es un giro de cámara.
  const dedos = new Set(); let gesto = null, original = null, ultimoToque = null, pulsacion = 0;
  function remapear(on) {
    if (on && !original) {
      original = { L: orbit.mouseButtons.LEFT, R: orbit.mouseButtons.RIGHT, U: orbit.touches.ONE, D: orbit.touches.TWO };
      orbit.mouseButtons.LEFT = null; orbit.mouseButtons.RIGHT = THREE.MOUSE.ROTATE; orbit.touches.ONE = null; orbit.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    } else if (!on && original) { orbit.mouseButtons.LEFT = original.L; orbit.mouseButtons.RIGHT = original.R; orbit.touches.ONE = original.U; orbit.touches.TWO = original.D; original = null; }
  }
  function buscar(cx, cy, tactil = false) {
    if (!plano) return null;
    const radio = tactil ? 26 : 16;
    const r = rect(), x = cx - r.left, y = cy - r.top;
    if (elegido >= 0 && puntos[elegido]) {
      const p = puntos[elegido]; let mj = null;
      for (const m of manejadores(elegido)) {
        const h = aPantalla(p.u + m.du, p.v + m.dv), d = Math.hypot(h.x - x, h.y - y);
        if (d <= radio && (!mj || d < mj.d)) mj = { tipo: 'manejador', i: elegido, k: m.k, d };
      }
      if (mj) return mj;
    }
    let mejor = null;
    puntos.forEach((p, i) => { const a = aPantalla(p.u, p.v), d = Math.hypot(a.x - x, a.y - y); if (d <= radio && (!mejor || d < mejor.d)) mejor = { tipo: 'punto', i, d }; });
    if (mejor) return mejor;
    if (puntos.length > 1) {
      const s = muestras(32); let mj = null;
      for (let k = 1; k < s.length; k++) {
        const a = aPantalla(s[k - 1].u, s[k - 1].v), b = aPantalla(s[k].u, s[k].v), dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)), d = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
        if (d <= 12 && (!mj || d < mj.d)) mj = { tipo: 'curva', i: s[k].i, t: s[k - 1].i === s[k].i ? s[k - 1].t + t * (s[k].t - s[k - 1].t) : t * s[k].t, d };
      }
      if (mj) return mj;
    }
    return null;
  }
  // Divide el tramo i en t sin cambiar la forma (de Casteljau).
  function partir(i, t) {
    const A = puntos[i], B = puntos[i + 1], l = (a, b) => a + (b - a) * t;
    const P0 = [A.u, A.v], P1 = [A.u + A.ou, A.v + A.ov], P2 = [B.u + B.iu, B.v + B.iv], P3 = [B.u, B.v];
    const m = (a, b) => [l(a[0], b[0]), l(a[1], b[1])];
    const Q0 = m(P0, P1), Q1 = m(P1, P2), Q2 = m(P2, P3), R0 = m(Q0, Q1), R1 = m(Q1, Q2), S = m(R0, R1);
    A.ou = Q0[0] - A.u; A.ov = Q0[1] - A.v; B.iu = Q2[0] - B.u; B.iv = Q2[1] - B.v;
    const nuevo = { u: S[0], v: S[1], iu: R0[0] - S[0], iv: R0[1] - S[1], ou: R1[0] - S[0], ov: R1[1] - S[1], esquina: false };
    puntos.splice(i + 1, 0, nuevo); return i + 1;
  }
  function empezarGesto(g) {
    const e = g.ev; let p = null;
    if (!plano) { if (!crearPlano()) return; }
    const obj = buscar(e.clientX, e.clientY, e.pointerType !== 'mouse');
    if (obj?.tipo === 'manejador') { gesto = { ...g, modo: 'manejador', i: obj.i, k: obj.k }; return; }
    if (obj?.tipo === 'punto') { elegido = obj.i; gesto = { ...g, modo: 'punto', i: obj.i }; return; }
    if (obj?.tipo === 'curva') { elegido = partir(obj.i, obj.t); gesto = { ...g, modo: 'punto', i: elegido, nuevo: true }; cambio(); return; }
    p = enPlano(e.clientX, e.clientY); if (!p) { status('Gira la vista: el plano de la curva está de canto.'); return; }
    puntos.push({ u: p.u, v: p.v, iu: 0, iv: 0, ou: 0, ov: 0, esquina: false }); elegido = puntos.length - 1;
    gesto = { ...g, modo: 'nuevo', i: elegido }; cambio(); textoAyuda();
  }
  function moverGesto(e) {
    const p = enPlano(e.clientX, e.clientY); if (!p || !gesto) return;
    const P = puntos[gesto.i]; if (!P) return;
    if (gesto.modo === 'punto') { P.u = p.u; P.v = p.v; }
    else if (gesto.modo === 'nuevo') { P.ou = p.u - P.u; P.ov = p.v - P.v; P.iu = -P.ou; P.iv = -P.ov; P.esquina = false; }
    else if (gesto.modo === 'manejador') {
      const du = p.u - P.u, dv = p.v - P.v;
      if (gesto.k === 'o') { P.ou = du; P.ov = dv; } else { P.iu = du; P.iv = dv; }
      if (!P.esquina) { // suave: el otro manejador queda alineado, con su propio largo (o el de su manejador virtual)
        const otro = manejadores(gesto.i).find(m => m.k !== gesto.k);
        const lo = otro ? Math.hypot(otro.du, otro.dv) : 0, l = Math.hypot(du, dv) || 1;
        const nu = -du / l * lo, nv = -dv / l * lo; if (gesto.k === 'o') { P.iu = nu; P.iv = nv; } else { P.ou = nu; P.ov = nv; }
      }
    }
    cambio();
  }
  const pausaVista = () => { if (ctx.enVista) ctx.cerrarVista(false); };
  caja.addEventListener('pointerdown', e => {
    if (e.target === lienzo) dedos.add(e.pointerId);
    if (!activo || ocupado || e.target !== lienzo) return;
    if (dedos.size > 1 || e.button !== 0) { // segundo dedo: es un giro
      if (gesto?.espera) { clearTimeout(gesto.espera); gesto = null; }
      clearTimeout(pulsacion); return;
    }
    pausaVista();
    const g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, ev: e, movido: false };
    if (e.pointerType === 'mouse') empezarGesto(g);
    else { gesto = { ...g, espera: setTimeout(() => { if (gesto && gesto.espera && dedos.size === 1) { const gg = gesto; gesto = null; empezarGesto({ ...gg, espera: 0 }); } }, 90) }; }
  }, { capture: true });
  caja.addEventListener('pointermove', e => {
    if (!activo || !gesto || gesto.id !== e.pointerId) return;
    if (dedos.size > 1) { if (gesto.espera) clearTimeout(gesto.espera); gesto = null; clearTimeout(pulsacion); return; }
    const lejos = Math.hypot(e.clientX - gesto.x, e.clientY - gesto.y) > 6;
    if (gesto.espera) { if (!lejos) return; clearTimeout(gesto.espera); const gg = gesto; gesto = null; empezarGesto({ ...gg, espera: 0 }); if (!gesto) return; }
    if (lejos) { gesto.movido = true; clearTimeout(pulsacion); }
    if (gesto.movido) moverGesto(e);
  }, { capture: true });
  const fin = e => {
    dedos.delete(e.pointerId);
    if (!activo || !gesto || gesto.id !== e.pointerId) return;
    clearTimeout(pulsacion);
    if (gesto.espera) { clearTimeout(gesto.espera); const gg = gesto; gesto = null; if (e.type === 'pointercancel') return; empezarGesto({ ...gg, espera: 0 }); if (!gesto) return; }
    const g = gesto; gesto = null;
    // Solo dos toques seguidos sobre el mismo punto lo borran (un toque solo lo elige).
    if (g.modo === 'punto' && !g.movido && !g.nuevo) {
      const ant = ultimoToque; ultimoToque = { i: g.i, t: e.timeStamp };
      // Se mide desde que se soltó el primer toque hasta que empieza el segundo.
      if (ant && ant.i === g.i && g.t - ant.t < 450) {
        ultimoToque = null; puntos.splice(g.i, 1); elegido = Math.min(g.i, puntos.length - 1);
        if (!puntos.length) plano = null; cambio(); textoAyuda(); info('Punto borrado.');
      }
    } else ultimoToque = null;
    pintarEsquina();
    if (puntos.length > 1) ctx.abrirVista();
  };
  caja.addEventListener('pointerup', fin, { capture: true });
  caja.addEventListener('pointercancel', fin, { capture: true });

  // ---------- activar / salir ----------
  function activar(on) {
    if (on === activo) return;
    if (on && ctx.busy()) { status('Vuelve a la vista ensamblada y desactiva Rayos X para usar el bisturí curvo.'); $('vBisturiCurvo')?.classList.remove('activo'); return; }
    activo = on; barra.hidden = !on; remapear(on);
    if (on) { ctx.registrarVista(vista); ctx.onActivo?.(true); reiniciar(); status('Bisturí curvo: toca fuera de la figura para poner el primer punto y ve poniendo puntos al otro lado. Arrastra al ponerlos para curvar.'); }
    else { ctx.soltarVista(vista); reiniciar(); gesto = null; dibujar(); }
  }
  window.addEventListener('cajon-abierto', e => activar(e.detail === 'bisturiCurvo'));
  for (const id of ['vSeleccionar', 'vMover', 'vRotar', 'vEscalar', 'vCortePlano']) $(id)?.addEventListener('click', () => { if (activo) window.dispatchEvent(new CustomEvent('cajon-abierto', { detail: null })); });
  const api = {
    activar, get activo() { return activo; }, get puntos() { return puntos.map(p => ({ ...p })); }, get plano() { return plano; },
    fijar(lista) { if (!plano) crearPlano(); puntos = lista.map(p => ({ iu: 0, iv: 0, ou: 0, ov: 0, esquina: false, ...p })); elegido = puntos.length - 1; cambio(); textoAyuda(); },
    aPantalla: (u, v) => { const r = rect(), p = aPantalla(u, v); return { x: r.left + p.x, y: r.top + p.y }; }, cortador
  };
  window.bisturiCurvo = api;
  return api;
}
