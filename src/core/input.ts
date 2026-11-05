import type { ButtonId } from './frames';

export interface InputFrame {
  dir: -1 | 0 | 1;
  jump: boolean;
  down: boolean;
  guard: boolean;
  buttons: ButtonId[];
}

export const EMPTY_INPUT: InputFrame = {
  dir: 0, jump: false, down: false, guard: false, buttons: [],
};

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

  /** 预留给 M2 的指令解析（236 等），M1 不消费。 */
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
