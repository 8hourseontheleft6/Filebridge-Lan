use std::{
    collections::HashMap,
    convert::Infallible,
    io::SeekFrom,
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    extract::{ConnectInfo, Path as AxumPath, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use futures_util::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufWriter},
    sync::{broadcast, Mutex, RwLock},
};
use tokio_stream::wrappers::BroadcastStream;
use tokio_util::io::ReaderStream;
use tower_http::services::{ServeDir, ServeFile};
use uuid::Uuid;

const HUB_VERSION: &str = "1.4.0";

// GUI 应用从资源管理器启动时 stdout 可能不可用；日志失败不能中断传输。
macro_rules! hub_log {
    ($($arg:tt)*) => {{
        use std::io::Write;
        let _ = writeln!(std::io::stdout(), $($arg)*);
    }};
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub sha256: String,
    pub mime: String,
    pub created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadEvent {
    pub id: String,
    pub name: String,
    pub loaded: u64,
    pub total: u64,
    pub status: String,
}

#[derive(Clone)]
pub struct HubState {
    inner: Arc<HubInner>,
}

struct TokenEntry {
    token: String,
    expires_at: Instant,
}

struct HubInner {
    port: u16,
    local_ips: Vec<String>,
    files_dir: PathBuf,
    meta_dir: PathBuf,
    tmp_dir: PathBuf,
    dist_dir: PathBuf,
    files: RwLock<HashMap<String, Meta>>,
    events: broadcast::Sender<UploadEvent>,
    session_code: RwLock<String>,
    tokens: RwLock<Vec<TokenEntry>>,
    pair_failures: Mutex<HashMap<IpAddr, (u32, Instant)>>,
    pair_global: Mutex<(u32, Instant)>,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }

    fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }

    fn range_not_satisfiable() -> Self {
        Self::new(StatusCode::RANGE_NOT_SATISFIABLE, "Range 不合法")
    }

    fn internal(error: impl std::fmt::Display) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(serde_json::json!({ "error": self.message }))).into_response()
    }
}

type ApiResult<T> = Result<T, ApiError>;

#[derive(Serialize)]
struct Info {
    name: &'static str,
    version: &'static str,
    port: u16,
    ips: Vec<String>,
    files: usize,
}

impl HubState {
    fn file_path(&self, id: &str) -> PathBuf {
        self.inner.files_dir.join(format!("{id}.bin"))
    }

    fn meta_path(&self, id: &str) -> PathBuf {
        self.inner.meta_dir.join(format!("{id}.json"))
    }

    fn emit_upload(&self, id: &str, name: &str, loaded: u64, total: u64, status: &str) {
        let _ = self.inner.events.send(UploadEvent {
            id: id.to_string(),
            name: name.to_string(),
            loaded,
            total,
            status: status.to_string(),
        });
    }
}

