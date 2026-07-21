import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.PORT || 3000);
const rooms = new Map();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".hdr": "application/octet-stream",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function makeCode() {
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  const pathname = decodeURIComponent((request.url || "/").split("?")[0]);
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  let file = join(root, safePath);
  if (!existsSync(file) || !statSync(file).isFile()) file = join(root, "index.html");
  if (!existsSync(file)) {
    response.writeHead(503, { "content-type": "text/plain" });
    response.end("Build Jims Roulette with `npm run build` first.");
    return;
  }
  response.writeHead(200, {
    "content-type": mime[extname(file)] || "application/octet-stream",
    "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
  });
  createReadStream(file).pipe(response);
});

const sockets = new WebSocketServer({ server, path: "/ws" });

sockets.on("connection", (socket) => {
  socket.roomCode = null;
  socket.role = null;

  socket.on("message", (raw) => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }

    if (message.type === "create") {
      const code = makeCode();
      const room = { code, seed: Math.floor(Math.random() * 2 ** 31), players: [socket] };
      rooms.set(code, room);
      socket.roomCode = code;
      socket.role = "player";
      send(socket, { type: "room", code, role: "player" });
      return;
    }

    if (message.type === "join") {
      const code = String(message.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room || room.players.length !== 1) {
        send(socket, { type: "error", message: "That room does not exist or is already full." });
        return;
      }
      room.players.push(socket);
      socket.roomCode = code;
      socket.role = "dealer";
      send(room.players[0], { type: "start", code, seed: room.seed, role: "player" });
      send(socket, { type: "start", code, seed: room.seed, role: "dealer" });
      return;
    }

    if (message.type === "command" && socket.roomCode) {
      const room = rooms.get(socket.roomCode);
      const command = message.command;
      if (!room || !command) return;
      if (command.type !== "next-round" && command.actor !== socket.role) return;
      for (const peer of room.players) if (peer !== socket) send(peer, { type: "command", command });
    }
  });

  socket.on("close", () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    for (const peer of room.players) if (peer !== socket) send(peer, { type: "peer-left" });
    rooms.delete(room.code);
  });
});

server.listen(port, "0.0.0.0", () => console.log(`Jims Roulette listening on ${port}`));
