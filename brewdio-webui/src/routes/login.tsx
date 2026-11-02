import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setToken, getAuthBaseUrl } from "@/lib/auth";
import { startSync } from "@/lib/sync";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/login")({
  component: LoginComponent,
});

function LoginComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const baseUrl = getAuthBaseUrl();
    const endpoint = mode === "login" ? "/auth/login" : "/auth/register";

    try {
      const resp = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        setError(
          mode === "login"
            ? t("auth.errors.loginFailed")
            : t("auth.errors.registerFailed")
        );
        return;
      }

      setToken(data.token);
      const serverUrl = localStorage.getItem("brewdio_server");
      if (serverUrl) {
        await startSync(serverUrl);
      }
      navigate({ to: "/settings" });
    } catch {
      setError(t("auth.errors.connectionFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 border rounded-lg p-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">brewdio</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "login" ? t("auth.loginDescription") : t("auth.registerDescription")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? t("auth.passwordPlaceholder") : ""}
              required
              minLength={mode === "register" ? 8 : undefined}
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("auth.working") : mode === "login" ? t("auth.signIn") : t("auth.createAccount")}
          </Button>
        </form>

        <div className="text-center text-sm">
          {mode === "login" ? (
            <p>
              {t("auth.noAccount")}{" "}
              <button
                type="button"
                className="underline text-primary"
                onClick={() => { setMode("register"); setError(""); }}
              >
                {t("auth.signUp")}
              </button>
            </p>
          ) : (
            <p>
              {t("auth.hasAccount")}{" "}
              <button
                type="button"
                className="underline text-primary"
                onClick={() => { setMode("login"); setError(""); }}
              >
                {t("auth.signIn")}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
