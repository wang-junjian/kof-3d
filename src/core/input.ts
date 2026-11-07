import type { ButtonId, CommandId } from './frames';

export interface InputFrame {
  dir: -1 | 0 | 1;
  jump: boolean;
  down: boolean;
  guard: boolean;
  buttons: ButtonId[];
  /**
   * M2：本帧由 Match 识别出的 236（↓↘→ / ↓↙←）指令，值为**绝对**水平方向。
   * 输入层不知道 facing，由 Fighter 比对 `qcf === facing` 才允许起必杀。
   * 可选字段：EMPTY_INPUT 与既有单测构造的中性帧不受影响。
   */
  qcf?: 1 | -1;
  /** M3：本帧识别出的通用指令（按长度降序，超杀指令优先）。 */
  commands?: CommandId[];
  /** M3：同一帧按下 LP + HP → MAX 爆气。 */
  max?: boolean;
  /** M3：同一帧按下 LP + HK 且方向朝后 → 紧急回避。 */
  evade?: boolean;
}

export const EMPTY_INPUT: InputFrame = {
  dir: 0, jump: false, down: false, guard: false, buttons: [],
};

/** 236 指令的有效输入窗口（逻辑帧，60Hz 下约 333ms），由 Match 维护历史。 */
export const QCF_WINDOW = 20;

/**
 * 识别「下 → 下前 → 前 + 攻击键」的 236 指令。
 *
 * 当前输入模型只有 `dir: -1|0|1` 与 `down`，没有斜下方向，因此 ↘ 用
 * `down && dir !== 0` 表达。frame 是**本帧**（不在 history 里），要求它正好
 * 是「松开下、保持该方向、并按下攻击键」的收尾帧；再往历史里倒序找 ↘ 与 ↓，
 * 顺序天然成立。中间的重复帧与停留帧都允许，符合格斗游戏的宽松输入。
 *
 * 返回绝对方向：玩家在左半场（facing=1）摇 ↓↘→ 得 1，在右半场摇 ↓↙← 得 -1。
 * 是否放行由 Fighter 用 facing 判定，输入层不掺入角色状态。
 */
export function detectQcf(history: readonly InputFrame[], frame: InputFrame): 1 | -1 | null {
  if (frame.down || frame.dir === 0 || frame.buttons.length === 0) return null;
  const d = frame.dir;
  let diagonal = false;
  for (let i = history.length - 1; i >= 0; i--) {
    const f = history[i];
    if (!diagonal) {
      if (f.down && f.dir === d) diagonal = true;
    } else if (f.down && f.dir === 0) {
      return d;
    }
  }
  return null;
}

// ── M3 通用指令匹配器 ───────────────────────────────────────────────────────
/**
 * 方向用 KOF 数字方位表示，且一律相对 facing：6 = 前，4 = 后，3 = 下前，
 * 1 = 下后，2 = 下，5 = 中立，8 = 跳。相对化放在 Match（它知道 facing），
 * 输入层因此与角色站位解耦，AI 也能直接产出指令 id。
 */
export interface CommandDef {
  id: CommandId;
  seq: number[];
  /** 有效输入窗口（逻辑帧）；长指令给更宽的窗口。 */
  window: number;
}

/** 按长度降序：一次摇杆若同时满足多个指令，超杀指令优先被 Fighter 选中。 */
export const COMMANDS: readonly CommandDef[] = [
  { id: '236236', seq: [2, 3, 6, 2, 3, 6], window: 34 },
  { id: '41236', seq: [4, 1, 2, 3, 6], window: 30 },
  { id: '236', seq: [2, 3, 6], window: 20 },
  { id: '214', seq: [2, 1, 4], window: 20 },
  { id: '623', seq: [6, 2, 3], window: 20 },
];

/** 把一帧输入归约成相对 facing 的数字方位。 */
export function toNotation(frame: InputFrame, facing: 1 | -1 = 1): number {
  if (frame.jump) return 8;
  const rel = frame.dir === 0 ? 0 : (frame.dir === facing ? 1 : -1);
  if (frame.down) return rel === 0 ? 2 : (rel === 1 ? 3 : 1);
  if (rel === 0) return 5;
  return rel === 1 ? 6 : 4;
}

