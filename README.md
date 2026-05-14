# YouTube Jam

Realtime YouTube watch parties powered by **Supabase Realtime** (free, open
source). Paste a YouTube link, get a shareable URL, and everyone who opens it
plays, pauses, and seeks together — in sync.

The share URL deliberately mirrors YouTube's own URL shape:

```
/watch?v=VIDEO_ID&session=SESSION_ID
```

So you can swap `youtube.com` for your jam host and keep the same path.

## Architecture

- **Frontend**: plain HTML + JS, [YouTube IFrame Player API], and the
  [`@supabase/supabase-js`][supabase-js] client (loaded from esm.sh).
- **Realtime sync**: a Supabase Realtime channel per session
  (`jam:<sessionId>`). Broadcast events for `play` / `pause` / `seek` /
  `chat` / `sync_request` / `sync_state`. Presence tracks the user list.
- **Server**: a tiny Express app that just serves static files, the
  `/watch` route, and `/api/config` (to hand the Supabase URL + anon key
  to the browser). No database. Sessions are entirely ephemeral — the
  `videoId` lives in the URL itself.
- **Late joiners** broadcast a `sync_request`; existing clients reply
  with `sync_state` (current playhead + isPlaying), and the new client
  seeks/plays accordingly.

[YouTube IFrame Player API]: https://developers.google.com/youtube/iframe_api_reference
[supabase-js]: https://github.com/supabase/supabase-js

## Setup

### 1. Create a free Supabase project

1. Go to <https://supabase.com> and sign in.
2. **New project** → pick any name/region. The free tier is plenty for
   this app — Realtime is included.
3. Once the project finishes provisioning, go to **Project Settings →
   API**. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`

> The anon key is safe to ship to the browser. We don't write any data
> to Postgres, so no Row Level Security setup is needed — Realtime
> broadcast and presence work out of the box.

### 2. Configure & run

```bash
cp .env.example .env
# edit .env and paste your SUPABASE_URL + SUPABASE_ANON_KEY

npm install
npm start
```

Then open <http://localhost:3000>.

## How sync works

| Event           | Sent when                                       | Effect on receivers                                                         |
| --------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| `play`          | a user presses play                             | seek to `time + drift` and play                                             |
| `pause`         | a user presses pause                            | seek to `time` and pause                                                    |
| `seek`          | local playhead diverges >1.2s from expectation  | seek to `time` (+ drift if playing) and match play state                    |
| `sync_request`  | new client subscribes                           | one existing client replies with `sync_state` (rate-limited to 1/sec)       |
| `sync_state`    | reply to `sync_request`                         | new client seeks + matches play state                                       |
| `chat`          | a user sends a chat message                     | append to chat log                                                          |
| presence join/leave/sync | track changes                          | re-render user list                                                         |

`drift = (Date.now() - payload.at) / 1000` — applied only while the
video is playing.

## Deploying

Any Node host works (Render, Fly.io, Railway, a VPS, etc.). Just set:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `PORT` (most platforms inject this automatically)

The whole frontend is static — you could also host `public/` on Netlify
or Cloudflare Pages and skip the server entirely if you replace
`/api/config` with build-time injection of those two values.

## Files

```
server.js              tiny Express - static + /api/config + /watch route
public/index.html      landing page
public/watch.html      jam session page
public/watch.js        YouTube player + Supabase Realtime sync logic
public/youtube-url.js  parse video IDs from any YouTube URL form
public/styles.css      styling
```
