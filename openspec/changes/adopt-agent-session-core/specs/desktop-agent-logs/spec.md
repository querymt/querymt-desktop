# Spec Delta

## Purpose

Defines when the desktop collects and shows agent runtime logs, so that log output from a busy agent costs no UI work while nobody is looking at it.

## ADDED Requirements

### Requirement: Logs shown on demand
The Agents page SHALL show each agent's newest 200 retained log entries when it opens and SHALL append new entries while it stays open. While no view shows logs, the desktop UI SHALL NOT process individual log entries.

#### Scenario: Opening the Agents page shows retained logs
- **WHEN** an agent has printed 300 lines and the user then opens the Agents page
- **THEN** the page shows the newest 200 entries

#### Scenario: Open page receives new entries
- **WHEN** the Agents page is open and the agent prints 10 more lines
- **THEN** the 10 entries appear, and the list still holds at most 200 entries

#### Scenario: Log flood with the page closed costs no UI work
- **WHEN** an agent prints 10,000 stdout lines while the Agents page is closed
- **THEN** no log state in the UI changes and no log entry is delivered to the webview

### Requirement: Log delivery is batched
While a view shows logs, log entries SHALL be delivered in batches rather than one event per line, and the order of entries SHALL be kept.

#### Scenario: Burst arrives in order
- **WHEN** the agent prints 1,000 lines in one burst while the Agents page is open
- **THEN** the page receives them in fewer than 1,000 deliveries and shows them in printed order
