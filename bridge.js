/* ============================================================
   bridge.js — the Roberto Clemente Bridge at dusk.

   Proportions follow the real bridge, 1 unit ~ 4 ft:
     main span 434 ft, side spans ~180 ft, towers ~65 ft over
     the deck, chain ~22 ft over the deck at midspan.
   It is a self-anchored suspension bridge: the chains land on
   the deck at both ends, not in ground anchorages. The chains
   are eyebar links, straight plates pinned at joints, so they
   are drawn as segments rather than a smooth cable.
   ============================================================ */

const BridgeScene = (() => {

  /* ---------- dimensions ---------- */
  const GOLD       = 0xe09410;
  const DECK_Y     = 14;
  const HALF_MAIN  = 54;              // river piers
  const HALF_TOTAL = 99;              // chains land on the deck
  const DECK_END   = 146;             // deck continues over the banks
  const SADDLE     = DECK_Y + 17;     // chain crosses the tower here
  const TOWER_TOP  = DECK_Y + 20;
  const MID_CHAIN  = DECK_Y + 6;      // chain height at midspan
  const CHAIN_Z    = 7.0;
  const DECK_HW    = 7.6;             // deck half width
  const RIVER_HW   = 103;             // bank edges
  const PANELS_MAIN = 12;
  const PANELS_SIDE = 5;
  const SUN = new THREE.Vector3(-1, 0.30, -0.62).normalize();

  /* Framing: yaw pushes the bridge right of centre so the
     passphrase card on the left does not cover it. */
  const HERO_POS  = new THREE.Vector3(64, 60, 214);
  const HERO_LOOK = new THREE.Vector3(0, 15, 0);
  const HERO_YAW  = 0.13;

  /* ---------- state ---------- */
  let renderer, scene, camera, clock;
  const waterTime = { value: 0 };
  let vehicles = [], mists = [];
  let running = false, mode = 'hero', flyStart = 0, onDone = null;
  let ready = false, reduced = false;
  let roll = 0, lastHeading = null;
  const look = new THREE.Vector3(0, 19, 0);
  const FLY_MS = 10400;

  /* ---------- camera move ----------
     Establish low down the river, pass under the main span
     between the piers, climb out, arc back over the deck,
     settle into the hero framing. */
  const posCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(  36,  6.0,  256),
    new THREE.Vector3(  24,  6.6,  198),
    new THREE.Vector3(  12,  7.4,  142),
    new THREE.Vector3(   0,  8.4,   90),
    new THREE.Vector3( -10,  9.2,   48),
    new THREE.Vector3( -17,  9.7,   14),
    new THREE.Vector3( -22, 10.1,  -16),
    new THREE.Vector3( -29, 12.4,  -48),
    new THREE.Vector3( -41, 24.0,  -90),
    new THREE.Vector3( -34, 40.0, -136),
    new THREE.Vector3(  16, 52.0, -142),
    new THREE.Vector3(  82, 54.0,  -58),
    new THREE.Vector3( 120, 47.0,   40),
    new THREE.Vector3( 124, 43.0,  112),
    HERO_POS.clone()
  ], false, 'catmullrom', 0.5);

  /* Target rides the bridge centreline, so the structure never
     leaves frame and the move reads as one continuous shot. */
  const lookCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(  0, 22, 0),
    new THREE.Vector3( -6, 22, 0),
    new THREE.Vector3(-16, 21, 0),
    new THREE.Vector3(-30, 21, 0),
    new THREE.Vector3(-44, 22, 0),
    new THREE.Vector3(-54, 25, 0),
    new THREE.Vector3(-56, 28, 0),
    new THREE.Vector3(-40, 22, 0),
    new THREE.Vector3(-16, 17, 0),
    new THREE.Vector3(  0, 15, 0),
    new THREE.Vector3(  4, 14, 0),
    new THREE.Vector3(  2, 16, 0),
    new THREE.Vector3(  0, 18, 0),
    HERO_LOOK.clone(),
    HERO_LOOK.clone()
  ], false, 'catmullrom', 0.5);

  /* Speed profile integrated into a table: short ramp in, hold,
     long settle. Keeps the move from lurching at the ends. */
  const EASE = (() => {
    const N = 360, acc = new Float32Array(N);
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      let s;
      if (t < 0.10)      s = 0.30 + 0.70 * (t / 0.10);
      else if (t < 0.58) s = 1;
      else               s = 0.09 + 0.91 * Math.pow(1 - (t - 0.58) / 0.42, 1.8);
      sum += s;
      acc[i] = sum;
    }
    for (let i = 0; i < N; i++) acc[i] /= sum;
    return t => {
      const x = Math.min(Math.max(t, 0), 1) * (N - 1);
      const i = Math.floor(x), f = x - i;
      return i >= N - 1 ? 1 : acc[i] * (1 - f) + acc[i + 1] * f;
    };
  })();

  /* ---------- materials ---------- */
  const SPEC = {
    gold:     { color: GOLD,     roughness: 0.44, metalness: 0.28, env: 1.3 },
    goldDeep: { color: 0xa9700f, roughness: 0.56, metalness: 0.24, env: 1.0 },
    rail:     { color: 0x7d5c15, roughness: 0.64, metalness: 0.20, env: 0.8 },
    asphalt:  { color: 0x15191d, roughness: 0.80, metalness: 0.02, env: 0.3 },
    walk:     { color: 0x1f2427, roughness: 0.93, metalness: 0.03, env: 0.4 },
    concrete: { color: 0x171a1d, roughness: 0.96, metalness: 0.02, env: 0.5 },
    steelDk:  { color: 0x2a3138, roughness: 0.60, metalness: 0.55, env: 0.7 },
    land:     { color: 0x070c0f, roughness: 0.97, metalness: 0.02, env: 0.2 },
    car:      { color: 0x1a2026, roughness: 0.35, metalness: 0.45, env: 1.0 }
  };
  const matCache = {};
  function mat(kind, refl) {
    const key = kind + (refl ? '~r' : '');
    if (matCache[key]) return matCache[key];
    const s = SPEC[kind];
    const m = new THREE.MeshStandardMaterial({
      color: s.color, roughness: s.roughness, metalness: s.metalness
    });
    m.envMapIntensity = s.env;
    if (refl) {
      m.color.multiplyScalar(0.40);
      m.roughness = Math.min(1, s.roughness + 0.32);
      m.envMapIntensity = s.env * 0.30;
      m.side = THREE.DoubleSide;
    }
    matCache[key] = m;
    return m;
  }
  function bulbMat() {
    if (!matCache.bulb) {
      matCache.bulb = new THREE.MeshStandardMaterial({
        color: 0xfff3da, emissive: 0xffcb7a, emissiveIntensity: 4.0, roughness: 0.5
      });
    }
    return matCache.bulb;
  }

  /* ---------- canvas textures ---------- */
  function radialTex(inner, mid) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.30, mid);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  function windowTex(seedFn) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 120; y += 20) {
      for (let x = 5; x < 58; x += 15) {
        if (seedFn() > 0.30) continue;
        const t = seedFn();
        g.fillStyle = t > 0.80 ? 'rgba(206,231,255,0.95)'
                   : t > 0.55 ? 'rgba(255,214,150,0.95)'
                              : 'rgba(255,188,110,0.90)';
        g.fillRect(x, y, 6, 9);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  function hazeTex() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * 256, y = Math.random() * 256, r = 40 + Math.random() * 80;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(150,180,196,0.055)');
      grd.addColorStop(1, 'rgba(150,180,196,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  /* ---------- sky ---------- */
  function skyDome() {
    return new THREE.Mesh(
      new THREE.SphereGeometry(1200, 40, 22),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false,
        uniforms: { uSun: { value: SUN.clone() } },
        vertexShader: [
          'varying vec3 vDir;',
          'void main(){',
          '  vec4 wp = modelMatrix * vec4(position, 1.0);',
          '  vDir = normalize(wp.xyz);',
          '  gl_Position = projectionMatrix * viewMatrix * wp;',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 uSun;',
          'varying vec3 vDir;',
          'void main(){',
          '  float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);',
          '  vec3 hor = vec3(0.215, 0.180, 0.142);',
          '  vec3 mid = vec3(0.064, 0.108, 0.136);',
          '  vec3 top = vec3(0.012, 0.030, 0.052);',
          '  vec3 c = mix(hor, mid, smoothstep(0.478, 0.605, h));',
          '  c = mix(c, top, smoothstep(0.575, 0.995, h));',
          '  float s = max(dot(vDir, normalize(uSun)), 0.0);',
          '  c += vec3(0.95, 0.46, 0.14) * pow(s, 44.0);',
          '  c += vec3(0.44, 0.22, 0.07) * pow(s, 7.0) * 0.55;',
          '  c += vec3(0.16, 0.09, 0.03) * pow(s, 2.0) * 0.30;',
          '  gl_FragColor = vec4(c, 1.0);',
          '}'
        ].join('\n')
      })
    );
  }

  /* No prefiltered environment map here on purpose. Generating one
     with PMREMGenerator produced a texture that poisoned every PBR
     material and blacked out direct lighting on some drivers. The
     gold is painted steel, so it does not need one. */

  /* ---------- water ---------- */
  const WAVES = [
    'float wA = sin(position.x * 0.052 + uTime * 1.00);',
    'float wB = sin(position.z * 0.039 - uTime * 0.78);',
    'float wC = sin((position.x + position.z) * 0.019 + uTime * 0.46);',
    'float hWave = wA * 0.22 + wB * 0.17 + wC * 0.26;',
    'float dhx = cos(position.x * 0.052 + uTime * 1.00) * 0.052 * 0.22',
    '          + cos((position.x + position.z) * 0.019 + uTime * 0.46) * 0.019 * 0.26;',
    'float dhz = cos(position.z * 0.039 - uTime * 0.78) * 0.039 * 0.17',
    '          + cos((position.x + position.z) * 0.019 + uTime * 0.46) * 0.019 * 0.26;',
    'vec3 objectNormal = normalize(vec3(-dhx, 1.0, -dhz));'
  ].join('\n');

  function buildWater() {
    const geo = new THREE.PlaneGeometry(2800, 2800, 200, 200);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({
      color: 0x061016, roughness: 0.10, metalness: 0.45,
      transparent: true, opacity: 0.90, depthWrite: false
    });
    m.envMapIntensity = 1.6;
    m.onBeforeCompile = sh => {
      sh.uniforms.uTime = waterTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader;
      sh.vertexShader = sh.vertexShader
        .replace('#include <beginnormal_vertex>', WAVES)
        .replace('#include <begin_vertex>',
          'vec3 transformed = vec3( position );\ntransformed.y += hWave;');
    };
    const mesh = new THREE.Mesh(geo, m);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    scene.add(mesh);
  }

  /* ---------- chain ---------- */
  function chainY(x) {
    const ax = Math.abs(x);
    if (ax <= HALF_MAIN) {
      const u = ax / HALF_MAIN;
      return MID_CHAIN + (SADDLE - MID_CHAIN) * u * u;
    }
    /* side spans run nearly straight, with a shallow bow */
    const u = (ax - HALF_MAIN) / (HALF_TOTAL - HALF_MAIN);
    const end = DECK_Y + 1.6;
    return SADDLE + (end - SADDLE) * u - Math.sin(u * Math.PI) * 1.1;
  }

  function jointXs() {
    const xs = [];
    for (let i = -PANELS_MAIN / 2; i <= PANELS_MAIN / 2; i++) {
      xs.push((i / (PANELS_MAIN / 2)) * HALF_MAIN);
    }
    for (let i = 1; i <= PANELS_SIDE; i++) {
      const f = i / PANELS_SIDE;
      const x = HALF_MAIN + (HALF_TOTAL - HALF_MAIN) * f;
      xs.push(x, -x);
    }
    return xs.sort((a, b) => a - b);
  }

  const UP = new THREE.Vector3(0, 1, 0);
  function buildChains(group, refl) {
    const link = mat('gold', refl);
    const plate = mat('goldDeep', refl);
    const xs = jointXs();
    const pts = xs.map(x => new THREE.Vector2(x, chainY(x)));
    for (const z of [-CHAIN_Z, CHAIN_Z]) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = new THREE.Vector3(pts[i].x, pts[i].y, z);
        const b = new THREE.Vector3(pts[i + 1].x, pts[i + 1].y, z);
        const dir = b.clone().sub(a);
        const len = dir.length();
        /* eyebars are tall thin plates: thin across, deep vertically */
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.30, len, 1.30), link);
        seg.position.copy(a).addScaledVector(dir, 0.5);
        seg.quaternion.setFromUnitVectors(UP, dir.normalize());
        seg.castShadow = !refl;
        group.add(seg);
      }
      /* pin plates at the joints, flat not round */
      for (const p of pts) {
        const pin = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.7, 1.7), plate);
        pin.position.set(p.x, p.y, z);
        group.add(pin);
      }
    }
  }

  function buildSuspenders(group, refl) {
    const top = DECK_Y + 2.0;
    const xs = jointXs().filter(x =>
      chainY(x) - top > 1.6 && Math.abs(Math.abs(x) - HALF_MAIN) > 3);
    const geo = new THREE.CylinderGeometry(0.11, 0.11, 1, 6);
    const inst = new THREE.InstancedMesh(geo, mat('goldDeep', refl), xs.length * 2);
    inst.castShadow = !refl;
    const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let i = 0;
    for (const x of xs) {
      const h = chainY(x) - top;
      for (const z of [-CHAIN_Z, CHAIN_Z]) {
        mx.compose(new THREE.Vector3(x, top + h / 2, z), q, s.set(1, h, 1));
        inst.setMatrixAt(i++, mx);
      }
    }
    inst.count = i;
    group.add(inst);
  }

  /* ---------- towers ---------- */
  function buildTower(group, x, refl) {
    const m = mat('gold', refl);
    const md = mat('goldDeep', refl);
    const base = DECK_Y - 4.0;
    const h = TOWER_TOP - base;
    for (const z of [-CHAIN_Z, CHAIN_Z]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(2.7, h, 2.7), m);
      leg.position.set(x, base + h / 2, z);
      leg.castShadow = !refl;
      group.add(leg);
      /* saddle block where the chain crosses */
      const saddle = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.7, 3.5), md);
      saddle.position.set(x, SADDLE, z);
      saddle.castShadow = !refl;
      group.add(saddle);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 3.2), md);
      cap.position.set(x, TOWER_TOP + 0.5, z);
      group.add(cap);
      const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.5, 2.2, 8), md);
      finial.position.set(x, TOWER_TOP + 2.0, z);
      group.add(finial);
    }
    /* portal struts give the tower its mass */
    for (const y of [DECK_Y + 5.5, DECK_Y + 12.0, TOWER_TOP - 0.6]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, CHAIN_Z * 2), m);
      strut.position.set(x, y, 0);
      strut.castShadow = !refl;
      group.add(strut);
    }
    const span = CHAIN_Z * 2;
    const rise = (TOWER_TOP - 0.6) - (DECK_Y + 12.0);
    const diag = Math.sqrt(span * span + rise * rise);
    for (const d of [1, -1]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.8, diag, 0.8), m);
      brace.position.set(x, (DECK_Y + 12.0 + TOWER_TOP - 0.6) / 2, 0);
      brace.rotation.x = d * Math.atan2(span, rise);
      group.add(brace);
    }
  }

  /* ---------- deck ---------- */
  function buildDeck(group, refl) {
    const L = DECK_END * 2;

    const road = new THREE.Mesh(new THREE.BoxGeometry(L, 0.45, 13.4), mat('asphalt', refl));
    road.position.set(0, DECK_Y + 0.33, 0);
    road.receiveShadow = !refl;
    group.add(road);

    const slab = new THREE.Mesh(new THREE.BoxGeometry(L, 0.9, DECK_HW * 2), mat('walk', refl));
    slab.position.set(0, DECK_Y - 0.25, 0);
    slab.castShadow = !refl;
    group.add(slab);

    for (const z of [-6.8, 6.8]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(L, 0.35, 1.6), mat('walk', refl));
      walk.position.set(0, DECK_Y + 0.5, z);
      group.add(walk);
    }

    /* the strong gold band along the deck edge */
    const gm = mat('gold', refl);
    for (const z of [-DECK_HW - 0.15, DECK_HW + 0.15]) {
      const girder = new THREE.Mesh(new THREE.BoxGeometry(HALF_TOTAL * 2 + 8, 2.7, 0.85), gm);
      girder.position.set(0, DECK_Y - 1.15, z);
      girder.castShadow = !refl;
      group.add(girder);
    }

    /* railing stays low and sparse so it does not read as a fence */
    const rm = mat('rail', refl);
    for (const z of [-DECK_HW + 0.2, DECK_HW - 0.2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(HALF_TOTAL * 2 + 8, 0.15, 0.15), rm);
      rail.position.set(0, DECK_Y + 1.55, z);
      group.add(rail);
    }
    const mx = new THREE.Matrix4();
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.3, 0.12), rm, 60);
    let p = 0;
    for (let x = -HALF_TOTAL; x <= HALF_TOTAL && p < 59; x += 8.6) {
      for (const z of [-DECK_HW + 0.2, DECK_HW - 0.2]) {
        mx.setPosition(x, DECK_Y + 0.95, z);
        posts.setMatrixAt(p++, mx);
      }
    }
    posts.count = p;
    group.add(posts);

    /* floor beams under the deck */
    const beams = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.55, 0.55, DECK_HW * 2 + 0.6), gm, 40);
    let b = 0;
    for (let x = -HALF_TOTAL; x <= HALF_TOTAL && b < 40; x += 5.4) {
      mx.setPosition(x, DECK_Y - 2.0, 0);
      beams.setMatrixAt(b++, mx);
    }
    beams.count = b;
    beams.castShadow = !refl;
    group.add(beams);

    if (!refl) {
      const dm = new THREE.MeshStandardMaterial({
        color: 0xd8c489, roughness: 0.65, emissive: 0x2e2409
      });
      const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(3.6, 0.05, 0.26), dm, 46);
      let d = 0;
      for (let x = -DECK_END + 8; x <= DECK_END && d < 46; x += 7.2) {
        mx.setPosition(x, DECK_Y + 0.58, 0);
        dashes.setMatrixAt(d++, mx);
      }
      dashes.count = d;
      group.add(dashes);
    }
  }

  /* ---------- piers and abutments ---------- */
  function buildPiers(group, refl) {
    const m = mat('concrete', refl);
    for (const x of [-HALF_MAIN, HALF_MAIN]) {
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(11, DECK_Y + 2, 24), m);
      shaft.position.set(x, (DECK_Y + 2) / 2 - 1.6, 0);
      shaft.castShadow = !refl;
      group.add(shaft);
      /* pointed cutwaters upstream and down */
      for (const z of [-12, 12]) {
        const nose = new THREE.Mesh(new THREE.BoxGeometry(7.8, DECK_Y, 7.8), m);
        nose.position.set(x, DECK_Y / 2 - 1.8, z);
        nose.rotation.y = Math.PI / 4;
        nose.castShadow = !refl;
        group.add(nose);
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(13, 1.5, 26), m);
      cap.position.set(x, DECK_Y - 3.1, 0);
      group.add(cap);
      const base = new THREE.Mesh(new THREE.BoxGeometry(14, 2.4, 30), m);
      base.position.set(x, 0.4, 0);
      group.add(base);
    }
    for (const x of [-HALF_TOTAL - 6, HALF_TOTAL + 6]) {
      const ab = new THREE.Mesh(new THREE.BoxGeometry(13, DECK_Y + 2, 22), m);
      ab.position.set(x, (DECK_Y + 2) / 2 + 1.4, 0);
      ab.castShadow = !refl;
      group.add(ab);
    }
    for (const x of [-128, 128]) {
      const bent = new THREE.Mesh(new THREE.BoxGeometry(5.5, DECK_Y - 1, 18), m);
      bent.position.set(x, (DECK_Y - 1) / 2 + 2.4, 0);
      bent.castShadow = !refl;
      group.add(bent);
    }
  }

  /* ---------- banks and skyline ---------- */
  function buildLand() {
    const lm = mat('land', false);
    for (const s of [-1, 1]) {
      const bank = new THREE.Mesh(new THREE.BoxGeometry(900, 7, 1100), lm);
      bank.position.set(s * (RIVER_HW + 450), 0.6, 0);
      bank.receiveShadow = true;
      scene.add(bank);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 5, 1100), mat('land', false));
      wall.position.set(s * (RIVER_HW + 0.5), 1.4, 0);
      wall.receiveShadow = true;
      scene.add(wall);
    }
  }

  function buildSkyline(group, refl) {
    let seed = 1337;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const tex = windowTex(rnd);
    for (let i = 0; i < 32; i++) {
      const mid = 1 - Math.abs(i - 14) / 18;
      const w = 16 + rnd() * 20;
      const h = 26 + rnd() * 40 + mid * 62;
      const x = -RIVER_HW - 60 - rnd() * 340;
      const z = -230 + i * 13 + rnd() * 11;
      let m;
      if (refl) {
        m = new THREE.MeshStandardMaterial({
          color: 0x070c0f, roughness: 0.98, metalness: 0.02,
          emissive: 0xffffff, emissiveIntensity: 0.40, side: THREE.DoubleSide
        });
      } else {
        m = new THREE.MeshStandardMaterial({
          color: 0x080d11, roughness: 0.94, metalness: 0.05,
          emissive: 0xffffff, emissiveIntensity: 0.95
        });
      }
      m.emissiveMap = tex.clone();
      m.emissiveMap.needsUpdate = true;
      m.emissiveMap.wrapS = m.emissiveMap.wrapT = THREE.RepeatWrapping;
      m.emissiveMap.repeat.set(Math.max(1, Math.round(w / 17)), Math.max(1, Math.round(h / 20)));
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.9), m);
      b.position.set(x, h / 2 + 3, z);
      b.castShadow = !refl;
      group.add(b);
    }
    /* dark riverfront massing so the banks are not empty planes */
    for (let i = 0; i < 26; i++) {
      const w = 18 + rnd() * 34, h = 7 + rnd() * 17;
      const side = i % 2 ? 1 : -1;
      const bl = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * (0.7 + rnd() * 0.8)),
        mat('land', refl));
      bl.position.set(
        side * (RIVER_HW + 55 + rnd() * 210),
        h / 2 + 3,
        -350 + rnd() * 300
      );
      bl.castShadow = !refl;
      group.add(bl);
    }
  }

  /* ---------- lamps, glows, traffic, haze ---------- */
  function buildLamps(group) {
    const glow = radialTex('rgba(255,230,180,0.95)', 'rgba(255,172,80,0.30)');
    const pm = mat('steelDk', false);
    const bm = bulbMat();
    for (let x = -HALF_TOTAL + 8; x <= HALF_TOTAL; x += 16.5) {
      for (const z of [-6.8, 6.8]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 5.0, 6), pm);
        post.position.set(x, DECK_Y + 3.2, z);
        group.add(post);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), bm);
        bulb.position.set(x, DECK_Y + 5.8, z);
        group.add(bulb);

        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glow, blending: THREE.AdditiveBlending,
          depthWrite: false, transparent: true, opacity: 0.55
        }));
        halo.position.copy(bulb.position);
        halo.scale.set(3.2, 3.2, 1);
        halo.renderOrder = 5;
        scene.add(halo);

        /* tight smear on the water, not a floating blob */
        const smear = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glow, blending: THREE.AdditiveBlending,
          depthWrite: false, transparent: true, opacity: 0.085
        }));
        smear.position.set(x, 2.6, z);
        smear.scale.set(1.7, 9, 1);
        smear.renderOrder = 5;
        scene.add(smear);
      }
    }
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTex('rgba(255,214,160,0.80)', 'rgba(255,138,56,0.20)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false
    }));
    sun.position.copy(SUN).multiplyScalar(900);
    sun.scale.set(620, 620, 1);
    sun.renderOrder = 4;
    scene.add(sun);
  }

  function buildHaze() {
    const tex = hazeTex();
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1800, 1800),
        new THREE.MeshBasicMaterial({
          map: tex, transparent: true, opacity: i ? 0.035 : 0.05,
          depthWrite: false, blending: THREE.AdditiveBlending
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 2.0 + i * 4.0;
      m.renderOrder = 8;
      mists.push(m);
      scene.add(m);
    }
  }

  function buildTraffic() {
    const head = radialTex('rgba(232,244,255,0.95)', 'rgba(168,206,255,0.25)');
    const tail = radialTex('rgba(255,120,86,0.95)', 'rgba(198,44,28,0.25)');
    for (let i = 0; i < 6; i++) {
      const dir = i % 2 ? 1 : -1;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.4, 1.9), mat('car', false));
      body.castShadow = true;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.85, 1.75), mat('car', false));
      cab.position.set(-0.4 * dir, 1.05, 0);
      body.add(cab);
      g.add(body);
      for (const s of [-1, 1]) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: dir > 0 ? head : tail, blending: THREE.AdditiveBlending,
          depthWrite: false, transparent: true, opacity: dir > 0 ? 0.75 : 0.55
        }));
        sp.position.set(2.3 * dir, 0.5, s * 0.6);
        sp.scale.setScalar(dir > 0 ? 2.6 : 1.8);
        sp.renderOrder = 5;
        g.add(sp);
      }
      g.position.set(-DECK_END + (i / 6) * DECK_END * 2, DECK_Y + 1.3, dir > 0 ? 3.4 : -3.4);
      g.userData = { dir: dir, speed: 24 + Math.random() * 12 };
      vehicles.push(g);
      scene.add(g);
    }
  }

  function buildLights() {
    scene.add(new THREE.HemisphereLight(0x40606f, 0x0b1216, 0.42));

    const key = new THREE.DirectionalLight(0xffcb8e, 1.65);
    key.position.copy(SUN).multiplyScalar(430);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const c = key.shadow.camera;
    c.left = -230; c.right = 230; c.top = 230; c.bottom = -230;
    c.near = 60; c.far = 1000;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.7;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x9dbdd6, 0.40);
    rim.position.set(210, 80, 235);
    scene.add(rim);

    /* warm city fill, low and on the camera side, so the gold faces
       that point away from the sun still read as metal */
    const cityFill = new THREE.DirectionalLight(0xffb46a, 0.30);
    cityFill.position.set(150, 18, 150);
    scene.add(cityFill);

    const bounce = new THREE.DirectionalLight(0x24505f, 0.16);
    bounce.position.set(0, -70, 50);
    scene.add(bounce);
  }

  /* ---------- frame ---------- */
  const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tL = new THREE.Vector3();

  function applyHero(s) {
    const d = reduced ? 0 : s * 0.042;
    camera.position.set(
      HERO_POS.x * Math.cos(d) + HERO_POS.z * Math.sin(d),
      HERO_POS.y + Math.sin(s * 0.17) * 1.2,
      HERO_POS.z * Math.cos(d) - HERO_POS.x * Math.sin(d)
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    camera.rotateY(HERO_YAW);
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const s = clock.getElapsedTime();
    waterTime.value = s;

    for (const v of vehicles) {
      v.position.x += v.userData.dir * v.userData.speed * 0.016;
      if (v.userData.dir > 0 && v.position.x > DECK_END) v.position.x = -DECK_END;
      if (v.userData.dir < 0 && v.position.x < -DECK_END) v.position.x = DECK_END;
    }
    for (let i = 0; i < mists.length; i++) {
      mists[i].position.x = Math.sin(s * (0.011 + i * 0.005)) * 70;
      mists[i].position.z = (s * (1.8 + i * 0.9)) % 320 - 160;
    }

    if (mode === 'fly') {
      const raw = Math.min((now - flyStart) / FLY_MS, 1);
      const u = Math.min(EASE(raw), 0.9999);

      camera.position.copy(posCurve.getPointAt(u));
      const j = (1 - raw) * 0.55;
      camera.position.x += Math.sin(s * 2.2) * j * 0.5;
      camera.position.y += Math.sin(s * 1.6 + 1.1) * j * 0.32;

      tL.copy(lookCurve.getPointAt(u));
      look.lerp(tL, 0.11);
      camera.up.set(0, 1, 0);
      camera.lookAt(look);

      tA.copy(posCurve.getPointAt(Math.max(u - 0.012, 0)));
      tB.copy(posCurve.getPointAt(Math.min(u + 0.012, 0.9999)));
      const heading = Math.atan2(tB.x - tA.x, tB.z - tA.z);
      if (lastHeading !== null) {
        let d = heading - lastHeading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        roll += (THREE.MathUtils.clamp(d * 5.0, -0.26, 0.26) - roll) * 0.05;
      }
      lastHeading = heading;
      camera.rotateZ(roll);
      /* ease the hero yaw in over the last stretch */
      camera.rotateY(HERO_YAW * Math.max(0, (raw - 0.72) / 0.28));

      if (raw >= 1) {
        mode = 'hero';
        roll = 0;
        if (onDone) { const cb = onDone; onDone = null; cb(); }
      }
    } else {
      look.lerp(HERO_LOOK, 0.08);
      applyHero(s);
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

  /* ---------- init ---------- */
  function init(canvas) {
    if (typeof THREE === 'undefined') return false;
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      renderer = new THREE.WebGLRenderer({
        canvas: canvas, antialias: true, powerPreference: 'high-performance'
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.96;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x101d24, 0.00185);
      camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 3000);
      clock = new THREE.Clock();

      const dome = skyDome();
      dome.renderOrder = -1;
      scene.add(dome);

      buildLights();
      buildWater();
      buildLand();
      buildHaze();

      const solid = new THREE.Group();
      buildPiers(solid, false);
      buildDeck(solid, false);
      buildChains(solid, false);
      buildSuspenders(solid, false);
      buildTower(solid, -HALF_MAIN, false);
      buildTower(solid,  HALF_MAIN, false);
      buildLamps(solid);
      buildSkyline(solid, false);
      scene.add(solid);

      /* mirror the structure under the waterline for the reflection */
      const refl = new THREE.Group();
      buildPiers(refl, true);
      buildDeck(refl, true);
      buildChains(refl, true);
      buildSuspenders(refl, true);
      buildTower(refl, -HALF_MAIN, true);
      buildTower(refl,  HALF_MAIN, true);
      buildSkyline(refl, true);
      refl.scale.set(1, -1, 1);
      scene.add(refl);

      buildTraffic();

      ready = true;
      resize();
      window.addEventListener('resize', resize);
      running = true;
      mode = 'hero';
      look.copy(HERO_LOOK);
      requestAnimationFrame(frame);
      return true;
    } catch (err) {
      console.warn('Bridge scene unavailable:', err);
      ready = false;
      return false;
    }
  }

  return {
    init: init,
    isReady: function () { return ready; },
    prefersReduced: function () { return reduced; },
    fly: function (cb) {
      if (!ready || reduced) { if (cb) cb(); return; }
      onDone = cb;
      lastHeading = null;
      roll = 0;
      look.copy(lookCurve.getPointAt(0));
      camera.position.copy(posCurve.getPointAt(0));
      mode = 'fly';
      flyStart = performance.now();
    },
    skip: function () {
      if (mode !== 'fly') return;
      mode = 'hero';
      roll = 0;
      if (onDone) { const cb = onDone; onDone = null; cb(); }
    },
    /* used by the offline render harness to inspect single frames */
    probe: function (u, t) {
      if (!ready) return;
      mode = 'probe';
      waterTime.value = t === undefined ? 4.2 : t;
      if (u >= 0.999) {
        look.copy(HERO_LOOK);
        applyHero(0);
      } else {
        const uu = Math.max(0.0005, Math.min(u, 0.9985));
        camera.position.copy(posCurve.getPointAt(uu));
        look.copy(lookCurve.getPointAt(uu));
        camera.up.set(0, 1, 0);
        camera.lookAt(look);
        camera.rotateY(HERO_YAW * Math.max(0, (uu - 0.72) / 0.28));
      }
      renderer.render(scene, camera);
    },
    freeze: function () { running = false; },
    resume: function () {
      if (!ready || running) return;
      running = true;
      mode = 'hero';
      requestAnimationFrame(frame);
    }
  };
})();
