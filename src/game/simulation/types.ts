export type Actor = "player" | "dealer";
export type Shell = "live" | "blank";
export type GameMode = "solo" | "multiplayer";
export type GameStatus = "playing" | "round-over" | "match-over";

export type ItemId =
  | "magnifier"
  | "cigarettes"
  | "handSaw"
  | "handcuffs"
  | "beer"
  | "burnerPhone"
  | "inverter"
  | "adrenaline"
  | "expiredMedicine"
  | "jammer"
  | "remote";

export interface FutureKnowledge {
  offset: number;
  shell: Shell;
}

export interface ShotEvent {
  kind: "shot";
  actor: Actor;
  target: Actor;
  shell: Shell;
  damage: number;
  message: string;
}

export interface ItemEvent {
  kind: "item";
  actor: Actor;
  item: ItemId;
  message: string;
  revealed?: Shell;
  ejected?: Shell;
  insight?: FutureKnowledge;
  healthDelta?: number;
  stolenItem?: ItemId;
  activatedItem?: ItemId;
}

export interface SystemEvent {
  kind: "reload" | "round";
  message: string;
  live?: number;
  blank?: number;
}

export type GameEvent = ShotEvent | ItemEvent | SystemEvent;

export interface GameState {
  mode: GameMode;
  status: GameStatus;
  /** Story stage in solo; round number in multiplayer. */
  round: number;
  roundWins: Record<Actor, number>;
  maxHealth: number;
  health: Record<Actor, number>;
  suddenDeath: Record<Actor, boolean>;
  turn: Actor;
  chamber: Shell[];
  knownShell: Record<Actor, Shell | null>;
  futureKnowledge: Record<Actor, FutureKnowledge[]>;
  inventory: Record<Actor, ItemId[]>;
  damageBoost: Record<Actor, boolean>;
  restrained: Record<Actor, boolean>;
  turnDirection: 1 | -1;
  rngState: number;
  revision: number;
  chamberNumber: number;
  loadNumber: number;
  lastEvent: GameEvent;
  winner: Actor | null;
}

export type GameCommand =
  | { type: "shoot"; actor: Actor; target: Actor }
  | { type: "item"; actor: Actor; item: ItemId; stolenItem?: ItemId }
  | { type: "next-round" };

export interface ItemDefinition {
  id: ItemId;
  name: string;
  short: string;
  glyph: string;
  availability: "story" | "double" | "multiplayer";
}
