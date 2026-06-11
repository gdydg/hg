# Sports Live Edge (体育滚球直播流打捞系统)

本项目基于 Hono.js 框架重构，专为边缘计算平台 (EdgeOne Pages / Cloudflare Workers / Vercel) 设计。结合 Upstash Redis 数据库，实现定时高并发抓取赛事直播流，并输出跨平台的 TXT 与 M3U 订阅源。

## 支持抓取的运动类型
- 1: 足球
- 2: 篮球
- 3: 网球
- 4: 棒球
- 9: 羽毛球
- 29: 乒乓球

## 接口说明
1. `GET /trigger` - 触发自动化爬虫，遍历上述所有类型并抓取直播流，结果将覆盖写入 Upstash 缓存（过期时间2小时）。
2. `GET /txt` - 读取缓存，输出人类可读的纯文本格式清单。
3. `GET /m3u` - 读取缓存，输出标准的 M3U 播放列表格式，可直接导入 PotPlayer / TVBox 等播放器。

## 部署到 Tencent EdgeOne Pages
1. 将此项目推送到您的 GitHub 仓库。
2. 登录 [腾讯云 EdgeOne 控制台](https://console.cloud.tencent.com/edgeone)，进入 **Pages 边缘函数**。
3. 创建项目并绑定您的 GitHub 仓库。
4. **构建设置**：
   - 框架预设：选择 `Hono` 或者 `无/Other`。
   - Install Command: `npm install`
   - Build Command: 留空 (如果无需打包，因为 Hono 可以直接被边缘运行时接管)。
5. **环境变量 (Environment Variables) 设置**：
   前往 [Upstash 控制台](https://console.upstash.com/) 创建一个免费的 Redis 数据库，在边缘函数的环境配置中填入：
   - `UPSTASH_REDIS_REST_URL` = 你的 Upstash REST API 地址
   - `UPSTASH_REDIS_REST_TOKEN` = 你的 Upstash Token
6. 点击**部署**即可获得公网 URL。

## 自动化策略
你可以使用 Github Actions，或者直接在平台（如 cron triggers）配置定时任务，每隔 30 分钟向你的 `https://你的域名/trigger` 发送一次 GET 请求，以保持直播源时刻最新。
