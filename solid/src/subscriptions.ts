// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Serialise a Miniflux subscription list as an ActivityStreams 2.0
 * `as:Collection` of feed pointers, built with `n3.Writer` + typed quads (never
 * hand-concatenated triples — house rule).
 *
 * Design choice (documented in solid/README.md): chat-interop ships NO
 * subscription-list serialiser, and the suite rule is to reuse an existing term
 * rather than mint a new one OR add a brand-new sector. `as:Collection` whose
 * items carry `schema:url` (the feed URL) + `dct:title` (the feed title) needs
 * NO new vocabulary term, so we use it directly — preferred over inventing a
 * `pc:`/`fed*` subscription term. Each item is an `as:OrderedCollectionPage`-free
 * plain pointer node; the collection root is an `as:Collection`.
 *
 * Every feed URL is `safeIri`-filtered (http(s) only) on write so a hostile
 * `feed_url`/`site_url` is dropped, never serialised.
 */
import { safeIri } from "@jeswr/solid-chat-interop";
import type { MinifluxFeed } from "./entry-mapper.js";

const AS = "https://www.w3.org/ns/activitystreams#";
const DCT = "http://purl.org/dc/terms/";
const SCHEMA = "http://schema.org/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const AS_COLLECTION = `${AS}Collection`;
const AS_ITEMS = `${AS}items`;
const AS_TOTAL_ITEMS = `${AS}totalItems`;
const SCHEMA_URL = `${SCHEMA}url`;
const DCT_TITLE = `${DCT}title`;
const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";

/** A feed pointer in the subscription collection. */
export interface SubscriptionFeed {
  /** The feed's stable id (used to mint the item IRI under `collectionUrl`). */
  readonly id?: number;
  readonly title?: string;
  readonly feed_url?: string;
  readonly site_url?: string;
}

/** Map a Miniflux feed onto the {@link SubscriptionFeed} pointer shape. */
export function toSubscriptionFeed(feed: MinifluxFeed): SubscriptionFeed {
  return {
    ...(feed.id !== undefined ? { id: feed.id } : {}),
    ...(feed.title !== undefined ? { title: feed.title } : {}),
    ...(feed.feed_url !== undefined ? { feed_url: feed.feed_url } : {}),
    ...(feed.site_url !== undefined ? { site_url: feed.site_url } : {}),
  };
}

/**
 * Serialise a subscription list as an `as:Collection` Turtle document rooted at
 * `collectionUrl`. Each feed becomes an item node carrying `schema:url` (the
 * feed URL, http(s)-filtered; falls back to the site URL) and `dct:title`.
 * A feed with NO valid http(s) URL is dropped (never serialised).
 */
export async function serializeSubscriptions(
  collectionUrl: string,
  feeds: readonly SubscriptionFeed[],
): Promise<string> {
  const safeCollection = safeIri(collectionUrl);
  if (safeCollection === undefined) {
    throw new TypeError(`serializeSubscriptions: collectionUrl is not http(s): ${collectionUrl}`);
  }
  const { DataFactory, Store, Writer } = await import("n3");
  const { namedNode, blankNode, literal } = DataFactory;
  const store = new Store();
  const root = namedNode(safeCollection);
  store.addQuad(root, namedNode(RDF_TYPE), namedNode(AS_COLLECTION));

  let included = 0;
  for (const feed of feeds) {
    const url = safeIri(feed.feed_url) ?? safeIri(feed.site_url);
    if (url === undefined) continue; // hostile/missing URL — drop, never serialise.
    // A stable item IRI when the feed has an id; a blank node otherwise.
    const item =
      feed.id !== undefined && Number.isInteger(feed.id) && feed.id >= 0
        ? namedNode(`${ensureSlash(safeCollection)}feed-${feed.id}`)
        : blankNode();
    store.addQuad(root, namedNode(AS_ITEMS), item);
    store.addQuad(item, namedNode(SCHEMA_URL), namedNode(url));
    if (typeof feed.title === "string" && feed.title.trim() !== "") {
      store.addQuad(item, namedNode(DCT_TITLE), literal(feed.title.trim()));
    }
    included++;
  }
  store.addQuad(root, namedNode(AS_TOTAL_ITEMS), literal(String(included), namedNode(XSD_INTEGER)));

  const writer = new Writer({
    format: "text/turtle",
    prefixes: { as: AS, dct: DCT, schema: SCHEMA },
  });
  writer.addQuads([...store]);
  return new Promise<string>((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

function ensureSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}
