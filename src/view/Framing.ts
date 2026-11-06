import { ARENA_HALF, PUSH_HALF } from '../core/frames';

/** 相机垂直 FOV（度）；命中推镜 / KO 特写在这个基准上收窄。 */
export const BASE_FOV = 34;
/** 横屏 / 桌面的默认相机距离，沿用改动前的值。 */
export const BASE_CAMERA_Z = 6.4;
/** 相机距离上限：极端窄视口或调试摆拍时兜底，避免无限拉远。 */
export const MAX_CAMERA_Z = 30;
/**
 * 角色中心到外侧还需预留的世界宽度：站立 hurtbox 半宽 0.38，
 * 加挥拳 / 踢腿伸展约 0.32。可见半宽 = 场地半宽 + 该余量时，
 * 站到边线的角色也不会被裁掉肩膀或拳脚。
 */
export const BODY_MARGIN = 0.70;
/** 竖屏目标场地半宽：两人最大间距 2.6，仍够前后步与击退。 */
export const PORTRAIT_TARGET_HALF = 1.30;
/** 场地半宽下限：必须容得下两人推挤盒（2 * PUSH_HALF = 0.60）再留余量。 */
export const MIN_ARENA_HALF = PUSH_HALF * 2 + 0.28;

export interface Framing {
  aspect: number;
  /** 竖屏（aspect < 1）：镜头跟紧中点、演出让位于可见性。 */
  portrait: boolean;
  /** 保证「arenaHalf + BODY_MARGIN」入画的相机距离。 */
  cameraZ: number;
  /** 角色可活动的世界半宽；横屏恒为 ARENA_HALF。 */
  arenaHalf: number;
  /** cameraZ + BASE_FOV 下 z=0 平面的横向可见半宽。 */
  visibleHalf: number;
}

/** z = 0 平面（角色所在深度）的横向可见半宽，透视投影的直接解。 */
export function visibleHalf(atZ: number, fovDeg: number, aspect: number): number {
  return atZ * Math.tan((fovDeg * Math.PI) / 360) * Math.max(0.05, aspect);
}

/** 反算：让 needHalf 刚好入画所需的相机距离。 */
export function zForWidth(needHalf: number, fovDeg: number, aspect: number): number {
  return needHalf / (Math.tan((fovDeg * Math.PI) / 360) * Math.max(0.05, aspect));
}

/**
 * 视口取景契约：把「窗口有多宽」翻译成「场地可以多宽 + 相机该站多远」。
 *
 * 横屏 / 桌面一律保持原场地 3.35 与默认机位不变；两人拉开时仍由
 * GameCamera.update() 按 gap 动态拉远。只有竖屏（aspect < 1）才把场地
 * 收进画面内 —— 否则 390px 宽的窗口要靠把相机拉到 z≈29 才能装下
 * ±3.35，角色会缩成几十像素的小点，即便"没出画"也没法玩。
 *
 * 纯函数、无 DOM / WebGL 依赖，可直接被逻辑层单测引用。
 */
export function framingFor(rawAspect: number): Framing {
  const aspect = Math.max(0.15, Math.min(8, rawAspect || 1.6));
  const tan = Math.tan((BASE_FOV * Math.PI) / 360);
  if (aspect >= 1) {
    return {
      aspect,
      portrait: false,
      cameraZ: BASE_CAMERA_Z,
      arenaHalf: ARENA_HALF,
      visibleHalf: BASE_CAMERA_Z * tan * aspect,
    };
  }
  const target = Math.min(ARENA_HALF, PORTRAIT_TARGET_HALF);
  const needHalf = target + BODY_MARGIN;
  const cameraZ = Math.min(MAX_CAMERA_Z, Math.max(BASE_CAMERA_Z, needHalf / (tan * aspect)));
  const vis = cameraZ * tan * aspect;
  const arenaHalf = Math.max(MIN_ARENA_HALF, Math.min(ARENA_HALF, vis - BODY_MARGIN));
  return { aspect, portrait: true, cameraZ, arenaHalf, visibleHalf: vis };
}