pub async fn new(port: u16, data_dir: PathBuf, dist_dir: PathBuf) -> std::io::Result<HubState> {
    let files_dir = data_dir.join("files");
    let meta_dir = data_dir.join("meta");
    let tmp_dir = data_dir.join("tmp");

    tokio::fs::create_dir_all(&files_dir).await?;
    tokio::fs::create_dir_all(&meta_dir).await?;
    tokio::fs::create_dir_all(&tmp_dir).await?;

    let mut files = HashMap::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&meta_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Ok(raw) = tokio::fs::read(&path).await else {
                continue;
            };
            let Ok(meta) = serde_json::from_slice::<Meta>(&raw) else {
                continue;
            };
            if tokio::fs::metadata(files_dir.join(format!("{}.bin", meta.id))).await.is_ok() {
                files.insert(meta.id.clone(), meta);
            }
        }
    }

    hub_log!("[hub] 已加载 {} 个文件索引", files.len());

    let (events, _) = broadcast::channel(128);
    let local_ips = local_ip_address::list_afinet_netifas()
        .map(|interfaces| {
            interfaces
                .into_iter()
                .filter_map(|(_, ip)| match ip {
                    std::net::IpAddr::V4(ip) if !ip.is_loopback() => Some(ip.to_string()),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(HubState {
        inner: Arc::new(HubInner {
            port,
            local_ips,
            files_dir,
            meta_dir,
            tmp_dir,
            dist_dir,
            files: RwLock::new(files),
            events,
            session_code: RwLock::new(generate_session_code()),
            tokens: RwLock::new(Vec::new()),
            pair_failures: Mutex::new(HashMap::new()),
            pair_global: Mutex::new((0, Instant::now())),
        }),
    })
}

pub fn router(state: HubState) -> Router {
    let dist = state.inner.dist_dir.clone();
    let index = dist.join("index.html");
    let static_files = ServeDir::new(dist).not_found_service(ServeFile::new(index));

    let protected = Router::new()
        .route("/files", get(list_files))
        .route("/upload", post(upload))
        .route("/events", get(sse_events))
        .route("/files/{id}", get(download).delete(delete_file))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token));

    let api = Router::new()
        .route("/info", get(get_info))
        .route("/session", get(get_session))
        .route("/session/rotate", post(rotate_session))
        .route("/pair", post(pair))
        .merge(protected)
        .fallback(api_not_found);

    Router::new()
        .nest("/api", api)
        .fallback_service(static_files)
        .layer(middleware::from_fn_with_state(state.clone(), security_guard))
        .with_state(state)
}

pub async fn serve(port: u16, data_dir: PathBuf, dist_dir: PathBuf) -> anyhow::Result<()> {
    let state = new(port, data_dir, dist_dir).await?;
    let app = router(state);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    let addr = listener.local_addr()?;
    hub_log!("[hub] HTTP Hub 启动于 http://{addr}");
    if let Ok(ip) = local_ip_address::local_ip() {
        hub_log!("[hub]   手机访问: http://{ip}:{port}");
    }

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

fn generate_session_code() -> String {
    let bytes = Uuid::new_v4().into_bytes();
    let value = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % 1_000_000;
    format!("{value:06}")
}

#[derive(Serialize)]
struct SessionInfo {
    code: String,
}

#[derive(Deserialize)]
struct PairRequest {
    code: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairResponse {
    token: String,
    expires_at: u64,
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

fn host_parts(value: &str) -> (String, Option<u16>) {
    if let Some(rest) = value.strip_prefix('[') {
        if let Some((host, tail)) = rest.split_once(']') {
            let port = tail.strip_prefix(':').and_then(|port| port.parse().ok());
            return (host.to_ascii_lowercase(), port);
        }
    }
    if let Some((host, port)) = value.rsplit_once(':') {
        if let Ok(port) = port.parse::<u16>() {
            return (host.to_ascii_lowercase(), Some(port));
        }
    }
    (value.to_ascii_lowercase(), None)
}

fn allowed_host(state: &HubState, host: &str) -> bool {
    let (name, port) = host_parts(host);
    if port.is_some_and(|port| port != state.inner.port) {
        return false;
    }
    if name == "localhost" || name == "127.0.0.1" || name == "::1" {
        return true;
    }
    state.inner.local_ips.iter().any(|ip| ip == &name)
}

fn allowed_origin(state: &HubState, origin: &str) -> bool {
    if origin == "http://tauri.localhost" {
        return true;
    }
    let Some(rest) = origin.strip_prefix("http://") else {
        return false;
    };
    let (host, port) = host_parts(rest);
    let port = port.unwrap_or(80);
    let local = host == "localhost" || host == "127.0.0.1" || host == "::1";
    let lan = state.inner.local_ips.iter().any(|ip| ip == &host);
    if !(local || lan) {
        return false;
    }
    port == state.inner.port || port == 5173
}

async fn security_guard(
    State(state): State<HubState>,
    request: Request,
    next: Next,
) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !allowed_host(&state, host) {
        return ApiError::new(StatusCode::FORBIDDEN, "Host 不允许").into_response();
    }

    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    if let Some(origin) = origin.as_deref() {
        if origin == "null" || !allowed_origin(&state, origin) {
            return ApiError::new(StatusCode::FORBIDDEN, "Origin 不允许").into_response();
        }
    }

    let mut response = if request.method() == axum::http::Method::OPTIONS {
        Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Body::empty())
            .unwrap_or_else(|_| StatusCode::NO_CONTENT.into_response())
    } else {
        next.run(request).await
    };

    if let Some(origin) = origin.as_deref() {
        if let Ok(value) = HeaderValue::from_str(origin) {
            response.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
            response.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_METHODS,
                HeaderValue::from_static("GET, POST, DELETE, OPTIONS"),
            );
            response.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                HeaderValue::from_static(
                    "Content-Type, Range, Authorization, X-Filebridge-Token",
                ),
            );
            response.headers_mut().insert(
                header::ACCESS_CONTROL_EXPOSE_HEADERS,
                HeaderValue::from_static(
                    "Content-Disposition, Content-Range, Content-Length",
                ),
            );
            response.headers_mut().insert(header::VARY, HeaderValue::from_static("Origin"));
        }
    }

    response
}

