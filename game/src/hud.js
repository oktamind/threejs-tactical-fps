// The DOM HUD: health, ammo, timer, money, round pips, bomb status, crosshair,
// hit marker, kill feed and the overlay panels (start, buy, pause, round end,
// match end). It never touches the simulation; main.js pushes numbers in and
// reads the button callbacks out.
export function createHud() {
  const el = (id) => document.getElementById(id);
  const overlay = el('overlay');
  const title = el('overlay-title');
  const copy = el('overlay-copy');
  const play = el('play');
  const buyPanel = el('buy-panel');
  const healthFill = el('health-fill');
  const healthValue = el('health-value');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const weaponName = el('weapon-name');
  const timerValue = el('timer-value');
  const moneyValue = el('money-value');
  const fragsValue = el('frags-value');
  const roundsValue = el('rounds-value');
  const bombValue = el('bomb-value');
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const damageVignette = el('damage');
  const killfeed = el('killfeed');
  const banner = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const matchHistory = el('match-history');
  const soundValue = el('sound-value');
  const armorFill = el('armor-fill');
  const armorValue = el('armor-value');
  const armorRow = el('armor');
  const scope = el('scope');

  let hitTimer = 0;
  let damageTimer = 0;
  let bannerTimer = 0;
  let lastAmmo = '';
  let lastHealth = -1;
  let lastArmor = -1;
  let lastTimer = -1;
  let lastMoney = -1;
  let lastRounds = '';
  let lastBomb = '';
  let lastWeapon = '';
  let lastFrags = -1;

  function feed(text, good) {
    const line = document.createElement('div');
    line.className = good ? 'feed-good' : 'feed-bad';
    line.textContent = text;
    killfeed.prepend(line);
    while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
    setTimeout(() => {
      if (line.parentNode) line.parentNode.removeChild(line);
    }, 5000);
  }

  return {
    setHealth(hp) {
      const value = Math.max(0, Math.round(hp));
      if (value === lastHealth) return;
      lastHealth = value;
      healthValue.textContent = String(value);
      healthFill.style.width = `${value}%`;
      healthFill.classList.toggle('low', value <= 30);
    },
    setArmor(points) {
      const value = Math.max(0, Math.round(points));
      if (value === lastArmor) return;
      lastArmor = value;
      armorRow.hidden = value <= 0;
      armorValue.textContent = String(value);
      armorFill.style.width = `${value}%`;
    },
    // The sniper's scope: a dark vignette with a fine crosshair, replacing
    // the hip-fire crosshair while aiming down sights.
    setScope(on) {
      scope.hidden = !on;
      crosshair.style.visibility = on ? 'hidden' : '';
    },
    setAmmo(mag, reserve, name) {
      const key = `${mag}/${reserve}/${name}`;
      if (key === lastAmmo) return;
      lastAmmo = key;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = name;
    },
    setTimer(seconds) {
      const value = Math.max(0, Math.ceil(seconds));
      if (value === lastTimer) return;
      lastTimer = value;
      const minutes = Math.floor(value / 60);
      const secs = value % 60;
      timerValue.textContent = `${minutes}:${String(secs).padStart(2, '0')}`;
      timerValue.classList.toggle('low', value <= 15);
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
    },
    setFrags(value) {
      if (value === lastFrags) return;
      lastFrags = value;
      fragsValue.textContent = `Frag x${value}`;
    },
    setRounds(playerWins, botWins, round) {
      const key = `${playerWins}-${botWins}-${round}`;
      if (key === lastRounds) return;
      lastRounds = key;
      roundsValue.textContent = `ROUND ${round} · YOU ${playerWins} — ${botWins} DEFENDERS`;
    },
    setBomb(text) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombValue.textContent = text;
    },
    setWeapon(name) {
      if (name === lastWeapon) return;
      lastWeapon = name;
      weaponName.textContent = name;
    },
    setSound(muted) {
      soundValue.textContent = muted ? 'SOUND OFF (M)' : 'SOUND ON (M)';
    },
    setSpread(px) {
      crosshair.style.setProperty('--gap', `${Math.round(px)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageVignette.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damageVignette.classList.remove('on'), 220);
    },
    feed,
    showBanner(titleText, subText, ms = 2400) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, ms);
    },
    hideBanner() {
      banner.hidden = true;
      clearTimeout(bannerTimer);
    },
    showOverlay(mode, data = {}) {
      buyPanel.hidden = true;
      matchHistory.hidden = true;
      matchHistory.textContent = '';
      if (mode === 'start') {
        title.textContent = 'RELAY YARD';
        copy.textContent = 'A tactical FPS at a decommissioned relay station. Plant the charge at site A or B, or eliminate all four defenders, before the clock runs out. First to 3 rounds takes the match. Three defender types — patrolling Defenders, rushing Rushers, long-range Marksmen — get tougher every round.';
        play.textContent = 'Click to play';
      } else if (mode === 'paused') {
        title.textContent = 'RELAY YARD';
        copy.textContent = 'Paused. Click to resume.';
        play.textContent = 'Click to resume';
      } else if (mode === 'buy') {
        title.textContent = `ROUND ${data.round} — BUY PHASE`;
        copy.textContent = `You have $${data.money}. Spend it before the round starts: SMG $900, Longshot $1200, Kevlar vest $500, frag grenade $300. Press B to close the shop and start the round.`;
        play.textContent = 'Start round';
        buyPanel.hidden = false;
        el('buy-money').textContent = `$${data.money}`;
        el('buy-smg').disabled = data.ownedSmg || data.money < 900;
        el('buy-smg').textContent = data.ownedSmg ? 'PDW-9 SMG — OWNED' : 'Buy PDW-9 SMG — $900';
        el('buy-sniper').disabled = data.ownedSniper || data.money < 1200;
        el('buy-sniper').textContent = data.ownedSniper ? 'LR-8 Longshot — OWNED' : 'Buy LR-8 Longshot — $1200';
        el('buy-vest').disabled = data.armor > 0 || data.money < 500;
        el('buy-vest').textContent = data.armor > 0 ? `Kevlar vest — ARMOR ${Math.round(data.armor)}` : 'Buy Kevlar vest — $500';
        el('buy-frag').disabled = data.money < 300 || data.frags >= 2;
        el('buy-frag').textContent = `Buy frag grenade — $300 (${data.frags}/2)`;
      } else if (mode === 'round') {
        title.textContent = data.won ? 'ROUND WON' : 'ROUND LOST';
        copy.textContent = `${data.message} Score: you ${data.playerWins} — ${data.botWins} defenders.`;
        play.textContent = data.matchOver ? 'See match result' : 'Next round';
      } else if (mode === 'match') {
        title.textContent = data.won ? 'MATCH WON — RELAY YARD IS YOURS' : 'MATCH LOST';
        copy.textContent = `Final score: you ${data.playerWins} — ${data.botWins} defenders. ${data.won ? 'The relay station falls silent. Well played.' : 'The defenders hold the yard. Run it back.'}`;
        play.textContent = 'Play again';
        for (const row of data.history ?? []) {
          const line = document.createElement('div');
          line.textContent = `ROUND ${row.round} — ${row.won ? 'WON' : 'LOST'} — ${row.message}`;
          matchHistory.appendChild(line);
        }
        matchHistory.hidden = (data.history ?? []).length === 0;
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuySmg(handler) {
      el('buy-smg').addEventListener('click', handler);
    },
    onBuySniper(handler) {
      el('buy-sniper').addEventListener('click', handler);
    },
    onBuyVest(handler) {
      el('buy-vest').addEventListener('click', handler);
    },
    onBuyFrag(handler) {
      el('buy-frag').addEventListener('click', handler);
    },
  };
}
