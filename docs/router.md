# bsig/router

A small, signal-native router for bsig: nested layouts, params, guards, and
per-entry scroll restoration. It lives in its own module —
importing `bsig/router` pulls it in, and a build that never imports it leaves
it (and its vendored path matcher) out of the bundle entirely.

It is built on the browser's History API (`pushState`/`replaceState`, a
`popstate` listener, and a document-level click interceptor), so it works
identically in every browser — Safari, Firefox, Chromium, WebViews — with one
code path and no Navigation API dependency. Guards run before the URL commits,
so blocks and redirects never flicker.

## 1. Set up routes

A route is `{ path, component, children?, beforeEnter? }`. The root route's
`path` is the base and its `component` is the layout. Layouts render
`<Outlet/>` where the matched child should go.

```tsx
import { Link, Outlet, Router } from 'bsig/router';
import type { Route, RouteProps } from 'bsig/router';

const Home = () => <h1>Home</h1>;
const User = ({ params }: RouteProps) => <p>User {params.id}</p>;

const Layout = () => (
  <div class="app">
    <nav>
      <Link to="/">Home</Link>
    </nav>
    <Outlet />
  </div>
);

const routes: Route = {
  path: '/',
  component: Layout,
  children: [
    { path: '/', component: Home },
    { path: '/users/:id', component: User },
  ],
};
```

Mount it once at the app root:

```tsx
import mount from 'bsig';
import { Router } from 'bsig/router';
import { routes } from './routes';

mount(document.getElementById('app')!, () => <Router routes={routes} />);
```

`<Router routes={...} />` creates its own instance. Pass `router={instance}`
instead if you built one with `createRouter()` (e.g. to read `router.pathname`).

The root layout may return a fragment (`<><nav/><Outlet/></>`); a fragment root
is resolved like any other. `<Router>` can be mounted anywhere a component can —
as the app root or nested inside another component, including conditionally
(such as inside `<Show>`). Its config props (`routes`, `router`, `notFound`,
`beforeEnter`) are read back out of the JSX plugin's auto-thunks, so passing them
by reference works as written.

## 2. Nested routes and params

Add `children` and render another `<Outlet/>` inside the parent page. The depth
is tracked through context, so each `<Outlet/>` resolves the next matched route.

```tsx
const Users = () => (
  <section>
    <h2>Users</h2>
    <Outlet />
  </section>
);

const routes: Route = {
  path: '/',
  component: Layout,
  children: [
    {
      path: '/users',
      component: Users,
      children: [{ path: '/:id', component: User }],
    },
  ],
};
```

Every routed component receives `{ params, route }`. `params` values are
URL-decoded; a catch-all (`*`) yields an array.

## 3. Links

```tsx
import { Link } from 'bsig/router';

<Link to="/users/1">Profile</Link>
```

`<Link>` sets `href` and `aria-current="page"` when the target is active, and
prefetches the destination on hover, focus, and pointer-down. Style the active
state in your components layer:

```css
[aria-current='page'] {
  font-weight: 600;
}
```

Programmatic navigation:

```tsx
import { createRouter } from 'bsig/router';
const router = createRouter({ routes });
await router.navigate('/users/1');
await router.navigate('/', { replace: true });
```

## 4. Guards

`beforeEnter` runs before a route activates. Return:

- `true` / `undefined` — allow
- `false` — block (navigation is aborted, the page does not change)
- `'path'` or `{ path, replace? }` — redirect

Guards run in parallel for the whole matched chain (root, layout, target).
They may be async.

```tsx
const routes: Route = {
  path: '/',
  component: Layout,
  beforeEnter: ({ to }) => (to.startsWith('/admin') && !isSignedIn() ? '/login' : true),
  children: [
    { path: '/login', component: Login },
    { path: '/admin', component: Admin, beforeEnter: () => (isAdmin() ? true : false) },
  ],
};
```

A boot-time redirect rewrites the address bar (via `replaceState`) rather than
pushing a new entry — the user never navigated anywhere.

## 5. 404s

```tsx
const routes: Route = { path: '/', component: Layout, children: [/* … */] };
const notFound: Route = { path: '', component: NotFound };
<Router routes={routes} notFound={notFound} />
```

## API

| Export | Purpose |
| --- | --- |
| `Router` | Mounts the router and the root layout. Props: `routes`, `notFound?`, `beforeEnter?`, `router?`. |
| `Outlet` | Renders the route matched at this nesting depth. |
| `Link` | Navigation link with `aria-current` and prefetch. |
| `createRouter({ routes, notFound?, beforeEnter? })` | Imperative instance: `navigate`, `prefetch`, `isActive`, `pathname`, `boot`, `handleClick`, `handlePopState`. |
| `matchTree(routes, pathname, base)` | Pure matcher; returns the matched chain or `null`. |
| `Route`, `RouteProps`, `MatchedRoute` | Types. |
| `BeforeEnterFn`, `BeforeEnterResult`, `BeforeEnterContext` | Guard types. |
| `RouterOptions`, `NavigateOptions`, `RouterProps`, `RouterInstance`, `LinkProps` | Instance/props types. |

Scroll restoration is managed manually (`history.scrollRestoration =
'manual'`): new entries scroll to top, back/forward restore the offset you left
each entry at, and manual scrolling during restore cancels it. Per-entry keys
are stamped onto `history.state`; back/forward run guards again, and a blocked
traversal pins the address bar back to the page on screen.
