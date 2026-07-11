# Community Contribution Pipeline — Terminal Content
## Implementation Plan

**Status: fully planned, not started.** This document is the source of
truth for scope and design; issue tracking (`Future: community
contribution pipeline for terminal content`) exists only as a pointer
back here. Nothing described below has been built.

---

## Goal

Let people outside this project submit interactive terminal content —
games, animations, small demos — that gets reviewed, validated, and
folded into the golden template (CT 180) as a curated command available
to every future playground session, alongside the existing `tour`,
`status`, `neofetch`.

## Why this needs more than the docs pipeline's model

`jaysync-lab-site`'s docs pipeline (`rebuild-from-docs.yml`) validates
submissions with a single automated gate: a pre-flight `npm run build`,
and if it passes, content merges and deploys unattended. That's
appropriate there — worst case, a bad doc renders wrong on a page.

It is not appropriate here. A contribution to this pipeline is
executable shell content that ends up baked into the golden template
every future visitor's session is cloned from — a public, internet-
exposed, disposable Linux sandbox. Automated checks alone cannot catch
a submission that's subtly hostile (fork bombs, resource exhaustion,
attempts to escape the sandbox's existing hardening, disguised network
calls) the way a `build` step catches a broken Markdown link. This
pipeline assumes any submission is untrusted until a human has actually
read it and it has actually run inside the sandbox.

## Scope: bash-only submissions

Contributions are plain bash — no compiled binaries, no interpreted
languages beyond what's already curated (the sandbox's disallowed-
command list, e.g. `curl`, `python3`, `gcc`, stays as-is; a contribution
can't introduce a new way around it). This keeps the review surface
small enough for a human to actually read every submission end to end,
and matches the sandbox's existing "curated commands only" model rather
than opening it into a general-purpose scripting platform.

## Four-gate review process

Every submission passes all four gates, in order, before it's eligible
for the next golden-template retemplate. Failing any gate ends the
review — it does not skip to a later gate.

1. **Automated checks.** Static analysis on the submitted script:
   syntax validation (`bash -n`), a lint pass (`shellcheck`), and a
   policy check against a denylist of patterns that have no legitimate
   use in a curated terminal demo (raw network syscalls, `fork`-bomb
   shapes, attempts to write outside the expected paths, references to
   binaries already excluded from the sandbox). This gate is fast and
   catches the obviously wrong; it is explicitly not sufficient on its
   own, unlike the docs pipeline's single-gate model.

2. **Mandatory human review.** No submission reaches gate 3 without a
   maintainer actually reading it — this is a hard requirement, not a
   fallback for when automated checks are inconclusive. Gate 1 passing
   is a prerequisite for review, not a substitute for it.

3. **Sandboxed test run.** The reviewed script runs inside a real,
   isolated session clone (the same disposable-clone infrastructure
   every visitor session already uses — not a separate test harness),
   observed directly: does it do what it claims, does it stay within
   expected resource limits, does it exit cleanly. This is the same
   "verify against the real system, not assumption" discipline used
   everywhere else in this project.

4. **Retemplate integration.** Only after gates 1-3 pass does the
   script get added to the golden template's curated command set, via
   the same retemplate cycle already used for infrastructure fixes
   (clone CT 180, apply the change, verify directly, convert to
   template, cycle the VMID back to 180 — see `implementation-log.md`
   for the established procedure and its known mechanical side effects,
   e.g. `/vms/180` ACL grants needing re-creation after a destroy).

## Retemplate cadence: per-contribution, not batched

Each accepted contribution gets its own retemplate cycle rather than
being queued and batched with others. This is a deliberate tradeoff:
batching would mean a bad contribution's investigation blocks every
other pending one from shipping, and would make it harder to isolate
which specific change caused a regression if the post-retemplate
verification checklist ever fails. A slower, one-at-a-time cadence costs
more operator time per contribution but keeps blast radius and
attribution both contained to a single change. (This is the opposite
policy from issue #16's tmux fix, which explicitly batched — that
distinction matters: #16 was internal, already-trusted infrastructure
fixes with no review-trust question; this pipeline is untrusted
external input, where isolating each change is the point.)

## Explicitly out of scope for now

- Non-bash submissions (compiled binaries, other interpreters).
- Any automated-only fast path, regardless of how simple a submission
  looks — gate 2 has no bypass.
- Contributor-facing tooling (submission templates, a review dashboard,
  CI wiring) — this plan covers the review model, not the tooling to
  operate it, since nothing here has been built yet.

## Open questions (to resolve before implementation starts)

- Where do submissions actually come from — GitHub PRs against this
  repo, a separate intake form, something else?
- Who has standing authority to perform gate 2 (mandatory human
  review) — just the repo owner, or a wider trusted set?
- What exact resource limits does gate 3's sandboxed run check against,
  and how are they measured (reuses the existing `pids.max`/cgroup
  limits already baked into CT 180, or something additional)?
