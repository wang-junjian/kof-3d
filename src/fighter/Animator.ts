import { JUMP_VY, MOVES, moveDuration, type MoveId, type PoseKey } from '../core/frames';
import type { Fighter } from './Fighter';
import type { JointName } from './rig';
import type { CharacterView, JointAngles, Pose, V3 } from './CharacterView';

const JOINTS: JointName[] = [
  'pelvis', 'torso', 'chest', 'head',
  'shoulderL', 'elbowL', 'shoulderR', 'elbowR',
  'hipL', 'kneeL', 'hipR', 'kneeR', 'hair',
];
const ZERO: V3 = [0, 0, 0];
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/**
 * 关节轴向与镜头投影的关系（相机在 +Z 看向 -Z，屏幕水平 = 世界 X）：
 *  - 绕 X 轴转：肢体朝 +Z/-Z（镜头方向），屏幕投影变化很小；
 *  - 绕 Z 轴转：肢体朝 +X/-X（对手方向），屏幕投影变化最大。
 * 因此出拳、踢腿的主伸展必须用 Z 分量；X 分量只负责抬平与立体厚度。
 * 护拳时双拳收在胸前中线附近，Z 角接近 0，避免一只手臂水平外伸像 T-pose。
 */
const BASE: JointAngles = {
  pelvis: [0, 0, 0.02],
  torso: [-0.06, -0.10, 0],
  chest: [0.02, 0.04, 0],
  head: [0.02, 0, -0.03],
  shoulderL: [-1.02, -0.08, -0.02],
  elbowL: [-1.68, 0, -0.10],
  shoulderR: [-0.92, 0.08, -0.28],
  elbowR: [-1.70, 0, 0.10],
  hipL: [-0.12, 0, 0.06],
  kneeL: [0.22, 0, 0],
  hipR: [0.08, 0, -0.06],
  kneeR: [0.16, 0, 0],
  hair: [0.12, 0, 0],
};

const P = (j: JointAngles, rootY = 0, lean = 0, hair = 0, impact = 0): Pose =>
  ({ j, rootY, lean, hair, impact });

/** 把 BASE 填满，避免每个关键帧都要写全 13 个关节。 */
function withBase(over: JointAngles, rootY = 0, lean = 0, hair = 0, impact = 0): Pose {
  return P({ ...BASE, ...over }, rootY, lean, hair, impact);
}

