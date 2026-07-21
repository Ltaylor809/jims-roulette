import type { Actor, GameCommand } from "../simulation/types";

export interface RoomStart {
  code: string;
  seed: number;
  role: Actor;
}

type ServerMessage =
  | { type: "room"; code: string; role: Actor }
  | { type: "start"; code: string; seed: number; role: Actor }
  | { type: "command"; command: GameCommand }
  | { type: "peer-left" }
  | { type: "error"; message: string };

export class RoomClient {
  private socket: WebSocket | null = null;
  private firebase: import("./FirebaseRoomTransport").FirebaseRoomTransport | null = null;
  private transport: "socket" | "firebase" | null = null;
  onStatus: (message: string) => void = () => undefined;
  onStart: (start: RoomStart) => void = () => undefined;
  onCommand: (command: GameCommand) => void = () => undefined;

  connect(): Promise<void> {
    if (this.transport === "firebase") return Promise.resolve();
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    const hostedOnFirebase = location.hostname.endsWith(".web.app") || location.hostname.endsWith(".firebaseapp.com");
    const forceFirebase = import.meta.env.VITE_ROOM_TRANSPORT === "firebase";
    if (hostedOnFirebase || forceFirebase) return this.connectFirebase();
    return this.connectSocket().catch(() => this.connectFirebase());
  }

  private connectSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/ws`);
      this.socket = socket;
      const timeout = window.setTimeout(() => {
        socket.close();
        reject(new Error("Could not reach the table server"));
      }, 1400);
      socket.addEventListener("open", () => {
        window.clearTimeout(timeout);
        this.transport = "socket";
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        window.clearTimeout(timeout);
        reject(new Error("Could not reach the table server"));
      }, { once: true });
      socket.addEventListener("message", (event) => this.receive(JSON.parse(String(event.data)) as ServerMessage));
      socket.addEventListener("close", () => this.onStatus("The wire went dead."));
    });
  }

  async create(): Promise<void> {
    await this.connect();
    if (this.transport === "firebase") await this.firebase?.create();
    else this.send({ type: "create" });
  }

  async join(code: string): Promise<void> {
    await this.connect();
    if (this.transport === "firebase") await this.firebase?.join(code);
    else this.send({ type: "join", code: code.toUpperCase() });
  }

  command(command: GameCommand): void {
    if (this.transport === "firebase") this.firebase?.command(command);
    else this.send({ type: "command", command });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    this.firebase?.close();
    this.firebase = null;
    this.transport = null;
  }

  private async connectFirebase(): Promise<void> {
    if (!this.firebase) {
      const { FirebaseRoomTransport } = await import("./FirebaseRoomTransport");
      this.firebase = new FirebaseRoomTransport({
        status: (message) => this.onStatus(message),
        start: (start) => this.onStart(start),
        command: (command) => this.onCommand(command),
      });
    }
    await this.firebase.connect();
    this.transport = "firebase";
    this.onStatus("Firebase is listening for a private table.");
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  private receive(message: ServerMessage): void {
    if (message.type === "room") this.onStatus(`Room ${message.code} is open. Waiting for the second player…`);
    if (message.type === "start") this.onStart(message);
    if (message.type === "command") this.onCommand(message.command);
    if (message.type === "peer-left") this.onStatus("The other chair is empty. The room has closed.");
    if (message.type === "error") this.onStatus(message.message);
  }
}
