// Wires the simulation, renderer and UI together and runs the frame loop.
(function (SB) {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  // A mode script loaded before this file can set SB.MODE to swap the default
  // roster (including 3D models), page title and storage key.
  const MODE = SB.MODE || {};
  const STORE = MODE.storageKey || 'spikeball-sim-roster-v1';
  const defaultRoster = MODE.defaultRoster || SB.defaultRoster;

  function loadRoster() {
    try {
      const r = JSON.parse(localStorage.getItem(STORE));
      if (r && r.teams && r.teams.length === 2 && r.teams.every((t) => t.players && t.players.length === 2)) {
        const def = defaultRoster();
        r.teams.forEach((t, i) => t.players.forEach((p, j) => {
          const d = def.teams[i].players[j];
          // fill any stats added since the roster was saved; models and sprites always come from the mode file
          p.stats = Object.assign({}, d.stats, p.stats);
          p.model = d.model;
          p.tag = d.tag;
          p.sprite = d.sprite;
        }));
        return r;
      }
    } catch (e) { /* storage unavailable */ }
    return defaultRoster();
  }
  function saveRoster(r) {
    try { localStorage.setItem(STORE, JSON.stringify(r)); } catch (e) { /* ignore */ }
  }

  const app = {
    roster: loadRoster(),
    speed: 1,
    paused: false,
    nextGameTimer: null,
    batchJob: null,
  };

  app.makeSim = function () {
    const sim = new SB.Sim(app.roster, { gameTo: +$('#sel-to').value });
    sim.on((ev) => app.onEvent(ev));
    return sim;
  };

  app.onEvent = function (ev) {
    app.ui && app.ui.onEvent(ev);
    if (ev.type === 'gameOver') {
      const t = app.sim.roster.teams[ev.winner];
      $('.go-title').textContent = `${t.name} win!`;
      $('.go-title').style.color = t.color;
      $('.go-score').textContent = `${ev.score[0]} – ${ev.score[1]}`;
      $('#gameover').hidden = false;
      clearTimeout(app.nextGameTimer);
      app.nextGameTimer = setTimeout(app.newGame, 7000);
    }
  };

  app.newGame = function () {
    clearTimeout(app.nextGameTimer);
    $('#gameover').hidden = true;
    app.sim.gameTo = +$('#sel-to').value;
    app.sim.newGame();
    app.renderer.trailPts.length = 0;
  };

  app.rosterChanged = function () {
    saveRoster(app.roster);
    app.renderer.refreshTeamColors();
    app.ui.lastScoreKey = '';
    app.ui.boxDirty = true;
  };

  app.setRoster = function (r) {
    // keep the same object graph the sim references
    r.teams.forEach((t, i) => {
      Object.assign(app.roster.teams[i], { name: t.name, color: t.color });
      t.players.forEach((p, j) => {
        app.roster.teams[i].players[j].name = p.name;
        Object.assign(app.roster.teams[i].players[j].stats, p.stats);
      });
    });
    app.ui.buildRoster();
    app.rosterChanged();
  };

  function init() {
    if (!window.THREE) {
      document.body.innerHTML = '<p style="padding:24px">Could not load Three.js from the CDN. Check your internet connection and reload.</p>';
      return;
    }
    if (MODE.title) document.title = MODE.title;
    app.sim = app.makeSim();
    app.ui = new SB.UI(app);
    app.renderer = new SB.Renderer($('#view'), app.sim);
    app.renderer.onNotice = (msg) => app.ui.addLine('fault', msg.replace(/[<>&]/g, ''));
    app.ui.onEvent({ type: 'newGame' });
    bindControls();

    let last = performance.now(), acc = 0;
    function frame(t) {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      if (!app.paused) {
        acc += dt * app.speed;
        let n = 0;
        while (acc >= SB.C.DT && n < 4000) { app.sim.step(SB.C.DT); acc -= SB.C.DT; n++; }
      }
      app.renderer.render(app.paused ? 0 : dt * Math.min(app.speed, 1.5));
      app.ui.tick();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function setSpeed(v) {
    app.speed = v;
    $$('#seg-speed button').forEach((b) => b.classList.toggle('on', +b.dataset.v === v));
  }
  function setPaused(p) {
    app.paused = p;
    $('#btn-play').innerHTML = p ? '&#9654;' : '&#10074;&#10074;';
  }
  function setCam(m) {
    app.renderer.setCamera(m);
    $$('#seg-cam button').forEach((b) => b.classList.toggle('on', b.dataset.v === m));
  }

  function bindControls() {
    $('#btn-play').addEventListener('click', () => setPaused(!app.paused));
    $$('#seg-speed button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.v)));
    $$('#seg-cam button').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.v)));
    $('#btn-new').addEventListener('click', app.newGame);
    $('#go-next').addEventListener('click', app.newGame);
    $('#sel-to').addEventListener('change', () => { app.sim.gameTo = +$('#sel-to').value; app.ui.lastScoreKey = ''; });

    $('#pr-default').addEventListener('click', () => app.setRoster(defaultRoster()));
    $('#pr-random').addEventListener('click', () => {
      const rng = SB.U.makeRng(Date.now());
      const r = SB.cloneRoster(app.roster);
      r.teams.forEach((t) => t.players.forEach((p) => { p.stats = SB.randomStats(rng); }));
      app.setRoster(r);
    });
    $('#pr-even').addEventListener('click', () => {
      const r = SB.cloneRoster(app.roster);
      r.teams.forEach((t) => t.players.forEach((p) => SB.STATS.forEach((d) => { p.stats[d.key] = 70; })));
      app.setRoster(r);
    });

    $('#batch-run').addEventListener('click', () => {
      if (app.batchJob) { app.batchJob.cancel(); app.batchJob = null; }
      const n = +$('#batch-n').value, to = +$('#batch-to').value;
      const prog = $('#batch-progress');
      prog.hidden = false;
      $('#batch-run').textContent = 'Running…';
      app.batchJob = SB.runBatch(SB.cloneRoster(app.roster), n, to, (f) => {
        $('.bar div', prog).style.width = (f * 100).toFixed(1) + '%';
        $('span', prog).textContent = `${Math.round(f * n)} / ${n}`;
      }, (agg) => {
        app.batchJob = null;
        prog.hidden = true;
        $('#batch-run').textContent = 'Run';
        app.ui.renderBatch(agg);
      });
    });

    const cams = ['broadcast', 'follow', 'overhead', 'auto', 'orbit'];
    window.addEventListener('keydown', (e) => {
      if (e.target.closest('input, select, textarea')) return;
      if (e.code === 'Space') { e.preventDefault(); setPaused(!app.paused); }
      else if (e.key >= '1' && e.key <= '5') setSpeed([0.25, 0.5, 1, 2, 4][+e.key - 1]);
      else if (e.key === 'c' || e.key === 'C') setCam(cams[(cams.indexOf(app.renderer.camMode) + 1) % cams.length]);
      else if (e.key === 'n' || e.key === 'N') app.newGame();
    });
  }

  window.addEventListener('DOMContentLoaded', init);
  SB.app = app;
})((globalThis.SB = globalThis.SB || {}));
