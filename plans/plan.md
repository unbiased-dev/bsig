# Plan: slim `bsig/router` (guard/loader API, drop lazy, single-jump scroll, fixes, dedupe, vendor trim)

Status: complete — all 8 steps Done; release (tag/push/publish) left to the user · Last updated: 2026-10-15

## For a fresh session (read this first)

1. Read this file completely, then the `plans/step-N.md` you were asked to run.
2. Do exactly one step per session unless the user says otherwise. Steps are
   ordered and depend on each other; do not start a step whose prerequisites
   are not `Done` in the Progress log.
3. Follow the repo conventions (`AGENTS.md`): `bun test`, `bun run typecheck`,
   docs + skills kept in step, `.d.ts` kept in sync, zero runtime
   dependencies, `bsig/router` stays a separate tree-shakeable entry point,
   and nothing new lands in `runtime.js`.
4. At the end of the step: run the step's verification, commit, then update
   this file (Progress log, Bug ledger, Handoff notes). Details in
   [Plan maintenance](#plan-maintenance).

## Goal

Make `bsig/router` smaller, simpler, and correct without touching the runtime:

- Remove `lazy()` entirely (breaking).
- Split route hooks: rename `beforeEnter` → **`guard`** (policy, unchanged
  semantics) and add **`loader`** (route data warm-up, replacing the `preload`
  convention).
- `prefetch()` runs the matched **loaders only** — never guards.
- Replace the 60-frame scroll chase with a single deferred `scrollTo` jump.
- Re-verify and fix the bugs in the Bug ledger after the cuts.
- Apply the zero-behavior-change simplifications from the review.
- Trim the vendored matcher to the surface the router actually uses.
- Update docs, skills, types, tests, and the changelog with every change.

Target: `router.js` ≤ ~5.2 KB raw minified (from 6.4 KB) and ≤ ~2.4 KB gzip
(from 2.7 KB). These are direction, not gospel: measure after every step.

## Current state (2026-10-15)

- HEAD `09f7c62` — "refactor(tests): update router tests to use History API
  and improve teardown logic", on `main`, with a clean working tree.
- `package.json` is already `0.7.0`; tag `v0.7.0` does not exist yet.
  `CHANGELOG.md` has a `## v0.7.0` section (History API rewrite) and an
  `## Unreleased` tooling section. All router work below belongs in the
  v0.7.0 notes (it is one unreleased release with breaking changes).
- `router.js` is History-API based. `lazy()` still exists; route hooks are
  `beforeEnter` (guards); `prefetch()` runs guards and calls
  `component.preload()`; scroll restoration chases the offset for up to 60 rAF
  frames and cancels on wheel/touchstart/keydown via `AbortController`
  listener options.
- Full suite at HEAD: 137 pass / 24 skip (`bun test`), `bun run typecheck`
  green.

### Sizes (Bun minify, `runtime.js` external)

Final numbers (step 8), with the planning baseline in parentheses. `runtime.js`
and `auth.js` are unchanged controls.

| module | raw | gzip | brotli |
| --- | --- | --- | --- |
| `runtime.js` (control) | 5444 | 2449 | 2204 |
| `auth.js` (control) | 3533 | 1519 | 1334 |
| `router.js` | 5138 (6405) | 2352 (2740) | 2107 (2468) |

Deltas for `router.js` vs baseline: **−1267 raw (−19.8%)**, **−388 gzip
(−14.2%)**, **−361 brotli (−14.6%)**. Router raw (5138) is below `runtime.js`
raw (5444) — confirmed.

A throwaway prototype from the review may still exist at
`/private/var/folders/zf/8680jwrj06b34yjrw_8jvrm40000gn/T/opencode/bsig-review/router.js`
(if the machine has not rebooted). It predates steps 1–2 (still has `lazy`
and the chase), but it demonstrates the trickier step-6 edits. Treat it as a
reference only — these instructions win on conflict.

## Decisions locked (from the review conversation)

| # | Decision |
| --- | --- |
| D1 | Delete `lazy()` and its types entirely (breaking). Route components are plain static components. |
| D2 | Rename `beforeEnter` → **`guard`** everywhere (breaking): route field, router option, `<Router guard={...}>`, and the `BeforeEnter*` types become `Guard*`. Guard semantics are unchanged: return `true`/`undefined` to allow, `false` to block, a string or `{ path, replace? }` to redirect; async supported; runs before the URL commits and re-runs on traversal. |
| D3 | Add a route-level **`loader`** hook (`({ to, from, params })`), replacing the `preload` convention. Loaders warm the app's own data layer; the return value is ignored (no `useLoaderData`, no router cache) and they must be idempotent. **Fire-and-forget:** on a real navigation, guards run first, then the matched loaders start in parallel and the commit/render proceeds immediately — loaders never delay the URL change or the page swap, and a rejection never fails a navigation (errors are swallowed; loaders write their own error state to the store). Prefetch runs loaders only (never guards), also best-effort. |
| D4 | `prefetch()` runs matched loaders only — never guards. It dedupes in-flight runs per target, matches the pathname (so `/path?query` works), and swallows errors. |
| D5 | Keep custom scroll management (top on push/replace, restore the remembered offset on traversal) as a single deferred `scrollTo` jump — scheduled with `queueMicrotask` after the render flush (not rAF: rAF is throttled in hidden tabs and needs test mocking). No 60-frame chase, no wheel/touch/keydown cancel listeners. |
| D6 | Trim `vendor/regexparam.js` to `parse` with string patterns only (`:param`, `:param?`, `*`): drop `inject`, RegExp input, and `.ext` support. |
| D7 | Fix Bug ledger B1–B3; re-verify each bug is still present after steps 1–2 before fixing. |
| D8 | Apply the zero-behavior simplifications batch (step-6 list). |
| D9 | Docs, skills, types, and changelog are updated alongside each change. No release tag/publish in this plan. |

## Non-goals

- Do not touch `runtime.js`, `auth.js`, plugins, or the JSX runtime.
- No loader result passing (`useLoaderData`), no loader cache/revalidation,
  no global/router-level loader, no pending-navigation UI. Loaders warm the
  app's own store; components keep reading that store.
- Do not remove custom scroll management (the user rejected deferring to the
  browser's `scrollRestoration`). Do not scroll to top on back/forward.
- No hash support work (`split()` still drops `#hash`; same-page hash links
  stay native). Record only.
- No multi-router/context work (`activeRouter` stays a module global).
- No hand-rolled matcher (keep the vendored, trimmed one).
- No merge of `boot()` into `traverse()` and no changes to the `RouteNode` /
  `RouterView` array-return trick — both are deliberate.
- No version bump, tag, or GitHub release (user's call after review).
- Do not change the `bsig:key` state key format.

## Bug ledger

| # | Bug at HEAD | Owner step | Status |
| --- | --- | --- | --- |
| B1 | `boot()` has no `.catch` around `resolve()`: a throwing guard rejects the floating `boot()` promise and the outlet stays blank. | step-3 | Fixed (step-3): `boot()` catches like `navigate()`/`traverse()`; regression in `test/router.test.mjs` (`boot + render`). |
| B2 | `matcher()` calls `decodeURIComponent` unguarded: a malformed `%` escape crashes `navigate`/`boot`/`traverse`. | step-3 | Fixed (step-3): malformed escapes keep the raw segment; `matchTree` unit test + boot end-to-end test. |
| B3 | `traverse()` blocked/redirect rewrites `history.state` to `{bsig:key}`, dropping any foreign payload. | step-3 | Fixed (step-3): all four rewrite sites merge via `state_with_key`; regression in `back/forward traversal`. |
| B4 | `prefetch(to)` matches against `to` including `?...`, so query-string targets never warm anything. | step-5 | Fixed (step-5): `prefetch` matches `split(to).path`; regressions in both suites prefetch `/heavy?page=2` and assert the loader ran with guards untouched (`guarded` counter / `__guardCalls === '[]'`). |
| B5 | `AbortController` + `{signal}` listener options are ignored on Safari < 15.4, leaking listeners and silently breaking "manual scroll cancels restore". | step-2 (deleted with the chase) | Resolved by deletion (step-2): the step's grep for `AbortController` / `wheel` / `touchstart` / `keydown` / `frames >= 60` / `requestAnimationFrame` in `router.js` returns nothing. |

## Step map

| Step | File | Depends on | One-line goal |
| --- | --- | --- | --- |
| 1 | `plans/step-1.md` | — | Remove `lazy()` from router, types, tests (happy-dom + browser), demo, docs, skills. |
| 2 | `plans/step-2.md` | step-1 | Single `queueMicrotask` scroll restore; delete the 60-frame chase and cancel listeners. |
| 3 | `plans/step-3.md` | steps 1–2 | Re-verify bugs; fix B1, B2, B3 with regressions. |
| 4 | `plans/step-4.md` | step-3 | Rename `beforeEnter` → `guard` everywhere (breaking, mechanical). |
| 5 | `plans/step-5.md` | step-4 | Add route `loader`; prefetch runs loaders only; fix B4; extract `matchOf`. |
| 6 | `plans/step-6.md` | step-5 | Zero-behavior simplifications (matched signal, commits, outlet, traverse, guard verdicts, click handler, misc). |
| 7 | `plans/step-7.md` | step-6 | Trim `vendor/regexparam.js` to the used surface. |
| 8 | `plans/step-8.md` | steps 1–7 | Full verification, docs/skills/changelog sweep, final size report. |

Recommended branch: `git switch -c router-slim` in step-1. Commit after each
step with the message suggested in the step (the repo also uses
`refactor(tests): …` style for internal commits once released).

## Verification commands

Run from the repo root unless noted:

```sh
bun test                       # full suite (happy-dom)
bun run typecheck              # public .d.ts + TS test harness
bun run test:browser           # opt-in real-browser suite (BUN_BSIG_BROWSER=1)
(cd demo && npm run typecheck && npm run build)   # demo stays honest
```

If `bun run test:browser` cannot run in the session (no WebKit/Chrome
available), record that in the Progress log / Handoff notes — step-8 must
either run it or flag it as unverified.

### Size measurement

Write this once to the session temp dir and run it from the repo root after
each step (works for `runtime.js`, `router.js`, `auth.js`; `auth` is a
control):

```sh
cat > "${TMPDIR:-/tmp}/bsig-measure.mjs" <<'EOF'
import { build } from 'bun';
import { gzipSync, brotliCompressSync } from 'node:zlib';
for (const entry of ['runtime.js', 'router.js', 'auth.js']) {
  const out = await build({
    entrypoints: [entry],
    target: 'browser',
    minify: true,
    write: false,
    external: ['./runtime.js'],
  });
  const text = await out.outputs[0].text();
  const b = Buffer.from(text);
  console.log(
    entry.padEnd(11),
    'raw', String(b.length).padStart(5),
    'gzip', String(gzipSync(b).length).padStart(5),
    'brotli', String(brotliCompressSync(b).length).padStart(5),
  );
}
EOF
bun "${TMPDIR:-/tmp}/bsig-measure.mjs"
```

## Plan maintenance

After **every** step (this is how fresh sessions stay in sync):

1. Edit the Progress log: set the step's Status (`Done`, `Done with
   deviations`, or `Blocked`), append the commit hash, the router
   `raw/gzip/brotli` sizes after the step, and a one-line note.
2. Update the Bug ledger statuses for bugs fixed or verified in the step.
3. Append to Handoff notes only what the *next* step needs: new helpers and
   where they live, moved/renamed code, test rewrites, browser-suite
   availability, deviations from the plan and why.
4. If reality diverges from a step file (better approach found, instruction
   impossible), record the deviation in Handoff notes and fix the step file
   before finishing the session.
5. Use the `edit` tool on this file; never rewrite it wholesale (fresh
   sessions rely on historical notes).

### Progress log

| Step | Status | Commit | Router size (raw/gzip/brotli) | Notes |
| --- | --- | --- | --- | --- |
| 1 | Done | 908a5d4 | 6211/2650/2383 | happy-dom 135 pass / 23 skip; browser suite: ran (23 pass); demo typecheck+build green. |
| 2 | Done | 4bc99e0 | 5883/2528/2274 | happy-dom 135 pass / 24 skip; browser suite: ran (24 pass, +1 new test); demo typecheck+build green. Chase + cancel listeners deleted; router raw −328 B. |
| 3 | Done | face72d | 5914/2525/2274 | B1+B2+B3 fixed with 4 regression tests; happy-dom 139 pass / 24 skip (was 135/24); browser suite: ran (24 pass); demo typecheck+build green. +31 raw from the guards (gzip −3). |
| 4 | Done | b943880 | 5866/2519/2269 | `guard`/`Guard*` everywhere; grep for `beforeEnter\|BeforeEnter` across router.js/router.d.ts/docs/skills/README/demo/test/AGENTS returns nothing; happy-dom 139 pass / 24 skip; browser suite ran (24 pass); demo typecheck+build green. −48 raw vs step 3 from the shorter identifier. |
| 5 | Done | 09e11c8 | 5765/2523/2277 | Route `loader` + `matchOf`/`runLoaders`; prefetch warms loaders only (B4 fixed); happy-dom 143 pass / 24 skip; browser suite ran (24 pass); demo typecheck+build green. |
| 6 | Done | 355304c | 5262/2412/2168 | All 7 zero-behavior items landed; no API/behavior change. happy-dom 143 pass / 24 skip; browser suite ran (24 pass); typecheck + demo green. Router raw −503 B vs step 5. |
| 7 | Done | d8deda2 | 5138/2352/2107 | Vendored matcher trimmed (drop `inject`/RegExp/`.ext`); new matchTree test locks `:param?` + `*`; happy-dom 144 pass / 24 skip; browser 24 pass; tree-shake 2 pass; typecheck + demo green. Router raw −124 B vs step 6, under `runtime.js` (5444). |
| 8 | Done | (recorded next) | 5138/2352/2107 | Full verification green: happy-dom 144 pass / 24 skip, browser suite ran (24 pass), typecheck + demo typecheck/build green. Doc sweep clean; changelog rewritten as 0.7.0 release notes; final sizes recorded (router raw < runtime raw). Release left to the user. |

## Handoff notes (append per step)

- 2026-10-15 (plan author): baseline recorded above. The API direction was
  decided with the user: `beforeEnter` → `guard`, new `loader` replaces
  `preload`, prefetch runs loaders only. Loader timing was decided separately:
  **fire-and-forget** (never delays or fails a navigation; errors swallowed).
  A review prototype with the step-6-style edits exists at the tmp path above
  if the machine has not rebooted. Browser suite was not run during planning;
  assume it needs a real run in step-1.
- 2026-10-15 (plan author): scroll restoration was deliberately changed from
  the prototype's single-rAF deferral to `queueMicrotask`; verified against
  the runtime that a microtask queued right after a signal write observes the
  committed DOM (FIFO after the render flush).
- 2026-10-15 (step 1): `lazy()` is gone from `router.js`/`router.d.ts`/tests/
  demo/docs/skills/README. `prefetch` still has its HEAD shape and calls
  `component.preload?.()` — `preload` is now interim dead weight that step-5
  replaces with the route `loader`. Deviations from the step file: (a)
  `router.d.ts` also dropped the now-unused `Child` import (needed under
  `noUnusedLocals`); (b) the step claimed nothing else in
  `skills/router/SKILL.md` mentioned lazy, but the Core API `prefetch` bullet
  said "lazy chunks" — it now says "component preload hooks", and the Link
  bullet in the retitled `## Prefetch` section was reworded the same way while
  keeping the guard-running claim (step-5 rewrites both); (c) the browser
  kitchensink test title also dropped "lazy" (only the comment rename was
  specified). Browser suite ran for real (`BUN_BSIG_BROWSER=1`): 23 pass, 0
  fail. Happy-dom suite: 135 pass / 23 skip (was 137/24; the 2 lazy tests and
  1 skipped browser test are gone). Router sizes after: 6211 raw / 2650 gzip /
  2383 brotli (was 6405/2740/2468).
- 2026-10-15 (step 2): `restore_scroll` is now one `queueMicrotask` jump for
  non-zero targets (`window.scrollTo(0, target)` guarded by `scroll_token`);
  `restore_scroll(0)` still scrolls to top synchronously. Keep the code comment
  above `restore_scroll`: it documents the FIFO coupling with the render flush
  (a non-zero scroll must run after the destination commits or it clamps on the
  outgoing short page). `scroll_positions`/`scroll_token`/call sites unchanged.
  Verification: `bun test` 135 pass / 24 skip (24th skip = the new opt-in
  browser test); `bun run typecheck` green; browser suite ran for real
  (`bun run test:browser`): 24 pass / 0 fail, including the new "back()
  restores the scroll offset … in one jump" test on the `TALL` fixture; demo
  typecheck + build green. Router size after: 5883 raw / 2528 gzip / 2274
  brotli (was 6211/2650/2383): −328 raw, a bit under the step's "~400 B" estimate
  (comments/whitespace the minifier already dropped). Deviations: (a)
  `skills/router/SKILL.md` needed no edit — it only says per-entry keys are
  stamped onto `history.state`, and nothing there or in `skills/bsig` claims a
  chase or a wheel/touch/key cancel; (b) the happy-dom test also asserts the
  exact `scrollTo` call count (2 after back, 3 after forward) to pin the
  single jump — do not add stray scroll calls in later steps; (c) the browser
  test keeps the sketch's "push went top" (`scrollY === 0`) assertion.
  `CHANGELOG.md` still says "manual scrolling still cancels a restore" — step-8
  owns that sweep per line ~94 of step-8.
- 2026-10-15 (step 3): B1–B3 fixed in `router.js` (commit `face72d`), each
  reproduced failing first. `stamp` is gone; `state_with_key(key)` (next to
  `entry_key()`) merges `[STATE_KEY]` into whatever `history.state` already
  holds and is used at all four rewrite sites — boot adoption, boot redirect,
  traverse blocked pin, traverse redirect. `commit_push`/`commit_replace` still
  write `{ [STATE_KEY]: key }` (router-owned new entries). No `router.d.ts` or
  helper changes. New tests in `test/router.test.mjs` (+4): matchTree malformed
  `%`, boot throwing guard (calls `r.boot()` directly, no mount), boot with a
  malformed `%` param end to end, blocked traversal preserving `state.marker`
  (leaves the shared stack tidy with `r.navigate('/')`). B5 re-verified absent
  (`grep -n "AbortController\|signal:" router.js` → nothing). B4 is still
  present and untouched: `prefetch(to)` passes the full `to` (with `?...`) to
  `collectGuards`/`matchTree`, so `/heavy?x=1` never warms anything — step-5's
  prefetch rewrite owns it. Sizes after: 5914 raw / 2525 gzip / 2274 brotli.
- 2026-10-15 (step 4): `beforeEnter`/`BeforeEnter*` is gone from shipped code,
  types, docs, skills, demo, and tests; the hook is `guard`/`Guard*` on routes,
  `createRouter`, and `<Router/>` (commit `b943880`). Renamed sites:
  `router.js` (`options.guard`, `options.routes.guard`, `entry.route.guard`,
  `guard: asGuard(props.guard)`, one comment), `router.d.ts`
  (`GuardContext`/`GuardResult`/`GuardFn`, three `guard?: GuardFn` fields),
  `demo/src/typecheck/router.tsx`, `test/router.test.mjs` (16 option keys, test
  name, comment), `test/router-jsx.test.mjs` (test name, prop),
  `test/browser/router.test.mjs` (7 keys), `docs/router.md`, both skills.
  Step-3's grep check for this rename was run verbatim and returned nothing;
  `README.md`/`AGENTS.md` had no prop-name mentions (only "async guards") and
  were untouched. `CHANGELOG.md` still carries `beforeEnter` in its v0.7.0 and
  historical sections, plus the stale `AGENTS.md` repo-map "lazy" row — step-8
  owns both sweeps (its doc-sweep list covers them). Verification: `bun test`
  139 pass / 24 skip (same as step 3), `bun run typecheck` green, browser suite
  ran (`bun run test:browser`): 24 pass / 0 fail, demo typecheck + build green.
  Sizes after: 5866 raw / 2519 gzip / 2269 brotli (was 5914/2525/2274; −48 raw
  from the shorter identifier). Deviation: the `asGuard` comment reads
  `guard={fn} -> () => fn` (clearer than a literal `guard={guard}`); all other
  edits were mechanical. No behavior change; `prefetch` (still guard-running,
  B4 still present) was deliberately not touched. Step-5 must not resurrect
  `beforeEnter` anywhere while adding `loader` — the step-8 sweep will catch it
  if it does.
- 2026-10-15 (step 5): route `loader({ to, from, params })` lands (commit
  `09e11c8`). `matchOf(target)` is the shared chain builder (next to the
  signals) used by `render`, `collectGuards`, `runLoaders`, and `prefetch`.
  Loaders are **fire-and-forget**: `resolve` starts them via
  `runLoaders(path).catch(() => {})` once guards pass and returns immediately;
  a loader rejection never fails or delays a navigation (happy-dom
  regression), and `prefetch`/`<Link>` never invoke guards (counters in
  happy-dom + browser tests). `prefetch(to)` warms `split(to).path` only, so
  B4 is fixed; the in-flight Set dedupes overlapping runs and a later run
  after completion re-runs (regression added). `preload` is gone from shipped
  code; remaining `preload` hits are bun-test preload comments
  (`test/setup.ts`, `test/helpers.ts`, `test/auth.test.mjs`) and
  `demo/node_modules`/`demo/dist` artifacts. Deviations from the step file:
  (a) its `resolve` snippet used step-6's `verdict === 0` encoding — kept the
  current `{ type: 'block' }` / `{ type: 'redirect' }` verdicts and put the
  `runLoaders` call in the `verdict === null` branch; step-6 item 5 converts
  to the `0` sentinel. (b) The step's prefetch test expected `guarded === 0`
  after boot, but boot runs the global guard, so it asserts `guarded === 1`
  after boot and `=== 1` after prefetch (proves the counter runs and prefetch
  adds nothing). (c) Added an in-flight dedupe regression beyond the listed
  tests. (d) Skipped the optional browser "navigate returns before the loader
  resolves" assertion (timing-only; the gated happy-dom test covers it
  deterministically). HEAVY browser fixture: `Heavy.preload` is gone; the
  route carries `loader: function () { window.__loaderRan = true }` plus the
  guard that records `__guardCalls`; prefetch and hover assert
  `__loaderRan === true` and `__guardCalls === '[]'`. Sizes after:
  5765 raw / 2523 gzip / 2277 brotli (was 5866/2519/2269; −101 raw, gzip +4
  and brotli +8 noise from the new `matchOf`/`runLoaders` shapes).
  Verification: `bun test` 143 pass / 24 skip, `bun run typecheck` green,
  `bun run test:browser` 24 pass / 0 fail, demo typecheck + build green.
  `runGuards` still returns `{ type }` verdicts — step-6 item 5 owns the
  switch to `0`. Step-6 must not re-add `matchOf`/`runLoaders`/prefetch
  (already listed as done in its header); item 1's `Outlet`/`matchOf` change
  and item 5's `resolve` snippet now match this file's shape.
- 2026-10-15 (step 6): all seven zero-behavior items landed in `router.js` only
  (commit `355304c`; no `.d.ts`, tests, docs, or skills changed): (1) `matched`
  signal + `render()` deleted — `apply(path)` writes only `pathname`, `Outlet`
  calls `matchOf(pathname.value)[depth]`; (2) `commit_push`/`commit_replace`
  merged into `commit({ path, href, replace })`; (3) `Outlet` single-slot
  cache (`key`/`node` locals, same remount semantics); (4) `traverse`
  consolidated (save offset + set `current_key` once, then branch);
  (5) `runGuards` returns the internal `0` sentinel for a block and passes a
  guard's own object through for redirects (strings wrapped as `{ path }`,
  `resolve` recurses with `!!verdict.replace`; parallel `Promise.all` kept);
  (6) compact click interceptor now reads `anchor.href` (base-resolving;
  unparseable hrefs still throw inside the try); (7) misc shrink
  (`history_api = history`; `new_key = () => 'k' + ++key_seq`; `current()`
  helper used by `boot`/`traverse`; `scroll_positions` object, not Map).
  `matchOf`/`runLoaders`/prefetch are step-5's and untouched; no item skipped.
  `<base>` outcome: happy-dom honors the element for `document.baseURI` but
  its `anchor.href` getter ignores it (probed: `<base href="/base/">` +
  `<a href="about">` → `http://localhost/about`), so no happy-dom test was
  added; a browser fixture could pin it later (serveApp would need to inject
  `<base>` into the head). All existing click cases (modifier/button, target,
  download, external, hash, malformed `http://[::1`) pass unchanged. Sanity
  grep clean: "matched" only in comments; no `commit_push`/`commit_replace`/
  `render(`. Verification: `bun test` 143 pass / 24 skip, `bun run typecheck`
  green, `bun run test:browser` 24 pass / 0 fail, demo typecheck + build
  green. Sizes after: 5262 raw / 2412 gzip / 2168 brotli (was 5765/2523/2277;
  −503 raw). Step-7 (vendor trim) was intentionally not started.
- 2026-10-15 (step 7): `vendor/regexparam.js` is now `parse` only, string
  patterns only (commit `d8deda2`); upstream `inject`, the
  `input instanceof RegExp` branch, and the `.ext` suffix handling
  (`/:name.:ext`) are gone. `vendor/regexparam.LICENSE` untouched. `router.js`
  only ever imported `parse` (line 16), so no call-site change was needed; no
  doc promised `.ext`, so no doc edit was due this step. Pattern coverage in
  `test/router.test.mjs` → `describe('router: matchTree')`: "matches nested
  routes, params, and loose parents" (`:id` + loose parent), "skips a loose
  parent whose child and exact path both miss", "keeps malformed percent
  escapes instead of throwing" (`%E0%A4%A`), and the new "matches optional
  params and catch-alls" (`:page?` with AND without the segment, and
  `/files/*` → `params['*'] === 'a/b/c'`, one decoded string). The new test
  was run green against the untrimmed parser first, then re-run after the
  trim (behavior-preserving). Verification: `bun test` 144 pass / 24 skip (was
  143/24; +1 test), `bun run typecheck` green, `bun run test:browser` 24
  pass / 0 fail, `bun test test/router-tree-shake.test.mjs` 2 pass (runtime
  bundle still excludes router/`regexparam`), demo typecheck + build green.
  Sizes after: 5138 raw / 2352 gzip / 2107 brotli (was 5262/2412/2168;
  −124 raw / −60 gzip), router raw now clearly under `runtime.js` (5444).
  Deviation: step-7's "expect no output" grep also hits two false positives —
  an ISO timestamp in `test/auth.test.mjs` and a stale `demo/dist` build
  artifact; the route-pattern/RegExp-path check itself is clean. Step-8's
  doc sweep still owns the `docs/router.md` "`*` yields an array" line (the
  vendored `(.*)` captures a single string — now locked by the new test) and
  the `CHANGELOG.md` scroll-cancellation line. Step-8 was not started.
