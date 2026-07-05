import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
const TYPING_IDLE_MS = 1500;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB, matches the server-side guard

const EMOJIS = [
  "😀", "😂", "😍", "😊", "😉", "😎", "🤔", "😢", "😮", "😡",
  "👍", "👎", "🙏", "👏", "💪", "🤝", "👋", "✌️", "🔥", "🎉",
  "❤️", "💯", "✅", "❌", "⚡", "⭐", "☕", "🍕", "🎂", "🏆",
  "😴", "🤗", "🙌", "😅", "🥳", "😇", "🤷", "🚀", "📸", "📌",
];

// WhatsApp assigns each group member a consistent color for their name/bubble
// accent, derived from their name so it's stable across sessions.
const NAME_COLORS = [
  "#E542A3", // pink
  "#00A884", // teal-green
  "#DF7E13", // amber
  "#7C5CFC", // violet
  "#F04747", // red
  "#1FA2FF", // sky blue
  "#B2891F", // gold
  "#2FB67C", // mint
];

function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
}

/**
 * ChatWidget
 * -----------------------------------------------------------------
 * A floating, launcher-triggered group chat widget styled after
 * WhatsApp's group-chat conventions: a teal app bar with group
 * identity, a wallpapered message thread, tailed bubbles colored by
 * sender, and a typing status that lives in the header subtitle.
 *
 * Props:
 *  - roomId:    which group/thread to join (defaults to a demo room)
 *  - name:      fallback display name, only used if no name has been
 *               entered yet (the real identity comes from the one-time
 *               name prompt, persisted in localStorage)
 *  - role:      "visitor" | "agent" — kept for the server's own bookkeeping
 *  - groupName: label shown in the header (defaults to "Support Group")
 */
