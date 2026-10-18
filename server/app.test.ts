import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordMatches } from "./app.ts";

const basic = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
test("공용 비밀번호: 아이디는 상관없고 비밀번호만 맞으면 통과", () => {
  assert.equal(passwordMatches(basic("hotori", "pw-1"), "pw-1"), true);
  assert.equal(passwordMatches(basic("x", "pw-2"), "pw-1"), false);
  assert.equal(passwordMatches(undefined, "pw-1"), false);
});
