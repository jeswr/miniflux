// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { describe, expect, it } from "vitest";
import { mirrorState, readState, stateKey } from "./state-mirror.js";

function makeStorage() {
  // The in-memory unstorage driver stands in for the @jeswr/unstorage-solid
  // solidDriver({base, fetch}) KV — same Storage interface, no pod needed.
  return createStorage({ driver: memoryDriver() });
}

describe("stateKey", () => {
  it("maps an entry id to a traversal-safe key", () => {
    expect(stateKey(7)).toBe("entry-7.json");
  });

  it("throws on a non-integer / negative id (never an unpredictable key)", () => {
    expect(() => stateKey(1.5)).toThrow(TypeError);
    expect(() => stateKey(-1)).toThrow(TypeError);
    expect(() => stateKey(Number.NaN)).toThrow(TypeError);
  });
});

describe("mirrorState / readState", () => {
  it("mirrors read+starred and reads them back", async () => {
    const storage = makeStorage();
    await mirrorState(storage, 7, { read: true, starred: false });
    expect(await readState(storage, 7)).toEqual({ read: true, starred: false });

    await mirrorState(storage, 7, { read: true, starred: true });
    expect(await readState(storage, 7)).toEqual({ read: true, starred: true });
  });

  it("stores under the sanitised key", async () => {
    const storage = makeStorage();
    await mirrorState(storage, 42, { read: false, starred: true });
    // unstorage memory driver normalises `.json` keys to a `:json` separator.
    const keys = await storage.getKeys();
    expect(keys.some((k) => k.includes("entry-42"))).toBe(true);
  });

  it("returns null for an unknown entry", async () => {
    const storage = makeStorage();
    expect(await readState(storage, 999)).toBeNull();
  });

  it("coerces non-boolean stored flags to false (defensive normalisation)", async () => {
    const storage = makeStorage();
    await storage.setItem(stateKey(5), JSON.stringify({ read: "yes", starred: 1 }));
    expect(await readState(storage, 5)).toEqual({ read: false, starred: false });
  });

  it("reads a corrupt (non-JSON) stored value as null, never throws", async () => {
    const storage = makeStorage();
    await storage.setItem(stateKey(6), "{not json");
    expect(await readState(storage, 6)).toBeNull();
  });

  it("normalises truthy-but-non-true values on write to strict booleans", async () => {
    const storage = makeStorage();
    await mirrorState(storage, 8, {
      read: 1 as unknown as boolean,
      starred: "x" as unknown as boolean,
    });
    // Only `=== true` survives as true → both false here.
    expect(await readState(storage, 8)).toEqual({ read: false, starred: false });
  });
});
