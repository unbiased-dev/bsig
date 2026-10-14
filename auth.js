/* bsig/auth — tree-shakeable better-auth client entry point.
 *
 * Lives in its own module so it is never part of the runtime bundle: the
 * runtime does not import it, and a build that never imports `bsig/auth` drops
 * everything here (package.json declares `sideEffects: false`).
 *
 * A hand-rolled client for the better-auth server API — the endpoints and
 * shapes below are the ones the email/password flow uses — spoken over plain
 * `fetch` and held in bsig signals. It replaces `better-auth/client` (which
 * pulls in @better-fetch/fetch, nanostores, defu, focus/online/broadcast
 * managers, session-refresh, …) while keeping the behaviours that matter, with
 * no runtime dependencies.
 *
 * Endpoints (all relative to `<baseURL>/api/auth`):
 *   GET  /get-session   -> { session, user } | null
 *   POST /sign-in/email -> { user, token }    401 { message, code }
 *   POST /sign-up/email -> { user, token }    403 { message, code }
 *   POST /sign-out      -> { success: true }
 * POSTs are CSRF-checked via the Origin header, which browsers send for
 * same-origin requests. `authFetch` is exported so an app can call any other
 * better-auth endpoint without another dependency.
 *
 * Mirrors better-auth's client niceties: request lifecycle hooks, refetch on
 * focus (5s rate limit), refetch when back online, cross-tab sync, optional
 * polling, in-flight collapse, `needsRefresh` cookie-cache rotation, and
 * 401-clears-session error handling.
 *
 * The session/user shapes are generic: they default to the fields this client
 * reads and can be extended by declaration merging (see `auth.d.ts`), so no
 * better-auth types (or dependency) are required.
 */
import { signal } from './runtime.js';

// Skip focus/online refetches this soon after the last request (matches better-auth).
const FOCUS_REFETCH_RATE_LIMIT_MS = 5000;
// Cross-tab notifications ride the `storage` event (the same trick better-auth's
// broadcast channel uses): one tab writes, the others observe.
const BROADCAST_KEY = 'bsig.auth.session';

let authOptions = {};

// Resolve lazily rather than at import time so the module loads under SSR/tests
// (no `window`), where a relative `/api/auth` URL is the correct default.
function resolveBaseURL() {
  if (authOptions.baseURL) return authOptions.baseURL;
  if (typeof window !== 'undefined' && window.location) return window.location.origin;
  return '';
}

/** Configure base URL, fetch hooks, and session-refresh behavior. */
export function initAuth(options = {}) {
  authOptions = options;
}

/** Current `{ session, user }`, or null when signed out. */
export const session = signal(null);
/** True until the first /get-session request settles. */
export const isPending = signal(true);
/** True while a /get-session request is in flight. */
export const isRefetching = signal(false);
/** Last session-request error, or null. */
export const sessionError = signal(null);

// A relative URL cannot be turned into a `Request` without a base (SSR). The
// request is exposed for hooks to inspect, so fall back to a placeholder origin
// when the caller configured no absolute baseURL.
function makeRequest(url, options) {
  try {
    return new Request(url, options);
  } catch {
    return new Request(new URL(url, 'http://localhost').href, options);
  }
}

/**
 * Perform one better-auth request against `<baseURL>/api/auth<path>`.
 * `input` is a `RequestInit`; hooks may mutate `context.options` to alter the
 * call (e.g. add headers). Exported so apps can reach endpoints this module
 * does not wrap.
 */
export async function authFetch(path, input = {}) {
  const url = `${resolveBaseURL()}/api/auth${path}`;
  const options = { credentials: 'include', ...input };
  const context = { path, url, request: makeRequest(url, options), options };
  const hooks = authOptions.fetchOptions;

  await hooks?.onRequest?.(context);

  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    const error = { message: err instanceof Error ? err.message : 'Request failed' };
    await hooks?.onError?.({ ...context, error });
    return { data: null, error };
  }

  await hooks?.onResponse?.({ ...context, response });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const error = { ...(typeof body === 'object' && body ? body : {}), status: response.status };
    await hooks?.onError?.({ ...context, response, error });
    return { data: null, error };
  }

  await hooks?.onSuccess?.({ ...context, response, data: body });
  return { data: body, error: null };
}

