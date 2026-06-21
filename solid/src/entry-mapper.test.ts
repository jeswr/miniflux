// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { entryToCanonical, feedRoomIri, type MinifluxEntry } from "./entry-mapper.js";

const BASE = "https://alice.pod.example/feeds/";

describe("feedRoomIri", () => {
  it("derives a per-feed collection IRI from the feed id", () => {
    expect(feedRoomIri(BASE, { id: 42 })).toBe("https://alice.pod.example/feeds/feeds/42/");
  });

  it("adds a trailing slash to the base when missing", () => {
    expect(feedRoomIri("https://alice.pod.example/x", { id: 1 })).toBe(
      "https://alice.pod.example/x/feeds/1/",
    );
  });

  it("falls back to the base container when no feed id is known", () => {
    expect(feedRoomIri(BASE, undefined)).toBe(BASE);
    expect(feedRoomIri(BASE, {})).toBe(BASE);
  });

  it("ignores a non-integer / negative feed id (falls back to base)", () => {
    expect(feedRoomIri(BASE, { id: -3 })).toBe(BASE);
    expect(feedRoomIri(BASE, { id: 1.5 })).toBe(BASE);
  });

  it("throws on a non-http(s) base container", () => {
    expect(() => feedRoomIri("javascript:alert(1)", { id: 1 })).toThrow(TypeError);
    expect(() => feedRoomIri("ftp://x/", { id: 1 })).toThrow(TypeError);
  });
});

describe("entryToCanonical — happy path", () => {
  it("maps title->content, published_at->published, permalink->derivedFrom, feed->room", () => {
    const entry: MinifluxEntry = {
      id: 7,
      title: "A great article",
      url: "https://news.example/posts/1",
      published_at: "2026-06-21T10:00:00Z",
      feed: { id: 3, title: "News", feed_url: "https://news.example/rss" },
    };
    const msg = entryToCanonical(entry, BASE);
    expect(msg.content).toBe("A great article");
    expect(msg.published).toBe("2026-06-21T10:00:00.000Z");
    expect(msg.mediaType).toBe("text/plain");
    expect(msg.room).toBe("https://alice.pod.example/feeds/feeds/3/");
    expect(msg.provenance?.derivedFrom).toBe("https://news.example/posts/1");
  });

  it("normalises a non-ISO but parseable date to ISO-8601", () => {
    const msg = entryToCanonical(
      { title: "t", published_at: "Sat, 21 Jun 2026 10:00:00 GMT" },
      BASE,
    );
    expect(msg.published).toBe("2026-06-21T10:00:00.000Z");
  });
});

describe("entryToCanonical — hostile / malformed inputs (drop, never throw)", () => {
  it("DROPS a javascript: permalink (no provenance.derivedFrom)", () => {
    const msg = entryToCanonical({ title: "t", url: "javascript:alert(document.cookie)" }, BASE);
    expect(msg.provenance).toBeUndefined();
    expect(msg.content).toBe("t");
  });

  it("DROPS a data: permalink", () => {
    const msg = entryToCanonical({ title: "t", url: "data:text/html,<script>" }, BASE);
    expect(msg.provenance).toBeUndefined();
  });

  it("DROPS a garbage / unparseable date (no published)", () => {
    const msg = entryToCanonical({ title: "t", published_at: "not-a-date" }, BASE);
    expect(msg.published).toBeUndefined();
  });

  it("DROPS an empty-string date", () => {
    const msg = entryToCanonical({ title: "t", published_at: "   " }, BASE);
    expect(msg.published).toBeUndefined();
  });

  it("yields an empty-string body for a missing title (never throws)", () => {
    const msg = entryToCanonical({ url: "https://x.example/1" }, BASE);
    expect(msg.content).toBe("");
    // the source still rides as provenance
    expect(msg.provenance?.derivedFrom).toBe("https://x.example/1");
  });

  it("ignores a wrong-typed title (treated as missing)", () => {
    const msg = entryToCanonical(
      { title: 123 as unknown as string, url: "https://x.example/1" },
      BASE,
    );
    expect(msg.content).toBe("");
  });

  it("never throws on a fully-empty entry", () => {
    expect(() => entryToCanonical({}, BASE)).not.toThrow();
    const msg = entryToCanonical({}, BASE);
    expect(msg.content).toBe("");
    expect(msg.room).toBe(BASE);
  });
});
