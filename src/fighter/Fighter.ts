import {
  AIR_BUTTON_MOVE, BACK_SPEED, BUTTON_MOVE, GRAVITY, GROUND_FRICTION,
  HURT_AIR, HURT_CROUCH, HURT_STAND, JUMP_VX, JUMP_VY,
  LANDING_STUN, MAX_HP, MAX_METER, MOVES, SUPER_COST, WALK_SPEED, moveDuration,
  type HitLevel, type MoveDef, type MoveId,
} from '../core/frames';
import type { InputFrame } from '../core/input';
import { clampArena, worldBox, type WorldBox } from '../core/hitbox';
import { isStunned, type FighterState } from '../core/state';

export interface HitEvent {
  attacker: Fighter;
  defender: Fighter;
  move: MoveDef;
  blocked: boolean;
  /** 摆了防御姿势但高度选错（下段没蹲防 / 上段没站防）。 */
  guardBreak: boolean;
  x: number;
  y: number;
}

export type GuardLevel = 'stand' | 'crouch' | null;

/** 防御高度与攻击属性的匹配表：站防挡中/上段，蹲防挡中/下段。 */
export function blockMatches(guard: GuardLevel, level: HitLevel): boolean {
  if (guard === 'stand') return level !== 'low';
  if (guard === 'crouch') return level !== 'overhead';
  return false;
}

/** 一个角色的完整逻辑状态。渲染层只读这里，不反向写入。 */
export class Fighter {
  readonly id: 0 | 1;
  readonly name: string;

  x: number;
  y = 0;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  hp = MAX_HP;
  meter = 0;
  wins = 0;

  state: FighterState = 'idle';
  stateFrame = 0;
  move: MoveDef | null = null;
  moveFrame = 0;
  /** 每次起招递增，配合 hasHit 保证一次出招只结算一次。 */
  hitId = 0;
  hasHit = false;

  guarding = false;
  /** 防御高度：站防挡 mid/overhead，蹲防挡 mid/low；状态仍复用 'guard'。 */
  guardLevel: GuardLevel = null;
  crouching = false;
  airborne = false;
  /** 空中招式落地后的硬直帧数，期间不接受输入。 */
  landingStun = 0;
  stunLeft = 0;
  flash = 0;
  combo = 0;
  comboTimer = 0;
  walkPhase = 0;

  constructor(id: 0 | 1, name: string, x: number) {
    this.id = id;
    this.name = name;
    this.x = x;
  }

  resetForRound(x: number, facing: 1 | -1): void {
    this.x = x;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.hp = MAX_HP;
    this.meter = 0;
    this.state = 'idle';
    this.stateFrame = 0;
    this.move = null;
    this.moveFrame = 0;
    this.hasHit = false;
    this.guarding = false;
    this.guardLevel = null;
    this.crouching = false;
    this.airborne = false;
    this.landingStun = 0;
    this.stunLeft = 0;
    this.flash = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.walkPhase = 0;
  }

  hurtbox(): WorldBox {
    const box = this.airborne ? HURT_AIR : this.crouching ? HURT_CROUCH : HURT_STAND;
    return worldBox(box, this.x, this.y, this.facing);
  }

  /** 仅 attack 状态的 active 窗口生成判定框；命中后立即失效。 */
  activeHitbox(): WorldBox | null {
    if (this.state !== 'attack' || !this.move || this.hasHit) return null;
    const f = this.moveFrame;
    if (f < this.move.startup || f >= this.move.startup + this.move.active) return null;
    return worldBox(this.move.hitbox, this.x, this.y, this.facing);
  }

  update(input: InputFrame): void {
    this.stateFrame++;
    if (this.flash > 0) this.flash--;
    if (this.comboTimer > 0) {
      this.comboTimer--;
      if (this.comboTimer === 0) this.combo = 0;
    }

    if (this.state === 'ko') {
      this.physics();
      return;
    }
    if (this.landingStun > 0) {
      // 空中招式落地：清判定、不接受输入，只保留落地缓冲姿态。
      this.landingStun--;
      this.state = 'idle';
      this.stateFrame = 0;
      this.move = null;
      this.guarding = false;
      this.guardLevel = null;
      this.physics();
      return;
    }
    if (isStunned(this.state)) this.advanceStun();
    else if (this.state === 'attack') this.advanceAttack(input);
    else this.neutral(input);

    this.physics();
  }

  private neutral(input: InputFrame): void {
    this.guarding = false;
    this.guardLevel = null;
    this.crouching = false;

    if (input.buttons.length > 0) {
      this.tryStartMove(input);
      return;
    }

    if (this.airborne) {
      this.state = 'jump';
      return;
    }

    if (input.jump) {
      this.airborne = true;
      this.vy = JUMP_VY;
      this.vx = input.dir * JUMP_VX;
      this.state = 'jump';
      this.stateFrame = 0;
      return;
    }

    // 按住「后方向」= 防御请求；单独按下只蹲不防。
    const back = input.dir !== 0 && input.dir === -this.facing;
    const wantGuard = input.guard || back;

    if (input.down) {
      this.crouching = true;
      if (wantGuard) {
        this.guarding = true;
        this.guardLevel = 'crouch';
        this.state = 'guard';
      } else {
        this.state = 'crouch';
      }
      this.stateFrame = 0;
      return;
    }

    if (wantGuard) {
      this.guarding = true;
      this.guardLevel = 'stand';
      // 站防仍可缓慢后退，保留「按后 = 后退防御」的格斗手感
      if (back) this.x = clampArena(this.x + input.dir * BACK_SPEED * 0.55);
      this.state = 'guard';
      this.stateFrame = 0;
      return;
    }

    if (input.dir !== 0) {
      const forward = input.dir === this.facing;
      this.x = clampArena(this.x + input.dir * (forward ? WALK_SPEED : BACK_SPEED));
      this.walkPhase += forward ? 0.20 : 0.14;
      this.state = 'walk';
      return;
    }
    this.state = 'idle';
  }

