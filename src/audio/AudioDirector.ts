import type { GameEvent, ItemId } from "../game/simulation/types";

const local = "/assets/local-only/audio/";
const original = "/assets/local-only/original/audio/";

type AudioPhase = "idle" | "restroom" | "club-open" | "club-muted" | "table";

export type MechanicalCue =
  | "briefcase"
  | "shells"
  | "rack"
  | "saw"
  | "wire"
  | "door"
  | "mainDoor"
  | "walk"
  | "gunFoley"
  | "rackForward"
  | "rackBack"
  | "loadShell"
  | "splatter"
  | "dealerHands"
  | "clubStart"
  | "clubOpen"
  | "clubMuffle";

const mechanicalSounds: Partial<Record<MechanicalCue, string>> = {
  briefcase: original + "open briefcase.ogg",
  shells: original + "shell latch1.ogg",
  rack: local + "rack_shotgun.ogg",
  saw: original + "blade cut.ogg",
  wire: original + "health counter reduce health.ogg",
  door: original + "intro/kick door enter backroom.ogg",
  mainDoor: original + "intro/kick door enter backroom.ogg",
  walk: original + "intro/crt_player walk.ogg",
  gunFoley: original + "intro/gun foley1.ogg",
  rackForward: original + "intro/rack shotgun_forward.ogg",
  rackBack: original + "intro/rack shotgun_back.ogg",
  loadShell: local + "load_shell.ogg",
  splatter: original + "intro/splatter1.ogg",
  dealerHands: original + "dealer hands on table.ogg",
};

const signatureSounds = {
  boot: original + "intro/signature machine bootup high pass.ogg",
  key: original + "intro/signature machine key press.ogg",
  letter: original + "intro/signature machine letter punch.ogg",
  shutdown: original + "intro/signature machine shutdown1.ogg",
} as const;

export class AudioDirector {
  private enabled = true;
  private started = false;
  private phase: AudioPhase = "idle";
  private music = new Audio(local + "music_room.ogg");
  private heartbeat = new Audio(local + "heartbeat.ogg");
  private ambience = new Audio(original + "ambience_fluorescent light.ogg");
  private readonly clubTracks = [local + "club/Bass Killer.mp3"];
  private clubIndex = 0;
  private clubStarted = false;
  private club = new Audio(this.clubTracks[0]);
  private clubContext: AudioContext | null = null;
  private clubSource: MediaElementAudioSourceNode | null = null;
  private clubFilter: BiquadFilterNode | null = null;
  private clubGain: GainNode | null = null;
  private effectsContext: AudioContext | null = null;
  private readonly effectBuffers = new Map<string, AudioBuffer>();
  private readonly effectLoads = new Map<string, Promise<void>>();
  private readonly fallbackPools = new Map<string, HTMLAudioElement[]>();
  private readonly fallbackIndices = new Map<string, number>();
  private sounds = {
    live: local + "gunshot_live.wav",
    blank: local + "gunshot_blank.wav",
    rack: local + "rack_shotgun.ogg",
    load: local + "load_shell.ogg",
    item: local + "button_press.ogg",
    hover: local + "button_hover.ogg",
  };
  private itemSounds: Partial<Record<ItemId, string>> = {
    magnifier: original + "player use magnifier.ogg",
    cigarettes: original + "player use cigarettes.ogg",
    handSaw: original + "player use handsaw.ogg",
    handcuffs: original + "player use handcuffs.ogg",
    beer: original + "player use beer.ogg",
    burnerPhone: original + "player use burner phone.ogg",
    inverter: original + "player use inverter.ogg",
    adrenaline: original + "player use adrenaline.ogg",
    expiredMedicine: original + "player use medicine.ogg",
  };
  private itemPickupSounds: Partial<Record<ItemId, string>> = {
    magnifier: original + "pick up magnifier.ogg",
    cigarettes: original + "pick up cigarettes.ogg",
    handcuffs: original + "pick up handcuffs.ogg",
    beer: original + "pick up beer.ogg",
    burnerPhone: original + "pick up burner phone.ogg",
    inverter: original + "pick up inverter.ogg",
    adrenaline: original + "pick up adrenaline.ogg",
    expiredMedicine: original + "pick up medicine.ogg",
  };

