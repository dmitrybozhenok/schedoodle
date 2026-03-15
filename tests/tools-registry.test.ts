import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.js", () => ({
	env: {
		DATABASE_URL: "./data/schedoodle.db",
		LLM_PROVIDER: "anthropic",
		ANTHROPIC_API_KEY: "test-key",
		OLLAMA_BASE_URL: "http://127.0.0.1:11434/api",
		PORT: 3000,
		BRAVE_API_KEY: "test-brave-key",
	},
}));

import { buildToolSet } from "../src/services/tools/registry.js";
import type { Tool } from "../src/types/index.js";

function makeTool(overrides: Partial<Tool> = {}): Tool {
	return {
		id: 1,
		name: "Custom Hook",
		description: "A custom webhook",
		url: "https://api.example.com/hook",
		method: "POST",
		headers: null,
		inputSchema: {
			type: "object",
			properties: {
				data: { type: "string" },
			},
		},
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

describe("buildToolSet", () => {
	it("returns web_fetch and web_search when no custom tools provided", () => {
		const toolSet = buildToolSet();

		expect(toolSet).toHaveProperty("web_fetch");
		expect(toolSet).toHaveProperty("web_search");
		expect(Object.keys(toolSet)).toHaveLength(2);
	});

	it("returns built-in + custom tools keyed by prefixed tool name", () => {
		const customTool = makeTool({ name: "My API" });
		const toolSet = buildToolSet([customTool]);

		expect(toolSet).toHaveProperty("web_fetch");
		expect(toolSet).toHaveProperty("web_search");
		expect(toolSet).toHaveProperty("custom_my_api");
		expect(Object.keys(toolSet)).toHaveLength(3);
	});

	it("handles multiple custom tools", () => {
		const tool1 = makeTool({ id: 1, name: "Tool One" });
		const tool2 = makeTool({ id: 2, name: "Tool Two" });
		const toolSet = buildToolSet([tool1, tool2]);

		expect(Object.keys(toolSet)).toHaveLength(4);
		expect(toolSet).toHaveProperty("custom_tool_one");
		expect(toolSet).toHaveProperty("custom_tool_two");
	});

	it("does not override built-in tools with custom tools of the same name", () => {
		// A custom tool named "web_fetch" should get prefixed, not override the built-in
		const customTool = makeTool({ name: "web_fetch" });
		const toolSet = buildToolSet([customTool]);

		expect(toolSet).toHaveProperty("web_fetch");
		expect(toolSet).toHaveProperty("custom_web_fetch");
		// The built-in web_fetch should still have its original description
		expect(toolSet.web_fetch.description).toContain("Fetch content from a URL");
	});

	it("normalizes custom tool names (lowercase, spaces to underscores)", () => {
		const customTool = makeTool({ name: "My Special Tool" });
		const toolSet = buildToolSet([customTool]);

		expect(toolSet).toHaveProperty("custom_my_special_tool");
	});

	it("returns empty custom tools when passed empty array", () => {
		const toolSet = buildToolSet([]);

		expect(Object.keys(toolSet)).toHaveLength(2);
		expect(toolSet).toHaveProperty("web_fetch");
		expect(toolSet).toHaveProperty("web_search");
	});
});
