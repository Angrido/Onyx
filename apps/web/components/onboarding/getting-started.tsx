"use client";

import { ArrowRight, CircleCheck, CircleDashed, Rocket } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/lib/i18n/client";
import { onboardingDone, type OnboardingStep } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

const HIDDEN_KEY = "onyx.onboarding.hidden";

export function GettingStarted({ steps }: { steps: OnboardingStep[] }) {
  const t = useT();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setHidden(localStorage.getItem(HIDDEN_KEY) === "1"), 0);
    return () => clearTimeout(timer);
  }, []);
  if (hidden || onboardingDone(steps)) return null;
  const next = steps.find((step) => !step.done);
  const done = steps.filter((step) => step.done).length;
  return (
    <Card data-testid="getting-started">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="size-4 text-primary" />
          {t("Get started")}
        </CardTitle>
        <CardDescription>
          {t("{done} of {total} steps done. Each step links to the page where you do it.", {
            done,
            total: steps.length,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-3">
          {steps.map((step) => (
            <li
              key={step.id}
              className={cn(
                "flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center",
                step.id === next?.id ? "border-primary/50 bg-primary/5" : "border-border",
              )}
              data-testid="onboarding-step"
              data-done={step.done}
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {step.done ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <CircleDashed
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      step.done && "text-muted-foreground line-through",
                    )}
                  >
                    <span className="sr-only">{step.done ? t("Done:") : t("To do:")} </span>
                    {t(step.title)}
                  </p>
                  <p className="text-sm text-muted-foreground">{t(step.description)}</p>
                </div>
              </div>
              {!step.done ? (
                <Button asChild size="sm" variant={step.id === next?.id ? "default" : "secondary"}>
                  <Link href={step.href}>
                    {t(step.action)}
                    <ArrowRight />
                  </Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            localStorage.setItem(HIDDEN_KEY, "1");
            setHidden(true);
          }}
        >
          {t("Hide this guide")}
        </Button>
      </CardContent>
    </Card>
  );
}
