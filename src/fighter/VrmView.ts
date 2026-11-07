import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { Fighter } from './Fighter';
import type { CharacterView, Pose } from './CharacterView';
import { disposeViewResources, type JointName } from './rig';

/** 游戏世界里的角色高度；VRM 模型身高各异，加载后统一归一化到这个值。 */
const TARGET_HEIGHT = 2.03;

/**
 * 关节 → VRM HumanoidBone。VRM 的 left/right 是角色自身左右，
 * 与程序化骨架的 x<0 = L 相反，所以这里按空间位置交叉映射。
 */
const BONE_MAP: Partial<Record<JointName, { name: VRMHumanBoneName; sign: [number, number, number] }>> = {
  pelvis: { name: 'hips', sign: [1, 1, 1] },
  torso: { name: 'spine', sign: [1, 1, 1] },
  chest: { name: 'chest', sign: [1, 1, 1] },
  head: { name: 'head', sign: [1, 1, 1] },
  // 手臂 Z 分量的符号必须与程序化骨架相反：VRM rest 是 T-pose，ARM_DROP 已用
  // +1.32 把 leftUpperArm 压到身侧；若再同号叠加 strike 的大 Z 角（1.35），
  // 总旋转会翻过 150° 把整条手臂甩到角色背后。取反后落在 ≈0 的水平位，
  // 配合 root 的 3/4 侧身与几何镜像，才是朝对手伸拳。四条同时取反才能保住
  // 非出拳臂贴身（只改主攻侧会让另一臂停在 rest 水平位，形成 T-pose）。
  shoulderL: { name: 'rightUpperArm', sign: [1, 1, 1] },
  elbowL: { name: 'rightLowerArm', sign: [1, 1, -1] },
  shoulderR: { name: 'leftUpperArm', sign: [1, 1, -1] },
  elbowR: { name: 'leftLowerArm', sign: [1, 1, -1] },
  hipL: { name: 'rightUpperLeg', sign: [1, 1, 1] },
  kneeL: { name: 'rightLowerLeg', sign: [1, 1, 1] },
  hipR: { name: 'leftUpperLeg', sign: [1, 1, 1] },
  kneeR: { name: 'leftLowerLeg', sign: [1, 1, 1] },
};

/**
 * 姿态缩放按骨骼组分开：统一的 0.65 会把拳类的前伸压成「手臂向外下方斜伸」，
 * 而躯干/腿部照单全收又容易甩过头。手臂要完整吃到 strike 的 Z 分量，
 * 腿与躯干保留保守增益。不同资产绑骨轴向有差异，这里留成分组旋钮。
 */
const GAIN = { arm: 1.00, leg: 0.82, body: 0.70 } as const;
/**
 * 模型正面朝向修正：VRM 0.x 导出常见正面朝 -Z，而舞台相机在 +Z。
 * 若换资产后发现脸朝里，把这个值改成 0 即可。
 */
const FACE_YAW = Math.PI;
/**
 * VRM 规范要求 rest pose 为 T-pose，手臂水平张开；格斗站姿需要把上臂压到身侧。
 * 绕 Z 轴 ±约 75°，在保留 rest quaternion 的前提下叠加。若换成自然站姿资产可设为 0。
 */
const ARM_DROP = 1.32;

