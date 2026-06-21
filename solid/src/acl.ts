// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The FAIL-CLOSED owner-only WAC ACL writer — the load-bearing security piece of
 * the Miniflux→Solid sync. Bakes in the Elk/Linkding roborev lessons:
 *
 *  1. Owner-only WAC: the owner WebID gets `acl:Read`/`acl:Write`/`acl:Control`
 *     over the resource (`acl:accessTo`) AND its descendants (`acl:default`).
 *     Nothing is public — no `acl:agentClass`, no foreign `acl:agent`.
 *  2. The ACL Turtle is built with `n3.Writer` + typed quads — NEVER
 *     hand-concatenated (house rule).
 *  3. `putAcl` THROWS on ANY non-2xx (a 4xx is never swallowed).
 *  4. `ensureOwnerPrivateContainer` is FAIL-CLOSED: the container body is written
 *     FIRST, then the `.acl`; if the ACL cannot be applied it THROWS and refuses
 *     to proceed — we never leave data in a container we could not lock down.
 *  5. The "ACL already owner-private" escape path validates POSITIVELY (the owner
 *     independently holds accessTo+default+Read+Write+Control) AND rejects ANY
 *     `acl:agentClass` (foaf:Agent / acl:AuthenticatedAgent) or foreign
 *     `acl:agent` grant. A negative "no public grant found" check is NOT enough.
 */
import { parseRdf } from "@jeswr/fetch-rdf";

const ACL = "http://www.w3.org/ns/auth/acl#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const ACL_AUTHORIZATION = `${ACL}Authorization`;
const ACL_AGENT = `${ACL}agent`;
// We reject ANY acl:agentClass grant regardless of class IRI (foaf:Agent /
// acl:AuthenticatedAgent / anything else), so no per-class constant is needed.
const ACL_AGENT_CLASS = `${ACL}agentClass`;
const ACL_AGENT_GROUP = `${ACL}agentGroup`;
const ACL_ACCESS_TO = `${ACL}accessTo`;
const ACL_DEFAULT = `${ACL}default`;
const ACL_MODE = `${ACL}mode`;
const ACL_READ = `${ACL}Read`;
const ACL_WRITE = `${ACL}Write`;
const ACL_CONTROL = `${ACL}Control`;

/** The required owner modes — accessTo + default must BOTH carry all three. */
const REQUIRED_MODES = [ACL_READ, ACL_WRITE, ACL_CONTROL] as const;

/** The ACL document URL for a resource/container URL (the `.acl` sibling). */
export function aclUrlFor(resourceUrl: string): string {
  // A trailing-slash container's ACL is `<container>.acl`; a resource's ACL is
  // `<resource>.acl`. The convention is identical: append `.acl`.
  return `${resourceUrl}.acl`;
}

/**
 * Build an owner-only WAC ACL Turtle document granting `ownerWebId`
 * Read/Write/Control over `resourceUrl` (`acl:accessTo`) and, if
 * `withDefault` is set, its descendants (`acl:default`). Built with `n3.Writer`
 * + typed quads — never hand-concatenated. Exported for testing.
 *
 * `withDefault` should be `true` for containers (so children inherit) and may be
 * `true` for resources too (harmless on a non-container). We always emit both so
 * the same lock-down applies whether the target is a container or a leaf.
 */
