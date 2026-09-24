/* OUTARCH's notification chimes.

   Synthesised with Web Audio rather than shipped as files: nothing to package,
   nothing the operating system can refuse to play, and each tone is a few
   milliseconds of sine and triangle with a soft attack, so none of them clicks
   or startles. They are short on purpose — a notification should be noticed,
   not jumped at.

   The main process decides whether a notice rings at all (the Sound setting,
   quiet hours, the severity floor, spacing between chimes) and says so on the
   notice; this module only plays what it is told to. It rings for Windows
   toasts too (they are silent), so the chime lands with the notice. */

// [frequency Hz, start offset s, duration s, gain]
const CHIMES = Object.freeze({
  // Something failed: two falling notes, clearly different from the others.
  alert: [[783.99, 0, 0.16, 1], [587.33, 0.15, 0.3, 0.9]],
  // Something needs you: the same note twice, like a gentle knock.
  attention: [[698.46, 0, 0.12, 0.85], [698.46, 0.17, 0.2, 0.85]],
  // Something came up: a rising fifth.
  success: [[659.25, 0, 0.12, 0.8], [987.77, 0.11, 0.26, 0.75]],
  // Something finished: one soft note.
  soft: [[880, 0, 0.24, 0.6]]
});

// 0.16 was heard as too quiet over normal desktop volume. 0.42 is about 2.6x
// louder and still leaves headroom: the loudest overlap (the two notes of
// "alert" with their overtones) peaks just under full scale.
const MASTER_GAIN = 0.42;
const MIN_GAP_MS = 900;
// An idle audio device is released after this long, so an open stream never
// keeps Windows awake; the next chime reopens it.
const IDLE_SUSPEND_MS = 20_000;

let context = null;
let lastPlayedAt = 0;
let idleTimer = null;

function audioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!context || context.state === "closed") context = new AudioContextClass({ latencyHint: "interactive" });
  return context;
}

function releaseWhenIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (context && context.state === "running") void context.suspend().catch(() => {});
  }, IDLE_SUSPEND_MS);
}

/**
 * Build the audio graph before the first notice arrives. Creating it is the
 * slow part (the output device is opened), and doing that inside the first
 * notification is what made the first chime lag behind its toast.
 */
export function primeNotificationSound() {
  try {
    const audio = audioContext();
    if (!audio) return false;
    if (audio.state === "suspended") void audio.resume().catch(() => {});
    releaseWhenIdle();
    return true;
  } catch {
    return false;
  }
}

export function notificationSoundNames() {
  return Object.keys(CHIMES);
}

/**
 * Play one chime. Returns true when it was scheduled. Two notices landing in
 * the same instant still ring once.
 */
export function playNotificationSound(name, { volume = 1, force = false } = {}) {
  const notes = CHIMES[name];
  if (!notes) return false;
  const now = Date.now();
  if (!force && now - lastPlayedAt < MIN_GAP_MS) return false;
  try {
    const audio = audioContext();
    if (!audio) return false;
    lastPlayedAt = now;
    releaseWhenIdle();
    // A suspended device (idle, or not yet allowed to play) is resumed first,
    // and the notes are scheduled from the moment it is running again, so the
    // start of the chime is not lost while the device wakes.
    if (audio.state === "suspended") {
      void audio.resume().then(() => schedule(audio, notes, volume)).catch(() => {});
      return true;
    }
    schedule(audio, notes, volume);
    return true;
  } catch {
    // A notification that cannot ring still shows.
    return false;
  }
}

function schedule(audio, notes, volume) {
  try {
    const start = audio.currentTime + 0.01;
    const master = audio.createGain();
    master.gain.value = MASTER_GAIN * Math.max(0, Math.min(1, volume));
    master.connect(audio.destination);
    for (const [frequency, offset, duration, gain] of notes) {
      // A sine for the note and a quiet triangle an octave up give it a bell's
      // brightness without the harshness of a square wave.
      for (const [type, multiple, level] of [["sine", 1, gain], ["triangle", 2, gain * 0.18]]) {
        const oscillator = audio.createOscillator();
        const envelope = audio.createGain();
        oscillator.type = type;
        oscillator.frequency.value = frequency * multiple;
        const at = start + offset;
        envelope.gain.setValueAtTime(0.0001, at);
        envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), at + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        oscillator.connect(envelope);
        envelope.connect(master);
        oscillator.start(at);
        oscillator.stop(at + duration + 0.05);
      }
    }
    return true;
  } catch {
    // A notification that cannot ring still shows.
    return false;
  }
}
