import * as THREE from 'three';

export type JointName =
  | 'pelvis' | 'torso' | 'chest' | 'head'
  | 'shoulderL' | 'elbowL' | 'shoulderR' | 'elbowR'
  | 'hipL' | 'kneeL' | 'hipR' | 'kneeR'
  | 'hair';

export interface CharacterPalette {
  skin: number;
  skinShade: number;
  hair: number;
  hairHi: number;
  top: number;
  topDark: number;
  bottoms: number;
  boots: number;
  gloves: number;
  trim: number;
  eye: number;
  lip: number;
}

/**
 * 两位原创成年女性格斗家：圆润讨喜的 5 头身比例、时尚竞技造型。
 * 配色之外还靠刘海片数、侧发长度、马尾蓬松度与护肩轮廓做剪影区分，
 * 远看不再像同一个角色换色。
 */
export const RIN: CharacterPalette = {
  skin: 0xffd9c2, skinShade: 0xe8ae95, hair: 0x33243f, hairHi: 0x8757a6,
  top: 0xe0457e, topDark: 0x93204f, bottoms: 0x364064,
  boots: 0x1d2848, gloves: 0x8d2350, trim: 0xb9f24a,
  eye: 0x8b4fd0, lip: 0xc4566f,
};

export const FEI: CharacterPalette = {
  skin: 0xffe1cb, skinShade: 0xefbb9c, hair: 0xe8c277, hairHi: 0xfff0c0,
  top: 0x2fb6da, topDark: 0x155f85, bottoms: 0x33405e,
  boots: 0x1b2745, gloves: 0x1b6288, trim: 0xff62ab,
  eye: 0x2f97c9, lip: 0xc76a70,
};

export interface Rig {
  root: THREE.Group;
  joints: Record<JointName, THREE.Group>;
  materials: THREE.MeshToonMaterial[];
  /** 高马尾的四段关节，供渲染层做弹簧二级动力学。 */
  hair: THREE.Group[];
  /** 左右眼各自的容器，整组缩放 y 即为眨眼。 */
  eyes: THREE.Group[];
  shadow: THREE.Mesh;
  /** 角色身上带贴图材质的网格数；纯 3D 几何角色必须为 0。 */
  texturedMeshes: number;
}

function gradient(stops: number[]): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(stops), stops.length, 1, THREE.RedFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// 皮肤用柔和五阶，衣料用偏硬的四阶，让 NPR 明暗有层次而不糊成一片
const GRAD_SKIN = gradient([96, 150, 196, 228, 255]);
const GRAD_CLOTH = gradient([92, 158, 214, 255]);
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x1b1526, side: THREE.BackSide });

/**
 * 模块级几何缓存：两位角色共享同一批 BufferGeometry。
 * 精修把大量独立网格换成多段轮廓，共享能压住内存与攻击残影的克隆成本。
 */
const GEO = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  const hit = GEO.get(key);
  if (hit) return hit as T;
  const g = make();
  GEO.set(key, g);
  return g;
}

/** 旋转体：更密的轮廓采样让四肢有肌肉起伏，而不是一根等粗圆柱。 */
function lathe(profile: [number, number][], segments = 24): THREE.LatheGeometry {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

/** 细长圆角条：Capsule 压扁成片，取代生硬的 Box 装饰线。 */
function stroke(len: number, width: number, depth = 0.010): THREE.BufferGeometry {
  return cached(`stroke:${len}:${width}:${depth}`, () => {
    const g = new THREE.CapsuleGeometry(width, Math.max(0.002, len - width * 2), 2, 8);
    g.scale(1, 1, depth / width);
    return g;
  });
}

/**
 * 弯曲发片：Cone 沿长度收尖、压扁成片，宽端做二次弧线偏移。
 * 直挺挺的圆锥刘海换成贴额头的弧形发束，是摆脱「碗盖头」的关键。
 */
function hairStrand(len: number, width: number, bend: number): THREE.BufferGeometry {
  return cached(`strand:${len}:${width}:${bend}`, () => {
    const g = new THREE.ConeGeometry(width, len, 7, 5);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + len / 2) / len; // 0 = 宽端（贴头皮），1 = 尖端
      pos.setZ(i, pos.getZ(i) * 0.32 + bend * (1 - t) * (1 - t));
      pos.setX(i, pos.getX(i) * (0.92 + 0.08 * t));
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  });
}

