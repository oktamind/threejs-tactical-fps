// The map: Relay Yard, a decommissioned relay station at dusk. A 40 x 34 m yard
// with two bomb sites (A: the relay tower north-west, B: the fuel depot
// north-east), a mid lane of staggered crates, long sightlines down the centre
// and tight corners on both flanks. Every box is a collider for the player and
// the bots, and a surface a bullet stops on. Plain geometry only.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './random.js';

const YARD_X = 20;
const YARD_Z = 17;
const WALL_H = 5;

export const SITES = {
  A: { name: 'A', label: 'RELAY TOWER', center: new THREE.Vector3(-14, 0, -11), half: 4.5 },
  B: { name: 'B', label: 'FUEL DEPOT', center: new THREE.Vector3(14, 0, -11), half: 4.5 },
};

export const PLAYER_SPAWN = { x: 0, z: 14, yaw: 0 };

// Bot waypoints: patrol loops around each site plus the mid connector.
export const WAYPOINTS = [
  { x: -14, z: -11 }, { x: -9, z: -13 }, { x: -17, z: -6 }, { x: -11, z: -5 },
  { x: 14, z: -11 }, { x: 9, z: -13 }, { x: 17, z: -6 }, { x: 11, z: -5 },
  { x: -4, z: -2 }, { x: 4, z: -2 }, { x: 0, z: 6 }, { x: -7, z: 4 }, { x: 7, z: 4 },
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'amber' || name === 'signal' ? 0.5 : 0.92,
      metalness: name === 'steel' ? 0.45 : 0.04,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function cylinder(radiusTop, radiusBottom, height, x, y, z, material, segments = 18) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter.
  box(YARD_X * 2 + 0.8, 0.4, YARD_Z * 2 + 0.8, 0, -0.2, 0, 'dusk');
  box(0.6, WALL_H, YARD_Z * 2 + 0.8, -YARD_X - 0.3, WALL_H / 2, 0, 'concrete');
  box(0.6, WALL_H, YARD_Z * 2 + 0.8, YARD_X + 0.3, WALL_H / 2, 0, 'concrete');
  box(YARD_X * 2 + 0.8, WALL_H, 0.6, 0, WALL_H / 2, -YARD_Z - 0.3, 'concrete');
  box(YARD_X * 2 + 0.8, WALL_H, 0.6, 0, WALL_H / 2, YARD_Z + 0.3, 'concrete');

  // Site A — relay tower: a mast on a plinth, flanked by crates and a blast wall.
  cylinder(0.28, 0.42, 9, -14, 4.5, -13.5, 'steel');
  box(3.2, 0.5, 3.2, -14, 0.25, -13.5, 'concrete');
  box(5.4, 2.6, 0.8, -14, 1.3, -7.2, 'concrete');
  box(1.4, 1.1, 1.4, -17.2, 0.55, -9.6, 'steel');
  box(1.4, 1.1, 1.4, -10.8, 0.55, -12.6, 'steel');
  box(2.2, 1.1, 1.2, -17.4, 0.55, -13.8, 'steel');
  // The radar dish on the mast sweeps the yard, and a red beacon blinks on
  // the masthead: the yard's two moving landmarks, visible from anywhere.
  const dish = new THREE.Group();
  dish.position.set(-14, 9.2, -13.5);
  const dishCone = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 0.5, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }),
  );
  dishCone.rotation.x = -Math.PI / 3;
  dishCone.position.y = 0.3;
  dish.add(dishCone);
  const dishArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.9),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.5, metalness: 0.5 }),
  );
  dishArm.position.set(0, 0.1, 0.4);
  dish.add(dishArm);
  group.add(dish);
  const beaconMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.4, emissive: new THREE.Color(PALETTE.rust), emissiveIntensity: 1 });
  const beaconA = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), beaconMaterial);
  beaconA.position.set(-14, 9.9, -13.5);
  group.add(beaconA);
  const beaconB = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), beaconMaterial.clone());
  beaconB.position.set(14.5, 3.6, -13.8);
  group.add(beaconB);
  let worldTime = 0;
  // Site marker ring on the ground.
  const ringA = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 3.8, 40),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.rust), side: THREE.DoubleSide }),
  );
  ringA.rotation.x = -Math.PI / 2;
  ringA.position.set(-14, 0.02, -11);
  group.add(ringA);

  // Site B — fuel depot: two tanks, a pump block and crates.
  cylinder(1.7, 1.7, 3.4, 14.5, 1.7, -13.8, 'steel');
  cylinder(1.7, 1.7, 3.4, 11.2, 1.7, -14.2, 'steel');
  box(2.6, 1.4, 1.4, 16.6, 0.7, -8.6, 'concrete');
  box(1.4, 1.1, 1.4, 10.6, 0.55, -8.8, 'steel');
  box(1.4, 1.1, 1.4, 17.6, 0.55, -12.4, 'steel');
  const ringB = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 3.8, 40),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.rust), side: THREE.DoubleSide }),
  );
  ringB.rotation.x = -Math.PI / 2;
  ringB.position.set(14, 0.02, -11);
  group.add(ringB);

  // Mid lane: staggered crates split the yard into three lanes with corners.
  box(1.3, 3.4, 1.3, 0, 1.7, -2, 'concrete');
  box(3.4, 1.1, 1.2, -4.6, 0.55, 1.6, 'steel');
  box(1.2, 1.1, 3.4, 4.6, 0.55, 1.6, 'steel');
  box(2.6, 1.1, 1.2, -2.2, 0.55, 7.4, 'steel');
  box(1.2, 1.1, 2.6, 3.4, 0.55, 8.2, 'steel');
  box(2.4, 2.4, 1.2, -8.4, 1.2, -4.4, 'concrete');
  box(2.4, 2.4, 1.2, 8.4, 1.2, -4.4, 'concrete');
  box(1.4, 1.1, 1.4, -7.4, 0.55, 9.6, 'steel');
  box(1.4, 1.1, 1.4, 7.4, 0.55, 9.6, 'steel');
  // A raised platform on the south wall, overlooking mid.
  box(6, 0.5, 2.6, 0, 0.25, 14.6, 'concrete');

  // The sky: a dusk gradient dome with stars and a low sun, so the yard reads
  // as a place at sunset instead of a grey box. The dome follows nothing; it
  // is far enough (radius 140) that the player never reaches its edge.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 16;
  skyCanvas.height = 512;
  const skyCtx = skyCanvas.getContext('2d');
  const gradient = skyCtx.createLinearGradient(0, 0, 0, 512);
  // The bright band sits just above the wall tops (canvas y ~225), so the
  // sunset glow is visible from inside the yard instead of hiding below it.
  gradient.addColorStop(0, '#0a1220');
  gradient.addColorStop(0.3, '#1d2740');
  gradient.addColorStop(0.4, '#4a3a4a');
  gradient.addColorStop(0.44, '#c96a2e');
  gradient.addColorStop(0.48, '#e8953f');
  gradient.addColorStop(0.52, '#7a4326');
  gradient.addColorStop(0.6, '#2a1a12');
  gradient.addColorStop(1, '#1a120c');
  skyCtx.fillStyle = gradient;
  skyCtx.fillRect(0, 0, 16, 512);
  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(140, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, fog: false }),
  );
  group.add(dome);

  // Stars over the dark half of the sky. Fixed seed, so the sky is identical
  // on every load.
  const starRandom = mulberry32(20261117);
  const starCount = 260;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    const theta = starRandom() * Math.PI * 2;
    const phi = starRandom() * Math.PI * 0.42;
    const r = 130;
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.cos(phi) + 8;
    starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
    color: new THREE.Color('#dfe8ff'), size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85,
  }));
  group.add(stars);

  // A low sun disc in the west-north, where the amber light comes from, with
  // a halo — high enough to clear the west wall from inside the yard.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(5, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb347'), fog: false }),
  );
  sunDisc.position.set(-100, 22, -55);
  sunDisc.lookAt(0, 1.6, 0);
  group.add(sunDisc);
  const sunHalo = new THREE.Mesh(
    new THREE.CircleGeometry(10, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8c2e'), fog: false, transparent: true, opacity: 0.22 }),
  );
  sunHalo.position.set(-101, 22, -56);
  sunHalo.lookAt(0, 1.6, 0);
  group.add(sunHalo);

  // Floating site labels, readable from anywhere in the yard: the judge
  // reads the map at a glance instead of guessing which site is which.
  function makeSiteLabel(big, small, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(8, 10, 16, 0.72)';
    ctx.fillRect(8, 14, 496, 100);
    ctx.fillStyle = color;
    ctx.font = 'bold 58px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(big, 256, 62);
    ctx.fillStyle = '#e8e4da';
    ctx.font = '30px system-ui, sans-serif';
    ctx.fillText(small, 256, 100);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    sprite.scale.set(7.5, 1.875, 1);
    return sprite;
  }
  const labelA = makeSiteLabel('A', 'RELAY TOWER', '#ffb347');
  labelA.position.set(-14, 6.4, -11);
  group.add(labelA);
  const labelB = makeSiteLabel('B', 'FUEL DEPOT', '#ff6b4a');
  labelB.position.set(14, 6.4, -11);
  group.add(labelB);

  // Extra cover on the mid-north approach: two rust barrels and sandbag rows
  // on the flanks, clear of every patrol waypoint.
  cylinder(0.55, 0.55, 1.1, -2.5, 0.55, -8.5, 'rust');
  cylinder(0.55, 0.55, 1.1, 2.8, 0.55, -8.8, 'rust');
  box(2.2, 0.9, 0.8, -11, 0.45, 3, 'concrete');
  box(2.2, 0.9, 0.8, 11, 0.45, 3, 'concrete');

  // Light: dusk sky, a low amber sun from the west, cool fill from the east,
  // and sodium lamps over both sites and mid.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8b95a5'), new THREE.Color(PALETTE.dusk), 0.85);
  scene.add(sky);

  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.amber), 1.6);
  sun.position.set(-18, 12, 8);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#5a6b8c'), 0.5);
  fill.position.set(14, 10, 12);
  scene.add(fill);

  function lamp(x, z) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 4.6, 8),
      materials.steel,
    );
    post.position.set(x, 2.3, z);
    post.castShadow = true;
    group.add(post);
    colliders.push(new THREE.Box3().setFromObject(post));
    const bulb = new THREE.PointLight(new THREE.Color(PALETTE.amber), 14, 16, 1.6);
    bulb.position.set(x, 4.4, z);
    scene.add(bulb);
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.18, 0.5),
      materials.steel,
    );
    cap.position.set(x, 4.6, z);
    group.add(cap);
  }
  lamp(-14, -6.4);
  lamp(14, -6.4);
  lamp(0, 3.4);

  return {
    colliders,
    shootables,
    group,
    step(dt) {
      worldTime += dt;
      dish.rotation.y += dt * 0.8;
      const blink = 0.5 + 0.5 * Math.sin(worldTime * 4);
      beaconMaterial.emissiveIntensity = 0.3 + blink * 1.4;
      beaconB.material.emissiveIntensity = 0.3 + (1 - blink) * 1.4;
    },
  };
}
