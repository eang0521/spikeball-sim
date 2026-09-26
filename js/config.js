// World constants, stat definitions and the default roster.
// Units: meters, seconds. The net sits at the origin, y is up.
(function (SB) {
  'use strict';

  SB.C = {
    G: 9.81,
    DRAG: 0.021, // quadratic drag coefficient (1/m) for a light, hollow ball
    BALL_R: 0.05,

    NET_R: 0.457, // 36" diameter set
    NET_H: 0.23, // rim height
    RIM_TUBE: 0.018,
    POCKET_W: 0.055, // outer band of the net that produces a "pocket" shot
    NET_E: 0.8, // vertical restitution of the net surface (center)
    NET_KEEP_H: 0.9, // horizontal speed kept through a net bounce
    POCKET_E: 0.32,
    ROLLUP_VY: 1.0, // incoming downward speed below which the ball rolls across the net
    GROUND_E: 0.45,

    DT: 1 / 240,
    PRED_DT: 1 / 120,

    SERVE_LINE: 0.457 + 1.83, // servers must be 6ft from the rim
    SERVE_MAX_H: 2.3, // a serve that rebounds higher than the receiver's raised hand is a fault

    SHOULDER_H: 1.38,
    STAND_REACH: 2.2,
    NET_KEEPOUT: 0.457 + 0.28,
    PLAYER_GAP: 0.55,

    POINT_PAUSE: 1.9,
    REPLAY_PAUSE: 1.1,
    SETUP_MAX: 4.5,
  };

  SB.STATS = [
    { key: 'speed', label: 'Speed', short: 'SPD', desc: 'Top running speed' },
    { key: 'agility', label: 'Agility', short: 'AGI', desc: 'Acceleration, jump height, dive range and recovery' },
    { key: 'reactions', label: 'Reactions', short: 'REA', desc: 'Delay before responding to a hit' },
    { key: 'awareness', label: 'Awareness', short: 'AWR', desc: 'Reading the ball, positioning and shot selection' },
    { key: 'servePower', label: 'Serve power', short: 'SVP', desc: 'Serve speed' },
    { key: 'serveAccuracy', label: 'Serve accuracy', short: 'SVA', desc: 'Serve placement and fault rate' },
    { key: 'receiving', label: 'Receiving', short: 'REC', desc: 'First touch on serves and digs' },
    { key: 'setting', label: 'Setting', short: 'SET', desc: 'Second-touch accuracy' },
    { key: 'spikePower', label: 'Spike power', short: 'SPP', desc: 'Hitting speed' },
    { key: 'spikeAccuracy', label: 'Spike accuracy', short: 'SPA', desc: 'Hitting placement and error rate' },
  ];

  const mk = (name, s) => ({ name, stats: s });

  SB.defaultRoster = function () {
    return {
      teams: [
        {
          name: 'Sunfire',
          color: '#f26b3a',
          players: [
            mk('Jordan', { speed: 78, agility: 80, reactions: 74, awareness: 70, servePower: 84, serveAccuracy: 66, receiving: 68, setting: 64, spikePower: 92, spikeAccuracy: 74 }),
            mk('Riley', { speed: 74, agility: 76, reactions: 80, awareness: 86, servePower: 66, serveAccuracy: 84, receiving: 80, setting: 88, spikePower: 70, spikeAccuracy: 82 }),
          ],
        },
        {
          name: 'Tidal',
          color: '#2f7fd8',
          players: [
            mk('Casey', { speed: 86, agility: 88, reactions: 90, awareness: 80, servePower: 64, serveAccuracy: 78, receiving: 90, setting: 76, spikePower: 72, spikeAccuracy: 76 }),
            mk('Morgan', { speed: 70, agility: 72, reactions: 70, awareness: 74, servePower: 92, serveAccuracy: 70, receiving: 70, setting: 72, spikePower: 84, spikeAccuracy: 78 }),
          ],
        },
      ],
    };
  };

  SB.randomStats = function (rng, center = 65, spread = 22) {
    const s = {};
    for (const d of SB.STATS) {
      s[d.key] = Math.round(SB.U.clamp(center + (rng() * 2 - 1) * spread, 1, 99));
    }
    return s;
  };

  SB.cloneRoster = (r) => JSON.parse(JSON.stringify(r));
})((globalThis.SB = globalThis.SB || {}));
