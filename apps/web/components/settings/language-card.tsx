"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form-controls";
import { storeLocale, useLocale, useT } from "@/lib/i18n/client";
import { LOCALE_NAMES, LOCALES, parseLocale } from "@/lib/i18n/core";

export function LanguageCard() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  return (
    <Card id="language" data-testid="language-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="size-4 text-primary" />
          {t("Language")}
        </CardTitle>
        <CardDescription>
          {t(
            "Onyx shows its screens in this language on this browser. Texts produced by the server, such as plan messages and Savings details, stay in English.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field label={t("Interface language")} htmlFor="interface-language">
          <Select
            id="interface-language"
            value={locale}
            onChange={(event) => {
              storeLocale(parseLocale(event.target.value));
              router.refresh();
            }}
          >
            {LOCALES.map((entry) => (
              <option key={entry} value={entry} lang={entry}>
                {LOCALE_NAMES[entry]}
              </option>
            ))}
          </Select>
        </Field>
      </CardContent>
    </Card>
  );
}
