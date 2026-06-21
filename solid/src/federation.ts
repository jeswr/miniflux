// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Emit the federation membership artifact for the Miniflux→Solid app: a
 * `fedreg:Registry` Turtle document with one `fedreg:Membership(status:Active)`
 * asserting this app is a member of the suite federation. Built via
 * `@jeswr/federation-registry`'s `buildRegistry` (typed RDF; never hand-built).
 *
 * Federation IRIs (verified canonical):
 *  - fedapp namespace:  https://w3id.org/jeswr/fed#
 *  - social sector:     https://w3id.org/jeswr/sectors/social#sector
 *  - fedreg namespace:  https://w3id.org/jeswr/fedreg#
 *
 * The asserting authority (`fedreg:assertedBy`) MUST be a real maintainer WebID
 * the federation trusts — a self-asserted membership is meaningless. We carry a
 * PLACEHOLDER here; see the `// needs:user` note below.
 */
import { buildRegistry } from "@jeswr/federation-registry";

/**
 * needs:user — the real authority WebID asserting this app's federation
 * membership. A registry membership is only trustworthy when `assertedBy` names
 * an authority a consumer trusts; this placeholder MUST be replaced with the
 * maintainer's actual WebID before any membership artifact is published/served.
 */
export const MAINTAINER_WEBID_PLACEHOLDER =
  "https://w3id.org/jeswr/PLACEHOLDER-maintainer-webid#me";

/** The canonical federation IRIs this app declares. */
export const FED_IRIS = {
  fedapp: "https://w3id.org/jeswr/fed#",
  socialSector: "https://w3id.org/jeswr/sectors/social#sector",
  fedreg: "https://w3id.org/jeswr/fedreg#",
  /** The pod-chat class this app produces (chat-interop CanonicalMessages). */
  pcChatRoom: "https://w3id.org/jeswr/pod-chat#ChatRoom",
} as const;

export interface BuildMembershipRegistryInput {
  /** The registry document's IRI. */
  readonly registryId: string;
  /** This app's `client_id` IRI (the served clientid.jsonld URL). */
  readonly clientId: string;
  /**
   * The authority WebID asserting the membership. Defaults to
   * {@link MAINTAINER_WEBID_PLACEHOLDER} — supply the real WebID in production.
   */
  readonly assertedBy?: string;
  /** Optional explicit membership-record IRI (defaults to a registry-anchored one). */
  readonly membershipId?: string;
  /** Optional assertion timestamp (xsd:dateTime lexical; defaults to "now"). */
  readonly asserted?: string;
}

/**
 * Build a `fedreg:Registry` membership artifact for this app. Returns a
 * `BuiltGraph` ({ quads, toString(format?) }) — call `.toString()` for Turtle.
 */
export function buildMembershipRegistry(input: BuildMembershipRegistryInput) {
  if (typeof input.registryId !== "string" || input.registryId.trim() === "") {
    throw new TypeError("buildMembershipRegistry: registryId is required");
  }
  if (typeof input.clientId !== "string" || input.clientId.trim() === "") {
    throw new TypeError("buildMembershipRegistry: clientId is required");
  }
  const assertedBy = input.assertedBy ?? MAINTAINER_WEBID_PLACEHOLDER;
  const membershipId = input.membershipId ?? `${input.registryId}#m-miniflux`;
  return buildRegistry({
    id: input.registryId,
    members: [
      {
        id: membershipId,
        app: input.clientId,
        status: "Active",
        assertedBy,
        ...(input.asserted !== undefined ? { asserted: input.asserted } : {}),
      },
    ],
  });
}
