// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. ?shot=start|firefight|bomb|end with &seed=N stages a
// deterministic frame for a capture, renders it twice, then freezes it and
// sets window.__shotReady. Everything else is live play: buy, fight, plant,
// win or lose the round, and run the match back.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './random.js';
import { createWorld, PLAYER_SPAWN } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createArsenal } from './weapons.js';
import { createGrenade } from './grenade.js';
import { createBots } from './bots.js';
import { createObjective } from './objective.js';
import { createRounds } from './rounds.js';
import { createArmor } from './armor.js';
import { createCampaign, NIGHT_TITLES } from './campaign.js';
import { createHud } from './hud.js';
import { createSoundEffects } from './sound.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(shot ? seed : (Date.now() % 2147483647));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.dusk);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.dusk), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const arsenal = createArsenal(camera);
const grenade = createGrenade(scene, world.colliders);
const bots = createBots(scene, world.colliders, world.shootables, random);
const objective = createObjective(scene);
const rounds = createRounds();
const armor = createArmor();
const campaign = createCampaign();
const hud = createHud();
const sound = createSoundEffects();
const player = createPlayer(world.colliders, PLAYER_SPAWN);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = world.shootables.concat(bots.hitMeshes);
const direction = new THREE.Vector3();
const origin = new THREE.Vector3();
const hitPoint = new THREE.Vector3();

// Tracers: a fixed pool, reused every shot, never allocated in the loop.
const tracers = [];
for (let index = 0; index < 8; index += 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0 }),
  );
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIndex = 0;

function fireTracer(from, to) {
  const tracer = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  const positions = tracer.line.geometry.attributes.position;
  positions.setXYZ(0, from.x, from.y, from.z);
  positions.setXYZ(1, to.x, to.y, to.z);
  positions.needsUpdate = true;
  tracer.line.material.opacity = 0.85;
  tracer.life = 0.07;
}

function stepTracers(dt) {
  for (const tracer of tracers) {
    if (tracer.life <= 0) continue;
    tracer.life -= dt;
    if (tracer.life <= 0) tracer.line.material.opacity = 0;
  }
}

const body = player.state;
const roundsState = rounds.state;
const campaignState = campaign.state;
const bombState = objective.state;
let elapsed = 0;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let shake = 0;
let wasBlast = false;
let wasPlanted = false;
let lastPlantBeep = 0;

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  if (shake > 0.001) {
    camera.position.x += (random() - 0.5) * shake * 0.3;
    camera.position.y += (random() - 0.5) * shake * 0.3;
    camera.rotation.z += (random() - 0.5) * shake * 0.02;
  }
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function losBlocked(from, to) {
  direction.copy(to).sub(from);
  const distance = direction.length();
  if (distance < 0.01) return false;
  direction.normalize();
  raycaster.set(from, direction);
  raycaster.far = distance;
  return raycaster.intersectObjects(world.shootables, false).length > 0;
}

function blastDamage(center, radius, damage) {
  for (const bot of bots.items) {
    if (!bot.alive) continue;
    const distance = Math.hypot(bot.position.x - center.x, bot.position.z - center.z);
    if (distance > radius) continue;
    origin.set(bot.position.x, 1.2, bot.position.z);
    if (losBlocked(center, origin)) continue;
    const scaled = Math.round(damage * (1 - (distance / radius) * 0.6));
    if (bots.damage(bot.torso, scaled)) {
      sound.hit(true);
      onBotKilled(bot);
    }
  }
  const playerDistance = Math.hypot(body.position.x - center.x, body.position.z - center.z);
  if (body.alive && playerDistance < radius) {
    origin.set(body.position.x, body.position.y + body.eye, body.position.z);
    if (!losBlocked(center, origin)) {
      hurtPlayer(Math.round(damage * 0.5 * (1 - (playerDistance / radius) * 0.6)));
    }
  }
}

function onBotKilled(bot) {
  // The Warden pays a $1000 bounty and gets its own line in the feed.
  if (bot.archetype === 'warden') {
    rounds.addKillReward(1000);
    hud.feed('RELAY WARDEN DOWN  +$1000', true);
  } else {
    rounds.addKillReward();
    hud.feed(`${bot.label} ${bot.id + 1} eliminated  +$300`, true);
  }
  if (bots.aliveCount() === 0 && roundsState.phase === 'live') {
    endRound(true, campaign.isBossRound(roundsState.round) ? 'The Relay Warden is down.' : 'All four defenders are down.');
  }
}