const POSES = {
  jumpRise: withBase({
    torso: [-0.14, 0, 0], chest: [0.08, 0, 0],
    shoulderL: [-0.70, 0, -0.42], elbowL: [-0.80, 0, -0.10],
    shoulderR: [-0.62, 0, 0.40], elbowR: [-0.82, 0, 0.10],
    hipL: [-0.20, 0, 0.78], kneeL: [0.95, 0, -0.10],
    hipR: [0.02, 0, 0.24], kneeR: [0.62, 0, 0.06],
    hair: [0.55, 0, 0],
  }, 0, -0.06, 0.65),

  jumpApex: withBase({
    torso: [-0.06, 0, 0], chest: [0.03, 0, 0],
    shoulderL: [-0.55, 0, -0.48], elbowL: [-0.72, 0, -0.10],
    shoulderR: [-0.50, 0, 0.46], elbowR: [-0.74, 0, 0.10],
    hipL: [-0.12, 0, 0.52], kneeL: [0.58, 0, -0.10],
    hipR: [0.04, 0, -0.22], kneeR: [0.36, 0, 0.06],
    hair: [0.35, 0, 0],
  }, 0, -0.02, 0.4),

  jumpFall: withBase({
    torso: [0.10, 0, 0], chest: [-0.04, 0, 0], head: [-0.10, 0, 0],
    shoulderL: [-0.38, 0, -0.56], elbowL: [-0.64, 0, -0.12],
    shoulderR: [-0.40, 0, 0.54], elbowR: [-0.62, 0, 0.12],
    hipL: [0.02, 0, 0.28], kneeL: [0.24, 0, -0.06],
    hipR: [0.06, 0, 0.36], kneeR: [0.48, 0, 0.10],
    hair: [-0.30, 0, 0],
  }, 0, 0.08, 0.5),

  land: withBase({
    torso: [0.22, 0, 0], chest: [0.10, 0, 0], head: [-0.14, 0, 0],
    shoulderL: [-0.62, 0, -0.34], elbowL: [-1.02, 0, -0.08],
    shoulderR: [-0.58, 0, 0.32], elbowR: [-1.04, 0, 0.08],
    hipL: [-0.24, 0, -0.12], kneeL: [0.86, 0, 0.20],
    hipR: [-0.22, 0, 0.12], kneeR: [0.84, 0, -0.20],
  }, -0.20, 0.04, 0.55),

  crouch: withBase({
    torso: [0.24, 0, 0], chest: [0.10, 0, 0], head: [-0.12, 0, 0],
    shoulderL: [-0.62, 0, 0.22], elbowL: [-1.10, 0, -0.08],
    shoulderR: [-0.60, 0, -0.22], elbowR: [-1.08, 0, 0.08],
    hipL: [-0.20, 0, -0.18], kneeL: [1.05, 0, 0.28],
    hipR: [-0.18, 0, 0.18], kneeR: [1.05, 0, -0.28],
  }, -0.32, 0.06),

  /** 站防：直立，双臂朝对手方向前伸、拳套在胸腹高度交叉，护住中段。 */
  guardStand: withBase({
    torso: [-0.04, -0.10, 0], chest: [0.06, 0.06, 0], head: [0.02, 0, 0],
    shoulderL: [-1.42, -0.12, 0.88], elbowL: [-1.56, 0, -0.12],
    shoulderR: [-1.38, 0.12, -0.88], elbowR: [-1.54, 0, 0.12],
    hipL: [-0.10, 0, -0.08], kneeL: [0.24, 0, 0.10],
    hipR: [0.06, 0, 0.08], kneeR: [0.22, 0, -0.10],
    hair: [0.12, 0, 0],
  }, -0.02, -0.10),

  /** 蹲防：重心明显下沉、深蹲、双拳上举护头，与站防形成剪影差异。 */
  guardCrouch: withBase({
    torso: [0.30, -0.04, 0], chest: [0.12, 0, 0], head: [-0.16, 0, 0],
    shoulderL: [-1.40, -0.12, 0.58], elbowL: [-1.80, 0, -0.20],
    shoulderR: [-1.36, 0.12, -0.58], elbowR: [-1.78, 0, 0.20],
    hipL: [-0.30, 0, -0.20], kneeL: [1.02, 0, 0.22],
    hipR: [0.12, 0, 0.20], kneeR: [1.00, 0, -0.22],
    hair: [-0.20, 0, 0],
  }, -0.36, 0.10),

  /** 受击峰值：第一帧就后仰到最大，之后按冲击衰减回稳。双臂一前一后，不做对称摊手。 */
  hitPeak: withBase({
    torso: [-0.46, -0.06, 0], chest: [-0.18, 0, 0], head: [-0.36, 0, 0],
    shoulderL: [0.10, 0, -0.42], elbowL: [-0.90, 0, -0.10],
    shoulderR: [-0.70, 0, 0.38], elbowR: [-1.20, 0, 0.10],
    hipL: [0.10, 0, -0.24], kneeL: [0.20, 0, 0.08],
    hipR: [0.04, 0, 0.20], kneeR: [0.26, 0, -0.08],
    hair: [-0.70, 0, 0],
  }, -0.06, -0.24, 1.0),

  blockPeak: withBase({
    torso: [-0.22, 0, 0], head: [0.12, 0, 0],
    shoulderL: [-1.28, -0.10, 0.30], elbowL: [-1.66, 0, -0.14],
    shoulderR: [-1.26, 0.10, -0.30], elbowR: [-1.64, 0, 0.14],
    hipL: [-0.14, 0, -0.08], kneeL: [0.46, 0, 0.12],
    hipR: [0.06, 0, 0.08], kneeR: [0.44, 0, -0.12],
  }, -0.12, -0.12, 0.45),

  knockdown: withBase({
    torso: [-0.58, 0, 0], chest: [-0.20, 0, 0], head: [-0.36, 0, 0],
    shoulderL: [0.70, 0, -0.88], elbowL: [-0.20, 0, -0.16],
    shoulderR: [0.66, 0, 0.84], elbowR: [-0.20, 0, 0.16],
    hipL: [-0.16, 0, -0.72], kneeL: [0.62, 0, 0.18],
    hipR: [0.10, 0, 0.44], kneeR: [0.98, 0, -0.20],
    hair: [-0.88, 0, 0],
  }, -0.44, -0.64, 1.0),

  ko: withBase({
    torso: [-0.30, 0, 0], chest: [-0.10, 0, 0], head: [-0.20, 0, 0],
    shoulderL: [0.78, 0, -0.95], elbowL: [-0.10, 0, -0.14],
    shoulderR: [0.76, 0, 0.92], elbowR: [-0.10, 0, 0.14],
    hipL: [-0.08, 0, -0.46], kneeL: [0.35, 0, 0.22],
    hipR: [0.06, 0, 0.28], kneeR: [0.55, 0, -0.18],
    hair: [-0.90, 0, 0],
  }, -0.62, -1.30, 0.6),
};

