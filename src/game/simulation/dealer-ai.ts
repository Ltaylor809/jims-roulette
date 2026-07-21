import { canUseItem, shellCounts } from "./rules";
import type { GameState, ItemId, Shell } from "./types";

function knownCurrent(state: GameState): Shell | null {
  if (state.chamber.length === 1) return state.chamber[0];
  return state.knownShell.dealer;
}

export function chooseDealerItem(state: GameState, itemsUsed: number): ItemId | null {
  if (itemsUsed >= 8) return null;
  const owned = state.inventory.dealer;
  const usable = (item: ItemId) => owned.includes(item) && canUseItem(state, "dealer", item);
  const known = knownCurrent(state);
  const counts = shellCounts(state);
  const liveChance = counts.live / Math.max(1, counts.live + counts.blank);

  if (usable("cigarettes") && state.health.dealer < state.maxHealth) return "cigarettes";
  if (usable("expiredMedicine") && state.health.dealer > 1 && state.health.dealer < state.maxHealth - 1) return "expiredMedicine";
  if (usable("magnifier") && !known && state.chamber.length > 1) return "magnifier";
  if (usable("inverter") && known === "blank") return "inverter";
  if (usable("handSaw") && (known === "live" || (!known && liveChance >= 0.5))) return "handSaw";
  if (usable("handcuffs")) return "handcuffs";
  if (usable("jammer")) return "jammer";
  if (usable("beer") && known === "blank" && state.chamber.length > 1) return "beer";
  if (usable("burnerPhone") && state.chamber.length > 2 && state.futureKnowledge.dealer.length === 0) return "burnerPhone";
  if (usable("adrenaline") && chooseAdrenalineTarget(state)) return "adrenaline";
  return null;
}

export function chooseAdrenalineTarget(state: GameState): ItemId | undefined {
  const priority: ItemId[] = ["inverter", "magnifier", "handSaw", "handcuffs", "jammer", "cigarettes", "beer", "burnerPhone", "expiredMedicine", "remote"];
  return priority.find((item) => state.inventory.player.includes(item));
}

export function chooseDealerTarget(state: GameState): "player" | "dealer" {
  const known = knownCurrent(state);
  if (known === "live") return "player";
  if (known === "blank") return "dealer";
  const counts = shellCounts(state);
  const liveChance = counts.live / Math.max(1, counts.live + counts.blank);
  if (liveChance < 0.5 && state.health.dealer > 1) return "dealer";
  return "player";
}
