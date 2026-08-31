use opentelemetry::Context;
use serde::Deserialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;

static NEXT_OPERATION_ID: AtomicU64 = AtomicU64::new(1);

const OPERATION_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Default, Clone)]
pub struct SessionLoadTelemetry {
    operations: Arc<Mutex<HashMap<String, SessionLoadOperation>>>,
}

struct SessionLoadOperation {
    span: tracing::Span,
    started: Instant,
    last_checkpoint: Instant,
    current_phase: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLoadCounters {
    pub live_notifications: Option<u64>,
    pub drained_notifications: Option<u64>,
    pub applied_notifications: Option<u64>,
    pub duplicate_notifications: Option<u64>,
    pub replay_captured_notifications: Option<u64>,
    pub replay_reactive_notifications: Option<u64>,
    pub history_assignments: Option<u64>,
    pub snapshot_events: Option<u64>,
    pub transcript_items: Option<u64>,
    pub tool_calls: Option<u64>,
    pub debug_events: Option<u64>,
    pub dom_nodes: Option<u64>,
    pub long_task_count: Option<u64>,
    pub long_task_total_ms: Option<f64>,
    pub longest_task_ms: Option<f64>,
}

impl SessionLoadTelemetry {
    pub fn start(&self, agent_id: String, session_id: String) -> String {
        self.expire_stale();
        let operation_id = format!(
            "session-load-{}-{}",
            std::process::id(),
            NEXT_OPERATION_ID.fetch_add(1, Ordering::Relaxed)
        );
        let span = tracing::info_span!(
            "desktop.session_load",
            agent.id = %agent_id,
            session.id = %session_id,
            session.load.operation_id = %operation_id,
            session.load.status = tracing::field::Empty,
            session.load.elapsed_ms = tracing::field::Empty,
            session.load.applied_notification_count = tracing::field::Empty,
        );
        let now = Instant::now();
        self.operations
            .lock()
            .expect("session load telemetry lock poisoned")
            .insert(
                operation_id.clone(),
                SessionLoadOperation {
                    span,
                    started: now,
                    last_checkpoint: now,
                    current_phase: "started".to_string(),
                },
            );
        operation_id
    }

    pub async fn checkpoint(
        &self,
        operation_id: &str,
        phase: String,
        duration_ms: f64,
        counters: SessionLoadCounters,
    ) {
        self.expire_stale();
        let parent = {
            let mut operations = self
                .operations
                .lock()
                .expect("session load telemetry lock poisoned");
            let Some(operation) = operations.get_mut(operation_id) else {
                return;
            };
            operation.current_phase = phase.clone();
            operation.last_checkpoint = Instant::now();
            operation.span.context()
        };
        let span = tracing::info_span!(
            "desktop.session_load.phase",
            session.load.operation_id = %operation_id,
            session.load.phase = %phase,
            session.load.phase_duration_ms = duration_ms,
            session.load.live_notification_count = counters.live_notifications,
            session.load.drained_notification_count = counters.drained_notifications,
            session.load.applied_notification_count = counters.applied_notifications,
            session.load.duplicate_notification_count = counters.duplicate_notifications,
            session.load.replay_captured_count = counters.replay_captured_notifications,
            session.load.replay_reactive_count = counters.replay_reactive_notifications,
            session.load.history_assignments = counters.history_assignments,
            session.load.snapshot_event_count = counters.snapshot_events,
            session.load.transcript_count = counters.transcript_items,
            session.load.tool_count = counters.tool_calls,
            session.load.debug_event_count = counters.debug_events,
            session.load.dom_node_count = counters.dom_nodes,
            session.load.long_task_count = counters.long_task_count,
            session.load.long_task_total_ms = counters.long_task_total_ms,
            session.load.longest_task_ms = counters.longest_task_ms,
        );
        let _ = span.set_parent(parent);
        async {}.instrument(span).await;
    }

