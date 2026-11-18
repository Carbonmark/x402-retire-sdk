// Tests for the CI release guard. Run with `npm test`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkRelease, parsePublishedVersions, parseVersion } from "./release-guard.mjs";

const decision = (input) => checkRelease(input).decision;

// ── Rule 1: a plain version, newer than latest ───────────────────────────────

test("stages a plain version that is newer than latest", () => {
  for (const [version, latest] of [
    ["1.0.1", "1.0.0"],
    ["1.1.0", "1.0.9"],
    ["2.0.0", "1.99.99"],
    ["1.10.0", "1.9.0"], // numeric, not alphabetical
    ["10.0.0", "9.0.0"],
  ]) {
    assert.equal(decision({ version, latest, publishedVersions: [latest] }), "stage", `${version} over ${latest}`);
  }
});

test("rejects a version that is older than latest", () => {
  // The case from review: 1.3.0 is live and a never-released 1.2.1 gets tagged.
  const result = checkRelease({ version: "1.2.1", latest: "1.3.0", publishedVersions: ["1.2.0", "1.3.0"] });
  assert.equal(result.decision, "reject");
  assert.match(result.reason, /not newer than 1\.3\.0/);
  for (const [version, latest] of [
    ["1.0.0", "1.0.1"],
    ["1.9.0", "1.10.0"],
    ["1.99.99", "2.0.0"],
    ["0.9.0", "1.0.0"],
  ]) {
    assert.equal(decision({ version, latest, publishedVersions: [latest] }), "reject", `${version} under ${latest}`);
  }
});

test("rejects the same version as latest when npm does not list it as published", () => {
  // Cannot happen with consistent registry answers; if it does, stop.
  assert.equal(decision({ version: "1.2.0", latest: "1.2.0" }), "reject");
});

test("rejects prereleases and build metadata, whatever latest is", () => {
  for (const version of ["1.1.0-beta.1", "2.0.0-rc.1", "1.0.1-0", "1.1.0+build.5", "1.1.0-alpha+001"]) {
    for (const latest of ["", "1.0.0", "9.9.9"]) {
      const result = checkRelease({ version, latest });
      assert.equal(result.decision, "reject", `${version} with latest "${latest}"`);
      assert.match(result.reason, /prerelease or carries build metadata/);
    }
  }
});

test("a prerelease is rejected even if that exact version is already on npm", () => {
  assert.equal(
    decision({ version: "1.1.0-beta.1", latest: "1.0.0", publishedVersions: ["1.0.0", "1.1.0-beta.1"] }),
    "reject",
  );
});

test("rejects anything that is not a semantic version", () => {
  for (const version of ["", "1", "1.2", "v1.2.3", "1.2.3.4", "01.2.3", "1.2.x", "latest", " "]) {
    assert.equal(decision({ version, latest: "1.0.0" }), "reject", JSON.stringify(version));
  }
});

test("skips a plain version that is already on npm", () => {
  // 1.0.0 was published by hand and tagged afterwards.
  assert.equal(decision({ version: "1.0.0", latest: "1.0.0", publishedVersions: ["1.0.0"] }), "skip");
  // An older version that exists is still just a no-op, not an error.
  assert.equal(decision({ version: "1.0.0", latest: "1.3.0", publishedVersions: ["1.0.0", "1.3.0"] }), "skip");
  // Re-running a tag never trips over other pending work.
  assert.equal(
    decision({ version: "1.0.0", latest: "1.0.0", publishedVersions: ["1.0.0"], taggedVersions: ["1.0.0", "1.1.0"] }),
    "skip",
  );
});

test("stages the first release when the package is not on npm", () => {
  assert.equal(decision({ version: "1.0.0", latest: "" }), "stage");
  assert.equal(decision({ version: "1.0.0" }), "stage");
  assert.equal(decision({ version: "1.0.0", taggedVersions: ["1.0.0"] }), "stage");
});

test("a release is newer than a prerelease of the same version", () => {
  assert.equal(decision({ version: "1.2.0", latest: "1.2.0-rc.1" }), "stage");
  assert.equal(decision({ version: "1.1.9", latest: "1.2.0-rc.1" }), "reject");
});

test("refuses to guess when npm reports a latest that is not a version", () => {
  assert.equal(decision({ version: "1.2.0", latest: "next" }), "reject");
});

test("compares very large components exactly", () => {
  assert.equal(decision({ version: "1.0.9007199254740993", latest: "1.0.9007199254740992" }), "stage");
  assert.equal(decision({ version: "1.0.9007199254740992", latest: "1.0.9007199254740993" }), "reject");
});

// ── Rule 2: one pending release at a time ────────────────────────────────────

const LIVE = { latest: "1.0.0", publishedVersions: ["1.0.0"] };

test("refuses a release while an earlier one is tagged but not on npm", () => {
  // The case from review: with latest at 1.0.0, 1.1.0 is staged and waiting,
  // then 1.2.0 is tagged. Approving 1.2.0 and then 1.1.0 would move latest back.
  const result = checkRelease({ ...LIVE, version: "1.2.0", taggedVersions: ["1.0.0", "1.1.0", "1.2.0"] });
  assert.equal(result.decision, "reject");
  assert.match(result.reason, /Another release is pending: sdk-v1\.1\.0/);
  assert.match(result.reason, /delete its tag/);
});