fn request_token(request: &Request) -> Option<String> {
    if let Some(value) = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(value.to_string());
    }
    if let Some(value) = request
        .headers()
        .get("x-filebridge-token")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(value.to_string());
    }
    request.uri().query().and_then(|query| {
        query.split('&').find_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            if key == "token" && !value.is_empty() {
                Some(value.to_string())
            } else {
                None
            }
        })
    })
}

async fn require_token(
    State(state): State<HubState>,
    request: Request,
    next: Next,
) -> Response {
    let Some(provided) = request_token(&request) else {
        return ApiError::new(StatusCode::UNAUTHORIZED, "未授权").into_response();
    };
    let now = Instant::now();
    let mut tokens = state.inner.tokens.write().await;
    tokens.retain(|entry| entry.expires_at > now);
    let authorized = tokens
        .iter()
        .any(|entry| constant_time_eq(&entry.token, &provided));
    drop(tokens);
    if !authorized {
        return ApiError::new(StatusCode::UNAUTHORIZED, "未授权").into_response();
    }
    next.run(request).await
}

fn token_ttl() -> Duration {
    Duration::from_secs(12 * 60 * 60)
}

async fn pair_limited(state: &HubState, ip: IpAddr) -> bool {
    let now = Instant::now();
    let mut failures = state.inner.pair_failures.lock().await;
    let window = failures
        .entry(ip)
        .or_insert((0, now + Duration::from_secs(60)));
    if now >= window.1 {
        *window = (0, now + Duration::from_secs(60));
    }
    if window.0 >= 10 {
        return true;
    }
    window.0 += 1;
    drop(failures);

    let mut global = state.inner.pair_global.lock().await;
    if now >= global.1 {
        *global = (0, now + Duration::from_secs(60));
    }
    global.0 += 1;
    global.0 > 300
}

async fn pair(
    State(state): State<HubState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<PairRequest>,
) -> ApiResult<Json<PairResponse>> {
    if pair_limited(&state, addr.ip()).await {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "配对尝试次数过多，请稍后再试",
        ));
    }

    let expected = state.inner.session_code.read().await.clone();
    if !constant_time_eq(body.code.trim(), &expected) {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "配对失败"));
    }

    state.inner.pair_failures.lock().await.remove(&addr.ip());
    let token = format!(
        "{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    );
    let expires_at = Instant::now() + token_ttl();
    {
        let mut tokens = state.inner.tokens.write().await;
        let now = Instant::now();
        tokens.retain(|entry| entry.expires_at > now);
        if tokens.len() >= 256 {
            tokens.remove(0);
        }
        tokens.push(TokenEntry { token: token.clone(), expires_at });
    }
    let expires_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .saturating_add(token_ttl())
        .as_millis() as u64;

    Ok(Json(PairResponse { token, expires_at: expires_ms }))
}

