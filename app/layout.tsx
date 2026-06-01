export const metadata = { title: "apple-health-mcp", description: "Apple Health data as a remote MCP server for Claude." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
