/**
 * The bell's chime: two soft notes made with the Web Audio API (no sound file to load).
 *
 * Browsers only allow sound after the person has clicked or typed on the page, so the audio is "unlocked" on the first click or key press.
 * Before that a chime is silently skipped (never an error). The person can mute it from the bell; the choice is remembered in this
 * browser. With several tabs open, each new notification chimes once, not once per tab (the last chimed id is shared through storage).
 */

const MUTE_KEY = 'alphacv.notifications.muted';
const LAST_CHIMED_KEY = 'alphacv.notifications.lastChimed';

let ctx: AudioContext | null = null;
let unlockedListeners = false;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** Call once (the bell does): the first click or key press on the page allows sound from then on. */
export function unlockSoundOnFirstGesture(): void {
  if (typeof window === 'undefined' || unlockedListeners) return;
  unlockedListeners = true;
  const unlock = () => {
    const c = context();
    if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, '1');
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    /* private window: the choice lasts for this page only */
  }
}

/** True once per notification id across this browser's tabs: the first tab to see it claims it. */
export function claimChime(id: string): boolean {
  try {
    if (localStorage.getItem(LAST_CHIMED_KEY) === id) return false;
    localStorage.setItem(LAST_CHIMED_KEY, id);
    return true;
  } catch {
    return true;
  }
}

/** Two short rising notes, quiet. Does nothing when muted, when sound is not allowed yet, or when the browser has no audio. */
export function playChime(): void {
  if (isMuted()) return;
  const c = context();
  if (!c || c.state !== 'running') return;
  try {
    const now = c.currentTime;
    const gain = c.createGain();
    gain.connect(c.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    [[880, 0], [1320, 0.12]].forEach(([freq, at]) => {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + at);
      osc.connect(gain);
      osc.start(now + at);
      osc.stop(now + at + 0.4);
    });
  } catch {
    /* sound is a nicety: never an error */
  }
}
