#!/usr/bin/env tsx
/**
 * Discover & quote: read-only
 */

import { parseArgs } from "node:util";
import { createClient, RetireError } from "../../sdk/x402-retire.js";

// ─── defaults (override with flags or env; flag > env > default) ──────────────
const CONFIG = {
  amount: "1", // tonnes to price (min 0.001)
  maxUsdcPricePerTonne: undefined as number | undefined, // e.g. 50 to filter the catalog
  baseUrl: "https://x402.carbonmark.com", // endpoint origin (no trailing /api)
};
// ─────────────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    help: { type: "boolean", short: "h" },
    amount: { type: "string" },
    "max-usdc-price": { type: "string" },
    "base-url": { type: "string" },
  },
});

if (values.help) {
  console.log(`Browse the carbon catalog and price a retirement (read-only).

Usage: npm run discover -- [options]
       (the -- is required so npm forwards the flags to the script)

Options:
  --amount <t>          tonnes to price (min 0.001)      [${CONFIG.amount}]
  --max-usdc-price <n>  filter catalog to <= n USDC/tonne
  --base-url <url>      endpoint origin                  [${CONFIG.baseUrl}]
  -h, --help            show this help`);
  process.exit(0);
}

// flag > env > default
const maxPriceRaw = values["max-usdc-price"] ?? process.env.MAX_USDC_PRICE;
const cfg = {
  amount: values.amount ?? process.env.AMOUNT ?? CONFIG.amount,
  maxUsdcPricePerTonne:
    maxPriceRaw != null ? Number(maxPriceRaw) : CONFIG.maxUsdcPricePerTonne,
  baseUrl: values["base-url"] ?? process.env.BASE_URL ?? CONFIG.baseUrl,
};

const client = createClient({ baseUrl: cfg.baseUrl });

try {
  // 1 · discover: the full catalog. Every credit in a class shares the class
  // price, so within a class you only choose on liquidity.
  const catalog = await client.discover(
    cfg.maxUsdcPricePerTonne != null
      ? { maxUsdcPricePerTonne: cfg.maxUsdcPricePerTonne }
      : {},
  );

  console.log(`\nProtocol catalog (${catalog.carbonClasses.length} classes)\n`);
  for (const cc of catalog.carbonClasses) {
    const liquidity = (cc.creditsDetailed as any[]).reduce(
      (sum, cr) => sum + Number(cr.liquidityFormatted),
      0,
    );
    console.log(
      `  ${cc.carbonClassId}  $${cc.priceUsdcPerTonneFormatted ?? "?"}/t` +
        `  ${cc.name ?? "unnamed"}  (${liquidity.toFixed(1)} t liquid)`,
    );
  }

  // Marketplace supply is one entry per open listing: a specific seller's
  // specific credit at a firm ask, not a class-wide indicative price.
  const listings: any[] = catalog.marketplaceEnabled
    ? catalog.marketplaceListings
    : [];
  console.log(
    `\nMarketplace listings (${catalog.marketplaceEnabled ? listings.length : "disabled"})\n`,
  );
  for (const l of listings) {
    console.log(
      `  ${l.listingId}  $${l.priceUsdcPerTonneFormatted ?? "?"}/t` +
        `  ${l.projectName ?? l.projectId ?? "unnamed"}  ` +
        `(${l.leftToSellFormatted} t left, min ${l.minFillFormatted} t)`,
    );
  }

  // 2 · pick: the cheapest fill across both surfaces that can cover the amount.
  //
  // A protocol pick needs a class price and one credit with enough liquidity;
  // a listing needs enough left to sell AND an amount at or above its own
  // minimum fill, which the seller sets and the endpoint enforces.
  type Pick = {
    priceUsdcPerTonne: number;
    label: string;
    quoteArgs: Parameters<typeof client.quote>[0];
  };

  const wanted = Number(cfg.amount);

  const protocolPicks: Pick[] = (catalog.carbonClasses as any[])
    .filter((cc) => cc.priceUsdcPerTonneFormatted != null)
    .flatMap((cc) =>
      (cc.creditsDetailed as any[])
        .filter((cr) => Number(cr.liquidityFormatted) >= wanted)
        .map((credit) => ({
          priceUsdcPerTonne: Number(cc.priceUsdcPerTonneFormatted),
          label:
            `protocol  class ${cc.carbonClassId} (${cc.name ?? "unnamed"})\n` +
            `            credit ${credit.tokenAddress} ` +
            `(${credit.projectId ?? "?"}, vintage ${credit.vintage ?? "?"})`,
          quoteArgs: {
            amount: cfg.amount,
            carbonClass: cc.carbonClassId,
            creditToken: credit.tokenAddress,
            inputToken: "usdc",
          },
        })),
    );

  const listingPicks: Pick[] = listings
    .filter(
      (l) =>
        l.priceUsdcPerTonneFormatted != null &&
        Number(l.leftToSellFormatted) >= wanted &&
        Number(l.minFillFormatted) <= wanted,
    )
    .map((l) => ({
      priceUsdcPerTonne: Number(l.priceUsdcPerTonneFormatted),
      label:
        `marketplace  listing ${l.listingId}\n` +
        `            seller ${l.seller} · ` +
        `${l.projectName ?? l.projectId ?? "?"}, vintage ${l.vintage ?? "?"}`,
      // A listing names its own credit and price, so listingId is the whole
      // selection -- do not also send carbonClass or creditToken.
      quoteArgs: {
        amount: cfg.amount,
        listingId: l.listingId,
        inputToken: "usdc",
      },
    }));

  const picks = [...protocolPicks, ...listingPicks].sort(
    (a, b) => a.priceUsdcPerTonne - b.priceUsdcPerTonne,
  );
  if (picks.length === 0) {
    console.error(
      `\nNothing can fill ${cfg.amount} t right now. Try a smaller amount, ` +
        `or a larger one if only listings are available (each sets a minimum fill).`,
    );
    process.exit(1);
  }
  const best = picks[0];

  // 3 · quote: the real cost at size (retirement + on-chain protocol fee).
  // The catalog price is spot; a listing's ask is firm but its supply is not
  // reserved, so quote and retire promptly.
  const quote = await client.quote(best.quoteArgs);

  console.log(`\nCheapest fill for ${cfg.amount} t`);
  console.log(`  ${best.label}`);
  console.log(`  quote        ${quote.humanSummary}\n`);
  console.log(
    `Paste carbonClass (+ creditToken) or listingId into retire-sdk.ts CONFIG to retire.\n`,
  );
} catch (err) {
  if (err instanceof RetireError) {
    console.error(`\n✗ ${err.code ?? err.status}: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
