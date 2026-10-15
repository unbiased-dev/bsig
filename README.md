# bsig

Tiny signal-based reactive UI library with React-like JSX. Fine-grained updates, no virtual DOM.

Based on [Sigwork](https://github.com/thatjustworks/sigwork) — same engine and philosophy, with a friendlier authoring experience: no manual `() =>` wrappers in JSX, React-style `props.children`, and an optional [`<Show>`](https://framework.thatjust.works/docs) over callback-style `If()`.

Write plain JSX — `{name.value}`, `disabled={off.value}`, `{show.value && <span/>}` — and the Vite plugin turns dynamic expressions into lazy bindings. Components run once; only the DOM nodes that read a changed signal update.

## Start a new project

No template needed (pinned templates go stale) — stock `create-vite` plus
three wires, verified against current Vite + TS releases:

```sh
npm create vite@latest my-app -- --template vanilla-ts
cd my-app
npm install github:unbiased-dev/bsig#v0.7.0
```

1. `vite.config.ts` — `import bsig from 'bsig/plugin'` + `plugins: [bsig()]`
2. `tsconfig.json` — `"jsx": "react-jsx", "jsxImportSource": "bsig"`
3. Write `.tsx` — no `h` import needed, ever:

```tsx
import { signal, For } from 'bsig';

const count = signal(0);

export default function App() {
  return (
    <div>
      <p>Count: {count.value}</p>
      <button onClick={() => count.value++}>+</button>
    </div>
  );
}
```

Why this works without `h` in scope: the automatic JSX runtime
(`bsig/jsx-runtime`, used by `tsc` for types) plus the Vite plugin (which
compiles JSX to lazy thunks ahead of time, skipping `on*`/`ref`/statics).
It typechecks even under stock strict configs (`noUnusedLocals`,
`verbatimModuleSyntax`). The classic factory (`jsxFactory: "h"` + explicit
`h` imports) keeps working if you prefer it.

## Install

No registry needed — install straight from GitHub (use a tag for reproducible builds):

```sh
npm install github:unbiased-dev/bsig#v0.7.0
```

`package.json` accepts this anywhere a version goes, and lockfiles pin the exact commit.

## Setup

```js
// vite.config.js
import { defineConfig } from 'vite';
import bsig from 'bsig/plugin';

export default defineConfig({ plugins: [bsig()] });
```

```jsx
// App.jsx — no h import needed, the plugin injects it
import { signal, For, Show } from 'bsig';

const name = signal('world');

export default function App() {
  return (
    <div>
      <p>Hello, {name.value}</p>
      <button onClick={() => (name.value = 'sigwork')}>rename</button>
    </div>
  );
}
```

```js
// main.js
import mount from 'bsig';
import App from './App.jsx';

mount(document.getElementById('app'), App);
```

## API essentials

- `signal(value)` / `computed(fn)` / `reactive(obj)` — state; read `.value` (or properties) in JSX, it stays live
- `effect(fn)` / `scope(fn)` / `watch(source, cb)` / `untrack(fn)`
- Components are single-argument functions: `props`, with children on `props.children`. Call parent callbacks directly via `props.onX`
- `<Show when={...} fallback={...}>`, `For(list, key, render)`, `<Component is={...}>`, `<Transition enter idle leave>`
- `onMount` / `onUnmount`, `provide` / `inject`, `ref`
- Fragments (`<>...</>`) work as children and as the app root

Full reference with live examples: run the demo (`demo/`) and open `/docs/`.

## Bun (fullstack / HTML routes)

No Vite needed: `bsig/bun-plugin` gives `.tsx` the same auto-thunk transform
through Bun's bundler. In `bunfig.toml`:

```toml
[serve.static]
plugins = ["bsig/bun-plugin"]
```

plus `"jsx": "react-jsx", "jsxImportSource": "bsig"` in `tsconfig.json`.
Full walkthrough (server + HTML route + app): [`docs/bun.md`](docs/bun.md).

## Router (optional)

`bsig/router` is a separate, tree-shakeable entry — a build that never imports
it leaves it (and its vendored matcher) out of the bundle. Nested layouts,
params, async guards, loaders, and scroll restoration, built on the History
API so it behaves identically in every browser:

```tsx
import mount from 'bsig';
import { Router, Outlet, Link } from 'bsig/router';

const Layout = () => (
  <div>
    <Link to="/users/1">user</Link>
    <Outlet />
  </div>
);

const routes = {
  path: '/',
  component: Layout,
  children: [
    { path: '/', component: () => <h1>Home</h1> },
    { path: '/users/:id', component: ({ params }) => <p>{params.id}</p> },
  ],
};

mount(document.getElementById('app')!, () => <Router routes={routes} />);
```

Full guide: [`docs/router.md`](docs/router.md). Works in every browser
(Safari, Firefox, Chromium) with no dependencies.

## Auth (optional)

`bsig/auth` is a separate, tree-shakeable entry — a tiny, zero-dependency client
for a [better-auth](https://www.better-auth.com/) server (sessions, email
sign-in/up/out, and refresh triggers), held in bsig signals. A build that never
imports it leaves it out of the bundle:

```ts
import { initAuth, loadSession, session, signInEmail, signOut, startSessionRefresh } from 'bsig/auth';

initAuth(); // baseURL defaults to window.location.origin
startSessionRefresh(); // focus / online / cross-tab / polling
await loadSession(); // read once (boot / route guards); no-op afterwards

await signInEmail({ email, password });
console.log(session.value?.user.name);

const { error } = await signOut(); // clears the store only when the server confirms
```

It speaks the better-auth endpoints over plain `fetch`, so there is no
better-auth dependency to install — the session/user types are generic, and you
register your own by declaration merging. It replaces `better-auth/client` for
apps that only need the session flow. Full guide: [`docs/auth.md`](docs/auth.md).

## Agent skills (bsig for AI assistants)

Three skills ship in the package, installed with one command each (replace
`v0.6.1` with the newest tag):

- `skills/bsig/SKILL.md` — the full bsig API: signals, effects,
  `For`/`Show`/`Transition`, the plugin's auto-thunk rules, and the React habits
  that don't apply.
- `skills/router/SKILL.md` — the `bsig/router` API and gotchas (parent
  preservation, parallel guards, matching rules).
- `skills/auth/SKILL.md` — the `bsig/auth` client and gotchas (401 vs other
  errors, cookie rotation, refresh triggers, type extension).

```sh
npx -p github:unbiased-dev/bsig#v0.7.0 bsig-skill          # bsig skill
npx -p github:unbiased-dev/bsig#v0.7.0 bsig-skill router   # router skill
npx -p github:unbiased-dev/bsig#v0.7.0 bsig-skill auth     # auth skill
# or, for the router/auth skill:
#   npx -p github:unbiased-dev/bsig#v0.7.0 bsig-router-skill
#   npx -p github:unbiased-dev/bsig#v0.7.0 bsig-auth-skill
```

Default target is `.agents/skills/<skill>/` (discovered by OpenCode, Claude
Code, and other agents). Variants: `--opencode` (`.opencode/skills/`),
`--claude` (`.claude/skills/`), `--global` (`~/.config/opencode/skills/`),
`--dest <dir>`, `--help`. Manual fallback is a plain copy of `skills/<skill>/SKILL.md`
from the repo.

## How it stays tiny

The runtime is a few kilobytes of signals + effects + direct-DOM patching (keyed lists via LIS reconciliation). The compiler (build-time only) auto-wraps dynamic JSX children/props into thunks and skips `on*` handlers, `ref`, statics, and `For`/`If` calls (those already return stable thunks). See `plugin/bsig-jsx.js`; override the runtime path with `bsig({ runtime: './path/to/runtime.js' })` if needed.

## Working on bsig

Contributor and agent guidance — the project's scope, architecture, library
conventions, and the release process — lives in [`AGENTS.md`](AGENTS.md).
Release notes for every tagged version are in [`CHANGELOG.md`](CHANGELOG.md).

## License

MIT — see LICENSE.
