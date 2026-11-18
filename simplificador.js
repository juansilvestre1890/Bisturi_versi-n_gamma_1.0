// Simplificador de mallas (trabajador en segundo plano).
// Une triángulos donde la forma casi no cambia (zonas lisas) y conserva los detalles.
// Método de errores cuadráticos (Garland y Heckbert), en la versión rápida por umbrales
// de «Fast Quadric Mesh Simplification» (S. Forstmann, licencia MIT).
//
// Mensaje de entrada: { id, pos: Float32Array (xyz por vértice), idx: Uint32Array|null, col: Float32Array|null,
//                       objetivo: nº de triángulos deseado, tolerancia: error máx. relativo a la diagonal }
// Respuesta:          { id, pos, idx, col, antes, despues } o { id, error }

function soldar(pos, idx, col) {
  // Une vértices con la misma posición (las STL repiten cada vértice en cada cara).
  const n = pos.length / 3; let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < n; i++) { const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2]; if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z; if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z; }
  const diag = Math.hypot(maxx - minx, maxy - miny, maxz - minz) || 1, q = 1e6 / diag;
  const mapa = new Map(), remap = new Int32Array(n); let m = 0;
  const P = [], C = col ? [] : null;
  for (let i = 0; i < n; i++) {
    const k = Math.round((pos[3 * i] - minx) * q) + '_' + Math.round((pos[3 * i + 1] - miny) * q) + '_' + Math.round((pos[3 * i + 2] - minz) * q);
    let j = mapa.get(k);
    if (j === undefined) { j = m++; mapa.set(k, j); P.push(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]); if (C) C.push(col[3 * i], col[3 * i + 1], col[3 * i + 2]); }
    remap[i] = j;
  }
  const nt = idx ? idx.length / 3 : n / 3, T = new Int32Array(nt * 3); let t = 0;
  for (let f = 0; f < nt; f++) {
    const a = remap[idx ? idx[3 * f] : 3 * f], b = remap[idx ? idx[3 * f + 1] : 3 * f + 1], c = remap[idx ? idx[3 * f + 2] : 3 * f + 2];
    if (a === b || b === c || a === c) continue; // caras degeneradas
    T[t++] = a; T[t++] = b; T[t++] = c;
  }
  return { P: new Float64Array(P), C: C && new Float32Array(C), T: T.subarray(0, t), diag, min: [minx, miny, minz] };
}

