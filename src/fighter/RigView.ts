import * as THREE from 'three';
import type { Fighter } from './Fighter';
import type { CharacterView, Pose, V3 } from './CharacterView';
import { disposeViewResources, type JointName, type Rig } from './rig';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const ZERO: V3 = [0, 0, 0];
const FLASH_HIT = 0x6a2a3c;

/** 默认渲染层：程序化骨架直接消费姿态欧拉角，并叠加眨眼与马尾弹簧。 */
export class RigView implements CharacterView {
  readonly root: THREE.Object3D;
  readonly shadow: THREE.Object3D;

  private readonly hairAngle: number[] = [];
  private readonly hairVel: number[] = [];
  private readonly overrides = new Map<JointName, V3>();
  /** 骨架结构在构造后不变：缓存关节名，避免每帧 Object.keys 生成新数组（两角色 × 60fps）。 */
  private readonly jointNames: JointName[];
  private lastTime = -1;
  private lastFlash = -1;

  /** 调试钩子：覆盖某关节的最终旋转，用于标定动作角度；正常运行时为空。 */
  setOverride(joint: JointName, angles: V3): void {
    this.overrides.set(joint, angles);
  }

  clearOverrides(): void {
    this.overrides.clear();
  }

  constructor(private readonly rig: Rig) {
    this.root = rig.root;
    this.shadow = rig.shadow;
    this.jointNames = Object.keys(rig.joints) as JointName[];
    for (let i = 0; i < rig.hair.length; i++) {
      this.hairAngle.push(i * 0.04);
      this.hairVel.push(0);
    }
  }

  /** 纯 3D 契约：带贴图材质的网格数必须为 0。 */
  get texturedMeshes(): number {
    return this.rig.texturedMeshes;
  }

  /** 自检探针：取某关节下局部点的世界坐标，用于量化出拳/踢腿的伸展方向。 */
  worldPoint(joint: JointName, local: [number, number, number]): [number, number, number] {
    this.root.updateMatrixWorld(true);
    const v = this.rig.joints[joint].localToWorld(new THREE.Vector3(local[0], local[1], local[2]));
    return [v.x, v.y, v.z];
  }

  /**
   * 骨架指纹：关节的父子关系与局部坐标逐字节可比对。
   * 几何精修只换网格，必须保持此值不变——`limbs()` 坐标探针与全部动作断言
   * 都建立在这些数值上。自检把基线写死后，任何一次误改骨骼都会立刻失败。
   */
  skeletonSignature(): string {
    const names = Object.keys(this.rig.joints) as JointName[];
    const parentOf = (g: THREE.Object3D): string => {
      if (g.parent === this.rig.root) return 'root';
      return names.find((n) => this.rig.joints[n] === g.parent) ?? 'detached';
    };
    const joints = names.map((n) => {
      const j = this.rig.joints[n];
      return `${n}>${parentOf(j)}:${j.position.toArray().map((v) => v.toFixed(4)).join(',')}`;
    });
    const chain = this.rig.hair.map((g) => g.position.y.toFixed(4)).join(',');
    return `${joints.join('|')}|hairChain:${chain}`;
  }

