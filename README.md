# bsig

Tiny signal-based reactive UI library with React-like JSX. Fine-grained updates, no virtual DOM.

Based on [Sigwork](https://github.com/thatjustworks/sigwork) — same engine and philosophy, with a friendlier authoring experience: no manual `() =>` wrappers in JSX, React-style `props.children`, and an optional [`<Show>`](https://framework.thatjust.works/docs) over callback-style `If()`.

Write plain JSX — `{name.value}`, `disabled={off.value}`, `{show.value && <span/>}` — and the Vite plugin turns dynamic expressions into lazy bindings. Components run once; only the DOM nodes that read a changed signal update.

## Start a new project

Fastest — clone the Vite + TS template (pre-wired plugin, typechecking, example
counter/list/conditional):

```sh
npx degit unbiased-dev/bsig/template my-app
cd my-app
npm install
npm run dev
```

Or from a stock Vite template (`vanilla-ts` — there is no bsig template in
`create-vite` itself):

```sh
npm create vite@latest my-app -- --template vanilla-ts
cd my-app
npm install github:unbiased-dev/bsig#v0.1.1
```

Then wire three things: the plugin in `vite.config.ts`
(`import bsig from 'bsig/plugin'` + `plugins: [bsig()]`), classic JSX in
`tsconfig.json` (`"jsx": "react", "jsxFactory": "h"`), and write `.tsx`
components importing `{ h }` from `'bsig'` (the factory must be in scope for
`tsc`; the plugin leaves files that already import it alone). See
`template/` for the complete working setup.

## Install

No registry needed — install straight from GitHub (use a tag for reproducible builds):

```sh
npm install github:unbiased-dev/bsig#v0.1.1
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

## How it stays tiny

The runtime is a few kilobytes of signals + effects + direct-DOM patching (keyed lists via LIS reconciliation). The compiler (build-time only) auto-wraps dynamic JSX children/props into thunks and skips `on*` handlers, `ref`, statics, and `For`/`If` calls (those already return stable thunks). See `plugin/bsig-jsx.js`; override the runtime path with `bsig({ runtime: './path/to/runtime.js' })` if needed.

## License

MIT — see LICENSE.
