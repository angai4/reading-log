/*
 * effects.js - little bits of delight: confetti and toast messages.
 */

const CONFETTI_COLOURS = ['#FF6B6B', '#FFC93C', '#1FB5A8', '#8E6CEF', '#4D9DE0', '#F78FB3', '#FF9F43'];

/** Is the user asking their device for less motion? */
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Fire a burst of confetti across the screen for about three seconds.
 * Uses a full-screen canvas that ignores taps, so the app stays usable.
 */
export function confetti() {
  if (prefersReducedMotion()) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  // As a "popover" the canvas joins the browser's top layer, so it shows
  // above any open dialog (call this *after* opening the dialog).
  canvas.setAttribute('popover', 'manual');
  document.body.appendChild(canvas);
  if (canvas.showPopover) canvas.showPopover();
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * ratio;
  canvas.height = window.innerHeight * ratio;
  ctx.scale(ratio, ratio);

  // Each piece starts near the bottom middle and is thrown upwards.
  const pieces = Array.from({ length: 160 }, () => ({
    x: window.innerWidth / 2 + (Math.random() - 0.5) * 80,
    y: window.innerHeight * 0.75,
    vx: (Math.random() - 0.5) * 14,
    vy: -(Math.random() * 14 + 8),
    size: Math.random() * 7 + 5,
    spin: Math.random() * Math.PI,
    spinSpeed: (Math.random() - 0.5) * 0.3,
    colour: CONFETTI_COLOURS[Math.floor(Math.random() * CONFETTI_COLOURS.length)],
  }));

  const start = performance.now();
  const frame = (now) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, elapsed - 2200) / 800);
    pieces.forEach((p) => {
      p.vy += 0.35; // gravity
      p.vx *= 0.99; // air resistance
      p.x += p.vx;
      p.y += p.vy;
      p.spin += p.spinSpeed;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillStyle = p.colour;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    });
    if (elapsed < 3000) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

let toastTimer = null;

/** Show a short message at the bottom of the screen. */
export function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
