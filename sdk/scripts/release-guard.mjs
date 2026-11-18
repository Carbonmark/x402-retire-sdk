#!/usr/bin/env node
// Decides whether CI may release a version of the SDK. Used by
// .github/workflows/release-sdk.yml before anything is built or staged.
//
// Two rules, both protecting what `npm install` gives people. npm points the
// `latest` tag at whatever was published last, whatever its version number.
//
// 1. Only a plain `X.Y.Z` newer than npm's current `latest` is released.
//    Tagging an older version that was never released (1.2.1 while 1.3.0 is
//    live) would otherwise move `latest` back to it. A prerelease would take
//    over `latest` the same way.
//
// 2. Only one release may be pending at a time. The workflow stages a version;
//    it goes live when a maintainer approves it, possibly much later, and a
//    stage keeps the `latest` tag it was created with. With `latest` at 1.0.0,
//    both 1.1.0 and 1.2.0 would pass rule 1; approving 1.2.0 and then 1.1.0
//    would still move `latest` backwards. So a release is refused while another
//    release tag exists whose version is not on npm yet.
//
//    CI cannot ask npm what is staged (the short-lived token it publishes with
//    may not list stages), so the release tags are the record: a plain
//    `sdk-vX.Y.Z` tag newer than `latest` whose version is not on npm is a
//    release that is staged and waiting, or one that did not finish.
//
// Patching an older release line, and prereleases, need `--tag` and a person
// deciding; they are done by hand, not by this workflow.
//
//   node scripts/release-guard.mjs --version 1.4.0 --latest 1.3.0 \
//     --published-versions '["1.2.0","1.3.0"]' --tagged-versions '1.2.0,1.3.0,1.4.0'
//
// Prints `decision=stage` or `decision=skip` on stdout (for $GITHUB_OUTPUT) and
// the reason on stderr. Exits 1, printing no decision, when the release must
// not go ahead.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Parse a semantic version, or return null when it is not one. */
export function parseVersion(text) {
  const match = SEMVER.exec(String(text).trim());
  if (!match) return null;
  return {
    // BigInt: a version component has no upper bound, and Number would round.
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease: match[4] ?? null,
    build: match[5] ?? null,
  };
}

const isPlain = (parsed) => parsed !== null && parsed.prerelease === null && parsed.build === null;

/** -1, 0 or 1 comparing only major.minor.patch. */
function compareCore(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1;
  }
  return 0;
}

/** Is `candidate` (a plain version) newer than `current` (whatever npm calls latest)? */
function isNewer(candidate, current) {
  const order = compareCore(candidate, current);
  // Same X.Y.Z is newer only when `current` is a prerelease of it (1.2.0 > 1.2.0-rc.1).
  return order > 0 || (order === 0 && current.prerelease !== null);
}

/**
 * @param {object} input
 * @param {string} input.version  the version in package.json (already checked against the tag)
 * @param {string} [input.latest]  npm's `latest` dist-tag, or "" when the package is not on npm
 * @param {string[]} [input.publishedVersions]  every version of the package on npm
 * @param {string[]} [input.taggedVersions]  the version of every `sdk-v*` tag in the repository
 * @returns {{ decision: "stage" | "skip" | "reject", reason: string }}
 */
export function checkRelease({ version, latest = "", publishedVersions = [], taggedVersions = [] }) {
  const candidate = parseVersion(version);
  if (!candidate) {
    return { decision: "reject", reason: `"${version}" is not a semantic version (expected X.Y.Z).` };
  }
  if (!isPlain(candidate)) {
    return {
      decision: "reject",
      reason:
        `${version} is a prerelease or carries build metadata. This workflow releases plain X.Y.Z only: ` +
        "a prerelease would become `latest` on npm. Publish prereleases by hand with `--tag`.",
    };
  }
  const published = new Set(publishedVersions.map((v) => String(v).trim()));
  if (published.has(version)) {
    return { decision: "skip", reason: `${version} is already on npm. Nothing to stage.` };
  }

  let current = null;
  if (latest.trim() !== "") {
    current = parseVersion(latest);
    if (!current) {
      return {
        decision: "reject",
        reason: `npm reports "${latest}" as latest, which is not a semantic version. Refusing to guess; release by hand.`,
      };
    }
    if (!isNewer(candidate, current)) {
      return {
        decision: "reject",
        reason:
          `${version} is not newer than ${latest}, the current \`latest\` on npm. Releasing it would move \`latest\` backwards. ` +
          "Patching an older release line is a separate, manual process (`npm publish --tag <line>`).",
      };
    }
  }

  // Rule 2: another release that is tagged, newer than `latest`, and not on npm.
  const pending = [...new Set(taggedVersions.map((v) => String(v).trim()))].filter((tagged) => {
    if (tagged === version || published.has(tagged)) return false;
    const parsed = parseVersion(tagged);
    if (!isPlain(parsed)) return false; // CI never stages these, so they cannot be pending here
    return current === null || isNewer(parsed, current);
  });
  if (pending.length > 0) {
    const tags = pending.map((v) => `sdk-v${v}`).join(", ");
    return {
      decision: "reject",
      reason:
        `Another release is pending: ${tags} is tagged but not on npm, so it is staged and waiting for approval, or its release did not finish. ` +
        "Only one release may be pending at a time, because approving two out of order moves `latest` backwards. " +
        "Approve it on npmjs.com, or reject it there and delete its tag (`git push origin :refs/tags/<tag>`), then re-run this workflow.",
    };
  }

  return {
    decision: "stage",
    reason: current
      ? `${version} is newer than ${latest}, the current \`latest\` on npm, and no other release is pending.`
      : `The package is not on npm yet, so ${version} is its first release.`,
  };
}

/** `npm view <pkg> versions --json` prints an array, a bare string for one version, or nothing. */
export function parsePublishedVersions(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return [];
  const value = JSON.parse(trimmed);
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value;
  throw new Error("Unexpected answer from npm for the published versions.");
}

function readArgs(argv) {
  const known = new Set(["--version", "--latest", "--published-versions", "--tagged-versions"]);
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!known.has(flag) || i + 1 >= argv.length) {
      throw new Error(
        "Usage: release-guard.mjs --version <x.y.z> [--latest <x.y.z>] [--published-versions <json>] [--tagged-versions <a,b,c>]",
      );
    }
    out[flag] = argv[i + 1];
  }
  if (!out["--version"]) throw new Error("--version is required.");
  return {
    version: out["--version"],
    latest: out["--latest"] ?? "",
    publishedVersions: parsePublishedVersions(out["--published-versions"]),
    taggedVersions: (out["--tagged-versions"] ?? "").split(/[\s,]+/).filter(Boolean),
  };
}

// Run only when executed directly, not when imported by the tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    result = checkRelease(readArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  console.error(result.reason);
  if (result.decision === "reject") process.exit(1);
  console.log(`decision=${result.decision}`);
}
