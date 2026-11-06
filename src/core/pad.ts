import type { InputRole } from './input';

/** 摇杆死区：低于此值当作回中，避免手柄漂移导致角色自己走。 */
export const PAD_DEADZONE = 0.35;

/**
 * Standard Gamepad 按钮索引 → 输入角色。
 * 0/1/2/3 = A/B/X/Y → 轻拳/重拳/轻踢/重踢；12..15 = 十字键。
 */
export const PAD_BUTTON_ROLE: Readonly<Record<number, InputRole>> = {
  0: 'LP', 1: 'HP', 2: 'LK', 3: 'HK',
  12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

/** RB：一键 236 超必杀（触屏也有同款快捷按钮），不映射到普通角色。 */
export const PAD_MACRO_BUTTON = 5;

/** 只取 navigator.getGamepads() 用到的字段，便于纯逻辑单测注入假手柄。 */
export interface PadLike {
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
}

/** 把一帧手柄状态归约成按住的 InputRole 集合；断开 / 缺失一律返回空集。 */
export function padRoles(pad: PadLike | null | undefined): Set<InputRole> {
  const roles = new Set<InputRole>();
  if (!pad || !pad.connected) return roles;
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  if (ax < -PAD_DEADZONE) roles.add('left');
  if (ax > PAD_DEADZONE) roles.add('right');
  if (ay < -PAD_DEADZONE) roles.add('up');
  if (ay > PAD_DEADZONE) roles.add('down');
  for (const [index, role] of Object.entries(PAD_BUTTON_ROLE)) {
    if (pad.buttons[Number(index)]?.pressed) roles.add(role);
  }
  return roles;
}

/** RB 是否按下；宏由调用方做边缘检测，避免按住时每帧重排 236。 */
export function padMacroPressed(pad: PadLike | null | undefined): boolean {
  return Boolean(pad?.connected && pad.buttons[PAD_MACRO_BUTTON]?.pressed);
}
