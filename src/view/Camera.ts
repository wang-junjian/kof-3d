import * as THREE from 'three';

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

/**
 * 固定侧视 2.5D 镜头：跟随两人中点、随距离拉远，命中时震屏 + 短促推镜，KO 走低机位特写。
 * 推镜用 FOV 收窄而非拉近距离，避免破坏 update() 里按 aspect 反算的「两人始终入画」约束。
 */
export class GameCamera {
  readonly cam: THREE.PerspectiveCamera;
  private shake = 0;
  private seed = 991;
  private readonly baseY = 1.55;
  private readonly baseFov = 34;
  private x = 0;
  private z = 6.4;
  private aspect = 1.6;
  private zoom = 0;
  private focusX = 0;
  private koZoom = 0;
  private koTarget = 0;
  private koFocusX = 0;
  private lastFov = 34;
  private lookX = 0;

  constructor(aspect: number) {
    this.aspect = aspect;
    this.cam = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.1, 100);
    this.cam.position.set(0, this.baseY, this.z);
    this.cam.lookAt(0, 1.02, 0);
  }

  resize(aspect: number): void {
    this.aspect = aspect;
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
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

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  update(p1x: number, p2x: number): void {
    const mid = (p1x + p2x) / 2;
    const gap = Math.abs(p1x - p2x);
    const wantX = mid * 0.45;
    // 竖屏时横向视野会急剧收窄，按 aspect 反算所需距离，保证两人始终入画
    const halfFov = (this.baseFov * Math.PI) / 360;
    // 余量要覆盖角色自身宽度，否则两人虽"在画面内"但外侧肩膀会被裁掉
    const zForWidth = (gap / 2 + 1.10) / (Math.tan(halfFov) * this.aspect);
    this.zoom *= 0.86;
    if (this.zoom < 0.002) this.zoom = 0;
    this.focusX *= 0.88;
    this.koZoom += (this.koTarget - this.koZoom) * 0.055;

    const fov = this.baseFov - this.zoom * 2.6 - this.koZoom * 4.4;
    if (Math.abs(fov - this.lastFov) > 0.005) {
      this.cam.fov = fov;
      this.lastFov = fov;
      this.cam.updateProjectionMatrix();
    }
    // KO 时允许轻微压近，幅度刻意小于推镜，避免把败者推出画外
    const wantZ = Math.max(5.55 + gap * 0.28, Math.min(14, zForWidth)) - this.koZoom * 0.42;
    this.x += (wantX - this.x) * 0.065;
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
    this.lookX = this.x * 0.55 + this.focusX + this.koFocusX * this.koZoom * 0.42;
    this.cam.position.set(this.x + sx, this.baseY + sy - this.koZoom * 0.10, this.z);
    this.cam.lookAt(this.lookX, 1.02 - this.koZoom * 0.06, 0);
  }
}
