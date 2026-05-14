/**
 * Extract a YouTube video id from any common form:
 *   https://www.youtube.com/watch?v=ID
 *   https://youtu.be/ID
 *   https://www.youtube.com/embed/ID
 *   https://www.youtube.com/shorts/ID
 *   ID (raw 11-char id)
 * Returns null if nothing valid is found.
 */
function parseYouTubeId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();

  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;

  let url;
  try {
    url = new URL(
      trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }

  if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;

    const parts = url.pathname.split("/").filter(Boolean);
    // /embed/ID, /shorts/ID, /live/ID, /v/ID
    if (
      parts.length >= 2 &&
      ["embed", "shorts", "live", "v"].includes(parts[0]) &&
      /^[\w-]{11}$/.test(parts[1])
    ) {
      return parts[1];
    }
  }

  return null;
}

if (typeof module !== "undefined") module.exports = { parseYouTubeId };
