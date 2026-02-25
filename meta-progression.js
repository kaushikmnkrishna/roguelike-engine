/**
 * Persistent Meta-Progression System
 * Survives browser sessions. Separate from run-layer modifier engine.
 * Meta data is loaded on game start and saved after unlock, upgrade, and equip changes.
 */

const META_STORAGE_KEY = 'roguelike_meta_v2';

/** Rarity tiers; influence shard requirements and scaling potential. */
export const RARITY_TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** Shards required to unlock a hero by rarity (per-hero shards only). */
const UNLOCK_SHARDS = { common: 10, uncommon: 20, rare: 30, epic: 40, legendary: 50 };

/** Shards required per upgrade level by rarity (consumed from that hero's shards only). */
const UPGRADE_SHARDS_PER_LEVEL = { common: 10, uncommon: 20, rare: 30, epic: 40, legendary: 50 };

/** Equipment slot ids. 8 slots per hero. */
export const EQUIPMENT_SLOTS = [
  'weaponCore', 'catalyst', 'armor', 'boots', 'relic', 'charm', 'sigil', 'artifact',
];

// =============================================================================
// HERO META DEFINITIONS (3 heroes: Vanguard, Executioner, Tactician)
// =============================================================================
/** Combat Identity categories. */
export const HERO_CATEGORIES = { vanguard: 'Vanguard', executioner: 'Executioner', tactician: 'Tactician' };

/**
 * Hero template: id, category, rarity, name, description, baseStats (for run layer),
 * intrinsicModifiers (applied at run start), levelScaling (per-level flat values applied via modifier engine).
 * Unlock/upgrade costs from UNLOCK_SHARDS and UPGRADE_SHARDS_PER_LEVEL by rarity.
 */
export const META_HERO_DEFINITIONS = {
  vanguard: {
    id: 'vanguard',
    category: 'vanguard',
    categoryLabel: 'Vanguard',
    rarity: 'common',
    name: 'Vanguard',
    description: 'Durability focused. Higher max HP, sustained combat.',
    baseStats: { maxHP: 4, moveSpeed: 4, damage: 1, fireRate: 150, projectileSpeed: 10, bulletsPerShot: 1 },
    intrinsicModifiers: [
      { id: 'vanguard_hp', source: 'hero', type: 'flat', stat: 'maxHP', value: 1 },
    ],
    levelScaling: { maxHP: 0.5, moveSpeed: 0, damage: 0, fireRate: 0, projectileSpeed: 0 },
  },
  executioner: {
    id: 'executioner',
    category: 'executioner',
    categoryLabel: 'Executioner',
    rarity: 'uncommon',
    name: 'Executioner',
    description: 'High burst damage. Higher damage, slower fire.',
    baseStats: { maxHP: 3, moveSpeed: 4, damage: 2, fireRate: 180, projectileSpeed: 10, bulletsPerShot: 1 },
    intrinsicModifiers: [
      { id: 'executioner_damage', source: 'hero', type: 'flat', stat: 'damage', value: 0.5 },
      { id: 'executioner_fire', source: 'hero', type: 'mult', stat: 'fireRate', value: 1.1 },
    ],
    levelScaling: { damage: 0.2, fireRate: 0, maxHP: 0, moveSpeed: 0, projectileSpeed: 0 },
  },
  tactician: {
    id: 'tactician',
    category: 'tactician',
    categoryLabel: 'Tactician',
    rarity: 'rare',
    name: 'Tactician',
    description: 'Utility and scaling. Move speed and fire rate utility.',
    baseStats: { maxHP: 3, moveSpeed: 4, damage: 1, fireRate: 150, projectileSpeed: 10, bulletsPerShot: 1 },
    intrinsicModifiers: [
      { id: 'tactician_speed', source: 'hero', type: 'mult', stat: 'moveSpeed', value: 1.1 },
      { id: 'tactician_fire', source: 'hero', type: 'flat', stat: 'fireRate', value: -10 },
    ],
    levelScaling: { moveSpeed: 0.08, fireRate: -2, maxHP: 0, damage: 0, projectileSpeed: 0 },
  },
};

