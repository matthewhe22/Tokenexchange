import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TokenExchange",
  description: "Unified API gateway for OpenAI, Anthropic and Gemini models",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
