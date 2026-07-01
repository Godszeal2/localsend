use async_trait::async_trait;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::UdpSocket;
use turn::auth::{generate_auth_key, AuthHandler};
use turn::relay::relay_static::RelayAddressGeneratorStatic;
use turn::server::config::{ConnConfig, ServerConfig};
use turn::server::Server;
use turn::Error as TurnError;
use webrtc_util::vnet::net::Net;

pub const TURN_PORT: u16 = 3478;
pub const TURN_REALM: &str = "bridgecast";
pub const TURN_USERNAME: &str = "bridgecast";
pub const TURN_PASSWORD: &str = "Br1dg3C@stR3l@y!";

struct StaticAuth {
    creds: HashMap<String, Vec<u8>>,
}

#[async_trait]
impl AuthHandler for StaticAuth {
    async fn auth_handle<'a>(
        &'a self,
        username: &'a str,
        _realm: &'a str,
        _src_addr: SocketAddr,
    ) -> Result<Vec<u8>, TurnError> {
        self.creds
            .get(username)
            .cloned()
            .ok_or_else(|| TurnError::Other("unknown user".to_owned()))
    }
}

/// Returns the best IP for the TURN relay address.
/// Priority: TURN_PUBLIC_IP env var → outbound-detected LAN IP → 127.0.0.1
pub fn get_relay_ip() -> String {
    if let Ok(ip) = std::env::var("TURN_PUBLIC_IP") {
        if !ip.is_empty() {
            return ip;
        }
    }
    // UDP trick: open a socket and "connect" to a public IP to find which
    // local interface the OS would use for outbound traffic.
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".to_string()
}

/// Starts the built-in TURN relay on UDP :3478.
/// Runs forever in the background. On bind failure it logs a warning and returns
/// cleanly — the rest of the app keeps working without TURN.
pub async fn start_turn_server() {
    let relay_ip_str = get_relay_ip();
    let relay_ip = match IpAddr::from_str(&relay_ip_str) {
        Ok(ip) => ip,
        Err(_) => {
            tracing::warn!("TURN: invalid relay IP '{}', disabling", relay_ip_str);
            return;
        }
    };

    let addr = format!("0.0.0.0:{TURN_PORT}");
    let udp_socket = match UdpSocket::bind(&addr).await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(
                "TURN: cannot bind to {addr} ({e}) — relay disabled. \
                 Open UDP port {TURN_PORT} and set TURN_PUBLIC_IP to enable cross-network relay."
            );
            return;
        }
    };

    let mut creds = HashMap::new();
    creds.insert(
        TURN_USERNAME.to_owned(),
        generate_auth_key(TURN_USERNAME, TURN_REALM, TURN_PASSWORD),
    );

    let server = match Server::new(ServerConfig {
        conn_configs: vec![ConnConfig {
            conn: Arc::new(udp_socket),
            relay_addr_generator: Box::new(RelayAddressGeneratorStatic {
                relay_address: relay_ip,
                address: "0.0.0.0".to_owned(),
                net: Arc::new(Net::new(None)),
            }),
        }],
        realm: TURN_REALM.to_owned(),
        auth_handler: Arc::new(StaticAuth { creds }),
        channel_bind_timeout: Duration::from_secs(0),
        alloc_close_notify: None,
    })
    .await
    {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("TURN: server init failed: {e} — relay disabled.");
            return;
        }
    };

    tracing::info!(
        "TURN relay on {addr}  relay-IP={}  user={}  pass={}",
        relay_ip_str,
        TURN_USERNAME,
        TURN_PASSWORD
    );

    // Park this task; the server runs its own background tasks inside.
    loop {
        tokio::time::sleep(Duration::from_secs(3600)).await;
    }

    #[allow(unreachable_code)]
    let _ = server.close().await;
}
