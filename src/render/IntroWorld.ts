import * as THREE from "three";
import { ASSETS } from "./assets";

type TextureLoader = (url: string, repeat?: [number, number]) => THREE.Texture;

export interface IntroWorld {
  scene: THREE.Scene;
  door: THREE.Group;
  mainDoor: THREE.Group;
  kickLeg: THREE.Group;
  fluorescent: THREE.PointLight;
  clubLights: THREE.SpotLight[];
  clubTiles: THREE.Mesh[];
  clubCrowd: THREE.Group[];
}

interface CatwalkFeatures {
  mainDoor: THREE.Group;
  clubLights: THREE.SpotLight[];
  clubTiles: THREE.Mesh[];
  clubCrowd: THREE.Group[];
}

function cropTexture(source: THREE.Texture, repeat: [number, number], offset: [number, number]): THREE.Texture {
  const texture = source.clone();
  texture.needsUpdate = true;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.offset.set(...offset);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function buildGraffiti(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 330;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(38, 270);
    context.rotate(-0.04);
    context.font = "900 220px Arial Narrow, Impact, sans-serif";
    context.lineWidth = 12;
    context.strokeStyle = "rgba(19, 5, 6, .38)";
    context.fillStyle = "rgba(43, 10, 11, .92)";
    context.strokeText("AFRAID?", 0, 0);
    context.fillText("AFRAID?", 0, 0);
    context.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function addShadowCasting(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}

function makeSink(metal: THREE.Material, ceramic: THREE.Material, grime: THREE.Material): THREE.Group {
  const sink = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.052, 12, 36), ceramic);
  rim.rotation.x = Math.PI / 2;
  rim.scale.z = 0.7;
  rim.position.y = 0.024;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.13, 0.11, 28, 1, false), ceramic);
  bowl.position.y = -0.025;
  bowl.scale.z = 0.74;
  const stain = new THREE.Mesh(new THREE.CircleGeometry(0.16, 28), grime);
  stain.rotation.x = -Math.PI / 2;
  stain.scale.y = 0.7;
  stain.position.y = 0.036;
  const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.012, 14), metal);
  drain.position.y = 0.043;

  const faucetBase = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.048, 0.11, 12), metal);
  faucetBase.position.set(0, 0.11, -0.28);
  const faucetStem = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.03, 0.25, 12), metal);
  faucetStem.position.set(0, 0.275, -0.28);
  const spout = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 10, 18, Math.PI), metal);
  spout.rotation.set(Math.PI / 2, 0, 0);
  spout.position.set(0, 0.37, -0.18);
  for (const x of [-0.16, 0.16]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.052, 0.05, 10), metal);
    knob.position.set(x, 0.11, -0.28);
    const crossA = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.018), metal);
    const crossB = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.12), metal);
    crossA.position.set(x, 0.15, -0.28);
    crossB.position.copy(crossA.position);
    sink.add(knob, crossA, crossB);
  }
  sink.add(rim, bowl, stain, drain, faucetBase, faucetStem, spout);
  addShadowCasting(sink);
  return sink;
}

function makeFluorescent(scene: THREE.Scene, x: number, z: number): void {
  const housingMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2928, roughness: 0.7, metalness: 0.62 });
  const housing = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.09, 0.3), housingMaterial);
  housing.position.set(x, 3.34, z);
  housing.castShadow = true;
  const diffuser = new THREE.Mesh(
    new THREE.BoxGeometry(1.54, 0.03, 0.16),
    new THREE.MeshStandardMaterial({ color: 0xffe3d6, emissive: 0xffbba9, emissiveIntensity: 3.6, roughness: 0.42 }),
  );
  diffuser.position.set(x, 3.28, z);
  scene.add(housing, diffuser);
}

