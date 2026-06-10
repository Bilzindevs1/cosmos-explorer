const NEON_PALETTE = [
  '#bf00ff', // purple
  '#00eeff', // cyan
  '#ff00cc', // magenta
  '#ffaa00', // gold
];

const MAX_DELTA_TIME = 0.032; // 32ms cap in seconds
const SINGULARITY_GUARD = 20;  // minimum distance (units)
const FALLOFF_RADIUS = 400;    // maximum effective gravity distance (units)
const AMBIENT_PULL = 0.8;      // central pull acceleration constant
const AMBIENT_MAX_DIST = 1200; // distance beyond which central pull is strongest

/**
 * Creates a particle object.
 * @param {number} x  - position X
 * @param {number} y  - position Y
 * @param {number} z  - position Z
 * @param {number} vx - velocity X
 * @param {number} vy - velocity Y
 * @param {number} vz - velocity Z
 * @param {number} mass  - particle mass
 * @param {string} color - CSS color string
 * @returns {Object} particle
 */
function createParticle(x, y, z, vx, vy, vz, mass, color) {
  return {
    x,
    y,
    z,
    vx,
    vy,
    vz,
    mass: mass > 0 ? mass : 1,
    color: color || NEON_PALETTE[0],
    ax: 0,
    ay: 0,
    az: 0,
  };
}

/**
 * Creates an attractor object.
 * @param {number} x    - position X
 * @param {number} y    - position Y
 * @param {number} z    - position Z
 * @param {number} mass - attractor mass (governs gravitational pull strength)
 * @returns {Object} attractor
 */
function createAttractor(x, y, z, mass) {
  return {
    x,
    y,
    z,
    mass: mass > 0 ? mass : 1,
  };
}

/**
 * Gravitational constant used in the n-body-lite simulation.
 * Tuned for artistic visual behavior rather than physical accuracy.
 */
const G = 200;

/**
 * Updates all particles using n-body-lite gravity from attractors
 * plus a weak ambient central pull toward the scene origin.
 *
 * @param {Object[]} particles  - array of particle objects (mutated in place)
 * @param {Object[]} attractors - array of attractor objects
 * @param {number}   dt         - delta time in seconds (will be capped internally)
 */
function updatePhysics(particles, attractors, dt) {
  // Cap delta time to avoid instability on slow frames
  const safeDt = Math.min(dt, MAX_DELTA_TIME);

  const particleCount = particles.length;
  const attractorCount = attractors.length;

  for (let i = 0; i < particleCount; i++) {
    const p = particles[i];

    // Reset per-frame acceleration
    p.ax = 0;
    p.ay = 0;
    p.az = 0;

    // --- N-body-lite: gravity from each attractor ---
    for (let j = 0; j < attractorCount; j++) {
      const a = attractors[j];

      const dx = a.x - p.x;
      const dy = a.y - p.y;
      const dz = a.z - p.z;

      const distSq = dx * dx + dy * dy + dz * dz;
      const dist = Math.sqrt(distSq);

      // Skip if beyond falloff radius
      if (dist > FALLOFF_RADIUS) continue;

      // Apply singularity guard — clamp minimum distance
      const effectiveDist = Math.max(dist, SINGULARITY_GUARD);
      const effectiveDistSq = effectiveDist * effectiveDist;

      // Inverse-square gravitational acceleration: a = G*M / r^2
      const accelMag = (G * a.mass) / effectiveDistSq;

      // Falloff softening: taper force to zero near FALLOFF_RADIUS boundary
      const falloffFactor = 1 - dist / FALLOFF_RADIUS;

      const invDist = 1 / (dist > 0 ? dist : 0.0001);
      const nx = dx * invDist;
      const ny = dy * invDist;
      const nz = dz * invDist;

      p.ax += nx * accelMag * falloffFactor;
      p.ay += ny * accelMag * falloffFactor;
      p.az += nz * accelMag * falloffFactor;
    }

    // --- Weak ambient central pull toward scene origin (0, 0, 0) ---
    const ox = -p.x;
    const oy = -p.y;
    const oz = -p.z;
    const originDist = Math.sqrt(ox * ox + oy * oy + oz * oz);

    if (originDist > 0.001) {
      // Pull strength ramps up with distance — keeps scene bounded
      const ambientStrength =
        AMBIENT_PULL * Math.min(originDist / AMBIENT_MAX_DIST, 1.0);
      const invOriginDist = 1 / originDist;

      p.ax += ox * invOriginDist * ambientStrength;
      p.ay += oy * invOriginDist * ambientStrength;
      p.az += oz * invOriginDist * ambientStrength;
    }

    // --- Symplectic Euler integration ---
    p.vx += p.ax * safeDt;
    p.vy += p.ay * safeDt;
    p.vz += p.az * safeDt;

    p.x += p.vx * safeDt;
    p.y += p.vy * safeDt;
    p.z += p.vz * safeDt;
  }
}

export { NEON_PALETTE, createParticle, createAttractor, updatePhysics };