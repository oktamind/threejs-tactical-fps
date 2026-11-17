// The look plan, in one place. Dusk at a decommissioned relay station: a cold
// blue-grey yard, sodium-amber lights, rust-red site markers and one signal
// green for the bomb. Every colour in the game and the page is one of these six.
export const PALETTE = {
  dusk: '#232a38',
  concrete: '#3a414d',
  steel: '#565e6b',
  ink: '#e8e4d8',
  muted: '#8b95a5',
  amber: '#f0a830',
  rust: '#c65a3a',
  signal: '#7fc24f',
};

export function paint(name) {
  return PALETTE[name];
}