function hurtPlayer(damage) {
  if (!body.alive || damage <= 0) return;
  // The vest eats 60% of the hit while it has points left; the rest reaches
  // health. The armor bar shows what is left of it.
  body.health -= armor.absorb(damage);
  shake = 0.35;
  hud.damageFlash();
  hud.setHealth(body.health);
  hud.setArmor(armor.state.points);
  if (body.health <= 0) {
    body.health = 0;
    body.alive = false;
    hud.feed('You were eliminated', false);
    if (roundsState.phase === 'live') endRound(false, 'You were eliminated.');
  }
}

function onBotShot(damage, headshot, bot) {
  if (bot) {
    origin.set(bot.position.x, 1.5, bot.position.z);
    hitPoint.set(body.position.x, body.position.y + body.eye * 0.8, body.position.z);
    fireTracer(origin, hitPoint);
  }
  if (damage > 0) hurtPlayer(damage);
}

function shoot(spread) {
  const def = arsenal.def();
  if (!arsenal.takeRound()) return false;
  sound.shoot(arsenal.current());
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  raycaster.far = def.range;
  origin.copy(camera.position).addScaledVector(direction, 0.6);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  hitPoint.copy(hit ? hit.point : camera.position.clone().addScaledVector(direction, def.range));
  fireTracer(origin, hitPoint);
  if (hit && hit.object.userData.bot) {
    const killed = bots.damage(hit.object, hit.object.userData.part === 'head' ? def.headDamage : def.damage);
    hud.hitMarker(killed, shot ? 4000 : 120);
    sound.hit(killed);
    if (killed) onBotKilled(hit.object.userData.bot);
  }
  arsenal.pullTrigger();
  player.recoil(0.008 + random() * 0.004 + def.kick * 0.12, (random() * 2 - 1) * 0.004);
  bots.hear(body.position);
  syncHudAmmo();
  return true;
}

function syncHudAmmo() {
  const ammo = arsenal.ammo();
  hud.setAmmo(ammo.mag, ammo.reserve, arsenal.def().name.toUpperCase());
}

function syncHud() {
  hud.setHealth(body.health);
  hud.setArmor(armor.state.points);
  hud.setTimer(roundsState.timer);
  hud.setMoney(roundsState.money);
  hud.setFrags(roundsState.frags);
  hud.setRounds(roundsState.playerWins, roundsState.botWins, roundsState.round, campaignState.night);
  const boss = bots.boss();
  hud.setBoss(boss ? boss.health : -1, boss ? boss.maxHealth : 0);
  hud.setSpread(2 + arsenal.spread(player.groundSpeed()) * 900);
  if (bombState.planted) {
    hud.setBomb(`CHARGE PLANTED — 0:${String(Math.max(0, Math.ceil(bombState.fuseLeft))).padStart(2, '0')}`);
  } else if (bombState.planting) {
    hud.setBomb(`PLANTING ${Math.round(bombState.plantProgress * 100)}%`);
  } else if (bombState.detonated) {
    hud.setBomb('CHARGE DETONATED');
  } else if (bombState.defused) {
    hud.setBomb('CHARGE DEFUSED');
  } else {
    hud.setBomb('CHARGE READY — HOLD E AT A OR B');
  }
  syncHudAmmo();
}

// The campaign starts over: fresh wallet, fresh arsenal, night 1. Night 1
// opens straight into the buy menu — the start screen already explained the
// campaign, so there is no separate intro for it.
function startCampaign() {
  campaign.reset();
  rounds.reset();
  armor.reset();
  arsenal.owned.clear();
  arsenal.owned.add('rifle');
  arsenal.owned.add('pistol');
  arsenal.select('rifle');
  arsenal.refillAll();
  startNight(1, true);
}

function startNight(night, skipIntro = false) {
  // A new night keeps the money earned so far; the match itself is fresh.
  rounds.reset(true);
  bots.reset(1, { night, bossRound: false });
  objective.reset();
  grenade.reset();
  player.reset(PLAYER_SPAWN);
  arsenal.refillAll();
  elapsed = 0;
  shake = 0;
  wasBlast = false;
  wasPlanted = false;
  lastPlantBeep = 0;
  hud.hideBanner();
  if (skipIntro) {
    showBuy();
  } else {
    roundsState.phase = 'night';
    hud.showOverlay('night', { night });
  }
  syncHud();
}

