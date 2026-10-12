# EV Client Profile — GraphQL Composition Layer

Apollo Server + TypeScript gateway joining **ClientService** and **AdviserService**
into one `clientProfile` query, with DataLoader batching and zero-trust error handling.

```bash
npm install
npm test            # 9 integration tests
npm run typecheck   # tsc --noEmit, strict
npm run dev         # http://localhost:4000
```

Try it:

```graphql
query {
  clientProfile(clientId: "A-000") {
    id
    firstName
    adviser {
      name
      firm
    }
  }
}
query {
  clients(clientIds: ["C-001", "C-002", "C-003"]) {
    id
    adviser {
      name
    }
  }
}
```

## Structure

| File                          | Role                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                   | Project rules for the AI agent: TS strictness, zero-trust, GraphQL practices, test contract                |
| `src/services/*`              | Mock microservices (in-memory arrays). `ADV-99` is revoked and throws a raw "HTTP" error full of internals |
| `src/loaders.ts`              | Per-request `DataLoader` for advisers; `Promise.allSettled` isolates per-key failures                      |
| `src/resolvers.ts`            | `clientProfile`, `clients`, and the field-level `Client.adviser` resolver                                  |
| `src/errors.ts`               | Allow-list `formatError` — only known codes keep their message; everything else is masked                  |
| `tests/clientProfile.test.ts` | The three required guardrails plus extra edge cases                                                        |

---

## Audit log — what the AI got wrong and how it was fixed

### 1. N+1 in `Client.adviser`

**AI default:**

```ts
adviser: (client) => AdviserService.getDetails(client.adviserId);
```

Fine for one client. For `clients(ids: [...])` it fires one downstream call **per client**,
even when they share an adviser. Verified: 3 clients → 3 calls.

**Fix:** per-request `DataLoader` in the context. All `.load()` calls in one event-loop
tick are collected, de-duplicated and dispatched together → 3 clients → 1 call.
The batch function is the single place to swap in a bulk `getMany(ids)` endpoint later.

**Second trap inside the fix:** AI often creates the loader at module level. That cache
would live forever and be shared across users — a data-leak and stale-data bug. Loaders
are created in `createContext()` per request, and a test asserts the cache isn't shared.

### 2. Error leakage on revoked adviser

**AI default:** let the downstream error propagate. Apollo returns its message —
`GET http://adviser-svc.internal:8443/v1/advisers/ADV-99 -> 403 Forbidden...` — leaking
hostname, port, API path, another record's ID and the revocation reason. In dev it
also adds a stack trace.

**Fix, in layers:**

1. **Field boundary:** resolver catches, logs codes/IDs only, throws a generic
   `ADVISER_UNAVAILABLE`. Because `adviser` is nullable, GraphQL nulls just that field
   and the client data still returns.
2. **`formatError` allow-list:** unknown codes are replaced by `"An unexpected error
occurred."` / `INTERNAL_SERVER_ERROR`; only `message`, `path`, `locations`, `code`
   survive. Allow-list beats deny-list — a new error type is safe by default.
3. **`includeStacktraceInErrorResponses: false`** unconditionally (Apollo enables it when
   `NODE_ENV` isn't production — risky if an env var is misconfigured).

**Caught by strict TypeScript:** the first draft used `includeStacktraceInErrorResponse`
(singular). In plain JS that's silently ignored and stack traces would ship. `tsc` flagged it.

### 3. Batch failure isolation

A naive batch function using `Promise.all` would reject the **whole batch** if one adviser
fails, nulling every client's adviser. `Promise.allSettled` maps failures to per-key
`Error`s so only `A-000` is affected — covered by a test.

### 4. Input validation (zero-trust inbound)

`clientId` is checked against a format before any service call, and `clients` caps list
size (cheap protection against amplification). Test asserts the service is never reached.

---

## Test map

| Requirement                   | Test                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Test 1 — Efficiency**       | `never calls AdviserService when the adviser field is not selected` (+ control case)                                                                                                                          |
| **Test 2 — Batching**         | `single AdviserService call for many clients sharing one adviser`; one call per _unique_ adviser; no cross-request cache                                                                                      |
| **Test 3 — Graceful failure** | `A-000` returns data with `adviser: null`, one coded error, and the serialised errors contain none of the PII/topology strings; failure isolated within a batch; unexpected errors masked; bad input rejected |

Guardrail check: swapping the DataLoader for the naive resolver makes Test 2 fail
(expected 1 call, received 3).

---

## Prompt sequence (for doing this live with Claude Code)

1. _"Read CLAUDE.md. Initialise a TypeScript/Node project with Apollo Server 5, strict tsconfig as
   specified, Jest via ts-jest. Don't write resolvers yet."_
2. _"Create mock ClientService.getDetails and AdviserService.getDetails using in-memory arrays with
   the shapes in the brief. Include client A-000 linked to adviser ADV-99, which is revoked: make
   the adviser service throw an error that looks like a real downstream HTTP failure."_
   — deliberately make the failure realistic so the audit has something to catch.
3. _"Add Client and Adviser types, `clientProfile(clientId: ID!)` and a `clients(clientIds)` list
   query, with a field-level resolver for Client.adviser."_ → **review: N+1 present.**
4. _"Client.adviser causes N+1 on the list query. Replace it with a per-request DataLoader created in
   the context factory. Use allSettled so one failed key doesn't reject the batch."_ → **review:
   check it's not a module singleton.**
5. _"Query A-000 and show me the raw response."_ → **review: internals leaked.** _"Catch at the field
   boundary, throw a coded ADVISER_UNAVAILABLE, and add an allow-list formatError. Disable stack
   traces unconditionally."_
6. _"Write the three integration tests from CLAUDE.md using executeOperation and jest.spyOn call
   counts. For Test 3, assert a list of PII and topology strings is absent from the serialised errors."_
7. _"Temporarily revert to the naive resolver and run Test 2 — confirm it fails."_ — proves the test
   is a real guardrail, not a tautology.

## What I'd do next in production

- **Authorisation:** The gateway validates the format of a client ID but never checks that the caller is allowed to see that client. In a platform holding client and adviser data, that's the largest gap. I'd put the caller's identity into the request context and check access before any data is fetched.
- **Timeouts and resilience:** A failing adviser service is handled, but a hanging adviser service stalls the whole query. I'd add a timeout in the loader's batch function so slow becomes ADVISER_UNAVAILABLE, then a circuit breaker so we stop calling a service that's down.
- **Observability:** Errors are masked for the client, so debugging depends on logs. I'd add a request ID (UUID) to both the log line and the response, so a support ticket maps to a single log entry.
