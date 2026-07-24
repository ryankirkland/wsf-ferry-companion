# WSF Ferry Companion (working title)

A joyful, beautiful, reliable companion for Washington State Ferries riders: a realtime fleet map you could hang on a wall, an honest trip planner ("run for the 5:30 or relax for the 6:20?"), delay alerts people actually rely on, and 14 years of on-time truth.

Also a portfolio flagship: pure-play AWS, Terraform-managed, and built through a documented end-to-end process.

## Status

Pre-implementation. The product is defined; design and architecture phases are next.

- 📘 **[Product Requirements (PRD)](docs/PRD.md)** - vision, five v1 features, SLOs, the $15 cost ceiling, roadmap
- 🧭 **[ADR-0000: how this project is built](docs/adr/0000-development-process.md)**
- ⚖️ **[ADR-0001: architecture bake-off (pending)](docs/adr/0001-architecture-cost-bakeoff.md)**
- 🚢 **Data source reference:** `api-exploration-wsf/` - verified facts about the WSDOT ferries API (see CLAUDE.md Data Sources)

## Stack (fixed)

Next.js (web) · Python (services/ETL) · Terraform (all infra) · AWS end to end (hosting, auth, data, alerting)

## Roadmap

M0 foundations -> M1 the map (+ ambient wall mode) -> M2 trip planner + fares -> M3 alerts -> M4 stats + capacity. Details and exit criteria in the [PRD](docs/PRD.md).
