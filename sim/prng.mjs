export function createRng(initialSeed = 42) {
  let s = Math.floor(initialSeed) >>> 0;
  function rng() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function int(n) {
    return Math.floor(rng() * n);
  }
  function pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[int(arr.length)];
  }
  return { rng, int, pick };
}

let defaultRng = createRng(42);

export function seed(s) {
  defaultRng = createRng(s);
}

export function rng() {
  return defaultRng.rng();
}

export function int(n) {
  return defaultRng.int(n);
}

export function pick(arr) {
  return defaultRng.pick(arr);
}
