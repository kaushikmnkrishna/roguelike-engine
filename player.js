/**
 * Player module — position, movement, and rendering.
 * Handles WASD movement and AABB collision against room walls.
 */

export class Player {
  /** @param {number} x - Initial x (center) */
  /** @param {number} y - Initial y (center) */
  /** @param {number} w - Width */
  /** @param {number} h - Height */
  /** @param {number} speed - Pixels per frame */
  constructor(x = 400, y = 300, w = 24, h = 24, speed = 4, maxHp = 3) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.speed = speed;
    this.maxHp = maxHp;
    this.currentHp = maxHp;
    /** Facing direction (unit-ish); used for visual orientation. */
    this.lastDx = 1;
    this.lastDy = 0;
  }

  /**
   * Player AABB as { left, right, top, bottom } (center-based).
   * Public for overlap checks (e.g. enemy touch).
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
   * AABB overlap check.
   * Two axis-aligned rects overlap iff they overlap on both axes:
   * no gap on left/right and no gap on top/bottom.
   * @param {{ left: number, right: number, top: number, bottom: number }} a
   * @param {{ x: number, y: number, w: number, h: number }} b - Wall rect (x,y,w,h)
   */
  _overlapsWall(a, b) {
    const bRight = b.x + b.w;
    const bBottom = b.y + b.h;
    if (a.right <= b.x || a.left >= bRight) return false;
    if (a.bottom <= b.y || a.top >= bBottom) return false;
    return true;
  }

  /**
   * Update position from keys. Uses separate X/Y movement with wall checks
   * so we slide along walls instead of getting stuck on diagonals.
   *
   * Collision logic:
   * - AABB (axis-aligned bounding box): we treat player and walls as rectangles.
   * - Overlap = overlap on both axes (no horizontal gap AND no vertical gap).
   * - We move X first, check vs all walls; if any overlap, we revert the X move.
   * - Then we move Y, check again; revert Y if we hit. That gives smooth sliding.
   *
   * @param {Set<string>} keys - Set of key codes (e.g. 'KeyW', 'KeyA')
   * @param {{ x: number, y: number, w: number, h: number }[]} wallRects - Room wall rects
   */
  update(keys, wallRects = []) {
    let dx = 0;
    let dy = 0;
    if (keys.has('KeyW')) dy -= this.speed;
    if (keys.has('KeyS')) dy += this.speed;
    if (keys.has('KeyA')) dx -= this.speed;
    if (keys.has('KeyD')) dx += this.speed;

    // --- Collision: move X and Y separately, revert axis if we hit a wall ---
    const aabb = () => this.getAABB();

    if (dx !== 0 || dy !== 0) {
      this.lastDx = dx;
      this.lastDy = dy;
    }
    // Apply X move, then check walls. If any overlap, revert X.
    this.x += dx;
    if (wallRects.length) {
      const px = aabb();
      const hit = wallRects.some((w) => this._overlapsWall(px, w));
      if (hit) this.x -= dx;
    }

    // Apply Y move, then check walls. If any overlap, revert Y.
    this.y += dy;
    if (wallRects.length) {
      const py = aabb();
      const hit = wallRects.some((w) => this._overlapsWall(py, w));
      if (hit) this.y -= dy;
    }
  }

  /**
   * Draw the player. Movement tilt/bob, idle breathing/aura, attack pop/recoil/glow, low-HP flicker. Hitbox unchanged.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} [heroCategory] - 'vanguard'|'executioner'|'tactician'
   * @param {HTMLImageElement|null} [sprite] - Transparent PNG for gameplay; optional
   * @param {{ attackPop?: number, isMoving?: boolean, lastDx?: number, lastDy?: number, hpRatio?: number, lastShootDx?: number, lastShootDy?: number }} [opts] - Visual feedback
   */
  draw(ctx, heroCategory = 'vanguard', sprite = null, opts = {}) {
    const hw = this.w / 2;
    const hh = this.h / 2;
    const left = this.x - hw;
    const top = this.y - hh;
    const baseScale = 1.45;
    const t = performance.now() * 0.003;
    const isMoving = opts.isMoving === true;
    const attackPop = Math.min(1, opts.attackPop || 0);
    const lastDx = opts.lastDx ?? this.lastDx;
    const lastDy = opts.lastDy ?? this.lastDy;
    const hpRatio = opts.hpRatio ?? 1;
    const isLowHp = hpRatio < 0.3 && hpRatio > 0;
    const shootDx = opts.lastShootDx ?? 1;
    const shootDy = opts.lastShootDy ?? 0;

    // Movement: controlled tilt (4°), subtle bob 2px
    const bobY = isMoving ? 2 * Math.sin(t * 7) : 0;
    const tiltAmount = isMoving ? 4 : 0;
    const tiltAngle = (lastDx !== 0 || lastDy !== 0) ? Math.atan2(lastDy, lastDx) * (tiltAmount / 90) : 0;

    // Idle: subtle breathing, Attack: small scale pop (1.06), recoil
    const idleBreath = isMoving ? 1 : (1 + 0.012 * Math.sin(t * 2));
    const attackScale = 1 + attackPop * 0.06;
    const recoilPx = attackPop * 4;
    const recoilX = -shootDx * recoilPx;
    const recoilY = -shootDy * recoilPx;

    const drawW = Math.round(this.w * baseScale);
    const drawH = Math.round(this.h * baseScale);
    const scaleMult = idleBreath * attackScale;
    const pw = Math.round(drawW * scaleMult);
    const ph = Math.round(drawH * scaleMult);

    // 1️⃣ Shadow: squish/stretch when moving (ellipse axis aligned to movement)
    const shadowY = this.y + hh + 4 + (bobY * 0.25);
    let shadowW = drawW * 0.6;
    let shadowH = 6;
    if (isMoving && (lastDx !== 0 || lastDy !== 0)) {
      const moveAng = Math.atan2(lastDy, lastDx);
      const squash = 0.85 + 0.2 * Math.abs(Math.sin(t * 7));
      const stretch = 1.15 + 0.15 * Math.abs(Math.cos(t * 6));
      const sx = Math.cos(moveAng) * stretch + Math.abs(Math.sin(moveAng)) * squash;
      const sy = Math.sin(moveAng) * stretch + Math.abs(Math.cos(moveAng)) * squash;
      shadowW *= Math.max(0.7, sx);
      shadowH *= Math.max(0.6, sy);
    } else if (isMoving) {
      shadowW *= 0.95 + 0.1 * Math.abs(Math.sin(t * 7));
      shadowH *= 0.9 + 0.15 * Math.abs(Math.sin(t * 6));
    }
    const shadowGrad = ctx.createRadialGradient(
      this.x, shadowY, 0,
      this.x, shadowY, Math.max(shadowW, shadowH * 3) * 0.5
    );
    shadowGrad.addColorStop(0, isMoving ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.35)');
    shadowGrad.addColorStop(0.6, isMoving ? 'rgba(0,0,0,0.14)' : 'rgba(0,0,0,0.12)');
    shadowGrad.addColorStop(1, 'transparent');
    ctx.save();
    ctx.translate(this.x, shadowY);
    ctx.rotate((lastDx !== 0 || lastDy !== 0) ? Math.atan2(lastDy, lastDx) : 0);
    ctx.translate(-this.x, -shadowY);
    ctx.fillStyle = shadowGrad;
    ctx.beginPath();
    ctx.ellipse(this.x, shadowY, shadowW / 2, shadowH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Subtle hero light radius (controlled glow), Low HP flicker
    const hasAura = !isMoving || isLowHp;
    if (hasAura) {
      const auraAlpha = isLowHp ? (0.18 + 0.12 * Math.sin(t * 10)) : (0.035 + 0.02 * Math.sin(t * 2));
      const auraColor = isLowHp ? 'rgba(200,60,60,' + Math.min(0.9, auraAlpha) + ')' : 'rgba(80,120,180,' + auraAlpha + ')';
      const auraGrad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, drawW * 0.8);
      auraGrad.addColorStop(0, auraColor);
      auraGrad.addColorStop(0.6, 'rgba(0,0,0,0)');
      auraGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(this.x, this.y, drawW * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }

    // Attack: subtle weapon flash
    if (attackPop > 0.4) {
      const flashAlpha = attackPop * 0.25;
      const fx = this.x + shootDx * drawW * 0.35;
      const fy = this.y + shootDy * drawW * 0.35;
      const flashGrad = ctx.createRadialGradient(fx, fy, 0, fx, fy, drawW * 0.4);
      flashGrad.addColorStop(0, 'rgba(200,180,140,' + flashAlpha + ')');
      flashGrad.addColorStop(0.6, 'transparent');
      flashGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = flashGrad;
      ctx.beginPath();
      ctx.arc(fx, fy, drawW * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }

    const pLeft = this.x - pw / 2 + recoilX;
    const pTop = this.y - ph / 2 + bobY + recoilY;
    ctx.save();
    ctx.translate(this.x + recoilX, this.y + bobY + recoilY);
    ctx.rotate(tiltAngle);
    ctx.translate(-(this.x + recoilX), -(this.y + bobY + recoilY));
    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      ctx.drawImage(sprite, pLeft, pTop, pw, ph);
    } else {
      const fill = { vanguard: '#4a5568', executioner: '#c53030', tactician: '#2b6cb0' }[heroCategory] || '#e94560';
      ctx.fillStyle = fill;
      ctx.fillRect(left, top, this.w, this.h);
    }
    ctx.restore();
  }
}
