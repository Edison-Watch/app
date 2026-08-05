import { Button, Badge } from "@edison-watch/shared/ui";
import { clearCachedSecretKey } from "@edison-watch/shared/crypto";
import PromptInjectionAnimation from "../animations/PromptInjectionAnimation";
import CustomServerConnect from "./CustomServerConnect";
import type { AuthState } from "../../hooks/useAuth";

function BrowserIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
    </svg>
  );
}

interface WelcomeStepProps {
  auth: AuthState & {
    signInWithBrowser: () => Promise<void>;
    reopenVerificationPage: () => void;
    cancelPendingAuth: () => void;
    signOut: () => Promise<void>;
  };
  onNext: () => void;
}

export default function WelcomeStep({ auth, onNext }: WelcomeStepProps): React.ReactNode {
  const hero = (
    <>
      <div className="text-center">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Protect your data handled by AI Agents</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          AI agents with access to your tools are vulnerable to prompt injection attacks that can exfiltrate sensitive data. Edison watches your agent actions and analyses each action, to protect your data.
        </p>
      </div>
      <PromptInjectionAnimation />
    </>
  );

  // Signed-in state
  if (auth.signedIn) {
    return (
      <div className="flex flex-col gap-4">
        {hero}
        <div
          className="rounded-lg border border-[var(--border)] overflow-hidden"
          style={{
            borderTopColor: "var(--accent-dim)",
            background: "linear-gradient(180deg, var(--bg-overlay) 0%, var(--bg-raised) 48px)",
          }}
        >
          <div className="flex items-center gap-3 px-4 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)]/15 text-xs font-semibold text-[var(--accent)]">
              {auth.email[0]?.toUpperCase() || "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate leading-tight">{auth.email}</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Authenticated</p>
            </div>
            <Badge variant={auth.serverStatus === "online" ? "success" : auth.serverStatus === "checking" ? "info" : "danger"}>
              {auth.serverStatus === "online" ? "Connected" : auth.serverStatus === "checking" ? "Checking…" : "Offline"}
            </Badge>
          </div>
        </div>
        <Button variant="primary" onClick={onNext} className="w-full">
          Continue
        </Button>
        <button
          type="button"
          onClick={async () => {
            try {
              await auth.signOut();
            } catch {
              // best-effort sign-out; always continue to reset
            }
            clearCachedSecretKey();
            await window.api.setup.reset();
            window.location.reload();
          }}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          Use a different account
        </button>
      </div>
    );
  }

  const errorBox = auth.error && (
    <div
      className="text-xs text-[var(--danger)] bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded-lg p-3"
      role="alert"
    >
      {auth.error}
    </div>
  );

  // Sign-in card: one path - approve this device from the Edison dashboard.
  return (
    <div className="flex flex-col gap-5">
      {hero}

      <p className="text-center text-xs text-[var(--text-secondary)]">
        {auth.awaitingBrowserCallback
          ? "Approve this device in your browser to continue"
          : "Sign in with your browser to connect this device"}
      </p>

      {/* Card */}
      <div
        className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] overflow-hidden"
        style={{
          borderTopColor: "var(--accent-dim)",
          background: "linear-gradient(180deg, var(--bg-overlay) 0%, var(--bg-raised) 48px)",
        }}
      >
        {auth.awaitingBrowserCallback ? (
          <div className="px-5 py-5 flex flex-col gap-3">
            <div className="flex items-center justify-center gap-2 text-sm text-[var(--text-secondary)]">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
              Waiting for approval in your browser…
            </div>
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg-base)]/40 p-3 text-center">
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                Confirm this code matches the one in your browser
              </p>
              <p
                className="mt-1 font-mono text-xl font-semibold tracking-[0.2em] text-[var(--text-primary)]"
                data-testid="device-user-code"
              >
                {auth.pendingUserCode}
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={auth.reopenVerificationPage} className="w-full">
              Reopen approval page
            </Button>
            <Button type="button" variant="danger" onClick={auth.cancelPendingAuth} className="w-full">
              Cancel sign-in
            </Button>
            {errorBox}
          </div>
        ) : (
          <div className="px-5 py-5 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => void auth.signInWithBrowser()}
              disabled={auth.loading}
              className="w-full flex items-center justify-center gap-2.5 bg-[var(--accent)] text-[var(--bg-base)] font-medium py-2 px-4 rounded-md border border-[var(--accent)] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              <BrowserIcon />
              Sign in with your browser
            </button>
            <p className="text-center text-xs text-[var(--text-secondary)]">
              Your browser opens the Edison dashboard, where you sign in as usual
              (Google, Microsoft, SSO, or email) and approve this device.
            </p>
            {errorBox}
          </div>
        )}
      </div>

      {/* Self-hosted deployments: connect to any Edison backend by URL. */}
      {!auth.awaitingBrowserCallback && <CustomServerConnect />}
    </div>
  );
}
