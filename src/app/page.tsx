export default function Home() {
  return (
    <main className="main" style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1>TokenExchange</h1>
      <p>One API key for OpenAI, Anthropic and Gemini models.</p>
      <div className="card mono">
        <div>POST /v1/chat/completions</div>
        <div>POST /v1/responses</div>
        <div>POST /v1/embeddings</div>
        <div>POST /v1/messages</div>
        <div>POST /v1beta/models/&#123;model&#125;:generateContent</div>
        <div>GET&nbsp; /v1/models</div>
      </div>
      <p className="muted">
        <a href="/admin">Admin console</a>
      </p>
    </main>
  );
}
