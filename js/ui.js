// DOM side of the app: scoreboard, play-by-play, box score, roster editor, batch results.
(function (SB) {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kmh = (v) => Math.round(v * 3.6);

  const REASON_LABEL = {
    kill: 'Kills', ace: 'Aces', rim: 'Rim faults', frame: 'Frame faults', miss: 'Missed the net',
    rollup: 'Roll-ups', double: 'Double net hits', drop: 'Unforced drops', doubleFault: 'Double faults', winner: 'Other winners',
  };

  class UI {
    constructor(app) {
      this.app = app;
      this.feed = $('#feed');
      this.lastScoreKey = '';
      this.toastTimer = null;
      this.boxDirty = true;
      this.bindTabs();
      this.buildRoster();
    }

    get sim() { return this.app.sim; }
    teamColor(t) { return this.sim.roster.teams[t].color; }
    who(p) { return `<span class="who" style="color:${esc(this.teamColor(p.team))}">${esc(p.name)}</span>`; }

    bindTabs() {
      $$('#tabs button').forEach((b) => b.addEventListener('click', () => {
        $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
        $$('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
        if (b.dataset.tab === 'box') this.renderBox();
      }));
    }

    // ------------------------------------------------------------ scoreboard
    tick() {
      const sim = this.sim;
      const key = [sim.score[0], sim.score[1], sim.serverId, sim.receiverId, sim.serveAttempt, sim.gameTo,
        sim.roster.teams[0].name, sim.roster.teams[1].name, sim.roster.teams[0].color, sim.roster.teams[1].color].join('|');
      if (key !== this.lastScoreKey) {
        this.lastScoreKey = key;
        $$('#scoreboard .team').forEach((el) => {
          const t = +el.dataset.team;
          $('.tname', el).textContent = sim.roster.teams[t].name;
          $('.tscore', el).textContent = sim.score[t];
          el.classList.toggle('serving', sim.servingTeam === t);
          el.style.borderColor = sim.roster.teams[t].color;
        });
        $('#sb-to').textContent = sim.gameTo;
        $('#sb-serve').innerHTML = `${this.who(sim.server)} → ${this.who(sim.receiver)}${sim.serveAttempt === 2 ? ' <em>(2nd)</em>' : ''}`;
        document.documentElement.style.setProperty('--t0', sim.roster.teams[0].color);
        document.documentElement.style.setProperty('--t1', sim.roster.teams[1].color);
      }
      if (this.boxDirty && $('#tab-box').classList.contains('on')) this.renderBox();
    }

    toast(text, sub) {
      const el = $('#toast');
      el.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
      el.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => el.classList.remove('show'), 1500);
    }

    // ------------------------------------------------------------ feed
    clearFeed() { this.feed.innerHTML = ''; this.boxDirty = true; }

    addLine(cls, html) {
      const li = document.createElement('li');
      li.className = cls;
      li.innerHTML = html;
      this.feed.prepend(li);
      while (this.feed.children.length > 300) this.feed.lastChild.remove();
    }

    onEvent(ev) {
      const sim = this.sim;
      switch (ev.type) {
        case 'newGame':
          this.clearFeed();
          this.addLine('point', `New game to ${sim.gameTo}. ${this.who(sim.server)} serves first.`);
          break;
        case 'serve':
          this.addLine('serve', `${this.who(ev.player)} serves to ${this.who(ev.receiver)}${ev.attempt === 2 ? ' (2nd serve)' : ''} · ${kmh(ev.speed)} km/h`);
          break;
        case 'touch': {
          let verb;
          if (ev.quality === 'shank') verb = ev.kind === 'hit' ? 'mis-hits it' : ev.touchNo === 1 ? 'shanks the ' + (ev.wasServe ? 'receive' : 'dig') : 'shanks the set';
          else if (ev.kind === 'pass') verb = ev.touchNo === 1 ? (ev.wasServe ? 'receives' : 'digs it') : 'bumps it';
          else if (ev.kind === 'set') verb = 'sets';
          else verb = `attacks · ${kmh(ev.speed)} km/h`;
          const q = ev.quality === 'shank' ? '' : ev.kind === 'hit' ? '' : ev.quality === 'great' ? ' — perfect' : ev.quality === 'poor' ? ' — scrappy' : '';
          this.addLine('touch', `${ev.dive ? 'Diving! ' : ''}${this.who(ev.player)} ${verb}${q}`);
          if (ev.dive && ev.quality !== 'shank' && sim.r.playTeam === ev.player.team) this.toast('What a dig!', ev.player.name);
          break;
        }
        case 'net':
          if (ev.pocket) { this.addLine('touch', 'Pocket shot!'); this.toast('POCKET!'); }
          break;
        case 'whiff':
          this.addLine('touch', `${this.who(ev.player)} can't get a hand on it`);
          break;
        case 'serveFault':
          this.addLine('fault', `Serve fault by ${this.who(ev.player)}: ${esc(ev.reason)}${ev.attempt === 1 ? ' — second serve' : ''}`);
          if (ev.attempt === 1) this.toast('FAULT', ev.reason + ' · 2nd serve');
          break;
        case 'point': {
          const t = sim.roster.teams[ev.team];
          const tag = ev.breakPoint ? ' · break' : '';
          this.addLine('point', `${esc(ev.text)}. Point ${esc(t.name)}${tag}<span class="sc">${ev.score[0]}–${ev.score[1]}</span>`);
          const big = { ace: 'ACE!', kill: 'KILL', rim: 'RIM!', frame: 'FRAME', rollup: 'ROLL-UP', doubleFault: 'DOUBLE FAULT', miss: 'MISSED', drop: 'DROPPED', double: 'DOUBLE HIT' }[ev.reason] || 'POINT';
          this.toast(big, `${ev.text} · ${ev.score[0]}–${ev.score[1]}`);
          this.boxDirty = true;
          break;
        }
        case 'gameOver': {
          const t = sim.roster.teams[ev.winner];
          this.addLine('point', `<b>${esc(t.name)} win ${Math.max(...ev.score)}–${Math.min(...ev.score)}</b>`);
          this.renderBox();
          break;
        }
      }
    }

    // ------------------------------------------------------------ box score
    statCells(s) {
      const pct = (a, b) => (b ? ((a / b) * 100).toFixed(0) + '%' : '–');
      const hit = s.att ? ((s.k - s.herr) / s.att).toFixed(3).replace(/^0/, '') : '–';
      return [s.pts, s.k, s.ace, hit, s.digAtt ? `${s.dig}/${s.digAtt}` : '–', pct(s.rec, s.recAtt), s.se, s.err];
    }

    renderBox() {
      this.boxDirty = false;
      const sim = this.sim;
      $('#box').innerHTML = this.boxTable(sim.roster, sim.stats, sim.score);
      const R = sim.rallies;
      if (!R.length) { $('#rally-summary').innerHTML = ''; return; }
      const n = R.length;
      const avg = (f) => (R.reduce((a, r) => a + f(r), 0) / n).toFixed(1);
      const brk = R.filter((r) => r.winner === r.serving).length;
      const longest = Math.max(...R.map((r) => r.poss));
      $('#rally-summary').innerHTML = `<h4>Rallies</h4><div class="kv">
        <span>Rallies played</span><span>${n}</span>
        <span>Avg touches per rally</span><span>${avg((r) => r.touches)}</span>
        <span>Avg possessions per rally</span><span>${avg((r) => r.poss)}</span>
        <span>Longest rally (possessions)</span><span>${longest}</span>
        <span>Break-point rate</span><span>${((brk / n) * 100).toFixed(0)}%</span>
      </div>`;
    }

    boxTable(roster, stats, score, perGame) {
      const head = '<tr><th>Player</th><th>PTS</th><th>K</th><th>ACE</th><th>HIT%</th><th>DIG</th><th>REC</th><th>SE</th><th>ERR</th></tr>';
      let rows = '';
      for (let t = 0; t < 2; t++) {
        const tot = SB.emptyStats();
        const pr = [0, 1].map((i) => {
          const s = stats[t * 2 + i];
          for (const k in s) tot[k] += s[k];
          const cells = this.statCells(s).map((c, j) => (perGame && j < 3 ? (s[['pts', 'k', 'ace'][j]] / perGame).toFixed(1) : c));
          return `<tr><td>${esc(roster.teams[t].players[i].name)}</td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
        }).join('');
        const tc = this.statCells(tot).map((c, j) => (perGame && j < 3 ? (tot[['pts', 'k', 'ace'][j]] / perGame).toFixed(1) : c));
        rows += `<tr class="team-row"><td><span class="swatch" style="background:${esc(roster.teams[t].color)}"></span>${esc(roster.teams[t].name)}${score ? ` · ${score[t]}` : ''}</td>${tc.map((c) => `<td>${c}</td>`).join('')}</tr>${pr}`;
      }
      return `<table class="stats">${head}${rows}</table>`;
    }

    // ------------------------------------------------------------ roster editor
    buildRoster() {
      const root = $('#roster');
      const roster = this.app.roster;
      root.innerHTML = '';
      roster.teams.forEach((team, t) => {
        const card = document.createElement('div');
        card.className = 'team-card';
        card.innerHTML = `<div class="team-head">
            <input type="color" value="${esc(team.color)}" title="Team color">
            <input type="text" value="${esc(team.name)}" maxlength="18" aria-label="Team name">
          </div>`;
        const [col, name] = $$('input', card);
        col.addEventListener('input', () => { team.color = col.value; this.app.rosterChanged(); });
        name.addEventListener('input', () => { team.name = name.value || `Team ${t + 1}`; this.app.rosterChanged(); });

        team.players.forEach((pl) => {
          const pc = document.createElement('div');
          pc.className = 'pcard';
          pc.innerHTML = `<div class="pcard-head">
              <input type="text" value="${esc(pl.name)}" maxlength="16" aria-label="Player name">
              <span class="ovr"></span>
              <button class="btn" title="Random stats">Random</button>
            </div>` + SB.STATS.map((d) => `<div class="stat-row" title="${esc(d.desc)}">
              <label>${esc(d.label)}</label>
              <input type="range" min="1" max="99" data-k="${d.key}" value="${pl.stats[d.key]}">
              <output>${pl.stats[d.key]}</output></div>`).join('');
          const ovr = $('.ovr', pc);
          const setOvr = () => {
            const v = SB.STATS.reduce((a, d) => a + pl.stats[d.key], 0) / SB.STATS.length;
            ovr.textContent = `OVR ${Math.round(v)}`;
          };
          setOvr();
          const nameIn = $('.pcard-head input', pc);
          nameIn.addEventListener('input', () => { pl.name = nameIn.value || 'Player'; this.app.rosterChanged(); });
          $$('input[type=range]', pc).forEach((r) => r.addEventListener('input', () => {
            pl.stats[r.dataset.k] = +r.value;
            r.nextElementSibling.textContent = r.value;
            setOvr();
            this.app.rosterChanged();
          }));
          $('.pcard-head .btn', pc).addEventListener('click', () => {
            Object.assign(pl.stats, SB.randomStats(SB.U.makeRng(Date.now() ^ (Math.random() * 1e9))));
            this.buildRoster();
            this.app.rosterChanged();
          });
          card.appendChild(pc);
        });
        root.appendChild(card);
      });
    }

    // ------------------------------------------------------------ batch
    renderBatch(a) {
      const n = a.done;
      const w0 = (a.wins[0] / n) * 100;
      const pct = (x) => ((x / a.rallies) * 100).toFixed(1) + '%';
      const reasons = Object.entries(a.reasons).sort((x, y) => y[1] - x[1])
        .map(([k, v]) => `<span>${esc(REASON_LABEL[k] || k)}</span><span>${pct(v)}</span>`).join('');
      const roster = { teams: [0, 1].map((t) => ({ name: a.teamNames[t], color: a.colors[t], players: a.names[t].map((nm) => ({ name: nm })) })) };
      $('#batch-out').innerHTML = `
        <div class="winbar">
          <div style="width:${w0}%;background:${esc(a.colors[0])}">${esc(a.teamNames[0])} ${w0.toFixed(0)}%</div>
          <div style="width:${100 - w0}%;background:${esc(a.colors[1])}">${(100 - w0).toFixed(0)}% ${esc(a.teamNames[1])}</div>
        </div>
        <div class="kv">
          <span>Games (to ${a.gameTo})</span><span>${n}</span>
          <span>Record</span><span>${a.wins[0]}–${a.wins[1]}</span>
          <span>Avg score</span><span>${(a.points[0] / n).toFixed(1)} – ${(a.points[1] / n).toFixed(1)}</span>
          <span>Avg winning margin</span><span>${(a.margins / n).toFixed(1)}</span>
          <span>Avg rallies per game</span><span>${(a.rallies / n).toFixed(1)}</span>
          <span>Avg touches per rally</span><span>${(a.touches / a.rallies).toFixed(2)}</span>
          <span>Avg possessions per rally</span><span>${(a.poss / a.rallies).toFixed(2)}</span>
          <span>Break-point rate</span><span>${pct(a.breaks)}</span>
          <span>Avg game length (sim time)</span><span>${(a.simTime / n / 60).toFixed(1)} min</span>
        </div>
        <h4>How points ended</h4><div class="kv">${reasons}</div>
        <h4>Player stats (PTS/K/ACE per game)</h4>${this.boxTable(roster, a.player, null, n)}`;
    }
  }

  SB.UI = UI;
})((globalThis.SB = globalThis.SB || {}));