/** 锥形发束：根部饱满、末端收尖，用于高马尾的四段。 */
function tuft(radius: number, length: number): THREE.BufferGeometry {
  return cached(`tuft:${radius}:${length}`, () => lathe([
    [0.004, -length], [radius * 0.52, -length * 0.74],
    [radius * 0.88, -length * 0.44], [radius, -length * 0.14],
    [radius * 0.94, 0],
  ], 16));
}

/** 鞋体：Box 顶点变形出收窄上翘的鞋头与略收的后跟，不再是纯长方体。 */
function shoe(): THREE.BufferGeometry {
  return cached('shoe', () => {
    const g = new THREE.BoxGeometry(0.155, 0.082, 0.255, 3, 2, 6);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i), x = pos.getX(i), y = pos.getY(i);
      const front = Math.max(0, z / 0.1275);
      const back = Math.max(0, -z / 0.1275);
      pos.setX(i, x * (1 - 0.32 * front * front - 0.12 * back * back));
      pos.setY(i, y + 0.022 * front * front + 0.006 * back);
      pos.setZ(i, z + 0.014 * front);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  });
}

/** 由球体收出尖下巴与后脑，正面留出平面放五官。 */
function faceGeometry(): THREE.SphereGeometry {
  return cached('face', () => {
    const g = new THREE.SphereGeometry(0.128, 26, 20);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const taper = y < 0 ? 1 + y * 1.15 : 1;
      pos.setXYZ(i, x * taper, y * 1.10, z * taper * (z < 0 ? 0.82 : 0.92));
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  });
}

const sphere = (r: number, w = 16, h = 12): THREE.SphereGeometry =>
  cached(`sph:${r}:${w}:${h}`, () => new THREE.SphereGeometry(r, w, h));
const ring = (r: number, tube: number, arc = Math.PI * 2): THREE.TorusGeometry =>
  cached(`ring:${r}:${tube}:${arc}`, () => new THREE.TorusGeometry(r, tube, 6, 18, arc));

/**
 * 纯 3D 程序化角色：关节层级 + 多段几何 + 结构分件 + NPR 卡通材质 + 细描边。
 * 零贴图、零外部资源。关节局部坐标与末端位置是动作系统的契约，不得改动。
 */
export type RigVariant = 'RIN' | 'FEI';

