import test from 'node:test';
import assert from 'node:assert/strict';
import { fighter, frames, state } from './.build/logic.mjs';

const { Fighter, blockMatches } = fighter;
const { MOVES, LANDING_STUN, MAX_HP, MAX_METER, SUPER_COST, moveDuration } = frames;
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

// ── 连段取消的运行时行为（frames.test.mjs 只覆盖了 cancelInto 的静态表） ──

test('连段取消：轻拳接触后按 HP / HK 立刻改招，并重置帧计数与命中标记', () => {
  for (const button of ['HP', 'HK']) {
    const f = new Fighter(0, 'RIN', 0);
    f.startMove('LP');
    const hitId = f.hitId;
    f.hasHit = true;                      // receiveHit 已结算过一次
    f.moveFrame = MOVES.LP.startup - 1; // 下一帧推进后正好进入取消窗口
    f.update(I({ buttons: [button] }));
    assert.equal(f.move?.id, button, `${button} 未能取消轻拳`);
    assert.equal(f.moveFrame, 0);
    assert.equal(f.hasHit, false);
    assert.equal(f.state, 'attack');
    assert.equal(f.hitId, hitId + 1, '新招式必须换 hitId，才能再次结算命中');
  }
});

test('取消窗口四道闸：未接触、未过 startup、白名单外按键、无取消表招式都不改招', () => {
  const attempt = (setup, moveId = 'LP', button = 'HP') => {
    const f = new Fighter(0, 'RIN', 0);
    f.startMove(moveId);
    setup(f);
    f.update(I({ buttons: [button] }));
    return f;
  };
  // 挥空：hasHit 仍为 false
  assert.equal(attempt(() => {}).move?.id, 'LP');
  // 已接触但仍在 startup 内
  assert.equal(attempt((f) => { f.hasHit = true; f.moveFrame = 0; }).move?.id, 'LP');
  // 白名单只有 HP / HK，按 LK 不触发
  assert.equal(attempt((f) => { f.hasHit = true; f.moveFrame = MOVES.LP.startup - 1; }, 'LP', 'LK').move?.id, 'LP');
  // HP 的 cancelInto 为空，即使条件全满足也不能连锁
  assert.equal(attempt((f) => { f.hasHit = true; f.moveFrame = MOVES.HP.startup - 1; }, 'HP').move?.id, 'HP');
});

test('被格挡同样打开取消窗口（hasHit 不区分命中与防御）', () => {
  const [atk, def] = pair();
  def.state = 'guard';
  def.guarding = true;
  def.guardLevel = 'stand';
  atk.startMove('LP');
  const ev = def.receiveHit(MOVES.LP, atk, 0, 1);
  assert.equal(ev.blocked, true);
  assert.equal(atk.hasHit, true);
  atk.moveFrame = MOVES.LP.startup - 1;
  atk.update(I({ buttons: ['HP'] }));
  assert.equal(atk.move?.id, 'HP');
});

// ── POW 槽：已实现「累积」，M2 之前不消费 ──

test('POW 增量：攻击者按帧表攒气（被防住也攒）、防守方格挡 +3 / 受击 +2，封顶 100，KO 不加', () => {
  const [atk, def] = pair();
  def.receiveHit(MOVES.HP, atk, 0, 1);
  assert.equal(atk.meter, MOVES.HP.meterGain);
  assert.equal(def.meter, 2);

  const [atk2, def2] = pair();
  def2.state = 'guard';
  def2.guarding = true;
  def2.guardLevel = 'stand';
  const blocked = def2.receiveHit(MOVES.HP, atk2, 0, 1);
  assert.equal(blocked.blocked, true);
  assert.equal(atk2.meter, MOVES.HP.meterGain);
  assert.equal(def2.meter, 3);

  const [atk3, def3] = pair();
  atk3.meter = MAX_METER - 1;
  def3.receiveHit(MOVES.HK, atk3, 0, 1);
  assert.equal(atk3.meter, MAX_METER);

  const [atk4, def4] = pair();
  def4.hp = 1;
  def4.receiveHit(MOVES.LP, atk4, 0, 1);
  assert.equal(def4.state, 'ko');
  assert.equal(def4.meter, 0, 'KO 分支不进入受击攒气');
});

test('POW 只有 236 会消费：普通出招不扣减，每回合清零而胜场保留', () => {
  const f = new Fighter(0, 'RIN', 0);
  f.meter = 73;
  f.wins = 1;
  f.startMove('HP');
  for (let i = 0; i < moveDuration(MOVES.HP) + 2; i++) f.update(I());
  assert.equal(f.meter, 73, '普通招式不消费 POW');
  f.resetForRound(-1.5, 1);
  assert.equal(f.meter, 0);
  assert.equal(f.wins, 1);
  assert.equal(f.hp, MAX_HP);
});

// ── M2：236 起必杀与 POW 消费 ───────────────────────────────────────

test('236 + 足额 POW：朝向匹配时消费半槽并起 SUPER', () => {
  for (const meter of [SUPER_COST, MAX_METER]) {
    const f = new Fighter(0, 'RIN', 0);
    f.facing = 1;
    f.meter = meter;
    f.update(I({ dir: 1, buttons: ['HP'], qcf: 1 }));
    assert.equal(f.move?.id, 'SUPER');
    assert.equal(f.meter, meter - SUPER_COST);
    assert.equal(f.state, 'attack');
    assert.equal(f.moveFrame, 0);
    assert.equal(f.hasHit, false);
  }
});

test('236 条件不满足就回退普通招式：按键不丢、POW 一分不扣', () => {
  const base = () => {
    const f = new Fighter(0, 'RIN', 0);
    f.facing = 1;
    f.meter = MAX_METER;
    return f;
  };

  const plain = base();
  plain.update(I({ dir: 1, buttons: ['HP'] }));
  assert.equal(plain.move?.id, 'HP', '没摇指令就只是重拳');
  assert.equal(plain.meter, MAX_METER);

  const poor = base();
  poor.meter = SUPER_COST - 1;
  poor.update(I({ dir: 1, buttons: ['HP'], qcf: 1 }));
  assert.equal(poor.move?.id, 'HP', 'POW 不足回退重拳');
  assert.equal(poor.meter, SUPER_COST - 1);

  const backward = base();
  backward.update(I({ dir: 1, buttons: ['HP'], qcf: -1 }));
  assert.equal(backward.move?.id, 'HP', '向后摇 214 不该触发');
  assert.equal(backward.meter, MAX_METER);

  const air = base();
  air.airborne = true;
  air.y = 0.8;
  air.vy = 0.02;
  air.update(I({ dir: 1, buttons: ['HP'], qcf: 1 }));
  assert.equal(air.move?.id, 'JHK', '滞空回退跳跃重踢');
  assert.equal(air.meter, MAX_METER);
});

test('SUPER 命中不回攒 POW（meterGain = 0），但防守方仍按规则攒气', () => {
  const [atk, def] = pair();
  atk.meter = 50;
  const ev = def.receiveHit(MOVES.SUPER, atk, 0, 1);
  assert.equal(ev.blocked, false);
  assert.equal(def.state, 'knockdown');
  assert.equal(atk.meter, 50);
  assert.equal(def.meter, 2);
});
