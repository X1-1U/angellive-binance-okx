# Binance + OKX Live for AngelLive

這個專案包含兩個獨立的 AngelLive v2 原生插件包：

- `binance`：Binance Square Live
- `okx`：OKX Orbit Live

兩者皆使用 `globalThis.LiveParsePlugin` API v1，不是瀏覽器擴充套件，也不是 Codex 插件。

## 直接安裝

目前公開 source index：

```text
https://raw.githubusercontent.com/X1-1U/angellive-binance-okx/main/dist/source.json
```

在已安裝 AngelLive 的裝置開啟以下 deep link，可一次加入 Binance 與 OKX：

```text
angellive://install-source?source=https%3A%2F%2Fraw.githubusercontent.com%2FX1-1U%2Fangellive-binance-okx%2Fmain%2Fdist%2Fsource.json
```

若只想加入單一平台，可使用 [`dist/install-binance.txt`](dist/install-binance.txt) 或 [`dist/install-okx.txt`](dist/install-okx.txt) 內的連結。

## 支援狀態

| 功能 | Binance Square | OKX Orbit |
|---|---|---|
| 直播目錄 | 多入口合併、近期房間狀態校驗 | 多分頁切片取樣、近期房間狀態校驗 |
| 房間搜尋 | 目前直播；URL／內容 ID | 目前直播；分享碼／URL |
| 房間詳情與狀態 | 支援 | 匿名狀態 API；離線保留基本資料 |
| AngelLive 原生播放 | HLS／FLV 直播、HLS 回放 | HLS／FLV、多畫質、雙 CDN |
| 分享連結解析 | 支援 Square audio、replay、audiospace、uni-qr | 支援 stream-room `shareCode` |
| 彈幕／聊天 | 公開聊天室每 3 秒更新 | 匿名 WebSocket 即時聊天及最近歷史 |

OKX 的官方直播狀態、聊天與 Web 平台播放資訊都可以透過臨時匿名 token 讀取。本插件只把實際 HLS／FLV 媒體地址交給 AngelLive，不會把官方網頁 URL 偽裝成直播串流。

## 目錄

```text
plugins/binance/           Binance 插件原始碼、manifest、圖示
plugins/okx/               OKX 插件原始碼、manifest、圖示
fixtures/                  契約測試用的精簡 API 回應
tests/plugin-contract.test.mjs
scripts/generate_assets.sh 重新產生各平台固定尺寸圖示
scripts/build.rb           建立 ZIP、SHA-256、source JSON、deep link
scripts/validate.rb        驗證 manifest、圖示尺寸、ZIP 與 checksum
dist/                      可交付成品
```

## 建置與驗證

目前工作區已經包含建置好的成品。重新建置時：

```sh
./scripts/generate_assets.sh
BASE_URL="https://raw.githubusercontent.com/X1-1U/angellive-binance-okx/main/dist" \
SOURCE_URL="https://raw.githubusercontent.com/X1-1U/angellive-binance-okx/main/dist/source.json" \
  ./scripts/build.rb
./scripts/validate.rb
node tests/plugin-contract.test.mjs
```

`node` 只用於 mock 契約測試；打包本身只需要 macOS 的 Swift、Ruby 與 `/usr/bin/zip`。

建置會產生：

```text
dist/binance-1.2.1.zip
dist/okx-1.2.1.zip
dist/source.json
dist/source-binance.json
dist/source-okx.json
dist/install-link.txt
dist/install-binance.txt
dist/install-okx.txt
```

## 安裝到 AngelLive

AngelLive 的 source index 和 ZIP 都必須放在可直接下載的穩定 HTTPS 網址，且 index 內的 `zipURL` 必須是絕對網址。本倉庫使用 GitHub Raw 提供公開下載。

1. 選定靜態 HTTPS 路徑，例如本倉庫的 `https://raw.githubusercontent.com/X1-1U/angellive-binance-okx/main/dist`。
2. 用相同路徑重新執行建置：

   ```sh
   BASE_URL="https://raw.githubusercontent.com/X1-1U/angellive-binance-okx/main/dist" ./scripts/build.rb
   ```

3. 將 `dist/` 內兩個 ZIP 與所需的 source JSON 上傳到該路徑，不要在上傳後修改 ZIP。
4. 開啟對應 `install-*.txt` 內的 `angellive://install-source?...` deep link。

未設定 `BASE_URL` 時，建置器會刻意使用 `YOUR-HOST.example` 佔位網址；這份 source JSON 通過格式檢查，但在替換／重建並上傳前不能安裝。

## 技術與風險說明

- Binance 插件使用 Binance Square 現行網頁所用的公開 `/bapi/square` 與 `/bapi/composite` 接口；不需要 API key、交易權限或帳戶 cookie。
- OKX 插件使用 Orbit 網頁的公開直播目錄，並透過臨時匿名 token 讀取 HLS／FLV、房間狀態與即時聊天；不讀取或儲存 OKX 登入 cookie。
- 這些是平台前端使用、但未承諾穩定性的接口，平台改版、地區限制、限流或 WAF 都可能令插件需要更新。
- 兩個插件只讀取直播內容，不執行下單、轉帳或任何帳戶操作。
- Binance、OKX 及其標誌是各自權利人的商標；本專案是非官方社群整合。

參考：

- [AngelLive 原始碼](https://github.com/pcccccc/AngelLive)
- [AngelLive Plugin Builder](https://plugins.carsonn.works/)
- [OKX Orbit FAQ](https://www.okx.com/en-gb/help/okx-orbit-faq)
