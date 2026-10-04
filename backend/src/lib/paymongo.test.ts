import assert from "node:assert/strict";
import { createHmac, randomBytes } from "crypto";
import { test } from "node:test";
import { calculateCommissionCents, decryptPayoutAccount, encryptPayoutAccount, verifyPayMongoSignature } from "./paymongo";

test("calculates the configured platform commission in centavos", () => {
  assert.equal(calculateCommissionCents(10000), 500);
  assert.equal(calculateCommissionCents(19999, 250), 500);
  assert.throws(() => calculateCommissionCents(-1));
});

test("verifies PayMongo webhook signatures for the configured key mode", () => {
  const originalKey = process.env.PAYMONGO_SECRET_KEY;
  process.env.PAYMONGO_SECRET_KEY = "sk_test_example";
  const body = Buffer.from('{"data":{"id":"evt_1"}}');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", "webhook-secret").update(`${timestamp}.${body.toString("utf8")}`).digest("hex");
  assert.equal(verifyPayMongoSignature(body, `t=${timestamp},te=${signature}`, "webhook-secret"), true);
  assert.equal(verifyPayMongoSignature(body, `t=${timestamp},te=${signature}`, "wrong-secret"), false);
  if (originalKey === undefined) delete process.env.PAYMONGO_SECRET_KEY;
  else process.env.PAYMONGO_SECRET_KEY = originalKey;
});

test("encrypts payout account data and detects modified ciphertext", () => {
  const originalKey = process.env.PAYOUT_ENCRYPTION_KEY;
  process.env.PAYOUT_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const account = { number: "123456789012", name: "Test Organizer", bic: "BNORPHMM" };
  const encrypted = encryptPayoutAccount(account);
  assert.equal(encrypted.includes(account.number), false);
  assert.deepEqual(decryptPayoutAccount(encrypted), account);
  const [iv, _tag, ciphertext] = encrypted.split(":");
  assert.throws(() => decryptPayoutAccount(`${iv}:${"00".repeat(16)}:${ciphertext}`));
  if (originalKey === undefined) delete process.env.PAYOUT_ENCRYPTION_KEY;
  else process.env.PAYOUT_ENCRYPTION_KEY = originalKey;
});
