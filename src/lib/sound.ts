export function playSuccessCue(volume: number): void {
  if (volume <= 0 || typeof window === 'undefined' || !window.AudioContext) return;

  try {
    const context = new window.AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const level = Math.min(1, Math.max(0, volume)) * 0.18;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, now);
    oscillator.frequency.setValueAtTime(880, now + 0.1);
    oscillator.frequency.setValueAtTime(1046.5, now + 0.2);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.025);
    gain.gain.setValueAtTime(level, now + 0.22);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.45);
    oscillator.addEventListener('ended', () => void context.close(), { once: true });
  } catch (error) {
    console.warn('Sound feedback could not be played.', error);
  }
}
