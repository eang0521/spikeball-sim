// Ball physics: gravity + quadratic drag, collisions with the net surface,
// rim, frame and ground, trajectory prediction and shot solving.
(function (SB) {
  'use strict';
  const C = SB.C;

  function freeStep(p, v, dt) {
    const sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    const k = C.DRAG * sp;
    v.x -= k * v.x * dt;
    v.y -= (C.G + k * v.y) * dt;
    v.z -= k * v.z * dt;
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
  }

  function rimHit(x, y, z) {
    const rh = Math.sqrt(x * x + z * z);
    const dr = rh - C.NET_R;
    const dy = y - C.NET_H;
    const lim = C.BALL_R + C.RIM_TUBE;
    return dr * dr + dy * dy < lim * lim;
  }

  // Test the segment prev -> p for a collision. Returns null or an event.
  function collide(prev, p, skipRim) {
    const R = C.NET_R;
    const top = C.NET_H + C.BALL_R;

    if (prev.y >= top && p.y < top) {
      const f = (prev.y - top) / (prev.y - p.y);
      const cx = prev.x + (p.x - prev.x) * f;
      const cz = prev.z + (p.z - prev.z) * f;
      const rc = Math.sqrt(cx * cx + cz * cz);
      if (rc < R - C.RIM_TUBE * 0.5) return { type: 'net', x: cx, z: cz, rc };
    }
    // sample the segment so fast balls cannot tunnel through the rim tube
    for (let i = 1; i <= 3 && !skipRim; i++) {
      const f = i / 3;
      const x = prev.x + (p.x - prev.x) * f;
      const y = prev.y + (p.y - prev.y) * f;
      const z = prev.z + (p.z - prev.z) * f;
      if (rimHit(x, y, z)) return { type: 'rim', x, y, z };
    }
    const rh = Math.sqrt(p.x * p.x + p.z * p.z);
    if (!skipRim && p.y < C.NET_H && p.y > 0 && rh < R + C.BALL_R) {
      const prh = Math.sqrt(prev.x * prev.x + prev.z * prev.z);
      if (prh >= R + C.BALL_R - 1e-6 || prev.y >= C.NET_H) return { type: 'frame', x: p.x, y: p.y, z: p.z };
    }
    if (p.y <= C.BALL_R) return { type: 'ground' };
    return null;
  }

  // Trampoline response. rng adds a little irregularity; omit it for predictions.
  function netBounce(p, v, ev, rng) {
    p.x = ev.x;
    p.z = ev.z;
    p.y = C.NET_H + C.BALL_R;
    const pocket = ev.rc > C.NET_R - C.POCKET_W;
    const vin = -v.y;
    const rollup = vin < C.ROLLUP_VY;
    // the net gives more on hard hits, so fast balls come off relatively lower
    let e = pocket ? C.POCKET_E : Math.max(0.25, C.NET_E - 0.034 * vin) * (1 - 0.1 * (ev.rc / C.NET_R));
    v.y = vin * e;
    const keep = pocket ? 1.0 : C.NET_KEEP_H;
    v.x *= keep;
    v.z *= keep;
    if (pocket && ev.rc > 1e-6) {
      v.x += (ev.x / ev.rc) * 1.3;
      v.z += (ev.z / ev.rc) * 1.3;
    }
    if (rollup) {
      v.y = Math.max(v.y, 0.25);
    }
    if (rng) {
      v.x += rng.gauss() * 0.12;
      v.z += rng.gauss() * 0.12;
      v.y *= 1 + rng.gauss() * 0.03;
    }
    return { pocket, rollup, vin };
  }

  // Visual-only responses for dead balls or after a fault has been called.
  function bounceVisual(p, v, ev) {
    if (ev.type === 'ground') {
      p.y = C.BALL_R;
      if (v.y < 0) v.y = -v.y * C.GROUND_E;
      v.x *= 0.72;
      v.z *= 0.72;
      if (Math.abs(v.y) < 0.4) v.y = 0;
    } else if (ev.type === 'net') {
      netBounce(p, v, ev, null);
    } else if (ev.type === 'rim') {
      const rh = Math.sqrt(ev.x * ev.x + ev.z * ev.z) || 1;
      const qx = (ev.x / rh) * C.NET_R;
      const qz = (ev.z / rh) * C.NET_R;
      let nx = ev.x - qx, ny = ev.y - C.NET_H, nz = ev.z - qz;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const dot = v.x * nx + v.y * ny + v.z * nz;
      if (dot < 0) {
        v.x -= 1.55 * dot * nx;
        v.y -= 1.55 * dot * ny;
        v.z -= 1.55 * dot * nz;
      }
      const push = C.BALL_R + C.RIM_TUBE + 0.002;
      p.x = qx + nx * push;
      p.y = C.NET_H + ny * push;
      p.z = qz + nz * push;
    } else if (ev.type === 'frame') {
      const rh = Math.sqrt(p.x * p.x + p.z * p.z) || 1;
      const nx = p.x / rh, nz = p.z / rh;
      const dot = v.x * nx + v.z * nz;
      if (dot < 0) {
        v.x -= 1.5 * dot * nx;
        v.z -= 1.5 * dot * nz;
      }
      p.x = nx * (C.NET_R + C.BALL_R + 0.002);
      p.z = nz * (C.NET_R + C.BALL_R + 0.002);
    }
  }

  // Forward-simulate a ball. Samples carry absolute times (t0 + elapsed).
  // opts.throughNet: continue through a (noise-free) net bounce.
  function predict(p0, v0, t0, opts = {}) {
    const dt = opts.dt || C.PRED_DT;
    const maxT = opts.maxT || 3;
    const p = { x: p0.x, y: p0.y, z: p0.z };
    const v = { x: v0.x, y: v0.y, z: v0.z };
    const samples = [];
    let netIdx = -1, netInfo = null, end = null, apexAfterNet = -Infinity;
    let t = 0;
    let skipUntil = opts.skipRimFor || 0;
    while (t < maxT) {
      const prev = { x: p.x, y: p.y, z: p.z };
      freeStep(p, v, dt);
      t += dt;
      const ev = collide(prev, p, t < skipUntil);
      if (ev) {
        if (ev.type === 'net' && opts.throughNet && netIdx < 0) {
          netInfo = netBounce(p, v, ev, null);
          netInfo.x = ev.x; netInfo.z = ev.z; netInfo.t = t0 + t;
          netIdx = samples.length;
          skipUntil = t + 0.15;
        } else {
          end = { type: ev.type, t: t0 + t, x: p.x, z: p.z };
          break;
        }
      }
      if (netIdx >= 0 && p.y > apexAfterNet) apexAfterNet = p.y;
      samples.push({ t: t0 + t, x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z });
    }
    if (!end) end = { type: 'timeout', t: t0 + t, x: p.x, z: p.z };
    return { samples, netIdx, netInfo, end, apexAfterNet };
  }

  // Velocity that carries the ball from `from` to `to` in time T (drag-corrected).
  function solveShot(from, to, T) {
    const v = {
      x: (to.x - from.x) / T,
      y: (to.y - from.y) / T + 0.5 * C.G * T,
      z: (to.z - from.z) / T,
    };
    const n = Math.max(6, Math.ceil(T / (1 / 240)));
    const dt = T / n;
    for (let it = 0; it < 6; it++) {
      const p = { x: from.x, y: from.y, z: from.z };
      const vv = { x: v.x, y: v.y, z: v.z };
      for (let i = 0; i < n; i++) freeStep(p, vv, dt);
      const ex = to.x - p.x, ey = to.y - p.y, ez = to.z - p.z;
      v.x += ex / T;
      v.y += ey / T;
      v.z += ez / T;
      if (ex * ex + ey * ey + ez * ez < 1e-5) break;
    }
    return v;
  }

  // Arc through a given apex height, landing at `to` (height to.y).
  function solveArc(from, to, apex) {
    apex = Math.max(apex, from.y + 0.2, to.y + 0.2);
    const tUp = Math.sqrt((2 * (apex - from.y)) / C.G);
    const tDown = Math.sqrt((2 * (apex - to.y)) / C.G);
    return solveShot(from, to, (tUp + tDown) * 1.04);
  }

  SB.Physics = { freeStep, collide, netBounce, bounceVisual, predict, solveShot, solveArc };
})((globalThis.SB = globalThis.SB || {}));