export function createRig(p: CharacterPalette, variant: RigVariant = 'RIN'): Rig {
  const root = new THREE.Group();
  const joints = {} as Record<JointName, THREE.Group>;
  const materials: THREE.MeshToonMaterial[] = [];
  const hair: THREE.Group[] = [];
  const eyes: THREE.Group[] = [];
  const cache = new Map<string, THREE.MeshToonMaterial>();
  const rig = { root, joints, materials, hair, eyes, texturedMeshes: 0 } as Rig;

  const mat = (color: number, skin = false): THREE.MeshToonMaterial => {
    const key = `${color}-${skin ? 's' : 'c'}`;
    let m = cache.get(key);
    if (!m) {
      m = new THREE.MeshToonMaterial({ color, gradientMap: skin ? GRAD_SKIN : GRAD_CLOTH });
      cache.set(key, m);
      materials.push(m);
    }
    return m;
  };

  const add = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    color: number,
    pos: [number, number, number],
    opts: { scale?: [number, number, number]; skin?: boolean; outline?: number; rot?: [number, number, number] } = {},
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat(color, opts.skin));
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (opts.scale) mesh.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
    if (opts.rot) mesh.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
    parent.add(mesh);
    const outline = opts.outline ?? 0;
    if (outline > 0) {
      const shell = new THREE.Mesh(geo, OUTLINE);
      // 统一放大描边厚度：几何尺寸差异很大，逐块写死会导致细部件几乎无描边
      shell.scale.setScalar(1 + (outline - 1) * 1.3);
      mesh.add(shell);
    }
    return mesh;
  };

  // 五官/装饰用无光照材质：侧视与逆光下也始终清晰可读
  const decal = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    color: number,
    pos: [number, number, number],
    scale?: [number, number, number],
    opacity = 1,
  ): THREE.Mesh => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
    parent.add(mesh);
    return mesh;
  };

  const joint = (parent: THREE.Object3D, name: JointName, pos: [number, number, number]): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(pos[0], pos[1], pos[2]);
    parent.add(g);
    joints[name] = g;
    return g;
  };

  // ── 胯 / 腰 / 躯干：多段轮廓收出腰线，短款外套与高腰下装之间露出腰腹 ───
  const pelvis = joint(root, 'pelvis', [0, 0.96, 0]);
  add(pelvis, lathe([[0.108, -0.10], [0.146, -0.06], [0.162, 0.02], [0.156, 0.09], [0.140, 0.13]]),
    p.bottoms, [0, 0, 0], { scale: [1, 1, 0.82], outline: 1.045 });
  add(pelvis, lathe([[0.152, 0.070], [0.161, 0.090], [0.150, 0.118]]),
    p.topDark, [0, 0, 0], { scale: [1.02, 1, 0.84] });
  const belt = decal(pelvis, stroke(0.085, 0.017), p.trim, [0, 0.090, 0.132]);
  belt.rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) {
    const seam = decal(pelvis, stroke(0.11, 0.006), p.trim, [s * 0.140, 0.010, 0.075], undefined, 0.45);
    seam.rotation.z = s * 0.16;
  }

  const torso = joint(pelvis, 'torso', [0, 0.12, 0]);
  // 腰腹不加描边壳：这层 BackSide 壳会从上衣下摆的收口处穿出来，
  // 在腹前形成一道黑色半圆。衣料与肤色的色差已足够勾出轮廓。
  // 腰线再收一点：胸围不变，只压腰腹两侧，Q 版筒状躯干才有起伏
  add(torso, lathe([[0.100, 0.00], [0.094, 0.07], [0.102, 0.15], [0.118, 0.23], [0.130, 0.29]]),
    p.skin, [0, 0, 0], { scale: [1, 1, 0.78], skin: true });
  // 上衣下摆保持平缓且不加描边壳：收成半径 0 的尖底会让腰腹戳出衣料，
  // 平口的背面在色差与绿色腰带遮挡下不可见。
  add(torso, lathe([
    [0.122, 0.174], [0.132, 0.210], [0.158, 0.290], [0.186, 0.370],
    [0.203, 0.440], [0.199, 0.490], [0.192, 0.520],
  ]), p.top, [0, 0, 0], { scale: [1, 1, 0.80] });
  add(torso, lathe([[0.129, 0.170], [0.142, 0.192], [0.144, 0.205]]),
    p.trim, [0, 0, 0], { scale: [1.02, 1, 0.82] });
  decal(torso, stroke(0.31, 0.007), p.topDark, [0, 0.350, 0.158]);
  decal(torso, stroke(0.30, 0.004), p.trim, [0.011, 0.350, 0.162], undefined, 0.85);
  for (let i = 0; i < 2; i++) {
    add(torso, sphere(0.007, 8, 6), p.topDark, [-0.011, 0.270 + i * 0.120, 0.163]);
  }
  // 胸前一道柔和衣料高光：无光照细斜条，方向按角色左右错开，剪影细节更耐看
  const clothHi = decal(torso, stroke(0.17, 0.006), 0xffffff,
    [variant === 'FEI' ? 0.070 : -0.070, 0.365, 0.164], undefined, 0.22);
  clothHi.rotation.z = variant === 'FEI' ? -0.42 : 0.42;

  const chest = joint(torso, 'chest', [0, 0.46, 0]);
  for (const s of [-1, 1]) {
    const collar = decal(chest, stroke(0.115, 0.010), p.trim, [s * 0.058, 0.055, 0.140]);
    collar.rotation.z = s * 0.52;
    const dart = decal(chest, stroke(0.040, 0.006), p.topDark, [s * 0.150, -0.012, 0.114]);
    dart.rotation.z = s * 0.30;
  }
  // 颈根过渡：脖子直接插进胸口会像一根柱子，先垫一圈肤色收口
  add(chest, lathe([[0.052, -0.010], [0.058, 0.010], [0.050, 0.030]]),
    p.skin, [0, 0.090, 0], { scale: [1, 1, 0.9], skin: true });
  add(chest, sphere(0.050, 16, 12), p.skin, [0, 0.112, 0], { scale: [1, 1, 0.9], skin: true });

  // ── 头部：全几何五官，正面朝向 +Z ─────────────────────────────────────
  const head = joint(chest, 'head', [0, 0.22, 0]);
  joint(head, 'hair', [0, 0.165, -0.135]);

  add(head, faceGeometry(), p.skin, [0, 0.045, 0], { skin: true, outline: 1.045 });
  // 后脑发比脸略大且后置，露出整张脸
  add(head, sphere(0.134, 22, 16), p.hair,
    [0, 0.040, -0.042], { scale: [1.02, 1.10, 0.94], outline: 1.04 });
  // 发帽只盖头顶：下缘必须高于眼睛，否则整张脸会被吞掉
  add(head, cached('cap', () => new THREE.SphereGeometry(0.139, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.42)),
    p.hair, [0, 0.072, -0.006], { scale: [1.05, 1.02, 1.04], outline: 1.04 });
  // 斜刘海按角色分片：RIN 六片碎刘海，FEI 四片更宽的斜刘海。
  // 只改网格数量与宽度，不动 hair 关节链（骨架指纹与动作探针都依赖它）。
  const bangCount = variant === 'FEI' ? 4 : 6;
  const bangHalf = (bangCount - 1) / 2;
  for (let i = 0; i < bangCount; i++) {
    const k = i - bangHalf;
    const h = 0.110 + (bangHalf - Math.abs(k)) * 0.014;
    const bang = add(head,
      hairStrand(h, bangCount === 4 ? 0.046 : 0.036, 0.016), p.hair,
      [k * (bangCount === 4 ? 0.050 : 0.037) - 0.008, 0.134 - i * 0.004, 0.102],
      { rot: [Math.PI, 0, k * 0.085 - 0.10] });
    bang.renderOrder = 1;
  }
  // 发丝高光：圆角细条，不再是硬边白线
  const streak = decal(head, stroke(0.100, 0.007), p.hairHi, [-0.030, 0.126, 0.128], undefined, 0.8);
  streak.rotation.z = -0.30;
  const streak2 = decal(head, stroke(0.075, 0.005), p.hairHi, [0.078, 0.118, 0.120], undefined, 0.6);
  streak2.rotation.z = -0.24;

  for (const side of [-1, 1]) {
    // 鬓发：圆润胶囊 + 一小束细发梢，贴脸但不压眼
    const longSide = variant === 'FEI' ? 1.42 : 1;
    add(head, cached('sideburn', () => new THREE.CapsuleGeometry(0.030, 0.16, 3, 10)), p.hair,
      [side * 0.121, -0.032 - (longSide - 1) * 0.04, 0.012],
      { scale: [1, longSide, 0.72] });
    add(head, cached('sideTip', () => new THREE.CapsuleGeometry(0.018, 0.075, 3, 8)), p.hair,
      [side * 0.133, -0.098 - (longSide - 1) * 0.09, 0.026],
      { scale: [1, longSide * 0.70, 0.70], rot: [0, 0, side * 0.18] });
    // 腮红与鼻影
    decal(head, sphere(0.026, 10, 8), p.lip, [side * 0.086, -0.020, 0.106], [1, 0.48, 0.24], 0.30);
    decal(head, sphere(0.010, 8, 6), p.skinShade,
      [side * 0.012, -0.014, 0.126], [1, 0.7, 0.4], 0.55);
  }
  decal(head, sphere(0.011, 8, 6), p.skinShade, [0, -0.012, 0.130], [1, 0.8, 0.5], 0.7);
  const mouth = decal(head, ring(0.020, 0.0035, Math.PI), p.lip, [0, -0.062, 0.116], undefined, 0.95);
  mouth.rotation.z = Math.PI;

  // 眼睛：整组装进容器，眨眼只需缩放容器 y
  for (const side of [-1, 1]) {
    const ex = side * 0.055;
    const group = new THREE.Group();
    group.position.set(ex, 0.030, 0);
    head.add(group);
    eyes.push(group);

    decal(group, sphere(0.032, 14, 10), 0xfdf9ff, [0, 0, 0.120], [1, 0.78, 0.34]);
    decal(group, sphere(0.020, 14, 10), p.eye, [side * 0.002, -0.001, 0.132], [1, 1.05, 0.42]);
    decal(group, sphere(0.011, 10, 8), 0x1d1526, [side * 0.002, -0.001, 0.141], [1, 1.10, 0.42]);
    decal(group, sphere(0.0065, 8, 6), 0xffffff, [-0.008, 0.009, 0.145]);
    decal(group, sphere(0.0035, 8, 6), 0xffffff, [0.009, -0.008, 0.143], undefined, 0.8);
    // 只保留上眼线 + 外侧睫毛 + 眉毛三条中的两条，多余的横线会让眼睛显脏
    const liner = decal(group, stroke(0.058, 0.0035), 0x251a30, [0, 0.024, 0.130]);
    liner.rotation.z = Math.PI / 2 - side * 0.10;
    const lash = decal(group, stroke(0.018, 0.003), 0x251a30, [side * 0.031, 0.023, 0.128]);
    lash.rotation.z = Math.PI / 2 + side * 0.42;
    const brow = decal(head, stroke(0.056, 0.003), p.hair, [ex, 0.082, 0.112]);
    brow.rotation.z = Math.PI / 2 - side * 0.11;
  }

  // 高马尾链：锥形发束相接，跟随动作做二级动力学
  const hairRoot = joints.hair;
  decal(hairRoot, ring(0.048, 0.015), p.topDark, [0, -0.030, -0.012]);
  let hairParent: THREE.Object3D = hairRoot;
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Group();
    seg.position.y = i === 0 ? -0.02 : -0.20;
    hairParent.add(seg);
    hair.push(seg);
    // FEI 马尾更蓬松、RIN 更细长：只换网格半径，hair 关节链的 position 保持契约
    const r = (0.058 - i * 0.010) * (variant === 'FEI' ? 1.18 : 1);
    // RIN 是细长高马尾、FEI 是蓬松短马尾：背影剪影一眼可分
    const len = variant === 'FEI' ? 0.24 : 0.31;
    add(seg, tuft(r, len), i >= 3 ? p.hairHi : i === 1 ? p.hairHi : p.hair,
      [0, 0.018, -0.02 - i * 0.025], { scale: [1, 1, 0.88], outline: i === 0 ? 1.05 : 0 });
    hairParent = seg;
  }

  // ── 手臂：多段肌肉轮廓 + 关节球过渡；装饰克制，避免叠成套筒 ─────────────
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? -1 : 1;
    const shoulder = joint(chest, `shoulder${side}`, [s * 0.215, 0.005, 0]);
    // 肩球收小，肩线不再像两颗圆球顶着脑袋
    add(shoulder, sphere(0.078, 18, 14), p.top, [0, 0, 0], { scale: [1, 0.92, 0.92], outline: 1.06 });
    // FEI 双侧外扩护肩、RIN 只有布袖：肩线一宽一窄，远看剪影不再相同
    if (variant === 'FEI') {
      const pauldron = add(shoulder, sphere(0.102, 16, 12), p.topDark,
        [s * 0.010, 0.028, -0.004], { scale: [1.12, 0.52, 1.00], outline: 1.04 });
      pauldron.rotation.z = -s * 0.20;
    }
    // 四肢旋转体两端必须收口到半径 0：留平口时 BackSide 描边壳会从斜下方
    // 露出一圈黑色内壁，两臂举在胸前时会连成一道突兀的黑弧。
    add(shoulder, lathe([
      [0.000, -0.330], [0.060, -0.325], [0.066, -0.295], [0.075, -0.250],
      [0.082, -0.190], [0.086, -0.130], [0.085, -0.075], [0.079, -0.020],
      [0.077, 0.005], [0.000, 0.010],
    ]), p.skin, [0, 0, 0], { scale: [1, 1, 0.94], skin: true, outline: 1.06 });
    add(shoulder, cached('cuff', () => new THREE.CylinderGeometry(0.076, 0.070, 0.075, 16)),
      p.topDark, [0, -0.055, 0], { scale: [1, 1, 0.94] });
    const epaulet = decal(shoulder, stroke(0.09, 0.006), p.trim,
      [s * 0.030, 0.062, 0.030], undefined, 0.55);
    epaulet.rotation.z = Math.PI / 2 - s * 0.55;
    const armStripe = decal(shoulder, stroke(0.19, 0.005), p.trim,
      [s * 0.070, -0.17, 0.012], undefined, 0.45);
    armStripe.rotation.z = s * 0.04;

    const elbow = joint(shoulder, `elbow${side}`, [0, -0.32, 0]);
    // 肘部球形过渡：前臂与上臂不再出现断层
    add(elbow, sphere(0.063, 14, 10), p.skin, [0, -0.012, 0], { scale: [1, 0.82, 1], skin: true });
    add(elbow, lathe([
      [0.000, -0.305], [0.049, -0.300], [0.055, -0.270], [0.062, -0.215],
      [0.068, -0.150], [0.070, -0.090], [0.066, -0.035], [0.062, 0.005],
      [0.000, 0.010],
    ]), p.skin, [0, 0, 0], { scale: [1, 1, 0.94], skin: true, outline: 1.06 });
    add(elbow, cached('wrist', () => new THREE.CylinderGeometry(0.067, 0.065, 0.085, 16)),
      p.topDark, [0, -0.235, 0], { scale: [1, 1, 0.94] });
    // 腕带：袖口与拳套之间再压一道亮色细环，近看有层次而不是一整块球
    const wristBand = decal(elbow, ring(0.066, 0.008), p.trim, [0, -0.266, 0]);
    wristBand.rotation.x = Math.PI / 2;
    // 拳套与护腕半径贴合：刻意放大球会让两个带描边的曲面互穿，交界处出现锯齿毛边
    add(elbow, sphere(0.056, 18, 14), p.gloves,
      [0, -0.305, 0], { scale: [1, 0.88, 1.08], outline: 1.06 });
    for (let i = 0; i < 3; i++) {
      add(elbow, sphere(0.015, 8, 6), p.gloves,
        [(i - 1) * 0.027, -0.316, 0.055], { scale: [1, 0.85, 0.70] });
    }
    add(elbow, sphere(0.024, 10, 8), p.topDark,
      [s * 0.050, -0.292, 0.028], { scale: [0.85, 1, 0.9] });
    const gloveBand = decal(elbow, stroke(0.10, 0.008), p.trim, [0, -0.300, 0.068]);
    gloveBand.rotation.z = Math.PI / 2;
  }

  // ── 腿：肌肉起伏 + 平滑护膝片 + 收窄上翘的鞋 ─────────────────────────────
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? -1 : 1;
    const hip = joint(pelvis, `hip${side}`, [s * 0.100, -0.06, 0]);
    add(hip, lathe([
      [0.000, -0.440], [0.072, -0.435], [0.080, -0.395], [0.090, -0.335],
      [0.098, -0.260], [0.106, -0.170], [0.112, -0.075], [0.108, -0.005],
      [0.000, 0.005],
    ]), p.bottoms, [0, 0, 0], { scale: [1, 1, 0.92], outline: 1.06 });
    const hipSeam = decal(hip, stroke(0.36, 0.006), p.trim,
      [s * 0.104, -0.225, 0.008], undefined, 0.50);
    hipSeam.rotation.z = s * 0.03;

    const knee = joint(hip, `knee${side}`, [0, -0.43, 0]);
    add(knee, sphere(0.075, 14, 10), p.boots, [0, -0.012, 0], { scale: [1, 0.78, 1] });
    add(knee, lathe([
      [0.000, -0.380], [0.055, -0.375], [0.061, -0.330], [0.069, -0.255],
      [0.076, -0.170], [0.079, -0.090], [0.075, -0.025], [0.072, 0.005],
      [0.000, 0.010],
    ]), p.boots, [0, 0, 0], { scale: [1, 1, 0.94], outline: 1.06 });
    add(knee, cached('bootCuff', () => new THREE.CylinderGeometry(0.078, 0.076, 0.038, 16)),
      p.topDark, [0, -0.035, 0], { scale: [1, 1, 0.94] });
    // 护膝：压扁的实心椭圆，比截断半球更干净（半球的开口会露出锯齿边）
    add(knee, sphere(0.068, 14, 10), p.topDark,
      [0, -0.120, 0.060], { scale: [1.05, 0.62, 0.34] });
    const kneeLine = decal(knee, stroke(0.24, 0.005), p.trim,
      [s * 0.073, -0.205, 0.010], undefined, 0.45);
    kneeLine.rotation.z = s * 0.02;

    // 鞋体中心仍位于 knee 局部 (0,-0.392,0.052)，与 limbs() 脚部探针一致
    add(knee, shoe(), p.boots, [0, -0.392, 0.052], { outline: 1.06 });
    add(knee, shoe(), p.topDark, [0, -0.435, 0.052], { scale: [1.03, 0.22, 1.02] });
    const toeCap = decal(knee, stroke(0.100, 0.005), p.trim, [0, -0.367, 0.178], undefined, 0.70);
    toeCap.rotation.z = Math.PI / 2;
    const lace = decal(knee, stroke(0.085, 0.005), p.topDark, [0, -0.352, 0.080], undefined, 0.85);
    lace.rotation.z = Math.PI / 2;
    add(knee, sphere(0.026, 10, 8), p.topDark, [0, -0.410, -0.075], { scale: [1.1, 0.7, 0.7] });
  }

  // ── 形象个性化：共享骨架之上，各自追加专属装备与剪影网格 ────────────────
  // 只新增挂在现有 joint 上的网格，绝不改关节层级 / 局部坐标 / 马尾链（骨架指纹契约）。
  // 绯翎走轻锐路线：细长收尖的飘带、腕刃、腰间菱形饰片与靴侧翼片，全用细锥 / 低面菱形，
  // 三角面增量刻意压小；岳铮走厚重路线：大面数甲片 / 方形拳套 / 宽腰带，增量明显更大，
  // 让两人三角面差继续拉大而不是收敛。
  if (variant === 'RIN') {
    // ① 细长飘带：后脑发束根部与肩后各甩一对收尖飘带，尖端锐利、向两侧外张
    for (const s of [-1, 1]) {
      add(joints.hair, hairStrand(0.46, 0.018, 0.05), p.trim,
        [s * 0.020, -0.10, -0.02], { rot: [Math.PI, 0, s * 0.46] });
      add(chest, hairStrand(0.30, 0.014, 0.04), p.top,
        [s * 0.150, 0.02, -0.09], { rot: [Math.PI, 0, s * 0.70] });
    }
    // ② 腰间菱形饰片：高腰前侧三枚酸绿宝石（4 面经线 × 2 面纬线的低面球即菱形）
    const gem = sphere(0.032, 4, 2);
    for (const dx of [-0.088, 0, 0.088]) {
      add(pelvis, gem, p.trim, [dx, 0.050, 0.150], { scale: [0.75, 1.15, 0.42] });
    }
    // ③ 腕刃 / 尖角护腕 + ④ 靴侧翼片：前臂与脚踝各挑出一枚锐角
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? -1 : 1;
      const elbow = joints[`elbow${side}`];
      const knee = joints[`knee${side}`];
      add(elbow, hairStrand(0.19, 0.026, 0.02), p.trim,
        [s * 0.056, -0.170, 0.055], { rot: [Math.PI / 2, 0, -s * 0.18] });
      add(elbow, hairStrand(0.085, 0.022, 0.01), p.topDark,
        [s * 0.060, -0.245, 0.010], { rot: [0, 0, -s * 1.25] });
      add(knee, hairStrand(0.13, 0.020, 0.02), p.trim,
        [s * 0.070, -0.360, 0.025], { rot: [0, 0, -s * 1.9] });
    }
  } else {
    // 宽腰带 + 扣环：柱带束腰，正面一枚粉色环扣嵌蓝芯
    const beltBand = cached('wideBelt', () => new THREE.CylinderGeometry(0.168, 0.168, 0.085, 20));
    add(pelvis, beltBand, p.topDark, [0, 0.075, 0], { scale: [1, 1, 0.84], outline: 1.04 });
    decal(pelvis, ring(0.040, 0.011), p.trim, [0, 0.075, 0.150]);
    add(pelvis, sphere(0.032, 4, 2), p.gloves, [0, 0.075, 0.162], { scale: [0.6, 0.6, 0.6] });
    // 胸甲横向纹路：三道加厚横棱叠在上胸前
    for (let i = 0; i < 3; i++) {
      add(torso, stroke(0.27 - i * 0.01, 0.011), p.topDark,
        [0, 0.39 + i * 0.05, 0.168], { rot: [0, 0, Math.PI / 2] });
    }
    // 四棱柱拳套：4 段圆柱即方柱，避免引入 BoxGeometry 推高 boxes 计数
    const sqGauntlet = cached('gauntlet', () => new THREE.CylinderGeometry(0.074, 0.070, 0.092, 4));
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? -1 : 1;
      const shoulder = joints[`shoulder${side}`];
      const elbow = joints[`elbow${side}`];
      const hip = joints[`hip${side}`];
      // 更外扩的多层护肩：再加一层外扩甲片与一枚外挑尖角
      add(shoulder, sphere(0.104, 16, 12), p.topDark,
        [s * 0.030, 0.034, -0.006], { scale: [1.28, 0.46, 1.06], outline: 1.04 });
      add(shoulder, hairStrand(0.10, 0.030, 0.01), p.trim,
        [s * 0.120, 0.050, -0.006], { rot: [0, 0, -s * 1.35] });
      // 加厚方形拳套：方柱本体 + 前指节方块 + 侧铆钉
      add(elbow, sqGauntlet, p.topDark, [0, -0.300, 0.010],
        { scale: [1, 0.9, 1.12], rot: [0, Math.PI / 4, 0], outline: 1.05 });
      add(elbow, sphere(0.052, 12, 10), p.gloves, [0, -0.312, 0.060], { scale: [1.1, 0.8, 0.7] });
      add(elbow, sphere(0.014, 8, 6), p.trim, [s * 0.050, -0.292, 0.075]);
      // 腿侧护甲片：大腿外侧一片竖长暗甲
      add(hip, sphere(0.070, 14, 10), p.topDark,
        [s * 0.104, -0.150, 0.020], { scale: [0.5, 1.5, 1.0], outline: 1.04 });
    }
  }

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.44, 24),
    new THREE.MeshBasicMaterial({ color: 0x04050b, transparent: true, opacity: 0.42, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  shadow.scale.set(1, 0.42, 1);
  rig.shadow = shadow;

  // 纯 3D 契约：角色网格不得携带任何贴图材质
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.material) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of list) {
      if ((m as THREE.Material & { map?: THREE.Texture }).map) rig.texturedMeshes++;
    }
  });

  return rig;
}