function makeClubSign(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#080507";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.shadowColor = "#fa355f";
    context.shadowBlur = 34;
    context.strokeStyle = "#ff315a";
    context.lineWidth = 10;
    context.font = "900 102px Arial Narrow, Impact, sans-serif";
    context.strokeText("JIM'S", canvas.width / 2, 100);
    context.fillStyle = "#ffd9d9";
    context.fillText("JIM'S", canvas.width / 2, 100);
    context.shadowColor = "#37d8ff";
    context.shadowBlur = 22;
    context.fillStyle = "#76e6ff";
    context.font = "700 43px monospace";
    context.fillText("BASEMENT CLUB", canvas.width / 2, 194);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function makeKickLeg(): THREE.Group {
  const leg = new THREE.Group();
  leg.name = "first-person-kick";
  leg.visible = false;
  const denim = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.96 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x130e0d, roughness: 0.58, metalness: 0.08 });
  const soleMaterial = new THREE.MeshStandardMaterial({ color: 0x050404, roughness: 0.88 });

  const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.72, 7, 12), denim);
  shin.rotation.x = Math.PI / 2;
  shin.position.z = 0.28;
  const boot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.23, 0.66, 3, 2, 5), leather);
  boot.position.set(0, -0.035, -0.42);
  boot.rotation.x = -0.08;
  const toe = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 10), leather);
  toe.scale.set(0.92, 0.67, 1.15);
  toe.position.set(0, -0.035, -0.76);
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.055, 0.75), soleMaterial);
  sole.position.set(0, -0.145, -0.48);
  sole.rotation.x = -0.05;
  const welt = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 7, 18, Math.PI), soleMaterial);
  welt.rotation.x = Math.PI / 2;
  welt.position.set(0, -0.1, -0.83);
  const heel = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.18), soleMaterial);
  heel.position.set(0, -0.16, -0.15);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.18, 14), leather);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = -0.08;
  const laceMaterial = new THREE.MeshStandardMaterial({ color: 0x493a35, roughness: 0.86 });
  for (let index = 0; index < 4; index += 1) {
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.012, 0.018), laceMaterial);
    lace.position.set(0, 0.095, -0.31 - index * 0.09);
    lace.rotation.x = -0.08;
    leg.add(lace);
  }
  leg.add(shin, boot, toe, sole, welt, heel, cuff);
  addShadowCasting(leg);
  return leg;
}

