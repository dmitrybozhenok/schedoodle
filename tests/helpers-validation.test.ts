import { describe, expect, it, vi } from "vitest";
import { parseId, zodErrorHook } from "../src/helpers/validation.js";

describe("zodErrorHook", () => {
	it("returns undefined on success", () => {
		const c = { json: vi.fn() };
		const result = zodErrorHook({ success: true }, c);
		expect(result).toBeUndefined();
		expect(c.json).not.toHaveBeenCalled();
	});

	it("returns 400 with field/message on single issue", () => {
		const c = {
			json: vi.fn((data: unknown, status: number) => ({ data, status }) as unknown as Response),
		};
		const result = zodErrorHook(
			{
				success: false,
				error: {
					issues: [{ path: ["name"], message: "Required" }],
				},
			},
			c,
		);
		expect(c.json).toHaveBeenCalledWith(
			{
				error: "Validation failed",
				details: [{ field: "name", message: "Required" }],
			},
			400,
		);
		expect(result).toBeDefined();
	});

	it("joins nested path with dots", () => {
		const c = {
			json: vi.fn((data: unknown, status: number) => ({ data, status }) as unknown as Response),
		};
		zodErrorHook(
			{
				success: false,
				error: {
					issues: [{ path: ["nested", "field"], message: "Too short" }],
				},
			},
			c,
		);
		expect(c.json).toHaveBeenCalledWith(
			{
				error: "Validation failed",
				details: [{ field: "nested.field", message: "Too short" }],
			},
			400,
		);
	});
});

describe("parseId", () => {
	it("returns number for valid integer string", () => {
		expect(parseId("42")).toBe(42);
	});

	it("returns null for float", () => {
		expect(parseId("4.5")).toBeNull();
	});

	it("returns null for non-numeric string", () => {
		expect(parseId("abc")).toBeNull();
	});

	it("returns -1 for negative integer", () => {
		expect(parseId("-1")).toBe(-1);
	});
});