  private tryStartMove(input: InputFrame): void {
    // M2 超必杀：236 必须朝向对手、站在地面、POW 足额。
    // 任一条件不满足就回退到普通招式——按键绝不吞掉，POW 也一分不扣。
    if (input.qcf === this.facing && !this.airborne && this.meter >= SUPER_COST) {
      this.meter -= SUPER_COST;
      this.startMove('SUPER');
      return;
    }
    let id: MoveId = BUTTON_MOVE[input.buttons[0]];
    if (this.airborne) {
      // 空中只允许空中招式，避免落地后仍在挥地面判定框
      id = AIR_BUTTON_MOVE[input.buttons[0]];
    } else if (input.down && (id === 'LK' || id === 'HK')) {
      // 蹲姿 + 踢 → 下段扫腿，让 SWEEP 有稳定的触发方式
      id = 'SWEEP';
    }
    this.startMove(id);
  }

  startMove(id: MoveId): void {
    this.move = MOVES[id];
    this.moveFrame = 0;
    this.hasHit = false;
    this.hitId++;
    this.state = 'attack';
    this.stateFrame = 0;
    this.guarding = false;
    this.guardLevel = null;
    if (!this.airborne) this.vx = 0;
  }

  private advanceAttack(input: InputFrame): void {
    this.moveFrame++;
    const m = this.move;
    if (!m) return;

    // 命中后的取消窗口：轻拳可取消为重拳/重踢
    if (this.hasHit && this.moveFrame >= m.startup && input.buttons.length > 0) {
      for (const b of input.buttons) {
        const next = BUTTON_MOVE[b];
        if (m.cancelInto.includes(next)) {
          this.startMove(next);
          return;
        }
      }
    }

    if (this.moveFrame >= moveDuration(m)) {
      this.move = null;
      this.state = this.airborne ? 'jump' : 'idle';
      this.stateFrame = 0;
    }
  }

  private advanceStun(): void {
    this.stunLeft--;
    if (this.stunLeft <= 0) {
      this.state = this.airborne ? 'jump' : 'idle';
      this.stateFrame = 0;
      this.guarding = false;
      this.guardLevel = null;
    }
  }

  private physics(): void {
    if (this.airborne) {
      this.vy += GRAVITY;
      this.y += this.vy;
      this.x = clampArena(this.x + this.vx);
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.vx = 0;
        this.airborne = false;
        if (this.state === 'jump') this.state = 'idle';
        if (this.state === 'attack' && this.move?.air) {
          // 空中招式落地即刻取消：不留 residual hitbox，也不允许落地连打
          this.move = null;
          this.hasHit = false;
          this.state = 'idle';
          this.stateFrame = 0;
          this.landingStun = LANDING_STUN;
        }
      }
    } else if (Math.abs(this.vx) > 0.0005) {
      this.x = clampArena(this.x + this.vx);
      this.vx *= GROUND_FRICTION;
    } else {
      this.vx = 0;
    }
  }

  receiveHit(m: MoveDef, attacker: Fighter, hitX: number, hitY: number): HitEvent {
    const inGuard = this.guarding && !this.airborne && this.state !== 'attack';
    const blocked = inGuard && blockMatches(this.guardLevel, m.level);
    const guardBreak = inGuard && !blocked;
    const damage = blocked ? Math.max(1, Math.round(m.damage * 0.12)) : m.damage;
    this.hp = Math.max(0, this.hp - damage);
    this.flash = blocked ? 0 : 6;
    this.vx = attacker.facing * m.pushback;

    if (this.hp === 0) {
      this.state = 'ko';
      this.stunLeft = 0;
    } else if (blocked) {
      this.state = 'blockstun';
      this.stunLeft = m.blockstun;
      this.meter = Math.min(MAX_METER, this.meter + 3);
    } else {
      this.state = m.knockdown ? 'knockdown' : 'hitstun';
      this.stunLeft = m.hitstun;
      this.meter = Math.min(MAX_METER, this.meter + 2);
    }
    this.stateFrame = 0;

    attacker.hasHit = true;
    attacker.meter = Math.min(MAX_METER, attacker.meter + m.meterGain);

    if (!blocked) {
      attacker.combo = attacker.comboTimer > 0 ? attacker.combo + 1 : 1;
      attacker.comboTimer = m.hitstun + 18;
    } else {
      attacker.combo = 0;
      attacker.comboTimer = 0;
    }

    return { attacker, defender: this, move: m, blocked, guardBreak, x: hitX, y: hitY };
  }
}
