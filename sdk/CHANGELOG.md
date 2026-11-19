<!--
  DO NOT EDIT. Published automatically from Carbonmark/x402-klima-RA-new/sdk/CHANGELOG.md.
  Changes made here will be overwritten by the next docs sync.
  Edit the source file and open a PR there instead.
-->

# Changelog

All notable changes to `@carbonmark/x402-retire`. The newest release is first, and its version
must equal `version` in `package.json`: `npm run changelog:check` enforces it,
in CI and before every `npm pack` / `npm publish`.

This package follows [Semantic Versioning](https://semver.org). It versions
independently of the API it calls; the API's own history is at
<https://x402.carbonmark.com/.well-known/x402-changelog.json>.

## 1.0.0

First published release. The client was previously distributed as a single
file to copy (`klima-retire.ts`). It behaves the same, with three changes if you
are moving from that file:

- The file is now `x402-retire.ts`.
- `KlimaRetireError`, `KlimaClient` and `KlimaClientOptions` are now
  `RetireError`, `RetireClient` and `RetireClientOptions`. An error's `name` is
  `"RetireError"`.
- The default `baseUrl` is `https://x402.carbonmark.com`. It is the same API as
  `https://x402.klimalabs.com`, which keeps working; pass `baseUrl` to choose.

What the package provides:

- `createClient()` with `discover`, `quote`, `prepareAuth`, `retire` and
  `certificate`.
- `retire()` runs the whole relayed flow: prepare-auth, sign, submit, then poll
  for the certificate.
- `discover()` accepts the `credit` filter.
- Errors are thrown as `RetireError` with `status`, `code` and `details`.
- Ships as ES modules with type declarations. Requires Node 20 or newer. No
  runtime dependencies.
