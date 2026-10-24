# Third-party notices

Filebridge-Lan itself is licensed under the [MIT License](LICENSE).

This project depends on third-party open-source packages. The main license families are:

## Rust (src-tauri)

- MIT / Apache-2.0 (most crates)
- BSD-2-Clause / BSD-3-Clause
- ISC
- Unicode-3.0
- Zlib
- MPL-2.0: `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`, `selectors`
- `MIT OR Apache-2.0 OR LGPL-2.1-or-later` dual/triple-licensed crates (use MIT/Apache option)

MPL-2.0 is file-level copyleft. These crates are used unmodified; their source is available from crates.io and the MPL-2.0 text is at <https://www.mozilla.org/MPL/2.0/>.

## JavaScript / npm

- MIT (majority)
- ISC
- Apache-2.0 / Apache-2.0 OR MIT
- BSD-3-Clause
- CC-BY-4.0: `caniuse-lite` browser compatibility data, © caniuse.com contributors, <https://caniuse.com/>

## Runtime

- Tauri: MIT / Apache-2.0
- Microsoft Edge WebView2: Microsoft terms; the installer embeds the WebView2 bootstrapper and downloads the runtime only if needed

## Release binaries

Full license texts are distributed with the corresponding crates/npm packages. If you distribute a compiled binary, include this notice and the dependency license texts (for example with `cargo-about` / `license-checker`) alongside the installer.

This file is a summary, not legal advice. Verify the exact license of any newly added dependency.
