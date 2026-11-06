import { installGestureGuards } from './Gestures';

export interface ScreenProbe {
  /** 浏览器是否提供元素级全屏 API（iPhone Safari 为 false）。 */
  supported: boolean;
  /** 当前是否处于全屏。 */
  active: boolean;
  /** 首次交互是否走过自动全屏分支（桌面恒为 false）。 */
  autoRequested: boolean;
  /** 真正发起过的全屏请求次数（不含「已全屏」与不支持的短路）。 */
  attempts: number;
  /** 最近一次失败原因；null 表示没有失败。 */
  lastError: string | null;
  /** 触屏设备判定，决定是否自动全屏。 */
  touchLike: boolean;
  /** 是否已作为独立 Web App（iOS 主屏图标 / PWA）运行。 */
  standalone: boolean;
  /** 是否成功锁定横屏（iOS Safari 不支持，恒为 false）。 */
  landscapeLocked: boolean;
}

type FullscreenRequest = () => Promise<void> | void;

interface FsElement extends HTMLElement {
  webkitRequestFullscreen?: FullscreenRequest;
  msRequestFullscreen?: FullscreenRequest;
}
interface FsDocument extends Document {
  webkitFullscreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
}

const IOS_HINT = 'iPhone Safari 不支持网页全屏：点「分享 → 添加到主屏幕」，再从主屏图标打开即可全屏游玩';
const FAIL_HINT = '浏览器未允许自动全屏，点右侧 ⛶ 可重试';
const EXIT_HINT = '已退出全屏，点右侧 ⛶ 可重新全屏';

/**
 * 移动端全屏与视口适配。
 *
 * 全屏请求只允许发生在用户手势的 transient activation 期间，所以
 * `enterAuto()` 必须由 InputBuffer 的首次交互回调**同步**调用；任何
 * `await` / setTimeout 之后再 request 都会被浏览器拒绝。
 * iPhone Safari 没有元素级 Fullscreen API，只能靠「添加到主屏幕」的
 * standalone 模式，因此这里所有失败都静默降级，绝不阻断对局。
 */
export class Screen {
  private readonly el = document.documentElement as FsElement;
  private readonly doc = document as FsDocument;
  private readonly button: HTMLButtonElement;
  private readonly hintEl: HTMLElement;
  private readonly touchLike: boolean;
  private readonly standalone: boolean;
  private readonly supported: boolean;
  private autoRequested = false;
  private attempts = 0;
  private lastError: string | null = null;
  private landscapeLocked = false;
  private wasFullscreen = false;
  private hintTimer = 0;

