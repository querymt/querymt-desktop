# Spec Delta

## Purpose

Defines how ACP traffic reaches the desktop UI with minimal overhead: messages parsed once, queued messages delivered together, and connection status kept in order with data.

## ADDED Requirements

### Requirement: Single-parse message delivery
The desktop SHALL deliver ACP messages from the agent process and from native WebSocket connections to the UI as raw newline-delimited JSON bytes, so each message is parsed exactly once in the UI. Message content and order SHALL be unchanged. A message that is not valid JSON SHALL fail the connection, as today, rather than being dropped.

#### Scenario: Large load response
- **WHEN** the agent sends a 5 MB session load response
- **THEN** the UI receives the same message content, parsed once, without it being embedded as a string in another JSON message

#### Scenario: Message split across deliveries
- **WHEN** a message's bytes arrive in the UI across two deliveries
- **THEN** the UI reassembles and processes it as one message

#### Scenario: Message containing line breaks
- **WHEN** a WebSocket text message contains raw line breaks as JSON whitespace
- **THEN** the UI receives it as one message with the same content

#### Scenario: Malformed message
- **WHEN** a native WebSocket connection receives a message that is not valid JSON
- **THEN** the UI reports the connection as failed

### Requirement: Queued messages delivered together
When several messages from one connection are already waiting, the desktop SHALL deliver them to the UI in a single delivery of at most 256 messages or 256 KiB. It SHALL NOT delay a message to wait for others.

#### Scenario: History replay burst
- **WHEN** the agent emits 5,000 session updates in quick succession
- **THEN** the UI receives them in far fewer deliveries than messages, in their original order

#### Scenario: Single message
- **WHEN** one message arrives and no other message is waiting
- **THEN** it is delivered immediately

### Requirement: Connection status delivered after data
Connection closure and connection errors SHALL be reported to the UI with the same reasons as before, and only after every message received before them has been delivered, whatever its size.

#### Scenario: Server closes after a large message
- **WHEN** the agent sends a 5 MB message and then closes the WebSocket connection with a reason
- **THEN** the UI receives the complete message, then the closure with that reason

#### Scenario: Agent process exits after its last response
- **WHEN** the agent process writes a response and then exits
- **THEN** the UI receives the response before the exit is reported

### Requirement: Delivery across webview reloads
When the webview reattaches to an agent process that kept running, each message SHALL be delivered once: none lost, none duplicated, and no delivery containing part of a message from before the reattach.

#### Scenario: Reload during a load
- **WHEN** the webview reloads while the agent is sending a session load response
- **THEN** the reattached UI receives every later message exactly once and in order
