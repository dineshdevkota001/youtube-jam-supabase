import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// --- URL params ------------------------------------------------------------
const params = new URLSearchParams(location.search);
let videoId = params.get("v");
let sessionId = params.get("session");

// `mydomain.com/watch?v=ID` (e.g. user swapped `youtube.com` for our host):
// no session given → spin one up so the page becomes a fresh shareable jam.
function newSessionId() {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const arr = new Uint32Array(10);
  crypto.getRandomValues(arr);
  let id = "";
  for (const n of arr) id += alphabet[n % alphabet.length];
  return id;
}

if (!sessionId && videoId) {
  sessionId = newSessionId();
}

if (!sessionId) {
  document.body.innerHTML =
    '<main class="landing"><div class="card"><h2>Missing session</h2>' +
    '<p>This link is incomplete. <a href="/">Start a new jam</a>.</p></div></main>';
  throw new Error("missing session in URL");
}

// --- Identity --------------------------------------------------------------
function loadName() {
  let n = localStorage.getItem("yt-jam-name");
  if (!n) {
    const adjectives = [
      "calm",
      "brave",
      "lucky",
      "loud",
      "quick",
      "wild",
      "kind",
    ];
    const animals = ["otter", "fox", "wolf", "panda", "tiger", "moose", "owl"];
    n =
      adjectives[Math.floor(Math.random() * adjectives.length)] +
      "-" +
      animals[Math.floor(Math.random() * animals.length)];
    localStorage.setItem("yt-jam-name", n);
  }
  return n;
}
const me = {
  id: crypto.randomUUID(),
  name: loadName(),
};

// --- URL / share-link sync -------------------------------------------------
// The URL is our source of truth for `session` and `v`. When either changes
// (e.g. video swap), we rewrite the address bar via history.replaceState so
// reloads / copies stay in sync with the current jam state.
const shareInput = document.getElementById("share-link");
const copyBtn = document.getElementById("copy-btn");
const copyToast = document.getElementById("copy-toast");

function currentShareUrl() {
  const url = new URL(location.origin + "/watch");
  url.searchParams.set("session", sessionId);
  if (videoId) url.searchParams.set("v", videoId);
  return url.toString();
}

function syncUrl() {
  const url = currentShareUrl();
  history.replaceState(null, "", url);
  shareInput.value = url;
}
syncUrl();

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareInput.value);
  } catch {
    shareInput.select();
    document.execCommand("copy");
  }
  copyToast.hidden = false;
  setTimeout(() => (copyToast.hidden = true), 1500);
});
shareInput.addEventListener("focus", () => shareInput.select());

const statusEl = document.getElementById("status");
function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// --- Change-video form -----------------------------------------------------
const changeForm = document.getElementById("change-video-form");
const changeInput = document.getElementById("change-video-input");
const changeError = document.getElementById("change-video-error");
const playerEmpty = document.getElementById("player-empty");

changeForm.addEventListener("submit", (e) => {
  e.preventDefault();
  changeError.hidden = true;
  const raw = changeInput.value.trim();
  const id = parseYouTubeId(raw);
  if (!id) {
    changeError.textContent =
      "Couldn't find a YouTube video ID in that link.";
    changeError.hidden = false;
    return;
  }
  if (id === videoId) {
    changeError.textContent = "That's already the current video.";
    changeError.hidden = false;
    return;
  }
  changeInput.value = "";
  changeVideo(id, { time: 0, isPlaying: true, broadcast: true });
});

// --- YouTube IFrame Player -------------------------------------------------
let player = null;
let playerReady = false;
let ytApiReady = false;
const pendingActions = []; // queue actions until player is ready

// `suppressBroadcast` is set while we're applying a remote action to the
// player, so the resulting state-change event doesn't echo back as a new
// broadcast. We use a small timestamp window so we don't get stuck suppressing
// forever if YT swallows an event.
let suppressUntil = 0;
function suppressOnce(ms = 800) {
  suppressUntil = Math.max(suppressUntil, Date.now() + ms);
}
function isSuppressed() {
  return Date.now() < suppressUntil;
}

window.onYouTubeIframeAPIReady = () => {
  ytApiReady = true;
  tryCreatePlayer();
};

const ytTag = document.createElement("script");
ytTag.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(ytTag);

function tryCreatePlayer() {
  if (player || !ytApiReady || !videoId) return;
  if (playerEmpty) playerEmpty.remove();
  player = new YT.Player("player", {
    width: "100%",
    height: "100%",
    videoId,
    playerVars: {
      playsinline: 1,
      rel: 0,
      modestbranding: 1,
    },
    events: {
      onReady: () => {
        playerReady = true;
        for (const fn of pendingActions) fn();
        pendingActions.length = 0;
      },
      onStateChange: onPlayerStateChange,
    },
  });
}

