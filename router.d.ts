/* bsig/router — types for the tree-shakeable router entry point. */
import type { Child, Signal } from './runtime.js';

export interface BeforeEnterContext {
  to: string;
  from: string;
}

export type BeforeEnterResult =
  | boolean
  | string
  | { path: string; replace?: boolean }
  | undefined;

export type BeforeEnterFn = (
  context: BeforeEnterContext,
) => BeforeEnterResult | Promise<BeforeEnterResult>;

/** Props every routed component receives. */
export interface RouteProps {
  params: Record<string, string | string[]>;
  route: Route;
}

/** A route's component: a plain bsig component (single `props` argument). */
export type RouteComponent = (props: RouteProps) => any;

export interface Route {
  path: string;
  component: RouteComponent;
  children?: Route[];
  beforeEnter?: BeforeEnterFn;
}

export interface MatchedRoute {
  route: Route;
  path: string;
  base: string;
  params: Record<string, string | string[]>;
}

export interface LinkProps {
  to: string;
  class?: string | (() => string);
  [key: string]: any;
}

export type LazyComponent = (props: any) => any;

/**
 * Wrap an async component loader. Renders `loading` (or nothing) until the
 * module resolves, then the loaded `default` export. Exposes `preload()` so
 * `<Link>` hover/focus can warm the chunk before navigation.
 */
export function lazy(
  loader: () => Promise<{ default: LazyComponent }>,
  loading?: Child,
): LazyComponent & { preload: () => void };

/**
 * Match a pathname against a route tree. Returns the chain of matched routes
 * (parents first) or `null`. Exported for tests and custom integrations.
 */
export function matchTree(
  routes: Route[],
  pathname: string,
  base: string,
): MatchedRoute[] | null;

export interface RouterOptions {
  /** Root route; its `path` is the base and its `component` is the layout. */
  routes: Route;
  notFound?: Route;
  beforeEnter?: BeforeEnterFn;
}

export interface NavigateOptions {
  replace?: boolean;
}

export function createRouter(options: RouterOptions): RouterInstance;

/**
 * The subset of the Navigation API's `NavigateEvent` the router uses. Declared
 * structurally so the types do not require a DOM lib that ships
 * `NavigateEvent` (added to lib.dom only in newer TypeScript).
 */
export interface RouterNavigateEvent {
  canIntercept: boolean;
  hashChange: boolean;
  downloadRequest: unknown;
  formData: unknown;
  navigationType: string;
  destination: { url: string; key: string };
  signal: AbortSignal;
  intercept(handlers: {
    precommitHandler?: (controller: {
      redirect(path: string, options?: { history?: string }): void;
    }) => void | Promise<void>;
    handler?: () => void | Promise<void>;
  }): void;
}

export type RouterInstance = {
  RouterView: (props?: unknown) => any;
  Outlet: () => any;
  navigate(to: string, options?: NavigateOptions): Promise<boolean>;
  handleNavigate(event: RouterNavigateEvent): void;
  boot(): Promise<void>;
  Link: (props: LinkProps) => any;
  prefetch(to: string): void;
  isActive(to: string): boolean;
  pathname: Signal<string>;
};

export interface RouterProps {
  router?: RouterInstance;
  routes?: Route;
  notFound?: Route;
  beforeEnter?: BeforeEnterFn;
}

/** Mounts the router and renders the root layout. Use once, at the app root. */
export function Router(props: RouterProps): any;

/** Renders the route matched at this nesting depth. */
export function Outlet(): any;

/** Client-side navigation link; sets `aria-current="page"` when active. */
export function Link(props: LinkProps): any;
