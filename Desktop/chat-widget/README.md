# Real-Time Chat Support Widget

A floating support-chat widget built with **React + Tailwind CSS** on the
front end and **Node.js + Socket.io** on the back end. Supports instant
bi-directional messaging, "user is typing…" indicators, presence/online
counts, and an auto-scrolling message list.

## Project structure

```
chat-widget/
├── server/              Node.js + Express + Socket.io backend
│   ├── index.js
│   └── package.json
└── client/              React + Vite + Tailwind frontend
    ├── src/
    │   ├── ChatWidget.jsx   ← the widget itself (drop into any page)
    │   ├── App.jsx          ← demo page that renders it
    │   ├── main.jsx
    │   └── index.css
    ├── index.html
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── vite.config.js
    └── package.json
```

## Running it locally

**1. Start the server** (defaults to port 4000):

```bash
cd server
npm install
npm start
```

**2. Start the client** (defaults to port 5173):

```bash
cd client
npm install
cp .env.example .env   # points the client at the socket server
npm run dev
```

Open `http://localhost:5173` in two browser tabs (or one normal + one
incognito window) to simulate a visitor and a support agent talking to each
other in real time.

## How it works

### Server (`server/index.js`)
- Each browser tab connects and calls `join_room`, joining a Socket.io
  "room" (a support conversation thread).
- `send_message` broadcasts a message to everyone in that room and appends
  it to an in-memory history array (capped at 200 messages/room — swap for
  Redis/Postgres in production).
- `typing_start` / `typing_stop` maintain a per-room `Map` of who is
  currently typing and broadcast the updated list on every change.
- `disconnect` cleans up typing state and notifies the room of presence
  changes and the current online count.

### Client (`client/src/ChatWidget.jsx`)
- Opens a single `socket.io-client` connection on mount and tears it down
  on unmount.
- **Auto-scroll**: a `ref` on the message container is scrolled to
  `scrollHeight` inside a `useEffect` that runs whenever `messages` or
  `typingNames` change, so new messages and the typing indicator always
  stay in view.
- **Typing indicator**: keystrokes emit `typing_start` once, then a
  debounce timer (1.5s of inactivity) emits `typing_stop`. Sending a
  message also stops typing immediately.
- **Private access**: opening the widget for the first time on a device
  shows one combined form asking for a **name** and the **passcode**
  together. The name is saved to `localStorage` (`chatwidget_name`) so it's
  never asked again on that browser — but the passcode is intentionally
  never persisted, so returning visitors see just the passcode field every
  time they reopen the site. `join_room` requires this passcode to match
  `ACCESS_PASSCODE` on the server. Sockets that haven't passed this check
  are marked unauthorized and every other event (`send_message`,
  `typing_start`/`typing_stop`) is ignored for them — so the passcode isn't
  just a UI gate, it's enforced server-side too.
  > **Note:** `localStorage` is shared across every tab of the same
  > browser. To try out multiple "people" while testing, use separate
  > browsers (e.g. Chrome + Firefox) or a normal window + an incognito
  > window — two tabs of the same normal window will share the same saved
  > name.
- **Persistent message ownership (bug fix)**: messages are attributed to a
  `clientId` generated once and stored in `localStorage`
  (`chatwidget_client_id`) — *not* to Socket.io's `socket.id`, which changes
  on every reconnect. Previously, a person's own past messages would flip
  to the "received" side after they reloaded the page or briefly dropped
  connection, because `isOwn` was compared against the old `socket.id`.
  `clientId` is sent with `join_room`, and the server now stamps every
  message's `senderId` with it instead of the connection's `socket.id`, so
  ownership survives reconnects.
- **Unread badge**: while the panel is minimized, incoming messages from
  other participants increment a badge on the launcher button; it clears
  when the panel is reopened.
- **Emoji picker**: the emoji button toggles a small grid; picking one
  appends it to the draft and refocuses the input. Click outside the panel
  to close it.
- **Photo sharing**: the paperclip button opens a file picker restricted to
  images. The chosen file is read client-side with `FileReader` into a
  base64 data URL, previewed above the composer with a remove button, and
  sent as an `image` message (optionally with a caption typed into the same
  input). The server enforces a ~3MB size cap and Socket.io's
  `maxHttpBufferSize` is raised to 6MB to allow the payload through —
  images are still fine for a demo but should move to real object storage
  (S3, Cloudinary, etc.) with the message carrying a URL instead of raw
  base64 for anything beyond a prototype.
- The room id, display name, and role (`visitor` vs `agent`) are props, so
  the same component can represent either side of the conversation — handy
  for testing both roles from two tabs.

## Deploying

- Deploy `server/` anywhere that supports long-lived WebSocket connections
  (Render, Railway, Fly.io, a plain VPS, etc.) — not classic serverless
  functions, which don't hold persistent sockets.
- Set `CLIENT_ORIGIN` on the server to your deployed frontend's URL (for
  CORS), and `VITE_SOCKET_URL` on the client to your deployed server's URL.
- For production scale beyond a single server instance, swap the in-memory
  `rooms` Map for the [Socket.io Redis adapter](https://socket.io/docs/v4/redis-adapter/)
  so rooms/typing state are shared across instances.

## Extending this further
- Persist message history to a database instead of memory.
- Add authentication so `join_room` verifies who's allowed into a room.
- Add file/image attachments via a signed upload URL + a `send_message`
  payload that includes an attachment reference.
- Add read receipts by emitting a `message_seen` event when a bubble
  scrolls into view.
