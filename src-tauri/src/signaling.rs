use std::{collections::HashMap, sync::Arc};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

type Tx = mpsc::UnboundedSender<String>;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Role {
    Host,
    Client,
}

#[derive(Default)]
struct Room {
    host: Option<Tx>,
    client: Option<Tx>,
}

#[derive(Default)]
struct SignalState {
    rooms: Mutex<HashMap<String, Room>>,
}

/// 内嵌信令服务器，协议与 server/signaling.ts 保持一致。
pub async fn serve(port: u16) -> anyhow::Result<()> {
    let state = Arc::new(SignalState::default());
    let app = Router::new().route("/", get(ws_handler)).with_state(state);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    println!("[signal] 信令服务器启动于 ws://0.0.0.0:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<SignalState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<SignalState>) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let writer = tokio::spawn(async move {
        while let Some(text) = rx.recv().await {
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    let mut room_id: Option<String> = None;
    let mut role: Option<Role> = None;

    while let Some(Ok(message)) = stream.next().await {
        if let Message::Text(text) = message {
            handle_message(text.as_str(), &state, &tx, &mut room_id, &mut role).await;
        }
    }

    cleanup(&state, room_id.as_deref(), role).await;
    writer.abort();
}

async fn handle_message(
    text: &str,
    state: &SignalState,
    tx: &Tx,
    room_id: &mut Option<String>,
    role: &mut Option<Role>,
) {
    let Ok(message) = serde_json::from_str::<Value>(text) else {
        return;
    };
    let kind = message.get("type").and_then(Value::as_str).unwrap_or("");

    match kind {
        "create_room" => {
            let code = {
                let mut rooms = state.rooms.lock().await;
                let code = loop {
                    let candidate = new_room_code();
                    if !rooms.contains_key(&candidate) {
                        break candidate;
                    }
                };
                rooms.insert(code.clone(), Room {
                    host: Some(tx.clone()),
                    client: None,
                });
                code
            };

            *room_id = Some(code.clone());
            *role = Some(Role::Host);
            send_json(tx, json!({ "type": "room_created", "roomId": code }));
            println!("[signal] 创建房间: {code}");
        }

        "join_room" => {
            let Some(code) = message
                .get("roomId")
                .and_then(Value::as_str)
                .map(|value| value.to_uppercase())
            else {
                return;
            };
            let device_id = message
                .get("deviceId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let device_name = message
                .get("deviceName")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();

            let mut host_tx = None;
            let mut failure: Option<&'static str> = None;
            {
                let mut rooms = state.rooms.lock().await;
                match rooms.get_mut(&code) {
                    None => failure = Some("房间不存在"),
                    Some(room) if room.host.is_none() => failure = Some("房间已关闭"),
                    Some(room) if room.client.is_some() => failure = Some("房间已满"),
                    Some(room) => {
                        room.client = Some(tx.clone());
                        host_tx = room.host.clone();
                    }
                }
            }

            if let Some(message) = failure {
                send_json(tx, json!({ "type": "error", "message": message }));
                return;
            }

            if let Some(host) = host_tx {
                send_json(&host, json!({
                    "type": "peer_joined",
                    "deviceId": device_id,
                    "deviceName": device_name
                }));
            }
            *room_id = Some(code.clone());
            *role = Some(Role::Client);
            send_json(tx, json!({ "type": "room_joined", "roomId": code }));
            println!("[signal] 加入房间: {code}");
        }

        "offer" | "answer" | "ice_candidate" => {
            let Some(code) = room_id.as_ref() else {
                return;
            };
            let Some(current) = *role else {
                return;
            };
            let target_role = if current == Role::Host {
                Role::Client
            } else {
                Role::Host
            };

            let target = {
                let rooms = state.rooms.lock().await;
                let Some(room) = rooms.get(code) else {
                    return;
                };
                if target_role == Role::Host {
                    room.host.clone()
                } else {
                    room.client.clone()
                }
            };

            if let Some(target) = target {
                let mut forward = message.clone();
                forward["from"] = message.get("deviceId").cloned().unwrap_or(Value::Null);
                send_json(&target, forward);
            }
        }

        _ => {}
    }
}

async fn cleanup(state: &SignalState, room_id: Option<&str>, role: Option<Role>) {
    let (Some(code), Some(role)) = (room_id, role) else {
        return;
    };

    let mut rooms = state.rooms.lock().await;
    match role {
        Role::Host => {
            if let Some(room) = rooms.remove(code) {
                if let Some(client) = room.client {
                    send_json(&client, json!({ "type": "host_disconnected" }));
                }
            }
            println!("[signal] 关闭房间: {code}");
        }
        Role::Client => {
            if let Some(room) = rooms.get_mut(code) {
                room.client = None;
                if let Some(host) = room.host.clone() {
                    send_json(&host, json!({ "type": "peer_disconnected" }));
                }
            }
            println!("[signal] 客户端离开: {code}");
        }
    }
}

fn send_json(tx: &Tx, value: Value) {
    let _ = tx.send(value.to_string());
}

fn new_room_code() -> String {
    Uuid::new_v4().simple().to_string()[..6].to_uppercase()
}
