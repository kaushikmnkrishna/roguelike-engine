/**
 * Enemy module — rectangle entity that moves toward the player.
 * No pathfinding; simple direct movement with wall collision.
 */

/** Visual scale for rendered sprite size only (Chaser, Charger, Sniper, Splitter). Collision uses unscaled w/h. */
const ENEMY_VISUAL_SCALE = 1.12;
/** Visual scale for Boss sprite only (~8–10%). Collision unchanged. */
const BOSS_VISUAL_SCALE = 1.09;

/**
 * Picks a random center position inside the room's walkable floor.
 * Keeps the full enemy rect within the inner area and avoids obstacles and player.
 * Spawn positions are validated; retries if overlap with obstacles or avoidRects.
 *
 * @param {{ x: number, y: number, w: number, h: number }} inner - Room.getInnerRect()
 * @param {number} entityW - Entity width
 * @param {number} entityH - Entity height
 * @param {{ x: number, y: number, w: number, h: number }[]} [obstacles] - Obstacle rects to avoid
 * @param {{ x: number, y: number, w: number, h: number }[]} [avoidRects] - Additional rects (player, other spawns)
 * @returns {{ x: number, y: number }}
 */
export function randomSpawnInRoom(inner, entityW, entityH, obstacles = [], avoidRects = []) {
  const hw = entityW / 2;
  const hh = entityH / 2;
  const allBlocked = [...obstacles, ...avoidRects];
  for (let attempt = 0; attempt < 80; attempt++) {
    const x = inner.x + hw + Math.random() * (inner.w - entityW);
    const y = inner.y + hh + Math.random() * (inner.h - entityH);
    const aabb = {
      left: x - hw,
      right: x + hw,
      top: y - hh,
      bottom: y + hh,
    };
    const hits = allBlocked.some(
      (o) => !(aabb.right <= o.x || aabb.left >= o.x + o.w || aabb.bottom <= o.y || aabb.top >= o.y + o.h)
    );
    if (!hits) return { x, y };
  }
  return {
    x: inner.x + inner.w / 2 - hw,
    y: inner.y + inner.h / 2 - hh,
  };
}

export class Enemy {
  /**
   * @param {number} x - Center x
   * @param {number} y - Center y
   * @param {number} w - Width
   * @param {number} h - Height
   * @param {number} speed - Pixels per frame (use small values for “slow” movement)
   */
  constructor(x, y, w = 20, h = 20, speed = 1.2, health = 2) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.speed = speed;
    this.health = health;
  }

  /**
   * Enemy AABB (center-based), for overlap checks.
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

  _overlapsWall(aabb, wall) {
    const br = wall.x + wall.w;
    const bb = wall.y + wall.h;
    if (aabb.right <= wall.x || aabb.left >= br) return false;
    if (aabb.bottom <= wall.y || aabb.top >= bb) return false;
    return true;
  }

  /**
   * Move toward the player each frame, then resolve wall collisions.
   *
   * Movement logic:
   * - Direction = vector from enemy to player (player - enemy).
   * - Normalize so we move at constant speed regardless of distance.
   * - If length is 0 (already on player), we don’t move to avoid NaN.
   * - Apply dx/dy. We use the same separate X-then-Y wall check as the player:
   *   move X, test walls, revert X if overlap; then move Y, test, revert Y.
   *   That keeps the enemy inside the room and sliding along walls.
   * - No pathfinding: we always move in a straight line toward the player.
   *
   * @param {{ x: number, y: number }} player - Player center
   * @param {{ x: number, y: number, w: number, h: number }[]} wallRects
   */
  update(player, wallRects = []) {
    let dx = player.x - this.x;
    let dy = player.y - this.y;
    const len = Math.hypot(dx, dy);

    if (len > 0) {
      dx /= len;
      dy /= len;
      dx *= this.speed;
      dy *= this.speed;
    } else {
      dx = dy = 0;
    }

    const aabb = () => this.getAABB();

    this.x += dx;
    if (wallRects.length) {
      const ax = aabb();
      if (wallRects.some((w) => this._overlapsWall(ax, w))) this.x -= dx;
    }

    this.y += dy;
    if (wallRects.length) {
      const ay = aabb();
      if (wallRects.some((w) => this._overlapsWall(ay, w))) this.y -= dy;
    }
  }

  /**
   * Draw the enemy using sprite. Centered on (x, y) with size (w, h).
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ [key: string]: HTMLImageElement }} sprites
   */
  draw(ctx, sprites = {}) {
    const sprite = sprites['chaser'];
    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      const drawW = this.w * ENEMY_VISUAL_SCALE;
      const drawH = this.h * ENEMY_VISUAL_SCALE;
      const left = this.x - drawW / 2;
      const top = this.y - drawH / 2;
      const now = performance.now();
      const flashing = this.hitUntil != null && now < this.hitUntil;
      if (flashing) {
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() * 0.03);
        ctx.filter = 'brightness(2)';
      }
      ctx.drawImage(sprite, left, top, drawW, drawH);
      if (flashing) ctx.restore();
    }
  }
}

