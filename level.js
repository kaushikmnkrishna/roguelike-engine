/**
 * Level — multi-room layout, doors, and wall segments.
 * Same room size for all rooms; doors are rectangles in walls.
 */

/**
 * @typedef {{ wall: 'left'|'right'|'top'|'bottom', offset: number, length: number, connectsTo: number }} DoorConfig
 */

/**
 * Compute world rect for a door. offset = distance from top (L/R walls) or left (T/B).
 * length = size along the wall. Depth = wall thickness.
 * @param {{ x: number, y: number, width: number, height: number, wallThickness: number }} room
 * @param {DoorConfig} door
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function getDoorRect(room, door) {
  const { x: rx, y: ry, width: W, height: H, wallThickness: t } = room;
  const o = door.offset;
  const L = door.length;
  switch (door.wall) {
    case 'left':
      return { x: rx, y: ry + o, w: t, h: L };
    case 'right':
      return { x: rx + W - t, y: ry + o, w: t, h: L };
    case 'top':
      return { x: rx + o, y: ry, w: L, h: t };
    case 'bottom':
      return { x: rx + o, y: ry + H - t, w: L, h: t };
    default:
      return { x: rx, y: ry, w: t, h: L };
  }
}

/**
 * Wall segments for collision (walls minus door holes). One door per wall supported.
 * @param {{ x: number, y: number, width: number, height: number, wallThickness: number }} room
 * @param {DoorConfig[]} doors
 * @returns {{ x: number, y: number, w: number, h: number }[]}
 */
export function getWallSegments(room, doors) {
  const { x: rx, y: ry, width: W, height: H, wallThickness: t } = room;
  const segs = [];

  const byWall = { left: [], right: [], top: [], bottom: [] };
  for (const d of doors) {
    const r = getDoorRect(room, d);
    byWall[d.wall].push({ ...r, connectsTo: d.connectsTo });
  }

  // Left wall: one full rect or split by door
  const leftDoor = byWall.left[0];
  if (!leftDoor) {
    segs.push({ x: rx, y: ry, w: t, h: H });
  } else {
    if (leftDoor.y > ry) segs.push({ x: rx, y: ry, w: t, h: leftDoor.y - ry });
    if (leftDoor.y + leftDoor.h < ry + H) segs.push({ x: rx, y: leftDoor.y + leftDoor.h, w: t, h: ry + H - (leftDoor.y + leftDoor.h) });
  }

  const rightDoor = byWall.right[0];
  if (!rightDoor) {
    segs.push({ x: rx + W - t, y: ry, w: t, h: H });
  } else {
    if (rightDoor.y > ry) segs.push({ x: rx + W - t, y: ry, w: t, h: rightDoor.y - ry });
    if (rightDoor.y + rightDoor.h < ry + H) segs.push({ x: rx + W - t, y: rightDoor.y + rightDoor.h, w: t, h: ry + H - (rightDoor.y + rightDoor.h) });
  }

  const topDoor = byWall.top[0];
  if (!topDoor) {
    segs.push({ x: rx, y: ry, w: W, h: t });
  } else {
    if (topDoor.x > rx) segs.push({ x: rx, y: ry, w: topDoor.x - rx, h: t });
    if (topDoor.x + topDoor.w < rx + W) segs.push({ x: topDoor.x + topDoor.w, y: ry, w: rx + W - (topDoor.x + topDoor.w), h: t });
  }

  const bottomDoor = byWall.bottom[0];
  if (!bottomDoor) {
    segs.push({ x: rx, y: ry + H - t, w: W, h: t });
  } else {
    if (bottomDoor.x > rx) segs.push({ x: rx, y: ry + H - t, w: bottomDoor.x - rx, h: t });
    if (bottomDoor.x + bottomDoor.w < rx + W) segs.push({ x: bottomDoor.x + bottomDoor.w, y: ry + H - t, w: rx + W - (bottomDoor.x + bottomDoor.w), h: t });
  }

  return segs;
}

/**
 * Door rects for the current room (for transition checks and drawing).
 * Each includes connectsTo.
 */
