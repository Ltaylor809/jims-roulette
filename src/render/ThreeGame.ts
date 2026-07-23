import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MechanicalCue } from "../audio/AudioDirector";
import type { Actor, GameEvent, GameMode, GameState, ItemId, Shell } from "../game/simulation/types";
import { ASSETS } from "./assets";
import { buildIntroWorld, type IntroWorld } from "./IntroWorld";

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const other = (actor: Actor): Actor => actor === "player" ? "dealer" : "player";

interface PendingReveal {
  chamber: Shell[];
  inventory: ItemId[];
  opponentInventory: ItemId[];
  itemDrawCount: number;
  round: number;
  delay: number;
}

export class ThreeGame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50);
  readonly renderer: THREE.WebGLRenderer;
  onInteraction: (interaction: string) => void = () => undefined;
  onHover: (interaction: string | null) => void = () => undefined;
  onShellReveal: (live: number, blank: number, visible: boolean) => void = () => undefined;
  onShotFire: (event: Extract<GameEvent, { kind: "shot" }>) => void = () => undefined;
  onBlackout: (active: boolean) => void = () => undefined;
  onMechanicalCue: (cue: MechanicalCue) => void = () => undefined;
  onItemCue: (item: ItemId, phase: "pickup" | "use") => void = () => undefined;

  private readonly clock = new THREE.Clock();
  private readonly loader = new GLTFLoader();
  private readonly fbxLoader = new FBXLoader();
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly textureCache = new Map<string, THREE.Texture>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(4, 4);
  private readonly itemTemplates = new Map<ItemId, THREE.Group>();
  private readonly localItems = new THREE.Group();
  private readonly dealerItems = new THREE.Group();
  private readonly shellRackShells = new THREE.Group();
  private readonly briefcaseItems = new THREE.Group();
  private readonly industrialLights: THREE.PointLight[] = [];
  private readonly ventilationFans: THREE.Group[] = [];
  private readonly roomEntryDoor = new THREE.Group();
  private readonly homeCamera = new THREE.Vector3(0, 2.2, 3.48);
  private readonly homeLook = new THREE.Vector3(0, 0.76, -0.58);
  private readonly lookTarget = this.homeLook.clone();
  private readonly muzzleLight = new THREE.PointLight(0xffd4a0, 0, 7, 2);
  private readonly roomLightLeft = new THREE.SpotLight(0xe1c2ae, 18.2, 10, 0.52, 0.84, 1.5);
  private readonly roomLightRight = new THREE.SpotLight(0xd8b3a5, 16.2, 10, 0.52, 0.84, 1.5);
  private readonly healthCanvas = document.createElement("canvas");
  private readonly healthTexture: THREE.CanvasTexture;
  private readonly introWorld: IntroWorld;
  private activeScene: THREE.Scene;
  private shotgun: THREE.Group | null = null;
  private dealer: THREE.Group | null = null;
  private soloDealer: THREE.Group | null = null;
  private multiplayerRival: THREE.Group | null = null;
  private dealerHandBones: { left?: THREE.Bone; right?: THREE.Bone } = {};
  private dealerIdleHands: THREE.Group[] = [];
  private briefcase: THREE.Group | null = null;
  private hoveredInteraction: string | null = null;
  private lastChamberNumber = -1;
  private pendingReveal: PendingReveal | null = null;
  private pendingHealthDraw: { state: GameState; localActor: Actor } | null = null;
  private tableActive = false;
  private animationBusy = false;
  private revealScheduled = false;
  private disposed = false;
  private pointerDirty = true;
  private lastRenderElapsed = 0;
  private lastSecondaryUpdate = 0;
  private shotgunTargetScale = 1;
  private lastSuddenDeath: Record<Actor, boolean> = { player: false, dealer: false };
  private playerName = "JIM";
  private dealerRestY = 1.55;
  private opponentMode: GameMode = "solo";

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // The table is dominated by close, static set dressing. Dynamic shadows were
    // doubling much of the scene's draw work for very little visible benefit.
    this.renderer.shadowMap.enabled = false;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 0.85));
    this.scene.background = new THREE.Color(0x030202);
    this.scene.fog = new THREE.FogExp2(0x050303, 0.058);
    this.camera.position.copy(this.homeCamera);
    this.camera.lookAt(this.lookTarget);

    this.healthCanvas.width = 768;
    this.healthCanvas.height = 256;
    this.healthTexture = new THREE.CanvasTexture(this.healthCanvas);
    this.healthTexture.colorSpace = THREE.SRGBColorSpace;
    this.healthTexture.minFilter = THREE.NearestFilter;
    this.healthTexture.magFilter = THREE.NearestFilter;

    this.introWorld = buildIntroWorld((url, repeat) => this.loadTexture(url, repeat));
    this.activeScene = this.scene;

    this.buildRoom();
    this.mergeStaticRoomGeometry();
    this.buildDealer();
    this.buildMultiplayerRival();
    this.buildHealthMachine();
    this.buildShellRack();
    this.buildBriefcase();
    this.scene.add(this.localItems, this.dealerItems);
    this.bindEvents();
    this.resize();
    this.renderer.setAnimationLoop(() => this.render());
  }

  async load(onProgress: (progress: number, label: string) => void): Promise<void> {
    onProgress(0.08, "POWERING THE TABLE");
    const jobs: Promise<void>[] = [];

    jobs.push((async () => {
      try {
        const authoredPack = await this.fbxLoader.loadAsync(ASSETS.dealer);
        this.installAuthoredItems(authoredPack);
        this.installAuthoredShotgun(authoredPack);
        this.installAuthoredDealer(authoredPack);
      } catch {
        // The procedural dealer built during construction remains as an offline fallback.
        try {
          const gltf = await this.loader.loadAsync(ASSETS.shotgun);
          this.installLegacyShotgun(gltf.scene);
        } catch {
          this.shotgun = this.createFallbackShotgun();
          this.scene.add(this.shotgun);
        }
      }
      onProgress(0.38, "SETTING THE 12-GAUGE");
    })());

    const modelEntries: ["handSaw", string][] = [["handSaw", ASSETS.itemModels.handSaw]];
    for (const [item, url] of modelEntries) {
      jobs.push((async () => {
        try {
          const gltf = await this.loader.loadAsync(url);
          const size = item === "handSaw" ? 0.53 : item === "magnifier" ? 0.34 : 0.29;
          this.itemTemplates.set(item, this.normalizeModel(gltf.scene, size));
        } catch {
          this.itemTemplates.set(item, this.createProceduralItem(item));
        }
      })());
    }
    await Promise.all(jobs);

    const allItems: ItemId[] = ["magnifier", "cigarettes", "handSaw", "handcuffs", "beer", "burnerPhone", "inverter", "adrenaline", "expiredMedicine", "jammer", "remote"];
    for (const item of allItems) if (!this.itemTemplates.has(item)) this.itemTemplates.set(item, this.createProceduralItem(item));
    onProgress(0.78, "LAYING OUT THE ITEMS");
    await wait(180);
    onProgress(1, "THE TABLE IS READY");
  }

  sync(state: GameState, localActor: Actor): void {
    this.setOpponentMode(state.mode);
    const healthState = {
      ...state,
      health: { ...state.health },
      suddenDeath: { ...state.suddenDeath },
    };
    if (state.lastEvent.kind === "shot" && state.lastEvent.shell === "live" && state.lastEvent.damage > 0) {
      this.pendingHealthDraw = { state: healthState, localActor };
    } else {
      this.pendingHealthDraw = null;
      this.drawHealth(healthState, localActor);
    }
    this.rebuildItems(state, localActor);
    const boosted = state.damageBoost[localActor] || state.damageBoost[other(localActor)];
    if (boosted) this.shotgunTargetScale = 0.66;
    else if (state.lastEvent.kind !== "shot") this.shotgunTargetScale = 1;
    for (const actor of ["player", "dealer"] as Actor[]) {
      if (state.suddenDeath[actor] && !this.lastSuddenDeath[actor]) {
        window.setTimeout(() => void this.animateWireFailure(actor === localActor), 1900);
      }
    }
    this.lastSuddenDeath = { ...state.suddenDeath };

    if (state.chamberNumber !== this.lastChamberNumber) {
      this.lastChamberNumber = state.chamberNumber;
      this.rebuildShells(state.chamber);
      this.pendingReveal = {
        chamber: [...state.chamber],
        inventory: [...state.inventory[localActor]],
        opponentInventory: [...state.inventory[other(localActor)]],
        itemDrawCount: state.mode === "multiplayer" ? 2 : state.round === 2 ? 2 : state.round === 3 ? 4 : 0,
        round: state.round,
        delay: state.lastEvent.kind === "shot" ? 1550 : state.lastEvent.kind === "item" ? 750 : 150,
      };
      if (this.tableActive) this.scheduleReveal();
    }
  }

  async react(event: GameEvent, localActor: Actor): Promise<void> {
    if (event.kind === "item") {
      const actorIsLocal = event.actor === localActor;
      if (event.item === "adrenaline" && event.activatedItem) {
        await this.animateItemUse("adrenaline", actorIsLocal);
        await this.animateItemUse(event.activatedItem, actorIsLocal);
      } else {
        await this.animateItemUse(event.item, actorIsLocal);
      }
      if (event.item === "beer" && event.ejected) await this.animateEjectedShell(event.ejected);
      return;
    }
    if (event.kind === "shot") await this.animateShot(event, localActor);
    if (event.kind === "round") await this.slowPushIn();
  }

  async setMenuView(menu: boolean): Promise<void> {
    this.activeScene = this.scene;
    this.tableActive = !menu;
    const target = menu ? new THREE.Vector3(0, 2.75, 2.15) : this.homeCamera.clone();
    const look = menu ? new THREE.Vector3(0, 0.55, -0.05) : this.homeLook.clone();
    await this.moveCamera(target, look, 720);
    if (!menu && this.pendingReveal) this.scheduleReveal();
  }

  setPlayerName(name: string): void {
    this.playerName = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8) || "JIM";
  }

  async showRestroom(): Promise<void> {
    while (this.animationBusy) await wait(60);
    this.animationBusy = true;
    this.tableActive = false;
    this.activeScene = this.introWorld.scene;
    this.introWorld.door.rotation.y = 0;
    this.introWorld.mainDoor.rotation.y = -1.26;
    this.introWorld.kickLeg.visible = false;
    const portrait = window.innerWidth / window.innerHeight < 0.82;
    const start = portrait ? new THREE.Vector3(0.3, 1.72, 4.65) : new THREE.Vector3(0.15, 1.68, 3.72);
    this.camera.position.copy(start);
    this.lookTarget.set(-0.65, 1.32, -2.25);
    await this.moveCamera(start.clone().add(new THREE.Vector3(0.16, -0.03, -0.35)), new THREE.Vector3(-0.72, 1.28, -2.42), 1450);
    this.animationBusy = false;
  }

  async enterRoom(): Promise<void> {
    while (this.animationBusy) await wait(60);
    this.animationBusy = true;
    this.tableActive = false;
    this.activeScene = this.introWorld.scene;
    const clubStartedAt = performance.now();
    const doorMoment = wait(6000);
    this.onMechanicalCue("clubStart");
    this.onMechanicalCue("walk");
    await this.walkCamera(new THREE.Vector3(1.42, 1.63, -0.55), new THREE.Vector3(1.44, 1.42, -3.28), 2350, 3.4);
    await wait(Math.max(0, 4550 - (performance.now() - clubStartedAt)));
    this.introWorld.kickLeg.visible = true;
    const kickDuration = Math.max(620, 6000 - (performance.now() - clubStartedAt));
    await Promise.all([
      this.tween(kickDuration, (amount) => this.placeKickLeg(amount)),
      doorMoment,
    ]);
    this.onMechanicalCue("door");
    this.onMechanicalCue("clubOpen");
    await Promise.all([
      this.tween(390, (amount) => {
        const overshoot = amount < 0.76
          ? this.ease(amount / 0.76) * 1.42
          : 1.42 - this.easeInOut((amount - 0.76) / 0.24) * 0.1;
        this.introWorld.door.rotation.y = -overshoot;
        this.camera.position.x += Math.sin(amount * Math.PI * 12) * 0.016 * (1 - amount);
        this.camera.position.z += Math.sin(amount * Math.PI) * 0.045;
      }),
      this.tween(430, (amount) => {
        this.placeKickLeg(1 + amount);
        if (amount > 0.82) this.introWorld.kickLeg.visible = false;
      }),
    ]);
    this.onMechanicalCue("walk");
    await this.travelCamera(
      [
        this.camera.position.clone(),
        new THREE.Vector3(1.45, 1.61, -4.35),
        new THREE.Vector3(1.46, 1.6, -5.55),
        new THREE.Vector3(1.48, 1.58, -7.0),
        new THREE.Vector3(1.48, 1.59, -8.25),
        new THREE.Vector3(1.48, 1.6, -9.62),
      ],
      [
        new THREE.Vector3(1.48, 1.38, -4.8),
        new THREE.Vector3(3.2, -0.25, -6.4),
        new THREE.Vector3(6.4, -2.05, -7.05),
        new THREE.Vector3(9.55, -0.35, -6.62),
        new THREE.Vector3(6.45, -2.15, -6.9),
        new THREE.Vector3(1.48, 1.33, -10.55),
      ],
      6100,
      8.5,
    );
    await this.travelCamera(
      [this.camera.position.clone(), new THREE.Vector3(1.48, 1.6, -10.45), new THREE.Vector3(1.48, 1.6, -11.5)],
      [this.lookTarget.clone(), new THREE.Vector3(1.48, 1.35, -11.8), new THREE.Vector3(1.48, 1.34, -12.45)],
      1850,
      3,
    );
    await wait(260);
    this.onBlackout(true);
    await wait(560);

    this.activeScene = this.scene;
    this.roomEntryDoor.rotation.y = -1.26;
    this.camera.position.set(0.08, 1.7, 3.7);
    this.lookTarget.set(-0.04, 1.34, 5.08);
    await wait(320);
    this.onBlackout(false);
    await wait(520);
    await this.tween(980, (amount) => {
      const eased = this.easeInOut(amount);
      this.roomEntryDoor.rotation.y = -1.26 * (1 - eased);
      const weight = Math.sin(amount * Math.PI);
      this.camera.position.x = 0.08 + Math.sin(amount * Math.PI * 2) * 0.008 * weight;
      this.camera.position.y = 1.7 + Math.sin(amount * Math.PI) * 0.015;
      this.lookTarget.x = -0.04 + Math.sin(amount * Math.PI * 1.4) * 0.012;
    });
    this.onMechanicalCue("mainDoor");
    this.onMechanicalCue("clubMuffle");
    await wait(540);
    this.onMechanicalCue("walk");
    await this.travelCamera(
      [
        this.camera.position.clone(),
        new THREE.Vector3(0.02, 1.78, 3.62),
        new THREE.Vector3(-0.06, 2.02, 3.42),
        this.homeCamera.clone().add(new THREE.Vector3(0, 0.08, 0.24)),
      ],
      [
        this.lookTarget.clone(),
        new THREE.Vector3(-1.8, 1.42, 1.1),
        new THREE.Vector3(-0.12, 1.2, -0.42),
        this.homeLook.clone(),
      ],
      3450,
      4.4,
    );
    await this.moveCamera(this.homeCamera.clone(), this.homeLook.clone(), 720);
    this.tableActive = true;
    this.animationBusy = false;
    if (this.pendingReveal) this.scheduleReveal();
  }

  private placeKickLeg(amount: number): void {
    const retracting = amount > 1;
    const phase = Math.min(1, retracting ? amount - 1 : amount);
    let localX = 0.38;
    let localY = -0.86;
    let localZ = -1.03;
    let pitch = -0.18;
    if (!retracting) {
      if (phase < 0.3) {
        const windup = this.easeInOut(phase / 0.3);
        localX += windup * 0.19;
        localY -= windup * 0.11;
        localZ += windup * 0.26;
        pitch -= windup * 0.38;
      } else {
        const strike = this.ease((phase - 0.3) / 0.7);
        localX = 0.57 - strike * 0.31;
        localY = -0.97 + strike * 0.34;
        localZ = -0.77 - strike * 1.26;
        pitch = -0.56 + strike * 0.7;
      }
    } else {
      const retract = this.easeInOut(phase);
      localX = 0.26 + retract * 0.34;
      localY = -0.63 - retract * 0.42;
      localZ = -2.03 + retract * 1.38;
      pitch = 0.14 - retract * 0.5;
    }
    this.camera.updateMatrixWorld(true);
    this.introWorld.kickLeg.position.copy(this.camera.localToWorld(new THREE.Vector3(localX, localY, localZ)));
    this.introWorld.kickLeg.quaternion.copy(this.camera.quaternion);
    this.introWorld.kickLeg.rotateX(pitch);
    this.introWorld.kickLeg.rotateZ(-0.13);
  }

  private buildRoom(): void {
    const felt = this.loadTexture(ASSETS.textures.felt);
    const brick = this.loadTexture(ASSETS.textures.brick, [2.3, 1.3]);
    const rust = this.loadTexture(ASSETS.textures.rust, [2, 2]);
    const wood = this.loadTexture(ASSETS.textures.wood, [1.6, 1.15]);

    const tableBase = new THREE.Mesh(
      new THREE.BoxGeometry(6.08, 0.28, 4.02),
      new THREE.MeshStandardMaterial({ map: wood, color: 0x4b2925, roughness: 0.9 }),
    );
    tableBase.position.set(0, 0.41, -0.05);
    tableBase.castShadow = true;
    tableBase.receiveShadow = true;
    this.scene.add(tableBase);

    const outerFelt = new THREE.Mesh(
      new THREE.PlaneGeometry(5.82, 3.76),
      new THREE.MeshStandardMaterial({ color: 0x625f50, roughness: 0.96, metalness: 0.01 }),
    );
    outerFelt.rotation.x = -Math.PI / 2;
    outerFelt.position.set(0, 0.557, -0.04);
    outerFelt.receiveShadow = true;
    this.scene.add(outerFelt);

    // Keep the supplied printed layout at its original dimensions while the
    // unprinted felt apron gives every item more physical room.
    const tableSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(5.22, 3.3),
      new THREE.MeshStandardMaterial({ map: felt, color: 0xb8b39a, roughness: 0.94, metalness: 0.01 }),
    );
    tableSurface.rotation.x = -Math.PI / 2;
    tableSurface.position.set(0, 0.558, -0.04);
    tableSurface.receiveShadow = true;
    this.scene.add(tableSurface);

    const railMaterial = new THREE.MeshStandardMaterial({ map: rust, color: 0x3a2522, roughness: 0.88, metalness: 0.34 });
    for (const [x, z, width, depth] of [
      [0, -1.98, 5.98, 0.14], [0, 1.88, 5.98, 0.14], [-2.98, -0.05, 0.14, 3.85], [2.98, -0.05, 0.14, 3.85],
    ] as const) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.14, depth), railMaterial);
      rail.position.set(x, 0.63, z);
      rail.castShadow = true;
      this.scene.add(rail);
    }

    const wallMaterial = new THREE.MeshStandardMaterial({ map: brick, color: 0x4b2426, roughness: 0.98 });
    for (const x of [-3.2, 3.2]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.4), wallMaterial);
      wall.position.set(x, 1.78, -2.66);
      wall.rotation.y = x < 0 ? 0.27 : -0.27;
      wall.receiveShadow = true;
      this.scene.add(wall);
    }

    const rearVoid = new THREE.Mesh(
      new THREE.PlaneGeometry(4.15, 3.2),
      new THREE.MeshBasicMaterial({ color: 0x010101 }),
    );
    rearVoid.position.set(0, 1.72, -2.92);
    this.scene.add(rearVoid);

    const metalMaterial = new THREE.MeshStandardMaterial({ map: rust, color: 0x453538, roughness: 0.78, metalness: 0.62 });
    const enclosureMaterial = new THREE.MeshStandardMaterial({ map: brick, color: 0x24191a, roughness: 0.98 });
    const floorMaterial = new THREE.MeshStandardMaterial({ map: rust, color: 0x211c1b, roughness: 0.9, metalness: 0.28 });
    const roomFloor = new THREE.Mesh(new THREE.PlaneGeometry(6.35, 8.35), floorMaterial);
    roomFloor.rotation.x = -Math.PI / 2;
    roomFloor.position.set(0, 0.03, 0.92);
    roomFloor.receiveShadow = true;
    this.scene.add(roomFloor);
    const roomCeiling = new THREE.Mesh(new THREE.PlaneGeometry(6.35, 8.35), enclosureMaterial);
    roomCeiling.rotation.x = Math.PI / 2;
    roomCeiling.position.set(0, 3.03, 0.92);
    roomCeiling.receiveShadow = true;
    this.scene.add(roomCeiling);
    for (const x of [-3.12, 3.12]) {
      const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(8.35, 3.02), enclosureMaterial);
      sideWall.position.set(x, 1.52, 0.92);
      sideWall.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      sideWall.receiveShadow = true;
      this.scene.add(sideWall);
    }

    const entryWallMaterial = new THREE.MeshStandardMaterial({ map: rust, color: 0x33292a, roughness: 0.84, metalness: 0.46 });
    for (const [x, width] of [[-2.02, 2.55], [2.02, 2.55]] as const) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(width, 3.0, 0.18), entryWallMaterial);
      panel.position.set(x, 1.5, 4.86);
      panel.castShadow = true;
      panel.receiveShadow = true;
      this.scene.add(panel);
    }
    const entryHeader = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.58, 0.2), entryWallMaterial);
    entryHeader.position.set(0, 2.72, 4.86);
    entryHeader.castShadow = true;
    this.scene.add(entryHeader);
    const entryDark = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.46), new THREE.MeshBasicMaterial({ color: 0x010101 }));
    entryDark.position.set(0, 1.23, 4.97);
    entryDark.rotation.y = Math.PI;
    this.scene.add(entryDark);
    this.roomEntryDoor.name = "dealer-room-entry-door";
    this.roomEntryDoor.position.set(-0.75, 0, 4.74);
    this.roomEntryDoor.rotation.y = -1.26;
    const entryDoorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.48, 2.46, 0.13),
      new THREE.MeshStandardMaterial({ map: rust, color: 0x514345, roughness: 0.79, metalness: 0.5 }),
    );
    entryDoorMesh.position.set(0.74, 1.23, 0);
    entryDoorMesh.castShadow = true;
    const entryKickPlate = new THREE.Mesh(new THREE.BoxGeometry(1.23, 0.3, 0.025), metalMaterial);
    entryKickPlate.position.set(0.74, 0.24, -0.078);
    const entryHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.23, 10), metalMaterial);
    entryHandle.rotation.x = Math.PI / 2;
    entryHandle.position.set(1.24, 1.22, -0.12);
    this.roomEntryDoor.add(entryDoorMesh, entryKickPlate, entryHandle);
    this.scene.add(this.roomEntryDoor);

    for (const z of [-2.45, -1.05, 0.42, 1.9, 3.35, 4.58]) {
      const overheadBeam = new THREE.Mesh(new THREE.BoxGeometry(6.32, 0.13, 0.16), metalMaterial);
      overheadBeam.position.set(0, 2.84, z);
      overheadBeam.rotation.z = Math.sin(z * 1.7) * 0.018;
      overheadBeam.castShadow = true;
      this.scene.add(overheadBeam);
    }
    for (const x of [-2.78, 2.78]) {
      for (const y of [2.26, 2.52]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 7.5, 10), metalMaterial);
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(x, y, 0.75);
        pipe.castShadow = true;
        this.scene.add(pipe);
      }
      const tank = new THREE.Group();
      const tankBody = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 1.25, 14), entryWallMaterial);
      tankBody.position.y = 0.72;
      const tankCap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 8), entryWallMaterial);
      tankCap.scale.y = 0.55;
      tankCap.position.y = 1.34;
      const tankValve = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 18), metalMaterial);
      tankValve.rotation.x = Math.PI / 2;
      tankValve.position.y = 1.53;
      tank.add(tankBody, tankCap, tankValve);
      tank.position.set(x, 0.03, 2.6);
      tank.rotation.z = x < 0 ? -0.035 : 0.035;
      tank.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      this.scene.add(tank);
    }
    for (const [x, y, z, width, height] of [
      [-2.92, 1.34, 1.28, 0.12, 0.76],
      [2.92, 1.56, 0.55, 0.12, 0.92],
      [-2.92, 1.86, -0.85, 0.12, 0.52],
    ] as const) {
      const junction = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.58), entryWallMaterial);
      junction.position.set(x, y, z);
      junction.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      junction.castShadow = true;
      this.scene.add(junction);
    }
    for (const x of [-2.54, 2.54]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.13, 2.9, 0.13), metalMaterial);
      post.position.set(x, 1.55, -2.2);
      post.rotation.z = x < 0 ? -0.08 : 0.08;
      this.scene.add(post);
    }
    const topBeam = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.12, 0.15), metalMaterial);
    topBeam.position.set(0, 2.62, -2.12);
    this.scene.add(topBeam);

    this.buildCables(metalMaterial);
    this.buildSpeaker(-2.27, 1.58, -2.22);
    this.buildSpeaker(2.27, 1.58, -2.22);
    this.buildEquipmentRack(-2.05, 0.96, -1.7);
    this.buildEquipmentRack(2.05, 0.96, -1.7);
    const rearPipeMaterial = new THREE.MeshStandardMaterial({ map: rust, color: 0x352b2b, roughness: 0.7, metalness: 0.72 });
    for (const x of [-1.72, -1.46, 1.46, 1.72]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 2.4, 10), rearPipeMaterial);
      pipe.position.set(x, 1.38, -2.78);
      pipe.castShadow = true;
      this.scene.add(pipe);
      for (const y of [0.42, 2.34]) {
        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.012, 7, 14), metalMaterial);
        collar.rotation.x = Math.PI / 2;
        collar.position.set(x, y, -2.78);
        this.scene.add(collar);
      }
    }
    const cableTray = new THREE.Mesh(new THREE.BoxGeometry(3.86, 0.14, 0.38), metalMaterial);
    cableTray.position.set(0, 2.52, -2.72);
    cableTray.castShadow = true;
    this.scene.add(cableTray);
    for (const x of [-1.12, 1.12]) {
      const fanHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 24), metalMaterial);
      fanHousing.rotation.x = Math.PI / 2;
      fanHousing.position.set(x, 1.74, -2.75);
      const fanRim = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.045, 9, 28), rearPipeMaterial);
      fanRim.position.set(x, 1.74, -2.65);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.09, 12), rearPipeMaterial);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(x, 1.74, -2.63);
      this.scene.add(fanHousing, fanRim, hub);
      for (let bladeIndex = 0; bladeIndex < 5; bladeIndex += 1) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.025), rearPipeMaterial);
        blade.position.set(x, 1.74, -2.6);
        blade.rotation.z = bladeIndex * (Math.PI * 2 / 5) + 0.22;
        blade.translateY(0.15);
        this.scene.add(blade);
      }
    }
    for (const x of [-2.48, 2.48]) {
      const hangingCable = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 8, 28, Math.PI * 1.35), rearPipeMaterial);
      hangingCable.position.set(x, 2.24, -2.5);
      hangingCable.rotation.z = x < 0 ? 0.38 : -0.38;
      this.scene.add(hangingCable);
    }
    this.buildIndustrialDetails(rust);

    this.roomLightLeft.position.set(-1.0, 2.08, -1.82);
    this.roomLightRight.position.set(1.0, 2.08, -1.82);
    this.roomLightLeft.target.position.set(-0.75, 0.5, -0.05);
    this.roomLightRight.target.position.set(0.75, 0.5, -0.05);
    this.roomLightLeft.castShadow = false;
    this.roomLightRight.castShadow = false;
    this.scene.add(this.roomLightLeft, this.roomLightRight, this.roomLightLeft.target, this.roomLightRight.target);
    this.buildSpotlightHousing(-1.0, 2.08, -1.82, metalMaterial);
    this.buildSpotlightHousing(1.0, 2.08, -1.82, metalMaterial);
    this.scene.add(new THREE.HemisphereLight(0x715d5b, 0x110908, 1.08));
    const dealerFaceLight = new THREE.PointLight(0xff9a80, 8.4, 2.7, 1.85);
    dealerFaceLight.position.set(0, 1.9, -1.42);
    this.scene.add(dealerFaceLight);

    this.muzzleLight.position.set(0, 1.0, -0.1);

    const dustGeometry = new THREE.BufferGeometry();
    const dust = new Float32Array(120 * 3);
    for (let index = 0; index < dust.length; index += 3) {
      dust[index] = (Math.random() - 0.5) * 6.5;
      dust[index + 1] = Math.random() * 3;
      dust[index + 2] = -3 + Math.random() * 5;
    }
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(dust, 3));
    const particles = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xdab6a0, size: 0.01, transparent: true, opacity: 0.25, depthWrite: false }));
    particles.name = "dust";
    this.scene.add(particles);
  }

  private buildIndustrialDetails(rustTexture: THREE.Texture): void {
    const root = new THREE.Group();
    root.name = "industrial-details";
    const agedMetal = new THREE.MeshStandardMaterial({ map: rustTexture, color: 0x403738, roughness: 0.77, metalness: 0.68 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x171719, roughness: 0.72, metalness: 0.76 });
    const brass = new THREE.MeshStandardMaterial({ color: 0x776545, roughness: 0.65, metalness: 0.72 });
    const warning = new THREE.MeshStandardMaterial({ color: 0x8f5d24, roughness: 0.84, metalness: 0.28 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 1 });
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0x3b0b08, emissive: 0xb12417, emissiveIntensity: 2.4, roughness: 0.5 });

    const ductGeometry = new THREE.CylinderGeometry(0.14, 0.16, 6.65, 14);
    const collarGeometry = new THREE.TorusGeometry(0.165, 0.018, 7, 18);
    for (const x of [-2.15, 2.15]) {
      const duct = new THREE.Mesh(ductGeometry, agedMetal);
      duct.rotation.x = Math.PI / 2;
      duct.position.set(x, 2.68, 0.75);
      root.add(duct);
      for (const z of [-2.1, -0.65, 0.8, 2.25, 3.65]) {
        const collar = new THREE.Mesh(collarGeometry, darkMetal);
        collar.position.set(x, 2.68, z);
        root.add(collar);
      }
    }

    const boltGeometry = new THREE.CylinderGeometry(0.034, 0.034, 0.025, 8);
    for (const z of [-1.7, 1.6]) {
      for (const x of [-2.48, -1.65, -0.82, 0, 0.82, 1.65, 2.48]) {
        const bolt = new THREE.Mesh(boltGeometry, brass);
        bolt.position.set(x, 0.715, z);
        root.add(bolt);
      }
    }
    for (const x of [-2.66, 2.66]) {
      for (const z of [-1.25, -0.55, 0.15, 0.85, 1.45]) {
        const bolt = new THREE.Mesh(boltGeometry, brass);
        bolt.position.set(x, 0.715, z);
        root.add(bolt);
      }
    }

    for (const side of [-1, 1]) {
      const cabinet = new THREE.Group();
      cabinet.position.set(side * 2.96, 1.48, 1.04);
      const casing = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.94, 0.86), agedMetal);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.78, 0.7), darkMetal);
      door.position.x = -side * 0.125;
      cabinet.add(casing, door);
      for (let index = 0; index < 4; index += 1) {
        const fuse = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, 0.1), index % 2 ? warning : brass);
        fuse.position.set(-side * 0.15, 0.23 - index * 0.15, -0.2 + (index % 2) * 0.38);
        cabinet.add(fuse);
      }
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.013, 6, 14, Math.PI), brass);
      handle.position.set(-side * 0.16, -0.05, 0.22);
      handle.rotation.y = Math.PI / 2;
      handle.rotation.z = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      cabinet.add(handle);
      root.add(cabinet);

      const gauge = new THREE.Group();
      gauge.position.set(side * 2.83, 1.72, -0.58);
      const gaugeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 24), agedMetal);
      gaugeBody.rotation.z = Math.PI / 2;
      const gaugeFace = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), new THREE.MeshStandardMaterial({ color: 0xb4a990, roughness: 0.95 }));
      gaugeFace.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      gaugeFace.position.x = -side * 0.066;
      const needle = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.14, 0.012), new THREE.MeshStandardMaterial({ color: 0x5c1714, roughness: 0.8 }));
      needle.position.x = -side * 0.075;
      needle.rotation.z = side * 0.64;
      gauge.add(gaugeBody, gaugeFace, needle);
      root.add(gauge);

      const fan = new THREE.Group();
      fan.position.set(side * 2.84, 2.13, 2.6);
      fan.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      const fanRim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 9, 28), agedMetal);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.09, 12), darkMetal);
      hub.rotation.x = Math.PI / 2;
      fan.add(fanRim, hub);
      for (let bladeIndex = 0; bladeIndex < 6; bladeIndex += 1) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.23, 0.025), darkMetal);
        blade.rotation.z = bladeIndex * Math.PI / 3;
        blade.translateY(0.12);
        fan.add(blade);
      }
      this.ventilationFans.push(fan);
      root.add(fan);

      const beaconHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.08, 12), darkMetal);
      beaconHousing.position.set(side * 2.72, 2.45, 0.02);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), lampMaterial.clone());
      beacon.scale.y = 0.72;
      beacon.position.set(side * 2.72, 2.53, 0.02);
      root.add(beaconHousing, beacon);
    }

    for (const x of [-1.75, 1.75]) {
      const grate = new THREE.Group();
      grate.position.set(x, 0.065, 3.05);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.035, 1.34), darkMetal);
      grate.add(frame);
      for (let index = -4; index <= 4; index += 1) {
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.045, 1.15), rubber);
        slot.position.set(index * 0.13, 0.025, 0);
        grate.add(slot);
      }
      root.add(grate);
    }

    for (let index = 0; index < 5; index += 1) {
      const cable = new THREE.Mesh(new THREE.TorusGeometry(0.48 + index * 0.035, 0.018, 7, 30, Math.PI * 1.26), index % 2 ? rubber : darkMetal);
      cable.position.set(-0.12 + index * 0.06, 2.74 - index * 0.025, -0.25 + index * 0.11);
      cable.rotation.z = 0.76 + index * 0.04;
      cable.rotation.y = Math.PI / 2;
      root.add(cable);
    }

    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
    });
    this.scene.add(root);
  }

  private buildDealer(): void {
    const dealer = new THREE.Group();
    dealer.name = "dealer";
    dealer.position.set(0, 1.55, -2.28);
    const skin = new THREE.MeshStandardMaterial({ color: 0x9c665d, roughness: 0.98, metalness: 0.02 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x030202, roughness: 1 });
    const tooth = new THREE.MeshStandardMaterial({ color: 0xd1c0a2, roughness: 0.88 });

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.43, 22, 15), skin);
    head.scale.set(1.02, 1.11, 0.72);
    head.rotation.z = -0.055;
    head.castShadow = true;
    dealer.add(head);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.33, 18, 10), skin);
    jaw.scale.set(1.12, 0.62, 0.72);
    jaw.position.set(0.012, -0.25, 0.02);
    jaw.castShadow = true;
    dealer.add(jaw);
    for (const x of [-0.34, 0.34]) {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), skin);
      cheek.scale.set(0.7, 1.15, 0.54);
      cheek.position.set(x, -0.055, 0.22);
      cheek.rotation.z = x < 0 ? -0.28 : 0.28;
      dealer.add(cheek);
    }

    for (const [index, x] of [-0.15, 0.15].entries()) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.145, 12, 8), dark);
      socket.scale.set(index === 0 ? 1.16 : 0.96, index === 0 ? 1.28 : 1.1, 0.34);
      socket.position.set(x + (index === 0 ? -0.008 : 0.012), index === 0 ? 0.095 : 0.112, 0.29);
      socket.rotation.z = index === 0 ? -0.12 : 0.08;
      dealer.add(socket);
    }
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.285, 16, 8), dark);
    mouth.scale.set(1.3, 0.58, 0.25);
    mouth.position.set(0.008, -0.16, 0.31);
    mouth.rotation.z = 0.045;
    dealer.add(mouth);
    for (let index = 0; index < 13; index += 1) {
      const x = -0.248 + index * 0.0415;
      for (const upper of [true, false]) {
        const variation = ((index * 17 + (upper ? 5 : 11)) % 9) / 100;
        const curve = Math.abs(x) * 0.13;
        const fang = new THREE.Mesh(new THREE.ConeGeometry(0.016 + (index % 3) * 0.002, 0.073 + variation, 5), tooth);
        fang.position.set(x, upper ? -0.078 - curve : -0.232 + curve, 0.395 + (index % 2) * 0.006);
        fang.rotation.z = (upper ? Math.PI : 0) + (index % 2 ? 0.085 : -0.07);
        fang.rotation.y = index % 2 ? 0.16 : -0.16;
        dealer.add(fang);
      }
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 5), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.0, 0.39);
    dealer.add(nose);

    const scarMaterial = new THREE.MeshStandardMaterial({ color: 0x4b2524, roughness: 1 });
    for (const [x, y, scale] of [[-0.3, -0.025, 0.075], [0.3, -0.045, 0.06], [-0.21, 0.28, 0.048]] as const) {
      const scar = new THREE.Mesh(new THREE.SphereGeometry(scale, 9, 6), scarMaterial);
      scar.scale.set(1.7, 0.45, 0.2);
      scar.position.set(x, y, 0.37);
      scar.rotation.z = x * 0.8;
      dealer.add(scar);
    }

    this.mergeDirectMeshes(dealer);
    this.dealer = dealer;
    this.soloDealer = dealer;
    dealer.userData.restY = this.dealerRestY;
    this.scene.add(dealer);
  }

  private mergeStaticRoomGeometry(): void {
    this.scene.updateMatrixWorld(true);
    const dynamicRoots = new Set<THREE.Object3D>([this.roomEntryDoor, ...this.ventilationFans]);
    const isDynamic = (object: THREE.Object3D): boolean => {
      let current: THREE.Object3D | null = object;
      while (current) {
        if (dynamicRoots.has(current) || current.userData.interaction) return true;
        current = current.parent;
      }
      return false;
    };
    const groups = new Map<string, { material: THREE.Material; entries: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry }[] }>();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || isDynamic(object)) return;
      if (Array.isArray(object.material) || !(object.geometry instanceof THREE.BufferGeometry)) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      const key = this.materialBatchKey(object.material);
      const group = groups.get(key) ?? {
        material: object.material,
        entries: [] as { mesh: THREE.Mesh; geometry: THREE.BufferGeometry }[],
      };
      group.entries.push({ mesh: object, geometry });
      groups.set(key, group);
    });
    for (const { material, entries } of groups.values()) {
      if (entries.length < 2) {
        entries.forEach(({ geometry }) => geometry.dispose());
        continue;
      }
      const mergedGeometry = mergeGeometries(entries.map(({ geometry }) => geometry), false);
      entries.forEach(({ geometry }) => geometry.dispose());
      if (!mergedGeometry) continue;
      const mergedMesh = new THREE.Mesh(mergedGeometry, material);
      mergedMesh.name = "static-room-batch";
      this.scene.add(mergedMesh);
      for (const { mesh } of entries) mesh.parent?.remove(mesh);
    }
  }

  private mergeDirectMeshes(root: THREE.Group): void {
    root.updateMatrixWorld(true);
    const groups = new Map<string, { material: THREE.Material; entries: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry }[] }>();
    for (const child of [...root.children]) {
      if (!(child instanceof THREE.Mesh) || child instanceof THREE.SkinnedMesh || Array.isArray(child.material)) continue;
      child.updateMatrix();
      const geometry = child.geometry.clone();
      geometry.applyMatrix4(child.matrix);
      const key = child.material.uuid;
      const group = groups.get(key) ?? {
        material: child.material,
        entries: [] as { mesh: THREE.Mesh; geometry: THREE.BufferGeometry }[],
      };
      group.entries.push({ mesh: child, geometry });
      groups.set(key, group);
    }
    for (const { material, entries } of groups.values()) {
      const geometry = mergeGeometries(entries.map((entry) => entry.geometry), false);
      entries.forEach((entry) => entry.geometry.dispose());
      if (!geometry) continue;
      entries.forEach((entry) => root.remove(entry.mesh));
      root.add(new THREE.Mesh(geometry, material));
    }
  }

  private materialBatchKey(material: THREE.Material): string {
    const candidate = material as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
      roughness?: number;
      metalness?: number;
      map?: THREE.Texture | null;
      normalMap?: THREE.Texture | null;
      roughnessMap?: THREE.Texture | null;
      metalnessMap?: THREE.Texture | null;
      emissiveMap?: THREE.Texture | null;
      alphaMap?: THREE.Texture | null;
    };
    return [
      material.type,
      candidate.color?.getHexString() ?? "",
      candidate.emissive?.getHexString() ?? "",
      candidate.emissiveIntensity ?? "",
      candidate.roughness ?? "",
      candidate.metalness ?? "",
      candidate.map?.uuid ?? "",
      candidate.normalMap?.uuid ?? "",
      candidate.roughnessMap?.uuid ?? "",
      candidate.metalnessMap?.uuid ?? "",
      candidate.emissiveMap?.uuid ?? "",
      candidate.alphaMap?.uuid ?? "",
      Number(material.transparent),
      material.opacity,
      material.side,
      material.depthWrite,
      material.blending,
    ].join("|");
  }

  private buildMultiplayerRival(): void {
    const rival = new THREE.Group();
    rival.name = "multiplayer-rival";
    rival.position.set(0, 0.32, -2.3);
    rival.userData.restY = rival.position.y;
    rival.visible = false;

    const coat = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.94, metalness: 0.04 });
    const coatEdge = new THREE.MeshStandardMaterial({ color: 0x2e2928, roughness: 0.86, metalness: 0.12 });
    const hood = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.98 });
    const mask = new THREE.MeshStandardMaterial({ color: 0x393b3a, roughness: 0.54, metalness: 0.66 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x17241f, emissive: 0x183d2d, emissiveIntensity: 0.36, roughness: 0.18, metalness: 0.18 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x9a7064, roughness: 0.98 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.58, 7, 12), coat);
    torso.position.set(0, 0.68, 0);
    torso.scale.set(1.04, 1, 0.72);
    rival.add(torso);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.56, 0.18), coatEdge);
    chest.position.set(0, 0.74, 0.19);
    chest.rotation.x = -0.07;
    rival.add(chest);
    for (const x of [-0.19, 0.19]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.7, 0.035), mask);
      strap.position.set(x, 0.75, 0.295);
      strap.rotation.z = x < 0 ? -0.08 : 0.08;
      rival.add(strap);
    }

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.065, 8, 22, Math.PI * 1.45), coatEdge);
    collar.position.set(0, 1.14, 0.06);
    collar.rotation.set(Math.PI / 2, 0, -Math.PI * 0.72);
    rival.add(collar);

    const hoodShell = new THREE.Mesh(new THREE.SphereGeometry(0.33, 18, 14), hood);
    hoodShell.position.set(0, 1.39, 0.02);
    hoodShell.scale.set(0.91, 1.08, 0.82);
    rival.add(hoodShell);

    const facePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.255, 0.225, 0.13, 8), mask);
    facePlate.position.set(0, 1.38, 0.265);
    facePlate.rotation.x = Math.PI / 2;
    facePlate.scale.y = 1.08;
    rival.add(facePlate);
    for (const x of [-0.105, 0.105]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.073, 0.073, 0.035, 18), glass);
      lens.position.set(x, 1.445, 0.345);
      lens.rotation.x = Math.PI / 2;
      rival.add(lens);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.012, 8, 20), mask);
      rim.position.set(x, 1.445, 0.368);
      rival.add(rim);
    }
    const respirator = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.105, 0.14, 12), mask);
    respirator.position.set(0, 1.28, 0.385);
    respirator.rotation.x = Math.PI / 2;
    rival.add(respirator);
    for (let index = -2; index <= 2; index += 1) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.07, 0.012), glass);
      vent.position.set(index * 0.028, 1.28, 0.462);
      rival.add(vent);
    }

    const segment = (start: THREE.Vector3, end: THREE.Vector3, radius: number): THREE.Mesh => {
      const direction = end.clone().sub(start);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.05, direction.length() - radius * 2), 5, 9), coat);
      arm.position.copy(start).add(end).multiplyScalar(0.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      return arm;
    };
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Vector3(side * 0.34, 0.97, 0.04);
      const elbow = new THREE.Vector3(side * 0.5, 0.56, 0.34);
      const wrist = new THREE.Vector3(side * 0.48, 0.2, 0.66);
      rival.add(segment(shoulder, elbow, 0.09), segment(elbow, wrist, 0.075));
      const hand = this.createHand(skin);
      hand.position.copy(wrist);
      hand.rotation.set(-0.18, side < 0 ? -0.22 : 0.22, side < 0 ? -0.18 : 0.18);
      hand.scale.setScalar(0.82);
      rival.add(hand);
    }

    rival.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
    });
    this.multiplayerRival = rival;
    this.scene.add(rival);
    this.setOpponentMode(this.opponentMode);
  }

  private setOpponentMode(mode: GameMode): void {
    this.opponentMode = mode;
    if (this.soloDealer) this.soloDealer.visible = mode === "solo";
    if (this.multiplayerRival) this.multiplayerRival.visible = mode === "multiplayer";
    const active = mode === "multiplayer" ? this.multiplayerRival : this.soloDealer;
    if (!active) return;
    this.dealer = active;
    this.dealerRestY = Number(active.userData.restY ?? active.position.y);
  }

  private blendDealerIdleHands(actionBlend: number): void {
    for (const hand of this.dealerIdleHands) {
      const restScale = Number(hand.userData.restScale ?? 1);
      hand.scale.setScalar(THREE.MathUtils.lerp(restScale, 0.001, THREE.MathUtils.clamp(actionBlend, 0, 1)));
    }
  }

  private installAuthoredDealer(authoredPack: THREE.Group): void {
    const authoredDealer = new THREE.Group();
    for (const child of [...authoredPack.children]) {
      if (child.name === "The_Dealer" || child.name === "The_Dealer_Armature") authoredDealer.add(child);
    }
    if (!authoredDealer.getObjectByName("The_Dealer")) return;
    const dealerMap = this.loadTexture(ASSETS.dealerTexture);
    authoredDealer.traverse((node) => {
      if (node instanceof THREE.Bone && node.name === "HandL") {
        this.dealerHandBones.left = node;
        node.scale.setScalar(0.001);
      }
      if (node instanceof THREE.Bone && node.name === "HandR") {
        this.dealerHandBones.right = node;
        node.scale.setScalar(0.001);
      }
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhongMaterial)) continue;
        material.map = dealerMap;
        material.color.set(0xffffff);
        material.side = THREE.FrontSide;
        if (material instanceof THREE.MeshStandardMaterial) {
          material.roughness = 0.9;
          material.metalness = 0.02;
        }
        material.needsUpdate = true;
      }
    });
    const wrapper = this.normalizeModel(authoredDealer, 2.8);
    wrapper.name = "dealer";
    wrapper.position.set(0, 1.08, -2.3);
    wrapper.rotation.y = 0;
    wrapper.userData.restY = wrapper.position.y;
    this.dealerIdleHands = [];
    if (this.soloDealer) this.scene.remove(this.soloDealer);
    this.soloDealer = wrapper;
    this.scene.add(wrapper);
    this.setOpponentMode(this.opponentMode);
  }

  private installAuthoredShotgun(authoredPack: THREE.Group): void {
    const shotgunRoot = new THREE.Group();
    for (const child of [...authoredPack.children]) if (/shotgun/i.test(child.name)) shotgunRoot.add(child);
    if (shotgunRoot.children.length === 0) throw new Error("Authored shotgun mesh missing from Dealer pack");
    const itemMap = this.loadTexture(ASSETS.dealerItemsTexture);
    const emissionMap = this.loadTexture(ASSETS.dealerItemsEmission);
    shotgunRoot.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhongMaterial)) continue;
        material.map = itemMap;
        if (material instanceof THREE.MeshStandardMaterial) {
          material.emissiveMap = emissionMap;
          material.emissive.set(0x49362d);
          material.emissiveIntensity = 0.08;
          material.roughness = 0.7;
          material.metalness = 0.16;
        }
        material.needsUpdate = true;
      }
    });
    const model = this.normalizeModel(shotgunRoot, 1.58);
    const bounds = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    if (bounds.z > bounds.x && bounds.z >= bounds.y) model.rotation.y = Math.PI / 2;
    else if (bounds.y > bounds.x) model.rotation.z = -Math.PI / 2;
    const wrapper = new THREE.Group();
    wrapper.name = "shotgun";
    wrapper.add(model);
    wrapper.position.set(-0.06, 0.575, 0.08);
    wrapper.rotation.y = Math.PI / 2 - 0.12;
    this.tagInteraction(wrapper, "shotgun");
    if (this.shotgun) this.scene.remove(this.shotgun);
    this.shotgun = wrapper;
    this.scene.add(wrapper);
  }

  private installAuthoredItems(authoredPack: THREE.Group): void {
    const itemMap = this.loadTexture(ASSETS.dealerItemsTexture);
    const emissionMap = this.loadTexture(ASSETS.dealerItemsEmission);
    const specs: { item: ItemId; matches: (name: string) => boolean; size: number }[] = [
      { item: "magnifier", matches: (name) => name === "Magnifying_Glass", size: 0.34 },
      { item: "cigarettes", matches: (name) => name === "Cigarettes" || name === "Cigarette_Armature", size: 0.25 },
      { item: "handcuffs", matches: (name) => name === "Handcuffs" || name === "Handcuffs_Armature", size: 0.36 },
      { item: "beer", matches: (name) => name === "Beer", size: 0.34 },
    ];
    for (const spec of specs) {
      const root = new THREE.Group();
      for (const child of [...authoredPack.children]) if (spec.matches(child.name)) root.add(child);
      if (root.children.length === 0) continue;
      root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.castShadow = true;
        node.receiveShadow = true;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhongMaterial)) continue;
          material.map = itemMap;
          material.color.set(0xffffff);
          material.emissive.set(0x160c0a);
          material.emissiveMap = emissionMap;
          if (material instanceof THREE.MeshStandardMaterial) {
            material.emissiveIntensity = 0.21;
            material.roughness = 0.72;
            material.metalness = spec.item === "handcuffs" ? 0.54 : 0.08;
          }
          material.needsUpdate = true;
        }
      });
      this.itemTemplates.set(spec.item, this.normalizeModel(root, spec.size));
    }
  }

  private installLegacyShotgun(root: THREE.Group): void {
    const model = this.normalizeModel(root, 1.58);
    const wrapper = new THREE.Group();
    wrapper.name = "shotgun";
    wrapper.add(model);
    wrapper.position.set(-0.08, 0.575, 0.08);
    wrapper.rotation.y = Math.PI / 2 - 0.12;
    this.tagInteraction(wrapper, "shotgun");
    this.shotgun = wrapper;
    this.scene.add(wrapper);
  }

  private createHand(material: THREE.Material): THREE.Group {
    const group = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.064, 0.082, 5, 9), material);
    palm.rotation.x = Math.PI / 2;
    palm.scale.set(1.3, 0.9, 1);
    group.add(palm);
    for (let index = 0; index < 4; index += 1) {
      const x = (index - 1.5) * 0.039;
      const base = new THREE.Mesh(new THREE.CapsuleGeometry(0.017 + index * 0.0007, 0.064 - index * 0.003, 4, 7), material);
      base.rotation.x = Math.PI / 2;
      base.rotation.z = (index - 1.5) * 0.035;
      base.position.set(x, -0.006, 0.077 + Math.abs(index - 1.5) * 0.004);
      const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.015 + index * 0.0005, 0.043 - index * 0.002, 4, 7), material);
      tip.rotation.x = Math.PI / 2 + 0.44;
      tip.rotation.z = base.rotation.z;
      tip.position.set(x, -0.027, 0.132 + Math.abs(index - 1.5) * 0.004);
      group.add(base, tip);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.068, 4, 7), material);
    thumb.rotation.x = Math.PI / 2;
    thumb.rotation.z = -0.65;
    thumb.position.set(0.11, -0.02, 0.045);
    group.add(thumb);
    group.traverse((node) => { if (node instanceof THREE.Mesh) node.castShadow = true; });
    return group;
  }

  private buildHealthMachine(): void {
    const group = new THREE.Group();
    group.name = "health-machine";
    group.position.set(2.7, 0.84, -0.16);
    group.rotation.y = -0.72;
    group.rotation.x = -0.12;
    const casing = new THREE.Mesh(
      new THREE.BoxGeometry(1.08, 0.43, 0.27),
      new THREE.MeshStandardMaterial({ map: this.loadTexture(ASSETS.textures.briefcaseSteel), color: 0x56504b, roughness: 0.83, metalness: 0.62 }),
    );
    casing.castShadow = true;
    group.add(casing);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.91, 0.27),
      new THREE.MeshBasicMaterial({ map: this.healthTexture, toneMapped: false }),
    );
    screen.position.set(0, 0.015, 0.139);
    group.add(screen);
    for (const x of [-0.45, 0.45]) {
      const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.33, 8), new THREE.MeshStandardMaterial({ color: 0x665c52, metalness: 0.72, roughness: 0.5 }));
      coil.position.set(x, 0.31, 0);
      group.add(coil);
    }
    this.scene.add(group);
  }

  private drawHealth(state: GameState, localActor: Actor): void {
    const context = this.healthCanvas.getContext("2d");
    if (!context) return;
    const rival = other(localActor);
    context.fillStyle = "#030704";
    context.fillRect(0, 0, this.healthCanvas.width, this.healthCanvas.height);
    context.strokeStyle = "#2cff69";
    context.lineWidth = 4;
    context.strokeRect(8, 8, 752, 240);
    context.font = "32px monospace";
    context.fillStyle = "#b9ffc8";
    context.fillText(state.mode === "solo" ? "DEALER" : "OTHER", 28, 57);
    context.fillText(this.playerName, 28, 173);
    context.font = "46px monospace";
    context.fillStyle = "#31ff68";
    const bolts = (actor: Actor) => state.suddenDeath[actor] ? "☠" : "ϟ".repeat(Math.max(0, state.health[actor]));
    context.fillText(bolts(rival), 260, 62);
    context.fillText(bolts(localActor), 260, 180);
    context.strokeStyle = "#1c8f43";
    context.beginPath();
    context.moveTo(20, 104);
    context.lineTo(744, 104);
    context.stroke();
    this.healthTexture.needsUpdate = true;
  }

  private commitPendingShotHealth(event: Extract<GameEvent, { kind: "shot" }>): void {
    if (event.shell !== "live" || !this.pendingHealthDraw) return;
    this.drawHealth(this.pendingHealthDraw.state, this.pendingHealthDraw.localActor);
    this.pendingHealthDraw = null;
  }

  private buildShellRack(): void {
    const rack = new THREE.Group();
    rack.name = "shell-rack";
    rack.position.set(1.28, 0.578, -0.31);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.045, 0.31), new THREE.MeshStandardMaterial({ color: 0x392f2d, roughness: 0.88, metalness: 0.35 }));
    base.castShadow = true;
    rack.add(base);
    for (let index = 0; index < 8; index += 1) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.025, 0.23), new THREE.MeshStandardMaterial({ color: 0x090807, roughness: 1 }));
      slot.position.set(-0.49 + index * 0.14, 0.033, 0);
      rack.add(slot);
    }
    this.shellRackShells.position.y = 0.09;
    this.shellRackShells.visible = false;
    rack.add(this.shellRackShells);
    this.scene.add(rack);
  }

  private rebuildShells(chamber: Shell[]): void {
    for (const child of [...this.shellRackShells.children]) this.disposeUniqueObject(child);
    this.shellRackShells.clear();
    chamber.slice(0, 8).forEach((shell, index) => {
      const round = this.createShell(shell);
      round.scale.setScalar(0.78);
      round.position.set(-0.49 + index * 0.14, 0, 0);
      round.rotation.x = Math.PI / 2;
      this.shellRackShells.add(round);
    });
  }

  private createShell(shell: Shell): THREE.Group {
    const group = new THREE.Group();
    const shellMap = this.loadTexture(shell === "live" ? ASSETS.textures.shellLive : ASSETS.textures.shellBlank);
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.039, 0.18, 12), new THREE.MeshStandardMaterial({ map: shellMap, color: shell === "live" ? 0xc45a5d : 0x657f8d, roughness: 0.7 }));
    const brass = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.045, 10), new THREE.MeshStandardMaterial({ color: 0xb79255, roughness: 0.35, metalness: 0.82 }));
    brass.position.y = -0.108;
    group.add(hull, brass);
    group.traverse((node) => { if (node instanceof THREE.Mesh) node.castShadow = true; });
    return group;
  }

  private buildBriefcase(): void {
    const group = new THREE.Group();
    group.position.set(0, 0.62, 1.13);
    const material = new THREE.MeshStandardMaterial({ map: this.loadTexture(ASSETS.textures.briefcaseCarbon), color: 0x3b3433, roughness: 0.68, metalness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ map: this.loadTexture(ASSETS.textures.briefcaseSteel), color: 0x5b514c, roughness: 0.72, metalness: 0.62 });
    const caseBottom = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.16, 0.72), material);
    caseBottom.position.z = 0;
    group.add(caseBottom);
    const lid = new THREE.Group();
    lid.name = "briefcase-lid";
    lid.position.set(0, 0.2, -0.35);
    lid.rotation.x = -1.2;
    const lidShell = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.075, 0.7), material);
    lidShell.position.z = 0.35;
    const lidLining = new THREE.Mesh(new THREE.BoxGeometry(1.19, 0.018, 0.54), new THREE.MeshStandardMaterial({ color: 0x0b0909, roughness: 0.96 }));
    lidLining.position.set(0, -0.048, 0.35);
    lid.add(lidShell, lidLining);
    for (const x of [-0.63, 0.63]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.62), steel);
      rail.position.set(x, -0.064, 0.35);
      lid.add(rail);
    }
    for (const z of [0.065, 0.635]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.03, 0.035), steel);
      rail.position.set(0, -0.064, z);
      lid.add(rail);
    }
    group.add(lid);
    this.briefcaseItems.position.set(0, 0.16, 0);
    group.add(this.briefcaseItems);
    for (const x of [-0.5, 0, 0.5]) {
      const divider = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.58), steel);
      divider.position.set(x, 0.12, 0);
      group.add(divider);
    }
    group.visible = false;
    this.briefcase = group;
    this.scene.add(group);
  }

  private rebuildItems(state: GameState, localActor: Actor): void {
    this.localItems.clear();
    this.dealerItems.clear();
    const localSlots: THREE.Vector3Tuple[] = [
      [-2.34, 0.59, 0.76], [-1.48, 0.59, 0.76], [1.48, 0.59, 0.76], [2.34, 0.59, 0.76],
      [-2.34, 0.59, 1.4], [-1.48, 0.59, 1.4], [1.48, 0.59, 1.4], [2.34, 0.59, 1.4],
    ];
    const dealerSlots: THREE.Vector3Tuple[] = [
      [-2.34, 0.59, -0.82], [-1.48, 0.59, -0.82], [1.48, 0.59, -0.82], [2.34, 0.59, -0.82],
      [-2.34, 0.59, -1.48], [-1.48, 0.59, -1.48], [1.48, 0.59, -1.48], [2.34, 0.59, -1.48],
    ];
    this.populateItems(this.localItems, state.inventory[localActor], localSlots, true);
    this.populateItems(this.dealerItems, state.inventory[other(localActor)], dealerSlots, false);
  }

  private populateItems(parent: THREE.Group, inventory: ItemId[], slots: THREE.Vector3Tuple[], interactive: boolean): void {
    inventory.slice(0, 8).forEach((item, index) => {
      const template = this.itemTemplates.get(item);
      if (!template) return;
      const instance = cloneSkeleton(template) as THREE.Group;
      instance.name = `${interactive ? "local" : "dealer"}-item:${item}`;
      instance.position.set(slots[index][0], 0, slots[index][2]);
      instance.rotation.copy(this.itemTableRotation(item, interactive, index));
      instance.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(instance);
      instance.position.y += slots[index][1] - bounds.min.y + 0.006;
      if (interactive) this.tagInteraction(instance, `item:${item}`);
      parent.add(instance);
    });
  }

  private itemTableRotation(item: ItemId, interactive: boolean, index: number): THREE.Euler {
    const facing = interactive ? 0 : Math.PI;
    const stagger = (index % 4 - 1.5) * 0.07;
    const yaw: Partial<Record<ItemId, number>> = {
      magnifier: -0.28,
      cigarettes: 0.08,
      handSaw: 0.2,
      handcuffs: 0.32,
      beer: -0.08,
      burnerPhone: -0.16,
      inverter: 0.12,
      adrenaline: 0.24,
      expiredMedicine: -0.1,
      jammer: 0.06,
      remote: -0.2,
    };
    return new THREE.Euler(
      item === "cigarettes" ? (interactive ? -Math.PI / 2 : Math.PI / 2) : 0,
      facing + (yaw[item] ?? 0) + stagger,
      item === "cigarettes" ? (interactive ? -0.08 : 0.08) : 0,
    );
  }

  private itemActionScale(item: ItemId): number {
    const scales: Record<ItemId, number> = {
      magnifier: 1.02,
      cigarettes: 1.02,
      handSaw: 0.96,
      handcuffs: 0.96,
      beer: 1.04,
      burnerPhone: 1,
      inverter: 1,
      adrenaline: 1,
      expiredMedicine: 1,
      jammer: 1,
      remote: 1,
    };
    return scales[item];
  }

  private itemActionRotation(item: ItemId, actorIsLocal: boolean): THREE.Euler {
    const sign = actorIsLocal ? 1 : -1;
    const rotations: Record<ItemId, THREE.Euler> = {
      magnifier: new THREE.Euler(-0.08, sign * 0.32, sign * -0.12),
      cigarettes: new THREE.Euler(-0.12, sign * 0.24, sign * 0.06),
      handSaw: new THREE.Euler(0.02, sign * 0.16, sign * -0.28),
      handcuffs: new THREE.Euler(-0.06, sign * 0.3, sign * 0.1),
      beer: new THREE.Euler(0, sign * 0.16, 0),
      burnerPhone: new THREE.Euler(-0.16, sign * 0.34, sign * -0.12),
      inverter: new THREE.Euler(-0.08, sign * 0.22, 0),
      adrenaline: new THREE.Euler(0, sign * 0.16, sign * -0.42),
      expiredMedicine: new THREE.Euler(-0.08, sign * 0.2, sign * 0.06),
      jammer: new THREE.Euler(-0.14, sign * 0.28, 0),
      remote: new THREE.Euler(-0.2, sign * 0.3, sign * -0.08),
    };
    return rotations[item];
  }

  private itemGripOffset(item: ItemId, actorIsLocal: boolean): THREE.Vector3 {
    const sign = actorIsLocal ? 1 : -1;
    const offsets: Record<ItemId, THREE.Vector3> = {
      magnifier: new THREE.Vector3(0.17 * sign, -0.035, 0.045 * sign),
      cigarettes: new THREE.Vector3(-0.03 * sign, -0.035, 0.07 * sign),
      handSaw: new THREE.Vector3(-0.22 * sign, -0.055, 0.05 * sign),
      handcuffs: new THREE.Vector3(-0.09 * sign, -0.04, 0.045 * sign),
      beer: new THREE.Vector3(0.055 * sign, -0.06, 0.075 * sign),
      burnerPhone: new THREE.Vector3(0.04 * sign, -0.055, 0.07 * sign),
      inverter: new THREE.Vector3(-0.11 * sign, -0.045, 0.045 * sign),
      adrenaline: new THREE.Vector3(-0.15 * sign, -0.02, 0.035 * sign),
      expiredMedicine: new THREE.Vector3(-0.07 * sign, -0.055, 0.065 * sign),
      jammer: new THREE.Vector3(-0.11 * sign, -0.055, 0.055 * sign),
      remote: new THREE.Vector3(0.02 * sign, -0.045, 0.1 * sign),
    };
    return offsets[item];
  }

  private createProceduralItem(item: ItemId): THREE.Group {
    const group = new THREE.Group();
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x383331, metalness: 0.7, roughness: 0.5 });
    const red = new THREE.MeshStandardMaterial({ color: 0x6e2528, roughness: 0.74, metalness: 0.2 });
    const paper = new THREE.MeshStandardMaterial({ color: 0xb8aa91, roughness: 0.95 });
    const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.86, metalness: 0.16 });
    const green = new THREE.MeshBasicMaterial({ color: 0x7aff8d, toneMapped: false });

    if (item === "beer") {
      const label = new THREE.MeshStandardMaterial({ map: this.loadTexture(ASSETS.textures.beer), color: 0xd1c8b6, roughness: 0.62, metalness: 0.38 });
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.28, 16), label);
      can.position.y = 0.14;
      group.add(can);
    } else if (item === "handcuffs") {
      for (const x of [-0.09, 0.09]) {
        const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.016, 8, 18), darkMetal);
        cuff.rotation.x = Math.PI / 2;
        cuff.position.set(x, 0.035, 0);
        group.add(cuff);
      }
      const link = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.025), darkMetal);
      link.position.y = 0.035;
      group.add(link);
    } else if (item === "burnerPhone") {
      const shell = new THREE.MeshStandardMaterial({ color: 0x282626, roughness: 0.82, metalness: 0.12 });
      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.055, 0.27), shell);
      lower.position.y = 0.035;
      const keypadPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.145, 0.19), black);
      keypadPlate.rotation.x = -Math.PI / 2;
      keypadPlate.position.set(0, 0.065, 0.018);
      group.add(lower, keypadPlate);
      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 3; column += 1) {
          const key = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.012, 0.028), paper);
          key.position.set((column - 1) * 0.043, 0.075, -0.045 + row * 0.043);
          group.add(key);
        }
      }
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.19, 10), darkMetal);
      hinge.rotation.z = Math.PI / 2;
      hinge.position.set(0, 0.07, -0.142);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, 0.225), shell);
      upper.position.set(0, 0.17, -0.235);
      upper.rotation.x = -0.86;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.125, 0.105), new THREE.MeshBasicMaterial({ color: 0xaebcaf }));
      screen.position.set(0, 0.19, -0.205);
      screen.rotation.x = -0.86;
      const staticLine = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.008), green);
      staticLine.position.set(0, 0.218, -0.186);
      staticLine.rotation.x = -0.86;
      group.add(hinge, upper, screen, staticLine);
    } else if (item === "inverter") {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.2), paper);
      box.position.y = 0.05;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.265, 0.165), new THREE.MeshBasicMaterial({ map: this.loadTexture(ASSETS.textures.inverter) }));
      face.rotation.x = -Math.PI / 2;
      face.position.y = 0.096;
      group.add(box, face);
      for (const x of [-0.11, 0.11]) {
        const terminal = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.035, 9), darkMetal);
        terminal.position.set(x, 0.115, -0.055);
        group.add(terminal);
      }
      const toggle = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.055, 0.022), red);
      toggle.rotation.z = -0.36;
      toggle.position.set(0, 0.13, 0.05);
      group.add(toggle);
    } else if (item === "adrenaline") {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.31, 12), new THREE.MeshStandardMaterial({ color: 0xd8c59e, transparent: true, opacity: 0.72, roughness: 0.28 }));
      barrel.rotation.z = Math.PI / 2;
      barrel.position.y = 0.05;
      const fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x9b2428, transparent: true, opacity: 0.84, roughness: 0.36 }));
      fluid.rotation.z = Math.PI / 2;
      fluid.position.set(-0.035, 0.05, 0);
      const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.18, 6), darkMetal);
      needle.rotation.z = Math.PI / 2;
      needle.position.set(0.23, 0.05, 0);
      const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8), black);
      plunger.rotation.z = Math.PI / 2;
      plunger.position.set(-0.205, 0.05, 0);
      const thumbPad = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.09, 0.075), red);
      thumbPad.position.set(-0.27, 0.05, 0);
      for (const x of [-0.155, 0.155]) {
        const flange = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.09, 0.07), paper);
        flange.position.set(x, 0.05, 0);
        group.add(flange);
      }
      group.add(barrel, fluid, needle, plunger, thumbPad);
    } else if (item === "expiredMedicine") {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.19), paper);
      box.position.y = 0.06;
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.15), new THREE.MeshBasicMaterial({ map: this.loadTexture(ASSETS.textures.expiredMedicine) }));
      label.rotation.x = -Math.PI / 2;
      label.position.y = 0.122;
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.012, 0.185), red);
      flap.position.set(0.08, 0.128, 0);
      flap.rotation.z = -0.12;
      group.add(box, label, flap);
    } else if (item === "jammer") {
      const jammerMetal = new THREE.MeshStandardMaterial({ color: 0x4c514c, roughness: 0.46, metalness: 0.72 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.18), jammerMetal);
      body.position.y = 0.06;
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.06), new THREE.MeshBasicMaterial({ color: 0x30ff68 }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(0, 0.122, -0.02);
      for (const x of [-0.072, 0.072]) {
        const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.22, 8), darkMetal);
        antenna.position.set(x, 0.19, 0.055);
        antenna.rotation.z = x < 0 ? -0.08 : 0.08;
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: 0x4cff72 }));
        tip.position.set(x + (x < 0 ? 0.009 : -0.009), 0.303, 0.055);
        group.add(antenna, tip);
      }
      group.add(body, glow);
    } else if (item === "remote") {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.055, 0.3), darkMetal);
      body.position.y = 0.03;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.25), black);
      face.rotation.x = -Math.PI / 2;
      face.position.y = 0.06;
      const status = new THREE.Mesh(new THREE.PlaneGeometry(0.078, 0.035), green);
      status.rotation.x = -Math.PI / 2;
      status.position.set(0, 0.067, -0.09);
      group.add(body, face, status);
      for (let index = 0; index < 5; index += 1) {
        const button = new THREE.Mesh(new THREE.CylinderGeometry(index === 0 ? 0.025 : 0.016, index === 0 ? 0.025 : 0.016, 0.014, 10), index === 0 ? red : paper);
        button.position.set(index === 0 ? 0 : (index % 2 ? -0.035 : 0.035), 0.071, index === 0 ? 0.075 : -0.005 + Math.floor((index - 1) / 2) * 0.058);
        group.add(button);
      }
    } else if (item === "magnifier") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.018, 8, 20), darkMetal);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.035;
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.22, 8), new THREE.MeshStandardMaterial({ color: 0x4b2d24, roughness: 0.86 }));
      handle.rotation.z = Math.PI / 2;
      handle.position.set(0.17, 0.035, 0);
      group.add(ring, handle);
    } else if (item === "handSaw") {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.09), darkMetal);
      blade.position.set(0.08, 0.04, 0);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.055, 0.13), red);
      handle.position.set(-0.22, 0.05, 0);
      group.add(blade, handle);
    } else {
      const front = new THREE.MeshStandardMaterial({ map: this.loadTexture(ASSETS.textures.cigarettesFront), color: 0xd2c6ad, roughness: 0.92 });
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.16), front);
      pack.position.y = 0.045;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.16), paper);
      lid.position.set(0, 0.105, -0.012);
      lid.rotation.z = -0.08;
      group.add(pack, lid);
    }
    group.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    return group;
  }

  private createFallbackShotgun(): THREE.Group {
    const group = new THREE.Group();
    group.name = "shotgun";
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a281f, roughness: 0.82 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x2e2c2b, roughness: 0.48, metalness: 0.75 });
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.16, 0.75), wood);
    stock.position.z = 0.46;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.15, 0.4), metal);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.12, 12), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.73;
    group.add(stock, receiver, barrel);
    group.position.set(0, 0.66, 0.05);
    this.tagInteraction(group, "shotgun");
    return group;
  }

  private normalizeModel(root: THREE.Group, targetSize: number): THREE.Group {
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        const material = node.material as THREE.MeshStandardMaterial;
        if (material?.roughness !== undefined) material.roughness = Math.max(0.58, material.roughness);
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const dimensions = box.getSize(new THREE.Vector3());
    root.scale.setScalar(targetSize / Math.max(dimensions.x, dimensions.y, dimensions.z));
    const scaled = new THREE.Box3().setFromObject(root);
    const center = scaled.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -scaled.min.y, -center.z);
    const group = new THREE.Group();
    group.add(root);
    return group;
  }

  private async animateItemUse(item: ItemId, actorIsLocal: boolean): Promise<void> {
    while (this.animationBusy) await wait(60);
    const template = this.itemTemplates.get(item);
    if (!template) return;
    this.animationBusy = true;
    const prop = cloneSkeleton(template) as THREE.Group;
    prop.traverse((node) => { delete node.userData.interaction; });
    const start = new THREE.Vector3(actorIsLocal ? -1.34 : 1.16, actorIsLocal ? 0.48 : 0.76, actorIsLocal ? 1.66 : -1.48);
    const faceFocus = new THREE.Vector3(actorIsLocal ? 0.28 : 0.32, actorIsLocal ? 1.47 : 1.49, actorIsLocal ? 1.58 : -1.62);
    const chamberFocus = new THREE.Vector3(0.08, 0.91, 0.03);
    const rivalFocus = new THREE.Vector3(actorIsLocal ? 0.12 : -0.12, 1.1, actorIsLocal ? -1.58 : 1.34);
    const actionFocus = item === "handSaw" && this.shotgun
      ? this.shotgun.position.clone().add(new THREE.Vector3(0.04, 0.25, 0.04))
      : item === "magnifier" || item === "inverter"
        ? chamberFocus
        : item === "handcuffs" || item === "jammer"
          ? rivalFocus
          : item === "adrenaline"
            ? new THREE.Vector3(actorIsLocal ? -0.42 : 0.4, 1.25, actorIsLocal ? 1.45 : -1.64)
            : item === "remote"
              ? new THREE.Vector3(actorIsLocal ? 0.12 : -0.12, 1.26, actorIsLocal ? 1.52 : -1.7)
              : faceFocus;
    const stagedAction = item === "magnifier" || item === "inverter" || item === "handcuffs" || item === "jammer";
    const focus = stagedAction ? faceFocus : actionFocus;
    prop.position.copy(start);
    const propScale = this.itemActionScale(item);
    const pickupQuaternion = prop.quaternion.clone();
    const actionRotation = this.itemActionRotation(item, actorIsLocal);
    const actionQuaternion = new THREE.Quaternion().setFromEuler(actionRotation);
    prop.scale.setScalar(propScale * 0.72);
    this.scene.add(prop);
    const carrier = this.createHand(new THREE.MeshStandardMaterial({
      color: actorIsLocal ? 0xb58a7b : 0xc09382,
      roughness: 0.98,
    }));
    const sleeveVector = new THREE.Vector3(actorIsLocal ? -0.2 : 0.2, -0.36, actorIsLocal ? 0.12 : -0.14);
    const sleeve = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.052, 0.31, 5, 9),
      new THREE.MeshStandardMaterial({ color: actorIsLocal ? 0x171718 : 0x080707, roughness: 0.94 }),
    );
    sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sleeveVector.clone().normalize());
    sleeve.position.copy(sleeveVector).multiplyScalar(0.56);
    sleeve.castShadow = true;
    const cuff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.064, 0.058, 0.09, 10),
      new THREE.MeshStandardMaterial({ color: actorIsLocal ? 0x302c2d : 0x171212, roughness: 0.82 }),
    );
    cuff.quaternion.copy(sleeve.quaternion);
    cuff.position.copy(sleeveVector).multiplyScalar(0.16);
    cuff.castShadow = true;
    carrier.add(sleeve, cuff);
    const carrierScale = actorIsLocal ? 0.96 : 1.02;
    carrier.scale.setScalar(carrierScale);
    carrier.rotation.set(
      item === "handSaw" ? -0.62 : item === "beer" ? -0.38 : -0.5,
      actorIsLocal ? -0.18 : 0.2,
      actorIsLocal ? (item === "magnifier" ? -0.16 : 0.2) : (item === "magnifier" ? 0.16 : -0.18),
    );
    const carrierGripRotation = carrier.rotation.clone();
    const carrierApproachRotation = carrierGripRotation.clone();
    carrierApproachRotation.x += 0.34;
    carrierApproachRotation.y += actorIsLocal ? -0.22 : 0.22;
    carrierApproachRotation.z += actorIsLocal ? 0.26 : -0.26;
    carrier.rotation.copy(carrierApproachRotation);
    carrier.scale.setScalar(0.001);
    const carrierOffset = this.itemGripOffset(item, actorIsLocal);
    carrier.position.copy(start).add(carrierOffset);
    this.scene.add(carrier);
    const supportHand = this.createHand(new THREE.MeshStandardMaterial({
      color: actorIsLocal ? 0xb58a7b : 0xc09382,
      roughness: 0.98,
    }));
    const supportSleeveVector = new THREE.Vector3(actorIsLocal ? 0.18 : -0.18, -0.34, actorIsLocal ? 0.1 : -0.1);
    const supportSleeve = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.05, 0.29, 5, 9),
      new THREE.MeshStandardMaterial({ color: actorIsLocal ? 0x171718 : 0x080707, roughness: 0.94 }),
    );
    supportSleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), supportSleeveVector.clone().normalize());
    supportSleeve.position.copy(supportSleeveVector).multiplyScalar(0.56);
    supportSleeve.castShadow = true;
    supportHand.add(supportSleeve);
    supportHand.scale.setScalar(0.001);
    this.scene.add(supportHand);
    const placeSupportHand = (position: THREE.Vector3, rotation: THREE.Euler, blend: number): void => {
      supportHand.position.copy(position);
      supportHand.rotation.copy(rotation);
      supportHand.scale.setScalar(Math.max(0.001, carrierScale * blend));
    };
    const effectRoot = new THREE.Group();
    this.scene.add(effectRoot);
    const makeParticles = (color: number, count: number, size: number): THREE.Points => {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      for (let index = 0; index < count; index += 1) {
        positions[index * 3] = (Math.random() - 0.5) * 0.22;
        positions[index * 3 + 1] = Math.random() * 0.12;
        positions[index * 3 + 2] = (Math.random() - 0.5) * 0.16;
      }
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      return new THREE.Points(geometry, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0, depthWrite: false }));
    };
    const setCarrier = (offset = carrierOffset): void => { carrier.position.copy(prop.position).add(offset); };
    const baseRotation = actionRotation.clone();
    const leftIntensity = this.roomLightLeft.intensity;
    const rightIntensity = this.roomLightRight.intensity;
    const cameraStart = this.camera.position.clone();
    const lookStart = this.lookTarget.clone();
    const cameraClose = new THREE.Vector3(actorIsLocal ? 0.02 : -0.02, actorIsLocal ? 1.94 : 2.02, actorIsLocal ? 2.64 : 2.78);
    const cameraFocus = (item === "handSaw" || item === "magnifier" || item === "inverter") ? actionFocus.clone()
      : (item === "handcuffs" || item === "jammer") ? rivalFocus.clone()
        : actionFocus.clone();
    cameraFocus.y += item === "handcuffs" || item === "jammer" ? 0.08 : 0.02;

    try {
      this.onItemCue(item, "pickup");
      await this.tween(actorIsLocal ? 880 : 1050, (amount) => {
        const eased = this.easeInOut(amount);
        const handBlend = this.easeInOut(THREE.MathUtils.clamp(amount / 0.42, 0, 1));
        prop.position.lerpVectors(start, focus, eased);
        prop.position.y += Math.sin(amount * Math.PI) * 0.16;
        prop.scale.setScalar(THREE.MathUtils.lerp(propScale * 0.72, propScale, handBlend));
        prop.quaternion.slerpQuaternions(pickupQuaternion, actionQuaternion, eased);
        prop.rotateX(Math.sin(amount * Math.PI) * 0.06);
        const approachOffset = carrierOffset.clone().add(new THREE.Vector3(
          actorIsLocal ? -0.16 * (1 - handBlend) : 0.16 * (1 - handBlend),
          -0.22 * (1 - handBlend),
          actorIsLocal ? 0.22 * (1 - handBlend) : -0.22 * (1 - handBlend),
        ));
        setCarrier(approachOffset);
        carrier.scale.setScalar(Math.max(0.001, carrierScale * handBlend));
        if (!actorIsLocal && this.opponentMode === "solo") this.blendDealerIdleHands(handBlend);
        carrier.rotation.set(
          THREE.MathUtils.lerp(carrierApproachRotation.x, carrierGripRotation.x, handBlend),
          THREE.MathUtils.lerp(carrierApproachRotation.y, carrierGripRotation.y, handBlend),
          THREE.MathUtils.lerp(carrierApproachRotation.z, carrierGripRotation.z + amount * (actorIsLocal ? -0.1 : 0.1), handBlend),
        );
        this.camera.position.lerpVectors(cameraStart, cameraClose, eased);
        this.lookTarget.lerpVectors(lookStart, cameraFocus, eased);
      });
      this.onItemCue(item, "use");

      if (item === "handSaw" && this.shotgun) {
        this.onMechanicalCue("saw");
        const sparks = makeParticles(0xffb26d, 34, 0.028);
        sparks.position.copy(actionFocus).add(new THREE.Vector3(0, 0.03, 0));
        effectRoot.add(sparks);
        const sparkMaterial = sparks.material as THREE.PointsMaterial;
        const sawStart = prop.position.clone();
        await this.tween(2200, (amount) => {
          const stroke = Math.sin(amount * Math.PI * 12) * 0.2 * (1 - amount * 0.1);
          prop.position.copy(sawStart);
          prop.position.x += stroke;
          prop.position.y += Math.sin(amount * Math.PI) * 0.025;
          prop.rotation.z = -0.35 + Math.sin(amount * Math.PI * 12) * 0.08;
          setCarrier(new THREE.Vector3(actorIsLocal ? -0.13 : 0.13, -0.09, actorIsLocal ? 0.08 : -0.08));
          placeSupportHand(
            actionFocus.clone().add(new THREE.Vector3(actorIsLocal ? 0.26 : -0.26, -0.075, actorIsLocal ? 0.035 : -0.035)),
            new THREE.Euler(-0.68, actorIsLocal ? 0.12 : -0.12, actorIsLocal ? -0.22 : 0.22),
            this.easeInOut(THREE.MathUtils.clamp(amount / 0.16, 0, 1)),
          );
          sparkMaterial.opacity = Math.sin(amount * Math.PI * 12) > 0.2 ? (1 - amount) * 0.88 : 0.12;
          sparks.rotation.y += 0.1;
          sparks.position.y += 0.0012;
        });
      } else if (item === "magnifier") {
        const lensLight = new THREE.PointLight(0xe6fff1, 0, 1.4, 2);
        effectRoot.add(lensLight);
        const hold = prop.position.clone();
        await this.tween(1900, (amount) => {
          const travel = this.easeInOut(THREE.MathUtils.clamp(amount * 1.4, 0, 1));
          prop.position.lerpVectors(hold, chamberFocus, travel);
          prop.position.x += Math.sin(amount * Math.PI * 3.5) * 0.055;
          prop.position.y += Math.sin(amount * Math.PI * 2) * 0.018;
          prop.rotation.y = baseRotation.y + 0.7 + Math.sin(amount * Math.PI * 2) * 0.1;
          setCarrier();
          lensLight.position.copy(prop.position).add(new THREE.Vector3(0, 0.08, 0));
          lensLight.intensity = Math.sin(amount * Math.PI) * 7.5;
        });
      } else if (item === "cigarettes") {
        const cigarette = new THREE.Group();
        const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.16, 8), new THREE.MeshStandardMaterial({ color: 0xd9cdb4, roughness: 0.9 }));
        paper.rotation.z = Math.PI / 2;
        const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.055, 8), new THREE.MeshStandardMaterial({ color: 0xb7784f, roughness: 0.84 }));
        filter.rotation.z = Math.PI / 2;
        filter.position.x = -0.095;
        const ember = new THREE.PointLight(0xff6536, 0, 1.2, 2);
        ember.position.x = 0.085;
        cigarette.add(paper, filter, ember);
        cigarette.position.copy(prop.position).add(new THREE.Vector3(0.02, 0.09, 0.02));
        effectRoot.add(cigarette);
        const smoke = makeParticles(0xc2b7ad, 24, 0.035);
        effectRoot.add(smoke);
        const packStart = prop.position.clone();
        const cigaretteStart = packStart.clone().add(new THREE.Vector3(actorIsLocal ? 0.02 : -0.02, 0.1, 0.02));
        const mouth = faceFocus.clone().add(new THREE.Vector3(actorIsLocal ? 0.015 : -0.015, 0.075, actorIsLocal ? 0.06 : -0.06));
        const afterDrag = mouth.clone().add(new THREE.Vector3(actorIsLocal ? 0.18 : -0.18, -0.04, actorIsLocal ? 0.04 : -0.04));
        await this.tween(2850, (amount) => {
          const extract = this.easeInOut(THREE.MathUtils.clamp(amount / 0.2, 0, 1));
          const raise = this.easeInOut(THREE.MathUtils.clamp((amount - 0.18) / 0.3, 0, 1));
          const withdraw = this.easeInOut(THREE.MathUtils.clamp((amount - 0.78) / 0.22, 0, 1));
          prop.position.copy(packStart).add(new THREE.Vector3(actorIsLocal ? -0.08 : 0.08, -0.08 * amount, 0));
          const extracted = cigaretteStart.clone().add(new THREE.Vector3(actorIsLocal ? 0.15 : -0.15, 0.035, 0));
          cigarette.position.lerpVectors(cigaretteStart, extracted, extract);
          cigarette.position.lerp(mouth, raise);
          cigarette.position.lerp(afterDrag, withdraw);
          cigarette.position.y += amount > 0.48 && amount < 0.78 ? Math.sin(amount * Math.PI * 4) * 0.003 : 0;
          cigarette.rotation.set(0, actorIsLocal ? -0.12 : 0.12, actorIsLocal ? -0.08 : 0.08);
          const drag = THREE.MathUtils.clamp((amount - 0.5) / 0.26, 0, 1) * (1 - withdraw);
          ember.intensity = 0.6 + drag * (7.5 + Math.sin(amount * Math.PI * 22) * 1.3);
          const smokeTip = cigarette.position.clone().add(new THREE.Vector3(actorIsLocal ? 0.1 : -0.1, 0.025, 0));
          smoke.position.copy(smokeTip).add(new THREE.Vector3(0, 0.06 + Math.max(0, amount - 0.56) * 0.3, 0));
          (smoke.material as THREE.PointsMaterial).opacity = THREE.MathUtils.clamp((amount - 0.58) * 2.8, 0, 0.52) * (1 - withdraw * 0.4);
          smoke.rotation.y += 0.018;
          setCarrier();
          placeSupportHand(
            cigarette.position.clone().add(new THREE.Vector3(actorIsLocal ? -0.085 : 0.085, -0.035, actorIsLocal ? 0.025 : -0.025)),
            new THREE.Euler(-0.34, actorIsLocal ? -0.2 : 0.2, actorIsLocal ? -0.36 : 0.36),
            this.easeInOut(THREE.MathUtils.clamp(amount / 0.16, 0, 1)),
          );
        });
      } else if (item === "handcuffs") {
        const cuffLight = new THREE.PointLight(0xffc09d, 0, 1.5, 2);
        effectRoot.add(cuffLight);
        const hold = prop.position.clone();
        await this.tween(1750, (amount) => {
          const travel = this.easeInOut(THREE.MathUtils.clamp(amount * 1.35, 0, 1));
          prop.position.lerpVectors(hold, rivalFocus, travel);
          const snap = amount > 0.68 ? (amount - 0.68) / 0.32 : 0;
          prop.rotation.z = Math.sin(amount * Math.PI * 2) * 0.12 + snap * 0.55;
          prop.scale.setScalar(propScale * (1 - Math.sin(snap * Math.PI) * 0.12));
          cuffLight.position.copy(prop.position);
          cuffLight.intensity = 2.5 + Math.sin(amount * Math.PI) * 5;
          this.lookTarget.lerp(prop.position, 0.055);
          setCarrier();
          placeSupportHand(
            prop.position.clone().add(new THREE.Vector3(actorIsLocal ? 0.14 : -0.14, -0.03, actorIsLocal ? 0.04 : -0.04)),
            new THREE.Euler(-0.5, actorIsLocal ? 0.15 : -0.15, actorIsLocal ? -0.28 : 0.28),
            this.easeInOut(THREE.MathUtils.clamp(amount / 0.18, 0, 1)),
          );
        });
      } else if (item === "beer") {
        const drinkStart = prop.position.clone();
        await this.tween(2050, (amount) => {
          const lift = this.easeInOut(THREE.MathUtils.clamp(amount * 2.1, 0, 1));
          const lower = this.easeInOut(THREE.MathUtils.clamp((amount - 0.72) / 0.28, 0, 1));
          prop.position.copy(drinkStart).lerp(faceFocus.clone().add(new THREE.Vector3(actorIsLocal ? 0.04 : -0.04, 0.08, 0)), lift);
          prop.position.lerp(drinkStart, lower);
          prop.rotation.z = baseRotation.z + Math.sin(Math.min(1, amount * 1.65) * Math.PI) * (actorIsLocal ? -1.2 : 1.2);
          prop.rotation.x = baseRotation.x + Math.sin(amount * Math.PI) * 0.2;
          setCarrier();
        });
      } else if (item === "burnerPhone") {
        const phoneLight = new THREE.PointLight(0x91ffd0, 0, 1.5, 2);
        effectRoot.add(phoneLight);
        const hold = prop.position.clone();
        const ear = faceFocus.clone().add(new THREE.Vector3(actorIsLocal ? 0.25 : -0.25, 0.12, actorIsLocal ? -0.02 : 0.02));
        await this.tween(2450, (amount) => {
          const answer = this.easeInOut(THREE.MathUtils.clamp(amount * 1.65, 0, 1));
          prop.position.lerpVectors(hold, ear, answer);
          prop.rotation.y = baseRotation.y + (actorIsLocal ? -0.72 : 0.72) + Math.sin(amount * Math.PI * 0.8) * 0.08;
          prop.rotation.z = actorIsLocal ? -0.18 : 0.18;
          phoneLight.position.copy(prop.position);
          phoneLight.intensity = 2.5 + Math.sin(amount * Math.PI * 17) * 1.2;
          setCarrier();
        });
      } else if (item === "inverter") {
        const polarityLight = new THREE.PointLight(0x7be8ff, 0, 2.1, 2);
        effectRoot.add(polarityLight);
        const hold = prop.position.clone();
        await this.tween(1850, (amount) => {
          const travel = this.easeInOut(THREE.MathUtils.clamp(amount * 1.3, 0, 1));
          prop.position.lerpVectors(hold, chamberFocus, travel);
          const flip = this.easeInOut(THREE.MathUtils.clamp((amount - 0.32) / 0.45, 0, 1));
          prop.rotation.z = baseRotation.z + flip * Math.PI;
          prop.rotation.y = baseRotation.y + 0.68 + Math.sin(amount * Math.PI * 4) * 0.08;
          polarityLight.color.set(amount < 0.58 ? 0x70dfff : 0xff5a62);
          polarityLight.position.copy(prop.position).add(new THREE.Vector3(0, 0.08, 0));
          polarityLight.intensity = Math.sin(flip * Math.PI) * 12;
          setCarrier();
        });
      } else if (item === "adrenaline") {
        const arm = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.075, 0.42, 6, 10),
          new THREE.MeshStandardMaterial({ color: actorIsLocal ? 0xb58a7b : 0xc09382, roughness: 0.98 }),
        );
        arm.rotation.z = Math.PI / 2 + (actorIsLocal ? 0.22 : -0.22);
        arm.position.copy(actionFocus).add(new THREE.Vector3(actorIsLocal ? -0.16 : 0.16, -0.08, 0));
        effectRoot.add(arm);
        const hold = prop.position.clone();
        const jab = actionFocus.clone().add(new THREE.Vector3(actorIsLocal ? 0.03 : -0.03, -0.02, 0.02));
        const cameraStart = this.camera.position.clone();
        await this.tween(1650, (amount) => {
          const windup = this.easeInOut(THREE.MathUtils.clamp(amount * 2.2, 0, 1));
          const strike = this.easeInOut(THREE.MathUtils.clamp((amount - 0.38) * 5.2, 0, 1));
          prop.position.lerpVectors(hold, hold.clone().add(new THREE.Vector3(actorIsLocal ? 0.12 : -0.12, 0.11, 0)), windup);
          prop.position.lerp(jab, strike);
          prop.rotation.z = baseRotation.z + (actorIsLocal ? -1.15 : 1.15) * strike;
          this.camera.position.x = cameraStart.x + (amount > 0.42 && amount < 0.63 ? Math.sin(amount * Math.PI * 28) * 0.009 : 0);
          setCarrier();
        });
        this.camera.position.copy(cameraStart);
      } else if (item === "expiredMedicine") {
        const pills = new THREE.Group();
        for (let index = 0; index < 3; index += 1) {
          const pill = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.045, 4, 7), new THREE.MeshStandardMaterial({ color: index % 2 ? 0xe5d8ae : 0xb84a51, roughness: 0.75 }));
          pill.rotation.z = Math.PI / 2;
          pill.position.set((index - 1) * 0.04, index * 0.015, 0);
          pills.add(pill);
        }
        pills.position.copy(prop.position).add(new THREE.Vector3(0, 0.08, 0));
        effectRoot.add(pills);
        const boxStart = prop.position.clone();
        const mouth = faceFocus.clone().add(new THREE.Vector3(0, 0.07, 0));
        await this.tween(2050, (amount) => {
          const shake = amount < 0.42 ? Math.sin(amount * Math.PI * 18) * 0.055 * (1 - amount) : 0;
          prop.position.copy(boxStart).add(new THREE.Vector3(shake, 0, 0));
          prop.rotation.z = shake * 2.8;
          const pour = this.easeInOut(THREE.MathUtils.clamp((amount - 0.38) / 0.45, 0, 1));
          pills.position.lerpVectors(boxStart.clone().add(new THREE.Vector3(0, 0.08, 0)), mouth, pour);
          pills.rotation.z = pour * (actorIsLocal ? -1.2 : 1.2);
          pills.scale.setScalar(1 - THREE.MathUtils.clamp((amount - 0.82) / 0.18, 0, 1));
          setCarrier();
          placeSupportHand(
            pills.position.clone().add(new THREE.Vector3(actorIsLocal ? -0.07 : 0.07, -0.045, actorIsLocal ? 0.025 : -0.025)),
            new THREE.Euler(-0.42, actorIsLocal ? -0.16 : 0.16, actorIsLocal ? -0.26 : 0.26),
            Math.min(1 - THREE.MathUtils.clamp((amount - 0.84) / 0.16, 0, 1), this.easeInOut(THREE.MathUtils.clamp(amount / 0.18, 0, 1))),
          );
        });
      } else if (item === "jammer") {
        const pulse = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.1, 24), new THREE.MeshBasicMaterial({ color: 0x4cff72, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
        pulse.rotation.x = -Math.PI / 2;
        effectRoot.add(pulse);
        const signalLight = new THREE.PointLight(0x32ff69, 0, 2.6, 2);
        effectRoot.add(signalLight);
        const hold = prop.position.clone();
        await this.tween(2050, (amount) => {
          const aim = this.easeInOut(THREE.MathUtils.clamp(amount * 1.2, 0, 1));
          prop.position.lerpVectors(hold, rivalFocus, aim);
          prop.rotation.x = baseRotation.x - 0.3;
          prop.rotation.y = baseRotation.y + (actorIsLocal ? -0.38 : 0.38);
          const wave = (amount * 4.2) % 1;
          pulse.position.copy(prop.position).add(new THREE.Vector3(0, 0.05, actorIsLocal ? -0.18 - wave * 0.48 : 0.18 + wave * 0.48));
          pulse.scale.setScalar(0.35 + wave * 2.2);
          (pulse.material as THREE.MeshBasicMaterial).opacity = (1 - wave) * 0.68;
          signalLight.position.copy(prop.position);
          signalLight.intensity = 3 + Math.sin(amount * Math.PI * 13) * 2.5;
          this.lookTarget.lerp(prop.position, 0.045);
          setCarrier();
        });
      } else if (item === "remote") {
        const led = new THREE.PointLight(0xff3344, 0, 1.8, 2);
        effectRoot.add(led);
        const hold = prop.position.clone();
        await this.tween(1700, (amount) => {
          const lift = this.easeInOut(THREE.MathUtils.clamp(amount * 1.5, 0, 1));
          prop.position.lerpVectors(hold, actionFocus, lift);
          prop.rotation.x = baseRotation.x - 0.28;
          prop.rotation.y = baseRotation.y + (actorIsLocal ? -0.5 : 0.5);
          const press = amount > 0.42 && amount < 0.58;
          led.position.copy(prop.position).add(new THREE.Vector3(0, 0.12, actorIsLocal ? -0.05 : 0.05));
          led.intensity = press ? 12 : 0;
          this.roomLightLeft.intensity = press ? leftIntensity * 0.18 : leftIntensity * (0.82 + Math.sin(amount * Math.PI * 8) * 0.08);
          this.roomLightRight.intensity = press ? rightIntensity * 0.12 : rightIntensity * (0.82 - Math.sin(amount * Math.PI * 8) * 0.08);
          setCarrier();
        });
      }

      await wait(260);
      const finish = prop.position.clone();
      const finishScale = prop.scale.x;
      const supportFinishScale = supportHand.scale.x;
      const exit = start.clone().add(new THREE.Vector3(actorIsLocal ? -0.35 : 0.35, -0.28, actorIsLocal ? 0.32 : -0.32));
      await this.tween(780, (amount) => {
        const eased = this.easeInOut(amount);
        const handBlend = 1 - this.easeInOut(THREE.MathUtils.clamp((amount - 0.18) / 0.82, 0, 1));
        prop.position.lerpVectors(finish, exit, eased);
        prop.rotation.x += 0.006;
        prop.scale.setScalar(THREE.MathUtils.lerp(finishScale, propScale * 0.62, eased));
        const releaseOffset = carrierOffset.clone().add(new THREE.Vector3(
          actorIsLocal ? -0.2 * (1 - handBlend) : 0.2 * (1 - handBlend),
          -0.26 * (1 - handBlend),
          actorIsLocal ? 0.25 * (1 - handBlend) : -0.25 * (1 - handBlend),
        ));
        setCarrier(releaseOffset);
        carrier.scale.setScalar(Math.max(0.001, carrierScale * handBlend));
        supportHand.scale.setScalar(Math.max(0.001, supportFinishScale * handBlend));
        if (!actorIsLocal && this.opponentMode === "solo") this.blendDealerIdleHands(handBlend);
        carrier.rotation.set(
          THREE.MathUtils.lerp(carrierApproachRotation.x, carrierGripRotation.x, handBlend),
          THREE.MathUtils.lerp(carrierApproachRotation.y, carrierGripRotation.y, handBlend),
          THREE.MathUtils.lerp(carrierApproachRotation.z, carrierGripRotation.z, handBlend),
        );
        effectRoot.scale.setScalar(THREE.MathUtils.lerp(0.82, 1, handBlend));
        this.camera.position.lerpVectors(cameraClose, cameraStart, eased);
        this.lookTarget.lerpVectors(cameraFocus, lookStart, eased);
      });
    } finally {
      this.roomLightLeft.intensity = leftIntensity;
      this.roomLightRight.intensity = rightIntensity;
      this.camera.position.copy(cameraStart);
      this.lookTarget.copy(lookStart);
      if (!actorIsLocal && this.opponentMode === "solo") this.blendDealerIdleHands(0);
      this.scene.remove(prop, carrier, supportHand, effectRoot);
      this.disposeUniqueObject(carrier);
      this.disposeUniqueObject(supportHand);
      this.disposeUniqueObject(effectRoot);
      this.animationBusy = false;
    }
  }

  private async animateWireFailure(localFailed: boolean): Promise<void> {
    while (this.animationBusy) await wait(90);
    this.animationBusy = true;
    this.onMechanicalCue("wire");
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(42 * 3);
    for (let index = 0; index < positions.length; index += 3) {
      positions[index] = (Math.random() - 0.5) * 0.48;
      positions[index + 1] = (Math.random() - 0.5) * 0.3;
      positions[index + 2] = (Math.random() - 0.5) * 0.25;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x8dff9c, size: 0.045, transparent: true, opacity: 1, depthWrite: false });
    const sparks = new THREE.Points(geometry, material);
    sparks.position.set(1.72, 1.02, -1.03);
    this.scene.add(sparks);
    const flash = new THREE.PointLight(0x58ff72, 0, 3, 2);
    flash.position.copy(sparks.position);
    this.scene.add(flash);
    const cameraStart = this.camera.position.clone();
    await this.tween(760, (amount) => {
      sparks.position.y -= 0.004;
      sparks.rotation.z += 0.08;
      material.opacity = 1 - amount;
      flash.intensity = Math.sin(amount * Math.PI * 5) > 0.25 ? 13 * (1 - amount) : 0;
      if (localFailed) this.camera.position.x = cameraStart.x + (Math.random() - 0.5) * 0.025 * (1 - amount);
    });
    this.camera.position.copy(cameraStart);
    this.scene.remove(sparks, flash);
    geometry.dispose();
    material.dispose();
    this.animationBusy = false;
  }

  private async animateShot(event: Extract<GameEvent, { kind: "shot" }>, localActor: Actor): Promise<void> {
    if (!this.shotgun) {
      this.commitPendingShotHealth(event);
      return;
    }
    while (this.animationBusy) await wait(60);
    this.animationBusy = true;
    const shotSequenceStarted = performance.now();
    const gun = this.shotgun;
    this.scene.add(this.muzzleLight);
    const startPosition = gun.position.clone();
    const startQuaternion = gun.quaternion.clone();
    const dealerStartPosition = this.dealer?.position.clone();
    const dealerStartRotation = this.dealer?.rotation.clone();
    const cameraStart = this.camera.position.clone();
    const lookStart = this.lookTarget.clone();
    const targetIsLocal = event.target === localActor;
    const actorIsLocal = event.actor === localActor;
    const selfShot = event.actor === event.target;
    let blackoutStarted = 0;
    const targetPosition = actorIsLocal
      ? selfShot ? new THREE.Vector3(0.52, 1.28, 2.02) : new THREE.Vector3(0.68, 1.2, 1.34)
      : selfShot ? new THREE.Vector3(-0.48, 1.42, -1.5) : new THREE.Vector3(-0.62, 1.24, -1.24);
    const aimPoint = actorIsLocal && selfShot
      ? new THREE.Vector3(-0.02, 1.7, 3.45)
      : !actorIsLocal && !selfShot
        ? new THREE.Vector3(-0.08, 1.68, 3.18)
        : selfShot
          ? new THREE.Vector3(0.14, 1.58, -2.32)
          : new THREE.Vector3(0, 1.72, -2.35);
    const aimDirection = aimPoint.clone().sub(targetPosition).normalize();
    const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), aimDirection);
    const roll = actorIsLocal ? (selfShot ? -0.2 : 0.13) : (selfShot ? 0.18 : -0.12);
    targetQuaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll));
    const tensionCamera = cameraStart.clone().add(new THREE.Vector3(actorIsLocal ? 0.025 : -0.025, selfShot ? -0.025 : 0.02, -0.07));
    const tensionLook = actorIsLocal && selfShot ? new THREE.Vector3(0.08, 1.38, 1.72) : new THREE.Vector3(0, 1.55, -1.72);
    const handMaterial = new THREE.MeshStandardMaterial({
      color: actorIsLocal ? 0xa7766d : 0x855049,
      roughness: 0.98,
    });
    const gripHand = this.createHand(handMaterial);
    const pumpHand = this.createHand(handMaterial.clone());
    const sleeveMaterial = new THREE.MeshStandardMaterial({ color: actorIsLocal ? 0x292629 : 0x0b0909, roughness: 0.92 });
    const cuffMaterial = new THREE.MeshStandardMaterial({ color: actorIsLocal ? 0x4b3937 : 0x241817, roughness: 0.8 });
    const attachForearm = (hand: THREE.Group, vector: THREE.Vector3) => {
      const length = vector.length();
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, Math.max(0.12, length - 0.18), 5, 10), sleeveMaterial);
      sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize());
      sleeve.position.copy(vector).multiplyScalar(0.5);
      sleeve.castShadow = true;
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.108, 0.096, 0.125, 12), cuffMaterial);
      cuff.quaternion.copy(sleeve.quaternion);
      cuff.position.copy(vector).multiplyScalar(0.12);
      cuff.castShadow = true;
      hand.add(sleeve, cuff);
    };
    const inverseAim = targetQuaternion.clone().invert();
    const gripWorldReach = actorIsLocal
      ? new THREE.Vector3(0.32, -0.62, 0.9)
      : new THREE.Vector3(-0.28, 0.08, -0.78);
    const pumpWorldReach = actorIsLocal
      ? new THREE.Vector3(-0.38, -0.68, 0.98)
      : new THREE.Vector3(0.34, 0.04, -0.86);
    attachForearm(gripHand, gripWorldReach.applyQuaternion(inverseAim));
    attachForearm(pumpHand, pumpWorldReach.applyQuaternion(inverseAim));
    const gripTargetScale = actorIsLocal ? (selfShot ? 0.86 : 0.94) : 0.68;
    const pumpTargetScale = actorIsLocal ? (selfShot ? 0.76 : 0.9) : 0.66;
    gripHand.scale.setScalar(0.001);
    pumpHand.scale.setScalar(0.001);
    gripHand.rotation.set(-0.08, 0, actorIsLocal ? 0.14 : -0.14);
    pumpHand.rotation.set(0.06, 0, actorIsLocal ? -0.1 : 0.1);
    const gripRestRotation = gripHand.rotation.clone();
    const pumpRestRotation = pumpHand.rotation.clone();
    const gripApproachRotation = gripRestRotation.clone();
    const pumpApproachRotation = pumpRestRotation.clone();
    gripApproachRotation.x += 0.28;
    gripApproachRotation.z += actorIsLocal ? 0.22 : -0.22;
    pumpApproachRotation.x += 0.24;
    pumpApproachRotation.z += actorIsLocal ? -0.2 : 0.2;
    gripHand.rotation.copy(gripApproachRotation);
    pumpHand.rotation.copy(pumpApproachRotation);
    gun.add(gripHand, pumpHand);
    const positionHands = (pumpOffset = 0, actionBlend = 1) => {
      gripHand.position.set(0.02, 0.025, 0);
      pumpHand.position.set((actorIsLocal && selfShot ? 0.22 : actorIsLocal ? 0.5 : 0.34) + pumpOffset, 0.02, 0);
      const retreat = 1 - actionBlend;
      gripHand.position.y -= retreat * 0.18;
      pumpHand.position.y -= retreat * 0.2;
      gripHand.position.z += (actorIsLocal ? 0.18 : -0.18) * retreat;
      pumpHand.position.z += (actorIsLocal ? 0.2 : -0.2) * retreat;
      gripHand.scale.setScalar(Math.max(0.001, gripTargetScale * actionBlend));
      pumpHand.scale.setScalar(Math.max(0.001, pumpTargetScale * actionBlend));
    };
    const dealerBoneScales = !actorIsLocal && this.opponentMode === "solo" ? {
      left: this.dealerHandBones.left?.scale.clone(),
      right: this.dealerHandBones.right?.scale.clone(),
    } : null;
    const blendDealerHands = (actionBlend: number): void => {
      if (actorIsLocal || !dealerBoneScales) return;
      this.blendDealerIdleHands(actionBlend);
      const hidden = new THREE.Vector3(0.001, 0.001, 0.001);
      if (dealerBoneScales.left) this.dealerHandBones.left?.scale.lerpVectors(dealerBoneScales.left, hidden, actionBlend);
      if (dealerBoneScales.right) this.dealerHandBones.right?.scale.lerpVectors(dealerBoneScales.right, hidden, actionBlend);
    };
    const muzzlePosition = () => new THREE.Vector3(0.82, 0.015, 0).applyQuaternion(gun.quaternion).add(gun.position);
    positionHands(0, 0);
    blendDealerHands(0);
    this.onMechanicalCue("gunFoley");

    await this.tween(actorIsLocal ? 1150 : 1350, (amount) => {
      const eased = this.easeInOut(amount);
      const handBlend = this.easeInOut(THREE.MathUtils.clamp(amount / 0.46, 0, 1));
      gun.position.lerpVectors(startPosition, targetPosition, eased);
      gun.quaternion.slerpQuaternions(startQuaternion, targetQuaternion, eased);
      this.muzzleLight.position.copy(muzzlePosition());
      this.muzzleLight.intensity = eased * 3.2;
      this.camera.position.lerpVectors(cameraStart, tensionCamera, eased);
      this.lookTarget.lerpVectors(lookStart, tensionLook, eased * 0.72);
      positionHands(0, handBlend);
      gripHand.rotation.set(
        THREE.MathUtils.lerp(gripApproachRotation.x, gripRestRotation.x, handBlend),
        THREE.MathUtils.lerp(gripApproachRotation.y, gripRestRotation.y, handBlend),
        THREE.MathUtils.lerp(gripApproachRotation.z, gripRestRotation.z, handBlend),
      );
      pumpHand.rotation.set(
        THREE.MathUtils.lerp(pumpApproachRotation.x, pumpRestRotation.x, handBlend),
        THREE.MathUtils.lerp(pumpApproachRotation.y, pumpRestRotation.y, handBlend),
        THREE.MathUtils.lerp(pumpApproachRotation.z, pumpRestRotation.z, handBlend),
      );
      blendDealerHands(handBlend);
      if (!actorIsLocal && this.dealer && dealerStartPosition && dealerStartRotation) {
        this.dealer.position.set(dealerStartPosition.x, dealerStartPosition.y - eased * 0.07, dealerStartPosition.z + eased * 0.16);
        this.dealer.rotation.set(dealerStartRotation.x + eased * 0.06, dealerStartRotation.y, dealerStartRotation.z + (selfShot ? 0.045 : -0.035) * eased);
      }
    });
    await this.tween(2200, (amount) => {
      const breath = (Math.sin(amount * Math.PI * 2) + Math.sin(amount * Math.PI) * 0.18) * 0.009;
      const tremor = Math.sin(amount * Math.PI * 8) * 0.0022 * (0.35 + amount * 0.65);
      const finalBrace = this.ease(THREE.MathUtils.clamp((amount - 0.72) / 0.28, 0, 1));
      gun.position.copy(targetPosition);
      gun.position.y += breath - finalBrace * 0.006;
      gun.position.x += Math.sin(amount * Math.PI * 1.35) * 0.006 + tremor;
      gun.position.z -= finalBrace * 0.013;
      gun.quaternion.copy(targetQuaternion)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), breath * 0.82 - finalBrace * 0.008))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tremor * 1.8));
      this.camera.position.set(
        tensionCamera.x + Math.sin(amount * Math.PI * 1.6) * 0.004,
        tensionCamera.y + breath * 0.16,
        tensionCamera.z - finalBrace * 0.008,
      );
      this.lookTarget.copy(tensionLook).add(new THREE.Vector3(tremor * 0.7, breath * 0.23, 0));
      positionHands(Math.sin(amount * Math.PI * 1.7) * 0.004 - finalBrace * 0.006);
      gripHand.rotation.copy(gripRestRotation);
      pumpHand.rotation.copy(pumpRestRotation);
      gripHand.rotation.z += Math.sin(amount * Math.PI * 2.2) * 0.008 - finalBrace * 0.018;
      pumpHand.rotation.z -= Math.sin(amount * Math.PI * 2.05) * 0.006 + finalBrace * 0.012;
      if (!actorIsLocal && this.dealer && dealerStartPosition && dealerStartRotation) {
        this.dealer.position.set(
          dealerStartPosition.x + Math.sin(amount * Math.PI * 1.3) * 0.008,
          dealerStartPosition.y - 0.07 + breath * 0.45,
          dealerStartPosition.z + 0.16,
        );
        this.dealer.rotation.set(
          dealerStartRotation.x + 0.06 + breath * 0.35,
          dealerStartRotation.y + tremor,
          dealerStartRotation.z + (selfShot ? 0.045 : -0.035) + Math.sin(amount * Math.PI) * 0.006,
        );
      }
    });

    this.muzzleLight.position.copy(muzzlePosition());
    this.onShotFire(event);
    this.commitPendingShotHealth(event);
    this.shotgunTargetScale = 1;
    if (event.shell === "live") {
      this.muzzleLight.intensity = 52;
      let blackoutCommitted = false;
      await this.tween(190, (amount) => {
        if (targetIsLocal && !blackoutCommitted && amount >= 58 / 190) {
          blackoutCommitted = true;
          blackoutStarted = performance.now();
          this.onBlackout(true);
        }
        this.muzzleLight.intensity = 52 * (1 - amount);
        const kick = Math.pow(1 - amount, 2.2);
        const settle = Math.sin(amount * Math.PI * 5) * (1 - amount) * 0.012;
        this.camera.position.set(
          tensionCamera.x + settle + (targetIsLocal ? kick * 0.08 : 0),
          tensionCamera.y + kick * (targetIsLocal ? -0.16 : 0.055),
          tensionCamera.z + kick * (targetIsLocal ? 0.46 : 0.085),
        );
        this.lookTarget.copy(tensionLook).add(new THREE.Vector3(
          settle * 0.4 + (targetIsLocal ? kick * 0.13 : 0),
          kick * (targetIsLocal ? -0.2 : 0.07),
          0,
        ));
        gun.position.copy(targetPosition).addScaledVector(aimDirection, -kick * 0.22);
        gun.position.y += settle;
        gun.quaternion.copy(targetQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -kick * 0.075 + settle));
        positionHands();
      });
      if (targetIsLocal) {
        await wait(260);
      } else {
        this.onMechanicalCue("splatter");
        this.spawnBlood();
        await this.animateDealerImpact();
      }
    } else {
      await this.tween(330, (amount) => {
        const twitch = Math.sin(amount * Math.PI * 5) * 0.018 * (1 - amount);
        gun.quaternion.copy(targetQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), twitch));
        this.camera.position.x = tensionCamera.x + Math.sin(amount * Math.PI * 3) * 0.012 * (1 - amount);
        positionHands();
      });
      await wait(240);
      this.muzzleLight.intensity = 0;
    }

    await this.animateHeldPump(event.shell, gun, positionHands);

    const returnDuration = 820;
    const returnPosition = gun.position.clone();
    const returnQuaternion = gun.quaternion.clone();
    const returnCamera = this.camera.position.clone();
    const returnLook = this.lookTarget.clone();
    const dealerReturnPosition = this.dealer?.position.clone();
    const dealerReturnRotation = this.dealer?.rotation.clone();
    await this.tween(returnDuration, (amount) => {
      const eased = this.ease(amount);
      const actionBlend = 1 - this.easeInOut(THREE.MathUtils.clamp((amount - 0.42) / 0.58, 0, 1));
      gun.position.lerpVectors(returnPosition, startPosition, eased);
      gun.quaternion.slerpQuaternions(returnQuaternion, startQuaternion, eased);
      this.camera.position.lerpVectors(returnCamera, cameraStart, eased);
      this.lookTarget.lerpVectors(returnLook, lookStart, eased);
      positionHands(0, actionBlend);
      gripHand.rotation.set(
        THREE.MathUtils.lerp(gripApproachRotation.x, gripRestRotation.x, actionBlend),
        THREE.MathUtils.lerp(gripApproachRotation.y, gripRestRotation.y, actionBlend),
        THREE.MathUtils.lerp(gripApproachRotation.z, gripRestRotation.z, actionBlend),
      );
      pumpHand.rotation.set(
        THREE.MathUtils.lerp(pumpApproachRotation.x, pumpRestRotation.x, actionBlend),
        THREE.MathUtils.lerp(pumpApproachRotation.y, pumpRestRotation.y, actionBlend),
        THREE.MathUtils.lerp(pumpApproachRotation.z, pumpRestRotation.z, actionBlend),
      );
      blendDealerHands(actionBlend);
      if (this.dealer && dealerStartPosition && dealerStartRotation && dealerReturnPosition && dealerReturnRotation) {
        this.dealer.position.lerpVectors(dealerReturnPosition, dealerStartPosition, eased);
        this.dealer.rotation.set(
          THREE.MathUtils.lerp(dealerReturnRotation.x, dealerStartRotation.x, eased),
          THREE.MathUtils.lerp(dealerReturnRotation.y, dealerStartRotation.y, eased),
          THREE.MathUtils.lerp(dealerReturnRotation.z, dealerStartRotation.z, eased),
        );
      }
    });
    gun.position.copy(startPosition);
    gun.quaternion.copy(startQuaternion);
    this.camera.position.copy(cameraStart);
    this.lookTarget.copy(lookStart);
    this.muzzleLight.intensity = 0;
    this.scene.remove(this.muzzleLight);
    if (this.dealer && dealerStartPosition && dealerStartRotation) {
      this.dealer.position.copy(dealerStartPosition);
      this.dealer.rotation.copy(dealerStartRotation);
    }
    gun.remove(gripHand, pumpHand);
    this.disposeUniqueObject(gripHand);
    this.disposeUniqueObject(pumpHand);
    if (dealerBoneScales?.left) this.dealerHandBones.left?.scale.copy(dealerBoneScales.left);
    if (dealerBoneScales?.right) this.dealerHandBones.right?.scale.copy(dealerBoneScales.right);
    const remaining = 6000 - (performance.now() - shotSequenceStarted);
    if (remaining > 0) await wait(remaining);
    if (blackoutStarted) {
      const blackRemaining = 3000 - (performance.now() - blackoutStarted);
      if (blackRemaining > 0) await wait(blackRemaining);
      this.onBlackout(false);
      await wait(350);
    }
    this.animationBusy = false;
  }

  private async animateHeldPump(shell: Shell, gun: THREE.Group, positionHands: (pumpOffset?: number) => void): Promise<void> {
    const gunStart = gun.position.clone();
    const spent = this.createShell(shell);
    spent.visible = false;
    spent.scale.setScalar(0.82);
    this.scene.add(spent);
    this.onMechanicalCue("rackForward");
    await this.tween(380, (amount) => {
      const eased = this.easeInOut(amount);
      gun.position.y = gunStart.y + Math.sin(amount * Math.PI) * 0.018;
      positionHands(-0.24 * eased);
      if (amount > 0.55) {
        spent.visible = true;
        const local = (amount - 0.55) / 0.45;
        spent.position.copy(gun.position).add(new THREE.Vector3(0.14 + local * 0.32, 0.04 + Math.sin(local * Math.PI) * 0.18, 0.05));
        spent.rotation.x = local * 3.4;
        spent.rotation.z = local * 2.7;
      }
    });
    this.onMechanicalCue("rackBack");
    const pumpBackStart = gun.position.clone();
    await this.tween(460, (amount) => {
      const eased = this.easeInOut(amount);
      gun.position.lerpVectors(pumpBackStart, gunStart, eased);
      gun.position.y += Math.sin(amount * Math.PI) * 0.012;
      positionHands(-0.24 * (1 - eased));
      if (spent.visible) {
        spent.position.x += 0.008;
        spent.position.y -= 0.004 + amount * 0.005;
        spent.rotation.x += 0.09;
      }
    });
    gun.position.copy(gunStart);
    await wait(160);
    this.scene.remove(spent);
    this.disposeUniqueObject(spent);
  }

  private async animateDealerImpact(): Promise<void> {
    if (!this.dealer) return;
    const startPosition = this.dealer.position.clone();
    const startRotation = this.dealer.rotation.clone();
    await this.tween(1380, (amount) => {
      const impact = this.ease(THREE.MathUtils.clamp(amount / 0.12, 0, 1));
      const collapse = this.easeInOut(THREE.MathUtils.clamp((amount - 0.1) / 0.9, 0, 1));
      const lift = Math.sin(THREE.MathUtils.clamp(amount / 0.3, 0, 1) * Math.PI) * 0.15;
      const aftershock = amount < 0.12 ? 0 : Math.sin((amount - 0.12) * Math.PI * 7.2) * (1 - amount) * 0.075;
      this.dealer!.position.set(
        startPosition.x + impact * 0.14 + collapse * 0.17 + aftershock * 0.45,
        startPosition.y + lift - collapse * 0.62,
        startPosition.z - impact * 0.42 - collapse * 0.72,
      );
      this.dealer!.rotation.set(
        startRotation.x - impact * 0.38 - collapse * 0.72 + aftershock * 0.15,
        startRotation.y + impact * 0.16 + collapse * 0.12,
        startRotation.z + impact * 0.24 + collapse * 0.38 + aftershock,
      );
    });
    await wait(260);
  }

  private spawnBlood(): void {
    if (!this.dealer) return;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(70 * 3);
    for (let index = 0; index < positions.length; index += 3) {
      positions[index] = (Math.random() - 0.5) * 1.5;
      positions[index + 1] = (Math.random() - 0.3) * 1.1;
      positions[index + 2] = (Math.random() - 0.5) * 0.7;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const spray = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xd13268, size: 0.09, transparent: true, opacity: 0.92, depthWrite: false }));
    spray.position.copy(this.dealer.position);
    this.scene.add(spray);
    void this.tween(780, (amount) => {
      spray.position.y -= 0.006;
      (spray.material as THREE.PointsMaterial).opacity = 1 - amount;
    }).then(() => {
      geometry.dispose();
      (spray.material as THREE.Material).dispose();
      this.scene.remove(spray);
    });
  }

  private async animateEjectedShell(shell: Shell): Promise<void> {
    while (this.animationBusy) await wait(60);
    this.animationBusy = true;
    const round = this.createShell(shell);
    round.position.set(0.55, 0.9, -0.05);
    this.scene.add(round);
    await this.tween(600, (amount) => {
      round.position.set(0.55 + amount * 0.75, 0.9 + Math.sin(amount * Math.PI) * 0.55, -0.05 + amount * 0.2);
      round.rotation.x += 0.15;
      round.rotation.z += 0.12;
    });
    this.scene.remove(round);
    this.disposeUniqueObject(round);
    this.animationBusy = false;
  }

  private scheduleReveal(): void {
    if (this.revealScheduled || !this.pendingReveal || !this.tableActive) return;
    this.revealScheduled = true;
    const delay = this.pendingReveal.delay;
    window.setTimeout(() => {
      this.revealScheduled = false;
      const pending = this.pendingReveal;
      this.pendingReveal = null;
      if (pending && this.tableActive) void this.revealLoad(pending);
    }, delay);
  }

  private async revealLoad(pending: PendingReveal): Promise<void> {
    while (this.animationBusy) await wait(80);
    this.animationBusy = true;
    if (pending.itemDrawCount > 0 && this.briefcase) {
      const drawCount = Math.min(pending.itemDrawCount, pending.inventory.length);
      const localStartIndex = Math.max(0, pending.inventory.length - drawCount);
      const dealerStartIndex = Math.max(0, pending.opponentInventory.length - drawCount);
      const newLocalItems = this.localItems.children.slice(localStartIndex);
      const newDealerItems = this.dealerItems.children.slice(dealerStartIndex);
      newLocalItems.forEach((object) => { object.visible = false; });
      newDealerItems.forEach((object) => { object.visible = false; });
      this.setBriefcaseContents(pending.inventory.slice(-drawCount));
      this.briefcase.visible = true;
      const lid = this.briefcase.getObjectByName("briefcase-lid");
      if (lid) lid.rotation.x = -0.05;
      this.onMechanicalCue("briefcase");
      await this.moveCamera(new THREE.Vector3(0, 1.92, 2.78), new THREE.Vector3(0, 0.61, 0.72), 920);
      await this.tween(1080, (amount) => {
        const eased = this.ease(amount);
        if (lid) lid.rotation.x = THREE.MathUtils.lerp(-0.05, -1.2, eased);
        this.briefcase!.position.y = 0.62 + Math.sin(amount * Math.PI) * 0.035;
      });
      await wait(720);
      const dealtItems = [...this.briefcaseItems.children];
      const starts = dealtItems.map((object) => {
        this.scene.attach(object);
        return {
          position: object.position.clone(),
          quaternion: object.quaternion.clone(),
          scale: object.scale.clone(),
        };
      });
      const targets = newLocalItems.map((object) => {
        object.updateMatrixWorld(true);
        return {
          position: object.getWorldPosition(new THREE.Vector3()),
          quaternion: object.getWorldQuaternion(new THREE.Quaternion()),
          scale: object.getWorldScale(new THREE.Vector3()),
        };
      });
      if (dealtItems.length > 0) {
        await this.tween(1260 + dealtItems.length * 120, (amount) => {
          dealtItems.forEach((object, index) => {
            const local = THREE.MathUtils.clamp((amount * (1 + dealtItems.length * 0.16)) - index * 0.16, 0, 1);
            const eased = this.easeInOut(local);
            const target = targets[index];
            if (!target) return;
            object.position.lerpVectors(starts[index].position, target.position, eased);
            object.position.y += Math.sin(local * Math.PI) * (0.26 + index * 0.025);
            object.quaternion.slerpQuaternions(starts[index].quaternion, target.quaternion, eased);
            object.scale.lerpVectors(starts[index].scale, target.scale, eased);
          });
        });
      }
      dealtItems.forEach((object) => this.scene.remove(object));
      newLocalItems.forEach((object) => { object.visible = true; });
      newDealerItems.forEach((object) => {
        object.visible = true;
        object.scale.setScalar(0.001);
      });
      await this.tween(620 + newDealerItems.length * 90, (amount) => {
        newDealerItems.forEach((object, index) => {
          const local = THREE.MathUtils.clamp(amount * 1.45 - index * 0.14, 0, 1);
          object.scale.setScalar(this.ease(local));
        });
      });
      await this.tween(820, (amount) => { if (lid) lid.rotation.x = THREE.MathUtils.lerp(-1.2, -0.05, this.easeInOut(amount)); });
      this.briefcase.visible = false;
    }
    const live = pending.chamber.filter((shell) => shell === "live").length;
    const blank = pending.chamber.length - live;
    await this.moveCamera(new THREE.Vector3(1.05, 1.42, 1.22), new THREE.Vector3(1.05, 0.57, -0.2), 940);
    this.shellRackShells.visible = true;
    this.onShellReveal(live, blank, true);
    this.onMechanicalCue("shells");
    const rounds = [...this.shellRackShells.children];
    rounds.forEach((round) => round.scale.setScalar(0.001));
    await this.tween(920 + rounds.length * 125, (amount) => {
      rounds.forEach((round, index) => {
        const local = THREE.MathUtils.clamp((amount * (1 + rounds.length * 0.12)) - index * 0.12, 0, 1);
        const eased = this.ease(local);
        round.scale.setScalar(0.78 * eased);
        round.position.y = Math.sin(local * Math.PI) * 0.055;
      });
    });
    await wait(2150);
    this.onShellReveal(live, blank, false);
    await this.animateDealerLoad(rounds);
    this.shellRackShells.visible = false;
    await this.moveCamera(this.homeCamera.clone(), this.homeLook.clone(), 1050);
    this.animationBusy = false;
  }

  private async animateDealerLoad(rounds: THREE.Object3D[]): Promise<void> {
    if (!this.shotgun || !this.dealer || rounds.length === 0) return;
    const gun = this.shotgun;
    const dealer = this.dealer;
    const gunStartPosition = gun.position.clone();
    const gunStartQuaternion = gun.quaternion.clone();
    const dealerStartPosition = dealer.position.clone();
    const dealerStartRotation = dealer.rotation.clone();
    const cameraStart = this.camera.position.clone();
    const lookStart = this.lookTarget.clone();
    const loadingPosition = new THREE.Vector3(0.18, 1.01, -1.16);
    const loadingQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, -0.16, -0.32));
    const handMaterial = new THREE.MeshStandardMaterial({ color: 0xb88476, roughness: 0.98 });
    const sleeveMaterial = new THREE.MeshStandardMaterial({ color: 0x070606, roughness: 0.96 });
    const gripHand = this.createHand(handMaterial);
    const loadingHand = this.createHand(handMaterial.clone());
    for (const hand of [gripHand, loadingHand]) {
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.067, 0.38, 5, 9), sleeveMaterial);
      sleeve.rotation.x = Math.PI / 2;
      sleeve.position.z = 0.25;
      sleeve.castShadow = true;
      hand.add(sleeve);
      hand.scale.setScalar(0.001);
      this.scene.add(hand);
    }
    const dealerBoneScales = {
      left: this.dealerHandBones.left?.scale.clone(),
      right: this.dealerHandBones.right?.scale.clone(),
    };
    const hiddenHandScale = new THREE.Vector3(0.001, 0.001, 0.001);
    const blendDealerLoadHands = (actionBlend: number): void => {
      gripHand.scale.setScalar(Math.max(0.001, 1.42 * actionBlend));
      loadingHand.scale.setScalar(Math.max(0.001, 1.42 * actionBlend));
      if (this.opponentMode === "solo") this.blendDealerIdleHands(actionBlend);
      if (dealerBoneScales.left) this.dealerHandBones.left?.scale.lerpVectors(dealerBoneScales.left, hiddenHandScale, actionBlend);
      if (dealerBoneScales.right) this.dealerHandBones.right?.scale.lerpVectors(dealerBoneScales.right, hiddenHandScale, actionBlend);
    };
    const gripLocal = new THREE.Vector3(-0.27, -0.015, 0.045);
    const loaderRestLocal = new THREE.Vector3(-0.06, 0.16, 0.1);
    const positionHands = (loaderLocal = loaderRestLocal) => {
      gripHand.position.copy(gripLocal).applyQuaternion(gun.quaternion).add(gun.position);
      gripHand.quaternion.copy(gun.quaternion);
      gripHand.rotateX(-0.42);
      gripHand.rotateZ(0.22);
      loadingHand.position.copy(loaderLocal).applyQuaternion(gun.quaternion).add(gun.position);
      loadingHand.quaternion.copy(gun.quaternion);
      loadingHand.rotateX(-0.5);
      loadingHand.rotateZ(-0.28);
    };

    positionHands();
    blendDealerLoadHands(0);
    this.onMechanicalCue("gunFoley");
    await this.tween(860, (amount) => {
      const eased = this.easeInOut(amount);
      const handBlend = this.easeInOut(THREE.MathUtils.clamp(amount / 0.48, 0, 1));
      gun.position.lerpVectors(gunStartPosition, loadingPosition, eased);
      gun.quaternion.slerpQuaternions(gunStartQuaternion, loadingQuaternion, eased);
      dealer.position.set(
        dealerStartPosition.x + Math.sin(amount * Math.PI) * 0.035,
        dealerStartPosition.y - Math.sin(amount * Math.PI) * 0.07,
        dealerStartPosition.z + eased * 0.12,
      );
      dealer.rotation.set(dealerStartRotation.x + eased * 0.055, dealerStartRotation.y, dealerStartRotation.z - eased * 0.025);
      this.camera.position.lerpVectors(cameraStart, new THREE.Vector3(0.2, 1.9, 2.72), eased);
      this.lookTarget.lerpVectors(lookStart, new THREE.Vector3(0.1, 0.88, -1.12), eased);
      positionHands();
      const retreat = 1 - handBlend;
      gripHand.position.y -= retreat * 0.2;
      loadingHand.position.y -= retreat * 0.22;
      blendDealerLoadHands(handBlend);
    });

    this.shellRackShells.updateMatrixWorld(true);
    for (const [index, round] of rounds.entries()) {
      if (!round.parent) continue;
      this.scene.attach(round);
      const startPosition = round.position.clone();
      const startQuaternion = round.quaternion.clone();
      const startScale = round.scale.clone();
      const insertLocal = new THREE.Vector3(-0.09, 0.055, 0.055);
      const handRest = loadingHand.position.clone();
      const pickupPosition = startPosition.clone().add(new THREE.Vector3(index % 2 ? 0.07 : -0.05, 0.1, 0.08));
      let cuePlayed = false;
      await this.tween(620, (amount) => {
        const approach = this.easeInOut(THREE.MathUtils.clamp(amount / 0.28, 0, 1));
        const carry = this.easeInOut(THREE.MathUtils.clamp((amount - 0.28) / 0.72, 0, 1));
        const insertPosition = insertLocal.clone().applyQuaternion(gun.quaternion).add(gun.position);
        round.position.lerpVectors(startPosition, insertPosition, carry);
        round.position.y += Math.sin(carry * Math.PI) * (0.18 + Math.min(index, 4) * 0.012);
        round.quaternion.slerpQuaternions(startQuaternion, gun.quaternion, carry);
        round.rotateZ(Math.PI / 2 * carry);
        if (amount < 0.28) loadingHand.position.lerpVectors(handRest, pickupPosition, approach);
        else loadingHand.position.lerpVectors(pickupPosition, insertPosition.clone().add(new THREE.Vector3(0.06, 0.055, 0.03)), carry);
        loadingHand.quaternion.copy(gun.quaternion);
        loadingHand.rotateX(-0.62);
        loadingHand.rotateZ(-0.32);
        gripHand.position.copy(gripLocal).applyQuaternion(gun.quaternion).add(gun.position);
        if (!cuePlayed && carry > 0.67) {
          cuePlayed = true;
          this.onMechanicalCue("loadShell");
        }
        const insertFade = THREE.MathUtils.clamp((carry - 0.86) / 0.14, 0, 1);
        round.scale.copy(startScale).multiplyScalar(1 - insertFade * 0.48);
      });
      round.visible = false;
      this.scene.remove(round);
      this.disposeUniqueObject(round);
      const releaseStart = loadingHand.position.clone();
      const restWorld = loaderRestLocal.clone().applyQuaternion(gun.quaternion).add(gun.position);
      await this.tween(180, (amount) => {
        const eased = this.easeInOut(amount);
        loadingHand.position.lerpVectors(releaseStart, restWorld, eased);
        loadingHand.quaternion.copy(gun.quaternion);
        loadingHand.rotateX(THREE.MathUtils.lerp(-0.62, -0.5, eased));
        loadingHand.rotateZ(THREE.MathUtils.lerp(-0.32, -0.28, eased));
      });
    }

    positionHands(new THREE.Vector3(0.24, 0.02, 0.055));
    this.onMechanicalCue("rackForward");
    await this.tween(360, (amount) => {
      const eased = this.easeInOut(amount);
      gun.position.x = loadingPosition.x - eased * 0.1;
      gun.position.y = loadingPosition.y + Math.sin(amount * Math.PI) * 0.018;
      positionHands(new THREE.Vector3(0.24 - eased * 0.25, 0.02, 0.055));
    });
    this.onMechanicalCue("rackBack");
    await this.tween(420, (amount) => {
      const eased = this.easeInOut(amount);
      gun.position.x = loadingPosition.x - 0.1 + eased * 0.1;
      gun.position.y = loadingPosition.y + Math.sin(amount * Math.PI) * 0.012;
      positionHands(new THREE.Vector3(-0.01 + eased * 0.25, 0.02, 0.055));
    });
    await wait(260);

    const returnPosition = gun.position.clone();
    const returnQuaternion = gun.quaternion.clone();
    const returnDealerPosition = dealer.position.clone();
    const returnDealerRotation = dealer.rotation.clone();
    await this.tween(900, (amount) => {
      const eased = this.easeInOut(amount);
      const handBlend = 1 - this.easeInOut(THREE.MathUtils.clamp((amount - 0.36) / 0.64, 0, 1));
      gun.position.lerpVectors(returnPosition, gunStartPosition, eased);
      gun.quaternion.slerpQuaternions(returnQuaternion, gunStartQuaternion, eased);
      dealer.position.lerpVectors(returnDealerPosition, dealerStartPosition, eased);
      dealer.rotation.set(
        THREE.MathUtils.lerp(returnDealerRotation.x, dealerStartRotation.x, eased),
        THREE.MathUtils.lerp(returnDealerRotation.y, dealerStartRotation.y, eased),
        THREE.MathUtils.lerp(returnDealerRotation.z, dealerStartRotation.z, eased),
      );
      this.camera.position.lerpVectors(new THREE.Vector3(0.2, 1.9, 2.72), cameraStart, eased);
      this.lookTarget.lerpVectors(new THREE.Vector3(0.1, 0.88, -1.12), lookStart, eased);
      positionHands();
      const retreat = 1 - handBlend;
      gripHand.position.y -= retreat * 0.2;
      loadingHand.position.y -= retreat * 0.22;
      blendDealerLoadHands(handBlend);
    });
    gun.position.copy(gunStartPosition);
    gun.quaternion.copy(gunStartQuaternion);
    dealer.position.copy(dealerStartPosition);
    dealer.rotation.copy(dealerStartRotation);
    this.camera.position.copy(cameraStart);
    this.lookTarget.copy(lookStart);
    this.scene.remove(gripHand, loadingHand);
    this.disposeUniqueObject(gripHand);
    this.disposeUniqueObject(loadingHand);
    if (dealerBoneScales.left) this.dealerHandBones.left?.scale.copy(dealerBoneScales.left);
    if (dealerBoneScales.right) this.dealerHandBones.right?.scale.copy(dealerBoneScales.right);
  }

  private setBriefcaseContents(inventory: ItemId[]): void {
    this.briefcaseItems.clear();
    const shown = inventory.slice(-4);
    shown.forEach((item, index) => {
      const template = this.itemTemplates.get(item);
      if (!template) return;
      const instance = cloneSkeleton(template) as THREE.Group;
      const caseScale: Record<ItemId, number> = {
        magnifier: 0.62,
        cigarettes: 0.72,
        handSaw: 0.5,
        handcuffs: 0.58,
        beer: 0.64,
        burnerPhone: 0.62,
        inverter: 0.66,
        adrenaline: 0.58,
        expiredMedicine: 0.68,
        jammer: 0.58,
        remote: 0.66,
      };
      instance.scale.setScalar(caseScale[item]);
      const span = Math.max(1, shown.length - 1);
      instance.position.set(-0.46 + index * (0.92 / span), 0, index % 2 ? 0.05 : -0.05);
      instance.rotation.copy(this.itemTableRotation(item, true, index));
      instance.rotation.y = (index - (shown.length - 1) / 2) * 0.08;
      instance.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(instance);
      instance.position.y += -bounds.min.y + 0.008;
      this.briefcaseItems.add(instance);
    });
  }

  private async slowPushIn(): Promise<void> {
    if (!this.tableActive) return;
    while (this.animationBusy) await wait(70);
    this.animationBusy = true;
    await this.moveCamera(this.homeCamera.clone().add(new THREE.Vector3(0, 0, -0.16)), this.homeLook.clone(), 620);
    await this.moveCamera(this.homeCamera.clone(), this.homeLook.clone(), 520);
    this.animationBusy = false;
  }

  private moveCamera(position: THREE.Vector3, look: THREE.Vector3, duration: number): Promise<void> {
    const startPosition = this.camera.position.clone();
    const startLook = this.lookTarget.clone();
    return this.tween(duration, (amount) => {
      const eased = this.ease(amount);
      this.camera.position.lerpVectors(startPosition, position, eased);
      this.lookTarget.lerpVectors(startLook, look, eased);
    });
  }

  private walkCamera(position: THREE.Vector3, look: THREE.Vector3, duration: number, steps: number): Promise<void> {
    const startPosition = this.camera.position.clone();
    const startLook = this.lookTarget.clone();
    return this.tween(duration, (amount) => {
      const eased = this.easeInOut(amount);
      const weight = Math.sin(amount * Math.PI);
      this.camera.position.lerpVectors(startPosition, position, eased);
      this.camera.position.y += Math.sin(amount * Math.PI * steps * 2) * 0.025 * weight;
      this.camera.position.x += Math.sin(amount * Math.PI * steps) * 0.012 * weight;
      this.lookTarget.lerpVectors(startLook, look, eased);
    });
  }

  private travelCamera(positions: THREE.Vector3[], looks: THREE.Vector3[], duration: number, steps: number): Promise<void> {
    const positionCurve = positions.length > 2 ? new THREE.CatmullRomCurve3(positions, false, "centripetal") : null;
    const lookCurve = looks.length > 2 ? new THREE.CatmullRomCurve3(looks, false, "centripetal") : null;
    const sample = (points: THREE.Vector3[], curve: THREE.CatmullRomCurve3 | null, amount: number) => {
      if (curve) return curve.getPoint(amount);
      return points[0].clone().lerp(points[points.length - 1], amount);
    };
    return this.tween(duration, (amount) => {
      const eased = this.easeInOut(amount);
      const weight = Math.sin(amount * Math.PI);
      this.camera.position.copy(sample(positions, positionCurve, eased));
      if (steps > 0) {
        this.camera.position.y += Math.sin(amount * Math.PI * steps * 2) * 0.019 * weight;
        this.camera.position.x += Math.sin(amount * Math.PI * steps) * 0.008 * weight;
      }
      this.lookTarget.copy(sample(looks, lookCurve, eased));
    });
  }

  private buildSpeaker(x: number, y: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = x < 0 ? 0.22 : -0.22;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.48, 0.42), new THREE.MeshStandardMaterial({ color: 0x4b4440, roughness: 0.84, metalness: 0.2 }));
    group.add(body);
    for (const [radius, offset] of [[0.21, -0.38], [0.14, 0.12], [0.065, 0.5]] as const) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.022, 8, 24), new THREE.MeshStandardMaterial({ color: 0x746963, roughness: 0.7, metalness: 0.42 }));
      rim.position.set(0, offset, 0.222);
      group.add(rim);
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.94, radius * 0.66, 0.065, 20), new THREE.MeshStandardMaterial({ color: 0x141211, roughness: 0.75 }));
      cone.rotation.x = Math.PI / 2;
      cone.position.set(0, offset, 0.226);
      group.add(cone);
    }
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.012), new THREE.MeshBasicMaterial({ color: 0xb7a58f }));
    badge.position.set(0.22, 0.65, 0.218);
    group.add(badge);
    this.scene.add(group);
  }

  private buildEquipmentRack(x: number, y: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.52, 0.34), new THREE.MeshStandardMaterial({ color: 0x403b38, metalness: 0.46, roughness: 0.71 }));
    group.add(body);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 6; column += 1) {
        const light = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.025, 0.012), new THREE.MeshBasicMaterial({ color: (row + column) % 3 ? 0x242018 : 0x65ff76 }));
        light.position.set(-0.25 + column * 0.1, 0.15 - row * 0.11, 0.177);
        group.add(light);
      }
    }
    this.scene.add(group);
  }

  private buildSpotlightHousing(x: number, y: number, z: number, material: THREE.Material): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.x = -0.45;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.34, 12), material);
    core.rotation.x = Math.PI / 2;
    group.add(core);
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.155, 18),
      new THREE.MeshBasicMaterial({ color: 0x180d0d }),
    );
    lens.position.set(0, 0, 0.205);
    group.add(lens);
    for (const [dx, dy] of [[-0.27, 0], [0.27, 0], [0, -0.27], [0, 0.27]] as const) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(dx === 0 ? 0.34 : 0.2, dy === 0 ? 0.34 : 0.2, 0.045), material);
      flap.position.set(dx, dy, 0.18);
      group.add(flap);
    }
    this.scene.add(group);
  }

  private buildCables(material: THREE.Material): void {
    const curves = [
      [new THREE.Vector3(-2.6, 2.63, -2.0), new THREE.Vector3(-1.2, 2.28, -1.95), new THREE.Vector3(0, 2.5, -2.0), new THREE.Vector3(2.6, 2.54, -2.0)],
      [new THREE.Vector3(-2.5, 2.45, -2.15), new THREE.Vector3(-0.8, 2.12, -2.1), new THREE.Vector3(0.9, 2.22, -2.1), new THREE.Vector3(2.5, 2.44, -2.15)],
    ];
    for (const points of curves) {
      const curve = new THREE.CatmullRomCurve3(points);
      const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.025, 6, false), material);
      this.scene.add(cable);
    }
  }

  private loadTexture(url: string, repeat?: [number, number]): THREE.Texture {
    const cacheKey = `${url}:${repeat?.join("x") ?? "once"}`;
    const cached = this.textureCache.get(cacheKey);
    if (cached) return cached;
    const texture = this.textureLoader.load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(...repeat);
    }
    texture.anisotropy = 2;
    this.textureCache.set(cacheKey, texture);
    return texture;
  }

  private disposeUniqueObject(root: THREE.Object3D): void {
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) material.dispose();
    });
  }

  private tagInteraction(root: THREE.Object3D, interaction: string): void {
    root.userData.interaction = interaction;
    root.traverse((node) => { if (node instanceof THREE.Mesh) node.userData.interaction = interaction; });
  }

  private tween(duration: number, update: (amount: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now: number) => {
        const amount = Math.min(1, (now - start) / duration);
        update(amount);
        if (amount < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  private ease(value: number): number {
    return 1 - Math.pow(1 - value, 3);
  }

  private easeInOut(value: number): number {
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }

  private render(): void {
    if (this.disposed || document.hidden) return;
    const elapsed = this.clock.getElapsedTime();
    const delta = Math.min(0.1, Math.max(1 / 240, elapsed - this.lastRenderElapsed || 1 / 60));
    this.lastRenderElapsed = elapsed;
    const smooth = 1 - Math.exp(-4.7 * delta);
    if (this.activeScene === this.introWorld.scene) this.animateIntroWorld(elapsed);
    else this.animateTableWorld(elapsed, delta, smooth);
    this.camera.lookAt(this.lookTarget);
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.updateHover();
    }
    this.renderer.render(this.activeScene, this.camera);
  }

  private animateIntroWorld(elapsed: number): void {
    this.introWorld.fluorescent.intensity = 25 + Math.sin(elapsed * 39) * 1.4 + (Math.sin(elapsed * 7.3) > 0.94 ? -8 : 0);
    for (const tile of this.introWorld.clubTiles) {
      const material = tile.material as THREE.MeshStandardMaterial;
      const pulse = Math.sin(elapsed * 5.8 + Number(tile.userData.clubPhase ?? 0));
      material.emissiveIntensity = 0.035 + Math.max(0, pulse) * 0.17;
    }
    for (const light of this.introWorld.clubLights) {
      const phase = Number(light.userData.clubPhase ?? 0);
      light.intensity = 28 + Math.max(0, Math.sin(elapsed * 4.1 + phase)) * 38;
      light.target.position.x = 6.35 + Math.sin(elapsed * 0.92 + phase) * 2.35;
      light.target.position.z = -6.65 + Math.cos(elapsed * 0.73 + phase * 0.7) * 2.15;
    }
    for (const dancer of this.introWorld.clubCrowd) {
      const phase = Number(dancer.userData.clubPhase ?? 0);
      const restY = Number(dancer.userData.restY ?? -3.03);
      dancer.position.y = restY + Math.max(0, Math.sin(elapsed * 5.4 + phase)) * 0.085;
      dancer.rotation.z = Math.sin(elapsed * 2.7 + phase) * 0.06;
      dancer.rotation.y = Number(dancer.userData.restRotationY ?? 0) + Math.sin(elapsed * 1.35 + phase) * 0.045;
      const shoulders = dancer.children[3];
      shoulders?.children.forEach((arm, index) => {
        arm.rotation.z = Number(arm.userData.restZ ?? 0) + Math.sin(elapsed * 3.4 + phase + index * 1.7) * 0.12;
        arm.rotation.x = Number(arm.userData.restX ?? 0) + Math.sin(elapsed * 2.3 + phase + index) * 0.055;
      });
      const feet = dancer.children[4];
      feet?.children.forEach((leg, index) => {
        leg.rotation.z = Number(leg.userData.restZ ?? 0) + Math.sin(elapsed * 2.8 + phase + index * Math.PI) * 0.035;
      });
    }
    const clubHaze = this.introWorld.scene.getObjectByName("club-haze");
    if (clubHaze) clubHaze.rotation.y = Math.sin(elapsed * 0.14) * 0.07;
  }

  private animateTableWorld(elapsed: number, delta: number, smooth: number): void {
    if (this.shotgun) this.shotgun.scale.x += (this.shotgunTargetScale - this.shotgun.scale.x) * smooth;
    if (elapsed - this.lastSecondaryUpdate >= 1 / 30) {
      this.lastSecondaryUpdate = elapsed;
      if (!this.animationBusy) {
        this.roomLightLeft.intensity = 18.2 + Math.sin(elapsed * 7.4) * 0.75 + Math.sin(elapsed * 19.7) * 0.25;
        this.roomLightRight.intensity = 16.2 + Math.sin(elapsed * 6.8 + 1.4) * 0.65;
      }
      for (const [index, fan] of this.ventilationFans.entries()) fan.rotation.z = elapsed * (index % 2 ? -1.25 : 1.08);
      for (const light of this.industrialLights) {
        const phase = Number(light.userData.phase ?? 0);
        light.intensity = 1.2 + Math.max(0, Math.sin(elapsed * 3.2 + phase)) * 2.2;
      }
      const dust = this.scene.getObjectByName("dust");
      if (dust) dust.rotation.y = elapsed * 0.018;
    }
    if (this.dealer && !this.animationBusy) {
      this.dealer.position.y = this.dealerRestY + Math.sin(elapsed * 1.1) * 0.014;
      this.dealer.rotation.z = Math.sin(elapsed * 0.48) * 0.01;
    }
    if (this.tableActive && !this.animationBusy) {
      const cameraSmooth = 1 - Math.exp(-1.34 * delta);
      this.camera.position.x += (this.pointer.x * 0.055 - this.camera.position.x) * cameraSmooth;
      this.camera.position.y += (this.homeCamera.y + this.pointer.y * 0.03 - this.camera.position.y) * cameraSmooth;
    }
  }

  private updateHover(): void {
    if (!this.tableActive || this.animationBusy) {
      this.setHovered(null);
      return;
    }
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.activeScene.children, true).find((entry) => this.findInteraction(entry.object));
    const interaction = this.findInteraction(hit?.object ?? null);
    this.setHovered(interaction);
  }

  private setHovered(interaction: string | null): void {
    if (interaction === this.hoveredInteraction) return;
    this.hoveredInteraction = interaction;
    this.onHover(interaction);
  }

  private findInteraction(object: THREE.Object3D | null): string | null {
    let current = object;
    while (current) {
      if (typeof current.userData.interaction === "string") return current.userData.interaction;
      current = current.parent;
    }
    return null;
  }

  private bindEvents(): void {
    window.addEventListener("resize", () => this.resize());
    this.canvas.addEventListener("pointermove", (event) => {
      const bounds = this.canvas.getBoundingClientRect();
      this.pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      this.pointerDirty = true;
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.pointer.set(4, 4);
      this.pointerDirty = true;
    });
    this.canvas.addEventListener("click", () => {
      if (!this.tableActive || this.animationBusy) return;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects(this.activeScene.children, true).find((entry) => this.findInteraction(entry.object));
      const interaction = this.findInteraction(hit?.object ?? null);
      if (interaction) this.onInteraction(interaction);
    });
    this.canvas.addEventListener("webglcontextlost", (event) => event.preventDefault());
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const portrait = width / height < 0.82;
    this.homeCamera.set(0, portrait ? 2.55 : 2.2, portrait ? 4.24 : 3.48);
    const healthMachine = this.scene.getObjectByName("health-machine");
    if (healthMachine) {
      healthMachine.position.x = portrait ? 1.72 : 2.7;
      healthMachine.position.z = portrait ? -0.42 : -0.16;
      healthMachine.scale.setScalar(portrait ? 0.72 : 1);
    }
    const shellRack = this.scene.getObjectByName("shell-rack");
    if (shellRack) shellRack.position.x = portrait ? 0.66 : 1.28;
    this.camera.fov = portrait ? 56 : 50;
    if (this.tableActive && !this.animationBusy) {
      this.camera.position.copy(this.homeCamera);
      this.lookTarget.copy(this.homeLook);
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
