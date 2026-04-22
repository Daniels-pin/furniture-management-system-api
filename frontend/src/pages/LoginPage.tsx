import { useMemo, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { authApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";

export function LoginPage() {
  const auth = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const location = useLocation() as any;

  const defaultHome = useMemo(() => (auth.role === "finance" ? "/finance" : "/dashboard"), [auth.role]);
  const from = useMemo(() => location?.state?.from?.pathname || defaultHome, [location, defaultHome]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.isAuthed) return <Navigate to={defaultHome} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const res = await authApi.login({ email: email.trim(), password });
      if (!res?.access_token) throw new Error("Missing access token");
      auth.login(res.access_token);
      toast.push("success", "Signed in");
      nav(from, { replace: true });
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      toast.push("error", msg);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-10">
        <div className="w-full">
          <div className="mb-6">
            <div className="text-sm font-medium italic tracking-tight text-black/70">
              No Limits Furniture Nig Ltd
            </div>
            <div className="text-3xl font-bold tracking-tight">Sign in</div>
            <div className="mt-1 text-sm text-black/60">Use your admin-created account.</div>
          </div>

          <Card>
            <>
              <form className="space-y-4" onSubmit={onSubmit}>
                <Input
                  label="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@company.com"
                  required
                />
                <Input
                  label="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete="current-password"
                  required
                />
                {error ? (
                  <div className="rounded-xl border border-black/15 bg-black/[0.02] px-3 py-2 text-sm text-black/70">
                    {error}
                  </div>
                ) : null}
                <Button type="submit" className="w-full" isLoading={isLoading}>
                  Sign in
                </Button>
              </form>
            </>
          </Card>
        </div>
      </div>
    </div>
  );
}

