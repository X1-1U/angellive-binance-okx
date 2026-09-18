# Binance + OKX + YouTube + Twitch Live for AngelLive

這個專案包含四個獨立的 AngelLive 原生插件包：

- `binance`：Binance Square Live
- `okx`：OKX Orbit Live
- `youtube-tw`：YouTube 台灣直播（免登入實驗版）
- `twitch-live`：Twitch 中文／全球直播與匿名聊天室（免登入實驗版）

皆使用 `globalThis.LiveParsePlugin` API v1，不是瀏覽器擴充套件，也不是 Codex 插件。

## 直接安裝

目前公開 source index：

```text
https://raw.githubusercontent.com/X1-1U/angellive-binance-okx/main/dist/source.json
```

在已安裝 AngelLive 的裝置開啟以下 deep link，可加入這四個平台：

```text
angellive://install-source?source=https%3A%2F%2Fraw.githubusercontent.com%2FX1-1U%2Fangellive-binance-okx%2Fmain%2Fdist%2Fsource.json
```

若只想加入單一平台，可使用 [`dist/install-binance.txt`](dist/install-binance.txt) 或 [`dist/install-okx.txt`](dist/install-okx.txt) 內的連結。

YouTube 獨立訂閱源（也已包含在原有總訂閱源）：

```text
https://raw.githubusercontent.com/X1-1U/angellive-binance-okx/main/dist/source-youtube-tw.json
```

## YouTube 免登入版

- 繁體中文 `hl=zh-TW`、地區 `gl=TW`，以台灣直播搜尋作推薦；新聞、遊戲、音樂、即時影像分類，每類最多合併三頁並依觀眾數排序。這不是個人化首頁，也不能保證主播位於台灣，更不是台灣代理節點。
- 即時查詢公開播放器返回的 HLS，支援自動畫質與可用分辨率；只播放正在直播的影片，不把回放／預告冒充直播。串流在裝置上即時解析，不把會過期的播放 URL 寫進訂閱源。
- 公開聊天室以 continuation 持續輪詢並去重，顯示文字、付費文字與部分會員訊息；只讀不發言。採用網站預設聊天室篩選，不保證所有被網站過濾／刪除的留言可見。
- 不需 YouTube 登入、Cookie、API key、伺服器或第三方代理。會員、年齡限制、地區限制、機器人驗證、未提供公開 HLS 或已關閉聊天室的房間不支援，會顯示明確錯誤。
- 分享添加支援 `youtube.com/watch?v=...`、`youtube.com/live/...`、`youtu.be/...` 和影片 ID。收藏對應本次影片；主播換新影片開播時需重新添加，暫不自動追蹤頻道。
- 請使用支援 `http_polling` 與 `plugin_js_v1` 定時回調的新版 AngelLive。以官方倉庫提交 `295f7dc7d36e9a9ba288a43185eff3d6ea53835f` 的協議實作；未在使用者 Apple TV／iPhone 上做端到端驗證。

2026-09-18 網路實測：台灣列表、寰宇／中天／TVBS 直播取得多畫質 HLS；持續分片檢查超過 1 分鐘，播放清單持續前進且分片 HTTP 200；中天與 TVBS 在初始歷史之後仍收到新增聊天室訊息。這是接口／分片測試，不等同於保證所有裝置長時間播放無卡頓。需要重新測試時：

```sh
node tests/youtube-contract.test.mjs
node scripts/smoke-youtube.mjs VIDEO_ID
```

實測腳本不儲存影片、不發送留言，只丟棄分片內容並輸出連線統計。

## twitch-live

獨立訂閱源（同時包含在原總訂閱源，既有使用者刷新後安裝即可）：

```text
https://raw.githubusercontent.com/X1-1U/angellive-binance-okx/main/dist/source-twitch-live.json
```