/** 倒序子序列匹配：允许按住方向产生的重复帧，符合格斗游戏的宽松输入。 */
function matchesPattern(seq: readonly number[], pattern: readonly number[]): boolean {
  let j = pattern.length - 1;
  for (let i = seq.length - 1; i >= 0 && j >= 0; i--) {
    if (seq[i] === pattern[j]) j--;
  }
  return j < 0;
}

/**
 * 识别本帧收尾的所有指令。要求本帧有攻击键（KOF 的指令都以按键收尾），
 * 且序列末尾落在窗口内。history 是 Match 维护的相对方位历史（不含本帧）。
 */
export function detectCommands(
  history: readonly number[], frame: InputFrame, facing: 1 | -1,
): CommandId[] {
  if (frame.buttons.length === 0 || frame.commands) return frame.commands ?? [];
  const seq = [...history, toNotation(frame, facing)];
  const found: CommandId[] = [];
  for (const def of COMMANDS) {
    const window = seq.slice(-def.window);
    if (matchesPattern(window, def.seq)) found.push(def.id);
  }
  return found;
}

/** 把数字方位还原成一帧输入，供触屏 / 手柄的一键指令宏使用。 */
export function notationFrame(n: number, facing: 1 | -1, buttons: ButtonId[] = []): InputFrame {
  const dir = (n === 6 || n === 3 ? facing : n === 4 || n === 1 ? -facing : 0) as -1 | 0 | 1;
  return {
    dir, jump: n === 8, down: n === 1 || n === 2 || n === 3,
    guard: false, buttons,
  };
}

/** 所有输入设备最终都归约成这 8 个角色，纯逻辑层不认识键盘 / 触屏 / 手柄。 */
export type InputRole = 'left' | 'right' | 'up' | 'down' | 'LP' | 'HP' | 'LK' | 'HK';
/** 分来源持有角色：多设备同时按同一个方向时，松开其中一个不会误清另一个。 */
export type InputSource = 'keyboard' | 'touch' | 'pad';

export const INPUT_ROLES: readonly InputRole[] = [
  'left', 'right', 'up', 'down', 'LP', 'HP', 'LK', 'HK',
];

const KEY_ROLE: Record<string, InputRole> = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyJ: 'LP', KeyK: 'HP', KeyL: 'LK', KeyI: 'HK',
};

const BUTTON_ROLES = new Set<InputRole>(['LP', 'HP', 'LK', 'HK']);

/**
 * 12 帧环形缓冲：sample() 每个逻辑帧调用一次，边缘触发的按键只消费一次。
 *
 * 键盘、触屏虚拟键、Gamepad 都通过 press()/release() 汇入同一个缓冲；
 * 按 source 分桶保存按住状态，避免「手柄每帧同步」把键盘按住的方向误释放。
 */