  constructor(private readonly onViewportChange: () => void) {
    this.touchLike = navigator.maxTouchPoints > 0 ||
      window.matchMedia?.('(pointer: coarse)').matches === true;
    this.standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia?.('(display-mode: standalone)').matches === true;
    this.supported = typeof this.el.requestFullscreen === 'function' ||
      typeof this.el.webkitRequestFullscreen === 'function' ||
      typeof this.el.msRequestFullscreen === 'function';

    installGestureGuards();

    this.button = document.createElement('button');
    this.button.id = 'fs-toggle';
    this.button.type = 'button';
    this.button.textContent = '⛶';
    this.button.setAttribute('aria-label', '切换全屏');
    this.button.setAttribute('aria-pressed', 'false');
    this.button.title = '进入全屏';
    // 点全屏按钮不该被当成「开始游戏」的首次交互，也不该进输入缓冲。
    this.button.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.button.addEventListener('click', () => { void this.toggle(); });

    this.hintEl = document.createElement('div');
    this.hintEl.id = 'fs-hint';
    this.hintEl.setAttribute('aria-live', 'polite');

    const app = document.getElementById('app') ?? document.body;
    app.appendChild(this.button);
    app.appendChild(this.hintEl);
    this.wasFullscreen = this.active();
    this.refresh();
    this.decorateBoot();

    const changed = (): void => {
      const on = this.active();
      const was = this.wasFullscreen;
      this.wasFullscreen = on;
      this.refresh();
      this.onViewportChange();
      // 地址栏 / 全屏过渡会在事件之后一两帧才稳定，补一次尺寸重算。
      window.setTimeout(this.onViewportChange, 140);
      if (was && !on && document.body.classList.contains('started')) {
        this.showHint(EXIT_HINT, 2600);
      }
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    window.addEventListener('orientationchange', changed);
    window.visualViewport?.addEventListener('resize', changed);
  }

  private active(): boolean {
    return !!(this.doc.fullscreenElement ??
      this.doc.webkitFullscreenElement ??
      this.doc.msFullscreenElement);
  }

  /** 首次交互入口：只在触屏设备自动请求全屏，桌面保持原有浏览器窗口。 */
  enterAuto(): void {
    if (!this.touchLike) return;
    this.autoRequested = true;
    if (this.standalone) return; // 主屏图标启动本就没有地址栏
    void this.enter('auto');
  }

  /** 手动进入全屏；返回是否真的处于全屏。 */
  async enter(reason: 'auto' | 'manual' = 'manual'): Promise<boolean> {
    if (this.active()) return true;
    if (!this.supported) {
      if (this.touchLike) this.showHint(IOS_HINT, 5000);
      return false;
    }
    this.attempts++;
    const request = this.el.requestFullscreen ??
      this.el.webkitRequestFullscreen ??
      this.el.msRequestFullscreen;
    try {
      await request?.call(this.el);
      await this.tryLockLandscape();
      this.lastError = null;
    } catch (err) {
      this.lastError = String(err).slice(0, 160);
      if (reason === 'auto' && this.touchLike) this.showHint(FAIL_HINT, 4000);
    }
    this.refresh();
    if (!this.active() && reason === 'manual' && this.touchLike && !this.lastError) {
      this.showHint(IOS_HINT, 5000);
    }
    return this.active();
  }

  async exit(): Promise<void> {
    if (!this.active()) return;
    const leave = this.doc.exitFullscreen ??
      this.doc.webkitExitFullscreen ??
      this.doc.msExitFullscreen;
    try {
      await leave?.call(this.doc);
    } catch (err) {
      this.lastError = String(err).slice(0, 160);
    }
    this.refresh();
  }

  async toggle(): Promise<void> {
    if (this.active()) { await this.exit(); return; }
    await this.enter('manual');
  }

  /** Chrome / Android：全屏状态下把屏幕锁成横屏；iOS 无此 API，静默跳过。 */
  private async tryLockLandscape(): Promise<void> {
    // lib.dom 的 ScreenOrientation 没有声明 lock（浏览器支持程度不一），单独收窄。
    const orientation = screen.orientation as unknown as
      { lock?: (o: string) => Promise<void> } | undefined;
    if (!orientation || typeof orientation.lock !== 'function') return;
    try {
      await orientation.lock('landscape');
      this.landscapeLocked = true;
    } catch {
      this.landscapeLocked = false;
    }
  }

  private refresh(): void {
    const on = this.active();
    this.button.classList.toggle('active', on);
    this.button.classList.toggle('unsupported', !this.supported);
    this.button.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.button.title = on ? '退出全屏' : '进入全屏';
  }

  private showHint(text: string, ms = 3600): void {
    window.clearTimeout(this.hintTimer);
    this.hintEl.textContent = text;
    this.hintEl.classList.add('show');
    this.hintTimer = window.setTimeout(() => this.hintEl.classList.remove('show'), ms);
  }

  /** 开机页只在触屏设备改文案；iOS 不支持全屏时提前给出可执行的替代路径。 */
  private decorateBoot(): void {
    const go = document.getElementById('boot-go');
    if (!go || !this.touchLike) return;
    go.textContent = this.standalone ? '点击开始' :
      this.supported ? '点击开始 · 自动全屏' : '点击开始 · 建议横屏';
    if (!this.supported && !this.standalone) {
      const note = document.createElement('div');
      note.className = 'boot-fs-note';
      note.textContent = 'iPhone Safari：分享 → 添加到主屏幕，从主屏图标打开才能全屏';
      go.insertAdjacentElement('afterend', note);
    }
  }

  probe(): ScreenProbe {
    return {
      supported: this.supported,
      active: this.active(),
      autoRequested: this.autoRequested,
      attempts: this.attempts,
      lastError: this.lastError,
      touchLike: this.touchLike,
      standalone: this.standalone,
      landscapeLocked: this.landscapeLocked,
    };
  }
}
