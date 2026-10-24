import QRCode from "qrcode";
import { ChangePasswordForm } from "@/components/change-password-form";
import { TotpPanel } from "@/components/totp-forms";
import { VerifyBanner } from "@/components/verify-banner";
import { decrypt } from "@/lib/crypto";
import { formatUsd, MICROS_PER_USD } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { getSecuritySettings } from "@/lib/settings";
import { otpauthUri } from "@/lib/totp";
import { saveLowBalanceAlert, signOutEverywhere } from "../actions";
import { formatDate } from "@/lib/time";

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
        <div><span className="muted">Member since:</span> {formatDate(user.createdAt)}</div>
      </div>

      <h2>Two-factor authentication</h2>
      <TotpPanel
        enabledSince={user.totpEnabledAt ? formatDate(user.totpEnabledAt) : null}
        recoveryLeft={user.totpRecoveryCodes?.length ?? 0}
        pending={pendingSecret && qr ? { secret: pendingSecret, qrSvg: qr } : null}
        needsPassword={!!user.passwordHash}
      />

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
