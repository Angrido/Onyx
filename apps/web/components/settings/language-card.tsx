"use client";

import { Languages } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form-controls";
import { useLocale, useSwitchLocale, useT } from "@/lib/i18n/client";
import { LOCALE_NAMES, LOCALES, parseLocale } from "@/lib/i18n/core";

export function LanguageCard() {
  const t = useT();
  const locale = useLocale();
  const switchLocale = useSwitchLocale();
  return (
    <Card id="language" data-testid="language-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="size-4 text-primary" />
          {t("Language")}
        </CardTitle>
        <CardDescription>
          {t(
            "Onyx shows its screens and messages in this language on this browser. What Claude writes, such as plans and answers, is not translated.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field label={t("Interface language")} htmlFor="interface-language">
          <Select
            id="interface-language"
            value={locale}
            onChange={(event) => {
              switchLocale(parseLocale(event.target.value));
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
