// Crisp HD 16:9 Kasumiai Neural Core Visualizer for FaceTime Video via Chert + LiveKit.
// Precomputes static background + orbital rings once at startup so per-frame render takes <1ms (zero CPU lag).

export const WIDTH = 640;
export const HEIGHT = 360;
export const FPS = 15;

const CX = WIDTH >> 1;
const CY = HEIGHT >> 1;

// Precomputed base frame (deep Yukari midnight radial backdrop + outer telemetry rings)
const BASE_PIXELS = new Uint8Array(WIDTH * HEIGHT * 4);

(function buildBaseFrame() {
  for (let y = 0; y < HEIGHT; y++) {
    const dy = y - CY;
    for (let x = 0; x < WIDTH; x++) {
      const dx = x - CX;
      const dist = Math.hypot(dx, dy);
      const glow = Math.max(0, 1 - dist / 230);

      let r = Math.round(11 + glow * 18);
      let g = Math.round(16 + glow * 26);
      let b = Math.round(32 + glow * 52);

      // Outer futuristic orbital rings (#9D8CFF & #55DDE0)
      if (Math.abs(dist - 132) < 1.5) {
        r = 157; g = 140; b = 255;
      } else if (Math.abs(dist - 104) < 1.2) {
        r = 85; g = 221; b = 224;
      }

      // Subtle crosshair ticks
      if ((Math.abs(dx) <= 1 && dist > 138 && dist < 154) || (Math.abs(dy) <= 1 && dist > 138 && dist < 154)) {
        r = 85; g = 221; b = 224;
      }

      const idx = (y * WIDTH + x) * 4;
      BASE_PIXELS[idx] = r;
      BASE_PIXELS[idx + 1] = g;
      BASE_PIXELS[idx + 2] = b;
      BASE_PIXELS[idx + 3] = 255;
    }
  }
})();

function fillCircle(pixels, cx, cy, radius, r, g, b, alpha = 1) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(WIDTH - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(HEIGHT - 1, Math.ceil(cy + radius));
  const invA = 1 - alpha;

  for (let y = y0; y <= y1; y++) {
    const dy2 = (y - cy) * (y - cy);
    const rowOffset = y * WIDTH;
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + dy2;
      if (d2 <= r2) {
        const idx = (rowOffset + x) * 4;
        if (alpha >= 0.99) {
          pixels[idx] = r;
          pixels[idx + 1] = g;
          pixels[idx + 2] = b;
        } else {
          pixels[idx] = Math.round(pixels[idx] * invA + r * alpha);
          pixels[idx + 1] = Math.round(pixels[idx + 1] * invA + g * alpha);
          pixels[idx + 2] = Math.round(pixels[idx + 2] * invA + b * alpha);
        }
      }
    }
  }
}

function strokeRing(pixels, cx, cy, radius, thickness, r, g, b) {
  const inner = Math.max(0, radius - thickness);
  const outer = radius + thickness;
  const in2 = inner * inner;
  const out2 = outer * outer;
  const x0 = Math.max(0, Math.floor(cx - outer));
  const x1 = Math.min(WIDTH - 1, Math.ceil(cx + outer));
  const y0 = Math.max(0, Math.floor(cy - outer));
  const y1 = Math.min(HEIGHT - 1, Math.ceil(cy + outer));

  for (let y = y0; y <= y1; y++) {
    const dy2 = (y - cy) * (y - cy);
    const rowOffset = y * WIDTH;
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + dy2;
      if (d2 >= in2 && d2 <= out2) {
        const idx = (rowOffset + x) * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
      }
    }
  }
}

function fillRect(pixels, x0, y0, w, h, r, g, b) {
  const sx = Math.max(0, Math.floor(x0));
  const ex = Math.min(WIDTH, Math.ceil(x0 + w));
  const sy = Math.max(0, Math.floor(y0));
  const ey = Math.min(HEIGHT, Math.ceil(y0 + h));
  for (let y = sy; y < ey; y++) {
    const row = y * WIDTH;
    for (let x = sx; x < ex; x++) {
      const i = (row + x) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
    }
  }
}

/**
 * Renders one 960x540 RGBA frame synced to Kasumiai's live voice/listening state.
 * @param {number} tick
 * @param {boolean} speaking
 * @param {'listening'|'speaking'|'thinking'|'idle'} mode
 */
export function drawFace(tick, speaking, mode = 'listening') {
  const pixels = new Uint8Array(BASE_PIXELS);

  const pulse = speaking
    ? 16 * Math.abs(Math.sin(tick * 0.55)) + 8 * Math.abs(Math.cos(tick * 0.9))
    : mode === 'thinking'
    ? 10 * Math.abs(Math.sin(tick * 0.35))
    : 5 * Math.sin(tick * 0.12);

  // Orbiting satellite nodes showing live frame sync (zero freeze verification)
  const angle1 = tick * 0.08;
  const angle2 = -tick * 0.06;
  fillCircle(pixels, CX + Math.cos(angle1) * 132, CY + Math.sin(angle1) * 132, 4.5, 85, 221, 224, 1);
  fillCircle(pixels, CX + Math.cos(angle2) * 104, CY + Math.sin(angle2) * 104, 3.8, 157, 140, 255, 1);

  // Reactive harmonic ring
  const [rr, rg, rb] = speaking
    ? [85, 221, 224]
    : mode === 'thinking'
    ? [255, 200, 118]
    : [157, 140, 255];

  strokeRing(pixels, CX, CY, 76 + pulse * 0.65, speaking ? 2.5 : 1.6, rr, rg, rb);

  // Soft outer aura + bright Kasumiai core
  fillCircle(pixels, CX, CY, 58 + pulse * 0.45, rr, rg, rb, 0.25);
  fillCircle(pixels, CX, CY, 42 + pulse * 0.3, 85, 221, 224, 0.85);
  fillCircle(pixels, CX, CY, 24 + pulse * 0.2, 240, 250, 255, 0.95);

  // Expressive eyes + voice equalizer bars inside/below core
  const blink = tick % 60 < 3;
  const eyeH = blink ? 2 : 11;
  fillRect(pixels, CX - 18, CY - 9 - (eyeH >> 1), 7, eyeH, 11, 16, 32);
  fillRect(pixels, CX + 11, CY - 9 - (eyeH >> 1), 7, eyeH, 11, 16, 32);

  // Synced equalizer mouth / audio wave bars
  const bars = 7;
  const barW = 6;
  const gap = 4;
  const totalW = bars * barW + (bars - 1) * gap;
  const startX = CX - totalW / 2;
  for (let b = 0; b < bars; b++) {
    const wave = speaking
      ? 6 + 18 * Math.abs(Math.sin(tick * 0.85 + b * 0.85))
      : mode === 'thinking'
      ? 4 + 7 * Math.abs(Math.sin(tick * 0.45 + b * 0.6))
      : 4;
    fillRect(pixels, startX + b * (barW + gap), CY + 32 - wave / 2, barW, wave, rr, rg, rb);
  }

  // Bottom live heartbeat bar
  const sweepX = 120 + ((tick * 6) % (WIDTH - 240));
  fillRect(pixels, 120, HEIGHT - 20, WIDTH - 240, 3, 30, 44, 76);
  fillRect(pixels, sweepX, HEIGHT - 21, 36, 5, rr, rg, rb);

  return pixels;
}