export class InputBuffer {
  private readonly held = new Map<InputSource, Set<InputRole>>();
  private fresh: InputRole[] = [];
  private history: InputFrame[] = [];
  /** 移动端 / 手柄的一键指令宏排队的脚本帧，由 sample() 逐帧吐出，保持纯逻辑可复现。 */
  private macro: InputFrame[] = [];
  private started = false;
  onFirstInteraction: (() => void) | null = null;

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
    target.addEventListener('pointerdown', this.onPointer);
  }

  private onPointer = (): void => this.signal();
  private signal(): void {
    if (!this.started) {
      this.started = true;
      this.onFirstInteraction?.();
    }
  }

  private roleHeld(role: InputRole): boolean {
    for (const set of this.held.values()) if (set.has(role)) return true;
    return false;
  }

  /** 外部输入源调用：按下边缘只在「该角色从无到有」时进入 fresh。 */
  press(role: InputRole, source: InputSource = 'keyboard'): void {
    this.signal();
    const wasHeld = this.roleHeld(role);
    let set = this.held.get(source);
    if (!set) {
      set = new Set();
      this.held.set(source, set);
    }
    if (set.has(role)) return; // 同一来源的重复按下（键盘 auto-repeat）不重复触发
    set.add(role);
    if (!wasHeld) this.fresh.push(role);
  }

  release(role: InputRole, source: InputSource = 'keyboard'): void {
    this.held.get(source)?.delete(role);
  }

  /** 失焦 / 页面隐藏：清空所有来源，避免切回来后角色一直朝一个方向走。 */
  releaseAll(): void {
    this.held.clear();
    this.fresh.length = 0;
    this.macro.length = 0;
  }

  /**
   * 触屏 / 手柄的一键 236：把 ↓ → ↘ → →+攻击 排成 3 个逻辑帧。
   * Match 会把前两帧存入 20 帧输入历史，第三帧触发 detectQcf，
   * 因此与键盘手摇走的是**完全相同**的判定链路，不是另一套规则。
   */
  queueQcf(dir: 1 | -1, button: ButtonId = 'HP'): void {
    this.signal();
    this.fresh.length = 0;
    this.macro = [
      { dir: 0, jump: false, down: true, guard: false, buttons: [] },
      { dir, jump: false, down: true, guard: false, buttons: [] },
      { dir, jump: false, down: false, guard: false, buttons: [button] },
    ];
  }

  /** 通用一键指令宏：把指令序列排成逐帧输入，走与手摇相同的识别链路。 */
  queueCommand(id: CommandId, facing: 1 | -1, button: ButtonId = 'HP'): void {
    const def = COMMANDS.find((c) => c.id === id);
    if (!def) return;
    this.signal();
    this.fresh.length = 0;
    this.macro = def.seq.map((n, i) =>
      notationFrame(n, facing, i === def.seq.length - 1 ? [button] : []));
  }

  get macroPending(): boolean { return this.macro.length > 0; }

  /** 自检探针：当前所有来源合并后的按住角色。 */
  heldRoles(): InputRole[] {
    return INPUT_ROLES.filter((r) => this.roleHeld(r));
  }

  private onDown = (e: KeyboardEvent): void => {
    const role = KEY_ROLE[e.code];
    if (!role) return;
    e.preventDefault();
    this.press(role, 'keyboard');
  };

  private onUp = (e: KeyboardEvent): void => {
    const role = KEY_ROLE[e.code];
    if (!role) return;
    e.preventDefault();
    this.release(role, 'keyboard');
  };

  private onBlur = (): void => {
    this.releaseAll();
  };

  sample(): InputFrame {
    if (this.macro.length) {
      this.fresh.length = 0;
      const frame = this.macro.shift() as InputFrame;
      this.history.push(frame);
      if (this.history.length > 12) this.history.shift();
      return frame;
    }
    const fresh = this.fresh;
    this.fresh = [];
    const buttons: ButtonId[] = [];
    let jump = false;
    for (const role of fresh) {
      if (BUTTON_ROLES.has(role)) buttons.push(role as ButtonId);
      if (role === 'up') jump = true;
    }
    const dir = ((this.roleHeld('right') ? 1 : 0) - (this.roleHeld('left') ? 1 : 0)) as -1 | 0 | 1;
    const down = this.roleHeld('down');
    // 防御不再由「下蹲」隐式触发：键盘侧按住后方向即为防御请求，
    // 由 Fighter 结合 facing 推导站防/蹲防；guard 保留给 AI 显式举防。
    const frame: InputFrame = {
      dir, jump, down, guard: false, buttons,
      max: buttons.includes('LP') && buttons.includes('HP'),
      evade: buttons.includes('LP') && buttons.includes('HK'),
    };
    this.history.push(frame);
    if (this.history.length > 12) this.history.shift();
    return frame;
  }

  /** 方向历史探针：固定回最近 12 帧。236 指令识别由 Match 独立维护更长的历史。 */
  recentDirections(): number[] {
    return this.history.map((f) => f.dir);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('pointerdown', this.onPointer);
  }
}
