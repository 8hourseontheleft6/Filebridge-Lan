#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let port = std::env::var("FILEBRIDGE_LAN_SIGNAL_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(42070);

    filebridge_lan_lib::signaling::serve(port).await
}
