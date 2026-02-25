/**
 * Elite Enemy Affix System
 *
 * Modular affix system for elite variants of existing enemies. Built on the Unified Modifier Engine.
 * Affixes are attached at spawn; modifiers registered via addEliteModifier; removed on death.
 *
 * Elite selection occurs: in spawnEnemyWave (main.js), when room is eligible.
 * Affixes are attached: in attachAffix() below, called from spawnEnemyWave.
 * Affix modifiers are registered: in each affix's onAttach, via addEliteModifier.
 * Affix modifiers are removed: in detachAffixModifiers(), called from main.js on enemy death.
 */

import { addEliteModifier, removeEliteModifiers, getEliteDerivedStats } from './modifiers.js';

// =============================================================================
// ELITE SPAWN CONFIG
// =============================================================================

/** Base chance (0–1) that a non-boss room spawns at least one elite. */
export const ELITE_SPAWN_CHANCE_BASE = 0.28;
/** Additional chance per difficultyModifier. Scales elite spawn with run difficulty. */
export const ELITE_SPAWN_CHANCE_PER_DIFF = 0.03;
/** Cap on total elite spawn chance. */
export const ELITE_SPAWN_CHANCE_CAP = 0.65;

/** Affix pool. One affix per elite for now; supports stacking in future. */
export const AFFIX_POOL = ['frenzied', 'hardened', 'volatile', 'vampiric'];

/**
 * Compute elite spawn chance for current run.
 * @param {number} difficultyModifier
 * @returns {number}
 */
export function getEliteSpawnChance(difficultyModifier = 0) {
  return Math.min(ELITE_SPAWN_CHANCE_CAP, ELITE_SPAWN_CHANCE_BASE + difficultyModifier * ELITE_SPAWN_CHANCE_PER_DIFF);
}

/** Pick one random affix from the pool. */
export function pickRandomAffix() {
  return AFFIX_POOL[Math.floor(Math.random() * AFFIX_POOL.length)];
}

// =============================================================================
// AFFIX DEFINITIONS
// =============================================================================

/**
 * Frenzied: increased movement speed; gains additional speed at low HP.
 * Stat modifiers: +speed (flat), +speedMult for Charger/Sniper. Low-HP bonus applied at runtime.
 */
const FRENZIED = {
  id: 'frenzied',
  statModifiers: [
    { type: 'flat', stat: 'speed', value: 0.4 },
    { type: 'flat', stat: 'speedMult', value: 0.25 }, // 25% faster for Charger dash, Sniper move
  ],
  onAttach(enemy, eliteId) {
    addEliteModifier(eliteId, { id: 'elite_frenzied_speed_' + eliteId, source: 'elite', type: 'flat', stat: 'speed', value: 0.4 });
    addEliteModifier(eliteId, { id: 'elite_frenzied_mult_' + eliteId, source: 'elite', type: 'flat', stat: 'speedMult', value: 0.25 });
  },
};

/**
 * Hardened: increased max HP; minor damage reduction.
 */
const HARDENED = {
  id: 'hardened',
  statModifiers: [
    { type: 'flat', stat: 'maxHealth', value: 2 },
    { type: 'flat', stat: 'damageReduction', value: 0.15 },
  ],
  onAttach(enemy, eliteId) {
    addEliteModifier(eliteId, { id: 'elite_hardened_hp_' + eliteId, source: 'elite', type: 'flat', stat: 'maxHealth', value: 2 });
    addEliteModifier(eliteId, { id: 'elite_hardened_dr_' + eliteId, source: 'elite', type: 'flat', stat: 'damageReduction', value: 0.15 });
  },
};

/**
 * Volatile: explodes on death. Explosion deals area damage.
 * No stat modifiers; behavioral effect via onEliteDeath in main.js.
 */
const VOLATILE = {
  id: 'volatile',
  statModifiers: [],
  onAttach(enemy, eliteId) {
    // No stat modifiers. Death effect handled by runVolatileExplosion in main.
  },
};

/**
 * Vampiric: heals slightly on hit. Small lifesteal mechanic.
 * Lifesteal amount applied at runtime when enemy hits player.
 */
const VAMPIRIC = {
  id: 'vampiric',
  statModifiers: [
    { type: 'flat', stat: 'lifesteal', value: 0.5 },
  ],
  onAttach(enemy, eliteId) {
    addEliteModifier(eliteId, { id: 'elite_vampiric_ls_' + eliteId, source: 'elite', type: 'flat', stat: 'lifesteal', value: 0.5 });
  },
};

