import test from 'node:test';
import assert from 'node:assert/strict';
import { pad } from './.build/logic.mjs';

const P = (o = {}) => ({
  connected: true,
  axes: [0, 0],
  buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
  ...o,
});

const withButtons = (...indexes) => {
  const p = P();
  for (const i of indexes) p.buttons[i] = { pressed: true };
  return p;
};

test('死区常数与标准映射表就位', () => {
  assert.equal(pad.PAD_DEADZONE, 0.35);
  assert.equal(pad.PAD_BUTTON_ROLE[0], 'LP');
  assert.equal(pad.PAD_BUTTON_ROLE[1], 'HP');
  assert.equal(pad.PAD_BUTTON_ROLE[2], 'LK');
  assert.equal(pad.PAD_BUTTON_ROLE[3], 'HK');
  assert.equal(pad.PAD_BUTTON_ROLE[12], 'up');
  assert.equal(pad.PAD_BUTTON_ROLE[15], 'right');
  assert.equal(pad.PAD_MACRO_BUTTON, 5);
});

test('回中手柄不产生任何方向；死区边界内仍视为回中', () => {
  assert.deepEqual([...pad.padRoles(P())], []);
  assert.deepEqual([...pad.padRoles(P({ axes: [0.34, -0.34] }))], []);
  assert.deepEqual([...pad.padRoles(P({ axes: [0.35, -0.35] }))], []);
});

test('左摇杆四方向映射到绝对左右与上下', () => {
  assert.deepEqual([...pad.padRoles(P({ axes: [-0.8, 0] }))], ['left']);
  assert.deepEqual([...pad.padRoles(P({ axes: [0.8, 0] }))], ['right']);
  assert.deepEqual([...pad.padRoles(P({ axes: [0, -0.8] }))], ['up']);
  assert.deepEqual([...pad.padRoles(P({ axes: [0, 0.8] }))], ['down']);
});

test('摇杆斜下同时给出 down 与方向，足以让 236 手摇成立', () => {
  const roles = pad.padRoles(P({ axes: [0.9, 0.9] }));
  assert.ok(roles.has('down') && roles.has('right'));
  const left = pad.padRoles(P({ axes: [-0.9, 0.9] }));
  assert.ok(left.has('down') && left.has('left'));
});

test('十字键与摇杆按「或」合并，同一角色不重复', () => {
  const roles = pad.padRoles(P({
    axes: [0.9, 0],
    buttons: (() => {
      const b = Array.from({ length: 16 }, () => ({ pressed: false }));
      b[15] = { pressed: true };
      b[13] = { pressed: true };
      return b;
    })(),
  }));
  assert.deepEqual([...roles].sort(), ['down', 'right']);
});

test('ABXY 映射轻拳/重拳/轻踢/重踢；RB 宏键不进普通角色集合', () => {
  const p = withButtons(0, 1, 2, 3, 5);
  const roles = pad.padRoles(p);
  assert.deepEqual(roles, new Set(['LP', 'HP', 'LK', 'HK']));
  assert.equal(pad.padMacroPressed(p), true);
  assert.equal(pad.padMacroPressed(withButtons(0)), false);
});

test('断开 / 缺失 / 短按钮数组都返回空集，不抛异常', () => {
  assert.deepEqual([...pad.padRoles(null)], []);
  assert.deepEqual([...pad.padRoles(undefined)], []);
  assert.deepEqual([...pad.padRoles(P({ connected: false, axes: [1, 1] }))], []);
  assert.equal(pad.padMacroPressed(null), false);
  const shortPad = P({ buttons: [{ pressed: true }], axes: [0, 1] });
  assert.ok(pad.padRoles(shortPad).has('down'));
  assert.equal(pad.padMacroPressed(shortPad), false);
});
