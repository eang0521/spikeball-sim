# Spikeball Sim

A 3D 2-v-2 roundnet (Spikeball) simulation that plays itself. Four abstract players (a prism body, a sphere head and two arms) serve, receive, set, spike, jump and dive. What happens is driven by a simple ball-physics engine and each player's ratings.

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

The simulation core (`util`, `config`, `physics`, `player`, `ai`, `game`) has no DOM dependency, so it also runs headless under Node.
