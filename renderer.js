const TWO_PI = Math.PI * 2;

/**
 * Applies a perspective projection to a world-space point given the camera state.
 * Camera rotation is applied as yaw (Y-axis) then pitch (X-axis).
 *
 * @param {number} wx - world x
 * @param {number} wy - world y
 * @param {number} wz - world z
 * @param {object} camera - { x, y, z, yaw, pitch, fov, screenW, screenH }
 * @returns {{ sx: number, sy: number, scale: number, depth: number } | null}
 *          null if the point is behind the camera
 */
export function projectPoint(wx, wy, wz, camera) {
  // Translate relative to camera position
  const tx = wx - camera.x;
  const ty = wy - camera.y;
  const tz = wz - camera.z;

  // Yaw rotation (around Y axis)
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const rx1 = tx * cosYaw + tz * sinYaw;
  const ry1 = ty;
  const rz1 = -tx * sinYaw + tz * cosYaw;

  // Pitch rotation (around X axis)
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);
  const rx2 = rx1;
  const ry2 = ry1 * cosPitch - rz1 * sinPitch;
  const rz2 = ry1 * sinPitch + rz1 * cosPitch;

  // Depth in camera space (positive = in front of camera)
  const depth = rz2;

  // Clip points behind (or too close to) camera
  if (depth < 1) return null;

  const fov = camera.fov || 600;
  const scale = fov / depth;

  const sx = camera.screenW * 0.5 + rx2 * scale;
  const sy = camera.screenH * 0.5 - ry2 * scale;

  return { sx, sy, scale, depth };
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _canvas = null;
let _offscreen = null;
let _offCtx = null;

/**
 * Initialises the renderer. Must be called once before renderFrame.
 *
 * @param {HTMLCanvasElement} canvas
 */
export function initRenderer(canvas) {
  _canvas = canvas;

  // Create a persistent offscreen canvas for the trail overlay
  _offscreen = document.createElement('canvas');
  _offscreen.width = canvas.width;
  _offscreen.height = canvas.height;
  _offCtx = _offscreen.getContext('2d');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the hex/CSS color string for a particle, falling back to cyan.
 * @param {object} p - particle
 * @returns {string}
 */
function particleColor(p) {
  return p.color || '#00eeff';
}

/**
 * Parses a hex color string (#rrggbb or #rgb) into { r, g, b }.
 * Cached for performance.
 */
const _colorCache = new Map();
function parseHex(hex) {
  if (_colorCache.has(hex)) return _colorCache.get(hex);
  let c = hex.replace('#', '');
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  const result = {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
  _colorCache.set(hex, result);
  return result;
}

/**
 * Draws a single particle using radial gradients for core + glow.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx - screen x
 * @param {number} sy - screen y
 * @param {number} scale - perspective scale factor
 * @param {number} depth - camera-space depth
 * @param {object} p - particle object
 */
function drawParticle(ctx, sx, sy, scale, depth, p) {
  const color = particleColor(p);
  const { r, g, b } = parseHex(color);

  // Depth normalisation: closer = brighter / larger
  // depth is clamped to a reasonable range so nothing blows up
  const depthNorm = Math.max(0, Math.min(1, 1 - (depth - 50) / 2000));

  // Speed-based glow intensity (speed stored on particle, default 0)
  const speed = p.speed || Math.sqrt((p.vx || 0) ** 2 + (p.vy || 0) ** 2 + (p.vz || 0) ** 2);
  const speedNorm = Math.min(1, speed / 8);

  // Core radius: 1-3px, scaled by depth
  const coreRadius = Math.max(0.5, (1 + depthNorm * 2) * Math.min(1.5, scale * 0.4));

  // Glow radius: 6-14px, also depth-influenced
  const glowRadius = Math.max(coreRadius * 1.5, (6 + depthNorm * 8) * Math.min(1, scale * 0.25 + 0.4));

  // Base alpha for glow tied to speed + depth
  const glowAlpha = (0.18 + speedNorm * 0.45) * (0.4 + depthNorm * 0.6);

  // --- Outer glow ---
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowRadius);
  glow.addColorStop(0, `rgba(${r},${g},${b},${(glowAlpha * 0.85).toFixed(3)})`);
  glow.addColorStop(0.4, `rgba(${r},${g},${b},${(glowAlpha * 0.35).toFixed(3)})`);
  glow.addColorStop(1, `rgba(${r},${g},${b},0)`);

  ctx.beginPath();
  ctx.arc(sx, sy, glowRadius, 0, TWO_PI);
  ctx.fillStyle = glow;
  ctx.fill();

  // --- Bright core ---
  const coreAlpha = Math.min(1, 0.7 + depthNorm * 0.3);
  const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, coreRadius);
  core.addColorStop(0, `rgba(255,255,255,${coreAlpha.toFixed(3)})`);
  core.addColorStop(0.5, `rgba(${r},${g},${b},${(coreAlpha * 0.85).toFixed(3)})`);
  core.addColorStop(1, `rgba(${r},${g},${b},0)`);

  ctx.beginPath();
  ctx.arc(sx, sy, coreRadius, 0, TWO_PI);
  ctx.fillStyle = core;
  ctx.fill();
}

