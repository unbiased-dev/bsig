/* bsig/auth — types for the tree-shakeable better-auth client entry point.
 *
 * Nothing here imports better-auth: the shapes are self-contained and
 * extensible. Add your own fields by declaration merging, e.g.
 *
 *   declare module 'bsig/auth' {
 *     interface AuthUser { role: 'admin' | 'user' }
 *     interface AuthSession { impersonatedBy?: string }
 *   }
 *
 * `session.value` is then typed with those extra fields.
 */
import type { Signal } from './runtime.js';

/**
 * Register your app's session/user types by declaration merging. Every
 * session-shaped export (`Session`, the `session` signal) then uses them in
 * place of the defaults:
 *
 *   declare module 'bsig/auth' {
 *     interface AuthTypes {
 *       user: { id: string; name: string; role: 'admin' | 'user' };
 *       session: { expiresAt: Date; impersonatedBy?: string };
 *     }
 *   }
 *
 * This *replaces* the type rather than extending it, so fields may be required,
 * optional, or a different type. Both halves are optional: provide only the
 * ones you want to override; the rest fall back to `DefaultUser` /
 * `DefaultSessionData`.
 */
export interface AuthTypes {}

/** Default user shape: `id`, plus whatever the server returns. */
export type DefaultUser = {
  id: string;
  name?: string;
  email?: string;
  [key: string]: unknown;
};

/** Default session shape: `expiresAt`, plus whatever the server returns. */
export type DefaultSessionData = {
  /** ISO string from JSON, or a `Date` if a hook reconstructed it. */
  expiresAt: string | Date;
  [key: string]: unknown;
};

/** The user half of a session: `AuthTypes['user']`, or `DefaultUser`. */
export type AuthUser = AuthTypes extends { user: infer U } ? U : DefaultUser;

/** The session half of a session: `AuthTypes['session']`, or `DefaultSessionData`. */
export type AuthSession = AuthTypes extends { session: infer S } ? S : DefaultSessionData;

/** better-auth's session payload: the pair, or null when signed out. */
export interface Session {
  user: AuthUser;
  session: AuthSession;
}

export interface AuthError {
  message?: string;
  code?: string;
  status?: number;
}

export interface AuthFetchContext {
  /** Endpoint path, e.g. "/sign-in/email". */
  path: string;
  url: string;
  /** The built request, for inspection by hooks. */
  request: Request;
  /** The init passed to fetch — mutate this (e.g. headers) to alter the call. */
  options: RequestInit;
}

export interface AuthResponseContext extends AuthFetchContext {
  response: Response;
}

export interface AuthSuccessContext extends AuthResponseContext {
  data: unknown;
}

export interface AuthErrorContext extends AuthFetchContext {
  /** Absent when the request never reached the server (network failure). */
  response?: Response;
  error: AuthError;
}

/** Request lifecycle hooks, mirroring better-auth's `fetchOptions`. */
export interface AuthFetchOptions {
  onRequest?(context: AuthFetchContext): void | Promise<void>;
  onResponse?(context: AuthResponseContext): void | Promise<void>;
  onSuccess?(context: AuthSuccessContext): void | Promise<void>;
  onError?(context: AuthErrorContext): void | Promise<void>;
}

export interface AuthSessionOptions {
  /** Poll interval in seconds. 0 (default) disables polling. */
  refetchInterval?: number;
  /** Refetch when the tab becomes visible. Default true. */
  refetchOnWindowFocus?: boolean;
  /** Keep refetching while navigator reports offline. Default false. */
  refetchWhenOffline?: boolean;
}

export interface AuthOptions {
  /** Origin the auth server is on. Defaults to `window.location.origin`. */
  baseURL?: string;
  fetchOptions?: AuthFetchOptions;
  sessionOptions?: AuthSessionOptions;
}

/** Configure base URL, fetch hooks, and session-refresh behavior. */
export function initAuth(options?: AuthOptions): void;

/** Current `{ session, user }`, or null when signed out. */
export const session: Signal<Session | null>;
/** True until the first /get-session request settles. */
export const isPending: Signal<boolean>;
/** True while a /get-session request is in flight. */
export const isRefetching: Signal<boolean>;
/** Last session-request error, or null. */
export const sessionError: Signal<AuthError | null>;

export interface Result<T> {
  data: T | null;
  error: AuthError | null;
}

/**
 * One better-auth request against `<baseURL>/api/auth<path>`. Hooks may mutate
 * `context.options`. Exposed so apps can reach endpoints this entry does not
 * wrap (e.g. social sign-in, password reset).
 */
export function authFetch<T = unknown>(
  path: string,
  input?: RequestInit,
): Promise<Result<T>>;

/** Re-read the session cookie and update the store. */
export function refreshSession(): Promise<void>;

/**
 * Ensure the session is read once (boot / route guards). No-op once the first
 * request has settled; use `refreshSession()` to force a refetch.
 */
export function loadSession(): Promise<void>;

/**
 * Wire the passive refetch triggers (focus, online, cross-tab, polling).
 * Returns cleanup.
 */
export function startSessionRefresh(): () => void;

export interface Credentials {
  email: string;
  password: string;
}

export interface SignUpInput extends Credentials {
  name: string;
}

export function signInEmail(input: Credentials): Promise<{ error: AuthError | null }>;
export function signUpEmail(input: SignUpInput): Promise<{ error: AuthError | null }>;
/**
 * POST /sign-out. Clears the store and broadcasts only when the server
 * confirms; on failure the session is kept and the error returned.
 */
export function signOut(): Promise<{ error: AuthError | null }>;
