import { chooseAdrenalineTarget, chooseDealerItem, chooseDealerTarget } from "../simulation/dealer-ai";
import { applyCommand, createMatch } from "../simulation/rules";
import type { Actor, GameCommand, GameEvent, GameState, ItemId } from "../simulation/types";

type StateListener = (state: GameState, locked: boolean) => void;
type EventListener = (event: GameEvent, state: GameState) => void | Promise<void>;

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export class SoloController {
  state: GameState;
  readonly localActor: Actor = "player";
  private locked = false;
  private stateListeners = new Set<StateListener>();
  private eventListeners = new Set<EventListener>();

  constructor(seed = Date.now()) {
    this.state = createMatch(seed, "solo");
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state, this.locked);
    return () => this.stateListeners.delete(listener);
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async shoot(target: Actor): Promise<void> {
    if (this.locked || this.state.status !== "playing" || this.state.turn !== "player") return;
    this.locked = true;
    this.publish();
    await this.commit({ type: "shoot", actor: "player", target });
    await this.finishPlayerAction();
  }

  async useItem(item: ItemId, stolenItem?: ItemId): Promise<void> {
    if (this.locked || this.state.status !== "playing" || this.state.turn !== "player") return;
    this.locked = true;
    this.publish();
    try {
      await this.commit({ type: "item", actor: "player", item, stolenItem });
    } catch {
      // The UI normally prevents invalid item use; stale clicks are harmless.
    }
    this.locked = false;
    this.publish();
  }

  async nextRound(): Promise<void> {
    if (this.locked || this.state.status !== "round-over") return;
    this.locked = true;
    await this.commit({ type: "next-round" });
    await this.finishPlayerAction();
  }

  private async finishPlayerAction(): Promise<void> {
    if (this.state.status === "playing" && this.state.turn === "dealer") {
      await wait(1150);
      await this.runDealer();
    }
    this.locked = false;
    this.publish();
  }

  private async runDealer(): Promise<void> {
    while (this.state.status === "playing" && this.state.turn === "dealer") {
      let itemsUsed = 0;
      let item = chooseDealerItem(this.state, itemsUsed);
      while (item && itemsUsed < 8) {
        const stolenItem = item === "adrenaline" ? chooseAdrenalineTarget(this.state) : undefined;
        await this.commit({ type: "item", actor: "dealer", item, stolenItem });
        itemsUsed += 1;
        await wait(980);
        item = chooseDealerItem(this.state, itemsUsed);
      }

      const target = chooseDealerTarget(this.state);
      await wait(1180);
      await this.commit({ type: "shoot", actor: "dealer", target });
      if (this.state.status === "playing" && this.state.turn === "dealer") await wait(1100);
    }
  }

  private async commit(command: GameCommand): Promise<void> {
    this.state = applyCommand(this.state, command);
    this.publish();
    await Promise.allSettled([...this.eventListeners].map((listener) => listener(this.state.lastEvent, this.state)));
  }

  private publish(): void {
    for (const listener of this.stateListeners) listener(this.state, this.locked);
  }
}