export function getDoorRects(room, doors) {
  return doors.map((d) => ({ ...getDoorRect(room, d), connectsTo: d.connectsTo }));
}

/**
 * Obstacle generation: 2–5 rectangular obstacles per non-boss room.
 * Obstacles must not overlap doors, player spawn (center), or entrance zones.
 * Obstacles are placed in the inner floor; simple rectangle collision.
 *
 * @param {{ x: number, y: number, width: number, height: number, wallThickness: number }} room
 * @param {DoorConfig[]} doors
 * @returns {{ x: number, y: number, w: number, h: number }[]}
 */
export function generateObstacles(room, doors) {
  const t = room.wallThickness || 20;
  const inner = {
    x: room.x + t,
    y: room.y + t,
    w: room.width - 2 * t,
    h: room.height - 2 * t,
  };
  const center = { x: room.x + room.width / 2, y: room.y + room.height / 2 };

  // Exclusion zones: rects that obstacles must not overlap.
  const CENTER_MARGIN = 70;
  const ENTRANCE_MARGIN = 50;
  const DOOR_MARGIN = 30;

  const excludeRects = [
    {
      x: center.x - CENTER_MARGIN / 2,
      y: center.y - CENTER_MARGIN / 2,
      w: CENTER_MARGIN,
      h: CENTER_MARGIN,
    },
  ];

  for (const d of doors) {
    const dr = getDoorRect(room, d);
    excludeRects.push({
      x: dr.x - DOOR_MARGIN,
      y: dr.y - DOOR_MARGIN,
      w: dr.w + 2 * DOOR_MARGIN,
      h: dr.h + 2 * DOOR_MARGIN,
    });
    const entrance = getEntrancePosition(room, d, 20);
    excludeRects.push({
      x: entrance.x - ENTRANCE_MARGIN / 2,
      y: entrance.y - ENTRANCE_MARGIN / 2,
      w: ENTRANCE_MARGIN,
      h: ENTRANCE_MARGIN,
    });
  }

  function rectsOverlap(a, b) {
    if (a.x + a.w <= b.x || b.x + b.w <= a.x) return false;
    if (a.y + a.h <= b.y || b.y + b.h <= a.y) return false;
    return true;
  }

  /**
   * Stacking prevention: reject placement if new wall would stack with existing.
   * Vertical stacking: high X-overlap (mostly aligned) AND small vertical gap.
   * Horizontal stacking: high Y-overlap AND small horizontal gap.
   */
  const STACK_GAP_MIN = 45;
  const OVERLAP_THRESHOLD = 15;

  function wouldStack(rect, existingObstacles) {
    for (const o of existingObstacles) {
      if (rectsOverlap(rect, o)) return true;

      const xOverlap = Math.max(0, Math.min(rect.x + rect.w, o.x + o.w) - Math.max(rect.x, o.x));
      const yOverlap = Math.max(0, Math.min(rect.y + rect.h, o.y + o.h) - Math.max(rect.y, o.y));

      const vertGap = rect.y + rect.h <= o.y ? o.y - (rect.y + rect.h)
        : o.y + o.h <= rect.y ? rect.y - (o.y + o.h)
        : 0;
      const horizGap = rect.x + rect.w <= o.x ? o.x - (rect.x + rect.w)
        : o.x + o.w <= rect.x ? rect.x - (o.x + o.w)
        : 0;

      if (xOverlap > OVERLAP_THRESHOLD && vertGap > 0 && vertGap < STACK_GAP_MIN) return true;
      if (yOverlap > OVERLAP_THRESHOLD && horizGap > 0 && horizGap < STACK_GAP_MIN) return true;
    }
    return false;
  }

  const obstacles = [];
  const count = 2 + Math.floor(Math.random() * 4);

  // Generation fail-safe: max attempts per obstacle; prevents infinite loops.
  const MAX_OBSTACLE_ATTEMPTS = 30;

  // Wall thickness: thin internal walls (reduced from ~35–65px squares).
  // Thickness 8–14px; length 55–110px. Orientation randomized for variety.
  const WALL_THICKNESS_MIN = 8;
  const WALL_THICKNESS_MAX = 14;
  const WALL_LENGTH_MIN = 55;
  const WALL_LENGTH_MAX = 110;
  const GAP = 20;

  let anySkipped = false;
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_OBSTACLE_ATTEMPTS; attempt++) {
      const thickness = WALL_THICKNESS_MIN + Math.floor(Math.random() * (WALL_THICKNESS_MAX - WALL_THICKNESS_MIN + 1));
      const length = WALL_LENGTH_MIN + Math.floor(Math.random() * (WALL_LENGTH_MAX - WALL_LENGTH_MIN + 1));
      const horizontal = Math.random() < 0.5;
      const w = horizontal ? length : thickness;
      const h = horizontal ? thickness : length;

      const maxX = inner.w - 2 * GAP - w;
      const maxY = inner.h - 2 * GAP - h;
      if (maxX <= 0 || maxY <= 0) break;

      const x = inner.x + GAP + Math.random() * maxX;
      const y = inner.y + GAP + Math.random() * maxY;
      const rect = { x, y, w, h };

      const hitsExclude = excludeRects.some((r) => rectsOverlap(rect, r));
      if (hitsExclude) continue;

      if (!wouldStack(rect, obstacles)) {
        obstacles.push(rect);
        placed = true;
        break;
      }
    }
    if (!placed) anySkipped = true;
  }

  // Safety fallback: if placement was skipped (cramped room), drop last obstacle to reduce blockage risk.
  if (anySkipped && obstacles.length >= 2) {
    obstacles.pop();
  }

  return obstacles;
}

