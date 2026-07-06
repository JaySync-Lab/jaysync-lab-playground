# Phase 3 Execution Brief — for Claude Code

This is the implementation plan for the playground's session controller
(Phase 3). Full detail is in `playground-phase3-session-controller-plan.md`
in this repo — read that fully first. This file is just the execution
discipline on top of it.

## How to work through this

Go step by step, in the order the plan lays out (3.1 → 3.9). After
completing each step:

1. Run that step's own "Verify before continuing" checklist yourself —
   don't just assume a command succeeded because it didn't error.
2. Report back what you did and what the verification showed.
3. **Stop and wait for explicit go-ahead before starting the next step.**
   Do not chain multiple steps together in one pass, even if they seem
   safe — this project has already had one incident (during the docs
   pipeline work) where an unsupervised multi-step run pushed further than
   intended. Small, confirmed steps are the standard here.

## Hard stops — do not proceed past these without explicit confirmation

- **Step 3.1, before `pct destroy 105`:** this is irreversible. Show me
  what you found when inspecting CT 105's contents, and explicitly ask
  "OK to destroy?" before running the destroy command. Do not run it as
  part of the same message/turn where you inspected the container.
- **Step 3.3, before creating the Proxmox role/token:** these are live
  permission grants on the actual hypervisor. Show me the exact `pveum`
  commands you're about to run before running them.
- **Step 3.4 onward (any step that actually clones CT 180):** each real
  clone consumes a VMID and disk space. After any test clone, confirm it
  gets destroyed again (`pct list`) before moving on — don't leave test
  artifacts sitting on the host between steps.
- **Step 3.8, the full end-to-end test:** this is the first time
  everything runs together for real. Narrate each of the six scenarios as
  you run them, don't just report a final "all passed."

## Connection details

SSH to the Proxmox host via Tailscale — use whatever alias/hostname is
already configured for it in this environment. Confirm you're on the
correct host (`hostname` command) before running any `pct`/`pveum`
command — this project has previously had an incident where a command
meant for inside a container was accidentally run on the Proxmox host
itself. Always check context first.

## Where controller code should live

Write the actual controller (FastAPI app, requirements, systemd unit file)
into this repo (`jaysync-lab-playground`), under a new `controller/`
directory — not directly on CT 105 with no source control. Deploy to CT
105 by copying/pulling from this repo, so the running code always
corresponds to something committed.

## Documentation note

Don't touch `JaySync-Lab`'s docs (Step 3.9) until the controller is
actually working end-to-end (after Step 3.8 passes). Writing docs for a
service that doesn't exist yet contradicts the "document as built, not
planned" principle already established in this project.