function whenReady(fn) {
  if (playerReady) fn();
  else pendingActions.push(fn);
}

// Swap the loaded video. `time` is the desired starting offset (in seconds);
// `isPlaying` controls autoplay; `broadcast` decides whether to tell the room.
function changeVideo(newVideoId, { time = 0, isPlaying = true, broadcast = false } = {}) {
  if (!newVideoId) return;
  const sameVideo = newVideoId === videoId;
  videoId = newVideoId;
  syncUrl();

  // Reset seek-detection so the time jump to 0 doesn't fire a phantom seek.
  lastObservedTime = time;
  lastObservedAt = Date.now();

  if (!player) {
    tryCreatePlayer();
    // First-time player creation already uses `videoId`; if we need a non-zero
    // start time, apply it once the player is ready.
    if (time > 0 || !isPlaying) {
      whenReady(() => {
        suppressOnce(1500);
        player.seekTo(time, true);
        if (!isPlaying) player.pauseVideo();
      });
    }
  } else if (sameVideo) {
    whenReady(() => {
      suppressOnce();
      player.seekTo(time, true);
      if (isPlaying) player.playVideo();
      else player.pauseVideo();
    });
  } else {
    whenReady(() => {
      suppressOnce(1500);
      if (isPlaying) {
        player.loadVideoById({ videoId: newVideoId, startSeconds: time });
      } else {
        player.cueVideoById({ videoId: newVideoId, startSeconds: time });
      }
    });
  }

  if (broadcast) {
    sendBroadcast("video_change", {
      videoId: newVideoId,
      time,
      isPlaying,
    });
  }
}

function onPlayerStateChange(e) {
  if (!channel) return;
  if (isSuppressed()) return;

  const t = player.getCurrentTime();
  if (e.data === YT.PlayerState.PLAYING) {
    sendBroadcast("play", { time: t });
  } else if (e.data === YT.PlayerState.PAUSED) {
    sendBroadcast("pause", { time: t });
  }
}

// Detect user-initiated seeks: YouTube doesn't fire a clean "seek" event, so
// we poll currentTime and compare against expected progression.
let lastObservedTime = 0;
let lastObservedAt = Date.now();
setInterval(() => {
  if (!playerReady || !channel || isSuppressed()) return;
  const now = Date.now();
  const t = player.getCurrentTime();
  const state = player.getPlayerState();
  const playing = state === YT.PlayerState.PLAYING;
  const expected = playing
    ? lastObservedTime + (now - lastObservedAt) / 1000
    : lastObservedTime;
  if (Math.abs(t - expected) > 1.2) {
    // user (or buffering) jumped the playhead; broadcast a seek
    sendBroadcast("seek", { time: t, isPlaying: playing });
  }
  lastObservedTime = t;
  lastObservedAt = now;
}, 700);

// --- Supabase Realtime -----------------------------------------------------
let supabase = null;
let channel = null;
let synced = false;

async function init() {
  setStatus("connecting…");
  const cfg = await fetch("/api/config").then((r) => r.json());
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    setStatus("Supabase not configured", "error");
    alert(
      "Supabase isn't configured on this server. Set SUPABASE_URL and " +
        "SUPABASE_ANON_KEY in .env (see README.md) and restart.",
    );
    return;
  }

  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    realtime: { params: { eventsPerSecond: 20 } },
  });

  channel = supabase.channel(`jam:${sessionId}`, {
    config: {
      broadcast: { self: false, ack: false },
      presence: { key: me.id },
    },
  });

  channel.on("broadcast", { event: "play" }, ({ payload }) =>
    applyRemote("play", payload),
  );
  channel.on("broadcast", { event: "pause" }, ({ payload }) =>
    applyRemote("pause", payload),
  );
  channel.on("broadcast", { event: "seek" }, ({ payload }) =>
    applyRemote("seek", payload),
  );
  channel.on("broadcast", { event: "chat" }, ({ payload }) =>
    appendChat(payload),
  );
  channel.on("broadcast", { event: "sync_request" }, ({ payload }) =>
    handleSyncRequest(payload),
  );
  channel.on("broadcast", { event: "sync_state" }, ({ payload }) =>
    handleSyncState(payload),
  );
  channel.on("broadcast", { event: "video_change" }, ({ payload }) =>
    handleVideoChange(payload),
  );

  channel.on("presence", { event: "sync" }, () => renderUsers());
  channel.on("presence", { event: "join" }, () => renderUsers());
  channel.on("presence", { event: "leave" }, () => renderUsers());

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      setStatus(videoId ? "connected" : "waiting for video…", videoId ? "ok" : "");
      await channel.track({ name: me.name, joinedAt: Date.now() });
      // Ask anyone in the room for the current video + playhead.
      sendBroadcast("sync_request", { from: me.id });
      // If no one answers within 1.5s, we're probably the first one in.
      setTimeout(() => {
        if (synced) return;
        synced = true;
        if (!videoId) {
          setStatus("no video yet — paste a YouTube link to start", "");
        }
      }, 1500);
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      setStatus("connection lost", "error");
    } else if (status === "CLOSED") {
      setStatus("disconnected", "error");
    }
  });
}

