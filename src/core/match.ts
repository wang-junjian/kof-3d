import { ROUND_SECONDS, type ButtonId } from './frames';
import { EMPTY_INPUT, QCF_WINDOW, detectQcf, type InputFrame } from './input';
import { boxCenterX, boxCenterY, clampArena, overlaps, separate } from './hitbox';
import type { AIController } from '../fighter/AI';
import { Fighter, type HitEvent } from '../fighter/Fighter';

export type MatchPhase = 'intro' | 'fight' | 'roundOver' | 'matchOver';

export interface MatchCallbacks {
  onHit(e: HitEvent): void;
  onRoundStart(round: number): void;
  onRoundEnd(winner: 0 | 1 | null, reason: 'ko' | 'time'): void;
  onMatchEnd(winner: 0 | 1): void;
  onAnnounce(text: string): void;
  onReset(): void;
}

/** 回合流程、命中结算与 Hitstop 冻结。渲染层通过回调拿事件，不参与判定。 */
export class Match {
  readonly p1: Fighter;
  readonly p2: Fighter;

  phase: MatchPhase = 'intro';
  round = 1;
  winner: 0 | 1 | null = null;
  timerFrames = ROUND_SECONDS * 60;
  hitstop = 0;
  frame = 0;
  private phaseFrames = 0;
  /** 顿帧期间玩家按下的攻击键不丢失，解冻后合并进下一逻辑帧（早按的排在前面）。 */
  private readonly buffered: ButtonId[] = [];
  /** 236 指令的输入历史（含顿帧——顿帧里摇的指令必须算数），长度上限 QCF_WINDOW。 */
  private readonly inputHistory: InputFrame[] = [];
  /** 顿帧期间识别出的 236：解冻后随第一个逻辑帧一起交给状态机。 */
  private pendingQcf: 1 | -1 | null = null;

  constructor(
    private readonly ai: AIController,
    private readonly cb: MatchCallbacks,
  ) {
    this.p1 = new Fighter(0, 'RIN', -1.5);
    this.p2 = new Fighter(1, 'FEI', 1.5);
    this.beginRound(1);
  }

  get timeLeft(): number {
    return Math.max(0, Math.ceil(this.timerFrames / 60));
  }

  get fighters(): [Fighter, Fighter] {
    return [this.p1, this.p2];
  }

  restart(): void {
    this.p1.wins = 0;
    this.p2.wins = 0;
    this.winner = null;
    this.cb.onReset();
    this.beginRound(1);
  }

  private beginRound(n: number): void {
    this.round = n;
    // 竖屏场地比默认站位窄，开局就按当前边界收拢，避免第一帧两人站在画外。
    this.p1.resetForRound(clampArena(-1.5), 1);
    this.p2.resetForRound(clampArena(1.5), -1);
    this.ai.reset();
    this.timerFrames = ROUND_SECONDS * 60;
    this.hitstop = 0;
    this.phaseFrames = 0;
    this.inputHistory.length = 0; // 摇杆指令不跨回合残留
    this.buffered.length = 0;     // 上一回合顿帧里按下的键也不该在新回合开局生效
    this.pendingQcf = null;
    this.phase = 'intro';
    this.cb.onRoundStart(n);
  }

  /**
   * 每个固定逻辑帧调用一次。Hitstop 期间整个逻辑冻结，但渲染与特效继续。
   * 返回「本帧是否被顿帧冻结」，让渲染层用 step 的实际结果判定视觉时间，
   * 而不是在调用前读 hitstop（step 内部会递减，读前状态会有一帧歧义）。
   */
  step(playerInput: InputFrame): boolean {
    this.frame++;
    if (this.hitstop > 0) {
      this.hitstop--;
      this.buffered.push(...playerInput.buttons);
      // 顿帧里也要采样方向：玩家在命中停顿中摇完的 236 不能丢，
      // 否则「打中后接必杀」这条最基本的连段永远做不出来。
      const frozen = this.track(playerInput);
      if (frozen) this.pendingQcf = frozen;
      return true;
    }
    const input: InputFrame = this.buffered.length > 0
      ? { ...playerInput, buttons: [...this.buffered, ...playerInput.buttons] }
      : playerInput;
    if (this.buffered.length > 0) this.buffered.length = 0;
    this.phaseFrames++;

    if (this.phase === 'intro') {
      if (this.phaseFrames === 1) this.cb.onAnnounce(`ROUND ${this.round}`);
      else if (this.phaseFrames === 70) this.cb.onAnnounce('FIGHT');
      else if (this.phaseFrames >= 104) {
        this.phase = 'fight';
        this.phaseFrames = 0;
        this.cb.onAnnounce('');
      }
      return false;
    }

    if (this.phase === 'roundOver') {
      this.advanceKo();
      if (this.phaseFrames >= 150) this.beginRound(this.round + 1);
      return false;
    }

    if (this.phase === 'matchOver') {
      this.advanceKo();
      if (this.phaseFrames > 60 && input.buttons.length > 0) this.restart();
      return false;
    }

    const aiInput = this.ai.decide(this.p2, this.p1);
    this.updateFacing();
    // 236 指令只在这里识别：intro / roundOver / matchOver 的帧不进输入历史，
    // 避免跨阶段残留误触发。detectQcf 产出绝对方向，facing 比对在 Fighter 里做。
    const qcf = this.pendingQcf ?? this.track(input);
    this.pendingQcf = null;
    const command: InputFrame = qcf ? { ...input, qcf } : input;
    this.p1.update(command);
    this.p2.update(aiInput);
    this.resolvePush();
    this.resolveHits();
    this.timerFrames--;

    if (this.p1.hp === 0 || this.p2.hp === 0 || this.timerFrames <= 0) {
      this.endRound();
    }
    return false;
  }

