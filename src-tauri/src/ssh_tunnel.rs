use crate::db_types::{ConnectionConfig, SSHTunnelConfig};
use ssh2::Session;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tokio::sync::Mutex;

const SSH_CONNECT_TIMEOUT_SECS: u64 = 10;
const TUNNEL_IDLE_SLEEP_MS: u64 = 5;
const ACCEPT_RETRY_SLEEP_MS: u64 = 40;

static ACTIVE_TUNNELS: LazyLock<Mutex<HashMap<String, ManagedTunnel>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct ManagedTunnel {
    local_port: u16,
    shutdown: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl ManagedTunnel {
    fn stop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(("127.0.0.1", self.local_port));
        if let Some(handle) = self.worker.take() {
            let _ = handle.join();
        }
    }
}

fn parse_socket_addr(host: &str, port: u16) -> Result<std::net::SocketAddr, String> {
    (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("Failed to resolve {}:{} - {}", host, port, e))?
        .next()
        .ok_or_else(|| format!("No resolved address found for {}:{}", host, port))
}

fn expand_path(input: &str) -> PathBuf {
    if let Some(stripped) = input.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }
    if input == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }
    PathBuf::from(input)
}

fn authenticate_session(session: &mut Session, config: &SSHTunnelConfig) -> Result<(), String> {
    let username = config.username.trim();
    if username.is_empty() {
        return Err("SSH username is required".to_string());
    }

    let mut auth_errors = Vec::new();
    let password_opt = config
        .password
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(key_path_raw) = config
        .key_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let key_path = expand_path(key_path_raw);
        if !Path::new(&key_path).exists() {
            auth_errors.push(format!("SSH key file not found: {}", key_path.display()));
        } else {
            match session.userauth_pubkey_file(username, None, &key_path, password_opt) {
                Ok(_) if session.authenticated() => return Ok(()),
                Ok(_) => auth_errors.push(format!(
                    "SSH key authentication failed for {}",
                    key_path.display()
                )),
                Err(e) => auth_errors.push(format!(
                    "SSH key authentication error for {}: {}",
                    key_path.display(),
                    e
                )),
            }
        }
    }

    if let Some(password) = password_opt {
        match session.userauth_password(username, password) {
            Ok(_) if session.authenticated() => return Ok(()),
            Ok(_) => auth_errors.push("SSH password authentication failed".to_string()),
            Err(e) => auth_errors.push(format!("SSH password authentication error: {}", e)),
        }
    }

    match session.userauth_agent(username) {
        Ok(_) if session.authenticated() => Ok(()),
        Ok(_) => {
            auth_errors.push("SSH agent authentication failed".to_string());
            Err(format!(
                "SSH authentication failed. Attempts: {}",
                auth_errors.join(" | ")
            ))
        }
        Err(e) => {
            auth_errors.push(format!("SSH agent authentication error: {}", e));
            Err(format!(
                "SSH authentication failed. Attempts: {}",
                auth_errors.join(" | ")
            ))
        }
    }
}

fn establish_session(config: &SSHTunnelConfig) -> Result<Session, String> {
    let address = parse_socket_addr(&config.host, config.port)?;
    let tcp_stream = TcpStream::connect_timeout(&address, Duration::from_secs(SSH_CONNECT_TIMEOUT_SECS))
        .map_err(|e| format!("SSH TCP connect failed: {}", e))?;
    let _ = tcp_stream.set_nodelay(true);

    let mut session = Session::new().map_err(|e| format!("SSH session init failed: {}", e))?;
    session.set_tcp_stream(tcp_stream);
    session
        .handshake()
        .map_err(|e| format!("SSH handshake failed: {}", e))?;

    authenticate_session(&mut session, config)?;

    if !session.authenticated() {
        return Err("SSH authentication failed".to_string());
    }

    Ok(session)
}

fn write_nonblocking_channel(channel: &mut ssh2::Channel, mut data: &[u8]) -> Result<(), String> {
    while !data.is_empty() {
        match channel.write(data) {
            Ok(0) => return Err("SSH channel closed while writing".to_string()),
            Ok(written) => data = &data[written..],
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(1));
            }
            Err(err) => return Err(format!("SSH channel write error: {}", err)),
        }
    }
    Ok(())
}

fn write_nonblocking_stream(stream: &mut TcpStream, mut data: &[u8]) -> Result<(), String> {
    while !data.is_empty() {
        match stream.write(data) {
            Ok(0) => return Err("Local stream closed while writing".to_string()),
            Ok(written) => data = &data[written..],
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(1));
            }
            Err(err) => return Err(format!("Local stream write error: {}", err)),
        }
    }
    Ok(())
}

