import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb, schema } from "@/db";
import { ChannelForm } from "@/components/channel-form";
import { ChannelTest } from "@/components/channel-test";
import { decrypt } from "@/lib/crypto";
import { deleteChannel, saveChannel } from "../../../actions";

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c] = await getDb().select().from(schema.channels).where(eq(schema.channels.id, Number(id)));
  if (!c) notFound();

  let stored: string[] = [];
  try {
    stored = Object.keys(JSON.parse(decrypt(c.credentials)));
  } catch {
    // undecryptable (ENCRYPTION_KEY changed): admin must re-enter credentials
  }

  return (
    <>
      <h1>{c.name}</h1>
      {c.lastError && (
        <div className="notice mono">
          Last error {c.lastErrorAt?.toISOString()}: {c.lastError}
        </div>
      )}
      <h2>Test</h2>
      <ChannelTest id={c.id} models={c.models} />
      <h2>Edit</h2>
      <ChannelForm
        action={saveChannel}
        value={{
          id: c.id,
          name: c.name,
          provider: c.provider,
          source: c.source,
          baseUrl: c.baseUrl ?? "",
          config: c.config,
          models: c.models,
          modelMapping: c.modelMapping,
          priority: c.priority,
          weight: c.weight,
          costMultiplier: c.costMultiplier,
          enabled: c.enabled,
          storedCredentials: stored,
        }}
      />
      <form action={deleteChannel}>
        <input type="hidden" name="id" value={c.id} />
        <button className="danger">Delete channel</button>
      </form>
    </>
  );
}
