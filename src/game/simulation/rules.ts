import { MULTIPLAYER_ITEM_IDS, STORY_ITEM_IDS } from "../content/items";
import type { Actor, FutureKnowledge, GameCommand, GameEvent, GameMode, GameState, ItemEvent, ItemId, Shell } from "./types";

const other = (actor: Actor): Actor => actor === "player" ? "dealer" : "player";
const oppositeShell = (shell: Shell): Shell => shell === "live" ? "blank" : "live";
const actorName = (actor: Actor): string => actor === "player" ? "You" : "The Dealer";

function nextRandom(state: GameState): number {
  let value = state.rngState | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rngState = value >>> 0;
  return state.rngState / 4_294_967_296;
}

function randomInt(state: GameState, min: number, max: number): number {
  return Math.floor(nextRandom(state) * (max - min + 1)) + min;
}

function shuffle<T>(state: GameState, values: T[]): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = randomInt(state, 0, index);
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

function itemPool(state: GameState): ItemId[] {
  return state.mode === "multiplayer" ? MULTIPLAYER_ITEM_IDS : STORY_ITEM_IDS;
}

function drawItems(state: GameState, actor: Actor, count: number): void {
  const inventory = state.inventory[actor];
  const pool = itemPool(state);
  let attempts = 0;
  while (inventory.length < 8 && count > 0 && attempts < 80) {
    attempts += 1;
    const item = pool[randomInt(state, 0, pool.length - 1)];
    if (item === "cigarettes" && inventory.filter((held) => held === item).length >= 2) continue;
    inventory.push(item);
    count -= 1;
  }
}

function loadRecipe(state: GameState): { live: number; blank: number } {
  if (state.mode === "solo" && state.round === 1 && state.loadNumber === 1) return { live: 1, blank: 2 };
  if (state.mode === "solo" && state.round === 1 && state.loadNumber === 2) return { live: 3, blank: 2 };
  if (state.mode === "solo" && state.round === 2 && state.loadNumber === 1) return { live: 1, blank: 1 };
  const total = randomInt(state, 2, 8);
  const live = randomInt(state, 1, total - 1);
  return { live, blank: total - live };
}

function loadChamber(state: GameState): void {
  state.loadNumber += 1;
  const recipe = loadRecipe(state);
  state.chamber = shuffle(state, [
    ...Array<Shell>(recipe.live).fill("live"),
    ...Array<Shell>(recipe.blank).fill("blank"),
  ]);
  state.knownShell = { player: null, dealer: null };
  state.futureKnowledge = { player: [], dealer: [] };
  state.chamberNumber += 1;

  const itemsPerLoad = state.mode === "multiplayer" ? 2 : state.round === 2 ? 2 : state.round === 3 ? 4 : 0;
  drawItems(state, "player", itemsPerLoad);
  drawItems(state, "dealer", itemsPerLoad);
}

export function shellCounts(state: GameState): { live: number; blank: number } {
  return state.chamber.reduce(
    (counts, shell) => ({ ...counts, [shell]: counts[shell] + 1 }),
    { live: 0, blank: 0 },
  );
}

export function createMatch(seed = Date.now(), mode: GameMode = "solo"): GameState {
  const maxHealth = mode === "solo" ? 2 : 3;
  const initial: GameState = {
    mode,
    status: "playing",
    round: 1,
    roundWins: { player: 0, dealer: 0 },
    maxHealth,
    health: { player: maxHealth, dealer: maxHealth },
    suddenDeath: { player: false, dealer: false },
    turn: "player",
    chamber: [],
    knownShell: { player: null, dealer: null },
    futureKnowledge: { player: [], dealer: [] },
    inventory: { player: [], dealer: [] },
    damageBoost: { player: false, dealer: false },
    restrained: { player: false, dealer: false },
    turnDirection: 1,
    rngState: (seed >>> 0) || 0x51f15e,
    revision: 0,
    chamberNumber: 0,
    loadNumber: 0,
    lastEvent: { kind: "round", message: "WELCOME TO JIMS ROULETTE." },
    winner: null,
  };
  loadChamber(initial);
  return initial;
}

export function canUseItem(state: GameState, actor: Actor, item: ItemId): boolean {
  if (state.status !== "playing" || state.turn !== actor || !state.inventory[actor].includes(item)) return false;
  switch (item) {
    case "magnifier": return state.knownShell[actor] === null && state.chamber.length > 0;
    case "handSaw": return !state.damageBoost[actor];
    case "handcuffs":
    case "jammer": return !state.restrained[other(actor)];
    case "beer":
    case "inverter": return state.chamber.length > 0;
    case "burnerPhone": return state.chamber.length > 0;
    case "adrenaline": return state.inventory[other(actor)].some((held) => held !== "adrenaline");
    case "remote": return state.mode === "multiplayer";
    case "cigarettes":
    case "expiredMedicine": return true;
  }
}

