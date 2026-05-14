// Netlify Function: GET /api/config
//
// Returns the public Supabase project URL and anon key so the browser can
// initialize the Supabase client. The anon key is intended to be public
// (it's the same key Supabase puts in frontend examples) so it's safe to
// hand out from this endpoint.
//
// Configure via Netlify dashboard → Site settings → Environment variables:
//   SUPABASE_URL       e.g. https://YOUR-PROJECT-REF.supabase.co
//   SUPABASE_ANON_KEY  the anon public key

export default async () =>
  new Response(
    JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );

export const config = { path: "/api/config" };
