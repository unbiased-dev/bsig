# Changelog

Notable changes to **bsig**, newest first. bsig is installed straight from
GitHub by tag (`npm install github:unbiased-dev/bsig#vX.Y.Z`), so **the tag is
the release**; versions below track the tagged releases. Semver-ish: **minor**
for new capability, **patch** for fixes.

## v0.7.0

**Breaking:** `bsig/router` drops the Navigation API for the History API (so
routing works identically in every browser, Safari included) and reworks the
hook surface: `lazy()` is gone, `beforeEnter` is renamed to `guard`, and
routes gain a `loader`.

- **Breaking:** `lazy()` is removed. Route components are plain static
  components; split chunks at the app/bundler level if you need to.
- **Breaking:** `beforeEnter` is renamed to **`guard`** (route field, router
  option, `<Router guard={...}>`); the `BeforeEnter*` types become `Guard*`.
  Semantics are unchanged: allow / block / redirect, async, precommit, re-run
  on traversal.
- **Breaking:** routes gain a **`loader({ to, from, params })`** hook for
  warming the app's data layer, replacing the component `preload()`
  convention. The return value is ignored — no `useLoaderData`, no router
  cache; components keep reading your store. On navigation, guards run first,
  then loaders start in parallel while the commit/render proceeds: they never
  delay or fail a navigation (errors are swallowed; write error state to your
  own store). Loaders re-run on traversal and must be idempotent. `prefetch()`
  warms the matched loaders only and never runs guards; `<Link>`
  hover/focus/pointerdown inherits that.
- One code path everywhere: `pushState`/`replaceState`, a `popstate`
  listener, and a document-level click interceptor (plain `<a>` tags too, not
  just `<Link>`). No `window.navigation` dependency, no degrade-to-full-load,
  no setup warning.
- Guards run before the URL commits, so blocks and redirects never flicker —
  including on Safari, where the old `precommitHandler` design silently
  no-op'd and guarded navigations went through.
- Back/forward re-run guards; a blocked traversal pins the address bar back
  to the page on screen, and a redirected traversal rewrites the entry.
- Scroll restoration: per-entry keys are stamped onto `history.state` (the
  History API ships none); push/replace scroll to top, and back/forward
  restore the remembered offset in one microtask-deferred jump after the
  destination commits. The 60-frame rAF chase and the wheel/touchstart/keydown
  cancel listeners are gone (`AbortController` listener options were ignored
  on Safari < 15.4 anyway).
- Fixes: a throwing guard during boot no longer rejects the boot (the outlet
  stays empty, like a block); malformed `%` escapes in params no longer crash
  a navigation; blocked/redirected traversals preserve the entry's
  `history.state` payload; `prefetch('/path?query')` now matches.
- The vendored `regexparam` is trimmed to the surface the router uses: string
  patterns, `:param`, `:param?`, and `*` (no `inject`, RegExp input, or
  `.ext`).
- API change: `handleNavigate(event)` / `RouterNavigateEvent` are removed;
  the instance now exposes `handleClick(event)` and `handlePopState()` (wired
  by `<Router />`, removed on unmount). The rest of the surface is unchanged.
- Size (`router.js` minified, `runtime.js` external): 6405 → 5138 raw,
  2740 → 2352 gzip, 2468 → 2107 brotli — roughly -20% raw, and the router is
  now smaller than the runtime it rides on.
- Tests drive the real History API (no Navigation API mock): 50 happy-dom
  router tests plus a 22-test router browser suite covering guard
  redirect/block and blocked back-navigation through real navigations.

## v0.7.1 — 2026-10-16

Runtime hardening from the 2026-10-15 review (six fixes, no public API
changes) plus the move of the test suite to Bun.

- **A throwing effect no longer bricks reactivity.** An error inside an
  effect is rethrown asynchronously (as an uncaught error) and the rest of the
  batch still runs, instead of leaving the scheduler wedged so every later
  signal write is silently dropped.
- **`reactive` handles `Object.prototype` keys.** Reads/writes of `toString`,
  `constructor`, `hasOwnProperty`, … are ordinary tracked keys instead of
  throwing (`subs.add is not a function`), and `__proto__` keeps raw-JS
  prototype semantics without crashing the notification path.
