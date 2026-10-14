import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// The auth client is browser-shaped (window/document/localStorage/navigator),
// so each test builds its own jsdom and stubs `fetch`. The module holds
// singleton signals, so `reset()` re-inits options and clears state between
// tests rather than re-importing (ESM caches the instance — which is the point:
// one shared store for the whole app).
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.StorageEvent = dom.window.StorageEvent;

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
  globalThis.localStorage.clear();
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
    assert.equal(auth.isPending.value, true);
    await auth.refreshSession();
    assert.equal(auth.session.value.user.id, 'u1');
    assert.equal(auth.session.value.user.name, 'Ada');
    assert.equal(auth.isPending.value, false);
    assert.equal(auth.isRefetching.value, false);
    assert.equal(auth.sessionError.value, null);
  });

  it('normalizes { session: null, user: null } to null', async () => {
    stubFetch(() => json({ session: null, user: null }));
    await auth.refreshSession();
    assert.equal(auth.session.value, null);
    assert.equal(auth.isPending.value, false);
  });

  it('collapses concurrent refreshes into one request', async () => {
    const calls = stubFetch(() => json(sampleSession));
    await Promise.all([auth.refreshSession(), auth.refreshSession(), auth.refreshSession()]);
    assert.equal(calls.length, 1);
  });

  it('keeps the same reference when the identity is unchanged', async () => {
    stubFetch(() => json(sampleSession));
    await auth.refreshSession();
    const first = auth.session.value;
    await auth.refreshSession();
    assert.equal(auth.session.value, first, 'unchanged identity must not re-render');
  });

  it('clears the session on 401 but keeps it on other failures', async () => {
    stubFetch(() => json(sampleSession));
    await auth.refreshSession();
    assert.ok(auth.session.value);

    stubFetch(() => json({ message: 'boom' }, 500));
    await auth.refreshSession();
    assert.ok(auth.session.value, '500 keeps the last known session');
    assert.equal(auth.sessionError.value.status, 500);

    stubFetch(() => json({ message: 'gone', code: 'UNAUTHORIZED' }, 401));
    await auth.refreshSession();
    assert.equal(auth.session.value, null, '401 signs out');
  });

  it('reports a network failure without a response', async () => {
    stubFetch(() => {
      throw new Error('offline');
    });
    await auth.refreshSession();
    assert.equal(auth.session.value, null);
    assert.equal(auth.sessionError.value.message, 'offline');
    assert.equal(auth.isPending.value, false);
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
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.method, undefined, 'GET by default');
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(auth.session.value.user.name, 'Grace');
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
    assert.deepEqual(events, ['request', 'response:200', 'success:u1']);
    assert.equal(calls[0].options.headers['x-test'], '1');
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
    assert.equal(seen.response.status, 400);
    assert.equal(seen.error.message, 'nope');
    assert.equal(seen.error.code, 'BAD');
  });
});

describe('auth: authFetch escape hatch', () => {
  it('hits an arbitrary endpoint and returns parsed data', async () => {
    const calls = stubFetch(() => json({ ok: true }));
    const { data, error } = await auth.authFetch('/change-password', { method: 'POST' });
    assert.deepEqual(data, { ok: true });
    assert.equal(error, null);
    assert.equal(calls[0].path, '/change-password');
  });
});

describe('auth: sign in / up / out', () => {
  it('signInEmail posts credentials, broadcasts, and refetches', async () => {
    const calls = stubFetch((call) =>
      call.path === '/sign-in/email' ? json({ user: sampleUser, token: 't' }) : json(sampleSession),
    );

    const { error } = await auth.signInEmail({ email: 'ada@example.com', password: 'pw' });
    assert.equal(error, null);
    assert.equal(calls[0].path, '/sign-in/email');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(JSON.parse(calls[0].options.body).email, 'ada@example.com');
    assert.equal(calls[1].path, '/get-session');
    assert.equal(auth.session.value.user.id, 'u1');
    const written = JSON.parse(globalThis.localStorage.getItem(BROADCAST_KEY));
    assert.equal(written.event, 'session');
    assert.equal(written.data.trigger, 'signin');
  });

  it('signInEmail surfaces an error and does not refetch', async () => {
    const calls = stubFetch(() => json({ message: 'bad creds', code: 'INVALID' }, 401));
    const { error } = await auth.signInEmail({ email: 'x', password: 'y' });
    assert.equal(error.message, 'bad creds');
    assert.equal(calls.length, 1, 'no session refetch on failure');
    assert.equal(auth.session.value, null);
  });

  it('signOut clears the store', async () => {
    stubFetch(() => json(sampleSession));
    await auth.refreshSession();
    stubFetch(() => json({ success: true }));
    await auth.signOut();
    assert.equal(auth.session.value, null);
  });
});

describe('auth: passive refresh', () => {
  it('refetches when another tab broadcasts a session change, then cleans up', async () => {
    const calls = stubFetch(() => json(sampleSession));
    const stop = auth.startSessionRefresh();

    // A storage event without our key is ignored.
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: '{}' }));
    await Promise.resolve();
    assert.equal(calls.length, 0);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: BROADCAST_KEY,
        newValue: JSON.stringify({ event: 'session', data: { trigger: 'signin' } }),
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.length, 1);

    stop();
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: BROADCAST_KEY,
        newValue: JSON.stringify({ event: 'session' }),
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.length, 1, 'listener removed on cleanup');
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
      document.dispatchEvent(new window.Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(calls.length, 1);

      // Second focus immediately after: within the 5s window, skipped.
      document.dispatchEvent(new window.Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(calls.length, 1, 'second focus is rate-limited');

      // Move past the window: it refetches again.
      now = base + 6000;
      document.dispatchEvent(new window.Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(calls.length, 2);

      stop();
    } finally {
      Date.now = realNow;
    }
  });
});

after(() => {
  globalThis.window.close();
});
