// Calls one tool on the Bursar MCP server over stdio with the official MCP client, prints the result, and
// (optionally) appends the exchange to a transcript file. Lets any MCP-speaking agent, or a person, drive the
// server without Claude Code. The server reads the agent key from the gitignored .env; this script never sees it.
// Usage (from the repo root):
//   node agent-mcp/scripts/call-tool.mjs <tool> '<json args>' [transcript.jsonl]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [tool, rawArgs = "{}", transcript] = process.argv.slice(2);
if (!tool) {
  console.error("usage: node agent-mcp/scripts/call-tool.mjs <tool> '<json args>' [transcript.jsonl]");
  process.exit(2);
}
const args = JSON.parse(rawArgs);
const root = fileURLToPath(new URL("../../", import.meta.url));
const transport = new StdioClientTransport({
  command: "node",
  args: ["agent-mcp/node_modules/tsx/dist/cli.mjs", "agent-mcp/src/server.ts"],
  cwd: root,
  stderr: "pipe",
});
let stderr = "";
transport.stderr?.on("data", (d) => (stderr += d));
const client = new Client({ name: "bursar-call-tool", version: "1.0.0" });
try {
  await client.connect(transport);
  const result = await client.callTool({ name: tool, arguments: args });
  const text = result.content.map((c) => c.text ?? "").join("\n");
  console.log(text);
  if (transcript) appendFileSync(transcript, JSON.stringify({ at: new Date().toISOString(), tool, args, result: text }) + "\n");
} catch (e) {
  console.error(`call failed: ${e.message}\n${stderr}`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