  /**
   * 把一帧输入记入 236 历史，并返回该帧自身识别出的指令（历史不含本帧）。
   * 顿帧与逻辑帧共用同一条判定链，手摇、触屏宏、AI 显式输入都走这里。
   */
  private track(frame: InputFrame): 1 | -1 | null {
    const qcf = detectQcf(this.inputHistory, frame);
    this.inputHistory.push(frame);
    if (this.inputHistory.length > QCF_WINDOW) this.inputHistory.shift();
    return qcf;
  }

  /**
   * 回合结束后只推进 KO 角色的表现层时间：stateFrame 继续增长，倒地姿态才能
   * 播到 POSES.ko。用空输入喂养，update 会停在 'ko' 分支——不行动、不接受操作，
   * 只跑物理让击退滑行收尾。
   */
  private advanceKo(): void {
    for (const f of this.fighters) {
      if (f.state === 'ko') f.update(EMPTY_INPUT);
    }
  }

  private updateFacing(): void {
    if (this.p1.x <= this.p2.x) {
      this.p1.facing = 1;
      this.p2.facing = -1;
    } else {
      this.p1.facing = -1;
      this.p2.facing = 1;
    }
  }

  private resolvePush(): void {
    // 视口变窄（旋转 / 全屏切换 / 地址栏收起）时，已在场外的角色下一帧
    // 就被拉回新边界；setPose 之类调试钩子直接写 x 也能被收拢。
    const [a, b] = separate(clampArena(this.p1.x), clampArena(this.p2.x));
    this.p1.x = a;
    this.p2.x = b;
  }

  private resolveHits(): void {
    const pairs: [Fighter, Fighter][] = [
      [this.p1, this.p2],
      [this.p2, this.p1],
    ];
    for (const [atk, def] of pairs) {
      const hb = atk.activeHitbox();
      if (!hb || !atk.move) continue;
      const hurt = def.hurtbox();
      if (!overlaps(hb, hurt)) continue;
      const hx = boxCenterX(hb, hurt);
      const hy = boxCenterY(hb, hurt);
      const ev = def.receiveHit(atk.move, atk, hx, hy);
      this.hitstop = ev.blocked
        ? Math.max(2, Math.floor(ev.move.hitstop / 2))
        : ev.move.hitstop;
      this.cb.onHit(ev);
    }

    // 受击会立刻切到 hitstun / blockstun / ko，此时被打断的旧招式已不成立。
    // 在「全部配对结算完之后」统一清理，保持原有先手结算顺序不变，
    // 同时让 snapshot().move 不再残留上一招（状态机与展示一致）。
    for (const f of [this.p1, this.p2]) {
      if (f.state !== 'attack' && f.move) {
        f.move = null;
        f.moveFrame = 0;
        f.hasHit = false;
      }
    }
  }

  private endRound(): void {
    const reason: 'ko' | 'time' = this.p1.hp === 0 || this.p2.hp === 0 ? 'ko' : 'time';
    let winner: 0 | 1 | null;
    if (this.p1.hp === this.p2.hp) winner = null;
    else winner = this.p1.hp > this.p2.hp ? 0 : 1;
    if (winner !== null) this.fighters[winner].wins++;

    const finished = (winner !== null && this.fighters[winner].wins >= 2) || this.round >= 3;
    this.phase = finished ? 'matchOver' : 'roundOver';
    this.phaseFrames = 0;
    this.cb.onAnnounce(reason === 'ko' ? 'K.O.' : 'TIME UP');
    this.cb.onRoundEnd(winner, reason);

    if (finished) {
      let champ: 0 | 1;
      if (winner !== null) champ = winner;
      else champ = this.p1.wins >= this.p2.wins ? 0 : 1;
      this.winner = champ;
      this.cb.onMatchEnd(champ);
    }
  }
}
