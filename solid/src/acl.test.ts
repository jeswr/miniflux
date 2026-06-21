// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it, vi } from "vitest";
import {
  aclUrlFor,
  buildOwnerOnlyAclTurtle,
  ensureOwnerPrivateContainer,
  isOwnerOnlyAcl,
  putAcl,
} from "./acl.js";

const OWNER = "https://alice.pod.example/profile/card#me";
const CONTAINER = "https://alice.pod.example/feeds/feeds/3/";
const RESOURCE = "https://alice.pod.example/feeds/feeds/3/entry-7";

/** A mock fetch that records (url, init) calls and returns scripted responses. */
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

function ok(body = "", contentType = "text/turtle"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}
function status(code: number): Response {
  return new Response("", { status: code });
}

describe("aclUrlFor", () => {
  it("appends .acl to a container and a resource alike", () => {
    expect(aclUrlFor(CONTAINER)).toBe(`${CONTAINER}.acl`);
    expect(aclUrlFor(RESOURCE)).toBe(`${RESOURCE}.acl`);
  });
});

describe("buildOwnerOnlyAclTurtle", () => {
  it("grants the owner Read/Write/Control over accessTo + default, nothing public", async () => {
    const turtle = await buildOwnerOnlyAclTurtle(CONTAINER, OWNER);
    expect(turtle).toContain("acl:Authorization");
    expect(turtle).toContain(`<${OWNER}>`);
    expect(turtle).toContain(`acl:accessTo <${CONTAINER}>`);
    expect(turtle).toContain(`acl:default <${CONTAINER}>`);
    expect(turtle).toContain("acl:Read");
    expect(turtle).toContain("acl:Write");
    expect(turtle).toContain("acl:Control");
    // No public grant.
    expect(turtle).not.toContain("foaf");
    expect(turtle).not.toContain("AuthenticatedAgent");
    expect(turtle).not.toContain("agentClass");
  });

  it("can omit acl:default for a leaf resource", async () => {
    const turtle = await buildOwnerOnlyAclTurtle(RESOURCE, OWNER, false);
    expect(turtle).toContain(`acl:accessTo <${RESOURCE}>`);
    expect(turtle).not.toContain("acl:default");
  });

  it("throws on a missing owner WebID", async () => {
    await expect(buildOwnerOnlyAclTurtle(CONTAINER, "")).rejects.toThrow(TypeError);
    await expect(buildOwnerOnlyAclTurtle(CONTAINER, "   ")).rejects.toThrow(TypeError);
  });
});

describe("putAcl — THROWS on any non-2xx (never swallows a 4xx)", () => {
  it("PUTs the .acl with the owner-only turtle", async () => {
    const { fetch, calls } = recordingFetch(() => ok());
    await putAcl(RESOURCE, OWNER, fetch);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toBe(aclUrlFor(RESOURCE));
    expect(calls[0]?.body).toContain("acl:Control");
  });

  it("throws on 403", async () => {
    const { fetch } = recordingFetch(() => status(403));
    await expect(putAcl(RESOURCE, OWNER, fetch)).rejects.toThrow(/403/);
  });

  it("throws on 404", async () => {
    const { fetch } = recordingFetch(() => status(404));
    await expect(putAcl(RESOURCE, OWNER, fetch)).rejects.toThrow(/404/);
  });

  it("throws on 500", async () => {
    const { fetch } = recordingFetch(() => status(500));
    await expect(putAcl(RESOURCE, OWNER, fetch)).rejects.toThrow(/500/);
  });
});

