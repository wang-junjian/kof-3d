import test from 'node:test';
import assert from 'node:assert/strict';
import { match, ai, frames, input } from './.build/logic.mjs';

const EMPTY = { ...input.EMPTY_INPUT, buttons: [] };
const I = (o = {}) => ({ ...EMPTY, ...o });

const makeMatch = () => {
  const events = { hits: 0, rounds: [], announces: [], roundEnd: null, matchEnd: null, resets: 0 };
  const cb = {
    onHit: () => { events.hits++; },
    onRoundStart: (n) => events.rounds.push(n),
    onRoundEnd: (w, r) => { events.roundEnd = { w, r }; },
    onMatchEnd: (w) => { events.matchEnd = w; },
    onAnnounce: (t) => { events.announces.push(t); },
    onReset: () => { events.resets++; },
  };
  return { m: new match.Match(new ai.AIController('easy'), cb), events };
};

test('开局 intro 走满 104 逻辑帧后进入 fight，期间计时器不流逝', () => {
  const { m, events } = makeMatch();
  assert.equal(m.phase, 'intro');
  assert.equal(m.timeLeft, frames.ROUND_SECONDS);
  for (let i = 0; i < 104; i++) m.step(EMPTY);
  assert.equal(m.phase, 'fight');
  assert.equal(m.timeLeft, frames.ROUND_SECONDS);
  assert.ok(events.announces.includes('ROUND 1'));
  assert.ok(events.announces.includes('FIGHT'));
  assert.equal(events.rounds[0], 1);
});

test('Hitstop 冻结逻辑但逻辑帧继续计数，顿帧期间按下的攻击键不丢失', () => {
  const { m } = makeMatch();
  m.phase = 'fight';
  m.hitstop = 3;
  const f0 = m.frame;
  m.step(I({ buttons: ['LP'] }));
  m.step(EMPTY);
  m.step(EMPTY);
  assert.equal(m.frame, f0 + 3);
  assert.equal(m.hitstop, 0);
  assert.equal(m.p1.state, 'idle');
  m.step(EMPTY); // 解冻后的第一帧消费缓冲
  assert.equal(m.p1.move?.id, 'LP');
});

test('KO 结束回合、记胜场、发 K.O. 公告', () => {
  const { m, events } = makeMatch();
  m.phase = 'fight';
  m.p2.hp = 1;
  let steps = 0;
  while (m.phase === 'fight' && steps < 120) {
    m.hitstop = 0;
    for (const f of [m.p1, m.p2]) {
      f.x = f === m.p1 ? -0.35 : 0.35;
      f.y = 0; f.vx = 0; f.vy = 0;
      f.airborne = false; f.guarding = false; f.crouching = false;
    }
    if (m.p2.state === 'attack') {
      m.p2.state = 'idle'; m.p2.move = null; m.p2.moveFrame = 0;
    }
    if (m.p1.state !== 'attack') m.p1.startMove('HP');
    m.step(EMPTY);
    steps++;
  }
  assert.ok(steps < 120, `未能在 120 帧内打出 KO（steps=${steps}）`);
  assert.equal(m.p2.hp, 0);
  assert.equal(m.p1.wins, 1);
  assert.ok(['roundOver', 'matchOver'].includes(m.phase));
  assert.equal(events.roundEnd.w, 0);
  assert.equal(events.roundEnd.r, 'ko');
  assert.ok(events.announces.includes('K.O.'));
  assert.ok(events.hits > 0);
});

test('受击打断后清掉旧招式，攻击者招式继续播放（snapshot().move 不残留）', () => {
  const { m } = makeMatch();
  m.phase = 'fight';
  m.p1.x = -0.35;
  m.p2.x = 0.35;
  m.p1.startMove('HP');
  m.p1.moveFrame = 6; // 下一次 update 进入 active 首帧
  m.p2.state = 'attack';
  m.p2.move = frames.MOVES.LP;
  m.p2.moveFrame = 0;
  m.p2.hasHit = false;
  m.step(EMPTY);
  assert.equal(m.p2.hp < frames.MAX_HP, true);
  assert.equal(m.p2.state, 'hitstun');
  assert.equal(m.p2.move, null);
  assert.equal(m.p2.hasHit, false);
  assert.equal(m.p1.move?.id, 'HP'); // 命中者的招式不应被清理
});

