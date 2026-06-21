// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * `miniflux-solid-sync` — a self-contained TypeScript integration layer that
 * syncs a Miniflux fork's saved RSS/Atom entries into a user's Solid pod.
 *
 * The Go core of Miniflux is UNTOUCHED. This module is the deploy-deferred
 * TypeScript bridge: it maps saved entries onto the suite-canonical
 * `@jeswr/solid-chat-interop` `CanonicalMessage` (so a saved feed item is
 * readable by every other suite chat/feed consumer), writes them owner-private
 * (fail-closed WAC ACL), mirrors read/starred state to a pod KV, serialises the
 * subscription list as an `as:Collection`, and self-describes as a federation
 * member (`fedreg:Membership`).
 *
 * @packageDocumentation
 */

// --- the fail-closed owner-only WAC ACL writer ---
export {
  aclUrlFor,
  buildOwnerOnlyAclTurtle,
  ensureOwnerPrivateContainer,
  isOwnerOnlyAcl,
  putAcl,
} from "./acl.js";
// --- client-id document origin rewrite ---
export {
  type ClientIdDocument,
  normalizeOrigin,
  rewriteClientIdOrigin,
} from "./client-id.js";
// --- entry → canonical message mapping ---
export {
  entryToCanonical,
  feedRoomIri,
  type MinifluxEntry,
  type MinifluxFeed,
} from "./entry-mapper.js";
// --- federation membership artifact ---
export {
  type BuildMembershipRegistryInput,
  buildMembershipRegistry,
  FED_IRIS,
  MAINTAINER_WEBID_PLACEHOLDER,
} from "./federation.js";
// --- thin browser login wiring (not part of the unit-tested core) ---
export {
  INTERACTIVE_LOGIN_IS_USER_INITIATED,
  type SilentRestoreOptions,
  trySilentRestore,
} from "./login.js";
// --- save an entry to the pod (owner-private, fail-closed) ---
export {
  entryResourceSlug,
  type SaveEntryOptions,
  type SaveEntryResult,
  saveEntryToPod,
} from "./save-entry.js";
// --- read/starred state mirror (pod KV via unstorage-solid) ---
export {
  type EntryState,
  mirrorState,
  readState,
  stateKey,
} from "./state-mirror.js";
// --- subscription list as an as:Collection ---
export {
  type SubscriptionFeed,
  serializeSubscriptions,
  toSubscriptionFeed,
} from "./subscriptions.js";
