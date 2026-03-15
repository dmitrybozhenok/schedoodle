import { describe, expect, it } from "vitest";
import { isPrivateUrl } from "../src/services/prefetch.js";

describe("isPrivateUrl", () => {
	describe("blocks private IPv4 ranges", () => {
		it("blocks 127.0.0.0/8 (loopback)", () => {
			expect(isPrivateUrl("http://127.0.0.1/path")).toBe(true);
			expect(isPrivateUrl("http://127.255.255.255/path")).toBe(true);
		});

		it("blocks 10.0.0.0/8 (private)", () => {
			expect(isPrivateUrl("http://10.0.0.1/path")).toBe(true);
			expect(isPrivateUrl("http://10.255.255.255/path")).toBe(true);
		});

		it("blocks 172.16.0.0/12 (private)", () => {
			expect(isPrivateUrl("http://172.16.0.1/path")).toBe(true);
			expect(isPrivateUrl("http://172.31.255.255/path")).toBe(true);
		});

		it("allows 172.15.0.1 (outside 172.16-31 range)", () => {
			expect(isPrivateUrl("http://172.15.0.1/path")).toBe(false);
		});

		it("blocks 192.168.0.0/16 (private)", () => {
			expect(isPrivateUrl("http://192.168.1.1/path")).toBe(true);
			expect(isPrivateUrl("http://192.168.255.255/path")).toBe(true);
		});

		it("blocks 169.254.0.0/16 (link-local)", () => {
			expect(isPrivateUrl("http://169.254.0.1/path")).toBe(true);
			expect(isPrivateUrl("http://169.254.169.254/path")).toBe(true);
		});

		it("blocks 0.0.0.0/8", () => {
			expect(isPrivateUrl("http://0.0.0.0/path")).toBe(true);
		});
	});

	describe("blocks IPv6 loopback", () => {
		it("blocks [::1]", () => {
			expect(isPrivateUrl("http://[::1]/path")).toBe(true);
		});
	});

	describe("blocks localhost", () => {
		it("blocks localhost hostname", () => {
			expect(isPrivateUrl("http://localhost/path")).toBe(true);
		});
	});

	describe("blocks non-HTTP protocols", () => {
		it("blocks ftp://", () => {
			expect(isPrivateUrl("ftp://example.com/path")).toBe(true);
		});

		it("blocks file://", () => {
			expect(isPrivateUrl("file:///etc/passwd")).toBe(true);
		});
	});

	describe("blocks malformed URLs", () => {
		it("blocks non-URL strings", () => {
			expect(isPrivateUrl("not-a-url")).toBe(true);
		});

		it("blocks empty string", () => {
			expect(isPrivateUrl("")).toBe(true);
		});
	});

	describe("allows public URLs", () => {
		it("allows http://example.com", () => {
			expect(isPrivateUrl("http://example.com/path")).toBe(false);
		});

		it("allows https://example.com", () => {
			expect(isPrivateUrl("https://example.com/path")).toBe(false);
		});

		it("allows public IP addresses", () => {
			expect(isPrivateUrl("http://8.8.8.8/path")).toBe(false);
		});
	});
});