function simplificar(P, T, objetivo, maxError) {
  const nv = P.length / 3; let nt = T.length / 3;
  const Q = new Float64Array(nv * 10), tstart = new Int32Array(nv), tcount = new Int32Array(nv), borde = new Uint8Array(nv);
  let TV = T, TE = new Float64Array(nt * 4), TN = new Float64Array(nt * 3), Tdel = new Uint8Array(nt), Tsucio = new Uint8Array(nt);
  let cap = nt * 3 + 1024, refT = new Int32Array(cap), refV = new Int8Array(cap), nref = 0;
  const pushRef = (t, v) => {
    if (nref >= cap) { cap = cap * 2; const a = new Int32Array(cap); a.set(refT); refT = a; const b = new Int8Array(cap); b.set(refV); refV = b; }
    refT[nref] = t; refV[nref] = v; nref++;
  };
  const res = new Float64Array(3);
  const det = (q, o, a11, a12, a13, a21, a22, a23, a31, a32, a33) =>
    q[o + a11] * q[o + a22] * q[o + a33] + q[o + a13] * q[o + a21] * q[o + a32] + q[o + a12] * q[o + a23] * q[o + a31]
    - q[o + a13] * q[o + a22] * q[o + a31] - q[o + a11] * q[o + a23] * q[o + a32] - q[o + a12] * q[o + a21] * q[o + a33];
  const qs = new Float64Array(10);
  const errV = (x, y, z) => qs[0] * x * x + 2 * qs[1] * x * y + 2 * qs[2] * x * z + 2 * qs[3] * x + qs[4] * y * y + 2 * qs[5] * y * z + 2 * qs[6] * y + qs[7] * z * z + 2 * qs[8] * z + qs[9];
  // Error de unir los vértices a y b; deja en «res» la mejor posición del vértice resultante.
  function calcError(a, b) {
    for (let k = 0; k < 10; k++) qs[k] = Q[a * 10 + k] + Q[b * 10 + k];
    const ambosBorde = borde[a] & borde[b], d = det(qs, 0, 0, 1, 2, 1, 4, 5, 2, 5, 7);
    if (d !== 0 && !ambosBorde) {
      res[0] = -1 / d * det(qs, 0, 1, 2, 3, 4, 5, 6, 5, 7, 8);
      res[1] = 1 / d * det(qs, 0, 0, 2, 3, 1, 5, 6, 2, 7, 8);
      res[2] = -1 / d * det(qs, 0, 0, 1, 3, 1, 4, 6, 2, 5, 8);
      return errV(res[0], res[1], res[2]);
    }
    const ax = P[3 * a], ay = P[3 * a + 1], az = P[3 * a + 2], bx = P[3 * b], by = P[3 * b + 1], bz = P[3 * b + 2];
    const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
    const e1 = errV(ax, ay, az), e2 = errV(bx, by, bz), e3 = errV(mx, my, mz), e = Math.min(e1, e2, e3);
    if (e === e1) { res[0] = ax; res[1] = ay; res[2] = az; } else if (e === e2) { res[0] = bx; res[1] = by; res[2] = bz; } else { res[0] = mx; res[1] = my; res[2] = mz; }
    return e;
  }
  function errTri(t) {
    let m = Infinity;
    for (let j = 0; j < 3; j++) { const e = calcError(TV[3 * t + j], TV[3 * t + (j + 1) % 3]); TE[4 * t + j] = e; if (e < m) m = e; }
    TE[4 * t + 3] = m;
  }
  function actualizarMalla(iter) {
    if (iter > 0) { // quitar triángulos borrados
      let d = 0;
      for (let t = 0; t < nt; t++) if (!Tdel[t]) {
        if (d !== t) { for (let k = 0; k < 3; k++) { TV[3 * d + k] = TV[3 * t + k]; TN[3 * d + k] = TN[3 * t + k]; } for (let k = 0; k < 4; k++) TE[4 * d + k] = TE[4 * t + k]; }
        Tdel[d] = 0; Tsucio[d] = 0; d++;
      }
      nt = d;
    }
    if (iter === 0) {
      for (let t = 0; t < nt; t++) {
        const a = TV[3 * t], b = TV[3 * t + 1], c = TV[3 * t + 2];
        const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2];
        const vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        TN[3 * t] = nx; TN[3 * t + 1] = ny; TN[3 * t + 2] = nz;
        const dd = -(nx * P[3 * a] + ny * P[3 * a + 1] + nz * P[3 * a + 2]);
        const m = [nx * nx, nx * ny, nx * nz, nx * dd, ny * ny, ny * nz, ny * dd, nz * nz, nz * dd, dd * dd];
        for (let j = 0; j < 3; j++) { const o = TV[3 * t + j] * 10; for (let k = 0; k < 10; k++) Q[o + k] += m[k]; }
      }
      for (let t = 0; t < nt; t++) errTri(t);
    }
    // referencias vértice → triángulos
    tcount.fill(0);
    for (let i = 0; i < nt * 3; i++) tcount[TV[i]]++;
    let s = 0; for (let v = 0; v < nv; v++) { tstart[v] = s; s += tcount[v]; tcount[v] = 0; }
    if (cap < s) { cap = s + 1024; refT = new Int32Array(cap); refV = new Int8Array(cap); }
    for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) { const v = TV[3 * t + j], r = tstart[v] + tcount[v]++; refT[r] = t; refV[r] = j; }
    nref = s;
    if (iter === 0) { // vértices de borde (aristas con una sola cara): no se mueven fuera del borde
      const cuenta = new Map();
      for (let v = 0; v < nv; v++) {
        cuenta.clear();
        for (let k = 0; k < tcount[v]; k++) { const t = refT[tstart[v] + k]; for (let j = 0; j < 3; j++) { const id = TV[3 * t + j]; if (id !== v) cuenta.set(id, (cuenta.get(id) || 0) + 1); } }
        for (const c of cuenta.values()) if (c === 1) { borde[v] = 1; break; }
      }
    }
  }
  let borr0 = new Uint8Array(64), borr1 = new Uint8Array(64);
  // ¿Unir a→p voltea alguna cara vecina? (marca en «borr» las que desaparecen)
  function volteado(px, py, pz, i0, i1, borr) {
    for (let k = 0; k < tcount[i0]; k++) {
      const t = refT[tstart[i0] + k]; if (Tdel[t]) continue;
      const s = refV[tstart[i0] + k], id1 = TV[3 * t + (s + 1) % 3], id2 = TV[3 * t + (s + 2) % 3];
      if (id1 === i1 || id2 === i1) { borr[k] = 1; continue; }
      let ax = P[3 * id1] - px, ay = P[3 * id1 + 1] - py, az = P[3 * id1 + 2] - pz, l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
      let bx = P[3 * id2] - px, by = P[3 * id2 + 1] - py, bz = P[3 * id2 + 2] - pz; l = Math.hypot(bx, by, bz) || 1; bx /= l; by /= l; bz /= l;
      if (Math.abs(ax * bx + ay * by + az * bz) > 0.999) return true;
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; l = Math.hypot(nx, ny, nz) || 1;
      borr[k] = 0;
      if ((nx * TN[3 * t] + ny * TN[3 * t + 1] + nz * TN[3 * t + 2]) / l < 0.2) return true;
    }
    return false;
  }
  // Condición de enlace: los dos vértices deben compartir exactamente dos vecinos (o uno en un borde).
  const sello = new Int32Array(nv); let marca = 0;
  function enlaceValido(i0, i1) {
    marca++;
    for (let k = 0; k < tcount[i0]; k++) { const t = refT[tstart[i0] + k]; if (Tdel[t]) continue; for (let j = 0; j < 3; j++) sello[TV[3 * t + j]] = marca; }
    let comunes = 0; marca++; const m1 = marca;
    for (let k = 0; k < tcount[i1]; k++) {
      const t = refT[tstart[i1] + k]; if (Tdel[t]) continue;
      for (let j = 0; j < 3; j++) { const v = TV[3 * t + j]; if (v === i0 || v === i1) continue; if (sello[v] === m1 - 1) { comunes++; sello[v] = m1; } }
    }
    return comunes === (borde[i0] && borde[i1] ? 1 : 2);
  }
  let borrados = 0;
  function actualizarTriangulos(i0, v, borr) {
    const n = tcount[v], s0 = tstart[v];
    for (let k = 0; k < n; k++) {
      const t = refT[s0 + k], j = refV[s0 + k]; if (Tdel[t]) continue;
      if (borr[k]) { Tdel[t] = 1; borrados++; continue; }
      TV[3 * t + j] = i0; Tsucio[t] = 1; errTri(t); pushRef(t, j);
    }
  }
  const total0 = nt;
  let iter = 0, quietas = 0;
  for (; iter < 100; iter++) {
    if (total0 - borrados <= objetivo) break;
    if (iter % 5 === 0) actualizarMalla(iter);
    Tsucio.fill(0, 0, nt);
    // el umbral sube en cada vuelta, pero nunca pasa del error permitido (más allá ya se notaría en la forma)
    const umbral = Math.min(1e-9 * Math.pow(iter + 3, 7), maxError), antesVuelta = borrados;
    for (let t = 0; t < nt; t++) {
      if (TE[4 * t + 3] > umbral || Tdel[t] || Tsucio[t]) continue;
      for (let j = 0; j < 3; j++) {
        if (TE[4 * t + j] >= umbral) continue;
        const i0 = TV[3 * t + j], i1 = TV[3 * t + (j + 1) % 3];
        if (borde[i0] !== borde[i1]) continue;
        if (!enlaceValido(i0, i1)) continue; // evitaría pliegues en «T» (aristas compartidas por más de dos caras)
        calcError(i0, i1); const px = res[0], py = res[1], pz = res[2];
        if (borr0.length < tcount[i0]) borr0 = new Uint8Array(tcount[i0] * 2);
        if (borr1.length < tcount[i1]) borr1 = new Uint8Array(tcount[i1] * 2);
        borr0.fill(0, 0, tcount[i0]); borr1.fill(0, 0, tcount[i1]);
        if (volteado(px, py, pz, i0, i1, borr0) || volteado(px, py, pz, i1, i0, borr1)) continue;
        P[3 * i0] = px; P[3 * i0 + 1] = py; P[3 * i0 + 2] = pz;
        for (let k = 0; k < 10; k++) Q[i0 * 10 + k] += Q[i1 * 10 + k];
        const ini = nref;
        actualizarTriangulos(i0, i0, borr0); actualizarTriangulos(i0, i1, borr1);
        const n = nref - ini;
        if (n <= tcount[i0]) { refT.copyWithin(tstart[i0], ini, ini + n); refV.copyWithin(tstart[i0], ini, ini + n); }
        else tstart[i0] = ini;
        tcount[i0] = n;
        break;
      }
      if (total0 - borrados <= objetivo) break;
    }
    if (umbral === maxError && borrados === antesVuelta && iter % 5 !== 4) { if (++quietas > 1) break; } else quietas = 0;
    if (iter % 5 === 4) postMessage({ progreso: Math.min(.99, borrados / Math.max(1, total0 - objetivo)) });
  }
  // compactar
  const usado = new Int32Array(nv).fill(-1); let m = 0, d = 0;
  for (let t = 0; t < nt; t++) if (!Tdel[t]) { for (let k = 0; k < 3; k++) TV[3 * d + k] = TV[3 * t + k]; d++; }
  nt = d;
  for (let i = 0; i < nt * 3; i++) { const v = TV[i]; if (usado[v] < 0) usado[v] = m++; }
  return { usado, m, TV: TV.subarray(0, nt * 3), nt };
}