function sendBroadcast(event, payload) {
  if (!channel) return;
  channel.send({
    type: "broadcast",
    event,
    payload: { ...payload, by: me.name, byId: me.id, at: Date.now() },
  });
}

// --- Apply remote events to local player -----------------------------------
function applyRemote(kind, payload) {
  if (!payload) return;
  if (payload.byId === me.id) return; // shouldn't happen (self:false) but be safe.
  whenReady(() => {
    const drift = (Date.now() - (payload.at || Date.now())) / 1000;

    if (kind === "play") {
      const target = (payload.time || 0) + Math.max(0, drift);
      suppressOnce();
      player.seekTo(target, true);
      player.playVideo();
    } else if (kind === "pause") {
      suppressOnce();
      player.seekTo(payload.time || 0, true);
      player.pauseVideo();
    } else if (kind === "seek") {
      const playing = !!payload.isPlaying;
      const target = (payload.time || 0) + (playing ? Math.max(0, drift) : 0);
      suppressOnce();
      player.seekTo(target, true);
      if (playing) player.playVideo();
      else player.pauseVideo();
    }
    synced = true;
  });
}

function handleVideoChange(payload) {
  if (!payload || payload.byId === me.id) return;
  const drift = (Date.now() - (payload.at || Date.now())) / 1000;
  const isPlaying = !!payload.isPlaying;
  const target = (payload.time || 0) + (isPlaying ? Math.max(0, drift) : 0);
  changeVideo(payload.videoId, {
    time: target,
    isPlaying,
    broadcast: false,
  });
  synced = true;
}

// Late-joiner sync: any client receiving sync_request replies with current state.
let lastSyncReplyAt = 0;
function handleSyncRequest(payload) {
  if (!playerReady || !videoId) return;
  if (payload?.from === me.id) return;
  // Throttle: at most one reply per second across multiple requests.
  if (Date.now() - lastSyncReplyAt < 1000) return;
  lastSyncReplyAt = Date.now();
  const state = player.getPlayerState();
  sendBroadcast("sync_state", {
    to: payload.from,
    videoId,
    time: player.getCurrentTime(),
    isPlaying: state === YT.PlayerState.PLAYING,
  });
}

function handleSyncState(payload) {
  if (synced) return;
  if (payload?.to && payload.to !== me.id) return;
  synced = true;
  const drift = (Date.now() - (payload.at || Date.now())) / 1000;
  const isPlaying = !!payload.isPlaying;
  const target = (payload.time || 0) + (isPlaying ? Math.max(0, drift) : 0);

  // Late-joiner needs the room's current video. Either we have none yet, or
  // it differs from what's loaded — swap in either case.
  if (payload.videoId && payload.videoId !== videoId) {
    changeVideo(payload.videoId, {
      time: target,
      isPlaying,
      broadcast: false,
    });
    setStatus("connected", "ok");
    return;
  }

  whenReady(() => {
    suppressOnce();
    player.seekTo(target, true);
    if (isPlaying) player.playVideo();
    else player.pauseVideo();
  });
}

// --- Presence / users list -------------------------------------------------
const usersEl = document.getElementById("users");
function renderUsers() {
  if (!channel) return;
  const state = channel.presenceState();
  const flat = [];
  for (const arr of Object.values(state)) {
    for (const p of arr) flat.push(p);
  }
  flat.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  usersEl.innerHTML = "";
  for (const u of flat) {
    const li = document.createElement("li");
    li.textContent = u.name + (u.name === me.name ? " (you)" : "");
    usersEl.appendChild(li);
  }
}

// --- Chat ------------------------------------------------------------------
const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  appendChat({ text, by: me.name, at: Date.now() }); // optimistic local
  sendBroadcast("chat", { text });
});

function appendChat({ text, by, at }) {
  const row = document.createElement("div");
  row.className = "chat-row";
  const t = new Date(at || Date.now());
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  row.innerHTML =
    `<span class="chat-meta">${hh}:${mm} ${escapeHtml(by || "anon")}</span>` +
    `<span class="chat-text">${escapeHtml(text)}</span>`;
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

init();
