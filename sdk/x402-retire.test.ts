/**
 * Unit tests for the client, run with Node's built-in runner: `npm test`.
 * Nothing here touches the network: every test injects a stub `fetch`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient, RetireError } from "./x402-retire.ts";
import type { Eip712TypedData, RetireStep } from "./x402-retire.ts";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CLASS = "0x0008f35758a4318942ecb5d5414116ce7b1ede2d";
const PAYER = "0x1111111111111111111111111111111111111111";
const TX = `0x${"ab".repeat(32)}`;

type Body = Record<string, unknown>;
type Reply = { status?: number; json?: unknown; text?: string };

/** A stub fetch that records each request and answers from a queue. */
function stub(replies: Reply[]) {
  const calls: { url: string; method: string; body: Body }[] = [];
  const doFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: JSON.parse(String(init?.body)) as Body,
    });
    const reply = replies.shift();
    assert.ok(reply, `unexpected request #${calls.length}`);
    if (reply.text !== undefined) {
      return new Response(reply.text, {
        status: reply.status ?? 200,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(JSON.stringify(reply.json ?? {}), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, doFetch };
}

async function rejection(promise: Promise<unknown>): Promise<RetireError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof RetireError, `expected RetireError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected the call to reject");
}

const TYPED_DATA: Eip712TypedData = {
  domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC },
  types: { TransferWithAuthorization: [{ name: "from", type: "address" }] },
  primaryType: "TransferWithAuthorization",
  message: { from: PAYER },
};

/** What prepare-auth returns: the payload to sign and the request to post back. */
const PREPARED = {
  authValueFormatted: "0.027143",
  typedData: TYPED_DATA,
  actionsRetireRequest: {
    action: "actions/retire",
    chainId: 8453,
    carbonClass: CLASS,
    amount: "0.001",
    salt: "0x5a17",
    details: { beneficiaryString: "Acme Corp" },
    authPayload: { from: PAYER, value: "27143", validBefore: "1800000000" },
  },
};

const RETIREMENT = {
  retirementId: "1",
  retirementIndex: 0,
  certificateUrl: "https://app.carbonmark.com/retirements/x",
  amountInTonnes: "0.001",
  beneficiaryName: "Acme Corp",
  beneficiaryLocation: "",
  message: "",
  projectId: "UCR-1",
  creditId: "UCR-1-2022",
  retiringAddress: PAYER,
  timestamp: 1_800_000_000,
};

test("posts every action to <baseUrl>/api and trims a trailing slash", async () => {
  const { calls, doFetch } = stub([{ json: {} }]);
  await createClient({ baseUrl: "https://example.test/", fetch: doFetch }).discover();
  assert.equal(calls[0]?.url, "https://example.test/api");
  assert.equal(calls[0]?.method, "POST");
  assert.deepEqual(calls[0]?.body, { action: "discover" });
});

test("without a baseUrl, requests go to x402.carbonmark.com", async () => {
  const { calls, doFetch } = stub([{ json: {} }]);
  await createClient({ fetch: doFetch }).discover();
  assert.equal(calls[0]?.url, "https://x402.carbonmark.com/api");
});

test("errors are named RetireError", async () => {
  const { doFetch } = stub([{ status: 400, json: { error: "bad_request" } }]);
  const err = await rejection(createClient({ fetch: doFetch }).discover());
  assert.equal(err.name, "RetireError");
});

test("discover sends filters, including credit, and stringifies the price cap", async () => {
  const { calls, doFetch } = stub([{ json: {} }]);
  await createClient({ fetch: doFetch }).discover({
    source: "protocol",
    credit: "VCS-1234-2020",
    maxUsdcPricePerTonne: 15,
  });
  assert.deepEqual(calls[0]?.body, {
    action: "discover",
    source: "protocol",
    credit: "VCS-1234-2020",
    maxUsdcPricePerTonne: "15",
  });
});

test("quote defaults to USDC on Base and normalises the amount", async () => {
  const { calls, doFetch } = stub([{ json: {} }, { json: {} }]);
  const client = createClient({ fetch: doFetch });
  await client.quote({ amount: 0.001, carbonClass: CLASS });
  await client.quote({ amount: ".5", carbonClass: CLASS, inputToken: "KVCM" });
  assert.deepEqual(calls[0]?.body, {
    action: "quote",
    chainId: 8453,
    inputToken: USDC,
    amount: "0.001",
    carbonClass: CLASS,
  });
  assert.equal(calls[1]?.body.amount, "0.5");
  assert.equal(calls[1]?.body.inputToken, "0x00fbac94fec8d4089d3fe979f39454f48c71a65d");
});

test("a marketplace listing is sent on its own, with no carbonClass key", async () => {
  const { calls, doFetch } = stub([{ json: {} }]);
  await createClient({ fetch: doFetch }).quote({ amount: "1", listingId: "0x1f0c" });
  assert.equal(calls[0]?.body.listingId, "0x1f0c");
  assert.equal("carbonClass" in (calls[0]?.body ?? {}), false);
});

test("an unknown input token is refused before any request is made", async () => {
  const { calls, doFetch } = stub([]);
  const client = createClient({ fetch: doFetch });
  // quote() throws synchronously here, so wrap the call rather than the promise.
  const err = await rejection((async () => client.quote({ amount: 1, carbonClass: CLASS, inputToken: "dai" }))());
  assert.equal(err.code, "unsupported_input_token");
  assert.equal(calls.length, 0);
});

test("certificate sends only txHash and index, never chainId", async () => {
  const { calls, doFetch } = stub([{ json: { retirements: [] } }]);
  await createClient({ fetch: doFetch }).certificate({ txHash: TX, index: 0 });
  assert.deepEqual(calls[0]?.body, { action: "certificate", txHash: TX, index: 0 });
});

test("an error response becomes a RetireError carrying status, code and body", async () => {
  const body = { error: "attribution_required", message: "A relayed retirement must name its beneficiary." };
  const { doFetch } = stub([{ status: 400, json: body }]);
  const err = await rejection(
    createClient({ fetch: doFetch }).prepareAuth({ from: PAYER, amount: "1", carbonClass: CLASS }),
  );
  assert.equal(err.status, 400);
  assert.equal(err.code, "attribution_required");
  assert.equal(err.message, body.message);
  assert.deepEqual(err.details, body);
});

test("a non-JSON reply is reported as non_json_response, not as an empty result", async () => {
  const { doFetch } = stub([{ status: 401, text: "<html>Authentication Required</html>" }]);
  const err = await rejection(createClient({ fetch: doFetch }).discover());
  assert.equal(err.code, "non_json_response");
  assert.equal(err.status, 401);
});

test("a failed connection is reported as network_error", async () => {
  const doFetch: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const err = await rejection(createClient({ fetch: doFetch }).discover());
  assert.equal(err.code, "network_error");
  assert.equal(err.status, 0);
});

test("a request that outlives timeoutMs is aborted and reported as timeout", async () => {
  const doFetch: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const err = await rejection(createClient({ fetch: doFetch, timeoutMs: 5 }).discover());
  assert.equal(err.code, "timeout");
  assert.equal(err.status, 408);
});

test("retire signs the prepared payload and posts the whole request back with the signature", async () => {
  const settled = { status: "settled", transactionHash: TX, retirements: [RETIREMENT], retirementCount: 1 };
  const { calls, doFetch } = stub([{ json: PREPARED }, { json: settled }]);
  const steps: RetireStep[] = [];
  let signed: Eip712TypedData | undefined;

  const result = await createClient({ fetch: doFetch }).retire({
    from: PAYER,
    amount: "0.001",
    carbonClass: CLASS,
    beneficiaryIsPayer: true,
    signTypedData: (typedData) => {
      signed = typedData;
      return "0xsigned";
    },
    onStep: (step) => steps.push(step),
  });

  assert.deepEqual(signed, TYPED_DATA);
  assert.deepEqual(calls[0]?.body, {
    action: "prepare-auth",
    chainId: 8453,
    from: PAYER,
    inputToken: USDC,
    amount: "0.001",
    carbonClass: CLASS,
    beneficiaryIsPayer: true,
  });
  // The salt and details must survive untouched: the endpoint re-hashes them
  // against the signed nonce and answers 400 if either is dropped or changed.
  assert.deepEqual(calls[1]?.body, {
    ...PREPARED.actionsRetireRequest,
    authPayload: { ...PREPARED.actionsRetireRequest.authPayload, signature: "0xsigned" },
  });
  assert.equal(calls.length, 2, "a settled retirement needs no certificate polling");
  assert.deepEqual(steps, ["prepare", "sign", "submit", "done"]);
  assert.equal(result.status, "settled");
  assert.equal(result.retirements[0]?.certificateUrl, RETIREMENT.certificateUrl);
});

test("retire polls the certificate while the retirement is unindexed, then reports it settled", async () => {
  const pending = { status: "pending_index", transactionHash: TX, retirements: [], retirementCount: 0 };
  const { calls, doFetch } = stub([
    { json: PREPARED },
    { json: pending },
    { status: 404, json: { error: "retirement_not_found", message: "not indexed yet" } },
    { json: { transactionHash: TX, retirementCount: 1, retirements: [RETIREMENT] } },
  ]);
  const result = await createClient({ fetch: doFetch }).retire({
    from: PAYER,
    amount: "0.001",
    carbonClass: CLASS,
    beneficiaryIsPayer: true,
    signTypedData: () => "0xsigned",
    pollIntervalMs: 1,
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[3]?.body, { action: "certificate", txHash: TX });
  assert.equal(result.status, "settled");
  assert.equal(result.retirementCount, 1);
  assert.deepEqual(result.retirements, [RETIREMENT]);
});

test("retire returns pending_index, with the transaction hash, when polling runs out", async () => {
  const pending = { status: "pending_index", transactionHash: TX, retirements: [], retirementCount: 0 };
  const notFound = { status: 404, json: { error: "retirement_not_found" } };
  const { calls, doFetch } = stub([{ json: PREPARED }, { json: pending }, notFound, notFound]);
  const result = await createClient({ fetch: doFetch }).retire({
    from: PAYER,
    amount: "0.001",
    carbonClass: CLASS,
    beneficiaryIsPayer: true,
    signTypedData: () => "0xsigned",
    pollIntervalMs: 1,
    pollAttempts: 2,
  });
  assert.equal(calls.length, 4);
  assert.equal(result.status, "pending_index");
  assert.equal(result.transactionHash, TX);
});

test("retire does not poll when pollCertificate is false", async () => {
  const pending = { status: "pending_index", transactionHash: TX, retirements: [], retirementCount: 0 };
  const { calls, doFetch } = stub([{ json: PREPARED }, { json: pending }]);
  const result = await createClient({ fetch: doFetch }).retire({
    from: PAYER,
    amount: "0.001",
    carbonClass: CLASS,
    beneficiaryIsPayer: true,
    signTypedData: () => "0xsigned",
    pollCertificate: false,
  });
  assert.equal(calls.length, 2);
  assert.equal(result.status, "pending_index");
});

test("retire stops polling on an error that is not 'not indexed yet'", async () => {
  const pending = { status: "pending_index", transactionHash: TX, retirements: [], retirementCount: 0 };
  const { doFetch } = stub([
    { json: PREPARED },
    { json: pending },
    { status: 500, json: { error: "internal_error", message: "boom" } },
  ]);
  const err = await rejection(
    createClient({ fetch: doFetch }).retire({
      from: PAYER,
      amount: "0.001",
      carbonClass: CLASS,
      beneficiaryIsPayer: true,
      signTypedData: () => "0xsigned",
      pollIntervalMs: 1,
    }),
  );
  assert.equal(err.code, "internal_error");
});

test("nothing is submitted when the wallet refuses to sign", async () => {
  const { calls, doFetch } = stub([{ json: PREPARED }]);
  await assert.rejects(
    createClient({ fetch: doFetch }).retire({
      from: PAYER,
      amount: "0.001",
      carbonClass: CLASS,
      beneficiaryIsPayer: true,
      signTypedData: () => {
        throw new Error("User rejected the request.");
      },
    }),
    /User rejected/,
  );
  assert.equal(calls.length, 1, "only prepare-auth was called");
});
