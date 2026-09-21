import { createClient } from '@supabase/supabase-js';
import { SESSION_STORAGE_KEY, SUPABASE_KEY, SUPABASE_URL } from './config.js';

// Two clients, on purpose.
//
// The website client keeps its own session (localStorage) for the Account and
// Pricing pages, and refreshes it.
//
// The desktop client is used only while signing in *for the OUTARCH app*. It
// stores nothing and never refreshes: the session it gets is handed straight
// to the app, and a refresh here would rotate the app's refresh token out
// from under it and sign the app out. It reads the tokens from the redirect
// itself, so the website client must not read them first.
let websiteClient = null;
let desktopClient = null;

export function isDesktopFlow(location = window.location) {
  return new URLSearchParams(location.search).get('client') === 'desktop';
}

export function website() {
  if (!websiteClient) {
    websiteClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        flowType: 'implicit',
        persistSession: true,
        autoRefreshToken: true,
        // Redirect tokens are read by the sign-in page itself (takeRedirectTokens),
        // which decides whose session they are.
        detectSessionInUrl: false,
        storageKey: SESSION_STORAGE_KEY
      }
    });
  }
  return websiteClient;
}

export function desktop() {
  if (!desktopClient) {
    desktopClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        flowType: 'implicit',
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  return desktopClient;
}

export function clientFor(desktopFlow) {
  return desktopFlow ? desktop() : website();
}
