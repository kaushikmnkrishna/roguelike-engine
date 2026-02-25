/**
 * Hero + Gear Loadout — data definitions only.
 * Heroes and items plug into the unified modifier engine (modifiers.js).
 * ApplyLoadoutToPlayer() lives in main.js and uses these definitions.
 */

// =============================================================================
// HERO DEFINITIONS BLOCK
// =============================================================================
// Each hero: id, name, description, spriteKey, baseStats (optional overrides),
// passiveModifiers (always-on), startingLoadout { weaponId, armorId?, ringIds[2], amuletId? }.

export const HERO_DEFINITIONS = {
  vanguard: {
    id: 'vanguard',
    name: 'Vanguard',
    description: 'Balanced fighter with sustain.',
    spriteKey: 'hero_vanguard',
    baseStats: null,
    passiveModifiers: [
      { id: 'vanguard_sustain_hp', source: 'hero', type: 'flat', stat: 'maxHP', value: 1 },
      { id: 'vanguard_sustain_regen', source: 'hero', type: 'mult', stat: 'moveSpeed', value: 1 },
    ],
    startingLoadout: {
      weaponId: 'rust_pistol',
      armorId: 'leather_coat',
      ringIds: ['ring_of_vitality', 'ring_of_haste'],
      amuletId: null,
    },
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    description: 'Fast and critical-focused.',
    spriteKey: 'hero_rogue',
    baseStats: null,
    passiveModifiers: [
      { id: 'rogue_speed', source: 'hero', type: 'mult', stat: 'moveSpeed', value: 1.15 },
      { id: 'rogue_crit', source: 'hero', type: 'flat', stat: 'critChance', value: 0.1 },
      { id: 'rogue_fire', source: 'hero', type: 'flat', stat: 'fireRate', value: -25 },
    ],
    startingLoadout: {
      weaponId: 'needle_smg',
      armorId: 'leather_coat',
      ringIds: ['ring_of_precision', 'ring_of_haste'],
      amuletId: null,
    },
  },
  juggernaut: {
    id: 'juggernaut',
    name: 'Juggernaut',
    description: 'Tank, slow and durable.',
    spriteKey: 'hero_juggernaut',
    baseStats: null,
    passiveModifiers: [
      { id: 'juggernaut_hp', source: 'hero', type: 'flat', stat: 'maxHP', value: 2 },
      { id: 'juggernaut_slow', source: 'hero', type: 'mult', stat: 'moveSpeed', value: 0.85 },
      { id: 'juggernaut_fire', source: 'hero', type: 'mult', stat: 'fireRate', value: 1.2 },
    ],
    startingLoadout: {
      weaponId: 'heavy_blaster',
      armorId: 'plated_vest',
      ringIds: ['ring_of_vitality', 'ring_of_vitality'],
      amuletId: null,
    },
  },
  arcanist: {
    id: 'arcanist',
    name: 'Arcanist',
    description: 'Glass cannon: high damage, lower fire rate.',
    spriteKey: 'hero_arcanist',
    baseStats: null,
    passiveModifiers: [
      { id: 'arcanist_damage', source: 'hero', type: 'flat', stat: 'damage', value: 1 },
      { id: 'arcanist_fire', source: 'hero', type: 'mult', stat: 'fireRate', value: 1.25 },
      { id: 'arcanist_glass', source: 'hero', type: 'flat', stat: 'maxHP', value: -1 },
    ],
    startingLoadout: {
      weaponId: 'arc_wand',
      armorId: null,
      ringIds: ['ring_of_precision', 'ring_of_haste'],
      amuletId: 'amulet_of_chaos',
    },
  },
};

// =============================================================================
// ITEM DEFINITIONS BLOCK
// =============================================================================
// Single registry: weapons, armor, rings, amulets.
// Each item: id, name, rarity, slot, spriteKey, modifiers[], optional hooks[] (hook modifiers).

/** Placeholder: small visual ping or one-time log; must not crash if effect system missing. */
function placeholderHook(eventName) {
  return function handler(payload) {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(`[Loadout hook] ${eventName}`, payload);
    }
  };
}

