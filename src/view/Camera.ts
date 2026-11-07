import * as THREE from 'three';
import {
  BASE_FOV, BODY_MARGIN, MAX_CAMERA_Z, framingFor, visibleHalf, zForWidth,
  type Framing,
} from './Framing';

export interface CameraDebug {
  /** 命中推镜强度 0..1，指数回弹到 0。 */
  zoom: number;
  /** KO 特写当前插值 0..1。 */
  koZoom: number;
  /** KO 特写是否已激活（同步推进逻辑时也可判定）。 */
  koActive: boolean;
  fov: number;
  lookX: number;
}

/** 视口取景探针：自检用它做「两人始终入画」的真实投影断言。 */
export interface FramingProbe {
  aspect: number;
  /** 竖屏：场地收窄、镜头跟紧、演出减弱。 */
  portrait: boolean;
  /** 基准相机距离。 */
  cameraZ: number;
  /** 当前相机距离（含动态拉远）。 */
  z: number;
  /** 当前允许的角色活动半宽。 */
  arenaHalf: number;
  /** 当前 FOV / 距离下 z=0 平面的横向可见半宽。 */
  visibleHalf: number;
  fov: number;
  lookX: number;
  /** 两名角色当前世界 x 在相机下的 NDC 横坐标；绝对值 <= 1 即在画面内。 */
  ndc: [number, number];
}

/**
 * 固定侧视 2.5D 镜头：跟随两人中点、随距离拉远，命中时震屏 + 短促推镜，KO 走低机位特写。
 *
 * 横屏保持原有视差与演出；竖屏（aspect < 1）改由 Framing 契约收紧场地、
 * 跟紧中点并减弱偏心，最后用真实投影做硬性兜底，保证两人绝不出画。
 */
export class GameCamera {
  readonly cam: THREE.PerspectiveCamera;
  private shake = 0;
  private seed = 991;
  // 机位高度不能低于 1.55：地板 PlaneGeometry 铺到相机脚下，俯角再小就会
  // 把角色小腿整段遮住（实测 1.46 时腿部被地板横向切断）。拉近同样减小俯角，
  // 因此横屏基准距离也保持 5.55，改用轮廓光与几何细节提升角色存在感。
  private readonly baseY = 1.55;
  private x = 0;
  private z = 6.4;
  private aspect = 1.6;
  private framing: Framing;
  private zoom = 0;
  private focusX = 0;
  private koZoom = 0;
  private koTarget = 0;
  private koFocusX = 0;
  private lastFov = BASE_FOV;
  private lookX = 0;
  private readonly probeVec = new THREE.Vector3();
  private ndc: [number, number] = [0, 0];
  private currentVisibleHalf = 0;

