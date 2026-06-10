import { initParticles, updatePhysics } from './particles.js';
import { renderFrame } from './renderer.js';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const MAX_ATTRACTORS = 8;
const INERTIA_DECAY = 0.95;
const CAMERA_LERP = 0.08;
const HUD_HIDE_DELAY = 4000;
const HUD_UPDATE_INTERVAL = 500;
const TRANSITION_DURATION = 1500; // ms
const MAX_DT = 0.032;

// ─────────────────────────────────────────────
// Canvas setup
// ─────────────────────────────────────────────
const canvas = document.getElementById('cosmos-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.scale(dpr, dpr);
}
resizeCanvas();

// ─────────────────────────────────────────────
// Seed utilities
// ─────────────────────────────────────────────
function generateSeed() {
  return (Math.random() * 0xFFFFFFFF) >>> 0;
}

function seedFromHash() {
  const hash = window.location.hash.slice(1);
  if (hash) {
    const n = parseInt(hash, 16);
    if (!isNaN(n)) return n >>> 0;
  }
  return null;
}

function writeSeedToHash(seed) {
  history.replaceState(null, '', '#' + seed.toString(16).padStart(8, '0'));
}

// ─────────────────────────────────────────────
// Camera state
// ─────────────────────────────────────────────
const camera = {
  x: 0,
  y: 0,
  z: 800,
  targetZ: 800,
  yaw: 0,
  pitch: 0,
  yawVel: 0,
  pitchVel: 0,
  fov: 600,
  screenW: window.innerWidth,
  screenH: window.innerHeight,
};

// ─────────────────────────────────────────────
// Attractors
// ─────────────────────────────────────────────
let attractors = [];
let attractorPulseT = 0;

// ─────────────────────────────────────────────
// Particle state
// ─────────────────────────────────────────────
let particles = [];
let currentSeed = 0;
let transitionParticles = null; // old particle set during transition
let transitionStart = 0;
let inTransition = false;

// ─────────────────────────────────────────────
// HUD state
// ─────────────────────────────────────────────
const hud = document.getElementById('hud');
const hudFps = document.getElementById('hud-fps');
const hudAttractors = document.getElementById('hud-attractors');
const hudSeed = document.getElementById('hud-seed');
let hudVisible = true;
let hudHideTimer = null;
let lastHudUpdate = 0;
let frameCount = 0;
let fpsAccum = 0;

function showHud() {
  if (!hudVisible) {
    hudVisible = true;
    if (hud) hud.classList.remove('hud-hidden');
  }
  clearTimeout(hudHideTimer);
  hudHideTimer = setTimeout(hideHud, HUD_HIDE_DELAY);
}

function hideHud() {
  hudVisible = false;
  if (hud) hud.classList.add('hud-hidden');
}

function updateHud(now) {
  if (now - lastHudUpdate < HUD_UPDATE_INTERVAL) return;
  const elapsed = (now - lastHudUpdate) / 1000;
  const fps = elapsed > 0 ? Math.round(frameCount / elapsed) : 0;
  frameCount = 0;
  lastHudUpdate = now;
  if (hudFps) hudFps.textContent = fps;
  if (hudAttractors) hudAttractors.textContent = attractors.length;
  if (hudSeed) hudSeed.textContent = currentSeed.toString(16).padStart(8, '0');
}

// ─────────────────────────────────────────────
// Unproject 2D → 3D (place attractor in world space)
// ─────────────────────────────────────────────
function unprojectToWorld(screenX, screenY, depth) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const fov = camera.fov;

  // Normalize screen coords to NDC centered at origin
  const ndcX = (screenX - W / 2) / fov;
  const ndcY = (screenY - H / 2) / fov;

  // Camera-space ray direction at given depth
  const cz = depth;
  const cx = ndcX * cz;
  const cy = ndcY * cz;

  // Undo pitch (rotate around X axis by -pitch)
  const cosPitch = Math.cos(-camera.pitch);
  const sinPitch = Math.sin(-camera.pitch);
  const rx = cx;
  const ry = cosPitch * cy - sinPitch * cz;
  const rz = sinPitch * cy + cosPitch * cz;

  // Undo yaw (rotate around Y axis by -yaw)
  const cosYaw = Math.cos(-camera.yaw);
  const sinYaw = Math.sin(-camera.yaw);
  const wx = cosYaw * rx + sinYaw * rz;
  const wy = ry;
  const wz = -sinYaw * rx + cosYaw * rz;

  return { x: wx, y: wy, z: wz };
}

