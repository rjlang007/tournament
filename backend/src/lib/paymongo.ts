import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "crypto";

const PAYMONGO_API_URL = "https://api.paymongo.com";

type PayMongoError = { errors?: { detail?: string }[] };

export function isPayMongoConfigured() {
  return !!process.env.PAYMONGO_SECRET_KEY;
}

export function calculateCommissionCents(grossAmountCents: number, commissionBps = 500) {
  if (!Number.isSafeInteger(grossAmountCents) || grossAmountCents < 0
    || !Number.isSafeInteger(commissionBps) || commissionBps < 0 || commissionBps > 10000) {
    throw new Error("Invalid amount or platform commission.");
  }
  return Math.round((grossAmountCents * commissionBps) / 10000);
}

export function verifyPayMongoSignature(rawBody: Buffer, signatureHeader: string | undefined, webhookSecret: string) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => {
    const separator = part.indexOf("=");
    return separator < 0 ? [part, ""] : [part.slice(0, separator), part.slice(separator + 1)];
  }));
  const timestamp = parts.t;
  const mode = process.env.PAYMONGO_SECRET_KEY?.startsWith("sk_live_") ? "li" : "te";
  const provided = parts[mode];
  if (!timestamp || !provided || !/^\d+$/.test(timestamp)) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;
  const expected = createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

export async function createPayMongoCheckout(input: {
  amountCents: number;
  itemName: string;
  referenceNumber: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}): Promise<{ checkoutId: string; checkoutUrl: string }> {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) throw new Error("Online payments are not configured. Please contact the platform administrator.");
  const response = await fetch(`${PAYMONGO_API_URL}/v2/checkout_sessions`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [{
            name: input.itemName.slice(0, 100),
            amount: input.amountCents,
            currency: "PHP",
            quantity: 1,
          }],
          payment_method_types: ["card", "gcash", "qrph"],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          reference_number: input.referenceNumber,
          send_email_receipt: true,
          metadata: input.metadata,
        },
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json() as {
    data?: { id?: string; attributes?: { checkout_url?: string } };
  } & PayMongoError;
  if (!response.ok) {
    console.error("PayMongo checkout creation failed", { status: response.status, errors: body.errors });
    throw new Error("Could not start online checkout. Please retry or choose another payment option.");
  }
  const checkoutId = body.data?.id;
  const checkoutUrl = body.data?.attributes?.checkout_url;
  if (!checkoutId || !checkoutUrl || !checkoutUrl.startsWith("https://")) {
    throw new Error("Payment provider returned an invalid checkout session.");
  }
  return { checkoutId, checkoutUrl };
}

type BankAccount = { number: string; name: string; bic: string };

export async function listPayMongoReceivingInstitutions(provider: "instapay" | "pesonet") {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) throw new Error("Online payments are not configured. Please contact the platform administrator.");
  const response = await fetch(`${PAYMONGO_API_URL}/v2/transfers/receiving_institutions?provider=${provider}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}` },
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json() as { data?: unknown[] } & PayMongoError;
  if (!response.ok) {
    console.error("PayMongo receiving-institution lookup failed", { status: response.status, errors: body.errors });
    throw new Error("Could not load supported payout banks.");
  }
  return body.data ?? [];
}

export async function createPayMongoTransfer(input: {
  amountCents: number;
  referenceNumber: string;
  destinationAccount: BankAccount;
  callbackUrl: string;
}): Promise<{ transferId: string; status: string; feeCents: number }> {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  const sourceAccount = {
    number: process.env.PAYMONGO_SOURCE_ACCOUNT_NUMBER,
    name: process.env.PAYMONGO_SOURCE_ACCOUNT_NAME,
    bic: process.env.PAYMONGO_SOURCE_ACCOUNT_BIC,
  };
  if (!secretKey || !sourceAccount.number || !sourceAccount.name || !sourceAccount.bic) {
    throw new Error("PayMongo payout source account is not configured.");
  }
  const response = await fetch(`${PAYMONGO_API_URL}/v2/batch_transfers`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transfers: [{
        provider: "instapay",
        amount: input.amountCents,
        currency: "PHP",
        purpose: "Event organizer payout",
        description: "Playwell event organizer payout",
        reference_number: input.referenceNumber,
        source_account: sourceAccount,
        destination_account: input.destinationAccount,
        callback_url: input.callbackUrl,
      }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json() as {
    data?: { transfers?: { id?: string; status?: string; fee?: number }[] };
  } & PayMongoError;
  if (!response.ok) {
    console.error("PayMongo transfer creation failed", { status: response.status, errors: body.errors });
    throw new Error("PayMongo could not start the organizer payout. Verify the payout details and wallet balance.");
  }
  const transfer = body.data?.transfers?.[0];
  if (!transfer?.id || !transfer.status) throw new Error("PayMongo returned an invalid transfer response.");
  return { transferId: transfer.id, status: transfer.status, feeCents: transfer.fee ?? 0 };
}

export function encryptPayoutAccount(value: BankAccount) {
  const key = process.env.PAYOUT_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) throw new Error("Payout encryption is not configured.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptPayoutAccount(value: string): BankAccount {
  const key = process.env.PAYOUT_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) throw new Error("Payout encryption is not configured.");
  const [ivHex, tagHex, encryptedHex] = value.split(":");
  if (!ivHex || !tagHex || !encryptedHex) throw new Error("Saved payout details could not be read.");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]).toString("utf8");
  const account: unknown = JSON.parse(decrypted);
  if (!account || typeof account !== "object" || !("number" in account) || !("name" in account) || !("bic" in account)
    || typeof account.number !== "string" || typeof account.name !== "string" || typeof account.bic !== "string") {
    throw new Error("Saved payout details are invalid.");
  }
  return { number: account.number, name: account.name, bic: account.bic };
}