/**
 * 每个招式四段关键帧：
 * windup（蓄力）→ strike（active 首帧就伸展到位）→ follow（跟随过冲）→ recovery 回预备式。
 * 判定框只在 active 窗口生成，因此 strike 必须提前于判定视觉到位，不能"打中了才伸出去"。
 */
/**
 * 主攻肢体一律用 R 侧：在 3/4 侧身镜头下，R 侧的 +Z 旋转才把肢体送向
 * 画面右侧的对手；L 侧同角度会甩向背后，看起来像往后踢。角度由浏览器内
 * 骨骼末端坐标扫描标定（见 scripts/verify.mjs 的伸展方向断言）。
 */
const ATTACKS: Record<PoseKey, { windup: Pose; strike: Pose; follow: Pose }> = {
  punchL: {
    windup: withBase({
      torso: [-0.16, -0.24, 0], chest: [-0.04, -0.06, 0],
      shoulderR: [-0.90, 0.10, -0.55], elbowR: [-1.55, 0, 0.05],
      shoulderL: [-1.05, -0.08, 0.20], elbowL: [-1.42, 0, -0.10],
    }, 0, -0.05),
    strike: withBase({
      torso: [0.10, -0.22, 0], chest: [0.06, -0.06, 0],
      shoulderR: [-1.45, 0.10, 1.15], elbowR: [0, 0, 0],
      shoulderL: [-1.10, -0.08, -0.30], elbowL: [-1.50, 0, -0.10],
      hipL: [-0.08, 0, 0.10],
    }, 0.02, 0.07, 0.3, 1),
    follow: withBase({
      torso: [0.16, -0.20, 0], chest: [0.08, -0.06, 0],
      shoulderR: [-1.32, 0.10, 0.98], elbowR: [-0.22, 0, 0],
      shoulderL: [-1.08, -0.08, -0.28], elbowL: [-1.48, 0, -0.10],
    }, 0.02, 0.09, 0.55, 0.7),
  },
  punchH: {
    windup: withBase({
      torso: [-0.28, -0.44, 0], chest: [-0.12, -0.12, 0],
      shoulderR: [-0.70, 0.14, -0.78], elbowR: [-1.75, 0, 0.10],
      shoulderL: [-1.08, -0.10, 0.34], elbowL: [-1.48, 0, -0.12],
      hipL: [-0.14, 0, -0.10], kneeL: [0.30, 0, 0.06],
    }, -0.06, -0.14),
    strike: withBase({
      torso: [0.22, -0.38, 0], chest: [0.10, -0.12, 0], head: [0.08, 0, 0],
      shoulderR: [-1.65, 0.14, 1.25], elbowR: [0, 0, 0],
      shoulderL: [-1.12, -0.10, -0.48], elbowL: [-1.52, 0, -0.14],
      hipL: [0.10, 0, 0.20], hipR: [-0.12, 0, -0.14],
    }, 0.04, 0.17, 0.7, 1),
    follow: withBase({
      torso: [0.30, -0.36, 0], chest: [0.14, -0.12, 0], head: [0.06, 0, 0],
      shoulderR: [-1.55, 0.14, 1.05], elbowR: [-0.20, 0, 0],
      shoulderL: [-1.10, -0.10, -0.44], elbowL: [-1.50, 0, -0.14],
      hipL: [0.06, 0, 0.16], hipR: [-0.10, 0, -0.12],
    }, 0.03, 0.20, 1.0, 0.8),
  },
  kickL: {
    windup: withBase({
      torso: [-0.10, -0.08, 0],
      hipR: [0.02, 0, -0.40], kneeR: [0.70, 0, -0.10],
      shoulderL: [-0.96, 0, -0.36], shoulderR: [-0.90, 0, -0.32],
    }, 0, -0.06),
    strike: withBase({
      torso: [-0.18, 0.10, 0],
      hipR: [-0.85, 0, 0.95], kneeR: [0.05, 0, -0.05],
      hipL: [0.06, 0, -0.16],
      shoulderL: [-0.86, 0, -0.48], shoulderR: [-0.88, 0, -0.44],
    }, 0.02, -0.14, 0.4, 1),
    follow: withBase({
      torso: [-0.14, 0.08, 0],
      hipR: [-0.75, 0, 0.75], kneeR: [0.25, 0, -0.08],
      hipL: [0.04, 0, -0.14],
      shoulderL: [-0.90, 0, -0.44], shoulderR: [-0.90, 0, -0.40],
    }, 0.01, -0.11, 0.6, 0.65),
  },
  kickH: {
    windup: withBase({
      torso: [-0.24, -0.16, 0],
      hipR: [-0.30, 0, -0.55], kneeR: [0.95, 0, -0.15],
      hipL: [-0.06, 0, -0.12],
      shoulderL: [-0.80, 0, -0.52], shoulderR: [-0.78, 0, -0.50],
    }, -0.04, -0.16),
    strike: withBase({
      torso: [-0.42, 0.18, 0], chest: [-0.10, 0, 0], head: [0.14, 0, 0],
      hipR: [-1.60, 0, 1.00], kneeR: [0, 0, -0.05],
      hipL: [0.10, 0, -0.20],
      shoulderL: [-0.80, 0, -0.62], elbowL: [-0.40, 0, -0.16],
      shoulderR: [-0.72, 0, -0.55], elbowR: [-0.36, 0, -0.16],
      hair: [-0.45, 0, 0],
    }, 0.06, -0.30, 0.9, 1),
    follow: withBase({
      torso: [-0.38, 0.16, 0], chest: [-0.08, 0, 0], head: [0.10, 0, 0],
      hipR: [-1.50, 0, 0.88], kneeR: [0.14, 0, -0.08],
      hipL: [0.08, 0, -0.18],
      shoulderL: [-0.82, 0, -0.58], elbowL: [-0.46, 0, -0.16],
      shoulderR: [-0.74, 0, -0.52], elbowR: [-0.42, 0, -0.16],
      hair: [-0.30, 0, 0],
    }, 0.05, -0.26, 1.0, 0.75),
  },
  sweep: {
    windup: withBase({
      torso: [0.20, -0.10, 0],
      hipR: [-0.18, 0, -0.35], kneeR: [0.80, 0, -0.10],
      hipL: [-0.18, 0, 0.10], kneeL: [0.95, 0, -0.20],
      shoulderL: [-0.82, 0, -0.52], elbowL: [-1.10, 0, -0.12],
    }, -0.28, 0.10),
    strike: withBase({
      torso: [0.38, 0.12, 0], chest: [0.12, 0, 0], head: [-0.16, 0, 0],
      hipR: [-0.55, 0, 0.95], kneeR: [0.10, 0, -0.05],
      hipL: [-0.24, 0, 0.16], kneeL: [1.05, 0, -0.26],
      shoulderL: [-0.56, 0, -0.62], shoulderR: [-0.96, 0, -0.68],
      elbowR: [-0.40, 0, -0.10], hair: [-0.35, 0, 0],
    }, -0.34, 0.26, 0.6, 1),
    follow: withBase({
      torso: [0.32, 0.10, 0], chest: [0.10, 0, 0], head: [-0.12, 0, 0],
      hipR: [-0.48, 0, 0.78], kneeR: [0.25, 0, -0.08],
      hipL: [-0.22, 0, 0.14], kneeL: [0.96, 0, -0.24],
      shoulderL: [-0.60, 0, -0.58], shoulderR: [-0.90, 0, -0.62],
      elbowR: [-0.48, 0, -0.10],
    }, -0.30, 0.22, 0.75, 0.7),
  },

  /** 跳跃轻拳：躯干前压、R 臂向前下方砸，双腿收起，剪影区别于地面直拳。 */
  jumpPunch: {
    windup: withBase({
      torso: [-0.16, -0.22, 0], chest: [-0.06, -0.06, 0],
      shoulderR: [-0.82, 0.10, -0.62], elbowR: [-1.58, 0, 0.08],
      shoulderL: [-1.00, -0.08, 0.18], elbowL: [-1.44, 0, -0.10],
      hipL: [-0.18, 0, 0.34], kneeL: [0.66, 0, -0.10],
      hipR: [0.04, 0, 0.20], kneeR: [0.54, 0, 0.06],
      hair: [0.30, 0, 0],
    }, 0, -0.06, 0.35),
    strike: withBase({
      torso: [0.24, -0.24, 0], chest: [0.10, -0.08, 0], head: [0.12, 0, 0],
      shoulderR: [-1.42, 0.10, 1.18], elbowR: [0, 0, 0],
      shoulderL: [-1.06, -0.08, -0.34], elbowL: [-1.50, 0, -0.10],
      hipL: [-0.12, 0, 0.38], kneeL: [0.74, 0, -0.10],
      hipR: [0.02, 0, 0.26], kneeR: [0.60, 0, 0.06],
      hair: [-0.34, 0, 0],
    }, 0.02, 0.12, 0.6, 1),
    follow: withBase({
      torso: [0.20, -0.22, 0], chest: [0.08, -0.08, 0], head: [0.10, 0, 0],
      shoulderR: [-1.30, 0.10, 0.94], elbowR: [-0.24, 0, 0],
      shoulderL: [-1.04, -0.08, -0.30], elbowL: [-1.48, 0, -0.10],
      hipL: [-0.12, 0, 0.36], kneeL: [0.70, 0, -0.10],
      hipR: [0.02, 0, 0.24], kneeR: [0.58, 0, 0.06],
    }, 0.02, 0.10, 0.85, 0.7),
  },

  /** 跳跃重踢：R 腿前下方踹出、支撑腿收起、上身后仰配平。 */
  jumpKick: {
    windup: withBase({
      torso: [-0.20, -0.10, 0], chest: [-0.04, 0, 0],
      hipR: [-0.22, 0, -0.52], kneeR: [0.94, 0, -0.12],
      hipL: [-0.12, 0, 0.24], kneeL: [0.58, 0, -0.10],
      shoulderL: [-0.78, 0, -0.52], shoulderR: [-0.76, 0, -0.48],
      hair: [0.36, 0, 0],
    }, 0, -0.12, 0.4),
    strike: withBase({
      torso: [-0.36, 0.14, 0], chest: [-0.10, 0, 0], head: [0.14, 0, 0],
      hipR: [-1.52, 0, 1.06], kneeR: [0.10, 0, -0.05],
      hipL: [0.08, 0, 0.32], kneeL: [0.76, 0, -0.12],
      shoulderL: [-0.70, 0, -0.62], elbowL: [-0.42, 0, -0.16],
      shoulderR: [-0.68, 0, -0.56], elbowR: [-0.38, 0, -0.16],
      hair: [-0.48, 0, 0],
    }, 0.04, -0.26, 0.9, 1),
    follow: withBase({
      torso: [-0.32, 0.12, 0], chest: [-0.08, 0, 0], head: [0.10, 0, 0],
      hipR: [-1.40, 0, 0.88], kneeR: [0.24, 0, -0.08],
      hipL: [0.06, 0, 0.28], kneeL: [0.70, 0, -0.12],
      shoulderL: [-0.72, 0, -0.58], shoulderR: [-0.70, 0, -0.54],
    }, 0.03, -0.22, 1.0, 0.75),
  },

  /** M2 超必杀：深蹲后仰蓄力 → 全身前压的单臂贯穿，剪影明显大于重拳。 */
  super: {
    windup: withBase({
      torso: [-0.46, -0.50, 0], chest: [-0.20, -0.16, 0], head: [-0.18, 0, 0],
      shoulderR: [-0.48, 0.18, -1.05], elbowR: [-2.08, 0, 0.16],
      shoulderL: [-1.18, -0.12, 0.52], elbowL: [-1.66, 0, -0.14],
      hipL: [-0.26, 0, -0.20], kneeL: [0.52, 0, 0.08],
      hipR: [0.18, 0, 0.18], kneeR: [0.40, 0, -0.06],
      hair: [0.66, 0, 0],
    }, -0.12, -0.26, 0.85),
    strike: withBase({
      torso: [0.42, -0.52, 0], chest: [0.20, -0.16, 0], head: [0.16, 0, 0],
      shoulderR: [-1.80, 0.18, 1.46], elbowR: [0, 0, 0],
      shoulderL: [-1.22, -0.12, -0.66], elbowL: [-1.60, 0, -0.14],
      hipL: [0.22, 0, 0.30], hipR: [-0.22, 0, -0.24],
      hair: [-0.76, 0, 0],
    }, 0.10, 0.32, 1.0, 1),
    follow: withBase({
      torso: [0.46, -0.48, 0], chest: [0.22, -0.16, 0], head: [0.12, 0, 0],
      shoulderR: [-1.66, 0.18, 1.24], elbowR: [-0.28, 0, 0],
      shoulderL: [-1.20, -0.12, -0.60], elbowL: [-1.58, 0, -0.14],
      hipL: [0.18, 0, 0.26], hipR: [-0.18, 0, -0.20],
      hair: [-0.60, 0, 0],
    }, 0.07, 0.34, 1.0, 0.85),
  },
};

