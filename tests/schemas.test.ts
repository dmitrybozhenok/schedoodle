import { describe, expect, it } from "vitest";
import { type AgentOutput, agentOutputSchema } from "../src/schemas/agent-output.js";

describe("agentOutputSchema", () => {
	it("parses valid { summary, details } successfully", () => {
		const result = agentOutputSchema.safeParse({
			summary: "x",
			details: "y",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.summary).toBe("x");
			expect(result.data.details).toBe("y");
		}
	});

	it("parses valid { summary, details, data } with optional data", () => {
		const result = agentOutputSchema.safeParse({
			summary: "x",
			details: "y",
			data: { foo: 1 },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.data).toEqual({ foo: 1 });
		}
	});

	it("rejects missing summary", () => {
		const result = agentOutputSchema.safeParse({ details: "y" });
		expect(result.success).toBe(false);
	});

	it("rejects missing details", () => {
		const result = agentOutputSchema.safeParse({ summary: "x" });
		expect(result.success).toBe(false);
	});

	it("AgentOutput type is inferred correctly", () => {
		const output: AgentOutput = {
			summary: "s",
			details: "d",
		};
		// compile-time check: satisfies ensures type compatibility
		output satisfies { summary: string; details: string; data?: unknown };
		expect(output).toBeDefined();
	});
});
