const MULBERRY32_INCREMENT = 0x6D2B79F5;

/**
 * Mulberry32 seeded pseudo-random number generator.
 * Returns a closure that yields floats in [0, 1).
 * @param {number} seed - 32-bit unsigned integer seed
 * @returns {function(): number}
 */
function createRNG(seed) {
  let state = seed >>> 0;
  return function () {
    state = (state + MULBERRY32_INCREMENT) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Module-level seed state
// ---------------------------------------------------------------------------

let _currentSeed = Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;

/**
 * Returns the active seed.
 * @returns {number}
 */
export function getCurrentSeed() {
  return _currentSeed;
}

/**
 * Generates, stores, and returns a new random seed.
 * @returns {number}
 */
export function generateNewSeed() {
  _currentSeed = Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
  return _currentSeed;
}

/**
 * Encodes a seed as a base-36 string suitable for use in a URL hash.
 * @param {number} seed
 * @returns {string}
 */
export function encodeHashSeed(seed) {
  return (seed >>> 0).toString(36).toUpperCase();
}

/**
 * Decodes a base-36 hash string back to a 32-bit unsigned integer seed.
 * Returns NaN if the string is invalid.
 * @param {string} hash
 * @returns {number}
 */
export function decodeHashSeed(hash) {
  if (typeof hash !== 'string' || hash.trim() === '') return NaN;
  const parsed = parseInt(hash.trim(), 36);
  if (Number.isNaN(parsed)) return NaN;
  return parsed >>> 0;
}

// ---------------------------------------------------------------------------
// Neon colour palette (matches physics.js)
// ---------------------------------------------------------------------------

const NEON_PALETTE = [
  '#bf00ff',
  '#00eeff',
  '#ff00cc',
  '#ffaa00',
  '#00ff88',
  '#ff6622',
];

/**
 * Returns a colour from the neon palette biased by a t value [0,1].
 * @param {function} rng
 * @param {number} [bias] - optional 0-1 float to pick a specific hue region
 */
function randomColor(rng, bias) {
  const t = bias !== undefined ? bias : rng();
  const index = Math.floor(t * NEON_PALETTE.length) % NEON_PALETTE.length;
  return NEON_PALETTE[index];
}

// ---------------------------------------------------------------------------
// Gaussian helpers
// ---------------------------------------------------------------------------

/**
 * Box-Muller transform for normally distributed values.
 * Uses two calls on the provided rng.
 * @param {function} rng
 * @param {number} mean
 * @param {number} stddev
 * @returns {number}
 */
function gaussian(rng, mean, stddev) {
  const u1 = Math.max(rng(), 1e-10);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stddev * z;
}

// ---------------------------------------------------------------------------
// Particle factory
// ---------------------------------------------------------------------------

/**
 * Builds a minimal particle descriptor compatible with physics.js.
 */
function makeParticle(x, y, vx, vy, color, radius, opacity) {
  return {
    x,
    y,
    z: 0,
    vx,
    vy,
    vz: 0,
    ax: 0,
    ay: 0,
    az: 0,
    color: color || NEON_PALETTE[0],
    radius: radius !== undefined ? radius : 1.0,
    opacity: opacity !== undefined ? opacity : 1.0,
    trail: [],
    mass: 1.0,
  };
}

// ---------------------------------------------------------------------------
// Configuration chooser
// ---------------------------------------------------------------------------

const CONFIGS = ['spiral', 'collision', 'nebula'];

/**
 * Deterministically picks a configuration name from a seed.
 * @param {number} seed
 * @returns {'spiral'|'collision'|'nebula'}
 */
function configFromSeed(seed) {
  return CONFIGS[seed % CONFIGS.length];
}

// ---------------------------------------------------------------------------
// Configuration 1 – Spiral Arms
// ---------------------------------------------------------------------------

/**
 * Archimedean spiral galaxy with 2–4 arms.
 * Particles are placed along arms with tangential velocity plus small radial noise.
 *
 * @param {function} rng
 * @param {number}   count
 * @param {number}   cx      - canvas centre X
 * @param {number}   cy      - canvas centre Y
 * @returns {object[]}
 */
function buildSpiralArms(rng, count, cx, cy) {
  const particles = [];

  // Arm count: 2, 3, or 4 – chosen from seed
  const armCount = 2 + Math.floor(rng() * 3); // 2..4
  const armOffset = (2 * Math.PI) / armCount;

  // Spiral growth rate – higher = more open arms
  const growthRate = 0.18 + rng() * 0.22; // 0.18..0.40

  // Maximum radial extent
  const maxRadius = 340 + rng() * 120; // 340..460 units

  // Rotation direction (CW / CCW)
  const rotDir = rng() < 0.5 ? 1 : -1;

  // Arm hue assignments
  const armColors = Array.from({ length: armCount }, (_, i) =>
    NEON_PALETTE[i % NEON_PALETTE.length]
  );

  // Central bulge: ~12% of particles
  const bulgeCount = Math.floor(count * 0.12);
  for (let i = 0; i < bulgeCount; i++) {
    const r = Math.abs(gaussian(rng, 0, maxRadius * 0.06));
    const theta = rng() * 2 * Math.PI;
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);

    // Slow circular motion around centre
    const speed = 0.1 + rng() * 0.15;
    const velAngle = theta + Math.PI * 0.5 * rotDir;
    const vx = Math.cos(velAngle) * speed;
    const vy = Math.sin(velAngle) * speed;

    const color = NEON_PALETTE[Math.floor(rng() * 2)]; // cyan / purple
    const opacity = 0.4 + rng() * 0.6;
    const radius = 0.6 + rng() * 1.0;
    particles.push(makeParticle(x, y, vx, vy, color, radius, opacity));
  }

  // Arm particles
  const armParticleCount = count - bulgeCount;
  for (let i = 0; i < armParticleCount; i++) {
    const arm = Math.floor(rng() * armCount);
    const armPhase = arm * armOffset;

    // Radial distance: clustered toward inner but spread outward
    const t = Math.pow(rng(), 0.6); // bias toward outer
    const r = 20 + t * maxRadius;

    // Archimedean: theta is proportional to r
    const thetaBase = armPhase + growthRate * r;
    const thetaSpread = gaussian(rng, 0, 0.18 + (r / maxRadius) * 0.22);
    const theta = thetaBase + thetaSpread;

    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);

    // Tangential velocity (orbital), magnitude decreases with r (Keplerian-ish)
    const orbitalSpeed = (0.8 + rng() * 0.4) * Math.sqrt(80 / (r + 10));
    const velTheta = theta + (Math.PI * 0.5) * rotDir;
    const radialNoise = (rng() - 0.5) * 0.06 * orbitalSpeed;
    const vx = Math.cos(velTheta) * orbitalSpeed + Math.cos(theta) * radialNoise;
    const vy = Math.sin(velTheta) * orbitalSpeed + Math.sin(theta) * radialNoise;

    // Colour: arm hue with occasional drift
    const color = rng() < 0.85 ? armColors[arm] : NEON_PALETTE[Math.floor(rng() * NEON_PALETTE.length)];
    const opacity = 0.25 + (1 - t) * 0.5 + rng() * 0.25;
    const radius = 0.5 + rng() * 1.2 * (1 - t * 0.5);
    particles.push(makeParticle(x, y, vx, vy, color, radius, opacity));
  }

  return particles;
}

