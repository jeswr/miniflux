// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * THIN, browser-only login wiring for the Miniflux→Solid sync. This module is
 * intentionally NOT part of the gated, unit-tested core (it depends on browser
 * globals: `customElements`, IndexedDB, the OIDC redirect lifecycle). The gate
 * covers the testable logic (mapping, ACL writer, subscription/state mirror,
 * federation artifacts, client-id rewrite). See solid/README.md.
 *
 * Two hard UX rules baked in (suite cross-app invariants):
 *
 *  1. SILENT SESSION RESTORE ON LOAD — on page load, attempt a silent
 *     refresh-token-grant restore via `@jeswr/solid-session-restore`'s
 *     `restoreSession` (a DPoP-bound refresh grant — NO redirect, NO iframe, NO
 *     interactive popup). `decideSilentRestore` / `shouldDropRememberedPointer`
 *     (also from that package) drive the keep/drop pointer matrix for a
 *     multi-account host page.
 *  2. INTERACTIVE LOGIN ONLY ON EXPLICIT USER ACTION — the
 *     `<authorization-code-flow>` web component (`@solid/reactive-authentication`)
 *     is mounted only when the user explicitly clicks "Connect a Solid pod". The
 *     served Client ID Document (public/clientid.jsonld, origin-rewritten — see
 *     client-id.ts) gives the consent screen this app's stable name.
 *
 * This file is a typed wiring seam + guidance; the concrete DOM mounting is left
 * to the host page (Miniflux's template) to call.
 */
import {
  type RestoredSession,
  restoreSession,
  type SessionStore,
} from "@jeswr/solid-session-restore";

export interface SilentRestoreOptions {
  /** The durable, WebID/issuer-scoped credential store (e.g. IndexedDbSessionStore). */
  readonly store: SessionStore;
  /** The issuer (OP) the persisted session belongs to. */
  readonly issuer: URL;
  /**
   * The Client ID Document URL (origin-rewritten — see {@link
   * rewriteClientIdOrigin} in client-id.ts). MUST byte-match the URL the doc is
   * served from, and the clientId the original login used.
   */
  readonly clientId: string;
}

/**
 * Attempt a SILENT session restore on load. Returns the {@link RestoredSession}
 * (WebID + DPoP-bound access token + handle), or `undefined` when there is
 * nothing to restore / restore fails — in which case the host page shows the
 * login affordance and must NOT auto-redirect.
 *
 * No interactive popup, redirect, or iframe is triggered here. The host builds a
 * DPoP-attaching authenticated `fetch` from the returned `accessToken` +
 * `dpopHandle` (the same seam every suite app uses).
 */
export async function trySilentRestore(
  options: SilentRestoreOptions,
): Promise<RestoredSession | undefined> {
  try {
    return await restoreSession({
      store: options.store,
      issuer: options.issuer,
      clientId: options.clientId,
    });
  } catch {
    // A genuine restore failure → fall back to the login affordance (fail-closed:
    // never assert a session we could not actually rebuild).
    return undefined;
  }
}

/**
 * Documentation-only marker for the INTERACTIVE login path. The host page mounts
 * the `<authorization-code-flow>` custom element ONLY in response to an explicit
 * user click — never on load. Example host wiring (browser):
 *
 * ```html
 * <!-- only injected AFTER the user clicks "Connect a Solid pod" -->
 * <authorization-code-flow
 *   client-id="https://<your-origin>/clientid.jsonld"
 *   redirect-uri="https://<your-origin>/callback.html">
 * </authorization-code-flow>
 * ```
 *
 * The `<authorization-code-flow>` element comes from
 * `@solid/reactive-authentication` (a first-party suite package, browser-only).
 */
export const INTERACTIVE_LOGIN_IS_USER_INITIATED = true;
