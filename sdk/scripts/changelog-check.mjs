#!/usr/bin/env node
// Fails unless the newest entry in CHANGELOG.md is the version in package.json.
// Run by `npm run changelog:check`, in CI and from `prepack`, so a release
// cannot go out without its notes.
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

const { version } = JSON.parse(read("package.json"));
// The first "## x.y.z" heading. Text after the version (a date, a label) is allowed.
const heading = read("CHANGELOG.md").match(/^##\s+\[?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?/m);

if (!heading) {
  console.error("changelog:check: CHANGELOG.md has no release heading (expected a line like `## 1.0.0`).");
  process.exit(1);
}
if (heading[1] !== version) {
  console.error(
    `changelog:check: package.json is ${version} but the newest CHANGELOG.md entry is ${heading[1]}. ` +
      "Add an entry for this version at the top of CHANGELOG.md.",
  );
  process.exit(1);
}
console.log(`OK: package.json and CHANGELOG.md both at ${version}.`);
