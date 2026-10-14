---
name: bsig
description: Build reactive UIs with bsig — signal-based JSX with no VDOM and no re-renders. Use for any task that imports from 'bsig' or 'bsig/router', edits .tsx under jsxImportSource bsig, or configures bsig/plugin.
---

# bsig

Tiny signal-based UI library with React-like JSX. Fine-grained updates, no
virtual DOM, components run once — only the DOM nodes that read a changed
signal update.

## This is NOT React

- No hooks: no `useState`, `useEffect`, `useMemo`, `useRef`, `useCallback`.
  State is `signal()` / `computed()` / `reactive()`; side effects are
  `effect()` / `watch()` / `onMount()`.
- Components run **once**, they never re-render. Reading `sig.value` inside
  JSX subscribes that DOM node; writing `sig.value = x` patches only
  subscribers (microtask-batched).
- Write plain values in JSX — `{count.value}`, `disabled={off.value}`.
  The Vite plugin wraps dynamics into thunks for you. Never hand-write
  `() =>` around JSX expressions.
- Components take a single `props` argument. Children arrive on
  `props.children`. There is no second context argument.
- Lists use `For()`, not `.map()`. There is no `key` prop — list identity
  comes from `For`'s key argument.
- Conditionals in JSX use `<Show>` (or `&&`), not React-style ternaries
  returning components — either works if values are plain, but `<Show>`
  caches branches.

## Setup (stock Vite, no template)

```sh
npm create vite@latest my-app -- --template vanilla-ts
cd my-app
npm install github:unbiased-dev/bsig#v0.5.0
```

## Bun alternative

Same ergonomics without Vite: `bsig/bun-plugin` in `bunfig.toml`
`[serve.static] plugins`, plus `"jsx": "react-jsx", "jsxImportSource": "bsig"`
in `tsconfig.json`. Without the plugin, plain `{count.value}` renders once
and goes static — hand-write `() =>` thunks or, better, use the plugin.
Without any bundler transform at all (e.g. hand-rolled `jsx()` calls),
`{() => count.value}` children and `prop={() => …}` props stay reactive
because `h()` subscribes function values; eager values never do.

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import bsig from 'bsig/plugin';

export default defineConfig({ plugins: [bsig()] });
```

`tsconfig.json` → `compilerOptions`: `"jsx": "react-jsx", "jsxImportSource": "bsig"`.
No file ever imports `h`. Entry:

```tsx
import mount from 'bsig';
import App from './App';

mount(document.getElementById('app')!, App);
```

## mount(target, root, props?)

Mounts a component into a DOM element. Returns an unmount function.

```tsx
const unmount = mount(document.getElementById('app')!, App);
unmount(); // removes the tree, runs onUnmount hooks, stops scopes
```

```tsx
// with props (children go in props.children, as usual)
mount(document.getElementById('card')!, Card, { title: 'hi' });
```

## signal(value)

Reactive cell. Read `.value` to subscribe, write `.value` to notify.
Writes are microtask-batched; writing the same value (`===`) is a no-op.

```tsx
import { signal } from 'bsig';

const count = signal(0);

export default function Counter() {
  return (
    <div>
      <p>Count: {count.value}</p>
      <button onClick={() => count.value++}>+</button>
      <button onClick={() => (count.value = 0)}>reset</button>
    </div>
  );
}
```

```tsx
const name = signal('world');
// NOT React: no setter function — assign .value directly
name.value = 'bsig';
```

## computed(fn)

Readonly derived signal. Recomputes when its dependencies change.

```tsx
import { signal, computed } from 'bsig';

const count = signal(2);
const doubled = computed(() => count.value * 2);

// in JSX:
<p>
  {count.value} x 2 = {doubled.value}
</p>;
```

## reactive(obj)

Deep reactive proxy for objects/arrays. Read/write properties directly —
no `.value`. Nested objects become reactive on access. Array `push`/`splice`
notify `length` readers.

```tsx
import { reactive } from 'bsig';

const form = reactive({ name: 'Ada', tags: ['a'] });

