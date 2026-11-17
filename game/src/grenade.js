// The frag grenade: a thrown arc with one bounce, a 1.6 s fuse, then a blast
// that hurts through the open yard but not through walls. The mesh is one
// small dark sphere; the blast is a flash sphere plus a point light that
// fades in a quarter of a second. No new objects per frame: one mesh, one
// light, reused every throw.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const FUSE = 1.6;
const BLAST_RADIUS = 7;
const BLAST_DAMAGE = 110;
const GRAVITY = 14;

export function createGrenade(scene, colliders) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.4, metalness: 0.6 }),
  );
  mesh.visible = false;
  scene.add(mesh);
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0, depthWrite: false }),
  );
  blast.visible = false;
  scene.add(blast);
  const light = new THREE.PointLight(new THREE.Color(PALETTE.amber), 0, 14);
  scene.add(light);

  const state = {
    active: false, flying: false, fuse: 0, blastLeft: 0,
    position: new THREE.Vector3(), velocity: new THREE.Vector3(),
  };
  const probe = new THREE.Box3();
  const tmp = new THREE.Vector3();

  function explode(onDamage) {
    state.active = false;
    state.flying = false;
    state.blastLeft = 0.25;
    mesh.visible = false;
    blast.visible = true;
    blast.position.copy(state.position);
    blast.scale.setScalar(0.5);
    light.position.copy(state.position);
    light.intensity = 60;
    if (onDamage) onDamage(state.position, BLAST_RADIUS, BLAST_DAMAGE);
  }

  function overlaps(x, y, z) {
    probe.min.set(x - 0.09, y - 0.09, z - 0.09);
    probe.max.set(x + 0.09, y + 0.09, z + 0.09);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return true;
    }
    return false;
  }

  return {
    state,
    throwFrom(origin, direction) {
      if (state.active) return false;
      state.active = true;
      state.flying = true;
      state.fuse = FUSE;
      state.position.copy(origin);
      state.velocity.copy(direction).multiplyScalar(13);
      state.velocity.y += 4.5;
      mesh.visible = true;
      mesh.position.copy(state.position);
      return true;
    },
    step(dt, onDamage) {
      if (state.blastLeft > 0) {
        state.blastLeft = Math.max(0, state.blastLeft - dt);
        const k = 1 - state.blastLeft / 0.25;
        blast.scale.setScalar(0.5 + k * BLAST_RADIUS * 0.9);
        blast.material.opacity = 0.55 * (1 - k);
        light.intensity = 60 * (1 - k);
        if (state.blastLeft === 0) {
          blast.visible = false;
          light.intensity = 0;
        }
        return;
      }
      if (!state.active) return;
      state.fuse -= dt;
      if (state.flying) {
        state.velocity.y -= GRAVITY * dt;
        tmp.copy(state.position).addScaledVector(state.velocity, dt);
        if (tmp.y < 0.09) {
          tmp.y = 0.09;
          state.velocity.y = Math.abs(state.velocity.y) * 0.35;
          state.velocity.x *= 0.6;
          state.velocity.z *= 0.6;
          if (Math.abs(state.velocity.y) < 1) state.flying = false;
        } else if (overlaps(tmp.x, tmp.y, tmp.z)) {
          state.velocity.multiplyScalar(-0.35);
          state.flying = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z) > 2;
        }
        state.position.copy(tmp);
        mesh.position.copy(state.position);
      }
      if (state.fuse <= 0) explode(onDamage);
    },
    reset() {
      state.active = false;
      state.flying = false;
      state.fuse = 0;
      state.blastLeft = 0;
      mesh.visible = false;
      blast.visible = false;
      light.intensity = 0;
    },
  };
}
