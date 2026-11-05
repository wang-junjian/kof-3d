/** 所有数值均为「逻辑帧」或「世界单位」，逻辑固定 60Hz 步进。 */

export type MoveId = 'LP' | 'HP' | 'LK' | 'HK' | 'SWEEP' | 'JLP' | 'JHK';
export type ButtonId = 'LP' | 'HP' | 'LK' | 'HK';
export type PoseKey = 'punchL' | 'punchH' | 'kickL' | 'kickH' | 'sweep' | 'jumpPunch' | 'jumpKick';
/**
 * 攻击高度属性：中段两种防御都能挡；下段只能蹲防；上段（跳攻）只能站防。
 * 防御姿势选错即按普通命中结算，并给 GUARD BREAK 反馈。
 */
export type HitLevel = 'mid' | 'low' | 'overhead';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MoveDef {
  id: MoveId;
  label: string;
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  pushback: number;
  meterGain: number;
  hitbox: Box;
  knockdown: boolean;
  cancelInto: MoveId[];
  pose: PoseKey;
  level: HitLevel;
  /** 仅限滞空期间可用；落地时由 Fighter 强制取消。 */
  air?: boolean;
}

/** 招式帧表：命中判定只在 active 窗口内生成。 */
export const MOVES: Record<MoveId, MoveDef> = {
  LP: {
    id: 'LP', label: '轻拳', startup: 3, active: 2, recovery: 6,
    damage: 4, hitstun: 12, blockstun: 8, hitstop: 4,
    pushback: 0.10, meterGain: 4,
    hitbox: { x: 0.66, y: 1.30, w: 0.58, h: 0.26 },
    knockdown: false, cancelInto: ['HP', 'HK'], pose: 'punchL', level: 'mid',
  },
  HP: {
    id: 'HP', label: '重拳', startup: 7, active: 3, recovery: 14,
    damage: 10, hitstun: 20, blockstun: 12, hitstop: 7,
    pushback: 0.20, meterGain: 8,
    hitbox: { x: 0.72, y: 1.26, w: 0.72, h: 0.34 },
    knockdown: false, cancelInto: [], pose: 'punchH', level: 'mid',
  },
  LK: {
    id: 'LK', label: '轻踢', startup: 4, active: 2, recovery: 8,
    damage: 5, hitstun: 13, blockstun: 9, hitstop: 4,
    pushback: 0.13, meterGain: 4,
    hitbox: { x: 0.68, y: 0.82, w: 0.60, h: 0.30 },
    knockdown: false, cancelInto: [], pose: 'kickL', level: 'mid',
  },
  HK: {
    id: 'HK', label: '重踢', startup: 9, active: 4, recovery: 18,
    damage: 14, hitstun: 26, blockstun: 14, hitstop: 8,
    pushback: 0.30, meterGain: 10,
    hitbox: { x: 0.76, y: 1.00, w: 0.86, h: 0.48 },
    knockdown: false, cancelInto: [], pose: 'kickH', level: 'mid',
  },
  SWEEP: {
    id: 'SWEEP', label: '下段扫腿', startup: 8, active: 3, recovery: 16,
    damage: 9, hitstun: 22, blockstun: 12, hitstop: 6,
    pushback: 0.24, meterGain: 7,
    hitbox: { x: 0.70, y: 0.28, w: 0.86, h: 0.34 },
    knockdown: true, cancelInto: [], pose: 'sweep', level: 'low',
  },

  JLP: {
    id: 'JLP', label: '跳跃轻拳', startup: 3, active: 4, recovery: 8,
    damage: 6, hitstun: 16, blockstun: 10, hitstop: 5,
    pushback: 0.14, meterGain: 5,
    hitbox: { x: 0.60, y: 0.55, w: 0.62, h: 0.52 },
    knockdown: false, cancelInto: [], pose: 'jumpPunch', level: 'overhead', air: true,
  },
  JHK: {
    id: 'JHK', label: '跳跃重踢', startup: 5, active: 5, recovery: 10,
    damage: 12, hitstun: 24, blockstun: 13, hitstop: 7,
    pushback: 0.26, meterGain: 9,
    hitbox: { x: 0.68, y: 0.42, w: 0.80, h: 0.60 },
    knockdown: false, cancelInto: [], pose: 'jumpKick', level: 'overhead', air: true,
  },
};

export const BUTTON_MOVE: Record<ButtonId, MoveId> = {
  LP: 'LP', HP: 'HP', LK: 'LK', HK: 'HK',
};

/** 滞空时同一组按键映射到空中招式，不引入额外键位。 */
export const AIR_BUTTON_MOVE: Record<ButtonId, MoveId> = {
  LP: 'JLP', HP: 'JHK', LK: 'JLP', HK: 'JHK',
};

export function moveDuration(m: MoveDef): number {
  return m.startup + m.active + m.recovery;
}

export const MAX_HP = 100;
export const MAX_METER = 100;
export const ROUND_SECONDS = 99;
export const ARENA_HALF = 3.35;
export const WALK_SPEED = 0.055;
export const BACK_SPEED = 0.042;
export const JUMP_VY = 0.20;
export const JUMP_VX = 0.070;
export const GRAVITY = -0.018;
export const GROUND_FRICTION = 0.80;
/** 空中招式落地后的短硬直：防止落地瞬间继续挥空判定或立刻起招。 */
export const LANDING_STUN = 6;

/** 站立受伤盒（局部坐标，x 为角色中心，y 自地面起）。 */
export const HURT_STAND: Box = { x: 0, y: 0.92, w: 0.66, h: 1.80 };
export const HURT_CROUCH: Box = { x: 0, y: 0.55, w: 0.76, h: 1.10 };
export const HURT_AIR: Box = { x: 0, y: 0.85, w: 0.66, h: 1.55 };
/** 推挤盒半宽，保证两名角色不重叠。 */
export const PUSH_HALF = 0.30;
