// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Client Identifier Document helpers.
 *
 * Solid-OIDC REQUIRES that a served Client ID Document's `client_id` BYTE-MATCH
 * the URL it is served from (origin-aware). A static committed file cannot know
 * its deploy origin, so the committed `public/clientid.jsonld` uses the
 * `https://miniflux-solid.example.example/` placeholder origin; at serve/build
 * time the origin must be rewritten to the real one.
 *
 * {@link rewriteClientIdOrigin} performs that rewrite deterministically: it
 * replaces the origin of `client_id`, `client_uri`, and every `redirect_uris`
 * entry with the supplied origin, leaving the PATHS intact. It validates the
 * origin is a clean http(s) origin (scheme + host [+ port], no path/query/hash)
 * and throws otherwise — so a malformed origin can never be baked into a served
 * doc.
 */

export interface ClientIdDocument {
  client_id: string;
  client_uri?: string;
  redirect_uris?: string[];
  [key: string]: unknown;
}

/**
 * Normalise + validate an origin string into a clean `scheme://host[:port]`
 * (no trailing slash, no path/query/hash). Throws on a non-http(s) or
 * non-origin input.
 */
export function normalizeOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new TypeError(`normalizeOrigin: not a valid URL: ${origin}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError(`normalizeOrigin: origin must be http(s): ${origin}`);
  }
  // Reject anything beyond a bare origin (path/query/hash/credentials).
  if (
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new TypeError(`normalizeOrigin: expected a bare origin, got: ${origin}`);
  }
  return url.origin;
}

/** Replace the origin of an absolute URL with `origin`, keeping path+query+hash. */
function withOrigin(absoluteUrl: string, origin: string): string {
  const u = new URL(absoluteUrl); // the placeholder doc holds absolute URLs
  const target = new URL(origin);
  u.protocol = target.protocol;
  u.host = target.host; // host includes port
  return u.toString();
}

/**
 * Return a COPY of `doc` with `client_id`, `client_uri`, and every
 * `redirect_uris` entry rewritten to `origin` (paths preserved). The returned
 * doc's `client_id` byte-matches `${origin}/clientid.jsonld` when served from
 * that path — satisfying Solid-OIDC's origin-match requirement.
 */
export function rewriteClientIdOrigin(doc: ClientIdDocument, origin: string): ClientIdDocument {
  const clean = normalizeOrigin(origin);
  const out: ClientIdDocument = { ...doc, client_id: withOrigin(doc.client_id, clean) };
  if (typeof doc.client_uri === "string") {
    out.client_uri = withOrigin(doc.client_uri, clean);
  }
  if (Array.isArray(doc.redirect_uris)) {
    out.redirect_uris = doc.redirect_uris.map((r) =>
      typeof r === "string" ? withOrigin(r, clean) : r,
    );
  }
  return out;
}
