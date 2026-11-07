import { ROUND_SECONDS, type ButtonId, type CommandId, type MoveDef } from './frames';
import { characterFor } from './characters';
import {
  EMPTY_INPUT, QCF_WINDOW, detectQcf, detectCommands, toNotation, type InputFrame,
} from './input';
import { boxCenterX, boxCenterY, clampArena, overlaps, separate, worldBox } from './hitbox';
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
  /** M3：相对 facing 的数字方位历史，供通用指令匹配器倒序匹配。 */
  private readonly notationHistory: number[] = [];
  /** 顿帧期间识别出的 236：解冻后随第一个逻辑帧一起交给状态机。 */
  private pendingQcf: 1 | -1 | null = null;
  /** 顿帧期间识别出的通用指令：同样不能丢，否则「打中后接必杀」永远做不出来。 */
  private readonly pendingCommands: CommandId[] = [];

  constructor(
    private readonly ai: AIController,
    private readonly cb: MatchCallbacks,
  ) {
    this.p1 = new Fighter(0, characterFor(0), -1.5);
    this.p2 = new Fighter(1, characterFor(1), 1.5);
    this.p1.foe = this.p2;
    this.p2.foe = this.p1;
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

  /** 清空跨帧输入残留，不重置回合 / 血量 / 胜场。回合切换与浏览器自检共用。 */
  clearTransient(): void {
    this.buffered.length = 0;
    this.inputHistory.length = 0;
    this.notationHistory.length = 0;
    this.pendingQcf = null;
    this.pendingCommands.length = 0;
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
    // 摇杆指令不跨回合残留；上一回合顿帧里按下的键也不该在新回合开局生效。
    this.clearTransient();
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
      if (frozen.qcf) this.pendingQcf = frozen.qcf;
      if (frozen.commands.length) this.pendingCommands.push(...frozen.commands);
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
    // 解冻帧是真实逻辑帧，必须先无条件记入历史（旧 ?? 短路会漏记这一帧），
    // 再取指令值：pendingQcf（顿帧里已识别出的 236）优先，track 的返回值兜底。
    const tracked = this.track(input);
    const qcf = this.pendingQcf ?? tracked.qcf;
    const commands = [...this.pendingCommands, ...tracked.commands];
    this.pendingQcf = null;
    this.pendingCommands.length = 0;
    const command: InputFrame = {
      ...input,
      ...(qcf ? { qcf } : {}),
      ...(commands.length ? { commands } : {}),
    };
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
   * 把一帧输入记入历史，并返回该帧自身识别出的指令（历史不含本帧）。
   * 顿帧与逻辑帧共用同一条判定链，手摇、触屏宏、AI 显式指令都走这里。
   * 通用指令用「相对 facing 的数字方位」匹配，因此镜像站位无需两套定义。
   */
  private track(frame: InputFrame): { qcf: 1 | -1 | null; commands: CommandId[] } {
    const facing = this.p1.facing;
    const qcf = detectQcf(this.inputHistory, frame);
    const commands = frame.commands ?? detectCommands(this.notationHistory, frame, facing);
    this.inputHistory.push(frame);
    if (this.inputHistory.length > QCF_WINDOW) this.inputHistory.shift();
    this.notationHistory.push(toNotation(frame, facing));
    if (this.notationHistory.length > 34) this.notationHistory.shift();
    return { qcf, commands: [...commands] };
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
    // 同一逻辑帧内双方的判定框一律基于「结算前」状态快照：receiveHit 会立刻把
    // 防守方切进 hitstun，若边遍历边结算，第二个配对回读 activeHitbox() 时
    // 攻击者已被打断，整招会被吞掉（同帧互击恒为 p1 先手）。
    // 遍历顺序固定 p1→p2，保证 onHit 派发顺序与回放确定性。
    const pairs: [Fighter, Fighter][] = [
      [this.p1, this.p2],
      [this.p2, this.p1],
    ];
    type Shot = {
      atk: Fighter; def: Fighter; move: MoveDef;
      hitIndex: number; hx: number; hy: number;
    };
    const shots: Shot[] = [];
    for (const [atk, def] of pairs) {
      const hit = atk.currentHit();
      if (!hit) continue;
      const hb = worldBox(hit.box, atk.x, atk.y, atk.facing);
      // 紧急回避的无敌帧直接跳过配对，比在 receiveHit 里回滚状态更干净。
      if (def.invuln > 0) continue;
      const hurt = def.hurtbox();
      if (!overlaps(hb, hurt)) continue;
      shots.push({
        atk, def, move: hit.move, hitIndex: hit.hitIndex,
        hx: boxCenterX(hb, hurt),
        hy: boxCenterY(hb, hurt),
      });
    }

    for (const s of shots) {
      const ev = s.def.receiveHit(s.move, s.atk, s.hx, s.hy);
      s.atk.markHit(s.hitIndex);
      const stop = ev.blocked
        ? Math.max(2, Math.floor(s.move.hitstop / 2))
        : s.move.hitstop;
      // 互击取较长顿帧，消除旧「后者覆盖」的配对顺序依赖。
      this.hitstop = Math.max(this.hitstop, stop);
      this.cb.onHit(ev);
    }

    // 受击会立刻切到 hitstun / blockstun / ko，此时被打断的旧招式已不成立。
    // 在「全部配对结算完之后」统一清理，互击时两招都被打断，语义一致。
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

    // 平局（TIME UP 同血量 / 同帧双 KO）不加胜场、不偏向任一方，也不结束比赛：
    // 复用既有 roundOver → beginRound(round+1) 走加赛。只有分出单局胜负才可能结束。
    const finished = winner !== null
      && (this.fighters[winner].wins >= 2 || this.round >= 3);
    this.phase = finished ? 'matchOver' : 'roundOver';
    this.phaseFrames = 0;
    this.cb.onAnnounce(reason === 'ko' ? 'K.O.' : 'TIME UP');
    this.cb.onRoundEnd(winner, reason);

    // finished 已含 winner !== null，这里显式再判一次让 TS narrow 到 0|1，
    // 彻底移除「平局时按 p1.wins >= p2.wins 默认判 RIN 胜」的兜底偏向。
    if (finished && winner !== null) {
      this.winner = winner;
      this.cb.onMatchEnd(winner);
    }
  }
}