- **`Show`/`If` branches revive on re-show.** Hiding a branch stops it; a
  prebuilt branch (element children, manual `h()` nodes) is now rebuilt on
  re-show — bindings live again, `onMount` refires, fresh node identity —
  instead of refiring with dead bindings.
- **`If` stops the outgoing branch scope on switch.** Effects created while a
  branch was built (including array-returning branches) no longer keep
  updating detached nodes after a toggle.
- **`For` is duplicate-safe.** Equal values in an unkeyed list, or repeated
  key-function results, get their own nodes instead of collapsing rows;
  duplicates are rebuilt on every update (fix the key if that churn matters).
- **`true` children render nothing.** Booleans now behave like `false`
  (`0` and `''` still render as text).
- Docs: the `Show`/`If` branch lifecycle and branch-scope contract, `reactive`
  limitations (membership/spread reads, native collections, prototype keys),
  `<Component is>` requiring a thunk, parent-first `onUnmount` order, and
  `Transition` leaves needing a real `transitionend`.
- Size: `runtime.js` grew 5444 → 5638 B minified (2449 → 2547 gzip,
  2204 → 2304 brotli, +3.6%) for the six fixes; `router.js` and `auth.js` are
  unchanged. Measured with `Bun.build({ minify: true })`.

- **Test suite moved to Bun.** `bun test` replaces `node --test`; assertions use
  `bun:test`'s `expect`, the DOM is **happy-dom** (registered by `test/setup.ts`
  via `bunfig.toml`), and Node APIs in tests gave way to `Bun.file`/`Bun.write`,
  `import.meta.dir`, `Bun.$`, and `Bun.build` (esbuild dropped).
- **Coverage and reporting.** `bun run test:coverage` emits `text` + `lcov`
  (into `coverage/`); `bun run test:ci` also writes a JUnit `junit.xml`.
- **Real-browser tests via `Bun.WebView`** (no Playwright): `bun run
  test:browser` boots the runtime in a real browser and drives native clicks.
  They are opt-in and skipped in the default run. The router has its own
  browser suite (`test/browser/router.test.mjs`): boot/render over
  real HTTP, nested params, notFound, native Link clicks with no reload,
  `navigate()` push/replace (history length), `history.back()` traversal,
  `isActive()`, boot-time guard redirects, guard redirect/block and blocked
  back-navigation through real navigations, prefetch
  (direct + Link hover, loaders only), `onUnmount` on leave, `matchTree`,
  `<Router routes={...}/>`, scroll-to-top on push, and a kitchensink driving
  them together.
- **100% coverage.** Every shipped module (`runtime`, `router`, `auth`, the
  JSX runtimes, and the plugins) is fully covered by `% Funcs` and `% Lines`;
  `bunfig.toml` keeps a floor so the harness cannot rot.
- **Typecheck.** `bun run typecheck` now runs `bun check` (Bun ≥ 1.4.3,
  TS 7 semantics) from the root `tsconfig.json` over the public `.d.ts` and
  the TypeScript test harness; the `typescript` dev-dep is gone (the demo
  keeps `tsc` for stock-consumer coverage).
- `package-lock.json` replaced by `bun.lock`.

## v0.6.2 — 2026-10-14

Two consumer-reported fixes to `bsig/auth`:

- **`signOut()` no longer reports success on a failed request.** It clears
  `session` and broadcasts to other tabs **only when the server confirms**. A
  failed request — a network error, or a CSRF `403` such as
  `MISSING_OR_NULL_ORIGIN` — keeps the session and returns `{ error }`, so the
  next refetch can no longer resurrect a session that was never revoked. Return
  type is now `Promise<{ error: AuthError | null }>`.
- **Added `loadSession()`.** The memoized initial read for boot and route
  guards: the first call fetches, later calls resolve instantly, so guards that
  await it on every navigation do not re-hit the network. `refreshSession()`
  stays the force-refetch.
- Docs/skill fixes: corrected the `signOut()` description and added the missing
  `<Show>` imports to the examples.

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
