<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->
# `miniflux-solid-sync` — Miniflux → Solid pod-sync integration

A self-contained TypeScript Node integration layer that syncs a [Miniflux](https://github.com/miniflux/v2)
fork's **saved RSS/Atom entries** into a user's **Solid pod**: it maps saved feed items onto the
suite-canonical [`@jeswr/solid-chat-interop`](https://github.com/jeswr/solid-chat-interop)
`CanonicalMessage` (so a saved item is readable by every other suite chat/feed consumer — the Pod
Manager "Solid Community" view, the chat-interop reconciler, …), writes them **owner-private**
behind a fail-closed WAC ACL, mirrors **read/starred** state to a pod KV, serialises the
**subscription list** as an `as:Collection`, and self-describes as a **federation member**.

## Scope — honest statement (deploy-deferred fork)

> **The Go core of Miniflux is UNTOUCHED.** This is a **deploy-DEFERRED** fork. **Go build/test is
> OUT of the MVP scope** and is NOT wired into this module's gate. The gate here covers ONLY the
> TypeScript integration module under `solid/` (lint + typecheck + vitest). Wiring this module into
> the running Miniflux Go service (a Go-side hook that, on save/star/read, calls into this module —
> e.g. via a sidecar or an exec bridge) is a follow-up, not part of this deliverable.

This directory (`solid/`) is the entire deliverable: a private (`"private": true`) integration
module, not a published npm package.

## Modules

| File | What it does |
|---|---|
| `src/entry-mapper.ts` | `entryToCanonical(entry, baseContainer)` — maps a Miniflux saved entry → `CanonicalMessage` (title→content, published_at→published, permalink→`provenance.derivedFrom`, per-feed room IRI). Every untrusted URL is `safeIri`/`isHttpIri`-filtered; a malformed field drops, never throws. |
| `src/acl.ts` | **The fail-closed owner-only WAC ACL writer** (the load-bearing security piece — see below). `putAcl`, `ensureOwnerPrivateContainer`, `isOwnerOnlyAcl`, `buildOwnerOnlyAclTurtle`. |
| `src/save-entry.ts` | `saveEntryToPod(entry, {fetch, ownerWebId, baseContainer})` — the full owner-private flow: lock the per-feed container (fail-closed) → map → `serializeAs2` → PUT body → lock the resource. |
| `src/subscriptions.ts` | `serializeSubscriptions(collectionUrl, feeds)` — the subscription list as an `as:Collection` (`schema:url` + `dct:title` per feed) built with `n3.Writer`. |
| `src/state-mirror.ts` | `mirrorState` / `readState` — read/starred flags → pod KV via `@jeswr/unstorage-solid`. |
| `src/federation.ts` | `buildMembershipRegistry(...)` — a `fedreg:Registry` with one `fedreg:Membership(status:Active)` via `@jeswr/federation-registry`. |
| `src/client-id.ts` | `rewriteClientIdOrigin(doc, origin)` + `normalizeOrigin` — origin-aware Client ID Document rewrite. |
| `src/login.ts` | THIN browser-only login wiring (silent restore + interactive `<authorization-code-flow>`). Documented, **not** part of the gated core (browser-only). |
| `public/clientid.jsonld` | The federation Client ID Document (`fedapp:App`). |

## The fail-closed owner-only WAC ACL (the security piece)

Every byte this module writes to a pod is **owner-private**. The ACL writer bakes in the
Elk/Linkding roborev lessons:

1. **Owner-only WAC** — the owner WebID gets `acl:Read`/`acl:Write`/`acl:Control` over the resource
   (`acl:accessTo`) AND its descendants (`acl:default`). Nothing public — no `acl:agentClass`, no
   foreign `acl:agent`.
2. **Built with `n3.Writer` + typed quads** — never hand-concatenated (house rule).
3. **`putAcl` THROWS on ANY non-2xx** — a 403/404/500 is never swallowed.
4. **`ensureOwnerPrivateContainer` is FAIL-CLOSED** — the container body is written **first**, then
   the `.acl`; if the ACL cannot be applied it **throws** and refuses to proceed, so data is never
   written into a container we could not lock down. The load-bearing ordering:

   ```ts
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
     // ...validateExisting (positive validation) path...
     // (Re)apply the owner-only ACL. THROWS on any non-2xx — fail-closed.
     await putAcl(containerUrl, ownerWebId, fetchImpl, true);
   }
   ```

   And `putAcl` itself:

   ```ts
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
   ```

5. **The "ACL already owner-private" escape path validates POSITIVELY** (`isOwnerOnlyAcl`): it
   parses the existing `.acl` (via `@jeswr/fetch-rdf` `parseRdf`), confirms the owner
   **independently** holds `accessTo` + `default` + `Read` + `Write` + `Control`, AND **rejects** any
   `acl:agentClass` (foaf:Agent / acl:AuthenticatedAgent / any class), any `acl:agentGroup`, or any
   foreign `acl:agent` grant. A negative "no public grant found" check is **not** used — the owner's
   grants are checked positively AND every authorization must be exclusively the owner's. An
   unparseable / authorization-less ACL is treated as **not** owner-private (fail closed).

The `save-entry` flow applies this twice: it locks the **per-feed container** before any data is
written, then writes the **message body**, then locks the **message resource** — each step
fail-closed.

## RDF discipline

- **Parse** with `@jeswr/fetch-rdf` `parseRdf` (the existing-ACL validation path).
- **Serialise the saved entry's message** with `@jeswr/solid-chat-interop` `serializeAs2` — the
  typed AS2.0 serialiser. The entry message RDF is **never** hand-written.
- **Serialise the ACL + the subscription `as:Collection`** with `n3.Writer` + typed quads — never
  hand-concatenated triples.
- **The federation membership** is built with `@jeswr/federation-registry` `buildRegistry` — typed
  RDF, never hand-built.

### Entry → `CanonicalMessage` mapping

- `title` → `content`
- `published_at` → `published` (ISO-8601, parse-validated; emitted as `dct:created` by `serializeAs2`)
- entry permalink (`url`) → `provenance.derivedFrom` (`prov:wasDerivedFrom`). chat-interop has **no**
  `schema:url`/`as:url` field on a message, so the permalink rides as `provenance.derivedFrom` — this
  satisfies the "schema:url/as:url as source" requirement **honestly** (`prov:wasDerivedFrom` is the
  semantically-correct "where this came from" edge).
- the **source feed** is the `room` — a per-feed `pc:ChatRoom` collection IRI under
  `<baseContainer>/feeds/<feedId>/`.

### Subscription-list serialisation choice

chat-interop ships **no** subscription-list serialiser, and the suite rule is to **reuse an existing
term** rather than mint a new one or add a brand-new sector. An `as:Collection` whose items carry
`schema:url` (the feed URL) + `dct:title` (the feed title) needs **no** new vocabulary term, so it is
used directly — preferred over inventing a `pc:`/`fed*` subscription term. (Had a genuinely-missing
term been required, the rule is to add it to chat-interop's vocab upstream, **not** a new sector.)

## Federation

The Client ID Document (`public/clientid.jsonld`) declares this a federation app:

- **fedapp namespace**: `https://w3id.org/jeswr/fed#` (NOT `fedapp#`)
- **sector**: `https://w3id.org/jeswr/sectors/social#sector` (RSS/feed-ingest = the **social**
  sector — already authored, no new sector minted)
- **fedreg namespace**: `https://w3id.org/jeswr/fedreg#`
- `fedapp:produces` includes **`pc:ChatRoom`** (`pc:` = `https://w3id.org/jeswr/pod-chat#`) to mean
  "produces chat-interop `CanonicalMessage`s in a `pc:ChatRoom` collection".

`buildMembershipRegistry(...)` emits a `fedreg:Registry` with one `fedreg:Membership(status:Active)`
linking the registry to this app's `client_id`, asserted by an authority WebID.

### Origin-aware Client ID Document — REQUIRED at serve/build time

Solid-OIDC **requires** that a served Client ID Document's `client_id` **byte-match** the URL it is
served from. A static committed file cannot know its deploy origin, so `public/clientid.jsonld` uses
the placeholder origin `https://miniflux-solid.example.example/`. **At serve/build time the served
file's `client_id` (and `client_uri` + `redirect_uris`) MUST be rewritten to the real origin** —
use `rewriteClientIdOrigin(doc, origin)` (paths preserved, origin validated). The served file's
`client_id` must then equal the URL it is served from (e.g. `https://<origin>/clientid.jsonld`).

## Install

```bash
cd solid
npm install            # ignore-scripts=true (.npmrc); no lifecycle hooks run
```

Suite `@jeswr` deps are installed by **GitHub** install (`github:jeswr/<repo>#main`); `@jeswr/fetch-rdf`
is on npm (`^0.1.0`). After install, the lockfile's `github:` deps are rewritten from `git+ssh://`
to `git+https://github.com/...` (the **#78 guard**) so `npm ci` works keyless in CI — enforced by
`npm run check:lockfile-transport`.

## Gate

```bash
cd solid
npm run lint        # biome (src public)
npm run typecheck   # tsc --noEmit
npm test            # vitest run  (77 tests across 7 files)
# or all three:
npm run gate
```

The gate is **scoped to this TypeScript module** — see the scope statement above. Tests cover: the
entry→`CanonicalMessage` mapping incl. hostile inputs (`javascript:`/`data:` permalinks dropped,
garbage dates dropped, missing title), the **fail-closed ACL writer** (throws on 403/404/500;
body-before-acl ordering asserted; data write never attempted when the ACL can't be applied; positive
owner-grant validation + rejection of `agentClass`/`agentGroup`/foreign-agent grants), the full
`saveEntryToPod` flow, the `as:Collection` subscription round-trip, the state mirror, the federation
artifact, and the origin-aware client-id rewrite.

## `needs:user` items

- **`fedreg:assertedBy` maintainer WebID** — `src/federation.ts` carries
  `MAINTAINER_WEBID_PLACEHOLDER`. The real maintainer WebID asserting this app's federation
  membership MUST be supplied before any membership artifact is published/served (a self-asserted
  membership is meaningless).
- **Deploy / Go-side wiring** — wiring this module into the running Miniflux Go service is a
  follow-up (deploy-deferred fork; Go build/test out of MVP scope).
- **npm publish / served origin** — this is a private module; if it is ever published or served, the
  Client ID Document origin must be set (see "Origin-aware Client ID Document").

## Provenance

Authored by **Claude Opus 4.8** (Fable unavailable) — re-review/upgrade candidate. Every source file
carries the `AUTHORED-BY` marker; commits carry the Opus-4.8 provenance trailers.