export const ITEM_DEFINITIONS = {
  weapons: {
    rust_pistol: {
      id: 'rust_pistol',
      name: 'Rust Pistol',
      rarity: 'common',
      slot: 'weapon',
      spriteKey: 'weapon_rust_pistol',
      modifiers: [
        { id: 'rust_pistol_fire', source: 'weapon', type: 'flat', stat: 'fireRate', value: -15 },
      ],
      hooks: [],
    },
    heavy_blaster: {
      id: 'heavy_blaster',
      name: 'Heavy Blaster',
      rarity: 'common',
      slot: 'weapon',
      spriteKey: 'weapon_heavy_blaster',
      modifiers: [
        { id: 'heavy_blaster_damage', source: 'weapon', type: 'flat', stat: 'damage', value: 1 },
        { id: 'heavy_blaster_fire', source: 'weapon', type: 'mult', stat: 'fireRate', value: 1.2 },
      ],
      hooks: [],
    },
    needle_smg: {
      id: 'needle_smg',
      name: 'Needle SMG',
      rarity: 'common',
      slot: 'weapon',
      spriteKey: 'weapon_needle_smg',
      modifiers: [
        { id: 'needle_smg_fire', source: 'weapon', type: 'flat', stat: 'fireRate', value: -25 },
        { id: 'needle_smg_damage', source: 'weapon', type: 'flat', stat: 'damage', value: -0.2 },
      ],
      hooks: [],
    },
    arc_wand: {
      id: 'arc_wand',
      name: 'Arc Wand',
      rarity: 'rare',
      slot: 'weapon',
      spriteKey: 'weapon_arc_wand',
      modifiers: [
        { id: 'arc_wand_damage', source: 'weapon', type: 'flat', stat: 'damage', value: 1 },
        { id: 'arc_wand_proj', source: 'weapon', type: 'mult', stat: 'projectileSpeed', value: 0.85 },
      ],
      hooks: [],
    },
  },
  armor: {
    leather_coat: {
      id: 'leather_coat',
      name: 'Leather Coat',
      rarity: 'common',
      slot: 'armor',
      spriteKey: 'armor_leather_coat',
      modifiers: [
        { id: 'leather_coat_hp', source: 'armor', type: 'flat', stat: 'maxHP', value: 1 },
      ],
      hooks: [],
    },
    plated_vest: {
      id: 'plated_vest',
      name: 'Plated Vest',
      rarity: 'common',
      slot: 'armor',
      spriteKey: 'armor_plated_vest',
      modifiers: [
        { id: 'plated_vest_hp', source: 'armor', type: 'flat', stat: 'maxHP', value: 2 },
        { id: 'plated_vest_speed', source: 'armor', type: 'mult', stat: 'moveSpeed', value: 0.9 },
      ],
      hooks: [],
    },
  },
  rings: {
    ring_of_haste: {
      id: 'ring_of_haste',
      name: 'Ring of Haste',
      rarity: 'common',
      slot: 'ring',
      spriteKey: 'ring_haste',
      modifiers: [
        { id: 'ring_haste_speed', source: 'ring', type: 'mult', stat: 'moveSpeed', value: 1.1 },
      ],
      hooks: [],
    },
    ring_of_thorns: {
      id: 'ring_of_thorns',
      name: 'Ring of Thorns',
      rarity: 'rare',
      slot: 'ring',
      spriteKey: 'ring_thorns',
      modifiers: [],
      hooks: [
        { id: 'ring_thorns_hook', source: 'ring', type: 'hook', event: 'onDamageTaken', handler: placeholderHook('onDamageTaken') },
      ],
    },
    ring_of_precision: {
      id: 'ring_of_precision',
      name: 'Ring of Precision',
      rarity: 'common',
      slot: 'ring',
      spriteKey: 'ring_precision',
      modifiers: [
        { id: 'ring_precision_crit', source: 'ring', type: 'flat', stat: 'critChance', value: 0.08 },
      ],
      hooks: [],
    },
    ring_of_vitality: {
      id: 'ring_of_vitality',
      name: 'Ring of Vitality',
      rarity: 'common',
      slot: 'ring',
      spriteKey: 'ring_vitality',
      modifiers: [
        { id: 'ring_vitality_hp', source: 'ring', type: 'flat', stat: 'maxHP', value: 1 },
      ],
      hooks: [],
    },
  },
  amulets: {
    amulet_of_greed: {
      id: 'amulet_of_greed',
      name: 'Amulet of Greed',
      rarity: 'rare',
      slot: 'amulet',
      spriteKey: 'amulet_greed',
      modifiers: [],
      hooks: [
        { id: 'amulet_greed_hook', source: 'amulet', type: 'hook', event: 'onRoomCleared', handler: placeholderHook('onRoomCleared') },
      ],
    },
    amulet_of_chaos: {
      id: 'amulet_of_chaos',
      name: 'Amulet of Chaos',
      rarity: 'epic',
      slot: 'amulet',
      spriteKey: 'amulet_chaos',
      modifiers: [],
      hooks: [
        { id: 'amulet_chaos_hook', source: 'amulet', type: 'hook', event: 'onEnemyKilled', handler: placeholderHook('onEnemyKilled') },
      ],
    },
  },
};

/**
 * Look up an item by id across all categories.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getItem(id) {
  if (!id) return undefined;
  for (const category of Object.values(ITEM_DEFINITIONS)) {
    if (typeof category !== 'object') continue;
    if (category[id]) return category[id];
  }
  return undefined;
}

/**
 * Get hero definition by id.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getHero(id) {
  return HERO_DEFINITIONS[id];
}
