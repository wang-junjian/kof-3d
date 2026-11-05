import * as THREE from 'three';

interface Burst {
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  rays: { mesh: THREE.Mesh; vx: number; vy: number }[];
  life: number;
  max: number;
}

interface Effect {
  kind: string;
  group: THREE.Group;
  materials: THREE.Material[];
  life: number;
  max: number;
  tick: (k: number, t: number) => void;
}

export interface FxProbe {
  /** 当前存活的特效组数，用于回收/暴增断言。 */
  active: number;
  counts: Record<string, number>;
  /** 累计生成次数：效果淡出后仍可断言「确实触发过」。 */
  totals: Record<string, number>;
}

const KINDS = ['sparks', 'lines', 'glows', 'arcs', 'dust', 'ghosts'] as const;
type Kind = typeof KINDS[number];

const RAY_GEO = new THREE.ConeGeometry(0.024, 0.18, 3);
const RING_GEO = new THREE.RingGeometry(0.17, 0.225, 20);
const LINE_GEO = new THREE.PlaneGeometry(1, 1);
const GLOW_GEO = new THREE.CircleGeometry(0.5, 24);
const ARC_GEO = new THREE.RingGeometry(0.30, 0.40, 24, 1, -0.85, 1.70);
const PUFF_GEO = new THREE.CircleGeometry(0.12, 12);
const DUST_RING_GEO = new THREE.RingGeometry(0.18, 0.27, 20);

/**
 * 打击演出全集。所有效果独立于逻辑帧推进，因此 Hitstop 冻结期间
 * 画面定格而火花继续炸开——这正是格斗游戏「顿帧」的手感来源。
 */
export class Fx {
  private readonly group = new THREE.Group();
  private readonly bursts: Burst[] = [];
  private readonly effects: Effect[] = [];
  private created = 0;
  private readonly totals: Record<Kind, number> = {
    sparks: 0, lines: 0, glows: 0, arcs: 0, dust: 0, ghosts: 0,
  };

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  get count(): number {
    return this.bursts.length + this.effects.length;
  }

  get total(): number {
    return this.created;
  }

  inspect(): FxProbe {
    const counts: Record<string, number> = { sparks: this.bursts.length };
    for (const k of KINDS.slice(1)) counts[k] = 0;
    for (const e of this.effects) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    return { active: this.count, counts, totals: { ...this.totals } };
  }

  private spawn(
    kind: Kind,
    materials: THREE.Material[],
    max: number,
    build: (g: THREE.Group) => (k: number, t: number) => void,
  ): void {
    const group = new THREE.Group();
    const tick = build(group);
    this.group.add(group);
    this.effects.push({ kind, group, materials, life: 0, max, tick });
    this.totals[kind]++;
  }

