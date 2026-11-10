import { useCallback, useEffect, useState } from 'react'
import { Badge, Button } from '@sealgate/shared/ui'
import StdiodEnableCard from '../StdiodEnableCard'

type Status = Awaited<ReturnType<typeof window.api.messaging.status>>
type LoginState = Exclude<Awaited<ReturnType<typeof window.api.messaging.startLogin>>, { error: string }>
type Field = NonNullable<NonNullable<LoginState['step']>['user_input']>['fields'][number]

function isError(v: unknown): v is { error: string } {
  return typeof v === 'object' && v !== null && 'error' in v && typeof (v as { error: unknown }).error === 'string'
}

const STATE_LABEL: Record<string, { text: string; variant: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  CONNECTED: { text: 'Connected', variant: 'success' },
  CONNECTING: { text: 'Connecting', variant: 'warning' },
  BACKFILLING: { text: 'Syncing', variant: 'warning' },
  TRANSIENT_DISCONNECT: { text: 'Reconnecting', variant: 'warning' },
  BAD_CREDENTIALS: { text: 'Sign-in needed', variant: 'danger' },
  UNKNOWN_ERROR: { text: 'Error', variant: 'danger' },
  LOGGED_OUT: { text: 'Signed out', variant: 'danger' }
}

const inputClass =
  'w-full rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]'

function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const id = `msg-field-${field.id}`
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-[var(--text-secondary)]">{field.name}</span>
      {field.type === 'select' && field.options ? (
        <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>
            Choose…
          </option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={inputClass}
          type={field.type === 'password' ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      )}
      {field.description && <span className="text-[10px] text-[var(--text-muted)]">{field.description}</span>}
    </label>
  )
}

