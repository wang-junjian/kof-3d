import test from 'node:test';
import assert from 'node:assert/strict';
import { ai, frames } from './.build/logic.mjs';

const { AIController } = ai;

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
