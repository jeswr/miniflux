// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import type { MinifluxEntry } from "./entry-mapper.js";
import { entryResourceSlug, saveEntryToPod } from "./save-entry.js";

const OWNER = "https://alice.pod.example/profile/card#me";
const BASE = "https://alice.pod.example/feeds/";

const ENTRY: MinifluxEntry = {
  id: 7,
  title: "Hello world",
  url: "https://news.example/posts/1",
  published_at: "2026-06-21T10:00:00Z",
  feed: { id: 3, title: "News", feed_url: "https://news.example/rss" },
};

function recordingFetch(responder: (url: string, init: RequestInit | undefined) => Response): {
  fetch: typeof globalThis.fetch;
  calls: Array<{ url: string; method: string; body?: string }>;
} {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return responder(url, init);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const ok = () => new Response("", { status: 201 });
const fail = (code: number) => new Response("", { status: code });

describe("entryResourceSlug", () => {
  it("uses the entry id when present", () => {
    expect(entryResourceSlug({ id: 7 })).toBe("entry-7");
  });

  it("is deterministic + traversal-safe for an id-less entry", () => {
    const a = entryResourceSlug({ url: "https://x.example/1", title: "t" });
    const b = entryResourceSlug({ url: "https://x.example/1", title: "t" });
    expect(a).toBe(b); // deterministic (idempotent re-sync)
    expect(a).toMatch(/^entry-h[a-z0-9]+$/); // no slash/dot/scheme — cannot escape
  });

  it("differs for different keys", () => {
    expect(entryResourceSlug({ url: "https://x.example/1" })).not.toBe(
      entryResourceSlug({ url: "https://x.example/2" }),
    );
  });
});

describe("saveEntryToPod — full owner-private flow", () => {
  it("locks the container+acl, then writes the body, then the resource acl (in order)", async () => {
    const { fetch, calls } = recordingFetch(() => ok());
    const result = await saveEntryToPod(ENTRY, { fetch, ownerWebId: OWNER, baseContainer: BASE });

    const room = "https://alice.pod.example/feeds/feeds/3/";
    const resource = `${room}entry-7`;
    expect(result).toEqual({ room, resource });

    const seq = calls.map((c) => `${c.method} ${c.url}`);
    expect(seq).toEqual([
      `PUT ${room}`, // 1. container body
      `PUT ${room}.acl`, // 2. container acl
      `PUT ${resource}`, // 3. message body
      `PUT ${resource}.acl`, // 4. message acl
    ]);

    // The message body must be chat-interop AS2.0 turtle (typed serialiser).
    const bodyCall = calls.find((c) => c.url === resource);
    expect(bodyCall?.body).toContain("Note"); // as:Note
    expect(bodyCall?.body).toContain("Hello world"); // the title as content
    expect(bodyCall?.body).toContain("https://news.example/posts/1"); // derivedFrom
  });

  it("FAIL-CLOSED: throws and writes NO body when the container ACL cannot be applied", async () => {
    const room = "https://alice.pod.example/feeds/feeds/3/";
    const { fetch, calls } = recordingFetch((url, init) => {
      if (url === room && init?.method === "PUT") return ok(); // container body OK
      if (url === `${room}.acl`) return fail(403); // container ACL fails
      return ok();
    });
    await expect(
      saveEntryToPod(ENTRY, { fetch, ownerWebId: OWNER, baseContainer: BASE }),
    ).rejects.toThrow(/403/);

    // Crucially: the message body PUT must NEVER have happened.
    const wroteBody = calls.some((c) => c.url === `${room}entry-7` && c.method === "PUT");
    expect(wroteBody).toBe(false);
    // Only the container body + the (failed) container ACL were attempted.
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`PUT ${room}`, `PUT ${room}.acl`]);
  });

  it("throws when the message body PUT fails (after the container is locked)", async () => {
    const room = "https://alice.pod.example/feeds/feeds/3/";
    const resource = `${room}entry-7`;
    const { fetch, calls } = recordingFetch((url, init) => {
      if (url === resource && init?.method === "PUT") return fail(500); // body fails
      return ok();
    });
    await expect(
      saveEntryToPod(ENTRY, { fetch, ownerWebId: OWNER, baseContainer: BASE }),
    ).rejects.toThrow(/500/);
    // The resource ACL must NOT be written if the body failed.
    expect(calls.some((c) => c.url === `${resource}.acl`)).toBe(false);
  });

  it("throws when the message resource ACL PUT fails", async () => {
    const room = "https://alice.pod.example/feeds/feeds/3/";
    const resource = `${room}entry-7`;
    const { fetch } = recordingFetch((url, init) => {
      if (url === `${resource}.acl` && init?.method === "PUT") return fail(403);
      return ok();
    });
    await expect(
      saveEntryToPod(ENTRY, { fetch, ownerWebId: OWNER, baseContainer: BASE }),
    ).rejects.toThrow(/403/);
  });
});