const AFFIX_MAP = { frenzied: FRENZIED, hardened: HARDENED, volatile: VOLATILE, vampiric: VAMPIRIC };

// =============================================================================
// ATTACH / DETACH
// =============================================================================

let nextEliteId = 0;

/**
 * Attach an affix to an enemy. Sets isElite, affix, eliteId; stores base stats; registers modifiers.
 * Call from spawnEnemyWave when an enemy is chosen to be elite.
 */
export function attachAffix(enemy, affixId) {
  const def = AFFIX_MAP[affixId];
  if (!def) return;

  const eliteId = 'elite_' + (nextEliteId++);
  enemy.isElite = true;
  enemy.affix = affixId;
  enemy.eliteId = eliteId;

  // Store base stats (before affix). Used for evaluation.
  enemy._baseSpeed = enemy.speed ?? 1.2;
  enemy._baseMaxHealth = enemy.health ?? enemy.maxHealth ?? 2;
  enemy._baseDamageReduction = 0;

  // Hardened adds max HP: also add to current health so elite gets full buffer.
  if (affixId === 'hardened') {
    enemy.health = (enemy.health ?? 2) + 2;
  }
  enemy.maxHealth = enemy.health; // Will be overwritten by applyEliteStats

  def.onAttach(enemy, eliteId);
}

/**
 * Remove affix modifiers from an elite. Call when enemy dies to prevent modifier leaks.
 */
export function detachAffixModifiers(enemy) {
  if (enemy.isElite && enemy.eliteId) {
    removeEliteModifiers(enemy.eliteId);
  }
}

/**
 * Apply elite derived stats to an enemy. Call each frame before enemy.update().
 * Mutates enemy.speed, enemy.maxHealth, enemy.damageReduction, enemy.eliteSpeedMult, enemy.lifesteal.
 */
export function applyEliteStats(enemy) {
  if (!enemy.isElite || !enemy.eliteId) return;

  const base = {
    speed: enemy._baseSpeed ?? 1.2,
    maxHealth: enemy._baseMaxHealth ?? 2,
    damageReduction: enemy._baseDamageReduction ?? 0,
    speedMult: 1,
    lifesteal: 0,
  };
  const derived = getEliteDerivedStats(enemy.eliteId, base);

  enemy.maxHealth = Math.max(1, derived.maxHealth);
  enemy.damageReduction = Math.max(0, Math.min(0.5, derived.damageReduction ?? 0));
  enemy.eliteSpeedMult = Math.max(0.5, derived.speedMult ?? 1);
  enemy.lifesteal = derived.lifesteal ?? 0;

  // Enemy/Splitter use .speed; Charger uses eliteSpeedMult for dash.
  if (enemy.speed != null) {
    let speed = derived.speed ?? enemy._baseSpeed;
    // Frenzied: additional speed at low HP
    if (enemy.affix === 'frenzied' && enemy.maxHealth > 0) {
      const hpRatio = enemy.health / enemy.maxHealth;
      if (hpRatio < 0.5) speed += 0.5;
    }
    enemy.speed = Math.max(0.5, speed);
  }
}

/**
 * Get lifesteal amount for Vampiric elite when it hits the player.
 */
export function getVampiricHealAmount(enemy) {
  if (!enemy.isElite || enemy.affix !== 'vampiric') return 0;
  return enemy.lifesteal ?? 0.5;
}

/**
 * Volatile explosion: deal area damage when elite dies.
 * Call from main.js when a Volatile elite is removed.
 * @param {object} enemy - The dead elite
 * @param {object} player - Player entity
 * @param {function} damagePlayer - (amount) => void
 */
export function runVolatileExplosion(enemy, player, damagePlayer) {
  if (!enemy.isElite || enemy.affix !== 'volatile') return;
  const radius = 80;
  const damage = 2;
  const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
  if (dist <= radius) {
    const falloff = 1 - (dist / radius) * 0.5;
    damagePlayer(Math.max(1, Math.round(damage * falloff)));
  }
}

/**
 * Elite reward placeholder: returns bonus value for future fragment drop integration.
 * For now, elites are marked (eliteKillCount can be used later).
 */
export function getEliteRewardBonus() {
  return 1; // Future: increase fragment drop chance or grant bonus value
}
