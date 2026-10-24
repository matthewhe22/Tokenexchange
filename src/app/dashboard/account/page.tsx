import QRCode from "qrcode";
import { ChangePasswordForm } from "@/components/change-password-form";
import { ConfirmTotpForm, DisableTotpForm } from "@/components/totp-forms";
import { VerifyBanner } from "@/components/verify-banner";
import { decrypt } from "@/lib/crypto";
import { formatUsd, MICROS_PER_USD } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { getSecuritySettings } from "@/lib/settings";
import { otpauthUri } from "@/lib/totp";
import { saveLowBalanceAlert, signOutEverywhere, startTotpSetup } from "../actions";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ require2fa?: string }> }) {
  const user = await requireUser();
  const { require2fa } = await searchParams;
  const security = await getSecuritySettings();
  const pendingSecret = user.totpSecret && !user.totpEnabledAt ? decrypt(user.totpSecret) : null;
  const qr = pendingSecret ? await QRCode.toString(otpauthUri(pendingSecret, user.email), { type: "svg", margin: 1, width: 180 }) : null;
  const effectiveThreshold = user.lowBalanceThreshold ?? security.lowBalanceDefault;

  return (
    <>
      <h1>Account</h1>
      {!user.emailVerifiedAt && <VerifyBanner email={user.email} />}
      {require2fa && <div className="notice error">Administrators must turn on two-factor authentication before using the admin console.</div>}
      <div className="card">
        <div><span className="muted">Email:</span> {user.email} {user.emailVerifiedAt && <span className="badge ok">verified</span>}</div>
        <div><span className="muted">Member since:</span> {user.createdAt.toISOString().slice(0, 10)}</div>
      </div>

      <h2>Two-factor authentication</h2>
      <div className="card">
        {user.totpEnabledAt ? (
          <>
            <div><span className="badge ok">on</span> since {user.totpEnabledAt.toISOString().slice(0, 10)}. You will be asked for a code each time you sign in.</div>
            <DisableTotpForm />
          </>
        ) : pendingSecret ? (
          <>
            <p style={{ marginTop: 0 }}>Scan this QR code with an authenticator app (1Password, Google Authenticator, Authy…), then enter the code it shows.</p>
            <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
              <div className="qr" dangerouslySetInnerHTML={{ __html: qr! }} />
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Or enter this key manually:</div>
                <div className="mono" style={{ wordBreak: "break-all", maxWidth: 280 }}>{pendingSecret.replace(/(.{4})/g, "$1 ").trim()}</div>
              </div>
            </div>
            <ConfirmTotpForm />
          </>
        ) : (
          <form action={startTotpSetup} className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Protect your account with a code from your phone in addition to your password.</span>
            <button>Set up</button>
          </form>
        )}
      </div>

      <h2>Low-balance alert</h2>
      <form action={saveLowBalanceAlert} className="card row" style={{ alignItems: "end" }}>
        <div style={{ maxWidth: 260 }}>
          <label htmlFor="threshold">Email me when my balance falls below (USD, 0 = never)</label>
          <input id="threshold" name="threshold" type="number" min={0} step="any" placeholder={String(security.lowBalanceDefault / MICROS_PER_USD)} defaultValue={user.lowBalanceThreshold != null ? user.lowBalanceThreshold / MICROS_PER_USD : ""} />
        </div>
        <button className="secondary">Save</button>
        <span className="muted">Currently: {effectiveThreshold > 0 ? `below ${formatUsd(effectiveThreshold)}` : "off"}</span>
      </form>

      <h2>Change password</h2>
      <ChangePasswordForm />
      <h2>Sessions</h2>
      <form action={signOutEverywhere} className="card row" style={{ justifyContent: "space-between" }}>
        <span className="muted">Signed in on a shared or lost device? Sign out of every browser, including this one.</span>
        <button className="danger">Sign out everywhere</button>
      </form>
    </>
  );
}