function buildNightclub(catwalk: THREE.Group, metal: THREE.Material): Pick<CatwalkFeatures, "clubLights" | "clubTiles" | "clubCrowd"> {
  const clubTiles: THREE.Mesh[] = [];
  const clubCrowd: THREE.Group[] = [];
  const clubLights: THREE.SpotLight[] = [];
  const danceFloor = new THREE.Group();
  danceFloor.name = "nightclub-below-catwalk";
  const colors = [0xb91f3e, 0x24798f, 0x8d1d33, 0x315c68];
  const tileGeometry = new THREE.BoxGeometry(0.72, 0.07, 0.67);
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 9; column += 1) {
      const color = colors[(row * 3 + column) % colors.length];
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).multiplyScalar(0.035),
        emissive: color,
        emissiveIntensity: 0.07,
        roughness: 0.68,
        metalness: 0.42,
      });
      const tile = new THREE.Mesh(tileGeometry, material);
      tile.position.set(3.1 + column * 0.76, -3.12, -9.18 + row * 0.72);
      tile.receiveShadow = true;
      tile.userData.clubPhase = row * 0.55 + column * 0.37;
      clubTiles.push(tile);
      danceFloor.add(tile);
    }
  }

  const stageMaterial = new THREE.MeshStandardMaterial({ color: 0x161317, roughness: 0.8, metalness: 0.48 });
  const stage = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.45, 5.9), stageMaterial);
  stage.position.set(9.73, -2.92, -6.65);
  stage.castShadow = true;
  danceFloor.add(stage);
  const booth = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.76, 2.28), stageMaterial);
  booth.position.set(9.25, -2.33, -6.65);
  booth.rotation.z = -0.04;
  danceFloor.add(booth);

  const speakerCase = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.72, metalness: 0.28 });
  const speakerCone = new THREE.MeshStandardMaterial({ color: 0x17191d, emissive: 0x240811, emissiveIntensity: 0.22, roughness: 0.9 });
  for (const z of [-9.12, -4.18]) {
    const stack = new THREE.Group();
    for (const y of [-2.5, -1.45]) {
      const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.94, 1.02), speakerCase);
      cabinet.position.set(9.88, y, z);
      const woofer = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.23, 0.04, 22), speakerCone);
      woofer.rotation.z = Math.PI / 2;
      woofer.position.set(9.58, y, z);
      stack.add(cabinet, woofer);
    }
    danceFloor.add(stack);
  }

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 0.84),
    new THREE.MeshBasicMaterial({ map: makeClubSign(), toneMapped: false }),
  );
  sign.position.set(10.28, 0.12, -6.65);
  sign.rotation.y = -Math.PI / 2;
  danceFloor.add(sign);

  const crowdColors = [0x100e13, 0x16121a, 0x11161a, 0x1a1012, 0x171611];
  for (let index = 0; index < 30; index += 1) {
    const dancer = new THREE.Group();
    dancer.name = "club-dancer";
    const crowdMaterial = new THREE.MeshStandardMaterial({ color: crowdColors[index % crowdColors.length], roughness: 0.95 });
    const skinMaterial = new THREE.MeshStandardMaterial({ color: 0x171315, roughness: 0.98 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.33, 5, 8), crowdMaterial);
    torso.position.y = 0.59;
    torso.scale.set(1.12, 1, 0.78);
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.15), crowdMaterial);
    hips.position.y = 0.31;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), skinMaterial);
    head.position.y = 0.94;
    const shoulders = new THREE.Group();
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.38, 4, 6), crowdMaterial);
      arm.position.set(side * 0.19, 0.63, 0);
      const pose = index % 6;
      arm.rotation.z = side * (pose < 2 ? 1.55 - pose * 0.28 : 0.45 + (pose - 2) * 0.19);
      arm.rotation.x = side * ((index % 3) * 0.12 - 0.1);
      arm.userData.restZ = arm.rotation.z;
      arm.userData.restX = arm.rotation.x;
      shoulders.add(arm);
    }
    const feet = new THREE.Group();
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.32, 4, 6), crowdMaterial);
      leg.position.set(side * 0.075, 0.12, 0);
      leg.rotation.z = side * (0.07 + (index % 3) * 0.035);
      leg.userData.restZ = leg.rotation.z;
      feet.add(leg);
    }
    dancer.add(torso, hips, head, shoulders, feet);
    const row = Math.floor(index / 6);
    dancer.position.set(3.35 + (index % 6) * 0.88 + (row % 2) * 0.25, -3.03, -8.65 + row * 0.89);
    dancer.rotation.y = (index % 5) * 0.38 - 0.75;
    const scale = 0.82 + (index % 4) * 0.055;
    dancer.scale.setScalar(scale);
    dancer.userData.clubPhase = index * 0.71;
    dancer.userData.restY = dancer.position.y;
    dancer.userData.restRotationY = dancer.rotation.y;
    clubCrowd.push(dancer);
    danceFloor.add(dancer);
  }

  const truss = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.12, 0.13), metal);
  truss.position.set(6.5, 2.58, -6.65);
  danceFloor.add(truss);
  const lightSpecs: [number, number, number, number][] = [
    [0xc51f42, 3.55, -9.12, 0.5],
    [0x3b899a, 5.5, -4.15, 1.8],
    [0x9e243d, 7.45, -9.05, 3.2],
    [0x326d7a, 9.1, -4.25, 4.6],
  ];
  for (const [color, x, z, phase] of lightSpecs) {
    const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.32, 12), stageMaterial);
    fixture.rotation.z = Math.PI / 2;
    fixture.position.set(x, 2.34, z);
    danceFloor.add(fixture);
    const light = new THREE.SpotLight(color, 46, 12, 0.26, 0.62, 1.32);
    light.position.set(x, 2.22, z);
    light.target.position.set(6.45, -3.0, -6.65);
    light.userData.clubPhase = phase;
    clubLights.push(light);
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(1.45, 5.2, 24, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.018, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    beam.position.set(x, -0.36, z);
    beam.rotation.z = (6.45 - x) * 0.035;
    danceFloor.add(light, light.target, beam);
  }

  const hazeGeometry = new THREE.BufferGeometry();
  const hazePositions = new Float32Array(130 * 3);
  for (let index = 0; index < 130; index += 1) {
    hazePositions[index * 3] = 2.9 + Math.random() * 6.5;
    hazePositions[index * 3 + 1] = -2.8 + Math.random() * 4.4;
    hazePositions[index * 3 + 2] = -9.3 + Math.random() * 5.4;
  }
  hazeGeometry.setAttribute("position", new THREE.BufferAttribute(hazePositions, 3));
  const haze = new THREE.Points(hazeGeometry, new THREE.PointsMaterial({ color: 0x6e3540, size: 0.018, transparent: true, opacity: 0.11, depthWrite: false }));
  haze.name = "club-haze";
  danceFloor.add(haze);

  catwalk.add(danceFloor);
  return { clubLights, clubTiles, clubCrowd };
}