/**
 * Teleport pad generation: exactly two bidirectionally linked pads per non-boss room.
 * Pad A ↔ Pad B (A→B and B→A). Pads are placed randomly; must not overlap obstacles, doors,
 * player spawn (center), shrine zone, or each other.
 *
 * @param {{ x: number, y: number, width: number, height: number, wallThickness: number }} room
 * @param {DoorConfig[]} doors
 * @param {{ x: number, y: number, w: number, h: number }[]} obstacles
 * @returns {{ x: number, y: number, w: number, h: number }[]} [padA, padB] or [] if placement fails
 */
export function generateTeleportPads(room, doors, obstacles = []) {
  const t = room.wallThickness || 20;
  const inner = {
    x: room.x + t,
    y: room.y + t,
    w: room.width - 2 * t,
    h: room.height - 2 * t,
  };
  const center = { x: room.x + room.width / 2, y: room.y + room.height / 2 };

  const PAD_SIZE = 36;
  const CENTER_MARGIN = 60;   // Player spawn + shrine zone (shrine spawns at center when cleared)
  const DOOR_MARGIN = 25;
  const ENTRANCE_MARGIN = 40;
  const GAP = 15;

  const excludeRects = [
    { x: center.x - CENTER_MARGIN / 2, y: center.y - CENTER_MARGIN / 2, w: CENTER_MARGIN, h: CENTER_MARGIN },
  ];
  for (const d of doors) {
    const dr = getDoorRect(room, d);
    excludeRects.push({
      x: dr.x - DOOR_MARGIN,
      y: dr.y - DOOR_MARGIN,
      w: dr.w + 2 * DOOR_MARGIN,
      h: dr.h + 2 * DOOR_MARGIN,
    });
    const entrance = getEntrancePosition(room, d, 20);
    excludeRects.push({
      x: entrance.x - ENTRANCE_MARGIN / 2,
      y: entrance.y - ENTRANCE_MARGIN / 2,
      w: ENTRANCE_MARGIN,
      h: ENTRANCE_MARGIN,
    });
  }

  function rectsOverlap(a, b) {
    if (a.x + a.w <= b.x || b.x + b.w <= a.x) return false;
    if (a.y + a.h <= b.y || b.y + b.h <= a.y) return false;
    return true;
  }

  const pads = [];
  const PADS_REQUIRED = 2;
  const MAX_PAD_ATTEMPTS = 40; // Placement attempt cap; prevents infinite loops.

  for (let i = 0; i < PADS_REQUIRED; i++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_PAD_ATTEMPTS; attempt++) {
      const maxX = inner.w - 2 * GAP - PAD_SIZE;
      const maxY = inner.h - 2 * GAP - PAD_SIZE;
      if (maxX <= 0 || maxY <= 0) break;

      const x = inner.x + GAP + Math.random() * maxX;
      const y = inner.y + GAP + Math.random() * maxY;
      const rect = { x, y, w: PAD_SIZE, h: PAD_SIZE };

      const hitsExclude = excludeRects.some((r) => rectsOverlap(rect, r));
      const hitsObstacle = obstacles.some((o) => rectsOverlap(rect, o));
      const hitsPad = pads.some((p) => rectsOverlap(rect, p));
      if (!hitsExclude && !hitsObstacle && !hitsPad) {
        pads.push(rect);
        placed = true;
        break;
      }
    }
    if (!placed) return []; // Skip teleport pads for this room if placement fails.
  }

  return pads; // [padA, padB] — paired: pad 0 ↔ pad 1
}

