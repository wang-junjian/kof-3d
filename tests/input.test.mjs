import test from 'node:test';
import assert from 'node:assert/strict';
import { input } from './.build/logic.mjs';

/** 最小事件目标：InputBuffer 只用到 add/removeEventListener 与事件对象的 code/preventDefault。 */
class FakeTarget {
  handlers = new Map();
  addEventListener(type, fn) { this.handlers.set(type, fn); }
  removeEventListener(type) { this.handlers.delete(type); }
  emit(type, code) {
    this.handlers.get(type)?.({ code, preventDefault() {} });
  }
}

const make = () => {
  const target = new FakeTarget();
  return { target, buf: new input.InputBuffer(target) };
};

test('EMPTY_INPUT 是干净的中性帧', () => {
  assert.deepEqual(input.EMPTY_INPUT, {
    dir: 0, jump: false, down: false, guard: false, buttons: [],
  });
});

test('攻击键是边缘触发：按下只消费一次，按住不重复出招', () => {
  const { target, buf } = make();
  target.emit('keydown', 'KeyJ');
  assert.deepEqual(buf.sample().buttons, ['LP']);
  assert.deepEqual(buf.sample().buttons, []);
  target.emit('keyup', 'KeyJ');
  target.emit('keydown', 'KeyK');
  assert.deepEqual(buf.sample().buttons, ['HP']);
});

test('方向键是持续状态；左右同按互相抵消；下蹲与跳跃分离', () => {
  const { target, buf } = make();
  target.emit('keydown', 'KeyA');
  assert.equal(buf.sample().dir, -1);
  target.emit('keydown', 'KeyD');
  assert.equal(buf.sample().dir, 0);
  target.emit('keyup', 'KeyD');
  assert.equal(buf.sample().dir, -1);
  target.emit('keydown', 'KeyS');
  assert.equal(buf.sample().down, true);
  assert.equal(buf.sample().guard, false); // 防御由 Fighter 按后方向推导，键盘层不隐式触发
  target.emit('keyup', 'KeyA');
  assert.equal(buf.sample().dir, 0);
});

test('跳跃只在按下边缘为 true，方向键与攻击键不会被误判为跳跃', () => {
  const { target, buf } = make();
  target.emit('keydown', 'ArrowUp');
  assert.equal(buf.sample().jump, true);
  assert.equal(buf.sample().jump, false);
  target.emit('keydown', 'KeyI');
  assert.deepEqual(buf.sample().buttons, ['HK']);
});

test('recentDirections 方向探针固定只回最近 12 帧', () => {
  const { target, buf } = make();
  target.emit('keydown', 'KeyD');
  for (let i = 0; i < 15; i++) buf.sample();
  assert.equal(buf.recentDirections().length, 12);
  assert.ok(buf.recentDirections().every((d) => d === 1));
  target.emit('keyup', 'KeyD');
  target.emit('keydown', 'KeyA');
  buf.sample();
  const dirs = buf.recentDirections();
  assert.equal(dirs.length, 12);
  assert.equal(dirs[11], -1); // 新帧进队首帧出队
  assert.equal(dirs[0], 1);
});

// ── M2：236 指令识别纯函数 ──────────────────────────────────────────
const F = (o = {}) => ({ dir: 0, jump: false, down: false, guard: false, buttons: [], ...o });
const qcf = (history, frame) => input.detectQcf(history, frame);

test('236 指令窗口为 20 逻辑帧（约 333ms，够真人摇完三段）', () => {
  assert.equal(input.QCF_WINDOW, 20);
});

test('detectQcf：↓↘→ + 攻击键识别为右向，↓↙← 识别为左向（绝对方向）', () => {
  assert.equal(qcf(
    [F({ down: true }), F({ down: true }), F({ down: true, dir: 1 }), F({ down: true, dir: 1 })],
    F({ dir: 1, buttons: ['HP'] }),
  ), 1);
  assert.equal(qcf(
    [F({ down: true }), F({ down: true, dir: -1 }), F({ down: true, dir: -1 })],
    F({ dir: -1, buttons: ['LP'] }),
  ), -1);
});

test('detectQcf：允许方向停留与重复帧（格斗游戏的宽松输入）', () => {
  const loose = [
    F({ down: true }), F({ down: true }), F({ down: true, dir: 1 }),
    F({ dir: 1 }), F({ down: true, dir: 1 }), F({ dir: 1 }),
  ];
  assert.equal(qcf(loose, F({ dir: 1, buttons: ['HK'] })), 1);
});

test('detectQcf：缺 ↓ / 缺 ↘ / 方向不一致 / 无攻击键 / 仍蹲着 / 原地按键都不触发', () => {
  const full = [F({ down: true }), F({ down: true, dir: 1 })];
  assert.equal(qcf([F({ down: true }), F({ down: true })], F({ dir: 1, buttons: ['HP'] })), null, '缺 ↘');
  assert.equal(qcf([F({ down: true, dir: 1 })], F({ dir: 1, buttons: ['HP'] })), null, '缺 ↓');
  assert.equal(qcf(full, F({ dir: -1, buttons: ['HP'] })), null, '收尾方向与 ↘ 不一致');
  assert.equal(qcf(full, F({ dir: 1 })), null, '没有攻击键');
  assert.equal(qcf(full, F({ dir: 1, down: true, buttons: ['HP'] })), null, '没松开下');
  assert.equal(qcf(full, F({ dir: 0, buttons: ['HP'] })), null, '原地按键');
  assert.equal(qcf([], F({ dir: 1, buttons: ['HP'] })), null, '空历史');
});

test('窗口失焦清空按键状态，dispose 移除所有监听', () => {
  const { target, buf } = make();
  target.emit('keydown', 'KeyA');
  target.emit('keydown', 'KeyJ');
  target.emit('blur', '');
  const f = buf.sample();
  assert.equal(f.dir, 0);
  assert.deepEqual(f.buttons, []);
  buf.dispose();
  assert.equal(target.handlers.size, 0);
});
