/**
 * 移动端手势护栏：把浏览器级的缩放 / 拖动 / 长按菜单从游戏里摘掉。
 *
 * 分工：viewport meta 与 CSS `touch-action` 负责声明式禁用，本模块只补
 * iOS Safari 不认声明的那部分（gesture* 捏合、双击兼容事件、多指手势）。
 * 刻意**不**拦截单指 touchstart —— 触屏虚拟键的 pointerdown，以及「左手
 * 方向 + 右手攻击」的多指同时按键，都依赖原生的触摸事件链。
 */
export function installGestureGuards(): void {
  const prevent = (e: Event): void => {
    if (e.cancelable) e.preventDefault();
  };

  // iOS Safari 私有的捏合手势，旧版 WebKit 上 CSS touch-action 拦不住它。
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, prevent, { passive: false });
  }
  // 双击缩放的兼容事件兜底：快速连点两个不同攻击键时最容易命中。
  document.addEventListener('dblclick', prevent, { passive: false });
  // 长按不弹选择 / 系统菜单，避免连打被打断。
  document.addEventListener('contextmenu', prevent);

  // 只在两指及以上时拦截，单指按下必须原样送达虚拟键。
  document.addEventListener('touchstart', (e) => {
    const ev = e as TouchEvent;
    if (ev.touches.length > 1 && ev.cancelable) ev.preventDefault();
  }, { passive: false });

  // 开局后禁止页面级拖动 / 下拉刷新 / 橡皮筋；开机页仍允许滚动长说明。
  document.addEventListener('touchmove', (e) => {
    if (!document.body.classList.contains('started')) return;
    const target = e.target;
    if (target instanceof Element && target.closest('.boot-keys')) return;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
}
