import { createClient } from '@supabase/supabase-js'
import { getEnv } from '../config'

const env = getEnv()

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})

// Shared flag to track if getSession is currently in progress anywhere in the app
// This prevents concurrent getSession() calls which can cause timeouts
export const getSessionState = { inProgress: false }

export interface ApiKeyResponse {
  api_key: string
  user_id: string
  user_email: string
  role: string
  is_active: boolean
  backend_base_url?: string | null
  warning?: string
}

/**
 * Fetch the Edison Watch API key for the authenticated user
 * from the Supabase edge function.
 *
 * Throws an error with a `code` property for known error cases:
 * - `SSO_ONLY_DOMAIN`: org requires SSO but user signed in via OAuth
 */
export async function fetchApiKey(): Promise<ApiKeyResponse | null> {
  const edgeFunctionUrl =
    import.meta.env?.VITE_SUPABASE_EDGE_FUNCTION_URL ||
    `${env.FUNCTIONS_URL}/functions/v1/get-api-key`

  try {
    if (getSessionState.inProgress) {
      return null
    }

    getSessionState.inProgress = true
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.getSession()
    getSessionState.inProgress = false

    if (sessionError || !session) {
      return null
    }

    const response = await fetch(edgeFunctionUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      let errorJson: { code?: string; message?: string } | null = null
      try {
        errorJson = await response.json()
      } catch {
        // not JSON
      }
      const knownCode =
        errorJson?.code === 'SSO_ONLY_DOMAIN' || errorJson?.code === 'AUTH_METHOD_MISMATCH'
      if (response.status === 403 && knownCode) {
        const err = new Error(errorJson!.message || 'Sign-in method not allowed for your account.')
        ;(err as Error & { code: string }).code = errorJson!.code!
        throw err
      }
      return null
    }

    return (await response.json()) as ApiKeyResponse
  } catch (error) {
    getSessionState.inProgress = false
    // Re-throw known coded errors so callers can handle them
    const code = (error as Error & { code?: string })?.code
    if (code === 'SSO_ONLY_DOMAIN' || code === 'AUTH_METHOD_MISMATCH') {
      throw error
    }
    console.error('[fetchApiKey] Exception:', error)
    return null
  }
}