// ---------------------------------------------------------------------------
// Configuration 2 – Collision
// ---------------------------------------------------------------------------

/**
 * Two disc galaxies offset from centre with opposing drift velocities.
 * Each disc has a near-uniform distribution within its radius.
 *
 * @param {function} rng
 * @param {number}   count
 * @param {number}   cx
 * @param {number}   cy
 * @returns {object[]}
 */
function buildCollision(rng, count, cx, cy) {
  const particles = [];

  // Geometry
  const separation = 160 + rng() * 180; // distance each disc is offset from centre
  const angle = rng() * Math.PI * 2;    // collision axis angle
  const discRadius = 180 + rng() * 120;

  // Disc centres
  const cx1 = cx + Math.cos(angle) * separation;
  const cy1 = cy + Math.sin(angle) * separation;
  const cx2 = cx - Math.cos(angle) * separation;
  const cy2 = cy - Math.sin(angle) * separation;

  // Drift velocities: opposing, pointing roughly toward centre
  const driftSpeed = 0.25 + rng() * 0.35;
  const driftVx1 = -Math.cos(angle) * driftSpeed;
  const driftVy1 = -Math.sin(angle) * driftSpeed;
  const driftVx2 = Math.cos(angle) * driftSpeed;
  const driftVy2 = Math.sin(angle) * driftSpeed;

  // Rotation direction per disc
  const rotDir1 = rng() < 0.5 ? 1 : -1;
  const rotDir2 = rng() < 0.5 ? 1 : -1;

  // Colour assignment: disc1 = cyan/purple cluster, disc2 = magenta/amber
  const disc1Colors = [NEON_PALETTE[1], NEON_PALETTE[0]]; // cyan, purple
  const disc2Colors = [NEON_PALETTE[2], NEON_PALETTE[3]]; // magenta, amber

  const halfCount = Math.floor(count / 2);

  function buildDisc(dcx, dcy, driftVx, driftVy, rotDir, colors, n) {
    for (let i = 0; i < n; i++) {
      // Uniform disc sampling via rejection or sqrt trick
      const r = discRadius * Math.sqrt(rng());
      const theta = rng() * 2 * Math.PI;

      const x = dcx + r * Math.cos(theta);
      const y = dcy + r * Math.sin(theta);

      // Orbital velocity within disc
      const orbitalSpeed = (0.3 + rng() * 0.3) * Math.sqrt(60 / (r + 8));
      const velTheta = theta + (Math.PI * 0.5) * rotDir;
      const vx = driftVx + Math.cos(velTheta) * orbitalSpeed;
      const vy = driftVy + Math.sin(velTheta) * orbitalSpeed;

      const color = colors[rng() < 0.7 ? 0 : 1];
      const opacity = 0.3 + rng() * 0.7;
      const radius = 0.5 + rng() * 1.4;
      particles.push(makeParticle(x, y, vx, vy, color, radius, opacity));
    }
  }

  buildDisc(cx1, cy1, driftVx1, driftVy1, rotDir1, disc1Colors, halfCount);
  buildDisc(cx2, cy2, driftVx2, driftVy2, rotDir2, disc2Colors, count - halfCount);

  return particles;
}

