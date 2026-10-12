# CLAUDE.md — EV Client Profile GraphQL Gateway

## What this project is
A GraphQL composition layer (Apollo Server, TypeScript, Node.js) that joins two
independent microservices — **ClientService** and **AdviserService** — into a single
`clientProfile` query for the UI. The two services own their data; this layer must
never assume they share a database, transaction or failure mode.

- `ClientService.getDetails(clientId: string)` → `{ id, firstName, lastName, adviserId }`
- `AdviserService.getDetails(adviserId: string)` → `{ id, name, firm }`

Both are in-memory mocks and stay independent: neither imports the other. The schema
exposes `clientProfile(clientId: ID!)` for the UI and `clients(clientIds: [ID!]!)`, the
list shape that makes per-parent resolver cost visible and testable.

## Non-negotiable rules

### 1. TypeScript strictness
- `tsconfig.json` runs with `"strict": true`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `exactOptionalPropertyTypes`. Do not relax these flags.
- **No `any`.** Use `unknown` and narrow. No `as` casts except to narrow `unknown`
  after a runtime check. No `// @ts-ignore` / `@ts-expect-error`.
- Every exported function has an explicit return type.
- Resolver signatures are typed against the shared `GraphQLContext` and the domain
  types in `src/types.ts` — do not redeclare shapes inline.

### 2. Zero-trust security
- Treat **every** input as hostile: validate GraphQL arguments (e.g. `clientId`
  format) before calling a downstream service.
- Treat **every** downstream service as unreliable: a failing AdviserService must
  never fail the whole query. Catch at the field boundary, log internally, and
  surface a **generic, coded** `GraphQLError` (`ADVISER_UNAVAILABLE`) so the field
  resolves to `null` and the rest of the payload still returns.
- A failing ClientService has no partial result to offer for that client: mask it as
  `INTERNAL_SERVER_ERROR`, and in a list null only that entry, not the whole list.
- **Never leak internals to the client.** No stack traces, no downstream URLs,
  hostnames, HTTP status codes, service names, IDs of other records, or PII in
  `errors[]`. All errors pass through `formatError` in `src/errors.ts`, which
  allow-lists safe codes and replaces everything else with `INTERNAL_SERVER_ERROR`.
- `includeStacktraceInErrorResponses: false` always — do not gate it on `NODE_ENV`.
- Introspection is disabled outside development.
- Per-request state only: DataLoaders are created **per request in the context
  factory**, never as module-level singletons (a shared cache would leak one
  user's data into another user's request).
- Server-side logs may include error codes and record IDs but never names or
  other personal data.

### 3. GraphQL best practices
- Schema-first SDL in `src/schema.ts`; resolvers in `src/resolvers.ts`.
- Relationships are resolved by **field-level resolvers** (`Client.adviser`), so a
  downstream call only happens when the client actually selects that field.
- **A field resolver runs once per parent object, so its cost multiplies with list
  size.** Write every field resolver as if its parent were one of N in a list, even
  when today's only caller is a single-object query.
- Therefore a field resolver never calls a downstream service directly. It goes
  through a per-request DataLoader (`context.loaders.*`) that batches and
  de-duplicates keys. A direct `AdviserService.getDetails` call inside
  `Client.adviser` is the canonical N+1 bug and must be rejected in review.
- A batch function isolates failures per key (`Promise.allSettled`, an `Error` in
  that key's slot) so one bad record never rejects the whole batch.
- Nullable by design for cross-service relationships (`adviser: Adviser`) so
  partial failure is representable. Non-null (`!`) only for fields this service
  owns and can guarantee.
- Use `ID` for identifiers. No business logic in resolvers — they orchestrate,
  services compute.

## Testing contract
- Jest + ts-jest. Integration tests go through `server.executeOperation`
  (the real schema, resolvers, context and `formatError`), not by calling resolvers
  directly.
- Spy on service functions with `jest.spyOn` to assert **call counts** — these tests
  are the guardrails for the rules above:
  1. Adviser service is never called when `adviser` is not selected.
  2. N clients sharing one adviser → exactly one adviser lookup.
  3. Client `A-000` (revoked adviser) → client data present, `adviser: null`,
     sanitised error with no PII / internals.
- `npm test` and `npm run typecheck` must both pass before any change is "done".

## Commands
- `npm run dev` — start the server on :4000
- `npm test` — run the integration suite
- `npm run typecheck` — `tsc --noEmit`

## When unsure
Ask rather than guess. Prefer the smallest change that keeps the tests green, and
add a test for any new failure mode you handle.
