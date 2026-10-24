use std::path::PathBuf;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    let port = std::env::var("FILEBRIDGE_LAN_HUB_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(42080);

    let data_dir = std::env::var("FILEBRIDGE_LAN_HUB_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| manifest_dir.join("../.filebridge-lan-data"));

    let dist_dir = std::env::var("FILEBRIDGE_LAN_DIST")
        .map(PathBuf::from)
        .unwrap_or_else(|_| manifest_dir.join("../dist"));

    filebridge_lan_lib::hub::serve(port, data_dir, dist_dir).await
}
