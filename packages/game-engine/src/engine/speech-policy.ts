import type { SeatId } from "@wfill/contracts";

export type SpeechValidationResult =
  | {
    readonly ok: true;
    readonly actualLength: number;
    readonly limit: number;
  }
  | {
    readonly ok: false;
    readonly reason: "speech_too_long";
    readonly actualLength: number;
    readonly limit: number;
  };

export type SpeechDirection = "clockwise" | "counterclockwise";

export const deriveSpeechDirection = (
  seed: string,
  dayNumber: number,
  roundContext = "ordinary",
): SpeechDirection => hashSeed(`${seed}|day:${dayNumber}|round:${roundContext}`) % 2 === 0
  ? "clockwise"
  : "counterclockwise";

export interface SpeakingOrderInput {
  readonly seed: string;
  readonly aliveSeats: readonly (SeatId | number)[];
  readonly priorDeathSeats: readonly (SeatId | number)[];
  readonly direction: SpeechDirection;
}

const hashSeed = (seed: string): number => {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const adjacentAliveSeat = (
  aliveSeats: readonly number[],
  deathSeat: number,
  direction: SpeechDirection,
): number => {
  if (direction === "clockwise") {
    return aliveSeats.find((seat) => seat > deathSeat) ?? aliveSeats[0]!;
  }
  return [...aliveSeats].reverse().find((seat) => seat < deathSeat) ?? aliveSeats.at(-1)!;
};

export const validateSpeech = (text: string, limit: number): SpeechValidationResult => {
  const actualLength = Array.from(text).length;
  if (actualLength > limit) {
    return { ok: false, reason: "speech_too_long", actualLength, limit };
  }
  return { ok: true, actualLength, limit };
};

export const createSpeakingOrder = ({
  seed,
  aliveSeats,
  priorDeathSeats,
  direction,
}: SpeakingOrderInput): SeatId[] => {
  const sortedAliveSeats = [...new Set(aliveSeats)]
    .map(Number)
    .sort((left, right) => left - right);
  if (sortedAliveSeats.length === 0) return [];

  const latestDeath = priorDeathSeats.at(-1);
  const startSeat = latestDeath === undefined
    ? sortedAliveSeats[hashSeed(seed) % sortedAliveSeats.length]!
    : adjacentAliveSeat(sortedAliveSeats, Number(latestDeath), direction);
  const directedSeats = direction === "clockwise"
    ? sortedAliveSeats
    : [...sortedAliveSeats].reverse();
  const startIndex = directedSeats.indexOf(startSeat);

  return [
    ...directedSeats.slice(startIndex),
    ...directedSeats.slice(0, startIndex),
  ] as SeatId[];
};
