<!--
  DO NOT EDIT. Published automatically from Carbonmark/x402-klima-RA-new/sdk/README.md.
  Changes made here will be overwritten by the next docs sync.
  Edit the source file and open a PR there instead.
-->

# @carbonmark/x402-retire

Zero-dependency TypeScript client for retiring tokenized carbon on **Base**
through the x402 Carbon Retirement API using any wallet or agent. Every
retirement gets a public [Carbonmark](https://www.carbonmark.com/ai-agents)
certificate.

## Install

```sh
npm install @carbonmark/x402-retire
```

Requires Node 20 or newer. The package is ES modules only and ships its own
type declarations.

The client is also a single self-contained file, `x402-retire.ts`. If you would
rather not add a dependency, copy that file into your project and import from it
instead; the API is the same.

## Easy to integrate

- **No dependencies.** Uses the global `fetch`: Node 20+, Bun, Deno, and
  serverless or edge functions. **Not from a web page yet:** the endpoint sends
  no CORS headers, so a browser blocks the call. Run the client on a server and
  hand only the signing step to the user's wallet.
- **Signer-agnostic.** You pass a `signTypedData` callback — works with viem,
  ethers, a browser wallet, Coinbase AgentKit, or a KMS/MPC signer. No wallet
  library is bundled.
- **One call.** `retire()` runs prepare-auth → sign → submit → poll certificate.
- **No gas, no approval, no Base Account.** You sign one standard EIP-712 token
  authorization (EIP-3009 for USDC, EIP-2612 for kVCM); the API's executor
  relays the transaction on-chain and is reimbursed from your signed budget. The
  signer needs only an input-token balance.

## Where the credits come from

`discover()` returns supply from two sources, and every call that names supply
takes exactly one of them:

- **Carbonmark marketplace** (`marketplaceListings[]`, addressed by
  `listingId`). Carbonmark is a marketplace where sellers list tokenized carbon
  credits. Each listing is one seller's firm ask.
- **Klima Protocol** (`carbonClasses[]`, addressed by `carbonClass`). Klima
  Protocol is a market maker for certain tokenized carbon credits: it holds them
  in pools and prices them automatically. kVCM is its token, and you can pay
  with it on this source.

## Usage

```ts
import { createClient } from "@carbonmark/x402-retire";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const client = createClient(); // https://x402.carbonmark.com, Base mainnet

const { status, transactionHash, retirements } = await client.retire({
  from: account.address,
  amount: "1",
  carbonClass: "0xf4699531e0a5f6e9351a36de3753deaad329bf45", // from client.discover()
  // ...or fill one marketplace listing instead. `listingId` REPLACES
  // carbonClass/creditToken rather than narrowing them — sending both is a 400:
  //   listingId: "0x1f0c…",   (USDC only; the authorization lives 5 minutes)
  inputToken: "usdc", // or "kvcm" / an address
  details: {
    beneficiaryString: "Acme Corp",
    beneficiaryAddress: "0x1234567890123456789012345678901234567890",
    retirementMessage: "Net-zero 2026",
  },
  beneficiaryIsPayer: true, // credit the payer; or set details.beneficiaryAddress
  signTypedData: (td) => account.signTypedData(td as any), // cast: viem's strict generics vs. the loose wire type
});

for (const r of retirements)
  console.log(r.amountInTonnes, "t →", r.certificateUrl);
```

> **Filling a marketplace listing.** A listing settles in USDC only, fills at its
> `unitPrice` with no slippage buffer, and its authorization is capped at 5
> minutes because the seller can reprice or cancel it and other buyers compete
> for the same supply.

> **Attribution is required.** `retire()` will not guess who a retirement belongs
> to. Pass `details.beneficiaryAddress` (the party it's for), or
> `beneficiaryIsPayer: true` to credit the paying wallet deliberately — omitting
> both throws `attribution_required`. The beneficiary is indexed on-chain as a
> permanent grouping key and can't be changed once the retirement confirms.
> `beneficiaryString` is what shows on the certificate, and is equally permanent.

### Other wallets

```ts
// ethers v6
signTypedData: (td) => signer.signTypedData(td.domain, td.types, td.message);

// browser wallet (EIP-1193). Signing happens in the page; the client calls
// themselves must run server-side, see "No dependencies" above.
signTypedData: (td) =>
  window.ethereum.request({
    method: "eth_signTypedData_v4",
    params: [address, JSON.stringify(td)],
  });
```

## API

`createClient({ baseUrl?, chainId?, fetch?, timeoutMs? })` returns:

| Method                    | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `retire(params)`          | Full flow: prepare-auth → sign → submit → poll certificate. |
| `discover(filters?)`      | Browse retirable credits from both sources, with prices.    |
| `quote(params)`           | Price a retirement before committing.                       |
| `prepareAuth(params)`     | Build the EIP-712 payload to sign (no funds moved).         |
| `certificate({ txHash })` | Resolve the public Carbonmark certificate(s) for a tx.      |

Non-2xx responses throw `RetireError` with `.status`, `.code`, `.details`.

The default endpoint is `https://x402.carbonmark.com`. Pass `baseUrl` to use
another host.

If you call `prepareAuth` directly instead of `retire()`, post the returned
`actionsRetireRequest` back **whole**. On the USDC path it carries a top-level
`salt`, which together with the retirement itself forms the EIP-3009
authorization `nonce` you signed; `actions/retire` re-hashes both to verify that
the retirement being submitted is the one authorized. Dropping `salt` returns
`400 invalid_auth_payload`; changing the credit, amount, or `details` after
signing returns `400 params_mismatch`. `retire()` handles this for you.

See the [OpenAPI document](https://x402.carbonmark.com/openapi.json) for the
full request/response shapes, and the
[x402 docs on docs.carbonmark.com](https://docs.carbonmark.com/carbonmark-x402/carbonmark-x402)
for a walkthrough.

## Development

```sh
npm ci             # two dev dependencies: typescript and @types/node
npm run typecheck  # the client and its tests
npm test           # node --test, stubbed fetch, no network
npm run build      # emits dist/x402-retire.js and .d.ts
npm run changelog:check  # newest CHANGELOG.md entry == package.json version
```

The tests run the TypeScript file directly, which needs Node 22.18 or newer. The
built package itself supports Node 20+.

Releases are listed in [CHANGELOG.md](./CHANGELOG.md). Licensed under the
[MIT License](./LICENSE.txt).
