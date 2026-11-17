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
import { createHud } from './hud.js';

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
const hud = createHud();
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
const bombState = objective.state;
let elapsed = 0;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
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
    if (bots.damage(bot.torso, scaled)) onBotKilled(bot);
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
  rounds.addKillReward();
  hud.feed(`Defender ${bot.id + 1} eliminated  +$300`, true);
  if (bots.aliveCount() === 0 && roundsState.phase === 'live') {
    endRound(true, 'All four defenders are down.');
  }
}

function hurtPlayer(damage) {
  if (!body.alive || damage <= 0) return;
  body.health -= damage;
  hud.damageFlash();
  hud.setHealth(body.health);
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
  hud.setTimer(roundsState.timer);
  hud.setMoney(roundsState.money);
  hud.setFrags(roundsState.frags);
  hud.setRounds(roundsState.playerWins, roundsState.botWins, roundsState.round);
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

function startMatch() {
  rounds.reset();
  bots.reset();
  objective.reset();
  grenade.reset();
  player.reset(PLAYER_SPAWN);
  arsenal.owned.clear();
  arsenal.owned.add('rifle');
  arsenal.owned.add('pistol');
  arsenal.select('rifle');
  arsenal.refillAll();
  elapsed = 0;
  hud.hideBanner();
  showBuy();
}

function showBuy() {
  rounds.openBuy();
  hud.showOverlay('buy', {
    round: roundsState.round,
    money: roundsState.money,
    ownedSmg: arsenal.owned.has('smg'),
    frags: roundsState.frags,
  });
}

function startRound() {
  rounds.startRound();
  bots.reset();
  objective.reset();
  grenade.reset();
  player.reset(PLAYER_SPAWN);
  arsenal.refillAll();
  hud.hideOverlay();
  hud.showBanner(`ROUND ${roundsState.round}`, 'Plant the charge or eliminate all defenders', 2600);
  syncHud();
}

function endRound(won, message) {
  rounds.endRound(won, message);
  hud.showBanner(won ? 'ROUND WON' : 'ROUND LOST', message, 2000);
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(() => {
    if (roundsState.matchOver) {
      hud.showOverlay('match', {
        won: roundsState.matchWon,
        playerWins: roundsState.playerWins,
        botWins: roundsState.botWins,
      });
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
  if (roundsState.phase === 'buy') {
    startRound();
    input.requestLock();
  } else if (roundsState.phase === 'over') {
    if (roundsState.matchOver) {
      startMatch();
    } else {
      rounds.nextRound();
      showBuy();
    }
  } else if (roundsState.phase === 'start') {
    showBuy();
  } else if (roundsState.phase === 'live') {
    input.requestLock();
  }
});

hud.onBuySmg(() => {
  if (rounds.buySmg()) {
    arsenal.buy('smg');
    arsenal.select('smg');
    showBuy();
    syncHud();
  }
});

hud.onBuyFrag(() => {
  if (rounds.buyFrag()) {
    showBuy();
    syncHud();
  }
});

function step(dt) {
  elapsed += dt;
  body.speed = player.groundSpeed();
  if (roundsState.phase === 'live') {
    roundsState.timer -= dt;
    if (roundsState.timer <= 0 && !bombState.planted && !roundsState.roundOver) {
      endRound(false, 'Time expired — the charge was never planted.');
    }
  }
  player.step(dt, input.state.keys);
  arsenal.step(dt);
  grenade.step(dt, blastDamage);
  objective.step(dt, body.position, input.state.keys.has('KeyE') && body.alive && roundsState.phase === 'live');
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
    player.look(look.x, look.y);
    if (roundsState.phase === 'live' && body.alive) {
      if (input.state.firing && arsenal.ready()) {
        const def = arsenal.def();
        if (def.auto || input.pressed('MouseLeft')) shoot(shot ? 0 : arsenal.spread(player.groundSpeed()));
      }
      if (input.pressed('KeyR')) arsenal.reload();
      if (input.pressed('Digit1')) { arsenal.select('rifle'); syncHudAmmo(); }
      if (input.pressed('Digit2')) { arsenal.select('smg'); syncHudAmmo(); }
      if (input.pressed('Digit3')) { arsenal.select('pistol'); syncHudAmmo(); }
      if (input.pressed('KeyG') && rounds.useFrag()) {
        camera.getWorldDirection(direction);
        origin.copy(camera.position);
        grenade.throwFrom(origin, direction);
        hud.setFrags(roundsState.frags);
      }
    }
    if (input.pressed('KeyB') && roundsState.phase === 'buy') showBuy();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
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
    roundsState.round = 2;
    roundsState.playerWins = 1;
    roundsState.money = 1100;
    roundsState.frags = 1;
    roundsState.timer = 83;
    body.position.set(0, 0, 8);
    bots.items[0].position.set(-4.5, 0, -2);
    bots.items[0].state = 'engage';
    bots.items[0].lastKnown.set(0, 0, 8);
    bots.items[1].position.set(4.8, 0, -4.5);
    bots.items[1].state = 'engage';
    bots.items[1].lastKnown.set(0, 0, 8);
    settle(10);
    aimAt(new THREE.Vector3(-4.5, 1.2, -2));
    for (let round = 0; round < 3; round += 1) {
      shoot(0);
      settle(6);
    }
    settle(8);
    body.health = 100;
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
    roundsState.round = 4;
    roundsState.playerWins = 3;
    roundsState.botWins = 1;
    roundsState.matchOver = true;
    roundsState.matchWon = true;
    bots.items[0].alive = false;
    bots.items[0].state = 'dead';
    bots.items[0].fall = 1;
    bots.items[0].group.rotation.x = -1.5;
    bots.items[0].position.set(-3, 0, -1);
    body.position.set(0, 0, 6);
    settle(10);
    aimAt(new THREE.Vector3(-3, 1, -1));
    hud.showOverlay('match', { won: true, playerWins: 3, botWins: 1 });
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
if (shot) runShot(shot);
else {
  roundsState.phase = 'start';
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