describe("ensureOwnerPrivateContainer — ordering + fail-closed", () => {
  it("writes the container body BEFORE the .acl (order asserted)", async () => {
    const { fetch, calls } = recordingFetch(() => ok());
    await ensureOwnerPrivateContainer(CONTAINER, OWNER, fetch);
    expect(calls).toHaveLength(2);
    // 1st: container body PUT
    expect(calls[0]).toMatchObject({ url: CONTAINER, method: "PUT" });
    // 2nd: the .acl PUT
    expect(calls[1]).toMatchObject({ url: aclUrlFor(CONTAINER), method: "PUT" });
  });

  it("FAIL-CLOSED: throws when the .acl PUT fails, after the body succeeded", async () => {
    const { fetch, calls } = recordingFetch((url, init) => {
      if (url === CONTAINER && init?.method === "PUT") return ok(); // body OK
      return status(403); // ACL PUT fails
    });
    await expect(ensureOwnerPrivateContainer(CONTAINER, OWNER, fetch)).rejects.toThrow(/403/);
    // The body was attempted, the ACL was attempted (and failed) — and that's it.
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `PUT ${CONTAINER}`,
      `PUT ${aclUrlFor(CONTAINER)}`,
    ]);
  });

  it("throws (writes nothing) when the container body PUT itself fails", async () => {
    const { fetch, calls } = recordingFetch(() => status(500));
    await expect(ensureOwnerPrivateContainer(CONTAINER, OWNER, fetch)).rejects.toThrow(/500/);
    // Only the body PUT was attempted; no .acl write after a failed body.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: CONTAINER, method: "PUT" });
  });

  it("throws on a container URL without a trailing slash", async () => {
    const { fetch } = recordingFetch(() => ok());
    await expect(
      ensureOwnerPrivateContainer("https://alice.pod.example/feeds", OWNER, fetch),
    ).rejects.toThrow(TypeError);
  });

  describe("validateExisting escape path", () => {
    it("SKIPS the ACL re-PUT when an existing .acl is provably owner-only", async () => {
      const existingAcl = await buildOwnerOnlyAclTurtle(CONTAINER, OWNER);
      const { fetch, calls } = recordingFetch((url, init) => {
        if (url === CONTAINER && init?.method === "PUT") return ok();
        if (url === aclUrlFor(CONTAINER) && (init?.method ?? "GET") === "GET")
          return ok(existingAcl);
        return status(500);
      });
      await ensureOwnerPrivateContainer(CONTAINER, OWNER, fetch, { validateExisting: true });
      // body PUT + acl GET, but NO acl PUT (it was already owner-only).
      const methods = calls.map((c) => `${c.method} ${c.url}`);
      expect(methods).toContain(`PUT ${CONTAINER}`);
      expect(methods).toContain(`GET ${aclUrlFor(CONTAINER)}`);
      expect(methods).not.toContain(`PUT ${aclUrlFor(CONTAINER)}`);
    });

    it("RE-WRITES the ACL when the existing one is NOT owner-only (public grant)", async () => {
      const publicAcl = `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.
<#owner> a acl:Authorization;
  acl:agent <${OWNER}>;
  acl:accessTo <${CONTAINER}>;
  acl:default <${CONTAINER}>;
  acl:mode acl:Read, acl:Write, acl:Control.
<#public> a acl:Authorization;
  acl:agentClass foaf:Agent;
  acl:accessTo <${CONTAINER}>;
  acl:mode acl:Read.`;
      const { fetch, calls } = recordingFetch((url, init) => {
        if (url === CONTAINER && init?.method === "PUT") return ok();
        if (url === aclUrlFor(CONTAINER) && (init?.method ?? "GET") === "GET") return ok(publicAcl);
        if (url === aclUrlFor(CONTAINER) && init?.method === "PUT") return ok();
        return status(500);
      });
      await ensureOwnerPrivateContainer(CONTAINER, OWNER, fetch, { validateExisting: true });
      const methods = calls.map((c) => `${c.method} ${c.url}`);
      // It must re-PUT the ACL because the existing one had a public grant.
      expect(methods).toContain(`PUT ${aclUrlFor(CONTAINER)}`);
    });
  });
});

