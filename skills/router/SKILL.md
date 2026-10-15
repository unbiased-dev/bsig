---
name: router
description: Use when working with the bsig router — bsig/router, Route configs, <Router />, <Link>, <Outlet />, navigate(), guard and loader hooks, prefetching, or matchTree(). Covers the API surface and gotchas (parent preservation, parallel guards, fire-and-forget loaders, vendored regexparam matching) so routing code follows the router's conventions.
---

# bsig/router

Signal-native router for bsig, shipped as the separate `bsig/router` entry
point (guide: `docs/router.md`). Unlike URL-resolution routers it never rebuilds
the tree from the root — **only the outlet slot whose route changed remounts**,
so shared parents (layouts, sidebars, scroll state) stay mounted. Matching is
powered by vendored [regexparam](https://github.com/lukeed/regexparam). URL and
history handling is built on the History API (`pushState`/`replaceState`, a
`popstate` listener, and a document-level click interceptor), so it behaves
identically in every browser — Safari, Firefox, Chromium, WebViews — with no
Navigation API dependency. Guards run before the URL commits, so blocks and
redirects never flicker; route loaders warm your store after guards pass
without delaying the swap; per-entry scroll keys are stamped onto
`history.state`.

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
a document click interceptor plus a `popstate` listener (link clicks,
programmatic navigation, and back/forward) — no manual `navigate()` bootstrap
needed.

## Core API

- **`<Router routes={...} notFound={...} guard={...} />`** or
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
- **`createRouter({ routes, notFound, guard })`** →
  `{ RouterView, Outlet, navigate, boot, handleClick, handlePopState, prefetch,
  isActive, Link, pathname }`.
- **`router.navigate(to, { replace? })`** → `Promise<boolean>` (`false` =
  blocked/superseded). Runs guards, then commits with `pushState`
  (`replaceState` for `replace`).
- **`router.pathname`** — a reactive signal of the current pathname. Read
  `router.pathname.value` in JSX to stay live.
- **`router.isActive(to)`** — whether `to` is the active path.
- **`router.prefetch(to)`** — warm the matched route loaders (never guards) without navigating; best-effort and deduped per target.
- **`matchTree(routes, pathname, base)`** — pure matcher (chain or `null`).

## Route config

```ts
interface Route {
  path: string;
  component: (props: { params, route }) => any; // runs once
  children?: Route[];
  guard?: GuardFn;
  loader?: LoaderFn; // warm your own store; return value ignored
}
```

- `path`: regexparam pattern — static segments, `:param`, `:param?`, `*`.
  `""` = index route (matches the parent path exactly); `"*"` = catch-all.
- Params are decoded and passed via `props.params`
  (`Record<string, string | string[]>`); the route object is `props.route`.
- Nesting is arbitrary depth; each level's layout renders its own `<Outlet />`.

## Navigation guards (`guard`)

Return values: `false` = **block**; `string` = **redirect** (push);
`{ path, replace?: true }` = **redirect** (replace); `undefined`/`true` = allow.
Hooks may be async.

- Global (on `createRouter` / `<Router />`) plus per-route (`route.guard`).
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

## Loaders & prefetch

`loader({ to, from, params })` warms the app's own store; the return value is
ignored (no `useLoaderData`, no router cache) and the router passes no data to
components.

- Starts **after guards pass** on navigation, in parallel across the matched
  chain, and never delays or fails the commit (fire-and-forget; errors are
  swallowed — write error state in your store).
- `<Link>` hover/focus/`pointerdown` and `router.prefetch(to)` run loaders
  **only — never guards**; best-effort, errors swallowed, in-flight runs
  deduped per target, query strings stripped (`/x?q=1` still matches).
- Re-runs on every navigation including traversal, and may run twice
  (prefetch + navigation): keep loaders **idempotent** (HTTP cache, promise
  dedupe, or a check-first write).

## Matching rules

- Parents match as a **prefix**; leaves match **exactly**; deepest match wins.
- regexparam regexes are case-insensitive; leaves allow a trailing slash
  (`/about` ≡ `/about/`).

## Gotchas / limitations

- **Single active router** per app (module-global `activeRouter`). `<Link />`
  and `<Outlet />` resolve it; outside a rendered `<Router />` they render
  `null`.
- **Mountable anywhere.** `<Router />` works as the app root or nested inside
  another component — including conditionally, e.g. wrapped in `<Show>` (its
  children are thunked so each activation remounts it). Layouts may return a
  fragment root. Config props (`routes`/`router`/`notFound`/`guard`) are
  unwrapped from the plugin's auto-thunks, so passing them by reference is fine.
- `<Router />` runs its setup eagerly (initial boot + `navigate` listener)
  because bsig only flushes `onMount` for the root component and
  dynamically-inserted children.
- **Works in every browser** — History API only (`pushState`/`replaceState` +
  `popstate`, Baseline since IE10), no Navigation API dependency. Same-document
  link clicks are intercepted at the document level (plain `<a>` tags too, not
  just `<Link>`); modifier/non-left clicks, `target`/`download` links, external
  origins, and same-page (hash) targets are left to the browser. The
  `popstate` event does not fire on first load, so `<Router />` renders the
  initial path explicitly. Reloads are left to the browser (boot re-runs).
- **Components run once**; a `:param` change within the same route remounts
  that leaf (the outlet key includes params) rather than re-rendering the
  instance.
- **Scroll** — push/replace scroll to top; back/forward restore the remembered
  offset in one microtask-deferred jump after the destination commits.
  Traversal re-runs guards (and loaders), and a blocked traversal pins the
  address bar to the page on screen.
- **Loaders never block** — they may run twice (prefetch, then navigation;
  again on traversal) and start after guards pass. Keep them idempotent and
  store-driven.
- Not React Router: no `useLoaderData` (loaders warm your store; their return
  value is ignored), no `useParams`, no nested `<Route>` JSX. Routes are plain
  objects, params come through props, and layouts render `<Outlet />`.
- `bsig/router` is a separate entry point — nothing is pulled into the runtime
  bundle unless imported, so adding routing never taxes non-routed pages.

## Installing this skill

```sh
npx -p github:unbiased-dev/bsig#v0.7.0 bsig-skill router
# or: npx -p github:unbiased-dev/bsig#v0.7.0 bsig-router-skill
# variants: --opencode | --claude | --global | --dest <dir>
```
