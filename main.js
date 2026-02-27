/**
 * Main entry — game loop, input, and rendering.
 * Uses requestAnimationFrame for the loop and ES6 modules.
 */

import { Player } from './player.js';
import { Room } from './room.js';
import { Enemy, Boss, Charger, Sniper, Splitter, randomSpawnInRoom, SPLITTER_CHILD_W, SPLITTER_CHILD_H, SPLITTER_CHILD_SPEED } from './enemy.js';
import {
  getEliteSpawnChance,
  pickRandomAffix,
  attachAffix,
  detachAffixModifiers,
  applyEliteStats,
  getVampiricHealAmount,
  runVolatileExplosion,
} from './elite-affixes.js';
import { Bullet } from './bullets.js';
import {
  generateDungeon,
  generateObstacles,
  generateTeleportPads,
  getWallSegments,
  getDoorRects,
  getEntrancePosition,
} from './level.js';
import {
  baseStats,
  activeModifiers,
  createDefaultBaseStats,
  getDerivedStats,
  getDerivedGlobal,
  emitGameEvent,
  processModifierDurations,
  resetModifiers,
  syncBaseStatsFromGame,
  addModifier,
  addGlobalModifier,
} from './modifiers.js';
import {
  tryGrantEliteFragments,
  grantBossFragments,
  grantVictoryFragments,
} from './fragment-drops.js';
import {
  loadMeta,
  getSelectedHeroId,
  getHeroProgress,
  getEquippedGear,
  getMetaHeroDefinition,
  getAllHeroIds,
  unlockHero,
  upgradeHero,
  setSelectedHeroId,
  setEquippedSlot,
  getOwnedGearIds,
  isHeroUnlocked,
  getHeroLevel,
  EQUIPMENT_SLOTS,
  GEAR_CATALOG,
  RARITY_TIERS,
} from './meta-progression.js';

// --- Canvas setup ---
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// --- Input state (keys currently held) ---
const keys = new Set();
// Global mouse position in canvas coordinates
let mx = 0;
let my = 0;

function onKeyDown(e) {
  if (inputMode === 'upgrade') {
    if (!upgradeChoices) return;
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      upgradeSelectedIndex = upgradeSelectedIndex === 0 ? 1 : 0;
      audioManager.play('menu_hover', 'ui');
      return;
    }
    if (e.code === 'Digit1') {
      audioManager.play('menu_select', 'ui');
      handleUpgradeSelect(0);
      return;
    }
    if (e.code === 'Digit2') {
      audioManager.play('menu_select', 'ui');
      handleUpgradeSelect(1);
      return;
    }
    if (e.code === 'Enter') {
      audioManager.play('menu_select', 'ui');
      handleUpgradeSelect(upgradeSelectedIndex);
      return;
    }
    if (!['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Tab'].includes(e.code)) {
      audioManager.play('menu_error', 'ui');
    }
    return;
  }
  if (inputMode === 'modal' && settingsOpen) {
    if (settingsOpen && e.code === 'Escape') {
      closeSettingsModal();
    }
    return;
  }
  if (e.code === 'KeyM') {
    audioManager.toggleMute();
    if (!audioManager.muted.master) {
      audioManager.play('menu_select', 'ui');
      setAmbient(gameState === 'MENU' ? 'menu' : 'gameplay');
    }
    return;
  }
  if (settingsOpen && e.code === 'Escape') {
    closeSettingsModal();
    return;
  }
  if (gameState === 'PLAYING') {
    if (e.code === 'Escape') {
      setPaused(!isPaused);
      return;
    }
    if (isPaused) {
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        pauseSelectedIndex = (pauseSelectedIndex + (e.code === 'ArrowUp' ? -1 : 1) + 3) % 3;
        audioManager.play('menu_hover', 'ui');
        return;
      }
      if (e.code === 'Enter') {
        handlePauseSelect(pauseSelectedIndex);
        audioManager.play('menu_select', 'ui');
        return;
      }
      return;
    }
  }
  if (settingsOpen) return;
  if (gameState === 'MENU') {
    if (menuScreen === 'help') {
      if (e.code === 'Enter' || e.code === 'Escape') {
        audioManager.play('menu_back', 'ui');
        menuScreen = 'main';
        startMenuTransition();
      }
      return;
    }
    if (menuScreen === 'heroes') {
      const heroIds = getAllHeroIds();
      if (e.code === 'Escape') {
        audioManager.play('menu_back', 'ui');
        menuScreen = 'main';
        startMenuTransition();
        return;
      }
      if (e.code === 'ArrowLeft') {
        menuSelectedIndex = (menuSelectedIndex - 1 + heroIds.length) % heroIds.length;
        audioManager.play('menu_hover', 'ui');
        return;
      }
      if (e.code === 'ArrowRight') {
        menuSelectedIndex = (menuSelectedIndex + 1) % heroIds.length;
        audioManager.play('menu_hover', 'ui');
        return;
      }
      if (e.code === 'KeyS') {
        const heroId = heroIds[menuSelectedIndex];
        const progress = getHeroProgress(heroId);
        if (progress && progress.unlocked) {
          setSelectedHeroId(heroId);
          audioManager.play('hero_select', 'ui');
        }
        return;
      }
      if (e.code === 'Enter') {
        audioManager.play('menu_select', 'ui');
        const heroId = heroIds[menuSelectedIndex];
        const progress = getHeroProgress(heroId);
        if (!progress.unlocked) {
          unlockHero(heroId);
          audioManager.play('hero_unlock', 'ui');
          return;
        }
        upgradeHero(heroId);
        audioManager.play('upgrade_success', 'ui');
        return;
      }
      return;
    }
    if (menuScreen === 'enemies') {
      const enemyIds = ['chaser', 'charger', 'sniper', 'splitter', 'boss'];
      if (e.code === 'Escape') {
        audioManager.play('menu_back', 'ui');
        menuScreen = 'main';
        startMenuTransition();
        return;
      }
      if (e.code === 'ArrowLeft') {
        menuSelectedIndex = (menuSelectedIndex - 1 + enemyIds.length) % enemyIds.length;
        enemyTransitionAlpha = 0;
        audioManager.play('menu_hover', 'ui');
        return;
      }
      if (e.code === 'ArrowRight') {
        menuSelectedIndex = (menuSelectedIndex + 1) % enemyIds.length;
        enemyTransitionAlpha = 0;
        audioManager.play('menu_hover', 'ui');
        return;
      }
      return;
    }
    if (menuScreen === 'loadout') {
      if (e.code === 'Escape') {
        audioManager.play('menu_back', 'ui');
        menuScreen = 'main';
        startMenuTransition();
        return;
      }
      if (e.code === 'ArrowUp') {
        menuSelectedIndex = moveLoadoutSelection(menuSelectedIndex, 'up');
        audioManager.play('menu_hover', 'ui');
        return;
      }
      if (e.code === 'ArrowDown') {
        menuSelectedIndex = moveLoadoutSelection(menuSelectedIndex, 'down');
        audioManager.play('menu_hover', 'ui');
        return;
      }
      if (e.code === 'ArrowLeft') {
        menuSelectedIndex = moveLoadoutSelection(menuSelectedIndex, 'left');
        audioManager.play('menu_hover', 'ui');
        return;
      }
      if (e.code === 'ArrowRight') {
        menuSelectedIndex = moveLoadoutSelection(menuSelectedIndex, 'right');
        audioManager.play('menu_hover', 'ui');
        return;
      }
      if (e.code === 'Enter') {
        audioManager.play('menu_select', 'ui');
        triggerMenuClickFlash();
        handleLoadoutSelect(menuSelectedIndex);
        return;
      }
      return;
    }
    if (e.code === 'ArrowUp') {
      menuSelectedIndex = (menuSelectedIndex - 1 + MENU_OPTIONS_MAIN.length) % MENU_OPTIONS_MAIN.length;
      audioManager.play('menu_hover', 'ui');
      return;
    }
    if (e.code === 'ArrowDown') {
      menuSelectedIndex = (menuSelectedIndex + 1) % MENU_OPTIONS_MAIN.length;
      audioManager.play('menu_hover', 'ui');
      return;
    }
    if (e.code === 'Enter') {
      audioManager.play('menu_select', 'ui');
      triggerMenuClickFlash();
      handleMainMenuSelect(menuSelectedIndex);
      return;
    }
    return;
  }
  if (gameState === 'DEAD') {
    if (e.code === 'ArrowUp') { deadSelectedIndex = deadSelectedIndex === 0 ? 1 : 0; return; }
    if (e.code === 'ArrowDown') { deadSelectedIndex = deadSelectedIndex === 0 ? 1 : 0; return; }
    if (e.code === 'Enter') {
      handleDeathSelect(deadSelectedIndex);
      return;
    }
    return;
  }
  if (gameState === 'VICTORY') {
    if (e.code === 'Enter') { gameState = 'MENU'; menuScreen = 'main'; menuSelectedIndex = 0; } // State switch: VICTORY → MENU
    return;
  }
  if (healingChoices) {
    if (e.code === 'Digit1' && healingChoices.choices[0]) {
      healingChoices.choices[0].apply();
      audioManager.play('upgrade_success', 'ui');
      upgradeFeedback = { text: healingChoices.choices[0].feedbackText, until: performance.now() + 1500 };
      healingChoices = null;
      upgradeChoices = { choices: pickRandomUpgrades(2) }; // Still grant room upgrade after healing choice.
      return;
    }
    if (e.code === 'Digit2' && healingChoices.choices[1]) {
      healingChoices.choices[1].apply();
      audioManager.play('upgrade_success', 'ui');
      upgradeFeedback = { text: healingChoices.choices[1].feedbackText, until: performance.now() + 1500 };
      healingChoices = null;
      upgradeChoices = { choices: pickRandomUpgrades(2) };
      return;
    }
    if (e.code === 'Digit3' && healingChoices.choices[2]) {
      healingChoices.choices[2].apply();
      audioManager.play('upgrade_success', 'ui');
      upgradeFeedback = { text: healingChoices.choices[2].feedbackText, until: performance.now() + 1500 };
      healingChoices = null;
      upgradeChoices = { choices: pickRandomUpgrades(2) };
      return;
    }
    return;
  }
  if (shrineChoices) {
    if (e.code === 'Digit1' && shrineChoices.choices[0]) {
      shrineChoices.choices[0].apply();
      audioManager.play('shrine_accept', 'sfx');
      upgradeFeedback = { text: shrineChoices.choices[0].feedbackText, until: performance.now() + 1500 };
      shrineChoices = null;
      return;
    }
    if (e.code === 'Digit2' && shrineChoices.choices[1]) {
      shrineChoices.choices[1].apply();
      audioManager.play('shrine_accept', 'sfx');
      upgradeFeedback = { text: shrineChoices.choices[1].feedbackText, until: performance.now() + 1500 };
      shrineChoices = null;
      return;
    }
    if (e.code === 'Digit3' && shrineChoices.choices[2]) {
      shrineChoices.choices[2].apply();
      audioManager.play('shrine_accept', 'sfx');
      upgradeFeedback = { text: shrineChoices.choices[2].feedbackText, until: performance.now() + 1500 };
      shrineChoices = null;
      return;
    }
    return;
  }
  if (upgradeChoices) {
    return;
  }
  if (gameState !== 'PLAYING' && gameState !== 'COUNTDOWN') return;
  if (isPaused) return;
  keys.add(e.code);
}

function onKeyUp(e) {
  if (inputMode === 'modal' && settingsOpen) return;
  keys.delete(e.code);
}

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);
canvas.addEventListener('mousemove', (e) => {
  const coords = getCanvasCoords(e);
  mx = coords.x;
  my = coords.y;
  if (settingsOpen) {
    canvas.style.cursor = 'default';
    return;
  }
  let hovered = false;
  for (const a of uiHitAreas) {
    if (mx >= a.x && mx <= a.x + a.w && my >= a.y && my <= a.y + a.h) {
      hovered = true;
      if (a.focus != null) setUiFocus(a);
      break;
    }
  }
  canvas.style.cursor = hovered ? 'pointer' : 'default';
  if (inputMode === 'upgrade') {
    topRightControls.hover = null;
    return;
  }
  if (!settingsOpen || !settingsDrag || !settingsLayout) {
    const dx = mx - muteButton.x;
    const dy = my - muteButton.y;
    const sx = mx - settingsButton.x;
    const sy = my - settingsButton.y;
    if (dx * dx + dy * dy <= muteButton.r * muteButton.r) {
      topRightControls.hover = 'mute';
    } else if (sx * sx + sy * sy <= settingsButton.r * settingsButton.r) {
      topRightControls.hover = 'settings';
    } else {
      topRightControls.hover = null;
    }
    return;
  }
  const r = settingsLayout.sliders[settingsDrag];
  const val = Math.max(0, Math.min(1, (mx - r.x) / r.w));
  audioManager.setChannelVolume(settingsDrag, val);
});
canvas.addEventListener('mouseup', () => {
  settingsDrag = null;
});
canvas.addEventListener('wheel', (e) => {
  if (!settingsOpen || !settingsLayout || settingsLayout.scrollMax <= 0) return;
  e.preventDefault();
  settingsScrollY += e.deltaY;
  settingsScrollY = Math.max(0, Math.min(settingsScrollY, settingsLayout.scrollMax));
}, { passive: false });

/** HUD: space above room for health bar. Health bar renders outside inner room, between canvas top and room top. */
const HUD_HEIGHT = 52;
/** HUD: offset from room top; healthBarY = room.y - HUD_OFFSET so bar sits above the blue frame. */
const HUD_OFFSET = 40;
/** Health bar: smooth fill lerp and damage flash. */
let healthBarDisplayRatio = 1;
let healthBarDamageFlashUntil = 0;
const HEALTH_BAR_LERP_SPEED = 0.12;
const HEALTH_BAR_DAMAGE_FLASH_MS = 180;

// --- Shared room geometry. Room starts below HUD strip so health bar renders outside playable area. ---
const room = new Room(0, HUD_HEIGHT, 800, 600 - HUD_HEIGHT, 20);
const inner = room.getInnerRect();
const center = room.getCenter();

// Spawn scaling: base range, depth bonus, modifier bonus, per-room randomness.
const ENEMY_COUNT_MIN = 4;
const ENEMY_COUNT_MAX = 7;
const ENEMY_COUNT_BONUS_PER_DEPTH = 0.5;
const ENEMY_COUNT_BONUS_MAX = 5;
const ENEMY_COUNT_MODIFIER_SCALE = 0.6; // difficultyModifier → extra enemies
const ENEMY_COUNT_ROOM_RANDOM = 2;      // +0 to N extra per room
const ENEMY_COUNT_CAP = 14;             // avoid overcrowding
const ENEMY_SPEED_BASE = 1.2;
const ENEMY_SPEED_BONUS_PER_DEPTH = 0.08;
const ENEMY_SPEED_MAX = 2.4;
const BOSS_SIZE = 48;
const BOSS_HEALTH = 28;
const BOSS_SPEED = 2.2;

/** Stat caps — prevent upgrades from making the player trivial. Tune here. */
const FIRE_COOLDOWN_MIN_MS = 70;  // Cap fire rate; lower = faster. 70ms ≈ 14 shots/sec.
const MOVE_SPEED_MAX = 8;         // Cap movement; higher = trivial dodging in small rooms.
const BULLET_SPEED_MAX = 20;      // Cap projectile speed; higher = instant hits, no aim needed.
const BULLETS_PER_SHOT_MAX = 4;   // Cap multishot; more = screen clutter, trivial clears.

/** Door colors. Locked = combat (enemies alive). Boss locked = can't enter yet. Green = progress, blue = explored. */
const LOCKED_DOOR_COLOR = '#5d2e46';
const BOSS_LOCKED_DOOR_COLOR = '#6b2d5c';
const DOOR_TO_UNCLEARED_COLOR = '#27ae60';
const DOOR_TO_CLEARED_COLOR = '#3498db';
/** Inset from door when placing player after transition; keep them clear of entrance to avoid re-trigger. */
const ENTRANCE_INSET = 40;

/** Transition guard: true after transitioning; cleared when player leaves the doorway. Prevents double-trigger. */
let justTransitioned = false;

/** Teleport pad cooldown: time of last teleport; prevents immediate re-trigger and bounce-back. */
let lastTeleportTime = 0;
const TELEPORT_COOLDOWN_MS = 300;

/** Hit effects: flash duration (ms). Reusable for any entity that sets hitUntil. */
const HIT_FLASH_MS = 100;
/** Boss impact: stronger shake and longer flash when boss is hit. */
const BOSS_HIT_FLASH_MS = 155;
const BOSS_SHAKE_PER_HIT = 4;
/** Death effects: stateless, frame-based. Spawned when enemy/boss removed; drawn for ~1–2 frames. Visual only. */
const deathEffects = [];
const DEATH_EFFECT_MS = 45;

/** Muzzle flash: brief flash at shoot position. Lasts ~1–2 frames. Null when inactive. */
let muzzleFlash = null;
const MUZZLE_FLASH_MS = 35;

/** Bullet spawn pop: bullets draw larger for a few frames then scale to normal. Visual only; collision unchanged. */
const BULLET_POP_DURATION_MS = 50;
const BULLET_POP_SCALE_MAX = 1.35;

/** Screen shake: magnitude in pixels, decays each frame. Low intensity, quick decay. Reusable for future impacts. */
let screenShakeMagnitude = 0;
const SHAKE_PER_HIT = 2;
const SHAKE_MAX = 8;
const SHAKE_DECAY = 0.72;
const SHAKE_THRESHOLD = 0.2;

/** Upgrade stats (modified by upgrades). */
let bulletSpeed = 10;
let fireCooldownMs = 150;
let lastShotTime = 0;
let bulletsPerShot = 1;

/** Upgrade choices shown after clearing a room. Null when not shown. */
/** @type {{ choices: { label: string, apply: () => void }[] } | null} */
let upgradeChoices = null;
let upgradeSelectedIndex = 0;

/** Demon Shrine: deal choices. Null when not shown. Each deal has positive + negative effects. */
/** @type {{ choices: { label: string, feedbackText: string, apply: () => void }[] } | null} */
let shrineChoices = null;

/** Healing Room: choices shown every N non-boss room clears. Mutually exclusive with upgradeChoices until resolved. */
/** @type {{ choices: { label: string, feedbackText: string, apply: () => void }[] } | null} */
let healingChoices = null;
/** Non-boss rooms cleared this run. Used to trigger healing event every HEALING_ROOM_INTERVAL. */
let nonBossRoomsCleared = 0;
const HEALING_ROOM_INTERVAL = 3;

/** Demon Shrine: enemy damage multiplier (applied when enemy/boss touches player). Permanent per run. */
let enemyDamageMultiplier = 1;
/** Demon Shrine: bonus added to roomsCleared for spawn difficulty (future rooms harder). Permanent per run. */
let difficultyModifier = 0;

/** Feedback message after picking an upgrade. Fades out after ~1.5s. */
/** @type {{ text: string, until: number } | null} */
let upgradeFeedback = null;

/** @type {Bullet[]} */
const bullets = [];

/** Enemy projectiles (Sniper). Hit player; destroyed by walls. */
const enemyProjectiles = [];

/** Global game state: MENU, COUNTDOWN, PLAYING, DEAD, VICTORY. All transitions centralized below. */
let gameState = 'MENU';

const PLAYER_MAX_HP = 3;

/** Menu: 'main' | 'help' | 'heroes' | 'loadout'. Help/Heroes/Loadout show sub-screens; main shows options. */
let menuScreen = 'main';
let menuSelectedIndex = 0;
const MENU_OPTIONS_MAIN = [
  { id: 'start', label: 'Start Game', subtitle: 'Begin a new run with your selected hero' },
  { id: 'heroes', label: 'Heroes', subtitle: 'View and upgrade your heroes' },
  { id: 'loadout', label: 'Loadout', subtitle: 'Equip gear for your active hero' },
  { id: 'enemies', label: 'Enemies', subtitle: 'Bestiary and enemy profiles' },
  { id: 'help', label: 'Help', subtitle: 'Controls and how to play' },
];

