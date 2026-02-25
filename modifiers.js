/**
 * Unified Modifier Engine
 *
 * Single source of truth for all run-based stat changes, effects, and behavioral alterations.
 * Manages modifiers affecting: player, enemies, bosses, projectiles (future), global run state.
 * Layers on top of existing architecture; does not replace player, enemy, shrine, boss, or dungeon.
 *
 * Modifier categories supported:
 * - Stat modifiers: flat (+n), percentage multipliers (×n), additive stacking (flat), multiplicative stacking (mult).
 * - Behavioral modifiers: on-hit, on-kill, conditional (via hook handlers).
 * - Global modifiers: difficulty scaling, enemy health, spawn density, shrine mutations.
 * - Temporary modifiers: time-limited (durationMs), room-scoped (future), conditional (future).
 *
 * Rules: stacking is deterministic; application order is consistent; base stats are never mutated
 * by evaluation; final values are derived through getDerivedStats / getDerivedGlobal only.
 *
 * Persistence: modifiers last for the run; resetModifiers() clears everything on Retry or Return to Menu.
 * Performance: evaluation is lightweight; optional cache avoids redundant recalc (invalidated on register/clear).
 *
 * Event hooks (for behavioral modifiers): onPlayerHit, onEnemyKilled, onRoomCleared, onDamageTaken,
 * onTeleport, onBossSpawn (future). Use emitGameEvent(eventName, payload) to fire.
 */

// =============================================================================
// MODIFIER FORMAT
// =============================================================================
/**
 * Stat modifier: { id, source, type: 'flat'|'mult', stat, value, durationMs?, stackRule? }
 * Hook modifier: { id, source, type: 'hook', event, handler, durationMs?, stackRule? }
 * source: 'hero'|'weapon'|'ring'|'amulet'|'shrine'|'room'|'boss'|'elite'|'global'
 * scope (optional, future): 'player'|'global'|'enemy'|'boss'|'projectile'
 * stackRule: 'stack' (default) | 'refresh' | 'unique'
 */

/** Canonical base stats shape for the player. Base stats are synced from game and never overwritten by evaluation. */
export const BASE_STAT_KEYS = [
  'maxHP', 'moveSpeed', 'damage', 'fireRate', 'projectileSpeed',
  'critChance', 'critMultiplier', 'dashCharges', 'pickupRadius',
  'bulletsPerShot',
];

/**
 * Create default base stats (used when no modifiers).
 * @returns {Record<string, number>}
 */
export function createDefaultBaseStats() {
  return {
    maxHP: 3,
    moveSpeed: 4,
    damage: 1,
    fireRate: 150,
    projectileSpeed: 10,
    critChance: 0,
    critMultiplier: 1,
    dashCharges: 0,
    pickupRadius: 0,
    bulletsPerShot: 1,
  };
}

// =============================================================================
// REGISTRATION: how modifiers are registered
// =============================================================================
/** Active modifiers applied to player (and future entity-scoped). Add via addModifier; never mutate this array from outside. */
export let activeModifiers = [];

/** Mutable base stats; synced from game (upgrades, etc.). Evaluation reads these and does not mutate them. */
export let baseStats = createDefaultBaseStats();

/** Global run modifiers (difficulty, enemy health, spawn density, shrine mutations). Registered via addGlobalModifier. */
export let globalModifiers = [];

/**
 * Elite entity modifiers: keyed by entityId. Used for elite enemy affixes.
 * Registered when elite spawns; removed when elite dies. Run-scoped; cleared in resetModifiers.
 */
export const eliteModifiers = new Map();

/** Default values for derived global run state. Evaluation applies globalModifiers on top. */
const GLOBAL_BASE = {
  difficultyScale: 1,
  enemyHealthMult: 1,
  spawnDensityMult: 1,
  enemyDamageMult: 1,
  difficultyModifier: 0,
};

const modifierStartTimes = new Map();
const globalModifierStartTimes = new Map();

/** Invalidate derived cache when modifiers or base stats change (see Evaluation). */
let derivedStatsCache = null;
let derivedGlobalCache = null;

function invalidateCaches() {
  derivedStatsCache = null;
  derivedGlobalCache = null;
}

/**
 * Register a modifier. Applies stackRule (unique/refresh) and tracks duration if durationMs set.
 * Call this to add player/entity stat or hook modifiers. Caches are invalidated.
 */