  /** 外形网格统计：量化「方柱 → 多段圆角」的精修幅度，并盯住 draw call 规模。 */
  geometryStats(): { meshes: number; boxes: number; triangles: number; materials: number } {
    let meshes = 0, boxes = 0, triangles = 0;
    this.rig.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (list.some((m) => m && m.side === THREE.BackSide)) return; // 排除描边壳
      meshes++;
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (geo.type === 'BoxGeometry') boxes++;
      const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
      triangles += geo.index ? geo.index.count / 3 : pos ? pos.count / 3 : 0;
    });
    return { meshes, boxes, triangles: Math.round(triangles), materials: this.rig.materials.length };
  }

  /**
   * 攻击残影：克隆本帧骨架（含关节旋转与 root 变换）。
   * 描边壳用共享的 BackSide 材质且是放大的实心块，单色剪影里必须删掉，
   * 否则残影会变成一坨黑影；其余材质一律新建，交由 Fx 安全回收。
   */
  ghost(): THREE.Object3D {
    const clone = this.root.clone(true);
    const outlines: THREE.Object3D[] = [];
    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (src && src.side === THREE.BackSide) {
        outlines.push(mesh);
        return;
      }
      mesh.material = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.26,
        depthWrite: false, side: THREE.FrontSide,
      });
    });
    for (const o of outlines) o.removeFromParent();
    return clone;
  }

  apply(pose: Pose, f: Fighter, time: number): void {
    const r = this.rig;
    const dt = this.lastTime < 0 ? 1 : clamp(time - this.lastTime, 0.2, 3);
    this.lastTime = time;

    for (const name of this.jointNames) {
      const v = pose.j[name] ?? ZERO;
      r.joints[name].rotation.set(v[0], v[1], v[2]);
    }
    for (const [name, v] of this.overrides) r.joints[name].rotation.set(v[0], v[1], v[2]);

    r.root.position.set(f.x, f.y + (pose.rootY ?? 0), 0);
    // 3/4 侧身：保留四肢横向投影宽度，同时让几何五官仍有立体透视
    r.root.rotation.set(0, f.facing * 0.72, (pose.lean ?? 0) * f.facing);
    // 头部转回镜头，保证两只眼睛都能被看见
    r.joints.head.rotation.y = -f.facing * 0.52;

    // 眨眼：两人错开相位，避免同步眨眼显得像木偶
    const ph = (time + f.id * 83 + 40) % 186;
    const blink = ph < 3 ? 1 - ph / 3 * 0.88
      : ph < 6 ? 0.12 + (ph - 3) / 3 * 0.88
        : 1;
    for (const eye of r.eyes) eye.scale.y = blink;

    // 马尾弹簧：静息微摆 + 出招冲量甩动，逐段递增延迟
    const impact = pose.impact ?? 0;
    for (let i = 0; i < r.hair.length; i++) {
      const seg = r.hair[i];
      const idleSway = Math.sin(time * 0.062 - i * 0.55) * 0.055;
      // 冲量减半并限幅：否则出招时马尾会整束翻到头顶，露出绿色发圈
      const drive = impact * (0.08 + i * 0.05) * (i % 2 ? -1 : 1)
        + (pose.hair ?? 0) * (0.06 + i * 0.03);
      const target = idleSway + drive + i * 0.030;
      const acc = (target - this.hairAngle[i]) * 0.16 - this.hairVel[i] * 0.34;
      this.hairVel[i] += acc * dt;
      this.hairAngle[i] = clamp(this.hairAngle[i] + this.hairVel[i] * dt, -0.42, 0.58);
      seg.rotation.x = this.hairAngle[i];
      seg.rotation.z = Math.sin(time * 0.052 - i * 0.42) * 0.055
        + (pose.lean ?? 0) * f.facing * 0.12;
    }

    const s = Math.max(0.45, 1 - f.y * 0.42);
    r.shadow.position.x = f.x;
    r.shadow.scale.set(s, 0.42 * s, s);
    (r.shadow.material as THREE.MeshBasicMaterial).opacity = 0.42 * s;

    // emissive 只有「受击 / 正常」两态，脏检查避免每帧写 9 个材质
    const flash = f.flash > 0 ? FLASH_HIT : 0x000000;
    if (flash !== this.lastFlash) {
      this.lastFlash = flash;
      for (const m of r.materials) m.emissive.setHex(flash);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.shadow.removeFromParent();
    // 不释放 root 下的 geometry：模块级 GEO 缓存与 Fx 里最多存活 10 帧的攻击残影
    // （ghost() 用 this.root.clone(true)，与本体共享几何）都还引用它们，释放会让残影渲染出错。
    // 材质除共享的 OUTLINE 描边壳外均为本实例私有，可安全释放。
    disposeViewResources(this.rig.root, { disposeGeometry: false });
    // shadow 不在 rig.root 下，几何与材质都是本实例新建，单独释放
    const shadow = this.rig.shadow;
    shadow.geometry.dispose();
    (shadow.material as THREE.Material).dispose();
  }
}
