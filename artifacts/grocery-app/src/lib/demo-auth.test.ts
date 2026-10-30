import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mobileError,
  emailError,
  otpError,
  OTP_LIFETIME_MS,
} from "./demo-auth";

test("demo email validation accepts addresses and rejects missing or malformed addresses", () => {
  for (const value of ["you@example.com", " name+pantry@example.co.in "])
    assert.equal(emailError(value), "");
  for (const value of [
    "",
    "you",
    "you@",
    "@example.com",
    "you@example",
    "you name@example.com",
    "you@@example.com",
  ])
    assert.ok(emailError(value));
});

test("demo mobile validation accepts ten digits and rejects country codes and spaces", () => {
  assert.equal(mobileError("9876543210"), "");
  for (const value of [
    "",
    "123",
    "+919876543210",
    "98765 43210",
    "abcdefghij",
  ]) {
    assert.ok(mobileError(value));
  }
});

test("demo OTP validation rejects incomplete, incorrect, expired and consumed codes", () => {
  const now = 1000;
  const expires = now + OTP_LIFETIME_MS;
  assert.equal(otpError("123456", expires, now), "");
  assert.match(otpError("", expires, now), /Enter/);
  assert.match(otpError("123", expires, now), /6-digit/);
  assert.match(otpError("654321", expires, now), /does not match/);
  assert.match(otpError("123456", expires, expires), /expired/);
  assert.match(otpError("123456", 0, now), /expired/);
});