- 2026-10-15 (step 8): plan complete. Verification on `router-slim`:
  `bun test` 144 pass / 24 skip, `bun run typecheck` green, `bun run
  test:browser` ran for real (24 pass / 0 fail), demo typecheck + build green.
  All six step-8 greps clean (`lazy()`, `beforeEnter`/`BeforeEnter`, `preload`,
  prefetch/loader wording, scroll cancel/chase, Navigation API) — remaining
  `preload` hits are bun-test preload comments plus the `demo/dist`
  modulepreload artifact; `lazy`/`beforeEnter` survive only as intentional
  breaking notes and pre-v0.7.0 history in `CHANGELOG.md`. Doc edits:
  `docs/router.md` catch-all now "one decoded string" (was "array") and the
  scroll paragraph is push/replace-top + one microtask-deferred restore;
  `skills/router/SKILL.md` gained a scroll Gotcha; `AGENTS.md` repo-map row is
  "loaders, prefetch"; README's stale `v0.6.1` example is `v0.7.0`.
  `CHANGELOG.md` v0.7.0 is the release-note rewrite for the final API (three
  breaking bullets — lazy out, guard rename, loader in — plus scroll/fixes/
  vendor/API/size/suite bullets; sizes 6405→5138 raw, 2740→2352 gzip,
  2468→2107 brotli); the Unreleased browser bullet says "prefetch (direct +
  Link hover, loaders only)" and no longer lists lazy placeholder/chunk.
  Deviation: the step's single commit was split into the docs commit (all doc
  files plus this plan, message per the step) and a follow-up bookkeeping
  commit that records that hash here — the Progress log cannot cite a commit
  that contains its own hash without an amend loop. Release (tag `v0.7.0`,
  push, `gh release create`, tag-install check) is the user's call;
  `router-slim` is not merged into `main`.