// ── M2：236 指令在 Match 层的完整链路 ───────────────────────────────
const F = (o = {}) => ({ ...EMPTY, ...o });
const readySuper = () => {
  const { m } = makeMatch();
  m.phase = 'fight';
  m.hitstop = 0;
  m.buffered.length = 0;
  m.p1.meter = 100;
  m.p1.x = -0.35;
  m.p2.x = 0.35;
  for (const f of [m.p1, m.p2]) {
    f.state = 'idle'; f.move = null; f.moveFrame = 0; f.stunLeft = 0;
    f.y = 0; f.vy = 0; f.vx = 0;
    f.airborne = false; f.guarding = false; f.crouching = false;
  }
  return m;
};

test('236 完整链路：↓↘→ + 攻击键扣除半槽并起 SUPER', () => {
  const m = readySuper();
  for (const f of [
    F({ down: true }), F({ down: true }),
    F({ down: true, dir: 1 }), F({ down: true, dir: 1 }),
    F({ dir: 1, buttons: ['HP'] }),
  ]) m.step(f);
  assert.equal(m.p1.facing, 1);
  assert.equal(m.p1.move?.id, 'SUPER');
  assert.equal(m.p1.meter, 100 - frames.SUPER_COST);
  assert.equal(m.p1.state, 'attack');
});

test('236 输入窗口有限：摇完方向后隔太久再按攻击键不触发', () => {
  const m = readySuper();
  m.step(F({ down: true }));
  m.step(F({ down: true, dir: 1 }));
  for (let i = 0; i < input.QCF_WINDOW + 3; i++) {
    m.hitstop = 0;
    m.p1.state = 'idle'; m.p1.move = null; m.p1.stunLeft = 0;
    m.p2.state = 'idle'; m.p2.move = null;
    m.step(EMPTY);
  }
  m.step(F({ dir: 1, buttons: ['HP'] }));
  assert.notEqual(m.p1.move?.id, 'SUPER');
  assert.equal(m.p1.meter, 100, '窗口过期不扣 POW');
});

test('回合切换清空 236 历史，摇杆输入不跨回合残留', () => {
  const m = readySuper();
  m.step(F({ down: true }));
  m.step(F({ down: true, dir: 1 }));
  m.restart();
  m.phase = 'fight';
  m.p1.meter = 100;
  m.step(F({ dir: 1, buttons: ['HP'] }));
  assert.notEqual(m.p1.move?.id, 'SUPER');
  assert.equal(m.p1.meter, 100);
});

test('顿帧期间摇完 236：解冻后仍按 SUPER 结算，POW 只扣一次', () => {
  const m = readySuper();
  m.hitstop = 4;
  for (const f of [
    F({ down: true }),
    F({ down: true, dir: 1 }),
    F({ dir: 1, buttons: ['HP'] }),
    EMPTY,
  ]) assert.equal(m.step(f), true, '顿帧期间 step 必须报告冻结');
  assert.equal(m.hitstop, 0);
  assert.equal(m.p1.state, 'idle', '顿帧里不该推进状态机');

  m.step(EMPTY);
  assert.equal(m.p1.move?.id, 'SUPER');
  assert.equal(m.p1.meter, 100 - frames.SUPER_COST);
});

test('KO 后倒地动画继续推进：roundOver 期间 stateFrame 增长但角色不再行动', () => {
  const { m } = makeMatch();
  m.phase = 'fight';
  m.hitstop = 0;
  m.p2.hp = 1;
  m.p2.receiveHit(frames.MOVES.HP, m.p1, 0, 1);
  assert.equal(m.p2.state, 'ko');

  m.step(EMPTY); // 本帧结算 KO 并切到 roundOver
  assert.ok(['roundOver', 'matchOver'].includes(m.phase));
  const f0 = m.p2.stateFrame;

  for (let i = 0; i < 30; i++) m.step(EMPTY);
  assert.equal(m.p2.stateFrame, f0 + 30, 'KO 姿态靠 stateFrame 插值，冻结会停在倒地中途');
  assert.equal(m.p2.state, 'ko');
  assert.ok(Math.abs(m.p2.x) <= frames.ARENA_HALF + 1e-9, '击退滑行不能越出场地');
});

test('restart 复位到第 1 局、满血、胜场清零', () => {
  const { m, events } = makeMatch();
  m.p1.wins = 2;
  m.p1.hp = 3;
  m.phase = 'matchOver';
  m.restart();
  assert.equal(m.round, 1);
  assert.equal(m.p1.wins, 0);
  assert.equal(m.p2.wins, 0);
  assert.equal(m.p1.hp, frames.MAX_HP);
  assert.equal(m.p2.hp, frames.MAX_HP);
  assert.equal(m.phase, 'intro');
  assert.equal(m.hitstop, 0);
  assert.equal(events.resets, 1);
});
