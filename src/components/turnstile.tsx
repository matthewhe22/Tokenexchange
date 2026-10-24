"use client";

import Script from "next/script";

/** Renders Cloudflare Turnstile when a site key is configured; the token posts as `cf-turnstile-response`. */
export function Turnstile({ siteKey }: { siteKey: string }) {
  if (!siteKey) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <div className="cf-turnstile" data-sitekey={siteKey} />
    </>
  );
}
