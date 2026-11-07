/** 所有数值均为「逻辑帧」或「世界单位」，逻辑固定 60Hz 步进。 */

export type CharId = 'FEILING' | 'YUEZHENG';

/**
 * 招式 id 是全体角色的并集。基础 8 招两人共用（跨角色镜像契约依赖这一点），
 * 其余为各自专属：FL_ = 绯翎，YZ_ = 岳铮。
 */
export type MoveId =
  | 'LP' | 'HP' | 'LK' | 'HK' | 'SWEEP' | 'JLP' | 'JHK' | 'SUPER'
  | 'FL_THRUST' | 'FL_SWALLOW' | 'FL_THOUSAND' | 'FL_FEATHER' | 'FL_SKYFALL'
  | 'FL_RISE' | 'FL_SKY'
  | 'YZ_SHOULDER' | 'YZ_STOMP' | 'YZ_CRUSH' | 'YZ_CRUSH2' | 'YZ_QUAKE'
  | 'YZ_RISE' | 'YZ_THROW' | 'YZ_LAND';

export type ButtonId = 'LP' | 'HP' | 'LK' | 'HK';
export type PoseKey =
  | 'punchL' | 'punchH' | 'kickL' | 'kickH' | 'sweep'
  | 'jumpPunch' | 'jumpKick' | 'super' | 'flurry' | 'slam';

/** 相对 facing 的方向序列指令；输入层只产出 id，起什么招由角色表决定。 */
export type CommandId = '236' | '214' | '623' | '236236' | '41236';

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

/** 多段招式的一段独立判定。frame 是相对起招的逻辑帧号。 */
export interface HitWindow {
  frame: number;
  box: Box;
  damage: number;
  hitstop?: number;
  hitstun?: number;
  knockdown?: boolean;
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
  /** 起招指令（由输入层识别，Fighter 按角色 commands 表映射）。 */
  command?: CommandId;
  /** POW 消耗，默认 0。 */
  cost?: number;
  /** 近身技：与对手的距离必须小于该值才允许起招。 */
  closeRange?: number;
  /** 不可防御（投技）；不做骨骼对位，用近距离判定 + 顿帧 + 击飞表现。 */
  unblockable?: boolean;
  /** 多段判定：每段独立结算一次，忽略 hasHit。 */
  hits?: HitWindow[];
  /** 派生追加输入：窗口内按指定键切到后续招式（KOF 的「追加输入」）。 */
  branchInto?: Partial<Record<ButtonId, MoveId>>;
  /** 派生窗口 [起, 止)，缺省为 [startup, moveDuration)。 */
  branchWindow?: [number, number];
  /** 专属角色；缺省表示两人共用。 */
  owner?: CharId;
}

