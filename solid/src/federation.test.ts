// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { buildMembershipRegistry, FED_IRIS, MAINTAINER_WEBID_PLACEHOLDER } from "./federation.js";

const REGISTRY = "https://w3id.org/jeswr/fedreg/miniflux";
const CLIENT_ID = "https://miniflux-solid.example.example/clientid.jsonld";

describe("FED_IRIS — canonical federation IRIs", () => {
  it("uses fed# (not fedapp#) and the social sector", () => {
    expect(FED_IRIS.fedapp).toBe("https://w3id.org/jeswr/fed#");
    expect(FED_IRIS.socialSector).toBe("https://w3id.org/jeswr/sectors/social#sector");
    expect(FED_IRIS.fedreg).toBe("https://w3id.org/jeswr/fedreg#");
    expect(FED_IRIS.pcChatRoom).toBe("https://w3id.org/jeswr/pod-chat#ChatRoom");
  });
});

describe("buildMembershipRegistry", () => {
  it("emits a fedreg:Registry with one Active membership for the app", async () => {
    const built = buildMembershipRegistry({ registryId: REGISTRY, clientId: CLIENT_ID });
    const turtle = await built.toString();

    expect(turtle).toContain("fedreg:Membership");
    expect(turtle).toContain("fedreg:Active"); // status Active
    expect(turtle).toContain(CLIENT_ID); // the app == client_id
    // The placeholder assertedBy (needs:user).
    expect(turtle).toContain(MAINTAINER_WEBID_PLACEHOLDER);
    expect(MAINTAINER_WEBID_PLACEHOLDER).toContain("PLACEHOLDER");
  });

  it("uses a supplied assertedBy WebID when given", async () => {
    const realWebId = "https://jeswr.example/profile/card#me";
    const built = buildMembershipRegistry({
      registryId: REGISTRY,
      clientId: CLIENT_ID,
      assertedBy: realWebId,
    });
    const turtle = await built.toString();
    expect(turtle).toContain(realWebId);
    expect(turtle).not.toContain(MAINTAINER_WEBID_PLACEHOLDER);
  });

  it("carries an explicit asserted timestamp when given", async () => {
    const built = buildMembershipRegistry({
      registryId: REGISTRY,
      clientId: CLIENT_ID,
      asserted: "2026-06-21T00:00:00Z",
    });
    const turtle = await built.toString();
    expect(turtle).toContain("2026-06-21T00:00:00Z");
  });

  it("exposes the quads on the BuiltGraph", () => {
    const built = buildMembershipRegistry({ registryId: REGISTRY, clientId: CLIENT_ID });
    expect(Array.isArray(built.quads)).toBe(true);
    expect(built.quads.length).toBeGreaterThan(0);
  });

  it("throws on a missing registryId or clientId", () => {
    expect(() => buildMembershipRegistry({ registryId: "", clientId: CLIENT_ID })).toThrow(
      TypeError,
    );
    expect(() => buildMembershipRegistry({ registryId: REGISTRY, clientId: "" })).toThrow(
      TypeError,
    );
  });
});