  hit(x: number, y: number, blocked: boolean, heavy: boolean, guardBreak = false): void {
    this.created++;
    this.totals.sparks++;
    const color = guardBreak ? 0xff7a45 : blocked ? 0x9fd8ff : heavy ? 0xffe082 : 0xfff6e2;
    const count = guardBreak ? 14 : heavy ? 12 : 8;
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
    });
    const group = new THREE.Group();
    group.position.set(x, y, 0.35);

    const rays: Burst['rays'] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (i % 2) * 0.22;
      const mesh = new THREE.Mesh(RAY_GEO, material);
      mesh.rotation.z = a - Math.PI / 2;
      mesh.scale.set(1, heavy ? 1.25 : 0.85, 1);
      group.add(mesh);
      const speed = guardBreak ? 0.075 : heavy ? 0.062 : 0.044;
      rays.push({ mesh, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed });
    }
    const ring = new THREE.Mesh(RING_GEO, ringMat);
    group.add(ring);
    this.group.add(group);
    this.bursts.push({ group, material, ring, ringMat, rays, life: 0, max: guardBreak ? 18 : heavy ? 16 : 12 });
  }

  /** 水平放射速度线：短促、贴着命中点向外发散，中心留白，强化冲击方向。 */
  speedLines(x: number, y: number, heavy: boolean): void {
    const mat = new THREE.MeshBasicMaterial({
      color: heavy ? 0xffe9b0 : 0xcfe4ff, transparent: true, opacity: 0.90,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const streaks: { mesh: THREE.Mesh; vx: number; len: number }[] = [];
    const n = heavy ? 10 : 6;
    this.spawn('lines', [mat], heavy ? 11 : 9, (g) => {
      g.position.set(x, y, 0.42);
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        const len = (heavy ? 0.52 : 0.34) * (0.65 + (i % 3) * 0.25);
        const mesh = new THREE.Mesh(LINE_GEO, mat);
        // 起点放在中心外侧（加上半个线长），保证线条不横穿角色
        mesh.position.set(side * (0.72 + (i % 3) * 0.10 + len * 0.5), (i - n / 2) * 0.105, 0);
        mesh.scale.set(len, 0.009 + (i % 3) * 0.004, 1);
        g.add(mesh);
        streaks.push({ mesh, vx: side * (heavy ? 0.078 : 0.052), len });
      }
      return (k, t) => {
        for (const s of streaks) {
          s.mesh.position.x += s.vx * k;
          s.mesh.scale.x = s.len * (1 + t * 0.6);
        }
        mat.opacity = 0.90 * (1 - t) * (1 - t);
      };
    });
  }

  /**
   * 局部柔光：加色混合，只提亮不压灰；半径刻意收小，避免大圆盘盖住两个角色。
   * 普通 alpha 混合的半透明圆盘在深色背景上会像一层脏玻璃，不是发光。
   */
  glow(x: number, y: number, heavy: boolean, blocked: boolean): void {
    const color = blocked ? 0xa9dcff : heavy ? 0xffe6a8 : 0xffffff;
    const outer = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.22, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const inner = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.spawn('glows', [outer, inner], 8, (g) => {
      g.position.set(x, y, 0.46);
      const a = new THREE.Mesh(GLOW_GEO, outer);
      const b = new THREE.Mesh(GLOW_GEO, inner);
      a.scale.setScalar(0.34);
      b.scale.setScalar(0.16);
      g.add(a, b);
      return (_k, t) => {
        a.scale.setScalar(0.34 + t * 0.95);
        b.scale.setScalar(0.16 + t * 0.34);
        outer.opacity = 0.22 * (1 - t);
        inner.opacity = 0.55 * (1 - t) * (1 - t);
      };
    });
  }

  /** 挥击弧光：沿出招方向的扇形拖尾，绕命中点扫过并放大淡出。 */
  arc(x: number, y: number, facing: number, heavy: boolean): void {
    const mat = new THREE.MeshBasicMaterial({
      color: heavy ? 0xffe082 : 0xeaf4ff, transparent: true, opacity: 0.76,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.spawn('arcs', [mat], heavy ? 12 : 9, (g) => {
      g.position.set(x, y, 0.44);
      const mesh = new THREE.Mesh(ARC_GEO, mat);
      mesh.rotation.z = facing > 0 ? -0.45 : Math.PI + 0.45;
      mesh.scale.set(facing, 1, 1);
      g.add(mesh);
      return (k, t) => {
        mesh.rotation.z += 0.055 * k * facing;
        const s = 1 + t * 0.90;
        mesh.scale.set(facing * s, s, 1);
        mat.opacity = 0.76 * (1 - t) * (1 - t);
      };
    });
  }

  /** M2 超必杀命中：在常规打击之上叠一层错位火花、放射线与双层柔光，做「贯穿」感。 */
  superBurst(x: number, y: number, facing: number): void {
    this.hit(x, y, false, true);
    this.hit(x + facing * 0.18, y + 0.09, false, true);
    this.speedLines(x, y, true);
    this.glow(x, y, true, false);
    this.glow(x + facing * 0.12, y, false, false);
    this.arc(x, y, facing, true);
  }

  /** 落地烟尘：贴地压扁的环 + 向两侧滚开的尘团，与落地缓冲同源触发。 */
  dust(x: number): void {
    const puff = new THREE.MeshBasicMaterial({
      color: 0x9fb0d8, transparent: true, opacity: 0.46,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.MeshBasicMaterial({
      color: 0xc6d4f2, transparent: true, opacity: 0.40,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const puffs: { mesh: THREE.Mesh; vx: number; vy: number; size: number }[] = [];
    this.spawn('dust', [puff, ring], 18, (g) => {
      g.position.set(x, 0.05, 0.40);
      const halo = new THREE.Mesh(DUST_RING_GEO, ring);
      halo.rotation.x = -Math.PI / 3;
      halo.scale.set(1, 0.42, 1);
      g.add(halo);
      for (let i = 0; i < 8; i++) {
        const side = i % 2 ? 1 : -1;
        const mesh = new THREE.Mesh(PUFF_GEO, puff);
        const size = 0.48 + (i % 3) * 0.22;
        mesh.position.set(side * 0.10, 0.01, 0);
        mesh.scale.setScalar(size);
        g.add(mesh);
        puffs.push({ mesh, vx: side * (0.026 + (i % 3) * 0.012), vy: 0.010 + (i % 2) * 0.006, size });
      }
      return (k, t) => {
        halo.scale.set(1 + t * 3.1, 0.42 * (1 + t * 1.2), 1);
        for (const p of puffs) {
          p.mesh.position.x += p.vx * k;
          p.mesh.position.y += p.vy * k * (1 - t);
          p.mesh.scale.setScalar(p.size * (1 + t * 0.85));
        }
        puff.opacity = 0.46 * (1 - t);
        ring.opacity = 0.40 * (1 - t) * (1 - t);
      };
    });
  }

  /**
   * 残影容量查询：调用方必须在克隆整套骨架「之前」问一次。
   * ghost() 收到的是已克隆好的 Object3D，满额时只能丢弃，
   * 那会白发一整套 111 个网格与材质的分配。
   */
  canGhost(): boolean {
    return this.countGhosts() < 4;
  }

  /**
   * 攻击残影：接收渲染层克隆出的本帧姿态剪影，向出招反方向漂移淡出。
   * 同时最多 4 个，避免连续攻击时堆出一片重影拖垮帧率。
   */
  ghost(obj: THREE.Object3D | null, tint: number, facing: number): void {
    if (!obj) return;
    const mats: THREE.Material[] = [];
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material;
      if (Array.isArray(m)) mats.push(...m);
      else if (m) mats.push(m);
    });
    if (this.countGhosts() >= 4) {
      for (const m of mats) m.dispose();
      return;
    }
    for (const m of mats) {
      const basic = m as THREE.MeshBasicMaterial;
      if (basic.color) basic.color.setHex(tint);
      basic.opacity = 0.34;
    }
    this.spawn('ghosts', mats, 10, (g) => {
      g.add(obj);
      // 首帧就往出招反方向拉开，否则残影与本体重合、只显得边缘发虚
      obj.position.x -= facing * 0.20;
      return (k, t) => {
        obj.position.x -= facing * 0.010 * k;
        obj.position.y += 0.0025 * k;
        for (const m of mats) (m as THREE.MeshBasicMaterial).opacity = 0.34 * (1 - t) * (1 - t);
      };
    });
  }

  private countGhosts(): number {
    let n = 0;
    for (const e of this.effects) if (e.kind === 'ghosts') n++;
    return n;
  }

  update(dtMs: number): void {
    const k = Math.min(2, dtMs / 16.667);
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += k;
      const t = b.life / b.max;
      for (const r of b.rays) {
        r.mesh.position.x += r.vx * k;
        r.mesh.position.y += r.vy * k;
        r.mesh.scale.y = Math.max(0.2, r.mesh.scale.y - 0.022 * k);
      }
      b.material.opacity = Math.max(0, 1 - t);
      b.ring.scale.setScalar(1 + t * 2.4);
      b.ringMat.opacity = Math.max(0, 0.9 * (1 - t));
      if (t >= 1) {
        this.group.remove(b.group);
        b.material.dispose();
        b.ringMat.dispose();
        this.bursts.splice(i, 1);
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life += k;
      const t = e.life / e.max;
      e.tick(k, Math.min(1, t));
      if (t >= 1) {
        this.group.remove(e.group);
        e.group.clear();
        for (const m of e.materials) m.dispose();
        this.effects.splice(i, 1);
      }
    }
  }
}