/** 预分配姿态缓冲：每帧复用，避免 13 组 V3 与 Pose 对象反复进 GC。 */
function makePoseBuffer(): Pose {
  const j: JointAngles = {};
  for (const name of JOINTS) j[name] = [0, 0, 0];
  return { j, rootY: 0, lean: 0, hair: 0, impact: 0 };
}

/**
 * out 可选：写入调用方预分配的缓冲。逐关节先读完 a/b 再写 out，
 * 因此 out 与 a 或 b 引用同一对象也是安全的（不会读到半更新的值）。
 */
function blend(a: Pose, b: Pose, t: number, out: Pose = makePoseBuffer()): Pose {
  for (const name of JOINTS) {
    const av = a.j[name] ?? BASE[name] ?? ZERO;
    const bv = b.j[name] ?? BASE[name] ?? ZERO;
    const v = out.j[name] ?? (out.j[name] = [0, 0, 0]);
    v[0] = lerp(av[0], bv[0], t);
    v[1] = lerp(av[1], bv[1], t);
    v[2] = lerp(av[2], bv[2], t);
  }
  out.rootY = lerp(a.rootY ?? 0, b.rootY ?? 0, t);
  out.lean = lerp(a.lean ?? 0, b.lean ?? 0, t);
  out.hair = lerp(a.hair ?? 0, b.hair ?? 0, t);
  out.impact = lerp(a.impact ?? 0, b.impact ?? 0, t);
  return out;
}

