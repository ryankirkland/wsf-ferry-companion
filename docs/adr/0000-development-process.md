# ADR-0000: Development process for this project

- **Status:** Accepted (2026-07-24)
- **Context:** This project has two products: the ferry app itself, and a demonstrated end-to-end process. Process decisions deserve the same rigor as technical ones, so the process is ADR number zero.

## Decision

Work proceeds in explicit, approval-gated phases, each producing durable documents before code:

1. **PRD first** ([docs/PRD.md](../PRD.md)). Product truth lives there: scope, acceptance criteria, SLOs, cost constraint, roadmap. Material scope changes edit the PRD, not just the code.
2. **Design exploration before UI code** (Phase B). Competing interactive mood boards, chosen with eyes; the winner becomes design tokens and a map visual language documented in docs/design/.
3. **ADRs for consequential choices.** Anything expensive to reverse (architecture, data store, auth model, hosting) gets a numbered ADR with alternatives considered and why the chosen path won - per the repo guideline of always explaining solutions and alternatives. One decision per ADR. Statuses: Proposed, Accepted, Superseded-by-NNNN.
4. **Milestone loops** (M0..M4 from the PRD). Each milestone: plan -> build -> verify end-to-end -> review against acceptance criteria -> update docs -> ship. A milestone is done only when its PRD exit criteria pass in the deployed environment, not on localhost.

## Definition of done (every change)

- E2E-verified the way a user would experience it (per CLAUDE.md: reproduce bugs E2E first; be pixel-picky about UI).
- Lint and tests green; flaky tests fixed, not retried into submission.
- No secrets in code, artifacts, or history; `.env` stays untracked.
- Docs that this change invalidates are updated in the same change (PRD, ADRs, runbooks, data-source references).
- Cost-relevant changes note their monthly delta against the PRD ceiling.

## Data source discipline

Before writing code against any external API, read its reference in `api-exploration-wsf/` (regenerate with the `api-source-exploration` skill when the source drifts). Source docs are descriptive and use-case-agnostic; project decisions live here in ADRs, and feature-coverage verdicts live in CLAUDE.md's Data Sources section.

## Consequences

- Slower start, faster middle: decisions get made once, in writing, instead of re-litigated in every session.
- The repo itself becomes the portfolio artifact for process, with ADRs as the narrative spine.
- Overhead is bounded: ADRs only for expensive-to-reverse choices; everything else is just done per CLAUDE.md guidelines.