function showBuy() {
  rounds.openBuy();
  hud.showOverlay('buy', {
    round: roundsState.round,
    money: roundsState.money,
    ownedSmg: arsenal.owned.has('smg'),
    ownedSniper: arsenal.owned.has('sniper'),
    armor: armor.state.points,
    frags: roundsState.frags,
  });
}

function startRound() {
  rounds.startRound();
  const bossRound = campaign.isBossRound(roundsState.round);
  bots.reset(roundsState.round, { night: campaignState.night, bossRound });
  objective.reset();
  grenade.reset();
  player.reset(PLAYER_SPAWN);
  arsenal.refillAll();
  hud.hideOverlay();
  if (bossRound) {
    hud.showBanner(
      'ROUND 3 — THE RELAY WARDEN',
      'A 500-HP Warden walks site B. Bring it down — $1000 bounty',
      3200,
    );
  } else {
    hud.showBanner(
      `ROUND ${roundsState.round}`,
      roundsState.round > 1
        ? 'Defenders push harder — faster reactions, heavier fire'
        : 'Plant the charge or eliminate all defenders',
      2600,
    );
  }
  syncHud();
}

function endRound(won, message) {
  rounds.endRound(won, message);
  if (won) sound.roundWon();
  else sound.roundLost();
  hud.showBanner(won ? 'ROUND WON' : 'ROUND LOST', message, 2000);
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(() => {
    if (roundsState.matchOver) {
      // A match ends a night, not the game: win and the campaign advances,
      // lose and the whole shift is over.
      if (roundsState.matchWon) {
        const clearedNight = campaignState.night;
        campaign.advance();
        if (campaignState.over) {
          roundsState.phase = 'campaign';
          hud.showOverlay('campaign', {
            won: true,
            nightsWon: 3,
            playerWins: roundsState.playerWins,
            botWins: roundsState.botWins,
            history: roundsState.history,
          });
        } else {
          roundsState.phase = 'nightclear';
          hud.showOverlay('nightclear', {
            night: clearedNight,
            nextNight: campaignState.night,
            playerWins: roundsState.playerWins,
            botWins: roundsState.botWins,
            money: roundsState.money,
          });
        }
      } else {
        campaign.fail();
        roundsState.phase = 'campaign';
        hud.showOverlay('campaign', {
          won: false,
          nightsWon: campaignState.nightsWon,
          night: campaignState.night,
          playerWins: roundsState.playerWins,
          botWins: roundsState.botWins,
          history: roundsState.history,
        });
      }
    } else {
      hud.showOverlay('round', {
        won,
        message,
        playerWins: roundsState.playerWins,
        botWins: roundsState.botWins,
        matchOver: false,
      });
    }
    syncHud();
  }, shot ? 0 : 900);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    if (roundsState.phase === 'live') hud.hideOverlay();
  } else if (roundsState.phase === 'live' && !roundsState.roundOver) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  sound.unlock();
  sound.uiClick();
  if (roundsState.phase === 'buy') {
    startRound();
    input.requestLock();
  } else if (roundsState.phase === 'over') {
    rounds.nextRound();
    showBuy();
  } else if (roundsState.phase === 'start') {
    startCampaign();
  } else if (roundsState.phase === 'night') {
    showBuy();
  } else if (roundsState.phase === 'nightclear') {
    startNight(campaignState.night);
  } else if (roundsState.phase === 'campaign') {
    startCampaign();
  } else if (roundsState.phase === 'live') {
    input.requestLock();
  }
});

hud.onBuySmg(() => {
  if (rounds.buySmg()) {
    arsenal.buy('smg');
    arsenal.select('smg');
    sound.buy();
    showBuy();
    syncHud();
  }
});

hud.onBuySniper(() => {
  if (rounds.buySniper()) {
    arsenal.buy('sniper');
    arsenal.select('sniper');
    sound.buy();
    showBuy();
    syncHud();
  }
});

hud.onBuyVest(() => {
  if (rounds.buyVest()) {
    armor.add();
    sound.buy();
    showBuy();
    syncHud();
  }
});

