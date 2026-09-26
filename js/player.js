// A player: stats-derived physical attributes plus kinematic movement.
(function (SB) {
  'use strict';
  const C = SB.C, U = SB.U;

  class Player {
    constructor(def, team, idx) {
      this.def = def; // live reference into the roster, so stat edits apply instantly
      this.team = team;
      this.idx = idx;
      this.id = team * 2 + idx;
      this.slot = this.id;
      this.pos = { x: 0, z: 0 };
      this.vel = { x: 0, z: 0 };
      this.y = 0; // jump height
      this.vy = 0;
      this.facing = 0; // yaw, radians (atan2(x, z) convention)
      this.target = null;
      this.pace = 1; // fraction of top speed allowed (walking between points)
      this.state = 'free'; // free | dive | down
      this.stateT = 0;
      this.diveDir = { x: 0, z: 1 };
      this.resetRally();
    }

    resetRally() {
      this.plan = null;
      this.planAt = -1;
      this.reactAt = Infinity;
      this.noise = null;
      this.role = 'idle';
      this.jumped = false;
      this.lastContact = null; // {t, kind, dir}
      this.state = 'free';
      this.y = 0;
      this.vy = 0;
    }

    get name() { return this.def.name; }
    s(key) { return (U.clamp(this.def.stats[key], 1, 99) - 1) / 98; }

    get vmax() { return 4.7 + 2.3 * this.s('speed'); }
    get accel() { return 8 + 8 * this.s('agility'); }
    get reaction() { return 0.33 - 0.17 * this.s('reactions'); }
    get jump() { return 0.25 + 0.5 * this.s('agility'); }
    get diveReach() { return 0.3 + 0.65 * this.s('agility'); }
    get diveRecover() { return 1.35 - 0.7 * this.s('agility'); }

    canAct() { return this.state === 'free'; }

    // Time to cover distance d from rest with accel/top-speed limits.
    moveTime(d) {
      if (d <= 0) return 0;
      const a = this.accel, v = this.vmax;
      const dAccel = (v * v) / (2 * a);
      return d < dAccel ? Math.sqrt((2 * d) / a) : v / a + (d - dAccel) / v;
    }

    // Horizontal reach from body center at ball height h; -1 if unreachable.
    reachAt(h, allowJump) {
      if (h < 0.12) return -1;
      const top = C.STAND_REACH + (allowJump ? this.jump : 0);
      if (h > top) return -1;
      if (h < 0.35) return 0.62;
      if (h <= 1.7) return 0.72;
      return U.lerp(0.72, 0.3, (h - 1.7) / Math.max(0.05, top - 1.7));
    }

    // Jump so the hand peaks around height h at time tAbs.
    startJump(h) {
      const need = U.clamp(h - (C.STAND_REACH - 0.12), 0.05, this.jump);
      this.vy = Math.sqrt(2 * C.G * need);
      this.jumped = true;
    }

    startDive(dx, dz) {
      const l = Math.hypot(dx, dz) || 1;
      this.diveDir = { x: dx / l, z: dz / l };
      this.state = 'dive';
      this.stateT = 0;
      const sp = 3.2 + 1.5 * this.s('agility');
      this.vel.x = this.diveDir.x * sp;
      this.vel.z = this.diveDir.z * sp;
      this.plan = null;
    }

    update(dt, sim) {
      this.stateT += dt;
      if (this.state === 'dive') {
        this.integrate(dt, 0.25);
        if (this.stateT > 0.35) { this.state = 'down'; this.stateT = 0; }
        return this.post(dt);
      }
      if (this.state === 'down') {
        this.integrate(dt, 0.02);
        if (this.stateT > this.diveRecover) { this.state = 'free'; this.stateT = 0; }
        return this.post(dt);
      }

      let dvx = -this.vel.x, dvz = -this.vel.z;
      if (this.target) {
        const wp = steerAroundNet(this.pos, this.target);
        const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        const vmax = this.vmax * this.pace;
        // arrive: decelerate early enough to stop at the waypoint
        const dFinal = wp === this.target ? d : d + 1;
        const sp = Math.min(vmax, Math.sqrt(2 * this.accel * 0.85 * dFinal));
        if (d > 0.01) {
          dvx = (dx / d) * sp - this.vel.x;
          dvz = (dz / d) * sp - this.vel.z;
        }
      }
      // airborne players cannot change direction much
      const aMax = this.accel * (this.y > 0.02 ? 0.15 : 1);
      const dl = Math.hypot(dvx, dvz);
      const lim = aMax * dt;
      if (dl > lim) { dvx *= lim / dl; dvz *= lim / dl; }
      this.vel.x += dvx;
      this.vel.z += dvz;
      this.integrate(dt, 0);
      this.post(dt);
    }

    integrate(dt, friction) {
      if (friction) {
        const k = Math.max(0, 1 - friction * 60 * dt * (this.state === 'down' ? 3 : 1));
        this.vel.x *= k;
        this.vel.z *= k;
      }
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
    }

    post(dt) {
      if (this.y > 0 || this.vy > 0) {
        this.vy -= C.G * dt;
        this.y += this.vy * dt;
        if (this.y <= 0) { this.y = 0; this.vy = 0; }
      }
      // keep out of the net
      const r = Math.hypot(this.pos.x, this.pos.z);
      if (r < C.NET_KEEPOUT) {
        const k = C.NET_KEEPOUT / (r || 1);
        this.pos.x = r ? this.pos.x * k : C.NET_KEEPOUT;
        this.pos.z *= r ? k : 0;
        const vr = (this.vel.x * this.pos.x + this.vel.z * this.pos.z) / C.NET_KEEPOUT;
        if (vr < 0) {
          this.vel.x -= (vr * this.pos.x) / C.NET_KEEPOUT;
          this.vel.z -= (vr * this.pos.z) / C.NET_KEEPOUT;
        }
      }
    }
  }

  // If the straight path crosses the net, head for a waypoint around it.
  function steerAroundNet(pos, tgt) {
    const Rk = C.NET_KEEPOUT + 0.2;
    const dx = tgt.x - pos.x, dz = tgt.z - pos.z;
    const L2 = dx * dx + dz * dz;
    if (L2 < 1e-6) return tgt;
    const t = U.clamp(-(pos.x * dx + pos.z * dz) / L2, 0, 1);
    const cx = pos.x + dx * t, cz = pos.z + dz * t;
    if (t <= 0 || t >= 1 || Math.hypot(cx, cz) >= Rk) return tgt;
    const ap = Math.atan2(pos.z, pos.x);
    const at = Math.atan2(tgt.z, tgt.x);
    let d = U.wrapAngle(at - ap);
    if (Math.abs(d) > Math.PI - 0.05) d = Math.PI - 0.05; // directly across: go one way
    const step = Math.sign(d) * Math.min(Math.abs(d), 0.9);
    const rp = Math.max(Math.hypot(pos.x, pos.z), Rk + 0.15);
    return { x: rp * Math.cos(ap + step), z: rp * Math.sin(ap + step) };
  }

  // Keep players from standing inside each other.
  function separate(players) {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i], b = players[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < C.PLAYER_GAP && d > 1e-6) {
          const push = (C.PLAYER_GAP - d) / 2;
          a.pos.x -= (dx / d) * push; a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push; b.pos.z += (dz / d) * push;
        }
      }
    }
  }

  SB.Player = Player;
  SB.steerAroundNet = steerAroundNet;
  SB.separatePlayers = separate;
})((globalThis.SB = globalThis.SB || {}));