describe("isOwnerOnlyAcl — POSITIVE validation + reject foreign/agentClass", () => {
  const aclBase = aclUrlFor(CONTAINER);

  async function correctAcl(): Promise<string> {
    return buildOwnerOnlyAclTurtle(CONTAINER, OWNER);
  }

  it("ACCEPTS a correct owner-only ACL (positive: owner has accessTo+default+R+W+C)", async () => {
    const acl = await correctAcl();
    expect(await isOwnerOnlyAcl(acl, "text/turtle", aclBase, CONTAINER, OWNER)).toBe(true);
  });

  it("REJECTS an ACL with a foaf:Agent agentClass grant", async () => {
    const acl = `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.
<#owner> a acl:Authorization;
  acl:agent <${OWNER}>;
  acl:accessTo <${CONTAINER}>;
  acl:default <${CONTAINER}>;
  acl:mode acl:Read, acl:Write, acl:Control.
<#public> a acl:Authorization;
  acl:agentClass foaf:Agent;
  acl:accessTo <${CONTAINER}>;
  acl:mode acl:Read.`;
    expect(await isOwnerOnlyAcl(acl, "text/turtle", aclBase, CONTAINER, OWNER)).toBe(false);
  });

  it("REJECTS an ACL with an acl:AuthenticatedAgent agentClass grant", async () => {
    const acl = `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner> a acl:Authorization;
  acl:agent <${OWNER}>;
  acl:accessTo <${CONTAINER}>;
  acl:default <${CONTAINER}>;
  acl:mode acl:Read, acl:Write, acl:Control.
<#authed> a acl:Authorization;
  acl:agentClass acl:AuthenticatedAgent;
  acl:accessTo <${CONTAINER}>;
  acl:mode acl:Append.`;
    expect(await isOwnerOnlyAcl(acl, "text/turtle", aclBase, CONTAINER, OWNER)).toBe(false);
  });

  it("REJECTS an ACL granting a FOREIGN agent (a different WebID)", async () => {
    const acl = `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner> a acl:Authorization;
  acl:agent <${OWNER}>;
  acl:accessTo <${CONTAINER}>;
  acl:default <${CONTAINER}>;
  acl:mode acl:Read, acl:Write, acl:Control.
<#mallory> a acl:Authorization;
  acl:agent <https://mallory.evil.example/card#me>;
  acl:accessTo <${CONTAINER}>;
  acl:mode acl:Read.`;
    expect(await isOwnerOnlyAcl(acl, "text/turtle", aclBase, CONTAINER, OWNER)).toBe(false);
  });

  it("REJECTS an ACL with an acl:agentGroup grant", async () => {
    const acl = `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner> a acl:Authorization;
  acl:agent <${OWNER}>;
  acl:accessTo <${CONTAINER}>;
  acl:default <${CONTAINER}>;
  acl:mode acl:Read, acl:Write, acl:Control.
<#group> a acl:Authorization;
  acl:agentGroup <https://alice.pod.example/groups#friends>;
  acl:accessTo <${CONTAINER}>;
  acl:mode acl:Read.`;
    expect(await isOwnerOnlyAcl(acl, "text/turtle", aclBase, CONTAINER, OWNER)).toBe(false);
  });

  it("REJECTS an ACL missing acl:default for the owner (incomplete grant)", async () => {
    const acl = `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner> a acl:Authorization;
  acl:agent <${OWNER}>;
  acl:accessTo <${CONTAINER}>;
  acl:mode acl:Read, acl:Write, acl:Control.`;
    expect(await isOwnerOnlyAcl(acl, "text/turtle", aclBase, CONTAINER, OWNER)).toBe(false);
  });

  it("REJECTS an ACL where the owner is missing acl:Control (incomplete modes)", async () => {
    const acl = `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner> a acl:Authorization;
  acl:agent <${OWNER}>;
  acl:accessTo <${CONTAINER}>;
  acl:default <${CONTAINER}>;
  acl:mode acl:Read, acl:Write.`;
    expect(await isOwnerOnlyAcl(acl, "text/turtle", aclBase, CONTAINER, OWNER)).toBe(false);
  });

  it("REJECTS an ACL scoped to a DIFFERENT resource", async () => {
    const other = "https://alice.pod.example/other/";
    const acl = await buildOwnerOnlyAclTurtle(other, OWNER);
    // The acl grants the owner on `other`, not on CONTAINER.
    expect(await isOwnerOnlyAcl(acl, "text/turtle", aclUrlFor(other), CONTAINER, OWNER)).toBe(
      false,
    );
  });

  it("REJECTS an empty / authorization-less document (fail closed)", async () => {
    expect(await isOwnerOnlyAcl("", "text/turtle", aclBase, CONTAINER, OWNER)).toBe(false);
  });

  it("REJECTS an unparseable ACL body (fail closed)", async () => {
    expect(
      await isOwnerOnlyAcl("@@ this is not turtle @@", "text/turtle", aclBase, CONTAINER, OWNER),
    ).toBe(false);
  });
});

// Sanity: confirm vi is genuinely used somewhere so the import is not dead.
describe("mock-fetch sanity", () => {
  it("uses a spy that records the request body", async () => {
    const spy = vi.fn(async () => ok());
    const fetch = spy as unknown as typeof globalThis.fetch;
    await putAcl(RESOURCE, OWNER, fetch);
    expect(spy).toHaveBeenCalledOnce();
  });
});
