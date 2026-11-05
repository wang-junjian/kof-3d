import * as THREE from 'three';
import { PUSH_HALF } from '../core/frames';
import type { WorldBox } from '../core/hitbox';
import type { Match } from '../core/match';

const UNIT_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

function wire(color: number): THREE.LineSegments {
  const material = new THREE.LineBasicMaterial({
    color, transparent: true, opacity: 0.92, depthTest: false,
  });
  const line = new THREE.LineSegments(UNIT_EDGES, material);
  line.renderOrder = 999;
  return line;
}

/**
 * 判定框可视化（调试用，默认关闭）：每人三个线框——
 * 青色 hurtbox、红色 active hitbox、绿色 pushbox。
 * 直接读 Match 的世界 AABB，与结算用的是同一组函数，不会出现"图与判定不一致"。
 */
export class DebugBoxes {
  readonly root = new THREE.Group();
  private readonly boxes: THREE.LineSegments[] = [];
  private visible = false;

  constructor(scene: THREE.Scene, private readonly match: Match) {
    for (let i = 0; i < 6; i++) {
      const color = i % 3 === 0 ? 0x66ccff : i % 3 === 1 ? 0xff5a6e : 0xb9f24a;
      const box = wire(color);
      this.boxes.push(box);
      this.root.add(box);
    }
    this.root.visible = false;
    scene.add(this.root);
  }

  get enabled(): boolean {
    return this.visible;
  }

  get count(): number {
    return this.boxes.length;
  }

  setEnabled(on: boolean): void {
    this.visible = on;
    this.root.visible = on;
  }

  private place(box: THREE.LineSegments, w: WorldBox, z: number): void {
    box.scale.set(
      Math.max(0.001, w.maxX - w.minX),
      Math.max(0.001, w.maxY - w.minY),
      0.05,
    );
    box.position.set((w.minX + w.maxX) / 2, (w.minY + w.maxY) / 2, z);
    box.visible = true;
  }

  update(): void {
    if (!this.visible) return;
    const fighters = [this.match.p1, this.match.p2];
    for (let i = 0; i < 2; i++) {
      const f = fighters[i];
      this.place(this.boxes[i * 3], f.hurtbox(), 0.55);

      const hit = f.activeHitbox();
      const hitBox = this.boxes[i * 3 + 1];
      if (hit) this.place(hitBox, hit, 0.60);
      else hitBox.visible = false;

      this.place(this.boxes[i * 3 + 2], {
        minX: f.x - PUSH_HALF, maxX: f.x + PUSH_HALF,
        minY: 0, maxY: 1.8,
      }, 0.50);
    }
  }
}
