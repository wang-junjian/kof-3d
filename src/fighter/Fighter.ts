import {
  BACK_SPEED, BUTTON_MOVE, GRAVITY, GROUND_FRICTION,
  GUARD_CRUSH_LIMIT, EVADE_FRAMES, EVADE_INVULN, EVADE_SPEED,
  HURT_AIR, HURT_CROUCH, HURT_STAND, JUMP_VX, JUMP_VY,
  LANDING_STUN, MAX_DAMAGE_SCALE, MAX_DURATION, MAX_COST, MAX_HP, MAX_METER,
  MOVES, SUPER_COST, WALK_SPEED, moveDuration,
  type Box, type HitLevel, type MoveDef, type MoveId,
} from '../core/frames';
import { LEGACY_CHAR, type CharacterDef } from '../core/characters';
import type { InputFrame } from '../core/input';
import { clampArena, worldBox, type WorldBox } from '../core/hitbox';
import { isStunned, type FighterState } from '../core/state';

export interface HitEvent {
  attacker: Fighter;
  defender: Fighter;
  /** 多段招式传入的是「当前段覆盖过伤害/顿帧」的 MoveDef，id 仍是原招式。 */
  move: MoveDef;
  blocked: boolean;
  /** 摆了防御姿势但高度选错 / 投技不可防 / 防御崩溃。 */
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
  /** 角色定义：中文名、按键表、指令表、取消图与动作风格都从这里取。 */
  readonly char: CharacterDef;
  /** 对手引用，仅供近身技（指令投）做距离判定；纯逻辑单测可不设。 */
  foe: Fighter | null = null;

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
  /** 多段招式已结算的段号（HitWindow.frame），防止同一段重复命中。 */
  readonly hitFrames = new Set<number>();

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

  /** M3：MAX 爆气剩余帧、紧急回避剩余帧、无敌帧、连续格挡压力。 */
  maxTimer = 0;
  evadeTimer = 0;
  invuln = 0;
  guardStress = 0;

  /**
   * 兼容旧签名 `new Fighter(0, 'RIN', x)`：传字符串时用中性角色定义，
   * 行为与 M2 完全一致（commands/specials 为空、superMove = 'SUPER'）。
   */
  constructor(id: 0 | 1, char: CharacterDef | string, x: number) {
    this.id = id;
    this.char = typeof char === 'string' ? LEGACY_CHAR : char;
    this.name = typeof char === 'string' ? char : char.name;
    this.x = x;
  }

  get damageScale(): number {
    return this.maxTimer > 0 ? MAX_DAMAGE_SCALE : 1;
  }

  get isMax(): boolean {
    return this.maxTimer > 0;
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
    this.hitFrames.clear();
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
    this.maxTimer = 0;
    this.evadeTimer = 0;
    this.invuln = 0;
    this.guardStress = 0;
  }

  hurtbox(): WorldBox {
    const box = this.airborne ? HURT_AIR : this.crouching ? HURT_CROUCH : HURT_STAND;
    return worldBox(box, this.x, this.y, this.facing);
  }

  /**
   * 本帧实际生效的判定。多段招式按 HitWindow.frame 逐段产出，并把伤害/
   * 顿帧/硬直覆盖到一份新的 MoveDef 上（id 不变，HUD 演出仍认得原招式）。
   * hitIndex = -1 表示单段招式，沿用 hasHit 做「一次出招只结算一次」。
   */
  currentHit(): { move: MoveDef; box: Box; hitIndex: number } | null {
    if (this.state !== 'attack' || !this.move) return null;
    const m = this.move;
    const f = this.moveFrame;
    if (m.hits) {
      for (const h of m.hits) {
        if (h.frame !== f || this.hitFrames.has(h.frame)) continue;
        return {
          move: {
            ...m,
            damage: h.damage,
            hitstop: h.hitstop ?? m.hitstop,
            hitstun: h.hitstun ?? m.hitstun,
            knockdown: h.knockdown ?? m.knockdown,
            meterGain: m.meterGain / m.hits.length,
          },
          box: h.box,
          hitIndex: h.frame,
        };
      }
      return null;
    }
    if (this.hasHit || f < m.startup || f >= m.startup + m.active) return null;
    return { move: m, box: m.hitbox, hitIndex: -1 };
  }

  /** 仅 attack 状态的 active 窗口生成判定框；命中后立即失效。 */
  activeHitbox(): WorldBox | null {
    const hit = this.currentHit();
    return hit ? worldBox(hit.box, this.x, this.y, this.facing) : null;
  }

  /** 由 Match 在结算后调用：多段只标记本段，不阻断后续段。 */
  markHit(index: number): void {
    if (index >= 0) this.hitFrames.add(index);
    this.hasHit = true;
  }

