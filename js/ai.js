// Player decision making: who plays the ball, where to stand, when to
// jump/dive, how clean each touch is, and where to aim serves and spikes.
(function (SB) {
  'use strict';
  const C = SB.C, U = SB.U, P = SB.Physics;
  const AI = {};

  const SKILL = { pass: 'receiving', set: 'setting', hit: 'spikeAccuracy' };
  const FAIL_SCALE = { pass: 1.3, set: 0.9, hit: 0.7 };

  // ---------------------------------------------------------------- perception
  // Each read of the ball carries a fixed error direction whose size shrinks as
  // the ball gets closer, so low-awareness players commit to the wrong spot early.
  function noiseScale(pl) { return 0.08 + 0.45 * (1 - pl.s('awareness')); }
  function freshNoise(sim, pl) {
    const a = sim.rng() * Math.PI * 2;
    const m = Math.min(2.2, Math.abs(sim.rng.gauss()));
    pl.noise = { x: Math.cos(a) * m, z: Math.sin(a) * m };
  }

  const hitHeight = (pl) => C.STAND_REACH - 0.2 + pl.jump * 0.6;

  function comfort(kind, s, pl) {
    const h = s.y;
    if (kind === 'hit') {
      const r = Math.hypot(s.x, s.z);
      return -Math.abs(h - hitHeight(pl)) * 1.1 - 0.4 * Math.max(0, r - 1.2);
    }
    if (kind === 'set') return -Math.abs(h - 1.2) * 0.8;
    return -Math.abs(h - 0.85) * 0.9 - (h < 0.35 ? 0.4 : 0);
  }

  // Best point on a predicted trajectory for this player to play the ball.
  // mode 0 = comfortable, 1 = stretching, 2 = needs a dive.
  AI.findIntercept = function (sim, pl, pred, kind, reactRem, useNoise, fromIdx, stride) {
    const S = pred.samples, now = sim.time;
    const allowJump = kind === 'hit';
    const ns = useNoise && pl.noise ? noiseScale(pl) : 0;
    let best = null;
    for (let i = fromIdx || 0; i < S.length; i += stride || 2) {
      const s = S[i];
      const tRel = s.t - now;
      if (tRel < reactRem + 0.06) continue;
      const reach = pl.reachAt(s.y, allowJump);
      if (reach < 0) continue;
      let bx = s.x, bz = s.z;
      if (ns) {
        const k = ns * Math.min(1, tRel / 0.9);
        bx += pl.noise.x * k;
        bz += pl.noise.z * k;
      }
      const d = Math.hypot(bx - pl.pos.x, bz - pl.pos.z);
      let mode, slack;
      const t0 = pl.moveTime(Math.max(0, d - 0.35)) + reactRem;
      if (t0 <= tRel) { mode = 0; slack = tRel - t0; }
      else {
        const t1 = pl.moveTime(Math.max(0, d - reach)) + reactRem;
        if (t1 <= tRel) { mode = 1; slack = tRel - t1; }
        else if (s.y < 1.5) {
          const t2 = pl.moveTime(Math.max(0, d - reach - pl.diveReach)) + reactRem + 0.19;
          if (t2 <= tRel) { mode = 2; slack = tRel - t2; } else continue;
        } else continue;
      }
      const score = comfort(kind, s, pl) + 1.2 * Math.min(slack, 0.4) - mode * 0.9 - tRel * 0.12;
      if (!best || score > best.score) {
        best = { score, mode, slack, t: s.t, pt: { x: s.x, y: s.y, z: s.z }, seen: { x: bx, z: bz } };
      }
    }
    return best;
  };

  // Stand a little outside the ball (relative to the net) so it is played in front.
  function standPoint(seen, kind) {
    const r = Math.hypot(seen.x, seen.z) || 1;
    const off = kind === 'hit' ? 0.32 : 0.28;
    return { x: seen.x + (seen.x / r) * off, z: seen.z + (seen.z / r) * off };
  }

  const polar = (a, r) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  const ang = (p) => Math.atan2(p.z, p.x);

  // Where a first touch should go: near the net, between passer and partner.
  function setSpot(from, partner) {
    const aFrom = ang(from);
    const da = U.wrapAngle(ang(partner.pos) - aFrom);
    return polar(aFrom + U.clamp(da * 0.5, -0.9, 0.9), 1.0);
  }

  function nextTouchNo(sim, T) {
    const r = sim.r;
    return (r.possTeam === T ? r.touches : 0) + 1;
  }

  // ---------------------------------------------------------------- per-step
  AI.update = function (sim, dt) {
    const r = sim.r, now = sim.time;
    const T = r.playTeam;
    if (T >= 0 && r.assigned < 0 && !r.tooHigh) {
      if (sim.teamPlayers(T).some((p) => now >= p.reactAt)) assign(sim, T);
    }
    for (const p of sim.players) {
      if (!p.canAct()) continue;
      if (p.id === r.assigned) drive(sim, p, dt);
      else position(sim, p);
    }
  };

  function assign(sim, T) {
    const r = sim.r, pred = sim.getPred();
    const team = sim.teamPlayers(T);
    const touchNo = nextTouchNo(sim, T);
    let chosen = null;
    if (r.isServe) chosen = sim.players[sim.receiverId];
    else if (touchNo > 1) chosen = sim.teammate(r.lastToucher);
    else {
      let best = null;
      for (const p of team) {
        if (!p.canAct()) continue;
        if (!p.noise) freshNoise(sim, p);
        const ic = AI.findIntercept(sim, p, pred, 'pass', Math.max(0, p.reactAt - sim.time), true, pred.from);
        const key = ic ? (3 - ic.mode) * 10 + ic.score : -100 - U.distH(p.pos, pred.end);
        if (!best || key > best.key) best = { p, key };
      }
      chosen = best ? best.p : team[0];
    }
    let kind = touchNo === 1 ? 'pass' : touchNo === 2 ? 'set' : 'hit';
    const partner = sim.teammate(chosen);
    if (touchNo === 2 && (!partner.canAct() || wantsHitOn2(sim, chosen, pred))) kind = 'hit';
    r.assigned = chosen.id;
    r.kind = kind;
    chosen.plan = null;
    chosen.planAt = -1;
    chosen.jumped = false;
    if (!chosen.noise) freshNoise(sim, chosen);
  }

  // A good pass sometimes gets attacked straight away instead of set.
  function wantsHitOn2(sim, p, pred) {
    const S = pred.samples;
    let ok = false;
    for (let i = pred.from; i < S.length; i += 3) {
      const s = S[i];
      if (s.y > 1.6 && s.y < C.STAND_REACH + p.jump && Math.hypot(s.x, s.z) < 1.4) { ok = true; break; }
    }
    return ok && sim.rng() < 0.05 + 0.2 * p.s('awareness');
  }

  function drive(sim, p, dt) {
    const r = sim.r, now = sim.time;
    if (now < p.reactAt) return; // still reading the play
    const pred = sim.getPred();
    const kind = r.kind;
    const stale = !p.plan || p.plan.ver !== pred.ver || (now - p.planAt > 0.1 && p.plan.t - now > 0.12);
    if (stale && !p.jumped) {
      const ic = AI.findIntercept(sim, p, pred, kind, 0, true, pred.from);
      p.planAt = now;
      if (ic) {
        p.plan = Object.assign(ic, { kind, ver: pred.ver });
        p.target = standPoint(ic.seen, kind);
      } else {
        p.plan = null;
        // first touch: let the partner take it if they can
        if (nextTouchNo(sim, p.team) === 1 && !r.isServe) {
          const mate = sim.teammate(p);
          if (mate.canAct()) {
            const ic2 = AI.findIntercept(sim, mate, pred, 'pass', Math.max(0, mate.reactAt - now), true, pred.from);
            if (ic2) { r.assigned = mate.id; mate.plan = null; mate.planAt = -1; return; }
          }
        }
        const S = pred.samples;
        const last = S.length ? S[S.length - 1] : sim.ball.p;
        p.target = { x: last.x, z: last.z };
      }
    }
    if (!p.plan) return;
    if (kind === 'hit' && !p.jumped && p.plan.pt.y > C.STAND_REACH - 0.1) {
      const need = U.clamp(p.plan.pt.y - (C.STAND_REACH - 0.12), 0.05, p.jump);
      if (now >= p.plan.t - Math.sqrt((2 * need) / C.G)) p.startJump(p.plan.pt.y);
    }
    if (now >= p.plan.t - 1e-6) attempt(sim, p, kind);
  }

  function attempt(sim, p, kind) {
    const b = sim.ball.p;
    const dx = b.x - p.pos.x, dz = b.z - p.pos.z;
    const hd = Math.hypot(dx, dz);
    const hEff = b.y - p.y;
    const reach = p.reachAt(U.clamp(hEff, 0.13, C.STAND_REACH), false);
    if (hEff > C.STAND_REACH + 0.1 || b.y < 0.1) return miss(sim, p);
    if (hd <= reach) {
      return AI.contact(sim, p, kind, U.clamp((hd - 0.3) / Math.max(0.1, reach - 0.3), 0, 1), false);
    }
    if (hd <= reach + p.diveReach && b.y < 1.5 && p.y < 0.05) {
      p.startDive(dx, dz);
      return AI.contact(sim, p, kind, 1, true);
    }
    return miss(sim, p);
  }

  function miss(sim, p) {
    p.plan = null;
    p.planAt = sim.time;
    if (!p.missed) sim.emit({ type: 'whiff', player: p });
    p.missed = true;
  }

  // ---------------------------------------------------------------- contact
  AI.contact = function (sim, p, kind, stretch, dive) {
    const b = sim.ball, rng = sim.rng, r = sim.r, now = sim.time;
    const skill = p.s(SKILL[kind]);
    const sp = U.len3(b.v);
    const h = b.p.y;
    const dSpeed = U.clamp((sp - 8) / 10, 0, 1);
    const dRush = p.plan ? U.clamp(1 - p.plan.slack / 0.25, 0, 1) : 1;
    const dHeight = kind === 'hit'
      ? U.clamp((hitHeight(p) - h) / 1.4, 0, 1)
      : U.clamp(Math.abs(h - 0.9) / 1.2, 0, 1);
    const dMove = U.clamp(Math.hypot(p.vel.x, p.vel.z) / p.vmax, 0, 1);
    const dFar = kind === 'hit' ? U.clamp((Math.hypot(b.p.x, b.p.z) - 1.2) / 2.5, 0, 1) : 0;
    let d = 0.06 + (kind === 'pass' ? 0.4 : 0.3) * dSpeed + 0.42 * stretch + (dive ? 0.35 : 0) +
      0.2 * dHeight + 0.12 * dMove + 0.3 * dFar + 0.18 * dRush;
    d = U.clamp(d, 0, 1.3);
    const pFail = U.clamp(d * d * (1.45 - skill) * 0.72 * FAIL_SCALE[kind] - 0.02, 0.004, 0.92);
    const fail = rng() < pFail;
    const q = fail ? 0 : U.clamp(1 - d * (1.5 - skill) * 0.73 * (0.4 + rng()) * 1.2, 0.05, 1);

    const { touchNo, wasServe } = sim.touch(p, kind);
    const st = sim.stats[p.id];
    if (touchNo === 1 && kind !== 'hit') {
      if (wasServe) { if (!fail) st.rec++; }
      else { st.digAtt++; if (!fail) st.dig++; }
    }
    if (kind === 'set' && !fail) st.sets++;

    let v;
    const from = U.copy3(b.p);
    const mate = sim.teammate(p);
    if (fail) {
      v = shank(sim, kind, from, b.v);
    } else if (kind === 'pass') {
      const S = setSpot(from, mate);
      const err = 1 - q;
      const tgt = { x: S.x + rng.gauss() * err * 1.1, y: 1.2, z: S.z + rng.gauss() * err * 1.1 };
      const apex = 2.4 + rng() * 0.4 - dSpeed * 0.4 + rng.gauss() * err * 0.5;
      v = P.solveArc(from, tgt, apex);
    } else if (kind === 'set') {
      const aB = ang(from);
      const a = aB + U.clamp(U.wrapAngle(ang(mate.pos) - aB), -1.0, 1.0);
      const err = 1 - q;
      const hh = hitHeight(mate);
      const S = polar(a, 0.95);
      const tgt = { x: S.x + rng.gauss() * err * 0.9, y: hh, z: S.z + rng.gauss() * err * 0.9 };
      v = P.solveArc(from, tgt, hh + 0.8 + rng() * 0.3 + rng.gauss() * err * 0.4);
    } else {
      const c = chooseAttack(sim, p, from, false);
      const sigma = c.sigma + d * 0.12;
      const A = { x: c.A.x + rng.gauss() * sigma, y: c.A.y, z: c.A.z + rng.gauss() * sigma };
      v = P.solveShot(from, A, c.T * (1 + rng.gauss() * 0.04));
      r.lastShot = { player: p, team: p.team, kind: 'hit', t: now, speed: c.speed };
      st.att++;
    }

    sim.setBallVel(v);
    p.lastContact = { t: now, kind, dir: norm3(v) };
    p.missed = false;
    const quality = fail ? 'shank' : q > 0.8 ? 'great' : q > 0.55 ? 'good' : 'poor';
    sim.emit({ type: 'touch', player: p, kind, quality, dive, touchNo, wasServe, speed: U.len3(v), d, stretch, inSpeed: sp });

    p.plan = null;
    p.reactAt = Infinity;
    p.noise = null;
    if (kind === 'hit') {
      AI.onShot(sim, p);
    } else {
      r.playTeam = p.team;
      r.assigned = -1;
      r.kind = null;
      mate.plan = null;
      mate.reactAt = now + (fail ? mate.reaction * 0.6 : 0.05);
      freshNoise(sim, mate);
    }
  };

  function norm3(v) {
    const l = U.len3(v) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  }

  function shank(sim, kind, from, vin) {
    const rng = sim.rng;
    if (kind === 'hit') {
      // mis-hit: aimed at the net but badly off
      const a = rng() * Math.PI * 2, m = 0.35 + rng() * 0.7;
      const A = { x: Math.cos(a) * m, y: C.NET_H + C.BALL_R, z: Math.sin(a) * m };
      const dist = U.len3({ x: A.x - from.x, y: A.y - from.y, z: A.z - from.z });
      return P.solveShot(from, A, dist / 9);
    }
    // deflection: mostly carries on with the incoming ball, plus a random kick
    const a = rng() * Math.PI * 2;
    const hs = 1.5 + rng() * 4.5;
    return {
      x: vin.x * 0.5 + Math.cos(a) * hs,
      y: 0.8 + rng() * 4,
      z: vin.z * 0.5 + Math.sin(a) * hs,
    };
  }

  // ---------------------------------------------------------------- attacking
  function aimSigma(p, isServe, sf, from) {
    const acc = p.s(isServe ? 'serveAccuracy' : 'spikeAccuracy');
    let s = isServe ? 0.045 + 0.17 * (1 - acc) : 0.04 + 0.16 * (1 - acc);
    s *= 0.7 + 0.5 * sf; // power costs control
    s += 0.04 * Math.max(0, Math.hypot(from.x, from.z) - 1.2);
    return s;
  }

  function evalShot(sim, from, A, speed, defenders, isServe, sigma) {
    const T = U.len3({ x: A.x - from.x, y: A.y - from.y, z: A.z - from.z }) / speed;
    const v = P.solveShot(from, A, T);
    const pred = P.predict(from, v, sim.time, { maxT: T + 2.2, throughNet: true, dt: 1 / 80 });
    if (pred.netIdx < 0 || pred.netInfo.rollup) return null;
    if (isServe && pred.apexAfterNet > C.SERVE_MAX_H - 0.12) return null;
    let g = -1;
    for (const d of defenders) {
      if (!d.canAct()) continue;
      const ic = AI.findIntercept(sim, d, pred, 'pass', d.reaction, false, pred.netIdx, 1);
      if (!ic) continue;
      g = Math.max(g, (ic.mode === 0 ? 0.55 : ic.mode === 1 ? 0.3 : 0.1) + Math.min(ic.slack, 0.5));
    }
    const s0 = pred.samples[pred.netIdx];
    const reb = s0 ? Math.sqrt(s0.vx * s0.vx + s0.vy * s0.vy + s0.vz * s0.vz) : 0;
    const margin = C.NET_R - C.RIM_TUBE - Math.hypot(A.x, A.z);
    const risk = Math.exp(-(margin * margin) / (2 * sigma * sigma));
    const score = (g < 0 ? 1 : -g) + 0.012 * reb - risk * (isServe ? 1.3 : 1.4);
    return { A, speed, T, score, sigma };
  }

  function chooseAttack(sim, p, from, isServe) {
    const defenders = isServe ? [sim.players[sim.receiverId]] : sim.teamPlayers(1 - p.team);
    const vPow = isServe ? 10 + 8 * p.s('servePower') : 11 + 11 * p.s('spikePower');
    let speeds;
    if (isServe) speeds = sim.serveAttempt === 2 ? [0.82, 0.68] : [1, 0.82];
    else speeds = from.y < 1.2 ? [0.6, 0.42] : [1, 0.75, 0.48];
    const fr = Math.hypot(from.x, from.z);
    let ux, uz;
    if (fr > 0.15) { ux = -from.x / fr; uz = -from.z / fr; }
    else { ux = Math.sin(p.facing); uz = Math.cos(p.facing); }
    const wx = -uz, wz = ux;
    const cands = [];
    for (const sf of speeds) {
      const sigma = aimSigma(p, isServe, sf, from) * (isServe && sim.serveAttempt === 2 ? 0.85 : 1);
      for (const a of [-0.12, 0.1]) {
        for (const b of [-0.26, -0.13, 0, 0.13, 0.26]) {
          const A = { x: ux * a + wx * b, y: C.NET_H + C.BALL_R, z: uz * a + wz * b };
          const ev = evalShot(sim, from, A, vPow * sf, defenders, isServe, sigma);
          if (ev) cands.push(ev);
        }
      }
    }
    if (!cands.length) {
      const A = { x: 0, y: C.NET_H + C.BALL_R, z: 0 };
      const speed = vPow * 0.5;
      const T = U.len3({ x: -from.x, y: A.y - from.y, z: -from.z }) / speed;
      return { A, speed, T, sigma: aimSigma(p, isServe, 0.5, from), score: 0 };
    }
    const temp = 0.05 + 0.4 * (1 - p.s('awareness'));
    return U.softmaxPick(sim.rng, cands, (c) => c.score, temp);
  }

  AI.serve = function (sim) {
    const p = sim.players[sim.serverId], b = sim.ball, rng = sim.rng;
    const from = U.copy3(b.p);
    const c = chooseAttack(sim, p, from, true);
    const A = { x: c.A.x + rng.gauss() * c.sigma, y: c.A.y, z: c.A.z + rng.gauss() * c.sigma };
    const v = P.solveShot(from, A, c.T * (1 + rng.gauss() * 0.03));
    sim.serveContact(p, v, c.speed);
    p.lastContact = { t: sim.time, kind: 'serve', dir: norm3(v) };
    AI.onShot(sim, p);
  };

  // A ball is heading for the net: the other team starts reading it.
  AI.onShot = function (sim, hitter, late) {
    const r = sim.r;
    r.playTeam = 1 - hitter.team;
    r.assigned = -1;
    r.kind = null;
    for (const p of sim.teamPlayers(r.playTeam)) {
      p.plan = null;
      p.missed = false;
      p.reactAt = sim.time + p.reaction * (late ? 0.8 : 0.85 + 0.3 * sim.rng());
      freshNoise(sim, p);
    }
    for (const p of sim.teamPlayers(hitter.team)) {
      p.plan = null;
      p.reactAt = Infinity;
    }
  };

  // ---------------------------------------------------------------- positioning
  function position(sim, p) {
    const r = sim.r, now = sim.time;
    p.pace = 1;
    const T = r.playTeam;
    if (T === p.team) {
      if (r.assigned < 0) return;
      const mate = sim.players[r.assigned];
      if (r.kind === 'pass') {
        // partner is digging: get to the set spot
        const from = mate.plan ? mate.plan.pt : sim.ball.p;
        const S = setSpot(from, p);
        const a = ang(S);
        p.target = polar(a, 1.4);
      } else if (r.kind === 'set') {
        // I'm the hitter: open up to an approach spot on my side of the setter
        const aB = ang(mate.plan ? mate.plan.pt : sim.ball.p);
        const a = aB + U.clamp(U.wrapAngle(ang(p.pos) - aB), -1.2, 1.2);
        p.target = polar(a, 1.75);
      } else {
        // partner attacks: drift back to where I'll defend from
        p.target = polar(ang(p.pos), 1.9);
      }
      return;
    }
    if (T < 0) return;
    if (p.reactAt !== Infinity && now < p.reactAt) return;
    p.target = defenseSpot(sim, p);
  }

  function defenseSpot(sim, p) {
    const r = sim.r;
    const opp = sim.teamPlayers(1 - p.team);
    let hx, hz;
    if (r.playTeam === 1 - p.team && r.assigned >= 0 && (r.kind === 'set' || r.kind === 'hit')) {
      const hitter = r.kind === 'hit' ? sim.players[r.assigned] : sim.teammate(sim.players[r.assigned]);
      hx = hitter.pos.x; hz = hitter.pos.z;
    } else {
      hx = (opp[0].pos.x + opp[1].pos.x) / 2;
      hz = (opp[0].pos.z + opp[1].pos.z) / 2;
    }
    const base = Math.atan2(hz, hx) + Math.PI;
    const mate = sim.teammate(p);
    const dMine = U.wrapAngle(ang(p.pos) - base), dMate = U.wrapAngle(ang(mate.pos) - base);
    const side = dMine > dMate || (dMine === dMate && p.idx === 1) ? 1 : -1;
    const power = (opp[0].s('spikePower') + opp[1].s('spikePower')) / 2;
    const aw = p.s('awareness');
    const spread = 0.8 - 0.15 * aw;
    return polar(base + side * spread, 1.7 + 0.5 * power + 0.2 * (1 - aw));
  }

  SB.AI = AI;
})((globalThis.SB = globalThis.SB || {}));
