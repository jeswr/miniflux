// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { serializeSubscriptions, toSubscriptionFeed } from "./subscriptions.js";

const { namedNode } = DataFactory;
const COLLECTION = "https://alice.pod.example/feeds/subscriptions";
const AS = "https://www.w3.org/ns/activitystreams#";
const SCHEMA = "http://schema.org/";
const DCT = "http://purl.org/dc/terms/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

describe("toSubscriptionFeed", () => {
  it("maps the present feed fields, omitting absent ones", () => {
    expect(toSubscriptionFeed({ id: 1, title: "T", feed_url: "https://x/rss" })).toEqual({
      id: 1,
      title: "T",
      feed_url: "https://x/rss",
    });
    expect(toSubscriptionFeed({})).toEqual({});
  });
});

describe("serializeSubscriptions", () => {
  it("emits an as:Collection with schema:url + dct:title items (round-trips through parseRdf)", async () => {
    const turtle = await serializeSubscriptions(COLLECTION, [
      { id: 1, title: "News", feed_url: "https://news.example/rss" },
      { id: 2, title: "Blog", feed_url: "https://blog.example/atom" },
    ]);
    const store = await parseRdf(turtle, "text/turtle", { baseIRI: COLLECTION });

    // The root is an as:Collection.
    const types = [
      ...store.match(namedNode(COLLECTION), namedNode(RDF_TYPE), namedNode(`${AS}Collection`)),
    ];
    expect(types).toHaveLength(1);

    // Two items, each with a schema:url.
    const urls = [...store.match(null, namedNode(`${SCHEMA}url`), null)].map((q) => q.object.value);
    expect(urls.sort()).toEqual(["https://blog.example/atom", "https://news.example/rss"]);

    // Titles present via dct:title.
    const titles = [...store.match(null, namedNode(`${DCT}title`), null)].map(
      (q) => q.object.value,
    );
    expect(titles.sort()).toEqual(["Blog", "News"]);

    // totalItems = 2
    const total = [...store.match(null, namedNode(`${AS}totalItems`), null)].map(
      (q) => q.object.value,
    );
    expect(total).toEqual(["2"]);
  });

  it("DROPS a feed with a hostile (javascript:) URL — never serialised", async () => {
    const turtle = await serializeSubscriptions(COLLECTION, [
      { id: 1, title: "Bad", feed_url: "javascript:alert(1)" },
      { id: 2, title: "Good", feed_url: "https://good.example/rss" },
    ]);
    expect(turtle).not.toContain("javascript:");
    expect(turtle).toContain("https://good.example/rss");
    // totalItems counts only the included feed.
    const store = await parseRdf(turtle, "text/turtle", { baseIRI: COLLECTION });
    const total = [...store.match(null, namedNode(`${AS}totalItems`), null)].map(
      (q) => q.object.value,
    );
    expect(total).toEqual(["1"]);
  });

  it("falls back to site_url when feed_url is missing/hostile", async () => {
    const turtle = await serializeSubscriptions(COLLECTION, [
      { id: 1, title: "X", site_url: "https://x.example/" },
    ]);
    expect(turtle).toContain("https://x.example/");
  });

  it("drops a feed with NO valid url (both missing)", async () => {
    const turtle = await serializeSubscriptions(COLLECTION, [{ id: 1, title: "no-url" }]);
    const store = await parseRdf(turtle, "text/turtle", { baseIRI: COLLECTION });
    const total = [...store.match(null, namedNode(`${AS}totalItems`), null)].map(
      (q) => q.object.value,
    );
    expect(total).toEqual(["0"]);
  });

  it("serialises an empty subscription list (empty as:Collection, totalItems 0)", async () => {
    const turtle = await serializeSubscriptions(COLLECTION, []);
    expect(turtle).toContain("Collection");
    const store = await parseRdf(turtle, "text/turtle", { baseIRI: COLLECTION });
    const total = [...store.match(null, namedNode(`${AS}totalItems`), null)].map(
      (q) => q.object.value,
    );
    expect(total).toEqual(["0"]);
  });

  it("throws on a non-http(s) collection URL", async () => {
    await expect(serializeSubscriptions("ftp://x/", [])).rejects.toThrow(TypeError);
  });
});