/** 内联的 2.4MB base64 只解码一次，产出可复用的原始二进制。 */
function decodeBase64(base64: string): ArrayBuffer {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * 缓存粒度只能是原始二进制：gltf / VRM / VrmView 都持有被挂载、被 tint 修改过的
 * 状态，跨 loadVrmViews 调用复用必然互相覆盖；这里只防止重复热替换时重复 atob
 * 与数 MB 级临时数组分配。
 */
let cachedGlb: Promise<ArrayBuffer> | null = null;
function getGlb(base64: string): Promise<ArrayBuffer> {
  cachedGlb ??= Promise.resolve(decodeBase64(base64));
  return cachedGlb;
}

export class VrmView implements CharacterView {
  readonly root: THREE.Group;
  readonly shadow: THREE.Mesh;
  private readonly bones = new Map<JointName, THREE.Object3D>();
  /** 每个骨骼加载后的原始 quaternion：姿态只能叠加，绝不能覆盖 rest pose。 */
  private readonly restQuat = new Map<JointName, THREE.Quaternion>();
  private readonly materials: THREE.Material[] = [];
  private readonly deltaEuler = new THREE.Euler();
  private readonly deltaQuat = new THREE.Quaternion();
  /** 上一次 apply 所见到的逻辑帧号：VRM 内部时间只按逻辑帧推进，不看渲染帧频率。 */
  private lastLogicFrame = -1;

  get boneCount(): number {
    return this.bones.size;
  }

  /**
   * VRM 插槽暂不生成残影：SkinnedMesh.clone() 共享原 skeleton 的骨骼对象，
   * 剪影会跟着实时骨架一起动而不是定格在发力帧。其余打击演出照常可用。
   */
  ghost(): THREE.Object3D | null {
    return null;
  }

  constructor(private readonly vrm: VRM, tint: readonly [number, number, number]) {
    this.root = new THREE.Group();
    const holder = new THREE.Group();
    this.root.add(holder);

    // 归一化身高、脚底贴地、水平居中、正面朝向镜头
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const height = Math.max(0.001, box.max.y - box.min.y);
    const scale = TARGET_HEIGHT / height;
    vrm.scene.scale.setScalar(scale);
    holder.add(vrm.scene);
    holder.position.set(
      -((box.min.x + box.max.x) / 2) * scale,
      -box.min.y * scale,
      0,
    );
    holder.rotation.y = FACE_YAW;

    for (const [joint, mapping] of Object.entries(BONE_MAP) as [JointName, { name: VRMHumanBoneName }][]) {
      const node = vrm.humanoid.getRawBoneNode(mapping.name);
      if (node) {
        this.bones.set(joint, node);
        this.restQuat.set(joint, node.quaternion.clone());
      }
    }

    vrm.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.material) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) {
        this.materials.push(m);
        const colored = m as THREE.Material & { color?: THREE.Color };
        if (colored.color) colored.color.multiply(new THREE.Color(tint[0], tint[1], tint[2]));
      }
    });

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0x04050b, transparent: true, opacity: 0.42, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.shadow.scale.set(1, 0.42, 1);
  }

  apply(pose: Pose, f: Fighter, time: number): void {
    // VRM 内部时间必须锚定固定 60Hz 逻辑帧，而不是渲染帧频率：高刷屏上按渲染帧
    // update(1/60) 会让 springBone 物理时间成倍加速。main.ts 传入的 time 已是
    // 「逻辑帧号 + alpha」，其整数部分即逻辑帧号；Hitstop 时 time 不增、steps 为 0，
    // springBone 也随视觉时间一起定格。
    const frame = Math.floor(time);
    if (this.lastLogicFrame < 0) this.lastLogicFrame = frame; // 首帧不补步
    if (frame > this.lastLogicFrame) {
      // 与 FixedLoop 的 steps<5 上限一致；调试钩子/异常跳变也不至于让物理一步爆炸
      const steps = Math.min(5, frame - this.lastLogicFrame);
      for (let i = 0; i < steps; i++) this.vrm.update(1 / 60);
      this.lastLogicFrame = frame;
    } else if (frame < this.lastLogicFrame) {
      this.lastLogicFrame = frame; // 调试钩子回拨时同步，避免差分卡住
    }

    for (const [joint, mapping] of Object.entries(BONE_MAP) as
      [JointName, { name: VRMHumanBoneName; sign: [number, number, number] }][]) {
      const node = this.bones.get(joint);
      const rest = this.restQuat.get(joint);
      if (!node || !rest) continue;
      const v = pose.j[joint] ?? [0, 0, 0];
      const s = mapping.sign;
      const isArm = mapping.name.includes('Arm');
      const gain = isArm ? GAIN.arm : mapping.name.includes('Leg') ? GAIN.leg : GAIN.body;
      const isUpperArm = mapping.name === 'leftUpperArm' || mapping.name === 'rightUpperArm';
      const drop = isUpperArm ? (mapping.name === 'leftUpperArm' ? ARM_DROP : -ARM_DROP) : 0;
      this.deltaEuler.set(v[0] * s[0] * gain, v[1] * s[1] * gain, v[2] * s[2] * gain + drop);
      this.deltaQuat.setFromEuler(this.deltaEuler);
      node.quaternion.copy(rest).multiply(this.deltaQuat);
    }

    const lunge = (pose.rootX ?? 0) * f.facing;
    this.root.position.set(f.x + lunge, f.y + (pose.rootY ?? 0), 0);
    this.root.rotation.set(0, f.facing * 0.82, (pose.lean ?? 0) * f.facing);
    // 与 RigView 同一套镜像契约：姿态表按 facing=+1 标定，p2 必须整副翻过去，
    // 否则主攻肢体会朝镜头甚至自己背后伸展（VRM 的 springBone/lookAt 在 root 下，
    // 随父级负缩放一起镜像，不需要额外补偿）。
    this.root.scale.x = f.facing;

    const shade = Math.max(0.45, 1 - f.y * 0.42);
    this.shadow.position.x = f.x + lunge;
    this.shadow.scale.set(shade, 0.42 * shade, shade);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.42 * shade;

    const flash = f.flash > 0 ? 0x6a2a3c : 0x000000;
    for (const m of this.materials) {
      const emissive = (m as THREE.Material & { emissive?: THREE.Color }).emissive;
      if (emissive) emissive.setHex(flash);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.shadow.removeFromParent();
    // 两个角色各自 parse 一份 GLB，vrm.scene 的 geometry/skeleton/material/texture
    // 全部本实例独占；且 VrmView.ghost() 返回 null、无残影共享几何 → 可全量释放。
    disposeViewResources(this.vrm.scene, { disposeGeometry: true });
    // shadow 是 VrmView 自建、不在 vrm.scene 里，需单独释放
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
    this.materials.length = 0;
    this.bones.clear();
    this.restQuat.clear();
  }
}