export function addModifier(modifier) {
  if (modifier.stackRule === 'unique') {
    const existing = activeModifiers.find((m) => m.id === modifier.id && m.source === modifier.source);
    if (existing) return;
  }
  if (modifier.stackRule === 'refresh') {
    activeModifiers = activeModifiers.filter((m) => !(m.id === modifier.id && m.source === modifier.source));
  }
  activeModifiers = [...activeModifiers, modifier];
  if (modifier.durationMs != null) {
    modifierStartTimes.set(modifier, performance.now());
  }
  invalidateCaches();
}

/**
 * Register a global run modifier (difficulty, enemy health, spawn density, etc.).
 * Same format as stat modifiers: type 'flat'|'mult', stat = key in GLOBAL_BASE (e.g. 'enemyHealthMult').
 */
export function addGlobalModifier(modifier) {
  if (modifier.stackRule === 'unique') {
    const existing = globalModifiers.find((m) => m.id === modifier.id && m.source === modifier.source);
    if (existing) return;
  }
  if (modifier.stackRule === 'refresh') {
    globalModifiers = globalModifiers.filter((m) => !(m.id === modifier.id && m.source === modifier.source));
  }
  globalModifiers = [...globalModifiers, modifier];
  if (modifier.durationMs != null) {
    globalModifierStartTimes.set(modifier, performance.now());
  }
  invalidateCaches();
}

/**
 * Remove modifier by id (and optionally source). Caches invalidated.
 */
export function removeModifier(id, source) {
  activeModifiers = activeModifiers.filter((m) => {
    const match = m.id === id && (source == null || m.source === source);
    if (match) modifierStartTimes.delete(m);
    return !match;
  });
  invalidateCaches();
}

/**
 * Register an elite (entity-scoped) modifier. Called when affix is attached to enemy.
 * Caches are not invalidated (elite stats are evaluated per-entity, no global cache).
 */
export function addEliteModifier(entityId, modifier) {
  const list = eliteModifiers.get(entityId) || [];
  list.push(modifier);
  eliteModifiers.set(entityId, list);
}

/**
 * Remove all modifiers for an elite entity. Call on enemy death to prevent modifier leaks.
 */
export function removeEliteModifiers(entityId) {
  eliteModifiers.delete(entityId);
}

/**
 * Compute derived stats for an elite entity from base stats and its modifiers.
 * Order: flat then mult. Returns new object; does not mutate.
 * @param {string} entityId
 * @param {Record<string, number>} base - e.g. { speed, maxHealth, damageReduction }
 * @returns {Record<string, number>}
 */
export function getEliteDerivedStats(entityId, base) {
  const list = eliteModifiers.get(entityId);
  if (!list || list.length === 0) return { ...base };
  const result = { ...base };
  for (const m of list) {
    if (m.type !== 'flat' || m.stat == null || typeof m.value !== 'number') continue;
    if (result[m.stat] != null) {
      result[m.stat] = (result[m.stat] ?? 0) + m.value;
    }
  }
  for (const m of list) {
    if (m.type !== 'mult' || m.stat == null || typeof m.value !== 'number') continue;
    if (result[m.stat] != null) {
      result[m.stat] = (result[m.stat] ?? 0) * m.value;
    }
  }
  return result;
}

/**
 * Remove global modifier by id (and optionally source).
 */
export function removeGlobalModifier(id, source) {
  globalModifiers = globalModifiers.filter((m) => {
    const match = m.id === id && (source == null || m.source === source);
    if (match) globalModifierStartTimes.delete(m);
    return !match;
  });
  invalidateCaches();
}

// =============================================================================
// EVALUATION: how modifiers are evaluated (no mutation of base stats)
// =============================================================================
/**
 * Compute derived stats from base stats and active modifiers. Deterministic order:
 * 1. Copy base stats (base stats remain intact).
 * 2. Apply all flat modifiers (additive).
 * 3. Apply all mult modifiers (multiplicative).
 * Returns a new object; does not mutate baseStats or activeModifiers.
 * Uses cache when possible; cache is invalidated on add/remove/sync/reset.
 *
 * @param {Record<string, number>} [base] - defaults to internal baseStats
 * @param {object[]} [modifiers] - defaults to activeModifiers
 * @returns {Record<string, number>}
 */
export function getDerivedStats(base = baseStats, modifiers = activeModifiers) {
  if (base === baseStats && modifiers === activeModifiers && derivedStatsCache) {
    return derivedStatsCache;
  }
  const result = { ...base };

  for (const m of modifiers) {
    if (m.type !== 'flat' || m.stat == null || typeof m.value !== 'number') continue;
    if (result[m.stat] != null) {
      result[m.stat] = (result[m.stat] ?? 0) + m.value;
    }
  }
  for (const m of modifiers) {
    if (m.type !== 'mult' || m.stat == null || typeof m.value !== 'number') continue;
    if (result[m.stat] != null) {
      result[m.stat] = (result[m.stat] ?? 0) * m.value;
    }
  }

  if (base === baseStats && modifiers === activeModifiers) {
    derivedStatsCache = result;
  }
  return result;
}

