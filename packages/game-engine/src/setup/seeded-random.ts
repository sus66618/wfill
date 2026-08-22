export interface SeededRandom {
  next(): number;
}

const hashSeed = (seed: string): number => {
  let hash = 2_166_136_261;

  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16_777_619);
  }

  return hash >>> 0;
};

export const createSeededRandom = (seed: string): SeededRandom => {
  let state = hashSeed(seed);

  return {
    next: () => {
      state = (state + 0x6d2b79f5) | 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    },
  };
};
