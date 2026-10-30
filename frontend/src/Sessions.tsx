import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchLogins, loginAction } from './api'
import type { LoginRole, Logins } from './types'

const LABELS: Record<LoginRole, string> = { buyer: 'Buyer', seller: 'Seller', admin: 'Admin', biz_user: 'Biz user' }

// Every role's saved session and login window on the chosen runner's laptop, refreshed by the caller on
// the backend's `logins` event.
export function useLogins(runnerId: string | null) {
  const [logins, setLogins] = useState<Logins | null>(null)
  const runnerRef = useRef(runnerId)
  runnerRef.current = runnerId
  const refresh = useCallback(() => {
    const asked = runnerRef.current
    fetchLogins(asked).then((latest) => {
      if (runnerRef.current === asked) setLogins(latest)
    }, () => undefined)
  }, [])
  useEffect(refresh, [runnerId, refresh])
  return { logins, setLogins, refresh }
}

function ago(iso: string, now: number) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'saved just now'
  if (minutes < 60) return `saved ${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `saved ${hours} h ago`
  return `saved ${Math.round(hours / 24)} days ago`
}

// The buttons at the top of the page that save the test suite's logins on the chosen runner's laptop,
// the same as `python scripts/save_auth_state.py <role>` there: a browser opens at the role's login page,
// the tester logs in there and clicks Save session here.
export function Sessions({
  logins,
  runnerId,
  onChange,
  onError,
}: {
  logins: Logins | null
  runnerId: string | null
  onChange: (logins: Logins) => void
  onError: (message: string) => void
}) {
  const [now, setNow] = useState(Date.now())
  const [hidden, setHidden] = useState<Set<LoginRole>>(new Set())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (!logins || !runnerId) return null

  const act = (role: LoginRole, action?: 'save' | 'cancel') => {
    if (!action) setHidden((previous) => new Set([...previous].filter((r) => r !== role)))
    loginAction(runnerId, role, action).then(onChange, (e) => onError(e instanceof Error ? e.message : String(e)))
  }
  const open = logins.roles.filter(({ role, login }) => login && !hidden.has(role) && login.status !== 'cancelled')
  const app = logins.app ? new URL(logins.app).host : null

  return (
    <div className="sessions">
      <div className="sessions-row">
        <span className="sessions-title" title={app ? `Saved logins the tests use on ${app}` : undefined}>
          Test logins{app && <span> · {app}</span>}
        </span>
        {logins.roles.map(({ role, savedAt, login }) => {
          const busy = login?.status === 'waiting' || login?.status === 'saving'
          return (
            <button
              key={role}
              className={busy ? 'session-button session-busy' : 'session-button'}
              disabled={!logins.available || busy}
              title={logins.reason ?? `Open the ${LABELS[role]} login page and save the session for the tests`}
              onClick={() => act(role)}
            >
              <span>Login as {LABELS[role]}</span>
              <small className={savedAt ? undefined : 'fail'}>
                {busy ? 'window open' : savedAt ? ago(savedAt, now) : 'not saved'}
              </small>
            </button>
          )
        })}
      </div>
      {open.map(({ role, loginUrl, login }) => (
        <div key={role} className={`session-panel session-${login!.status}`} role="status">
          {login!.status === 'waiting' || login!.status === 'saving' ? (
            <>
              <p>
                <b>{LABELS[role]}:</b> a browser opened at <code>{loginUrl}</code>. Log in there with the {LABELS[role].toLowerCase()} test
                account{role === 'biz_user' && ' (a business user)'}, then save.
                {login!.message && <span className="fail session-message">{login!.message}</span>}
              </p>
              <span className="session-actions">
                <button className="text-button" onClick={() => act(role, 'cancel')}>
                  Cancel
                </button>
                <button className="save-button" disabled={login!.status === 'saving'} onClick={() => act(role, 'save')}>
                  {login!.status === 'saving' ? 'Saving…' : 'Save session'}
                </button>
              </span>
            </>
          ) : (
            <>
              <p>
                {login!.status === 'saved' ? (
                  <>
                    <b className="pass">{LABELS[role]} session saved.</b> Tests now run with this login.
                  </>
                ) : (
                  <>
                    <b className="fail">{LABELS[role]} session not saved.</b> {login!.message}
                  </>
                )}
              </p>
              <button
                className="text-button"
                aria-label="Dismiss"
                onClick={() => setHidden((previous) => new Set([...previous, role]))}
              >
                ✕
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
