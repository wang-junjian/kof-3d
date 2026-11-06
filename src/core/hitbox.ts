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

/** 推挤盒不允许两人重叠；被墙卡住时把整个 pair 平移回场内，间距保持 need。 */
export function separate(ax: number, bx: number): [number, number] {
  const d = bx - ax;
  const need = PUSH_HALF * 2;
  if (Math.abs(d) >= need) return [ax, bx];
  // sign 决定「把 a 往 -sign、b 往 +sign 推开」，兼容交叉站位（sign=-1）。
  const sign = d >= 0 ? 1 : -1;
  const mid = (ax + bx) / 2;
  const na = mid - sign * need / 2;
  const nb = mid + sign * need / 2;
  // 以两人的实际左右端点为准（不假设 a 在左 / b 在右），整体平移回场地内。
  // setArenaHalf 下限保证 2 * arenaHalf > need，故 left/right 不会同时越界。
  const left = sign === 1 ? na : nb;
  const right = sign === 1 ? nb : na;
  let shift = 0;
  if (left < -arenaHalf) shift = -arenaHalf - left;
  else if (right > arenaHalf) shift = arenaHalf - right;
  return [clampArena(na + shift), clampArena(nb + shift)];
}
