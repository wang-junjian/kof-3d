import * as THREE from 'three';

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function floorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  if (!g) return new THREE.CanvasTexture(c);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#171d33');
  grd.addColorStop(0.55, '#0e1326');
  grd.addColorStop(1, '#080b18');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(126,158,232,0.16)';
  g.lineWidth = 1;
  for (let i = 0; i <= 16; i++) {
    const k = (i * 512) / 16;
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 512); g.stroke();
    g.beginPath(); g.moveTo(0, k); g.lineTo(512, k); g.stroke();
  }
  g.fillStyle = 'rgba(185,242,74,0.09)';
  g.fillRect(0, 250, 512, 12);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 纯几何 + Canvas 纹理搭的夜景擂台，无任何外部资源。 */
export class Stage {
  readonly scene = new THREE.Scene();

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(0x080b17);
    s.fog = new THREE.FogExp2(0x080b17, 0.026);

    s.add(new THREE.AmbientLight(0xaab8ff, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.45);
    key.position.set(3, 6, 6);
    s.add(key);
    const pink = new THREE.PointLight(0xe0457e, 22, 20);
    pink.position.set(-5, 2.6, 2.2);
    s.add(pink);
    const cyan = new THREE.PointLight(0x31b7da, 22, 20);
    cyan.position.set(5, 2.6, 2.2);
    s.add(cyan);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 14),
      new THREE.MeshBasicMaterial({ map: floorTexture() }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -1);
    s.add(floor);

    const rnd = seeded(20261104);
    const wallDark = new THREE.MeshBasicMaterial({ color: 0x111730 });
    const wallMid = new THREE.MeshBasicMaterial({ color: 0x182041 });
    const neonPink = new THREE.MeshBasicMaterial({ color: 0xe0457e });
    const neonCyan = new THREE.MeshBasicMaterial({ color: 0x31b7da });
    for (let i = 0; i < 22; i++) {
      const w = 0.65 + rnd() * 1.25;
      const h = 1.5 + rnd() * 4.4;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.5), i % 3 === 0 ? wallMid : wallDark);
      b.position.set(-10.5 + i * 1.0, h / 2, -8 - rnd() * 2.2);
      s.add(b);
      if (rnd() < 0.55) {
        const strip = new THREE.Mesh(
          new THREE.PlaneGeometry(w * 0.62, 0.045),
          i % 2 === 0 ? neonPink : neonCyan,
        );
        strip.position.set(b.position.x, Math.min(h - 0.2, 0.6 + rnd() * (h - 0.8)), b.position.z + 0.26);
        s.add(strip);
      }
    }

    const ropeMat = new THREE.MeshBasicMaterial({ color: 0x909ac4, transparent: true, opacity: 0.13 });
    for (const y of [0.52, 0.92, 1.32]) {
      const rope = new THREE.Mesh(new THREE.BoxGeometry(13, 0.016, 0.016), ropeMat);
      rope.position.set(0, y, -3.7);
      s.add(rope);
    }
    const postMat = new THREE.MeshBasicMaterial({ color: 0x2a3358 });
    for (const x of [-6.2, -2.1, 2.1, 6.2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.065, 1.55, 0.065), postMat);
      post.position.set(x, 0.775, -3.7);
      s.add(post);
    }

    for (const [x, color] of [[-3.3, 0xe0457e], [3.3, 0x31b7da]] as const) {
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(1.7, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.075, depthWrite: false }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(x, 0.018, -0.25);
      s.add(glow);
    }
  }
}
