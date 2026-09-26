// The match: rally flow, roundnet rules, scoring, serve rotation and stats.
(function (SB) {
  'use strict';
  const C = SB.C, U = SB.U, P = SB.Physics;

  const emptyStats = () => ({
    pts: 0, k: 0, ace: 0, att: 0, herr: 0, serves: 0, se: 0,
    rec: 0, recAtt: 0, dig: 0, digAtt: 0, sets: 0, err: 0,
  });

  const FAULT_TEXT = {
    rim: 'hits the rim',
    frame: 'hits the frame',
    rollup: 'rolls it up the net',
    double: 'ball hits the net twice',
    miss: 'misses the net',
    drop: "can't keep the ball alive",
  };

  class Sim {
    constructor(roster, opts = {}) {
      this.roster = roster;
      this.rng = U.makeRng(opts.seed != null ? opts.seed : Math.floor(Math.random() * 4294967296));
      this.gameTo = opts.gameTo || 21;
      this.listeners = [];
      this.players = [];
      for (let t = 0; t < 2; t++) {
        for (let i = 0; i < 2; i++) this.players.push(new SB.Player(roster.teams[t].players[i], t, i));
      }
      this.ball = { p: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 0 }, holder: null };
      this.ballVer = 0;
      this.pred = null;
      this.lastNetHit = null;
      this.newGame();
    }

    on(fn) { this.listeners.push(fn); }
    emit(ev) {
      ev.time = this.time;
      for (const f of this.listeners) f(ev, this);
    }

    teamPlayers(t) { return [this.players[t * 2], this.players[t * 2 + 1]]; }
    teammate(p) { return this.players[p.team * 2 + (1 - p.idx)]; }
    playerInSlot(s) { return this.players.find((p) => p.slot === s); }
    slotAngle(s) { return Math.PI / 4 + (s * Math.PI) / 2; }
    get server() { return this.players[this.serverId]; }
    get receiver() { return this.players[this.receiverId]; }
    get servingTeam() { return this.players[this.serverId].team; }

    newGame() {
      this.time = 0;
      this.score = [0, 0];
      this.winner = -1;
      this.rallyNo = 0;
      this.stats = this.players.map(emptyStats);
      this.rallies = [];
      this.players.forEach((p, i) => { p.slot = i; p.resetRally(); });
      const serverSlot = this.rng() < 0.5 ? 0 : 2;
      this.serverId = this.playerInSlot(serverSlot).id;
      this.receiverId = this.playerInSlot((serverSlot + 2) % 4).id;
      this.serveAttempt = 1;
      this.startSetup(true);
      this.emit({ type: 'newGame' });
    }

    resetRallyState() {
      this.r = {
        lastTeam: -1, lastToucher: null, touches: 0, possTeam: -1, playTeam: -1,
        netBounced: false, isServe: true, lastShot: null, assigned: -1, kind: null,
        tooHigh: false, skipRimUntil: 0, rallyTouches: 0, possessions: 0, start: this.time,
      };
    }

    // Players walk to their serve/receive spots.
    startSetup(snap) {
      this.phase = 'setup';
      this.phaseT = 0;
      if (this.serveAttempt === 1) this.rallyNo++;
      this.resetRallyState();
      const srv = this.server, rcv = this.receiver;
      for (const p of this.players) {
        const a = this.slotAngle(p.slot);
        let rad;
        if (p === srv) rad = C.SERVE_LINE + 0.35;
        else if (p === rcv) rad = 2.3 + 0.3 * (1 - p.s('reactions'));
        else if (p.team === srv.team) rad = 1.35;
        else rad = 1.9;
        p.resetRally();
        p.celebrate = null;
        p.target = { x: rad * Math.cos(a), z: rad * Math.sin(a) };
        p.pace = 0.7;
        if (snap) { p.pos = { ...p.target }; p.vel = { x: 0, z: 0 }; p.facing = Math.atan2(-p.pos.x, -p.pos.z); }
      }
      this.ball.holder = srv;
      this.ball.v = { x: 0, y: 0, z: 0 };
      this.bumpBall();
    }

    handPos(p) {
      const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
      return { x: p.pos.x + fx * 0.42 - fz * 0.12, y: 1.05 + p.y, z: p.pos.z + fz * 0.42 + fx * 0.12 };
    }

    bumpBall() { this.ballVer++; }
    setBallVel(v) { this.ball.v = { x: v.x, y: v.y, z: v.z }; this.bumpBall(); }

    getPred() {
      if (this.pred && this.pred.ver === this.ballVer) return this.pred;
      const r = this.r;
      const through = !r.netBounced && r.playTeam >= 0 && r.playTeam !== r.lastTeam;
      const pr = P.predict(this.ball.p, this.ball.v, this.time, {
        maxT: 3.5, throughNet: through, skipRimFor: Math.max(0, r.skipRimUntil - this.time),
      });
      pr.from = through ? (pr.netIdx >= 0 ? pr.netIdx : pr.samples.length) : 0;
      pr.ver = this.ballVer;
      this.pred = pr;
      return pr;
    }

    // ------------------------------------------------------------ main step
    step(dt) {
      this.time += dt;
      this.phaseT += dt;
      const b = this.ball;
      switch (this.phase) {
        case 'setup': {
          let done = true;
          for (const p of this.players) if (U.distH(p.pos, p.target) > 0.25) done = false;
          if ((done && this.phaseT > 0.6) || this.phaseT > C.SETUP_MAX) {
            this.phase = 'ready';
            this.phaseT = 0;
          }
          break;
        }
        case 'ready':
          if (this.phaseT > 0.6) {
            const srv = this.server;
            b.holder = null;
            b.p = this.handPos(srv);
            b.v = { x: 0, y: 2.0, z: 0 };
            this.bumpBall();
            this.phase = 'toss';
            this.phaseT = 0;
          }
          break;
        case 'toss':
          P.freeStep(b.p, b.v, dt);
          if (b.v.y < 0 && b.p.y <= 1.0) {
            this.phase = 'live';
            this.phaseT = 0;
            SB.AI.serve(this);
          }
          break;
        case 'live':
          this.stepLive(dt);
          if (this.phase === 'live') SB.AI.update(this, dt);
          break;
        case 'dead':
        case 'over':
          this.stepDead(dt);
          if (this.phase === 'dead' && this.phaseT > this.deadPause) {
            if (this.winner >= 0) {
              this.phase = 'over';
              this.emit({ type: 'gameOver', winner: this.winner, score: [...this.score] });
            } else this.startSetup(false);
          }
          break;
      }
      for (const p of this.players) {
        this.updateFacing(p, dt);
        p.update(dt, this);
      }
      SB.separatePlayers(this.players);
      if (b.holder) b.p = this.handPos(b.holder);
    }

    updateFacing(p, dt) {
      if (p.state !== 'free') return;
      let tx, tz;
      const live = this.phase === 'live' || this.phase === 'dead';
      if (live && !(p.id === this.serverId && this.phase === 'toss')) { tx = this.ball.p.x; tz = this.ball.p.z; }
      else { tx = 0; tz = 0; }
      const dx = tx - p.pos.x, dz = tz - p.pos.z;
      if (dx * dx + dz * dz < 0.01) return;
      const want = Math.atan2(dx, dz);
      const d = U.wrapAngle(want - p.facing);
      const maxTurn = 9 * dt;
      p.facing = U.wrapAngle(p.facing + U.clamp(d, -maxTurn, maxTurn));
    }

    stepLive(dt) {
      const b = this.ball, r = this.r;
      const prev = U.copy3(b.p);
      P.freeStep(b.p, b.v, dt);
      const ev = P.collide(prev, b.p, this.time < r.skipRimUntil);
      if (r.tooHigh && b.v.y <= 0) return this.serveFault('serve too high');
      if (!ev) {
        if (U.hyp(b.p.x, b.p.z) > 30) this.ballDown();
        return;
      }
      if (ev.type === 'net') return this.onNet(ev);
      P.bounceVisual(b.p, b.v, ev);
      this.bumpBall();
      if (ev.type === 'rim') return this.fault(r.lastTeam, 'rim');
      if (ev.type === 'frame') return this.fault(r.lastTeam, 'frame');
      return this.ballDown();
    }

    stepDead(dt) {
      const b = this.ball;
      if (b.holder) return;
      const prev = U.copy3(b.p);
      P.freeStep(b.p, b.v, dt);
      const ev = P.collide(prev, b.p, false);
      if (ev) P.bounceVisual(b.p, b.v, ev);
      if (b.p.y <= C.BALL_R + 0.001) {
        const k = Math.max(0, 1 - 1.5 * dt);
        b.v.x *= k;
        b.v.z *= k;
      }
    }

    // ------------------------------------------------------------ rules
    touch(p) {
      const r = this.r;
      if (r.possTeam !== p.team) { r.possTeam = p.team; r.touches = 0; }
      r.touches++;
      r.rallyTouches++;
      r.lastTeam = p.team;
      r.lastToucher = p;
      r.netBounced = false;
      r.tooHigh = false;
      const wasServe = r.isServe;
      r.isServe = false;
      return { touchNo: r.touches, wasServe };
    }

    serveContact(p, v, speed) {
      const r = this.r;
      r.lastTeam = p.team;
      r.lastToucher = p;
      r.possTeam = p.team;
      r.touches = 1;
      r.isServe = true;
      r.lastShot = { player: p, team: p.team, kind: 'serve', t: this.time, speed };
      this.stats[p.id].serves++;
      this.setBallVel(v);
      this.emit({ type: 'serve', player: p, receiver: this.receiver, attempt: this.serveAttempt, speed: U.len3(v) });
    }

    onNet(ev) {
      const r = this.r, b = this.ball;
      const info = P.netBounce(b.p, b.v, ev, this.rng);
      this.bumpBall();
      r.skipRimUntil = this.time + 0.15;
      this.lastNetHit = { x: ev.x, z: ev.z, t: this.time, power: info.vin, pocket: info.pocket };
      if (r.netBounced) return this.fault(r.lastTeam, 'double');
      this.emit({ type: 'net', pocket: info.pocket, team: r.lastTeam, player: r.lastToucher });
      if (info.rollup) return this.fault(r.lastTeam, 'rollup');
      const accidental = r.playTeam === r.lastTeam;
      r.netBounced = true;
      r.playTeam = 1 - r.lastTeam;
      r.possessions++;
      if (r.isServe) {
        this.stats[this.receiverId].recAtt++;
        const pr = P.predict(b.p, b.v, this.time, { maxT: 2.5, skipRimFor: 0.15 });
        let apex = 0;
        for (const s of pr.samples) apex = Math.max(apex, s.y);
        if (apex > C.SERVE_MAX_H) r.tooHigh = true;
      }
      if (accidental) SB.AI.onShot(this, r.lastToucher, true);
    }

    ballDown() {
      const r = this.r;
      if (r.netBounced) return this.awardPoint(r.lastTeam, { reason: 'winner' });
      if (r.isServe) return this.serveFault('missed the net');
      const shot = r.lastShot;
      const hitMiss = shot && shot.player === r.lastToucher && shot.kind === 'hit' && r.lastToucher.lastContact && r.lastToucher.lastContact.kind === 'hit';
      return this.fault(r.lastTeam, hitMiss ? 'miss' : 'drop');
    }

    fault(team, kind) {
      const r = this.r;
      if (r.isServe && team === this.servingTeam) {
        const label = { rim: 'hit the rim', frame: 'hit the frame', rollup: 'roll-up', double: 'hit the net twice', miss: 'missed the net', drop: 'missed the net' }[kind];
        return this.serveFault(label);
      }
      const pl = r.lastToucher;
      // a defender who touched the ball once and couldn't control it: credit the attacker
      if (kind === 'drop' && r.lastShot && r.lastShot.team !== team && r.touches <= 1) {
        return this.awardPoint(1 - team, { reason: 'winner' });
      }
      this.stats[pl.id].err++;
      if (kind !== 'drop' && r.lastShot && r.lastShot.player === pl && r.lastShot.kind === 'hit') this.stats[pl.id].herr++;
      this.awardPoint(1 - team, { reason: kind, error: true, credit: pl, text: `${pl.name} ${FAULT_TEXT[kind]}` });
    }

    serveFault(reason) {
      const srv = this.server;
      this.stats[srv.id].se++;
      this.stats[srv.id].err++;
      this.emit({ type: 'serveFault', player: srv, reason, attempt: this.serveAttempt });
      if (this.serveAttempt === 1) {
        this.serveAttempt = 2;
        this.toDead(C.REPLAY_PAUSE, -1);
      } else {
        this.awardPoint(1 - srv.team, { reason: 'doubleFault', error: true, credit: srv, text: `${srv.name} double faults (${reason})` });
      }
    }

    awardPoint(team, info) {
      const r = this.r;
      const srvTeam = this.servingTeam;
      this.score[team]++;
      let credit = info.credit || null, reason = info.reason, text = info.text;
      if (!info.error) {
        const shot = r.lastShot;
        credit = shot ? shot.player : null;
        if (shot && shot.kind === 'serve') { reason = 'ace'; this.stats[credit.id].ace++; text = `Ace by ${credit.name}`; }
        else if (credit) { reason = 'kill'; this.stats[credit.id].k++; text = `${credit.name} puts it away`; }
        else text = 'Point';
        if (credit) this.stats[credit.id].pts++;
      }
      this.rallies.push({
        touches: r.rallyTouches, poss: r.possessions, dur: this.time - r.start,
        reason, winner: team, serving: srvTeam,
      });
      this.emit({ type: 'point', team, reason, text, player: credit, score: [...this.score], breakPoint: team === srvTeam });

      // rotation
      const srv = this.server;
      if (team === srvTeam) {
        const mate = this.teammate(srv);
        const s = srv.slot; srv.slot = mate.slot; mate.slot = s;
      } else {
        const n1 = this.playerInSlot((srv.slot + 1) % 4), n2 = this.playerInSlot((srv.slot + 3) % 4);
        this.serverId = (n1.team !== srv.team ? n1 : n2).id;
      }
      this.receiverId = this.playerInSlot((this.server.slot + 2) % 4).id;
      this.serveAttempt = 1;

      const s = this.score;
      if (s[team] >= this.gameTo && s[team] - s[1 - team] >= 2) this.winner = team;
      this.toDead(C.POINT_PAUSE, team);
    }

    toDead(pause, winTeam) {
      this.phase = 'dead';
      this.phaseT = 0;
      this.deadPause = pause;
      this.r.assigned = -1;
      for (const p of this.players) {
        p.plan = null;
        p.target = { x: p.pos.x, z: p.pos.z };
        p.celebrate = winTeam < 0 ? null : p.team === winTeam ? 'win' : 'lose';
      }
    }
  }

  SB.Sim = Sim;
  SB.emptyStats = emptyStats;
})((globalThis.SB = globalThis.SB || {}));
