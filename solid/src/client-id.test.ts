// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type ClientIdDocument, normalizeOrigin, rewriteClientIdOrigin } from "./client-id.js";

const here = dirname(fileURLToPath(import.meta.url));
const clientIdPath = join(here, "..", "public", "clientid.jsonld");

describe("normalizeOrigin", () => {
  it("returns a clean origin for a bare origin", () => {
    expect(normalizeOrigin("https://miniflux.example.com")).toBe("https://miniflux.example.com");
    expect(normalizeOrigin("https://miniflux.example.com/")).toBe("https://miniflux.example.com");
    expect(normalizeOrigin("https://miniflux.example.com:8443")).toBe(
      "https://miniflux.example.com:8443",
    );
  });

  it("throws on a non-http(s) scheme", () => {
    expect(() => normalizeOrigin("ftp://x")).toThrow(TypeError);
    expect(() => normalizeOrigin("javascript:alert(1)")).toThrow(TypeError);
  });

  it("throws when given a URL with a path/query/hash/credentials", () => {
    expect(() => normalizeOrigin("https://x.example/path")).toThrow(TypeError);
    expect(() => normalizeOrigin("https://x.example/?q=1")).toThrow(TypeError);
    expect(() => normalizeOrigin("https://x.example/#h")).toThrow(TypeError);
    expect(() => normalizeOrigin("https://user:pw@x.example")).toThrow(TypeError);
  });

  it("throws on a non-URL input", () => {
    expect(() => normalizeOrigin("not a url")).toThrow(TypeError);
  });
});

describe("rewriteClientIdOrigin", () => {
  const doc: ClientIdDocument = {
    client_id: "https://miniflux-solid.example.example/clientid.jsonld",
    client_uri: "https://miniflux-solid.example.example/",
    redirect_uris: ["https://miniflux-solid.example.example/callback.html"],
    "@type": "fedapp:App",
  };

  it("rewrites client_id, client_uri, and redirect_uris to the new origin (paths kept)", () => {
    const out = rewriteClientIdOrigin(doc, "https://reader.acme.io");
    expect(out.client_id).toBe("https://reader.acme.io/clientid.jsonld");
    expect(out.client_uri).toBe("https://reader.acme.io/");
    expect(out.redirect_uris).toEqual(["https://reader.acme.io/callback.html"]);
    // Unrelated fields preserved.
    expect(out["@type"]).toBe("fedapp:App");
  });

  it("preserves a non-root path + port", () => {
    const out = rewriteClientIdOrigin(doc, "https://reader.acme.io:9000");
    expect(out.client_id).toBe("https://reader.acme.io:9000/clientid.jsonld");
    expect(out.redirect_uris?.[0]).toBe("https://reader.acme.io:9000/callback.html");
  });

  it("does not mutate the input document", () => {
    const snapshot = JSON.stringify(doc);
    rewriteClientIdOrigin(doc, "https://reader.acme.io");
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it("throws on a malformed origin (never bakes a bad origin in)", () => {
    expect(() => rewriteClientIdOrigin(doc, "https://x.example/path")).toThrow(TypeError);
    expect(() => rewriteClientIdOrigin(doc, "ftp://x")).toThrow(TypeError);
  });
});

describe("public/clientid.jsonld — the committed federation client-id doc", () => {
  it("is valid JSON with the expected federation shape", async () => {
    const parsed = JSON.parse(await readFile(clientIdPath, "utf8")) as ClientIdDocument & {
      "fedapp:sector"?: string;
      "fedapp:produces"?: string[];
      "@type"?: string;
    };
    // client_id byte-matches its own served URL convention (placeholder origin).
    expect(parsed.client_id).toBe("https://miniflux-solid.example.example/clientid.jsonld");
    expect(parsed["@type"]).toBe("fedapp:App");
    expect(parsed["fedapp:sector"]).toBe("sectors:social#sector");
    // produces a pc:ChatRoom (chat-interop CanonicalMessages).
    expect(parsed["fedapp:produces"]).toContain("pc:ChatRoom");
    expect(parsed.token_endpoint_auth_method).toBe("none");
  });

  it("rewrites cleanly to a real origin (client_id byte-matches the served URL)", async () => {
    const parsed = JSON.parse(await readFile(clientIdPath, "utf8")) as ClientIdDocument;
    const origin = "https://reader.acme.io";
    const out = rewriteClientIdOrigin(parsed, origin);
    expect(out.client_id).toBe(`${origin}/clientid.jsonld`);
  });
});