async fn get_session(
    State(state): State<HubState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> ApiResult<Json<SessionInfo>> {
    if !addr.ip().is_loopback() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "会话码只允许本机读取",
        ));
    }
    let code = state.inner.session_code.read().await.clone();
    Ok(Json(SessionInfo { code }))
}

async fn rotate_session(
    State(state): State<HubState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> ApiResult<Json<SessionInfo>> {
    if !addr.ip().is_loopback() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "会话码只允许本机轮换",
        ));
    }
    let code = generate_session_code();
    *state.inner.session_code.write().await = code.clone();
    state.inner.tokens.write().await.clear();
    Ok(Json(SessionInfo { code }))
}

async fn get_info(State(state): State<HubState>) -> Json<Info> {
    let files = state.inner.files.read().await.len();
    let mut ips: Vec<String> = state
        .inner
        .local_ips
        .iter()
        .filter(|ip| !ip.starts_with("169.254."))
        .cloned()
        .collect();
    ips.sort_by_key(|ip| {
        if ip.starts_with("192.168.") {
            0
        } else if ip.starts_with("10.") {
            1
        } else if ip.starts_with("172.") {
            2
        } else {
            3
        }
    });

    Json(Info {
        name: "Filebridge-Lan Hub",
        version: HUB_VERSION,
        port: state.inner.port,
        ips,
        files,
    })
}

async fn list_files(State(state): State<HubState>) -> Json<Vec<Meta>> {
    let mut files: Vec<Meta> = state.inner.files.read().await.values().cloned().collect();
    files.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Json(files)
}