- 預設中文熱門，另有全球熱門；每類最多讀取 4 頁、120 個直播頻道，去重後按在線觀眾數排序，目錄快取 60 秒。中文語言篩選不等於台灣所在地，也不是全站完整目錄。
- 2026-09-18 實測中文首頁返回 29 間，第二頁被 Twitch `IntegrityCheckFailed` 拒絕；插件保留已取得的首頁，不繞過驗證。可用頻道搜尋或分享地址補充目錄外主播。
- 搜尋支援中文顯示名稱及英文帳號，取官方搜尋首批結果；分享添加使用 `https://www.twitch.tv/帳號`。可收藏未開播的頻道，之後依同一頻道更新直播狀態；頻道改名需重新添加。不支援回放與剪輯。
- 免登入取得公開 HLS，提供自動畫質及官方回傳的各解析度／僅音訊。**保留官方廣告，不跳過廣告，也不保證無廣告等待畫面**；會員專屬、地區限制或匿名播放被拒絕的房間不支援。
- 匿名 IRC WebSocket 即時文字彈幕，支援 PING/PONG、15 秒保活、跨資料包解析與訊息 ID 去重；斷線／伺服器要求重連時交由新版 AngelLive 重連。無歷史訊息、不發言、不支援第三方圖片表情渲染。
- `Client-ID` 是 Twitch 官網公開客戶端識別；IRC 的 `SCHMOOPIIE` 是匿名訪客協議佔位值，兩者都不是你的帳號密碼或私密 token。插件不需要 API key、Cookie 或帳號權限。
- 匿名接口不是穩定性承諾，Twitch 改版或流量限制可能使插件失效。以官方 [IRC 協議](https://dev.twitch.tv/docs/chat/irc/) 與實測匿名訪客行為實作；播放／聊天未在你的 Apple TV 或 iPhone 上做端到端驗證。

離線契約測試與唯讀網路實測：

```sh
node tests/twitch-contract.test.mjs
node scripts/smoke-twitch.mjs CHANNEL_LOGIN
```

網路測試會在公開聊天室以匿名訪客連線約一分鐘，驗證後續仍有新訊息、直播清單序號持續增加及分片可讀取；不發送聊天內容、不保存影片。

2026-09-18 `kant0211` 實測：5 次直播分片 HTTP 200、清單向前推進、匿名 IRC 已加入；前／後半段分別接收 37／60 條文字訊息。未在使用者裝置上驗證畫面渲染及長時間播放。

## 支援狀態

Binance 1.2.7／OKX 1.2.6：請求語系優先 `zh-TW`，其次 `zh-CN`。Binance 專用目錄會隨 `lang` 改變推薦主播，已由英文切換中文。這是中文優先推薦而非主播國籍或語言的嚴格篩選；OKX 是否依語系改變目錄由上游決定。**語系不是 IP 節點**：台灣出口需要在播放裝置的網路／代理上配置，插件不會偽造台灣 IP。播放與彈幕協議未更動。

2026-09-05：Binance 1.2.6／OKX 1.2.5 擴大目錄分頁，合併去重後按官方觀眾數降序排列。Binance 優先使用在線人數，缺少時才使用觀看數；零人不會誤用累計觀看數。目錄快取 30 秒（再次請求時更新），不改動播放及彈幕協議。公開目錄可能有地區、推薦與權限限制，無法保證涵蓋全站；分享地址添加仍可使用。

| 功能 | Binance Square | OKX Orbit |
|---|---|---|
| 直播目錄 | 多入口合併、近期房間狀態校驗 | 多分頁切片取樣、近期房間狀態校驗 |
| 房間搜尋 | 目前直播；URL／內容 ID | 目前直播；分享碼／URL |
| 房間詳情與狀態 | 支援 | 匿名狀態 API；離線保留基本資料 |
| AngelLive 原生播放 | HLS／FLV 直播、HLS／MP4 回放 | HLS／FLV、多畫質、雙 CDN |
| 分享連結解析 | 支援 Square audio、replay、audiospace、uni-qr | 支援 stream-room `shareCode` |
| 彈幕／聊天 | 公開 WebSocket 驅動聊天室每 3 秒增量更新 | 匿名 WebSocket 即時聊天及最近歷史 |

OKX 的官方直播狀態、聊天與 Web 平台播放資訊都可以透過臨時匿名 token 讀取。本插件只把實際 HLS／FLV 媒體地址交給 AngelLive，不會把官方網頁 URL 偽裝成直播串流。

## 目錄

```text
plugins/binance/           Binance 插件原始碼、manifest、圖示
plugins/okx/               OKX 插件原始碼、manifest、圖示
plugins/youtube-tw/           YouTube 免登入直播與聊天室
plugins/twitch-live/        Twitch 免登入直播與 IRC 彈幕
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
node tests/youtube-contract.test.mjs
node tests/twitch-contract.test.mjs
```

`node` 只用於 mock 契約測試；打包本身只需要 macOS 的 Swift、Ruby 與 `/usr/bin/zip`。

建置會產生：

```text
dist/binance-1.2.7.zip
dist/okx-1.2.6.zip
dist/youtube-tw-1.0.0.zip
dist/twitch-live-1.0.0.zip
dist/source.json
dist/source-binance.json
dist/source-okx.json
dist/source-youtube-tw.json
dist/source-twitch-live.json
dist/install-link.txt
dist/install-binance.txt
dist/install-okx.txt
dist/install-youtube-tw.txt
dist/install-twitch-live.txt
```

## 安裝到 AngelLive

AngelLive 的 source index 和 ZIP 都必須放在可直接下載的穩定 HTTPS 網址，且 index 內的 `zipURL` 必須是絕對網址。本倉庫使用 GitHub Raw 提供公開下載。

1. 選定靜態 HTTPS 路徑，例如本倉庫的 `https://raw.githubusercontent.com/X1-1U/angellive-binance-okx/main/dist`。
2. 用相同路徑重新執行建置：

   ```sh
   BASE_URL="https://raw.githubusercontent.com/X1-1U/angellive-binance-okx/main/dist" ./scripts/build.rb
   ```

3. 將 `dist/` 內目前版本的四個 ZIP 與所需的 source JSON 上傳到該路徑，不要在上傳後修改 ZIP。
4. 開啟對應 `install-*.txt` 內的 `angellive://install-source?...` deep link。

未設定 `BASE_URL` 時，建置器會刻意使用 `YOUR-HOST.example` 佔位網址；這份 source JSON 通過格式檢查，但在替換／重建並上傳前不能安裝。

## 技術與風險說明

- Binance 插件使用 Binance Square 現行網頁所用的公開 `/bapi/square` 與 `/bapi/composite` 接口；不需要 API key、交易權限或帳戶 cookie。
- OKX 插件使用 Orbit 網頁的公開直播目錄，並透過臨時匿名 token 讀取 HLS／FLV、房間狀態與即時聊天；不讀取或儲存 OKX 登入 cookie。
- 這些是平台前端使用、但未承諾穩定性的接口，平台改版、地區限制、限流或 WAF 都可能令插件需要更新。
- 四個插件只讀取直播內容，不執行下單、轉帳、發言或任何帳戶操作。
- Binance、OKX、YouTube、Twitch 及其標誌是各自權利人的商標；本專案是非官方社群整合。

參考：

- [AngelLive 原始碼](https://github.com/pcccccc/AngelLive)
- [AngelLive Plugin Builder](https://plugins.carsonn.works/)
- [OKX Orbit FAQ](https://www.okx.com/en-gb/help/okx-orbit-faq)
