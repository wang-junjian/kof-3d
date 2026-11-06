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

// ── 多输入源汇合：键盘 / 触屏 / 手柄共用 InputBuffer ─────────────────
test('外部设备 press/release 与键盘同构：边缘触发一次、方向持续按住', () => {
  const { buf } = make();
  buf.press('right', 'touch');
  assert.equal(buf.sample().dir, 1);
  assert.equal(buf.sample().dir, 1, '方向是持续状态，不重复消费');
  buf.press('HP', 'touch');
  assert.deepEqual(buf.sample().buttons, ['HP']);
  assert.deepEqual(buf.sample().buttons, [], '攻击键只在按下边缘出现一次');
  buf.release('right', 'touch');
  buf.release('HP', 'touch');
  assert.deepEqual(buf.heldRoles(), []);
});

test('按 source 分桶：松开其中一个设备不会误清另一个按住的同一方向', () => {
  const { target, buf } = make();
  target.emit('keydown', 'KeyD');
  buf.press('right', 'pad');
  buf.release('right', 'pad'); // 手柄每帧同步都会 release 未按下的角色
  assert.equal(buf.sample().dir, 1, '键盘仍按着右');
  assert.deepEqual(buf.sample().buttons, [], '第二个来源按下不重复产生边缘');
  target.emit('keyup', 'KeyD');
  assert.equal(buf.sample().dir, 0);
});

test('同一来源重复 press 不产生重复边缘（键盘 auto-repeat / 手柄每帧同步）', () => {
  const { buf } = make();
  buf.press('LP', 'pad');
  buf.press('LP', 'pad');
  buf.press('LP', 'pad');
  assert.deepEqual(buf.sample().buttons, ['LP']);
  assert.deepEqual(buf.sample().buttons, []);
});

test('heldRoles 汇总所有来源；releaseAll 清空按键与待播 236', () => {
  const { buf } = make();
  buf.press('left', 'touch');
  buf.press('HK', 'keyboard');
  buf.queueQcf(1);
  assert.deepEqual(buf.heldRoles(), ['left', 'HK']);
  assert.equal(buf.macroPending, true);
  buf.releaseAll();
  assert.deepEqual(buf.heldRoles(), []);
  assert.equal(buf.macroPending, false);
  assert.equal(buf.sample().dir, 0);
});

test('触屏一键 236 排 3 帧：前两帧进历史，第三帧能触发 detectQcf', () => {
  const { buf } = make();
  buf.queueQcf(1, 'HP');
  assert.equal(buf.macroPending, true);
  const a = buf.sample();
  const b = buf.sample();
  const c = buf.sample();
  assert.equal(buf.macroPending, false);
  assert.deepEqual(
    [a, b, c].map((f) => ({ dir: f.dir, down: f.down, buttons: f.buttons })),
    [
      { dir: 0, down: true, buttons: [] },
      { dir: 1, down: true, buttons: [] },
      { dir: 1, down: false, buttons: ['HP'] },
    ],
  );
  assert.equal(input.detectQcf([a, b], c), 1);
});

test('镜像站位一键 236 产出绝对左向，且不吞掉真实按键', () => {
  const { buf } = make();
  buf.queueQcf(-1, 'LK');
  const history = [buf.sample(), buf.sample()];
  const last = buf.sample();
  assert.equal(last.buttons[0], 'LK');
  assert.equal(input.detectQcf(history, last), -1);
  buf.press('down', 'touch');
  assert.equal(buf.sample().down, true, '宏播完后恢复正常采样');
});
