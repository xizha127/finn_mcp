import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP stdio exposes schemas, validates input, and returns search counts", { timeout: 15000 }, async () => {
  const setup = `import { readFileSync } from "node:fs";
    globalThis.fetch = async (url) => new Response(readFileSync(
      String(url).includes("/ad.html") ? "test/fixtures/eiendom-detail.html" : "test/fixtures/search.html", "utf8"));`;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", `data:text/javascript,${encodeURIComponent(setup)}`, "src/server.js"],
    stderr: "pipe",
  });
  const client = new Client({ name: "compatibility-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 12);
    const search = tools.find((tool) => tool.name === "search_finn_torget");
    assert.ok(tools.some((tool) => tool.name === "search_finn_eiendom"));
    const detail = tools.find((tool) => tool.name === "get_finn_eiendom_item");
    assert.equal(detail.annotations.readOnlyHint, true);
    const property = await client.callTool({ name: detail.name, arguments: { finn_code: "123456789" } });
    assert.ok(!property.isError);
    assert.equal(JSON.parse(property.content[0].text).status, "active");
    const invalidCode = await client.callTool({ name: detail.name, arguments: { finn_code: "../../other" } });
    assert.equal(invalidCode.isError, true);
    assert.equal(search.inputSchema.properties.shipping.type, "boolean");
    assert.equal(search.inputSchema.properties.condition.type, "array");
    const result = await client.callTool({
      name: search.name,
      arguments: { query: "jakke", price_to: 1500, condition: ["2", "3"], shipping: true },
    });
    assert.ok(!result.isError);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.total_results, 3917);
    assert.equal(data.results_on_page, 53);
    assert.equal(data.total_pages, 50);
    const url = new URL(data.search_url);
    assert.equal(url.searchParams.get("price_to"), "1500");
    assert.deepEqual(url.searchParams.getAll("condition"), ["2", "3"]);
    const invalid = await client.callTool({ name: search.name, arguments: { sort: "invalid" } });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
  }
});