/**
 * Draws an attractor as an animated pulsing ring.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} sx
 * @param {number} sy
 * @param {number} scale
 * @param {object} att - attractor object { strength, color? }
 * @param {number} pulseT - 0-1 cycling value
 */
function drawAttractor(ctx, sx, sy, scale, att, pulseT) {
  const baseRadius = Math.max(6, Math.min(40, (att.strength || 50) * 0.18) * (0.4 + scale * 0.6));
  const color = att.color || '#00eeff';
  const { r, g, b } = parseHex(color);

  // Two rings: a stable inner ring + an expanding pulse ring
  const pulseEase = pulseT < 0.5 ? 2 * pulseT * pulseT : -1 + (4 - 2 * pulseT) * pulseT;

  // --- Pulsing expanding ring ---
  const pulseRadius = baseRadius * (1 + pulseEase * 1.4);
  const pulseAlpha = (1 - pulseEase) * 0.7;

  ctx.beginPath();
  ctx.arc(sx, sy, pulseRadius, 0, TWO_PI);
  ctx.strokeStyle = `rgba(${r},${g},${b},${pulseAlpha.toFixed(3)})`;
  ctx.lineWidth = Math.max(0.5, 1.5 * (1 - pulseEase * 0.6));
  ctx.stroke();

  // --- Static core ring ---
  ctx.beginPath();
  ctx.arc(sx, sy, baseRadius, 0, TWO_PI);
  ctx.strokeStyle = `rgba(${r},${g},${b},0.85)`;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // --- Inner glow fill ---
  const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, baseRadius);
  grd.addColorStop(0, `rgba(${r},${g},${b},0.18)`);
  grd.addColorStop(0.6, `rgba(${r},${g},${b},0.06)`);
  grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.beginPath();
  ctx.arc(sx, sy, baseRadius, 0, TWO_PI);
  ctx.fillStyle = grd;
  ctx.fill();

  // --- Secondary secondary outer pulse halo ---
  const haloRadius = baseRadius * (1.6 + pulseEase * 0.8);
  const haloAlpha = (0.3 - pulseEase * 0.28) * 0.6;
  if (haloAlpha > 0.01) {
    ctx.beginPath();
    ctx.arc(sx, sy, haloRadius, 0, TWO_PI);
    ctx.strokeStyle = `rgba(${r},${g},${b},${haloAlpha.toFixed(3)})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

/**
 * Renders a single frame.
 *
 * @param {CanvasRenderingContext2D} ctx    - 2D context of the main canvas
 * @param {Array}  particles               - array of particle objects
 * @param {Array}  attractors              - array of attractor objects
 * @param {object} camera                  - camera state { x,y,z, yaw,pitch, fov, screenW, screenH }
 * @param {number} attractorPulseT         - 0-1 cycling value for attractor pulse animation
 */
export function renderFrame(ctx, particles, attractors, camera, attractorPulseT) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;

  // Sync offscreen canvas size if needed
  if (_offscreen && (_offscreen.width !== W || _offscreen.height !== H)) {
    _offscreen.width = W;
    _offscreen.height = H;
  }

  // ---------------------------------------------------------------------------
  // 1. Motion trail: semi-transparent black fill (alpha 0.12)
  // ---------------------------------------------------------------------------
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.fillRect(0, 0, W, H);

  // ---------------------------------------------------------------------------
  // 2. Project all particles; collect visible ones
  // ---------------------------------------------------------------------------
  const projected = [];

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const proj = projectPoint(p.x, p.y, p.z, camera);
    if (proj === null) continue;

    // Cull off-screen particles with a generous margin (avoid popping)
    const margin = 80;
    if (proj.sx < -margin || proj.sx > W + margin || proj.sy < -margin || proj.sy > H + margin) {
      continue;
    }

    projected.push({ p, proj });
  }

  // ---------------------------------------------------------------------------
  // 3. Sort by depth descending (furthest first = painter's algorithm)
  // ---------------------------------------------------------------------------
  projected.sort((a, b) => b.proj.depth - a.proj.depth);

  // ---------------------------------------------------------------------------
  // 4. Draw particles
  // ---------------------------------------------------------------------------
  ctx.save();
  for (let i = 0; i < projected.length; i++) {
    const { p, proj } = projected[i];
    drawParticle(ctx, proj.sx, proj.sy, proj.scale, proj.depth, p);
  }
  ctx.restore();

  // ---------------------------------------------------------------------------
  // 5. Draw attractors
  // ---------------------------------------------------------------------------
  if (attractors && attractors.length > 0) {
    ctx.save();
    for (let i = 0; i < attractors.length; i++) {
      const att = attractors[i];
      const proj = projectPoint(att.x, att.y, att.z, camera);
      if (proj === null) continue;

      drawAttractor(ctx, proj.sx, proj.sy, proj.scale, att, attractorPulseT);
    }
    ctx.restore();
  }
}