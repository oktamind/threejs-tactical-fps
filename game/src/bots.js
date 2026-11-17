// The defenders: four bots that patrol the two sites, hold positions, react to
// sight and sound, and converge to defuse a planted bomb. Each bot is a small
// state machine — patrol, alert, engage, defuse, dead — with a vision cone,
// a hearing radius and burst fire whose accuracy falls off with distance and
// with how fast its target moves. Bots move with the same axis-separated box
// collision as the player, so they never walk through a wall.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WAYPOINTS } from './world.js';

const HEALTH = 100;
const WALK_SPEED = 3.4;
const STRAFE_SPEED = 2.2;
const VISION_HALF_ANGLE = 0.96;
const HEAR_RADIUS = 26;
const BURST_MIN = 3;
const BURST_MAX = 5;
const SHOT_GAP = 0.16;

const BODY_MATERIAL = new THREE.MeshStandardMaterial({ color: new THREE.Color('#7a4a3a'), roughness: 0.65, metalness: 0.1 });
const VISOR_MATERIAL = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.amber), roughness: 0.4, metalness: 0.2, emissive: new THREE.Color(PALETTE.amber), emissiveIntensity: 0.35 });
const DARK_MATERIAL = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.85 });

// Three defender archetypes, one job each: the patrol Defender holds a site,
// the Rusher closes distance fast with a wild SMG, the Marksman holds long
// sightlines and hits hard but reacts slowly. The Warden is the boss of the
// campaign's final round: a 500-HP heavy that walks slowly, sees far and
// hits like a truck. The visor colour tells the player which one it is at a
// glance.
const ARCHETYPES = {
  patrol: { label: 'Defender', visor: PALETTE.amber, speed: 1, damage: 1, vision: 27, reaction: [0.7, 1.2], burstPause: 1.15, spread: 0.03 },
  rusher: { label: 'Rusher', visor: PALETTE.rust, speed: 1.35, damage: 0.8, vision: 20, reaction: [0.45, 0.8], burstPause: 0.8, spread: 0.045 },
  marksman: { label: 'Marksman', visor: PALETTE.signal, speed: 0.7, damage: 1.5, vision: 34, reaction: [1.0, 1.6], burstPause: 1.5, spread: 0.02 },
  warden: { label: 'Warden', visor: '#d43d2a', speed: 0.55, damage: 2.2, vision: 40, reaction: [1.2, 1.8], burstPause: 1.8, spread: 0.015 },
};

export const WARDEN_HEALTH = 500;

// The defenders get tougher as the match goes on: faster reactions, harder
// hits and quicker feet with every round.
function scaleBotDifficultyForRound(round) {
  return {
    reaction: Math.max(0.6, 1 - 0.06 * (round - 1)),
    damage: 1 + 0.08 * (round - 1),
    speed: 1 + 0.05 * (round - 1),
  };
}

const TORSO_GEO = new THREE.BoxGeometry(0.54, 0.8, 0.32);
const HEAD_GEO = new THREE.SphereGeometry(0.16, 14, 10);
const LEG_GEO = new THREE.BoxGeometry(0.2, 0.72, 0.22);
const GUN_GEO = new THREE.BoxGeometry(0.08, 0.1, 0.55);

