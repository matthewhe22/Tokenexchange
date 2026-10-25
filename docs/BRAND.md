# Tenon 榫卯 — brand guide

The customer-facing name is **Tenon** (Chinese: **榫卯**). A tenon is the tongue of a mortise-and-tenon joint,
which holds timber together without glue or nails. That is the product promise: your existing SDK fits every
model, with no glue code.

Tagline: **One API key for every frontier model** / **一个 API Key，调用所有前沿模型**.

## Logo

The mark is a beam whose gold tenon sits inside a post, on a walnut tile.

| Use | File / component |
|---|---|
| In pages | `TenonMark` and `TenonLogo` in `src/components/logo.tsx` (48px and up draws the detailed joint; smaller sizes use a heavier, simplified drawing) |
| Browser tab | `src/app/icon.svg`, `src/app/favicon.ico` (16, 32, 48) |
| iOS home screen | `src/app/apple-icon.png` (180×180, full-bleed; iOS rounds the corners) |
| Link previews | `src/app/opengraph-image.png` (1200×630) |
| Installed web app | `src/app/manifest.ts` |

- The lockup is mark + "Tenon" + "榫卯". The Chinese name can be dropped where space is tight (`<TenonLogo zh={false} />`).
- Keep clear space of at least half the mark's width around the lockup.
- Don't recolour, outline, rotate or add effects to the mark. Its colours are fixed and do not follow the theme.

## Colour

All theme colours are CSS variables in `src/app/globals.css`, with a dark-mode set under
`prefers-color-scheme: dark`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F4F0` 素木 | `#1C1411` | Page background |
| `--panel` | `#FFFFFF` | `#2A1E19` | Cards, header, sidebar |
| `--text` | `#2F211B` 紫檀 | `#F2EBE3` | Body text |
| `--muted` | `#74675E` 柚木 | `#B3A69C` | Secondary text |
| `--border` | `#E6DED4` | `#3D2E27` | Borders, dividers |
| `--accent` | `#E3A857` 黄花梨 | `#E3A857` | Button and chart fills only |
| `--accent-ink` | `#2F211B` | `#2F211B` | Text on `--accent` |
| `--link` | `#8A5A1C` | `#EBBE7A` | Links and coloured text |
| `--brand` | `#2F211B` | `#140E0B` | Brand surfaces (CTA band) |
| `--ok` | `#356B4E` 竹青 | `#7CC59D` | Success, healthy |
| `--danger` | `#B42318` | `#FF8A7A` | Errors, destructive actions |

Gold does not have enough contrast for text on light backgrounds. Use `--accent` only as a fill with
`--accent-ink` on top, and `--link` for coloured text. Every text pairing above meets WCAG AA (4.5:1).

## Type

- Headings and the wordmark: **Fraunces**, loaded with `next/font` (self-hosted at build time, so pages make no
  runtime requests to Google, which matters for visitors in mainland China).
- Body: the system UI font, falling back to PingFang SC / Microsoft YaHei / Noto Sans SC for Chinese.
- Code: the system monospace font.

## Names that stay the same

Renaming these would break existing integrations, so they keep the original project name:

- API key prefix `sk-tx-`
- Error type `tokenexchange_error` and `owned_by: "tokenexchange"` in `/v1/models`
- The npm package name, database names and environment variables
