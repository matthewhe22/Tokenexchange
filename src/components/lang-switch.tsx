"use client";

import { usePathname } from "next/navigation";

export function LangSwitch({ current, label }: { current: "en" | "zh"; label: string }) {
  const path = usePathname() ?? "/";
  const to = current === "zh" ? "en" : "zh";
  return (
    <a href={`/api/lang?to=${to}&back=${encodeURIComponent(path)}`} hrefLang={to} lang={to}>
      {label}
    </a>
  );
}
