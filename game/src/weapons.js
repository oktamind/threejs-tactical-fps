// Three weapons, one job each in the buy menu: the VK-7 rifle (accurate, the
// default), the PDW-9 SMG (fast, wild on the move) and the P-12 pistol (slow,
// heavy, always in the holster). Every weapon owns its numbers; main.js owns
// the ray and the damage. Spread grows with movement speed, so stopping to
// aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  rifle: {
    id: 'rifle', name: 'VK-7 Rifle', key: 'Digit1', price: 0,
    mag: 30, reserve: 90, gap: 0.105, reload: 1.9, damage: 34, headDamage: 100,
    spreadStill: 0.0022, spreadMove: 0.026, auto: true, kick: 0.055, range: 80,
  },
  smg: {
    id: 'smg', name: 'PDW-9 SMG', key: 'Digit2', price: 900,
    mag: 32, reserve: 96, gap: 0.068, reload: 1.6, damage: 22, headDamage: 66,
    spreadStill: 0.006, spreadMove: 0.042, auto: true, kick: 0.038, range: 55,
  },
  pistol: {
    id: 'pistol', name: 'P-12 Pistol', key: 'Digit3', price: 0,
    mag: 12, reserve: 36, gap: 0.24, reload: 1.3, damage: 45, headDamage: 100,
    spreadStill: 0.003, spreadMove: 0.02, auto: false, kick: 0.07, range: 45,
  },
  sniper: {
    id: 'sniper', name: 'LR-8 Longshot', key: 'Digit4', price: 1200,
    mag: 5, reserve: 15, gap: 1.1, reload: 2.6, damage: 90, headDamage: 200,
    spreadStill: 0.0008, spreadMove: 0.03, auto: false, kick: 0.12, range: 100,
  },
};

const MUZZLE_TIME = 0.06;

function buildViewModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.7, metalness: 0.25 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.amber), roughness: 0.5, metalness: 0.2 });
  const model = new THREE.Group();
  if (def.id === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.3), body);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), grip);
    handle.position.set(0, -0.09, 0.1);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.02), accent);
    sight.position.set(0, 0.05, -0.12);
    model.add(slide, handle, sight);
    model.position.set(0.2, -0.22, -0.38);
  } else if (def.id === 'sniper') {
    // Longshot: a long thin barrel, a scope tube on top, a short stock.
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.34), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.62), grip);
    barrel.position.set(0, 0.02, -0.44);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 12), grip);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.085, -0.05);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.2), grip);
    stock.position.set(0, -0.02, 0.26);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.02, 0.16), accent);
    stripe.position.set(0, 0.05, -0.02);
    model.add(receiver, barrel, scope, stock, stripe);
    model.position.set(0.24, -0.2, -0.42);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.id === 'smg' ? 0.24 : 0.4), grip);
    barrel.position.set(0, 0.025, -0.34);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.02, 0.2), accent);
    stripe.position.set(0, 0.055, -0.05);
    model.add(receiver, barrel, stock, stripe);
    model.position.set(0.24, -0.2, -0.42);
  }
  return model;
}

export function createArsenal(camera) {
  const models = {};
  const flashMeshes = {};
  const flashLights = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildViewModel(def);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
    const flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }),
    );
    flash.position.set(0.24, -0.16, -1.05);
    flash.visible = false;
    camera.add(flash);
    flashMeshes[def.id] = flash;
    const light = new THREE.PointLight(new THREE.Color(PALETTE.amber), 0, 5);
    light.position.set(0.24, -0.16, -0.6);
    camera.add(light);
    flashLights[def.id] = light;
  }

  const owned = new Set(['rifle', 'pistol']);
  const ammo = {};
  for (const def of Object.values(WEAPONS)) ammo[def.id] = { mag: def.mag, reserve: def.reserve };
  let current = 'rifle';
  models.rifle.visible = true;
  const state = { cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };

  function def() {
    return WEAPONS[current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[current];
    model.position.z = (current === 'pistol' ? -0.38 : -0.42) + state.kick;
    model.rotation.x = state.kick * 2.2;
    const flash = flashMeshes[current];
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLights[current].intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def().mag - ammo[current].mag;
        const take = Math.min(need, ammo[current].reserve);
        ammo[current].mag += take;
        ammo[current].reserve -= take;
      }
    }
  }

  return {
    owned,
    current() {
      return current;
    },
    def,
    ammo() {
      return ammo[current];
    },
    step,
    ready() {
      return ammo[current].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = MUZZLE_TIME;
      state.kick = def().kick;
      // Light the flash at once, so the same frame that fires shows it.
      flashMeshes[current].visible = true;
      flashLights[current].intensity = 18;
    },
    takeRound() {
      if (ammo[current].mag <= 0) return false;
      ammo[current].mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || ammo[current].mag === def().mag || ammo[current].reserve === 0) return;
      state.reloadLeft = def().reload;
    },
    spread(speed, moveReference = 5.4) {
      const d = def();
      return d.spreadStill + Math.min(1, speed / moveReference) * d.spreadMove;
    },
    select(id) {
      if (!owned.has(id) || id === current) return false;
      models[current].visible = false;
      current = id;
      models[current].visible = true;
      state.cooldown = 0.25;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      return true;
    },
    buy(id) {
      if (owned.has(id)) return false;
      owned.add(id);
      return true;
    },
    refillAll() {
      for (const d of Object.values(WEAPONS)) {
        ammo[d.id] = { mag: d.mag, reserve: d.reserve };
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}
