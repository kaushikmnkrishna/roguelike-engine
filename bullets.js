/**
 * Bullet module — small rectangles that move in a fixed direction.
 * Used for player shooting; collision with walls or enemy handled by main loop.
 */

export class Bullet {
  /**
   * @param {number} x - Center x
   * @param {number} y - Center y
   * @param {number} dx - Velocity x (per frame)
   * @param {number} dy - Velocity y (per frame)
   * @param {number} w - Width
   * @param {number} h - Height
   */
  constructor(x, y, dx, dy, w = 6, h = 6) {
    this.x = x;
    this.y = y;
    this.dx = dx;
    this.dy = dy;
    this.w = w;
    this.h = h;
  }

  /**
   * Bullet AABB (center-based), for overlap checks.
   * @returns {{ left: number, right: number, top: number, bottom: number }}
   */
  getAABB() {
    const hw = this.w / 2;
    const hh = this.h / 2;
    return {
      left: this.x - hw,
      right: this.x + hw,
      top: this.y - hh,
      bottom: this.y + hh,
    };
  }

  /**
   * Move bullet by its velocity each frame.
   *
   * Movement: bullets travel in a straight line. We add (dx, dy) to position
   * every frame. No gravity or drag.
   *
   * Collision: not handled here. The game loop checks bullet AABB vs walls
   * (overlap → remove bullet) and vs enemy (overlap → remove bullet and enemy).
   */
  update() {
    this.x += this.dx;
    this.y += this.dy;
  }

  /**
   * Draw the bullet as a small filled rectangle.
   * Spawn pop: if spawnTime is set, bullet draws larger for ~50ms then scales to normal. Visual only; getAABB() unchanged.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    let drawW = this.w;
    let drawH = this.h;
    if (this.spawnTime != null) {
      const age = performance.now() - this.spawnTime;
      const POP_MS = 50;
      const POP_SCALE = 1.35;
      if (age < POP_MS) {
        const t = age / POP_MS;
        const scale = 1 + (POP_SCALE - 1) * (1 - t); // Shooting visual: spawn pop (large -> normal)
        drawW = this.w * scale;
        drawH = this.h * scale;
      }
    }
    const left = this.x - drawW / 2;
    const top = this.y - drawH / 2;
    ctx.fillStyle = '#00d9ff';
    ctx.fillRect(left, top, drawW, drawH);
  }
}
