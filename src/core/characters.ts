/**
 * 角色定义：纯数据，位于 core 层，不导入任何渲染模块（three.js / rig.ts）。
 * 这样 bundle-logic.mjs 打出的纯逻辑 ESM 包仍能直接在 node:test 里跑。
 */
import {
  AIR_BUTTON_MOVE, BUTTON_MOVE,
  type ButtonId, type CharId, type CommandId, type MoveId,
} from './frames';

/**
 * 动作个性化参数：Animator 在通用姿态表之上按角色变换主攻肢体。
 * 只缩放 / 偏移角度，不改骨架层级，因此 skeletonSignature() 与镜像契约都不受影响。
 */
export interface MotionStyle {
  /** 主攻肢体 Z 角倍率（>1 更舒展，<1 更收沉）。 */
  reach: number;
  /** 主攻肢体 X 角偏移（抬平 / 立体厚度）。 */
  lift: number;
  /** 整体前倾增量。 */
  lean: number;
  /** rootX 前冲倍率。 */
  rootX: number;
  /** 马尾 / 飘带摆动幅度倍率。 */
  hair: number;
}

/** 特殊技：相对 facing 的方向 + 按键。dir 用 KOF 数字方位，6 = 前，3 = 下前。 */
export interface SpecialDef {
  dir: 6 | 3;
  button: ButtonId;
  move: MoveId;
}

export interface CharacterDef {
  id: CharId;
  /** HUD 与开机页使用的中文名。 */
  name: string;
  title: string;
  style: string;
  catchphrase: string;
  motion: MotionStyle;
  buttons: Record<ButtonId, MoveId>;
  airButtons: Record<ButtonId, MoveId>;
  specials: SpecialDef[];
  /** 指令 → 起招映射，两人不同，这是「角色独特性」的核心。 */
  commands: Partial<Record<CommandId, MoveId>>;
  /** 取消图覆盖：键为起手招式 id；缺省回落到 MoveDef.cancelInto。 */
  cancels: Partial<Record<MoveId, MoveId[]>>;
  /** 旧 qcf 兼容链路使用的超必杀。 */
  superMove: MoveId;
}

/** 绯翎：轻装、迅捷、多段连击、空中派生。深紫长马尾 + 品红轻装 + 酸绿饰边。 */
export const FEILING: CharacterDef = {
  id: 'FEILING',
  name: '绯翎',
  title: '疾影',
  style: '轻装 · 迅捷 · 多段连击',
  catchphrase: '羽过无痕',
  motion: { reach: 1.12, lift: -0.10, lean: -0.02, rootX: 0.85, hair: 1.25 },
  buttons: { ...BUTTON_MOVE },
  airButtons: { ...AIR_BUTTON_MOVE },
  specials: [
    { dir: 6, button: 'HP', move: 'FL_THRUST' },
    { dir: 3, button: 'HK', move: 'FL_SWALLOW' },
  ],
  commands: {
    '236': 'FL_THOUSAND',
    '623': 'FL_RISE',
    '236236': 'FL_SKY',
  },
  cancels: {
    LP: ['HP', 'HK', 'FL_THOUSAND', 'FL_SKY'],
    LK: ['FL_THOUSAND', 'FL_SKY'],
    HP: ['FL_SKY'],
    HK: ['FL_SKY'],
    FL_THRUST: ['FL_THOUSAND', 'FL_SKY'],
    FL_SWALLOW: ['FL_THOUSAND'],
  },
  superMove: 'FL_SKY',
};

/** 岳铮：重装、力量、指令投、派生重压。金发宽刘海 + 青蓝重甲 + 双侧护肩。 */
export const YUEZHENG: CharacterDef = {
  id: 'YUEZHENG',
  name: '岳铮',
  title: '铁山',
  style: '重装 · 力量 · 指令投',
  catchphrase: '一拳落岳',
  motion: { reach: 0.92, lift: 0.14, lean: 0.12, rootX: 1.35, hair: 0.75 },
  buttons: { ...BUTTON_MOVE },
  airButtons: { ...AIR_BUTTON_MOVE },
  specials: [
    { dir: 6, button: 'HP', move: 'YZ_SHOULDER' },
    { dir: 3, button: 'HK', move: 'YZ_STOMP' },
  ],
  commands: {
    '214': 'YZ_CRUSH',
    '623': 'YZ_RISE',
    '41236': 'YZ_THROW',
    '236236': 'YZ_LAND',
  },
  cancels: {
    LP: ['HP', 'HK', 'YZ_CRUSH', 'YZ_LAND'],
    LK: ['YZ_CRUSH', 'YZ_LAND'],
    HP: ['YZ_LAND'],
    HK: ['YZ_LAND'],
    YZ_SHOULDER: ['YZ_CRUSH', 'YZ_LAND'],
    YZ_STOMP: ['YZ_CRUSH'],
  },
  superMove: 'YZ_LAND',
};

export const CHARACTERS: Record<CharId, CharacterDef> = {
  FEILING,
  YUEZHENG,
};

/** 纯逻辑单测用旧签名 `new Fighter(0, 'RIN', x)` 时的中性角色：行为与改动前一致。 */
export const LEGACY_CHAR: CharacterDef = {
  id: 'FEILING',
  name: 'RIN',
  title: '',
  style: '',
  catchphrase: '',
  motion: { reach: 1, lift: 0, lean: 0, rootX: 1, hair: 1 },
  buttons: { ...BUTTON_MOVE },
  airButtons: { ...AIR_BUTTON_MOVE },
  specials: [],
  commands: {},
  cancels: {},
  superMove: 'SUPER',
};

export function characterFor(side: 0 | 1): CharacterDef {
  return side === 0 ? FEILING : YUEZHENG;
}