/** 招式帧表：命中判定只在 active 窗口内生成。基础 8 招数值冻结，勿动。 */
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

  /** M2 超必杀：只能由 236 指令 + SUPER_COST 消费起招，不进按键直连映射表。 */
  SUPER: {
    id: 'SUPER', label: '流星直拳', startup: 10, active: 5, recovery: 22,
    damage: 26, hitstun: 34, blockstun: 20, hitstop: 12,
    pushback: 0.46, meterGain: 0,
    hitbox: { x: 0.82, y: 1.24, w: 1.05, h: 0.46 },
    // cost 与下方 SUPER_COST 同为 50：常量声明在表之后，这里不能引用（TDZ）。
    knockdown: true, cancelInto: [], pose: 'super', level: 'mid', cost: 50,
  },

  // ── 绯翎（轻装 · 迅捷 · 多段连击 · 空中派生）────────────────────────────
  FL_THRUST: {
    id: 'FL_THRUST', label: '流光刺', startup: 6, active: 3, recovery: 12,
    damage: 8, hitstun: 18, blockstun: 11, hitstop: 6,
    pushback: 0.16, meterGain: 6,
    hitbox: { x: 0.86, y: 1.30, w: 0.80, h: 0.30 },
    knockdown: false, cancelInto: ['FL_THOUSAND', 'FL_SKY'], pose: 'punchH', level: 'mid',
    owner: 'FEILING',
  },
  FL_SWALLOW: {
    id: 'FL_SWALLOW', label: '燕落', startup: 9, active: 4, recovery: 16,
    damage: 11, hitstun: 22, blockstun: 13, hitstop: 7,
    pushback: 0.22, meterGain: 7,
    hitbox: { x: 0.80, y: 0.95, w: 0.78, h: 0.50 },
    knockdown: false, cancelInto: ['FL_THOUSAND'], pose: 'kickH', level: 'overhead',
    owner: 'FEILING',
  },
  FL_THOUSAND: {
    id: 'FL_THOUSAND', label: '千羽连', startup: 8, active: 12, recovery: 18,
    damage: 4, hitstun: 16, blockstun: 10, hitstop: 4,
    pushback: 0.10, meterGain: 10,
    hitbox: { x: 0.80, y: 1.22, w: 0.72, h: 0.36 },
    knockdown: false, cancelInto: [], pose: 'flurry', level: 'mid',
    command: '236', owner: 'FEILING',
    hits: [
      { frame: 8, box: { x: 0.74, y: 1.26, w: 0.62, h: 0.30 }, damage: 4, hitstop: 3 },
      { frame: 12, box: { x: 0.80, y: 1.22, w: 0.70, h: 0.34 }, damage: 4, hitstop: 3 },
      { frame: 16, box: { x: 0.86, y: 1.20, w: 0.78, h: 0.36 }, damage: 5, hitstop: 5 },
    ],
    branchInto: { HP: 'FL_FEATHER', HK: 'FL_SKYFALL' },
    branchWindow: [8, 30],
  },
  FL_FEATHER: {
    id: 'FL_FEATHER', label: '羽落', startup: 5, active: 3, recovery: 12,
    damage: 7, hitstun: 18, blockstun: 11, hitstop: 5,
    pushback: 0.14, meterGain: 5,
    hitbox: { x: 0.78, y: 1.18, w: 0.70, h: 0.42 },
    knockdown: false, cancelInto: [], pose: 'jumpPunch', level: 'overhead',
    owner: 'FEILING',
    branchInto: { HK: 'FL_SKYFALL' }, branchWindow: [5, 20],
  },
  FL_SKYFALL: {
    id: 'FL_SKYFALL', label: '天翔落', startup: 7, active: 4, recovery: 20,
    damage: 14, hitstun: 26, blockstun: 14, hitstop: 9,
    pushback: 0.34, meterGain: 8,
    hitbox: { x: 0.80, y: 0.78, w: 0.86, h: 0.62 },
    knockdown: true, cancelInto: [], pose: 'jumpKick', level: 'overhead',
    owner: 'FEILING',
  },
  FL_RISE: {
    id: 'FL_RISE', label: '翎升', startup: 5, active: 5, recovery: 22,
    damage: 13, hitstun: 26, blockstun: 14, hitstop: 8,
    pushback: 0.30, meterGain: 9,
    hitbox: { x: 0.62, y: 1.40, w: 0.70, h: 0.76 },
    knockdown: true, cancelInto: [], pose: 'punchH', level: 'mid',
    command: '623', owner: 'FEILING',
  },
  FL_SKY: {
    id: 'FL_SKY', label: '绯翎·天翔', startup: 10, active: 8, recovery: 26,
    damage: 16, hitstun: 34, blockstun: 20, hitstop: 12,
    pushback: 0.50, meterGain: 0,
    hitbox: { x: 0.84, y: 1.22, w: 1.00, h: 0.52 },
    knockdown: true, cancelInto: [], pose: 'super', level: 'mid',
    command: '236236', cost: 50, owner: 'FEILING',
    hits: [
      { frame: 10, box: { x: 0.78, y: 1.24, w: 0.92, h: 0.46 }, damage: 14, hitstop: 8 },
      { frame: 14, box: { x: 0.90, y: 1.20, w: 1.06, h: 0.54 }, damage: 16, hitstop: 13 },
    ],
  },

  // ── 岳铮（重装 · 力量 · 指令投 · 派生重压）──────────────────────────────
  YZ_SHOULDER: {
    id: 'YZ_SHOULDER', label: '铁肩撞', startup: 8, active: 4, recovery: 15,
    damage: 11, hitstun: 22, blockstun: 13, hitstop: 8,
    pushback: 0.30, meterGain: 7,
    hitbox: { x: 0.78, y: 1.18, w: 0.76, h: 0.52 },
    knockdown: false, cancelInto: ['YZ_CRUSH', 'YZ_LAND'], pose: 'punchH', level: 'mid',
    owner: 'YUEZHENG',
  },
  YZ_STOMP: {
    id: 'YZ_STOMP', label: '踏山', startup: 10, active: 4, recovery: 17,
    damage: 10, hitstun: 22, blockstun: 13, hitstop: 7,
    pushback: 0.22, meterGain: 7,
    hitbox: { x: 0.76, y: 0.34, w: 0.88, h: 0.34 },
    knockdown: false, cancelInto: ['YZ_CRUSH'], pose: 'kickH', level: 'low',
    owner: 'YUEZHENG',
  },
  YZ_CRUSH: {
    id: 'YZ_CRUSH', label: '崩山拳', startup: 11, active: 4, recovery: 18,
    damage: 15, hitstun: 26, blockstun: 15, hitstop: 9,
    pushback: 0.34, meterGain: 10,
    hitbox: { x: 0.84, y: 1.18, w: 0.92, h: 0.52 },
    knockdown: false, cancelInto: [], pose: 'punchH', level: 'mid',
    command: '214', owner: 'YUEZHENG',
    branchInto: { HP: 'YZ_CRUSH2', HK: 'YZ_QUAKE' },
    branchWindow: [11, 33],
  },
  YZ_CRUSH2: {
    id: 'YZ_CRUSH2', label: '续·崩山', startup: 6, active: 4, recovery: 14,
    damage: 9, hitstun: 20, blockstun: 12, hitstop: 6,
    pushback: 0.24, meterGain: 6,
    hitbox: { x: 0.82, y: 1.14, w: 0.84, h: 0.48 },
    knockdown: false, cancelInto: [], pose: 'flurry', level: 'mid',
    owner: 'YUEZHENG',
    branchInto: { HK: 'YZ_QUAKE' }, branchWindow: [6, 24],
  },
  YZ_QUAKE: {
    id: 'YZ_QUAKE', label: '裂地', startup: 9, active: 4, recovery: 22,
    damage: 16, hitstun: 30, blockstun: 16, hitstop: 10,
    pushback: 0.40, meterGain: 9,
    hitbox: { x: 0.82, y: 0.40, w: 1.02, h: 0.50 },
    knockdown: true, cancelInto: [], pose: 'slam', level: 'low',
    owner: 'YUEZHENG',
  },
  YZ_RISE: {
    id: 'YZ_RISE', label: '岳起', startup: 7, active: 5, recovery: 24,
    damage: 14, hitstun: 28, blockstun: 15, hitstop: 9,
    pushback: 0.34, meterGain: 9,
    hitbox: { x: 0.68, y: 1.32, w: 0.78, h: 0.80 },
    knockdown: true, cancelInto: [], pose: 'kickH', level: 'mid',
    command: '623', owner: 'YUEZHENG',
  },
  YZ_THROW: {
    id: 'YZ_THROW', label: '岳落', startup: 4, active: 3, recovery: 26,
    damage: 20, hitstun: 32, blockstun: 18, hitstop: 14,
    pushback: 0.56, meterGain: 12,
    hitbox: { x: 0.52, y: 1.10, w: 0.66, h: 0.92 },
    knockdown: true, cancelInto: [], pose: 'slam', level: 'mid',
    command: '41236', closeRange: 1.05, unblockable: true, owner: 'YUEZHENG',
  },
  YZ_LAND: {
    id: 'YZ_LAND', label: '铮·裂地', startup: 12, active: 8, recovery: 28,
    damage: 16, hitstun: 36, blockstun: 22, hitstop: 13,
    pushback: 0.58, meterGain: 0,
    hitbox: { x: 0.86, y: 0.92, w: 1.08, h: 0.70 },
    knockdown: true, cancelInto: [], pose: 'super', level: 'mid',
    command: '236236', cost: 50, owner: 'YUEZHENG',
    hits: [
      { frame: 12, box: { x: 0.80, y: 1.02, w: 0.96, h: 0.62 }, damage: 15, hitstop: 9 },
      { frame: 16, box: { x: 0.90, y: 0.80, w: 1.12, h: 0.68 }, damage: 17, hitstop: 14, knockdown: true },
    ],
  },
};