// =============================================================================
// GEAR CATALOG (placeholder items per slot for ownership and equip)
// =============================================================================
export const GEAR_CATALOG = {
  rust_pistol: { id: 'rust_pistol', name: 'Rust Pistol', slot: 'weaponCore', rarity: 'common', modifiers: [{ stat: 'fireRate', type: 'flat', value: -15 }] },
  heavy_blaster: { id: 'heavy_blaster', name: 'Heavy Blaster', slot: 'weaponCore', rarity: 'common', modifiers: [{ stat: 'damage', type: 'flat', value: 1 }, { stat: 'fireRate', type: 'mult', value: 1.2 }] },
  catalyst_spark: { id: 'catalyst_spark', name: 'Catalyst Spark', slot: 'catalyst', rarity: 'common', modifiers: [{ stat: 'projectileSpeed', type: 'flat', value: 1 }] },
  leather_coat: { id: 'leather_coat', name: 'Leather Coat', slot: 'armor', rarity: 'common', modifiers: [{ stat: 'maxHP', type: 'flat', value: 1 }] },
  plated_vest: { id: 'plated_vest', name: 'Plated Vest', slot: 'armor', rarity: 'common', modifiers: [{ stat: 'maxHP', type: 'flat', value: 2 }, { stat: 'moveSpeed', type: 'mult', value: 0.9 }] },
  swift_boots: { id: 'swift_boots', name: 'Swift Boots', slot: 'boots', rarity: 'common', modifiers: [{ stat: 'moveSpeed', type: 'flat', value: 0.3 }] },
  ring_haste: { id: 'ring_haste', name: 'Ring of Haste', slot: 'relic', rarity: 'common', modifiers: [{ stat: 'moveSpeed', type: 'mult', value: 1.1 }] },
  ring_vitality: { id: 'ring_vitality', name: 'Ring of Vitality', slot: 'relic', rarity: 'common', modifiers: [{ stat: 'maxHP', type: 'flat', value: 1 }] },
  charm_greed: { id: 'charm_greed', name: 'Charm of Greed', slot: 'charm', rarity: 'rare', modifiers: [] },
  sigil_precision: { id: 'sigil_precision', name: 'Sigil of Precision', slot: 'sigil', rarity: 'common', modifiers: [{ stat: 'critChance', type: 'flat', value: 0.08 }] },
  artifact_ward: { id: 'artifact_ward', name: 'Ward Artifact', slot: 'artifact', rarity: 'uncommon', modifiers: [{ stat: 'maxHP', type: 'flat', value: 1 }] },
};

// =============================================================================
// META STATE (in-memory; persisted to localStorage)
// =============================================================================
let meta = getDefaultMeta();

function getDefaultMeta() {
  const heroes = {};
  for (const id of Object.keys(META_HERO_DEFINITIONS)) {
    heroes[id] = { unlocked: false, level: 0, shards: 0 };
  }
  heroes.vanguard.unlocked = true;
  const equipped = {};
  for (const id of Object.keys(META_HERO_DEFINITIONS)) {
    equipped[id] = {};
    for (const slot of EQUIPMENT_SLOTS) equipped[id][slot] = null;
  }
  return {
    heroes,
    selectedHeroId: 'vanguard',
    equipped,
    ownedGearIds: ['rust_pistol', 'leather_coat', 'ring_haste', 'swift_boots'],
  };
}

// ---------- Meta data is loaded here (on game start). Migrates v1 saves to per-hero shards. ----------
export function loadMeta() {
  try {
    let raw = localStorage.getItem(META_STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem('roguelike_meta_v1');
      if (raw) {
        const v1 = JSON.parse(raw);
        meta = getDefaultMeta();
        if (v1.heroes) {
          for (const id of Object.keys(META_HERO_DEFINITIONS)) {
            if (v1.heroes[id]) {
              meta.heroes[id].unlocked = !!v1.heroes[id].unlocked;
              meta.heroes[id].level = Math.max(0, parseInt(v1.heroes[id].level, 10) || 0);
            }
            meta.heroes[id].shards = 0;
          }
        }
        if (v1.equipped) Object.assign(meta.equipped, v1.equipped);
        if (v1.selectedHeroId && META_HERO_DEFINITIONS[v1.selectedHeroId]) meta.selectedHeroId = v1.selectedHeroId;
        if (v1.ownedGearIds) meta.ownedGearIds = v1.ownedGearIds;
        saveMeta();
      }
      return;
    }
    const parsed = JSON.parse(raw);
    if (parsed && parsed.heroes && parsed.equipped) {
      meta = parsed;
      if (!meta.ownedGearIds) meta.ownedGearIds = [];
      for (const id of Object.keys(META_HERO_DEFINITIONS)) {
        if (!meta.heroes[id]) meta.heroes[id] = { unlocked: false, level: 0, shards: 0 };
        if (typeof meta.heroes[id].shards !== 'number') meta.heroes[id].shards = 0;
        if (!meta.equipped[id]) {
          meta.equipped[id] = {};
          for (const slot of EQUIPMENT_SLOTS) meta.equipped[id][slot] = null;
        }
      }
      if (!meta.selectedHeroId || !META_HERO_DEFINITIONS[meta.selectedHeroId]) meta.selectedHeroId = 'vanguard';
    }
  } catch (_) {}
}

