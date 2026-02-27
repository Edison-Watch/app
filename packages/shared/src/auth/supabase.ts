import { createClient } from "@supabase/supabase-js";

// Supabase config - these should be set via environment variables at build time
// For development, you can hardcode them or use import.meta.env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[supabase.ts] Supabase not configured - auth disabled:", {
    VITE_SUPABASE_URL: !!supabaseUrl,
    VITE_SUPABASE_ANON_KEY: !!supabaseAnonKey,
  });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// Shared flag to track if getSession is currently in progress anywhere in the app
// This prevents concurrent getSession() calls which can cause timeouts
export const getSessionState = { inProgress: false };

export interface ApiKeyResponse {
  api_key: string;
  user_id: string;
  user_email: string;
  role: string;
  backend_base_url?: string | null;
}

/**
 * Fetch the Edison Watch API key for the authenticated user
 * from the Supabase edge function.
 */
export async function fetchApiKey(): Promise<ApiKeyResponse | null> {
  const edgeFunctionUrl =
    import.meta.env.VITE_SUPABASE_EDGE_FUNCTION_URL ||
    `${supabaseUrl}/functions/v1/get-api-key`;

  try {
    if (getSessionState.inProgress) {
      return null;
    }

    getSessionState.inProgress = true;
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    getSessionState.inProgress = false;

    if (sessionError || !session) {
      return null;
    }

    const response = await fetch(edgeFunctionUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as ApiKeyResponse;
  } catch (error) {
    getSessionState.inProgress = false;
    console.error("[fetchApiKey] Exception:", error);
    return null;
  }
}
