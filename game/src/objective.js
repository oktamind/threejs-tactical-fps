// The objective: plant the charge at site A or B, then guard it while the fuse
// burns. Planting takes 3 s holding E inside a site ring; the fuse is 25 s;
// a living bot that reaches the planted charge defuses it in 3.5 s. The
// charge is one small blinking box, green while armed, so the player can
// always find it again.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { SITES as WORLD_SITES } from './world.js';

const PLANT_TIME = 3;
const FUSE_TIME = 25;

export function createObjective(scene) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.signal), roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(PALETTE.signal), emissiveIntensity: 0.4 }),
  );
  mesh.visible = false;
  mesh.castShadow = true;
  scene.add(mesh);
  const blink = new THREE.PointLight(new THREE.Color(PALETTE.signal), 0, 6);
  scene.add(blink);

  const state = {
    planted: false,
    detonated: false,
    defused: false,
    planting: false,
    plantProgress: 0,
    fuseLeft: 0,
    site: null,
    siteCenter: new THREE.Vector3(),
    beep: 0,
  };

  function siteAt(position) {
    for (const site of Object.values(WORLD_SITES)) {
      const dx = position.x - site.center.x;
      const dz = position.z - site.center.z;
      if (Math.hypot(dx, dz) < site.half) return site;
    }
    return null;
  }

  return {
    state,
    siteAt,
    step(dt, playerPos, holdingPlant) {
      if (state.planted) {
        state.fuseLeft -= dt;
        state.beep += dt;
        const on = Math.sin(state.beep * 10) > 0;
        blink.intensity = on ? 8 : 0;
        mesh.material.emissiveIntensity = on ? 1.2 : 0.3;
        if (state.fuseLeft <= 0) {
          state.detonated = true;
          mesh.visible = false;
          blink.intensity = 0;
        }
        return;
      }
      if (state.detonated || state.defused) return;
      const site = siteAt(playerPos);
      if (holdingPlant && site) {
        state.planting = true;
        state.plantProgress += dt / PLANT_TIME;
        if (state.plantProgress >= 1) {
          state.planted = true;
          state.planting = false;
          state.site = site;
          state.siteCenter.copy(site.center);
          state.fuseLeft = FUSE_TIME;
          mesh.visible = true;
          mesh.position.set(site.center.x, 0.12, site.center.z);
          blink.position.set(site.center.x, 0.6, site.center.z);
          blink.intensity = 8;
        }
      } else {
        state.planting = false;
        state.plantProgress = 0;
      }
    },
    reset() {
      state.planted = false;
      state.detonated = false;
      state.defused = false;
      state.planting = false;
      state.plantProgress = 0;
      state.fuseLeft = 0;
      state.site = null;
      state.beep = 0;
      mesh.visible = false;
      blink.intensity = 0;
    },
  };
}
