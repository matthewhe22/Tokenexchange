import { Playground } from "@/components/playground";
import { VerifyBanner } from "@/components/verify-banner";
import { getPrices } from "@/lib/billing";
import { requireUser } from "@/lib/session";

export default async function PlaygroundPage() {
  const user = await requireUser();
  const models = [...(await getPrices()).values()]
    .filter((p) => p.enabled && !/embed|rerank|whisper|tts|transcribe|dall-e|image/i.test(p.model))
    .map((p) => p.model)
    .sort();
  return (
    <>
      <h1>Playground</h1>
      {!user.emailVerifiedAt && <VerifyBanner email={user.email} />}
      <Playground models={models} />
    </>
  );
}