// in JSX / effects, plain property access stays live:
<p>Hello, {form.name}</p>
<input value={form.name} onInput={(e: Event) => (form.name = (e.target as HTMLInputElement).value)} />
```

```tsx
form.tags.push('b'); // length + index readers update
delete form.name; // key readers update
```

## effect(fn) / scope(fn) / untrack(fn)

`effect` runs `fn` now and re-runs it when any signal read inside changes.
Returns a `stop` function. If `fn` returns a function, it runs as cleanup
before the next run and on stop.

```tsx
import { effect, signal } from 'bsig';

const count = signal(0);
const stop = effect(() => {
  document.title = `count ${count.value}`;
  return () => console.log('cleaning up before re-run');
});
stop(); // unsubscribe + run latest cleanup
```

`scope` groups effects so one call stops them all (component cleanup uses
this internally):

```tsx
import { scope, effect, signal } from 'bsig';

const stop = scope(() => {
  effect(() => console.log('a', a.value));
  effect(() => console.log('b', b.value));
});
stop(); // stops both effects
```

`untrack` reads signals without subscribing:

```tsx
import { untrack } from 'bsig';

effect(() => {
  console.log(count.value); // subscribes
  console.log(untrack(() => other.value)); // read once, no subscription
});
```

## watch(source, cb)

Runs `cb(newValue, oldValue)` when `source` changes. Skips the first run;
the callback itself is untracked. Source is a signal or a getter. Returns
a stop function.

```tsx
import { watch } from 'bsig';

watch(count, (next, prev) => console.log(`was ${prev}, now ${next}`));
watch(
  () => count.value * 2,
  (next) => save(next)
);
```

## JSX dynamics (the plugin does the thunks)

Write plain reads. The plugin auto-wraps dynamic children/props; it leaves
`on*`, `ref`, `key`, static literals, plain functions, and `For`/`If` calls
alone.

```tsx
<p>Count: {count.value}</p>
<input disabled={off.value} title="static stays static" />
{show.value && <span>conditional</span>}
<button onClick={() => count.value++}>+</button> // handler passed as-is
```

NOT bsig (hand-wrapping defeats nothing but is banned style — and wrapping
`For`/`If` breaks their caches):

```tsx
<p>{() => count.value}</p> // DON'T — write {count.value}
<ul>{() => For(rows, 'id', (r) => <li>{r.name}</li>)}</ul> // DON'T — call bare
```

## Components (single-arg, props.children)

Functions of `props`. Run once. Call parent callbacks directly through
`props.onX` — no emit helper.

```tsx
interface CardProps {
  title: string;
  onClose?: () => void;
  children?: unknown;
}

export function Card(props: CardProps) {
  return (
    <section>
      <h2>{props.title}</h2>
      {props.children}
      <button onClick={() => props.onClose?.()}>x</button>
    </section>
  );
}

// usage:
<Card title="hi" onClose={() => (open.value = false)}>
  <p>body</p>
</Card>;
```

## Show (conditional branches)

`<Show when={...} fallback={...}>children</Show>`. `when` accepts a plain
value (auto-thunked by the plugin), a signal, or a getter. Branches are
cached — toggling back reuses DOM.

```tsx
import { Show } from 'bsig';

<Show when={user.value} fallback={<i>loading…</i>}>
  <b>{user.value.name}</b>
</Show>;
```

```tsx
<Show when={tab.value === 'a'}>
  <PaneA />
</Show>;
```

## If (function API — manual thunks required)

`If(cond, renderFn, fallback?)`. Unlike `<Show>`, the compiler does NOT
help here: pass real thunks yourself. Prefer `<Show>` inside JSX.

```tsx
import { If } from 'bsig';

const branch = If(
  () => show.value,
  () => 'on',
  () => 'off'
);
// branch is itself a thunk for JSX: <div>{branch}</div>
```

## For (keyed lists — never .map)

`For(list, key, renderFn)`. `list` is an array, a signal of an array, or a
getter. `key` is a property name, a `(item, index) => key` function, or
`null` (identity). Renders are cached per key: reorder/moves reuse DOM via
LIS reconciliation. Call it bare in JSX — never wrap it.

```tsx
import { For } from 'bsig';