/** 从构建期内联的 base64 数据加载两个独立 VRM 实例（各自可独立摆动与着色）。 */
export async function loadVrmViews(base64: string): Promise<CharacterView[]> {
  // Blob URL 只创建一次；revoke 必须晚于两次 loadAsync 全部 settle（含失败路径）。
  const url = URL.createObjectURL(new Blob([await getGlb(base64)], {
    type: 'application/octet-stream',
  }));
  try {
    const loader = new GLTFLoader();
    // 默认 autoUpdateHumanBones=true 会把 normalized pose 每帧写回 raw bone，
    // 覆盖我们叠加的格斗姿态。关闭后 raw bone 完全由 CharacterView 控制。
    loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: false }));

    const make = async (tint: readonly [number, number, number]): Promise<CharacterView> => {
      const gltf = await loader.loadAsync(url);
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) throw new Error('GLB 中未解析出 VRM 扩展，可能不是有效的 .vrm 文件');
      return new VrmView(vrm, tint);
    };
    // 两个独立 VRM 实例必须各自 parse 一次：VRM 的 manager 与 gltf.scene 节点强绑定，
    // 共享 VRM 实例或 SkeletonUtils.clone 都会让两人姿态/tint 互相覆盖。并发只是省掉串行等待。
    // 两位角色用极轻的冷暖色调区分，不破坏原贴图
    return await Promise.all([
      make([1.06, 0.96, 1.00]),
      make([0.96, 1.02, 1.06]),
    ]);
  } finally {
    URL.revokeObjectURL(url);
  }
}
