import "./styles.css";
import { AudioDirector } from "./audio/AudioDirector";
import { OnlineController, type GameController } from "./game/app/OnlineController";
import { SoloController } from "./game/app/SoloController";
import { RoomClient } from "./game/network/RoomClient";
import { ThreeGame } from "./render/ThreeGame";
import { GameUI } from "./ui/GameUI";

const requireElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

const canvas = requireElement<HTMLCanvasElement>("game-canvas");
const cursorRoot = document.documentElement;
const loading = requireElement<HTMLElement>("loading-screen");
const loadingProgress = requireElement<HTMLElement>("loading-progress");
const loadingStatus = requireElement<HTMLElement>("loading-status");
const ui = new GameUI();
const audio = new AudioDirector();
const game = new ThreeGame(canvas);
const room = new RoomClient();
let controller: GameController | null = null;
let entryInProgress = false;

function describeRoomError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/CONFIGURATION_NOT_FOUND|configuration-not-found/i.test(message)) {
    return "Firebase Anonymous Auth is not enabled for this project yet.";
  }
  if (/permission-denied|insufficient permissions/i.test(message)) {
    return "Firebase rejected the room. Publish the included Firestore rules, then try again.";
  }
  if (/does not exist|already full|reserve a room code/i.test(message)) return message;
  return fallback;
}

function bindController(next: GameController): void {
  controller = next;
  ui.attach(next);
  next.onState((state) => {
    game.sync(state, next.localActor);
    audio.setDanger(state.health[next.localActor]);
  });
  next.onEvent(async (event) => {
    if (event.kind !== "shot") {
      ui.notify(event);
      audio.react(event);
    }
    await game.react(event, next.localActor);
  });
  ui.showGame();
  game.setMenuView(false);
}

async function startSolo(): Promise<void> {
  if (entryInProgress) return;
  entryInProgress = true;
  audio.start();
  ui.showIntro();
  await game.showRestroom();
  ui.showIntroCaption("THE PAPERWORK IS WAITING.", 1700);
  await new Promise((resolve) => window.setTimeout(resolve, 850));
  const name = await new Promise<string>((resolve) => ui.showWaiver(resolve));
  ui.hideWaiver();
  ui.setPlayerName(name);
  game.setPlayerName(name);
  ui.showIntroCaption("SIGNATURE ACCEPTED. ENTER THE ROOM.", 2600);
  await game.enterRoom();
  audio.enterTable();
  bindController(new SoloController());
  entryInProgress = false;
}

function leaveTable(): void {
  controller = null;
  room.close();
  ui.showMenu();
  game.setMenuView(true);
}

requireElement("solo-button").addEventListener("click", () => void startSolo());
requireElement("multiplayer-button").addEventListener("click", () => ui.showLobby());
requireElement("rules-button").addEventListener("click", () => ui.showRules());
requireElement("credits-button").addEventListener("click", () => void ui.showCredits());
requireElement("pause-button").addEventListener("click", () => ui.showRules());
requireElement("audio-button").addEventListener("click", (event) => {
  const enabled = audio.toggle();
  const button = event.currentTarget as HTMLButtonElement;
  button.textContent = `AUDIO: ${enabled ? "ON" : "OFF"}`;
  button.setAttribute("aria-pressed", String(!enabled));
});
document.querySelectorAll<HTMLElement>("[data-close-modal]").forEach((button) => button.addEventListener("click", () => {
  ui.lobby.hidden = true;
  ui.infoModal.hidden = true;
}));
document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.addEventListener("pointerenter", () => audio.hover()));
ui.onLeaveTable = leaveTable;
ui.onWaiverCue = (cue) => audio.signature(cue);

requireElement("create-room").addEventListener("click", async () => {
  ui.lobbyStatus.textContent = "Opening a private room…";
  try { await room.create(); } catch (error) {
    ui.lobbyStatus.textContent = describeRoomError(error, "The private table could not be reached.");
  }
});
requireElement("join-room").addEventListener("click", async () => {
  const code = requireElement<HTMLInputElement>("room-code").value.trim();
  if (code.length !== 4) { ui.lobbyStatus.textContent = "Enter the four-letter room code."; return; }
  ui.lobbyStatus.textContent = "Taking the second chair…";
  try { await room.join(code); } catch (error) {
    ui.lobbyStatus.textContent = describeRoomError(error, "The private table could not be reached.");
  }
});
room.onStatus = (message) => { ui.lobbyStatus.textContent = message; };
room.onStart = ({ seed, role }) => {
  audio.start();
  audio.enterTable();
  bindController(new OnlineController(seed, role, room));
};

game.onInteraction = (interaction) => {
  if (!controller) return;
  if (interaction.startsWith("item:")) ui.activateItem(interaction.slice(5) as Parameters<typeof controller.useItem>[0]);
  if (interaction === "shotgun") ui.armShotgun();
};
game.onHover = (interaction) => {
  cursorRoot.classList.toggle("cursor-interactive", Boolean(interaction));
  ui.describeInteraction(interaction);
};
game.onShotFire = (event) => {
  audio.fire(event.shell);
  ui.commitShotHealth(event);
  ui.notify(event);
};
game.onBlackout = (active) => ui.setBlackout(active);
game.onMechanicalCue = (cue) => audio.mechanical(cue);
game.onItemCue = (item, phase) => audio.item(item, phase);
game.onShellReveal = (live, blank, visible) => {
  ui.showShellLoad(live, blank, visible);
  if (visible) audio.revealLoad(live, blank);
};

const releaseCursor = (): void => cursorRoot.classList.remove("cursor-clicking");
window.addEventListener("pointerdown", () => cursorRoot.classList.add("cursor-clicking"), { capture: true });
window.addEventListener("pointerup", releaseCursor, { capture: true });
window.addEventListener("pointercancel", releaseCursor, { capture: true });
window.addEventListener("blur", releaseCursor);

const bootStarted = performance.now();
await game.load((progress, label) => {
  loadingProgress.style.width = `${Math.round(Math.min(progress * 0.88, 0.88) * 100)}%`;
  if (performance.now() - bootStarted > 2150) loadingStatus.textContent = label;
});
const bootRemaining = Math.max(0, 2650 - (performance.now() - bootStarted));
if (bootRemaining > 0) {
  const stages = [
    [0, "POWERING THE TABLE"],
    [820, "SETTING THE 12-GAUGE"],
    [1660, "LAYING OUT THE ITEMS"],
    [2260, "CHECKING THE CHAMBER"],
  ] as const;
  const elapsed = performance.now() - bootStarted;
  for (const [at, label] of stages) {
    if (at <= elapsed) continue;
    await new Promise((resolve) => window.setTimeout(resolve, at - (performance.now() - bootStarted)));
    loadingStatus.textContent = label;
  }
  const finalRemaining = Math.max(0, 2650 - (performance.now() - bootStarted));
  if (finalRemaining > 0) await new Promise((resolve) => window.setTimeout(resolve, finalRemaining));
}
loadingStatus.textContent = "TABLE LINK ESTABLISHED";
loadingProgress.style.width = "100%";
loading.classList.add("ready");
window.setTimeout(() => loading.classList.add("done"), 520);
game.setMenuView(true);
