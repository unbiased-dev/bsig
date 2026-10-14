# bsig/auth

A small, signal-native client for a [better-auth](https://www.better-auth.com/)
server — the email/password session flow, spoken over plain `fetch` and held in
bsig signals. It lives in its own module: importing `bsig/auth` pulls it in, and
a build that never imports it leaves it out of the bundle entirely.

It exists because the official `better-auth/client` drags in a stack of runtime
dependencies (`@better-fetch/fetch`, nanostores, defu, focus/online/broadcast
managers, session-refresh, …) for behaviours most apps use a fraction of. This
client keeps the behaviours that matter — request lifecycle hooks, refetch on
focus (rate-limited), refetch when back online, cross-tab sync, optional
polling, in-flight collapse, cookie-cache rotation, and 401-clears-session — as
**zero runtime dependencies**.

Nothing here imports better-auth. The session/user shapes are generic and
extensible (see [§8](#8-bring-your-own-session-types)), so you can adopt it without
adding better-auth to your app at all.

## 1. Configure

```ts
import { initAuth } from 'bsig/auth';

initAuth({
  baseURL: 'https://api.example.com', // defaults to window.location.origin
  sessionOptions: { refetchInterval: 30 }, // optional polling, in seconds
});
```

The client talks to `<baseURL>/api/auth/…`. POSTs are CSRF-checked by
better-auth via the `Origin` header, which browsers send for same-origin
requests — so the defaults work when the auth server shares your origin.

## 2. Read the session

State lives in signals, so it stays live in JSX:

```tsx
import { isPending, isRefetching, session, sessionError } from 'bsig/auth';

const user = session.value?.user;

return (
  <div>
    <Show when={isPending.value} fallback={user ? `Hi ${user.name}` : 'Signed out'}>
      <p>Loading…</p>
    </Show>
    <Show when={sessionError.value}>{sessionError.value?.message}</Show>
  </div>
);
```

| Signal | Meaning |
| --- | --- |
| `session` | `{ session, user }` or `null`. |
| `isPending` | `true` until the first request settles. |
| `isRefetching` | `true` while a request is in flight. |
| `sessionError` | The last session-request error, or `null`. |

`refreshSession()` re-reads the session cookie and updates the store. It returns
a promise; concurrent calls are collapsed into a single in-flight request.

## 3. Sign in, sign up, sign out

```ts
import { signInEmail, signUpEmail, signOut } from 'bsig/auth';

const { error } = await signInEmail({ email, password });
if (error) showError(error.message);

await signUpEmail({ name, email, password });
await signOut(); // clears `session` immediately
```

Each returns `{ error: AuthError | null }` (sign-out resolves `void`). On
success, sign-in/up broadcast to other tabs and then refresh the session; on
failure the error is returned as-is (`{ message, code, status }`) and nothing is
refetched.

## 4. Passive refresh

Wire the triggers once at app startup:

```ts
import { startSessionRefresh } from 'bsig/auth';

const stop = startSessionRefresh();
// later, e.g. on app teardown
stop();
```

It refetches when:

- the tab becomes **visible** (focus; rate-limited to one per 5s),
- the browser comes back **online** (`navigator.onLine`),
- **another tab** signs in or out (via a `storage` event), and
- `refetchInterval > 0` and a session exists (polling).

Disable focus refetches with `sessionOptions.refetchOnWindowFocus: false`, or
keep refetching while offline with `refetchWhenOffline: true`.

## 5. Request hooks

Mirror better-auth's `fetchOptions`. Hooks fire around every request; `onRequest`
can mutate `context.options` (e.g. add headers) before the call is made:

```ts
initAuth({
  fetchOptions: {
    onRequest: ({ options }) => {
      options.headers = { ...options.headers, 'x-app': 'demo' };
    },
    onError: ({ error, response }) => {
      console.error(response?.status ?? 'network', error.message);
    },
  },
});
```

Available: `onRequest`, `onResponse`, `onSuccess`, `onError`. All may be async.

## 6. Cookie-cache rotation

If `/get-session` responds with `needsRefresh: true`, the client transparently
re-issues the cookie with a `POST /get-session` and uses its result — the same
rotation the official client performs.

## 7. Other endpoints

`authFetch(path, init?)` is exported, so you can reach any other better-auth
endpoint without another dependency:

```ts
const { data, error } = await authFetch('/change-password', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ currentPassword, newPassword }),
});
```

It returns `{ data, error }`, where a non-2xx status fills `error` with the
parsed body (plus `status`), and a network failure fills `error` alone.

## 8. Bring your own session types

The client is generic in its session/user shapes. Register yours once by
declaration merging `AuthTypes`, and every session-shaped export (`Session`, the
`session` signal) uses them — **replacing** the defaults, so fields keep their
exact required/optional types. No better-auth types needed:

```ts
declare module 'bsig/auth' {
  interface AuthTypes {
    user: {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      email: string;
      emailVerified: boolean;
      name: string;
      image?: string | null;
    };
    session: {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      expiresAt: Date;
      token: string;
      ipAddress?: string | null;
      userAgent?: string | null;
    };
  }
}

import { session } from 'bsig/auth';
session.value?.user.name.toUpperCase(); // string, not string | undefined
session.value?.session.expiresAt; // Date
```

Both halves are optional — provide only the one(s) you want to override; the
rest fall back to `DefaultUser` (`{ id, name?, email? }`, open) and
`DefaultSessionData` (`{ expiresAt: string | Date }`, open). You can also build
on the defaults, e.g. `user: DefaultUser & { role: 'admin' | 'user' }`.

> **Dates arrive as strings.** better-auth serialises `expiresAt`/`createdAt` as
> ISO strings over JSON; registering them as `Date` matches better-auth's own
> types but is a claim about the wire, not a conversion. Convert in an
> `onSuccess` hook if you need real `Date`s.

Exported type names: `AuthTypes`, `Session`, `AuthUser`, `AuthSession`,
`DefaultUser`, `DefaultSessionData`, `AuthError`, `AuthOptions`,
`AuthFetchOptions`, `AuthSessionOptions`, `AuthFetchContext`,
`AuthResponseContext`, `AuthSuccessContext`, `AuthErrorContext`, `Credentials`,
`SignUpInput`, `Result`.

## API

| Export | Purpose |
| --- | --- |
| `initAuth(options?)` | Configure `baseURL`, `fetchOptions`, `sessionOptions`. |
| `session`, `isPending`, `isRefetching`, `sessionError` | Signals holding the session store. |
| `refreshSession()` | Re-read the session cookie. |
| `startSessionRefresh()` | Wire passive refetches; returns cleanup. |
| `signInEmail(credentials)` | `POST /sign-in/email`, then refresh. |
| `signUpEmail(input)` | `POST /sign-up/email`, then refresh. |
| `signOut()` | `POST /sign-out`, clear `session`, broadcast. |
| `authFetch(path, init?)` | Raw request against any `/api/auth` endpoint. |
| `Session`, `AuthUser`, `AuthSession`, `AuthError`, … | Types. |

## Notes

- **Server required.** This is a client; run better-auth (or any server exposing
  the endpoints above) behind `/api/auth`.
- **SSR-safe import.** The module does not touch `window` at import time; the
  base URL is resolved lazily. Calls still need a `fetch` and an absolute
  `baseURL` to run on the server.
- **Separate entry point.** `bsig/auth` adds nothing to the runtime bundle
  unless imported, so adding auth never taxes the rest of your app.