// --- UI: clean minimal sci-fi aesthetic (cinematic layout) ---
const UI = {
  bg: '#0a0e18',
  navy: '#0d1220',
  panelGlass: 'rgba(12,20,36,0.8)',
  panelBorder: 'rgba(80,120,180,0.18)',
  accent: '#5b8def',
  accentDim: 'rgba(91,141,239,0.35)',
  title: '#e8ecf4',
  header: '#c8d0e0',
  body: '#94a3b8',
  hint: '#64748b',
  locked: '#475569',
  cardGap: 20,
  cardPadding: 18,
  /** Central content width (other screens). Main menu uses mainPanelWidthRatio. */
  contentRatio: 0.78,
  /** Edge margin for clean layout. */
  edgeMargin: 40,
  /** Panel internal padding (all screens). */
  panelPadding: 40,
  /** Typography: proportional scale. */
  fontScreenTitle: 20,
  fontModalTitle: 24,
  fontPanelTitle: 24,
  fontSectionHeader: 15,
  fontBody: 14,
  fontHint: 12,
  fontLabel: 11,
  /** Screen title Y from top (HEROES, LOADOUT, ENEMIES). */
  screenTitleY: 38,
  /** Navigation hint: offset from bottom (all screens use ch - navHintOffset). */
  navHintOffset: 40,
  /** Carousel strip: distance from bottom to top of strip (leaves room for nav hint below). */
  carouselStripTopOffset: 170,
  /** Vertical rhythm. */
  sectionGap: 24,
  lineGap: 20,
  /** Main menu inner panel: 78–82% for readability. */
  mainPanelWidthRatio: 0.8,
  mainPanelPad: 32,
  mainPanelGap: 18,
  /** Unified corner radii. */
  radiusButton: 10,
  radiusPanel: 14,
  radiusModal: 18,
  radiusSlot: 8,
};
/** Menu transition: fades in on screen change. */
const MENU_TRANSITION_MS = 200;
let menuTransitionAlpha = 1;
let menuTransitionStart = performance.now() - MENU_TRANSITION_MS;
const MENU_CLICK_FLASH_MS = 120;
let menuClickFlashUntil = 0;

const audioManager = window.audioManager || {
  play() {},
  playLoop() {},
  stop() {},
  setVolume() {},
  setChannelVolume() {},
  toggleMute() {},
  muted: { master: false, music: false, sfx: false, ui: false },
};
let ambientMode = null;
let ambientStarted = false;
let lowHpWarningActive = false;
const muteButton = { x: 0, y: 0, r: 14 };
let isPaused = false;
let pauseSelectedIndex = 0;
const settingsButton = { x: 0, y: 0, r: 14 };
let settingsOpen = false;
let settingsDrag = null;
let settingsLayout = null;
let settingsOpenAt = 0;
let settingsScrollY = 0;
let inputMode = 'game';
let inputModePrev = 'game';
let uiHitAreas = [];
const topRightControls = {
  padding: 16,
  size: 40,
  gap: 10,
  hover: null,
};

function setPaused(state) {
  if (inputMode === 'upgrade') return;
  if (isPaused === state) return;
  isPaused = state;
  pauseSelectedIndex = 0;
  audioManager.setChannelVolume('music', isPaused ? 0.125 : 0.25, { persist: false });
  if (isPaused) {
    inputMode = 'modal';
  } else if (inputMode !== 'modal' && inputMode !== 'death') {
    inputMode = gameState === 'MENU' ? 'menu' : 'game';
  }
}

function layoutTopRightControls(cw, yOffset = 0) {
  const size = topRightControls.size;
  const pad = topRightControls.padding;
  const gap = topRightControls.gap;
  const totalW = size * 2 + gap;
  const left = cw - pad - totalW;
  const top = pad + yOffset;
  muteButton.x = left + size / 2;
  muteButton.y = top + size / 2;
  muteButton.r = size / 2;
  settingsButton.x = left + size + gap + size / 2;
  settingsButton.y = top + size / 2;
  settingsButton.r = size / 2;
}

function drawIconButton(ctx, cx, cy, r, icon, hovered) {
  ctx.save();
  ctx.fillStyle = 'rgba(12,20,36,0.8)';
  if (hovered) {
    ctx.shadowColor = 'rgba(91,141,239,0.45)';
    ctx.shadowBlur = 10;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.strokeStyle = UI.panelBorder;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = UI.title;
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, cx, cy);
  ctx.restore();
}

function drawTopRightControls(ctx, cw, yOffset = 0) {
  layoutTopRightControls(cw, yOffset);
  drawIconButton(ctx, muteButton.x, muteButton.y, muteButton.r, audioManager.muted.master ? '🔇' : '🔊', topRightControls.hover === 'mute');
  drawIconButton(ctx, settingsButton.x, settingsButton.y, settingsButton.r, '⚙', topRightControls.hover === 'settings');
}

function registerTopRightHitAreas() {
  uiHitAreas.push({
    x: muteButton.x - muteButton.r,
    y: muteButton.y - muteButton.r,
    w: muteButton.r * 2,
    h: muteButton.r * 2,
    onClick: () => {
      audioManager.toggleMute();
      if (!audioManager.muted.master) {
        audioManager.play('menu_select', 'ui');
        setAmbient(gameState === 'MENU' ? 'menu' : 'gameplay');
      }
    },
  });
  uiHitAreas.push({
    x: settingsButton.x - settingsButton.r,
    y: settingsButton.y - settingsButton.r,
    w: settingsButton.r * 2,
    h: settingsButton.r * 2,
    onClick: () => {
      openSettingsModal();
    },
  });
}

function openSettingsModal() {
  if (inputMode === 'upgrade') return;
  settingsOpen = true;
  settingsOpenAt = performance.now();
  settingsDrag = null;
  settingsScrollY = 0;
  inputModePrev = inputMode;
  inputMode = 'modal';
}

function closeSettingsModal() {
  settingsOpen = false;
  settingsDrag = null;
  inputMode = inputModePrev || (gameState === 'MENU' ? 'menu' : 'game');
}

function handleMainMenuSelect(index) {
  const opt = MENU_OPTIONS_MAIN[index];
  if (!opt) return;
  if (opt.id === 'start') {
    const heroId = getSelectedHeroId();
    if (!isHeroUnlocked(heroId)) return;
    startNewRun();
    gameState = 'COUNTDOWN';
    countdownStartTime = performance.now();
  }
  if (opt.id === 'heroes') { menuScreen = 'heroes'; menuSelectedIndex = 0; heroSelectionLerp = 0; startMenuTransition(); }
  if (opt.id === 'loadout') { menuScreen = 'loadout'; menuSelectedIndex = 0; startMenuTransition(); }
  if (opt.id === 'enemies') { menuScreen = 'enemies'; menuSelectedIndex = 0; enemySelectionLerp = 0; enemyTransitionAlpha = 1; startMenuTransition(); }
  if (opt.id === 'help') { menuScreen = 'help'; startMenuTransition(); }
}

function handlePauseSelect(index) {
  if (index === 0) {
    setPaused(false);
  } else if (index === 1) {
    openSettingsModal();
  } else {
    setPaused(false);
    gameState = 'MENU';
    menuScreen = 'main';
    menuSelectedIndex = 0;
    startMenuTransition();
  }
}

function handleDeathSelect(index) {
  if (index === 0) {
    startNewRun();
    gameState = 'COUNTDOWN';
    countdownStartTime = performance.now();
    inputMode = 'game';
  } else {
    gameState = 'MENU';
    menuScreen = 'main';
    menuSelectedIndex = 0;
    inputMode = 'menu';
  }
}

function handleUpgradeSelect(index) {
  if (!upgradeChoices) return;
  const choice = upgradeChoices.choices[index];
  if (!choice) {
    audioManager.play('menu_error', 'ui');
    return;
  }
  choice.apply();
  audioManager.play('upgrade_success', 'ui');
  upgradeFeedback = { text: choice.feedbackText, until: performance.now() + 1500 };
  upgradeChoices = null;
  upgradeSelectedIndex = 0;
  inputMode = 'game';
}

function enterDeathState() {
  gameState = 'DEAD';
  deadSelectedIndex = 0;
  inputMode = 'death';
}

function handleHeroesSelect(index) {
  const heroIds = getAllHeroIds();
  const heroId = heroIds[index];
  const progress = heroId ? getHeroProgress(heroId) : null;
  if (!progress) return;
  if (!progress.unlocked) {
    unlockHero(heroId);
    audioManager.play('hero_unlock', 'ui');
    return;
  }
  upgradeHero(heroId);
  audioManager.play('upgrade_success', 'ui');
}

function setUiFocus(area) {
  if (!area || area.focus == null) return;
  if (area.focus === 'main') menuSelectedIndex = area.index;
  if (area.focus === 'loadout') menuSelectedIndex = area.index;
  if (area.focus === 'heroes') menuSelectedIndex = area.index;
  if (area.focus === 'enemies') menuSelectedIndex = area.index;
  if (area.focus === 'pause') pauseSelectedIndex = area.index;
  if (area.focus === 'upgrade') upgradeSelectedIndex = area.index;
}

function drawToggle(ctx, x, y, label, value) {
  const w = 44;
  const h = 20;
  ctx.fillStyle = UI.body;
  ctx.font = UI.fontHint + 'px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + h / 2);
  const tx = x + 160;
  ctx.fillStyle = value ? 'rgba(91,141,239,0.7)' : 'rgba(30,40,55,0.7)';
  roundRect(ctx, tx, y, w, h, UI.radiusSlot);
  ctx.fill();
  ctx.strokeStyle = UI.panelBorder;
  roundRect(ctx, tx, y, w, h, UI.radiusSlot);
  ctx.stroke();
  ctx.fillStyle = value ? UI.title : UI.hint;
  ctx.beginPath();
  ctx.arc(tx + (value ? w - 10 : 10), y + h / 2, 7, 0, Math.PI * 2);
  ctx.fill();
  return { x: tx, y, w, h };
}

function drawSlider(ctx, x, y, w, value, label) {
  const h = 6;
  ctx.fillStyle = UI.body;
  ctx.font = UI.fontHint + 'px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y - 10);
  ctx.fillStyle = UI.hint;
  ctx.textAlign = 'right';
  ctx.fillText(Math.round(value * 100) + '%', x + w, y - 10);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, x, y, w, h, UI.radiusSlot);
  ctx.fill();
  ctx.fillStyle = UI.accent;
  roundRect(ctx, x, y, w * value, h, UI.radiusSlot);
  ctx.fill();
  ctx.strokeStyle = UI.panelBorder;
  roundRect(ctx, x, y, w, h, UI.radiusSlot);
  ctx.stroke();
  ctx.fillStyle = UI.title;
  ctx.beginPath();
  ctx.arc(x + w * value, y + h / 2, 6, 0, Math.PI * 2);
  ctx.fill();
  return { x, y: y - 6, w, h: h + 12 };
}

function drawSettingsPanel(ctx, cw, ch) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, cw, ch);
  const t = Math.min(1, (performance.now() - settingsOpenAt) / 140);
  const ease = t * (2 - t);
  const panelW = 420;
  const paddingTop = 70;
  const paddingBottom = 32;
  const paddingX = 40;
  const sliderGap = 56;
  const toggleGap = 38;
  const dividerGap = 52;
  const titleHeight = 32;
  const sliderBlock = 4 * sliderGap;
  const muteBlock = 4 * toggleGap + 24;
  const contentHeight = paddingTop + titleHeight + sliderBlock + dividerGap + muteBlock + paddingBottom;
  const panelH = Math.min(contentHeight, ch - 80);
  const px = cw / 2 - panelW / 2;
  const py = ch / 2 - panelH / 2;
  ctx.globalAlpha = ease;
  ctx.translate(cw / 2, ch / 2);
  ctx.scale(0.985 + 0.015 * ease, 0.985 + 0.015 * ease);
  ctx.translate(-cw / 2, -ch / 2);
  drawGlassPanel(px, py, panelW, panelH, null, UI.radiusModal);
  ctx.strokeStyle = UI.accentDim;
  roundRect(ctx, px + 1, py + 1, panelW - 2, panelH - 2, UI.radiusModal - 2);
  ctx.stroke();
  ctx.save();
  roundRect(ctx, px, py, panelW, panelH, UI.radiusModal);
  ctx.clip();
  ctx.fillStyle = UI.title;
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Audio Settings', cw / 2, py + 32);

  const sx = px + paddingX;
  const sliderW = panelW - paddingX * 2;
  const scrollMax = Math.max(0, contentHeight - panelH);
  settingsScrollY = Math.max(0, Math.min(settingsScrollY, scrollMax));
  const contentTop = py + paddingTop - settingsScrollY;
  let y = contentTop;
  const sliders = {};
  sliders.master = drawSlider(ctx, sx, y, sliderW, audioManager.volumes.master, 'Master Volume');
  y += sliderGap;
  sliders.music = drawSlider(ctx, sx, y, sliderW, audioManager.volumes.music, 'Music Volume');
  y += sliderGap;
  sliders.sfx = drawSlider(ctx, sx, y, sliderW, audioManager.volumes.sfx, 'SFX Volume');
  y += sliderGap;
  sliders.ui = drawSlider(ctx, sx, y, sliderW, audioManager.volumes.ui, 'UI Volume');

  y += dividerGap;
  ctx.strokeStyle = 'rgba(91,141,239,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx, y);
  ctx.lineTo(sx + sliderW, y);
  ctx.stroke();
  y += 18;
  ctx.fillStyle = UI.hint;
  ctx.font = UI.fontHint + 'px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Mute Toggles', sx, y);
  y += 22;
  const toggles = {};
  toggles.master = drawToggle(ctx, sx, y, 'Mute All', audioManager.muted.master);
  y += toggleGap;
  toggles.music = drawToggle(ctx, sx, y, 'Mute Music', audioManager.isMusicMuted);
  y += toggleGap;
  toggles.sfx = drawToggle(ctx, sx, y, 'Mute SFX', audioManager.muted.sfx);
  y += toggleGap;
  toggles.ui = drawToggle(ctx, sx, y, 'Mute UI', audioManager.muted.ui);

  ctx.restore();
  ctx.restore();
  settingsLayout = { panel: { x: px, y: py, w: panelW, h: panelH }, sliders, toggles, scrollMax };
  if (settingsOpen) {
    uiHitAreas.length = 0;
    Object.entries(sliders).forEach(([key, r]) => {
      uiHitAreas.push({
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        onClick: () => {
          settingsDrag = key;
        },
      });
    });
    Object.entries(toggles).forEach(([key, r]) => {
      uiHitAreas.push({
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        onClick: () => {
          if (key === 'music') {
            const next = !audioManager.isMusicMuted;
            audioManager.setMute(next, 'music');
            if (!next) restartAmbientMusic();
          } else {
            audioManager.setMute(!audioManager.muted[key], key);
          }
        },
      });
    });
  }
}

function getLoadoutNavMap() {
  const slotIndexById = Object.fromEntries(EQUIPMENT_SLOTS.map((s, i) => [s, i]));
  const items = [
    { key: 'hero', row: 0, col: 0, index: 0 },
    { key: 'weaponCore', row: 1, col: 0, index: 1 + slotIndexById.weaponCore },
    { key: 'relic', row: 1, col: 1, index: 1 + slotIndexById.relic },
    { key: 'armor', row: 2, col: 0, index: 1 + slotIndexById.armor },
    { key: 'boots', row: 2, col: 1, index: 1 + slotIndexById.boots },
    { key: 'catalyst', row: 3, col: 0, index: 1 + slotIndexById.catalyst },
    { key: 'charm', row: 3, col: 1, index: 1 + slotIndexById.charm },
    { key: 'sigil', row: 3, col: 2, index: 1 + slotIndexById.sigil },
    { key: 'artifact', row: 3, col: 3, index: 1 + slotIndexById.artifact },
    { key: 'back', row: 4, col: 0, index: 1 + EQUIPMENT_SLOTS.length },
  ];
  const byIndex = {};
  items.forEach((it) => { byIndex[it.index] = it; });
  return { items, byIndex };
}

function moveLoadoutSelection(current, dir) {
  const nav = getLoadoutNavMap();
  const cur = nav.byIndex[current] || nav.items[0];
  let targetRow = cur.row;
  let targetCol = cur.col;
  if (dir === 'up') targetRow -= 1;
  if (dir === 'down') targetRow += 1;
  if (dir === 'left') targetCol -= 1;
  if (dir === 'right') targetCol += 1;

  const sameRow = nav.items.filter((it) => it.row === targetRow);
  if (!sameRow.length) return current;
  let best = sameRow[0];
  let bestDist = Math.abs(best.col - targetCol);
  sameRow.forEach((it) => {
    const d = Math.abs(it.col - targetCol);
    if (d < bestDist) {
      best = it;
      bestDist = d;
    }
  });
  return best.index;
}

function handleLoadoutSelect(selectedIndex) {
  const heroIds = getAllHeroIds().filter((id) => isHeroUnlocked(id));
  const slotCount = EQUIPMENT_SLOTS.length;
  const totalRows = 1 + slotCount + 1;
  if (selectedIndex === 0) {
    if (!heroIds.length) return;
    const idx = heroIds.indexOf(getSelectedHeroId());
    const next = heroIds[(idx + 1) % heroIds.length];
    setSelectedHeroId(next);
    audioManager.play('hero_select', 'ui');
    return;
  }
  if (selectedIndex === totalRows - 1) {
    menuScreen = 'main';
    startMenuTransition();
    return;
  }
  const heroId = getSelectedHeroId();
  const slotIndex = selectedIndex - 1;
  const slot = EQUIPMENT_SLOTS[slotIndex];
  const owned = getOwnedGearIds().filter((id) => GEAR_CATALOG[id] && GEAR_CATALOG[id].slot === slot);
  const current = getEquippedGear(heroId)[slot];
  let next = null;
  const curIdx = current ? owned.indexOf(current) : -1;
  if (owned.length) next = owned[(curIdx + 1) % (owned.length + 1)] || null;
  if (next && next !== current) audioManager.play('equip_item', 'ui');
  if (!next && current) audioManager.play('unequip_item', 'ui');
  setEquippedSlot(heroId, slot, next);
}

function startMenuTransition() {
  menuTransitionStart = performance.now();
  menuTransitionAlpha = 0;
}

function triggerMenuClickFlash() {
  menuClickFlashUntil = performance.now() + MENU_CLICK_FLASH_MS;
}

function setAmbient(mode) {
  if (ambientMode !== mode) {
    if (ambientMode === 'menu') audioManager.fadeOutLoop('menu_ambient_loop', 500);
    if (ambientMode === 'gameplay') audioManager.fadeOutLoop('gameplay_ambient_loop', 500);
    ambientMode = mode;
    ambientStarted = false;
  }
  const canPlay = typeof audioManager.unlocked === 'boolean' ? audioManager.unlocked : true;
  if (!ambientMode || !canPlay || audioManager.muted.master) {
    ambientStarted = false;
    return;
  }
  if (ambientStarted) return;
  if (ambientMode === 'menu') audioManager.fadeInLoop('menu_ambient_loop', 'music', 500);
  if (ambientMode === 'gameplay') audioManager.fadeInLoop('gameplay_ambient_loop', 'music', 500);
  ambientStarted = true;
}

