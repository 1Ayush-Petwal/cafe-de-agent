/**
 * Issue #10 (PRD area F): a tiny deterministic PRNG (mulberry32) so the
 * seed's historical bookings are reproducible from one fixed seed rather
 * than `Math.random()` — the same seed must regenerate byte-identical
 * history on every reseed, since both arms of the eventual evaluation
 * harness (issue #34, PRD area G) need to face identical demand.
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