fn handle_tunnel_client(
    mut local_stream: TcpStream,
    ssh_config: SSHTunnelConfig,
    remote_host: String,
    remote_port: u16,
) -> Result<(), String> {
    let session = establish_session(&ssh_config)?;
    session.set_blocking(false);
    let mut channel = session
        .channel_direct_tcpip(&remote_host, remote_port, None)
        .map_err(|e| {
            format!(
                "SSH direct-tcpip failed ({}:{}): {}",
                remote_host, remote_port, e
            )
        })?;

    let _ = local_stream.set_nonblocking(true);
    let _ = local_stream.set_nodelay(true);

    let mut local_buf = [0u8; 16 * 1024];
    let mut remote_buf = [0u8; 16 * 1024];
    let mut local_eof = false;
    let mut remote_eof = false;
    let mut sent_eof = false;

    while !(local_eof && remote_eof) {
        let mut progressed = false;

        if !local_eof {
            match local_stream.read(&mut local_buf) {
                Ok(0) => {
                    local_eof = true;
                }
                Ok(read_len) => {
                    write_nonblocking_channel(&mut channel, &local_buf[..read_len])?;
                    progressed = true;
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(err) => return Err(format!("Local stream read error: {}", err)),
            }
        }

        if local_eof && !sent_eof {
            let _ = channel.send_eof();
            sent_eof = true;
        }

        if !remote_eof {
            match channel.read(&mut remote_buf) {
                Ok(0) => {
                    remote_eof = true;
                }
                Ok(read_len) => {
                    write_nonblocking_stream(&mut local_stream, &remote_buf[..read_len])?;
                    progressed = true;
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(err) => return Err(format!("SSH channel read error: {}", err)),
            }
        }

        if !progressed {
            thread::sleep(Duration::from_millis(TUNNEL_IDLE_SLEEP_MS));
        }
    }

    let _ = channel.close();
    let _ = channel.wait_close();
    let _ = local_stream.shutdown(Shutdown::Both);
    Ok(())
}

fn spawn_tunnel_worker(
    ssh_config: SSHTunnelConfig,
    remote_host: String,
    remote_port: u16,
) -> Result<ManagedTunnel, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind local SSH tunnel port: {}", e))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Failed to set tunnel listener non-blocking: {}", e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read tunnel listener address: {}", e))?
        .port();

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_signal = Arc::clone(&shutdown);

    let worker = thread::Builder::new()
        .name(format!("tactilesql-ssh-tunnel-{}", local_port))
        .spawn(move || {
            while !shutdown_signal.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _addr)) => {
                        let ssh_cfg = ssh_config.clone();
                        let target_host = remote_host.clone();
                        thread::spawn(move || {
                            if let Err(err) =
                                handle_tunnel_client(stream, ssh_cfg, target_host, remote_port)
                            {
                                eprintln!("SSH tunnel client error: {}", err);
                            }
                        });
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(ACCEPT_RETRY_SLEEP_MS));
                    }
                    Err(err) => {
                        eprintln!("SSH tunnel listener error: {}", err);
                        break;
                    }
                }
            }
        })
        .map_err(|e| format!("Failed to spawn tunnel worker thread: {}", e))?;

    Ok(ManagedTunnel {
        local_port,
        shutdown,
        worker: Some(worker),
    })
}

pub fn validate_ssh_config(config: &SSHTunnelConfig) -> Result<(), String> {
    if config.host.trim().is_empty() {
        return Err("SSH host is required".to_string());
    }
    if config.username.trim().is_empty() {
        return Err("SSH username is required".to_string());
    }
    Ok(())
}

pub fn extract_ssh_config(connection: &ConnectionConfig) -> Result<SSHTunnelConfig, String> {
    let host = connection
        .ssh_host
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("SSH host is required when SSH tunnel is enabled")?;
    let username = connection
        .ssh_username
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("SSH username is required when SSH tunnel is enabled")?;

    Ok(SSHTunnelConfig {
        host: host.to_string(),
        port: connection.ssh_port.unwrap_or(22),
        username: username.to_string(),
        password: connection.ssh_password.clone(),
        key_path: connection.ssh_key_path.clone(),
    })
}

pub fn test_ssh_connection(config: &SSHTunnelConfig) -> Result<String, String> {
    validate_ssh_config(config)?;
    let _session = establish_session(config)?;
    Ok(format!(
        "SSH connection successful: {}@{}:{}",
        config.username, config.host, config.port
    ))
}

pub async fn open_or_replace_tunnel(
    connection_key: &str,
    ssh_config: SSHTunnelConfig,
    remote_host: String,
    remote_port: u16,
) -> Result<u16, String> {
    validate_ssh_config(&ssh_config)?;
    let new_tunnel = spawn_tunnel_worker(ssh_config, remote_host, remote_port)?;
    let local_port = new_tunnel.local_port;

    let previous = {
        let mut guard = ACTIVE_TUNNELS.lock().await;
        guard.insert(connection_key.to_string(), new_tunnel)
    };

    if let Some(mut old_tunnel) = previous {
        old_tunnel.stop();
    }

    Ok(local_port)
}

pub async fn close_tunnel(connection_key: &str) -> Result<(), String> {
    let tunnel = {
        let mut guard = ACTIVE_TUNNELS.lock().await;
        guard.remove(connection_key)
    };

    if let Some(mut tunnel) = tunnel {
        tunnel.stop();
    }

    Ok(())
}

pub async fn close_all_tunnels() -> Result<(), String> {
    let tunnels = {
        let mut guard = ACTIVE_TUNNELS.lock().await;
        guard.drain().map(|(_, tunnel)| tunnel).collect::<Vec<_>>()
    };

    for mut tunnel in tunnels {
        tunnel.stop();
    }

    Ok(())
}

pub async fn close_all_except(connection_key: Option<&str>) -> Result<(), String> {
    let keep = connection_key.map(str::to_string);
    let tunnels = {
        let mut guard = ACTIVE_TUNNELS.lock().await;
        let keys_to_remove: Vec<String> = guard
            .keys()
            .filter(|key| keep.as_ref().map(|k| k != *key).unwrap_or(true))
            .cloned()
            .collect();

        let mut removed = Vec::with_capacity(keys_to_remove.len());
        for key in keys_to_remove {
            if let Some(tunnel) = guard.remove(&key) {
                removed.push(tunnel);
            }
        }
        removed
    };

    for mut tunnel in tunnels {
        tunnel.stop();
    }

    Ok(())
}
