# Spikeball Sim

A 3D 2-v-2 roundnet (Spikeball) simulation that plays itself. Four abstract players (a prism body, a sphere head and two ball "hands" floating at its sides) serve, receive, set, spike, jump and dive. As in real roundnet, sets are one-handed: there is no two-handed volleyball set. What happens is driven by a simple ball-physics engine and each player's ratings.

## Run

Serve the folder with any static server and open it in a browser. For example:

```
python -m http.server 8765
```

Then go to http://localhost:8765. Three.js loads from a CDN, so you need an internet connection.

**Keys:** Space pauses or plays · 1–5 set the speed · C cycles the camera · N starts a new game

## How it works

| File | Role |
| --- | --- |
| `js/physics.js` | Ball flight with gravity and drag. Handles contact with the net (trampoline bounce that absorbs more on hard hits, pocket shots and roll-ups), the rim, the frame and the ground. Also predicts trajectories and solves for the velocity needed to hit a target. |
| `js/player.js` | Turns ratings into physical traits (top speed, acceleration, reaction delay, jump, dive reach) and moves players, steering them around the net. |
| `js/ai.js` | Decides who plays the ball, where each player intercepts it, and when to jump or dive. Rolls touch quality from difficulty and skill. Picks serve and spike placements by predicting each candidate shot against the defenders. |
| `js/game.js` | Applies standard rules: rally scoring, win by 2, up to 3 touches, no consecutive touches by the same player, a second serve after a fault, the "serve too high" fault, serve rotation, and rim, frame, roll-up and double-net faults. Also tracks stats. |
| `js/render.js` | Three.js scene, player animation and cameras. |
| `js/ui.js`, `js/main.js`, `js/batch.js` | Scoreboard, play-by-play, box score, the live roster editor (saved in localStorage) and batch simulation. |

## Custom rosters and 3D models

A script loaded before `js/main.js` can set `SB.MODE = { defaultRoster, title, storageKey }` to supply its own roster. Any player in a roster can use a glTF model in place of the prism:

```js
{ name: 'Robo', stats: { ... }, tag: 'optional subtitle',
  model: { url: 'models/robo.glb', height: 1.5, yaw: 0, hands: true,
           anims: { idle: 'Idle', run: 'Running', jump: 'Jump', attack: 'Punch', dive: 'Death', celebrate: 'Dance' } } }
```

Models are scaled to `height` and centred on the player. The `yaw` value (in degrees) fixes models that face the wrong way. Animation clips are matched by name when `anims` is left out. Models without clips get simple procedural motion (lean, bob, squash). The floating ball hands stay on by default so touches remain readable.

The simulation core (`util`, `config`, `physics`, `player`, `ai`, `game`) has no DOM dependency, so it also runs headless under Node.
