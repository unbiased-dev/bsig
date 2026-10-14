import { h, signal } from 'bsig';
import {
  authFetch,
  initAuth,
  isPending,
  loadSession,
  refreshSession,
  session,
  sessionError,
  signInEmail,
  signOut,
  signUpEmail,
  startSessionRefresh,
} from 'bsig/auth';
import type { AuthError, AuthOptions, Credentials, SignUpInput } from 'bsig/auth';

// A better-auth Session/User pair, as it comes from userland. Registering it on
// `AuthTypes` REPLACES the client's defaults, so all fields keep their exact
// (required/optional/Date) types on `session.value`. No better-auth dependency.
declare module 'bsig/auth' {
  interface AuthTypes {
    session: {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      expiresAt: Date;
      token: string;
      ipAddress?: string | null;
      userAgent?: string | null;
    };
    user: {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      email: string;
      emailVerified: boolean;
      name: string;
      image?: string | null;
    };
  }
}

const options: AuthOptions = {
  baseURL: 'https://api.example.com',
  fetchOptions: {
    onRequest: ({ options: init }) => {
      init.headers = { 'x-app': 'demo' };
    },
    onError: ({ error, response }) => {
      void `${response?.status ?? 'network'}: ${error.message}`;
    },
  },
  sessionOptions: { refetchInterval: 30, refetchOnWindowFocus: true, refetchWhenOffline: false },
};
initAuth(options);

const credentials: Credentials = { email: 'a@b.c', password: 'pw' };
const signUpInput: SignUpInput = { ...credentials, name: 'Ada' };

export const stopRefresh = startSessionRefresh();

export const authSmoke = {
  // Required fields stay required; `Date` stays `Date`; optional stay optional.
  name: session.value?.user.name.toUpperCase(),
  verified: session.value?.user.emailVerified,
  image: session.value?.user.image,
  expiresAt: session.value?.session.expiresAt.getTime(),
  ip: session.value?.session.ipAddress,
  pending: isPending.value,
  error: sessionError.value as AuthError | null,
  credentials,
  signUpInput,
};

export const authActions = { loadSession, refreshSession, signInEmail, signUpEmail, signOut, authFetch };

// A signal-driven view, to keep the JSX/react pipeline honest.
const signedIn = signal(true);
export function AuthBadge() {
  return h('span', null, () => (signedIn.value ? (session.value?.user.name ?? 'signed in') : 'out'));
}
