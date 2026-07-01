use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct IceEntry {
    pub urls: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

#[derive(Serialize)]
pub struct IceConfigResponse {
    #[serde(rename = "iceServers")]
    pub ice_servers: Vec<IceEntry>,
    /// Human-readable hint shown in the UI.
    pub relay_host: String,
    pub relay_port: u16,
}

/// GET /v1/ice-servers
/// Returns STUN + TURN configuration so clients don't need hardcoded credentials.
pub async fn ice_servers_handler() -> Json<IceConfigResponse> {
    let host = crate::turn_server::get_relay_ip();
    let port = crate::turn_server::TURN_PORT;
    let user = crate::turn_server::TURN_USERNAME;
    let pass = crate::turn_server::TURN_PASSWORD;

    Json(IceConfigResponse {
        ice_servers: vec![
            IceEntry { urls: "stun:stun.l.google.com:19302".into(), username: None, credential: None },
            IceEntry { urls: "stun:stun1.l.google.com:19302".into(), username: None, credential: None },
            IceEntry {
                urls: format!("turn:{host}:{port}"),
                username: Some(user.into()),
                credential: Some(pass.into()),
            },
            IceEntry {
                urls: format!("turn:{host}:{port}?transport=tcp"),
                username: Some(user.into()),
                credential: Some(pass.into()),
            },
        ],
        relay_host: host,
        relay_port: port,
    })
}
