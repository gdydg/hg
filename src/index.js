import { Hono } from 'hono';
import { Redis } from '@upstash/redis';

const app = new Hono();

// ==================== 1. 核心指纹与Token配置 ====================
const STATIC_HASH = "373c3c5eddd48672e373817c3ae6d27ea8294fdf78ffaeafff46ba807f55a186";
const DOMAIN = "2x2the4scoihla6w.app";
const UUID = "f50743a72e22fde30abfc716e1e24a32";
const AUTH_TOKEN = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpY2xhaW1zIjp7ImxhbmRsb3JkX2lkIjoicGQzIiwidXNlcl9pZCI6InBkM19hbGluYTI1IiwidXNlcl90YWdfaWQiOjAsInVzZXJfYWNjb3VudCI6InBkM19hbGluYTI1IiwidHlwZSI6MCwidXNlcl9uYW1lIjoiYWxpbmEyNSIsImRldmljZSI6MSwiY3VycmVuY3kiOiJDTlkiLCJzcGVjaWFsX2xpbWl0IjoiMCIsInRhZ19pZCI6MCwidGFnX25hbWUiOiIiLCJ0YWdfc3BlY2lhbF9saW1pdCI6IjAiLCJ0YWdfZXh0cmFfZGVsYXkiOjAsInRhZ19pc19iZXQiOjAsInRhZ19pc190ZXN0IjowLCJ0YWdfaXNfZWFybHkiOjB9LCJsYW5nIjoiZW4iLCJ0aW1lem9uZSI6IlVUQyIsImlzcyI6Imp3dCIsImV4cCI6MTc4MTIzOTY1NywiaWF0IjoxNzgxMTUzMjU3fQ.xwXVqCn33hAiYdT7dsX3hRA_Alnq8DlDm8OeQa8lsa4";

const TARGET_SIDS = {
    1: "足球",
    2: "篮球",
    3: "网球",
    4: "棒球",
    9: "羽毛球",
    29: "乒乓球"
};

const REDIS_KEY = "sports_live_streams";

// ==================== 2. 公共伪装 Headers ====================
function getHeaders() {
    const ts = Date.now();
    const rawStr = `${STATIC_HASH}|${DOMAIN}|${UUID}|${ts}|`;
    const dynamicChecksum = btoa(rawStr); // Base64 编码

    return {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'zh-cn',
        'apptype': '2',
        'authorization': AUTH_TOKEN,
        'browser': 'Chrome',
        'cks': '1781153259a817d',
        'currency': 'CNY',
        'device': 'mobile',
        'origin': `https://${DOMAIN}`,
        'referer': `https://${DOMAIN}/`,
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'x-uuid': UUID,
        'x-checksum': dynamicChecksum
    };
}

// ==================== 3. 抓取逻辑封装 ====================
async function fetchMatchesForSid(sid) {
    const url = `https://pub-nwapi-ddos.ewlcs.com/product/business/sport/tournament/info?sid=${sid}&sort=tournament&inplay=true&language=zh-cn`;
    try {
        const res = await fetch(url, { headers: getHeaders() });
        const data = await res.json();
        const matches = [];

        if (data.code === 0 && data.data?.tournaments) {
            for (const tour of data.data.tournaments) {
                for (const match of (tour.matches || [])) {
                    if (match.iid) {
                        matches.push({
                            iid: String(match.iid),
                            title: `${match.home?.name || '未知主队'} VS ${match.away?.name || '未知客队'}`,
                            league: tour.name || '未知联赛',
                            sid_name: TARGET_SIDS[sid]
                        });
                    }
                }
            }
        }
        return matches;
    } catch (e) {
        console.error(`SID ${sid} 列表获取失败`, e);
        return [];
    }
}

async function fetchStreamsForMatch(sid, iid) {
    const url = `https://pub-nwapi-ddos.ewlcs.com/product/business/sport/inplay/match?sid=${sid}&iid=${iid}&language=zh-cn`;
    try {
        const res = await fetch(url, { headers: getHeaders() });
        const data = await res.json();
        const streams = [];
        const videos = data.data?.data?.videos || [];
        
        for (const v of videos) {
            if (v.info && v.info.includes("http")) {
                streams.push(v.info);
            }
        }
        return streams;
    } catch (e) {
        return [];
    }
}

// ==================== 4. 路由与接口定义 ====================

// 初始化 Redis 连接 (依赖于环境变量)
const getRedisClient = (env) => {
    return new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
    });
};

// 触发抓取接口：/trigger
app.get('/trigger', async (c) => {
    const redis = getRedisClient(c.env);
    const allResults = [];

    // 为了避免 Serverless 超时，这里采用 Promise.all 并发请求 SIDs
    const sidPromises = Object.keys(TARGET_SIDS).map(async (sid) => {
        const matches = await fetchMatchesForSid(sid);
        if (matches.length === 0) return;

        // 并发请求具体比赛的直播流地址 (可根据实际情况加并发控制)
        const streamPromises = matches.map(async (match) => {
            const streams = await fetchStreamsForMatch(sid, match.iid);
            if (streams.length > 0) {
                return { ...match, streams };
            }
            return null;
        });

        const resolvedStreams = await Promise.all(streamPromises);
        allResults.push(...resolvedStreams.filter(item => item !== null));
    });

    await Promise.all(sidPromises);

    // 覆盖写入 Upstash 数据库 (过期时间设置为 2 小时)
    await redis.set(REDIS_KEY, JSON.stringify(allResults), { ex: 7200 });

    return c.json({
        success: true,
        message: "抓取并覆盖写入完成",
        total_matches: allResults.length,
        time: new Date().toISOString()
    });
});

// 获取 TXT 格式接口：/txt
app.get('/txt', async (c) => {
    const redis = getRedisClient(c.env);
    const dataStr = await redis.get(REDIS_KEY);
    const data = typeof dataStr === 'string' ? JSON.parse(dataStr) : (dataStr || []);

    let txtContent = `=== 体育滚球数据分析报告 ===\n生成时间: ${new Date().toISOString()}\n总计捕获到直播流的比赛: ${data.length} 场\n==================================================\n\n`;

    data.forEach(r => {
        txtContent += `【运动】: ${r.sid_name}\n`;
        txtContent += `【联赛】: ${r.league}\n`;
        txtContent += `【对阵】: ${r.title}\n`;
        txtContent += `【赛事ID】: ${r.iid}\n`;
        r.streams.forEach(url => {
            txtContent += `【信号流】: ${url}\n`;
        });
        txtContent += "----------------------------------------\n";
    });

    return c.text(txtContent);
});

// 获取 M3U 格式接口：/m3u
app.get('/m3u', async (c) => {
    const redis = getRedisClient(c.env);
    const dataStr = await redis.get(REDIS_KEY);
    const data = typeof dataStr === 'string' ? JSON.parse(dataStr) : (dataStr || []);

    let m3uContent = "#EXTM3U\n";

    data.forEach(r => {
        r.streams.forEach((url, idx) => {
            m3uContent += `#EXTINF:-1 group-title="${r.sid_name}直播", ${r.league} | ${r.title} (线路${idx + 1})\n`;
            m3uContent += `${url}\n`;
        });
    });

    // 设置 Header，让浏览器或播放器识别为播放列表文件
    c.header('Content-Type', 'application/vnd.apple.mpegurl');
    c.header('Content-Disposition', 'attachment; filename="sports_live.m3u"');
    
    return c.body(m3uContent);
});

// 根路由探测
app.get('/', (c) => c.text('Sports Live Edge API is running.'));

export default app;
