import type { ButtonId } from './frames';

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

const KEY_ROLE: Record<string, string> = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyJ: 'LP', KeyK: 'HP', KeyL: 'LK', KeyI: 'HK',
};

const BUTTON_ROLES = new Set(['LP', 'HP', 'LK', 'HK']);

/** 12 帧环形缓冲：sample() 每个逻辑帧调用一次，边缘触发的按键只消费一次。 */
export class InputBuffer {
  private held = new Set<string>();
  private fresh: string[] = [];
  private history: InputFrame[] = [];
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

  private onDown = (e: KeyboardEvent): void => {
    if (!(e.code in KEY_ROLE)) return;
    e.preventDefault();
    this.signal();
    if (!this.held.has(e.code)) {
      this.held.add(e.code);
      this.fresh.push(e.code);
    }
  };

  private onUp = (e: KeyboardEvent): void => {
    if (!(e.code in KEY_ROLE)) return;
    e.preventDefault();
    this.held.delete(e.code);
  };

  private onBlur = (): void => {
    this.held.clear();
    this.fresh.length = 0;
  };

  private roleHeld(role: string): boolean {
    for (const code of this.held) if (KEY_ROLE[code] === role) return true;
    return false;
  }

  sample(): InputFrame {
    const fresh = this.fresh;
    this.fresh = [];
    const buttons: ButtonId[] = [];
    let jump = false;
    for (const code of fresh) {
      const role = KEY_ROLE[code];
      if (!role) continue;
      if (BUTTON_ROLES.has(role)) buttons.push(role as ButtonId);
      if (role === 'up') jump = true;
    }
    const dir = ((this.roleHeld('right') ? 1 : 0) - (this.roleHeld('left') ? 1 : 0)) as -1 | 0 | 1;
    const down = this.roleHeld('down');
    // 防御不再由「下蹲」隐式触发：键盘侧按住后方向即为防御请求，
    // 由 Fighter 结合 facing 推导站防/蹲防；guard 保留给 AI 显式举防。
    const frame: InputFrame = { dir, jump, down, guard: false, buttons };
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
