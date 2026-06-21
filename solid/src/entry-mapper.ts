// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Map a Miniflux saved entry onto the suite-canonical chat-interop
 * {@link CanonicalMessage} hub, so a saved feed item written by Miniflux is
 * readable by every other suite chat/feed consumer (the Pod Manager "Solid
 * Community" view, the chat interop reconciler, …) with no Miniflux-specific
 * code.
 *
 * Mapping (Miniflux entry → CanonicalMessage):
 *  - `title`          → `content`        (the human-readable message body)
 *  - `published_at`   → `published`      (ISO-8601, parse-validated; → dct:created)
 *  - `url` (permalink)→ `provenance.derivedFrom` (prov:wasDerivedFrom — honest
 *                       "where this came from" attribution; doubles as the
 *                       schema:url/as:url "source" the task spec asks for)
 *  - the per-feed collection IRI → `room` (the source feed = a `pc:ChatRoom`)
 *
 * Untrusted-input discipline (mirrors `@jeswr/solid-granary`'s `map.ts`): a
 * wrong-typed field is ignored, every IRI is `safeIri`-filtered (http(s) only —
 * a `javascript:` permalink is DROPPED), every date is parse-validated. A
 * malformed field drops; this function NEVER throws.
 */
import { type CanonicalMessage, DEFAULT_MEDIA_TYPE, safeIri } from "@jeswr/solid-chat-interop";

/** The Miniflux feed shape carried on a saved entry (the fields we read). */
export interface MinifluxFeed {
  readonly id?: number;
  readonly title?: string;
  readonly site_url?: string;
  readonly feed_url?: string;
}

/** The Miniflux saved-entry shape (the subset this mapper reads). */
export interface MinifluxEntry {
  readonly id?: number;
  readonly title?: string;
  /** The entry permalink (the article URL). */
  readonly url?: string;
  readonly content?: string;
  /** ISO-8601 publish stamp. */
  readonly published_at?: string;
  readonly feed?: MinifluxFeed;
}

/**
 * The per-feed `pc:ChatRoom` collection IRI an entry's message belongs to. We
 * derive it deterministically from the feed id under a `feeds/<id>/` container
 * so entries from the same feed share a stable room IRI. Falls back to the base
 * container itself when no feed id is known. `baseContainer` MUST be an
 * http(s) container IRI ending in `/`.
 */
export function feedRoomIri(baseContainer: string, feed: MinifluxFeed | undefined): string {
  const safeBase = safeIri(baseContainer);
  if (safeBase === undefined) {
    throw new TypeError(`feedRoomIri: baseContainer is not an http(s) IRI: ${baseContainer}`);
  }
  const withSlash = safeBase.endsWith("/") ? safeBase : `${safeBase}/`;
  if (feed?.id !== undefined && Number.isInteger(feed.id) && feed.id >= 0) {
    return `${withSlash}feeds/${feed.id}/`;
  }
  return withSlash;
}

/** Parse-validate an untrusted date string → ISO-8601, or `undefined`. */
function isoDateOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** First non-empty trimmed string of the given candidates, or `undefined`. */
function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return undefined;
}

/**
 * Map a single Miniflux saved entry → {@link CanonicalMessage}.
 *
 * The body (`content`) is the entry title (falling back to the entry's HTML
 * content's plain text length-bounded preview only if there is no title; a
 * title-less, content-less entry yields an empty-string body, never a throw).
 * `room` is the per-feed collection IRI; the permalink rides as
 * `provenance.derivedFrom` (prov:wasDerivedFrom).
 *
 * @param entry The (untrusted) Miniflux entry.
 * @param baseContainer The owner's base container IRI (http(s), trailing slash).
 */
export function entryToCanonical(entry: MinifluxEntry, baseContainer: string): CanonicalMessage {
  // Body: the title is the canonical message content. A title-less entry falls
  // back to the empty string (never throws) — the permalink still carries the
  // source, so the message is meaningful even with an empty body.
  const content = firstNonEmpty(entry.title) ?? "";

  const published = isoDateOrUndefined(entry.published_at);

  // The source feed is the room (a pc:ChatRoom collection IRI).
  const room = feedRoomIri(baseContainer, entry.feed);

  // The entry permalink — provenance, not identity. safeIri DROPS a
  // javascript:/data: permalink (an attacker-controlled feed URL).
  const derivedFrom = safeIri(entry.url);

  const msg: CanonicalMessage = {
    content,
    mediaType: DEFAULT_MEDIA_TYPE,
    room,
  };
  if (published !== undefined) msg.published = published;
  if (derivedFrom !== undefined) {
    msg.provenance = { derivedFrom };
  }
  return msg;
}