export async function buildOwnerOnlyAclTurtle(
  resourceUrl: string,
  ownerWebId: string,
  withDefault = true,
): Promise<string> {
  if (typeof ownerWebId !== "string" || ownerWebId.trim() === "") {
    throw new TypeError("buildOwnerOnlyAclTurtle: ownerWebId is required");
  }
  const { DataFactory, Store, Writer } = await import("n3");
  const { namedNode } = DataFactory;
  const store = new Store();
  const auth = namedNode(`${aclUrlFor(resourceUrl)}#owner`);
  store.addQuad(auth, namedNode(RDF_TYPE), namedNode(ACL_AUTHORIZATION));
  store.addQuad(auth, namedNode(ACL_AGENT), namedNode(ownerWebId));
  store.addQuad(auth, namedNode(ACL_ACCESS_TO), namedNode(resourceUrl));
  if (withDefault) {
    store.addQuad(auth, namedNode(ACL_DEFAULT), namedNode(resourceUrl));
  }
  for (const mode of REQUIRED_MODES) {
    store.addQuad(auth, namedNode(ACL_MODE), namedNode(mode));
  }
  const writer = new Writer({ format: "text/turtle", prefixes: { acl: ACL } });
  writer.addQuads([...store]);
  return new Promise<string>((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

/**
 * PUT an owner-only WAC ACL for `resourceUrl`. THROWS on ANY non-2xx response
 * (a 403/404/500 is never swallowed). `fetch` must be an authenticated Solid
 * fetch with Control on the resource.
 */
export async function putAcl(
  resourceUrl: string,
  ownerWebId: string,
  fetchImpl: typeof globalThis.fetch,
  withDefault = true,
): Promise<void> {
  const aclUrl = aclUrlFor(resourceUrl);
  const turtle = await buildOwnerOnlyAclTurtle(resourceUrl, ownerWebId, withDefault);
  const res = await fetchImpl(aclUrl, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: turtle,
  });
  if (!res.ok) {
    throw new Error(`putAcl: PUT ${aclUrl} failed -> ${res.status} ${res.statusText}`);
  }
}

/**
 * POSITIVE validation of an existing `.acl` body: confirm `ownerWebId`
 * INDEPENDENTLY holds Read+Write+Control on BOTH `acl:accessTo` and
 * `acl:default` for `resourceUrl`, AND that the document grants NOTHING to any
 * `acl:agentClass` (foaf:Agent / acl:AuthenticatedAgent / any other class), any
 * `acl:agentGroup`, or any foreign `acl:agent`. Returns `true` only when the
 * document is provably owner-only.
 *
 * This is deliberately strict: a negative "I found no public grant" check would
 * pass an ACL whose owner grants are incomplete or whose foreign grants use an
 * unrecognised class IRI. We require the owner's grants to be present AND every
 * authorization to be exclusively the owner's.
 */
export async function isOwnerOnlyAcl(
  aclBody: string,
  contentType: string | null,
  aclBaseIri: string,
  resourceUrl: string,
  ownerWebId: string,
): Promise<boolean> {
  let dataset: Awaited<ReturnType<typeof parseRdf>>;
  try {
    dataset = await parseRdf(aclBody, contentType, { baseIRI: aclBaseIri });
  } catch {
    // An unparseable ACL is NOT owner-private — fail closed.
    return false;
  }
  // `parseRdf` returns a DatasetCore whose `match` compares terms by value
  // (RDF/JS `.equals`), so externally-minted n3 NamedNodes match correctly.
  const { DataFactory } = await import("n3");
  const node = (iri: string) => DataFactory.namedNode(iri);

  // Every subject that is an acl:Authorization in the document.
  const authorizations = new Set<string>();
  for (const q of dataset.match(null, node(RDF_TYPE), node(ACL_AUTHORIZATION))) {
    authorizations.add(q.subject.value);
  }
  if (authorizations.size === 0) return false;

  // Hard reject: ANY agentClass or agentGroup grant anywhere in the document
  // means the ACL is not owner-only (regardless of which authorization it sits
  // on). This catches foaf:Agent / acl:AuthenticatedAgent and any other class.
  for (const _ of dataset.match(null, node(ACL_AGENT_CLASS), null)) {
    return false;
  }
  for (const _ of dataset.match(null, node(ACL_AGENT_GROUP), null)) {
    return false;
  }

  // Hard reject: ANY acl:agent that is not exactly the owner WebID.
  for (const q of dataset.match(null, node(ACL_AGENT), null)) {
    if (q.object.value !== ownerWebId) return false;
  }

  // POSITIVE: there must exist an authorization where the owner holds R/W/C on
  // accessTo for the resource, AND one where the owner holds R/W/C on default.
  const accessToOk = authorizationGrantsOwner(
    dataset,
    node,
    authorizations,
    ownerWebId,
    ACL_ACCESS_TO,
    resourceUrl,
  );
  const defaultOk = authorizationGrantsOwner(
    dataset,
    node,
    authorizations,
    ownerWebId,
    ACL_DEFAULT,
    resourceUrl,
  );
  return accessToOk && defaultOk;
}

/** A NamedNode factory bound to the dataset's term equality. */
type NodeFactory = (iri: string) => import("@rdfjs/types").NamedNode;

/**
 * Does some authorization in `authorizations` grant `ownerWebId` ALL of
 * Read+Write+Control, scoped to `resourceUrl` via `scopePredicate`
 * (acl:accessTo or acl:default)?
 */
function authorizationGrantsOwner(
  dataset: Awaited<ReturnType<typeof parseRdf>>,
  node: NodeFactory,
  authorizations: Set<string>,
  ownerWebId: string,
  scopePredicate: string,
  resourceUrl: string,
): boolean {
  for (const subject of authorizations) {
    const subjNode = node(subject);
    // The authorization must name the owner as agent.
    if (!hasObject(dataset, node, subjNode, ACL_AGENT, ownerWebId)) continue;
    // …and be scoped to the resource via the requested predicate.
    if (!hasObject(dataset, node, subjNode, scopePredicate, resourceUrl)) continue;
    // …and carry ALL required modes.
    if (REQUIRED_MODES.every((m) => hasObject(dataset, node, subjNode, ACL_MODE, m))) {
      return true;
    }
  }
  return false;
}

/** Does subject have predicate → object (by IRI string)? */
function hasObject(
  dataset: Awaited<ReturnType<typeof parseRdf>>,
  node: NodeFactory,
  subject: import("@rdfjs/types").NamedNode,
  predicate: string,
  object: string,
): boolean {
  for (const _ of dataset.match(subject, node(predicate), node(object))) {
    return true;
  }
  return false;
}

/**
 * Ensure a container exists and is locked down owner-only — FAIL-CLOSED.
 *
 * Order is load-bearing:
 *  1. Write the container body (idempotent PUT; a 2xx means it exists).
 *  2. Apply the owner-only `.acl` via {@link putAcl}.
 * If step 2 fails (ACL un-writable), this THROWS — we refuse to proceed so no
 * data is ever written into a container we could not lock down.
 *
 * Optionally, if `validateExisting` is set and an owner-private `.acl` already
 * exists (validated POSITIVELY via {@link isOwnerOnlyAcl}), the re-PUT of the
 * ACL is skipped — but a NON-owner-private or absent existing ACL is always
 * (re)written, and a write failure still throws.
 */
export async function ensureOwnerPrivateContainer(
  containerUrl: string,
  ownerWebId: string,
  fetchImpl: typeof globalThis.fetch,
  options: { validateExisting?: boolean } = {},
): Promise<void> {
  if (!containerUrl.endsWith("/")) {
    throw new TypeError(
      `ensureOwnerPrivateContainer: containerUrl must end with '/': ${containerUrl}`,
    );
  }
  // Step 1: ensure the container body exists. PUT is idempotent for an LDP
  // container at a trailing-slash URL. A non-2xx here means we cannot proceed.
  const putRes = await fetchImpl(containerUrl, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
  });
  if (!putRes.ok) {
    throw new Error(
      `ensureOwnerPrivateContainer: PUT ${containerUrl} failed -> ${putRes.status} ${putRes.statusText}`,
    );
  }

  // Step 2: lock it down. If asked, accept an already-correct owner-only ACL.
  if (options.validateExisting === true) {
    const aclUrl = aclUrlFor(containerUrl);
    let existing: Response | undefined;
    try {
      existing = await fetchImpl(aclUrl, { method: "GET" });
    } catch {
      existing = undefined;
    }
    if (existing?.ok) {
      const body = await existing.text();
      const ct = existing.headers.get("content-type");
      if (await isOwnerOnlyAcl(body, ct, aclUrl, containerUrl, ownerWebId)) {
        return; // already provably owner-only — nothing to do.
      }
    }
  }

  // (Re)apply the owner-only ACL. THROWS on any non-2xx — fail-closed.
  await putAcl(containerUrl, ownerWebId, fetchImpl, true);
}
