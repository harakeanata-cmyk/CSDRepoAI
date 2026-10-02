import test from "node:test";
import assert from "node:assert/strict";
import { getPasswordResetRedirectTo } from "./authReset.js";

test("password reset redirects to the current site's login page", () => {
  assert.equal(getPasswordResetRedirectTo("https://csd-repo-ai.vercel.app"), "https://csd-repo-ai.vercel.app/login");
});

test("password reset redirect supports preview origins", () => {
  assert.equal(getPasswordResetRedirectTo("https://preview.example.com/"), "https://preview.example.com/login");
});

test("invalid redirect origins safely fall back to production", () => {
  assert.equal(getPasswordResetRedirectTo("not a url"), "https://csd-repo-ai.vercel.app/login");
});