function consumeItem(state: GameState, actor: Actor, item: ItemId): void {
  const index = state.inventory[actor].indexOf(item);
  if (index >= 0) state.inventory[actor].splice(index, 1);
}

function advanceKnowledge(state: GameState): void {
  for (const actor of ["player", "dealer"] as Actor[]) {
    state.knownShell[actor] = null;
    state.futureKnowledge[actor] = state.futureKnowledge[actor]
      .map((entry) => ({ ...entry, offset: entry.offset - 1 }))
      .filter((entry) => entry.offset >= 0);
    const current = state.futureKnowledge[actor].find((entry) => entry.offset === 0);
    if (current) state.knownShell[actor] = current.shell;
  }
}

function finishStage(state: GameState, winner: Actor): void {
  state.roundWins[winner] += 1;
  state.winner = winner;
  state.status = state.mode === "solo"
    ? state.round >= 3 ? "match-over" : "round-over"
    : state.roundWins[winner] >= 2 ? "match-over" : "round-over";
}

function loseHealth(state: GameState, actor: Actor, amount: number): number {
  const before = state.health[actor];
  state.health[actor] = Math.max(0, before - amount);
  if (state.mode === "solo" && state.round === 3 && !state.suddenDeath[actor] && state.health[actor] > 0 && state.health[actor] <= 2) {
    state.health[actor] = 1;
    state.suddenDeath[actor] = true;
  }
  if (state.health[actor] === 0) finishStage(state, other(actor));
  return state.health[actor] - before;
}

function activateItem(state: GameState, actor: Actor, item: ItemId, shouldConsume = true): ItemEvent {
  if (shouldConsume) consumeItem(state, actor, item);
  const rival = other(actor);

  switch (item) {
    case "magnifier": {
      const revealed = state.chamber[0];
      state.knownShell[actor] = revealed;
      return { kind: "item", actor, item, revealed, message: `${actorName(actor)} check${actor === "player" ? "" : "s"} the chamber. ${revealed.toUpperCase()}.` };
    }
    case "cigarettes": {
      const before = state.health[actor];
      if (!state.suddenDeath[actor]) state.health[actor] = Math.min(state.maxHealth, state.health[actor] + 1);
      const healthDelta = state.health[actor] - before;
      return { kind: "item", actor, item, healthDelta, message: healthDelta > 0 ? `${actorName(actor)} regain${actor === "player" ? "" : "s"} 1 charge.` : "THE EDGE DOES NOT MOVE." };
    }
    case "handSaw":
      state.damageBoost[actor] = true;
      return { kind: "item", actor, item, message: "THE SHOTGUN WILL DEAL 2 DAMAGE." };
    case "handcuffs":
    case "jammer":
      state.restrained[rival] = true;
      return { kind: "item", actor, item, message: `${rival === "dealer" ? "THE DEALER" : "YOU"} WILL SKIP THE NEXT TURN.` };
    case "beer": {
      const ejected = state.chamber.shift();
      if (!ejected) throw new Error("There is no shell to eject");
      advanceKnowledge(state);
      if (state.chamber.length === 0) loadChamber(state);
      return { kind: "item", actor, item, ejected, message: `${actorName(actor)} rack${actor === "player" ? "" : "s"} out a ${ejected.toUpperCase()} shell.` };
    }
    case "burnerPhone": {
      if (state.chamber.length <= 1) return { kind: "item", actor, item, message: "HOW UNFORTUNATE..." };
      const offset = randomInt(state, 1, state.chamber.length - 1);
      const insight: FutureKnowledge = { offset, shell: state.chamber[offset] };
      state.futureKnowledge[actor].push(insight);
      return { kind: "item", actor, item, insight, message: `${ordinal(offset + 1)} SHELL... ${insight.shell.toUpperCase()} ROUND.` };
    }
    case "inverter": {
      const inverted = oppositeShell(state.chamber[0]);
      state.chamber[0] = inverted;
      for (const informed of ["player", "dealer"] as Actor[]) {
        if (state.knownShell[informed]) state.knownShell[informed] = inverted;
      }
      return { kind: "item", actor, item, revealed: inverted, message: "THE CURRENT SHELL CHANGES POLARITY." };
    }
    case "expiredMedicine": {
      const won = nextRandom(state) < 0.5;
      const before = state.health[actor];
      if (won && !state.suddenDeath[actor]) state.health[actor] = Math.min(state.maxHealth, state.health[actor] + 2);
      else if (!won) loseHealth(state, actor, 1);
      const healthDelta = state.health[actor] - before;
      return { kind: "item", actor, item, healthDelta, message: healthDelta > 0 ? "THE MEDICINE RESTORES 2 CHARGES." : healthDelta < 0 ? "THE MEDICINE TAKES 1 CHARGE." : "NOTHING HAPPENS." };
    }
    case "remote":
      state.turnDirection = state.turnDirection === 1 ? -1 : 1;
      return { kind: "item", actor, item, message: "THE TABLE'S TURN ORDER REVERSES." };
    case "adrenaline":
      throw new Error("Adrenaline requires a selected item");
  }
}

