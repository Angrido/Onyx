"use client";

import type { GitIdentityDto } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCommitHorizontal, Loader2, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";

export function GitIdentityCard({ initial }: { initial: GitIdentityDto }) {
  const t = useT();
  const queryClient = useQueryClient();
  const identity = useQuery({
    queryKey: queryKeys.gitIdentity,
    queryFn: () => api.get<GitIdentityDto>("/api/settings/git"),
    initialData: initial,
  });
  const [name, setName] = useState(initial.name ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const save = useMutation({
    mutationFn: () =>
      api.put<GitIdentityDto>("/api/settings/git", {
        name: name.trim() || null,
        email: email.trim() || null,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.gitIdentity, next);
      toast.success(t("Commit author saved"));
    },
    onError: (error) => toast.error(errorMessage(error, t)),
  });

  return (
    <Card id="git-identity">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCommitHorizontal className="size-4 text-primary" />
          {t("Commit author")}
        </CardTitle>
        <CardDescription>
          {t(
            "Commits Onyx creates before pushing a branch use this name and email. Left empty, they use your GitHub account and its noreply address.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("Name")} htmlFor="git-name">
              <Input
                id="git-name"
                placeholder={identity.data.effectiveName}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label={t("Email")} htmlFor="git-email">
              <Input
                id="git-email"
                type="email"
                placeholder={identity.data.effectiveEmail}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" variant="secondary" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {t("Save")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t("Current: {name} <{email}>", {
                name: identity.data.effectiveName,
                email: identity.data.effectiveEmail,
              })}
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