self.onmessage = ({ data }) => {
  const { id, pos, idx, col, objetivo, tolerancia } = data;
  try {
    const s = soldar(pos, idx, col);
    // trabajar en una escala con diagonal 1 para que los umbrales sirvan para cualquier tamaño de modelo
    const k = 1 / s.diag, P = s.P;
    for (let i = 0; i < P.length; i += 3) { P[i] = (P[i] - s.min[0]) * k; P[i + 1] = (P[i + 1] - s.min[1]) * k; P[i + 2] = (P[i + 2] - s.min[2]) * k; }
    const antes = (idx ? idx.length : pos.length) / 3;
    const r = simplificar(P, s.T, objetivo, tolerancia * tolerancia);
    const out = new Float32Array(r.m * 3), outC = s.C ? new Float32Array(r.m * 3) : null;
    for (let v = 0; v < r.usado.length; v++) { const u = r.usado[v]; if (u < 0) continue;
      out[3 * u] = P[3 * v] / k + s.min[0]; out[3 * u + 1] = P[3 * v + 1] / k + s.min[1]; out[3 * u + 2] = P[3 * v + 2] / k + s.min[2];
      if (outC) { outC[3 * u] = s.C[3 * v]; outC[3 * u + 1] = s.C[3 * v + 1]; outC[3 * u + 2] = s.C[3 * v + 2]; } }
    const outI = new Uint32Array(r.nt * 3); for (let i = 0; i < outI.length; i++) outI[i] = r.usado[r.TV[i]];
    const transfer = [out.buffer, outI.buffer]; if (outC) transfer.push(outC.buffer);
    postMessage({ id, pos: out, idx: outI, col: outC, antes, despues: r.nt }, transfer);
  } catch (e) { postMessage({ id, error: String(e && e.message || e) }); }
};
