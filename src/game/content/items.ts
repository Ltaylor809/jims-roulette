import type { ItemDefinition, ItemId } from "../simulation/types";

export const ITEMS: Record<ItemId, ItemDefinition> = {
  magnifier: {
    id: "magnifier",
    name: "Magnifying Glass",
    short: "Check the current round in the chamber",
    glyph: "◉",
    availability: "story",
  },
  cigarettes: {
    id: "cigarettes",
    name: "Cigarette Pack",
    short: "Regain 1 charge",
    glyph: "╱",
    availability: "story",
  },
  handSaw: {
    id: "handSaw",
    name: "Hand Saw",
    short: "The next shot deals 2 damage",
    glyph: "╪",
    availability: "story",
  },
  handcuffs: {
    id: "handcuffs",
    name: "Handcuffs",
    short: "The Dealer skips the next turn",
    glyph: "∞",
    availability: "story",
  },
  beer: {
    id: "beer",
    name: "Beer",
    short: "Rack the shotgun and eject the current shell",
    glyph: "▥",
    availability: "story",
  },
  burnerPhone: {
    id: "burnerPhone",
    name: "Burner Phone",
    short: "A voice gives insight from the future",
    glyph: "▯",
    availability: "double",
  },
  inverter: {
    id: "inverter",
    name: "Inverter",
    short: "Swap the polarity of the current shell",
    glyph: "⇄",
    availability: "double",
  },
  adrenaline: {
    id: "adrenaline",
    name: "Adrenaline",
    short: "Steal an item and use it immediately",
    glyph: "✚",
    availability: "double",
  },
  expiredMedicine: {
    id: "expiredMedicine",
    name: "Expired Medicine",
    short: "50%: gain 2 charges. Otherwise lose 1",
    glyph: "✣",
    availability: "double",
  },
  jammer: {
    id: "jammer",
    name: "Jammer",
    short: "Selected opponent skips their next turn",
    glyph: "⌁",
    availability: "multiplayer",
  },
  remote: {
    id: "remote",
    name: "Remote",
    short: "Reverse the table's turn order",
    glyph: "↶",
    availability: "multiplayer",
  },
};

export const STORY_ITEM_IDS: ItemId[] = ["magnifier", "cigarettes", "handSaw", "handcuffs", "beer"];
export const DOUBLE_ITEM_IDS: ItemId[] = [...STORY_ITEM_IDS, "burnerPhone", "inverter", "adrenaline", "expiredMedicine"];
export const MULTIPLAYER_ITEM_IDS: ItemId[] = ["magnifier", "cigarettes", "handSaw", "beer", "burnerPhone", "inverter", "adrenaline", "jammer", "remote"];
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
