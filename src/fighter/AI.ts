import {
  MAX_COST, SUPER_COST, moveDuration,
  type ButtonId, type CommandId,
} from '../core/frames';
import type { InputFrame } from '../core/input';
import { isStunned } from '../core/state';
import type { Fighter } from './Fighter';

const IDLE: InputFrame = { dir: 0, jump: false, down: false, guard: false, buttons: [] };
const act = (patch: Partial<InputFrame>): InputFrame => ({ ...IDLE, ...patch });

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface AIProfile {
  aggression: number;
  guardChance: number;
  cooldownMin: number;
  cooldownMax: number;
  /** 按来袭攻击高度选对站防/蹲防的概率。 */
  guardRead: number;
  /** POW 达标时，把一次普通出招升级为 236 超必杀的概率。 */
  superChance: number;
  /** 近距离主动跳入的概率（每次出招窗口）。 */
  jumpChance: number;
  /** 滞空期间补一次空中攻击的概率。 */
  airChance: number;
  /** 轻拳命中后取消成重拳/重踢的概率。 */
  cancelChance: number;
  /** M3：发指令必杀（214 / 623 / 41236）的概率。 */
  commandChance: number;
  /** M3：派生链窗口内按追加输入的概率。 */
  branchChance: number;
  /** M3：POW 达标时爆 MAX 的概率。 */
  maxChance: number;
  /** M3：对手出招时紧急回避的概率。 */
  evadeChance: number;
}

const PROFILES: Record<Difficulty, AIProfile> = {
  easy: {
    aggression: 0.42, guardChance: 0.18, cooldownMin: 30, cooldownMax: 52, guardRead: 0.45,
    superChance: 0.12, jumpChance: 0.010, airChance: 0, cancelChance: 0,
    commandChance: 0.08, branchChance: 0, maxChance: 0, evadeChance: 0,
  },
  normal: {
    aggression: 0.62, guardChance: 0.42, cooldownMin: 22, cooldownMax: 44, guardRead: 0.75,
    superChance: 0.32, jumpChance: 0.055, airChance: 0.55, cancelChance: 0.45,
    commandChance: 0.30, branchChance: 0.45, maxChance: 0.12, evadeChance: 0.10,
  },
  hard: {
    aggression: 0.82, guardChance: 0.68, cooldownMin: 14, cooldownMax: 30, guardRead: 0.96,
    superChance: 0.58, jumpChance: 0.075, airChance: 0.70, cancelChance: 0.80,
    commandChance: 0.50, branchChance: 0.75, maxChance: 0.25, evadeChance: 0.18,
  },
};

/** 带冷却的权重规则对手：距离分档 → 接近 / 后退 / 防御 / 出招 / 连段。固定种子便于复现。 */
export class AIController {
  private cooldown = 30;
  private guardHold = 0;
  private guardStance: 'stand' | 'crouch' = 'stand';
  private airAttackUsed = false;
  private seed = 20261104;

  constructor(private difficulty: Difficulty = 'normal') {}

  get level(): Difficulty {
    return this.difficulty;
  }

  get profile(): AIProfile {
    return PROFILES[this.difficulty];
  }

  setDifficulty(d: Difficulty): void {
    this.difficulty = d;
  }

  reset(): void {
    this.cooldown = 30;
    this.guardHold = 0;
    this.airAttackUsed = false;
    this.seed = 20261104;
    // 难度由玩家选择，不随回合重置
  }

  private rnd(): number {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }

  /** 下段必须蹲防、上段/跳攻必须站防；中段两种姿势都可以，随机挑一种。 */
  private pickGuardStance(foe: Fighter): 'stand' | 'crouch' {
    const level = foe.move?.level ?? 'mid';
    const needed: 'stand' | 'crouch' = foe.airborne || level === 'overhead'
      ? 'stand'
      : level === 'low' ? 'crouch' : (this.rnd() < 0.5 ? 'stand' : 'crouch');
    if (this.rnd() < this.profile.guardRead) return needed;
    return needed === 'stand' ? 'crouch' : 'stand';
  }

  /** 从角色指令表里挑一个当前条件下能放出的指令必杀。 */
  private pickCommand(self: Fighter, dist: number, includeSuper: boolean): CommandId | null {
    const entries = Object.entries(self.char?.commands ?? {}) as [CommandId, string][];
    const usable = entries.filter(([cmd, id]) => {
      if (!includeSuper && cmd === '236236') return false;
      if (cmd === '236236' && self.meter < SUPER_COST) return false;
      if (cmd === '41236' && dist > 1.05) return false;
      return Boolean(id);
    });
    if (!usable.length) return null;
    return usable[Math.floor(this.rnd() * usable.length)][0];
  }

