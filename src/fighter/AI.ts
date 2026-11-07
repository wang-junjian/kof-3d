import { SUPER_COST, type ButtonId } from '../core/frames';
import type { InputFrame } from '../core/input';
import { isStunned } from '../core/state';
import type { Fighter } from './Fighter';

const IDLE: InputFrame = { dir: 0, jump: false, down: false, guard: false, buttons: [] };

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
}

const PROFILES: Record<Difficulty, AIProfile> = {
  easy: {
    aggression: 0.42, guardChance: 0.18, cooldownMin: 30, cooldownMax: 52, guardRead: 0.45,
    superChance: 0.12, jumpChance: 0.010, airChance: 0, cancelChance: 0,
  },
  normal: {
    aggression: 0.62, guardChance: 0.42, cooldownMin: 22, cooldownMax: 44, guardRead: 0.75,
    superChance: 0.32, jumpChance: 0.028, airChance: 0.45, cancelChance: 0.45,
  },
  hard: {
    aggression: 0.82, guardChance: 0.68, cooldownMin: 14, cooldownMax: 30, guardRead: 0.96,
    superChance: 0.58, jumpChance: 0.050, airChance: 0.70, cancelChance: 0.80,
  },
};

/** 带冷却的权重规则对手：距离分档 → 接近 / 后退 / 防御 / 出招。固定种子便于复现。 */
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

  decide(self: Fighter, foe: Fighter): InputFrame {
    const p = this.profile;
    if (self.state === 'ko' || isStunned(self.state)) {
      if (this.guardHold > 0) this.guardHold--;
      return IDLE;
    }

    // 轻拳命中后的取消窗口：发一次后续重招即可。取消成功后 move 换成 HP/HK，
    // cancelInto 为空且 hasHit 被 startMove 清零，条件自然失效，无需额外状态位。
    if (self.state === 'attack') {
      const m = self.move;
      if (m && self.hasHit && m.cancelInto.length > 0 &&
          self.moveFrame >= m.startup && this.rnd() < p.cancelChance) {
        return {
          dir: 0, jump: false, down: false, guard: false,
          buttons: [this.rnd() < 0.5 ? 'HP' : 'HK'],
        };
      }
      return IDLE;
    }

    if (this.cooldown > 0) this.cooldown--;

    const dist = Math.abs(foe.x - self.x);
    const toward = self.facing;

    // 对手正在出招且距离够近 → 按来袭高度选防御姿势
    if (this.guardHold === 0 && foe.state === 'attack' && dist < 1.35 && this.rnd() < p.guardChance) {
      this.guardHold = 16 + Math.floor(this.rnd() * 12);
      this.guardStance = this.pickGuardStance(foe);
    }
    if (this.guardHold > 0) {
      this.guardHold--;
      return {
        dir: 0, jump: false,
        down: this.guardStance === 'crouch', guard: true, buttons: [],
      };
    }

    // 滞空：normal/hard 补一次空中攻击制造上段破蹲防的二择
    if (self.airborne) {
      if (!this.airAttackUsed && p.airChance > 0 && dist < 1.8 && this.rnd() < p.airChance) {
        this.airAttackUsed = true;
        return {
          dir: 0, jump: false, down: false, guard: false,
          buttons: [this.rnd() < 0.5 ? 'LP' : 'HK'],
        };
      }
      return IDLE;
    }
    this.airAttackUsed = false;

    // 远距离：接近为主，偶尔跳跃进场
    if (dist > 1.18) {
      if (dist > 2.4 && this.rnd() < p.jumpChance && this.cooldown === 0) {
        this.cooldown = 40;
        return { dir: toward, jump: true, down: false, guard: false, buttons: [] };
      }
      return { dir: toward, jump: false, down: false, guard: false, buttons: [] };
    }

    // 冷却期间不等于站桩：贴近 / 小幅拉开都让「对方」持续在动，
    // 这是把 idle 帧占比从 42~55% 压下来的关键。
    if (this.cooldown > 0) {
      const jockey = this.rnd();
      const dir = jockey < 0.55 ? toward : jockey < 0.78 ? (-toward as -1 | 1) : 0;
      return { dir, jump: false, down: false, guard: false, buttons: [] };
    }

    // 近距离跳入，落地前由滞空分支补空中攻击
    if (this.rnd() < p.jumpChance) {
      this.cooldown = 30;
      return { dir: toward, jump: true, down: false, guard: false, buttons: [] };
    }

    if (this.rnd() > p.aggression) {
      this.cooldown = 18 + Math.floor(this.rnd() * 16);
      return { dir: -toward as -1 | 1, jump: false, down: false, guard: false, buttons: [] };
    }

    // POW 达标时升级成 236 超必杀。qcf 是绝对方向，Fighter 会拿 facing 比对，
    // 因此镜像站位也成立；AI 走显式指令，不需要维护 20 帧输入历史。
    if (self.meter >= SUPER_COST && this.rnd() < p.superChance) {
      this.cooldown = p.cooldownMax + 12;
      return {
        dir: toward, jump: false, down: false, guard: false,
        buttons: ['HP'], qcf: toward,
      };
    }

    const roll = this.rnd();
    let button: ButtonId = 'LP';
    if (roll > 0.86) button = 'HK';
    else if (roll > 0.64) button = 'HP';
    else if (roll > 0.40) button = 'LK';
    const sweep = this.rnd() < 0.12;
    this.cooldown = p.cooldownMin + Math.floor(this.rnd() * (p.cooldownMax - p.cooldownMin));
    return {
      dir: 0,
      jump: false,
      down: sweep,
      guard: false,
      buttons: [sweep ? 'LK' : button],
    };
  }
}
