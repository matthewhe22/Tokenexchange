import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { GuidePage, guideMetadata } from "@/components/guide-page";
import { perMillion, publicPriceList } from "@/lib/catalog";
import { servedModels } from "@/lib/channels";
import { appUrl } from "@/lib/url";

export const metadata = guideMetadata("claude-code");

export default async function ClaudeCodeGuide() {
  const base = appUrl();
  const [prices, served] = await Promise.all([publicPriceList(), servedModels()]);
  // Claude Code speaks the Anthropic Messages API, so only models served through it work.
  const models = prices.filter((p) => served.byApi.anthropic.has(p.model));
  const main = models.find((p) => /^claude-.*sonnet/.test(p.model)) ?? models[0];
  const small = models.find((p) => /^claude-.*haiku/.test(p.model)) ?? main;
  const mainName = main?.model ?? "claude-sonnet-4-5";
  const smallName = small?.model ?? "claude-haiku-4-5";

  return (
    <GuidePage slug="claude-code">
      <p>
        Claude Code talks to the Anthropic Messages API, and lets you change where that API lives. Point it at Tenon and it runs
        on your Tenon balance, with the models you choose, and every request shows up in your usage history.
      </p>

      <h2>1. Get a key</h2>
      <p>
        <Link href="/signup">Create an account</Link>, add credit on the <Link href="/dashboard/billing">Billing</Link> page and
        create a key on the <Link href="/dashboard/keys">API keys</Link> page. A dedicated key for Claude Code, with a spending
        limit, makes its cost easy to follow and cap.
      </p>

      <h2>2. Point Claude Code at Tenon</h2>
      <p>Set two environment variables and start Claude Code as usual:</p>
      <CodeBlock label="bash" code={`export ANTHROPIC_BASE_URL=${base}
export ANTHROPIC_AUTH_TOKEN=sk-tx-...
claude`} />
      <p>
        <code>ANTHROPIC_AUTH_TOKEN</code> is sent as a bearer token, which Tenon accepts on <code>/v1/messages</code>. Inside
        Claude Code, <code>/status</code> shows the base URL it is using.
      </p>

      <h2>3. Choose the models</h2>
      <p>
        Claude Code uses a main model for the conversation and a small, fast one for background work. Set either to any model
        Tenon serves through the Anthropic API:
      </p>
      <CodeBlock label="bash" code={`export ANTHROPIC_MODEL=${mainName}
export ANTHROPIC_DEFAULT_HAIKU_MODEL=${smallName}`} />
      {models.length > 0 && (
        <>
          <p>Models available to Claude Code right now (USD per 1M tokens, input / output):</p>
          <div className="card scroll">
            <table>
              <thead><tr><th>Model</th><th>Price</th></tr></thead>
              <tbody>
                {models.slice(0, 12).map((p) => (
                  <tr key={p.model}>
                    <td className="mono">{p.model}</td>
                    <td>{perMillion(p.input)} / {perMillion(p.output)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p>
        Prices for every model are on the <Link href="/pricing">pricing page</Link>. Coding sessions send long contexts, so the
        input price matters most; models with cached-input pricing are cheaper again on repeated context.
      </p>

      <h2>4. Make it permanent</h2>
      <p>
        Rather than exporting variables in every shell, put them in <code>~/.claude/settings.json</code> (for you) or{" "}
        <code>.claude/settings.json</code> in a project (for everyone working on it, without the key):
      </p>
      <CodeBlock label="~/.claude/settings.json" code={`{
  "env": {
    "ANTHROPIC_BASE_URL": "${base}",
    "ANTHROPIC_AUTH_TOKEN": "sk-tx-...",
    "ANTHROPIC_MODEL": "${mainName}",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "${smallName}"
  }
}`} />
      <p className="muted">Never commit a key. In a shared project file, leave <code>ANTHROPIC_AUTH_TOKEN</code> out and let each person set it.</p>

      <h2>Troubleshooting</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Error</th><th>What to check</th></tr></thead>
          <tbody>
            <tr><td>401</td><td>The key is wrong, disabled or expired, or <code>ANTHROPIC_AUTH_TOKEN</code> is not set in this shell.</td></tr>
            <tr><td>402</td><td>Your balance is used up, or the key reached its spending limit.</td></tr>
            <tr><td>403</td><td>The key is restricted to other models. Allow the model on the key, or pick another.</td></tr>
            <tr><td>404</td><td>Unknown model name. Copy it exactly from the pricing page.</td></tr>
            <tr><td>503</td><td>The model isn&apos;t available through the Anthropic API right now. Choose one from the list above.</td></tr>
          </tbody>
        </table>
      </div>
      <p>Using Codex CLI or another coding tool instead? The <Link href="/docs#tools">docs</Link> cover those too.</p>
    </GuidePage>
  );
}
