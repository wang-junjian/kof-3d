/** 固定 60Hz 逻辑步进 + 渲染插值。帧数据的可复现性依赖这里，不能用 rAF 的 delta 当逻辑时间。 */
export class FixedLoop {
  readonly stepMs = 1000 / 60;
  /** 逻辑步/秒：固定步进的目标值 60，掉帧时靠一帧多步补上。 */
  fps = 60;
  /** 渲染帧/秒：真实 rAF 次数。掉帧时这个数会掉，fps 却仍可能是 60，两者必须分开看。 */
  renderFps = 60;
  private acc = 0;
  private prev = 0;
  private rafId = 0;
  private running = false;
  private hidden = false;
  private countedSteps = 0;
  private countedFrames = 0;
  private countedAt = 0;

  constructor(
    private readonly onStep: () => void,
    private readonly onRender: (alpha: number, dtMs: number) => void,
  ) {}

  /** 统一的时间/统计基准：start() 与「从后台恢复」共用，关键是 acc 归零。 */
  private resetTiming(now: number): void {
    this.prev = now;
    this.acc = 0;
    this.countedAt = now;
    this.countedSteps = 0;
    this.countedFrames = 0;
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      this.hidden = true;
    } else {
      this.hidden = false;
      // 后台积压的时间一律丢弃：格斗逻辑不该在切回时快进补步，
      // 统计窗口也重新起算，避免 span 含后台时长把 fps/renderFps 稀释成 0。
      this.resetTiming(performance.now());
    }
  };
  private readonly onPageHide = (): void => { this.hidden = true; };
  private readonly onPageShow = (): void => {
    this.hidden = false;
    this.resetTiming(performance.now());
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resetTiming(performance.now());
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);
    // 后台偶发 rAF 也不能累积 acc，否则切回第一帧仍会一次性补步
    if (this.hidden) { this.prev = now; return; }

    let dt = now - this.prev;
    this.prev = now;
    if (dt > 250) dt = 250;
    this.acc += dt;

    let steps = 0;
    while (this.acc >= this.stepMs && steps < 5) {
      this.onStep();
      this.acc -= this.stepMs;
      steps++;
      this.countedSteps++;
    }
    if (steps === 5) this.acc = 0;
    this.countedFrames++;

    if (now - this.countedAt >= 1000) {
      const span = now - this.countedAt;
      this.fps = Math.round((this.countedSteps * 1000) / span);
      this.renderFps = Math.round((this.countedFrames * 1000) / span);
      this.countedSteps = 0;
      this.countedFrames = 0;
      this.countedAt = now;
    }
    this.onRender(this.acc / this.stepMs, dt);
  };
}
