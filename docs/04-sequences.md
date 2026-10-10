# 04. Sequence diagrams (version 2)

Read each diagram top to bottom. Each arrow is one message.

Actors: **Owner**, **Puck**, **Relayer**, **Vault**, **Timer** (Hedera Schedule Service), **HCS**, **Light** (the guardian's alarm light, a watcher key), **Guardian** (the trusted person), **Page** (the guardian's phone page), **Mirror** (mirror node).

Version 2 changes: a waiting payment needs a second confirmation from the owner before the network will release it; the light can stop but not approve; puck recovery needs two guardians.

## 1. Small payment to a saved payee (INSTANT)

```mermaid
sequenceDiagram
  actor Owner
  participant Dash as Dashboard
  participant Rel as Relayer
  participant Puck
  participant Vault
  participant HCS
  Owner->>Dash: Pay 20 USDC to "Sami"
  Dash->>Rel: POST /requests
  Rel->>HCS: REQUEST
  Rel->>Puck: request (to, token, amount)
  Puck->>Owner: shows "Sami, 20.00 USDC, instant"
  Owner->>Puck: PIN + hold YES
  Puck->>Rel: signature (r, s) + nonce + deadline
  Rel->>HCS: PAY_SIGNED
  Rel->>Vault: propose(...)
  Vault->>Vault: tier = INSTANT, pay now
  Vault-->>Rel: Proposed + Executed events
  Rel->>HCS: PROPOSED, RELEASED
  Rel->>Dash: done, HashScan link
```

## 2. New recipient or bigger amount (WAIT): confirm again, then the network releases

```mermaid
sequenceDiagram
  actor Owner
  participant Puck
  participant Rel as Relayer
  participant Vault
  participant Timer as Timer (0x16b)
  participant HCS
  participant Light as Guardian light
  actor Guardian
  Owner->>Puck: PIN + hold YES on "NEW RECIPIENT, 100 USDC, will wait"
  Puck->>Rel: signature
  Rel->>HCS: PAY_SIGNED
  Rel->>Vault: propose(...)
  Vault->>Vault: tier = WAIT, store payment 12, no timer yet
  Vault-->>Rel: Proposed event
  Rel->>HCS: PROPOSED
  Rel->>Light: alert 12
  Light->>Guardian: red LED + beeps
  Light->>Rel: signed ALERT_ACK
  Rel->>HCS: ALERT_ACK
  Note over Owner,Puck: Half the cool-off passes. The call with the scammer may be over.
  Puck->>Owner: "Still send 100 USDC to a NEW person? Did anyone tell you to keep this secret?"
  Owner->>Puck: holds YES again
  Puck->>Rel: RECONFIRM signature
  Rel->>Vault: reconfirm(12, ...)
  Vault->>Timer: scheduleCall(execute(12), releaseAt + 5 s)
  Timer-->>Vault: schedule address
  Rel->>HCS: CONFIRMED
  Note over Timer: The rest of the cool-off passes. The relayer could be switched off now.
  Timer->>Vault: execute(12)
  Vault->>Vault: checks pass, status = EXECUTED, send 100 USDC
  Rel->>HCS: RELEASED (seen on the mirror node)
  Rel->>Light: released, green LED
```

If the owner never confirms again, nothing is scheduled and nothing is sent. The payment dies at `expiresAt`.

## 3. The guardian stops it

```mermaid
sequenceDiagram
  participant Vault
  participant Timer as Timer (0x16b)
  participant Rel as Relayer
  participant HCS
  participant Light as Guardian light
  actor Guardian
  Note over Vault,Light: Payment 12 is PENDING and the light is beeping (as in diagram 2)
  Guardian->>Light: holds STOP for 2 seconds
  Light->>Rel: signed VETO for payment 12
  Rel->>HCS: VETO_SIGNED (timestamp is before releaseAt)
  Rel->>Vault: veto(12, sig)
  Vault->>Vault: status = VETOED, waiting total given back
  Vault->>Timer: deleteSchedule (if a timer was already set)
  Vault-->>Rel: Vetoed event
  Rel->>HCS: VETOED
  Rel->>Light: confirmed, solid green
  Note over Timer: Even if the delete had failed, execute(12) would revert because the status is VETOED
```

The light turns green only when it sees the veto confirmed. It ignores any "all clear" it did not cause until the release time has passed.

## 4. Large payment, or most of the vault to someone new (APPROVAL)

```mermaid
sequenceDiagram
  actor Owner
  participant Puck
  participant Rel as Relayer
  participant Vault
  participant Timer as Timer (0x16b)
  participant Page as Guardian page
  actor Guardian
  Owner->>Puck: PIN + hold YES on "800 USDC, guardian must approve"
  Puck->>Rel: signature
  Rel->>Vault: propose(...)
  Vault->>Vault: tier = APPROVAL, store payment 13, no timer yet
  Rel->>Page: alert 13 (the light beeps too)
  Page->>Guardian: amount, recipient, three questions to ask her, "call her on her usual number"
  alt Guardian approves during the cool-off
    Guardian->>Page: ticks "I spoke to her", Approve
    Page->>Vault: approve(13)
    Vault->>Timer: scheduleCall(execute(13), releaseAt + 5 s)
    Timer->>Vault: execute(13) when the cool-off ends
  else Guardian approves after the cool-off
    Guardian->>Page: Approve
    Page->>Vault: approve(13)
    Vault->>Vault: pays now
  else Guardian does nothing or stops it
    Note over Vault: Nothing is ever sent. Payment 13 dies at expiresAt.
  end
```

