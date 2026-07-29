# Ferry Sound

A joyful, beautiful, reliable companion for Washington State Ferries riders: a realtime fleet map you could hang on a wall, an honest trip planner ("run for the 5:30 or relax for the 6:20?"), delay alerts people actually rely on, and 14 years of on-time truth.

Also a portfolio flagship: pure-play AWS, Terraform-managed, and built through a documented end-to-end process.

## Status

M0 foundations in flight: Terraform skeleton, OIDC-only CI, and billing guardrails deployed to [ferrysound.com](https://ferrysound.com). Founding phases (PRD, design, architecture) are closed.

- 📘 **[Product Requirements (PRD)](docs/PRD.md)** - vision, five v1 features, SLOs, the $15 cost ceiling, roadmap
- 🗺️ **[Architecture](docs/architecture.md)** - deployed state + target state, kept current
- 🧭 **[ADR-0000: how this project is built](docs/adr/0000-development-process.md)**
- ⚖️ **[ADR-0001: serverless lakehouse, decided by spike bake-off](docs/adr/0001-architecture-cost-bakeoff.md)** · [ADR-0002: design direction](docs/adr/0002-design-direction.md) · [ADR-0003: tile hosting](docs/adr/0003-tile-hosting.md) · [ADR-0004: state backend + CI](docs/adr/0004-state-backend-and-ci.md)
- 🚢 **Data source reference:** `api-exploration-wsdot-ferries/` - verified facts about the WSDOT ferries API (see CLAUDE.md Data Sources)

## Stack (fixed)

Next.js (web) · Python (services/ETL) · Terraform (all infra) · AWS end to end (hosting, auth, data, alerting)

## Roadmap

M0 foundations -> M1 the map (+ ambient wall mode) -> M2 trip planner + fares -> M3 alerts -> M4 stats + capacity. Details and exit criteria in the [PRD](docs/PRD.md).
