import { ITEMS } from "../game/content/items";
import { canUseItem, shellCounts } from "../game/simulation/rules";
import type { GameController } from "../game/app/OnlineController";
import type { Actor, GameEvent, GameState, ItemId } from "../game/simulation/types";

const roman = ["0", "I", "II", "III", "IV", "V"];
const other = (actor: Actor): Actor => actor === "player" ? "dealer" : "player";

export class GameUI {
  private controller: GameController | null = null;
  private unsubscribe: (() => void) | null = null;
  private currentState: GameState | null = null;
  private displayedHealth: Record<Actor, number> | null = null;
  private committedShotRevision = -1;
  private locked = false;
  private toastTimer = 0;
  private dealerDialogueTimer = 0;
  private dealerTypeTimer = 0;
  private turnTimer = 0;
  private resultTimer = 0;
  private introCaptionTimer = 0;
  private waiverAccept: ((name: string) => void) | null = null;
  private playerName = "YOU";

  readonly menu = this.get<HTMLElement>("menu");
  readonly lobby = this.get<HTMLElement>("lobby");
  readonly infoModal = this.get<HTMLElement>("info-modal");
  readonly resultModal = this.get<HTMLElement>("result-modal");
  readonly gameUi = this.get<HTMLElement>("game-ui");
  readonly introUi = this.get<HTMLElement>("intro-ui");
  readonly waiverScreen = this.get<HTMLElement>("waiver-screen");
  readonly infoContent = this.get<HTMLElement>("info-content");
  readonly lobbyStatus = this.get<HTMLElement>("lobby-status");