function clonePose(p: Pose, out: Pose = makePoseBuffer()): Pose {
  for (const name of JOINTS) {
    const v = p.j[name] ?? BASE[name] ?? ZERO;
    const o = out.j[name] ?? (out.j[name] = [0, 0, 0]);
    o[0] = v[0]; o[1] = v[1]; o[2] = v[2];
  }
  out.rootY = p.rootY ?? 0;
  out.lean = p.lean ?? 0;
  out.hair = p.hair ?? 0;
  out.impact = p.impact ?? 0;
  return out;
}

/** 待机：呼吸、重心转移、护拳微动三层不同频率叠加，避免完全静止的立牌感。 */
function idlePose(time: number, id: number): Pose {
  const breath = Math.sin(time * 0.042 + id * 1.7);
  const shift = Math.sin(time * 0.017 + id * 2.1);
  return withBase({
    pelvis: [0, 0, 0.02 + shift * 0.055],
    torso: [-0.06 + breath * 0.035, -0.06 + shift * 0.070, -shift * 0.025],
    chest: [0.02 - breath * 0.018, 0.02, 0],
    head: [0.02 - breath * 0.022, -0.03 + shift * 0.040, -0.03 - shift * 0.030],
    shoulderL: [-1.02 - breath * 0.040, -0.08, -0.02],
    shoulderR: [-0.92 + breath * 0.040, 0.08, -0.28],
    hipL: [-0.12 + shift * 0.050, 0, 0.06],
    hipR: [0.08 - shift * 0.050, 0, -0.06],
    kneeL: [0.22 + shift * 0.090, 0, 0],
    kneeR: [0.16 - shift * 0.090, 0, 0],
  }, breath * 0.018, 0, 0.12);
}