hud.onBuyFrag(() => {
  if (rounds.buyFrag()) {
    sound.buy();
    showBuy();
    syncHud();
  }
});

function step(dt) {
  elapsed += dt;
  body.speed = player.groundSpeed();
  shake = Math.max(0, shake - dt * 1.4);
  world.step(dt);
  if (roundsState.phase === 'live') {
    roundsState.timer -= dt;
    if (roundsState.timer <= 0 && !bombState.planted && !roundsState.roundOver) {
      endRound(false, 'Time expired — the charge was never planted.');
    }
  }
  player.step(dt, input.state.keys);
  arsenal.step(dt);
  grenade.step(dt, blastDamage);
  if (grenade.state.blastLeft > 0 && !wasBlast) {
    sound.explosion();
    shake = Math.max(shake, 0.4);
  }
  wasBlast = grenade.state.blastLeft > 0;
  objective.step(dt, body.position, input.state.keys.has('KeyE') && body.alive && roundsState.phase === 'live');
  if (bombState.planting) {
    const quarter = Math.floor(bombState.plantProgress / 0.25);
    if (quarter > lastPlantBeep) {
      lastPlantBeep = quarter;
      sound.plantBeep();
    }
  } else {
    lastPlantBeep = 0;
  }
  if (bombState.planted && !wasPlanted) {
    sound.buy();
  }
  wasPlanted = bombState.planted;
  if (bombState.detonated && roundsState.phase === 'live') {
    endRound(true, `Charge detonated at site ${bombState.site ? bombState.site.name : ''}.`);
  } else if (bombState.defused && roundsState.phase === 'live') {
    endRound(false, 'The charge was defused.');
  }
  bots.step(dt, body, bombState, onBotShot);
  stepTracers(dt);
  if (roundsState.phase === 'live') syncHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    // Aim down sights: steadier look, a tighter field of view and far less
    // spread, at the cost of walking speed (see player.step).
    body.aiming = input.state.aiming && roundsState.phase === 'live' && body.alive;
    const lookScale = body.aiming ? 0.6 : 1;
    player.look(look.x * lookScale, look.y * lookScale);
    if (roundsState.phase === 'live' && body.alive) {
      if (input.state.firing && arsenal.ready()) {
        const def = arsenal.def();
        if (def.auto || input.pressed('MouseLeft')) shoot(shot ? 0 : arsenal.spread(player.groundSpeed()) * (body.aiming ? 0.35 : 1));
      }
      if (input.pressed('KeyR')) arsenal.reload();
      if (input.pressed('Digit1')) { arsenal.select('rifle'); syncHudAmmo(); }
      if (input.pressed('Digit2')) { arsenal.select('smg'); syncHudAmmo(); }
      if (input.pressed('Digit3')) { arsenal.select('pistol'); syncHudAmmo(); }
      if (input.pressed('Digit4')) { arsenal.select('sniper'); syncHudAmmo(); }
      if (input.pressed('KeyG') && rounds.useFrag()) {
        camera.getWorldDirection(direction);
        origin.copy(camera.position);
        grenade.throwFrom(origin, direction);
        hud.setFrags(roundsState.frags);
      }
    }
    if (input.pressed('KeyB') && roundsState.phase === 'buy') showBuy();
    if (input.pressed('KeyM')) hud.setSound(sound.toggleMute());
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    // Aiming narrows the field of view smoothly; releasing it opens back up.
    const targetFov = body.aiming ? 55 : 74;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
      camera.updateProjectionMatrix();
    }
    // The scope vignette only appears when aiming with the Longshot.
    hud.setScope(body.aiming && arsenal.current() === 'sniper' && roundsState.phase === 'live');
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBanner();
  body.pitch = 0;
  body.yaw = 0;
  roundsState.phase = 'live';
  if (name === 'start') {
    body.position.set(0.6, 0, 14.6);
    body.yaw = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 2, -11));
    hud.showOverlay('start');
    syncHud();
  } else if (name === 'firefight') {
    // The cover is the boss round: night 3, round 3, the Warden walking the
    // yard with two defenders and one already down. The boss bar shows the
    // Warden at partial health — three rifle hits on it before the capture.
    campaignState.night = 3;
    roundsState.round = 3;
    roundsState.playerWins = 2;
    roundsState.money = 1400;
    roundsState.frags = 1;
    roundsState.timer = 83;
    bots.reset(3, { night: 3, bossRound: true });
    body.position.set(0, 0, 8);
    bots.items[2].position.set(-3, 0, 1.5);
    bots.items[2].state = 'engage';
    bots.items[2].lastKnown.set(0, 0, 8);
    // The Warden holds fire during the staging window: its bursts hit
    // ~2.2x as hard, and three defenders at once could drop the player
    // before the capture even through the vest.
    bots.items[2].pauseTimer = 5;
    bots.items[0].position.set(-6.5, 0, -0.5);
    bots.items[0].state = 'engage';
    bots.items[0].lastKnown.set(0, 0, 8);
    bots.items[1].position.set(4.5, 0, -1.5);
    bots.items[1].state = 'engage';
    bots.items[1].lastKnown.set(0, 0, 8);
    bots.items[3].alive = false;
    bots.items[3].state = 'dead';
    bots.items[3].fall = 1;
    bots.items[3].group.rotation.x = -1.5;
    bots.items[3].position.set(2, 0, 4);
    // Four defenders shooting at once can drop the player before the
    // capture, so the staged player wears a vest: it also shows the armor
    // bar in the cover.
    armor.add();
    settle(10);
    aimAt(new THREE.Vector3(-3, 1.8, 1.5));
    for (let round = 0; round < 3; round += 1) {
      shoot(0);
      settle(6);
    }
    settle(8);
    body.health = 100;
    syncHud();
    // One last shot right before the capture, so the cover shows the muzzle
    // flash and the tracer mid-flight.
    shoot(0);
  } else if (name === 'buy') {
    roundsState.round = 2;
    roundsState.playerWins = 1;
    roundsState.money = 1200;
    roundsState.frags = 0;
    roundsState.timer = 100;
    body.position.set(0, 0, 14);
    settle(10);
    aimAt(new THREE.Vector3(0, 2, -11));
    hud.showOverlay('buy', { round: 2, money: 1200, ownedSmg: false, ownedSniper: false, armor: 0, frags: 0 });
    syncHud();
  } else if (name === 'bomb') {
    roundsState.round = 2;
    roundsState.playerWins = 1;
    roundsState.timer = 61;
    body.position.set(-9.5, 0, -6);
    bots.items[0].position.set(-17, 0, -13);
    bots.items[1].position.set(-12, 0, -13.5);
    bots.items[2].position.set(-5, 0, -8);
    bots.items[2].state = 'alert';
    bots.items[2].lastKnown.set(-13, 0, -10);
    settle(10);
    aimAt(new THREE.Vector3(-14, 1.5, -11));
    bombState.planting = true;
    bombState.plantProgress = 0.55;
    hud.setBomb('PLANTING 55%');
    syncHud();
  } else if (name === 'end') {
    // The end shot is the campaign-complete screen: all three nights
    // survived, the Warden down in the yard behind the panel.
    campaignState.night = 3;
    campaignState.nightsWon = 3;
    campaignState.over = true;
    campaignState.won = true;
    roundsState.round = 4;
    roundsState.playerWins = 3;
    roundsState.botWins = 1;
    roundsState.matchOver = true;
    roundsState.matchWon = true;
    roundsState.history = [
      { round: 1, won: true, message: 'All four defenders are down.' },
      { round: 2, won: false, message: 'You were eliminated.' },
      { round: 3, won: true, message: 'The Relay Warden is down.' },
      { round: 4, won: true, message: 'All four defenders are down.' },
    ];
    bots.reset(3, { night: 3, bossRound: true });
    bots.items[2].alive = false;
    bots.items[2].state = 'dead';
    bots.items[2].fall = 1;
    bots.items[2].group.rotation.x = -1.5;
    bots.items[2].position.set(-3, 0, -1);
    body.position.set(0, 0, 6);
    settle(10);
    aimAt(new THREE.Vector3(-3, 1, -1));
    hud.showOverlay('campaign', { won: true, nightsWon: 3, playerWins: 3, botWins: 1, history: roundsState.history });
    syncHud();
  }
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
syncHud();
hud.setSound(false);
if (shot) runShot(shot);
else {
  roundsState.phase = 'start';
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
