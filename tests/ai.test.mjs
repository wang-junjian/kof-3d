import test from 'node:test';
import assert from 'node:assert/strict';
import { ai, frames, match, input } from './.build/logic.mjs';

const { AIController } = ai;
const EMPTY = { ...input.EMPTY_INPUT, buttons: [] };

const fake = (x, state = 'idle', extra = {}) => ({
  x, state, facing: 1, airborne: false, move: null, hp: frames.MAX_HP, ...extra,
});

test('三档难度参数单调：越难越主动、越会防守、冷却越短、读招越准', () => {
  const easy = new AIController('easy').profile;
  const normal = new AIController('normal').profile;
  const hard = new AIController('hard').profile;
  assert.ok(easy.aggression < normal.aggression && normal.aggression < hard.aggression);
  assert.ok(easy.guardChance < normal.guardChance && normal.guardChance < hard.guardChance);
  assert.ok(easy.guardRead < normal.guardRead && normal.guardRead < hard.guardRead);
  assert.ok(easy.cooldownMin > normal.cooldownMin && normal.cooldownMin > hard.cooldownMin);
  assert.ok(easy.cooldownMax > normal.cooldownMax && normal.cooldownMax > hard.cooldownMax);
});

test('setDifficulty 切换档位但不重置玩家选择之外的状态', () => {
  const c = new AIController();
  assert.equal(c.level, 'normal');
  c.setDifficulty('hard');
  assert.equal(c.level, 'hard');
  assert.equal(c.profile.aggression, 0.82);
  c.reset();
  assert.equal(c.level, 'hard'); // 难度由玩家选择，不随回合重置
});

test('受创 / KO / 出招中一律返回中性帧，不叠加输入', () => {
  const c = new AIController('hard');
  for (const s of ['hitstun', 'blockstun', 'knockdown', 'ko', 'attack']) {
    const out = c.decide(fake(0, s), fake(0.5, 'attack'));
    assert.deepEqual(out.buttons, [], `${s} 不应出招`);
    assert.equal(out.dir, 0);
    assert.equal(out.guard, false);
  }
});

test('固定种子下同一初始状态的决策序列可复现', () => {
  const run = () => {
    const c = new AIController('normal');
    const out = [];
    for (let i = 0; i < 60; i++) {
      out.push(JSON.stringify(c.decide(fake(-0.4), fake(0.4, 'idle'))));
    }
    return out;
  };
  assert.deepEqual(run(), run());
});

test('读招：hard 面对下段会蹲防、面对上段/跳攻会站防', () => {
  const c = new AIController('hard');
  // pickGuardStance 是 TS private，编译后仍是普通方法；白盒验证规则表本身
  const low = fake(0.5, 'attack', { move: { level: 'low' } });
  const overhead = fake(0.5, 'attack', { move: { level: 'overhead' } });
  const airborne = fake(0.5, 'attack', { airborne: true, move: { level: 'low' } });
  let lowCrouch = 0, overheadStand = 0, airStand = 0;
  for (let i = 0; i < 100; i++) {
    if (c.pickGuardStance(low) === 'crouch') lowCrouch++;
    if (c.pickGuardStance(overhead) === 'stand') overheadStand++;
    if (c.pickGuardStance(airborne) === 'stand') airStand++;
  }
  assert.ok(lowCrouch >= 90, `下段读蹲防命中 ${lowCrouch}/100`);
  assert.ok(overheadStand >= 90, `上段读站防命中 ${overheadStand}/100`);
  assert.ok(airStand >= 90, `滞空一律站防 ${airStand}/100`);
});

test('AI 近距离会出招、远距离会接近，不会输出非法按键', () => {
  const c = new AIController('hard');
  const buttons = new Set(['LP', 'HP', 'LK', 'HK']);
  let attacked = false, advanced = false;
  for (let i = 0; i < 200; i++) {
    const near = c.decide(fake(-0.4), fake(0.4));
    const far = c.decide(fake(-2.4), fake(2.4));
    for (const b of [...near.buttons, ...far.buttons]) assert.ok(buttons.has(b));
    if (near.buttons.length > 0) attacked = true;
    if (far.dir !== 0) advanced = true;
  }
  assert.equal(attacked, true);
  assert.equal(advanced, true);
});

