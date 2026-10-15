# AGENTS.md

Guidance for agents (and humans) working **on** bsig itself. If you are
building an app *with* bsig, read the skills (`skills/bsig/SKILL.md`,
`skills/router/SKILL.md`), `README.md`, and `docs/`.

## What bsig is

bsig is a **very small, dependency-light toolkit for building full-blown
single-page apps**: a signal runtime with React-like JSX and no virtual DOM.
The mission is a hard constraint on every change:

> Tiny core, opt-in everything else. Nothing an app does not import should end
> up in its bundle.

- The **runtime is the product** — a few KB of signals, effects, and direct-DOM
  patching. Keep it that way; size is a feature.
- Anything not every app needs (routing, and future data/store/form helpers)
  ships as a **separate entry point** (`bsig/router`), declared in
  `package.json` `exports`/`files`, and **never imported by the core**.
- Prefer **zero runtime dependencies**. Build-time tooling (the Babel-based
  transform) may be a dependency; runtime helpers are vendored under `vendor/`
  with their license (e.g. `vendor/regexparam.js`).
- Easy beats clever: stock Vite/Bun plus a few wires, no pinned template.

If a feature grows the runtime or adds a runtime dependency for a niche use
case, it belongs in an opt-in entry — or not at all.

## Repo map

| Path | Role |
| --- | --- |
| `runtime.js` / `runtime.d.ts` | The core: `signal`/`computed`/`reactive`, `effect`/`scope`/`watch`/`untrack`, `h`, `If`/`Show`/`For`/`Component`/`Transition`, and default `mount`. |
| `jsx-runtime.js` / `.d.ts` | Automatic JSX runtime surface (types + dev fallback). The plugin does the real work. |
| `plugin/transform.js` | Shared Babel transform: auto-thunk dynamic JSX, strip TS, inject the `h` import. |
| `plugin/bsig-jsx.js`, `plugin/bun.js` | Vite and Bun plugins; `.d.ts` siblings. |
| `router.js` / `router.d.ts` | Opt-in `bsig/router`: nested routes, guards, loaders, prefetch, scroll restoration. |
| `auth.js` / `auth.d.ts` | Opt-in `bsig/auth`: zero-dependency better-auth client (sessions, email sign-in/up/out, refresh triggers). |
| `vendor/` | Vendored third-party source + license. |
| `skills/` | Agent skills and installers (`bsig-skill`, `bsig-router-skill`, `bsig-auth-skill`). |
| `test/` | `bun test` + happy-dom, real-transform and tree-shake guards, opt-in `Bun.WebView` browser tests. |
| `demo/` | Vite app exercising the runtime; also `src/typecheck/*.tsx` smoke files. |
| `docs/` | User guides (repo-only, not published to npm). |
| `bench/` | Local benchmarks (gitignored). |

## Architecture in one screen

- `h(tag, props, ...children)`: a **string** tag creates a DOM element; a
  **function** tag is a component, run *once* inside a fresh context
  `{ m, u, p }` (`onMount`, `onUnmount`, `provide`/`inject`) and stamped onto
  the returned node/function/array; `null` is a fragment (returns a thunk).
- **Reactivity is lazy and fine-grained.** A function-valued child or prop is a
  live binding; the compiler inserts those wrappers, so source JSX is written
  with plain values. Only nodes that read a changed signal update.
- **Context** flows by cloning `p` down the tree. `onMount` fires children-first
  after attach; `onUnmount` runs on removal.
- **Cleanup** is scope-based. A scope effect (components, `scope()`) marks
  itself with `c` and does not track reads; every effect registers its stop with
  the nearest enclosing scope's `k` list, and `stop` is idempotent. This is what
  lets components created inside a dynamic-child boundary be released when an
  ancestor unmounts. Changes here must keep `test/runtime2.test.mjs` green.
- **Array returns** are first-class: a component may return an array (used by
  provider-shaped components so an outer `h()` cannot stomp the child's
  lifecycle context). `h`/`append`/`mount` treat arrays as lists.
- Internal node fields (`$c` context, `$s` stop, `$l` leave/transition) are
  conventions, not public API. Don't expose them.

## Library and API conventions

- Components are **single-argument**: `(props) => node`; children arrive on
  `props.children`; callbacks are called directly via `props.onX` (no `emit`).
- Components **run once**; never write code that expects a re-render.
- Write plain reads in JSX (`{count.value}`, `disabled={off.value}`); the plugin
  thunks them. **Never** hand-wrap dynamics in `() =>` and never wrap `For`/`If`.
- Lists use `For(list, key, render)`; conditionals use `<Show>`.
- Classic JSX (`jsxFactory: "h"`) must keep working alongside the automatic
  runtime.
- Public types live in the sibling `.d.ts`; keep them in sync with the JS.

## Adding a new opt-in library (entry point)

1. New module at the package root (`query.js`) with a `query.d.ts`, importing
   `./runtime.js` so it shares the **same runtime instance**.
2. Never import it from `runtime.js`.
3. Add `"./query"` to `package.json` `exports` and the files to `files`.
4. Keep it dependency-free; if a dependency is unavoidable, vendor it under
   `vendor/` with its license and attribution.
5. Prove it is tree-shakeable: add a bundling guard like
   `test/router-tree-shake.test.mjs` (runtime-only bundle excludes it;
   importing it includes it).
