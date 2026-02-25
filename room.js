/**
 * Dungeon room — rectangle with solid walls and inner floor.
 * Exposes wall rects for collision and draws the room.
 */

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 */

export class Room {
  /**
   * @param {number} x - Top-left x of outer room rect
   * @param {number} y - Top-left y of outer room rect
   * @param {number} width - Total room width
   * @param {number} height - Total room height
   * @param {number} wallThickness - Wall width in pixels
   */
  constructor(x = 80, y = 60, width = 640, height = 480, wallThickness = 20) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.wallThickness = wallThickness;
  }

  /**
   * Wall rects in order: left, right, top, bottom.
   * Used for AABB collision — player must not overlap any.
   * @returns {Rect[]}
   */
  getWallRects() {
    const { x, y, width, height, wallThickness: t } = this;
    return [
      { x, y, w: t, h: height },                                    // left
      { x: x + width - t, y, w: t, h: height },                     // right
      { x, y, w: width, h: t },                                     // top
      { x, y: y + height - t, w: width, h: t },                     // bottom
    ];
  }

  /**
   * Inner floor rect (walkable area). Used for spawn / draw.
   * @returns {{ x: number, y: number, w: number, h: number }}
   */
  getInnerRect() {
    const t = this.wallThickness;
    return {
      x: this.x + t,
      y: this.y + t,
      w: this.width - 2 * t,
      h: this.height - 2 * t,
    };
  }

  /**
   * Center of the room (for spawning player).
   * @returns {{ x: number, y: number }}
   */
  getCenter() {
    return {
      x: this.x + this.width / 2,
      y: this.y + this.height / 2,
    };
  }

  /**
   * Draw room: floor first, then walls so it feels enclosed.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    const inner = this.getInnerRect();
    const walls = this.getWallRects();

    // Floor — darker, clearly inside
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);

    // Walls — solid, visible border
    ctx.fillStyle = '#0f3460';
    for (const r of walls) {
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    // Wall outline for clarity
    ctx.strokeStyle = '#533483';
    ctx.lineWidth = 2;
    ctx.strokeRect(this.x, this.y, this.width, this.height);
  }
}
