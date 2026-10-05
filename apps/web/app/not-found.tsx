import Link from "next/link";
import { OnyxMark } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="flex flex-col items-center gap-4 text-center">
        <OnyxMark className="size-12" />
        <h1 className="text-xl font-semibold">{t("Nothing here")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("The resource you are looking for does not exist.")}
        </p>
        <Button asChild variant="secondary">
          <Link href="/">{t("Back to the console")}</Link>
        </Button>
      </div>
    </main>
  );
}