  constructor() {
    this.music.loop = true;
    this.music.volume = 0.34;
    this.ambience.loop = true;
    this.ambience.volume = 0.18;
    this.heartbeat.loop = true;
    this.heartbeat.volume = 0;
    this.club.preload = "auto";
    this.club.volume = 1;
    this.club.addEventListener("ended", () => this.advanceClubTrack());
    this.club.load();
  }

  start(): void {
    if (!this.started) {
      this.started = true;
      this.phase = "restroom";
    }
    this.ensureEffectsContext();
    void this.effectsContext?.resume();
    this.preloadEffects();
    if (!this.enabled) return;
    void this.ambience.play().catch(() => undefined);
  }

  enterTable(): void {
    this.phase = "table";
    this.rampClub(420, 0.055, 0.7);
    if (!this.enabled) return;
    void this.music.play().catch(() => undefined);
    void this.ambience.play().catch(() => undefined);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) {
      if (!this.started) this.start();
      void this.clubContext?.resume();
      void this.effectsContext?.resume();
      void this.ambience.play().catch(() => undefined);
      if (this.phase === "table") void this.music.play().catch(() => undefined);
      if (this.clubStarted) void this.club.play().catch(() => undefined);
      this.restoreClubMix();
    } else {
      this.music.pause();
      this.club.pause();
      this.ambience.pause();
      this.heartbeat.pause();
    }
    return this.enabled;
  }

  hover(): void { this.play("hover", 0.14); }

  react(event: GameEvent): void {
    if (!this.enabled) return;
    if (event.kind === "round") this.play("load", 0.5);
  }

  item(item: ItemId, phase: "pickup" | "use"): void {
    if (!this.enabled) return;
    const url = phase === "pickup" ? this.itemPickupSounds[item] : this.itemSounds[item];
    this.playUrl(url ?? (phase === "pickup" ? original + "intro/gun foley1.ogg" : local + "button_press.ogg"), phase === "pickup" ? 0.38 : 0.5);
  }

  fire(shell: "live" | "blank"): void {
    if (!this.enabled) return;
    this.play(shell, shell === "live" ? 0.78 : 0.52);
  }

  revealLoad(live: number, blank: number): void {
    if (!this.enabled) return;
    const sequence = [
      ...Array(live).fill(original + "shell indicator_live.ogg"),
      ...Array(blank).fill(original + "shell indicator_blank.ogg"),
    ];
    sequence.forEach((url, index) => this.playUrl(url, 0.42, index * 330));
  }

  mechanical(cue: MechanicalCue): void {
    if (cue === "clubStart") {
      this.startClubCountdown();
      return;
    }
    if (cue === "clubOpen") {
      this.phase = "club-open";
      this.rampClub(14_000, 0.72, 0.42);
      return;
    }
    if (cue === "clubMuffle") {
      this.phase = "club-muted";
      this.rampClub(520, 0.12, 0.55);
      return;
    }
    if (!this.enabled) return;
    const url = mechanicalSounds[cue];
    if (url) this.playUrl(url, cue === "wire" ? 0.62 : cue === "mainDoor" ? 0.36 : cue === "dealerHands" ? 0.19 : 0.48);
  }

  signature(cue: "boot" | "key" | "letter" | "shutdown"): void {
    if (!this.enabled) return;
    this.playUrl(signatureSounds[cue], cue === "boot" ? 0.5 : 0.42);
  }

  setDanger(health: number): void {
    if (!this.enabled || health > 1) {
      this.heartbeat.pause();
      this.heartbeat.currentTime = 0;
      return;
    }
    this.heartbeat.volume = 0.38;
    void this.heartbeat.play().catch(() => undefined);
  }

  private startClubCountdown(): void {
    this.phase = "club-muted";
    this.clubIndex = 0;
    this.clubStarted = true;
    this.club.pause();
    this.club.src = this.clubTracks[this.clubIndex];
    this.club.currentTime = 0;
    this.ensureClubGraph();
    this.setClubMix(420, 0.1);
    if (!this.enabled) return;
    void this.clubContext?.resume();
    void this.club.play().catch(() => undefined);
  }

  private advanceClubTrack(): void {
    if (!this.clubStarted) return;
    this.clubIndex = (this.clubIndex + 1) % this.clubTracks.length;
    this.club.src = this.clubTracks[this.clubIndex];
    this.club.currentTime = 0;
    if (this.enabled) void this.club.play().catch(() => undefined);
  }

  private ensureClubGraph(): void {
    if (this.clubContext) return;
    try {
      this.clubContext = new AudioContext();
      this.clubSource = this.clubContext.createMediaElementSource(this.club);
      this.clubFilter = this.clubContext.createBiquadFilter();
      this.clubFilter.type = "lowpass";
      this.clubFilter.Q.value = 0.72;
      this.clubGain = this.clubContext.createGain();
      this.clubSource.connect(this.clubFilter).connect(this.clubGain).connect(this.clubContext.destination);
    } catch {
      this.clubContext = null;
      this.clubSource = null;
      this.clubFilter = null;
      this.clubGain = null;
    }
  }

  private rampClub(frequency: number, gain: number, seconds: number): void {
    if (!this.clubFilter || !this.clubGain || !this.clubContext) {
      this.club.volume = Math.min(1, gain);
      return;
    }
    const now = this.clubContext.currentTime;
    this.clubFilter.frequency.cancelScheduledValues(now);
    this.clubGain.gain.cancelScheduledValues(now);
    this.clubFilter.frequency.setValueAtTime(this.clubFilter.frequency.value, now);
    this.clubGain.gain.setValueAtTime(this.clubGain.gain.value, now);
    this.clubFilter.frequency.linearRampToValueAtTime(frequency, now + seconds);
    this.clubGain.gain.linearRampToValueAtTime(gain, now + seconds);
  }

  private setClubMix(frequency: number, gain: number): void {
    if (this.clubFilter) this.clubFilter.frequency.value = frequency;
    if (this.clubGain) this.clubGain.gain.value = gain;
    else this.club.volume = Math.min(1, gain);
  }

  private restoreClubMix(): void {
    if (this.phase === "club-open") this.setClubMix(14_000, 0.72);
    else if (this.phase === "club-muted") this.setClubMix(520, 0.12);
    else if (this.phase === "table") this.setClubMix(420, 0.055);
  }

  private play(key: keyof typeof this.sounds, volume: number): void {
    this.playUrl(this.sounds[key], volume);
  }

  private ensureEffectsContext(): void {
    if (this.effectsContext) return;
    try {
      this.effectsContext = new AudioContext({ latencyHint: "interactive" });
    } catch {
      this.effectsContext = null;
    }
  }

  private preloadEffects(): void {
    const urls = new Set([
      ...Object.values(this.sounds),
      ...Object.values(this.itemSounds),
      ...Object.values(this.itemPickupSounds),
      ...Object.values(mechanicalSounds),
      ...Object.values(signatureSounds),
    ].filter((url): url is string => Boolean(url)));
    for (const url of urls) void this.loadEffect(url);
  }

  private loadEffect(url: string): Promise<void> {
    if (!this.effectsContext || this.effectBuffers.has(url)) return Promise.resolve();
    const existing = this.effectLoads.get(url);
    if (existing) return existing;
    const load = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Audio preload failed: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => this.effectsContext?.decodeAudioData(bytes))
      .then((buffer) => {
        if (buffer) this.effectBuffers.set(url, buffer);
      })
      .catch(() => undefined)
      .finally(() => this.effectLoads.delete(url));
    this.effectLoads.set(url, load);
    return load;
  }

  private playUrl(url: string, volume: number, delayMs = 0): void {
    const context = this.effectsContext;
    const buffer = this.effectBuffers.get(url);
    if (context && buffer) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = volume;
      source.buffer = buffer;
      source.connect(gain).connect(context.destination);
      source.start(context.currentTime + Math.max(0, delayMs) / 1000);
      return;
    }

    if (context) void this.loadEffect(url);
    const playFallback = () => {
      let pool = this.fallbackPools.get(url);
      if (!pool) {
        pool = Array.from({ length: 3 }, () => {
          const sound = new Audio(url);
          sound.preload = "auto";
          sound.load();
          return sound;
        });
        this.fallbackPools.set(url, pool);
      }
      const available = pool.find((sound) => sound.paused || sound.ended);
      const index = this.fallbackIndices.get(url) ?? 0;
      const sound = available ?? pool[index % pool.length];
      this.fallbackIndices.set(url, (index + 1) % pool.length);
      sound.pause();
      sound.currentTime = 0;
      sound.volume = volume;
      void sound.play().catch(() => undefined);
    };
    if (delayMs > 0) window.setTimeout(playFallback, delayMs);
    else playFallback();
  }
}
