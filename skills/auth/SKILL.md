---
name: auth
description: Use when working with bsig/auth — the small signal-native better-auth client. Covers initAuth, the session/isPending/isRefetching/sessionError signals, signInEmail/signUpEmail/signOut, refreshSession, startSessionRefresh triggers, fetchOptions hooks, needsRefresh cookie rotation, authFetch for other endpoints, and registering your own Session/User types via `AuthTypes`. No better-auth dependency.
---

# bsig/auth

A hand-rolled client for a [better-auth](https://www.better-auth.com/) server,
shipped as the separate `bsig/auth` entry point (guide: `docs/auth.md`). It
speaks the email/password session flow over plain `fetch`, holds state in bsig
signals, and has **zero runtime dependencies** — it is a drop-in replacement for
`better-auth/client` for apps that only need sessions, sign in/up/out, and
refresh triggers. Nothing imports better-auth; the session/user types are
generic and you register your own by declaration merging.

This is **bsig**: components run once and the JSX plugin auto-thunks dynamic
expressions — read signals plainly in JSX (`{session.value?.user.name}`), never
with `() =>` wrappers. Import the runtime from `bsig`, the client from
`bsig/auth`.

## Quick start

```tsx
import { initAuth, session, isPending, signInEmail, signOut, startSessionRefresh } from 'bsig/auth';

initAuth({ baseURL: 'https://api.example.com' }); // defaults to window.location.origin
const stopRefresh = startSessionRefresh();

function UserBadge() {
  return (
    <Show when={isPending.value} fallback={<span>{session.value?.user.name ?? 'Sign in'}</span>}>
      <span>…</span>
    </Show>
  );
}

await signInEmail({ email, password }); // { error }
await signOut();
```

It targets `<baseURL>/api/auth` — `GET /get-session`, `POST /sign-in/email`,
`POST /sign-up/email`, `POST /sign-out`.

## Core API

- **`initAuth({ baseURL?, fetchOptions?, sessionOptions? })`** — configure once
  at startup. `sessionOptions`: `{ refetchInterval? (seconds), refetchOnWindowFocus?
  (default true), refetchWhenOffline? (default false) }`.
- **Signals** — `session` (`{ session, user } | null`), `isPending` (true until
  the first request settles), `isRefetching` (in-flight), `sessionError`
  (`AuthError | null`). Read them in JSX; they are live.
- **`refreshSession()`** — re-read the session cookie. Concurrent calls collapse
  into one request.
- **`startSessionRefresh()`** — wire focus / online / cross-tab / polling
  triggers; returns a cleanup function. Call it once.
- **`signInEmail({ email, password })`**, **`signUpEmail({ name, email, password })`**
  → `Promise<{ error: AuthError | null }>`. On success they broadcast to other
  tabs, then refresh the session.
- **`signOut()`** → clears `session` immediately, then broadcasts.
- **`authFetch(path, init?)`** → `Promise<{ data, error }>` against any
  `/api/auth` endpoint (social sign-in, password reset, …).

## Behaviours worth knowing

- **401 clears the session; other errors keep it.** A network failure or 5xx
  leaves the last known `session` intact and sets `sessionError` instead, so a
  flaky connection does not sign the user out.
- **Cookie rotation.** If `/get-session` returns `needsRefresh: true`, the client
  re-issues the cookie with `POST /get-session` and uses that response.
- **Refetch triggers** (`startSessionRefresh`): tab visible (focus, rate-limited
  to one per 5s), back online, another tab's sign-in/out (via a `storage`
  event), and optional polling while signed in. Cross-tab sync writes a
  `bsig.auth.session` key to `localStorage`.
- **Hooks** (`fetchOptions`): `onRequest`, `onResponse`, `onSuccess`, `onError`
  — all may be async. `onRequest` receives `context.options`; mutate it (e.g.
  headers) to alter the call. `onError` gets `{ error, response? }`, where
  `response` is absent for network failures.
- **Identity-gated updates.** A refetch that returns the same
  `user.id|name|email|expiresAt` does not reassign `session`, so it does not
  re-render.

## Types: bring your own session

Register your app's shapes once on `AuthTypes`; the client then types `Session`
and the `session` signal with them — **replacing** the defaults, so fields keep
their exact required/optional types (no better-auth dependency):

```ts
declare module 'bsig/auth' {
  interface AuthTypes {
    user: { id: string; name: string; email: string; role: 'admin' | 'user' };
    session: { expiresAt: Date; impersonatedBy?: string };
  }
}

import { session } from 'bsig/auth';
session.value?.user.name.toUpperCase(); // string
session.value?.session.expiresAt; // Date
```

Provide only the half(s) you want; the rest fall back to `DefaultUser`
(`{ id, name?, email? }`) and `DefaultSessionData` (`{ expiresAt: string | Date }`)
— both open, and usable as a base (`user: DefaultUser & { role: 'admin' }`).
Note: better-auth serialises dates as ISO strings, so typing them `Date` is a
claim about the wire; convert in `onSuccess` if you need real `Date`s.

## Gotchas / limitations

- **Client only.** A better-auth-compatible server must serve `/api/auth`.
- **CSRF/Origin.** POSTs rely on the browser's same-origin `Origin` header; the
  defaults assume the auth server shares your origin (`baseURL` defaults to
  `window.location.origin`).
- **SSR-safe import, browser-shaped calls.** The module resolves `baseURL`
  lazily and touches no `window` at import time, but a server call needs `fetch`
  and an absolute `baseURL`. `localStorage`/`navigator` absence degrades
  gracefully (no cross-tab sync; treated as online).
- **Not the whole better-auth API.** Only sessions and email/password auth are
  wrapped; use `authFetch` for anything else.
- **Separate entry point.** Nothing is pulled into the runtime bundle unless
  `bsig/auth` is imported.

## Installing this skill

```sh
npx -p github:unbiased-dev/bsig#v0.6.0 bsig-skill auth
# or: npx -p github:unbiased-dev/bsig#v0.6.0 bsig-auth-skill
# variants: --opencode | --claude | --global | --dest <dir>
```