function ordinal(value: number): string {
  const suffix = value === 2 ? "SECOND" : value === 3 ? "THIRD" : value === 4 ? "FOURTH" : value === 5 ? "FIFTH" : value === 6 ? "SIXTH" : value === 7 ? "SEVENTH" : "EIGHTH";
  return suffix;
}

function useItem(state: GameState, actor: Actor, item: ItemId, stolenItem?: ItemId): GameEvent {
  if (!canUseItem(state, actor, item)) throw new Error(`Item ${item} cannot be used now`);
  if (item !== "adrenaline") return activateItem(state, actor, item);

  const rival = other(actor);
  if (!stolenItem || stolenItem === "adrenaline") throw new Error("Select a non-adrenaline item to steal");
  const stolenIndex = state.inventory[rival].indexOf(stolenItem);
  if (stolenIndex < 0) throw new Error("The selected rival item is no longer available");
  consumeItem(state, actor, "adrenaline");
  state.inventory[rival].splice(stolenIndex, 1);
  const effect = activateItem(state, actor, stolenItem, false);
  return {
    ...effect,
    item: "adrenaline",
    stolenItem,
    activatedItem: stolenItem,
    message: `ADRENALINE: ${effect.message}`,
  };
}

function shoot(state: GameState, actor: Actor, target: Actor): GameEvent {
  if (state.status !== "playing") throw new Error("The stage is not active");
  if (state.turn !== actor) throw new Error("It is not that actor's turn");
  const shell = state.chamber.shift();
  if (!shell) throw new Error("The shotgun is empty");

  const damage = shell === "live" ? state.damageBoost[actor] ? 2 : 1 : 0;
  state.damageBoost[actor] = false;
  advanceKnowledge(state);
  if (damage > 0) loseHealth(state, target, damage);

  const subject = target === "player" ? "YOU" : "THE DEALER";
  const message = shell === "live" ? `${subject} TAKE${target === "player" ? "" : "S"} ${damage} DAMAGE.` : "BLANK.";
  const event: GameEvent = { kind: "shot", actor, target, shell, damage, message };
  if (state.status !== "playing") return event;

  let nextTurn = shell === "blank" && target === actor ? actor : other(actor);
  if (nextTurn !== actor && state.restrained[nextTurn]) {
    state.restrained[nextTurn] = false;
    nextTurn = actor;
  }
  state.turn = nextTurn;
  if (state.chamber.length === 0) loadChamber(state);
  return event;
}

function nextRound(state: GameState): GameEvent {
  if (state.status !== "round-over") throw new Error("A new stage cannot start yet");
  state.round += 1;
  state.maxHealth = state.mode === "solo" ? [0, 2, 4, 6][state.round] : Math.min(5, 3 + state.round - 1);
  state.health = { player: state.maxHealth, dealer: state.maxHealth };
  state.suddenDeath = { player: false, dealer: false };
  state.inventory = { player: [], dealer: [] };
  state.damageBoost = { player: false, dealer: false };
  state.restrained = { player: false, dealer: false };
  state.turn = state.mode === "solo" ? "player" : state.round % 2 === 0 ? "dealer" : "player";
  state.status = "playing";
  state.winner = null;
  state.loadNumber = 0;
  loadChamber(state);
  return { kind: "round", message: state.round === 3 ? "THE FINAL SHOWDOWN." : `ROUND ${state.round}.` };
}

export function applyCommand(current: GameState, command: GameCommand): GameState {
  const state = structuredClone(current);
  const event = command.type === "shoot"
    ? shoot(state, command.actor, command.target)
    : command.type === "item"
      ? useItem(state, command.actor, command.item, command.stolenItem)
      : nextRound(state);
  state.lastEvent = event;
  state.revision += 1;
  return state;
}
