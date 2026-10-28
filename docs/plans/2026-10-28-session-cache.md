# Session cache: list caches belong to a user and end with the session

Candidate 7 of [the architecture review of 2026-10-28](../architecture-review-2026-10-28.html).

## Problem

The web app has two stale-while-revalidate list caches. Each has its own copy of the same
memory + `sessionStorage` code:

| | `web/src/hooks/useCachedList.ts` | `web/src/pi/piListCache.ts` |
|---|---|---|
| Used for | ticket list, product list | PI list, home-page prefetch |
| Key | `tickets:all`, `tickets:NEW`, `products` (**not per user**) | `<userId>:<language>` |
| Cleared when the session ends | no | no |

**Bug.** Suppose an ADMIN opens the ticket list, logs out, and a SALES user signs in in the same
tab. This is a single-page app, so the in-memory map survives. The ticket page paints
`tickets:all` from the cache, so the SALES user first sees **every ticket the ADMIN could see**,
until `/tickets` returns. The PI cache was keyed per user, but its lists stayed in the tab's
`sessionStorage` after logout.

A session ends in one place: `clearStoredSession()` in `web/src/api/client.ts`. That covers the
logout button and any 401 response.

## Decisions

1. **One session cache.** `web/src/session/sessionCache.ts` holds the lists both caches show.
   - Every entry belongs to a user, under `session-cache:<userId>:<key>`.
   - `clearStoredSession()` empties it. Because a 401 also goes through `clearStoredSession()`,
     this covers both the logout button and an expired session.
   - `useCachedList` and `piListCache` become thin callers.
   - Badge "seen" state in `localStorage` (`pi/notifications.ts`) is per user and meant to
     outlive the session, so it is unchanged.
2. **Explicit user id.** The interface is `readList(userId, key)`, `writeList(userId, key, list)`
   and `clearSessionCache()`.
   - `useCachedList` takes the id from `useAuth()`, so its callers are unchanged.
   - `piListCache` keeps its `userId` parameter.
   - With no user, nothing is read or written. Before, the PI cache wrote under `anon:`, but no
     page that uses it is reachable signed out.
   - `client.ts` imports the cache in order to clear it, and the cache imports nothing from
     `client.ts`.
3. **Older entries.** Clearing also removes the unkeyed `list-cache:*` and `pi-list-cache:*`
   entries written before this change, in tabs open across the deploy.

## Tests

- New `web/src/session/sessionCache.test.ts` runs in node with a Map-backed `sessionStorage`.
  It covers:
  - Two users' lists stay apart.
  - Nothing is cached without a user.
  - After a reload (a fresh module), a list is read back from `sessionStorage`.
  - Clearing empties memory and storage, including both legacy prefixes, and leaves other keys.
  - Malformed or unavailable storage does not throw.
- `useCachedList` has no unit test, because the project has no React test environment. Its key
  now includes the user id, so a different user gets a different entry and the existing effect
  reloads it.
- Browser check: sign in as ADMIN and open the ticket list, log out, then sign in as SALES in
  the same tab. The first paint must show only the SALES user's tickets.

## Rollout

Two steps on this branch. `npm test` and the server typecheck must pass after each step. The
web typecheck fails only on the missing `@vitejs/plugin-react` in this checkout, which is
unrelated to this change.

1. Add the session cache module and its tests.
2. Point `useCachedList` and `piListCache` at it, and clear it in `clearStoredSession()`.

Commit locally only. No push and no PR until reviewed.
