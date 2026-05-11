# Ops Evaluator Calibration Examples

These examples calibrate the boundary between PASS, FAIL-REWORK, and FAIL-ESCALATE.

---

## Example 1 — PASS (well-diagnosed, command-evidenced, reversible)

**Stage goal**: Diagnose why the home WiFi drops every evening around 9pm.

**Output excerpt**:
> Diagnosis: The 5GHz channel was overlapping with a neighbour's AP that broadcasts at 9pm (confirmed via `iw wlan0 scan` — neighbour's BSSID cc:dd:ee:ff:00:11 appeared on channel 36 at 21:00).
>
> Runbook:
> 1. `iw dev wlan0 set channel 149` — move to 5GHz channel 149 (less congested). **Revert**: `iw dev wlan0 set channel 36`
> 2. `uci set wireless.radio0.channel='149' && uci commit` — persist across reboot. **Revert**: `uci set wireless.radio0.channel='36' && uci commit`
>
> Memory entry appended to `memory/2026-05-05.md`.

**Checklist**:
- H1 PASS: Every claim backed by command output (`iw scan` confirmed channel overlap).
- H2 PASS: Every change has a revert command documented.
- H3 PASS: Memory entry written with symptom, diagnosis, remediation, devices touched.
- S1 score 5: Systematic hypothesis elimination (interference → channel scan → channel change).
- S2 score 5: Revert commands for both runtime and persistent config changes.

**Verdict**: passed=true, escalate=false, score=4.5

---

## Example 2 — FAIL-REWORK (claims without evidence, fixable)

**Stage goal**: Diagnose why the NAS is unreachable from the laptop.

**Output excerpt**:
> The NAS probably has a static IP conflict. I think the new smart TV grabbed the NAS's IP via DHCP. You should set a static DHCP reservation for the NAS and restart it.

**Checklist**:
- H1 FAIL-REWORK: Claims "IP conflict" and "smart TV grabbed NAS IP" without any command evidence. Running `arp -a`, `ping <nas-ip>`, or checking DHCP leases would confirm or refute.
- H2 FAIL-REWORK: "Set a static DHCP reservation" has no specific command or revert path.
- H3 FAIL-REWORK: No memory entry.

**Verdict**: passed=false, escalate=false, score=1.5
**Issues**: "Run `arp -a` and check DHCP lease table to confirm IP conflict hypothesis", "Provide specific commands with revert steps", "Write memory entry after diagnosis is confirmed"

---

## Example 3 — FAIL-ESCALATE (genuinely impossible to diagnose remotely)

**Stage goal**: Determine why the garage door opener stopped responding to the smart home hub.

**Output excerpt**:
> Ran `ping 192.168.1.50` — no response. Ran `arp -a` — MAC not in ARP table. The opener does not appear on the network at all. Checked router DHCP leases — no entry for this MAC in the last 7 days. The opener uses a proprietary radio protocol (not WiFi) bridged through a hub; the hub itself is reachable (`ping 192.168.1.51` OK) but reports the opener as "offline" via its API (`curl http://192.168.1.51/api/devices` → `{"opener": "offline"}`).
>
> Likely hardware failure in the opener unit or its radio module. This cannot be diagnosed further via software — physical inspection is needed.

**Checklist**:
- H1 PASS: Systematic evidence trail (ping, ARP, DHCP, hub API all tried and documented).
- H2 N/A: No changes were made — diagnosis only, as the device is unreachable.
- H3 FAIL-ESCALATE: The issue requires physical access. No software remediation is possible. Writing a memory entry now would be premature — the root cause is unknown.

**Verdict**: passed=false, escalate=true, score=3.5
**Issues**: "Device is physically unreachable — requires on-site inspection or hardware replacement"

**Escalation note**: The worker exhausted all remote diagnostic paths. The evaluator should NOT ask for rework — no amount of additional commands will fix a dead radio module. This should pause for human decision: schedule physical inspection, or mark as known-hardware-failure and write a minimal memory entry.

---

## Example 4 — FAIL-ESCALATE vs FAIL-REWORK boundary

The distinction: ask yourself **"If the worker ran more diagnostic commands and checked more logs, would this criterion be satisfiable?"**

- YES → FAIL-REWORK
- NO (device is physically dead, firmware is proprietary and undocumented, or access requires credentials the user hasn't provided) → FAIL-ESCALATE

When uncertain, prefer FAIL-REWORK. Only use FAIL-ESCALATE when you are confident the issue is beyond software remediation or the information needed is unavailable.
