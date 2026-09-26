// Three.js view of the simulation. Reads sim state each frame; never mutates it.
(function (SB) {
  'use strict';
  const C = SB.C, U = SB.U;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const DOWN = V3(0, -1, 0);

  // Animation clip names are guessed from common conventions (including Pokémon
  // game rips: wait01, run01, attack01, down01…) unless a roster maps them explicitly.
  const CLIP_GUESS = {
    idle: [/idle/i, /wait/i, /stand/i],
    run: [/run/i, /walk/i, /move/i],
    jump: [/jump/i, /hop/i],
    attack: [/attack/i, /punch/i, /strike/i, /hit/i],
    dive: [/dive/i, /down/i, /faint/i, /fall/i, /damage/i],
    celebrate: [/win|victory/i, /happy|joy|cheer|dance/i, /wave|yes|thumb/i],
  };
  const ONE_SHOT = { attack: true, jump: true, dive: true };

  // Trim transparent padding so sprites stand on the ground and scale by their visible height.
  function cropToContent(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    let data;
    try { data = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { return c; }
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return c;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  function resolveClips(anims, map = {}) {
    const out = {};
    for (const key in CLIP_GUESS) {
      let clip = map[key] ? anims.find((a) => a.name === map[key]) : null;
      for (const re of CLIP_GUESS[key]) {
        if (clip) break;
        clip = anims.find((a) => re.test(a.name));
      }
      if (clip) out[key] = clip;
    }
    if (!out.idle) out.idle = anims[0];
    return out;
  }

  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  class Renderer {
    constructor(container, sim) {
      this.container = container;
      this.sim = sim;
      this.camMode = 'broadcast';
      this.autoAngle = 0;

      const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      r.outputEncoding = THREE.sRGBEncoding;
      container.appendChild(r.domElement);

      const scene = (this.scene = new THREE.Scene());
      scene.background = new THREE.Color(0xbfd9ec);
      scene.fog = new THREE.Fog(0xbfd9ec, 22, 55);

      this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
      this.camera.position.set(0, 4.4, 9);
      this.controls = new THREE.OrbitControls(this.camera, r.domElement);
      this.controls.target.set(0, 0.6, 0);
      this.controls.maxPolarAngle = Math.PI * 0.49;
      this.controls.minDistance = 2.5;
      this.controls.maxDistance = 30;
      this.controls.enableDamping = true;
      this.controls.enabled = false;

      scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x4a6b35, 0.75));
      const sun = new THREE.DirectionalLight(0xffffff, 0.9);
      sun.position.set(6, 12, 5);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const sc = sun.shadow.camera;
      sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 1; sc.far = 30;
      sun.shadow.bias = -0.0005;
      scene.add(sun);

      this.buildGround();
      this.buildNet();
      this.buildBall();
      this.players = sim.players.map((p) => this.buildPlayer(p));
      // look chain: 3D model -> 2D sprite -> prism
      sim.players.forEach((p, i) => {
        const m = this.players[i];
        if (p.def.model && p.def.model.url) this.loadModel(p, m, () => this.loadSprite(p, m));
        else this.loadSprite(p, m);
      });
      this.labels = sim.players.map(() => {
        const d = document.createElement('div');
        d.className = 'plabel';
        container.appendChild(d);
        return d;
      });
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    setSim(sim) { this.sim = sim; }

    resize() {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }

    buildGround() {
      const grass = canvasTex(512, 512, (g, w, h) => {
        g.fillStyle = '#5d9a45';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 9000; i++) {
          const v = Math.random();
          g.fillStyle = v < 0.5 ? 'rgba(40,90,30,0.18)' : 'rgba(140,190,90,0.14)';
          g.fillRect(Math.random() * w, Math.random() * h, 2, 5);
        }
      });
      grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
      grass.repeat.set(14, 14);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshLambertMaterial({ map: grass }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this.scene.add(ground);

      // mowing stripes
      for (let i = -6; i <= 6; i++) {
        if (i % 2 === 0) continue;
        const s = new THREE.Mesh(new THREE.PlaneGeometry(3, 90), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.04, depthWrite: false }));
        s.rotation.x = -Math.PI / 2;
        s.position.set(i * 3, 0.002, 0);
        this.scene.add(s);
      }

      const line = new THREE.Mesh(
        new THREE.RingGeometry(C.SERVE_LINE - 0.025, C.SERVE_LINE + 0.025, 96),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false })
      );
      line.rotation.x = -Math.PI / 2;
      line.position.y = 0.004;
      this.scene.add(line);
    }

    buildNet() {
      const g = (this.netGroup = new THREE.Group());
      const yellow = new THREE.MeshStandardMaterial({ color: 0xf6d31c, roughness: 0.45 });
      const black = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.7 });

      const rim = new THREE.Mesh(new THREE.TorusGeometry(C.NET_R, C.RIM_TUBE, 12, 72), yellow);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = C.NET_H;
      rim.castShadow = true;
      g.add(rim);

      const netTex = canvasTex(256, 256, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.strokeStyle = 'rgba(15,15,15,0.95)';
        c.lineWidth = 3;
        for (let i = 0; i <= w; i += 14) {
          c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke();
          c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke();
        }
      });
      // subdivide radially so the net can dent under the ball
      this.netGeo = new THREE.RingGeometry(0.0001, C.NET_R - 0.004, 40, 10);
      this.netBase = Float32Array.from(this.netGeo.attributes.position.array);
      const net = (this.netMesh = new THREE.Mesh(
        this.netGeo,
        new THREE.MeshStandardMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, roughness: 0.9, color: 0x333333, opacity: 0.95 })
      ));
      net.rotation.x = -Math.PI / 2;
      net.position.y = C.NET_H - 0.004;
      net.receiveShadow = true;
      g.add(net);

      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const top = V3(Math.cos(a) * C.NET_R, C.NET_H - 0.01, Math.sin(a) * C.NET_R);
        const bot = V3(Math.cos(a) * (C.NET_R + 0.07), 0, Math.sin(a) * (C.NET_R + 0.07));
        const len = top.distanceTo(bot);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, len, 8), black);
        leg.position.copy(top).add(bot).multiplyScalar(0.5);
        leg.quaternion.setFromUnitVectors(V3(0, 1, 0), top.clone().sub(bot).normalize());
        leg.castShadow = true;
        g.add(leg);
      }
      this.scene.add(g);
    }

    buildBall() {
      const tex = canvasTex(128, 64, (c, w, h) => {
        c.fillStyle = '#ffd400';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#1c1c1c';
        for (let i = 0; i < 4; i++) c.fillRect((i * w) / 4 + 10, 0, 5, h);
      });
      const ball = (this.ball = new THREE.Mesh(
        new THREE.SphereGeometry(C.BALL_R * 1.15, 20, 14),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 })
      ));
      ball.castShadow = true;
      this.scene.add(ball);

      this.ballShadow = new THREE.Mesh(
        new THREE.CircleGeometry(C.BALL_R * 1.3, 20),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
      );
      this.ballShadow.rotation.x = -Math.PI / 2;
      this.scene.add(this.ballShadow);

      this.trailN = 26;
      this.trailPts = [];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailN * 3), 3));
      this.trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff27a, transparent: true, opacity: 0.55 }));
      this.trail.frustumCulled = false;
      this.scene.add(this.trail);
    }

    buildPlayer(p) {
      const teamColor = new THREE.Color(this.sim.roster.teams[p.team].color);
      const root = new THREE.Group();
      const body = new THREE.Group(); // leans / dives, pivot at the feet
      root.add(body);

      const jersey = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.6 });
      const numTex = canvasTex(128, 128, (c, w, h) => {
        c.fillStyle = '#' + teamColor.getHexString();
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#ffffff';
        c.font = 'bold 84px system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(String(p.idx + 1 + p.team * 2), w / 2, h / 2 + 4);
      });
      const front = new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.6 });
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 1.42, 0.26), [jersey, jersey, jersey, jersey, front, jersey]);
      torso.position.y = 0.71;
      torso.castShadow = true;
      body.add(torso);

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), new THREE.MeshStandardMaterial({ color: 0xe0b48f, roughness: 0.7 }));
      head.position.y = 1.58;
      head.castShadow = true;
      body.add(head);

      // hands are free-floating balls; an invisible pivot at each shoulder swings them around
      const handMat = new THREE.MeshStandardMaterial({ color: teamColor.clone().lerp(new THREE.Color(0xffffff), 0.35), roughness: 0.5 });
      const arms = [-1, 1].map((side) => {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.3, C.SHOULDER_H, 0);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), handMat);
        hand.position.y = -0.6;
        hand.castShadow = true;
        pivot.add(hand);
        body.add(pivot);
        return pivot;
      });

      const disc = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.36, 32),
        new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.7, depthWrite: false })
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.006;
      root.add(disc);

      this.scene.add(root);
      return { root, body, torso, head, arms, disc, jersey, handMat, front, runPhase: 0, color: teamColor.getHex() };
    }

    notice(msg) {
      console.warn(msg);
      if (this.onNotice) this.onNotice(msg);
    }

    // Replace the prism with a glTF model if the roster gives one:
    // def.model = { url, height (m), yaw (deg), hands (bool), anims: { idle: 'clipName', … } }
    loadModel(p, m, onFail) {
      const cfg = p.def.model;
      if (!cfg || !cfg.url) return;
      if (!THREE.GLTFLoader) { this.notice('glTF loader unavailable; using prism players'); return; }
      this.loader = this.loader || new THREE.GLTFLoader();
      this.loader.load(cfg.url, (gltf) => {
        const model = gltf.scene;
        model.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.frustumCulled = false; // skinned meshes often have stale bounds
          for (const mat of [].concat(o.material)) {
            // exported rips often come out fully metallic, which renders black without an env map
            if (mat && mat.metalness !== undefined) mat.metalness = Math.min(mat.metalness, 0.15);
          }
        });
        const height = cfg.height || 1.6;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        model.scale.multiplyScalar(height / (size.y || 1));
        box.setFromObject(model);
        const c = box.getCenter(new THREE.Vector3());
        model.position.x -= c.x;
        model.position.z -= c.z;
        model.position.y -= box.min.y;
        const holder = new THREE.Group();
        holder.rotation.y = ((cfg.yaw || 0) * Math.PI) / 180;
        holder.add(model);
        m.body.add(holder);
        m.torso.visible = false;
        m.head.visible = false;
        const halfW = Math.max(size.x, size.z) * (height / (size.y || 1)) * 0.5;
        m.arms.forEach((a, i) => {
          a.visible = cfg.hands !== false;
          a.position.x = (i ? 1 : -1) * U.clamp(halfW * 0.7 + 0.08, 0.3, 0.6);
        });
        m.model = { holder, height };
        m.figureH = height;
        if (gltf.animations.length) {
          m.mixer = new THREE.AnimationMixer(model);
          m.clips = resolveClips(gltf.animations, cfg.anims);
          m.clipKey = null;
        }
      }, undefined, () => {
        const next = p.def.sprite && p.def.sprite.url ? 'its sprite' : 'a prism';
        this.notice(`Couldn't load the model for ${p.name} (${cfg.url}); using ${next} instead.`);
        if (onFail) onFail();
      });
    }

    // Replace the prism with a camera-facing 2D sprite:
    // def.sprite = { url, height (m), facesLeft (bool, default true), hands (bool) }
    loadSprite(p, m) {
      const cfg = p.def.sprite;
      if (!cfg || !cfg.url) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const tex = new THREE.CanvasTexture(cropToContent(img));
        tex.encoding = THREE.sRGBEncoding;
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.2 }));
        spr.center.set(0.5, 0); // stand on the ground
        const h = cfg.height || 1.4;
        const w = (h * tex.image.width) / tex.image.height;
        spr.scale.set(w, h, 1);
        m.root.add(spr);

        const blob = new THREE.Mesh(
          new THREE.CircleGeometry(Math.min(0.45, w * 0.4), 24),
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
        );
        blob.rotation.x = -Math.PI / 2;
        blob.position.y = 0.004;
        m.root.add(blob);

        m.torso.visible = false;
        m.head.visible = false;
        m.arms.forEach((a, i) => {
          a.visible = cfg.hands !== false;
          a.position.x = (i ? 1 : -1) * U.clamp(w * 0.38 + 0.06, 0.3, 0.6);
        });
        m.sprite = { spr, blob, w, h, facesLeft: cfg.facesLeft !== false, flip: 1, rot: 0 };
        m.figureH = h;
      };
      img.onerror = () => this.notice(`Couldn't load the sprite for ${p.name} (${cfg.url}); using a prism instead.`);
      img.src = cfg.url;
    }

    // Code-driven motion for sprites: flip toward travel, bob, squash, dive, celebrate.
    animateSprite(p, m, speed, crouch, dt) {
      const S = m.sprite, now = this.sim.time;
      const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      let dx = p.vel.x, dz = p.vel.z;
      if (speed < 0.6) { dx = Math.sin(p.facing); dz = Math.cos(p.facing); }
      const right = dx * camRight.x + dz * camRight.z;
      if (Math.abs(right) > 0.2) S.flip = (right > 0) === S.facesLeft ? -1 : 1;

      let sx = 1 + crouch * 0.7, sy = 1 - crouch * 1.3, rot = 0, y = 0;
      if (speed > 1.2) y = Math.abs(Math.sin(m.runPhase)) * 0.08;
      const lc = p.lastContact;
      if (lc && now - lc.t < 0.25) {
        const k = 1 - (now - lc.t) / 0.25;
        sy += 0.14 * k;
        sx -= 0.08 * k;
        const r = lc.dir.x * camRight.x + lc.dir.z * camRight.z;
        rot = -Math.sign(r) * 0.25 * k;
      }
      if (p.state === 'dive' || p.state === 'down') {
        const k = p.state === 'dive' ? U.clamp(p.stateT / 0.2, 0, 1) : U.clamp(1 - (p.stateT - p.diveRecover * 0.6) / (p.diveRecover * 0.4), 0, 1);
        const r = p.diveDir.x * camRight.x + p.diveDir.z * camRight.z;
        rot = -(r >= 0 ? 1 : -1) * 1.35 * k;
        sy = 1;
        sx = 1;
      }
      if (p.celebrate === 'win') { y = Math.abs(Math.sin(now * 9 + p.id)) * 0.25; rot = Math.sin(now * 9 + p.id) * 0.12; }
      else if (p.celebrate === 'lose') sy *= 0.93;

      S.rot = U.lerp(S.rot, rot, Math.min(1, dt * 14));
      S.spr.material.rotation = S.rot;
      S.spr.scale.set(S.w * sx * S.flip, S.h * sy, 1);
      S.spr.position.y = y;
      S.blob.visible = p.y < 0.05 && y < 0.2;
    }

    playClip(m, key, timeScale) {
      let clip = m.clips[key];
      if (!clip) {
        if (ONE_SHOT[key] && m.clipKey) return; // no clip for it: keep whatever is playing
        key = 'idle';
        clip = m.clips.idle;
      }
      const action = m.mixer.clipAction(clip);
      action.timeScale = timeScale;
      if (m.clipKey === key) return;
      const prev = m.clipKey && m.mixer.clipAction(m.clips[m.clipKey]);
      action.reset();
      action.setLoop(ONE_SHOT[key] ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = !!ONE_SHOT[key];
      action.fadeIn(0.12).play();
      if (prev && prev !== action) prev.fadeOut(0.12);
      m.clipKey = key;
    }

    animateModel(p, m, speed, dt) {
      if (!m.mixer) return;
      const now = this.sim.time, lc = p.lastContact, plan = p.plan;
      let key = 'idle', ts = 1;
      if (p.celebrate === 'win') key = 'celebrate';
      else if (p.state === 'dive' || p.state === 'down') key = 'dive';
      else if ((lc && now - lc.t < 0.35) || (plan && plan.kind === 'hit' && plan.t - now < 0.25)) key = 'attack';
      else if (p.y > 0.05) key = 'jump';
      else if (speed > 0.8) { key = 'run'; ts = U.clamp(speed / 4, 0.6, 1.8); }
      this.playClip(m, key, ts);
      m.mixer.update(dt);
    }

    refreshTeamColors() {
      this.sim.players.forEach((p, i) => {
        const col = new THREE.Color(this.sim.roster.teams[p.team].color);
        const m = this.players[i];
        if (m.color === col.getHex()) return;
        m.color = col.getHex();
        m.jersey.color.copy(col);
        m.handMat.color.copy(col).lerp(new THREE.Color(0xffffff), 0.35);
        m.disc.material.color.copy(col);
        // redraw number texture
        const img = m.front.map.image, c = img.getContext('2d');
        c.fillStyle = '#' + col.getHexString();
        c.fillRect(0, 0, img.width, img.height);
        c.fillStyle = '#ffffff';
        c.font = 'bold 84px system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(String(p.idx + 1 + p.team * 2), img.width / 2, img.height / 2 + 4);
        m.front.map.needsUpdate = true;
      });
    }

    // ------------------------------------------------------------ per frame
    render(dtReal) {
      const sim = this.sim;
      this.updateBall();
      this.updateNet();
      sim.players.forEach((p, i) => this.updatePlayer(p, this.players[i], dtReal));
      this.updateCamera(dtReal);
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
    }

    updateBall() {
      const b = this.sim.ball.p;
      this.ball.position.set(b.x, b.y, b.z);
      const v = this.sim.ball.v;
      this.ball.rotation.x += v.z * 0.02;
      this.ball.rotation.z -= v.x * 0.02;
      this.ballShadow.position.set(b.x, 0.005, b.z);
      const s = U.clamp(1.4 - b.y * 0.25, 0.5, 1.4);
      this.ballShadow.scale.set(s, s, s);
      this.ballShadow.material.opacity = U.clamp(0.45 - b.y * 0.08, 0.1, 0.45);

      const live = this.sim.phase === 'live' || this.sim.phase === 'dead' || this.sim.phase === 'toss';
      if (live && !this.sim.ball.holder) {
        const last = this.trailPts[this.trailPts.length - 1];
        if (!last || Math.abs(last.x - b.x) + Math.abs(last.y - b.y) + Math.abs(last.z - b.z) > 0.03) {
          this.trailPts.push({ x: b.x, y: b.y, z: b.z });
          if (this.trailPts.length > this.trailN) this.trailPts.shift();
        }
      } else this.trailPts.length = 0;
      const arr = this.trail.geometry.attributes.position.array;
      const n = this.trailPts.length;
      for (let i = 0; i < this.trailN; i++) {
        const q = this.trailPts[Math.min(i, n - 1)] || b;
        arr[i * 3] = q.x; arr[i * 3 + 1] = q.y; arr[i * 3 + 2] = q.z;
      }
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.trail.geometry.setDrawRange(0, n);
    }

    updateNet() {
      const hit = this.sim.lastNetHit;
      const pos = this.netGeo.attributes.position;
      const base = this.netBase;
      const age = hit ? this.sim.time - hit.t : 99;
      if (age > 0.6 && !this.netDirty) return;
      this.netDirty = age <= 0.6;
      const amp = age <= 0.6 ? Math.min(0.09, 0.012 + hit.power * 0.004) * Math.exp(-age * 9) * Math.cos(age * 38) : 0;
      // ring geometry lies in XY before the mesh rotation; world (x, z) maps to (x, -y)
      const hx = hit ? hit.x : 0, hy = hit ? -hit.z : 0;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        const d2 = (x - hx) * (x - hx) + (y - hy) * (y - hy);
        const edge = 1 - Math.min(1, Math.sqrt(x * x + y * y) / C.NET_R);
        pos.array[i * 3 + 2] = -amp * Math.exp(-d2 / 0.03) * Math.min(1, edge * 4);
      }
      pos.needsUpdate = true;
    }

    updatePlayer(p, m, dt) {
      const sim = this.sim;
      m.root.position.set(p.pos.x, p.y, p.pos.z);
      m.root.rotation.y = p.facing;

      const speed = Math.hypot(p.vel.x, p.vel.z);
      const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
      const vFwd = p.vel.x * fx + p.vel.z * fz;
      const vSide = p.vel.x * fz - p.vel.z * fx;

      // body posture
      let pitch = U.clamp(vFwd * 0.045, -0.2, 0.3);
      let roll = U.clamp(-vSide * 0.03, -0.2, 0.2);
      let crouch = 0;
      const plan = p.plan;
      const tTo = plan ? plan.t - sim.time : 99;
      if (sim.phase === 'live' && plan && tTo < 0.6 && (plan.kind === 'pass' || plan.kind === 'set')) crouch = plan.kind === 'pass' ? 0.16 : 0.06;
      else if (sim.phase === 'live' && sim.r.playTeam >= 0 && speed < 1.5) crouch = 0.08;
      if (p.state === 'dive' || p.state === 'down') {
        // lay out in the dive direction
        const local = Math.atan2(p.diveDir.x, p.diveDir.z) - p.facing;
        const k = p.state === 'dive' ? U.clamp(p.stateT / 0.2, 0, 1) : U.clamp(1 - (p.stateT - p.diveRecover * 0.6) / (p.diveRecover * 0.4), 0, 1);
        pitch = 1.35 * k * Math.cos(local);
        roll = -1.35 * k * Math.sin(local);
        crouch = 0;
      }
      m.body.rotation.x = U.lerp(m.body.rotation.x, pitch, Math.min(1, dt * 14));
      m.body.rotation.z = U.lerp(m.body.rotation.z, roll, Math.min(1, dt * 14));
      m.runPhase += speed * dt * 2.4;
      if (m.model) {
        // models squash instead of sinking into the ground, and bob when they have no run clip
        const bob = !m.mixer && speed > 1.2 ? Math.abs(Math.sin(m.runPhase)) * 0.06 : 0;
        m.body.scale.y = U.lerp(m.body.scale.y, 1 - crouch * 0.9, Math.min(1, dt * 12));
        m.body.position.y = bob;
        this.animateModel(p, m, speed, dt);
      } else {
        m.body.position.y = U.lerp(m.body.position.y, -crouch, Math.min(1, dt * 12));
        if (m.sprite) this.animateSprite(p, m, speed, crouch, dt);
      }
      m.disc.visible = p.y < 0.05;
      m.body.updateMatrixWorld(true);

      const targets = this.armTargets(p, m, speed);
      const inv = new THREE.Quaternion();
      m.body.getWorldQuaternion(inv);
      inv.invert();
      const rate = Math.min(1, dt * (targets.fast ? 30 : 14));
      m.arms.forEach((pivot, i) => {
        let dir = targets.dirs[i].clone();
        if (targets.world[i]) dir.applyQuaternion(inv);
        dir.normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(DOWN, dir);
        pivot.quaternion.slerp(q, rate);
      });
    }

    // Returns arm directions (left, right); world[i] says whether dirs[i] is in world space.
    armTargets(p, m, speed) {
      const sim = this.sim, now = sim.time, b = sim.ball.p;
      const L = (x, y, z) => V3(x, y, z);
      const toBall = (side) => {
        const sh = V3(side * 0.3, C.SHOULDER_H, 0);
        m.body.localToWorld(sh);
        return V3(b.x - sh.x, b.y - sh.y, b.z - sh.z);
      };
      // one-handed touches use whichever hand is on the ball's side
      const pair = (side, active, activeWorld, rest) =>
        side < 0 ? { dirs: [active, rest], world: [activeWorld, false] } : { dirs: [rest, active], world: [false, activeWorld] };

      if (p.celebrate === 'win') {
        const w = Math.sin(now * 12) * 0.25;
        return { dirs: [L(-0.35 + w, 1, 0.1), L(0.35 - w, 1, 0.1)], world: [false, false] };
      }
      if (p.celebrate === 'lose') return { dirs: [L(-0.1, -1, 0.05), L(0.1, -1, 0.05)], world: [false, false] };

      if (p.state === 'dive' || p.state === 'down') return { dirs: [L(-0.15, 0.2, 1), L(0.15, 0.2, 1)], world: [false, false] };

      // serving
      if (p.id === sim.serverId && (sim.phase === 'ready' || sim.phase === 'setup' || sim.phase === 'toss')) {
        if (sim.phase === 'toss') return { dirs: [L(-0.2, -0.3, 1), L(0.3, 0.2, -1)], world: [false, false], fast: true };
        return { dirs: [L(0.25, -0.5, 1), L(0.35, -0.8, -0.4)], world: [false, false] };
      }

      // follow-through
      const lc = p.lastContact;
      if (lc && now - lc.t < 0.32) {
        const d = V3(lc.dir.x, lc.dir.y, lc.dir.z);
        if (lc.kind === 'hit' || lc.kind === 'serve') {
          const follow = d.clone().add(V3(0, -0.6, 0));
          return { dirs: [L(-0.2, -0.4, 0.8), follow], world: [false, true], fast: true };
        }
        if (lc.kind === 'set') {
          const side = m.setSide || 1;
          return Object.assign(pair(side, d.clone().add(V3(0, 0.5, 0)), true, L(-side * 0.35, -0.8, 0.4)), { fast: true });
        }
        return { dirs: [d, d.clone()], world: [true, true], fast: true };
      }

      // reaching for an upcoming touch
      const plan = p.plan;
      if (sim.phase === 'live' && plan) {
        const tTo = plan.t - now;
        if (tTo < 0.5) {
          if (plan.kind === 'hit') {
            const cock = tTo > 0.1;
            return {
              dirs: [toBall(-1), cock ? L(0.25, 1, -0.9) : toBall(1)],
              world: [true, !cock],
              fast: !cock,
            };
          }
          if (plan.kind === 'set') {
            // roundnet has no two-handed sets: pop it up with one hand
            const local = m.body.worldToLocal(V3(b.x, b.y, b.z));
            m.setSide = local.x >= 0 ? 1 : -1;
            return pair(m.setSide, toBall(m.setSide), true, L(-m.setSide * 0.35, -0.8, 0.4));
          }
          // pass: platform, hands together below the ball
          const tb = toBall(0);
          tb.y = Math.min(-0.45 * Math.hypot(tb.x, tb.z), tb.y);
          return { dirs: [tb, tb.clone()], world: [true, true] };
        }
      }

      // running
      if (speed > 1.2) {
        const s = Math.sin(m.runPhase) * 0.9;
        return { dirs: [L(-0.12, -1, s), L(0.12, -1, -s)], world: [false, false] };
      }
      // ready position when the ball is live
      if (sim.phase === 'live') return { dirs: [L(-0.35, -0.65, 0.75), L(0.35, -0.65, 0.75)], world: [false, false] };
      return { dirs: [L(-0.18, -1, 0.12), L(0.18, -1, 0.12)], world: [false, false] };
    }

    updateCamera(dt) {
      const cam = this.camera, b = this.sim.ball.p;
      const mode = this.camMode;
      this.controls.enabled = mode === 'orbit';
      if (mode === 'orbit') { this.controls.update(); return; }
      let pos, look;
      if (mode === 'broadcast') { pos = V3(0, 4.4, 9.2); look = V3(0, 0.5, 0); }
      else if (mode === 'overhead') { pos = V3(0, 13, 3.2); look = V3(0, 0, 0); }
      else if (mode === 'follow') {
        const bx = U.clamp(b.x, -8, 8), bz = U.clamp(b.z, -8, 8);
        pos = V3(bx * 0.45, 3.2, bz * 0.45 + 7.2);
        look = V3(bx * 0.7, Math.min(b.y, 2) * 0.5 + 0.3, bz * 0.7);
      } else {
        this.autoAngle += dt * 0.12;
        pos = V3(Math.sin(this.autoAngle) * 8.5, 3.6, Math.cos(this.autoAngle) * 8.5);
        look = V3(0, 0.5, 0);
      }
      const k = Math.min(1, dt * (mode === 'follow' ? 3 : 4));
      cam.position.lerp(pos, k);
      this.controls.target.lerp(look, k);
      cam.lookAt(this.controls.target);
    }

    setCamera(mode) { this.camMode = mode; }

    updateLabels() {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      const v = new THREE.Vector3();
      this.sim.players.forEach((p, i) => {
        const el = this.labels[i];
        const m = this.players[i];
        v.set(p.pos.x, Math.max(2.0, (m.figureH || 0) + 0.3) + p.y, p.pos.z).project(this.camera);
        if (v.z > 1) { el.style.display = 'none'; return; }
        el.style.display = '';
        el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
        const serving = p.id === this.sim.serverId && this.sim.phase !== 'live' && this.sim.phase !== 'over';
        const txt = p.name + (serving ? ' ●' : '');
        if (el.textContent !== txt) el.textContent = txt;
        el.style.setProperty('--team', this.sim.roster.teams[p.team].color);
      });
    }
  }

  SB.Renderer = Renderer;
})((globalThis.SB = globalThis.SB || {}));