6. Add tests, a `docs/*.md` guide, a README mention, and — if it has a real
   surface for app authors — a skill under `skills/<name>/SKILL.md` plus an
   installer target.

## Testing

- `bun test` runs the suite (Bun's built-in runner; config in `bunfig.toml`).
  `bun run test:coverage` adds `text` + `lcov` coverage (`coverage/`), and
  `bun run test:ci` writes a JUnit report (`junit.xml`) as well.
- `bun run typecheck` runs `tsc --noEmit` from the root `tsconfig.json` over the
  public `.d.ts` files and the TypeScript test harness (`test/*.ts`, e.g.
  `helpers.ts`/`setup.ts`). Test bodies are `.mjs` and are not type-checked;
  new harness types belong in `helpers.ts`.
- The DOM is **happy-dom**, registered globally by `test/setup.ts` and preloaded
  for every file — no per-file jsdom boilerplate. Tests flush with
  `setTimeout(0)`; `test/setup.ts` resets `document.body` between tests.
- Shared helpers live in `test/helpers.ts` (`useHistory()` URL setup and a
  `Bun.build`-based `bundle()`). Node APIs are avoided in tests; use `Bun.file`/
  `Bun.write`, `import.meta.dir`, `Bun.$`, and `Bun.build` instead. The router
  drives the real History API: entries persist across tests in a file
  (happy-dom never resets the stack), so each router test pushes its own anchor
  entry, never traverses past its own entries, and registers teardowns for the
  `afterEach` flush (a leaked document/popstate listener would hijack later
  tests). happy-dom performs default anchor navigations (even cross-origin),
  so left-alone click cases call `router.handleClick` directly instead of
  dispatching, and `replaceState` on a back-landed entry breaks happy-dom's
  `forward()` — adopted entries are tracked without stamping for that reason.
- Cover unit behavior, the **real transform chain** (`test/tsx-chain.test.mjs`),
  tree-shaking, and lifecycle/cleanup edge cases. Runtime cleanup changes
  should add a regression to `test/runtime2.test.mjs`.
- Real-browser tests (`test/browser/`) use the built-in `Bun.WebView` instead of
  Playwright and are **opt-in**: `bun run test:browser`. They skip unless
  `BUN_BSIG_BROWSER=1` and a browser can be spawned, so the default run stays
  fast. `router.test.mjs` there serves fixtures over node:http (SPA fallback)
  — not `Bun.serve`, whose `Response` the happy-dom preload shadows — and
  drives them with native clicks plus `evaluate`, including guard
  redirect/block and blocked back-navigation through real navigations.
- Keep the demo honest: `cd demo && npm run typecheck && npm run build`.

## Docs and skills

- `docs/` are user-facing guides; keep them in step with the API.
- `skills/bsig/SKILL.md`, `skills/router/SKILL.md`, and
  `skills/auth/SKILL.md` are how coding agents learn the library — update them
  whenever the public API changes.
- Install with `bsig-skill [bsig|router|auth]` (or `bsig-router-skill`,
  `bsig-auth-skill`); installs land in `.agents/skills/<skill>/` and the
  `--opencode`/`--claude`/`--global`/`--dest` variants.

## Release process

bsig is installed straight from GitHub by tag
(`npm install github:unbiased-dev/bsig#vX.Y.Z`), so **the tag is the release**.
Release notes are kept in the repo in [`CHANGELOG.md`](CHANGELOG.md).

1. Make sure `main` is green:
   ```sh
   bun test
   (cd demo && npm run typecheck && npm run build)
   ```
2. Bump `"version"` in `package.json`, then `bun install` to sync
   `bun.lock`.
3. Bump the install pins everywhere:
   ```sh
   grep -rn "#v0\." README.md docs skills
   ```
4. Add the version's notes to `CHANGELOG.md` (newest first). Keep them the same
   highlights you will publish on GitHub.
5. Commit using the repo convention: `vX.Y.Z: <what changed>` (one line; add a
   short body when useful).
6. Tag and push:
   ```sh
   git tag -a vX.Y.Z -m "vX.Y.Z: <what changed>"
   git push origin main
   git push origin vX.Y.Z        # retry once if the tag push fails transiently
   ```
7. Publish the GitHub release (use the changelog entry as the notes):
   ```sh
   gh release create vX.Y.Z --title "vX.Y.Z — <title>" --notes "<highlights>"
   ```
8. Verify the tag installs:
   ```sh
   npm install github:unbiased-dev/bsig#vX.Y.Z
   # or: npx -p github:unbiased-dev/bsig#vX.Y.Z bsig-skill
   ```

Versioning is semver-ish: **minor** for new capability, **patch** for fixes.
Docs-only changes (this file, `docs/`, README prose, `CHANGELOG.md`) can be
committed to `main` without a tag, since they are not part of the published
package.

## Definition of done

- [ ] `bun test` green, including new tests for new behavior.
- [ ] `bun run typecheck` green (public `.d.ts` + TS test harness).
- [ ] Demo typechecks/builds if the runtime or plugin changed.
- [ ] Runtime stayed tiny; new surface is opt-in and tree-shakeable.
- [ ] `.d.ts` types updated and accurate (no dependency on a too-new TS DOM lib).
- [ ] README/docs/skills updated.
- [ ] `CHANGELOG.md` has an entry for the version (same highlights as the
      GitHub release).
- [ ] If the published package changed: version bumped, tagged, released, and
      the tag verified to install.