/** 步行：对侧手脚反相、骨盆与胸廓反向扭转、双频重心起伏，护拳不散。 */
function walkPose(phase: number): Pose {
  const s = Math.sin(phase);
  return withBase({
    pelvis: [0.03, s * 0.11, s * 0.05],
    torso: [-0.01, -s * 0.13, 0],
    chest: [0.02, -s * 0.05, 0],
    head: [0.02, -s * 0.04, -0.03],
    shoulderL: [-1.02 - s * 0.24, -0.08, -0.02 + s * 0.20],
    shoulderR: [-0.92 + s * 0.24, 0.08, -0.28 + s * 0.20],
    elbowL: [-1.68 + s * 0.10, 0, -0.10],
    elbowR: [-1.70 - s * 0.10, 0, 0.10],
    hipL: [-0.12 + s * 0.30, 0, 0.06 + s * 0.30],
    kneeL: [0.22 + Math.max(0, -s) * 0.42, 0, -0.08],
    hipR: [0.08 - s * 0.30, 0, -0.06 - s * 0.30],
    kneeR: [0.16 + Math.max(0, s) * 0.42, 0, 0.08],
  }, Math.abs(Math.sin(phase)) * 0.026 - 0.012, 0.045, 0.25 + Math.abs(s) * 0.12);
}

function jumpPose(f: Fighter): { pose: Pose; tag: string } {
  const p = clamp01(0.5 - f.vy / (2 * JUMP_VY));
  if (p < 0.5) return { pose: blend(POSES.jumpRise, POSES.jumpApex, p * 2), tag: 'jump-rise' };
  return { pose: blend(POSES.jumpApex, POSES.jumpFall, (p - 0.5) * 2), tag: 'jump-fall' };
}

