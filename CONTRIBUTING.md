# Contributing to Saga

Thanks for taking the time to contribute. This document covers what you need to know to make changes that land cleanly.

## Setup

```bash
npm install
npm run build       # tsc + copy prompts to dist/
npm run typecheck
npm test            # runs all 172 unit tests in test/ (regression/ is excluded)
```

Requires Node.js ≥ 20.

## Repo layout

```
src/
├── adapters/         # OpenClaw plugin entry — the only place that imports the SDK
├── coordinator/      # advance() dispatcher, state types, transitions, progress
├── roles/            # planner parser, auto evaluator, deep evaluator (data-driven)
├── recovery/         # cascading chain + root-cause classifiers
├── compaction/       # microcompact + prefix builder
├── stage-spec/       # loose YAML stage-spec parser + done-criteria runner
├── profiles/         # ProfileDefinition registry (TS side)
├── prompts/          # planner/worker/evaluator templates + per-profile fragments
└── storage/          # state.json (atomic), events.jsonl (append-only), artifacts/, diagnostics

profiles/             # <id>-default.json — one per profile (declares evaluator checklist)
data/few-shot-rubrics/<id>.md  # calibration examples per profile
skills/saga-<id>/SKILL.md      # host-LLM-visible skill descriptors
```

The non-trivial design choices (continue-site dispatcher, loose stage-spec, cascading recovery, data-driven deep evaluator) are explained in [`docs/zh/codebase-walkthrough.md`](docs/zh/codebase-walkthrough.md). Read it before structural changes.

## What kind of change goes where

| Adding… | Files to touch |
|---|---|
| A new hard-check kind | `src/stage-spec/hard-check-kinds.ts` (declare kind + traits) → `src/stage-spec/done-criteria.ts` (handler) → test |
| A new recovery layer | `src/coordinator/state.ts` (add `Transition` kind) → `src/recovery/cascading-chain.ts` (slot into `classifyRecovery`) → `src/coordinator/advance.ts` (continue-site for the new kind) |
| A new profile | `src/coordinator/state.ts` (`ProfileId`) → `src/profiles/index.ts` (definition) → `profiles/<id>-default.json` (checklist) → `data/few-shot-rubrics/<id>.md` → `src/prompts/{worker-tools,planner-examples}-<id>.md` → `skills/saga-<id>/SKILL.md` |
| A state machine change | `src/coordinator/state.ts` (transition / termination type) → `src/coordinator/advance.ts` (continue-site) → `npm run typecheck` will list every site that hasn't handled the new variant |

## Conventions

- **No `if (profile === ...)` in `src/`.** Per-profile differences belong in `profiles/<id>-default.json` or a per-profile file under `src/prompts/`.
- **Only `src/adapters/` may import the OpenClaw SDK.** Everywhere else depends on `AdvanceDeps` (in `src/coordinator/state.ts`) so it can be unit-tested without a live gateway.
- **State writes go through `coordinator/advance.ts`.** Tools and hooks should not mutate `state.json` directly.
- **Worker artifacts come through the `artifacts` parameter on `saga_advance`.** Don't have workers write files directly — the evaluator reads only what was submitted.

## Tests

- Unit tests live in `test/*.test.ts` and run as part of `npm test`. They use stubbed `AdvanceDeps` — no Docker required.
- LLM regression tests (which need a real OpenClaw gateway running in Docker) are not part of this repo. They have their own infrastructure.
- `test/profile-config.test.ts` enforces that every profile has all required files. If you add a profile, that test will tell you what's missing.

Before opening a PR:

```bash
npm run typecheck
npm test
```

Both should be green.

## Commit messages

No strict convention. Imperative mood is preferred (`add ops profile`, `fix planner parser on missing evaluator field`). Reference the area you're touching when useful (`coordinator: …`, `evaluator-deep: …`).

## Releasing (maintainers)

Releases are cut by tagging a commit. `.github/workflows/release.yml` runs on `v*` tags and:

1. Runs typecheck + tests + build
2. Verifies the tag matches `package.json` version
3. `npm publish` (with provenance + public access) to npmjs
4. Creates a GitHub Release with the `.tgz` attached as both:
   - `openclaw-plugin-saga-<version>.tgz` (versioned, reproducible)
   - `openclaw-plugin-saga.tgz` (stable name — used by `releases/latest/download/` URLs)

### One-time setup

Add an `NPM_TOKEN` secret in the repo settings (Settings → Secrets and variables → Actions → New repository secret). Generate the token at npmjs.com → Access Tokens → Generate New Token → choose **Automation** type. The token needs publish rights on `openclaw-plugin-saga`.

### Cutting a release

```bash
# bump version (patch / minor / major), update package.json, create git tag
npm version patch

# push commit + tag together
git push --follow-tags
```

The workflow takes over from there. Watch the Actions tab; on success, the new version appears on npm and as a GitHub Release.

If the workflow fails halfway through (npm published but Release failed, or vice versa), fix the underlying issue and re-run only the failed jobs from the Actions tab; do not delete the tag and re-push — that breaks the provenance attestation.

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see [`LICENSE`](LICENSE)).
