import { h } from 'bsig';
import { Router, Outlet, Link, matchTree } from 'bsig/router';
import type { BeforeEnterFn, Route, RouteProps } from 'bsig/router';

const guard: BeforeEnterFn = ({ to, from }) => {
  if (to === from) return true;
  return { path: '/login', replace: true };
};

const Home = () => <p>home</p>;
const User = ({ params }: RouteProps) => <p>{params.id as never}</p>;

const Layout = () => (
  <div>
    <Link to="/">home</Link>
    <Outlet />
  </div>
);

const routes: Route = {
  path: '/',
  component: Layout,
  children: [
    { path: '/', component: Home },
    { path: '/users/:id', component: User, beforeEnter: guard },
  ],
};

const chain = matchTree(routes.children ?? [], '/users/1', '/');
export const depth = chain ? chain.length : 0;

export function App() {
  return <Router routes={routes} beforeEnter={guard} />;
}
