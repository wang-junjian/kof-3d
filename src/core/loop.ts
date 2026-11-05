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
  private countedSteps = 0;
  private countedFrames = 0;
  private countedAt = 0;

  constructor(
    private readonly onStep: () => void,
    private readonly onRender: (alpha: number, dtMs: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.prev = performance.now();
    this.countedAt = this.prev;
    this.countedSteps = 0;
    this.countedFrames = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);
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
