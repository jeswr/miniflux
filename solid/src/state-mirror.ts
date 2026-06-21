// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Mirror an entry's read/starred flags to a pod KV store via
 * `@jeswr/unstorage-solid`. The KV is an `unstorage` storage built from
 * `solidDriver({ base, fetch })` — the per-entry state document lives under
 * `base` as an LDP resource, addressed by a sanitised key.
 *
 * The caller owns building the storage (so the authed `fetch` + base are
 * injected once); this module is the typed read/write seam over it. The state
 * KV `base` SHOULD itself be an owner-private container — lock it down with
 * {@link ensureOwnerPrivateContainer} (acl.ts) before mirroring state into it.
 */
import type { Storage } from "unstorage";

/** The mirrored per-entry state. */
export interface EntryState {
  readonly read: boolean;
  readonly starred: boolean;
}

/**
 * Map a Miniflux entry id to a traversal-safe storage key. Only digits survive,
 * so the key can never escape the KV base (no `/`, `.`, scheme). A non-integer
 * id throws (we never write to an unpredictable key).
 */
export function stateKey(entryId: number): string {
  if (!Number.isInteger(entryId) || entryId < 0) {
    throw new TypeError(`stateKey: entryId must be a non-negative integer, got ${entryId}`);
  }
  return `entry-${entryId}.json`;
}

/**
 * Mirror an entry's read/starred state to the pod KV. Overwrites in place
 * (idempotent). The value is a small JSON object `{ read, starred }`.
 */
export async function mirrorState(
  storage: Storage,
  entryId: number,
  state: EntryState,
): Promise<void> {
  const value: EntryState = {
    read: state.read === true,
    starred: state.starred === true,
  };
  await storage.setItem(stateKey(entryId), JSON.stringify(value));
}

/**
 * Read an entry's mirrored state from the pod KV, or `null` if none is stored
 * (or the stored value is malformed — a corrupt KV entry never throws, it reads
 * as "no state"). Untrusted stored input is shape-validated.
 */
export async function readState(storage: Storage, entryId: number): Promise<EntryState | null> {
  const raw = await storage.getItem(stateKey(entryId));
  if (raw === null || raw === undefined) return null;
  const parsed = coerceState(raw);
  return parsed;
}

/** Validate/normalise an untrusted stored value into {@link EntryState} or null. */
function coerceState(raw: unknown): EntryState | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const rec = obj as Record<string, unknown>;
  return {
    read: rec.read === true,
    starred: rec.starred === true,
  };
}
