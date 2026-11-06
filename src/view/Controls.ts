import {
  INPUT_ROLES, type InputBuffer, type InputRole,
} from '../core/input';
import { padMacroPressed, padRoles, type PadLike } from '../core/pad';

export interface ControlsOptions {
  /** 236 快捷手势要按玩家当前面向注入绝对方向，不能写死向右。 */
  facing: () => 1 | -1;
  /** intro / roundOver / hitstop 期间不排 236，否则前两帧不进 Match 的输入历史。 */
  canMacro: () => boolean;
}

export interface ControlsProbe {
  visible: boolean;
  touchDetected: boolean;
  padConnected: boolean;
  padRoles: InputRole[];
  macroPending: boolean;
  held: InputRole[];
  buttons: number;
}

const TEMPLATE = `
<div id="touch-controls" aria-hidden="true">
  <div class="tc-stick" aria-label="方向键">
    <button type="button" class="tc-key tc-up" data-role="up" aria-label="跳跃">▲</button>
    <button type="button" class="tc-key tc-left" data-role="left" aria-label="左">◀</button>
    <button type="button" class="tc-key tc-down" data-role="down" aria-label="下蹲">▼</button>
    <button type="button" class="tc-key tc-right" data-role="right" aria-label="右">▶</button>
  </div>
  <div class="tc-actions" aria-label="攻击键">
    <button type="button" class="tc-key tc-macro" data-macro="qcf" aria-label="236 超必杀">236<small>必杀</small></button>
    <button type="button" class="tc-key tc-atk tc-lp" data-role="LP" aria-label="轻拳">轻拳</button>
    <button type="button" class="tc-key tc-atk tc-hp" data-role="HP" aria-label="重拳">重拳</button>
    <button type="button" class="tc-key tc-atk tc-lk" data-role="LK" aria-label="轻踢">轻踢</button>
    <button type="button" class="tc-key tc-atk tc-hk" data-role="HK" aria-label="重踢">重踢</button>
  </div>
  <div id="device-hint" aria-live="polite"></div>
</div>
`;

/**
 * 把触屏虚拟键与 Gamepad 汇入 InputBuffer。
 *
 * 三种设备统一归约成 InputRole，纯逻辑层（帧表 / Match / Fighter）完全不知道
 * 输入来自哪里。方向按 source 分桶持有，手柄每帧同步不会误释放键盘按住的方向。
 */
export class Controls {
  private readonly root: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly touchDetected: boolean;
  private forced: boolean | null = null;
  private padConnected = false;
  private prevMacro = false;
  private lastPadRoles: InputRole[] = [];

  constructor(
    host: HTMLElement,
    private readonly input: InputBuffer,
    private readonly opts: ControlsOptions,
  ) {
    this.touchDetected = navigator.maxTouchPoints > 0 ||
      window.matchMedia?.('(pointer: coarse)').matches === true;
    const wrap = document.createElement('div');
    wrap.innerHTML = TEMPLATE;
    this.root = wrap.firstElementChild as HTMLElement;
    host.appendChild(this.root);
    this.hint = this.root.querySelector<HTMLElement>('#device-hint') as HTMLElement;

    for (const el of this.root.querySelectorAll<HTMLElement>('[data-role]')) {
      this.bindKey(el, el.dataset.role as InputRole);
    }
    const macro = this.root.querySelector<HTMLElement>('[data-macro]') as HTMLElement;
    macro.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.opts.canMacro()) this.input.queueQcf(this.opts.facing());
      macro.classList.add('down');
      window.setTimeout(() => macro.classList.remove('down'), 130);
    });

    this.applyVisibility();
  }

  private bindKey(el: HTMLElement, role: InputRole): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.input.press(role, 'touch');
      el.classList.add('down');
    });
    const lift = (): void => {
      this.input.release(role, 'touch');
      el.classList.remove('down');
    };
    el.addEventListener('pointerup', lift);
    el.addEventListener('pointercancel', lift);
    el.addEventListener('lostpointercapture', lift);
  }

  private applyVisibility(): void {
    const on = this.forced ?? this.touchDetected;
    document.body.classList.toggle('touch-ui', on);
    this.root.setAttribute('aria-hidden', on ? 'false' : 'true');
  }

  /** 桌面调试 / 自检可强制开关；传 null 回到设备自动判定。 */
  setTouchVisible(on: boolean | null): void {
    this.forced = on;
    this.applyVisibility();
  }

  /** 真实可见性：与 CSS 的 `body.touch-ui.started` 一致，开机遮罩期返回 false。 */
  get visible(): boolean {
    return getComputedStyle(this.root).display !== 'none';
  }

  /** 每个逻辑帧在 sample() 之前调用：手柄是轮询设备，没有 DOM 事件可用。 */
  sync(): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let pad: PadLike | null = null;
    for (const p of pads) {
      if (p && p.connected) { pad = p as PadLike; break; }
    }
    const roles = padRoles(pad);
    for (const role of INPUT_ROLES) {
      if (roles.has(role)) this.input.press(role, 'pad');
      else this.input.release(role, 'pad');
    }
    this.lastPadRoles = [...roles];

    const macro = padMacroPressed(pad);
    if (macro && !this.prevMacro && this.opts.canMacro()) {
      this.input.queueQcf(this.opts.facing());
    }
    this.prevMacro = macro;

    const connected = pad !== null;
    if (connected !== this.padConnected) {
      this.padConnected = connected;
      this.hint.textContent = connected ? '手柄已连接 · RB 一键 236' : '';
    }
  }

  probe(): ControlsProbe {
    return {
      visible: this.visible,
      touchDetected: this.touchDetected,
      padConnected: this.padConnected,
      padRoles: this.lastPadRoles,
      macroPending: this.input.macroPending,
      held: this.input.heldRoles(),
      buttons: this.root.querySelectorAll('[data-role]').length,
    };
  }
}
