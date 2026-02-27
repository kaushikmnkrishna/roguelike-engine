class AudioManager {
  constructor({ basePath = 'assets/sounds', volumes, muted, sounds = {} } = {}) {
    this.basePath = basePath;
    this.volumes = Object.assign(
      { master: 0.35, music: 0.18, sfx: 0.22, ui: 0.18 },
      volumes || {}
    );
    this.muted = Object.assign(
      { master: false, music: false, sfx: false, ui: false },
      muted || {}
    );
    this.isMusicMuted = !!this.muted.music;
    this.musicFade = 1;
    this.sounds = {};
    this.lastPlay = {};
    this.unlocked = false;
    this.fadeStates = {};

    this._loadSettings();
    this.isMusicMuted = !!this.muted.music;

    Object.entries(sounds).forEach(([name, cfg]) => {
      const audio = new Audio(`${this.basePath}/${name}.mp3`);
      audio.preload = 'auto';
      audio.loop = !!cfg.loop;
      this.sounds[name] = {
        audio,
        rateLimitMs: cfg.rateLimitMs ?? 0,
        loop: !!cfg.loop,
        type: cfg.type || 'sfx',
      };
      audio.load();
    });

    const unlock = () => {
      this.unlocked = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  _effectiveMusicVolume() {
    const master = this.volumes.master ?? 0;
    const music = this.volumes.music ?? 0;
    const mutedAll = this.muted.master;
    const mutedMusic = this.isMusicMuted;
    const base = master * music * (mutedAll ? 0 : 1) * (mutedMusic ? 0 : 1);
    return Math.max(0, Math.min(0.4, base)) * (this.musicFade ?? 1);
  }

  _effectiveVolume(type) {
    const channel = type || 'sfx';
    if (channel === 'music') return this._effectiveMusicVolume();
    if (this.muted.master || this.muted[channel]) return 0;
    const master = this.volumes.master ?? 0;
    const ch = this.volumes[channel] ?? 0;
    return Math.max(0, Math.min(0.4, master * ch));
  }

  _loadSettings() {
    const saved = localStorage.getItem('gameAudioSettings');
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      if (data?.volumes) {
        this.volumes = Object.assign(this.volumes, data.volumes);
      }
      if (data?.muted) {
        this.muted = Object.assign(this.muted, data.muted);
      }
    } catch {
      // Ignore invalid settings.
    }
  }

  _saveSettings() {
    localStorage.setItem('gameAudioSettings', JSON.stringify({
      volumes: this.volumes,
      muted: this.muted,
    }));
  }

  setChannelVolume(type, value, { persist = true } = {}) {
    if (!(type in this.volumes)) return;
    this.volumes[type] = Math.max(0, Math.min(1, value));
    this._applyAudioMix();
    if (persist) this._saveSettings();
  }

  setMute(state, type = 'master') {
    if (!this.muted[type] && !state && type === 'master') return;
    if (type === 'music') {
      this.isMusicMuted = !!state;
      this.muted.music = this.isMusicMuted;
    } else {
      this.muted[type] = !!state;
    }
    this._applyAudioMix();
    this._saveSettings();
  }

  toggleMute() {
    this.setMute(!this.muted.master, 'master');
  }

  _applyAudioMix() {
    const musicVol = this._effectiveMusicVolume();
    Object.values(this.sounds).forEach((entry) => {
      if (!entry.loop) return;
      const audio = entry.audio;
      const effective = entry.type === 'music' ? musicVol : this._effectiveVolume(entry.type);
      if (effective > 0 && this.unlocked) {
        if (audio.paused) {
          const p = audio.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } else {
        audio.pause();
      }
      audio.volume = effective;
    });
  }

  _stopAllLoops() {
    Object.values(this.sounds).forEach((entry) => {
      if (!entry.loop) return;
      entry.audio.pause();
      entry.audio.currentTime = 0;
    });
  }

  play(name, type) {
    const entry = this.sounds[name];
    if (!entry) {
      console.warn(`[AudioManager] Missing sound: ${name}`);
      return;
    }
    if (!this.unlocked) return;
    const now = performance.now();
    const last = this.lastPlay[name] || 0;
    if (entry.rateLimitMs && now - last < entry.rateLimitMs) return;
    this.lastPlay[name] = now;
    const finalVol = this._effectiveVolume(type || entry.type);
    if (finalVol <= 0) return;
    try {
      const node = entry.audio.cloneNode();
      node.volume = finalVol;
      node.loop = false;
      const p = node.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Ignore autoplay/timing errors.
    }
  }

  playLoop(name, type) {
    const entry = this.sounds[name];
    if (!entry) {
      console.warn(`[AudioManager] Missing sound: ${name}`);
      return;
    }
    if (!this.unlocked) return;
    const finalVol = this._effectiveVolume(type || entry.type);
    if (finalVol <= 0) return;
    const audio = entry.audio;
    audio.loop = true;
    audio.volume = finalVol;
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  stop(name) {
    const entry = this.sounds[name];
    if (!entry) {
      console.warn(`[AudioManager] Missing sound: ${name}`);
      return;
    }
    const audio = entry.audio;
    audio.pause();
    audio.currentTime = 0;
  }

  _setMusicFade(target, duration = 500, onDone) {
    const start = performance.now();
    const from = this.musicFade ?? 1;
    const to = Math.max(0, Math.min(1, target));
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / duration);
      this.musicFade = from + (to - from) * t;
      this._applyAudioMix();
      if (t < 1) {
        requestAnimationFrame(tick);
      } else if (onDone) {
        onDone();
      }
    };
    requestAnimationFrame(tick);
  }

  _fadeTo(name, target, duration = 500, onDone) {
    const entry = this.sounds[name];
    if (!entry) {
      console.warn(`[AudioManager] Missing sound: ${name}`);
      return;
    }
    if (entry.type === 'music') {
      this._setMusicFade(target, duration, onDone);
      return;
    }
    const audio = entry.audio;
    const startVol = audio.volume ?? 0;
    const start = performance.now();
    const key = name;
    this.fadeStates[key] = { active: true };
    const tick = () => {
      if (!this.fadeStates[key]?.active) return;
      const t = Math.min(1, (performance.now() - start) / duration);
      audio.volume = startVol + (target - startVol) * t;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        this.fadeStates[key].active = false;
        if (target <= 0) {
          audio.pause();
          audio.currentTime = 0;
        }
        if (onDone) onDone();
      }
    };
    requestAnimationFrame(tick);
  }

  fadeInLoop(name, type = 'music', duration = 500) {
    const entry = this.sounds[name];
    if (!entry) {
      console.warn(`[AudioManager] Missing sound: ${name}`);
      return;
    }
    if (!this.unlocked) return;
    const audio = entry.audio;
    audio.loop = true;
    Object.values(this.sounds).forEach((other) => {
      if (!other.loop || other.type !== 'music' || other === entry) return;
      other.audio.pause();
    });
    if (audio.paused) {
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    this._setMusicFade(1, duration);
  }

  fadeOutLoop(name, duration = 500) {
    const entry = this.sounds[name];
    if (!entry) {
      console.warn(`[AudioManager] Missing sound: ${name}`);
      return;
    }
    if (entry.type === 'music') {
      this._setMusicFade(0, duration);
      return;
    }
    this._fadeTo(name, 0, duration);
  }
}

window.AudioManager = AudioManager;
window.audioManager = new AudioManager({
  basePath: 'assets/sounds',
  sounds: {
    mouse_click: { type: 'ui' },
    menu_hover: { type: 'ui' },
    menu_select: { type: 'ui' },
    menu_back: { type: 'ui' },
    menu_error: { type: 'ui' },
    hero_select: { type: 'ui' },
    hero_unlock: { type: 'ui' },
    upgrade_success: { type: 'ui' },
    equip_item: { type: 'ui' },
    unequip_item: { type: 'ui' },
    shoot: { rateLimitMs: 80, type: 'sfx' },
    hit_enemy: { type: 'sfx' },
    player_hit: { type: 'sfx' },
    enemy_die: { type: 'sfx' },
    room_clear: { type: 'sfx' },
    boss_intro: { type: 'sfx' },
    boss_die: { type: 'sfx' },
    shrine_open: { type: 'sfx' },
    shrine_accept: { type: 'sfx' },
    reward_pickup: { type: 'sfx' },
    fragment_collect: { type: 'sfx' },
    low_hp_warning: { type: 'sfx' },
    button_disabled: { type: 'ui' },
    ui_transition: { type: 'ui' },
    menu_ambient_loop: { loop: true, type: 'music' },
    gameplay_ambient_loop: { loop: true, type: 'music' },
  },
});
