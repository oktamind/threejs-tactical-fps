// Rounds and money: first to 3 round wins takes the match, at most 5 rounds.
// A round lasts 100 s and ends when the other team is eliminated, the charge
// detonates, the charge is defused, or the clock runs out with nothing
// planted. Win pays $300, loss $150, every elimination $300. Between rounds
// the buy menu opens: SMG $900, frag $300, rifle ammo free with the round.
export const ROUND_TIME = 100;
export const ROUNDS_TO_WIN = 3;
export const MAX_ROUNDS = 5;

export const PRICES = { smg: 900, sniper: 1200, frag: 300 };

export function createRounds() {
  const state = {
    round: 1,
    playerWins: 0,
    botWins: 0,
    money: 900,
    frags: 0,
    phase: 'buy',
    timer: ROUND_TIME,
    message: '',
    matchOver: false,
    matchWon: false,
    roundOver: false,
    roundWon: false,
    // Every round's result, in order, for the match-results screen.
    history: [],
  };

  return {
    state,
    startRound() {
      state.phase = 'live';
      state.timer = ROUND_TIME;
      state.roundOver = false;
      state.roundWon = false;
      state.message = '';
    },
    openBuy() {
      state.phase = 'buy';
    },
    endRound(won, message) {
      if (state.roundOver) return;
      state.roundOver = true;
      state.roundWon = won;
      state.message = message;
      state.phase = 'over';
      state.history.push({ round: state.round, won, message });
      if (won) {
        state.playerWins += 1;
        state.money += 300;
      } else {
        state.botWins += 1;
        state.money += 150;
      }
      if (state.playerWins >= ROUNDS_TO_WIN || state.botWins >= ROUNDS_TO_WIN || state.round >= MAX_ROUNDS) {
        state.matchOver = true;
        state.matchWon = state.playerWins > state.botWins;
      }
    },
    nextRound() {
      state.round += 1;
      state.phase = 'buy';
      state.timer = ROUND_TIME;
      state.roundOver = false;
      state.roundWon = false;
      state.message = '';
    },
    addKillReward() {
      state.money += 300;
    },
    buyFrag() {
      if (state.money < PRICES.frag || state.frags >= 2) return false;
      state.money -= PRICES.frag;
      state.frags += 1;
      return true;
    },
    buySmg() {
      if (state.money < PRICES.smg) return false;
      state.money -= PRICES.smg;
      return true;
    },
    buySniper() {
      if (state.money < PRICES.sniper) return false;
      state.money -= PRICES.sniper;
      return true;
    },
    useFrag() {
      if (state.frags <= 0) return false;
      state.frags -= 1;
      return true;
    },
    reset() {
      state.round = 1;
      state.playerWins = 0;
      state.botWins = 0;
      state.money = 900;
      state.frags = 0;
      state.phase = 'buy';
      state.timer = ROUND_TIME;
      state.message = '';
      state.matchOver = false;
      state.matchWon = false;
      state.roundOver = false;
      state.roundWon = false;
      state.history = [];
    },
  };
}