  constructor() {
    const waiverInput = this.get<HTMLInputElement>("waiver-name");
    const waiverKeys = this.get<HTMLElement>("waiver-keys");
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const key = document.createElement("button");
      key.type = "button";
      key.textContent = letter;
      key.addEventListener("click", () => {
        if (waiverInput.value.length >= waiverInput.maxLength) return;
        this.setWaiverValue(waiverInput.value + letter);
        this.onWaiverCue("letter");
      });
      waiverKeys.append(key);
    }
    waiverInput.addEventListener("input", () => {
      const previous = waiverInput.value;
      this.setWaiverValue(previous);
      if (waiverInput.value.length > 0) this.onWaiverCue("key");
    });
    this.get<HTMLButtonElement>("waiver-backspace").addEventListener("click", () => {
      this.setWaiverValue(waiverInput.value.slice(0, -1));
      this.onWaiverCue("key");
      waiverInput.focus();
    });
    this.get<HTMLFormElement>("waiver-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const name = waiverInput.value.trim().toUpperCase();
      if (!name) return;
      this.playerName = name;
      this.onWaiverCue("shutdown");
      this.waiverScreen.classList.add("accepted");
      const accept = this.waiverAccept;
      this.waiverAccept = null;
      window.setTimeout(() => accept?.(name), 720);
    });
    this.get<HTMLButtonElement>("interaction-hint").addEventListener("click", () => this.armShotgun());
    this.get<HTMLButtonElement>("shoot-self").addEventListener("click", () => {
      if (this.controller) void this.controller.shoot(this.controller.localActor);
      this.disarmShotgun();
    });
    this.get<HTMLButtonElement>("shoot-opponent").addEventListener("click", () => {
      if (this.controller) void this.controller.shoot(other(this.controller.localActor));
      this.disarmShotgun();
    });
    this.get<HTMLButtonElement>("result-action").addEventListener("click", () => {
      if (!this.controller) return;
      if (this.controller.state.status === "round-over") {
        this.resultModal.hidden = true;
        void this.controller.nextRound();
      } else {
        this.onLeaveTable();
      }
    });
    this.get<HTMLButtonElement>("return-menu").addEventListener("click", () => this.onLeaveTable());
  }

  onLeaveTable: () => void = () => undefined;
  onWaiverCue: (cue: "boot" | "key" | "letter" | "shutdown") => void = () => undefined;
  onDealerLine: () => void = () => undefined;

  attach(controller: GameController): void {
    this.unsubscribe?.();
    this.controller = controller;
    this.displayedHealth = null;
    this.committedShotRevision = -1;
    this.unsubscribe = controller.onState((state, locked) => this.render(state, locked));
  }

  commitShotHealth(event: Extract<GameEvent, { kind: "shot" }>): void {
    if (event.shell !== "live" || !this.currentState || !this.controller) return;
    this.committedShotRevision = this.currentState.revision;
    this.displayedHealth = { ...this.currentState.health };
    this.paintHealth(this.currentState, this.controller.localActor);
  }

  showGame(): void {
    this.menu.classList.add("dismissed");
    this.lobby.hidden = true;
    this.infoModal.hidden = true;
    this.gameUi.hidden = false;
    this.introUi.hidden = true;
    this.waiverScreen.hidden = true;
    this.resultModal.hidden = true;
    window.clearTimeout(this.resultTimer);
    this.resultTimer = 0;
    this.setBlackout(false);
    this.disarmShotgun();
  }

  showMenu(): void {
    this.gameUi.hidden = true;
    this.resultModal.hidden = true;
    this.infoModal.hidden = true;
    this.lobby.hidden = true;
    this.introUi.hidden = true;
    this.waiverScreen.hidden = true;
    this.get("item-select").hidden = true;
    window.clearTimeout(this.resultTimer);
    this.resultTimer = 0;
    this.setBlackout(false);
    this.menu.classList.remove("dismissed");
  }

  showIntro(): void {
    this.menu.classList.add("dismissed");
    this.lobby.hidden = true;
    this.infoModal.hidden = true;
    this.resultModal.hidden = true;
    this.gameUi.hidden = true;
    this.introUi.hidden = false;
    this.waiverScreen.hidden = true;
    this.setBlackout(false);
  }

  showWaiver(onAccept: (name: string) => void): void {
    this.showIntro();
    this.waiverAccept = onAccept;
    const input = this.get<HTMLInputElement>("waiver-name");
    this.setWaiverValue("");
    this.waiverScreen.classList.remove("accepted");
    this.waiverScreen.hidden = false;
    this.onWaiverCue("boot");
    window.setTimeout(() => input.focus(), 350);
  }

  showIntroCaption(message: string, duration = 1800): void {
    const caption = this.get("intro-caption");
    caption.textContent = message;
    caption.classList.add("show");
    window.clearTimeout(this.introCaptionTimer);
    this.introCaptionTimer = window.setTimeout(() => caption.classList.remove("show"), duration);
  }

  hideWaiver(): void {
    this.waiverScreen.hidden = true;
  }

  setPlayerName(name: string): void {
    this.playerName = name.toUpperCase().slice(0, 8) || "YOU";
  }

  showRules(): void {
    this.infoContent.innerHTML = `
      <p class="eyebrow">HOUSE RULES</p>
      <h2>YOU KNOW THE DRILL.</h2>
      <p>The live and blank counts are shown before every load, then the shells are hidden and shuffled. Choose the shotgun, then choose yourself or the Dealer.</p>
      <h3>THE EDGE</h3>
      <ul>
        <li>A blank fired at yourself keeps the turn.</li>
        <li>A live shell—or any shot across the table—passes the turn.</li>
        <li>Story Mode has three increasingly dangerous rounds; the expanded equipment set unlocks after Round I.</li>
        <li>Items do not spend your shot. Select their physical model on the table.</li>
      </ul>
      <h3>TABLE EQUIPMENT</h3>
      <ul>${Object.values(ITEMS).map((item) => `<li><strong>${item.name}</strong> — ${item.short}.</li>`).join("")}</ul>
    `;
    this.infoModal.hidden = false;
  }

  async showCredits(): Promise<void> {
    let ledger = "Asset ledger could not be loaded.";
    try { ledger = await fetch("/assets/ATTRIBUTIONS.md").then((response) => response.text()); } catch { /* Keep fallback. */ }
    this.infoContent.innerHTML = `
      <p class="eyebrow">CREDITS & LICENSES</p>
      <h2>THE PIECES ON THE TABLE.</h2>
      <p>Jims Roulette uses original browser-game code and presentation. Openly licensed assets are recorded below, and owner-supplied assets are used with the project owner's public-distribution permission.</p>
      <pre>${this.escape(ledger)}</pre>
    `;
    this.infoModal.hidden = false;
  }

  showLobby(): void { this.lobby.hidden = false; }

  armShotgun(): void {
    if (!this.controller || !this.currentState || this.locked) return;
    if (this.currentState.status !== "playing" || this.currentState.turn !== this.controller.localActor) return;
    this.gameUi.classList.add("shotgun-armed");
    this.get("interaction-hint").textContent = "CHOOSE A TARGET";
  }

  describeInteraction(interaction: string | null): void {
    const card = this.get("hover-card");
    if (!interaction) {
      card.classList.remove("show");
      return;
    }
    if (interaction === "shotgun") {
      this.get("hover-title").textContent = "SHOTGUN";
      this.get("hover-copy").textContent = "SHOOTING YOURSELF WITH A BLANK SKIPS THE DEALER'S TURN.";
    } else if (interaction.startsWith("item:")) {
      const item = ITEMS[interaction.slice(5) as ItemId];
      if (!item) return;
      this.get("hover-title").textContent = item.name.toUpperCase();
      this.get("hover-copy").textContent = `${item.short.toUpperCase()}.`;
    } else return;
    card.classList.add("show");
  }

  showShellLoad(live: number, blank: number, visible: boolean): void {
    const strip = this.get("shell-reveal");
    strip.textContent = `${live} LIVE ROUND${live === 1 ? "" : "S"}. ${blank} BLANK${blank === 1 ? "" : "S"}.`;
    strip.classList.toggle("show", visible);
    if (visible) this.disarmShotgun();
  }

  setBlackout(active: boolean): void {
    const blackout = this.get("impact-blackout");
    if (active) {
      blackout.classList.remove("instant");
      void blackout.offsetWidth;
      blackout.classList.add("instant");
    } else {
      blackout.classList.remove("instant");
    }
  }

  activateItem(item: ItemId): void {
    if (!this.controller || !this.currentState || this.locked) return;
    const me = this.controller.localActor;
    if (!canUseItem(this.currentState, me, item)) return;
    if (item !== "adrenaline") {
      void this.controller.useItem(item);
      return;
    }
    const choices = [...new Set(this.currentState.inventory[other(me)].filter((held) => held !== "adrenaline"))];
    const picker = this.get("item-select");
    picker.innerHTML = `<p>ADRENALINE</p><strong>STEAL WHICH ITEM?</strong><div>${choices.map((choice) => `<button data-steal="${choice}">${ITEMS[choice].name}</button>`).join("")}</div><button data-cancel>CANCEL</button>`;
    picker.hidden = false;
    picker.querySelectorAll<HTMLButtonElement>("[data-steal]").forEach((button) => button.addEventListener("click", () => {
      picker.hidden = true;
      void this.controller?.useItem("adrenaline", button.dataset.steal as ItemId);
    }));
    picker.querySelector<HTMLButtonElement>("[data-cancel]")?.addEventListener("click", () => { picker.hidden = true; });
  }

  notify(event: GameEvent): void {
    const toast = this.get<HTMLElement>("event-toast");
    const toastLabel = this.get<HTMLElement>("event-toast-label");
    const toastCopy = this.get<HTMLElement>("event-toast-copy");
    let message = event.message;
    if (event.kind === "shot" && event.shell === "live" && this.currentState?.mode === "multiplayer" && this.controller) {
      const label = event.target === this.controller.localActor ? "YOU" : "OTHER PLAYER";
      message = `${label} ${label === "YOU" ? "TAKE" : "TAKES"} ${event.damage} DAMAGE.`;
    }
    const label = event.kind === "shot"
      ? event.shell === "live" ? "IMPACT" : "CHAMBER"
      : event.kind === "item" ? ITEMS[event.item].name
        : "TABLE";
    toastLabel.textContent = label.toUpperCase();
    toastCopy.textContent = message.toUpperCase();
    toast.dataset.kind = event.kind;
    toast.classList.remove("show");
    void toast.offsetWidth;
    toast.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove("show"), event.kind === "shot" ? 2850 : 2500);
    const dealerLine = this.dealerLineFor(event);
    if (dealerLine) this.showDealerLine(dealerLine);
    if (event.kind === "shot") this.disarmShotgun();
    if (event.kind === "shot" && event.shell === "live") {
      document.body.classList.remove("damage-flash");
      void document.body.offsetWidth;
      document.body.classList.add("damage-flash");
    }
  }

  greetDealer(): void {
    if (this.currentState?.mode !== "solo") return;
    window.setTimeout(() => this.showDealerLine(`WELCOME, ${this.playerName}. LET'S BEGIN.`), 950);
  }

  private showDealerLine(message: string): void {
    const dialogue = this.get<HTMLElement>("dealer-dialogue");
    const copy = this.get<HTMLElement>("dealer-dialogue-copy");
    window.clearTimeout(this.dealerDialogueTimer);
    window.clearInterval(this.dealerTypeTimer);
    copy.textContent = "";
    dialogue.classList.remove("show");
    void dialogue.offsetWidth;
    dialogue.classList.add("show");
    this.onDealerLine();
    let index = 0;
    this.dealerTypeTimer = window.setInterval(() => {
      index += 1;
      copy.textContent = message.slice(0, index);
      if (index >= message.length) window.clearInterval(this.dealerTypeTimer);
    }, 24);
    this.dealerDialogueTimer = window.setTimeout(() => dialogue.classList.remove("show"), Math.max(3000, message.length * 24 + 1650));
  }

  private dealerLineFor(event: GameEvent): string | null {
    if (this.currentState?.mode !== "solo") return null;
    if (event.kind === "round") return event.message.includes("FINAL") ? "NO MORE DEFIBRILLATORS AFTER THIS." : "THE STAKES HAVE CHANGED.";
    if (event.kind === "shot") {
      if (event.shell === "blank" && event.actor === "player" && event.target === "player") return "AGAIN.";
      if (event.shell === "blank" && event.actor === "player") return "MY TURN.";
      if (event.shell === "blank" && event.actor === "dealer") return "HOW UNFORTUNATE.";
      if (event.target === "dealer") return event.damage > 1 ? "YOU CAME PREPARED." : "GOOD.";
      return event.damage > 1 ? "THAT ONE WILL STAY WITH YOU." : "STILL WITH ME?";
    }
    if (event.kind !== "item") return null;
    if (event.actor === "dealer") {
      const lines: Partial<Record<ItemId, string>> = {
        magnifier: "LET'S HAVE A LOOK.", cigarettes: "DON'T MIND ME.", handSaw: "THIS SHOULD HURT.",
        handcuffs: "STAY WHERE YOU ARE.", beer: "NOT THAT ONE.", burnerPhone: "YES. I UNDERSTAND.",
        inverter: "A SMALL CHANGE.", adrenaline: "I'LL BORROW THAT.", expiredMedicine: "WORTH THE RISK.",
        jammer: "QUIET.", remote: "WE GO THE OTHER WAY.",
      };
      return lines[event.item] ?? "MY MOVE.";
    }
    const lines: Partial<Record<ItemId, string>> = {
      magnifier: "LOOKING WON'T CHANGE WHAT'S IN THERE.", cigarettes: "TAKE YOUR TIME.",
      handSaw: "NOW YOU'RE SERIOUS.", handcuffs: "YOU BOUGHT YOURSELF A MOMENT.", beer: "ONE LESS UNKNOWN.",
      burnerPhone: "WHO DO YOU THINK ANSWERS?", inverter: "ARE YOU CERTAIN?", adrenaline: "GREEDY.",
      expiredMedicine: "TRUST THE LABEL IF YOU LIKE.", jammer: "I CAN STILL SEE YOU.", remote: "INTERESTING.",
    };
    return lines[event.item] ?? null;
  }

  private render(state: GameState, locked: boolean): void {
    if (!this.controller) return;
    this.currentState = state;
    this.locked = locked;
    const me = this.controller.localActor;
    const rival = other(me);
    const counts = shellCounts(state);
    const myTurn = state.status === "playing" && state.turn === me;

    this.get("mode-label").textContent = state.mode === "solo" ? "STORY MODE" : "PRIVATE TABLE";
    this.get("round-label").textContent = `ROUND ${roman[state.round] ?? state.round}`;
    this.get("score-label").textContent = state.mode === "solo" ? `${state.maxHealth} CHARGES` : `${state.roundWins[me]} — ${state.roundWins[rival]}`;
    this.get("player-name").textContent = this.playerName;
    this.get("opponent-name").textContent = state.mode === "solo" ? "THE DEALER" : "OTHER PLAYER";
    const deferLiveDamage = state.lastEvent.kind === "shot"
      && state.lastEvent.shell === "live"
      && state.lastEvent.damage > 0
      && state.revision !== this.committedShotRevision;
    if (!this.displayedHealth || !deferLiveDamage) this.displayedHealth = { ...state.health };
    this.paintHealth(state, me);
    this.get("live-count").textContent = String(counts.live);
    this.get("blank-count").textContent = String(counts.blank);
    this.get("shoot-opponent").querySelector("strong")!.textContent = state.mode === "solo" ? "THE DEALER" : "OTHER PLAYER";

    const shootDisabled = locked || !myTurn;
    this.get<HTMLButtonElement>("shoot-self").disabled = shootDisabled;
    this.get<HTMLButtonElement>("shoot-opponent").disabled = shootDisabled;
    this.get<HTMLButtonElement>("interaction-hint").disabled = shootDisabled;
    this.get("interaction-hint").textContent = myTurn ? "CLICK THE SHOTGUN" : state.mode === "solo" ? "THE DEALER'S TURN" : "WAITING FOR THE OTHER PLAYER";
    if (!myTurn || locked) this.disarmShotgun();
    this.renderInventory(state, me, shootDisabled);

    if (state.status === "playing") {
      window.clearTimeout(this.resultTimer);
      this.resultTimer = 0;
      this.showTurn(myTurn ? "YOUR TURN" : state.mode === "solo" ? "DEALER" : "OTHER PLAYER");
    } else if (this.resultModal.hidden && this.resultTimer === 0) {
      const delay = state.lastEvent.kind === "shot" ? 7900 : state.lastEvent.kind === "item" ? 3900 : 950;
      const revision = state.revision;
      this.resultTimer = window.setTimeout(() => {
        this.resultTimer = 0;
        if (this.currentState?.revision === revision && this.currentState.status !== "playing") this.showResult(this.currentState, me);
      }, delay);
    }
  }

  private renderInventory(state: GameState, actor: Actor, locked: boolean): void {
    const inventory = this.get("inventory");
    inventory.innerHTML = "";
    state.inventory[actor].forEach((item, index) => {
      const definition = ITEMS[item];
      const button = document.createElement("button");
      button.disabled = locked || !canUseItem(state, actor, item);
      button.textContent = `${definition.name}: ${definition.short}`;
      button.setAttribute("aria-label", `Use ${definition.name}, inventory slot ${index + 1}`);
      button.addEventListener("click", () => this.activateItem(item));
      inventory.append(button);
    });
  }

  private renderCharges(id: string, health: number, max: number): void {
    this.get(id).textContent = `${health} of ${max} charges`;
  }

  private paintHealth(state: GameState, me: Actor): void {
    const rival = other(me);
    const health = this.displayedHealth ?? state.health;
    this.get("player-health-text").textContent = `${health[me]} / ${state.maxHealth}`;
    this.get("opponent-health-text").textContent = `${health[rival]} / ${state.maxHealth}`;
    this.renderCharges("player-health", health[me], state.maxHealth);
    this.renderCharges("opponent-health", health[rival], state.maxHealth);
    document.body.classList.toggle("low-health", health[me] <= 1 && state.status === "playing");
  }

  private setWaiverValue(value: string): void {
    const sanitized = value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8);
    const input = this.get<HTMLInputElement>("waiver-name");
    input.value = sanitized;
    this.get("waiver-paper-name").textContent = sanitized.padEnd(8, "·");
    this.get<HTMLButtonElement>("waiver-submit").disabled = sanitized.length === 0;
  }

  private disarmShotgun(): void {
    this.gameUi.classList.remove("shotgun-armed");
  }

  private showTurn(message: string): void {
    const banner = this.get("turn-banner");
    if (banner.textContent === message && banner.classList.contains("show")) return;
    banner.textContent = message;
    banner.classList.add("show");
    window.clearTimeout(this.turnTimer);
    this.turnTimer = window.setTimeout(() => banner.classList.remove("show"), 1650);
  }

  private showResult(state: GameState, me: Actor): void {
    const won = state.winner === me;
    const match = state.status === "match-over";
    this.get("result-kicker").textContent = match ? "THE CONTRACT IS CLOSED" : `ROUND ${roman[state.round] ?? state.round} COMPLETE`;
    this.get("result-title").textContent = won ? (match ? "YOU SURVIVED" : "YOU MADE IT") : (match ? "THE HOUSE WINS" : "YOU WAKE UP");
    this.get("result-copy").textContent = match
      ? won ? "The other side of the table goes quiet." : "The room keeps what it was promised."
      : won ? "The next round is waiting behind the door." : "The defibrillator brings you back. The next round is already loaded.";
    this.get("result-action").textContent = match ? "RETURN TO MENU" : "NEXT ROUND";
    this.resultModal.hidden = false;
  }

  private get<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing UI element #${id}`);
    return element as T;
  }

  private escape(value: string): string {
    const element = document.createElement("div");
    element.textContent = value;
    return element.innerHTML;
  }
}