export default function ChatWidget({
  roomId = "demo-room",
  name = "You",
  role = "visitor",
  groupName = "Support Group",
}) {
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [typingNames, setTypingNames] = useState([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [unread, setUnread] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingImage, setPendingImage] = useState(null); // { dataUrl, fileName }
  const [imageError, setImageError] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeError, setPasscodeError] = useState("");
  const [checkingPasscode, setCheckingPasscode] = useState(false);
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem("chatwidget_name") || ""
  );
  const [nameInput, setNameInput] = useState("");

  // A stable per-browser identity that outlives any single socket connection.
  // socket.id changes every time a client reconnects (page reload, dropped
  // network, etc.) — using it for message ownership meant a person's own
  // past messages would flip to the "received" side after they reconnected.
  // clientId is generated once and stored forever, so ownership stays correct.
  const clientIdRef = useRef(
    (() => {
      let id = localStorage.getItem("chatwidget_client_id");
      if (!id) {
        id =
          crypto.randomUUID?.() ??
          `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        localStorage.setItem("chatwidget_client_id", id);
      }
      return id;
    })()
  );

  const socketRef = useRef(null);
  const scrollRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isTypingRef = useRef(false);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  const emojiPanelRef = useRef(null);

  // ---- Connect once on mount -------------------------------------------
  useEffect(() => {
    const socket = io(SOCKET_URL, { autoConnect: true });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("join_result", ({ ok, reason }) => {
      setCheckingPasscode(false);
      if (ok) {
        setAuthorized(true);
        setPasscodeError("");
      } else {
        setAuthorized(false);
        setPasscodeError(reason || "Incorrect passcode.");
      }
    });

    socket.on("room_history", (history) => setMessages(history));

    socket.on("receive_message", (message) => {
      setMessages((prev) => [...prev, message]);
      setOpen((currentlyOpen) => {
        if (!currentlyOpen && message.senderId !== clientIdRef.current) {
          setUnread((u) => u + 1);
        }
        return currentlyOpen;
      });
    });

    socket.on("typing_update", ({ typingNames }) => setTypingNames(typingNames));

    socket.on("online_count", ({ count }) => setOnlineCount(count));

    socket.on("message_error", ({ reason }) => setImageError(reason));

    socket.on("presence", ({ type, name: who }) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `sys_${Date.now()}_${Math.random()}`,
          system: true,
          text: type === "joined" ? `${who} joined` : `${who} left`,
          timestamp: Date.now(),
        },
      ]);
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ---- Auto-scroll to newest message -------------------------------------
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typingNames, open]);

  // ---- Clear unread badge when opened -------------------------------------
  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  // ---- Close the emoji picker when clicking outside it --------------------
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handleClick = (e) => {
      if (emojiPanelRef.current && !emojiPanelRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showEmojiPicker]);

  // ---- Auto-dismiss image errors after a few seconds -----------------------
  useEffect(() => {
    if (!imageError) return;
    const t = setTimeout(() => setImageError(""), 4000);
    return () => clearTimeout(t);
  }, [imageError]);

  // ---- Typing lifecycle ----------------------------------------------------
  const stopTyping = useCallback(() => {
    if (isTypingRef.current) {
      isTypingRef.current = false;
      socketRef.current?.emit("typing_stop", { roomId });
    }
  }, [roomId]);

  const handleDraftChange = (e) => {
    const value = e.target.value;
    setDraft(value);

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socketRef.current?.emit("typing_start", { roomId });
    }

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  const submitJoin = (e) => {
    e.preventDefault();

    let finalName = displayName;
    if (!finalName) {
      const trimmedName = nameInput.trim();
      if (!trimmedName) return;
      localStorage.setItem("chatwidget_name", trimmedName);
      setDisplayName(trimmedName);
      finalName = trimmedName;
    }

    const code = passcodeInput.trim();
    if (!code) return;

    setCheckingPasscode(true);
    setPasscodeError("");
    socketRef.current?.emit("join_room", {
      roomId,
      name: finalName,
      role,
      passcode: code,
      clientId: clientIdRef.current,
    });
  };

  const sendMessage = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text && !pendingImage) return;

    socketRef.current?.emit("send_message", {
      roomId,
      text,
      image: pendingImage?.dataUrl || null,
    });

    setDraft("");
    setPendingImage(null);
    clearTimeout(typingTimeoutRef.current);
    stopTyping();
  };

  const insertEmoji = (emoji) => {
    setDraft((d) => d + emoji);
    inputRef.current?.focus();
  };

  const handleImagePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again later
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setImageError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Image is too large (max 3MB).");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPendingImage({ dataUrl: reader.result, fileName: file.name });
    };
    reader.onerror = () => setImageError("Couldn't read that image, try another.");
    reader.readAsDataURL(file);
  };

  const othersTyping = typingNames.filter((n) => n !== (displayName || name));

  // Group subtitle: WhatsApp shows "typing…" in place of the member list
  // the moment someone starts composing, then reverts once they stop.
  const subtitle = useMemo(() => {
    if (!authorized) return "Private group";
    if (!connected) return "connecting…";
    if (othersTyping.length === 1) return `${othersTyping[0]} is typing…`;
    if (othersTyping.length > 1) return `${othersTyping.length} people typing…`;
    return `${onlineCount} online`;
  }, [authorized, connected, othersTyping, onlineCount]);

  return (
    <div className="fixed bottom-5 right-5 z-50 font-body">
      {open && (
        <div className="mb-3 flex h-[560px] w-[360px] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl animate-pop">
          {/* Group header */}
          <div className="flex items-center justify-between bg-wa-header px-3.5 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 font-display text-sm font-semibold">
                <GroupGlyph />
              </div>
              <div>
                <p className="font-display text-[15px] font-semibold leading-tight">
                  {groupName}
                </p>
                <p
                  className={`text-[12px] leading-tight ${
                    othersTyping.length > 0 ? "text-white" : "text-white/70"
                  }`}
                >
                  {subtitle}
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Minimize chat"
              className="rounded-md p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          {/* Message thread — wallpapered like a group chat */}
          {authorized ? (
            <>
              <div
                ref={scrollRef}
                className="chat-scroll wa-wallpaper flex flex-1 flex-col justify-end space-y-1.5 overflow-y-auto px-3 py-3"
              >
                {messages.length === 0 && (
                  <div className="mx-auto mt-6 max-w-[85%] rounded-lg bg-[#FFF5CC] px-3 py-2 text-center text-[12px] text-wa-ink/70 shadow-sm">
                    🔒 Messages here are just for this demo room — say hello to get started.
                  </div>
                )}

                {messages.map((m, i) =>
                  m.system ? (
                    <p key={m.id} className="py-1 text-center text-[11.5px] text-wa-ink/45">
                      {m.text}
                    </p>
                  ) : (
                    <MessageBubble
                      key={m.id}
                      message={m}
                      isOwn={m.senderId === clientIdRef.current}
                      showName={
                        m.senderId !== clientIdRef.current &&
                        (i === 0 || messages[i - 1]?.senderId !== m.senderId)
                      }
                    />
                  )
                )}

                {othersTyping.length > 0 && <TypingBubble />}
              </div>

              {/* Composer */}
              <div className="relative bg-[#F0F2F5]">
                {imageError && (
                  <div className="absolute -top-9 left-2 right-2 rounded-md bg-[#F04747] px-3 py-1.5 text-center text-[12px] text-white shadow">
                    {imageError}
                  </div>
                )}

                {showEmojiPicker && (
                  <div
                    ref={emojiPanelRef}
                    className="absolute bottom-full left-2 mb-2 grid w-64 grid-cols-8 gap-1 rounded-xl border border-black/5 bg-white p-2.5 shadow-2xl animate-pop"
                  >
                    {EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => insertEmoji(emoji)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-lg transition hover:bg-black/5"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                {pendingImage && (
                  <div className="flex items-center gap-2 border-b border-black/5 px-3 pt-2.5">
                    <div className="relative">
                      <img
                        src={pendingImage.dataUrl}
                        alt="Selected attachment preview"
                        className="h-14 w-14 rounded-md object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setPendingImage(null)}
                        aria-label="Remove attached image"
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-wa-ink text-white shadow"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M6 6l12 12M18 6L6 18"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </div>
                    <p className="truncate text-[12px] text-wa-sub">{pendingImage.fileName}</p>
                  </div>
                )}

                <form onSubmit={sendMessage} className="flex items-center gap-1.5 px-2 py-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImagePick}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker((s) => !s)}
                    aria-label="Choose an emoji"
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-black/5 ${
                      showEmojiPicker ? "bg-black/5 text-wa-accent" : "text-wa-sub"
                    }`}
                  >
                    <EmojiGlyph />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach a photo"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-wa-sub transition hover:bg-black/5"
                  >
                    <ClipGlyph />
                  </button>
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={handleDraftChange}
                    onBlur={stopTyping}
                    placeholder={pendingImage ? "Add a caption…" : "Type a message"}
                    className="flex-1 rounded-full border border-black/5 bg-white px-4 py-2 text-[13.5px] text-wa-ink placeholder:text-wa-sub focus:outline-none focus:ring-2 focus:ring-wa-accent/30"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() && !pendingImage}
                    aria-label="Send message"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wa-accent text-white transition disabled:opacity-40"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M3 11l18-7-7 18-2.5-7.5L3 11z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </form>
              </div>
            </>
          ) : (
            <form
              onSubmit={submitJoin}
              className="flex flex-1 flex-col items-center justify-center gap-3 bg-wa-bg px-8 text-center"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-wa-header/10 text-wa-header">
                <LockGlyph />
              </div>
              <p className="font-display text-[15px] font-semibold text-wa-ink">
                {displayName ? "This group is private" : "Join the group"}
              </p>
              <p className="text-[12.5px] text-wa-sub">
                {displayName
                  ? `Hi ${displayName} — enter the passcode to join.`
                  : "Enter your name and the group passcode."}
              </p>

              {!displayName && (
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Your name"
                  maxLength={30}
                  autoFocus
                  className="w-full max-w-[220px] rounded-full border border-black/10 bg-white px-4 py-2 text-center text-[13.5px] text-wa-ink placeholder:text-wa-sub focus:outline-none focus:ring-2 focus:ring-wa-accent/40"
                />
              )}

              <input
                type="password"
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                placeholder="Enter passcode"
                autoFocus={!!displayName}
                className="w-full max-w-[220px] rounded-full border border-black/10 bg-white px-4 py-2 text-center text-[13.5px] text-wa-ink placeholder:text-wa-sub focus:outline-none focus:ring-2 focus:ring-wa-accent/40"
              />

              {passcodeError && (
                <p className="text-[12px] text-[#D93025]">{passcodeError}</p>
              )}

              <button
                type="submit"
                disabled={
                  (!displayName && !nameInput.trim()) ||
                  !passcodeInput.trim() ||
                  checkingPasscode
                }
                className="rounded-full bg-wa-accent px-5 py-2 text-[13px] font-semibold text-white transition disabled:opacity-40"
              >
                {checkingPasscode ? "Checking…" : "Join group"}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close chat" : "Open chat"}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-wa-accent text-white shadow-xl transition hover:scale-105 active:scale-95"
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H9l-4.5 4v-4h-.01A2.5 2.5 0 0 1 4 13.5v-8z" />
          </svg>
        )}

        {!open && unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#F04747] px-1 text-[11px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}

function MessageBubble({ message, isOwn, showName }) {
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const nameColor = colorForName(message.senderName || "?");
  const isImage = message.type === "image" && message.image;

  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
      <div
        className={`relative max-w-[78%] rounded-lg shadow-sm ${
          isImage ? "p-1.5" : "px-2.5 pb-1.5 pt-1.5"
        } text-[13.5px] leading-snug ${
          isOwn ? "rounded-tr-none bg-wa-own text-wa-ink" : "rounded-tl-none bg-wa-other text-wa-ink"
        }`}
      >
        {showName && (
          <p
            className={`mb-0.5 text-[12.5px] font-semibold ${isImage ? "px-1 pt-0.5" : ""}`}
            style={{ color: nameColor }}
          >
            {message.senderName}
          </p>
        )}

        {isImage && (
          <img
            src={message.image}
            alt="Shared attachment"
            className="max-h-64 w-full rounded-md object-cover"
          />
        )}

        {message.text && (
          <p className={`whitespace-pre-wrap break-words ${isImage ? "px-1 pt-1.5" : ""}`}>
            {message.text}
            {/* Invisible spacer reserves room so the timestamp never overlaps
                short messages; visible timestamp is the absolutely-positioned
                span below, positioned exactly over this reserved gap. */}
            <span className="invisible ml-2 inline-block whitespace-nowrap text-[10px]">
              {time}
            </span>
          </p>
        )}

        <span
          className={`pointer-events-none absolute text-[10px] text-wa-sub ${
            isImage && !message.text ? "bottom-2.5 right-3 text-white drop-shadow" : "bottom-1.5 right-2.5"
          }`}
        >
          {time}
        </span>
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-lg rounded-tl-none bg-wa-other px-3 py-2.5 shadow-sm">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-wa-sub"
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function GroupGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="8" r="3.2" />
      <circle cx="16" cy="9.5" r="2.6" opacity="0.75" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M14 19c0-2.2 1.6-4 4-4s4 1.8 4 4" opacity="0.75" />
    </svg>
  );
}

function EmojiGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
      <path
        d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8 11V7.5a4 4 0 0 1 8 0V11"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClipGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M8 12.5l6.5-6.5a3 3 0 1 1 4.24 4.24L11 18a5 5 0 1 1-7.07-7.07L12 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
