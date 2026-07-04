/**
 * Real-Time Chat Support Widget — Server
 * -------------------------------------------------
 * Express + Socket.io backend.
 *
 * Responsibilities:
 *  - Accept visitor connections and assign them to a support "room"
 *  - Broadcast messages between visitor <-> support agent within a room
 *  - Relay "typing" / "stop typing" presence events
 *  - Track basic online/offline state and notify the room
 *
 * Run:
 *    cd server
 *    npm install
 *    npm start        # http://localhost:4000
 */

require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
// Shared passcode friends must enter to join. Set this in your deployment's
// environment variables — never commit a real passcode to source control.
const ACCESS_PASSCODE = process.env.ACCESS_PASSCODE || "letmein";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
  // Default is 1MB, which a base64-encoded photo blows past easily.
  maxHttpBufferSize: 6 * 1024 * 1024, // 6MB
});

// In-memory store: { [roomId]: { messages: [], typing: Set<socketId> } }
// Fine for a demo / single-instance deployment. Swap for Redis + a DB for production.
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { messages: [], typingUsers: new Map() });
  }
  return rooms.get(roomId);
}

io.on("connection", (socket) => {
  let currentRoom = null;
  let currentName = "Visitor";

  socket.on("join_room", ({ roomId, name, role, passcode }) => {
    if (passcode !== ACCESS_PASSCODE) {
      socket.emit("join_result", { ok: false, reason: "Incorrect passcode." });
      return;
    }

    currentRoom = roomId || `room_${socket.id}`;
    currentName = name || (role === "agent" ? "Support Agent" : "Visitor");

    socket.join(currentRoom);
    socket.data.role = role || "visitor";
    socket.data.name = currentName;
    socket.data.authorized = true;

    const room = getRoom(currentRoom);

    // Send chat history to the newly joined client
    socket.emit("room_history", room.messages);
    socket.emit("join_result", { ok: true });

    // Let everyone else in the room know someone connected
    socket.to(currentRoom).emit("presence", {
      type: "joined",
      name: currentName,
      role: socket.data.role,
      timestamp: Date.now(),
    });

    io.to(currentRoom).emit("online_count", {
      count: io.sockets.adapter.rooms.get(currentRoom)?.size || 0,
    });
  });

  socket.on("send_message", ({ roomId, text, image }) => {
    if (!socket.data.authorized) return;
    const trimmedText = (text || "").trim();
    if (!trimmedText && !image) return;
    const room = getRoom(roomId);

    // Guard against oversized payloads — base64 images bloat memory fast
    // since history is kept in-process for this demo. 4MB is a generous
    // ceiling for a support-chat screenshot/photo.
    if (image && image.length > 4 * 1024 * 1024) {
      socket.emit("message_error", { reason: "Image is too large (max ~3MB)." });
      return;
    }

    const message = {
      id: `${socket.id}_${Date.now()}`,
      type: image ? "image" : "text",
      text: trimmedText,
      image: image || null,
      senderId: socket.id,
      senderName: socket.data.name || currentName,
      role: socket.data.role || "visitor",
      timestamp: Date.now(),
    };

    room.messages.push(message);
    // Cap history to last 200 messages per room to bound memory use
    if (room.messages.length > 200) room.messages.shift();

    io.to(roomId).emit("receive_message", message);

    // Sending a message implies typing has stopped
    room.typingUsers.delete(socket.id);
    socket.to(roomId).emit("typing_update", {
      typingNames: [...room.typingUsers.values()],
    });
  });

  socket.on("typing_start", ({ roomId }) => {
    if (!socket.data.authorized) return;
    const room = getRoom(roomId);
    room.typingUsers.set(socket.id, socket.data.name || currentName);
    socket.to(roomId).emit("typing_update", {
      typingNames: [...room.typingUsers.values()],
    });
  });

  socket.on("typing_stop", ({ roomId }) => {
    if (!socket.data.authorized) return;
    const room = getRoom(roomId);
    room.typingUsers.delete(socket.id);
    socket.to(roomId).emit("typing_update", {
      typingNames: [...room.typingUsers.values()],
    });
  });

  socket.on("disconnect", () => {
    if (!currentRoom || !socket.data.authorized) return;
    const room = getRoom(currentRoom);
    room.typingUsers.delete(socket.id);

    socket.to(currentRoom).emit("presence", {
      type: "left",
      name: currentName,
      role: socket.data.role,
      timestamp: Date.now(),
    });

    socket.to(currentRoom).emit("typing_update", {
      typingNames: [...room.typingUsers.values()],
    });

    const remaining = io.sockets.adapter.rooms.get(currentRoom)?.size || 0;
    io.to(currentRoom).emit("online_count", { count: remaining });
  });
});

server.listen(PORT, () => {
  console.log(`Chat server listening on http://localhost:${PORT}`);
});
