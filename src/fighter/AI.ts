import { type ButtonId } from '../core/frames';
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
}

const PROFILES: Record<Difficulty, AIProfile> = {
  easy: { aggression: 0.42, guardChance: 0.18, cooldownMin: 34, cooldownMax: 60, guardRead: 0.45 },
  normal: { aggression: 0.62, guardChance: 0.42, cooldownMin: 24, cooldownMax: 50, guardRead: 0.75 },
  hard: { aggression: 0.82, guardChance: 0.68, cooldownMin: 16, cooldownMax: 34, guardRead: 0.96 },
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
    if (self.state === 'ko' || isStunned(self.state) || self.state === 'attack') {
      if (this.guardHold > 0) this.guardHold--;
      return IDLE;
    }
    if (this.cooldown > 0) this.cooldown--;

    const dist = Math.abs(foe.x - self.x);
    const toward = self.facing;
    const p = this.profile;

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

    // 滞空：hard 会用一次跳跃攻击制造上段破蹲防的二择
    if (self.airborne) {
      // 每次起跳最多补一次空中攻击，落地时清零
      if (this.difficulty === 'hard' && !this.airAttackUsed && dist < 1.8 && this.rnd() < 0.35) {
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
      if (dist > 2.4 && this.rnd() < 0.012 && this.cooldown === 0) {
        this.cooldown = 40;
        return { dir: toward, jump: true, down: false, guard: false, buttons: [] };
      }
      return { dir: toward, jump: false, down: false, guard: false, buttons: [] };
    }

    // 近距离：偶尔拉开距离，其余按冷却出招
    if (this.cooldown > 0) {
      const retreat = (this.rnd() < 0.18 ? -toward : 0) as -1 | 0 | 1;
      return { dir: retreat, jump: false, down: false, guard: false, buttons: [] };
    }

    if (this.rnd() > p.aggression) {
      this.cooldown = 18 + Math.floor(this.rnd() * 16);
      return { dir: -toward as -1 | 1, jump: false, down: false, guard: false, buttons: [] };
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
