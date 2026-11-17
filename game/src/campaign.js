// The Night Shift campaign: three nights, one match each. Money, weapons and
// armor carry across nights, the defenders get tougher every night, and the
// third night ends with the Relay Warden — a boss round in round 3. Win a
// night to advance; lose one and the shift is over.
export const NIGHTS = 3;
export const BOSS_ROUND = 3;
export const NIGHT_TITLES = ['FIRST SHIFT', 'THE YARD GETS LOUDER', 'THE WARDEN WAKES'];

export function createCampaign() {
  const state = {
    night: 1,
    nightsWon: 0,
    over: false,
    won: false,
  };

  return {
    state,
    // The boss walks the yard in round 3 of night 3. A match is first to 3,
    // so round 3 is always played — the boss round is guaranteed.
    isBossRound(round) {
      return state.night === NIGHTS && round === BOSS_ROUND;
    },
    advance() {
      state.nightsWon += 1;
      if (state.night >= NIGHTS) {
        state.over = true;
        state.won = true;
      } else {
        state.night += 1;
      }
    },
    fail() {
      state.over = true;
      state.won = false;
    },
    reset() {
      state.night = 1;
      state.nightsWon = 0;
      state.over = false;
      state.won = false;
    },
  };
}
