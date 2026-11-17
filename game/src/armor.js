// Kevlar vest: bought once in the buy menu, it lasts the whole match until
// it is shot through. While it has points left it absorbs 60% of every hit,
// so a $500 vest soaks roughly 165 damage before the player starts bleeding.
const VEST_POINTS = 100;
const ABSORB_FRACTION = 0.6;

export function createArmor() {
  const state = { points: 0 };

  return {
    state,
    reset() {
      state.points = 0;
    },
    add() {
      state.points = VEST_POINTS;
    },
    // Returns the damage that still reaches the player's health.
    absorb(damage) {
      if (state.points <= 0 || damage <= 0) return damage;
      const absorbed = Math.min(state.points, damage * ABSORB_FRACTION);
      state.points -= absorbed;
      return damage - absorbed;
    },
  };
}