function attackPose(f: Fighter, time: number, entry: Pose): { pose: Pose; tag: string } {
  const m = f.move;
  if (!m) return { pose: idlePose(time, f.id), tag: 'idle' };
  const { windup, strike, follow } = ATTACKS[m.pose];
  const frame = f.moveFrame;
  const idle = idlePose(time, f.id);
  const total = moveDuration(m);
  const activeEnd = m.startup + m.active;
  const followEnd = activeEnd + 2;

  if (frame < m.startup) {
    return { pose: blend(entry, windup, easeOut(clamp01(frame / m.startup))), tag: `windup:${m.id}` };
  }
  if (frame < activeEnd) {
    // 判定框在 active 首帧就生成，姿态必须同时到位：首帧即 88% strike，末帧 100%。
    // 用 t=0 起步的缓动会让命中帧仍是蓄力姿态，看起来「打中了才伸出去」。
    const t = clamp01((frame - m.startup + 1) / Math.max(1, m.active));
    return { pose: blend(windup, strike, 0.88 + 0.12 * t), tag: `strike:${m.id}` };
  }
  if (frame < followEnd) {
    const t = clamp01((frame - activeEnd) / 2);
    return { pose: blend(strike, follow, easeOut(t)), tag: `follow:${m.id}` };
  }
  const t = clamp01((frame - followEnd) / Math.max(1, total - followEnd));
  const pose = blend(follow, idle, easeOut(t));
  pose.impact = (follow.impact ?? 0.7) * (1 - t);
  return { pose, tag: `recovery:${m.id}` };
}

/** 受击/防御/倒地按状态帧走冲击曲线，而不是整段固定姿态。 */
function stunPose(f: Fighter, time: number): { pose: Pose; tag: string } {
  const idle = idlePose(time, f.id);
  const frame = f.stateFrame;
  if (f.state === 'hitstun') {
    const shock = Math.exp(-frame / 3.6);
    const pose = blend(idle, POSES.hitPeak, shock);
    const shake = Math.sin(frame * 2.2) * shock * 0.09;
    pose.j.torso = [(pose.j.torso?.[0] ?? 0) + shake, pose.j.torso?.[1] ?? 0, 0];
    pose.impact = shock;
    return { pose, tag: 'hit' };
  }
  if (f.state === 'blockstun') {
    const shock = Math.exp(-frame / 2.6);
    const pose = blend(idle, POSES.blockPeak, shock);
    pose.impact = shock * 0.5;
    return { pose, tag: 'block' };
  }
  if (f.state === 'knockdown') {
    const total = Math.max(1, frame + f.stunLeft);
    const t = clamp01(frame / total);
    if (t < 0.18) {
      const pose = blend(POSES.hitPeak, POSES.knockdown, t / 0.18);
      return { pose, tag: 'knockdown' };
    }
    if (t < 0.72) return { pose: clonePose(POSES.knockdown), tag: 'knockdown' };
    const pose = blend(POSES.knockdown, POSES.crouch, (t - 0.72) / 0.28);
    return { pose, tag: 'getup' };
  }
  // ko
  const pose = blend(POSES.knockdown, POSES.ko, clamp01(frame / 12));
  return { pose, tag: 'ko' };
}

/** 姿态平滑时间常数（单位：逻辑帧）。攻击必须严格对帧，其余状态消掉切换跳变。 */
const SMOOTHING: Record<string, number> = {
  idle: 3.0, walk: 2.0, guard: 1.8, crouch: 1.8,
  jump: 1.6, hitstun: 0.55, blockstun: 0.7,
  knockdown: 1.0, ko: 1.4, attack: 0.12,
};

export interface AnimDebug {
  tag: string;
  state: string;
  /** 本帧姿态平滑系数（1 = 无平滑）。 */
  blend: number;
  /** 本帧最大单关节角变化，用于检测动作跳变。 */
  maxDelta: number;
  impact: number;
  landing: number;
  joints: number[];
}

const DEBUG_JOINTS: JointName[] = ['torso', 'head', 'shoulderL', 'shoulderR', 'hipL', 'kneeR'];