/** Adds an IRC server to the list the IRC login offers. */
function IrcServerForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [tls, setTls] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const save = async (): Promise<void> => {
    const res = await window.api.messaging.setIrcNetwork(name.trim().toLowerCase(), {
      displayname: name.trim(),
      address: address.trim(),
      tls
    })
    if (isError(res)) setError(res.error)
    else onDone()
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-raised)] p-3">
      <span className="text-xs font-medium text-[var(--text-primary)]">Add an IRC server</span>
      <input id="irc-server-name" className={inputClass} placeholder="Short name, e.g. work-irc" value={name} onChange={(e) => setName(e.target.value)} />
      <input id="irc-server-address" className={inputClass} placeholder="host:port, e.g. irc.example.com:6697" value={address} onChange={(e) => setAddress(e.target.value)} />
      <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
        <input id="irc-server-tls" type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />
        Use TLS
      </label>
      {error && <p className="text-[11px] text-[var(--danger)]">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={!name.trim() || !address.trim()}>
          Save server
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function AddAccount({ networks, onDone }: { networks: Status['networks']; onDone: () => void }) {
  const [network, setNetwork] = useState<string | null>(networks.length === 1 ? networks[0]!.id : null)
  const [login, setLogin] = useState<LoginState | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [addingServer, setAddingServer] = useState(false)

  const start = useCallback(async (net: string) => {
    setError(null)
    const res = await window.api.messaging.startLogin(net)
    if (isError(res)) {
      setError(res.error)
      return
    }
    setLogin(res)
    const defaults: Record<string, string> = {}
    for (const f of res.step?.user_input?.fields ?? []) defaults[f.id] = f.default_value ?? ''
    setValues(defaults)
  }, [])

  useEffect(() => {
    if (network && !login) void start(network)
  }, [network, login, start])

  // A display_and_wait step (a QR code to scan) finishes on the network's
  // side, so poll until the next step arrives.
  useEffect(() => {
    if (!login || login.done || login.step?.type !== 'display_and_wait') return
    const t = setInterval(async () => {
      const res = await window.api.messaging.getLogin(login.network, login.id)
      if (!isError(res)) setLogin(res)
    }, 2000)
    return () => clearInterval(t)
  }, [login])

  const cancel = async (): Promise<void> => {
    if (login && !login.done) await window.api.messaging.cancelLogin(login.network, login.id)
    onDone()
  }

  const submit = async (): Promise<void> => {
    if (!login) return
    setBusy(true)
    const res = await window.api.messaging.submitLogin(login.network, login.id, values)
    setBusy(false)
    if (isError(res)) setError(res.error)
    else {
      setLogin(res)
      setError(res.error ?? null)
    }
  }

  if (!network) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs text-[var(--text-secondary)]">Which app?</span>
        {networks.map((n) => (
          <Button key={n.id} variant="secondary" size="sm" onClick={() => setNetwork(n.id)}>
            {n.name}
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    )
  }

  if (login?.done) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-raised)] p-3">
        <span className="text-xs font-medium text-[var(--text-primary)]">Account added</span>
        {login.step?.instructions && <span className="text-[11px] text-[var(--text-muted)]">{login.step.instructions}</span>}
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    )
  }

  const step = login?.step
  const fields = step?.user_input?.fields ?? []
  const missing = fields.some((f) => !values[f.id])
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-raised)] p-3">
      {!step && !error && <span className="text-xs text-[var(--text-muted)]">Starting sign-in…</span>}
      {step?.instructions && <p className="text-[11px] text-[var(--text-secondary)]">{step.instructions}</p>}
      {step?.type === 'display_and_wait' && (
        <div className="flex flex-col items-center gap-2">
          {step.display_and_wait?.image_url ? (
            <img src={step.display_and_wait.image_url} alt="Sign-in code" className="max-w-[200px]" />
          ) : (
            <code className="break-all text-[11px]">{step.display_and_wait?.data}</code>
          )}
          <span className="text-[10px] text-[var(--text-muted)]">Waiting for you to confirm on your phone…</span>
        </div>
      )}
      {fields.map((f) => (
        <FieldInput key={f.id} field={f} value={values[f.id] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [f.id]: v }))} />
      ))}
      {network === 'irc' && step?.type === 'user_input' && !addingServer && (
        <button
          type="button"
          className="self-start text-[11px] text-[var(--accent)] hover:text-[var(--accent-muted)]"
          onClick={() => setAddingServer(true)}
        >
          Server not listed? Add one
        </button>
      )}
      {addingServer && (
        <IrcServerForm
          onDone={() => {
            setAddingServer(false)
            setLogin(null) // restart so the new server appears in the list
          }}
        />
      )}
      {error && <p className="text-[11px] text-[var(--danger)]">{error}</p>}
      <div className="flex gap-2">
        {step?.type === 'user_input' && (
          <Button size="sm" onClick={submit} disabled={busy || missing}>
            {busy ? 'Connecting…' : 'Continue'}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export default function MessagingView({ apiBaseUrl, apiKey }: { apiBaseUrl?: string; apiKey?: string }): React.ReactNode {
  const [status, setStatus] = useState<Status | null>(null)
  const [tunnelReady, setTunnelReady] = useState<boolean | null>(null)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [enabling, setEnabling] = useState(false)

  const refresh = useCallback(async () => {
    const [st, tunnel] = await Promise.all([window.api.messaging.status(), window.api.stdiod.status().catch(() => null)])
    setStatus(st)
    setTunnelReady(Boolean(tunnel?.installed && tunnel?.loggedIn))
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
  }, [refresh])

  const enable = async (): Promise<void> => {
    setEnabling(true)
    setMessage(null)
    const res = await window.api.messaging.enable()
    setEnabling(false)
    if (isError(res)) setMessage(res.error)
    else if (!res.ok) setMessage(res.message)
    await refresh()
  }

  const remove = async (id: string): Promise<void> => {
    const res = await window.api.messaging.removeAccount(id)
    if (isError(res)) setMessage(res.error)
    await refresh()
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    )
  }

  const intro = (
    <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
      Let your AI agents read and send messages in your chat apps. Your chats are synced and stored on this
      computer only. Agents reach them through SealGate, where your organization's policies apply.
    </p>
  )

  if (!status.binaryPresent) {
    return (
      <div className="flex flex-col gap-3">
        {intro}
        <p className="text-xs text-[var(--danger)]">The messaging component is missing from this install. Reinstall SealGate.</p>
      </div>
    )
  }

  if (!status.running) {
    let body: React.ReactNode
    if (status.registration === 'pending') {
      body = (
        <p className="text-xs text-[var(--text-secondary)]">
          Waiting for an admin to approve Messaging in the SealGate dashboard. This page updates by itself.
        </p>
      )
    } else if (status.registration === 'approved') {
      body = (
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          Starting messaging…
        </div>
      )
    } else if (tunnelReady === false) {
      // Messaging runs as a local MCP server through the stdio tunnel daemon,
      // so the tunnel has to be on first.
      body = (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-[var(--text-secondary)]">
            Messaging runs on this computer through the local stdio tunnel. Turn the tunnel on first.
          </p>
          {apiBaseUrl && apiKey && <StdiodEnableCard apiBaseUrl={apiBaseUrl} apiKey={apiKey} />}
        </div>
      )
    } else {
      body = (
        <Button onClick={enable} disabled={enabling}>
          {enabling ? 'Turning on…' : 'Turn on messaging'}
        </Button>
      )
    }
    return (
      <div className="flex flex-col gap-3">
        {intro}
        {body}
        {message && <p className="text-[11px] text-[var(--danger)] whitespace-pre-wrap">{message}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {intro}
      <div className="flex flex-col gap-1.5">
        {status.accounts.length === 0 && !adding && (
          <p className="text-center text-xs text-[var(--text-muted)] py-3">No accounts yet. Add one to get started.</p>
        )}
        {status.accounts.map((a) => {
          const st = STATE_LABEL[a.state] ?? { text: a.state.toLowerCase(), variant: 'neutral' as const }
          return (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-[var(--text-primary)] truncate">{a.remote_name}</div>
                <div className="text-[10px] text-[var(--text-muted)]">{a.network_name}</div>
                {a.error && <div className="text-[10px] text-[var(--danger)] truncate">{a.error}</div>}
              </div>
              <Badge variant={st.variant}>{st.text}</Badge>
              <button
                type="button"
                className="text-[10px] text-[var(--text-muted)] hover:text-[var(--danger)]"
                onClick={() => void remove(a.id)}
              >
                Remove
              </button>
            </div>
          )
        })}
      </div>
      {adding ? (
        <AddAccount
          networks={status.networks}
          onDone={() => {
            setAdding(false)
            void refresh()
          }}
        />
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          Add account
        </Button>
      )}
      {message && <p className="text-[11px] text-[var(--danger)]">{message}</p>}
    </div>
  )
}
