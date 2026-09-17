use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::ipc::Channel;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Default)]
pub struct AcpWebSocketManager {
    next_id: AtomicU64,
    connections: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<SocketCommand>>>>,
}

#[derive(Debug)]
enum SocketCommand {
    Send(String),
    Close,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AcpWebSocketEvent {
    Message { data: String },
    Closed { reason: String },
    Error { message: String },
}

impl AcpWebSocketManager {
    pub async fn connect(
        &self,
        url: String,
        events: Channel<AcpWebSocketEvent>,
    ) -> Result<String, String> {
        let url = validated_acp_url(&url)?;
        let (socket, _) =
            tokio::time::timeout(std::time::Duration::from_secs(15), connect_async(url))
                .await
                .map_err(|_| "Timed out while connecting to the ACP server.".to_string())?
                .map_err(|error| format!("Unable to connect to the ACP server: {error}"))?;
        let connection_id = format!(
            "acp-websocket-{}",
            self.next_id.fetch_add(1, Ordering::Relaxed)
        );
        let (commands, mut command_rx) = mpsc::unbounded_channel();
        self.connections
            .lock()
            .expect("websocket manager lock poisoned")
            .insert(connection_id.clone(), commands);

        let connections = Arc::clone(&self.connections);
        let task_connection_id = connection_id.clone();
        tauri::async_runtime::spawn(async move {
            let (mut writer, mut reader) = socket.split();
            loop {
                tokio::select! {
                    command = command_rx.recv() => match command {
                        Some(SocketCommand::Send(data)) => {
                            if let Err(error) = writer.send(Message::Text(data.into())).await {
                                let _ = events.send(AcpWebSocketEvent::Error {
                                    message: format!("ACP WebSocket send failed: {error}"),
                                });
                                break;
                            }
                        }
                        Some(SocketCommand::Close) | None => {
                            let _ = writer.close().await;
                            break;
                        }
                    },
                    incoming = reader.next() => match incoming {
                        Some(Ok(Message::Text(data))) => {
                            if events.send(AcpWebSocketEvent::Message { data: data.to_string() }).is_err() {
                                break;
                            }
                        }
                        Some(Ok(Message::Close(frame))) => {
                            let reason = frame
                                .map(|frame| {
                                    if frame.reason.is_empty() {
                                        format!("WebSocket closed (code {}).", u16::from(frame.code))
                                    } else {
                                        format!("WebSocket closed: {}", frame.reason)
                                    }
                                })
                                .unwrap_or_else(|| "WebSocket closed.".to_string());
                            let _ = events.send(AcpWebSocketEvent::Closed { reason });
                            break;
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            if let Err(error) = writer.send(Message::Pong(payload)).await {
                                let _ = events.send(AcpWebSocketEvent::Error {
                                    message: format!("ACP WebSocket Pong failed: {error}"),
                                });
                                break;
                            }
                        }
                        Some(Ok(Message::Binary(_))) => {
                            let _ = events.send(AcpWebSocketEvent::Error {
                                message: "ACP WebSocket received an unsupported binary frame.".to_string(),
                            });
                            break;
                        }
                        Some(Ok(_)) => {}
                        Some(Err(error)) => {
                            let _ = events.send(AcpWebSocketEvent::Error {
                                message: format!("ACP WebSocket connection failed: {error}"),
                            });
                            break;
                        }
                        None => {
                            let _ = events.send(AcpWebSocketEvent::Closed {
                                reason: "WebSocket closed.".to_string(),
                            });
                            break;
                        }
                    }
                }
            }

            connections
                .lock()
                .expect("websocket manager lock poisoned")
                .remove(&task_connection_id);
        });

        Ok(connection_id)
    }

    pub fn send(&self, connection_id: &str, data: String) -> Result<(), String> {
        let connections = self
            .connections
            .lock()
            .map_err(|_| "WebSocket manager lock poisoned.".to_string())?;
        let connection = connections
            .get(connection_id)
            .ok_or_else(|| "ACP WebSocket is not connected.".to_string())?;
        connection
            .send(SocketCommand::Send(data))
            .map_err(|_| "ACP WebSocket is not connected.".to_string())
    }

    pub fn close(&self, connection_id: &str) {
        let connection = self
            .connections
            .lock()
            .expect("websocket manager lock poisoned")
            .remove(connection_id);
        if let Some(connection) = connection {
            let _ = connection.send(SocketCommand::Close);
        }
    }

    pub fn close_all(&self) {
        let connections = std::mem::take(
            &mut *self
                .connections
                .lock()
                .expect("websocket manager lock poisoned"),
        );
        for connection in connections.into_values() {
            let _ = connection.send(SocketCommand::Close);
        }
    }
}

fn validated_acp_url(value: &str) -> Result<&str, String> {
    let lower = value.to_ascii_lowercase();
    if !(lower.starts_with("ws://") || lower.starts_with("wss://")) {
        return Err("ACP WebSocket URL must use ws:// or wss://.".to_string());
    }
    if value.contains(['\r', '\n']) {
        return Err("ACP WebSocket URL contains invalid characters.".to_string());
    }
    Ok(value)
}
