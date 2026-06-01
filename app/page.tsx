export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 640, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>apple-health-mcp</h1>
      <p>
        A remote MCP server that exposes Apple Watch / Apple Health data to Claude. The MCP endpoint
        is at <code>/api/mcp</code> (secret required). See the README to self-host.
      </p>
    </main>
  );
}