function addAttractor(screenX, screenY) {
  const worldPos = unprojectToWorld(screenX, screenY, camera.z * 0.6);
  const attractor = {
    x: worldPos.x,
    y: worldPos.y,
    z: worldPos.z,
    strength: 180 + Math.random() * 120,
    born: performance.now(),
    id: Math.random(),
  };
  attractors.push(attractor);
  if (attractors.length > MAX_ATTRACTORS) {
    attractors.shift(); // remove oldest
  }
}

// ─────────────────────────────────────────────
// Input: drag-orbit
// ─────────────────────────────────────────────
let isDragging = false;
let lastPointer = { x: 0, y: 0 };
let lastPointerTime = 0;
let pointerDelta = { x: 0, y: 0 };

// Touch pinch
let lastPinchDist = null;

function getPointerPos(e) {
  if (e.touches) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

function getPinchDist(e) {
  if (e.touches && e.touches.length >= 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  return null;
}

let clickTimer = null;
let pointerMoved = false;

canvas.addEventListener('mousedown', onPointerDown, { passive: false });
canvas.addEventListener('touchstart', onPointerDown, { passive: false });
canvas.addEventListener('mousemove', onPointerMove, { passive: false });
canvas.addEventListener('touchmove', onPointerMove, { passive: false });
canvas.addEventListener('mouseup', onPointerUp, { passive: false });
canvas.addEventListener('touchend', onPointerUp, { passive: false });
canvas.addEventListener('wheel', onWheel, { passive: false });

function onPointerDown(e) {
  e.preventDefault();
  showHud();

  // Handle pinch
  if (e.touches && e.touches.length >= 2) {
    lastPinchDist = getPinchDist(e);
    isDragging = false;
    return;
  }

  isDragging = true;
  pointerMoved = false;
  const pos = getPointerPos(e);
  lastPointer = { ...pos };
  lastPointerTime = performance.now();
  pointerDelta = { x: 0, y: 0 };
}

function onPointerMove(e) {
  e.preventDefault();
  showHud();

  // Pinch zoom
  if (e.touches && e.touches.length >= 2) {
    const dist = getPinchDist(e);
    if (lastPinchDist !== null) {
      const delta = lastPinchDist - dist;
      camera.targetZ = Math.max(200, Math.min(3000, camera.targetZ + delta * 3));
    }
    lastPinchDist = dist;
    return;
  }

  if (!isDragging) return;

  const pos = getPointerPos(e);
  const now = performance.now();
  const dt = Math.max(1, now - lastPointerTime);

  const dx = pos.x - lastPointer.x;
  const dy = pos.y - lastPointer.y;

  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pointerMoved = true;

  const sensitivity = 0.004;
  camera.yaw += dx * sensitivity;
  camera.pitch += dy * sensitivity;
  camera.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camera.pitch));

  camera.yawVel = (dx / dt) * 16;
  camera.pitchVel = (dy / dt) * 16;

  pointerDelta = { x: dx, y: dy };
  lastPointer = { ...pos };
  lastPointerTime = now;
}

function onPointerUp(e) {
  e.preventDefault();
  lastPinchDist = null;

  if (isDragging && !pointerMoved) {
    // Treat as a click → place attractor
    const pos = getPointerPos(e);
    addAttractor(pos.x, pos.y);
  }

  // If we barely moved, kill inertia
  if (!pointerMoved) {
    camera.yawVel = 0;
    camera.pitchVel = 0;
  }

  isDragging = false;
}

function onWheel(e) {
  e.preventDefault();
  showHud();
  const delta = e.deltaY || e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY;
  camera.targetZ = Math.max(200, Math.min(3000, camera.targetZ + delta * 0.8));
}

// Keyboard inactivity tracking
window.addEventListener('keydown', showHud);
window.addEventListener('touchstart', showHud, { passive: true });
window.addEventListener('mousemove', showHud);

