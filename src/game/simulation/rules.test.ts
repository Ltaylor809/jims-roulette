import { describe, expect, it } from "vitest";
import { DOUBLE_ITEM_IDS, ITEM_IDS, MULTIPLAYER_ITEM_IDS, STORY_ITEM_IDS } from "../content/items";
import { applyCommand, createMatch, shellCounts } from "./rules";

describe("Jims Roulette rules", () => {
  it("ships the complete base, extended, and multiplayer item rosters", () => {
    expect(STORY_ITEM_IDS).toHaveLength(5);
    expect(DOUBLE_ITEM_IDS).toHaveLength(9);
    expect(MULTIPLAYER_ITEM_IDS).toHaveLength(9);
    expect(ITEM_IDS).toHaveLength(11);
    expect(MULTIPLAYER_ITEM_IDS).toContain("jammer");
    expect(MULTIPLAYER_ITEM_IDS).toContain("remote");
    expect(MULTIPLAYER_ITEM_IDS).not.toContain("handcuffs");
    expect(MULTIPLAYER_ITEM_IDS).not.toContain("expiredMedicine");
  });

  it("starts faithful Story Mode with two charges, no items, and a 1/2 load", () => {
    const first = createMatch(1234);
    const second = createMatch(1234);
    expect(first.chamber).toEqual(second.chamber);
    expect(first.health).toEqual({ player: 2, dealer: 2 });
    expect(first.inventory).toEqual({ player: [], dealer: [] });
    expect(shellCounts(first)).toEqual({ live: 1, blank: 2 });
  });

  it("lets a self-fired blank retain the turn", () => {
    const state = createMatch(55);
    state.chamber = ["blank", "live"];
    const next = applyCommand(state, { type: "shoot", actor: "player", target: "player" });
    expect(next.turn).toBe("player");
    expect(next.health.player).toBe(state.health.player);
  });

  it("applies the hand saw for exactly one shot", () => {
    const state = createMatch(99);
    state.chamber = ["live", "blank"];
    state.inventory.player = ["handSaw"];
    const armed = applyCommand(state, { type: "item", actor: "player", item: "handSaw" });
    const fired = applyCommand(armed, { type: "shoot", actor: "player", target: "dealer" });
    expect(fired.health.dealer).toBe(0);
    expect(fired.damageBoost.player).toBe(false);
  });

  it("ejects and identifies the current shell with beer without spending the turn", () => {
    const state = createMatch(18);
    state.chamber = ["live", "blank"];
    state.inventory.player = ["beer"];
    const next = applyCommand(state, { type: "item", actor: "player", item: "beer" });
    expect(next.chamber).toEqual(["blank"]);
    expect(next.turn).toBe("player");
    expect(next.lastEvent).toMatchObject({ kind: "item", ejected: "live" });
  });

  it("uses handcuffs to skip the rival's next turn", () => {
    const state = createMatch(22);
    state.chamber = ["live", "blank"];
    state.inventory.player = ["handcuffs"];
    const cuffed = applyCommand(state, { type: "item", actor: "player", item: "handcuffs" });
    const fired = applyCommand(cuffed, { type: "shoot", actor: "player", target: "dealer" });
    expect(fired.turn).toBe("player");
    expect(fired.restrained.dealer).toBe(false);
  });

  it("reveals the current shell with the magnifying glass", () => {
    const state = createMatch(31);
    state.chamber = ["live", "blank"];
    state.inventory.player = ["magnifier"];
    const next = applyCommand(state, { type: "item", actor: "player", item: "magnifier" });
    expect(next.knownShell.player).toBe("live");
    expect(next.lastEvent).toMatchObject({ kind: "item", revealed: "live" });
  });

  it("restores one charge with cigarettes without exceeding maximum health", () => {
    const state = createMatch(42, "multiplayer");
    state.health.player = 1;
    state.inventory.player = ["cigarettes", "cigarettes"];
    const healed = applyCommand(state, { type: "item", actor: "player", item: "cigarettes" });
    const capped = applyCommand({ ...healed, health: { ...healed.health, player: healed.maxHealth } }, { type: "item", actor: "player", item: "cigarettes" });
    expect(healed.health.player).toBe(2);
    expect(capped.health.player).toBe(capped.maxHealth);
  });

  it("inverts only the current shell", () => {
    const state = createMatch(8, "multiplayer");
    state.chamber = ["blank", "live"];
    state.inventory.player = ["inverter"];
    const next = applyCommand(state, { type: "item", actor: "player", item: "inverter" });
    expect(next.chamber).toEqual(["live", "live"]);
  });

  it("uses adrenaline to steal and immediately activate the selected item", () => {
    const state = createMatch(11, "multiplayer");
    state.chamber = ["blank", "live"];
    state.inventory.player = ["adrenaline"];
    state.inventory.dealer = ["inverter"];
    const next = applyCommand(state, { type: "item", actor: "player", item: "adrenaline", stolenItem: "inverter" });
    expect(next.chamber[0]).toBe("live");
    expect(next.inventory.player).toEqual([]);
    expect(next.inventory.dealer).toEqual([]);
  });

  it("records a future shell revealed by the burner phone", () => {
    const state = createMatch(61, "multiplayer");
    state.chamber = ["blank", "live", "blank"];
    state.inventory.player = ["burnerPhone"];
    const next = applyCommand(state, { type: "item", actor: "player", item: "burnerPhone" });
    expect(next.futureKnowledge.player).toHaveLength(1);
    const insight = next.futureKnowledge.player[0];
    expect(insight.offset).toBeGreaterThanOrEqual(1);
    expect(insight.shell).toBe(next.chamber[insight.offset]);
  });

  it("applies both deterministic outcomes of expired medicine", () => {
    const healthy = createMatch(71, "multiplayer");
    healthy.health.player = 1;
    healthy.rngState = 1;
    healthy.inventory.player = ["expiredMedicine"];
    const restored = applyCommand(healthy, { type: "item", actor: "player", item: "expiredMedicine" });

    const sick = createMatch(72, "multiplayer");
    sick.health.player = 2;
    sick.rngState = 123456789;
    sick.inventory.player = ["expiredMedicine"];
    const harmed = applyCommand(sick, { type: "item", actor: "player", item: "expiredMedicine" });

    expect(restored.health.player).toBe(3);
    expect(harmed.health.player).toBe(1);
  });

  it("uses the jammer to restrain the other multiplayer seat", () => {
    const state = createMatch(81, "multiplayer");
    state.inventory.player = ["jammer"];
    const next = applyCommand(state, { type: "item", actor: "player", item: "jammer" });
    expect(next.restrained.dealer).toBe(true);
  });

  it("reverses multiplayer table direction with the remote", () => {
    const state = createMatch(91, "multiplayer");
    state.inventory.player = ["remote"];
    const next = applyCommand(state, { type: "item", actor: "player", item: "remote" });
    expect(next.turnDirection).toBe(-1);
  });

  it("moves Story Mode to four charges and two items per load in stage two", () => {
    const state = createMatch(7);
    state.status = "round-over";
    state.winner = "player";
    const next = applyCommand(state, { type: "next-round" });
    expect(next.round).toBe(2);
    expect(next.health).toEqual({ player: 4, dealer: 4 });
    expect(next.inventory.player).toHaveLength(2);
    expect(shellCounts(next)).toEqual({ live: 1, blank: 1 });
  });

  it("rejects commands from the wrong actor", () => {
    const state = createMatch(7);
    expect(() => applyCommand(state, { type: "shoot", actor: "dealer", target: "player" })).toThrow();
  });
});
