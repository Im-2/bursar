// Starts the "bursar" server exactly as the repo-root .mcp.json describes (same command, args, env, cwd = repo
// root), over stdio with the official MCP client, the way Claude Code does. Lists the tools and runs the two
// read-only ones. Sends no transactions. Usage (from the repo root): node agent-mcp/scripts/check-server.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cfg = JSON.parse(readFileSync(new URL("../../.mcp.json", import.meta.url), "utf8")).mcpServers.bursar;
console.log(`.mcp.json -> ${cfg.command} ${cfg.args.join(" ")}  (env keys: ${Object.keys(cfg.env ?? {}).join(", ") || "none"})`);

const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args, env: { ...process.env, ...cfg.env }, cwd: root, stderr: "pipe" });
let stderr = "";
transport.stderr?.on("data", (d) => (stderr += d));
const client = new Client({ name: "bursar-check", version: "1.0.0" });
const t0 = Date.now();
await client.connect(transport);
console.log(`connected in ${Date.now() - t0} ms; server: ${JSON.stringify(client.getServerVersion())}`);
const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);
for (const name of ["get_policy_and_budget", "list_vendors"]) {
  const r = await client.callTool({ name, arguments: {} });
  console.log(`\n--- ${name}${r.isError ? " (ERROR)" : ""}\n${r.content.map((c) => c.text ?? "").join("\n")}`);
}
await client.close();
console.log(`\nserver stderr:\n${stderr.trim() || "(empty)"}`);