  constructor(aspect: number) {
    this.aspect = aspect;
    this.framing = framingFor(aspect);
    this.z = this.framing.cameraZ;
    this.currentVisibleHalf = this.framing.visibleHalf;
    this.cam = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 100);
    this.cam.position.set(0, this.baseY, this.z);
    this.cam.lookAt(0, 1.02, 0);
  }

  /** 视口适配层从这里同步场地边界，保证相机与逻辑层读的是同一份契约。 */
  get framingState(): Framing {
    return this.framing;
  }

  resize(aspect: number): void {
    this.aspect = aspect;
    this.framing = framingFor(aspect);
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
    // 旋转进窄视口时立刻拉远（拉远只会多看见、不会出画）；拉近仍走平滑。
    if (this.framing.cameraZ > this.z) {
      this.z = this.framing.cameraZ;
      this.cam.position.z = this.z;
    }
    this.currentVisibleHalf = visibleHalf(this.z, this.cam.fov, aspect);
  }

  punch(strength: number): void {
    this.shake = Math.max(this.shake, strength);
  }

  /** 命中推镜：瞬间收窄 FOV 并把焦点拉向命中点，随后逐帧指数回弹。 */
  impact(x: number, strength: number): void {
    this.zoom = Math.max(this.zoom, Math.min(1, strength));
    this.focusX = x * 0.30;
  }

  /** KO 特写：慢推、低机位、焦点偏向胜者；持续到下一回合 reset()。 */
  ko(winnerX: number): void {
    this.koTarget = 1;
    this.koFocusX = winnerX;
  }

  /** 回合重开是硬切，特写直接归零，不留下缓慢回弹的镜头偏差。 */
  reset(): void {
    this.koTarget = 0;
    this.koFocusX = 0;
    this.koZoom = 0;
    this.zoom = 0;
    this.focusX = 0;
  }

  inspect(): CameraDebug {
    return {
      zoom: this.zoom, koZoom: this.koZoom, koActive: this.koTarget > 0,
      fov: this.cam.fov, lookX: this.lookX,
    };
  }

  framingProbe(): FramingProbe {
    return {
      aspect: this.aspect,
      portrait: this.framing.portrait,
      cameraZ: this.framing.cameraZ,
      z: this.z,
      arenaHalf: this.framing.arenaHalf,
      visibleHalf: this.currentVisibleHalf,
      fov: this.cam.fov,
      lookX: this.lookX,
      ndc: [this.ndc[0], this.ndc[1]],
    };
  }

  /** 用当前相机矩阵把任意两个世界 x 投影到 NDC，供自检验证极端站位。 */
  project(x1: number, x2: number): [number, number] {
    this.cam.updateMatrixWorld();
    return [this.projectX(x1), this.projectX(x2)];
  }

  private projectX(x: number): number {
    return this.probeVec.set(x, 1.02, 0).project(this.cam).x;
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  update(p1x: number, p2x: number): void {
    const mid = (p1x + p2x) / 2;
    const gap = Math.abs(p1x - p2x);
    const portrait = this.framing.portrait;

    this.zoom *= 0.86;
    if (this.zoom < 0.002) this.zoom = 0;
    this.focusX *= 0.88;
    this.koZoom += (this.koTarget - this.koZoom) * 0.055;

    // 竖屏大幅减弱推镜：FOV 收窄会同步缩小可见宽度，可见性优先于演出。
    const fov = BASE_FOV
      - this.zoom * (portrait ? 1.2 : 2.6)
      - this.koZoom * (portrait ? 2.0 : 4.4);
    if (Math.abs(fov - this.lastFov) > 0.005) {
      this.cam.fov = fov;
      this.lastFov = fov;
      this.cam.updateProjectionMatrix();
    }

    // 横屏保留原有轻微视差；竖屏跟紧两人中点，否则整组人会偏出窄画面。
    const wantX = portrait ? mid : mid * 0.45;
    this.x += (wantX - this.x) * (portrait ? 0.30 : 0.065);

    // 按当前 FOV 反算，推镜收窄时同步补偿可见宽度；横屏沿用原本 1.10 的余量。
    const needHalf = gap / 2 + (portrait ? BODY_MARGIN : 1.10);
    const wantZ = Math.max(
      portrait ? this.framing.cameraZ : 5.55 + gap * 0.28,
      Math.min(MAX_CAMERA_Z, zForWidth(needHalf, fov, this.aspect)),
    ) - this.koZoom * 0.42;
    this.z += (wantZ - this.z) * 0.045;

    let sx = 0;
    let sy = 0;
    if (this.shake > 0.002) {
      sx = (this.rnd() - 0.5) * this.shake;
      sy = (this.rnd() - 0.5) * this.shake * 0.7;
      this.shake *= 0.84;
    } else {
      this.shake = 0;
    }

    // 竖屏几乎不偏心：命中推镜与 KO 特写都不能把另一侧角色挤出去。
    this.lookX = portrait
      ? this.x + this.focusX * 0.12 + this.koFocusX * this.koZoom * 0.08
      : this.x * 0.55 + this.focusX + this.koFocusX * this.koZoom * 0.42;
    this.cam.position.set(this.x + sx, this.baseY + sy - this.koZoom * 0.10, this.z);
    this.cam.lookAt(this.lookX, 1.02 - this.koZoom * 0.06, 0);
    this.cam.updateMatrixWorld();

    // 硬兜底：用真实投影判定而非公式假设。无论推镜、KO 偏心、镜头滞后、
    // 旋转瞬间还是调试摆拍，两人中心都必须留在画面内（边缘留 4%~8%）。
    let n1 = this.projectX(p1x);
    let n2 = this.projectX(p2x);
    const limit = portrait ? 0.92 : 0.96;
    const worst = Math.max(Math.abs(n1), Math.abs(n2));
    if (worst > limit) {
      this.z = Math.min(MAX_CAMERA_Z, this.z * (worst / limit));
      this.cam.position.z = this.z;
      this.cam.updateMatrixWorld();
      n1 = this.projectX(p1x);
      n2 = this.projectX(p2x);
    }
    this.ndc = [n1, n2];
    this.currentVisibleHalf = visibleHalf(this.z, fov, this.aspect);
  }
}
