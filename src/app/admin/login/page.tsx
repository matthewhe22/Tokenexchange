import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="main" style={{ maxWidth: 360, margin: "10vh auto" }}>
      <h1>Admin sign in</h1>
      <div className="card">
        <LoginForm />
      </div>
    </main>
  );
}