function buildCatwalk(scene: THREE.Scene, metal: THREE.Material, brick: THREE.Material): CatwalkFeatures {
  const deckMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2d2c, roughness: 0.74, metalness: 0.72 });
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x343838, roughness: 0.58, metalness: 0.82 });
  const catwalk = new THREE.Group();
  catwalk.name = "warehouse-catwalk";

  const underDeck = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.12, 7.15), deckMaterial);
  underDeck.position.set(1.47, -0.1, -6.86);
  catwalk.add(underDeck);
  for (let index = 0; index < 38; index += 1) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.045, 0.085), railMaterial);
    slat.position.set(1.47, 0.005, -3.4 - index * 0.185);
    slat.castShadow = true;
    slat.receiveShadow = true;
    catwalk.add(slat);
  }

  for (const x of [0.53, 2.41]) {
    for (const y of [0.46, 0.83, 1.15]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 6.8, 10), railMaterial);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(x, y, -6.75);
      catwalk.add(rail);
    }
    for (let index = 0; index < 8; index += 1) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.18, 10), railMaterial);
      post.position.set(x, 0.58, -3.55 - index * 0.88);
      catwalk.add(post);
    }
  }

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(7.15, 3.5), brick);
  leftWall.position.set(0.42, 1.7, -6.86);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.receiveShadow = true;
  catwalk.add(leftWall);

  for (const [x, y, width, height] of [
    [0.39, 1.75, 0.78, 3.5],
    [3.54, 1.75, 2.76, 3.5],
    [1.47, 3.05, 1.4, 0.9],
  ] as const) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), brick);
    panel.position.set(x, y, -10.45);
    panel.receiveShadow = true;
    catwalk.add(panel);
  }
  for (const [x, y, width, height] of [
    [0.75, 1.3, 0.13, 2.6],
    [2.19, 1.3, 0.13, 2.6],
    [1.47, 2.55, 1.56, 0.13],
  ] as const) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.2), metal);
    frame.position.set(x, y, -10.38);
    frame.castShadow = true;
    catwalk.add(frame);
  }

  const passageFloor = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.1, 2.55), deckMaterial);
  passageFloor.position.set(1.47, -0.08, -11.65);
  passageFloor.receiveShadow = true;
  catwalk.add(passageFloor);
  for (const x of [0.73, 2.21]) {
    const passageWall = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.7), brick);
    passageWall.position.set(x, 1.3, -11.65);
    passageWall.rotation.y = x < 1.47 ? Math.PI / 2 : -Math.PI / 2;
    catwalk.add(passageWall);
  }
  const passageCeiling = new THREE.Mesh(new THREE.PlaneGeometry(1.48, 2.6), new THREE.MeshStandardMaterial({ color: 0x171315, roughness: 1 }));
  passageCeiling.position.set(1.47, 2.62, -11.65);
  passageCeiling.rotation.x = Math.PI / 2;
  catwalk.add(passageCeiling);
  const passageDark = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 2.6), new THREE.MeshBasicMaterial({ color: 0x020202 }));
  passageDark.position.set(1.47, 1.3, -12.92);
  catwalk.add(passageDark);

  const mainDoor = new THREE.Group();
  mainDoor.name = "main-room-door";
  mainDoor.position.set(0.81, 0, -10.31);
  mainDoor.rotation.y = -1.26;
  const mainDoorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 2.42, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x4f4545, roughness: 0.78, metalness: 0.46 }),
  );
  mainDoorMesh.position.set(0.65, 1.21, 0);
  mainDoorMesh.castShadow = true;
  const mainKickPlate = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.32, 0.03), new THREE.MeshStandardMaterial({ color: 0x262225, roughness: 0.62, metalness: 0.7 }));
  mainKickPlate.position.set(0.65, 0.25, 0.072);
  const mainHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), metal);
  mainHandle.rotation.x = Math.PI / 2;
  mainHandle.position.set(1.12, 1.21, 0.12);
  mainDoor.add(mainDoorMesh, mainKickPlate, mainHandle);
  catwalk.add(mainDoor);

  for (const levelY of [-1.38, -2.95]) {
    const sideLevel = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.18, 6.6), deckMaterial);
    sideLevel.position.set(9.68, levelY, -6.75);
    sideLevel.castShadow = true;
    sideLevel.receiveShadow = true;
    catwalk.add(sideLevel);
    for (const bridgeZ of [-4.15, -9.25]) {
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(7.85, 0.18, 0.72), deckMaterial);
      bridge.position.set(6.38, levelY, bridgeZ);
      bridge.castShadow = true;
      bridge.receiveShadow = true;
      catwalk.add(bridge);
    }
    for (let index = 0; index < 7; index += 1) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.45, 0.12), railMaterial);
      beam.position.set(2.72 + (index % 2) * 7.42, levelY + 0.72, -4.15 - Math.floor(index / 2) * 1.62);
      catwalk.add(beam);
    }
  }

  const factoryWall = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 6.6), brick);
  factoryWall.position.set(10.52, -0.08, -6.65);
  factoryWall.rotation.y = -Math.PI / 2;
  catwalk.add(factoryWall);
  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x1a3d43, emissive: 0x123a42, emissiveIntensity: 1.35, roughness: 0.76 });
  for (const y of [-0.62, -2.18]) {
    for (const z of [-4.35, -5.9, -7.45, -9.0]) {
      const windowFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.92, 1.16), metal);
      windowFrame.position.set(10.41, y, z);
      catwalk.add(windowFrame);
      const windowGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 0.76), windowMaterial);
      windowGlow.position.set(10.34, y, z);
      windowGlow.rotation.y = -Math.PI / 2;
      catwalk.add(windowGlow);
      for (const offset of [-0.26, 0.26]) {
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.76, 0.025), railMaterial);
        mullion.position.set(10.3, y, z + offset);
        catwalk.add(mullion);
      }
    }
  }

  for (let index = 0; index < 7; index += 1) {
    const z = -3.8 - index * 1.02;
    const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(10.05, 0.085, 0.11), railMaterial);
    crossBeam.position.set(5.42, 2.93, z);
    crossBeam.rotation.z = index % 2 ? 0.045 : -0.035;
    catwalk.add(crossBeam);
    for (const x of [1.05, 3.9, 6.75, 9.6]) {
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.42, 0.055), railMaterial);
      hanger.position.set(x, 2.72, z);
      catwalk.add(hanger);
    }
  }

  const watcher = new THREE.Group();
  watcher.name = "catwalk-watcher";
  const silhouette = new THREE.MeshStandardMaterial({ color: 0x111010, roughness: 1 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.78, 6, 10), silhouette);
  torso.rotation.z = -0.21;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), silhouette);
  head.position.set(0.13, 0.56, -0.03);
  const nearArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.62, 5, 8), silhouette);
  nearArm.rotation.z = -1.28;
  nearArm.position.set(0.25, 0.17, 0.02);
  const farArm = nearArm.clone();
  farArm.position.set(0.14, 0.08, -0.12);
  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), silhouette);
  hips.scale.set(0.9, 0.72, 0.75);
  hips.position.y = -0.48;
  for (const x of [-0.09, 0.09]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.78, 5, 8), silhouette);
    leg.position.set(x, -0.95, 0);
    leg.rotation.z = x < 0 ? 0.04 : -0.12;
    watcher.add(leg);
  }
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff5b3e }));
  ember.position.set(0.62, 0.25, 0.02);
  watcher.add(torso, head, nearArm, farArm, hips, ember);
  watcher.position.set(0.58, 0.74, -9.0);
  watcher.rotation.y = 0.36;
  watcher.scale.setScalar(0.72);
  catwalk.add(watcher);
  const watcherRim = new THREE.PointLight(0xd94f42, 22, 3.2, 1.7);
  watcherRim.position.set(0.32, 1.65, -9.18);
  catwalk.add(watcherRim);

  const lowerBlue = new THREE.PointLight(0x3b7180, 34, 14, 1.68);
  lowerBlue.position.set(6.8, -0.55, -6.8);
  const doorwayRed = new THREE.PointLight(0xa43e35, 31, 8, 1.68);
  doorwayRed.position.set(1.42, 2.18, -4.72);
  const walkwayFill = new THREE.PointLight(0x66777a, 24, 8, 1.58);
  walkwayFill.position.set(2.15, 2.25, -7.18);
  const coldStrip = new THREE.SpotLight(0x668b90, 39, 17, 0.62, 0.84, 1.48);
  coldStrip.position.set(7.8, 3.15, -7.4);
  coldStrip.target.position.set(5.5, -0.45, -7.1);
  catwalk.add(lowerBlue, doorwayRed, walkwayFill, coldStrip, coldStrip.target);
  const nightclub = buildNightclub(catwalk, metal);
  scene.add(catwalk);
  return { mainDoor, ...nightclub };
}