/** Charger state machine: IDLE (wait) → TELEGRAPH (pause, lock dir) → DASH (fast move) → COOLDOWN (wait) → IDLE. */
const CHARGER_TELEGRAPH_MS = 380;
const CHARGER_DASH_SPEED = 9;
const CHARGER_DASH_DURATION_MS = 220;
const CHARGER_COOLDOWN_MS = 1400;

/**
 * Charger enemy: telegraphs then dashes toward player. State machine ensures readable, fair behavior.
 * Visually distinct (red); does not adjust direction mid-dash; respects room boundaries.
 */
export class Charger {
  constructor(x, y, w = 20, h = 20, health = 2) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.health = health;
    /** State: 'IDLE' | 'TELEGRAPH' | 'DASH' | 'COOLDOWN'. */
    this.chargerState = 'IDLE';
    this.cooldownEnd = 0;
    this.telegraphEnd = 0;
    this.dashEnd = 0;
    this.dashDx = 0;
    this.dashDy = 0;
  }

  getAABB() {
    const hw = this.w / 2;
    const hh = this.h / 2;
    return { left: this.x - hw, right: this.x + hw, top: this.y - hh, bottom: this.y + hh };
  }

  _overlapsWall(aabb, wall) {
    const br = wall.x + wall.w;
    const bb = wall.y + wall.h;
    if (aabb.right <= wall.x || aabb.left >= br) return false;
    if (aabb.bottom <= wall.y || aabb.top >= bb) return false;
    return true;
  }

  /**
   * Charger state machine: IDLE → TELEGRAPH → DASH → COOLDOWN → IDLE.
   * No direction adjustment mid-dash; dash stops on wall hit.
   */
  update(player, wallRects = []) {
    const now = performance.now();
    const aabb = () => this.getAABB();

    if (this.chargerState === 'IDLE') {
      if (now >= this.cooldownEnd) {
        this.chargerState = 'TELEGRAPH';
        this.telegraphEnd = now + CHARGER_TELEGRAPH_MS;
      }
      return;
    }

    if (this.chargerState === 'TELEGRAPH') {
      if (now >= this.telegraphEnd) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          this.dashDx = dx / len;
          this.dashDy = dy / len;
        } else {
          this.dashDx = 1;
          this.dashDy = 0;
        }
        this.chargerState = 'DASH';
        this.dashEnd = now + CHARGER_DASH_DURATION_MS;
      }
      return;
    }

    if (this.chargerState === 'DASH') {
      const dashSpeed = (this.eliteSpeedMult ?? 1) * CHARGER_DASH_SPEED;
      const stepX = this.dashDx * dashSpeed;
      const stepY = this.dashDy * dashSpeed;
      this.x += stepX;
      this.y += stepY;
      if (wallRects.length) {
        const ax = aabb();
        if (wallRects.some((w) => this._overlapsWall(ax, w))) {
          this.x -= stepX;
          this.y -= stepY;
          this.chargerState = 'COOLDOWN';
          this.cooldownEnd = now + CHARGER_COOLDOWN_MS;
        }
      }
      if (now >= this.dashEnd) {
        this.chargerState = 'COOLDOWN';
        this.cooldownEnd = now + CHARGER_COOLDOWN_MS;
      }
      return;
    }

    // COOLDOWN
    if (now >= this.cooldownEnd) {
      this.chargerState = 'IDLE';
    }
  }

  draw(ctx, sprites = {}) {
    const sprite = sprites['charger'];
    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      const drawW = this.w * ENEMY_VISUAL_SCALE;
      const drawH = this.h * ENEMY_VISUAL_SCALE;
      const left = this.x - drawW / 2;
      const top = this.y - drawH / 2;
      const now = performance.now();
      const flashing = this.hitUntil != null && now < this.hitUntil;
      if (flashing) {
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() * 0.03);
        ctx.filter = 'brightness(2)';
      }
      ctx.drawImage(sprite, left, top, drawW, drawH);
      if (flashing) ctx.restore();
    }
  }
}

