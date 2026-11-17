// Corte por plano (herramienta de la barra vertical).
// El plano siempre se ve y se maneja como un objeto: se mueve, se gira y se cambia de tamaño
// con el manipulador (los iconos Mover / Girar / Escalar de la barra actúan sobre él).
// Arriba al centro: X, Y, Z para orientarlo. Abajo a la derecha: «Hacer el corte».
// El tamaño del plano limita el corte: solo se separa lo que el plano atraviesa.
export function setupCortePlano(ctx) {
  const { THREE, scene, camera, renderer, orbit, TransformControls } = ctx;
  const $ = id => document.getElementById(id);
  const caja = renderer.domElement.parentElement;
  let activo = false, plano = null, gizmo = null, eje = 'Y', ocupado = false;

  // ---------- botones sobre la vista ----------
  const ejes = document.createElement('div');
  ejes.className = 'cp-ejes'; ejes.hidden = true;
  ejes.innerHTML = ['X', 'Y', 'Z'].map(a => `<button type="button" data-eje="${a}" title="Plano perpendicular al eje ${a}">${a}</button>`).join('');
  const cortar = document.createElement('button');
  cortar.type = 'button'; cortar.className = 'cp-cortar'; cortar.hidden = true; cortar.textContent = 'Hacer el corte';
  caja.append(ejes, cortar);
  for (const el of [ejes, cortar]) ['pointerdown', 'pointerup', 'pointermove'].forEach(t => el.addEventListener(t, e => e.stopPropagation()));

  const objetivos = () => ctx.selected && ctx.meshes.includes(ctx.selected) ? [ctx.selected] : ctx.meshes.filter(m => m.visible);
  const cajaDe = lista => { const b = new THREE.Box3(); for (const m of lista) b.expandByObject(m); return b; };

  function crearPlano() {
    const lista = objetivos(); if (!lista.length) { ctx.status('Abre un modelo para usar el corte por plano.'); return false; }
    const b = cajaDe(lista), c = b.getCenter(new THREE.Vector3()), lado = b.getSize(new THREE.Vector3()).length() * 0.75;
    const geo = new THREE.PlaneGeometry(1, 1);
    plano = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1f8fff, transparent: true, opacity: .32, side: THREE.DoubleSide, depthWrite: false }));
    const borde = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x41d2ff }));
    plano.add(borde); plano.renderOrder = 15; plano.position.copy(c); plano.scale.set(lado, lado, 1);
    scene.add(plano);
    gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; if (e.value) ctx.cerrarVista(false); else if (activo) ctx.abrirVista(); });
    gizmo.addEventListener('objectChange', () => { plano.scale.z = 1; });
    gizmo.setMode('translate');
    scene.add(gizmo.getHelper()); gizmo.attach(plano);
    orientar(eje);
    return true;
  }
  function quitarPlano() {
    if (gizmo) { gizmo.detach(); scene.remove(gizmo.getHelper()); gizmo.disconnect?.(); gizmo = null; orbit.enabled = true; }
    if (plano) { scene.remove(plano); plano.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); plano = null; }
  }
  // El plano de corte es perpendicular al eje elegido.
  function orientar(a) {
    eje = a; if (!plano) return;
    const q = new THREE.Quaternion();
    if (a === 'X') q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    else if (a === 'Y') q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    plano.quaternion.copy(q);
    ejes.querySelectorAll('button').forEach(b => b.classList.toggle('activo', b.dataset.eje === a));
  }
  ejes.addEventListener('click', e => { const b = e.target.closest('[data-eje]'); if (!b) return; ctx.cerrarVista(false); orientar(b.dataset.eje); ctx.abrirVista(); });

  // Corte que describe el plano tal como está ahora.
  function corteActual() {
    plano.updateMatrixWorld(true);
    const e = plano.matrixWorld.elements, u = new THREE.Vector3(e[0], e[1], e[2]), w = new THREE.Vector3(e[4], e[5], e[6]), normal = new THREE.Vector3(e[8], e[9], e[10]).normalize();
    const mitad = u.length() / 2, mitadW = w.length() / 2; u.normalize(); w.normalize();
    const centro = plano.getWorldPosition(new THREE.Vector3());
    return [{ normal, point: centro, cuadrado: { centro: centro.toArray(), u: u.toArray(), w: w.toArray(), mitad, mitadW } }];
  }
  // «Explosión» con el corte por plano activo: vista previa del corte.
  const vista = ctx.vistaPorCorte(async () => { const r = await ctx.cutWithPlanes(corteActual(), objetivos()); return r.hechos > 0; });
  // Durante la vista previa el plano se ve muy tenue para no tapar las piezas.
  const tenue = on => { if (!plano) return; plano.material.opacity = on ? .08 : .32; plano.children[0].material.opacity = on ? .35 : 1; plano.children[0].material.transparent = on; };
  const vI = vista.iniciar, vT = vista.terminar;
  let matrizVista = null;
  vista.iniciar = async () => { plano.updateMatrixWorld(true); matrizVista = plano.matrixWorld.clone(); const ok = await vI(); if (ok) tenue(true); return ok; };
  vista.terminar = c => { tenue(false); return vT(c); };
  cortar.onclick = async () => {
    if (!plano || ocupado) return;
    plano.updateMatrixWorld(true);
    if (ctx.enVista && !(matrizVista && matrizVista.equals(plano.matrixWorld))) ctx.cerrarVista(false);
    if (ctx.enVista) { ctx.cerrarVista(true); ctx.status('Corte hecho tal como lo viste en la vista previa. «Deshacer» lo devuelve.'); return; }
    if (ctx.busy()) return ctx.status('Vuelve a la vista ensamblada del modelo y desactiva Rayos X.');
    plano.updateMatrixWorld(true);
    const e = plano.matrixWorld.elements, u = new THREE.Vector3(e[0], e[1], e[2]), w = new THREE.Vector3(e[4], e[5], e[6]), normal = new THREE.Vector3(e[8], e[9], e[10]).normalize();
    const mitad = u.length() / 2, mitadW = w.length() / 2; u.normalize(); w.normalize();
    const centro = plano.getWorldPosition(new THREE.Vector3());
    ocupado = true; cortar.disabled = true;
    try {
      const r = await ctx.cutWithPlanes([{ normal, point: centro, cuadrado: { centro: centro.toArray(), u: u.toArray(), w: w.toArray(), mitad, mitadW } }], objetivos());
      if (!r.hechos) ctx.status('El plano no separó ninguna parte. Muévelo o agrándalo para que atraviese la pieza de lado a lado.');
      else ctx.status(`Corte hecho: ahora hay ${r.piezas} pieza(s).` + (r.avisos.length ? ' El modelo tiene partes que se cruzan; revisa las piezas en el laminador.' : ''));
    } catch (err) { console.error(err); ctx.status('No se pudo cortar: ' + err.message); }
    finally { ocupado = false; cortar.disabled = false; }
  };

  function activar(on) {
    if (on === activo) return;
    if (on && !crearPlano()) return;
    activo = on;
    if (!on) { ctx.soltarVista(vista); quitarPlano(); } else { ctx.registrarVista(vista); setTimeout(() => { if (activo) ctx.abrirVista(); }, 0); }
    ejes.hidden = cortar.hidden = !on;
    $('vCortePlano')?.classList.toggle('activo', on);
    if (on) ctx.status('Corte por plano: mueve, gira o cambia el tamaño del plano y pulsa «Hacer el corte». Solo se corta la zona que cubre el plano.');
  }
  $('vCortePlano')?.addEventListener('click', () => { if (!activo) window.dispatchEvent(new CustomEvent('cajon-abierto', { detail: null })); activar(!activo); });
  // Mover / Girar / Escalar de la barra vertical actúan sobre el plano mientras la herramienta está activa.
  const modos = { vMover: 'translate', vRotar: 'rotate', vEscalar: 'scale' };
  for (const [id, modo] of Object.entries(modos)) $(id)?.addEventListener('click', e => {
    if (!activo || !gizmo) return;
    e.stopImmediatePropagation(); gizmo.setMode(modo);
    for (const k of Object.keys(modos)) $(k)?.classList.toggle('activo', k === id);
  }, { capture: true });
  // Otra herramienta (bisturí, paneles) o Seleccionar desactivan el corte por plano.
  window.addEventListener('cajon-abierto', e => { if (e.detail) activar(false); });
  $('vSeleccionar')?.addEventListener('click', () => activar(false));
  const api = { activar, get activo() { return activo; }, get plano() { return plano; }, orientar };
  window.bisturiCortePlano = api;
  return api;
}