/**
 * 视图 dispose 共用的资源所有权边界。
 * GEO / GRAD_SKIN / GRAD_CLOTH / OUTLINE 由本模块持有、生命周期与页面等长：
 * 两个程序化角色和攻击残影都在引用它们，任何一次视图销毁都不得释放。
 * 其余按引用 Set 去重后释放，避免同一 texture/material 被多 mesh 共用时重复 dispose。
 */
export function disposeViewResources(
  root: THREE.Object3D,
  opts: { disposeGeometry: boolean },
): void {
  const sharedGeometries = new Set<THREE.BufferGeometry>(GEO.values());
  const sharedMaterials = new Set<THREE.Material>([OUTLINE]);
  const sharedTextures = new Set<THREE.Texture>([GRAD_SKIN, GRAD_CLOTH]);

  const geometries = new Set<THREE.BufferGeometry>();
  const skeletons = new Set<THREE.Skeleton>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (opts.disposeGeometry && mesh.geometry && !sharedGeometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
    }
    const skinned = obj as THREE.SkinnedMesh;
    if (skinned.skeleton) skeletons.add(skinned.skeleton);
    const m = mesh.material;
    if (m) {
      const list: THREE.Material[] = Array.isArray(m) ? m : [m];
      for (const mm of list) {
        if (!sharedMaterials.has(mm)) materials.add(mm);
      }
    }
  });

  for (const m of materials) {
    // 材质属性里挂的贴图（map/normalMap/...）与 ShaderMaterial uniforms 里的贴图
    // 常被多个材质共用，先按引用收集、最后统一释放，避免重复 dispose。
    for (const v of Object.values(m) as unknown[]) {
      const t = v as THREE.Texture;
      if (t && t.isTexture && !sharedTextures.has(t)) textures.add(t);
    }
    const shader = m as THREE.ShaderMaterial;
    if (shader.uniforms) {
      for (const u of Object.values(shader.uniforms)) {
        const t = u.value as THREE.Texture;
        if (t && t.isTexture && !sharedTextures.has(t)) textures.add(t);
      }
    }
  }

  for (const g of geometries) g.dispose();
  for (const s of skeletons) s.dispose();
  for (const t of textures) t.dispose();
  for (const m of materials) m.dispose();
}
