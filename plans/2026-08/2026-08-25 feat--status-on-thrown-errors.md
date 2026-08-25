# Status on thrown errors

## Summary

A handler could return any status it liked and throw only one. Every throw that
was not a Zod issue became a **500**, so "not found", "not yours" and "you may
not write to this" all arrived as *the server fell over* — to the caller, to the
logs, and to anything watching an error rate.

Handlers can now throw a `BridgeError` carrying a status, and the bridge honours
it. An error without one is still a 500, which is the half that matters most: a
real fault must not start reading as a refusal just because refusals gained
statuses.

Found while writing integration tests for a consumer, where every authorization
refusal was indistinguishable from a crash.

## Changes

- `src/error.ts` — `BridgeError`, plus `notFound` / `forbidden` / `badRequest`
  so a handler reads as the decision it is making rather than as a number.
  `statusOf` accepts any error carrying a usable status, not only this class, so
  an error from a library that already has one is not thrown away.
- `src/bridge/index.ts` — the catch consults `statusOf` before falling through
  to 500. A chosen refusal logs as one line rather than a stack trace: it is
  expected behaviour, and burying real faults underneath it is how error logs
  stop being read.
- `src/index.ts` — exported.
- `src/demo/bridge/user` — `user.fetch` now throws `notFound`, and a `user.refuse`
  entry exercises each shape including the unhandled one.
- `test/index.ts` — four cases: 404, 403, 400, and an error with no status
  still arriving as 500.

## Verified

`npm run test:bridge` against the demo server — **29 passed, 0 failed**.

Also proven in a consumer: hello-db's API suite now asserts 404 for a schema a
stranger cannot see (deliberately not 403, so an id cannot be probed for
existence) and 403 with a "read-only" message for a write attempted with read
access. Both were 500s before.

## Not done

**Not published.** `dist` was built and copied into the consumer's node_modules
to prove the change end to end; the version is untouched at 4.2.0. Publishing is
a separate decision — consumers pick it up through `^4.x`.
