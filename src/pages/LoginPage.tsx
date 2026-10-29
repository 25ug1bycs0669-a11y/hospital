import { useState, type FormEvent } from "react";
import { Activity, ArrowRight, HeartPulse, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../components/UI";

export function LoginPage() {
  const { login, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setLocalError("");
    try { await login(email, password); }
    catch (reason) { setLocalError(reason instanceof Error ? reason.message : "Unable to sign in."); }
    finally { setPending(false); }
  }

  return <main className="login-page">
    <section className="login-art">
      <a className="brand login-brand" href="#"><span className="brand-mark"><HeartPulse size={22} /></span><span className="brand-name">care<span>point</span></span></a>
      <div className="login-art-copy"><span className="art-tag"><Activity size={14} /> HEALTHCARE, CONNECTED</span>
        <h1>Better care starts<br />with a clearer view.</h1>
        <p>One thoughtful workspace for the people who make every patient feel cared for.</p></div>
      <div className="login-art-footer"><ShieldCheck size={16} /> Protected access for your care team</div>
      <div className="art-orb orb-one" /><div className="art-orb orb-two" />
    </section>
    <section className="login-form-side">
      <form className="login-card" onSubmit={submit}>
        <span className="mobile-brand"><span className="brand-mark"><HeartPulse size={20} /></span><b>care<span>point</span></b></span>
        <p className="eyebrow">WELCOME BACK</p><h2>Sign in to your account</h2><p className="login-subtitle">Enter your credentials to access your workspace.</p>
        <label className="form-field"><span>Email address</span><input type="email" autoComplete="username" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@hospital.com" /></label>
        <label className="form-field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" /></label>
        {(localError || error) && <div className="login-error" role="alert">{localError || error}</div>}
        <Button type="submit" className="login-submit" disabled={pending}>{pending ? "Signing in..." : "Sign in"} {!pending && <ArrowRight size={16} />}</Button>
        <p className="login-hint">Ask your hospital administrator for your account credentials.</p>
      </form>
      <footer className="login-legal">CarePoint HMS <span>·</span> Secure clinical workspace</footer>
    </section>
  </main>;
}