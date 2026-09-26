// Headless multi-game simulation, run in time-sliced chunks so the page stays responsive.
(function (SB) {
  'use strict';

  SB.runBatch = function (roster, games, gameTo, onProgress, onDone) {
    const agg = {
      games, gameTo, done: 0, wins: [0, 0], points: [0, 0], margins: 0,
      rallies: 0, touches: 0, poss: 0, breaks: 0, simTime: 0,
      reasons: {}, player: [0, 1, 2, 3].map(SB.emptyStats),
      names: roster.teams.map((t) => t.players.map((p) => p.name)),
      teamNames: roster.teams.map((t) => t.name),
      colors: roster.teams.map((t) => t.color),
    };
    let sim = null, cancelled = false;
    const seed0 = Math.floor(Math.random() * 1e9);

    function finishGame() {
      agg.wins[sim.winner]++;
      agg.points[0] += sim.score[0];
      agg.points[1] += sim.score[1];
      agg.margins += Math.abs(sim.score[0] - sim.score[1]);
      agg.simTime += sim.time;
      for (const r of sim.rallies) {
        agg.rallies++;
        agg.touches += r.touches;
        agg.poss += r.poss;
        if (r.winner === r.serving) agg.breaks++;
        agg.reasons[r.reason] = (agg.reasons[r.reason] || 0) + 1;
      }
      sim.stats.forEach((s, i) => { for (const k in s) agg.player[i][k] += s[k]; });
      agg.done++;
      sim = null;
    }

    function tick() {
      if (cancelled) return;
      const t0 = performance.now();
      while (performance.now() - t0 < 28 && agg.done < games) {
        if (!sim) sim = new SB.Sim(SB.cloneRoster(roster), { gameTo, seed: seed0 + agg.done });
        for (let i = 0; i < 2000 && sim.phase !== 'over'; i++) sim.step(SB.C.DT);
        if (sim.phase === 'over') finishGame();
      }
      onProgress(agg.done / games);
      if (agg.done < games) setTimeout(tick, 0);
      else onDone(agg);
    }
    setTimeout(tick, 0);
    return { cancel() { cancelled = true; } };
  };
})((globalThis.SB = globalThis.SB || {}));
