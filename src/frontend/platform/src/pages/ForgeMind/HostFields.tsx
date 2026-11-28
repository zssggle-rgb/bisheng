import { Button } from "@bisheng/ui";
import { useTranslation } from "react-i18next";
import type { Host } from "@/controllers/API/forgemind";

export function hostState(host: Host) {
  if (host.retirement) return host.retirement;
  if (!host.seen) return "never";
  if (host.online === null) return "unknown";
  return host.online ? "online" : "offline";
}
export function Seen({ value }: { value: string | null }) {
  const { t, i18n } = useTranslation();
  return <>{value ? new Date(value).toLocaleString(i18n.language) : t("hosts.never")}</>;
}
export function Failure({ retry }: { retry: () => void }) {
  const { t } = useTranslation();
  return <div role="alert" className="flex items-center gap-3 p-4 text-sm">
    {t("hosts.loadFailed")}<Button onClick={retry} variant="outlined">{t("hosts.retry")}</Button>
  </div>;
}
