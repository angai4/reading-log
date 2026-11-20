/*
 * wheel.js - draws and spins the reading wheel on a <canvas>.
 *
 * Usage:
 *   const wheel = new Wheel(canvas, pointerElement);
 *   wheel.setSlots([{ label, colour, textColour }, ...]);
 *   const index = await wheel.spin();   // resolves with the winning slot
 *
 * How the spin works: the winning slot is chosen at random *first*, then
 * the wheel is animated so that slot ends up under the pointer at the top.
 * Every slot is the same size, so every slot has an equal chance.
 */

const TAU = Math.PI * 2;

/** A fair random number in [0, 1) using the browser's crypto generator. */
function random() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

/** Ease-out cubic: fast at first, gently slowing to a stop. */
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export class Wheel {
  constructor(canvas, pointer) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pointer = pointer;
    this.slots = [];
    this.rotation = 0; // radians, clockwise
    this.spinning = false;

    // Redraw crisply whenever the canvas changes size (e.g. phone rotated).
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
  }

  /** Match the canvas's internal pixels to its on-screen size. */
  resize() {
    const ratio = window.devicePixelRatio || 1;
    const size = this.canvas.clientWidth;
    if (!size) return;
    this.canvas.width = Math.round(size * ratio);
    this.canvas.height = Math.round(size * ratio);
    this.draw();
  }

  /** Replace the slots and redraw. */
  setSlots(slots) {
    this.slots = slots;
    this.draw();
  }

  /** Which slot is currently under the pointer at the top. */
  slotAtPointer() {
    const n = this.slots.length;
    if (!n) return -1;
    const seg = TAU / n;
    // The pointer sits at angle 0 (top). Slot i starts at rotation + i*seg.
    const angle = (((-this.rotation) % TAU) + TAU) % TAU;
    return Math.floor(angle / seg) % n;
  }

  /** Paint the wheel at the current rotation. */
  draw() {
    const { ctx, canvas, slots } = this;
    const w = canvas.width;
    if (!w) return;
    const r = w / 2;
    const ratio = window.devicePixelRatio || 1;
    const styles = getComputedStyle(document.documentElement);
    const rim = styles.getPropertyValue('--wheel-rim').trim() || '#2D2A4A';
    const hub = styles.getPropertyValue('--card').trim() || '#fff';

    ctx.clearRect(0, 0, w, w);
    ctx.save();
    ctx.translate(r, r);

    // Outer rim.
    ctx.beginPath();
    ctx.arc(0, 0, r - 1, 0, TAU);
    ctx.fillStyle = rim;
    ctx.fill();

    const inner = r - 8 * ratio;

    if (!slots.length) {
      ctx.beginPath();
      ctx.arc(0, 0, inner, 0, TAU);
      ctx.fillStyle = hub;
      ctx.fill();
      ctx.restore();
      return;
    }

    const n = slots.length;
    const seg = TAU / n;
    // Canvas angle 0 points right; -PI/2 points up to the pointer.
    const base = -Math.PI / 2 + this.rotation;

    slots.forEach((slot, i) => {
      const start = base + i * seg;
      const end = start + seg;

      // The slice itself.
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, inner, start, end);
      ctx.closePath();
      ctx.fillStyle = slot.colour;
      ctx.fill();
      // A thin gap between slices.
      ctx.lineWidth = 2 * ratio;
      ctx.strokeStyle = rim;
      ctx.stroke();

      // The label, written outwards along the middle of the slice.
      ctx.save();
      ctx.rotate(start + seg / 2);
      const fontSize = Math.max(11, Math.min(17, (inner * seg) / 2.4 / ratio)) * ratio;
      ctx.font = `700 ${fontSize}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
      ctx.fillStyle = slot.textColour;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const maxWidth = inner * 0.66;
      ctx.fillText(fitText(ctx, slot.label, maxWidth), inner - 12 * ratio, 0);
      ctx.restore();
    });

    // Centre hub (the spin button sits on top of this in the page).
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.2, 0, TAU);
    ctx.fillStyle = rim;
    ctx.fill();

    ctx.restore();
  }

  /**
   * Spin the wheel. Resolves with the index of the winning slot.
   * @param {boolean} reduceMotion  use a short, gentle spin
   */
  spin(reduceMotion = false) {
    const n = this.slots.length;
    if (!n || this.spinning) return Promise.resolve(-1);
    this.spinning = true;

    const seg = TAU / n;
    const winner = Math.floor(random() * n);
    // Land somewhere inside the slot, not right on a dividing line.
    const offset = 0.15 + random() * 0.7;

    // We need the pointer angle (-rotation) to equal (winner + offset) * seg.
    const targetMod = (((-(winner + offset) * seg) % TAU) + TAU) % TAU;
    const currentMod = ((this.rotation % TAU) + TAU) % TAU;
    let delta = targetMod - currentMod;
    if (delta < 0) delta += TAU;
    const turns = reduceMotion ? 1 : 5 + Math.floor(random() * 3);
    const startRotation = this.rotation;
    const totalDelta = delta + turns * TAU;
    const duration = reduceMotion ? 1200 : 4200 + random() * 1200;

    return new Promise((resolve) => {
      const startTime = performance.now();
      let lastSlot = this.slotAtPointer();

      const frame = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        this.rotation = startRotation + totalDelta * easeOut(t);
        this.draw();

        // Give the pointer a little "tick" as each slot passes it.
        const current = this.slotAtPointer();
        if (current !== lastSlot) {
          lastSlot = current;
          this.tick();
        }

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          this.rotation %= TAU;
          this.spinning = false;
          resolve(winner);
        }
      };
      requestAnimationFrame(frame);
    });
  }

  /** Wobble the pointer element briefly. */
  tick() {
    if (!this.pointer || !this.pointer.animate) return;
    this.pointer.animate(
      [{ transform: 'translateX(-50%) rotate(0deg)' }, { transform: 'translateX(-50%) rotate(-14deg)' }, { transform: 'translateX(-50%) rotate(0deg)' }],
      { duration: 120, easing: 'ease-out' }
    );
  }
}

/** Shorten text with an ellipsis until it fits in maxWidth pixels. */
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed.trimEnd()}…`;
}

/**
 * Pick readable text (dark or white) for a given background colour,
 * using WCAG relative luminance.
 */
export function textOn(hex) {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const contrastWhite = 1.05 / (lum + 0.05);
  const contrastDark = (lum + 0.05) / (0.027 + 0.05); // luminance of #2D2A4A
  return contrastWhite >= contrastDark ? '#FFFFFF' : '#2D2A4A';
}
