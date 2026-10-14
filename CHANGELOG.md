# Changelog

Notable changes to **bsig**, newest first. bsig is installed straight from
GitHub by tag (`npm install github:unbiased-dev/bsig#vX.Y.Z`), so **the tag is
the release**; versions below track the tagged releases. Semver-ish: **minor**
for new capability, **patch** for fixes.

## v0.6.1 — 2026-10-14

Fixes three issues reported by a consumer building an app with `bsig/router`.

### Router config props
The JSX plugin auto-thunks dynamic props, so `<Router routes={routes} />` and
`<Router router={r} />` delivered thunks and broke (`router.boot is not a
function`, or an empty render). `Router` now unwraps `router`/`routes`/
`notFound`, and resolves `beforeEnter` lazily so `beforeEnter={guard}` works
whether the guard is passed inline or by reference.

### Fragment layout roots
A layout returning a fragment (`<><nav/><Outlet/></>`) rendered the outlet's
thunk source as literal text. The runtime now resolves a dynamic child's return
recursively — arrays are lists, functions are thunks — so the
`Outlet → RouteNode → page` chain resolves at any depth.

### `<Router>` inside `<Show>`
Toggling a router (or any component) through `<Show>` and navigating later left
the DOM frozen: JSX builds element children eagerly, so removal stopped their
effects and re-insertion could not revive them. The plugin now passes `<Show>`
its element children as thunks, so each activation rebuilds the subtree.

Adds regression tests through the real plugin + esbuild + jsdom chain, plus
focused plugin/runtime tests. Docs and the router skill were updated.

## v0.6.0 — 2026-10-14

New opt-in entry point **`bsig/auth`** — a tiny, zero-dependency client for
[better-auth](https://www.better-auth.com/) servers, held in bsig signals.

- **API**: `initAuth`, the `session` / `isPending` / `isRefetching` /
  `sessionError` signals, `refreshSession`, `startSessionRefresh`,
  `signInEmail`, `signUpEmail`, `signOut`, and `authFetch` (escape hatch for any
  other `/api/auth` endpoint).
- **Behaviour kept from the official client**: request lifecycle hooks
  (`onRequest`/`onResponse`/`onSuccess`/`onError`), refetch on focus (5s rate
  limit), refetch when back online, cross-tab sync, optional polling, in-flight
  collapse, `needsRefresh` cookie-cache rotation, and 401-clears-session
  (5xx/network keeps the last known session).
- **Bring your own types**: register your `Session`/`User` on `AuthTypes` by
  declaration merging — no better-auth dependency.
- **Tree-shakeable**: a build that never imports `bsig/auth` leaves it out.
- Guide: `docs/auth.md`; agent skill installed with `bsig-auth-skill`.

## v0.5.0 — 2026-10-14

Ships the `bsig/router` guidance as a **separately installable agent skill**.

- `skills/router/SKILL.md` — the router API and gotchas (parent preservation,
  parallel guards, vendored regexparam matching, Navigation API caveats),
  adapted to bsig: single-arg components, the `<Outlet />` JSX tag, and
  auto-thunked JSX so there is no manual `() =>`.
- Installer now selects a skill: `bsig-skill`, `bsig-skill router`, or
  `bsig-router-skill` (new bin alias). Installs land in
  `.agents/skills/<skill>/` (plus `--opencode`, `--claude`, `--global`, `--dest`).
- Install pins bumped to `v0.5.0`.

## v0.4.0 — 2026-10-14

Adds an optional, tree-shakeable router under **`bsig/router`**.

- **Nested routes & layouts** — the root route's `component` is the layout;
  pages render `<Outlet/>`. Components get `{ params, route }`.
- **`<Link>`** — sets `aria-current="page"` when active and prefetches on
  hover/focus.
- **Guards** — `beforeEnter({ to, from })` returns `true`/`undefined` (allow),
  `false` (block), or a path / `{ path, replace? }` (redirect); may be async.
  Boot-time redirects rewrite the address bar.
- **`lazy()`** — async pages with a loading fallback and `.preload()`.
- **`createRouter()` / `matchTree()`** — imperative instance (`navigate`,
  `prefetch`, `isActive`, `pathname`) and a pure matcher.
- **Scroll restoration** — manual per-entry handling that plays well with lazy
  pages.
- Built on the Navigation API (`window.navigation`, Chromium); where unavailable
  it boots/renders, warns once, and `navigate()` degrades to a full navigation.
  `regexparam` is vendored under `vendor/` (MIT © Luke Edwards). Guide:
  `docs/router.md`.

### Runtime fixes (used by the router, useful on their own)
- Effects register cleanup with their nearest enclosing scope (idempotent
  `stop`), so components created inside a dynamic-child boundary are released
  when an ancestor unmounts.
- `h()` cleanup captures the component's own context, so `onUnmount` fires
  correctly for array-returning components.
- `h()`/`append()`/`mount()` treat an array return as a list of children.

## v0.3.6 — 2026-10-14

- Export `jsxDEV` from the runtime so Bun's non-production builds resolve the
  dev JSX runtime entry.
- Verify the skill CLI ignores a project `bunfig.toml` (a configured bundler
  plugin must not affect the installer).

## v0.3.5 — 2026-10-14

- **`bsig/bun-plugin`** — the same auto-thunk transform for Bun's bundler,
  bunfig-ready, with `plugin/bun.d.ts` and `test/bun-plugin.test.mjs`.
- Factored the shared Babel transform into `plugin/transform.js`, now used by
  both the Vite and Bun plugins.
- Guide: `docs/bun.md`.

## v0.3.4 — 2026-10-14

- **`bsig-skill` installer bin** (`skills/install.mjs`) — a single
  `npx`/`bunx` one-liner that installs the agent skill into
  `.agents/skills/bsig/`.

## v0.3.3 — 2026-10-14

- **bsig agent skill** — `skills/bsig/SKILL.md`, a full API reference with
  examples.
- Ship `skills/` in the published package; README updated.

## v0.3.2 — 2026-10-14

- Export `./jsx-dev-runtime` (resolving to `jsx-runtime`) so Vite's dev
  dependency scan resolves the dev JSX entry.

## v0.3.1 — 2026-10-14

- Plugin type declarations (`plugin/bsig-jsx.d.ts`).
- Fixed the published `package.json` version and tightened the packlist.

## v0.3.0 — 2026-10-14

- **TypeScript `.tsx` support** — the plugin strips types and compiles JSX in
  one pass; the `h` import is injected after the TS pass.
- Guide: `docs/vanilla-ts.md`; test: `test/tsx-chain.test.mjs` (real
  transform → esbuild → jsdom).

## v0.2.0 — 2026-10-14

- **Automatic JSX runtime** (`bsig/jsx-runtime`, `bsig/jsx-dev-runtime`) —
  `jsx`/`jsxs`/`Fragment`, so `jsx: "react-jsx"` + `jsxImportSource: "bsig"`
  works.
- Render children from `props.children`; dropped the stale `template/`
  directory.

## v0.1.1 — 2026-10-14

- `<Show>` accepts signals and plain values via `when`/`fallback`.
- Added a Vite + TS starter `template/` and a root README start guide.

## v0.1.0 — 2026-10-14

- Initial release: a tiny signal runtime (`signal`/`computed`/`reactive`,
  `effect`/`scope`/`watch`/`untrack`), `h` with direct-DOM, fine-grained
  patching, `If`/`Show`/`For`/`Component`/`Transition`, and `mount`, plus the
  Vite JSX plugin, a demo, and the test suite.