function restartAmbientMusic() {
  audioManager.fadeOutLoop('menu_ambient_loop', 200);
  audioManager.fadeOutLoop('gameplay_ambient_loop', 200);
  ambientStarted = false;
  if (gameState === 'MENU') audioManager.fadeInLoop('menu_ambient_loop', 'music', 500);
  if (gameState === 'PLAYING') audioManager.fadeInLoop('gameplay_ambient_loop', 'music', 500);
}
const MENU_STARS = [];
for (let i = 0; i < 48; i++) {
  MENU_STARS.push({
    x: Math.random(), y: Math.random(),
    r: 0.5 + Math.random() * 1, twinkle: Math.random() * Math.PI * 2,
  });
}
function drawMenuBackground(cw, ch) {
  const cx = cw / 2;
  const cy = ch * 0.45;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(cw, ch) * 0.85);
  grad.addColorStop(0, '#121a2f');
  grad.addColorStop(1, '#050810');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);
  const ambient = ctx.createLinearGradient(0, 0, 0, ch);
  ambient.addColorStop(0, 'rgba(255,255,255,0.06)');
  ambient.addColorStop(0.6, 'rgba(0,0,0,0)');
  ambient.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = ambient;
  ctx.fillRect(0, 0, cw, ch);
  const t = performance.now() * 0.0007;
  MENU_STARS.forEach((s) => {
    const flicker = 0.05 + 0.08 * (0.5 + 0.5 * Math.sin(t + s.twinkle));
    ctx.fillStyle = `rgba(255,255,255,${flicker})`;
    ctx.beginPath();
    ctx.arc(s.x * cw, s.y * ch, s.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.strokeStyle = 'rgba(60,100,160,0.06)';
  ctx.lineWidth = 1;
  const gridStep = 40;
  const driftX = (t * 12) % gridStep;
  const driftY = (t * 8) % gridStep;
  for (let gx = -gridStep; gx <= cw + gridStep; gx += gridStep) {
    ctx.beginPath();
    ctx.moveTo(gx + driftX, 0);
    ctx.lineTo(gx + driftX, ch);
    ctx.stroke();
  }
  for (let gy = -gridStep; gy <= ch + gridStep; gy += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, gy + driftY);
    ctx.lineTo(cw, gy + driftY);
    ctx.stroke();
  }

  const vignette = ctx.createRadialGradient(cx, cy, Math.min(cw, ch) * 0.15, cx, cy, Math.max(cw, ch) * 0.9);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.65, 'rgba(0,0,0,0.2)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, cw, ch);
}
function drawGlassButton(x, y, w, h, selected) {
  const now = performance.now();
  const pulse = selected ? 0.35 + 0.35 * Math.sin((now / 1200) * Math.PI * 2) : 0;
  const radius = UI.radiusButton;
  ctx.save();
  if (selected) {
    ctx.shadowColor = 'rgba(100,150,255,0.6)';
    ctx.shadowBlur = 15;
  }
  ctx.fillStyle = UI.panelGlass;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();
  if (!selected) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    roundRect(ctx, x, y, w, h, radius);
    ctx.fill();
  }
  if (selected && now < menuClickFlashUntil) {
    const flash = (menuClickFlashUntil - now) / MENU_CLICK_FLASH_MS;
    ctx.fillStyle = `rgba(255,255,255,${0.2 * flash})`;
    roundRect(ctx, x, y, w, h, radius);
    ctx.fill();
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.strokeStyle = selected ? `rgba(91,141,239,${pulse})` : UI.panelBorder;
  ctx.lineWidth = selected ? 1.5 : 1;
  roundRect(ctx, x, y, w, h, radius);
  ctx.stroke();
  if (selected) {
    ctx.fillStyle = UI.accentDim;
    roundRectLeft(ctx, x, y, 3, h, radius);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(x + 1, y + 1, w - 2, 1);
  }
  ctx.restore();
}
function drawPanel(x, y, w, h, highlighted = false) {
  drawGlassButton(x, y, w, h, highlighted);
}

/** Slot icons for loadout (Unicode symbols). */
const SLOT_ICONS = {
  weaponCore: '\u2694',
  catalyst: '\u25C7',
  armor: '\u25A1',
  boots: '\u2302',
  relic: '\u25C6',
  charm: '\u25D1',
  sigil: '\u271A',
  artifact: '\u25CE',
};

/** Rarity accent colors for hero cards and shard bars. */
const RARITY_ACCENTS = {
  common: '#94a3b8',
  uncommon: '#34d399',
  rare: '#60a5fa',
  epic: '#a78bfa',
  legendary: '#fbbf24',
};

/** Rarity glow auras for selected hero (Common=blue, Uncommon=crimson, Rare=teal/arcane). */
const RARITY_GLOW_AURAS = {
  common: { inner: '#3b82f6', outer: '#60a5fa44', rim: '#93c5fd' },
  uncommon: { inner: '#dc2626', outer: '#ef444444', rim: '#f87171' },
  rare: { inner: '#14b8a6', outer: '#2dd4bf44', rim: '#5eead4' },
  epic: { inner: '#a78bfa', outer: '#c4b5fd44', rim: '#ddd6fe' },
  legendary: { inner: '#fbbf24', outer: '#fcd34d44', rim: '#fde68a' },
};

/** Draw multiline text with explicit line height. Returns total height used. */
function drawMultilineText(ctx, text, x, y, options = {}) {
  const {
    maxWidth = Infinity,
    lineHeight = 20,
    align = 'left',
    color = UI.body,
    font = UI.fontHint + 'px sans-serif',
  } = options;
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const lines = String(text).split(/\n/);
  let usedHeight = 0;
  lines.forEach((line) => {
    ctx.fillText(line.trim(), x, y + usedHeight, maxWidth);
    usedHeight += lineHeight;
  });
  ctx.restore();
  return usedHeight;
}

function drawTrackingText(ctx, text, x, y, options = {}) {
  const {
    spacing = 1.5,
    color = UI.title,
    font = UI.fontScreenTitle + 'px sans-serif',
    align = 'center',
  } = options;
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  const chars = String(text).split('');
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((sum, w) => sum + w, 0) + spacing * Math.max(0, chars.length - 1);
  let startX = x;
  if (align === 'center') startX = x - total / 2;
  else if (align === 'right') startX = x - total;
  let cx = startX;
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += widths[i] + spacing;
  });
  ctx.restore();
  return total;
}

function drawHeaderUnderline(ctx, x, y, width) {
  const pulse = 0.4 + 0.3 * Math.sin(performance.now() * (2 * Math.PI / 1200));
  ctx.save();
  ctx.strokeStyle = `rgba(91,141,239,${pulse})`;
  ctx.shadowColor = `rgba(91,141,239,${pulse})`;
  ctx.shadowBlur = 6;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - width / 2, y + 10);
  ctx.lineTo(x + width / 2, y + 10);
  ctx.stroke();
  ctx.restore();
}

function getTitleYOffset() {
  return -10 * (1 - menuTransitionAlpha);
}

/** Glass panel: minimal sci-fi. */
function drawGlassPanel(x, y, w, h, accentColor = null, radius = UI.radiusPanel) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = UI.panelGlass;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = accentColor || UI.panelBorder;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, radius);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
}

/**
 * Help screen: fully isolated. Single render path.
 * Order: 1) Background  2) Title  3) Panel  4) Help text  5) Navigation hint (SINGLE instance).
 */