/** 基础按键映射（两人共用；专属特殊技由 CharacterDef.specials 覆盖）。 */
export const BUTTON_MOVE: Record<ButtonId, MoveId> = {
  LP: 'LP', HP: 'HP', LK: 'LK', HK: 'HK',
};

/** 滞空时同一组按键映射到空中招式，不引入额外键位。 */
export const AIR_BUTTON_MOVE: Record<ButtonId, MoveId> = {
  LP: 'JLP', HP: 'JHK', LK: 'JLP', HK: 'JHK',
};

/** 全部基础（两人共用）招式：镜像 / 伸展契约只对它们做跨角色严格比对。 */
export const BASE_MOVES: readonly MoveId[] = [
  'LP', 'HP', 'LK', 'HK', 'SWEEP', 'JLP', 'JHK', 'SUPER',
];

export function moveDuration(m: MoveDef): number {
  return m.startup + m.active + m.recovery;
}

export const MAX_HP = 100;
export const MAX_METER = 100;
/** 236 超必杀的 POW 消费：半槽一次，攒满可连续放两次。必杀本身不再攒气（meterGain = 0）。 */
export const SUPER_COST = 50;
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

// ── M3 系统常量 ────────────────────────────────────────────────────────────
/** MAX 爆气：消耗半槽，持续 8 秒，攻击力 1.5 倍，超必杀升 MAX 版。 */
export const MAX_COST = 50;
export const MAX_DURATION = 480;
export const MAX_DAMAGE_SCALE = 1.5;
/** 同一帧按下轻拳 + 重拳即触发 MAX，不新增键位（触屏双指同按同样成立）。 */
export const MAX_BUTTONS: readonly ButtonId[] = ['LP', 'HP'];
/** 防御破坏：连续挡下 9 次攻击后，下一次格挡被强制破防。 */
export const GUARD_CRUSH_LIMIT = 9;
/** 紧急回避：向后 + 轻拳 + 重踢同时按，前 10 帧无敌。 */
export const EVADE_FRAMES = 18;
export const EVADE_INVULN = 10;
export const EVADE_SPEED = 0.13;

/** 站立受伤盒（局部坐标，x 为角色中心，y 自地面起）。 */
export const HURT_STAND: Box = { x: 0, y: 0.92, w: 0.66, h: 1.80 };
export const HURT_CROUCH: Box = { x: 0, y: 0.55, w: 0.76, h: 1.10 };
export const HURT_AIR: Box = { x: 0, y: 0.85, w: 0.66, h: 1.55 };
/** 推挤盒半宽，保证两名角色不重叠。 */
export const PUSH_HALF = 0.30;
