import { ARENA_HALF, PUSH_HALF, type Box } from './frames';

export interface WorldBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * 把局部盒转成世界 AABB。
 * box.x 是沿「面向方向」的中心偏移，box.y 是相对脚底的高度。
 * hurtbox 的 x 为 0，因此 facing 对它没有影响。
 */
export function worldBox(box: Box, x: number, baseY: number, facing: 1 | -1): WorldBox {
  const cx = x + facing * box.x;
  const cy = baseY + box.y;
  return {
    minX: cx - box.w / 2,
    maxX: cx + box.w / 2,
    minY: cy - box.h / 2,
    maxY: cy + box.h / 2,
  };
}

export function overlaps(a: WorldBox, b: WorldBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

export function boxCenterX(a: WorldBox, b: WorldBox): number {
  return (Math.max(a.minX, b.minX) + Math.min(a.maxX, b.maxX)) / 2;
}

export function boxCenterY(a: WorldBox, b: WorldBox): number {
  return (Math.max(a.minY, b.minY) + Math.min(a.maxY, b.maxY)) / 2;
}

/**
 * 当前场地半宽。默认等于 ARENA_HALF；视口适配层（main.ts 的 resize 入口）
 * 会在竖屏时把窗口可见宽度换算成更小的边界注入进来。
 * 这是「屏幕有多宽」的物理约束，不是游戏规则，帧表 / 判定框 / 推挤盒都不变。
 */
let arenaHalf = ARENA_HALF;

/** 注入当前视口允许的场地半宽；下限保证两人推挤盒仍能站开。 */
export function setArenaHalf(next: number): void {
  if (!Number.isFinite(next)) return;
  arenaHalf = Math.max(PUSH_HALF * 2 + 0.2, Math.min(ARENA_HALF, next));
}

export function getArenaHalf(): number {
  return arenaHalf;
}

export function clampArena(x: number): number {
  return Math.max(-arenaHalf, Math.min(arenaHalf, x));
}

/** 推挤盒不允许两人重叠；被墙卡住时把剩余位移补给另一侧（墙位置随视口变化）。 */
export function separate(ax: number, bx: number): [number, number] {
  const d = bx - ax;
  const need = PUSH_HALF * 2;
  if (Math.abs(d) >= need) return [ax, bx];
  const sign = d >= 0 ? 1 : -1;
  const half = (need - Math.abs(d)) / 2;
  let na = clampArena(ax - sign * half);
  let nb = clampArena(bx + sign * half);
  if (Math.abs(nb - na) < need) {
    const rest = need - Math.abs(nb - na);
    if (na <= -arenaHalf + 0.001) nb = clampArena(nb + sign * rest);
    else if (nb >= arenaHalf - 0.001) na = clampArena(na - sign * rest);
    else { na = clampArena(na - sign * rest / 2); nb = clampArena(nb + sign * rest / 2); }
  }
  return [na, nb];
}
