# Spec Delta

## Purpose

Enables users to leave session-scoped ACP form questions unanswered for extended periods and recover them after a client transport reconnect without falsely cancelling the agent's pending work.

## ADDED Requirements

### Requirement: Long-lived unanswered form questions
The system SHALL keep a session-scoped form elicitation pending while its originating agent process and run remain active, without a wall-clock response timeout. It MUST distinguish the client's explicit `accept`, `decline`, and `cancel` actions from transport failures or missing responses; only an explicit `cancel` MAY be described as user cancellation.

#### Scenario: User returns hours later
- **WHEN** the agent asks a form question and the user does not answer for several hours while the agent run remains active
- **THEN** the originating tool remains waiting and the question remains available, with no timeout-generated `cancel` or false user-cancellation error

#### Scenario: Transport fails before user responds
- **WHEN** an elicitation request cannot be delivered, its WebSocket disconnects, or its response is malformed
- **THEN** the system does not synthesize `accept`, `decline`, or `cancel` and retains the pending question for eligible recovery

#### Scenario: User explicitly dismisses question
- **WHEN** the authorized client responds with ACP action `cancel`
- **THEN** the waiting tool receives a cancellation outcome attributed to the user

### Requirement: Authorized recovery across ACP connections
The system SHALL allow a client authorized to resume the original interaction to discover its outstanding session-scoped form questions, including those in sessions not currently open in the UI. The system MUST bind discovery, delivery, and resolution to the original receiving client authority and, when authentication is available, its verified user identity; knowledge of a `sessionId`, elicitation ID, or unverified self-reported identity alone MUST NOT grant access. If the client cannot establish a secure recovery authority, the system MUST reject recovery rather than reveal a question or accept a response.

#### Scenario: Reconnect to an off-screen session
- **WHEN** an authorized client reconnects while a question in a non-active session is pending
- **THEN** the client can discover the pending session and receive a new ACP `elicitation/create` request for the still-unanswered question

#### Scenario: Unrelated client attempts recovery
- **WHEN** a different client supplies a known session or elicitation ID without valid recovery authority
- **THEN** it cannot discover the question content, reattach to the question, or answer it

#### Scenario: Client lacks elicitation capability
- **WHEN** a recovered connection has not advertised non-null `clientCapabilities.elicitation.form`
- **THEN** the agent does not send a form `elicitation/create` request to that connection and leaves the question pending for an eligible client

### Requirement: Re-delivery follows ACP request semantics
The agent SHALL issue a fresh standard ACP `elicitation/create` request with a connection-local JSON-RPC request ID for each authorized delivery attempt. It MUST retain a stable opaque question identity across attempts, accept no more than one valid terminal response for each question, and reject or ignore stale or unauthorized delivery responses. For `accept`, it MUST validate submitted form content against the requested schema before completing the waiting tool; invalid content MUST NOT be treated as a user cancellation.

#### Scenario: Answer after reconnection
- **WHEN** an authorized reconnecting client receives a fresh request for an outstanding question and submits valid form content
- **THEN** the original waiting tool resumes exactly once with the accepted answer

#### Scenario: Old connection replies after recovery
- **WHEN** a response arrives from a superseded delivery attempt after a new connection has attached
- **THEN** the old response cannot overwrite or complete the current question

#### Scenario: Invalid submitted form
- **WHEN** an authorized client submits accepted form content that fails the requested schema
- **THEN** the system reports validation failure rather than delivering the invalid answer or labelling it a user cancel

### Requirement: Desktop inbox survives temporary transport loss
The desktop SHALL retain pending question items and in-progress form drafts across a temporary ACP transport disconnect in the same running desktop application. While offline, it MUST prevent submission; after authorized reconnection it SHALL bind each re-delivered request to the existing question item and reconcile with the agent's authoritative pending set. Receiving the same stable question identity MUST NOT generate an ACP `cancel` response.

#### Scenario: Reconnect with an unfinished draft
- **WHEN** a desktop transport drops with a partly completed form and later reconnects to the same pending question
- **THEN** the inbox contains one actionable question with the draft preserved, and the answer is sent on the new ACP request

#### Scenario: Question already completed elsewhere
- **WHEN** the agent's authoritative pending set no longer includes an offline inbox question
- **THEN** desktop removes its actionability without sending a fabricated user action

### Requirement: Terminal lifecycle and scope
The system SHALL retire pending questions when the originating run is explicitly cancelled, the session is terminated, or its waiting tool ends. An agent-process restart is not required to restore an interrupted run. Terminal history MUST NOT disclose submitted answer content solely to implement recovery and MUST NOT replay an already-resolved question as actionable.

#### Scenario: Session stop while waiting
- **WHEN** the user stops a run that is awaiting a question
- **THEN** the run stops, the question ceases to be actionable, and a later reconnection cannot revive it

#### Scenario: Resolved question in history
- **WHEN** a client reloads a session after its question has already been answered
- **THEN** it may see historical request and terminal outcome but receives no actionable duplicate
