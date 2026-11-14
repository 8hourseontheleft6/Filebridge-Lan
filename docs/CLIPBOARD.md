# Text Clipboard Sync Protocol

Status: 1.6.0-preview.4. Node Hub and Rust Hub implement the same contract.

## Access

- Every endpoint requires the existing approved bearer token. No token → `401`.
- Enabling requires a loopback request (`127.0.0.1` / `::1`) **and** a valid bearer token; a remote caller gets `403 clipboard_host_only`.
- The Hub starts enabled so the approved desktop session can begin syncing immediately. The user can disable it at any time, which clears the in-memory text.
- Text is in memory only; no file, no discovery beacon, no URL query, no normal log.

## Limits

- `text/plain` only; one item at a time.
- Maximum UTF-8 size: **256 KiB (262144 bytes)**.
- Write rate limit: 30/minute global and 10/minute per client IP.
- All responses are JSON; errors include `error` and a stable `code` when applicable.

## Endpoints

### `GET /api/clipboard`

Returns:

```json
{
  "enabled": true,
  "text": "latest text",
  "hash": "sha256-hex",
  "updatedAt": 1760000000000,
  "revision": 3,
  "source": "phone",
  "maxBytes": 262144
}
```

When disabled: `enabled=false`, `text/hash/updatedAt/source` are `null`.

### `POST /api/clipboard`

```json
{"text": "plain text"}
```

The body only carries `text`; `source` is **derived by the Hub from the socket**: a loopback request is recorded as `desktop`, anything else as `phone`. Clients must not send a source and any extra field is ignored, so a remote caller cannot claim `desktop` to suppress the host's system-clipboard write. The server computes SHA-256 and does not bump `revision` when the hash is unchanged, preventing echo loops. Response is the current snapshot.

Check order is identical in both Hubs: rate limit (`429`) → disabled (`409`) → size (`413`) → bad request (`400`).

Errors:

- `429 clipboard_rate_limited`
- `409 clipboard_disabled`
- `413 clipboard_too_large`
- `400 clipboard_bad_request`

### `DELETE /api/clipboard`

Clears the current text; keeps the enabled state.

### `POST /api/clipboard/enabled`

Requires a bearer token **and** a loopback request; a remote caller gets `403 clipboard_host_only`:

```json
{"enabled": true}
```

Returns the current snapshot. Disabling clears text.

## Browser limits

The mobile UI always keeps received text and provides a **复制** button. It only calls `navigator.clipboard.writeText` from that click and shows a manual-copy message on failure. **从剪贴板读取** fills the manual composer; if permission fails the user can still paste/type. No background silent copy is promised.

## Loop prevention

- The server deduplicates by SHA-256.
- The desktop remembers the last system-clipboard hash it wrote, so polling the system clipboard does not echo phone-originated text back.
- Desktop-originated text is not written back to the system clipboard by the receive path.