/** 把逻辑状态映射成骨架姿态。姿态严格对齐帧表的窗口，因此动作天然对帧。 */
export class Animator {
  private displayed: Pose = withBase({});
  private entryPose: Pose = withBase({});
  /** displayed 双缓冲：读上一帧、写另一块，保证 maxDelta 拿到的是真正的前一帧姿态。 */
  private readonly bufA: Pose = makePoseBuffer();
  private readonly bufB: Pose = makePoseBuffer();
  private readonly targetBuf: Pose = makePoseBuffer();
  private readonly landBuf: Pose = makePoseBuffer();
  private useA = true;
  private readonly debugJoints: number[] = DEBUG_JOINTS.flatMap(() => [0, 0, 0]);
  private readonly debug: AnimDebug = {
    tag: 'idle', state: 'idle', blend: 1, maxDelta: 0,
    impact: 0, landing: 0, joints: this.debugJoints,
  };
  private lastTime = -1;
  private lastHitId = -1;
  private wasAirborne = false;
  private landTimer = 0;

  constructor(private view: CharacterView) {}

  /** 运行时热替换渲染层（例如 VRM 异步加载完成后）。 */
  setView(view: CharacterView): void {
    this.view = view;
  }

  inspect(): AnimDebug {
    return this.debug;
  }

  update(f: Fighter, time: number): void {
    const dt = this.lastTime < 0 ? 1 : Math.max(0, Math.min(3, time - this.lastTime));
    this.lastTime = time;

    // 落地缓冲：只要从滞空回到地面就触发（含空中招式落地），逐帧衰减
    if (this.wasAirborne && !f.airborne) this.landTimer = 7;
    this.wasAirborne = f.airborne;
    if (this.landTimer > 0) this.landTimer = Math.max(0, this.landTimer - dt);

    if (f.state === 'attack' && f.hitId !== this.lastHitId) {
      this.lastHitId = f.hitId;
      this.entryPose = clonePose(this.displayed);
    }

    let target: Pose;
    let tag: string;
    switch (f.state) {
      case 'attack': {
        const a = attackPose(f, time, this.entryPose);
        target = a.pose; tag = a.tag; break;
      }
      case 'walk': target = walkPose(f.walkPhase); tag = 'walk'; break;
      case 'jump': {
        const j = jumpPose(f);
        target = j.pose; tag = j.tag; break;
      }
      case 'crouch': target = clonePose(POSES.crouch, this.targetBuf); tag = 'crouch'; break;
      case 'guard': {
        const stand = f.guardLevel === 'stand';
        target = clonePose(stand ? POSES.guardStand : POSES.guardCrouch, this.targetBuf);
        tag = stand ? 'guard-stand' : 'guard-crouch';
        break;
      }
      case 'hitstun': case 'blockstun': case 'knockdown': case 'ko': {
        const s = stunPose(f, time);
        target = s.pose; tag = s.tag; break;
      }
      default: target = idlePose(time, f.id); tag = 'idle';
    }

    if (this.landTimer > 0) {
      const k = (this.landTimer / 7) * 0.85;
      target = blend(target, POSES.land, k, this.landBuf);
      target.impact = Math.max(target.impact ?? 0, k * 0.6);
      tag = 'land';
    }

    const tau = SMOOTHING[f.state] ?? 2.0;
    const k = tau <= 0 ? 1 : (dt <= 0 ? 0 : 1 - Math.exp(-dt / tau));
    const previous = this.displayed;
    const out = this.useA ? this.bufA : this.bufB;
    this.useA = !this.useA;
    this.displayed = k >= 0.999 ? clonePose(target, out) : blend(previous, target, k, out);

    let maxDelta = 0;
    for (const name of JOINTS) {
      const a = previous.j[name] ?? ZERO;
      const b = this.displayed.j[name] ?? ZERO;
      for (let i = 0; i < 3; i++) maxDelta = Math.max(maxDelta, Math.abs(b[i] - a[i]));
    }
    let n = 0;
    for (const name of DEBUG_JOINTS) {
      const v = this.displayed.j[name] ?? ZERO;
      this.debugJoints[n++] = v[0];
      this.debugJoints[n++] = v[1];
      this.debugJoints[n++] = v[2];
    }
    this.debug.tag = tag;
    this.debug.state = f.state;
    this.debug.blend = k;
    this.debug.maxDelta = maxDelta;
    this.debug.impact = this.displayed.impact ?? 0;
    this.debug.landing = this.landTimer;

    this.view.apply(this.displayed, f, time);
  }
}

/** 供自检直接抽样：按招式 ID 与帧号取四段标签，不改变任何运行时状态。 */
export function sampleAttackTags(moveId: MoveId): string[] {
  const m = MOVES[moveId];
  const total = moveDuration(m);
  const tags: string[] = [];
  const dummy = { id: 0, move: m, moveFrame: 0 } as unknown as Fighter;
  for (let frame = 0; frame < total; frame++) {
    dummy.moveFrame = frame;
    tags.push(attackPose(dummy, 0, withBase({})).tag);
  }
  return tags;
}
