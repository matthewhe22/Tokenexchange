import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import { getLocale } from "@/lib/i18n";
import { appUrl } from "@/lib/url";
import "./globals.css";

// Display face for headings and the wordmark. next/font self-hosts it, so pages never call Google at runtime.
const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: "Tenon · One API key for every frontier model", template: "%s · Tenon" },
  description: "Tenon is a unified API gateway for OpenAI, Anthropic and Gemini models, billed per token.",
  applicationName: "Tenon",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F4F0" },
    { media: "(prefers-color-scheme: dark)", color: "#1C1411" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"} className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
