---
name: router
description: Use when working with the bsig router — bsig/router, Route configs, <Router />, <Link>, <Outlet />, navigate(), beforeEnter guards, lazy() routes, prefetching, or matchTree(). Covers the API surface and gotchas (parent preservation, parallel guards, vendored regexparam matching) so routing code follows the router's conventions.
---

# bsig/router

Signal-native router for bsig, shipped as the separate `bsig/router` entry
point (guide: `docs/router.md`). Unlike URL-resolution routers it never rebuilds
the tree from the root — **only the outlet slot whose route changed remounts**,
so shared parents (layouts, sidebars, scroll state) stay mounted. Matching is
powered by vendored [regexparam](https://github.com/lukeed/regexparam). URL and
history handling is built on the [Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API):
one `navigate` event listener (wired by `<Router />`) handles link clicks,
programmatic navigation, and back/forward; `router.navigate()` just calls
`navigation.navigate()`. Guards and redirects run in the event's
`precommitHandler` (before the URL commits); a guard returning `false` cancels
the navigation by rejecting.

This is **bsig**, not React and not the older sigwork API: components run once,
and the JSX plugin auto-thunks dynamic expressions — write plain values
(`{user.value}`), never `() =>` wrappers. Import the router's components from
`bsig/router`, the runtime from `bsig`.

## Quick start

```tsx
import mount from 'bsig';
import { Router, Link, Outlet } from 'bsig/router';
import type { Route } from 'bsig/router';

const RootLayout = () => (
  <div>
    <Link to="/">Home</Link> <Link to="/about">About</Link>
    <Outlet />
  </div>
);

const routes: Route = {
  path: '/',
  component: RootLayout,
  children: [
    { path: '', component: HomePage }, // "/" (index route)
    { path: '/about', component: AboutPage }, // "/about"
  ],
};

mount(document.getElementById('app')!, () => <Router routes={routes} />);
```

`<Router />` mounts the tree, starts at `window.location.pathname`, and wires up
the Navigation API's `navigate` event (link clicks, programmatic navigation, and
back/forward) — no manual `navigate()` bootstrap needed.

## Core API

- **`<Router routes={...} notFound={...} beforeEnter={...} />`** or
  **`<Router router={instance} />`** — mounts a router. Returns the root layout
  (internally through an array), so it is safe as the app root and can also be
  nested inside another component.
- **`<Link to="/path">`** — SPA `<a>`; no active-class prop. When the current
  path equals `to` or is nested under it (`"/"` matches only exactly) it sets
  `aria-current="page"` (else `"false"`), styled via an
  `[aria-current="page"]` rule. Prefetches on hover/focus/`pointerdown`. Extra
  props spread onto the anchor.
- **`<Outlet />`** — renders the matched route at the current nesting level;
  each layout renders exactly one. Use the JSX tag, not `{Outlet()}` (the tag
  creates the component context that `provide`/`inject` and lifecycles need).
- **`createRouter({ routes, notFound, beforeEnter })`** →
  `{ RouterView, Outlet, navigate, boot, handleNavigate, prefetch, isActive,
  Link, pathname }`.
- **`router.navigate(to, { replace? })`** → `Promise<boolean>` (`false` =
  blocked/superseded). Delegates to `navigation.navigate()`; guards run in the
  `navigate` event's `precommitHandler`.
- **`router.pathname`** — a reactive signal of the current pathname. Read
  `router.pathname.value` in JSX to stay live.
- **`router.isActive(to)`** — whether `to` is the active path.
- **`router.prefetch(to)`** — warm guards + lazy chunks without navigating.
- **`matchTree(routes, pathname, base)`** — pure matcher (chain or `null`).

## Route config

```ts
interface Route {
  path: string;
  component: (props: { params, route }) => any; // runs once
  children?: Route[];
  beforeEnter?: BeforeEnterFn;
}
```

- `path`: regexparam pattern — static segments, `:param`, `:param?`, `*`.
  `""` = index route (matches the parent path exactly); `"*"` = catch-all.
- Params are decoded and passed via `props.params`
  (`Record<string, string | string[]>`); the route object is `props.route`.
- Nesting is arbitrary depth; each level's layout renders its own `<Outlet />`.

## Navigation guards (`beforeEnter`)

Return values: `false` = **block**; `string` = **redirect** (push);
`{ path, replace?: true }` = **redirect** (replace); `undefined`/`true` = allow.
Hooks may be async.

- Global (on `createRouter` / `<Router />`) plus per-route (`route.beforeEnter`).
- For a navigation, **all matched-layer hooks run in parallel** (`Promise.all`);
  the render waits for the slowest.
- **The first definitive result in highest-parent-first order wins** — a
  parent's redirect beats a child's.
- Redirects are re-fed through the guard pipeline (visited-set loop guard → a
  loop ends in a block).
- Guards re-run on every navigation across all matched layers (no per-layer
  memoization).
- A boot-time redirect rewrites the address bar (`replaceState`) instead of
  pushing — the user never navigated anywhere.

## Lazy routes & prefetch

- **`lazy(() => import('./pages/X'), loading?)`** — imports on first visit (not
  app start); cached for revisits; emits a real bundler chunk. Optional
  `loading` node (default: nothing). Exposes `.preload()`.
- `<Link>` prefetches on hover/focus/`pointerdown` (touch): runs guards
  (verdict ignored) and loads lazy chunks. Best-effort — failures are swallowed
  and failed imports retry.

## Matching rules

- Parents match as a **prefix**; leaves match **exactly**; deepest match wins.
- regexparam regexes are case-insensitive; leaves allow a trailing slash
  (`/about` ≡ `/about/`).

## Gotchas / limitations

- **Single active router** per app (module-global `activeRouter`). `<Link />`
  and `<Outlet />` resolve it; outside a rendered `<Router />` they render
  `null`.
- `<Router />` runs its setup eagerly (initial boot + `navigate` listener)
  because bsig only flushes `onMount` for the root component and
  dynamically-inserted children.
- **Navigation API only** — no History-API fallback. Relies on
  `window.navigation` (Baseline 2026). Where it is missing the router still
  boots/renders, warns once, and `navigate()` degrades to a full navigation.
  The `navigate` event does not fire on first load, so `<Router />` renders the
  initial path explicitly. Reloads, hash-only changes, downloads, and form
  submissions are left to the browser (not intercepted).
- **Components run once**; a `:param` change within the same route remounts
  that leaf (the outlet key includes params) rather than re-rendering the
  instance.
- Not React Router: no loaders, no `useParams`, no nested `<Route>` JSX. Routes
  are plain objects, params come through props, and layouts render `<Outlet />`.
- `bsig/router` is a separate entry point — nothing is pulled into the runtime
  bundle unless imported, so adding routing never taxes non-routed pages.

## Installing this skill

```sh
npx -p github:unbiased-dev/bsig#v0.6.0 bsig-skill router
# or: npx -p github:unbiased-dev/bsig#v0.6.0 bsig-router-skill
# variants: --opencode | --claude | --global | --dest <dir>
```