async fn sse_events(
    State(state): State<HubState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let receiver = state.inner.events.subscribe();
    let stream = BroadcastStream::new(receiver).filter_map(|message| async move {
        let event = message.ok()?;
        let data = serde_json::to_string(&event).ok()?;
        Some(Ok(Event::default().event("upload").data(data)))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn api_not_found() -> ApiError {
    ApiError::not_found("接口不存在")
}

#[derive(Deserialize)]
struct UploadQuery {
    name: Option<String>,
}

async fn upload(
    State(state): State<HubState>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Body,
) -> ApiResult<Json<Meta>> {
    let raw_name = query
        .name
        .ok_or_else(|| ApiError::bad_request("缺少 name 参数"))?;
    let name = sanitize_name(&raw_name);
    let id = Uuid::new_v4().to_string();
    let part = state.inner.tmp_dir.join(format!("{id}.part"));
    let total = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);

    state.emit_upload(&id, &name, 0, total, "started");
    let outcome = store_upload(&state, &id, &name, &part, &headers, total, body).await;
    match &outcome {
        Ok(meta) => state.emit_upload(&id, &name, meta.size, meta.size, "completed"),
        Err(_) => state.emit_upload(&id, &name, 0, total, "failed"),
    }
    if outcome.is_err() {
        let _ = tokio::fs::remove_file(&part).await;
    }

    outcome.map(Json)
}

async fn store_upload(
    state: &HubState,
    id: &str,
    name: &str,
    part: &Path,
    headers: &HeaderMap,
    total: u64,
    body: Body,
) -> ApiResult<Meta> {
    let mut file = BufWriter::with_capacity(
        1024 * 1024,
        File::create(part).await.map_err(ApiError::internal)?,
    );
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut stream = body.into_data_stream();
    let mut read_nanos: u128 = 0;
    let mut write_nanos: u128 = 0;
    let mut hash_nanos: u128 = 0;
    let mut last_emit = Instant::now() - Duration::from_millis(250);

    while let Some(chunk) = stream.next().await {
        let read_start = Instant::now();
        let chunk = chunk.map_err(|error| ApiError::bad_request(format!("读取请求体失败: {error}")))?;
        read_nanos += read_start.elapsed().as_nanos();

        let hash_start = Instant::now();
        hasher.update(&chunk[..]);
        hash_nanos += hash_start.elapsed().as_nanos();

        received += chunk.len() as u64;

        let write_start = Instant::now();
        file.write_all(&chunk).await.map_err(ApiError::internal)?;
        write_nanos += write_start.elapsed().as_nanos();

        if last_emit.elapsed() >= Duration::from_millis(200) {
            state.emit_upload(id, name, received, total, "progress");
            last_emit = Instant::now();
        }
    }

    let flush_start = Instant::now();
    file.flush().await.map_err(ApiError::internal)?;
    let flush_nanos = flush_start.elapsed().as_nanos();
    drop(file);

    if std::env::var_os("FILEBRIDGE_LAN_HUB_PROFILE").is_some() {
        hub_log!(
            "[hub] profile {} bytes: read {} ms, write {} ms, hash {} ms, flush {} ms",
            received,
            read_nanos / 1_000_000,
            write_nanos / 1_000_000,
            hash_nanos / 1_000_000,
            flush_nanos / 1_000_000
        );
    }

    let expected = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);

    if expected > 0 && expected != received {
        return Err(ApiError::bad_request(format!(
            "上传不完整：期望 {expected}，实际 {received}"
        )));
    }

    let final_path = state.file_path(id);
    tokio::fs::rename(part, &final_path)
        .await
        .map_err(ApiError::internal)?;

    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "application/octet-stream".to_string());

    let meta = Meta {
        id: id.to_string(),
        name: name.to_string(),
        size: received,
        sha256: format!("{:x}", hasher.finalize()),
        mime,
        created_at: now_millis(),
    };

    let meta_bytes = serde_json::to_vec_pretty(&meta).map_err(ApiError::internal)?;
    if let Err(error) = tokio::fs::write(state.meta_path(id), meta_bytes).await {
        let _ = tokio::fs::remove_file(&final_path).await;
        return Err(ApiError::internal(error));
    }

    state.inner.files.write().await.insert(id.to_string(), meta.clone());
    hub_log!("[hub] 上传完成: {} ({} bytes)", meta.name, meta.size);
    Ok(meta)
}

async fn download(
    State(state): State<HubState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let meta = state
        .inner
        .files
        .read()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(|| ApiError::not_found("文件不存在"))?;

    let path = state.file_path(&id);
    let file_meta = tokio::fs::metadata(&path)
        .await
        .map_err(|_| ApiError::not_found("文件已丢失"))?;
    let len = file_meta.len();

    let disposition = HeaderValue::from_str(&content_disposition(&meta.name))
        .unwrap_or_else(|_| HeaderValue::from_static("attachment"));
    let content_type = HeaderValue::from_str(&meta.mime)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));

    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());

    if let Some(range) = range {
        let (start, end) = parse_range(range, len)?;
        let mut file = File::open(&path).await.map_err(ApiError::internal)?;
        file.seek(SeekFrom::Start(start))
            .await
            .map_err(ApiError::internal)?;
        let stream = ReaderStream::with_capacity(file.take(end - start + 1), 1024 * 1024);
        let body = Body::from_stream(stream);

        Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CONTENT_DISPOSITION, disposition)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
            .header(header::CONTENT_LENGTH, (end - start + 1).to_string())
            .header(header::CACHE_CONTROL, "no-store")
            .body(body)
            .map_err(ApiError::internal)
    } else {
        let file = File::open(&path).await.map_err(ApiError::internal)?;
        let stream = ReaderStream::with_capacity(file, 1024 * 1024);
        let body = Body::from_stream(stream);

        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CONTENT_DISPOSITION, disposition)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, len.to_string())
            .header(header::CACHE_CONTROL, "no-store")
            .body(body)
            .map_err(ApiError::internal)
    }
}

