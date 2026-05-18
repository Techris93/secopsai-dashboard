# Dashboard Redesign Agent Plan

## llm-kb Inspection

Command run:

```bash
cd /Users/chrixchange/llm-knowledge-base
./llm-kb --help
./llm-kb agents "redesign an operations dashboard frontend for accessibility contrast readable triage workflow" --limit 12
```

## Selected Agents

- **Frontend Developer**: primary implementation lens for professional dashboard hierarchy, responsive layout, form polish, and interaction clarity.
- **Software Architect**: information-architecture lens for reshaping Triage Ops into a clearer control plane without changing API boundaries.
- **Accessibility Auditor**: WCAG-oriented review lens for contrast, keyboard/focus affordances, readable labels, and mobile usability. This agent is present as `wiki/agents/accessibility-auditor.md`.
- **Security Engineer**: guardrail lens because Triage Ops includes protected close/escalate/blog-draft actions and helper-backed command execution.
- **Code Reviewer**: regression lens for preserving existing dashboard behavior, tests, helper routes, and Cloudflare Pages compatibility.

## Design Direction

The redesign keeps the existing SecOpsAI command-surface brand, but reduces visual debt by making Triage Ops consistently dark, high-contrast, and sectioned. Alert triage is now the main workspace; Campaign Research and Autonomous Discovery move into a collapsed advanced dock so they remain available without dominating daily triage.

## Safety Boundaries

- No helper endpoint contracts are changed.
- Browser-side actions still call protected helper routes only.
- Write actions remain token-gated.
- Campaign and discovery controls remain available, but advanced form density is hidden until the operator expands the dock.