function post(path, body) {
  return authFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

/** `{ session: null, user: null }` comes back for "no session". */
function normalize(body) {
  if (!body || (body.session === null && body.user === null)) return null;
  return body;
}

/** Identity of the fields the UI reads, so unchanged refetches don't re-render. */
function identity(value) {
  if (!value) return 'null';
  return [
    value.user?.id,
    value.user?.name,
    value.user?.email,
    value.session?.expiresAt,
  ].join('|');
}

let inFlight = null;
let lastRequestAt = 0;

function fetchSession() {
  if (inFlight) return inFlight;

  isPending.value = session.value === null;
  isRefetching.value = true;
  sessionError.value = null;

  inFlight = (async () => {
    const { data, error } = await authFetch('/get-session');

    if (error) {
      // A 401 means signed out; any other failure keeps the last known session.
      if (error.status === 401) session.value = null;
      sessionError.value = error;
    } else {
      let body = data;
      // Cookie-cache rotation: the server asks for a POST to re-issue the cookie.
      if (body?.needsRefresh) {
        const rotated = await authFetch('/get-session', { method: 'POST' });
        if (!rotated.error) body = rotated.data;
      }
      const next = normalize(body);
      if (identity(next) !== identity(session.value)) session.value = next;
    }

    isPending.value = false;
    isRefetching.value = false;
    lastRequestAt = Date.now();
    inFlight = null;
  })();

  return inFlight;
}

/** Re-read the session cookie and update the store. */
export function refreshSession() {
  return fetchSession();
}

/**
 * Ensure the session has been read once — the boot and route-guard path.
 * Resolves immediately once the first request has settled, so guards that await
 * it on every navigation do not re-hit the network. (`isPending` is exactly
 * "the first request has not settled yet".) Use `refreshSession()` to force an
 * actual refetch.
 */
export function loadSession() {
  return isPending.value ? fetchSession() : Promise.resolve();
}

function broadcast(trigger) {
  try {
    localStorage.setItem(
      BROADCAST_KEY,
      JSON.stringify({
        event: 'session',
        data: { trigger },
        id: Math.random().toString(36).slice(2),
        at: Date.now(),
      }),
    );
  } catch {
    // localStorage unavailable (private mode): cross-tab sync just won't run
  }
}

/**
 * Passive refetch triggers, wired once at startup: window focus, coming back
 * online, another tab signing in/out, and optional polling. Returns cleanup.
 */
export function startSessionRefresh() {
  const {
    refetchInterval = 0,
    refetchOnWindowFocus = true,
    refetchWhenOffline = false,
  } = authOptions.sessionOptions ?? {};

  // Same semantics as better-auth's online manager: assume online unless
  // navigator explicitly reports offline (navigator can exist without onLine,
  // e.g. SSR/Node).
  let isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
  const shouldRefetch = () => refetchWhenOffline || Boolean(isOnline);

  const trigger = (event) => {
    if (!shouldRefetch()) return;
    // Focus and online share the rate limit; storage and polling don't.
    if (event === 'visibilitychange' && Date.now() - lastRequestAt < FOCUS_REFETCH_RATE_LIMIT_MS) {
      return;
    }
    void refreshSession();
  };

  const onVisibility = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    trigger('visibilitychange');
  };
  const onOnline = () => {
    isOnline = true;
    trigger('visibilitychange');
  };
  const onOffline = () => {
    isOnline = false;
  };
  const onStorage = (event) => {
    if (event.key !== BROADCAST_KEY || !event.newValue) return;
    try {
      if (JSON.parse(event.newValue).event === 'session') trigger('storage');
    } catch {
      // ignore malformed payloads
    }
  };

  if (typeof document !== 'undefined') {
    if (refetchOnWindowFocus) document.addEventListener('visibilitychange', onVisibility, false);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline, false);
    window.addEventListener('offline', onOffline, false);
    window.addEventListener('storage', onStorage, false);
  }

  const poll =
    refetchInterval > 0
      ? setInterval(() => {
          if (session.value) trigger('poll');
        }, refetchInterval * 1000)
      : undefined;

  return () => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility, false);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline, false);
      window.removeEventListener('offline', onOffline, false);
      window.removeEventListener('storage', onStorage, false);
    }
    if (poll) clearInterval(poll);
  };
}

export async function signInEmail(input) {
  const { error } = await post('/sign-in/email', input);
  if (error) return { error };
  broadcast('signin');
  await refreshSession();
  return { error: null };
}

export async function signUpEmail(input) {
  const { error } = await post('/sign-up/email', input);
  if (error) return { error };
  broadcast('signup');
  await refreshSession();
  return { error: null };
}

export async function signOut() {
  const { error } = await post('/sign-out');
  // Only clear when the server confirms. A failed request (network, or a CSRF
  // 403 like MISSING_OR_NULL_ORIGIN) leaves the server session and cookie
  // intact, so clearing locally would just be resurrected by the next refetch.
  if (error) return { error };
  session.value = null;
  broadcast('signout');
  return { error: null };
}
