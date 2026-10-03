import type { ReactNode } from "react";
import { Wordmark } from "@/components/layout/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex justify-center">
          <Wordmark />
        </div>
        {children}
      </div>
    </main>
  );
}
