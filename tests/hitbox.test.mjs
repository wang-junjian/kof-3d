import test from 'node:test';
import assert from 'node:assert/strict';
import { hitbox, frames } from './.build/logic.mjs';

const { worldBox, overlaps, boxCenterX, boxCenterY, clampArena, separate } = hitbox;

test('worldBox：box.x 随 facing 镜像，box.y 叠加角色离地高度', () => {
  const box = { x: 0.7, y: 1.2, w: 0.6, h: 0.4 };
  const right = worldBox(box, -1, 0, 1);
  const left = worldBox(box, -1, 0, -1);
  assert.equal(right.minX, -1 + 0.7 - 0.3);
  assert.equal(left.maxX, -1 - 0.7 + 0.3);
  assert.equal(right.minX + left.maxX, -2); // 以角色中心镜像对称
  assert.equal(right.minY, 1.0);
  const air = worldBox(box, -1, 0.8, 1);
  assert.ok(Math.abs(air.minY - (right.minY + 0.8)) < 1e-9);
});

test('hurtbox 的 x=0，因此 facing 不影响受伤盒', () => {
  assert.deepEqual(
    worldBox(frames.HURT_STAND, 0.5, 0, 1),
    worldBox(frames.HURT_STAND, 0.5, 0, -1),
  );
});

test('overlaps 用严格不等：边缘恰好相接不算命中', () => {
  const a = worldBox({ x: 0, y: 1, w: 1, h: 1 }, 0, 0, 1);
  const touching = { minX: 0.5, maxX: 1.5, minY: 0.5, maxY: 1.5 };
  assert.equal(overlaps(a, touching), false);
  const inside = { minX: 0.49, maxX: 1.5, minY: 0.5, maxY: 1.5 };
  assert.equal(overlaps(a, inside), true);
});

test('接触点取两框交集中心，用于 hitspark 落点', () => {
  const a = { minX: -1, maxX: 1, minY: 0, maxY: 2 };
  const b = { minX: 0, maxX: 3, minY: 1, maxY: 4 };
  assert.equal(boxCenterX(a, b), 0.5);
  assert.equal(boxCenterY(a, b), 1.5);
});

test('clampArena 把角色限制在场内', () => {
  assert.equal(clampArena(99), frames.ARENA_HALF);
  assert.equal(clampArena(-99), -frames.ARENA_HALF);
  assert.equal(clampArena(0.3), 0.3);
});

test('separate：两人不重叠；靠墙时把剩余位移补给另一侧且不出界', () => {
  const [a, b] = separate(-0.05, 0.05);
  assert.ok(Math.abs(b - a) >= frames.PUSH_HALF * 2 - 1e-9);
  assert.ok(a >= -frames.ARENA_HALF && b <= frames.ARENA_HALF);

  const [wa, wb] = separate(-frames.ARENA_HALF, -frames.ARENA_HALF + 0.1);
  assert.ok(wa >= -frames.ARENA_HALF - 1e-9);
  assert.ok(wb <= frames.ARENA_HALF + 1e-9);
  assert.ok(Math.abs(wb - wa) >= frames.PUSH_HALF * 2 - 1e-9);

  const far = separate(-2, 2);
  assert.deepEqual(far, [-2, 2]);
});

test('separate 交叉站位贴墙：sign=-1 时整体平移回场内，仍拉开到 PUSH_HALF*2', () => {
  const need = frames.PUSH_HALF * 2;
  // 两人都贴右墙、b 在 a 左侧：a 已被墙卡死，只能把整个 pair 往左平移
  const [ra, rb] = separate(frames.ARENA_HALF, frames.ARENA_HALF - 0.05);
  assert.ok(Math.abs(rb - ra) >= need - 1e-9,
    `右墙镜像间距 ${Math.abs(rb - ra)} < ${need}（修复前为 0.4625）`);
  assert.ok(ra <= frames.ARENA_HALF + 1e-9 && rb >= -frames.ARENA_HALF - 1e-9, '右墙镜像不得出界');

  const [la, lb] = separate(-frames.ARENA_HALF + 0.05, -frames.ARENA_HALF);
  assert.ok(Math.abs(lb - la) >= need - 1e-9,
    `左墙镜像间距 ${Math.abs(lb - la)} < ${need}（修复前为 0.4625）`);
  assert.ok(lb >= -frames.ARENA_HALF - 1e-9 && la <= frames.ARENA_HALF + 1e-9, '左墙镜像不得出界');
});
