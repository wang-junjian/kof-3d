export const FIGHTER_STATES = [
  'idle', 'walk', 'jump', 'crouch', 'guard',
  'attack', 'hitstun', 'blockstun', 'knockdown', 'ko',
] as const;

export type FighterState = (typeof FIGHTER_STATES)[number];

const NEUTRAL = new Set<FighterState>(['idle', 'walk', 'jump', 'crouch', 'guard']);
const STUNNED = new Set<FighterState>(['hitstun', 'blockstun', 'knockdown']);

/** 中性态：可接受输入、可起招。 */
export function isNeutral(s: FighterState): boolean {
  return NEUTRAL.has(s);
}

/** 受控态：不可行动，硬直结束回中性态。 */
export function isStunned(s: FighterState): boolean {
  return STUNNED.has(s);
}
