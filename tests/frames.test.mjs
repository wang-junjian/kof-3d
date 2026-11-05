import test from 'node:test';
import assert from 'node:assert/strict';
import { frames, hitbox } from './.build/logic.mjs';

const { MOVES, BUTTON_MOVE, AIR_BUTTON_MOVE, moveDuration } = frames;

test('7 个招式帧表自洽：id 对齐、窗口为正、时长等于三段之和', () => {
  const ids = Object.keys(MOVES);
  assert.equal(ids.length, 7);
  for (const id of ids) {
    const m = MOVES[id];
    assert.equal(m.id, id, `${id} 的 id 字段不一致`);
    assert.ok(m.startup > 0 && m.active > 0 && m.recovery > 0, `${id} 帧窗口非正`);
    assert.equal(moveDuration(m), m.startup + m.active + m.recovery);
    assert.ok(m.damage > 0 && m.hitstun > 0 && m.blockstun > 0, `${id} 伤害/硬直非正`);
    assert.ok(m.hitbox.w > 0 && m.hitbox.h > 0, `${id} 判定框尺寸非正`);
    assert.ok(m.hitbox.x > 0, `${id} 判定框必须朝面向方向前伸`);
    assert.ok(['mid', 'low', 'overhead'].includes(m.level), `${id} 高度属性非法`);
  }
});

test('地面招式高度属性：中段 4 招 + 下段扫腿；跳攻 2 招为上段且仅滞空可用', () => {
  for (const id of ['LP', 'HP', 'LK', 'HK']) assert.equal(MOVES[id].level, 'mid');
  assert.equal(MOVES.SWEEP.level, 'low');
  assert.equal(MOVES.SWEEP.knockdown, true);
  for (const id of ['JLP', 'JHK']) {
    assert.equal(MOVES[id].level, 'overhead');
    assert.equal(MOVES[id].air, true);
    assert.equal(MOVES[id].knockdown, false);
  }
  for (const id of ['LP', 'HP', 'LK', 'HK', 'SWEEP']) assert.equal(MOVES[id].air, undefined);
});

test('下段判定框确实低于站立受伤盒中心、跳攻判定框高于下段', () => {
  assert.ok(MOVES.SWEEP.hitbox.y < frames.HURT_STAND.y);
  assert.ok(MOVES.JHK.hitbox.y > MOVES.SWEEP.hitbox.y);
  assert.ok(MOVES.LP.hitbox.y > MOVES.SWEEP.hitbox.y);
});

test('空中按键只映射到 JLP / JHK，地面按键一对一', () => {
  for (const b of ['LP', 'HP', 'LK', 'HK']) {
    assert.equal(BUTTON_MOVE[b], b);
    assert.ok(['JLP', 'JHK'].includes(AIR_BUTTON_MOVE[b]));
    assert.equal(MOVES[AIR_BUTTON_MOVE[b]].air, true);
  }
  assert.equal(AIR_BUTTON_MOVE.HP, 'JHK');
  assert.equal(AIR_BUTTON_MOVE.HK, 'JHK');
  assert.equal(AIR_BUTTON_MOVE.LP, 'JLP');
});

test('核心常量守住单局规则：99 秒、满血 100、场地与重力符号', () => {
  assert.equal(frames.MAX_HP, 100);
  assert.equal(frames.MAX_METER, 100);
  assert.equal(frames.ROUND_SECONDS, 99);
  assert.equal(frames.ROUND_SECONDS * 60, 5940);
  assert.ok(frames.ARENA_HALF > 0 && frames.WALK_SPEED > 0 && frames.BACK_SPEED > 0);
  assert.ok(frames.GRAVITY < 0 && frames.JUMP_VY > 0);
  assert.ok(frames.LANDING_STUN > 0);
  assert.ok(frames.PUSH_HALF * 2 > 0);
});

test('轻拳可取消进重拳/重踢，其它招式没有取消窗口', () => {
  assert.deepEqual(MOVES.LP.cancelInto, ['HP', 'HK']);
  for (const id of ['HP', 'LK', 'HK', 'SWEEP', 'JLP', 'JHK']) {
    assert.deepEqual(MOVES[id].cancelInto, []);
  }
});

test('判定框工具导出齐全且可用（模块图完整性）', () => {
  assert.equal(typeof hitbox.worldBox, 'function');
  assert.equal(typeof hitbox.overlaps, 'function');
  assert.equal(typeof hitbox.separate, 'function');
});
