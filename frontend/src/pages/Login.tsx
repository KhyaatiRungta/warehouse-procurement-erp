import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { Button, Field } from "../components/ui";

const DEMO = [
  { label: "Admin", email: "admin@erp.test", password: "admin1234", note: "Approves purchase orders, full access" },
  { label: "Buyer", email: "buyer@erp.test", password: "buyer1234", note: "Suppliers, POs, approves requisitions" },
  { label: "Warehouse clerk", email: "clerk@erp.test", password: "clerk1234", note: "Receives goods and posts stock" },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={(location.state as { from?: string } | null)?.from ?? "/"} replace />;

  const validate = () => {
    const next: typeof errors = {};
    if (!email.trim()) next.email = "Enter your work email";
    else if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) next.email = "This does not look like an email address";
    if (!password) next.password = "Enter your password";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate((location.state as { from?: string } | null)?.from ?? "/", { replace: true });
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login-story">
        <div className="login-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="40" height="40">
            <rect width="32" height="32" rx="6" fill="#24523F" />
            <path d="M7 9h18M7 16h12M7 23h18" stroke="#BFE3CF" strokeWidth="2.6" strokeLinecap="round" />
            <circle cx="23" cy="16" r="2.6" fill="#E3B65C" />
          </svg>
        </div>
        <h1>Depot ERP</h1>
        <p className="login-lede">
          Requisitions become purchase orders. Goods receipts post to stock in one transaction, and every change is
          written to the audit log.
        </p>
        <ol className="login-flow" aria-label="Procurement flow">
          <li><span>Requisition</span> raised, approved, converted</li>
          <li><span>Purchase order</span> submitted, approved, sent</li>
          <li><span>Goods receipt</span> checked against the order</li>
          <li><span>Stock ledger</span> updated with a running balance</li>
        </ol>
      </section>

      <section className="login-card">
        <form onSubmit={submit} noValidate className="login-form">
          <h2>Sign in</h2>
          <Field label="Email" error={errors.email}>
            {(id) => (
              <input id={id} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </Field>
          <Field label="Password" error={errors.password}>
            {(id) => (
              <input id={id} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
          </Field>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <Button variant="primary" type="submit" disabled={busy} className="btn-block">
            {busy ? "Signing in" : "Sign in"}
          </Button>
        </form>

        <div className="demo-accounts">
          <p className="demo-title">Demo accounts</p>
          <p className="demo-note">Fictional accounts for evaluation. Each fills the form; you still press sign in.</p>
          <ul>
            {DEMO.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  className="demo-pick"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(account.password);
                    setErrors({});
                    setFormError(null);
                  }}
                >
                  <span className="demo-label">{account.label}</span>
                  <span className="mono">{account.email}</span>
                  <span className="demo-desc">{account.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