/** Door length (along wall) and offset to roughly center. */
const DOOR_LENGTH = 64;
const OFF_V = 268; // (600 - 64) / 2 for left/right walls
const OFF_H = 368; // (800 - 64) / 2 for top/bottom walls

const WALLS = ['left', 'right', 'top', 'bottom'];

/** Shuffle array in place (Fisher–Yates). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Procedural dungeon generation. Produces 5–7 rooms in a connected layout.
 */
export function generateDungeon() {
  const roomCount = 5 + Math.floor(Math.random() * 3);

  const adj = Array.from({ length: roomCount }, () => new Set());
  const connected = new Set([0]);
  const unconnected = new Set();
  for (let i = 1; i < roomCount; i++) unconnected.add(i);

  while (unconnected.size > 0) {
    const toAdd = [...unconnected][Math.floor(Math.random() * unconnected.size)];
    const toConnect = [...connected][Math.floor(Math.random() * connected.size)];
    adj[toAdd].add(toConnect);
    adj[toConnect].add(toAdd);
    connected.add(toAdd);
    unconnected.delete(toAdd);
  }

  const extraEdges = 1 + Math.floor(Math.random() * 2);
  for (let e = 0; e < extraEdges; e++) {
    let added = false;
    for (let attempts = 0; attempts < 20 && !added; attempts++) {
      const a = Math.floor(Math.random() * roomCount);
      let b = Math.floor(Math.random() * roomCount);
      if (b === a || adj[a].has(b)) continue;
      if (adj[a].size >= 4 || adj[b].size >= 4) continue;
      adj[a].add(b);
      adj[b].add(a);
      added = true;
    }
  }

  const rooms = [];
  for (let id = 0; id < roomCount; id++) {
    const neighbors = [...adj[id]];
    const walls = [...WALLS];
    shuffle(walls);

    const doors = neighbors.map((connectsTo, i) => {
      const wall = walls[i % walls.length];
      const offset = wall === 'left' || wall === 'right' ? OFF_V : OFF_H;
      return { wall, offset, length: DOOR_LENGTH, connectsTo };
    });

    rooms.push({
      id,
      enemies: [],
      boss: null,
      cleared: false,
      exit: null,
      hasSpawnedEnemies: false,
      isBossRoom: false,
      doors,
    });
  }

  const bossRoomId = 1 + Math.floor(Math.random() * (roomCount - 1));
  rooms[bossRoomId].isBossRoom = true;

  return { rooms, startRoomId: 0, bossRoomId };
}

/**
 * Player position when entering a room through the given door (slightly inside).
 */
export function getEntrancePosition(room, door, inset = 20) {
  const r = getDoorRect(room, door);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const { x: rx, y: ry, width: W, height: H, wallThickness: t } = room;
  switch (door.wall) {
    case 'left':
      return { x: rx + t + inset, y: cy };
    case 'right':
      return { x: rx + W - t - inset, y: cy };
    case 'top':
      return { x: cx, y: ry + t + inset };
    case 'bottom':
      return { x: cx, y: ry + H - t - inset };
    default:
      return { x: cx, y: cy };
  }
}