async fn delete_file(
    State(state): State<HubState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<StatusCode> {
    let removed = state.inner.files.write().await.remove(&id);
    let Some(meta) = removed else {
        return Err(ApiError::not_found("文件不存在"));
    };

    let _ = tokio::fs::remove_file(state.file_path(&id)).await;
    let _ = tokio::fs::remove_file(state.meta_path(&id)).await;
    hub_log!("[hub] 删除文件: {}", meta.name);
    Ok(StatusCode::NO_CONTENT)
}

fn parse_range(value: &str, len: u64) -> ApiResult<(u64, u64)> {
    let spec = value
        .strip_prefix("bytes=")
        .ok_or_else(ApiError::range_not_satisfiable)?;
    let (start_text, end_text) = spec
        .split_once('-')
        .ok_or_else(ApiError::range_not_satisfiable)?;

    if len == 0 {
        return Err(ApiError::range_not_satisfiable());
    }

    let last = len - 1;

    if start_text.is_empty() {
        let suffix: u64 = end_text
            .parse::<u64>()
            .map_err(|_| ApiError::range_not_satisfiable())?;
        if suffix == 0 {
            return Err(ApiError::range_not_satisfiable());
        }
        Ok((len.saturating_sub(suffix), last))
    } else {
        let start: u64 = start_text
            .parse::<u64>()
            .map_err(|_| ApiError::range_not_satisfiable())?;
        let end: u64 = if end_text.is_empty() {
            last
        } else {
            end_text
                .parse::<u64>()
                .map_err(|_| ApiError::range_not_satisfiable())?
                .min(last)
        };

        if start > end || start >= len {
            return Err(ApiError::range_not_satisfiable());
        }
        Ok((start, end))
    }
}

pub(crate) fn sanitize_name(raw: &str) -> String {
    let base = raw
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or("file");

    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();

    let trimmed = cleaned
        .trim()
        .trim_end_matches(|c| c == '.' || c == ' ');

    let mut safe: String = if trimmed.is_empty() {
        "file".to_string()
    } else {
        trimmed.chars().take(200).collect()
    };

    let lower = safe.to_lowercase();
    let reserved = [
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7",
        "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    if reserved
        .iter()
        .any(|name| lower == *name || lower.starts_with(&format!("{name}.")))
    {
        safe = format!("_{safe}");
    }

    safe
}

fn content_disposition(name: &str) -> String {
    let ascii: String = name
        .chars()
        .map(|c| if c.is_ascii_graphic() || c == ' ' { c } else { '_' })
        .collect();
    let ascii = ascii.replace('"', "_").replace('\\', "_");
    let encoded = percent_encoding::utf8_percent_encode(name, percent_encoding::NON_ALPHANUMERIC)
        .to_string();
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_handles_paths_and_reserved_names() {
        assert_eq!(sanitize_name("../../evil.txt"), "evil.txt");
        assert_eq!(sanitize_name("CON.txt"), "_CON.txt");
        assert_eq!(sanitize_name("a/b\\c.txt"), "c.txt");
        assert_eq!(sanitize_name("  "), "file");
        assert_eq!(sanitize_name("中文 文件.bin"), "中文 文件.bin");
    }

    #[test]
    fn range_parsing() {
        assert_eq!(parse_range("bytes=0-1023", 2048).unwrap(), (0, 1023));
        assert_eq!(parse_range("bytes=1024-", 2048).unwrap(), (1024, 2047));
        assert_eq!(parse_range("bytes=-1024", 2048).unwrap(), (1024, 2047));
        assert!(parse_range("bytes=4096-", 2048).is_err());
        assert!(parse_range("bytes=-0", 2048).is_err());
        assert!(parse_range("nonsense", 2048).is_err());
    }
}
