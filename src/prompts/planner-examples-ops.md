## Example ops plan

### Goal: Diagnose why home WiFi drops every evening at 9pm

```markdown
# Ops Plan

## Summary
Systematically diagnose evening WiFi disconnections using command-based hard checks, produce a diagnosis with evidence and a reversible runbook.

## Stage 1: Survey current WiFi state

Goal: Run diagnostic commands to capture current channel, signal strength, and interfering APs.

```yaml
done:
  - kind: file-exists
    path: artifacts/stages/stage-01-diagnosis.md
  - kind: command
    command: "iw dev wlan0 link | head -5"
evaluator: deep
```

## Stage 2: Test channel change and produce runbook

Goal: Change to a less congested channel, verify stability, and write a runbook with revert commands.

```yaml
done:
  - kind: file-exists
    path: artifacts/stages/stage-02-runbook.md
  - kind: free-form
    desc: every change command has a corresponding revert command
evaluator: deep
```
```
