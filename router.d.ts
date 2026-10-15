/* bsig/router — types for the tree-shakeable router entry point. */
import type { Signal } from './runtime.js';

export interface GuardContext {
  to: string;
  from: string;
}

export type GuardResult =
  | boolean
  | string
  | { path: string; replace?: boolean }
  | undefined;

export type GuardFn = (
  context: GuardContext,
) => GuardResult | Promise<GuardResult>;

export interface LoaderContext {
  to: string;
  from: string;
  params: Record<string, string | string[]>;
}

/**
 * Route data warm-up. Return value is ignored; must be idempotent and safe to
 * run on hover. Starts after guards pass on navigation without delaying the
 * commit (errors are swallowed — write error state to your own store), and
 * runs best-effort on prefetch.
 */
export type LoaderFn = (context: LoaderContext) => unknown;

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
  guard?: GuardFn;
  loader?: LoaderFn;
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
  guard?: GuardFn;
}

export interface NavigateOptions {
  replace?: boolean;
}

export function createRouter(options: RouterOptions): RouterInstance;

export type RouterInstance = {
  RouterView: (props?: unknown) => any;
  Outlet: () => any;
  navigate(to: string, options?: NavigateOptions): Promise<boolean>;
  /** Document click interceptor (same-document links). Wired by `<Router />`. */
  handleClick(event: MouseEvent): void;
  /** Back/forward handler. Wired by `<Router />`. */
  handlePopState(): void;
  boot(): Promise<void>;
  Link: (props: LinkProps) => any;
  /** Warm matched route loaders (never guards). */
  prefetch(to: string): void;
  isActive(to: string): boolean;
  pathname: Signal<string>;
};

export interface RouterProps {
  router?: RouterInstance;
  routes?: Route;
  notFound?: Route;
  guard?: GuardFn;
}

/** Mounts the router and renders the root layout. Use once, at the app root. */
export function Router(props: RouterProps): any;

/** Renders the route matched at this nesting depth. */
export function Outlet(): any;

/** Client-side navigation link; sets `aria-current="page"` when active. */
export function Link(props: LinkProps): any;