// ---------------------------------------------------------------------------
// Configuration 3 – Nebula Cloud
// ---------------------------------------------------------------------------

/**
 * Multi-cluster Gaussian nebula with very low velocity.
 * 2–5 overlapping Gaussian blobs of varying size and colour.
 *
 * @param {function} rng
 * @param {number}   count
 * @param {number}   cx
 * @param {number}   cy
 * @returns {object[]}
 */
function buildNebulaCloud(rng, count, cx, cy) {
  const particles = [];

  const clusterCount = 2 + Math.floor(rng() * 4); // 2..5

  // Generate cluster descriptors
  const clusters = [];
  let totalWeight = 0;
  for (let c = 0; c < clusterCount; c++) {
    const spreadRadius = 120 + rng() * 220;
    const offsetR = rng() * 200;
    const offsetTheta = rng() * 2 * Math.PI;
    const weight = 0.5 + rng() * 1.5;
    const color = NEON_PALETTE[c % NEON_PALETTE.length];
    clusters.push({ cx: cx + offsetR * Math.cos(offsetTheta), cy: cy + offsetR * Math.sin(offsetTheta), spread: spreadRadius, weight, color });
    totalWeight += weight;
  }

  // Normalise weights to cumulative distribution for sampling
  const cdf = [];
  let acc = 0;
  for (const cl of clusters) {
    acc += cl.weight / totalWeight;
    cdf.push(acc);
  }

  for (let i = 0; i < count; i++) {
    // Pick cluster via CDF
    const u = rng();
    let clusterIdx = 0;
    for (let c = 0; c < cdf.length; c++) {
      if (u <= cdf[c]) { clusterIdx = c; break; }
    }
    const cl = clusters[clusterIdx];

    const x = gaussian(rng, cl.cx, cl.spread);
    const y = gaussian(rng, cl.cy, cl.spread * 0.65); // slightly flattened

    // Very low velocity – gentle brownian-like drift
    const speed = rng() * 0.12;
    const velTheta = rng() * 2 * Math.PI;
    const vx = Math.cos(velTheta) * speed;
    const vy = Math.sin(velTheta) * speed;

    // Soft translucent look
    const opacity = 0.1 + rng() * 0.55;
    const radius = 0.7 + rng() * 2.2;

    // Allow colour blending between adjacent clusters
    const blendNeighbour = rng() < 0.25 && clusterCount > 1;
    const neighbourIdx = (clusterIdx + 1) % clusterCount;
    const color = blendNeighbour ? clusters[neighbourIdx].color : cl.color;

    particles.push(makeParticle(x, y, vx, vy, color, radius, opacity));
  }

  return particles;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialises a particle array using a deterministic seeded layout.
 * Automatically selects one of three configurations based on the seed value.
 *
 * @param {number} [seed]          - 32-bit seed; defaults to current module seed
 * @param {number} [count=4000]    - number of particles to generate
 * @param {number} [width=1280]    - canvas logical width  (for centring)
 * @param {number} [height=720]    - canvas logical height (for centring)
 * @returns {{ particles: object[], config: string, seed: number }}
 */
export function initParticles(seed, count = 4000, width = 1280, height = 720) {
  // Accept explicit seed or fall back to module seed
  if (seed === undefined || seed === null) {
    seed = _currentSeed;
  }
  seed = seed >>> 0;
  _currentSeed = seed;

  const rng = createRNG(seed);
  const cx = width / 2;
  const cy = height / 2;

  const config = configFromSeed(seed);

  let particles;
  switch (config) {
    case 'spiral':
      particles = buildSpiralArms(rng, count, cx, cy);
      break;
    case 'collision':
      particles = buildCollision(rng, count, cx, cy);
      break;
    case 'nebula':
    default:
      particles = buildNebulaCloud(rng, count, cx, cy);
      break;
  }

  return { particles, config, seed };
}