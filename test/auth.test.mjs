import { describe, it, expect, beforeEach } from 'bun:test';

// The auth client is browser-shaped (window/document/localStorage/navigator);
// happy-dom supplies those globals via the test preload and each test stubs
// `fetch`. The module holds singleton signals, so `reset()` re-inits options
// and clears state between tests rather than re-importing (ESM caches the
// instance — which is the point: one shared store for the whole app).
const auth = await import('../auth.js');
const BROADCAST_KEY = 'bsig.auth.session';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const sampleUser = { id: 'u1', name: 'Ada', email: 'ada@example.com' };
const sampleSession = { user: sampleUser, session: { expiresAt: '2999-01-01T00:00:00.000Z' } };

function reset() {
  auth.session.value = null;
  auth.isPending.value = true;
  auth.isRefetching.value = false;
  auth.sessionError.value = null;
  auth.initAuth({ baseURL: 'http://localhost' });
  localStorage.clear();
}

// Installs a fetch stub. `handler(call)` returns a Response (or throws).
// Records every call as { url, path, options }.
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const call = { url: href, path: href.replace('http://localhost/api/auth', ''), options };
    calls.push(call);
    return handler(call);
  };
  return calls;
}

beforeEach(reset);

describe('auth: session loading', () => {
  it('loads a session and clears the pending flags', async () => {
    stubFetch(() => json(sampleSession));
    expect(auth.isPending.value).toBe(true);
    await auth.refreshSession();
    expect(auth.session.value.user.id).toBe('u1');
    expect(auth.session.value.user.name).toBe('Ada');
    expect(auth.isPending.value).toBe(false);
    expect(auth.isRefetching.value).toBe(false);
    expect(auth.sessionError.value).toBeNull();
  });

  it('defaults the base URL to the page origin when none is configured', async () => {
    auth.initAuth({}); // no baseURL -> resolveBaseURL falls back to window.location
    const calls = stubFetch(() => json(sampleSession));
    await auth.refreshSession();
    expect(calls[0].url).toBe('http://localhost/api/auth/get-session');
  });

  it('normalizes { session: null, user: null } to null', async () => {
    stubFetch(() => json({ session: null, user: null }));
    await auth.refreshSession();
    expect(auth.session.value).toBeNull();
    expect(auth.isPending.value).toBe(false);
  });

  it('collapses concurrent refreshes into one request', async () => {
    const calls = stubFetch(() => json(sampleSession));
    await Promise.all([auth.refreshSession(), auth.refreshSession(), auth.refreshSession()]);
    expect(calls.length).toBe(1);
  });

  it('keeps the same reference when the identity is unchanged', async () => {
    stubFetch(() => json(sampleSession));
    await auth.refreshSession();
    const first = auth.session.value;
    await auth.refreshSession();
    expect(auth.session.value).toBe(first); // unchanged identity must not re-render
  });

  it('clears the session on 401 but keeps it on other failures', async () => {
    stubFetch(() => json(sampleSession));
    await auth.refreshSession();
    expect(auth.session.value).toBeTruthy();

    stubFetch(() => json({ message: 'boom' }, 500));
    await auth.refreshSession();
    expect(auth.session.value).toBeTruthy(); // 500 keeps the last known session
    expect(auth.sessionError.value.status).toBe(500);

    stubFetch(() => json({ message: 'gone', code: 'UNAUTHORIZED' }, 401));
    await auth.refreshSession();
    expect(auth.session.value).toBeNull(); // 401 signs out
  });

  it('reports a network failure without a response', async () => {
    stubFetch(() => {
      throw new Error('offline');
    });
    await auth.refreshSession();
    expect(auth.session.value).toBeNull();
    expect(auth.sessionError.value.message).toBe('offline');
    expect(auth.isPending.value).toBe(false);
  });

  it('treats a non-JSON response body as no data', async () => {
    stubFetch(
      () =>
        new Response('<html>oops</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    await auth.refreshSession();
    expect(auth.session.value).toBeNull();
    expect(auth.sessionError.value).toBeNull();
    expect(auth.isPending.value).toBe(false);
  });
});

describe('auth: needsRefresh rotation', () => {
  it('re-issues the cookie with a POST and uses its result', async () => {
    const calls = stubFetch((call) => {
      if (call.options.method === 'POST') {
        return json({ user: { id: 'u1', name: 'Grace' }, session: sampleSession.session });
      }
      return json({ ...sampleSession, needsRefresh: true });
    });
    await auth.refreshSession();
    expect(calls.length).toBe(2);
    expect(calls[0].options.method).toBeUndefined(); // GET by default
    expect(calls[1].options.method).toBe('POST');
    expect(auth.session.value.user.name).toBe('Grace');
  });
});

describe('auth: fetch hooks', () => {
  it('runs hooks in order and lets onRequest mutate options', async () => {
    const events = [];
    auth.initAuth({
      baseURL: 'http://localhost',
      fetchOptions: {
        onRequest: (ctx) => {
          events.push('request');
          ctx.options.headers = { 'x-test': '1' };
        },
        onResponse: ({ response }) => events.push(`response:${response.status}`),
        onSuccess: ({ data }) => events.push(`success:${data.user.id}`),
        onError: () => events.push('error'),
      },
    });
    const calls = stubFetch(() => json(sampleSession));
    await auth.refreshSession();
    expect(events).toEqual(['request', 'response:200', 'success:u1']);
    expect(calls[0].options.headers['x-test']).toBe('1');
  });

  it('calls onError with the parsed error body', async () => {
    let seen;
    auth.initAuth({
      baseURL: 'http://localhost',
      fetchOptions: {
        onError: (ctx) => {
          seen = ctx;
        },
      },
    });
    stubFetch(() => json({ message: 'nope', code: 'BAD' }, 400));
    await auth.refreshSession();
    expect(seen.response.status).toBe(400);
    expect(seen.error.message).toBe('nope');
    expect(seen.error.code).toBe('BAD');
  });
});

describe('auth: authFetch escape hatch', () => {
  it('hits an arbitrary endpoint and returns parsed data', async () => {
    const calls = stubFetch(() => json({ ok: true }));
    const { data, error } = await auth.authFetch('/change-password', { method: 'POST' });
    expect(data).toEqual({ ok: true });
    expect(error).toBeNull();
    expect(calls[0].path).toBe('/change-password');
  });

  it('retries the request object against a placeholder origin when Request rejects a relative URL', async () => {
    // Simulate SSR/Node, where a relative URL cannot build a Request. A relative
    // baseURL therefore goes through `makeRequest`'s fallback.
    const RealRequest = globalThis.Request;
    globalThis.Request = function StrictRequest(url, options) {
      if (typeof url === 'string' && !/^https?:\/\//i.test(url)) {
        throw new Error('Invalid URL');
      }
      return new RealRequest(url, options);
    };
    let requestURL;
    auth.initAuth({
      baseURL: '/relative',
      fetchOptions: {
        onRequest: ({ request }) => {
          requestURL = request.url;
        },
      },
    });
    const calls = stubFetch(() => json(sampleSession));
    try {
      await auth.refreshSession();
    } finally {
      globalThis.Request = RealRequest;
    }
    expect(calls[0].url).toBe('/relative/api/auth/get-session'); // fetch still uses the configured base
    expect(requestURL).toBe('http://localhost/relative/api/auth/get-session');
  });
});

describe('auth: sign in / up / out', () => {
  it('signInEmail posts credentials, broadcasts, and refetches', async () => {
    const calls = stubFetch((call) =>
      call.path === '/sign-in/email' ? json({ user: sampleUser, token: 't' }) : json(sampleSession),
    );

    const { error } = await auth.signInEmail({ email: 'ada@example.com', password: 'pw' });
    expect(error).toBeNull();
    expect(calls[0].path).toBe('/sign-in/email');
    expect(calls[0].options.method).toBe('POST');
    expect(JSON.parse(calls[0].options.body).email).toBe('ada@example.com');
    expect(calls[1].path).toBe('/get-session');
    expect(auth.session.value.user.id).toBe('u1');
    const written = JSON.parse(localStorage.getItem(BROADCAST_KEY));
    expect(written.event).toBe('session');
    expect(written.data.trigger).toBe('signin');
  });

  it('signInEmail surfaces an error and does not refetch', async () => {
    const calls = stubFetch(() => json({ message: 'bad creds', code: 'INVALID' }, 401));
    const { error } = await auth.signInEmail({ email: 'x', password: 'y' });
    expect(error.message).toBe('bad creds');
    expect(calls.length).toBe(1); // no session refetch on failure
    expect(auth.session.value).toBeNull();
  });

  it('signOut clears the store and broadcasts on success', async () => {
    stubFetch(() => json(sampleSession));
    await auth.refreshSession();
    const calls = stubFetch(() => json({ success: true }));
    const { error } = await auth.signOut();
    expect(error).toBeNull();
    expect(calls[0].path).toBe('/sign-out');
    expect(auth.session.value).toBeNull();
    const written = JSON.parse(localStorage.getItem(BROADCAST_KEY));
    expect(written.data.trigger).toBe('signout');
  });

  it('signOut keeps the session and does not broadcast when the request fails', async () => {
    stubFetch(() => json(sampleSession));
    await auth.refreshSession();
    stubFetch(() => json({ message: 'missing origin', code: 'MISSING_OR_NULL_ORIGIN' }, 403));
    const { error } = await auth.signOut();
    expect(error.code).toBe('MISSING_OR_NULL_ORIGIN');
    expect(auth.session.value).toBeTruthy(); // session survives a failed sign-out
    expect(localStorage.getItem(BROADCAST_KEY)).toBeNull(); // no broadcast on failure
  });

  it('signUpEmail posts, broadcasts signup, and refetches', async () => {
    const calls = stubFetch((call) =>
      call.path === '/sign-up/email' ? json({ user: sampleUser, token: 't' }) : json(sampleSession),
    );
    const { error } = await auth.signUpEmail({ email: 'ada@example.com', password: 'pw', name: 'Ada' });
    expect(error).toBeNull();
    expect(calls[0].path).toBe('/sign-up/email');
    expect(calls[0].options.method).toBe('POST');
    expect(JSON.parse(calls[0].options.body).name).toBe('Ada');
    expect(calls[1].path).toBe('/get-session');
    expect(auth.session.value.user.id).toBe('u1');
    expect(JSON.parse(localStorage.getItem(BROADCAST_KEY)).data.trigger).toBe('signup');
  });

  it('signUpEmail surfaces an error and does not refetch', async () => {
    const calls = stubFetch(() => json({ message: 'taken', code: 'EMAIL_TAKEN' }, 403));
    const { error } = await auth.signUpEmail({ email: 'x', password: 'y' });
    expect(error.code).toBe('EMAIL_TAKEN');
    expect(calls.length).toBe(1);
  });
});

describe('auth: loadSession', () => {
  it('fetches once, then resolves without touching the network', async () => {
    const calls = stubFetch(() => json(sampleSession));
    await auth.loadSession();
    expect(calls.length).toBe(1);
    expect(auth.session.value.user.id).toBe('u1');
    await auth.loadSession();
    await auth.loadSession();
    expect(calls.length).toBe(1); // later loadSession calls are no-ops
  });

  it('collapses concurrent initial loads into one request', async () => {
    const calls = stubFetch(() => json(sampleSession));
    await Promise.all([auth.loadSession(), auth.loadSession(), auth.loadSession()]);
    expect(calls.length).toBe(1);
  });

  it('does not refetch after an explicit refreshSession', async () => {
    const calls = stubFetch(() => json(sampleSession));
    await auth.refreshSession();
    expect(calls.length).toBe(1);
    await auth.loadSession();
    expect(calls.length).toBe(1); // loadSession is a no-op once loaded
  });

  it('stays memoized after a failed load; refreshSession is the retry', async () => {
    let attempt = 0;
    const calls = stubFetch(() => {
      attempt += 1;
      return attempt === 1 ? json({ message: 'boom' }, 500) : json(sampleSession);
    });
    await auth.loadSession();
    expect(calls.length).toBe(1);
    expect(auth.session.value).toBeNull();
    await auth.loadSession();
    expect(calls.length).toBe(1); // loadSession does not retry after the first attempt
    await auth.refreshSession();
    expect(calls.length).toBe(2);
    expect(auth.session.value.user.id).toBe('u1');
  });
});

describe('auth: passive refresh', () => {
  it('refetches when another tab broadcasts a session change, then cleans up', async () => {
    const calls = stubFetch(() => json(sampleSession));
    const stop = auth.startSessionRefresh();

    // A storage event without our key is ignored.
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: '{}' }));
    await Promise.resolve();
    expect(calls.length).toBe(0);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: BROADCAST_KEY,
        newValue: JSON.stringify({ event: 'session', data: { trigger: 'signin' } }),
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.length).toBe(1);

    stop();
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: BROADCAST_KEY,
        newValue: JSON.stringify({ event: 'session' }),
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.length).toBe(1); // listener removed on cleanup
  });

  it('rate-limits visibility refetches to one per 5s', async () => {
    const realNow = Date.now;
    const base = realNow() + 1_000_000;
    let now = base;
    Date.now = () => now;
    try {
      const calls = stubFetch(() => json(sampleSession));
      const stop = auth.startSessionRefresh();

      // First focus: last request was long ago, so it refetches.
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 0));
      expect(calls.length).toBe(1);

      // Second focus immediately after: within the 5s window, skipped.
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 0));
      expect(calls.length).toBe(1); // second focus is rate-limited

      // Move past the window: it refetches again.
      now = base + 6000;
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 0));
      expect(calls.length).toBe(2);

      stop();
    } finally {
      Date.now = realNow;
    }
  });

  it('refetches when the browser comes back online, and stays quiet while offline', async () => {
    const realNow = Date.now;
    // A large offset clears the focus rate limit regardless of what earlier
    // tests left in `lastRequestAt` (it is module-level state).
    let now = realNow() + 10_000_000_000;
    Date.now = () => now;
    try {
      const calls = stubFetch(() => json(sampleSession));
      const stop = auth.startSessionRefresh();

      window.dispatchEvent(new Event('offline')); // offline suppresses refetches by default
      await new Promise((r) => setTimeout(r, 0));
      expect(calls.length).toBe(0);

      now += 10_000; // past the focus rate limit
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 0));
      expect(calls.length).toBe(1);
      expect(auth.session.value.user.id).toBe('u1');
      stop();
    } finally {
      Date.now = realNow;
    }
  });

  it('polls on the configured interval while a session exists', async () => {
    auth.initAuth({
      baseURL: 'http://localhost',
      sessionOptions: { refetchInterval: 0.01 },
    });
    auth.session.value = sampleSession;
    const calls = stubFetch(() => json(sampleSession));
    const stop = auth.startSessionRefresh();
    try {
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      stop();
    }
    expect(calls.length).toBeGreaterThan(0);
  });
});
