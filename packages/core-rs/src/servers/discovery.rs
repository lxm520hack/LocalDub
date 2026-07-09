use std::time::Duration;

use config_rs::servers::ServerType;
use mdns_sd::{ServiceDaemon, ServiceEvent};

const MDNS_TIMEOUT: Duration = Duration::from_millis(3000);

const DEFAULT_HOST: &str = "127.0.0.1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FoundVia {
    Mdns,
    Default,
    PortFile,
}

#[derive(Debug, Clone)]
pub struct ServerInfo {
    pub host: String,
    pub port: u16,
    pub found_via: FoundVia,
}

/// Discover all matching servers via mDNS, falling back to default host/port.
///
/// Returns base URLs like `http://127.0.0.1:19109`.
pub async fn find_servers(type_: ServerType) -> Vec<String> {
    let list = find_server_via_mdns_all(type_, None).await;
    if !list.is_empty() {
        return list
            .into_iter()
            .map(|(host, port)| format!("http://{}:{}", host, port))
            .collect();
    }
    vec![format!("http://{}:{}", DEFAULT_HOST, type_.default_port())]
}

/// Discover a single server by mDNS, falling back to defaults.
pub async fn find_server(type_: ServerType) -> ServerInfo {
    let list = find_server_via_mdns_all(type_, None).await;
    if let Some((host, port)) = list.into_iter().next() {
        return ServerInfo {
            host,
            port,
            found_via: FoundVia::Mdns,
        };
    }
    ServerInfo {
        host: DEFAULT_HOST.to_string(),
        port: type_.default_port(),
        found_via: FoundVia::Default,
    }
}

/// Browse mDNS for the given server type.
///
/// Returns `(ip, port)` pairs for all resolved services of the matching type.
pub async fn find_server_via_mdns_all(
    type_: ServerType,
    timeout: Option<Duration>,
) -> Vec<(String, u16)> {
    let timeout = timeout.unwrap_or(MDNS_TIMEOUT);

    let Ok(daemon) = ServiceDaemon::new() else {
        return vec![];
    };
    let Ok(receiver) = daemon.browse(type_.service_name()) else {
        return vec![];
    };

    let start = std::time::Instant::now();
    let mut results: Vec<(String, u16)> = vec![];

    while start.elapsed() < timeout {
        let remaining = timeout.saturating_sub(start.elapsed());
        if remaining.is_zero() {
            break;
        }
        let recv_timeout = remaining.min(Duration::from_millis(200));
        match receiver.recv_timeout(recv_timeout) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let port = info.get_port();
                for addr in info.get_addresses() {
                    let ip = addr.to_string();
                    let entry = (ip, port);
                    if !results.contains(&entry) {
                        results.push(entry);
                    }
                }
            }
            _ => {}
        }
    }

    drop(daemon);
    results
}

/// Read the first `PORT=XXXX` line from process stdout.
pub fn read_port_from_output(output: &str) -> Option<u16> {
    for line in output.lines() {
        if let Some(port_str) = line.strip_prefix("PORT=") {
            if let Ok(port) = port_str.trim().parse::<u16>() {
                return Some(port);
            }
        }
    }
    None
}
