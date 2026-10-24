import { ChangePasswordForm } from "@/components/change-password-form";
import { VerifyBanner } from "@/components/verify-banner";
import { requireUser } from "@/lib/session";
import { signOutEverywhere } from "../actions";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <h1>Account</h1>
      {!user.emailVerifiedAt && <VerifyBanner email={user.email} />}
      <div className="card">
        <div><span className="muted">Email:</span> {user.email} {user.emailVerifiedAt && <span className="badge ok">verified</span>}</div>
        <div><span className="muted">Member since:</span> {user.createdAt.toISOString().slice(0, 10)}</div>
      </div>
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
