# Aspire 17 standalone dashboard migration

Status: current-dev transplant prepared locally on 2026-11-18; standalone
command behavior mock-tested, separate Docker image upgrade held.

Squad consumes only the standalone dashboard, not an Aspire AppHost. Use the
documented Aspire CLI 17+ `dashboard run` command by default, keeping the UI on
18888 (configurable), OTLP/gRPC on 4317, anonymous local access and ephemeral
history. Explicitly disable the unused OTLP/HTTP listener.

```text
aspire dashboard run --frontend-url http://localhost:18888 --otlp-grpc-url http://localhost:4317 --otlp-http-url "" --allow-anonymous --persistence None --non-interactive --nologo
```

Remove obsolete .NET workload/global-tool detection and the fallback that assumes
a local AppHost exists. Missing, older, prerelease or unrecognized CLIs fail with
guidance instead of silently switching launch strategies. Keep `--docker` as an
explicit legacy option with its original image, auth settings and gRPC mapping.
Both launch paths honor the requested UI port and forward child output.

Missing prerequisites, spawn errors, nonzero exits and unexpected child signals
set `process.exitCode = 1`. Early failures cancel the delayed launch message and
settle the command. Requested SIGINT/SIGTERM shutdown remains successful.

The earlier MCR check returned HTTP 404 `MANIFEST_UNKNOWN` for
`mcr.microsoft.com/aspire/dashboard:17.0`. Keep
`mcr.microsoft.com/dotnet/aspire-dashboard:latest` as an explicit legacy-image
hold, not an Aspire 17 image claim. No new container manifest check or runtime
smoke test is implied by this transplant.

The supported command/help was verified against the official signed
[17.0.0 CLI release](https://github.com/microsoft/aspire/releases/tag/v17.0.0),
commit `2d325b13709752ba6d9a943635c5e2940a2530c0`, with verified Authenticode
and SHA-256/SHA-512 checks in the local upgrade investigation. No NuGet package,
unsigned CI artifact, new npm dependency or CLI auto-install is introduced.

## Current-dev integration and validation

This change is based directly on `origin/dev` at
`330b5d5df355b4d3f5ab658103a205b34eb3d13e`, not merged from the old main-based
upgrade branch. The four existing Aspire source/help/test/scenario files had
identical baseline blobs, so the intended delta can be transplanted without
replacing newer dev APIs or importing unrelated branch history.

The actual CLI package is still `@bradygaster/squad-cli`; the patch changeset
uses that name. No package manifests, lockfiles, templates, bootstrap imports,
application versions or unrelated storage-provider scripts are changed.

Fifteen dependency-free Node VM scenarios exercise the actual TypeScript source:
CLI arguments/ports/output; explicit Docker and custom UI ports; unsupported or
missing prerequisites without fallback; early/late nonzero exits; spawn errors;
unexpected signals; and successful SIGINT/SIGTERM cleanup. Vitest regression
coverage is retained, but its normal runner and a full type-check remain held
because dependencies are absent in this worktree.

The existing PR `Squad CI` workflow only runs `node --test test/*.test.cjs`;
the workflows that build TypeScript or invoke Vitest are release/manual jobs,
not equivalent PR coverage. A single additional PR-only workflow therefore
compiles the existing SDK and CLI workspace build scripts and runs exactly
`npm test -- test/aspire-command.test.ts`. It avoids the root prebuild's
version/template hooks, package publishing, dashboards and integration suites.
It has read-only contents permission, no persisted checkout credentials,
pinned official actions, a timeout and per-PR concurrency cancellation.

The new job writes a job-local root `.npmrc` with the approved registry and
`replace-registry-host=always`, then checks both effective settings before
`npm ci`. Canonical public-registry metadata in the unchanged lock is accepted
because npm routes those requests through the proxy; URLs/hashes are not
rewritten. Install lifecycle scripts, audit, funding requests and fetch retries
are disabled. No existing workflow or repository registry configuration changes.
The new workflow requires independent review and a separately approved push
before execution. Its compilation/Vitest results are pending, not claimed green
from local VM or syntax checks.

The effective npm registry was inspected offline and is
`https://packagefeedproxy.microsoft.io/npm/`. Root and documentation lockfiles
contain respectively 419 and 409 public-registry resolved URLs. No package
installation, public-registry request or lockfile rewrite is performed. No
dashboard, container, server, integration environment or CI workflow is launched.

References:

- <https://aspire.dev/dashboard/standalone/>
- <https://aspire.dev/reference/cli/commands/aspire-dashboard-run/>
- <https://github.com/microsoft/aspire/blob/2d325b13709752ba6d9a943635c5e2940a2530c0/src/Aspire.Cli/Commands/DashboardRunCommand.cs>