/** Sniper state machine: MOVE (maintain distance) → AIM (stop, face player) → SHOOT (fire) → COOLDOWN (wait) → MOVE. */
const SNIPER_PREFERRED_DIST = 180;
const SNIPER_AIM_MS = 350;
const SNIPER_COOLDOWN_MS = 1600;
const SNIPER_PROJECTILE_SPEED = 6;

/** Splitter child: smaller, faster, 1 HP, does NOT split again. Exported for main.js spawn. */
export const SPLITTER_CHILD_W = 12;
export const SPLITTER_CHILD_H = 12;
export const SPLITTER_CHILD_SPEED = 1.8;

/**
 * Sniper enemy: maintains distance, periodically shoots. Lower HP (1). State: MOVE → AIM → SHOOT → COOLDOWN.
 * Calls spawnProjectile(x, y, dx, dy) when shooting. Respects room boundaries.
 */
export class Sniper {
  constructor(x, y, w = 20, h = 20, health = 1) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.health = health;
    this.sniperState = 'MOVE';
    this.cooldownEnd = 0;
    this.aimEnd = 0;
    this.aimDx = 0;
    this.aimDy = 0;
  }

  getAABB() {
    const hw = this.w / 2;
    const hh = this.h / 2;
    return { left: this.x - hw, right: this.x + hw, top: this.y - hh, bottom: this.y + hh };
  }

  _overlapsWall(aabb, wall) {
    const br = wall.x + wall.w;
    const bb = wall.y + wall.h;
    if (aabb.right <= wall.x || aabb.left >= br) return false;
    if (aabb.bottom <= wall.y || aabb.top >= bb) return false;
    return true;
  }

  /**
   * Sniper state machine: MOVE (maintain distance) → AIM (telegraph) → SHOOT (spawn projectile) → COOLDOWN.
   * spawnProjectile(x, y, dx, dy) is called when transitioning from AIM to COOLDOWN.
   */
  update(player, wallRects = [], spawnProjectile = () => {}) {
    const now = performance.now();
    const aabb = () => this.getAABB();
    const dist = Math.hypot(player.x - this.x, player.y - this.y);

    if (this.sniperState === 'MOVE') {
      if (now >= this.cooldownEnd) {
        this.sniperState = 'AIM';
        this.aimEnd = now + SNIPER_AIM_MS;
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          this.aimDx = dx / len;
          this.aimDy = dy / len;
        } else {
          this.aimDx = 1;
          this.aimDy = 0;
        }
      } else {
        let dx = 0;
        let dy = 0;
        if (dist > 0) {
          const toPlayerX = (player.x - this.x) / dist;
          const toPlayerY = (player.y - this.y) / dist;
          const mult = this.eliteSpeedMult ?? 1;
          if (dist < SNIPER_PREFERRED_DIST) {
            dx = -toPlayerX * 1.4 * mult;
            dy = -toPlayerY * 1.4 * mult;
          } else if (dist > SNIPER_PREFERRED_DIST + 40) {
            dx = toPlayerX * 1 * mult;
            dy = toPlayerY * 1 * mult;
          }
        }
        this.x += dx;
        this.y += dy;
        if (wallRects.length) {
          const ax = aabb();
          if (wallRects.some((w) => this._overlapsWall(ax, w))) {
            this.x -= dx;
            this.y -= dy;
          }
        }
      }
      return;
    }

    if (this.sniperState === 'AIM') {
      if (now >= this.aimEnd) {
        spawnProjectile(this.x, this.y, this.aimDx * SNIPER_PROJECTILE_SPEED, this.aimDy * SNIPER_PROJECTILE_SPEED);
        this.sniperState = 'COOLDOWN';
        this.cooldownEnd = now + SNIPER_COOLDOWN_MS;
      }
      return;
    }

    if (this.sniperState === 'COOLDOWN') {
      if (now >= this.cooldownEnd) {
        this.sniperState = 'MOVE';
      }
    }
  }

  draw(ctx, sprites = {}) {
    const sprite = sprites['sniper'];
    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      const drawW = this.w * ENEMY_VISUAL_SCALE;
      const drawH = this.h * ENEMY_VISUAL_SCALE;
      const left = this.x - drawW / 2;
      const top = this.y - drawH / 2;
      const now = performance.now();
      const flashing = this.hitUntil != null && now < this.hitUntil;
      if (flashing) {
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() * 0.03);
        ctx.filter = 'brightness(2)';
      }
      ctx.drawImage(sprite, left, top, drawW, drawH);
      if (flashing) ctx.restore();
    }
  }
}