// ---------- Meta data is saved here (after unlock, upgrade, equip, select hero) ----------
function saveMeta() {
  try {
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
  } catch (_) {}
}

/** Per-hero shard count (no global pool). */
export function getHeroShards(heroId) {
  const state = meta.heroes[heroId];
  return state ? Math.max(0, state.shards || 0) : 0;
}

/** For future drop system: add shards to a specific hero only. */
export function addHeroShards(heroId, n) {
  if (!meta.heroes[heroId]) return;
  meta.heroes[heroId].shards = Math.max(0, (meta.heroes[heroId].shards || 0) + n);
  saveMeta();
}

export function getHeroProgress(heroId) {
  const def = META_HERO_DEFINITIONS[heroId];
  if (!def) return null;
  const state = meta.heroes[heroId] || { unlocked: false, level: 0, shards: 0 };
  const shards = Math.max(0, state.shards || 0);
  const shardsRequiredToUnlock = state.unlocked ? 0 : (UNLOCK_SHARDS[def.rarity] ?? 10);
  const upgradeCostPerLevel = UPGRADE_SHARDS_PER_LEVEL[def.rarity] ?? 10;
  const shardsRequiredToUpgrade = state.unlocked ? upgradeCostPerLevel : 0;
  return {
    unlocked: state.unlocked,
    level: state.level,
    shards,
    shardsRequiredToUnlock,
    shardsRequiredToUpgrade,
    definition: def,
  };
}

export function getAllHeroIds() {
  return Object.keys(META_HERO_DEFINITIONS);
}

// ---------- Hero unlock logic is validated here (consumes that hero's shards only) ----------
export function unlockHero(heroId) {
  const def = META_HERO_DEFINITIONS[heroId];
  if (!def) return false;
  const state = meta.heroes[heroId];
  if (!state) return false;
  if (state.unlocked) return false;
  const cost = UNLOCK_SHARDS[def.rarity] ?? 10;
  const shards = Math.max(0, state.shards || 0);
  if (shards < cost) return false;
  state.shards = shards - cost;
  state.unlocked = true;
  saveMeta();
  return true;
}

// ---------- Hero leveling logic is validated here (consumes that hero's shards only) ----------
export function upgradeHero(heroId) {
  const def = META_HERO_DEFINITIONS[heroId];
  if (!def) return false;
  const state = meta.heroes[heroId];
  if (!state || !state.unlocked) return false;
  const cost = UPGRADE_SHARDS_PER_LEVEL[def.rarity] ?? 10;
  const shards = Math.max(0, state.shards || 0);
  if (shards < cost) return false;
  state.shards = shards - cost;
  state.level = (state.level || 0) + 1;
  saveMeta();
  return true;
}

export function getSelectedHeroId() {
  return meta.selectedHeroId;
}

export function setSelectedHeroId(heroId) {
  const progress = getHeroProgress(heroId);
  if (!progress || !progress.unlocked) return false;
  meta.selectedHeroId = heroId;
  saveMeta();
  return true;
}

export function isHeroUnlocked(heroId) {
  const state = meta.heroes[heroId];
  return state ? state.unlocked : false;
}

export function getEquippedGear(heroId) {
  const eq = meta.equipped[heroId];
  if (!eq) return Object.fromEntries(EQUIPMENT_SLOTS.map((s) => [s, null]));
  return { ...eq };
}

export function setEquippedSlot(heroId, slot, gearId) {
  if (!EQUIPMENT_SLOTS.includes(slot)) return false;
  if (!meta.equipped[heroId]) meta.equipped[heroId] = {};
  if (gearId !== null && !meta.ownedGearIds.includes(gearId)) return false;
  const g = gearId ? GEAR_CATALOG[gearId] : null;
  if (g && g.slot !== slot) return false;
  meta.equipped[heroId][slot] = gearId;
  saveMeta();
  return true;
}

export function getOwnedGearIds() {
  return [...(meta.ownedGearIds || [])];
}

export function getHeroLevel(heroId) {
  const state = meta.heroes[heroId];
  return state ? state.level : 0;
}

export function getMetaHeroDefinition(heroId) {
  return META_HERO_DEFINITIONS[heroId] || null;
}

export function getGearBySlot(slot) {
  return Object.values(GEAR_CATALOG).filter((g) => g.slot === slot);
}