export function buildIntroWorld(loadTexture: TextureLoader): IntroWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090707);
  scene.fog = new THREE.FogExp2(0x2a1918, 0.027);

  const wallAtlas = loadTexture(ASSETS.textures.restroomWallTiles);
  const wallMapBack = cropTexture(wallAtlas, [0.39, 0.23], [0.05, 0.73]);
  const wallMapLeft = cropTexture(wallAtlas, [0.42, 0.24], [0.48, 0.72]);
  const wallMapRight = cropTexture(wallAtlas, [0.42, 0.24], [0.08, 0.46]);
  const floorMap = loadTexture(ASSETS.textures.restroomTiles, [1.65, 1.85]);
  const marbleMap = loadTexture(ASSETS.textures.restroomMarble);
  const marbleDarkMap = loadTexture(ASSETS.textures.restroomMarbleDark);
  const ceramicMap = loadTexture(ASSETS.textures.restroomCeramic);
  const wallMaterial = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, color: 0xd0b5ad, roughness: 0.93 });
  const floorMaterial = new THREE.MeshStandardMaterial({ map: floorMap, color: 0x9a7875, roughness: 0.96 });
  const metal = new THREE.MeshStandardMaterial({ map: loadTexture(ASSETS.textures.restroomMetalSheet), color: 0x68605d, roughness: 0.6, metalness: 0.58 });
  const ceramic = new THREE.MeshStandardMaterial({ map: ceramicMap, color: 0xe1c8c0, roughness: 0.83 });
  const basinGrime = new THREE.MeshStandardMaterial({ color: 0x5e403b, roughness: 1, transparent: true, opacity: 0.58 });
  const mirrorMaterial = new THREE.MeshPhysicalMaterial({ color: 0x756b68, roughness: 0.33, metalness: 0.74, clearcoat: 0.18 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 7.2), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -0.15);
  floor.receiveShadow = true;
  scene.add(floor);

  const backWallMaterial = wallMaterial(wallMapBack);
  for (const [x, y, width, height] of [
    [-1.28, 1.75, 3.84, 3.5], [2.75, 1.75, 0.9, 3.5], [1.47, 3.07, 1.66, 0.86],
  ] as const) {
    const wallPanel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), backWallMaterial);
    wallPanel.position.set(x, y, -3.3);
    wallPanel.receiveShadow = true;
    scene.add(wallPanel);
  }
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.5), wallMaterial(wallMapLeft));
  leftWall.position.set(-3.2, 1.75, -0.15);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.receiveShadow = true;
  scene.add(leftWall);
  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.5), wallMaterial(wallMapRight));
  rightWall.position.set(3.2, 1.75, -0.15);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.receiveShadow = true;
  scene.add(rightWall);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 7.2), new THREE.MeshStandardMaterial({ color: 0x342b2a, roughness: 1 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 3.48, -0.15);
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  const vanityTop = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, 0.18, 4.82),
    new THREE.MeshStandardMaterial({ map: marbleMap, color: 0xa1817a, roughness: 0.87 }),
  );
  vanityTop.position.set(-2.7, 0.84, -0.3);
  const vanityFront = new THREE.Mesh(
    new THREE.BoxGeometry(0.68, 0.82, 4.62),
    new THREE.MeshStandardMaterial({ map: marbleDarkMap, color: 0x3e2c2a, roughness: 0.94 }),
  );
  vanityFront.position.set(-2.77, 0.41, -0.3);
  scene.add(vanityTop, vanityFront);
  addShadowCasting(vanityTop);
  addShadowCasting(vanityFront);

  const sinkPositions = [1.42, 0.28, -0.86, -2.0];
  for (const [index, z] of sinkPositions.entries()) {
    const sink = makeSink(metal, ceramic, basinGrime);
    sink.position.set(-2.38, 0.94, z);
    sink.rotation.y = -Math.PI / 2;
    scene.add(sink);

    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 1.08), mirrorMaterial);
    mirror.position.set(-3.184, 1.9, z);
    mirror.rotation.y = Math.PI / 2;
    scene.add(mirror);
    for (const [offset, size] of [[0, 1.08], [-0.54, 1.02], [0.54, 1.02]] as const) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.025, offset === 0 ? size : 1.08, offset === 0 ? 1.02 : 0.025), new THREE.MeshStandardMaterial({ color: 0x282322, metalness: 0.5, roughness: 0.7 }));
      edge.position.set(-3.19, offset === 0 ? 1.36 : 1.9, offset === 0 ? z : z + offset);
      scene.add(edge);
    }
    if (index === 1) {
      const soap = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.24, 0.1), new THREE.MeshStandardMaterial({ color: 0xcfc0b7, roughness: 0.86 }));
      soap.position.set(-2.23, 1.07, z + 0.32);
      scene.add(soap);
    }
  }

  const graffiti = new THREE.Mesh(
    new THREE.PlaneGeometry(2.05, 0.56),
    new THREE.MeshBasicMaterial({ map: buildGraffiti(), transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
  graffiti.position.set(-3.17, 2.03, -0.62);
  graffiti.rotation.y = Math.PI / 2;
  scene.add(graffiti);

  const door = new THREE.Group();
  door.name = "restroom-door";
  door.position.set(0.73, 0, -3.25);
  const doorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.48, 2.5, 0.13),
    new THREE.MeshStandardMaterial({ map: loadTexture(ASSETS.textures.restroomDoor), color: 0x8a7471, roughness: 0.78, metalness: 0.3 }),
  );
  doorMesh.position.set(0.74, 1.25, 0);
  doorMesh.castShadow = true;
  const kickPlate = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.28, 0.02), new THREE.MeshStandardMaterial({ color: 0x514542, roughness: 0.8, metalness: 0.42 }));
  kickPlate.position.set(0.74, 0.22, 0.075);
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 9), metal);
  handle.position.set(1.28, 1.2, 0.1);
  door.add(doorMesh, kickPlate, handle);
  scene.add(door);
  for (const [x, y, width, height] of [[1.47, 2.57, 1.74, 0.15], [0.64, 1.31, 0.15, 2.65], [2.3, 1.31, 0.15, 2.65]] as const) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.24), metal);
    frame.position.set(x, y, -3.2);
    frame.castShadow = true;
    scene.add(frame);
  }
  const industrialBrick = new THREE.MeshStandardMaterial({ map: loadTexture(ASSETS.textures.brick, [3.4, 1.8]), color: 0x72504b, roughness: 0.98 });
  const catwalk = buildCatwalk(scene, metal, industrialBrick);

  const dispenser = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.66, 0.25),
    new THREE.MeshStandardMaterial({ map: loadTexture(ASSETS.textures.restroomTowelDispenser), color: 0x5c504d, roughness: 0.74, metalness: 0.32 }),
  );
  dispenser.position.set(0.36, 1.55, -3.15);
  dispenser.castShadow = true;
  scene.add(dispenser);
  const towel = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xc7bcb2, roughness: 1, side: THREE.DoubleSide }));
  towel.position.set(0.36, 1.21, -3.015);
  scene.add(towel);

  const redPanel = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2.55), new THREE.MeshStandardMaterial({ color: 0x5a302e, roughness: 0.96 }));
  redPanel.position.set(3.17, 1.42, -1.45);
  redPanel.rotation.y = -Math.PI / 2;
  scene.add(redPanel);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.5, 10), metal);
  pipe.position.set(3.03, 1.25, -2.55);
  scene.add(pipe);

  for (const [x, z, sx, sz, rotation] of [
    [-0.45, 1.05, 0.46, 0.34, 0.08], [0.38, 0.22, 0.38, 0.42, -0.06], [1.35, 1.5, 0.58, 0.3, 0.04], [-0.85, -1.85, 0.45, 0.36, -0.07],
  ] as const) {
    const missingTile = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshStandardMaterial({ color: 0x282121, roughness: 1 }));
    missingTile.rotation.set(-Math.PI / 2, 0, rotation);
    missingTile.position.set(x, 0.008, z);
    scene.add(missingTile);
  }

  makeFluorescent(scene, -0.95, -1.65);
  makeFluorescent(scene, -0.55, 1.25);
  const fluorescent = new THREE.PointLight(0xffc1b5, 46, 9, 1.45);
  fluorescent.position.set(-0.55, 2.94, -0.35);
  fluorescent.castShadow = true;
  fluorescent.shadow.mapSize.set(1024, 1024);
  fluorescent.shadow.bias = -0.001;
  const doorFill = new THREE.SpotLight(0xffad9e, 21, 8, 0.65, 0.7, 1.5);
  doorFill.position.set(2.15, 2.8, 1.4);
  doorFill.target.position.set(1.45, 1.2, -3.1);
  const mirrorFill = new THREE.PointLight(0xd98f83, 10, 5, 1.8);
  mirrorFill.position.set(-2.3, 1.8, 1.5);
  scene.add(fluorescent, doorFill, doorFill.target, mirrorFill, new THREE.HemisphereLight(0xc89c93, 0x1c1110, 1.75));

  const dustGeometry = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(90 * 3);
  for (let i = 0; i < 90; i += 1) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 5.7;
    dustPositions[i * 3 + 1] = 0.3 + Math.random() * 2.7;
    dustPositions[i * 3 + 2] = -2.8 + Math.random() * 5.8;
  }
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const motes = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xe6b7ad, size: 0.012, transparent: true, opacity: 0.32, depthWrite: false }));
  motes.name = "restroom-dust";
  scene.add(motes);

  const stand = new THREE.Group();
  stand.name = "waiver-stand";
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.92, 0.76), new THREE.MeshStandardMaterial({ map: loadTexture(ASSETS.textures.waiverMetal), color: 0x3b3532, roughness: 0.75, metalness: 0.48 }));
  base.position.y = 0.46;
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.95), new THREE.MeshStandardMaterial({ color: 0x38322f, roughness: 0.74, metalness: 0.4 }));
  top.position.set(0, 0.97, -0.02);
  top.rotation.x = -0.12;
  stand.add(base, top);
  stand.position.set(2.05, 0, 2.7);
  stand.rotation.y = -0.38;
  scene.add(stand);

  const kickLeg = makeKickLeg();
  scene.add(kickLeg);

  return { scene, door, kickLeg, fluorescent, ...catwalk };
}
