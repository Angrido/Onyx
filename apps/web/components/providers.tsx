"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { ApiRequestError } from "@/lib/api/client";
import { I18nProvider } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/core";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) =>
          !(error instanceof ApiRequestError && error.status < 500) && failureCount < 2,
      },
    },
  });
}

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <I18nProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{ className: "glass border border-border text-foreground" }}
        />
      </QueryClientProvider>
    </I18nProvider>
  );
}
