#!/usr/bin/env node
/**
 * reindex-audio — rebuild `web/public/audio/index.json` from the
 * audio files currently on disk.
 *
 * The SoundtrackPicker (Module / Map / Dungeon properties dialogs) and
 * the editor's Soundtrack browse page read index.json, not the
 * directory itself, because the static build has no filesystem API at
 * runtime. When an author drops a new track into `public/audio/`, this
 * script needs to run so the catalog picks it up — otherwise the file
 * is invisible to the editor.
 *
 * Usage:
 *   node scripts/reindex-audio.mjs
 *   # or via npm:
 *   npm run reindex-audio
 *
 * Output:
 *   - Collects every audio file in `public/audio/` (mp3/ogg/wav/m4a),
 *     and writes a sorted, flat `tracks: [{ path, name }]` list — the
 *     shape the picker expects.
 *   - `path` is `/audio/<filename>` (basePath applied at runtime).
 *   - `name` is the display label. Custom names already in the current
 *     index.json are PRESERVED (so "Bard's Ballad", "Don't Fear the
 *     Reaper", etc. aren't clobbered); new files get a name derived
 *     from the filename (underscores → spaces, Title Case).
 *   - `gain` (optional, 0-1) is a per-track volume multiplier set in
 *     the editor to tame tracks that are too loud. It's PRESERVED
 *     across reindex runs so dropping a new file never wipes the
 *     volume levelling you've already dialled in.
 *   - The `_comment` field is preserved/re-injected so future readers
 *     know how the file is structured.
 *
 * Safety:
 *   - Only writes inside `public/audio/`.
 *   - Skips hidden files (`.DS_Store`, etc.) and non-audio entries.
 *   - Idempotent — running twice in a row is a no-op when nothing has
 *     changed.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_ROOT = path.resolve(
  process.env.PUBLISH_AUDIO_ROOT || path.join(__dirname, "..", "public", "audio"),
);
const INDEX_PATH = path.join(AUDIO_ROOT, "index.json");

const AUDIO_EXT_RE = /\.(mp3|ogg|wav|m4a)$/i;

const COMMENT =
  "Listing of every audio file under /public/audio/. Hand-maintained for now — Next.js static export can't directory-list at runtime, so the editor's SoundtrackPicker reads this file to know what tracks are available. Run `npm run reindex-audio` after dropping a file in this folder to regenerate it. Each `path` is what gets stored on a module / map / dungeon's soundtrack list and is what the SoundtrackPlayer hands to <audio>.src; `name` is the display label in the picker; optional `gain` (0-1) attenuates a track that's too loud relative to the rest of the soundtrack.";

/** Title-case a filename-derived label: "dont_fear_the_reaper" →
 *  "Dont Fear The Reaper". Custom names in the existing index win over
 *  this, so apostrophes / casing authored by hand survive. */
function deriveName(fileName) {
  return fileName
    .replace(AUDIO_EXT_RE, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

async function listAudioFiles() {
  const entries = await fs.readdir(AUDIO_ROOT, { withFileTypes: true });
  return entries
    .filter(
      (e) => e.isFile() && !e.name.startsWith(".") && AUDIO_EXT_RE.test(e.name),
    )
    .map((e) => e.name)
    .sort();
}

async function readCurrentIndex() {
  try {
    const raw = await fs.readFile(INDEX_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Build a path → { name, gain } map so authored display names AND
 *  per-track volume levels are preserved across reindex runs. */
function existingMetaByPath(current) {
  const map = new Map();
  if (current && Array.isArray(current.tracks)) {
    for (const t of current.tracks) {
      if (!t || typeof t.path !== "string") continue;
      const meta = {};
      if (typeof t.name === "string") meta.name = t.name;
      if (Number.isFinite(t.gain)) {
        meta.gain = Math.max(0, Math.min(1, Number(t.gain)));
      }
      map.set(t.path, meta);
    }
  }
  return map;
}

async function main() {
  const files = await listAudioFiles();
  const current = await readCurrentIndex();
  const preserved = existingMetaByPath(current);

  const tracks = files.map((fileName) => {
    const trackPath = `/audio/${fileName}`;
    const prev = preserved.get(trackPath) ?? {};
    const track = {
      path: trackPath,
      name: prev.name ?? deriveName(fileName),
    };
    // Carry a non-default gain forward; omit the default (1) so
    // untouched tracks stay clean.
    if (prev.gain != null && prev.gain !== 1) track.gain = prev.gain;
    return track;
  });

  const out = { _comment: COMMENT, tracks };
  const next = JSON.stringify(out, null, 2) + "\n";
  const currentSerialized = current
    ? JSON.stringify(current, null, 2) + "\n"
    : "";
  if (current && currentSerialized === next) {
    console.log("reindex-audio: index.json already up to date.");
    return;
  }
  await fs.writeFile(INDEX_PATH, next, "utf8");
  console.log(`reindex-audio: wrote ${tracks.length} tracks.`);
  for (const t of tracks) {
    console.log(`  ${t.path}  →  ${t.name}`);
  }
}

main().catch((err) => {
  console.error("reindex-audio failed:", err);
  process.exit(1);
});
