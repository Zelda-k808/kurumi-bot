/* ───────────── Audio Filter Presets ───────────── */

/**
 * Pre-built filter configurations for Lavalink.
 * Each preset returns the `filters` payload to send to the player.
 */

const PRESETS = {
  bassboost: {
    label: "🔊 Bass Boost",
    description: "Heavy low-frequency boost",
    filters: {
      equalizer: [
        { band: 0, gain: 0.6 },
        { band: 1, gain: 0.5 },
        { band: 2, gain: 0.35 },
        { band: 3, gain: 0.2 },
        { band: 4, gain: 0.1 },
        { band: 5, gain: 0.0 },
      ],
    },
  },

  nightcore: {
    label: "🌙 Nightcore",
    description: "Sped up + higher pitch",
    filters: {
      timescale: { speed: 1.25, pitch: 1.3, rate: 1.0 },
    },
  },

  vaporwave: {
    label: "🌊 Vaporwave",
    description: "Slowed + lower pitch",
    filters: {
      timescale: { speed: 0.85, pitch: 0.8, rate: 1.0 },
    },
  },

  "8d": {
    label: "🎧 8D Audio",
    description: "Rotating stereo panning",
    filters: {
      rotation: { rotationHz: 0.2 },
    },
  },

  karaoke: {
    label: "🎤 Karaoke",
    description: "Reduces vocal frequencies",
    filters: {
      karaoke: {
        level: 1.0,
        monoLevel: 1.0,
        filterBand: 220.0,
        filterWidth: 100.0,
      },
    },
  },

  tremolo: {
    label: "〰️ Tremolo",
    description: "Volume oscillation effect",
    filters: {
      tremolo: { frequency: 5.0, depth: 0.5 },
    },
  },

  vibrato: {
    label: "🎵 Vibrato",
    description: "Pitch oscillation effect",
    filters: {
      vibrato: { frequency: 5.0, depth: 0.5 },
    },
  },

  lowpass: {
    label: "🔇 Low Pass",
    description: "Muffled / underwater effect",
    filters: {
      lowPass: { smoothing: 20.0 },
    },
  },

  pop: {
    label: "🎶 Pop",
    description: "Enhanced mids and clarity",
    filters: {
      equalizer: [
        { band: 0, gain: -0.1 },
        { band: 1, gain: 0.0 },
        { band: 2, gain: 0.15 },
        { band: 3, gain: 0.2 },
        { band: 4, gain: 0.25 },
        { band: 5, gain: 0.25 },
        { band: 6, gain: 0.2 },
        { band: 7, gain: 0.1 },
        { band: 8, gain: 0.0 },
        { band: 9, gain: -0.1 },
      ],
    },
  },

  clear: {
    label: "✨ Clear",
    description: "Reset all filters",
    filters: {},
  },
};

/**
 * Get a filter preset by name.
 * @param {string} name
 * @returns {{ label: string, description: string, filters: object } | null}
 */
function getPreset(name) {
  return PRESETS[name.toLowerCase()] || null;
}

/**
 * Get all available preset names.
 * @returns {string[]}
 */
function getPresetNames() {
  return Object.keys(PRESETS);
}

/**
 * Get all presets with labels for display.
 * @returns {{ name: string, label: string, description: string }[]}
 */
function listPresets() {
  return Object.entries(PRESETS).map(([name, p]) => ({
    name,
    label: p.label,
    description: p.description,
  }));
}

module.exports = { getPreset, getPresetNames, listPresets, PRESETS };
