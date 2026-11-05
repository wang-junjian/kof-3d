import test from 'node:test';
import assert from 'node:assert/strict';
import { fighter, frames, state } from './.build/logic.mjs';

const { Fighter, blockMatches } = fighter;
const { MOVES, LANDING_STUN, MAX_HP } = frames;
const I = (o = {}) => ({ dir: 0, jump: false, down: false, guard: false, buttons: [], ...o });
const pair = () => [new Fighter(0, 'RIN', -1), new Fighter(1, 'FEI', 1)];

test('状态机分类：中性态可接受输入，受创态不可行动', () => {
  for (const s of ['idle', 'walk', 'jump', 'crouch', 'guard']) assert.equal(state.isNeutral(s), true);
  for (const s of ['hitstun', 'blockstun', 'knockdown']) assert.equal(state.isStunned(s), true);
  assert.equal(state.isNeutral('attack'), false);
  assert.equal(state.isStunned('attack'), false);
  assert.equal(state.isNeutral('ko'), false);
  assert.equal(state.FIGHTER_STATES.length, 10);
});

test('防御匹配表：站防漏下段、蹲防漏上段、中段两头都能挡', () => {
  assert.equal(blockMatches('stand', 'mid'), true);
  assert.equal(blockMatches('stand', 'overhead'), true);
  assert.equal(blockMatches('stand', 'low'), false);
  assert.equal(blockMatches('crouch', 'mid'), true);
  assert.equal(blockMatches('crouch', 'low'), true);
  assert.equal(blockMatches('crouch', 'overhead'), false);
  for (const level of ['mid', 'low', 'overhead']) assert.equal(blockMatches(null, level), false);
});

test('防御输入：后方向站防、后+下蹲防、单按下不防御、AI 显式 guard 生效', () => {
  const f = new Fighter(0, 'RIN', 0);
  f.facing = 1; // 后方向 = -1
  f.update(I({ dir: -1 }));
  assert.equal(f.state, 'guard');
  assert.equal(f.guardLevel, 'stand');
  assert.equal(f.guarding, true);
  assert.equal(f.crouching, false);

  f.update(I({ dir: -1, down: true }));
  assert.equal(f.state, 'guard');
  assert.equal(f.guardLevel, 'crouch');

  f.update(I({ down: true }));
  assert.equal(f.state, 'crouch');
  assert.equal(f.guarding, false);
  assert.equal(f.guardLevel, null);

  f.update(I({ guard: true }));
  assert.equal(f.state, 'guard');
  assert.equal(f.guardLevel, 'stand');

  f.update(I({ dir: 1 }));
  assert.equal(f.state, 'walk');
  assert.equal(f.guarding, false);
});

test('activeHitbox 只在 startup..startup+active-1 生成，且命中后立即失效', () => {
  const f = new Fighter(0, 'RIN', 0);
  f.startMove('HP');
  assert.equal(f.activeHitbox(), null);
  for (let i = 0; i < MOVES.HP.startup; i++) f.update(I());
  assert.equal(f.moveFrame, MOVES.HP.startup);
  assert.ok(f.activeHitbox());
  for (let i = 0; i < MOVES.HP.active; i++) f.update(I());
  assert.equal(f.activeHitbox(), null); // 到 recovery 首帧
  f.hasHit = true;
  assert.equal(f.activeHitbox(), null);
});

test('空中招式落地即刻取消：无残留判定、有落地硬直、硬直中不能起招', () => {
  const f = new Fighter(0, 'RIN', 0);
  f.airborne = true;
  f.y = 0.01;
  f.vy = -0.02;
  f.startMove('JHK');
  f.update(I());
  assert.equal(f.airborne, false);
  assert.equal(f.move, null);
  assert.equal(f.activeHitbox(), null);
  assert.equal(f.landingStun, LANDING_STUN);
  f.update(I({ buttons: ['LP'] }));
  assert.equal(f.move, null);
});

test('receiveHit：站防挡中段、漏下段并标记 GUARD BREAK；蹲防挡下段、漏跳攻', () => {
  const setup = (guardLevel, down = false) => {
    const [atk, def] = pair();
    if (guardLevel) {
      def.state = 'guard';
      def.guarding = true;
      def.guardLevel = guardLevel;
      def.crouching = down;
    }
    return { atk, def };
  };
  let { atk, def } = setup('stand');
  let ev = def.receiveHit(MOVES.HP, atk, 0, 1);
  assert.equal(ev.blocked, true);
  assert.equal(ev.guardBreak, false);
  assert.equal(def.hp, MAX_HP - 1);
  assert.equal(def.state, 'blockstun');
  assert.equal(atk.hasHit, true);
  assert.equal(atk.meter, MOVES.HP.meterGain);

  ({ atk, def } = setup('stand'));
  ev = def.receiveHit(MOVES.SWEEP, atk, 0, 0.3);
  assert.equal(ev.blocked, false);
  assert.equal(ev.guardBreak, true);
  assert.equal(def.hp, MAX_HP - MOVES.SWEEP.damage);
  assert.equal(def.state, 'knockdown');

  ({ atk, def } = setup('crouch', true));
  ev = def.receiveHit(MOVES.SWEEP, atk, 0, 0.3);
  assert.equal(ev.blocked, true);
  assert.equal(ev.guardBreak, false);

  ({ atk, def } = setup('crouch', true));
  ev = def.receiveHit(MOVES.JHK, atk, 0, 1);
  assert.equal(ev.blocked, false);
  assert.equal(ev.guardBreak, true);

  ({ atk, def } = setup('stand'));
  ev = def.receiveHit(MOVES.JHK, atk, 0, 1);
  assert.equal(ev.blocked, true);
});

test('无防御时按全额伤害结算并累计连段；血量归零进入 KO', () => {
  const [atk, def] = pair();
  const a = def.receiveHit(MOVES.LP, atk, 0, 1);
  assert.equal(a.blocked, false);
  assert.equal(a.guardBreak, false);
  assert.equal(atk.combo, 1);
  def.receiveHit(MOVES.LP, atk, 0, 1);
  assert.equal(atk.combo, 2);
  def.hp = 1;
  def.receiveHit(MOVES.LP, atk, 0, 1);
  assert.equal(def.hp, 0);
  assert.equal(def.state, 'ko');
});

test('蹲姿 + 踢键稳定触发下段扫腿；空中同键改走跳跃招式', () => {
  const ground = new Fighter(0, 'RIN', 0);
  ground.update(I({ down: true, buttons: ['HK'] }));
  assert.equal(ground.move.id, 'SWEEP');

  const air = new Fighter(0, 'RIN', 0);
  air.airborne = true;
  air.y = 0.8;
  air.vy = 0.02;
  air.update(I({ buttons: ['HK'] }));
  assert.equal(air.move.id, 'JHK');
});
