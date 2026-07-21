import {
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { ensureAnonymousPlayer, firestore } from "../../firebase";
import type { Actor, GameCommand } from "../simulation/types";
import type { RoomStart } from "./RoomClient";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";

interface RoomDocument extends DocumentData {
  seed: number;
  hostUid: string;
  guestUid: string | null;
  status: "waiting" | "active";
  commandSeq: number;
  command?: GameCommand;
  commandActorUid?: string;
}

export interface FirebaseRoomCallbacks {
  status: (message: string) => void;
  start: (start: RoomStart) => void;
  command: (command: GameCommand) => void;
}

export class FirebaseRoomTransport {
  private uid = "";
  private code = "";
  private role: Actor = "player";
  private stopListening: Unsubscribe | null = null;
  private lastCommandSeq = 0;
  private receivedInitialSnapshot = false;
  private started = false;

  constructor(private readonly callbacks: FirebaseRoomCallbacks) {}

  async connect(): Promise<void> {
    this.uid = await ensureAnonymousPlayer();
  }

  async create(): Promise<void> {
    await this.connect();
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
      const room = doc(firestore, "rooms", code);
      if ((await getDoc(room)).exists()) continue;
      const seed = Math.floor(Math.random() * 2 ** 31);
      await setDoc(room, {
        seed,
        hostUid: this.uid,
        guestUid: null,
        status: "waiting",
        commandSeq: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      this.listen(code, "player");
      this.callbacks.status(`Room ${code} is open. Waiting for the second player…`);
      return;
    }
    throw new Error("Could not reserve a room code. Try again.");
  }

  async join(code: string): Promise<void> {
    await this.connect();
    const normalized = code.toUpperCase();
    const room = doc(firestore, "rooms", normalized);
    const initial = await getDoc(room);
    const data = initial.data() as RoomDocument | undefined;
    if (!data || data.status !== "waiting" || data.guestUid) throw new Error("That room does not exist or is already full.");

    this.listen(normalized, "dealer");
    try {
      await runTransaction(firestore, async (transaction) => {
        const snapshot = await transaction.get(room);
        const current = snapshot.data() as RoomDocument | undefined;
        if (!current || current.status !== "waiting" || current.guestUid) throw new Error("That room does not exist or is already full.");
        transaction.update(room, { guestUid: this.uid, status: "active", updatedAt: serverTimestamp() });
      });
    } catch (error) {
      this.stopListening?.();
      this.stopListening = null;
      throw error;
    }
  }

  command(command: GameCommand): void {
    if (!this.code) return;
    const payload = JSON.parse(JSON.stringify(command)) as GameCommand;
    void updateDoc(doc(firestore, "rooms", this.code), {
      command: payload,
      commandActorUid: this.uid,
      commandSeq: increment(1),
      updatedAt: serverTimestamp(),
    }).catch(() => this.callbacks.status("The table rejected that move. Reconnect the room."));
  }

  close(): void {
    this.stopListening?.();
    this.stopListening = null;
    if (this.code && this.role === "player") void deleteDoc(doc(firestore, "rooms", this.code)).catch(() => undefined);
    this.code = "";
    this.started = false;
  }

  private listen(code: string, role: Actor): void {
    this.stopListening?.();
    this.code = code;
    this.role = role;
    this.started = false;
    this.receivedInitialSnapshot = false;
    this.stopListening = onSnapshot(doc(firestore, "rooms", code), (snapshot) => {
      if (!snapshot.exists()) {
        if (this.receivedInitialSnapshot) this.callbacks.status("The other chair is empty. The room has closed.");
        return;
      }
      const data = snapshot.data() as RoomDocument;
      if (!this.receivedInitialSnapshot) {
        this.lastCommandSeq = data.commandSeq ?? 0;
        this.receivedInitialSnapshot = true;
      } else if ((data.commandSeq ?? 0) > this.lastCommandSeq) {
        this.lastCommandSeq = data.commandSeq;
        if (data.command && data.commandActorUid !== this.uid) this.callbacks.command(data.command);
      }
      if (!this.started && data.status === "active" && data.guestUid) {
        this.started = true;
        this.callbacks.start({ code, seed: data.seed, role });
      }
    }, () => this.callbacks.status("Firebase disconnected from the table."));
  }
}
