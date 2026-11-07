import type * as THREE from 'three';
import type { Fighter } from './Fighter';
import type { JointName } from './rig';

/** 姿态用欧拉角描述，与具体骨架实现无关——这是可替换角色资产的契约。 */
export type V3 = [number, number, number];
export type JointAngles = Partial<Record<JointName, V3>>;

export interface Pose {
  j: JointAngles;
  rootY?: number;
  /** 发力帧的整体前冲（世界单位，按 facing 取符号）；只影响视觉位置，不改判定坐标。 */
  rootX?: number;
  lean?: number;
  hair?: number;
  /** 发力冲量 0..1：驱动头发/衣摆的二级动力学，不参与任何判定。 */
  impact?: number;
}

/**
 * 角色渲染层接口。游戏逻辑只产出 Pose，具体由程序化骨架、VRM 或将来任何
 * 骨骼实现消费；换资产不需要碰状态机、帧表与判定。
 */
export interface CharacterView {
  readonly root: THREE.Object3D;
  readonly shadow: THREE.Object3D;
  apply(pose: Pose, f: Fighter, time: number): void;
  dispose(): void;
  /**
   * 可选：克隆「当前姿态」的半透明单色剪影，用于攻击残影。
   * 返回的 Object3D 自带本帧的世界变换与新材质（几何可共享），
   * 由 Fx 负责淡出并 dispose 材质；不支持的渲染层返回 null。
   */
  ghost?(): THREE.Object3D | null;
}