<ul>{For(todos, 'id', (item) => <li>{item.text}</li>)}</ul>
<ul>{For(rows, (r) => r.id, (r) => <Row row={r} />)}</ul>
```

```tsx
// reactive source: replacing .value re-renders the list, keyed
items.value = [...items.value, { id: 4, text: 'new' }];
items.value = items.value.filter((t) => t.id !== 2);
```

NOT bsig:

```tsx
todos.value.map((t) => <li key={t.id}>{t.text}</li>) // DON'T — no key prop, no .map
```

## Component (dynamic switching)

`<Component is={...}>` renders whichever component `is` resolves to and
unmounts the old tree on switch. `is` may be a value or a getter.

```tsx
import { Component } from 'bsig';

<Component is={tab.value === 'a' ? PaneA : PaneB} title="x" />
// `is` is auto-thunked by the plugin, so the chosen component renders with
// the remaining props. A getter works too: is={() => tab.value}.
```

## Transition (enter/leave classes)

Wraps a single child (element or a `<Show>`/conditional thunk). Classes are
`[active, from, to]` triples plus an `idle` class restored afterwards.

```tsx
import { Transition, Show } from 'bsig';

<Transition enter={['anim', 'fade-from', 'fade-to']} idle="steady" leave={['anim', 'fade-from', 'fade-to']}>
  <Show when={show.value}>
    <div class="box">hi</div>
  </Show>
</Transition>;
```

## onMount / onUnmount (lifecycles)

Call inside a component body. `onMount` fires after insert (node is attached,
children first); `onUnmount` fires on removal.

```tsx
import { onMount, onUnmount } from 'bsig';

export function Chart(props: { data: number[] }) {
  const host = { value: null as HTMLElement | null };

  onMount(() => {
    const chart = createChart(host.value!, props.data);
    onUnmount(() => chart.destroy());
  });

  return <div ref={host} />;
}
```

## provide / inject (context)

`provide(key, value)` inside a component scopes the value to its subtree;
`inject(key, default?)` reads the nearest one (or the default outside any
provider).

```tsx
import { provide, inject } from 'bsig';

export function ThemeRoot(props: { children?: unknown }) {
  provide('theme', 'dark');
  return <div>{props.children}</div>;
}

export function Label() {
  const theme = inject('theme', 'light');
  return <span>{theme}</span>;
}
```

## ref (element handles)

On DOM elements only. Object form (`.value` assigned) or callback form.

```tsx
const input = { value: null as HTMLInputElement | null };
<input ref={input} />;
input.value?.focus();
```

```tsx
<canvas
  ref={(el: HTMLCanvasElement) => {
    el.width = 300;
  }}
/>;
```

## Fragments

`<></>` groups children with no wrapper, including as a component root.

```tsx
export function Pair() {
  return (
    <>
      <dt>term</dt>
      <dd>definition</dd>
    </>
  );
}
```

## Router (`bsig/router`)

Optional, tree-shakeable entry — never part of the runtime bundle unless
imported. Built on the Navigation API (Chromium; degrades to full navigations
elsewhere). See `docs/router.md`.

```tsx
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

- `Route` is `{ path, component, children?, beforeEnter? }`; the root's
  `component` is the layout. Routed components get `{ params, route }`.
- `beforeEnter({ to, from })` returns `true`/`undefined` (allow), `false`
  (block), or a path / `{ path, replace? }` (redirect); may be async.
- `lazy(() => import('./Page'), loading?)` renders the fallback until the
  module's `default` resolves, and exposes `.preload()`.
- `createRouter({ routes, notFound?, beforeEnter? })` gives you `navigate`,
  `prefetch`, `isActive`, and `pathname`. `matchTree()` matches without
  rendering.
- `<Link>` sets `aria-current="page"` when active and prefetches on
  hover/focus.
- This is NOT React Router: no loaders, no `useParams`, no nested `<Route>`
  JSX. Routes are plain objects, params come through props, and layouts render
  `<Outlet/>`.
