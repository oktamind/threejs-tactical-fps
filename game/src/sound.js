// Sound: every effect is synthesised with WebAudio, so the game ships no
// audio files and makes no network request. The context is created on the
// first user gesture (a click or a key), M toggles mute, and every call is
// guarded so a browser without audio never breaks the game.
export function createSoundEffects() {
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;

  function unlock() {
    try {
      if (!context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        context = new AudioContext();
        master = context.createGain();
        master.gain.value = 0.35;
        master.connect(context.destination);
        const length = context.sampleRate;
        noiseBuffer = context.createBuffer(1, length, context.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      }
      if (context.state === 'suspended') void context.resume();
    } catch {
      context = null;
    }
  }

  function tone(frequency, duration, type = 'sine', volume = 0.5, slideTo = null, delay = 0) {
    if (!context || !master || muted) return;
    try {
      const start = context.currentTime + delay;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, start);
      if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), start + duration);
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    } catch {
      // Audio is decoration; never let it break the game.
    }
  }

  function noise(duration, volume = 0.5, cutoff = 4000, delay = 0) {
    if (!context || !master || !noiseBuffer || muted) return;
    try {
      const start = context.currentTime + delay;
      const source = context.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const gain = context.createGain();
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(start);
      source.stop(start + duration + 0.02);
    } catch {
      // Audio is decoration; never let it break the game.
    }
  }

  const PITCH = { rifle: 190, smg: 240, pistol: 140 };

  return {
    unlock,
    toggleMute() {
      muted = !muted;
      return muted;
    },
    isMuted() {
      return muted;
    },
    shoot(weaponId) {
      noise(0.08, 0.5, 3200);
      tone(PITCH[weaponId] ?? 190, 0.07, 'square', 0.22, 90);
    },
    hit(killed) {
      tone(1200, 0.05, 'sine', 0.35);
      if (killed) tone(1600, 0.09, 'sine', 0.35, null, 0.06);
    },
    explosion() {
      noise(0.6, 0.9, 900);
      tone(70, 0.5, 'sine', 0.7, 30);
    },
    plantBeep() {
      tone(880, 0.08, 'square', 0.18);
    },
    roundWon() {
      tone(523, 0.12, 'triangle', 0.4);
      tone(659, 0.12, 'triangle', 0.4, null, 0.1);
      tone(784, 0.22, 'triangle', 0.4, null, 0.2);
    },
    roundLost() {
      tone(392, 0.14, 'triangle', 0.4);
      tone(330, 0.14, 'triangle', 0.4, null, 0.12);
      tone(262, 0.26, 'triangle', 0.4, null, 0.24);
    },
    buy() {
      tone(700, 0.06, 'sine', 0.3);
      tone(1050, 0.08, 'sine', 0.3, null, 0.06);
    },
    uiClick() {
      tone(700, 0.05, 'sine', 0.25);
    },
  };
}
