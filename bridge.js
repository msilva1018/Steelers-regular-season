/* ============================================================
   bridge.js — the Roberto Clemente Bridge, built from scratch.
   Self-anchored suspension: the eyebar chains land on the deck
   at both ends instead of in ground anchorages.
   ============================================================ */

const BridgeScene = (() => {
  const GOLD = 0xfdb827;
  const DECK_Y = 14;
  const TOWER_TOP = 38;
  const HALF_MAIN = 54;   // towers sit here
  const HALF_TOTAL = 104; // chains land on the deck here
  const HALF_W = 8;       // chain offset from centerline
  const MID_SAG = 19;     // chain height at midspan

  let renderer, scene, camera, water, waterBase, clock;
  let running = false, mode = 'idle', flyStart = 0, onDone = null;
  let ready = false, reduced = false;
  const FLY_MS = 7200;

  const posCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-196, 7, 58),
    new THREE.Vector3(-124, 6, 27),
    new THREE.Vector3(-58, 9, 13),
    new THREE.Vector3(-8, 21, 27),
    new THREE.Vector3(58, 40, 52),
    new THREE.Vector3(124, 44, 130)
  ]);
  const lookCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-104, 16, 0),
    new THREE.Vector3(-62, 20, 0),
    new THREE.Vector3(0, 25, 0),
    new THREE.Vector3(44, 26, 0),
    new THREE.Vector3(20, 16, 0),
    new THREE.Vector3(0, 18, 0)
  ]);
  const HERO_POS = new THREE.Vector3(124, 44, 130);
  const HERO_LOOK = new THREE.Vector3(0, 18, 0);

  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* chain height at a given x, in the shape the real bridge makes */
  function chainY(x) {
    const ax = Math.abs(x);
    if (ax <= HALF_MAIN) {
      const u = ax / HALF_MAIN;
      return MID_SAG + (TOWER_TOP - MID_SAG) * u * u;
    }
    const u = (ax - HALF_MAIN) / (HALF_TOTAL - HALF_MAIN);
    return TOWER_TOP - (TOWER_TOP - (DECK_Y + 0.9)) * Math.pow(u, 1.35);
  }

  function steel(color, rough, metal) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  }

  function buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: `
        varying float vH;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vH = normalize(wp.xyz).y;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        varying float vH;
        void main(){
          float h = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
          vec3 low  = vec3(0.129, 0.098, 0.063);
          vec3 mid  = vec3(0.043, 0.075, 0.094);
          vec3 high = vec3(0.012, 0.024, 0.035);
          vec3 c = mix(low, mid, smoothstep(0.44, 0.56, h));
          c = mix(c, high, smoothstep(0.55, 0.95, h));
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    scene.add(new THREE.Mesh(geo, mat));
  }

  function buildWater() {
    const geo = new THREE.PlaneGeometry(1800, 1800, 110, 110);
    geo.rotateX(-Math.PI / 2);
    waterBase = Float32Array.from(geo.attributes.position.array);
    water = new THREE.Mesh(geo, steel(0x0a1c22, 0.16, 0.72));
    scene.add(water);
  }

  function rippleWater(t) {
    const p = water.geometry.attributes.position;
    const a = p.array;
    for (let i = 0; i < a.length; i += 3) {
      const x = waterBase[i], z = waterBase[i + 2];
      a[i + 1] =
        Math.sin(x * 0.055 + t * 1.15) * 0.30 +
        Math.sin(z * 0.041 - t * 0.85) * 0.24 +
        Math.sin((x + z) * 0.021 + t * 0.55) * 0.34;
    }
    p.needsUpdate = true;
  }

  function buildChains(group) {
    const mat = steel(GOLD, 0.34, 0.88);
    for (const z of [-HALF_W, HALF_W]) {
      const pts = [];
      for (let x = -HALF_TOTAL; x <= HALF_TOTAL; x += 2) pts.push(new THREE.Vector3(x, chainY(x), z));
      const curve = new THREE.CatmullRomCurve3(pts);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 200, 0.44, 8, false), mat));
    }
  }

  function buildSuspenders(group) {
    const step = 4.2;
    const spots = [];
    for (let x = -HALF_TOTAL + step; x < HALF_TOTAL; x += step) {
      if (Math.abs(Math.abs(x) - HALF_MAIN) < 2.4) continue;
      const h = chainY(x) - (DECK_Y + 0.6);
      if (h > 0.9) spots.push([x, h]);
    }
    const geo = new THREE.CylinderGeometry(0.11, 0.11, 1, 6);
    const mesh = new THREE.InstancedMesh(geo, steel(GOLD, 0.4, 0.8), spots.length * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    let i = 0;
    for (const [x, h] of spots) {
      for (const z of [-HALF_W, HALF_W]) {
        m.compose(
          new THREE.Vector3(x, DECK_Y + 0.6 + h / 2, z),
          q,
          new THREE.Vector3(1, h, 1)
        );
        mesh.setMatrixAt(i++, m);
      }
    }
    group.add(mesh);
  }

  function buildTower(group, x) {
    const mat = steel(GOLD, 0.36, 0.85);
    const h = TOWER_TOP - DECK_Y + 3;
    for (const z of [-HALF_W, HALF_W]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.7, h, 1.7), mat);
      post.position.set(x, DECK_Y - 1.5 + h / 2, z);
      group.add(post);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 2.6), mat);
      cap.position.set(x, TOWER_TOP + 1.4, z);
      group.add(cap);
    }
    for (const y of [DECK_Y + 6, DECK_Y + 15, TOWER_TOP - 0.6]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, HALF_W * 2), mat);
      beam.position.set(x, y, 0);
      group.add(beam);
    }
    for (const dir of [1, -1]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.7, 20, 0.7), mat);
      brace.position.set(x, DECK_Y + 10.5, 0);
      brace.rotation.x = dir * 0.66;
      group.add(brace);
    }
  }

  function buildDeck(group) {
    const road = new THREE.Mesh(new THREE.BoxGeometry(300, 0.55, 17.4), steel(0x1b2126, 0.94, 0.05));
    road.position.set(0, DECK_Y + 0.3, 0);
    group.add(road);

    const slab = new THREE.Mesh(new THREE.BoxGeometry(300, 0.9, 18.6), steel(0x2b3238, 0.9, 0.1));
    slab.position.set(0, DECK_Y - 0.3, 0);
    group.add(slab);

    /* centerline dashes */
    const dashGeo = new THREE.BoxGeometry(3.2, 0.06, 0.3);
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xd8c37a, roughness: 0.8, emissive: 0x4a3c14 });
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, 30);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let x = -HALF_TOTAL; x <= HALF_TOTAL && i < 30; x += 7.2) {
      m.setPosition(x, DECK_Y + 0.6, 0);
      dashes.setMatrixAt(i++, m);
    }
    dashes.count = i;
    group.add(dashes);

    /* stiffening girders and railings */
    const gMat = steel(GOLD, 0.42, 0.8);
    for (const z of [-9.1, 9.1]) {
      const girder = new THREE.Mesh(new THREE.BoxGeometry(210, 1.9, 0.7), gMat);
      girder.position.set(0, DECK_Y - 1.1, z);
      group.add(girder);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(210, 0.22, 0.22), gMat);
      rail.position.set(0, DECK_Y + 1.9, z);
      group.add(rail);
    }

    /* cross bracing under the deck */
    const braceGeo = new THREE.BoxGeometry(0.45, 0.45, 19.6);
    const braces = new THREE.InstancedMesh(braceGeo, gMat, 34);
    let j = 0;
    for (let x = -HALF_TOTAL; x <= HALF_TOTAL && j < 34; x += 6.5) {
      m.setPosition(x, DECK_Y - 1.7, 0);
      braces.setMatrixAt(j++, m);
    }
    braces.count = j;
    group.add(braces);
  }

  function buildPiers(group) {
    const mat = steel(0x4c5254, 0.96, 0.04);
    for (const x of [-HALF_MAIN, HALF_MAIN]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(12, DECK_Y + 1, 25), mat);
      pier.position.set(x, (DECK_Y + 1) / 2 - 0.6, 0);
      group.add(pier);
      for (const z of [-12.5, 12.5]) {
        const nose = new THREE.Mesh(new THREE.BoxGeometry(8.5, DECK_Y - 1, 8.5), mat);
        nose.position.set(x, (DECK_Y - 1) / 2 - 0.6, z);
        nose.rotation.y = Math.PI / 4;
        group.add(nose);
      }
    }
    for (const x of [-HALF_TOTAL - 22, HALF_TOTAL + 22]) {
      const bent = new THREE.Mesh(new THREE.BoxGeometry(7, DECK_Y, 20), mat);
      bent.position.set(x, DECK_Y / 2 - 0.8, 0);
      group.add(bent);
    }
  }

  function buildLamps(group) {
    const postMat = steel(0x2f3538, 0.7, 0.5);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffe6b0, emissive: 0xffcf7a, emissiveIntensity: 2.4, roughness: 0.4
    });
    for (let x = -HALF_TOTAL + 8; x <= HALF_TOTAL; x += 17) {
      for (const z of [-8.6, 8.6]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5, 6), postMat);
        post.position.set(x, DECK_Y + 3.1, z);
        group.add(post);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), bulbMat);
        bulb.position.set(x, DECK_Y + 5.7, z);
        group.add(bulb);
      }
    }
  }

  function buildSkyline() {
    const dark = steel(0x0e171c, 0.95, 0.06);
    const lit = new THREE.MeshStandardMaterial({
      color: 0x2a2a1e, emissive: 0xffc978, emissiveIntensity: 0.55, roughness: 0.9
    });
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 26; i++) {
      const w = 14 + rnd() * 22;
      const h = 22 + rnd() * 78;
      const x = -230 + i * 18 + rnd() * 8;
      const z = -215 - rnd() * 120;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.85), dark);
      b.position.set(x, h / 2 - 1, z);
      scene.add(b);
      for (let k = 0; k < 3; k++) {
        if (rnd() > 0.55) continue;
        const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 1.4, 0.6), lit);
        win.position.set(x, 8 + rnd() * (h - 12), z + w * 0.43);
        scene.add(win);
      }
    }
  }

  function buildLights() {
    scene.add(new THREE.HemisphereLight(0x2a3d4a, 0x070c0f, 0.55));
    const key = new THREE.DirectionalLight(0xffd9a4, 1.05);
    key.position.set(-160, 70, -120);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x86b6d6, 0.35);
    fill.position.set(140, 40, 160);
    scene.add(fill);
    for (const x of [-HALF_MAIN, 0, HALF_MAIN]) {
      const p = new THREE.PointLight(0xffc978, 0.9, 120, 2);
      p.position.set(x, DECK_Y + 6, 0);
      scene.add(p);
    }
  }

  function frame(t) {
    if (!running) return;
    requestAnimationFrame(frame);
    const s = clock.getElapsedTime();
    rippleWater(s);

    if (mode === 'fly') {
      const raw = Math.min((t - flyStart) / FLY_MS, 1);
      const u = ease(raw);
      camera.position.copy(posCurve.getPointAt(Math.min(u, 0.999)));
      camera.lookAt(lookCurve.getPointAt(Math.min(u, 0.999)));
      if (raw >= 1) {
        mode = 'hero';
        if (onDone) { const cb = onDone; onDone = null; cb(); }
      }
    } else {
      const d = reduced ? 0 : s * 0.06;
      camera.position.set(
        HERO_POS.x * Math.cos(d) + HERO_POS.z * Math.sin(d),
        HERO_POS.y + Math.sin(s * 0.2) * 1.6,
        HERO_POS.z * Math.cos(d) - HERO_POS.x * Math.sin(d)
      );
      camera.lookAt(HERO_LOOK);
    }
    renderer.render(scene, camera);
  }

  function resize() {
    if (!ready) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function init(canvas) {
    if (typeof THREE === 'undefined') return false;
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;

      scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x0a1216, 150, 620);
      camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 1600);
      clock = new THREE.Clock();

      buildSky();
      buildWater();
      buildSkyline();
      buildLights();

      const bridge = new THREE.Group();
      buildPiers(bridge);
      buildDeck(bridge);
      buildChains(bridge);
      buildSuspenders(bridge);
      buildTower(bridge, -HALF_MAIN);
      buildTower(bridge, HALF_MAIN);
      buildLamps(bridge);
      scene.add(bridge);

      ready = true;
      resize();
      window.addEventListener('resize', resize);
      running = true;
      mode = 'hero';
      requestAnimationFrame(frame);
      return true;
    } catch (err) {
      console.warn('Bridge scene unavailable:', err);
      ready = false;
      return false;
    }
  }

  return {
    init,
    isReady: () => ready,
    prefersReduced: () => reduced,
    fly(cb) {
      if (!ready) { cb && cb(); return; }
      if (reduced) { cb && cb(); return; }
      onDone = cb;
      mode = 'fly';
      flyStart = performance.now();
    },
    skip() {
      if (mode !== 'fly') return;
      mode = 'hero';
      if (onDone) { const cb = onDone; onDone = null; cb(); }
    },
    freeze() { running = false; },
    resume() {
      if (!ready || running) return;
      running = true;
      mode = 'hero';
      requestAnimationFrame(frame);
    }
  };
})();
