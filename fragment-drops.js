/**
 * Fragment Reward & Drop Distribution System
 *
 * Meta-layer only. Does NOT use modifier engine. Integrates with meta-progression for persistence.
 *
 * Fragment drop is triggered: in main.js when elite dies, boss dies, or run reaches VICTORY.
 * Fragment assignment occurs: here, via addHeroShards(heroId, n).
 * Persistence write occurs: addHeroShards calls saveMeta() in meta-progression.js.
 * Exploit prevention logic: validated in main.js (each event fires once; run flags prevent duplication).
 */

import { addHeroShards } from './meta-progression.js';

// =============================================================================
// DROP CONFIG (future-safe: category pools, rare types, multipliers)
// =============================================================================

/** Elite: base drop chance (0–1). */
const ELITE_DROP_CHANCE_BASE = 0.25;
/** Elite: additional chance per difficultyModifier point. */
const ELITE_DROP_CHANCE_PER_DIFF = 0.04;
/** Elite: cap on total drop chance. */
const ELITE_DROP_CHANCE_CAP = 0.55;
/** Elite: min/max shards when drop occurs. */
const ELITE_SHARDS_MIN = 1;
const ELITE_SHARDS_MAX = 2;

/** Boss: base shards (guaranteed). */
const BOSS_SHARDS_BASE = 2;
/** Boss: additional shards per difficulty tier (future: difficulty tiers). */
const BOSS_SHARDS_PER_TIER = 1;

/** Victory: bonus shards for run completion. */
const VICTORY_SHARDS_BONUS = 3;

// =============================================================================
// GRANT FUNCTIONS (call from main.js at event trigger points)
// =============================================================================

/**
 * Elite kill: roll drop chance, grant 1–2 shards if success. Chance scales with difficultyModifier.
 * Fragment drop is triggered: in main.js bullet-enemy collision when elite health <= 0.
 * Persistence write occurs: addHeroShards → saveMeta in meta-progression.js.
 *
 * @param {string} heroId - Hero to receive shards (current run hero).
 * @param {number} difficultyModifier - From global run state.
 * @param {{ x: number, y: number }} position - For floating text.
 * @returns {{ granted: number, position: { x: number, y: number } } | null} - If granted, amount and position for feedback.
 */
export function tryGrantEliteFragments(heroId, difficultyModifier, position) {
  const chance = Math.min(ELITE_DROP_CHANCE_CAP, ELITE_DROP_CHANCE_BASE + difficultyModifier * ELITE_DROP_CHANCE_PER_DIFF);
  if (Math.random() >= chance) return null;
  const amount = ELITE_SHARDS_MIN + Math.floor(Math.random() * (ELITE_SHARDS_MAX - ELITE_SHARDS_MIN + 1));
  addHeroShards(heroId, amount);
  return { granted: amount, position: { x: position.x, y: position.y } };
}

/**
 * Boss kill: guaranteed shard drop. Amount scales with difficulty tier (future-safe).
 * Fragment drop is triggered: in main.js bullet-boss collision when boss health <= 0.
 * Persistence write occurs: addHeroShards → saveMeta in meta-progression.js.
 *
 * @param {string} heroId - Hero to receive shards.
 * @param {number} difficultyTier - 0 for now; future: ascension / difficulty tier.
 * @param {{ x: number, y: number }} position - For floating text.
 * @returns {{ granted: number, position: { x: number, y: number } }}
 */
export function grantBossFragments(heroId, difficultyTier, position) {
  const amount = BOSS_SHARDS_BASE + (difficultyTier || 0) * BOSS_SHARDS_PER_TIER;
  addHeroShards(heroId, amount);
  return { granted: amount, position: { x: position.x, y: position.y } };
}

/**
 * Run victory: bonus shard grant. Applied once when transitioning to VICTORY.
 * Fragment drop is triggered: in main.js room-clear block when r.isBossRoom and room cleared.
 * Persistence write occurs: addHeroShards → saveMeta in meta-progression.js.
 *
 * @param {string} heroId - Hero to receive shards.
 * @returns {{ granted: number }}
 */
export function grantVictoryFragments(heroId) {
  addHeroShards(heroId, VICTORY_SHARDS_BONUS);
  return { granted: VICTORY_SHARDS_BONUS };
}