// ─────────────────────────────────────────────
// New Universe
// ─────────────────────────────────────────────
const newUniverseBtn = document.getElementById('btn-new-universe');
if (newUniverseBtn) {
  newUniverseBtn.addEventListener('click', () => {
    triggerNewUniverse();
  });
}

function triggerNewUniverse() {
  const newSeed = generateSeed();
  currentSeed = newSeed;
  writeSeedToHash(newSeed);

  // Save old particles for transition
  transitionParticles = particles.map(p => ({ ...p }));
  transitionStart = performance.now();
  inTransition = true;

  // Generate new particles
  particles = initParticles(newSeed, window.innerWidth, window.innerHeight);
  attractors = [];
  attractorPulseT = 0;
}

// ─────────────────────────────────────────────
// Share
// ─────────────────────────────────────────────
const shareBtn = document.getElementById('btn-share');
if (shareBtn) {
  shareBtn.addEventListener('click', async () => {
    const url = window.location.origin + window.location.pathname + '#' + currentSeed.toString(16).padStart(8, '0');
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = 'Copied!';
      setTimeout(() => { shareBtn.textContent = 'Share'; }, 2000);
    } catch {
      prompt('Copy this URL:', url);
    }
  });
}

// ─────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────
let lastTime = 0;

function loop(now) {
  requestAnimationFrame(loop);

  const rawDt = (now - lastTime) / 1000;
  lastTime = now;
  const dt = Math.min(rawDt, MAX_DT);

  // Skip first frame (dt would be huge)
  if (rawDt <= 0 || rawDt > 0.5) return;

  frameCount++;
  fpsAccum += dt;

  // ── Camera lerp & inertia ──
  camera.z += (camera.targetZ - camera.z) * CAMERA_LERP;
  camera.fov = camera.z * 0.75;

  if (!isDragging) {
    camera.yaw += camera.yawVel * dt;
    camera.pitch += camera.pitchVel * dt;
    camera.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camera.pitch));
    camera.yawVel *= INERTIA_DECAY;
    camera.pitchVel *= INERTIA_DECAY;
    if (Math.abs(camera.yawVel) < 0.001) camera.yawVel = 0;
    if (Math.abs(camera.pitchVel) < 0.001) camera.pitchVel = 0;
  }

  camera.screenW = window.innerWidth;
  camera.screenH = window.innerHeight;

  // ── Transition blend ──
  let blendAlpha = 1;
  if (inTransition) {
    const elapsed = now - transitionStart;
    blendAlpha = elapsed / TRANSITION_DURATION;
    if (blendAlpha >= 1) {
      blendAlpha = 1;
      inTransition = false;
      transitionParticles = null;
    } else {
      // Lerp particle positions from old → new
      const t = blendAlpha;
      for (let i = 0; i < particles.length; i++) {
        const old = transitionParticles[i];
        if (!old) continue;
        particles[i].x = old.x + (particles[i].x - old.x) * t;
        particles[i].y = old.y + (particles[i].y - old.y) * t;
        particles[i].z = old.z + (particles[i].z - old.z) * t;
      }
    }
  }

  // ── Physics ──
  updatePhysics(particles, attractors, dt);

  // ── Render ──
  renderFrame(ctx, particles, attractors, camera, attractorPulseT, {
    screenW: window.innerWidth,
    screenH: window.innerHeight,
    transitionAlpha: blendAlpha,
  });

  // ── Attractor pulse timer ──
  attractorPulseT += dt * 2.5;

  // ── HUD ──
  updateHud(now);
}

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
window.addEventListener('resize', () => {
  resizeCanvas();
  camera.screenW = window.innerWidth;
  camera.screenH = window.innerHeight;
});

document.addEventListener('DOMContentLoaded', () => {
  let seed = seedFromHash();
  if (seed === null) {
    seed = generateSeed();
    writeSeedToHash(seed);
  }
  currentSeed = seed;

  particles = initParticles(seed, window.innerWidth, window.innerHeight);

  if (hudSeed) hudSeed.textContent = currentSeed.toString(16).padStart(8, '0');

  showHud();
  lastHudUpdate = performance.now();
  lastTime = performance.now();

  requestAnimationFrame(loop);
});