    pub async fn heartbeat(&self, operation_id: &str, counters: SessionLoadCounters) {
        let (parent, phase, elapsed_ms) = {
            let operations = self
                .operations
                .lock()
                .expect("session load telemetry lock poisoned");
            let Some(operation) = operations.get(operation_id) else {
                return;
            };
            (
                operation.span.context(),
                operation.current_phase.clone(),
                operation.started.elapsed().as_millis() as u64,
            )
        };
        let span = tracing::info_span!(
            "desktop.session_load.still_running",
            session.load.operation_id = %operation_id,
            session.load.phase = %phase,
            session.load.elapsed_ms = elapsed_ms,
            session.load.live_notification_count = counters.live_notifications,
            session.load.applied_notification_count = counters.applied_notifications,
            session.load.transcript_count = counters.transcript_items,
            session.load.tool_count = counters.tool_calls,
            session.load.debug_event_count = counters.debug_events,
        );
        let _ = span.set_parent(parent);
        async {}.instrument(span).await;
    }

    pub async fn report_still_running(&self) {
        self.expire_stale();
        let active: Vec<_> = {
            let operations = self
                .operations
                .lock()
                .expect("session load telemetry lock poisoned");
            operations
                .iter()
                .map(|(id, operation)| {
                    (
                        id.clone(),
                        operation.span.context(),
                        operation.current_phase.clone(),
                        operation.started.elapsed().as_millis() as u64,
                        operation.last_checkpoint.elapsed().as_millis() as u64,
                    )
                })
                .collect()
        };
        for (operation_id, parent, phase, elapsed_ms, checkpoint_age_ms) in active {
            let span = tracing::info_span!(
                "desktop.session_load.still_running",
                session.load.operation_id = %operation_id,
                session.load.phase = %phase,
                session.load.elapsed_ms = elapsed_ms,
                session.load.checkpoint_age_ms = checkpoint_age_ms,
            );
            let _ = span.set_parent(parent);
            async {}.instrument(span).await;
        }
    }

    pub fn finish(&self, operation_id: &str, status: &str, counters: SessionLoadCounters) {
        let Some(operation) = self
            .operations
            .lock()
            .expect("session load telemetry lock poisoned")
            .remove(operation_id)
        else {
            return;
        };
        operation.span.record("session.load.status", status);
        operation.span.record(
            "session.load.elapsed_ms",
            operation.started.elapsed().as_millis() as i64,
        );
        operation.span.record(
            "session.load.applied_notification_count",
            counters.applied_notifications,
        );
    }

    pub fn context(&self, operation_id: &str) -> Option<Context> {
        self.operations
            .lock()
            .ok()?
            .get(operation_id)
            .map(|operation| operation.span.context())
    }

    pub fn close_all(&self, status: &str) {
        let operations: Vec<_> = self
            .operations
            .lock()
            .expect("session load telemetry lock poisoned")
            .drain()
            .map(|(_, operation)| operation)
            .collect();
        for operation in operations {
            operation.span.record("session.load.status", status);
            operation.span.record(
                "session.load.elapsed_ms",
                operation.started.elapsed().as_millis() as i64,
            );
        }
    }

    pub fn expire_stale(&self) {
        let mut operations = self
            .operations
            .lock()
            .expect("session load telemetry lock poisoned");
        let expired: Vec<_> = operations
            .iter()
            .filter(|(_, operation)| operation.started.elapsed() >= OPERATION_TIMEOUT)
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            if let Some(operation) = operations.remove(&id) {
                operation.span.record("session.load.status", "timeout");
                operation.span.record(
                    "session.load.elapsed_ms",
                    operation.started.elapsed().as_millis() as i64,
                );
            }
        }
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.operations
            .lock()
            .expect("session load telemetry lock poisoned")
            .len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operation_lifecycle_closes_on_finish_and_shutdown() {
        let telemetry = SessionLoadTelemetry::default();
        let first = telemetry.start("agent-1".to_string(), "session-1".to_string());
        let _second = telemetry.start("agent-1".to_string(), "session-2".to_string());
        assert_eq!(telemetry.active_count(), 2);

        telemetry.finish(&first, "success", SessionLoadCounters::default());
        assert_eq!(telemetry.active_count(), 1);

        telemetry.close_all("application_shutdown");
        assert_eq!(telemetry.active_count(), 0);
    }

    #[test]
    fn unknown_operation_ids_are_safe() {
        let telemetry = SessionLoadTelemetry::default();
        telemetry.finish("missing", "error", SessionLoadCounters::default());
        assert!(telemetry.context("missing").is_none());
    }
}
