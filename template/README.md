# bsig + Vite + TS template

Clone it with [degit](https://github.com/Rich-Harris/degit):

```sh
npx degit unbiased-dev/bsig/template my-app
cd my-app
npm install
npm run dev
```

Rename the package in `package.json` (`my-bsig-app` is a placeholder).

What's wired: `bsig` from GitHub, the `bsig/plugin` Vite plugin (plain JSX stays
reactive — no `() =>` needed), classic JSX factory `h` in `tsconfig.json`.
`.tsx` files import `{ h }` explicitly so `tsc` typechecks them; the plugin
skips files that already import `h`, so nothing is duplicated.
