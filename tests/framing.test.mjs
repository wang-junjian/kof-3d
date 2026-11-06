import test from 'node:test';
import assert from 'node:assert/strict';
import { framing, hitbox, frames } from './.build/logic.mjs';

const {
  BASE_FOV, BASE_CAMERA_Z, MAX_CAMERA_Z, BODY_MARGIN, PORTRAIT_TARGET_HALF,
  MIN_ARENA_HALF, visibleHalf, zForWidth, framingFor,
} = framing;
const { clampArena, getArenaHalf, setArenaHalf, separate } = hitbox;

test('横屏 / 桌面：场地与机位保持原值，不改变既有观感', () => {
  for (const aspect of [1, 1.6, 2.16, 3]) {
    const f = framingFor(aspect);
    assert.equal(f.portrait, false, `aspect=${aspect}`);
    assert.equal(f.arenaHalf, frames.ARENA_HALF);
    assert.equal(f.cameraZ, BASE_CAMERA_Z);
  }
});

test('竖屏：场地收进画面，可见半宽恰好等于「场地 + 角色外侧余量」', () => {
  for (const [w, h] of [[390, 844], [390, 780], [412, 915]]) {
    const aspect = w / h;
    const f = framingFor(aspect);
    assert.equal(f.portrait, true, `${w}x${h}`);
    assert.ok(f.arenaHalf < frames.ARENA_HALF, `${w}x${h}: 场地必须收窄`);
    assert.ok(f.arenaHalf >= MIN_ARENA_HALF, `${w}x${h}: 仍要容下两人推挤盒`);
    assert.ok(Math.abs(f.visibleHalf - (f.arenaHalf + BODY_MARGIN)) < 1e-9,
      `${w}x${h}: ${f.visibleHalf} vs ${f.arenaHalf + BODY_MARGIN}`);
    assert.ok(f.cameraZ < MAX_CAMERA_Z, `${w}x${h}: 不该把角色拉成小点`);
  }
});

test('竖屏越窄相机越远；极端窄视口也不突破机位上限与场地下限', () => {
  const wide = framingFor(0.6);
  const narrow = framingFor(0.4);
  assert.ok(narrow.cameraZ > wide.cameraZ);
  const extreme = framingFor(0.15);
  assert.ok(extreme.cameraZ <= MAX_CAMERA_Z);
  assert.ok(extreme.arenaHalf >= MIN_ARENA_HALF);
  assert.ok(extreme.arenaHalf <= frames.ARENA_HALF);
  assert.ok(PORTRAIT_TARGET_HALF < frames.ARENA_HALF);
});

test('visibleHalf / zForWidth 互逆，推镜收窄 FOV 时需要更远的机位', () => {
  const aspect = 0.5;
  const z = zForWidth(2.0, BASE_FOV, aspect);
  assert.ok(Math.abs(visibleHalf(z, BASE_FOV, aspect) - 2.0) < 1e-9);
  assert.ok(zForWidth(2.0, BASE_FOV - 4, aspect) > z);
  assert.ok(Math.abs(visibleHalf(z, BASE_FOV, aspect) / aspect - z * Math.tan(BASE_FOV * Math.PI / 360)) < 1e-9);
});

test('动态边界注入：clampArena 与 separate 的靠墙补偿都跟着视口走，恢复后回到默认', () => {
  try {
    assert.equal(getArenaHalf(), frames.ARENA_HALF);
    setArenaHalf(1.0);
    assert.equal(getArenaHalf(), 1.0);
    assert.equal(clampArena(99), 1.0);
    assert.equal(clampArena(-99), -1.0);

    const [a, b] = separate(-1.0, -0.9);
    assert.ok(a >= -1.0 - 1e-9 && b <= 1.0 + 1e-9, `靠墙补偿越界: ${a}, ${b}`);
    assert.ok(Math.abs(b - a) >= frames.PUSH_HALF * 2 - 1e-9, `两人被挤重叠: ${a}, ${b}`);

    setArenaHalf(0.01); // 低于推挤盒下限，必须被夹住
    assert.ok(getArenaHalf() >= frames.PUSH_HALF * 2);
    setArenaHalf(Number.NaN); // 非有限值不能污染边界
    assert.ok(Number.isFinite(getArenaHalf()));
  } finally {
    setArenaHalf(frames.ARENA_HALF);
  }
  assert.equal(clampArena(99), frames.ARENA_HALF);
  assert.equal(clampArena(-99), -frames.ARENA_HALF);
});
