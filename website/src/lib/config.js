// The OUTARCH account backend. The publishable key only identifies the
// project: every table it can reach is guarded by row level security.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://qswiqzootfwkbbbvhfyj.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Hzu_YYvjpON_JuygUzx3EA_Ti7O-fu5';

// The browser storage key the website's Supabase client keeps its session under.
export const SESSION_STORAGE_KEY = 'outarch-website-session';

// A public table read without loading the Supabase client, for the home page.
export async function readPublic(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: { apikey: SUPABASE_KEY, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${table}: ${response.status}`);
  return response.json();
}