## Definition of done (whole plan)

- [x] `lazy()` gone from `router.js`, `router.d.ts`, docs, skills, demo, and
      all test suites.
- [x] `beforeEnter`/`BeforeEnter*` gone from the shipped code, types, docs,
      skills, demo, and tests; `guard`/`Guard*` used everywhere.
- [x] `loader` exists on routes, starts after guards pass on navigation
      without delaying the commit (fire-and-forget; errors swallowed), runs
      best-effort on prefetch, and is documented as idempotent and
      store-driven.
- [x] `prefetch()` runs loaders only, never guards, matches query strings, and
      dedupes in-flight runs.
- [x] Scroll restoration: one `queueMicrotask`-deferred `scrollTo` for a
      non-zero restore, immediate `scrollTo(0, 0)` for push/replace; no rAF
      chase, no `wheel`/`touchstart`/`keydown` listeners, no `AbortController`.
- [x] Bug ledger: every bug `Fixed` or `Resolved by deletion`, each with a
      regression test except deletions.
- [x] Simplifications applied; no public API change from step-6.
- [x] Vendored matcher trimmed and tested (`:param`, `:param?`, `*`).
- [x] `bun test`, `bun run typecheck`, browser suite, demo typecheck + build
      all green.
- [x] `docs/router.md`, both router skills, `README.md`, `AGENTS.md`, and
      `CHANGELOG.md` consistent with the new surface.
- [x] Final size table in this file updated; router raw size below
      `runtime.js` raw size.
- [ ] Release decision (tag/push/publish) left to the user.
