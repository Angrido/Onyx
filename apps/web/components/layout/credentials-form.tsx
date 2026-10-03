"use client";

import type { MeResponse } from "@onyx/contracts";
import { Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";

export function CredentialsForm({ mode }: { mode: "login" | "setup" }) {
  const router = useRouter();
  const [username, setUsername] = useState(mode === "setup" ? "admin" : "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post<MeResponse>(mode === "login" ? "/api/auth/login" : "/api/auth/setup", {
        username,
        password,
      });
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
      setPending(false);
    }
  }

  return (
    <motion.div initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base">
            {mode === "login" ? "Sign in" : "Create the operator account"}
          </CardTitle>
          <CardDescription>
            {mode === "login"
              ? "Access the Onyx control panel."
              : "This account controls every agent running in this container."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Username" htmlFor="username">
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </Field>
            <Field
              label="Password"
              htmlFor="password"
              {...(mode === "setup" ? { hint: "At least 12 characters." } : {})}
            >
              <Input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={mode === "setup" ? 12 : 1}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>
            {error ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
