# bsig on Bun (HTML routes)

Serve a bsig app with `Bun.serve` HTML routes instead of Vite. Every file
below is complete. Verified with Bun 1.4.3: the served bundle mounts,
`+` updates the count, and `<Show>` toggles — same as the Vite path.

Bun's bundler handles JSX natively but does **not** auto-thunk dynamics the
way the Vite plugin does. `bsig/bun-plugin` (same transform, `onLoad` hook)
fills that gap.

## 1. Scaffold and install

```sh
mkdir my-app && cd my-app
bun init -y
bun add github:unbiased-dev/bsig#v0.7.1
```

(`@babel/*` arrives as transitive deps of bsig — build-time only.)

## 2. `bunfig.toml` (new file, project root)

```toml
[serve.static]
plugins = ["bsig/bun-plugin"]
```

## 3. `tsconfig.json` (new file, project root)

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "bsig",
    "lib": ["ES2022", "DOM"]
  }
}
```

No file ever imports `h` — same rule as the Vite setup.

## 4. `server.ts` (new file, project root)

```ts
import { serve } from "bun";
import homepage from "./index.html";

const server = serve({ routes: { "/": homepage }, development: false });

console.log(`listening on ${server.url}`);
```

## 5. `index.html` (new file, project root)

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>bsig on bun</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./src/app.tsx"></script>
  </body>
</html>
```

## 6. `src/app.tsx` (new file)

```tsx
import mount, { signal, For, Show } from "bsig";

const count = signal(0);
const items = signal([
  { id: 1, text: "served by bun" },
  { id: 2, text: "thunked by plugin" },
]);
const show = signal(true);

function App() {
  return (
    <div>
      <h1>bsig on bun</h1>
      <p>Count: {count.value}</p>
      <button onClick={() => count.value++}>+</button>
      <button onClick={() => (show.value = !show.value)}>toggle</button>
      <Show when={show.value} fallback={<i>hidden</i>}>
        <ul>{For(items, "id", (item) => <li>{item.text}</li>)}</ul>
      </Show>
    </div>
  );
}

mount(document.getElementById("app")!, App);
```

## 7. Run it

```sh
bun run server.ts   # open the URL it prints
```

Click `+`: the count updates without a reload. Without the plugin this
renders once and goes static (verified: `Count: 0` forever) — the plugin is
what keeps `{count.value}` live.

## Notes

- **Dev mode caveat (Bun 1.4.3):** with `development: true`, the served HTML
  dropped `<script src>` tags entirely — even for plugin-free plain `.js`,
  so this is Bun-side, not bsig. `development: false` (above) serves the
  bundled chunk correctly. If you need HMR, retry dev mode on a newer Bun
  and fall back here if scripts still vanish.
- **Ahead-of-time builds:** Bun's docs say `bunfig.toml` plugins apply to
  `Bun.serve` and the `Bun.build()` JS API but not the `bun build` CLI —
  and that's still true on Bun 1.4.3, verified: a CLI-built bundle
  succeeds but ignores the plugin (eager reads in the output, clicks do
  nothing). For a reactive AOT bundle, use a small build script instead:

  ```ts
  // build.ts
  import plugin from "bsig/bun-plugin";

  const out = await Bun.build({
    entrypoints: ["./server.ts"],
    target: "bun",
    outdir: "./dist",
    plugins: [plugin],
  });
  if (!out.success) {
    console.error(out.logs);
    process.exit(1);
  }
  ```
