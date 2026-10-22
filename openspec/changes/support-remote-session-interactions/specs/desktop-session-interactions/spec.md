# Spec Delta

## Purpose

Defines how the desktop keeps permission requests safe across transport loss and reports remote-node incompatibility, so remote and local sessions behave the same from the user's point of view.

## ADDED Requirements

### Requirement: Permission requests survive temporary transport loss
The desktop SHALL retain pending permission request cards across a temporary ACP transport disconnect in the same running application. While offline, the cards MUST NOT be actionable and the desktop MUST NOT send any permission outcome, including `cancelled`, for them.

#### Scenario: Disconnect with a pending permission request
- **WHEN** the ACP transport drops while a permission request card is pending
- **THEN** the card remains in the inbox as temporarily unavailable and no response is sent to the agent

#### Scenario: Reconnect re-delivers the request
- **WHEN** the transport reconnects and the agent re-delivers the same permission request
- **THEN** the existing card becomes actionable again, there is still one card for that request, and the selected option is sent on the new request

#### Scenario: Answer while offline
- **WHEN** the user tries to answer a permission card while the transport is offline
- **THEN** the desktop prevents the submission and sends nothing

### Requirement: Permission requests carry a stable interaction identity
The agent SHALL include the pending interaction's ID as `_meta.querymt.interaction_id` on every `session/request_permission` request, for local and remote-hosted sessions, and the desktop SHALL identify a permission card by that ID. The ID MUST match the ID the agent lists for recovery.

#### Scenario: Same tool call, different requests
- **WHEN** two permission requests share a tool-call ID but have different interaction IDs
- **THEN** the desktop shows two separate cards

#### Scenario: Rejected answer is re-delivered
- **WHEN** the agent rejects an answered permission request and re-delivers it
- **THEN** the re-delivery rebinds to the same card and there is no second card or notification

### Requirement: Pending permissions are recoverable like questions
After a recovery attach, the agent SHALL deliver every pending permission of the session to the attaching connection as a standard `session/request_permission` request, and SHALL issue a resume authority when a permission request is raised, including for a session that has no pending form question.

#### Scenario: Attach claims a pending permission
- **WHEN** a client recovers a session with a pending permission through the recovery attach
- **THEN** the client receives that permission request and its answer decides the waiting tool call

#### Scenario: Permission-only session
- **WHEN** a permission request is raised in a session with no pending form question over a secure transport
- **THEN** the client receives a resume authority for that session

### Requirement: Permission cards reconcile with the agent's pending set
After a reconnect, the desktop SHALL remove any permission card the agent no longer reports as pending. Removal MUST NOT send an outcome to the agent and MUST NOT be presented as a user decision.

#### Scenario: Request resolved elsewhere
- **WHEN** a permission request was answered by another client or retired by a run cancel while the desktop was offline
- **THEN** after reconnect its card is no longer actionable and no response is sent

#### Scenario: Remote-hosted request after reconnect
- **WHEN** the desktop reconnects while a permission request from a remote-hosted session is still pending
- **THEN** the desktop shows one actionable card for it, the same as for a locally hosted session

### Requirement: Remote node upgrade-required is reported clearly
When creating, attaching to, or prompting a session on a remote node fails because the node runs an incompatible agent version, the desktop SHALL tell the user that the remote node must be upgraded. It MUST NOT present the failure as a generic prompt error or retry it as if it were transient.

#### Scenario: Create a session on an outdated node
- **WHEN** the user starts a session targeting a remote node whose agent lacks the interaction contract
- **THEN** the desktop shows a message naming the node and stating that it must be upgraded, and no session is left half-created

#### Scenario: Prompt fails with upgrade-required
- **WHEN** a prompt to a remote session fails with the agent's upgrade-required error
- **THEN** the desktop shows the upgrade message and does not display the raw internal error as the primary text
