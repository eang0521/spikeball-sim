// Shared helpers. Every module attaches to the global SB namespace so the
// simulation core can run in the browser or headless under Node.
(function (SB) {
  'use strict';

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  function wrapAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  // mulberry32 — small, fast, seedable
  function makeRng(seed) {
    let s = seed >>> 0;
    const rng = function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.gauss = () => {
      let u = 0;
      while (u === 0) u = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
    };
    rng.range = (a, b) => a + (b - a) * rng();
    rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
    return rng;
  }

  const hyp = (x, z) => Math.sqrt(x * x + z * z);
  const distH = (a, b) => hyp(a.x - b.x, a.z - b.z);
  const len3 = (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const copy3 = (v) => ({ x: v.x, y: v.y, z: v.z });

  // Weighted random pick with softmax over scores; low temperature = greedy.
  function softmaxPick(rng, items, scoreOf, temp) {
    let max = -Infinity;
    for (const it of items) max = Math.max(max, scoreOf(it));
    let total = 0;
    const w = items.map((it) => {
      const v = Math.exp((scoreOf(it) - max) / Math.max(temp, 1e-3));
      total += v;
      return v;
    });
    let r = rng() * total;
    for (let i = 0; i < items.length; i++) {
      r -= w[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  SB.U = { clamp, lerp, smooth, wrapAngle, makeRng, hyp, distH, len3, copy3, softmaxPick };
})((globalThis.SB = globalThis.SB || {}));