export function createBots(scene, colliders, shootables, random) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const items = [];
  const hitMeshes = [];
  const probe = new THREE.Box3();
  const toTarget = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const chest = new THREE.Vector3();
  const head = new THREE.Vector3();

  const spawns = [
    { x: -14, z: -11, route: [0, 1, 2, 3], archetype: 'patrol' },
    { x: -10, z: -6, route: [3, 2, 1, 0], archetype: 'rusher' },
    { x: 14, z: -11, route: [4, 5, 6, 7], archetype: 'marksman' },
    { x: 10, z: -6, route: [7, 6, 5, 4], archetype: 'patrol' },
  ];

  for (let index = 0; index < spawns.length; index += 1) {
    const spawn = spawns[index];
    const archetype = ARCHETYPES[spawn.archetype];
    const visorMaterial = VISOR_MATERIAL.clone();
    visorMaterial.color.set(new THREE.Color(archetype.visor));
    visorMaterial.emissive.set(new THREE.Color(archetype.visor));
    const group = new THREE.Group();
    group.position.set(spawn.x, 0, spawn.z);

    const torso = new THREE.Mesh(TORSO_GEO, BODY_MATERIAL);
    torso.position.y = 1.05;
    const headMesh = new THREE.Mesh(HEAD_GEO, visorMaterial);
    headMesh.position.y = 1.6;
    const legL = new THREE.Mesh(LEG_GEO, DARK_MATERIAL);
    legL.position.set(-0.14, 0.36, 0);
    const legR = new THREE.Mesh(LEG_GEO, DARK_MATERIAL);
    legR.position.set(0.14, 0.36, 0);
    const gun = new THREE.Mesh(GUN_GEO, DARK_MATERIAL);
    gun.position.set(0.24, 1.05, -0.2);
    group.add(torso, headMesh, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);

    const item = {
      id: index,
      group, torso, headMesh, visorMaterial,
      archetype: spawn.archetype,
      spawnArchetype: spawn.archetype,
      label: archetype.label,
      visionRange: archetype.vision,
      difficulty: scaleBotDifficultyForRound(1),
      health: HEALTH, maxHealth: HEALTH, alive: true,
      position: group.position,
      yaw: Math.PI,
      state: 'patrol',
      route: spawn.route, routeIndex: index % 2 === 0 ? 0 : 2,
      lastKnown: new THREE.Vector3(),
      seeTimer: random() * 0.15,
      burstLeft: 0, shotTimer: 0, pauseTimer: 0,
      strafeDir: 1, strafeTimer: 0,
      defuseLeft: 0,
      fall: 0,
      home: new THREE.Vector3(spawn.x, 0, spawn.z),
    };
    torso.userData.bot = item;
    torso.userData.part = 'torso';
    headMesh.userData.bot = item;
    headMesh.userData.part = 'head';
    hitMeshes.push(torso, headMesh);
    items.push(item);
  }

  function overlaps(x, z) {
    probe.min.set(x - 0.34, 0.04, z - 0.34);
    probe.max.set(x + 0.34, 1.68, z + 0.34);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return true;
    }
    return false;
  }

  function canSee(bot, playerPos, playerEye) {
    eye.set(bot.position.x, 1.55, bot.position.z);
    toTarget.set(playerPos.x - eye.x, playerEye - 1.55, playerPos.z - eye.z);
    const distance = toTarget.length();
    if (distance > bot.visionRange) return false;
    toTarget.normalize();
    const facing = Math.sin(bot.yaw) * -toTarget.x + Math.cos(bot.yaw) * -toTarget.z;
    if (facing < Math.cos(VISION_HALF_ANGLE)) return false;
    dir.copy(toTarget);
    raycaster.set(eye, dir);
    raycaster.far = distance;
    const hit = raycaster.intersectObjects(shootables, false)[0];
    return !hit;
  }

  function moveToward(bot, target, dt, speed) {
    toTarget.set(target.x - bot.position.x, 0, target.z - bot.position.z);
    const distance = toTarget.length();
    if (distance < 0.05) return true;
    toTarget.normalize();
    bot.yaw = Math.atan2(-toTarget.x, -toTarget.z);
    const stepX = toTarget.x * speed * dt;
    const stepZ = toTarget.z * speed * dt;
    if (!overlaps(bot.position.x + stepX, bot.position.z)) bot.position.x += stepX;
    if (!overlaps(bot.position.x, bot.position.z + stepZ)) bot.position.z += stepZ;
    return distance < 0.4;
  }

  function damage(mesh, amount) {
    const bot = mesh.userData.bot;
    if (!bot || !bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.state = 'dead';
    bot.fall = 0;
    return true;
  }

  function hear(position) {
    for (const bot of items) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.position.x - position.x, bot.position.z - position.z);
      if (d < HEAR_RADIUS && bot.state === 'patrol') {
        bot.state = 'alert';
        bot.lastKnown.set(position.x, 0, position.z);
      }
    }
  }

  function step(dt, player, bomb, onBotShot) {
    const playerPos = player.position;
    const playerEye = playerPos.y + player.eye;
    for (const bot of items) {
      if (!bot.alive) {
        bot.fall = Math.min(1, bot.fall + dt / 0.45);
        bot.group.rotation.x = -bot.fall * 1.5;
        continue;
      }
      bot.seeTimer -= dt;
      let seen = false;
      if (bot.seeTimer <= 0) {
        bot.seeTimer = 0.15 + random() * 0.05;
        seen = player.alive && canSee(bot, playerPos, playerEye);
        if (seen) {
          bot.lastKnown.set(playerPos.x, 0, playerPos.z);
          if (bot.state !== 'engage') {
            bot.state = 'engage';
            bot.burstLeft = 0;
            const react = ARCHETYPES[bot.archetype].reaction;
            bot.pauseTimer = (react[0] + random() * (react[1] - react[0])) * bot.difficulty.reaction;
          }
        } else if (bot.state === 'engage') {
          bot.state = 'alert';
        }
      }

      if (bomb && bomb.planted && !bomb.detonated && !bomb.defused) {
        if (bot.state !== 'defuse' && bot.state !== 'engage') {
          bot.state = 'defuse';
          bot.defuseLeft = 0;
        }
      }

      if (bot.state === 'patrol') {
        const target = WAYPOINTS[bot.route[bot.routeIndex]];
        if (moveToward(bot, target, dt, WALK_SPEED * ARCHETYPES[bot.archetype].speed * bot.difficulty.speed)) {
          bot.routeIndex = (bot.routeIndex + 1) % bot.route.length;
        }
      } else if (bot.state === 'alert') {
        if (moveToward(bot, bot.lastKnown, dt, WALK_SPEED * 1.15 * ARCHETYPES[bot.archetype].speed * bot.difficulty.speed)) {
          bot.state = 'patrol';
        }
      } else if (bot.state === 'defuse' && bomb) {
        const site = bomb.siteCenter;
        if (moveToward(bot, { x: site.x, z: site.z }, dt, WALK_SPEED * 1.2 * ARCHETYPES[bot.archetype].speed * bot.difficulty.speed)) {
          bot.defuseLeft += dt;
          bot.yaw = Math.atan2(-(site.x - bot.position.x), -(site.z - bot.position.z));
          if (bot.defuseLeft >= 3.5) bomb.defused = true;
        }
      } else if (bot.state === 'engage' && player.alive) {
        // Face the player and strafe while firing in bursts.
        toTarget.set(playerPos.x - bot.position.x, 0, playerPos.z - bot.position.z);
        const distance = toTarget.length();
        bot.yaw = Math.atan2(-toTarget.x, -toTarget.z);
        bot.strafeTimer -= dt;
        if (bot.strafeTimer <= 0) {
          bot.strafeTimer = 0.7 + random() * 0.9;
          bot.strafeDir = random() < 0.5 ? -1 : 1;
        }
        const sideX = Math.cos(bot.yaw) * bot.strafeDir;
        const sideZ = -Math.sin(bot.yaw) * bot.strafeDir;
        const strafe = STRAFE_SPEED * ARCHETYPES[bot.archetype].speed;
        const nx = bot.position.x + sideX * strafe * dt;
        const nz = bot.position.z + sideZ * strafe * dt;
        if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
        if (!overlaps(bot.position.x, nz)) bot.position.z = nz;

        bot.pauseTimer -= dt;
        if (bot.burstLeft > 0) {
          bot.shotTimer -= dt;
          if (bot.shotTimer <= 0) {
            bot.shotTimer = SHOT_GAP;
            bot.burstLeft -= 1;
            if (bot.burstLeft === 0) bot.pauseTimer = ARCHETYPES[bot.archetype].burstPause;
            // Hitscan with spread: accuracy falls with distance and target speed.
            const spread = ARCHETYPES[bot.archetype].spread + distance * 0.002 + player.speed * 0.005;
            eye.set(bot.position.x, 1.5, bot.position.z);
            dir.set(playerPos.x - eye.x, playerEye - 1.5, playerPos.z - eye.z).normalize();
            dir.x += (random() * 2 - 1) * spread;
            dir.y += (random() * 2 - 1) * spread;
            dir.z += (random() * 2 - 1) * spread;
            dir.normalize();
            raycaster.set(eye, dir);
            raycaster.far = distance + 2;
            const blocked = raycaster.intersectObjects(shootables, false)[0];
            let shotDamage = 0;
            let shotHead = false;
            if (!blocked) {
              chest.set(playerPos.x, playerPos.y + player.eye * 0.72, playerPos.z);
              head.set(playerPos.x, playerPos.y + player.eye * 0.95, playerPos.z);
              shotHead = closestDistance(eye, dir, head) < 0.26;
              const hitBody = closestDistance(eye, dir, chest) < 0.5;
              if (shotHead || hitBody) {
                const base = shotHead ? 22 : 9 + Math.floor(random() * 5);
                shotDamage = Math.round(base * ARCHETYPES[bot.archetype].damage * bot.difficulty.damage);
              }
            }
            if (onBotShot) onBotShot(shotDamage, shotHead, bot);
          }
        } else if (bot.pauseTimer <= 0 && distance < bot.visionRange) {
          bot.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
          bot.shotTimer = 0;
        }
      }
      bot.group.rotation.y = bot.yaw;
    }
  }

  function closestDistance(origin, direction, point) {
    const px = point.x - origin.x;
    const py = point.y - origin.y;
    const pz = point.z - origin.z;
    const t = px * direction.x + py * direction.y + pz * direction.z;
    if (t < 0) return Infinity;
    const cx = origin.x + direction.x * t - point.x;
    const cy = origin.y + direction.y * t - point.y;
    const cz = origin.z + direction.z * t - point.z;
    return Math.hypot(cx, cy, cz);
  }

  // A new round re-deals the defenders. In the campaign's boss round the
  // third defender becomes the Warden: 500 HP, a 1.5x frame and a crimson
  // visor. Later nights also scale difficulty as if they were later rounds.
  function reset(round = 1, options = {}) {
    const night = options.night ?? 1;
    const bossRound = options.bossRound ?? false;
    for (const bot of items) {
      const isWarden = bossRound && bot.id === 2;
      bot.archetype = isWarden ? 'warden' : bot.spawnArchetype;
      const archetype = ARCHETYPES[bot.archetype];
      bot.label = archetype.label;
      bot.visionRange = archetype.vision;
      bot.maxHealth = isWarden ? WARDEN_HEALTH : HEALTH;
      bot.health = bot.maxHealth;
      bot.alive = true;
      bot.state = 'patrol';
      bot.difficulty = scaleBotDifficultyForRound(round + (night - 1) * 2);
      bot.routeIndex = bot.id % 2 === 0 ? 0 : 2;
      bot.position.copy(bot.home);
      bot.yaw = Math.PI;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.scale.setScalar(isWarden ? 1.5 : 1);
      bot.visorMaterial.color.set(new THREE.Color(archetype.visor));
      bot.visorMaterial.emissive.set(new THREE.Color(archetype.visor));
      bot.lastKnown.set(0, 0, 0);
      bot.burstLeft = 0;
      bot.pauseTimer = 0;
      bot.defuseLeft = 0;
      bot.fall = 0;
    }
  }

  return {
    items,
    hitMeshes,
    damage,
    hear,
    step,
    reset,
    // The live boss, or null when there is none or it is already down.
    boss() {
      return items.find((bot) => bot.archetype === 'warden' && bot.alive) ?? null;
    },
    aliveCount() {
      return items.filter((bot) => bot.alive).length;
    },
  };
}
