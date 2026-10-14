# Starting from stock `vanilla-ts`

This guide takes a fresh `create-vite` scaffold to a working bsig app. Every
file below is complete — no diffs to interpret. It was verified against
current Vite 8 + TS 6 output; nothing here pins versions except the bsig tag
itself (use the newest tag on the releases page).

Stock `vanilla-ts` ships **no `vite.config.ts`** — you create it in step 3.
It also ships strict TS defaults (`noUnusedLocals`, `verbatimModuleSyntax`);
the setup below passes them as-is, with no `h` import in any file.

## 1. Scaffold and install

```sh
npm create vite@latest my-app -- --template vanilla-ts
cd my-app
npm install
npm install github:unbiased-dev/bsig#v0.3.0
```

## 2. Remove the counter boilerplate

```sh
rm src/main.ts src/counter.ts src/style.css
rm -rf src/assets   # only referenced by the deleted files
```

Remaining stock files you keep untouched: `index.html`, `package.json`,
`tsconfig.json`, `public/`, `src/vite-env.d.ts` (if present).

## 3. Create `vite.config.ts` (new file, project root)

```ts
import { defineConfig } from 'vite';
import bsig from 'bsig/plugin';

export default defineConfig({
  plugins: [bsig()],
});
```

The plugin compiles JSX to lazy signal bindings ahead of time (dynamic
children/props become thunks; `on*` handlers, `ref`, and static values are
left alone). It handles both `.jsx` and `.tsx`.

## 4. Teach `tsconfig.json` the automatic runtime

Find the `compilerOptions` block (it contains `"types": ["vite/client"],`)
and add these two lines:

```json
    "jsx": "react-jsx",
    "jsxImportSource": "bsig",
```

So that section reads:

```json
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "lib": ["ES2023", "DOM"],
    "types": ["vite/client"],
    "jsx": "react-jsx",
    "jsxImportSource": "bsig",
    ...
```

This is what frees every component file from importing `h`: `tsc` checks
JSX against `bsig/jsx-runtime` types instead of a classic factory.

## 5. Write `src/main.tsx` (new file)

```tsx
import mount from 'bsig';
import App from './App';

mount(document.getElementById('app')!, App);
```

## 6. Write `src/App.tsx` (new file)

```tsx
import { signal, computed, For, Show } from 'bsig';

const count = signal(0);
const doubled = computed(() => count.value * 2);
const items = signal([
  { id: 1, text: 'plain values stay live' },
  { id: 2, text: 'no thunks by hand' },
  { id: 3, text: 'no h imports' },
]);
const show = signal(true);

export default function App() {
  return (
    <div>
      <h1>bsig on stock Vite</h1>
      <p>
        Count: {count.value} (x2 = {doubled.value})
      </p>
      <button onClick={() => count.value++}>+</button>
      <button onClick={() => (show.value = !show.value)}>toggle</button>
      <Show when={show.value} fallback={<i>hidden</i>}>
        <ul>{For(items, 'id', (item) => <li>{item.text}</li>)}</ul>
      </Show>
    </div>
  );
}
```

## 7. Point `index.html` at the new entry

Line 11 of the stock file:

```html
    <script type="module" src="/src/main.ts"></script>
```

becomes:

```html
    <script type="module" src="/src/main.tsx"></script>
```

## 8. Run it

```sh
npm run dev     # open the URL it prints; click + and watch only the text update
npm run build   # runs tsc && vite build — typecheck and bundle in one step
```

If `+` updates the count without a page refresh, the whole chain works:
plugin thunks → signals → fine-grained DOM patch, with `tsc` covering the
`.tsx` files through the `bsig/jsx-runtime` types.