  update(input: InputFrame): void {
    this.stateFrame++;
    if (this.flash > 0) this.flash--;
    if (this.maxTimer > 0) this.maxTimer--;
    if (this.invuln > 0) this.invuln--;
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
    // MAX 爆气：同一帧按下 LP + HP，消耗半槽、8 秒内攻击力 1.5 倍。
    if (input.max && !this.airborne && this.maxTimer === 0 && this.meter >= MAX_COST) {
      this.meter -= MAX_COST;
      this.maxTimer = MAX_DURATION;
      this.state = 'idle';
      this.stateFrame = 0;
      return;
    }
    // 紧急回避：后方向 + LP + HK 同按，前 10 帧无敌。
    if (input.evade && !this.airborne && this.evadeTimer === 0 &&
        input.dir !== 0 && input.dir === -this.facing) {
      this.evadeTimer = EVADE_FRAMES;
      this.invuln = EVADE_INVULN;
      this.vx = -this.facing * EVADE_SPEED * 3;
      this.state = 'walk';
      this.stateFrame = 0;
      return;
    }
    if (this.evadeTimer > 0) {
      this.evadeTimer--;
      this.state = 'walk';
      this.walkPhase += 0.5;
      return;
    }

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
      // 前跳更高更远，原地跳更短：用同一套输入做出小/大跳的差别。
      const long = input.dir === this.facing;
      this.vy = JUMP_VY * (long ? 1.16 : 0.86);
      this.vx = input.dir * JUMP_VX * (long ? 1.25 : 0.85);
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

  /** 起招资格：角色归属、空地限制、POW 消耗、近身距离。 */
  private canStart(m: MoveDef): boolean {
    if (m.owner && m.owner !== this.char.id) return false;
    if (this.airborne !== (m.air === true)) return false;
    if ((m.cost ?? 0) > this.meter) return false;
    if (m.closeRange !== undefined && this.foe &&
        Math.abs(this.foe.x - this.x) > m.closeRange) return false;
    return true;
  }

  private tryStartMove(input: InputFrame): void {
    // 1) 通用指令：COMMANDS 已按长度降序，超杀优先于普通必杀。
    for (const cmd of input.commands ?? []) {
      const id = this.char.commands[cmd];
      if (!id) continue;
      if (!this.canStart(MOVES[id])) continue;
      this.startMove(id);
      return;
    }

    // 2) 旧 236 兼容链路：AI 显式 qcf、触屏一键宏、纯逻辑单测都走这里。
    const legacyId = this.char.superMove;
    const legacyMove = MOVES[legacyId];
    if (input.qcf === this.facing && !this.airborne &&
        this.meter >= (legacyMove.cost ?? SUPER_COST) && this.canStart(legacyMove)) {
      this.startMove(legacyId);
      return;
    }

    // 3) 特殊技：把方向归约成相对 facing 的数字方位（6 前 / 3 下前 / 4 后 / 1 下后）。
    const rel = input.dir === 0 ? 5 : (input.dir === this.facing ? 6 : 4);
    const notation = input.down ? (rel === 6 ? 3 : rel === 4 ? 1 : 2) : rel;
    for (const b of input.buttons) {
      for (const sp of this.char.specials) {
        if (sp.button !== b || sp.dir !== notation) continue;
        if (!this.canStart(MOVES[sp.move])) continue;
        this.startMove(sp.move);
        return;
      }
    }

    // 4) 普通按键（含空中映射与蹲 + 踢 → 扫腿）。
    const b = input.buttons[0];
    let id: MoveId = this.airborne ? this.char.airButtons[b] : this.char.buttons[b];
    if (!this.airborne && input.down && (id === 'LK' || id === 'HK')) id = 'SWEEP';
    this.startMove(id);
  }

  startMove(id: MoveId): void {
    const m = MOVES[id];
    this.meter = Math.max(0, this.meter - (m.cost ?? 0));
    this.move = m;
    this.moveFrame = 0;
    this.hasHit = false;
    this.hitFrames.clear();
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

    // 派生「追加输入」：窗口内按指定键切到后续招式，不要求命中，
    // 对应 KOF 的荒咬→九伤→八锖、岚之山→续·切株返这类多拍结构。
    if (m.branchInto) {
      const [lo, hi] = m.branchWindow ?? [m.startup, moveDuration(m)];
      if (this.moveFrame >= lo && this.moveFrame < hi) {
        for (const b of input.buttons) {
          const next = m.branchInto[b];
          if (next) {
            this.startMove(next);
            return;
          }
        }
      }
    }

    // 取消图：指令取消优先（通常技 → 必杀 / 超杀），其次按键取消。
    const cancels = this.char.cancels[m.id] ?? m.cancelInto;
    if (cancels.length > 0 && this.hasHit && this.moveFrame >= m.startup) {
      for (const cmd of input.commands ?? []) {
        const id = this.char.commands[cmd];
        if (!id || !cancels.includes(id)) continue;
        if (!this.canStart(MOVES[id])) continue;
        this.startMove(id);
        return;
      }
      for (const b of input.buttons) {
        const next = BUTTON_MOVE[b];
        if (!cancels.includes(next)) continue;
        if (!this.canStart(MOVES[next])) continue;
        this.startMove(next);
        return;
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
    // 防御破坏：连续挡满 GUARD_CRUSH_LIMIT 次后强制破防；投技永远不可防。
    const crushed = inGuard && this.guardStress >= GUARD_CRUSH_LIMIT;
    const blocked = inGuard && !crushed && !m.unblockable && blockMatches(this.guardLevel, m.level);
    const guardBreak = inGuard && !blocked;
    const damage = blocked
      ? Math.max(1, Math.round(m.damage * 0.12))
      : Math.round(m.damage * attacker.damageScale);
    this.hp = Math.max(0, this.hp - damage);
    this.flash = blocked ? 0 : 6;
    this.vx = attacker.facing * m.pushback;
    this.guardStress = blocked ? this.guardStress + 1 : 0;

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

    // 破防 / 被命中后必须交出防御姿态。inGuard 只看 guarding，不看状态，
    // 所以留在硬直里的 guarding 会让下一记追击被自动挡下——摆错姿势反而比
    // 不防御更安全，整套 guardLevel 设计就失效了。crouching 也要清：
    // hurtbox() 直接读它，蹲盒残留会让站着的角色躲过所有上段攻击。
    // blocked 分支不清：blockstun 期间松手仍继续挡，是刻意保留的手感。
    if (!blocked) {
      this.guarding = false;
      this.guardLevel = null;
      this.crouching = false;
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