/**
 * Compute derived global run state from GLOBAL_BASE and globalModifiers.
 * Same order: flat then mult. Used for difficulty scaling, enemy health, spawn density.
 * Cached; invalidated on global modifier add/remove/reset.
 */
export function getDerivedGlobal() {
  if (derivedGlobalCache) return derivedGlobalCache;
  const result = { ...GLOBAL_BASE };

  for (const m of globalModifiers) {
    if (m.type !== 'flat' || m.stat == null || typeof m.value !== 'number') continue;
    if (result[m.stat] != null) {
      result[m.stat] = (result[m.stat] ?? 0) + m.value;
    }
  }
  for (const m of globalModifiers) {
    if (m.type !== 'mult' || m.stat == null || typeof m.value !== 'number') continue;
    if (result[m.stat] != null) {
      result[m.stat] = (result[m.stat] ?? 0) * m.value;
    }
  }

  derivedGlobalCache = result;
  return result;
}

/**
 * Emit an event to all hook modifiers. Handlers run for matching event name.
 * Supported events: onPlayerHit, onEnemyKilled, onRoomCleared, onDamageTaken, onTeleport, onBossSpawn (future).
 */
export function emitGameEvent(eventName, payload = {}) {
  for (const m of activeModifiers) {
    if (m.type !== 'hook' || m.event !== eventName || typeof m.handler !== 'function') continue;
    m.handler(payload);
  }
}

/**
 * Expire time-limited modifiers. Call once per frame with current time.
 * Removes modifiers whose durationMs has elapsed; invalidates caches.
 */
export function processModifierDurations(now) {
  const toRemove = [];
  for (const m of activeModifiers) {
    const dur = m.durationMs;
    if (dur == null) continue;
    const start = modifierStartTimes.get(m);
    if (start == null) continue;
    if (now - start >= dur) {
      toRemove.push(m);
    }
  }
  for (const m of toRemove) {
    activeModifiers = activeModifiers.filter((x) => x !== m);
    modifierStartTimes.delete(m);
  }

  const globalToRemove = [];
  for (const m of globalModifiers) {
    const dur = m.durationMs;
    if (dur == null) continue;
    const start = globalModifierStartTimes.get(m);
    if (start == null) continue;
    if (now - start >= dur) {
      globalToRemove.push(m);
    }
  }
  for (const m of globalToRemove) {
    globalModifiers = globalModifiers.filter((x) => x !== m);
    globalModifierStartTimes.delete(m);
  }

  if (toRemove.length || globalToRemove.length) invalidateCaches();
}

// =============================================================================
// CLEARING: how modifier state is reset (Retry / Return to Menu)
// =============================================================================
/**
 * Clear all modifiers and caches. Call on Retry or Return to Menu so the next run starts clean.
 * No page refresh required. Base stats are not reset here (caller typically resets baseStats then syncs from game).
 */
export function resetModifiers() {
  activeModifiers = [];
  globalModifiers = [];
  eliteModifiers.clear();
  modifierStartTimes.clear();
  globalModifierStartTimes.clear();
  derivedStatsCache = null;
  derivedGlobalCache = null;
}

/**
 * Sync baseStats from current game values. Call after upgrades and at run start.
 * Does not touch activeModifiers. Invalidates derived cache so next getDerivedStats is fresh.
 */
export function syncBaseStatsFromGame(gameState) {
  if (gameState.maxHP != null) baseStats.maxHP = gameState.maxHP;
  if (gameState.moveSpeed != null) baseStats.moveSpeed = gameState.moveSpeed;
  if (gameState.fireRate != null) baseStats.fireRate = gameState.fireRate;
  if (gameState.projectileSpeed != null) baseStats.projectileSpeed = gameState.projectileSpeed;
  if (gameState.damage != null) baseStats.damage = gameState.damage;
  if (gameState.critChance != null) baseStats.critChance = gameState.critChance;
  if (gameState.critMultiplier != null) baseStats.critMultiplier = gameState.critMultiplier;
  if (gameState.bulletsPerShot != null) baseStats.bulletsPerShot = gameState.bulletsPerShot;
  invalidateCaches();
}