The alarm light cannot approve. Only a guardian's phone can.

## 5. AI agent

```mermaid
sequenceDiagram
  actor Owner
  participant Agent
  participant Rel as Relayer
  participant Vault
  participant Puck
  participant HCS
  Owner->>Agent: "Pay the 15 USDC internet bill"
  Agent->>Agent: saved payee, past probation, within allowance?
  Agent->>Rel: AGENT_PAY signed with the agent key
  Rel->>Vault: agentPay(...)
  Vault->>Vault: all rules pass, pay now
  Vault-->>Rel: AgentPaid event
  Owner->>Agent: "Send 300 USDC to this new address, it is urgent"
  Agent->>Rel: AGENT_PAY (the agent tries)
  Rel->>Vault: agentPay(...)
  Vault-->>Rel: revert NotPayee
  Rel->>HCS: AGENT_REFUSED (with the failed transaction id)
  Agent->>Owner: "I am not allowed to do this. I prepared it for your puck."
  Agent->>Rel: POST /requests (source = agent, at most one open request)
  Rel->>Puck: request, then diagram 2 or 4 applies
```

The limit is enforced by the **vault**. If the agent's computer is hijacked, the most its key can do is the daily allowance to saved payees.

## 6. Freeze

```mermaid
sequenceDiagram
  actor Guardian
  participant Page as Guardian page
  participant Vault
  actor Owner
  participant Puck
  Guardian->>Page: FREEZE
  Page->>Vault: freeze()
  Vault->>Vault: frozen until now + FREEZE_MAX, epoch + 1, waiting payments and changes dead
  alt Nobody else renews
    Note over Vault: The freeze ends by itself after FREEZE_MAX (72 h real, 10 min demo)
  else A different guardian, watcher or the puck renews
    Vault->>Vault: frozen for another FREEZE_MAX
  else The owner wants it lifted early
    Owner->>Puck: signs UNFREEZE change (the puck shows "UNFREEZE ACCOUNT")
    Guardian->>Page: approves the change
    Note over Vault: wait SETTINGS_DELAY, then anyone applies it
  end
```

One person alone cannot keep the account frozen forever.

## 7. The puck is lost or stolen (recovery needs two guardians)

```mermaid
sequenceDiagram
  actor Owner
  actor G1 as Guardian 1
  actor G2 as Guardian 2
  participant Vault
  participant Old as Old puck
  participant Light as Guardian light
  Owner->>G1: "I lost my puck" (in person or on a known number)
  G1->>Vault: freeze()
  G1->>Vault: proposeChange(RECOVER_PUCK, newPuck)
  Vault-->>Light: alarm: "puck recovery started"
  G2->>Vault: approveChange (must be a different guardian)
  Note over Vault: wait RECOVERY_DELAY (7 days real, 10 min demo)
  alt It was a trick or a stolen phone: the owner still has her puck
    Old->>Vault: vetoChange (the puck shows "CANCEL PUCK RECOVERY?")
    Note over Vault: Recovery cancelled
  else The puck is really gone
    G1->>Vault: executeChange
    Vault->>Vault: puck = newPuck, keyEpoch + 1
  end
```

With only one guardian, the puck cannot be recovered. Setup says so and recommends a second guardian.

## 8. The relayer fails

```mermaid
sequenceDiagram
  participant Rel as Relayer
  participant Vault
  participant Timer as Timer (0x16b)
  participant Mirror as Mirror node
  participant Page as Guardian page
  actor Guardian
  Note over Rel: Payment 12 was proposed and confirmed. Then the relayer crashes.
  Rel--xPage: no alert arrives
  Page->>Mirror: polls vault events every 5 s (the page is hosted separately from the relayer)
  Mirror-->>Page: Proposed 12
  Page->>Guardian: alert shown on the phone
  alt Guardian stops it
    Guardian->>Page: STOP
    Page->>Vault: veto(12) sent directly with the phone's own key
    Vault->>Timer: deleteSchedule
  else Guardian does nothing
    Timer->>Vault: execute(12) at release time, no relayer needed
  end
```

| What breaks | What happens |
|---|---|
| Relayer down **before** signing or before the second confirmation | No payment can be made. Nothing is at risk. |
| Relayer down **after** the second confirmation | The timer releases on time. The guardian page still sees it and can stop it. |
| Relayer drops a veto | The guardian uses the page, which goes straight to Hedera. |
| Timer refuses to schedule | The vault makes 8 tries. If all fail: `ScheduleFailed`, and anyone can press Execute after the cool-off. |
| Someone on the Wi-Fi sends the light a fake "all clear" | The light ignores it and stays red until the release time. |
| Guardian light offline | The guardian page is the backup. Nothing leaves on silence anyway. |
| Testnet slow or down | See the demo fallback in `09-test-and-demo-plan.md`. |