/**
 * Splitter enemy: moves like normal enemy. On death, spawns 2 smaller fast enemies (isSplitterChild).
 * Children do NOT split again. Health = 2; children have 1 HP.
 */
export class Splitter {
  constructor(x, y, w = 20, h = 20, speed = 1.2, health = 2, isSplitterChild = false) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.speed = speed;
    this.health = health;
    this.isSplitterChild = isSplitterChild;
  }

  getAABB() {
    const hw = this.w / 2;
    const hh = this.h / 2;
    return { left: this.x - hw, right: this.x + hw, top: this.y - hh, bottom: this.y + hh };
  }

  _overlapsWall(aabb, wall) {
    const br = wall.x + wall.w;
    const bb = wall.y + wall.h;
    if (aabb.right <= wall.x || aabb.left >= br) return false;
    if (aabb.bottom <= wall.y || aabb.top >= bb) return false;
    return true;
  }

  update(player, wallRects = []) {
    let dx = player.x - this.x;
    let dy = player.y - this.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
      dx *= this.speed;
      dy *= this.speed;
    } else {
      dx = dy = 0;
    }
    const aabb = () => this.getAABB();
    this.x += dx;
    if (wallRects.length && wallRects.some((w) => this._overlapsWall(aabb(), w))) this.x -= dx;
    this.y += dy;
    if (wallRects.length && wallRects.some((w) => this._overlapsWall(aabb(), w))) this.y -= dy;
  }

  draw(ctx, sprites = {}) {
    const sprite = sprites['splitter'];
    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      const drawW = this.w * ENEMY_VISUAL_SCALE;
      const drawH = this.h * ENEMY_VISUAL_SCALE;
      const left = this.x - drawW / 2;
      const top = this.y - drawH / 2;
      const flashing = this.hitUntil != null && performance.now() < this.hitUntil;
      if (flashing) {
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() * 0.03);
        ctx.filter = 'brightness(2)';
      }
      ctx.drawImage(sprite, left, top, drawW, drawH);
      if (flashing) ctx.restore();
    }
  }
}

/** Boss dash timing: cooldown between dashes, windup telegraph, dash distance and speed. */
const BOSS_DASH_COOLDOWN_MS = 2200;
const BOSS_DASH_WINDUP_MS = 450;
const BOSS_DASH_DISTANCE = 120;
const BOSS_DASH_SPEED = 11;

/**
 * Boss enemy: larger, higher health, faster movement than normal enemies.
 * Secondary behavior: periodic dash toward the player (windup telegraph, then quick dash).
 * Basic attack = touch (resets player). Doors lock during fight; unlock when health reaches 0.
 */
