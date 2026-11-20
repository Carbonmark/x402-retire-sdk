# x402 Carbon Retirement API: SDK, agent plugin and docs

Retire tokenized carbon credits on **Base** from any AI agent or HTTP client through the x402 Carbon Retirement API (`https://x402.carbonmark.com/api`), operated by Carbonmark. Credits come from two sources: the **Carbonmark marketplace**, where sellers list tokenized carbon credits, and **Klima Protocol**, a market maker for certain tokenized carbon credits. Every retirement gets a public Carbonmark certificate.

This repository holds the TypeScript SDK, the Base MCP agent plugin, its setup guide, runnable examples and the API docs. The full API and error reference is in [`endpoint-reference.md`](./endpoint-reference.md) and on [docs.carbonmark.com](https://docs.carbonmark.com/carbonmark-x402/carbonmark-x402).

> ⚠️ **Retirement is irreversible**: it permanently burns the carbon credit. Always review before approving.

## Contents

| Path | What |
|---|---|
| `sdk/` | Zero-dependency TypeScript client (`@carbonmark/x402-retire`). One `retire()` call runs the whole flow. |
| `examples/` | Runnable examples: read-only discover/quote, the SDK retire path, and a raw-HTTP walkthrough. |
| `plugins/carbonmark-x402.md` | The Base MCP plugin. |
| `base-mcp-setup.md` | Step-by-step: connect Base MCP and load the plugin. |
| `carbonmark-x402-action.md` | HTTP reference for the relayed retirement (`discover` → `quote` → `actions/retire` → `certificate`). |
| `endpoint-reference.md` | Every action, parameter, fee and error code. |
| `x402-docs/` | The guides published on docs.carbonmark.com. |

## TypeScript SDK & examples

For calling the API from a script, an app or an agent, use the SDK. You sign one standard EIP-712 token authorization, and the API's executor relays the on-chain retirement and pays the gas (reimbursed from your signed budget). No native ETH, no prior approval, no Base Account: just an input-token balance.

```ts
import { createClient } from "./sdk/x402-retire";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const client = createClient(); // https://x402.carbonmark.com, Base mainnet

const { status, transactionHash, retirements } = await client.retire({
  from: account.address,
  amount: "1",
  carbonClass: "0xf4699531e0a5f6e9351a36de3753deaad329bf45", // from client.discover()
  inputToken: "usdc", // or "kvcm" / an address
  details: { beneficiaryString: "Acme Corp", retirementMessage: "Net-zero 2026" },
  beneficiaryIsPayer: true, // credit the paying wallet; or set details.beneficiaryAddress
  signTypedData: (td) => account.signTypedData(td as any),
});
```

**Drop-in today, package soon.** `sdk/x402-retire.ts` is a single zero-dependency file: copy it into your project and import it directly (as the examples do). Once the package is published you can instead `npm i @carbonmark/x402-retire` and change only the import line; the `createClient()` API is identical either way.

Start here:

- [`examples/`](./examples/): runnable end-to-end. `npm run discover` is read-only (no wallet); `npm run retire:sdk` performs a real retirement. See [`examples/README.md`](./examples/README.md).
- [`sdk/README.md`](./sdk/README.md): the full client API (`retire`, `discover`, `quote`, `prepareAuth`, `certificate`) and how to swap in ethers, a browser wallet or an agent signer.

## Base MCP plugin

**Prerequisites**

1. Default Base MCP skills installed: `npx skills add base/skills --skill base-mcp`
2. A **Base Account** funded **on Base mainnet** with:
   - **USDC or kVCM** (Klima Protocol's token, accepted for Klima Protocol supply): covers the retirement cost and fee.
   - **A small amount of ETH**: for gas.

   This is the smart wallet that executes the retirement, _not_ your Coinbase exchange balance.

See [`base-mcp-setup.md`](./base-mcp-setup.md) for the full walkthrough (connect server → OAuth → add skill).

### Two steps

1. Copy the plugin into the skill:

```bash
cp plugins/carbonmark-x402.md ~/.claude/skills/base-mcp/plugins/carbonmark-x402.md
```

2. Add a routing row to `~/.claude/skills/base-mcp/SKILL.md` (in the **Plugins** table):

```
| [Carbonmark x402](plugins/carbonmark-x402.md) | Retire / offset carbon credits, buy carbon offsets. | discover, quote, prepare/retire, certificate | Base only. Always chainId=8453. |
```

Then restart your agent.

> **Upgrading from the earlier plugin:** it was called `klima-retire.md`. Delete `~/.claude/skills/base-mcp/plugins/klima-retire.md` and its row in `SKILL.md`, then follow the two steps above.

> **Note:** re-running `npx skills add base/skills --skill base-mcp` can overwrite `SKILL.md` and drop the plugin's row. Re-add it if you update the skill.

## Docs

- [Endpoint reference](./endpoint-reference.md): endpoints, `details` schema, fees, and the full error catalog.
- [Base MCP setup](./base-mcp-setup.md): connect a wallet and load the plugin.
- [Relay action reference](./carbonmark-x402-action.md): the `discover` → `quote` → `actions/retire` → `certificate` HTTP flow the SDK wraps.
- [Guides on docs.carbonmark.com](https://docs.carbonmark.com/carbonmark-x402/carbonmark-x402): quickstart, retiring carbon, the gasless relay, and using the API from an AI agent.
- Machine-readable: [OpenAPI](https://x402.carbonmark.com/openapi.json) · [agent guide (`llms.txt`)](https://x402.carbonmark.com/llms.txt) · [discovery manifest](https://x402.carbonmark.com/.well-known/x402.json)

## License

[MIT](./sdk/LICENSE.txt)
