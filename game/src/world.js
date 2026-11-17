// The map: Relay Yard, a decommissioned relay station at dusk. A 40 x 34 m yard
// with two bomb sites (A: the relay tower north-west, B: the fuel depot
// north-east), a mid lane of staggered crates, long sightlines down the centre
// and tight corners on both flanks. Every box is a collider for the player and
// the bots, and a surface a bullet stops on. Plain geometry only.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

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
      materials.amber,
    );
    cap.position.set(x, 4.6, z);
    group.add(cap);
  }
  lamp(-14, -6.4);
  lamp(14, -6.4);
  lamp(0, 3.4);

  return { colliders, shootables, group };
}