export class Boss {
  constructor(x, y, w = 48, h = 48, speed = 2.2, health = 28) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.speed = speed;
    this.health = health;
    this.maxHealth = health;
    /** Dash state: 'idle' (normal chase), 'windup' (telegraph), 'dashing'. */
    this.dashState = 'idle';
    /** When the current dash cooldown ends; next dash can start. */
    this.dashCooldownEnd = 0;
    /** When windup ends and dash begins. */
    this.windupEnd = 0;
    /** Dash direction (unit-ish); used during dashing. */
    this.dashDx = 0;
    this.dashDy = 0;
    /** Pixels remaining to travel in current dash. */
    this.dashRemaining = 0;
  }

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

  _overlapsWall(aabb, wall) {
    const br = wall.x + wall.w;
    const bb = wall.y + wall.h;
    if (aabb.right <= wall.x || aabb.left >= br) return false;
    if (aabb.bottom <= wall.y || aabb.top >= bb) return false;
    return true;
  }

  /**
   * Boss movement: normal chase when idle; periodic dash toward player.
   * Dash timing: cooldown → windup (telegraph, no movement) → dashing (fast movement).
   * Dash stops on wall hit to keep behavior readable and fair.
   */
  update(player, wallRects = []) {
    const now = performance.now();
    const aabb = () => this.getAABB();

    if (this.dashState === 'idle') {
      // Dash cooldown check: start windup when cooldown elapsed.
      if (now >= this.dashCooldownEnd) {
        this.dashState = 'windup';
        this.windupEnd = now + BOSS_DASH_WINDUP_MS;
        return; // No movement this frame; telegraph starts.
      }
      // Normal chase movement (faster than default enemies via this.speed).
      let dx = player.x - this.x;
      let dy = player.y - this.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        dx /= len;
        dy /= len;
        dx *= this.speed;
        dy *= this.speed;
      } else {
        dx = dy = 0;
      }
      this.x += dx;
      if (wallRects.length && wallRects.some((w) => this._overlapsWall(aabb(), w))) this.x -= dx;
      this.y += dy;
      if (wallRects.length && wallRects.some((w) => this._overlapsWall(aabb(), w))) this.y -= dy;
      return;
    }

    if (this.dashState === 'windup') {
      // Telegraph: boss stays still. Player can dodge before dash.
      if (now >= this.windupEnd) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          this.dashDx = dx / len;
          this.dashDy = dy / len;
        } else {
          this.dashDx = 1;
          this.dashDy = 0;
        }
        this.dashRemaining = BOSS_DASH_DISTANCE;
        this.dashState = 'dashing';
      }
      return;
    }

    // dashState === 'dashing'
    const move = Math.min(this.dashRemaining, BOSS_DASH_SPEED);
    const stepX = this.dashDx * move;
    const stepY = this.dashDy * move;
    this.x += stepX;
    this.y += stepY;
    this.dashRemaining -= move;

    if (wallRects.length) {
      const ax = aabb();
      if (wallRects.some((w) => this._overlapsWall(ax, w))) {
        this.x -= stepX;
        this.y -= stepY;
        this.dashRemaining = 0;
      }
    }

    if (this.dashRemaining <= 0) {
      this.dashState = 'idle';
      this.dashCooldownEnd = now + BOSS_DASH_COOLDOWN_MS;
    }
  }

  draw(ctx, sprites = {}) {
    const sprite = sprites['boss'];
    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      const drawW = this.w * BOSS_VISUAL_SCALE;
      const drawH = this.h * BOSS_VISUAL_SCALE;
      const left = this.x - drawW / 2;
      const top = this.y - drawH / 2;
      const now = performance.now();
      const flashing = this.hitUntil != null && now < this.hitUntil;
      if (flashing) {
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() * 0.03);
        ctx.filter = 'brightness(2)';
      }
      ctx.drawImage(sprite, left, top, drawW, drawH);
      if (flashing) ctx.restore();
    }
  }
}