  decide(self: Fighter, foe: Fighter): InputFrame {
    const p = this.profile;
    if (self.state === 'ko' || isStunned(self.state)) {
      if (this.guardHold > 0) this.guardHold--;
      return IDLE;
    }

    const dist = Math.abs(foe.x - self.x);
    const toward = self.facing;

    // 出招中：派生「追加输入」优先，其次命中取消（可取消成指令必杀）。
    if (self.state === 'attack') {
      const m = self.move;
      if (!m) return IDLE;
      const [lo, hi] = m.branchWindow ?? [m.startup, moveDuration(m)];
      if (m.branchInto && self.moveFrame >= lo && self.moveFrame < hi &&
          this.rnd() < p.branchChance) {
        const keys = Object.keys(m.branchInto) as ButtonId[];
        if (keys.length) {
          return act({ buttons: [keys[Math.floor(this.rnd() * keys.length)]] });
        }
      }
      const commands = self.char?.commands ?? {};
      const cancels = self.char?.cancels?.[m.id] ?? m.cancelInto;
      if (self.hasHit && cancels.length > 0 && self.moveFrame >= m.startup &&
          this.rnd() < p.cancelChance) {
        const cmd = (Object.keys(commands) as CommandId[]).find((c) => {
          const id = commands[c];
          return id !== undefined && cancels.includes(id);
        });
        if (cmd && this.rnd() < 0.5) return act({ buttons: ['HP'], commands: [cmd] });
        return act({ buttons: [this.rnd() < 0.5 ? 'HP' : 'HK'] });
      }
      return IDLE;
    }

    if (this.cooldown > 0) this.cooldown--;

    // 紧急回避：对手出招且贴身、冷却已好时按难度概率用无敌帧躲开。
    // 必须挂在 cooldown 上：若逐帧掷骰，10 帧的起招窗口里几乎必中一次，
    // 无敌帧覆盖率会过半，玩家打不出连段、确定性探针也会被整场躲光。
    if (foe.state === 'attack' && dist < 1.35 && self.invuln === 0 &&
        self.evadeTimer === 0 && this.cooldown === 0 && this.rnd() < p.evadeChance) {
      this.cooldown = 40;
      return act({ dir: -toward as -1 | 1, evade: true });
    }

    // 对手正在出招且距离够近 → 按来袭高度选防御姿势
    if (this.guardHold === 0 && foe.state === 'attack' && dist < 1.35 && this.rnd() < p.guardChance) {
      this.guardHold = 16 + Math.floor(this.rnd() * 12);
      this.guardStance = this.pickGuardStance(foe);
    }
    if (this.guardHold > 0) {
      this.guardHold--;
      return act({ down: this.guardStance === 'crouch', guard: true });
    }

    // 滞空：normal/hard 补一次空中攻击制造上段破蹲防的二择
    if (self.airborne) {
      if (!this.airAttackUsed && p.airChance > 0 && dist < 1.8 && this.rnd() < p.airChance) {
        this.airAttackUsed = true;
        return act({ buttons: [this.rnd() < 0.5 ? 'LP' : 'HK'] });
      }
      return IDLE;
    }
    this.airAttackUsed = false;

    // MAX 爆气：攒够半槽就按难度概率开，之后所有伤害 1.5 倍。
    if (self.meter >= MAX_COST && !self.isMax && this.rnd() < p.maxChance) {
      return act({ max: true });
    }

    // 远距离：接近为主，偶尔跳跃进场
    if (dist > 1.18) {
      if (dist > 2.4 && this.rnd() < p.jumpChance && this.cooldown === 0) {
        this.cooldown = 40;
        return act({ dir: toward, jump: true });
      }
      return act({ dir: toward });
    }

    // 冷却期间不等于站桩：贴近 / 小幅拉开都让「对方」持续在动。
    if (this.cooldown > 0) {
      const jockey = this.rnd();
      const dir = jockey < 0.55 ? toward : jockey < 0.78 ? (-toward as -1 | 1) : 0;
      return act({ dir });
    }

    // 近距离跳入，落地前由滞空分支补空中攻击
    if (this.rnd() < p.jumpChance) {
      this.cooldown = 30;
      return act({ dir: toward, jump: true });
    }

    if (this.rnd() > p.aggression) {
      this.cooldown = 18 + Math.floor(this.rnd() * 16);
      return act({ dir: -toward as -1 | 1 });
    }

    // POW 达标时升级成 236 超必杀。qcf 是绝对方向，Fighter 会拿 facing 比对，
    // 因此镜像站位也成立；AI 走显式指令，不需要维护 20 帧输入历史。
    if (self.meter >= SUPER_COST && this.rnd() < p.superChance) {
      this.cooldown = p.cooldownMax + 12;
      return act({ dir: toward, buttons: ['HP'], qcf: toward });
    }

    // 指令必杀 / 近身投：直接把指令 id 塞进输入，走与玩家相同角色表。
    if (this.rnd() < p.commandChance) {
      const cmd = this.pickCommand(self, dist, false);
      if (cmd) {
        this.cooldown = p.cooldownMin + 8;
        return act({ dir: toward, buttons: ['HP'], commands: [cmd] });
      }
    }

    const roll = this.rnd();
    let button: ButtonId = 'LP';
    if (roll > 0.86) button = 'HK';
    else if (roll > 0.64) button = 'HP';
    else if (roll > 0.40) button = 'LK';
    const sweep = this.rnd() < 0.12;
    this.cooldown = p.cooldownMin + Math.floor(this.rnd() * (p.cooldownMax - p.cooldownMin));

    // 特殊技：→ + 重拳 / ↘ + 重踢，由方向归约在 Fighter 侧命中角色 specials 表。
    const special = this.rnd() < 0.20;
    if (special) {
      const forward = this.rnd() < 0.6;
      return act({
        dir: toward,
        down: !forward,
        buttons: [forward ? 'HP' : 'HK'],
      });
    }
    return act({ down: sweep, buttons: [sweep ? 'LK' : button] });
  }
}