test('POW 达标时放 236 超必杀，qcf 是绝对方向且随 facing 翻转', () => {
  for (const facing of [1, -1]) {
    const c = new AIController('hard');
    let fired = 0;
    for (let i = 0; i < 400; i++) {
      const out = c.decide(fake(-0.4, 'idle', { meter: 100, facing }), fake(0.4, 'idle'));
      if (out.qcf) {
        fired++;
        assert.equal(out.qcf, facing);
        assert.ok(out.buttons.length > 0, '236 收尾帧必须带攻击键');
      }
    }
    assert.ok(fired > 0, `facing=${facing} 时一次超必杀都没放`);
  }
  const broke = new AIController('hard');
  for (let i = 0; i < 400; i++) {
    const out = broke.decide(fake(-0.4, 'idle', { meter: 0 }), fake(0.4, 'idle'));
    assert.equal(out.qcf, undefined, 'POW 不足绝不发 236');
  }
});

test('轻拳命中后按难度取消成重招，未命中仍保持中性帧', () => {
  const lp = { cancelInto: ['HP', 'HK'], startup: 3 };
  const c = new AIController('hard');
  let cancelled = 0;
  for (let i = 0; i < 100; i++) {
    const out = c.decide(
      fake(-0.4, 'attack', { hasHit: true, move: lp, moveFrame: 4 }), fake(0.4, 'idle'));
    if (out.buttons.length) {
      cancelled++;
      assert.ok(out.buttons[0] === 'HP' || out.buttons[0] === 'HK');
    }
  }
  assert.ok(cancelled > 50, `hard 应高概率取消（${cancelled}/100）`);
  const clean = c.decide(
    fake(-0.4, 'attack', { hasHit: false, move: lp, moveFrame: 4 }), fake(0.4, 'idle'));
  assert.deepEqual(clean.buttons, [], '未命中不得叠加输入');
  const easy = new AIController('easy');
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(
      easy.decide(fake(-0.4, 'attack', { hasHit: true, move: lp, moveFrame: 4 }),
        fake(0.4, 'idle')).buttons,
      [], 'easy 不连段');
  }
});

test('滞空时 normal/hard 会补空中攻击，easy 不会', () => {
  for (const [level, expected] of [['hard', true], ['normal', true], ['easy', false]]) {
    const c = new AIController(level);
    let fired = 0;
    for (let i = 0; i < 80; i++) {
      const out = c.decide(fake(-0.4, 'jump', { airborne: true }), fake(0.4, 'idle'));
      if (out.buttons.length) fired++;
    }
    assert.equal(fired > 0, expected, `${level} 空中攻击 fired=${fired}`);
  }
});

test('冷却期间持续走位，不再站桩', () => {
  const c = new AIController('normal');
  let moving = 0;
  for (let i = 0; i < 200; i++) {
    const out = c.decide(fake(-0.4, 'idle', { meter: 0 }), fake(0.4, 'idle'));
    if (out.dir !== 0) moving++;
  }
  assert.ok(moving / 200 > 0.5, `走位帧占比=${(moving / 2).toFixed(1)}%`);
});

test('三档难度 60s 对局：站桩占比下降，超必杀与跳攻确实出现', () => {
  const cb = {
    onHit() {}, onRoundStart() {}, onRoundEnd() {}, onMatchEnd() {},
    onAnnounce() {}, onReset() {},
  };
  for (const diff of ['easy', 'normal', 'hard']) {
    const m = new match.Match(new AIController(diff), cb);
    m.phase = 'fight';
    let idle = 0, supers = 0, air = 0;
    const total = 3600;
    for (let i = 0; i < total; i++) {
      m.step(EMPTY);
      if (m.phase !== 'fight') {
        m.phase = 'fight';
        m.p1.hp = frames.MAX_HP; m.p2.hp = frames.MAX_HP;
        m.timerFrames = 5940;
      }
      if (m.p2.state === 'idle') idle++;
      const id = m.p2.move?.id;
      if (id === 'SUPER') supers++;
      if (id === 'JLP' || id === 'JHK') air++;
    }
    assert.ok(idle / total < 0.45,
      `${diff} idle 占比 ${(idle / total * 100).toFixed(1)}%（应 < 45%）`);
    assert.ok(supers > 0, `${diff} 超必杀帧=${supers}`);
    if (diff !== 'easy') assert.ok(air > 0, `${diff} 跳攻帧=${air}`);
  }
});