function drawHelpScreen(cw, ch) {
  ctx.save();

  drawMenuBackground(cw, ch);
  ctx.globalAlpha = menuTransitionAlpha;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const pad = UI.mainPanelPad;
  const gap = UI.mainPanelGap;
  const panelW = Math.round(cw * UI.mainPanelWidthRatio);
  const panelH = Math.min(380, Math.round(ch * 0.55));
  const px = (cw - panelW) / 2;
  const py = (ch - panelH) / 2 - 20;
  const contentX = px + pad;

  // 2. Title (above panel)
  const helpTitleW = drawTrackingText(ctx, 'HOW TO PLAY', cw / 2, py - 16 + getTitleYOffset(), {
    spacing: 1.5,
    font: `bold ${UI.fontModalTitle}px sans-serif`,
    color: UI.title,
  });
  drawHeaderUnderline(ctx, cw / 2, py - 16 + getTitleYOffset(), helpTitleW);

  // 3. Panel
  drawGlassPanel(px, py, panelW, panelH, null, UI.radiusModal);

  // 4. Help text (inside panel)
  const keycap = (key, x, y) => {
    const kw = 28;
    const kh = 22;
    ctx.save();
    ctx.fillStyle = 'rgba(30,40,55,0.8)';
    ctx.strokeStyle = UI.panelBorder;
    ctx.lineWidth = 1;
    ctx.fillRect(x - kw / 2, y - kh / 2, kw, kh);
    ctx.strokeRect(x - kw / 2, y - kh / 2, kw, kh);
    ctx.fillStyle = UI.title;
    ctx.font = UI.fontHint + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(key, x, y);
    ctx.restore();
  };

  let contentY = py + pad;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = UI.header;
  ctx.font = 'bold ' + UI.fontSectionHeader + 'px sans-serif';
  ctx.fillText('Controls', contentX, contentY);
  contentY += 26;
  ctx.strokeStyle = 'rgba(80,120,180,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(contentX, contentY - 8);
  ctx.lineTo(px + panelW - pad, contentY - 8);
  ctx.stroke();
  contentY += 18;
  ctx.fillStyle = UI.body;
  ctx.font = UI.fontBody + 'px sans-serif';
  keycap('W', contentX + 24, contentY + 11);
  keycap('A', contentX + 58, contentY + 11);
  keycap('S', contentX + 92, contentY + 11);
  keycap('D', contentX + 126, contentY + 11);
  ctx.fillText('Move', contentX + 185, contentY + 11);
  contentY += 34;
  ctx.beginPath();
  ctx.arc(contentX + 14, contentY + 11, 10, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(30,40,55,0.8)';
  ctx.fill();
  ctx.strokeStyle = UI.panelBorder;
  ctx.stroke();
    ctx.fillStyle = UI.title;
    ctx.font = (UI.fontLabel - 1) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Click', contentX + 14, contentY + 11);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = UI.body;
  ctx.font = (UI.fontBody - 1) + 'px sans-serif';
  ctx.fillText('Shoot (aim at cursor)', contentX + 42, contentY + 11);
  contentY += 42;

  ctx.fillStyle = UI.header;
  ctx.font = 'bold ' + UI.fontSectionHeader + 'px sans-serif';
  ctx.fillText('Objective', contentX, contentY);
  contentY += 26;
  ctx.strokeStyle = 'rgba(80,120,180,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(contentX, contentY - 10);
  ctx.lineTo(px + panelW - pad, contentY - 10);
  ctx.stroke();
  contentY += 22;
  ctx.fillStyle = UI.body;
  ctx.font = UI.fontBody + 'px sans-serif';
  ctx.fillText('Clear all rooms, then defeat the boss.', contentX, contentY);

  // 5. Navigation hint — same position as all screens (ch - navHintOffset)
  ctx.fillStyle = UI.hint;
  ctx.font = UI.fontHint + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Enter or Esc — Back', cw / 2, ch - UI.navHintOffset);

  ctx.restore();
}

/** Hero theme layer: subtle background effects per class. Renders behind hero only. */
function drawHeroThemeLayer(ctx, category, cx, cy, heroSize, platformR, t) {
  const r = platformR;
  if (category === 'vanguard') {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.15);
    ctx.translate(-cx, -cy);
    ctx.strokeStyle = 'rgba(100,200,220,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const cyanPulse = 0.04 + 0.03 * Math.sin(t * 1.8);
    ctx.fillStyle = `rgba(100,200,220,${cyanPulse})`;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 4; i++) {
      const a = t * 0.2 + i * 1.5;
      const fx = cx + Math.cos(a) * r * 0.9;
      const fy = cy + Math.sin(a) * r * 0.9;
      ctx.fillStyle = `rgba(120,200,220,${0.06 + 0.04 * Math.sin(t * 0.8 + i)})`;
      ctx.beginPath();
      ctx.moveTo(fx + 4, fy);
      ctx.lineTo(fx - 2, fy + 3);
      ctx.lineTo(fx - 2, fy - 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + heroSize * 0.48, r * 0.88, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (category === 'executioner') {
    for (let i = 0; i < 5; i++) {
      const px = cx + ((t * 8 + i * 80) % 120) - 60;
      const py = cy + ((t * 5 + i * 60) % 100) - 50;
      const alpha = 0.04 + 0.03 * Math.sin(t * 1.2 + i);
      ctx.fillStyle = `rgba(220,80,60,${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    const hazeGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.2);
    hazeGrad.addColorStop(0, 'rgba(80,40,40,0.03)');
    hazeGrad.addColorStop(0.6, 'rgba(60,30,30,0.02)');
    hazeGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(cx - r * 1.5, cy - r * 1.5, r * 3, r * 3);
    const flicker = 0.02 + 0.015 * Math.sin(t * 4.5);
    ctx.fillStyle = `rgba(200,80,60,${flicker})`;
    ctx.beginPath();
    ctx.arc(cx + r * 0.3, cy - r * 0.2, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
  } else if (category === 'tactician') {
    ctx.save();
    ctx.globalAlpha = 0.06 + 0.02 * Math.sin(t * 0.5);
    ctx.strokeStyle = 'rgba(80,180,180,0.5)';
    ctx.lineWidth = 0.5;
    const gs = 18;
    for (let gx = cx - r * 1.2; gx < cx + r * 1.2; gx += gs) {
      ctx.beginPath();
      ctx.moveTo(gx, cy - r * 1.2);
      ctx.lineTo(gx, cy + r * 1.2);
      ctx.stroke();
    }
    for (let gy = cy - r * 1.2; gy < cy + r * 1.2; gy += gs) {
      ctx.beginPath();
      ctx.moveTo(cx - r * 1.2, gy);
      ctx.lineTo(cx + r * 1.2, gy);
      ctx.stroke();
    }
    ctx.restore();
    const sweepY = cy - r + ((t * 25) % (r * 2.4));
    const sweepGrad = ctx.createLinearGradient(cx, sweepY - 15, cx, sweepY + 15);
    sweepGrad.addColorStop(0, 'transparent');
    sweepGrad.addColorStop(0.4, 'rgba(80,200,200,0.06)');
    sweepGrad.addColorStop(0.6, 'rgba(80,200,200,0.06)');
    sweepGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = sweepGrad;
    ctx.fillRect(cx - r * 1.2, sweepY - 20, r * 2.4, 40);
    for (let i = 0; i < 3; i++) {
      const ax = cx + Math.sin(t * 0.3 + i * 2) * r * 0.8;
      const ay = cy + Math.cos(t * 0.25 + i * 1.5) * r * 0.7;
      ctx.fillStyle = `rgba(80,200,200,${0.05 + 0.03 * Math.sin(t * 0.6 + i)})`;
      ctx.beginPath();
      ctx.moveTo(ax + 5, ay);
      ctx.lineTo(ax - 2.5, ay + 4);
      ctx.lineTo(ax - 2.5, ay - 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(80,200,200,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, heroSize * 0.52, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Hero lobby mouse position for parallax (normalized -1..1). */
let heroLobbyMouseX = 0;
let heroLobbyMouseY = 0;

/** Hero selection lerp for smooth transitions. Updated each frame. */
let heroSelectionLerp = 0;

/** Hero lobby ambient particles for depth. */
const HERO_LOBBY_PARTICLES = [];
function initHeroLobbyParticles() {
  if (HERO_LOBBY_PARTICLES.length) return;
  for (let i = 0; i < 36; i++) {
    HERO_LOBBY_PARTICLES.push({
      x: Math.random() * 900 - 50,
      y: Math.random() * 600 - 50,
      r: 1 + Math.random() * 2,
      speed: 0.02 + Math.random() * 0.04,
      phase: Math.random() * Math.PI * 2,
    });
  }
}
initHeroLobbyParticles();

/** Attack pop: brief scale-up on shoot. Visual only. */
let attackPopUntil = 0;
const ATTACK_POP_MS = 80;
/** Recoil direction for attack feedback (aim direction; recoil = opposite). */
let lastShootDx = 1;
let lastShootDy = 0;

// ---------- Meta data is loaded here (on game start) ----------
loadMeta();

// ---------- Hero sprites: gameplay + Hero/Loadout screens (transparent PNG) ----------
/** Hero sprites: vanguard.png, executioner.png, tactician.png. Used for gameplay and menu screens. */
const heroSprites = {};
const HERO_IDS = ['vanguard', 'executioner', 'tactician'];
function loadHeroSprites() {
  HERO_IDS.forEach((id) => {
    const g = new Image();
    g.src = `assets/heros/${id}.png`;
    heroSprites[id] = g;
  });
}
loadHeroSprites();

// ---------- Enemy sprites: gameplay + Enemies screen (transparent PNG) ----------
/** Enemy sprites: chaser.png, charger.png, sniper.png, splitter.png, boss-1.png. Preloaded at init. */
const enemySprites = {};
const ENEMY_IDS = ['chaser', 'charger', 'sniper', 'splitter', 'boss'];
const ENEMY_SPRITE_PATHS = {
  chaser: 'assets/enemies/chaser.png',
  charger: 'assets/enemies/charger.png',
  sniper: 'assets/enemies/sniper.png',
  splitter: 'assets/enemies/splitter.png',
  boss: 'assets/enemies/boss-1.png',
};
function loadEnemySprites() {
  ENEMY_IDS.forEach((id) => {
    const img = new Image();
    img.src = ENEMY_SPRITE_PATHS[id];
    enemySprites[id] = img;
  });
}
loadEnemySprites();

/** Enemy metadata for Enemies screen. */
const ENEMY_DATA = {
  chaser: {
    name: 'Chaser',
    role: 'Aggressor',
    description: 'Relentlessly pursues the player. No special abilities, pure pressure.',
    stats: { hp: 3, dmg: 2, spd: 3, special: 1 },
    threat: 2,
  },
  charger: {
    name: 'Charger',
    role: 'Dash Unit',
    description: 'Locks on, pauses briefly, then dashes at high velocity.',
    stats: { hp: 4, dmg: 4, spd: 5, special: 3 },
    threat: 3,
  },
  sniper: {
    name: 'Sniper',
    role: 'Ranged',
    description: 'Maintains distance. Aims, then fires high-damage precision shots.',
    stats: { hp: 2, dmg: 5, spd: 2, special: 4 },
    threat: 4,
  },
  splitter: {
    name: 'Splitter',
    role: 'Spawn Unit',
    description: 'On death, splits into two smaller aggressive units.',
    stats: { hp: 5, dmg: 2, spd: 2, special: 5 },
    threat: 4,
  },
  boss: {
    name: 'Overseer',
    role: 'Boss',
    description: 'High HP. Multiple attack phases. Area denial and minion spawn.',
    stats: { hp: 5, dmg: 5, spd: 3, special: 5 },
    threat: 5,
  },
};

/** Enemy selection lerp and transition alpha for Enemies screen. */
let enemySelectionLerp = 0;
let enemyTransitionAlpha = 1;

/** Dead screen: 0 = Retry, 1 = Return to Menu */
let deadSelectedIndex = 0;

/** Countdown: start time and duration per number (ms). */
let countdownStartTime = 0;
const COUNTDOWN_DURATION_MS = 1000;

/** Procedurally generated dungeon. Created on Enter from START; unused until PLAYING. */
let rooms = [];
let startRoomId = 0;
let currentRoomId = 0;

/** Dungeon depth: number of rooms cleared. Used for difficulty scaling. */
let roomsCleared = 0;

/** Elite kills this run. Run-scoped; resets on Retry/Menu. */
let elitesKilledThisRun = 0;

/** Fragment gain this run (for victory summary). Run-scoped; resets on Retry/Menu. */
let fragmentsFromElitesThisRun = 0;
let fragmentsFromBossThisRun = 0;
let fragmentsFromVictoryThisRun = 0;
/** Exploit prevention: victory fragments granted only once per run. */
let runVictoryFragmentsGranted = false;

/** Floating fragment drop feedback. { x, y, text, until } */
const fragmentDropFeedbacks = [];
const FRAGMENT_FEEDBACK_DURATION_MS = 1200;

const player = new Player(center.x, center.y);

/**
 * Spawn a wave of enemies. Count scales with depth, difficultyModifier, and per-room randomness.
 * Early rooms stay easier; later rooms add more, faster enemies.
 */
/**
 * @param {{ x: number, y: number, w: number, h: number }[]} [obstacles] - Room obstacles for spawn validation
 */
function spawnEnemyWave(obstacles = []) {
  const effectiveDepth = roomsCleared + difficultyModifier;
  const countBonus = Math.min(ENEMY_COUNT_BONUS_MAX, Math.floor(effectiveDepth * ENEMY_COUNT_BONUS_PER_DEPTH));
  const modifierBonus = Math.floor(difficultyModifier * ENEMY_COUNT_MODIFIER_SCALE); // Spawn scaling: difficultyModifier → extra enemies
  const roomRandom = Math.floor(Math.random() * (ENEMY_COUNT_ROOM_RANDOM + 1));     // Per-room randomness
  const min = ENEMY_COUNT_MIN + countBonus + modifierBonus;
  const max = ENEMY_COUNT_MAX + countBonus + modifierBonus;
  const n = Math.min(ENEMY_COUNT_CAP, min + Math.floor(Math.random() * (max - min + 1)) + roomRandom);

  const speedBonus = Math.min(ENEMY_SPEED_MAX - ENEMY_SPEED_BASE, effectiveDepth * ENEMY_SPEED_BONUS_PER_DEPTH);
  const speed = ENEMY_SPEED_BASE + speedBonus;

  const wave = [];
  const avoidRects = [{ x: player.x - player.w / 2, y: player.y - player.h / 2, w: player.w, h: player.h }];
  for (let i = 0; i < n; i++) {
    const s = randomSpawnInRoom(inner, 20, 20, obstacles, avoidRects);
    const roll = Math.random();
    if (roll < 0.25) wave.push(new Charger(s.x, s.y, 20, 20));
    else if (roll < 0.5) wave.push(new Sniper(s.x, s.y, 20, 20));
    else if (roll < 0.75) wave.push(new Splitter(s.x, s.y, 20, 20, speed, 2, false));
    else wave.push(new Enemy(s.x, s.y, 20, 20, speed, 2));
    avoidRects.push({ x: s.x - 10, y: s.y - 10, w: 20, h: 20 });
  }

  // Elite selection: at least one enemy may spawn as elite in eligible non-boss rooms.
  const eliteChance = getEliteSpawnChance(difficultyModifier);
  if (wave.length > 0 && Math.random() < eliteChance) {
    const eliteIndex = Math.floor(Math.random() * wave.length);
    const elite = wave[eliteIndex];
    if (!elite.isSplitterChild) {
      attachAffix(elite, pickRandomAffix());
    }
  }

  return wave;
}

/** Spawn boss at room center. Single entity, higher health/size. Doors lock until defeated. */
function spawnBoss() {
  return new Boss(center.x, center.y, BOSS_SIZE, BOSS_SIZE, BOSS_SPEED, BOSS_HEALTH);
}

/**
 * Boss unlock: true only when every non-boss room has cleared === true.
 * Checks all rooms except the boss room.
 */
function areAllNonBossRoomsCleared() {
  const nonBoss = rooms.filter((r) => !r.isBossRoom);
  return nonBoss.length === 0 || nonBoss.every((r) => r.cleared === true);
}

/** Boss door state: set by updateBossDoorState(). Event-driven; not tied to render or room entry. */
let bossDoorsUnlocked = false;

/**
 * Recalculates boss unlock from dungeon completion. Call when a room becomes cleared.
 * Updates bossDoorsUnlocked so door blocking, transitions, and visuals use current state.
 */
function updateBossDoorState() {
  bossDoorsUnlocked = areAllNonBossRoomsCleared();
}

// ---------- Run-layer modifier registration occurs here (hero + gear → modifier engine). Run modifiers are cleared in startNewRun via resetModifiers(). ----------
function registerRunLoadoutFromMeta() {
  const heroId = getSelectedHeroId();
  const def = getMetaHeroDefinition(heroId);
  if (!def) return;
  const level = getHeroLevel(heroId);
  Object.assign(baseStats, createDefaultBaseStats());
  if (def.baseStats) {
    if (def.baseStats.maxHP != null) baseStats.maxHP = def.baseStats.maxHP;
    if (def.baseStats.moveSpeed != null) baseStats.moveSpeed = def.baseStats.moveSpeed;
    if (def.baseStats.damage != null) baseStats.damage = def.baseStats.damage;
    if (def.baseStats.fireRate != null) baseStats.fireRate = def.baseStats.fireRate;
    if (def.baseStats.projectileSpeed != null) baseStats.projectileSpeed = def.baseStats.projectileSpeed;
    if (def.baseStats.bulletsPerShot != null) baseStats.bulletsPerShot = def.baseStats.bulletsPerShot;
  }
  for (const m of def.intrinsicModifiers || []) {
    addModifier({ ...m, source: 'hero' });
  }
  if (level > 0 && def.levelScaling) {
    for (const [stat, perLevel] of Object.entries(def.levelScaling)) {
      if (perLevel === 0) continue;
      addModifier({ id: `hero_level_${heroId}_${stat}`, source: 'hero', type: 'flat', stat, value: perLevel * level });
    }
  }
  const equipped = getEquippedGear(heroId);
  for (const slot of EQUIPMENT_SLOTS) {
    const gearId = equipped[slot];
    if (!gearId) continue;
    const gear = GEAR_CATALOG[gearId];
    if (!gear || !gear.modifiers) continue;
    const source = 'gear';
    for (const mod of gear.modifiers) {
      addModifier({ id: `${gearId}_${mod.stat}`, source, type: mod.type || 'flat', stat: mod.stat, value: mod.value });
    }
  }
}

/** Initialize dungeon and player. Caller sets gameState (e.g. COUNTDOWN). */
function startNewRun() {
  const d = generateDungeon();
  rooms = d.rooms;
  for (const r of rooms) {
    r.obstacles = r.isBossRoom ? [] : generateObstacles(room, r.doors);
    r.teleportPads = r.isBossRoom ? [] : generateTeleportPads(room, r.doors, r.obstacles);
  }
  startRoomId = d.startRoomId;
  currentRoomId = startRoomId;
  roomsCleared = 0;
  elitesKilledThisRun = 0;
  fragmentsFromElitesThisRun = 0;
  fragmentsFromBossThisRun = 0;
  fragmentsFromVictoryThisRun = 0;
  runVictoryFragmentsGranted = false;
  fragmentDropFeedbacks.length = 0;
  bullets.length = 0;
  enemyProjectiles.length = 0;
  upgradeChoices = null;
  shrineChoices = null;
  healingChoices = null;
  nonBossRoomsCleared = 0;
  upgradeFeedback = null;
  justTransitioned = false;
  lastTeleportTime = 0;
  // ---------- Run modifiers are cleared here (Retry / Return to Menu). Meta progression is NOT reset. ----------
  Object.assign(baseStats, createDefaultBaseStats());
  resetModifiers();
  // ---------- Run-layer modifier registration: selected hero + equipped gear applied through modifier engine. ----------
  registerRunLoadoutFromMeta();
  const derived = getDerivedStats(baseStats);
  const derivedGlobal = getDerivedGlobal();
  player.speed = Math.min(MOVE_SPEED_MAX, Math.max(1, derived.moveSpeed));
  player.maxHp = Math.max(1, derived.maxHP);
  player.currentHp = player.maxHp;
  fireCooldownMs = Math.max(FIRE_COOLDOWN_MIN_MS, derived.fireRate);
  bulletSpeed = Math.min(BULLET_SPEED_MAX, derived.projectileSpeed);
  bulletsPerShot = Math.min(BULLETS_PER_SHOT_MAX, Math.max(1, Math.round(derived.bulletsPerShot)));
  enemyDamageMultiplier = derivedGlobal.enemyDamageMult;
  difficultyModifier = derivedGlobal.difficultyModifier;
  screenShakeMagnitude = 0;
  muzzleFlash = null;
  deathEffects.length = 0;
  healthBarDisplayRatio = 1;
  healthBarDamageFlashUntil = 0;
  player.x = center.x;
  player.y = center.y;
  rooms[startRoomId].hasSpawnedEnemies = true;
  rooms[startRoomId].enemies = spawnEnemyWave(rooms[startRoomId].obstacles);
  updateBossDoorState(); // Boss unlock: initialize state on run start.
}

// [Removed: spawnExit and resetCurrentRoom. Room reset/respawn trigger removed — cleared rooms stay cleared.]

/**
 * Upgrade pool. Each apply() registers modifiers via the engine (no direct stat mutations).
 * Pick 2 at random when room cleared (without replacement).
 */
const UPGRADE_POOL = [
  { label: 'Fire Rate +15%', feedbackText: 'Fire Rate Increased', apply: () => { addModifier({ id: 'upgrade_fire_15_' + Date.now(), source: 'upgrade', type: 'mult', stat: 'fireRate', value: 0.85 }); } },
  { label: 'Move Speed +1', feedbackText: 'Move Speed Increased', apply: () => { addModifier({ id: 'upgrade_speed_1_' + Date.now(), source: 'upgrade', type: 'flat', stat: 'moveSpeed', value: 1 }); } },
  { label: 'Bullet Speed +2', feedbackText: 'Bullet Speed Increased', apply: () => { addModifier({ id: 'upgrade_bullet_2_' + Date.now(), source: 'upgrade', type: 'flat', stat: 'projectileSpeed', value: 2 }); } },
  { label: 'Fire Rate +20%', feedbackText: 'Fire Rate Increased', apply: () => { addModifier({ id: 'upgrade_fire_20_' + Date.now(), source: 'upgrade', type: 'mult', stat: 'fireRate', value: 0.8 }); } },
  { label: 'Move Speed +0.5', feedbackText: 'Move Speed Increased', apply: () => { addModifier({ id: 'upgrade_speed_05_' + Date.now(), source: 'upgrade', type: 'flat', stat: 'moveSpeed', value: 0.5 }); } },
  { label: 'Bullet Speed +1', feedbackText: 'Bullet Speed Increased', apply: () => { addModifier({ id: 'upgrade_bullet_1_' + Date.now(), source: 'upgrade', type: 'flat', stat: 'projectileSpeed', value: 1 }); } },
  { label: 'Multishot', feedbackText: 'Multishot', apply: () => { addModifier({ id: 'upgrade_multishot_' + Date.now(), source: 'upgrade', type: 'flat', stat: 'bulletsPerShot', value: 1 }); } },
];

/**
 * Demon Shrine deal pool. All lasting effects registered via modifier engine (no direct stat mutations).
 * Tradeoffs: positive + negative modifiers. One-time "HP now" changes still applied to player.currentHp.
 */
const DEMON_SHRINE_DEAL_POOL = [
  {
    label: '+1 Max HP | -1 HP now',
    feedbackText: 'Max HP +1, HP -1',
    apply: () => {
      addModifier({ id: 'shrine_maxhp_1_' + Date.now(), source: 'shrine', type: 'flat', stat: 'maxHP', value: 1 });
      player.currentHp = Math.max(1, player.currentHp - 1);
    },
  },
  {
    label: 'Fire Rate +25% | Move Speed -0.5',
    feedbackText: 'Fire faster, move slower',
    apply: () => {
      addModifier({ id: 'shrine_fire_25_' + Date.now(), source: 'shrine', type: 'mult', stat: 'fireRate', value: 0.75 });
      addModifier({ id: 'shrine_speed_neg_05_' + Date.now(), source: 'shrine', type: 'flat', stat: 'moveSpeed', value: -0.5 });
    },
  },
  {
    label: 'Move Speed +1 | Enemy Damage x1.5',
    feedbackText: 'Faster, enemies hit harder',
    apply: () => {
      addModifier({ id: 'shrine_speed_1_' + Date.now(), source: 'shrine', type: 'flat', stat: 'moveSpeed', value: 1 });
      addGlobalModifier({ id: 'shrine_enemy_dmg_15_' + Date.now(), source: 'shrine', type: 'mult', stat: 'enemyDamageMult', value: 1.5 });
    },
  },
  {
    label: 'Bullet Speed +2 | Future rooms +1 diff',
    feedbackText: 'Faster bullets, harder rooms',
    apply: () => {
      addModifier({ id: 'shrine_bullet_2_' + Date.now(), source: 'shrine', type: 'flat', stat: 'projectileSpeed', value: 2 });
      addGlobalModifier({ id: 'shrine_diff_1_' + Date.now(), source: 'shrine', type: 'flat', stat: 'difficultyModifier', value: 1 });
    },
  },
  {
    label: 'Enemy Damage -20% | Future rooms +2 diff',
    feedbackText: 'Softer hits, much harder rooms',
    apply: () => {
      addGlobalModifier({ id: 'shrine_enemy_dmg_08_' + Date.now(), source: 'shrine', type: 'mult', stat: 'enemyDamageMult', value: 0.8 });
      addGlobalModifier({ id: 'shrine_diff_2_' + Date.now(), source: 'shrine', type: 'flat', stat: 'difficultyModifier', value: 2 });
    },
  },
  {
    label: '+2 Max HP | -2 HP now',
    feedbackText: 'Max HP +2, HP -2',
    apply: () => {
      addModifier({ id: 'shrine_maxhp_2_' + Date.now(), source: 'shrine', type: 'flat', stat: 'maxHP', value: 2 });
      player.currentHp = Math.max(1, player.currentHp - 2);
    },
  },
  {
    label: 'Multishot +1 | Move Speed -0.5',
    feedbackText: 'More bullets, slower',
    apply: () => {
      addModifier({ id: 'shrine_multishot_1_' + Date.now(), source: 'shrine', type: 'flat', stat: 'bulletsPerShot', value: 1 });
      addModifier({ id: 'shrine_speed_neg_05_b_' + Date.now(), source: 'shrine', type: 'flat', stat: 'moveSpeed', value: -0.5 });
    },
  },
  {
    label: 'Fire Rate +30% | Enemy Damage x1.5',
    feedbackText: 'Much faster fire, enemies hit harder',
    apply: () => {
      addModifier({ id: 'shrine_fire_30_' + Date.now(), source: 'shrine', type: 'mult', stat: 'fireRate', value: 0.7 });
      addGlobalModifier({ id: 'shrine_enemy_dmg_15_b_' + Date.now(), source: 'shrine', type: 'mult', stat: 'enemyDamageMult', value: 1.5 });
    },
  },
];

function pickRandomShrineDeals() {
  const shuffled = [...DEMON_SHRINE_DEAL_POOL].sort(() => Math.random() - 0.5);
  const count = 2 + Math.floor(Math.random() * 2); // 2 or 3 deals
  return shuffled.slice(0, count).map((d) => ({
    label: d.label,
    feedbackText: d.feedbackText,
    apply: () => {
      d.apply();
      const rm = rooms[currentRoomId];
      if (rm) rm.shrine = null; // Shrine disappears after one use
    },
  }));
}

/**
 * Healing Room event: mutually exclusive choices. Run-scoped; resets on Retry/Menu.
 * A: Heal +20% of max HP (capped at evaluated max). B: +1 Max HP via modifier engine. C: Skip (future-safe).
 */
function createHealingChoices() {
  return {
    choices: [
      {
        label: 'Heal +20% Max HP',
        feedbackText: 'Healed',
        apply: () => {
          const heal = Math.max(1, Math.floor(0.2 * player.maxHp));
          player.currentHp = Math.min(player.maxHp, player.currentHp + heal);
        },
      },
      {
        label: '+1 Max HP (this run)',
        feedbackText: 'Max HP +1',
        apply: () => {
          addModifier({ id: 'healing_room_maxhp_' + Date.now(), source: 'room', type: 'flat', stat: 'maxHP', value: 1 });
        },
      },
      {
        label: 'Skip',
        feedbackText: 'Skipped',
        apply: () => {},
      },
    ],
  };
}

/** Pick n random upgrades from pool without replacement. */
function pickRandomUpgrades(n) {
  const shuffled = [...UPGRADE_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n).map((u) => ({ label: u.label, feedbackText: u.feedbackText, apply: u.apply }));
}

/**
 * Room transition: player touched a door. Switch to connected room, place player at entrance,
 * clear bullets, and spawn enemies on first visit.
 *
 * Transition logic:
 * - We leave fromRoomId and enter toRoomId (door.connectsTo).
 * - The entrance door in the new room is the one that connects back to fromRoomId.
 * - We place the player at that door, slightly inside (getEntrancePosition with ENTRANCE_INSET)
 *   so they are clear of the entrance and won't overlap it—avoids instant transition back.
 * - Bullets are cleared when changing rooms. Enemies spawn only when entering a room
 *   for the first time (hasSpawnedEnemies).
 *
 * @param {number} fromRoomId - Room we're leaving
 * @param {number} toRoomId - Room we're entering (door.connectsTo)
 */
function transitionToRoom(fromRoomId, toRoomId) {
  const target = rooms[toRoomId];
  const entranceDoor = target.doors.find((d) => d.connectsTo === fromRoomId);
  if (!entranceDoor) return;

  const pos = getEntrancePosition(room, entranceDoor, ENTRANCE_INSET);
  player.x = pos.x;
  player.y = pos.y;
  justTransitioned = true;
  bullets.length = 0;
  enemyProjectiles.length = 0;
  currentRoomId = toRoomId;
  emitGameEvent('onRoomEntered', { roomId: toRoomId, room: target });

  if (!target.hasSpawnedEnemies) {
    target.hasSpawnedEnemies = true;
    if (target.isBossRoom) {
      target.boss = spawnBoss();
      audioManager.play('boss_intro', 'sfx');
    } else {
      target.enemies = spawnEnemyWave(target.obstacles);
    }
  }
}

/**
 * Map click to canvas coordinates (handles CSS scaling).
 * @param {MouseEvent} e
 * @returns {{ x: number, y: number }}
 */
function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

/** Angle spread per bullet in degrees (multishot). */
const MULTISHOT_SPREAD_DEG = 6;

/**
 * Rotate a unit vector by angle (degrees). Returns new dx, dy.
 */
function rotateDir(dx, dy, deg) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [dx * c - dy * s, dx * s + dy * c];
}

/**
 * Shoot toward the mouse. Fire rate and bullet speed from upgrades.
 * Multishot: fires bulletsPerShot bullets with small angle spread.
 */
function onCanvasClick(e) {
  const coords = getCanvasCoords(e);
  mx = coords.x;
  my = coords.y;
  if (settingsOpen && settingsLayout) {
    const p = settingsLayout.panel;
    if (!(mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h)) {
      closeSettingsModal();
      return;
    }
    for (const a of uiHitAreas) {
      if (mx >= a.x && mx <= a.x + a.w && my >= a.y && my <= a.y + a.h) {
        if (a.onClick) a.onClick();
        return;
      }
    }
    return;
  }
  for (const a of uiHitAreas) {
    if (mx >= a.x && mx <= a.x + a.w && my >= a.y && my <= a.y + a.h) {
      if (a.onClick) {
        a.onClick();
        return;
      }
      if (a.focus != null) setUiFocus(a);
      if (a.action) {
        audioManager.play('menu_select', 'ui');
        triggerMenuClickFlash();
        a.action();
        return;
      }
    }
  }
  if (inputMode !== 'game') return;
  if (isPaused) return;
  if (gameState !== 'PLAYING' || upgradeChoices || shrineChoices || healingChoices) return;
  const now = performance.now();
  if (now - lastShotTime < fireCooldownMs) return;
  lastShotTime = now;
  audioManager.play('shoot', 'sfx');

  let dx = mx - player.x;
  let dy = my - player.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  dx /= len;
  dy /= len;

  const n = bulletsPerShot;
  for (let i = 0; i < n; i++) {
    const offsetDeg = (i - (n - 1) / 2) * MULTISHOT_SPREAD_DEG;
    const [rdx, rdy] = rotateDir(dx, dy, offsetDeg);
    const b = new Bullet(player.x, player.y, rdx * bulletSpeed, rdy * bulletSpeed);
    b.spawnTime = performance.now(); // Spawn pop effect: track age for visual scale
    bullets.push(b);
  }
  muzzleFlash = { x: player.x, y: player.y, until: now + MUZZLE_FLASH_MS }; // Shooting visual: muzzle flash at spawn
  attackPopUntil = now + ATTACK_POP_MS; // Visual: brief scale pop on hero sprite
  lastShootDx = dx; // Recoil direction (opposite of aim)
  lastShootDy = dy;
}

canvas.addEventListener('click', onCanvasClick);

canvas.addEventListener('mousemove', (e) => {
  if (gameState !== 'MENU' || menuScreen !== 'heroes') return;
  const rect = canvas.getBoundingClientRect();
  mx = (e.clientX - rect.left) / rect.width;
  my = (e.clientY - rect.top) / rect.height;
  heroLobbyMouseX = mx * 2 - 1;
  heroLobbyMouseY = my * 2 - 1;
});

/**
 * AABB overlap: both axes must overlap (no horizontal gap and no vertical gap).
 */
function aabbOverlap(a, b) {
  if (a.right <= b.left || a.left >= b.right) return false;
  if (a.bottom <= b.top || a.top >= b.bottom) return false;
  return true;
}

/** Wall rect (x,y,w,h) → AABB for overlap checks. */
function wallToAABB(w) {
  return {
    left: w.x,
    right: w.x + w.w,
    top: w.y,
    bottom: w.y + w.h,
  };
}

/** Full rounded rect path. */
function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/** Left-rounded rect for HP fill (right edge straight when partial). */
function roundRectLeft(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/** Draw health bar in HUD space above room. Modern HUD style: track, fill, glow, HP label. */
function drawHealthBar() {
  const targetRatio = Math.max(0, Math.min(1, player.currentHp / Math.max(1, player.maxHp)));
  healthBarDisplayRatio += (targetRatio - healthBarDisplayRatio) * HEALTH_BAR_LERP_SPEED;

  const barW = Math.round(inner.w * 0.52);
  const barH = 18;
  const radius = 9;
  const barX = room.x + room.width / 2 - barW / 2;
  const barY = room.y - HUD_OFFSET + 8;

  ctx.save();

  roundRect(ctx, barX, barY, barW, barH, radius);
  ctx.fillStyle = 'rgba(8,14,22,0.95)';
  ctx.fill();
  ctx.strokeStyle = UI.panelBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  const fillW = Math.max(0, barW * healthBarDisplayRatio);
  if (fillW > 0.5) {
    roundRectLeft(ctx, barX, barY, fillW, barH, radius);
    const grad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
    grad.addColorStop(0, '#3dd68c');
    grad.addColorStop(0.5, '#28c97a');
    grad.addColorStop(1, '#22a06b');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowColor = 'rgba(61,214,140,0.4)';
    ctx.shadowBlur = 8;
    roundRectLeft(ctx, barX, barY, fillW, barH, radius);
    ctx.fill();
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  roundRect(ctx, barX, barY, barW, barH, radius);
  ctx.strokeStyle = UI.accent + '99';
  ctx.lineWidth = 1;
  ctx.stroke();

  const now = performance.now();
  if (now < healthBarDamageFlashUntil) {
    const flashAlpha = 0.4 * (healthBarDamageFlashUntil - now) / HEALTH_BAR_DAMAGE_FLASH_MS;
    roundRect(ctx, barX, barY, barW, barH, radius);
    ctx.fillStyle = `rgba(220,60,60,${flashAlpha})`;
    ctx.fill();
  }

  ctx.restore();

  ctx.fillStyle = UI.title;
  ctx.font = 'bold ' + UI.fontLabel + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    'HP  ' + Math.max(0, Math.floor(player.currentHp)) + ' / ' + Math.max(1, Math.floor(player.maxHp)),
    barX + barW / 2,
    barY + barH / 2
  );
  ctx.textAlign = 'left';
}

/** Draw current play scene (room, entities). Used by COUNTDOWN and DEAD overlays. No updates. */
function drawPlayScene() {
  if (!rooms.length) return;
  const rn = rooms[currentRoomId];
  ctx.fillStyle = '#16213e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Inner room: playable floor (walls, floor, entities drawn inside this box).
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
  ctx.fillStyle = '#0f3460';
  for (const w of getWallSegments(room, rn.doors)) ctx.fillRect(w.x, w.y, w.w, w.h);
  for (const dr of getDoorRects(room, rn.doors)) {
    const target = rooms[dr.connectsTo];
    const isLocked = !rn.cleared;
    const isBossLocked = target.isBossRoom && !bossDoorsUnlocked;
    if (isLocked) ctx.fillStyle = LOCKED_DOOR_COLOR;
    else if (isBossLocked) ctx.fillStyle = BOSS_LOCKED_DOOR_COLOR;
    else ctx.fillStyle = target.cleared ? DOOR_TO_CLEARED_COLOR : DOOR_TO_UNCLEARED_COLOR;
    ctx.fillRect(dr.x, dr.y, dr.w, dr.h);
    if (isLocked || isBossLocked) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      const midX = dr.x + dr.w / 2; const midY = dr.y + dr.h / 2;
      const bw = Math.max(4, Math.min(dr.w, dr.h) * 0.35);
      ctx.fillRect(midX - bw / 2, midY - 2, bw, 4);
    }
  }
  // Frame: outer room border (blue stroke).
  ctx.strokeStyle = '#533483';
  ctx.lineWidth = 2;
  ctx.strokeRect(room.x, room.y, room.width, room.height);

  for (const o of rn.obstacles || []) {
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeStyle = '#34495e';
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    ctx.strokeStyle = '#533483';
  }
  (rn.teleportPads || []).forEach((pad, i) => {
    ctx.fillStyle = i === 0 ? '#1abc9c' : '#16a085';
    ctx.fillRect(pad.x, pad.y, pad.w, pad.h);
    ctx.strokeStyle = i === 0 ? '#0e6655' : '#0d5c4a';
    ctx.lineWidth = 2;
    ctx.strokeRect(pad.x, pad.y, pad.w, pad.h);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(i === 0 ? 'A' : 'B', pad.x + pad.w / 2, pad.y + pad.h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = '#533483';
    ctx.lineWidth = 2;
  });
  if (rn.cleared && !rn.isBossRoom && rn.shrine) {
    const sh = rn.shrine;
    ctx.fillStyle = '#2d1b4e';
    ctx.fillRect(sh.x, sh.y, sh.w, sh.h);
    ctx.strokeStyle = '#9b59b6';
    ctx.lineWidth = 2;
    ctx.strokeRect(sh.x, sh.y, sh.w, sh.h);
    const cx = sh.x + sh.w / 2; const cy = sh.y + sh.h / 2; const r = 8;
    ctx.fillStyle = 'rgba(155,89,182,0.6)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#533483';
  }
  const now = performance.now();
  if (muzzleFlash && now < muzzleFlash.until) {
    ctx.fillStyle = '#fff8dc';
    ctx.fillRect(muzzleFlash.x - 7, muzzleFlash.y - 7, 14, 14);
  }
  for (const b of bullets) b.draw(ctx);
  ctx.fillStyle = '#e74c3c';
  for (const ep of enemyProjectiles) ctx.fillRect(ep.x - 2.5, ep.y - 2.5, ep.w || 5, ep.h || 5);
  for (const e of rn.enemies) {
    e.draw(ctx, enemySprites);
    if (e.isElite) {
      const w = e.w || 20; const h = e.h || 20;
      const left = e.x - w / 2 - 2; const top = e.y - h / 2 - 2;
      const affix = e.affix || '';
      ctx.strokeStyle = affix === 'frenzied' ? '#ff8c00' : affix === 'hardened' ? '#94a3b8' : affix === 'volatile' ? '#ffb432' : affix === 'vampiric' ? '#c23d6b' : '#ffd700';
      ctx.lineWidth = affix === 'hardened' ? 3 : 2;
      ctx.strokeRect(left, top, w + 4, h + 4);
    }
  }
  if (rn.boss) rn.boss.draw(ctx, enemySprites);
  for (const d of deathEffects) {
    if (now >= d.until) continue;
    const t = 1 - (d.until - now) / DEATH_EFFECT_MS;
    const scale = 1 + 0.15 * t;
    const alpha = 1 - t;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = d.color;
    ctx.fillRect(d.x - (d.w * scale) / 2, d.y - (d.h * scale) / 2, d.w * scale, d.h * scale);
    ctx.restore();
  }
  const heroDef = getMetaHeroDefinition(getSelectedHeroId());
  const heroId = heroDef?.id || getSelectedHeroId() || 'vanguard';
  const nowDraw = performance.now();
  const ap = attackPopUntil > nowDraw ? 1 - (attackPopUntil - nowDraw) / ATTACK_POP_MS : 0;
  player.draw(ctx, heroDef?.category || 'vanguard', heroSprites[heroId], {
    attackPop: ap,
    isMoving: keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD'),
    lastDx: player.lastDx,
    lastDy: player.lastDy,
    hpRatio: player.currentHp / Math.max(1, player.maxHp),
    lastShootDx: lastShootDx,
    lastShootDy: lastShootDy,
  });
  drawHealthBar();
}

/**
 * Game loop: update and render. Branch on game state; MENU, COUNTDOWN, DEAD, VICTORY have dedicated handling.
 */
function loop() {
  setAmbient(gameState === 'MENU' ? 'menu' : 'gameplay');
  if (settingsOpen) {
    inputMode = 'modal';
  } else if (gameState === 'DEAD') {
    inputMode = 'death';
  } else if (gameState === 'MENU') {
    inputMode = 'menu';
  } else if (isPaused) {
    inputMode = 'modal';
  } else if (upgradeChoices) {
    inputMode = 'upgrade';
  } else {
    inputMode = 'game';
  }
  uiHitAreas.length = 0;
  if (gameState === 'MENU') {
    const cw = canvas.width;
    const ch = canvas.height;
    menuTransitionAlpha = Math.min(1, (performance.now() - menuTransitionStart) / MENU_TRANSITION_MS);

    if (menuScreen === 'help') {
      drawHelpScreen(cw, ch);
      requestAnimationFrame(loop);
      return;
    }

    drawMenuBackground(cw, ch);

    if (menuScreen === 'heroes') {
      const heroIds = getAllHeroIds();
      heroSelectionLerp += (menuSelectedIndex - heroSelectionLerp) * 0.1;
      const selHero = heroIds[Math.round(heroSelectionLerp)];
      const selProg = selHero ? getHeroProgress(selHero) : null;
      const def = selProg?.definition;
      const rarity = def?.rarity || 'common';
      const accent = RARITY_ACCENTS[rarity] || RARITY_ACCENTS.common;
      const t = performance.now() * 0.001;

      drawMenuBackground(cw, ch);
      ctx.globalAlpha = menuTransitionAlpha;

      const heroAreaW = cw * 0.55;
      const statsPanelW = 320;
      const statsPanelH = 340;
      const statsX = cw - statsPanelW - UI.edgeMargin;
      const statsY = (ch - statsPanelH) / 2;

      const heroCenterX = heroAreaW / 2;
      const heroCenterY = ch * 0.38;
      const heroSize = Math.round(140 * 1.6);
      const floatY = 1.6 * Math.sin(t * 1.4);
      const breathScale = 1 + 0.01 * Math.sin(t * 2);
      const heroLeft = heroCenterX - (heroSize * breathScale) / 2;
      const heroTop = heroCenterY - (heroSize * breathScale) / 2 + floatY;
      const heroCenterYf = heroTop + (heroSize * breathScale) / 2;
      const platformR = heroSize * 0.65;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(heroCenterX, heroCenterYf + heroSize * 0.48, platformR * 0.9, platformR * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Faint energy ring behind selected hero (slow ~10s rotation)
      ctx.save();
      ctx.translate(heroCenterX, heroCenterYf);
      ctx.rotate(t * 0.628);
      ctx.translate(-heroCenterX, -heroCenterYf);
      ctx.strokeStyle = 'rgba(120,220,255,0.08)';
      ctx.shadowColor = 'rgba(120,220,255,0.12)';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(heroCenterX, heroCenterYf, platformR * 1.18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      const radialGlow = ctx.createRadialGradient(heroCenterX, heroCenterYf, 0, heroCenterX, heroCenterYf, heroSize * 0.8);
      radialGlow.addColorStop(0, accent + '12');
      radialGlow.addColorStop(0.5, accent + '04');
      radialGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = radialGlow;
      ctx.beginPath();
      ctx.arc(heroCenterX, heroCenterYf, heroSize * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(heroCenterX, heroCenterYf);
      ctx.rotate(t * 0.12);
      ctx.translate(-heroCenterX, -heroCenterYf);
      ctx.strokeStyle = 'rgba(80,120,180,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(heroCenterX, heroCenterYf, platformR * 1.05, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.translate(heroCenterX, heroCenterYf);
      ctx.rotate(-t * 0.09);
      ctx.translate(-heroCenterX, -heroCenterYf);
      ctx.strokeStyle = 'rgba(80,120,180,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(heroCenterX, heroCenterYf, platformR * 0.85, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      const heroCategory = def?.category || 'vanguard';
      if (selProg?.unlocked) {
        drawHeroThemeLayer(ctx, heroCategory, heroCenterX, heroCenterYf, heroSize, platformR, t);
      } else if (heroCategory === 'vanguard') {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 20;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.ellipse(heroCenterX, heroCenterYf + heroSize * 0.48, platformR * 0.85, platformR * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const uiSprite = selHero ? heroSprites[selHero] : null;
      if (uiSprite && uiSprite.complete && uiSprite.naturalWidth > 0) {
        ctx.save();
        if (selProg && !selProg.unlocked) {
          ctx.globalAlpha = 0.55;
          ctx.filter = 'grayscale(100%) saturate(0) brightness(0.65)';
        }
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 20;
        ctx.shadowOffsetY = 10;
        ctx.drawImage(uiSprite, heroLeft, heroTop, heroSize * breathScale, heroSize * breathScale);
        ctx.restore();
      }
      if (selProg && !selProg.unlocked) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.arc(heroCenterX, heroCenterYf, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔒', heroCenterX, heroCenterYf);
      }
      ctx.textBaseline = 'alphabetic';

      const pad = UI.panelPadding;
      drawGlassPanel(statsX, statsY, statsPanelW, statsPanelH);
      ctx.fillStyle = accent;
      ctx.fillRect(statsX, statsY, 3, 36);
      ctx.fillStyle = UI.title;
      ctx.font = 'bold ' + UI.fontPanelTitle + 'px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(def?.name || '—', statsX + pad, statsY + 30);
      ctx.fillStyle = accent;
      ctx.font = (UI.fontBody - 1) + 'px sans-serif';
      ctx.fillText((def?.categoryLabel || '') + '  ·  ' + rarity, statsX + pad, statsY + 54);
      ctx.fillStyle = UI.body;
      ctx.font = (UI.fontBody - 1) + 'px sans-serif';
      const desc = def?.description || '';
      ctx.fillText(desc, statsX + pad, statsY + 78);

      const bs = def?.baseStats || {};
      const STAT_BARS = [
        { key: 'maxHP', label: 'HP', max: 5 },
        { key: 'damage', label: 'DMG', max: 3 },
        { key: 'moveSpeed', label: 'SPD', max: 5 },
        { key: 'fireRate', label: 'RFR', max: 200, invert: true },
      ];
      const barPad = pad + 36;
      const barW = statsPanelW - barPad - pad;
      let barY = statsY + 110;
      STAT_BARS.forEach((s) => {
        let val = bs[s.key] ?? 0;
        if (s.invert) val = Math.max(0, (s.max - val) / s.max);
        else val = Math.min(1, val / s.max);
        ctx.fillStyle = UI.hint;
        ctx.font = UI.fontLabel + 'px sans-serif';
        ctx.fillText(s.label, statsX + pad, barY - 2);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(statsX + barPad, barY - 8, barW, 8);
        ctx.save();
        ctx.shadowColor = accent + '66';
        ctx.shadowBlur = 8;
        ctx.fillStyle = accent;
        ctx.fillRect(statsX + barPad, barY - 8, barW * val, 8);
        ctx.restore();
        if (val > 0.05) {
          ctx.fillStyle = 'rgba(255,255,255,0.14)';
          ctx.fillRect(statsX + barPad, barY - 8, barW * val, 2);
        }
        barY += 24;
      });

      if (def?.intrinsicModifiers?.length) {
        const passive = def.intrinsicModifiers[0];
        const pVal = passive.type === 'mult' ? '×' + passive.value : '+' + passive.value;
        const pStat = (passive.stat || '').replace(/([A-Z])/g, ' $1').trim();
        const cardY = barY + 14;
        ctx.fillStyle = 'rgba(20,35,55,0.7)';
        roundRect(ctx, statsX + pad, cardY, statsPanelW - pad * 2, 48, UI.radiusSlot);
        ctx.fill();
        ctx.strokeStyle = accent + '50';
        ctx.lineWidth = 1;
        roundRect(ctx, statsX + pad, cardY, statsPanelW - pad * 2, 48, UI.radiusSlot);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(statsX + pad, cardY, statsPanelW - pad * 2, 1);
        ctx.fillStyle = accent;
        ctx.font = UI.fontLabel + 'px sans-serif';
        ctx.fillText('PASSIVE', statsX + pad + 8, cardY + 18);
        ctx.fillStyle = UI.header;
        ctx.font = UI.fontBody + 'px sans-serif';
        ctx.fillText(pVal + ' ' + pStat, statsX + pad + 8, cardY + 36);
        barY += 68;
      } else {
        barY += 28;
      }

      const shardBarW = statsPanelW - pad * 2;
      const barH = 8;
      const barX = statsX + pad;
      const required = selProg?.unlocked ? selProg.shardsRequiredToUpgrade : selProg?.shardsRequiredToUnlock || 10;
      const current = selProg?.shards ?? 0;
      const pct = Math.min(1, required > 0 ? current / required : 1);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(barX, barY, shardBarW, barH);
      ctx.fillStyle = accent;
      ctx.fillRect(barX, barY, shardBarW * pct, barH);
      ctx.strokeStyle = UI.panelBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, shardBarW, barH);
      ctx.fillStyle = UI.body;
      ctx.font = UI.fontLabel + 'px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(current + ' / ' + required + ' shards', barX, barY + barH + 16);

      const stripY = ch - UI.carouselStripTopOffset;
      const cardW = 108;
      const cardH = 108;
      const cardGap = 20;
      const totalStripW = heroIds.length * cardW + (heroIds.length - 1) * cardGap;
      const stripStartX = cw / 2 - totalStripW / 2;
      heroIds.forEach((id, i) => {
        const p = getHeroProgress(id);
        const def = p.definition;
        const lerpIdx = Math.abs(i - heroSelectionLerp);
        const cardScale = 0.86 + 0.14 * Math.max(0, 1 - lerpIdx);
        const isSelected = cardScale > 0.96;
        const isActive = id === getSelectedHeroId();
        const locked = !p.unlocked;
        const cardAccent = RARITY_ACCENTS[def?.rarity || 'common'] || RARITY_ACCENTS.common;
        const x = stripStartX + i * (cardW + cardGap);
        const y = stripY + (cardH - cardH * cardScale) / 2 - (isSelected ? 6 : 0);
        const w = cardW * cardScale;
        const h = cardH * cardScale;
        if (isSelected) {
          const glowGrad = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 0.9);
          glowGrad.addColorStop(0, cardAccent + '25');
          glowGrad.addColorStop(0.6, cardAccent + '08');
          glowGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = glowGrad;
          ctx.fillRect(x - 8, y - 8, w + 16, h + 16);
        }
        if (isActive) {
          const activeGlow = ctx.createRadialGradient(x + w / 2, y + h - 6, 0, x + w / 2, y + h - 6, w * 0.55);
          activeGlow.addColorStop(0, cardAccent + '55');
          activeGlow.addColorStop(0.5, cardAccent + '18');
          activeGlow.addColorStop(1, 'transparent');
          ctx.fillStyle = activeGlow;
          ctx.fillRect(x - 6, y + h - 18, w + 12, 28);
        }
        drawGlassPanel(x, y, w, h, isSelected ? accent : null);
        if (isSelected) {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.5;
          roundRect(ctx, x, y, w, h, UI.radiusPanel);
          ctx.stroke();
        }
        const thumbSize = 62 * cardScale;
        const thumbLeft = x + (w - thumbSize) / 2;
        const thumbTop = y + 8;
        const cardSprite = heroSprites[id];
        if (cardSprite && cardSprite.complete && cardSprite.naturalWidth > 0) {
          ctx.save();
          if (locked) {
            ctx.globalAlpha = 0.5;
            ctx.filter = 'grayscale(100%) saturate(0) brightness(0.6)';
          }
          ctx.drawImage(cardSprite, thumbLeft, thumbTop, thumbSize, thumbSize);
          ctx.restore();
        }
        if (locked) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.beginPath();
          ctx.arc(x + w / 2, thumbTop + thumbSize / 2, 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 14px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('🔒', x + w / 2, thumbTop + thumbSize / 2);
        }
        ctx.fillStyle = locked ? UI.locked : UI.header;
        ctx.font = Math.round(UI.fontLabel * cardScale) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(def?.name || id, x + w / 2, y + h - 8);
        if (isActive) {
          ctx.fillStyle = accent;
          ctx.fillText('ACTIVE', x + w / 2, y + h - 2);
        }
        ctx.textAlign = 'left';
      });
      uiHitAreas.length = 0;
      heroIds.forEach((id, i) => {
        const lerpIdx = Math.abs(i - heroSelectionLerp);
        const cardScale = 0.86 + 0.14 * Math.max(0, 1 - lerpIdx);
        const isSelected = cardScale > 0.96;
        const cardW = 108;
        const cardH = 108;
        const cardGap = 20;
        const totalStripW = heroIds.length * cardW + (heroIds.length - 1) * cardGap;
        const stripStartX = cw / 2 - totalStripW / 2;
        const x = stripStartX + i * (cardW + cardGap);
        const y = (ch - UI.carouselStripTopOffset) + (cardH - cardH * cardScale) / 2 - (isSelected ? 6 : 0);
        const w = cardW * cardScale;
        const h = cardH * cardScale;
        uiHitAreas.push({
          focus: 'heroes',
          index: i,
          x,
          y,
          w,
          h,
          action: () => handleHeroesSelect(i),
        });
      });

      const heroesTitleW = drawTrackingText(ctx, 'HEROES', cw / 2, UI.screenTitleY + getTitleYOffset(), {
        spacing: 1.5,
        font: UI.fontScreenTitle + 'px sans-serif',
        color: UI.title,
      });
      drawHeaderUnderline(ctx, cw / 2, UI.screenTitleY + getTitleYOffset(), heroesTitleW);

      ctx.fillStyle = UI.hint;
      ctx.font = UI.fontHint + 'px sans-serif';
      ctx.fillText('← → Select  ·  Enter Unlock/Upgrade  ·  S Select  ·  Esc Back', cw / 2, ch - UI.navHintOffset);

      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    } else if (menuScreen === 'loadout') {
      const heroId = getSelectedHeroId();
      const def = getMetaHeroDefinition(heroId);
      const equipped = getEquippedGear(heroId);
      ctx.globalAlpha = menuTransitionAlpha;

      const loadoutTitleW = drawTrackingText(ctx, 'LOADOUT', cw / 2, UI.screenTitleY + getTitleYOffset(), {
        spacing: 1.5,
        font: UI.fontScreenTitle + 'px sans-serif',
        color: UI.title,
      });
      drawHeaderUnderline(ctx, cw / 2, UI.screenTitleY + getTitleYOffset(), loadoutTitleW);

      const containerW = Math.round(cw * 0.84);
      const containerX = (cw - containerW) / 2;
      const containerTop = UI.screenTitleY + 64;
      const containerBottom = ch - 32;
      let sectionGap = 28;
      let cursorY = containerTop;
      uiHitAreas.length = 0;

      const heroHeaderW = containerW;
      const heroHeaderH = 82;
      const heroHeaderX = containerX;
      let heroHeaderY = cursorY;

      const slots = [...EQUIPMENT_SLOTS];
      const gearLeft = ['weaponCore', 'armor'];
      const gearRight = ['relic', 'boots'];
      const moduleSlots = ['catalyst', 'charm', 'sigil', 'artifact'];

      const gearCardW = 300;
      const gearCardH = 86;
      let gearGapY = 22;
      const colGap = 56;
      const gearColsW = gearCardW * 2 + colGap;
      const gearColsX = cw / 2 - gearColsW / 2;
      const gearLeftX = gearColsX;
      const gearRightX = gearColsX + gearCardW + colGap;
      const moduleCardW = 140;
      let moduleCardH = 70;
      let moduleGap = 16;
      const backH = 52;
      const hintGap = 20;
      const bottomPad = 40;

      const computeLayout = () => {
        const gearTop = heroHeaderY + heroHeaderH + sectionGap;
        const gearLeftH = gearLeft.length * gearCardH + (gearLeft.length - 1) * gearGapY;
        const gearRightH = gearRight.length * gearCardH + (gearRight.length - 1) * gearGapY;
        const gearSectionH = Math.max(gearLeftH, gearRightH);
        const moduleRowW = moduleSlots.length * moduleCardW + (moduleSlots.length - 1) * moduleGap;
        const moduleX = cw / 2 - moduleRowW / 2;
        const moduleY = gearTop + gearSectionH + sectionGap;
        const backW = Math.round(moduleRowW * 0.9);
        const backX = (cw - backW) / 2;
        const backY = moduleY + moduleCardH + sectionGap;
        const hintY = backY + backH + hintGap;
        const layoutBottom = hintY + bottomPad;
        return { gearTop, gearSectionH, moduleRowW, moduleX, moduleY, backW, backX, backY, hintY, layoutBottom };
      };

      let layout = computeLayout();
      if (layout.layoutBottom > containerBottom) {
        sectionGap = 20;
        gearGapY = 16;
        moduleCardH = 60;
        moduleGap = 12;
        layout = computeLayout();
      }
      if (layout.layoutBottom > containerBottom) {
        const overflow = layout.layoutBottom - containerBottom;
        const minGearTop = heroHeaderY + heroHeaderH + sectionGap;
        const shift = Math.min(overflow, layout.gearTop - minGearTop);
        layout.gearTop -= shift;
        layout.moduleY -= shift;
        layout.backY -= shift;
        layout.hintY -= shift;
      }

      const isHeaderSelected = menuSelectedIndex === 0;
      drawGlassPanel(heroHeaderX, heroHeaderY, heroHeaderW, heroHeaderH, isHeaderSelected ? UI.accentDim : null, UI.radiusPanel);
      ctx.fillStyle = isHeaderSelected ? UI.accent : UI.panelBorder;
      ctx.fillRect(heroHeaderX, heroHeaderY, 3, heroHeaderH);
      const portraitSize = 60;
      const portraitX = heroHeaderX + UI.panelPadding;
      const portraitY = heroHeaderY + (heroHeaderH - portraitSize) / 2;
      const portraitCx = portraitX + portraitSize / 2;
      const portraitCy = portraitY + portraitSize / 2;
      const heroSprite = heroId ? heroSprites[heroId] : null;
      if (heroSprite && heroSprite.complete && heroSprite.naturalWidth > 0) {
        const holoGrad = ctx.createRadialGradient(portraitCx, portraitCy, 0, portraitCx, portraitCy, portraitSize * 0.9);
        holoGrad.addColorStop(0, UI.accent + '15');
        holoGrad.addColorStop(0.6, UI.accent + '04');
        holoGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = holoGrad;
        ctx.beginPath();
        ctx.arc(portraitCx, portraitCy, portraitSize * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.drawImage(heroSprite, portraitX, portraitY, portraitSize, portraitSize);
      } else {
        ctx.strokeStyle = 'rgba(80,120,180,0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(portraitX, portraitY, portraitSize, portraitSize);
        ctx.setLineDash([]);
      }
      ctx.fillStyle = isHeaderSelected ? UI.title : UI.header;
      ctx.font = 'bold ' + (UI.fontSectionHeader + 3) + 'px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(def ? def.name : 'None', heroHeaderX + 96, heroHeaderY + 26);
      ctx.fillStyle = UI.accent;
      ctx.font = (UI.fontBody - 1) + 'px sans-serif';
      ctx.fillText(def ? def.categoryLabel + '  ·  Enter to change hero' : 'Select a hero in Heroes screen', heroHeaderX + 96, heroHeaderY + 54);
      if (isHeaderSelected) {
        ctx.strokeStyle = UI.accent;
        ctx.lineWidth = 1;
        roundRect(ctx, heroHeaderX, heroHeaderY, heroHeaderW, heroHeaderH, UI.radiusPanel);
        ctx.stroke();
      }
      uiHitAreas.push({
        focus: 'loadout',
        index: 0,
        x: heroHeaderX,
        y: heroHeaderY,
        w: heroHeaderW,
        h: heroHeaderH,
        action: () => handleLoadoutSelect(0),
      });

      const layoutMap = new Map();
      gearLeft.forEach((slot, i) => {
        layoutMap.set(slot, { x: gearLeftX, y: layout.gearTop + i * (gearCardH + gearGapY), w: gearCardW, h: gearCardH, dashed: false });
      });
      gearRight.forEach((slot, i) => {
        layoutMap.set(slot, { x: gearRightX, y: layout.gearTop + i * (gearCardH + gearGapY), w: gearCardW, h: gearCardH, dashed: false });
      });
      moduleSlots.forEach((slot, i) => {
        layoutMap.set(slot, { x: layout.moduleX + i * (moduleCardW + moduleGap), y: layout.moduleY, w: moduleCardW, h: moduleCardH, dashed: true });
      });

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const layout = layoutMap.get(slot);
        if (!layout) continue;
        const isSelected = menuSelectedIndex === i + 1;
        const liftY = isSelected ? -3 : 0;
        const x = layout.x;
        const y = layout.y + liftY;
        const cardW = layout.w;
        const cardH = layout.h;
        const gearId = equipped[slot];
        const gear = gearId ? GEAR_CATALOG[gearId] : null;
        const isEmpty = !gear;
        const rarity = gear?.rarity || 'common';
        const slotAccent = RARITY_ACCENTS[rarity] || RARITY_ACCENTS.common;
        const slotIcon = SLOT_ICONS[slot] || '\u25A0';

        if (isEmpty) {
          ctx.fillStyle = 'rgba(12,20,36,0.5)';
          roundRect(ctx, x, y, cardW, cardH, UI.radiusSlot);
          ctx.fill();
          if (layout.dashed) ctx.setLineDash([6, 4]);
          ctx.strokeStyle = isSelected ? UI.accent : 'rgba(80,120,180,0.2)';
          ctx.lineWidth = isSelected ? 1.5 : 1;
          roundRect(ctx, x, y, cardW, cardH, UI.radiusSlot);
          ctx.stroke();
          ctx.setLineDash([]);
          if (isSelected) {
            ctx.fillStyle = 'rgba(91,141,239,0.08)';
            roundRect(ctx, x, y, cardW, cardH, UI.radiusSlot);
            ctx.fill();
          }
          ctx.fillStyle = UI.hint;
          ctx.font = '24px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('+', x + cardW / 2, y + cardH / 2 - 5);
          ctx.fillStyle = UI.locked;
          ctx.font = UI.fontHint + 'px sans-serif';
          ctx.fillText('Install Module', x + cardW / 2, y + cardH / 2 + 16);
          ctx.textAlign = 'left';
        } else {
          drawGlassPanel(x, y, cardW, cardH, null, UI.radiusSlot);
          ctx.fillStyle = slotAccent;
          ctx.fillRect(x, y, 4, cardH);
          if (isSelected) {
            ctx.strokeStyle = UI.accent;
            ctx.lineWidth = 1;
            roundRect(ctx, x, y, cardW, cardH, UI.radiusSlot);
            ctx.stroke();
            ctx.fillStyle = 'rgba(91,141,239,0.06)';
            roundRect(ctx, x, y, cardW, cardH, UI.radiusSlot);
            ctx.fill();
          }
          ctx.fillStyle = UI.hint;
          ctx.font = UI.fontHint + 'px sans-serif';
          ctx.fillText(slot.replace(/([A-Z])/g, ' $1').trim(), x + 22, y + 18);
          ctx.fillStyle = slotIcon ? UI.accentDim : UI.hint;
          ctx.font = (UI.fontSectionHeader + 3) + 'px sans-serif';
          ctx.fillText(slotIcon, x + cardW - 32, y + 44);
          ctx.fillStyle = UI.header;
          ctx.font = UI.fontBody + 'px sans-serif';
          ctx.fillText(gear.name, x + 22, y + 44);
          ctx.fillStyle = slotAccent;
          ctx.font = UI.fontLabel + 'px sans-serif';
          ctx.fillText(gear.rarity, x + 22, y + 62);
        }
        uiHitAreas.push({
          focus: 'loadout',
          index: i + 1,
          x,
          y,
          w: cardW,
          h: cardH,
          action: () => handleLoadoutSelect(i + 1),
        });
      }

      const isBackSelected = menuSelectedIndex === 1 + EQUIPMENT_SLOTS.length;
      drawGlassButton(layout.backX, layout.backY, layout.backW, backH, isBackSelected);
      ctx.fillStyle = isBackSelected ? UI.title : UI.body;
      ctx.font = (UI.fontBody + 3) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Back to Menu', cw / 2, layout.backY + 32);
      ctx.fillStyle = UI.hint;
      ctx.font = UI.fontHint + 'px sans-serif';
      ctx.fillText('Arrow keys — Navigate  ·  Enter — Cycle gear / Back  ·  Esc — Back', cw / 2, layout.hintY);
      ctx.textAlign = 'left';
      uiHitAreas.push({
        focus: 'loadout',
        index: 1 + EQUIPMENT_SLOTS.length,
        x: layout.backX,
        y: layout.backY,
        w: layout.backW,
        h: backH,
        action: () => handleLoadoutSelect(1 + EQUIPMENT_SLOTS.length),
      });
      ctx.globalAlpha = 1;
    } else if (menuScreen === 'enemies') {
      const enemyIds = ['chaser', 'charger', 'sniper', 'splitter', 'boss'];
      enemySelectionLerp += (menuSelectedIndex - enemySelectionLerp) * 0.1;
      enemyTransitionAlpha += (1 - enemyTransitionAlpha) * 0.12;
      const selIdx = Math.round(enemySelectionLerp);
      const selEnemyId = enemyIds[selIdx];
      const enemyData = selEnemyId ? ENEMY_DATA[selEnemyId] : null;
      const t = performance.now() * 0.001;

      drawMenuBackground(cw, ch);
      ctx.globalAlpha = menuTransitionAlpha;

      const enemyAreaW = cw * 0.55;
      const statsPanelW = 340;
      const statsPanelH = 360;
      const statsX = cw - statsPanelW - UI.edgeMargin;
      const statsY = (ch - statsPanelH) / 2;

      const previewH = 350;
      const enemyCenterX = enemyAreaW / 2;
      const enemyCenterY = ch * 0.42;
      const breathScale = 1.01 + 0.01 * Math.sin(t * 2);
      const floatY = 3 * Math.sin(t * 1.2);
      const enemySize = previewH * breathScale;
      const enemyLeft = enemyCenterX - enemySize / 2;
      const enemyTop = enemyCenterY - enemySize / 2 + floatY;
      const enemyCenterYf = enemyTop + enemySize / 2;

      const ambientGlow = ctx.createRadialGradient(enemyCenterX, enemyCenterYf, 0, enemyCenterX, enemyCenterYf, enemySize * 1.05);
      ambientGlow.addColorStop(0, 'rgba(150,40,40,0.05)');
      ambientGlow.addColorStop(0.6, 'rgba(120,30,30,0.03)');
      ambientGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = ambientGlow;
      ctx.beginPath();
      ctx.arc(enemyCenterX, enemyCenterYf, enemySize * 1.05, 0, Math.PI * 2);
      ctx.fill();

      const redGlow = ctx.createRadialGradient(enemyCenterX, enemyCenterYf, 0, enemyCenterX, enemyCenterYf, enemySize * 0.7);
      redGlow.addColorStop(0, 'rgba(200,70,70,0.22)');
      redGlow.addColorStop(0.4, 'rgba(160,60,60,0.1)');
      redGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = redGlow;
      ctx.beginPath();
      ctx.arc(enemyCenterX, enemyCenterYf, enemySize * 0.85, 0, Math.PI * 2);
      ctx.fill();

      const glowPulse = 0.1 + 0.06 * Math.sin(t * 1.5);
      const pulseGrad = ctx.createRadialGradient(enemyCenterX, enemyCenterYf, 0, enemyCenterX, enemyCenterYf, enemySize * 0.9);
      pulseGrad.addColorStop(0, `rgba(220,80,80,${glowPulse})`);
      pulseGrad.addColorStop(0.6, 'rgba(170,60,60,0.04)');
      pulseGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = pulseGrad;
      ctx.beginPath();
      ctx.arc(enemyCenterX, enemyCenterYf, enemySize * 0.95, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetY = 5;
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(enemyCenterX, enemyCenterYf + enemySize * 0.45, enemySize * 0.4, enemySize * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const enemySprite = selEnemyId ? enemySprites[selEnemyId] : null;
      if (enemySprite && enemySprite.complete && enemySprite.naturalWidth > 0) {
        ctx.drawImage(enemySprite, enemyLeft, enemyTop, enemySize, enemySize);
      }

      const epad = UI.panelPadding;
      drawGlassPanel(statsX, statsY, statsPanelW, statsPanelH);
      ctx.fillStyle = '#c05050';
      ctx.fillRect(statsX, statsY, 3, 40);
      ctx.fillStyle = UI.title;
      ctx.font = 'bold ' + UI.fontPanelTitle + 'px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(enemyData?.name || '—', statsX + epad, statsY + 32);
      const nameFlicker = 0.25 + 0.25 * Math.sin(t * 2.2);
      ctx.strokeStyle = `rgba(200,70,70,${nameFlicker})`;
      ctx.lineWidth = 1;
      roundRect(ctx, statsX + epad - 6, statsY + 12, statsPanelW - epad * 2 + 12, 28, UI.radiusSlot);
      ctx.stroke();
      ctx.fillStyle = UI.body;
      ctx.font = UI.fontHint + 'px sans-serif';
      const roleW = 80;
      const roleX = statsX + epad;
      const roleY = statsY + 50;
      ctx.fillStyle = 'rgba(50,30,30,0.8)';
      ctx.fillRect(roleX, roleY - 14, roleW, 20);
      ctx.strokeStyle = 'rgba(180,80,80,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(roleX, roleY - 14, roleW, 20);
      ctx.fillStyle = '#c07070';
      ctx.font = (UI.fontLabel - 1) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(enemyData?.role || '', roleX + roleW / 2, roleY);
      ctx.textAlign = 'left';
      ctx.fillStyle = UI.body;
      ctx.font = '12px sans-serif';
      const descLines = (enemyData?.description || '').match(/.{1,42}(\s|$)/g) || [''];
      let descY = statsY + 92;
      descLines.slice(0, 3).forEach((line) => {
        ctx.fillText(line.trim(), statsX + epad, descY);
        descY += 20;
      });

      const STAT_BARS = [
        { key: 'hp', label: 'HP', max: 5 },
        { key: 'dmg', label: 'DMG', max: 5 },
        { key: 'spd', label: 'SPD', max: 5 },
        { key: 'special', label: 'Special', max: 5 },
      ];
      const ebarPad = epad + 40;
      const ebarW = statsPanelW - ebarPad - epad;
      let barY = statsY + 158;
      const barTargets = enemyData?.stats || {};
      STAT_BARS.forEach((s) => {
        const val = Math.min(1, (barTargets[s.key] ?? 0) / s.max);
        const fillVal = enemyTransitionAlpha < 1 ? val * enemyTransitionAlpha : val;
        ctx.fillStyle = UI.hint;
        ctx.font = UI.fontLabel + 'px sans-serif';
        ctx.fillText(s.label, statsX + epad, barY - 2);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(statsX + ebarPad, barY - 8, ebarW, 8);
        ctx.fillStyle = '#c05050';
        ctx.fillRect(statsX + ebarPad, barY - 8, ebarW * fillVal, 8);
        if (fillVal > 0.05) {
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(statsX + ebarPad, barY - 8, ebarW * fillVal, 2);
        }
        barY += 24;
      });

      const threatLabelY = barY + 14;
      ctx.fillStyle = UI.hint;
      ctx.font = UI.fontLabel + 'px sans-serif';
      ctx.fillText('Threat Level', statsX + epad, threatLabelY);
      const threatMax = 5;
      const threatVal = enemyData?.threat ?? 0;
      const threatFillVal = enemyTransitionAlpha < 1 ? (threatVal / threatMax) * enemyTransitionAlpha : threatVal / threatMax;
      const segW = 38;
      const segGap = 6;
      const threatBarX = statsX + ebarPad;
      const threatBarY = threatLabelY + 4;
      for (let i = 0; i < threatMax; i++) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(threatBarX + i * (segW + segGap), threatBarY, segW, 10);
        if ((i + 1) / threatMax <= threatFillVal) {
          ctx.fillStyle = '#c05050';
          ctx.fillRect(threatBarX + i * (segW + segGap), threatBarY, segW, 10);
        } else if (i / threatMax < threatFillVal) {
          const partial = (threatFillVal * threatMax - i);
          ctx.fillStyle = '#c05050';
          ctx.fillRect(threatBarX + i * (segW + segGap), threatBarY, segW * Math.min(1, partial), 10);
        }
      }

      const stripY = ch - UI.carouselStripTopOffset;
      const cardW = 92;
      const cardH = 92;
      const cardGap = 18;
      const totalStripW = enemyIds.length * cardW + (enemyIds.length - 1) * cardGap;
      const stripStartX = cw / 2 - totalStripW / 2;
      enemyIds.forEach((id, i) => {
        const ed = ENEMY_DATA[id];
        const lerpIdx = Math.abs(i - enemySelectionLerp);
        const cardScale = 0.88 + 0.12 * Math.max(0, 1 - lerpIdx);
        const isSelected = cardScale > 0.96;
        const w = cardW * cardScale;
        const h = cardH * cardScale;
        const x = stripStartX + i * (cardW + cardGap) + (cardW - w) / 2;
        const y = stripY + (cardH - h) / 2 - (isSelected ? 4 : 0);
        if (isSelected) {
          const glowGrad = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 0.9);
          glowGrad.addColorStop(0, 'rgba(180,60,60,0.2)');
          glowGrad.addColorStop(0.6, 'rgba(140,50,50,0.06)');
          glowGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = glowGrad;
          ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
        }
        drawGlassPanel(x, y, w, h);
        if (isSelected) {
          ctx.strokeStyle = '#c05050';
          ctx.lineWidth = 1.5;
          roundRect(ctx, x, y, w, h, UI.radiusPanel);
          ctx.stroke();
        }
        const thumbSize = 46 * cardScale;
        const thumbLeft = x + (w - thumbSize) / 2;
        const thumbTop = y + 6;
        const cardSprite = enemySprites[id];
        if (cardSprite && cardSprite.complete && cardSprite.naturalWidth > 0) {
          ctx.drawImage(cardSprite, thumbLeft, thumbTop, thumbSize, thumbSize);
        }
        ctx.fillStyle = isSelected ? UI.title : UI.header;
        ctx.font = Math.round(UI.fontLabel * cardScale) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ed?.name || id, x + w / 2, y + h - 6);
      });
      uiHitAreas.length = 0;
      enemyIds.forEach((id, i) => {
        const lerpIdx = Math.abs(i - enemySelectionLerp);
        const cardScale = 0.88 + 0.12 * Math.max(0, 1 - lerpIdx);
        const cardW = 92;
        const cardH = 92;
        const cardGap = 18;
        const totalStripW = enemyIds.length * cardW + (enemyIds.length - 1) * cardGap;
        const stripStartX = cw / 2 - totalStripW / 2;
        const w = cardW * cardScale;
        const h = cardH * cardScale;
        const x = stripStartX + i * (cardW + cardGap) + (cardW - w) / 2;
        const y = (ch - UI.carouselStripTopOffset) + (cardH - h) / 2 - (cardScale > 0.96 ? 4 : 0);
        uiHitAreas.push({
          focus: 'enemies',
          index: i,
          x,
          y,
          w,
          h,
          action: () => {
            menuSelectedIndex = i;
            enemyTransitionAlpha = 0;
          },
        });
      });

      const enemiesTitleW = drawTrackingText(ctx, 'ENEMIES', cw / 2, UI.screenTitleY + getTitleYOffset(), {
        spacing: 1.5,
        font: UI.fontScreenTitle + 'px sans-serif',
        color: UI.title,
      });
      drawHeaderUnderline(ctx, cw / 2, UI.screenTitleY + getTitleYOffset(), enemiesTitleW);
      ctx.fillStyle = UI.hint;
      ctx.font = UI.fontHint + 'px sans-serif';
      ctx.fillText('← → Cycle  ·  Esc Back', cw / 2, ch - UI.navHintOffset);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    } else {
      // Main menu: inner panel layout, responsive, single footer, no overlap
      const pad = UI.mainPanelPad;
      const gap = UI.mainPanelGap;
      const cardW = Math.round(cw * UI.mainPanelWidthRatio);
      const footerY = ch - UI.navHintOffset;
      const footerZone = 50;
      const n = MENU_OPTIONS_MAIN.length;
      const cardH = 58;
      const cardGap = 12;
      const buttonsTotalH = n * cardH + (n - 1) * cardGap;
      const headerH = 42 + gap + 18 + 32 + gap;
      const contentTop = pad;
      const buttonsTop = Math.min(
        contentTop + headerH,
        footerY - footerZone - buttonsTotalH - gap
      );

      ctx.globalAlpha = menuTransitionAlpha;
      const cx = cw / 2;
      let y = contentTop;

      drawTopRightControls(ctx, cw);
      registerTopRightHitAreas();

      ctx.fillStyle = UI.title;
      ctx.font = '44px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('R O G U E L I K E', cx, y + 42 + getTitleYOffset());
      y += 52;

      ctx.fillStyle = UI.accent;
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(performance.now() * 0.002);
      ctx.fillRect(cx - 100, y, 200, 2);
      ctx.globalAlpha = menuTransitionAlpha;
      y += gap;

      ctx.fillStyle = UI.hint;
      ctx.font = UI.fontBody + 'px sans-serif';
      ctx.fillText('Choose your path', cx, y + 16);
      y += 32 + gap;

      uiHitAreas = uiHitAreas.filter((a) => a.onClick);
      MENU_OPTIONS_MAIN.forEach((opt, i) => {
        const isSelected = i === menuSelectedIndex;
        const liftY = isSelected ? -2 : 0;
        const by = buttonsTop + i * (cardH + cardGap) + liftY;
        const px = cx - cardW / 2;
        drawGlassButton(px, by, cardW, cardH, isSelected);
        uiHitAreas.push({
          focus: 'main',
          index: i,
          x: px,
          y: by,
          w: cardW,
          h: cardH,
          action: () => handleMainMenuSelect(i),
        });
        ctx.fillStyle = isSelected ? UI.title : UI.header;
        ctx.font = UI.fontScreenTitle + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(opt.label, cx, by + cardH / 2 - 10);
        if (opt.subtitle) {
          ctx.fillStyle = UI.hint;
          ctx.font = UI.fontHint + 'px sans-serif';
          ctx.fillText(opt.subtitle, cx, by + cardH / 2 + 12);
        }
        ctx.textBaseline = 'alphabetic';
      });

      ctx.fillStyle = UI.hint;
      ctx.font = UI.fontHint + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Arrow keys — Navigate  ·  Enter — Select', cx, footerY);

      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }
    if (settingsOpen) drawSettingsPanel(ctx, cw, ch);
    requestAnimationFrame(loop);
    return;
  }

  if (gameState === 'COUNTDOWN') {
    const elapsed = performance.now() - countdownStartTime;
    const phase = Math.floor(elapsed / COUNTDOWN_DURATION_MS);
    const sec = 3 - phase;
    if (phase >= 3) {
      gameState = 'PLAYING'; // State switch: countdown complete.
    }
    drawPlayScene();
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = '72px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(sec > 0 ? String(sec) : 'GO!', canvas.width / 2, 300);
    ctx.textAlign = 'left';
    requestAnimationFrame(loop);
    return;
  }

  if (gameState === 'DEAD') {
    drawPlayScene();
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e74c3c';
    ctx.font = '40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('You Died', canvas.width / 2, 220);
    const deadFrags = fragmentsFromElitesThisRun + fragmentsFromBossThisRun;
    if (deadFrags > 0) {
      ctx.fillStyle = '#bdc3c7';
      ctx.font = '16px sans-serif';
      ctx.fillText('Fragments earned: ' + deadFrags, canvas.width / 2, 255);
    }
    ctx.font = '22px sans-serif';
    ctx.fillStyle = deadSelectedIndex === 0 ? '#f1c40f' : '#ccc';
    ctx.fillText('Retry', canvas.width / 2, 300);
    ctx.fillStyle = deadSelectedIndex === 1 ? '#f1c40f' : '#ccc';
    ctx.fillText('Return to Menu', canvas.width / 2, 340);
    ctx.fillStyle = '#888';
    ctx.font = '16px sans-serif';
    ctx.fillText('Arrow keys + Enter', canvas.width / 2, 420);
    ctx.textAlign = 'left';
    const buttonW = 260;
    const buttonH = 36;
    const retryTop = 300 - 22;
    const menuTop = 340 - 22;
    uiHitAreas.push({
      focus: 'death',
      index: 0,
      x: canvas.width / 2 - buttonW / 2,
      y: retryTop,
      w: buttonW,
      h: buttonH,
      onClick: () => handleDeathSelect(0),
    });
    uiHitAreas.push({
      focus: 'death',
      index: 1,
      x: canvas.width / 2 - buttonW / 2,
      y: menuTop,
      w: buttonW,
      h: buttonH,
      onClick: () => handleDeathSelect(1),
    });
    requestAnimationFrame(loop);
    return;
  }

  if (gameState === 'VICTORY') {
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f1c40f';
    ctx.font = '36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Victory!', canvas.width / 2, 220);
    const totalFrags = fragmentsFromElitesThisRun + fragmentsFromBossThisRun + fragmentsFromVictoryThisRun;
    if (totalFrags > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = '18px sans-serif';
      ctx.fillText('Fragments earned: ' + totalFrags, canvas.width / 2, 270);
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#bdc3c7';
      const parts = [];
      if (fragmentsFromElitesThisRun) parts.push('Elites: ' + fragmentsFromElitesThisRun);
      if (fragmentsFromBossThisRun) parts.push('Boss: ' + fragmentsFromBossThisRun);
      if (fragmentsFromVictoryThisRun) parts.push('Victory: ' + fragmentsFromVictoryThisRun);
      if (parts.length) ctx.fillText(parts.join('  |  '), canvas.width / 2, 295);
    }
    ctx.fillStyle = '#fff';
    ctx.font = '20px sans-serif';
    ctx.fillText('Press Enter to Return to Menu', canvas.width / 2, 340);
    ctx.textAlign = 'left';
    requestAnimationFrame(loop);
    return;
  }

  if (gameState === 'PLAYING' && isPaused) {
    drawPlayScene();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const panelW = 320;
    const panelH = 160;
    const px = canvas.width / 2 - panelW / 2;
    const py = canvas.height / 2 - panelH / 2;
    drawGlassPanel(px, py, panelW, panelH, null, UI.radiusModal);
    ctx.fillStyle = UI.title;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', canvas.width / 2, py + 36);
    const options = ['Resume', 'Settings', 'Back to Menu'];
    uiHitAreas.length = 0;
    options.forEach((opt, i) => {
      const isSel = i === pauseSelectedIndex;
      ctx.fillStyle = isSel ? UI.title : UI.body;
      ctx.font = (UI.fontBody + 2) + 'px sans-serif';
      ctx.fillText(opt, canvas.width / 2, py + 78 + i * 30);
      uiHitAreas.push({
        focus: 'pause',
        index: i,
        x: px + 40,
        y: py + 62 + i * 30,
        w: panelW - 80,
        h: 26,
        action: () => handlePauseSelect(i),
      });
    });
    ctx.textAlign = 'left';
    drawTopRightControls(ctx, canvas.width, -10);
    registerTopRightHitAreas();
    if (settingsOpen) drawSettingsPanel(ctx, canvas.width, canvas.height);
    requestAnimationFrame(loop);
    return;
  }

  const r = rooms[currentRoomId];
  const hpBeforeDamage = player.currentHp;
  const wallSegments = getWallSegments(room, r.doors);
  const doorRects = getDoorRects(room, r.doors);

  // 1. Bullets: move, then collision vs enemies first (so we can detect room clear this frame).
  for (const b of bullets) b.update();

  for (const e of r.enemies) applyEliteStats(e);

  const hitEnemies = new Set();
  const splitterChildrenToSpawn = [];
  const spawnProjectile = (x, y, dx, dy) => {
    enemyProjectiles.push({ x, y, dx, dy, w: 5, h: 5, getAABB() { return { left: this.x - 2.5, right: this.x + 2.5, top: this.y - 2.5, bottom: this.y + 2.5 }; }, update() { this.x += this.dx; this.y += this.dy; } });
  };
  const afterEnemy = bullets.filter((b) => {
    for (const e of r.enemies) {
      if (hitEnemies.has(e)) continue;
      if (aabbOverlap(b.getAABB(), e.getAABB())) {
        const baseDmg = 1;
        const dr = e.damageReduction ?? 0;
        const effectiveDmg = Math.max(0.25, baseDmg * (1 - dr));
        e.health = (e.health ?? 1) - effectiveDmg;
        e.hitUntil = performance.now() + HIT_FLASH_MS;
        audioManager.play('hit_enemy', 'sfx');
        screenShakeMagnitude = Math.min(SHAKE_MAX, screenShakeMagnitude + SHAKE_PER_HIT);
          if (e.health <= 0) {
          audioManager.play('enemy_die', 'sfx');
          emitGameEvent('onPlayerHit', { target: e });
          emitGameEvent('onEnemyKilled', { enemy: e });
          runVolatileExplosion(e, player, (amt) => { player.currentHp -= amt; if (player.currentHp <= 0) { enterDeathState(); } });
          if (e.isElite) {
            elitesKilledThisRun++;
            // Fragment drop triggered: elite death. Exploit prevention: elite removed this frame, cannot re-trigger.
            const heroId = getSelectedHeroId();
            const result = tryGrantEliteFragments(heroId, difficultyModifier, { x: e.x, y: e.y });
            if (result) {
              fragmentsFromElitesThisRun += result.granted;
              fragmentDropFeedbacks.push({ x: result.position.x, y: result.position.y, text: '+' + result.granted, until: performance.now() + FRAGMENT_FEEDBACK_DURATION_MS });
              audioManager.play('fragment_collect', 'sfx');
            }
          }
          detachAffixModifiers(e);
          hitEnemies.add(e);
          if (e instanceof Splitter && !e.isSplitterChild) {
            splitterChildrenToSpawn.push(new Splitter(e.x - 15, e.y, SPLITTER_CHILD_W, SPLITTER_CHILD_H, SPLITTER_CHILD_SPEED, 1, true));
            splitterChildrenToSpawn.push(new Splitter(e.x + 15, e.y, SPLITTER_CHILD_W, SPLITTER_CHILD_H, SPLITTER_CHILD_SPEED, 1, true));
          }
        }
        return false;
      }
    }
    if (r.boss && aabbOverlap(b.getAABB(), r.boss.getAABB())) {
      r.boss.health--;
      r.boss.hitUntil = performance.now() + BOSS_HIT_FLASH_MS; // Boss impact: longer flash
      audioManager.play('hit_enemy', 'sfx');
      screenShakeMagnitude = Math.min(SHAKE_MAX, screenShakeMagnitude + BOSS_SHAKE_PER_HIT); // Boss impact: stronger shake
      if (r.boss.health <= 0) {
        audioManager.play('boss_die', 'sfx');
        const bossX = r.boss.x;
        const bossY = r.boss.y;
        emitGameEvent('onPlayerHit', { target: r.boss });
        emitGameEvent('onEnemyKilled', { enemy: r.boss, isBoss: true });
        // Fragment drop triggered: boss death. Exploit prevention: boss removed this frame, cannot re-trigger.
        const heroId = getSelectedHeroId();
        const bossResult = grantBossFragments(heroId, 0, { x: bossX, y: bossY });
        fragmentsFromBossThisRun += bossResult.granted;
        fragmentDropFeedbacks.push({ x: bossX, y: bossY, text: '+' + bossResult.granted, until: performance.now() + FRAGMENT_FEEDBACK_DURATION_MS });
        audioManager.play('fragment_collect', 'sfx');
        audioManager.play('reward_pickup', 'sfx');
        deathEffects.push({ x: bossX, y: bossY, w: r.boss.w, h: r.boss.h, color: '#9b59b6', until: performance.now() + DEATH_EFFECT_MS });
        r.boss = null;
      }
      return false;
    }
    return true;
  });
  bullets.length = 0;
  bullets.push(...afterEnemy);

  // 2. Room-clear: immediately mark cleared when last enemy/boss defeated.
  if (r.enemies.length === 0 && !r.boss && !r.cleared) {
    r.cleared = true;
    audioManager.play('room_clear', 'sfx');
    roomsCleared++;
    emitGameEvent('onRoomCleared', { roomId: currentRoomId, room: r });
    updateBossDoorState(); // Boss unlock: recalculate immediately when a room becomes cleared.
    if (r.isBossRoom) {
      // Fragment drop triggered: run victory. Exploit prevention: runVictoryFragmentsGranted ensures one-time grant.
      if (!runVictoryFragmentsGranted) {
        const heroId = getSelectedHeroId();
        const vicResult = grantVictoryFragments(heroId);
        fragmentsFromVictoryThisRun = vicResult.granted;
        runVictoryFragmentsGranted = true;
        if (vicResult.granted > 0) {
          audioManager.play('fragment_collect', 'sfx');
          audioManager.play('reward_pickup', 'sfx');
        }
      }
      gameState = 'VICTORY'; // State switch: boss defeated.
    } else {
      nonBossRoomsCleared++;
      // Healing Room: every HEALING_ROOM_INTERVAL non-boss clears, show healing first (priority over upgrades this room).
      if (nonBossRoomsCleared % HEALING_ROOM_INTERVAL === 0) {
        healingChoices = createHealingChoices();
      } else if (!settingsOpen && !isPaused) {
        upgradeChoices = { choices: pickRandomUpgrades(2) };
        upgradeSelectedIndex = 0;
        inputMode = 'upgrade';
      }
      // Demon Shrine: randomly spawn in non-boss cleared rooms. Appears once per room.
      if (Math.random() < 0.35) {
        const sw = 48;
        const sh = 48;
        r.shrine = { x: center.x - sw / 2, y: center.y - sh / 2, w: sw, h: sh };
      }
    }
  }

  // 3. Door state refresh: uses bossDoorsUnlocked (set by updateBossDoorState above). recalculate which doors to block using current r.cleared.
  // Normal rooms: all doors locked when !cleared; when cleared, only boss doors stay locked (if boss not yet accessible).
  // Boss-door locking never overrides normal room doors; it applies only to doors that connect TO the boss room.
  let doorRectsToBlock = [];
  if (!r.cleared) {
    doorRectsToBlock = doorRects;
  } else {
    doorRectsToBlock = doorRects.filter((dr) => rooms[dr.connectsTo].isBossRoom && !bossDoorsUnlocked);
  }
  const blockingRects = [...wallSegments, ...doorRectsToBlock, ...(r.obstacles || [])];
  const blockingAABBs = blockingRects.map((w) => wallToAABB(w));

  // 4. Bullet vs walls (uses refreshed blocking rects; cleared-room doors no longer block bullets).
  const afterWalls = bullets.filter((b) => {
    const ba = b.getAABB();
    return !blockingAABBs.some((rect) => aabbOverlap(ba, rect));
  });
  bullets.length = 0;
  bullets.push(...afterWalls);

  for (const ep of enemyProjectiles) ep.update();
  const afterEpWalls = enemyProjectiles.filter((ep) => {
    const ba = ep.getAABB();
    return !blockingAABBs.some((rect) => aabbOverlap(ba, rect));
  });
  for (const ep of afterEpWalls) {
      if (aabbOverlap(ep.getAABB(), player.getAABB())) {
      const dmg = Math.max(1, Math.round(enemyDamageMultiplier));
      emitGameEvent('onDamageTaken', { damage: dmg, source: 'projectile' });
      player.currentHp -= dmg;
      player.x = center.x;
      player.y = center.y;
      if (player.currentHp <= 0) { enterDeathState(); }
      break;
    }
  }
  enemyProjectiles.length = 0;
  enemyProjectiles.push(...afterEpWalls.filter((ep) => !aabbOverlap(ep.getAABB(), player.getAABB())));

  // Modifier engine: evaluate derived stats (no sync from game; base stats unchanged). Apply to player and run state.
  processModifierDurations(performance.now());
  const derived = getDerivedStats(baseStats);
  const derivedGlobal = getDerivedGlobal();
  player.speed = Math.min(MOVE_SPEED_MAX, Math.max(1, derived.moveSpeed));
  player.maxHp = Math.max(1, derived.maxHP);
  player.currentHp = Math.min(player.currentHp, player.maxHp);
  fireCooldownMs = Math.max(FIRE_COOLDOWN_MIN_MS, derived.fireRate);
  bulletSpeed = Math.min(BULLET_SPEED_MAX, derived.projectileSpeed);
  bulletsPerShot = Math.min(BULLETS_PER_SHOT_MAX, Math.max(1, Math.round(derived.bulletsPerShot)));
  enemyDamageMultiplier = derivedGlobal.enemyDamageMult;
  difficultyModifier = derivedGlobal.difficultyModifier;

  // 5. Player and enemy update (use refreshed blocking rects; doors unlock immediately when room cleared).
  if (!upgradeChoices && !shrineChoices && !healingChoices) {
    player.update(keys, blockingRects);
    for (const e of r.enemies) {
      if (e instanceof Sniper) e.update(player, blockingRects, spawnProjectile);
      else e.update(player, blockingRects);
    }
    if (r.boss) r.boss.update(player, blockingRects);
  }

  // Demon Shrine: when player touches shrine in cleared non-boss room, open deal UI.
  if (!upgradeChoices && !shrineChoices && !healingChoices && r.cleared && !r.isBossRoom && r.shrine) {
    const shrineAABB = wallToAABB(r.shrine);
    if (aabbOverlap(player.getAABB(), shrineAABB)) {
      shrineChoices = { choices: pickRandomShrineDeals() };
      audioManager.play('shrine_open', 'sfx');
    }
  }

  // Teleport pads: paired A↔B. Overlap pad A → move to center of pad B. Cooldown guard prevents immediate re-trigger.
  if (!r.isBossRoom && r.teleportPads && r.teleportPads.length === 2) {
    const now = performance.now();
    if (now - lastTeleportTime >= TELEPORT_COOLDOWN_MS) {
      for (let i = 0; i < 2; i++) {
        const pad = r.teleportPads[i];
        const padAABB = wallToAABB(pad);
        if (aabbOverlap(player.getAABB(), padAABB)) {
          const otherPad = r.teleportPads[1 - i];
          player.x = otherPad.x + otherPad.w / 2;
          player.y = otherPad.y + otherPad.h / 2;
          lastTeleportTime = now;
          emitGameEvent('onTeleport', { fromPad: i, toPad: 1 - i });
          break;
        }
      }
    }
  }

  // --- Door transition ---
  // Boss doors use bossDoorsUnlocked (event-driven state, not render timing).
  let didTransition = false;
  if (!upgradeChoices && !shrineChoices && !healingChoices && !justTransitioned && r.cleared) {
    for (const dr of doorRects) {
      const target = rooms[dr.connectsTo];
      if (target.isBossRoom && !bossDoorsUnlocked) continue;
      if (aabbOverlap(player.getAABB(), wallToAABB(dr))) {
        transitionToRoom(currentRoomId, dr.connectsTo);
        didTransition = true;
        break;
      }
    }
  }

  const rn = rooms[currentRoomId];

  // Clear transition guard when player is no longer overlapping any door (left the doorway).
  if (!didTransition) {
    const rnDoorRects = getDoorRects(room, rn.doors);
    const overAnyDoor = rnDoorRects.some((dr) => aabbOverlap(player.getAABB(), wallToAABB(dr)));
    if (!overAnyDoor) justTransitioned = false;
  }

  // 6. [Removed: exit touch / reset trigger. Cleared rooms remain cleared permanently.]

  // 7. Enemy/boss touch → damage player, reset position. State switch: DEAD when HP reaches 0.
  if (!rn.cleared) {
    for (const e of rn.enemies) {
      if (hitEnemies.has(e)) continue;
      if (aabbOverlap(player.getAABB(), e.getAABB())) {
        const dmg = Math.max(1, Math.round(enemyDamageMultiplier));
        emitGameEvent('onDamageTaken', { damage: dmg, source: 'enemy' });
        player.currentHp -= dmg; // Demon Shrine: apply enemy damage multiplier
        if (e.isElite && e.affix === 'vampiric') {
          const heal = getVampiricHealAmount(e);
          e.health = Math.min(e.maxHealth ?? e.health, (e.health ?? 0) + heal);
        }
        player.x = center.x;
        player.y = center.y;
        if (player.currentHp <= 0) { enterDeathState(); }
        break;
      }
    }
    if (player.currentHp > 0 && rn.boss && aabbOverlap(player.getAABB(), rn.boss.getAABB())) {
      const dmg = Math.max(1, Math.round(enemyDamageMultiplier));
      emitGameEvent('onDamageTaken', { damage: dmg, source: 'boss' });
      player.currentHp -= dmg; // Demon Shrine: apply enemy damage multiplier
      player.x = center.x;
      player.y = center.y;
      if (player.currentHp <= 0) { enterDeathState(); }
    }
  }
  if (player.currentHp < hpBeforeDamage) {
    healthBarDamageFlashUntil = performance.now() + HEALTH_BAR_DAMAGE_FLASH_MS;
    audioManager.play('player_hit', 'sfx');
  }
  let hpRatio = player.currentHp / Math.max(1, player.maxHp);
  if (!lowHpWarningActive && hpRatio <= 0.25) {
    audioManager.play('low_hp_warning', 'sfx');
    lowHpWarningActive = true;
  } else if (lowHpWarningActive && hpRatio > 0.3) {
    lowHpWarningActive = false;
  }

  // 8. Render — background, floor, wall segments, doors, bullets, enemies, player, "Room Cleared"
  ctx.fillStyle = '#16213e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Screen shake: decay each frame; reset cleanly when below threshold.
  if (screenShakeMagnitude > SHAKE_THRESHOLD) {
    screenShakeMagnitude *= SHAKE_DECAY;
    if (screenShakeMagnitude < SHAKE_THRESHOLD) screenShakeMagnitude = 0;
  }

  ctx.save();
  if (screenShakeMagnitude > 0) {
    const sx = (Math.random() - 0.5) * 2 * screenShakeMagnitude;
    const sy = (Math.random() - 0.5) * 2 * screenShakeMagnitude;
    ctx.translate(sx, sy); // Screen shake: apply to game world
  }

  // Inner room: playable floor (walkable area inside blue frame).
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(inner.x, inner.y, inner.w, inner.h);

  ctx.fillStyle = '#0f3460';
  for (const w of getWallSegments(room, rn.doors)) {
    ctx.fillRect(w.x, w.y, w.w, w.h);
  }

  // Door visuals: locked (combat), boss-locked, unlocked. Inner bar for locked clarity.
  for (const dr of getDoorRects(room, rn.doors)) {
    const target = rooms[dr.connectsTo];
    const isLocked = !rn.cleared;
    const isBossLocked = target.isBossRoom && !bossDoorsUnlocked;
    if (isLocked) ctx.fillStyle = LOCKED_DOOR_COLOR;
    else if (isBossLocked) ctx.fillStyle = BOSS_LOCKED_DOOR_COLOR;
    else ctx.fillStyle = target.cleared ? DOOR_TO_CLEARED_COLOR : DOOR_TO_UNCLEARED_COLOR;
    ctx.fillRect(dr.x, dr.y, dr.w, dr.h);
    if (isLocked || isBossLocked) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      const midX = dr.x + dr.w / 2; const midY = dr.y + dr.h / 2;
      const bw = Math.max(4, Math.min(dr.w, dr.h) * 0.35);
      ctx.fillRect(midX - bw / 2, midY - 2, bw, 4);
    }
  }

  // Frame: outer room border (blue stroke).
  ctx.strokeStyle = '#533483';
  ctx.lineWidth = 2;
  ctx.strokeRect(room.x, room.y, room.width, room.height);

  for (const o of rn.obstacles || []) {
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeStyle = '#34495e';
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    ctx.strokeStyle = '#533483';
  }

  (rn.teleportPads || []).forEach((pad, i) => {
    ctx.fillStyle = i === 0 ? '#1abc9c' : '#16a085';
    ctx.fillRect(pad.x, pad.y, pad.w, pad.h);
    ctx.strokeStyle = i === 0 ? '#0e6655' : '#0d5c4a';
    ctx.lineWidth = 2;
    ctx.strokeRect(pad.x, pad.y, pad.w, pad.h);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(i === 0 ? 'A' : 'B', pad.x + pad.w / 2, pad.y + pad.h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = '#533483';
    ctx.lineWidth = 2;
  });

  // Demon Shrine: draw in cleared non-boss rooms when present. Diamond symbol for clarity.
  if (rn.cleared && !rn.isBossRoom && rn.shrine) {
    const sh = rn.shrine;
    ctx.fillStyle = '#2d1b4e';
    ctx.fillRect(sh.x, sh.y, sh.w, sh.h);
    ctx.strokeStyle = '#9b59b6';
    ctx.lineWidth = 2;
    ctx.strokeRect(sh.x, sh.y, sh.w, sh.h);
    const cx = sh.x + sh.w / 2; const cy = sh.y + sh.h / 2; const r = 8;
    ctx.fillStyle = 'rgba(155,89,182,0.6)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  }

  // Shooting visual: muzzle flash at spawn position (1–2 frames).
  const now = performance.now();
  if (muzzleFlash && now < muzzleFlash.until) {
    ctx.fillStyle = '#fff8dc';
    const size = 14;
    ctx.fillRect(muzzleFlash.x - size / 2, muzzleFlash.y - size / 2, size, size);
  } else if (muzzleFlash) {
    muzzleFlash = null;
  }

  for (const b of bullets) b.draw(ctx);
  ctx.fillStyle = '#e74c3c';
  for (const ep of enemyProjectiles) ctx.fillRect(ep.x - 2.5, ep.y - 2.5, ep.w || 5, ep.h || 5);
  for (const e of rn.enemies) {
    e.draw(ctx, enemySprites);
    if (e.isElite) {
      const w = e.w || 20;
      const h = e.h || 20;
      const left = e.x - w / 2 - 2;
      const top = e.y - h / 2 - 2;
      const affix = e.affix || '';
      const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.008);
      if (affix === 'frenzied') {
        ctx.fillStyle = 'rgba(255,140,0,0.15)';
        ctx.fillRect(left - 1, top - 1, w + 6, h + 6);
        ctx.strokeStyle = '#ff8c00';
      } else if (affix === 'hardened') {
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        ctx.strokeRect(left - 1, top - 1, w + 6, h + 6);
        ctx.lineWidth = 1;
      } else if (affix === 'volatile') {
        ctx.fillStyle = `rgba(255,180,50,${0.1 * pulse})`;
        ctx.fillRect(left - 2, top - 2, w + 8, h + 8);
        ctx.strokeStyle = '#ffb432';
      } else if (affix === 'vampiric') {
        ctx.fillStyle = 'rgba(180,50,100,0.12)';
        ctx.fillRect(left - 1, top - 1, w + 6, h + 6);
        ctx.strokeStyle = '#c23d6b';
      } else {
        ctx.strokeStyle = '#ffd700';
      }
      if (affix !== 'hardened') ctx.lineWidth = 2;
      ctx.strokeRect(left, top, w + 4, h + 4);
      ctx.lineWidth = 1;
    }
  }
  if (rn.boss) rn.boss.draw(ctx, enemySprites);
  // Death effect: draw stateless pop at removal position. Fade-out + slight scale-up for 1–2 frames.
  for (const d of deathEffects) {
    if (now >= d.until) continue;
    const t = 1 - (d.until - now) / DEATH_EFFECT_MS;
    const scale = 1 + 0.15 * t;
    const alpha = 1 - t;
    const dw = d.w * scale;
    const dh = d.h * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = d.color;
    ctx.fillRect(d.x - dw / 2, d.y - dh / 2, dw, dh);
    ctx.restore();
  }
  deathEffects.splice(0, deathEffects.length, ...deathEffects.filter((d) => now < d.until));

  for (const fb of fragmentDropFeedbacks) {
    if (now >= fb.until) continue;
    const t = 1 - (fb.until - now) / FRAGMENT_FEEDBACK_DURATION_MS;
    const alpha = 1 - t * 0.8;
    const offsetY = -t * 24;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(fb.text + ' shard' + (parseInt(fb.text.slice(1), 10) === 1 ? '' : 's'), fb.x, fb.y + offsetY);
    ctx.restore();
  }
  fragmentDropFeedbacks.splice(0, fragmentDropFeedbacks.length, ...fragmentDropFeedbacks.filter((fb) => now < fb.until));

  const heroDef = getMetaHeroDefinition(getSelectedHeroId());
  const heroId = heroDef?.id || getSelectedHeroId() || 'vanguard';
  const ap = attackPopUntil > now ? 1 - (attackPopUntil - now) / ATTACK_POP_MS : 0;
  player.draw(ctx, heroDef?.category || 'vanguard', heroSprites[heroId], {
    attackPop: ap,
    isMoving: keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD'),
    lastDx: player.lastDx,
    lastDy: player.lastDy,
    hpRatio: player.currentHp / Math.max(1, player.maxHp),
    lastShootDx: lastShootDx,
    lastShootDy: lastShootDy,
  });

  ctx.restore();

  // --- Subtle vignette (always on). Visual only. ---
  const vigGrad = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, canvas.height * 0.25,
    canvas.width / 2, canvas.height / 2, canvas.height * 0.9
  );
  vigGrad.addColorStop(0, 'transparent');
  vigGrad.addColorStop(0.7, 'transparent');
  vigGrad.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = vigGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // --- Low HP vignette (HP < 30%): red pulse overlay. Visual only. ---
  hpRatio = player.currentHp / Math.max(1, player.maxHp);
  if (hpRatio < 0.3 && hpRatio > 0) {
    const vigPulse = 0.15 + 0.12 * Math.sin(performance.now() * 0.008);
    const vigGrad = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, canvas.height * 0.2,
      canvas.width / 2, canvas.height / 2, canvas.height * 0.8
    );
    vigGrad.addColorStop(0, 'transparent');
    vigGrad.addColorStop(0.5, 'transparent');
    vigGrad.addColorStop(0.85, `rgba(180,40,40,${0.25 * (1 - hpRatio / 0.3)})`);
    vigGrad.addColorStop(1, `rgba(120,20,20,${0.35 * (1 - hpRatio / 0.3) * (0.8 + vigPulse)})`);
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // --- HUD layer begins: drawn in screen space, outside inner room. ---
  drawHealthBar();
  if (rn.cleared) {
    const HEALTH_BAR_H = 26;
    ctx.fillStyle = '#fff';
    ctx.font = '28px sans-serif';
    ctx.textAlign = 'center';
    const roomClearedY = room.y - HUD_OFFSET + HEALTH_BAR_H + 20; // In HUD strip, below health bar.
    ctx.fillText(rn.isBossRoom ? 'Victory' : 'Room Cleared', room.x + room.width / 2, roomClearedY);
    ctx.textAlign = 'left';
  }

  // Death effect: spawn visual-only pop at removal position. Enemy removal unchanged.
  for (const e of hitEnemies) {
    const baseColor = e instanceof Sniper ? '#2980b9' : e instanceof Splitter ? '#8e44ad' : e instanceof Charger ? '#c0392b' : '#f39c12';
    const color = e.affix === 'volatile' ? '#ff6b35' : baseColor;
    const size = e.affix === 'volatile' ? 60 : (e.w || 20);
    deathEffects.push({ x: e.x, y: e.y, w: size, h: size, color, until: now + DEATH_EFFECT_MS });
  }
  rn.enemies = rn.enemies.filter((e) => !hitEnemies.has(e));
  rn.enemies.push(...splitterChildrenToSpawn);

  // Upgrade overlay: 2 choices, press 1 or 2 to select. Blocks until choice made.
  if (upgradeChoices) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Choose an upgrade (1 or 2)', canvas.width / 2, 220);
    const optionW = 420;
    const optionH = 46;
    const optionX = canvas.width / 2 - optionW / 2;
    const optionY = 255;
    const optionGap = 14;
    ctx.font = '20px sans-serif';
    upgradeChoices.choices.forEach((choice, i) => {
      const y = optionY + i * (optionH + optionGap);
      const isSelected = upgradeSelectedIndex === i;
      ctx.fillStyle = isSelected ? 'rgba(18,30,50,0.92)' : 'rgba(12,20,36,0.7)';
      roundRect(ctx, optionX, y, optionW, optionH, 12);
      ctx.fill();
      ctx.strokeStyle = isSelected ? 'rgba(120,180,255,0.85)' : 'rgba(80,120,180,0.25)';
      ctx.lineWidth = isSelected ? 2 : 1;
      roundRect(ctx, optionX, y, optionW, optionH, 12);
      ctx.stroke();
      ctx.fillStyle = isSelected ? '#f1f5f9' : '#cbd5e1';
      ctx.fillText(`${i + 1}. ${choice.label}`, canvas.width / 2, y + optionH / 2 + 7);
      uiHitAreas.push({
        focus: 'upgrade',
        index: i,
        x: optionX,
        y,
        w: optionW,
        h: optionH,
        onClick: () => {
          upgradeSelectedIndex = i;
          audioManager.play('menu_select', 'ui');
          handleUpgradeSelect(i);
        },
      });
    });
    ctx.textAlign = 'left';
  }

  // Demon Shrine overlay: 2–3 deals, press 1/2/3. Each deal has positive + negative effect.
  if (shrineChoices) {
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#9b59b6';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Demon Shrine — Choose a deal (1, 2, or 3)', canvas.width / 2, 180);
    ctx.fillStyle = '#fff';
    ctx.font = '18px sans-serif';
    shrineChoices.choices.forEach((c, i) => {
      ctx.fillText(`${i + 1}. ${c.label}`, canvas.width / 2, 240 + i * 50);
    });
    ctx.textAlign = 'left';
  }

  // Healing Room overlay: mutually exclusive choices (heal / +max HP / skip). Blocks movement and shooting.
  if (healingChoices) {
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#27ae60';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Healing Room — Choose (1, 2, or 3)', canvas.width / 2, 180);
    ctx.fillStyle = '#fff';
    ctx.font = '18px sans-serif';
    healingChoices.choices.forEach((c, i) => {
      ctx.fillText(`${i + 1}. ${c.label}`, canvas.width / 2, 240 + i * 50);
    });
    ctx.textAlign = 'left';
  }

  // Upgrade feedback: short message after selecting, fades out over ~0.5s before until.
  if (upgradeFeedback) {
    const now = performance.now();
    if (now >= upgradeFeedback.until) {
      upgradeFeedback = null;
    } else {
      const remain = upgradeFeedback.until - now;
      const fadeStart = 400;
      const alpha = remain <= fadeStart ? remain / fadeStart : 1;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.font = '22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(upgradeFeedback.text, canvas.width / 2, 520);
      ctx.textAlign = 'left';
    }
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