test("refuses it in the other order too: a newer version is the one pending", () => {
  const result = checkRelease({ ...LIVE, version: "1.1.0", taggedVersions: ["1.0.0", "1.2.0", "1.1.0"] });
  assert.equal(result.decision, "reject");
  assert.match(result.reason, /sdk-v1\.2\.0/);
});

test("names every pending release", () => {
  const result = checkRelease({ ...LIVE, version: "1.3.0", taggedVersions: ["1.1.0", "1.2.0", "1.3.0"] });
  assert.match(result.reason, /sdk-v1\.1\.0, sdk-v1\.2\.0/);
});

test("stages once the earlier release has been approved", () => {
  assert.equal(
    decision({
      version: "1.2.0",
      latest: "1.1.0",
      publishedVersions: ["1.0.0", "1.1.0"],
      taggedVersions: ["1.0.0", "1.1.0", "1.2.0"],
    }),
    "stage",
  );
});

test("its own tag and published tags are not pending", () => {
  assert.equal(decision({ ...LIVE, version: "1.1.0", taggedVersions: ["1.0.0", "1.1.0", "1.1.0"] }), "stage");
});

test("an abandoned tag older than latest does not block releases forever", () => {
  // sdk-v1.0.5 was tagged, never released, and 1.1.0 has shipped since. It can
  // no longer be staged by CI (rule 1), so it is not pending.
  assert.equal(
    decision({
      version: "1.2.0",
      latest: "1.1.0",
      publishedVersions: ["1.0.0", "1.1.0"],
      taggedVersions: ["1.0.0", "1.0.5", "1.1.0", "1.2.0"],
    }),
    "stage",
  );
});

test("prerelease and malformed tags are ignored when looking for pending releases", () => {
  // CI refuses to stage these, so they cannot be waiting for approval here.
  assert.equal(
    decision({ ...LIVE, version: "1.1.0", taggedVersions: ["1.1.0", "1.2.0-beta.1", "not-a-version", "2", ""] }),
    "stage",
  );
});

test("the first release is refused while another first release is pending", () => {
  const result = checkRelease({ version: "1.0.1", latest: "", taggedVersions: ["1.0.0", "1.0.1"] });
  assert.equal(result.decision, "reject");
  assert.match(result.reason, /sdk-v1\.0\.0/);
});

// ── Parsing ──────────────────────────────────────────────────────────────────

test("parseVersion separates the parts", () => {
  assert.deepEqual(parseVersion("1.2.3-rc.1+b7"), { core: [1n, 2n, 3n], prerelease: "rc.1", build: "b7" });
  assert.equal(parseVersion("1.2"), null);
});

test("parsePublishedVersions accepts each shape npm prints", () => {
  assert.deepEqual(parsePublishedVersions('["1.0.0","1.1.0"]'), ["1.0.0", "1.1.0"]);
  assert.deepEqual(parsePublishedVersions('"1.0.0"'), ["1.0.0"]); // npm prints a bare string for one version
  assert.deepEqual(parsePublishedVersions(""), []); // package not on npm
  assert.deepEqual(parsePublishedVersions(undefined), []);
  assert.throws(() => parsePublishedVersions("{}"));
  assert.throws(() => parsePublishedVersions("not json"));
});

// ── The command line, which is what the workflow calls ───────────────────────

const SCRIPT = fileURLToPath(new URL("./release-guard.mjs", import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

test("CLI prints the decision for $GITHUB_OUTPUT and the reason on stderr", () => {
  const staged = cli(
    "--version", "1.1.0", "--latest", "1.0.0",
    "--published-versions", '["1.0.0"]', "--tagged-versions", "1.0.0,1.1.0",
  );
  assert.equal(staged.status, 0, staged.stderr);
  assert.equal(staged.stdout.trim(), "decision=stage");
  assert.match(staged.stderr, /newer than 1\.0\.0/);

  const skipped = cli("--version", "1.0.0", "--latest", "1.0.0", "--published-versions", '"1.0.0"');
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(skipped.stdout.trim(), "decision=skip");

  const first = cli("--version", "1.0.0", "--latest", "", "--published-versions", "", "--tagged-versions", "1.0.0");
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim(), "decision=stage");
});

test("CLI exits 1 and prints no decision when the release is refused", () => {
  for (const args of [
    ["--version", "1.2.1", "--latest", "1.3.0", "--published-versions", '["1.3.0"]'],
    ["--version", "1.4.0-beta.1", "--latest", "1.3.0"],
    ["--version", "1.2.0", "--latest", "1.0.0", "--published-versions", '["1.0.0"]', "--tagged-versions", "1.1.0 1.2.0"],
  ]) {
    const refused = cli(...args);
    assert.equal(refused.status, 1, args.join(" "));
    assert.equal(refused.stdout, "", "nothing may reach $GITHUB_OUTPUT");
    assert.notEqual(refused.stderr.trim(), "");
  }
});

test("CLI exits 2 on bad usage or an answer from npm it cannot read", () => {
  assert.equal(cli().status, 2);
  assert.equal(cli("--latest", "1.0.0").status, 2);
  assert.equal(cli("--bogus", "x").status, 2);
  assert.equal(cli("--version").status, 2);
  assert.equal(cli("--version", "1.1.0", "--published-versions", "<html>").status, 2);
});
