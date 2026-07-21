import { applyCommand, createMatch } from "../simulation/rules";
import type { Actor, GameCommand, GameEvent, GameState, ItemId } from "../simulation/types";
import type { RoomClient } from "../network/RoomClient";

type StateListener = (state: GameState, locked: boolean) => void;
type EventListener = (event: GameEvent, state: GameState) => void | Promise<void>;

export class OnlineController {
  state: GameState;
  readonly localActor: Actor;
  private locked = false;
  private stateListeners = new Set<StateListener>();
  private eventListeners = new Set<EventListener>();

  constructor(seed: number, role: Actor, private room: RoomClient) {
    this.localActor = role;
    this.state = createMatch(seed, "multiplayer");
    room.onCommand = (command) => void this.receive(command);
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

  shoot(target: Actor): Promise<void> {
    return this.local({ type: "shoot", actor: this.localActor, target });
  }

  useItem(item: ItemId, stolenItem?: ItemId): Promise<void> {
    return this.local({ type: "item", actor: this.localActor, item, stolenItem });
  }

  nextRound(): Promise<void> {
    return this.local({ type: "next-round" });
  }

  private async local(command: GameCommand): Promise<void> {
    if (this.locked) return;
    if (command.type !== "next-round" && this.state.turn !== this.localActor) return;
    this.locked = true;
    try {
      await this.apply(command, true);
    } catch {
      // A stale or invalid network click is ignored.
    }
    this.locked = false;
    this.publish();
  }

  private async receive(command: GameCommand): Promise<void> {
    this.locked = true;
    try { await this.apply(command); } catch { /* Reject invalid remote commands locally. */ }
    this.locked = false;
    this.publish();
  }

  private async apply(command: GameCommand, relay = false): Promise<void> {
    this.state = applyCommand(this.state, command);
    this.publish();
    // Relay immediately after validation/state mutation so both browsers begin
    // the long item/shot animation on the same beat instead of six seconds apart.
    if (relay) this.room.command(command);
    await Promise.allSettled([...this.eventListeners].map((listener) => listener(this.state.lastEvent, this.state)));
  }

  private publish(): void {
    for (const listener of this.stateListeners) listener(this.state, this.locked);
  }
}

export type GameController = OnlineController | import("./SoloController").SoloController;
