"use client";

import { useActionState } from "react";
import { confirmTotp, disableTotp, regenerateRecoveryCodes, startTotpSetup } from "@/app/dashboard/actions";

type State = { error?: string; message?: string; recoveryCodes?: string[] } | null;
type Action = (p: unknown, f: FormData) => Promise<NonNullable<State>>;

function Message({ state }: { state: State }) {
  return (
    <>
      {state?.error && <span className="error">{state.error}</span>}
      {state?.message && <span>{state.message}</span>}
    </>
  );
}

function CodeField({ id }: { id: string }) {
  return (
    <div style={{ maxWidth: 200 }}>
      <label htmlFor={id}>6-digit code</label>
      <input id={id} name="code" inputMode="numeric" autoComplete="one-time-code" required />
    </div>
  );
}

export interface TotpPanelProps {
  enabledSince: string | null;
  recoveryLeft: number;
  pending: { secret: string; qrSvg: string } | null;
  needsPassword: boolean;
}

/**
 * All 2FA controls in one component. Turning 2FA on re-issues the session cookie, which re-renders
 * the page in its "enabled" state; keeping the action state here means the one-time recovery codes
 * from that response are still on screen afterwards.
 */
export function TotpPanel({ enabledSince, recoveryLeft, pending, needsPassword }: TotpPanelProps) {
  const [startState, start, starting] = useActionState(startTotpSetup as Action, null);
  const [confirmState, confirm, confirming] = useActionState(confirmTotp as Action, null);
  const [regenState, regen, regenerating] = useActionState(regenerateRecoveryCodes as Action, null);
  const [disableState, disable, disabling] = useActionState(disableTotp as Action, null);
  const codes = regenState?.recoveryCodes ?? confirmState?.recoveryCodes;

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      {codes && (
        <div className="notice">
          Save these recovery codes somewhere safe. Each one signs you in once if you lose your phone; they will not be shown again.
          <pre className="mono recovery-codes" style={{ margin: "8px 0 0" }}>{codes.join("\n")}</pre>
        </div>
      )}
      {enabledSince ? (
        <>
          <div>
            <span className="badge ok">on</span> since {enabledSince}. You will be asked for a code each time you sign in. {recoveryLeft} unused recovery codes
            left.
          </div>
          <form action={regen} className="row" style={{ alignItems: "end" }}>
            <CodeField id="code-regen" />
            <button className="secondary" disabled={regenerating}>New recovery codes</button>
            <Message state={regenState} />
          </form>
          <form action={disable} className="row" style={{ alignItems: "end" }}>
            <CodeField id="code-disable" />
            <button className="danger" disabled={disabling}>Turn off</button>
            <Message state={disableState} />
          </form>
        </>
      ) : pending ? (
        <>
          <p style={{ margin: 0 }}>Scan this QR code with an authenticator app (1Password, Google Authenticator, Authy…), then enter the code it shows.</p>
          <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
            <div className="qr" dangerouslySetInnerHTML={{ __html: pending.qrSvg }} />
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Or enter this key manually:</div>
              <div className="mono totp-secret" style={{ wordBreak: "break-all", maxWidth: 280 }}>{pending.secret.replace(/(.{4})/g, "$1 ").trim()}</div>
            </div>
          </div>
          <form action={confirm} className="row" style={{ alignItems: "end" }}>
            <CodeField id="code-confirm" />
            <button disabled={confirming}>Turn on</button>
            <Message state={confirmState} />
          </form>
        </>
      ) : (
        <form action={start} className="row" style={{ alignItems: "end" }}>
          <span className="muted" style={{ flex: 1, minWidth: 220 }}>Protect your account with a code from your phone in addition to your password.</span>
          {needsPassword && (
            <div style={{ maxWidth: 220 }}>
              <label htmlFor="totp-password">Current password</label>
              <input id="totp-password" name="password" type="password" autoComplete="current-password" required />
            </div>
          )}
          <button disabled={starting}>Set up</button>
          <Message state={startState} />
        </form>
      )}
    </div>
  );
}
