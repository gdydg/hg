import { Hono } from 'hono';
import { Redis } from '@upstash/redis';

const app = new Hono();

// ==================== 1. 核心指纹与Token配置 ====================
const STATIC_HASH = "373c3c5eddd48672e373817c3ae6d27ea8294fdf78ffaeafff46ba807f55a186";
const DOMAIN = "2x2the4scoihla6w.app";
const UUID = "f50743a72e22fde30abfc716e1e24a32";
const AUTH_TOKEN = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpY2xhaW1zIjp7ImxhbmRsb3JkX2lkIjoicGQzIiwidXNlcl9pZCI6InBkM19hbGluYTI1IiwidXNlcl90YWdfaWQiOjAsInVzZXJfYWNjb3VudCI6InBkM19hbGluYTI1IiwidHlwZSI6MCwidXNlcl9uYW1lIjoiYWxpbmEyNSIsImRldmljZSI6MSwiY3VycmVuY3kiOiJDTlkiLCJzcGVjaWFsX2xpbWl0IjoiMCIsInRhZ19pZCI6MCwidGFnX25hbWUiOiIiLCJ0YWdfc3BlY2lhbF9saW1pdCI6IjAiLCJ0YWdfZXh0cmFfZGVsYXkiOjAsInRhZ19pc19iZXQiOjAsInRhZ19pc190ZXN0IjowLCJ0YWdfaXNfZWFybHkiOjB9LCJsYW5nIjoiZW4iLCJ0aW1lem9uZSI6IlVUQyIsImlzcyI6Imp3dCIsImV4cCI6MTc4MTIzOTY1NywiaWF0IjoxNzgxMTUzMjU3fQ.xwXVqCn33hAiYdT7dsX3hRA_Alnq8DlDm8OeQa8lsa4";

// 需要抓取的目标运动类型
const TARGET_SIDS = {
    1: "足球",
    2: "篮球",
    3: "网球",
    4: "棒球",
    9: "羽毛球",
    29: "乒乓球"
};

const REDIS_KEY_PREFIX = "sports_live_streams";

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
        console.error(`SID ${sid} 列表获取失败:`, e);
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

// 初始化 Redis 连接 (依赖于 EdgeOne 环境变量)
const getRedisClient = (env) => {
    return new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
    });
};

// 接口 1: 触发抓取接口：/trigger
// 支持全量或通过 /trigger?sid=1 单独触发
app.get('/trigger', async (c) => {
    const redis = getRedisClient(c.env);
    const targetSid = c.req.query('sid'); 
    
    // 如果指定了 sid 就只抓那一个，否则抓取全部
    const sidsToProcess = targetSid 
        ? [targetSid] 
        : Object.keys(TARGET_SIDS);

    let totalMatches = 0;

    // 串行处理大类，避免瞬间触发防 CC 拦截
    for (const sid of sidsToProcess) {
        if (!TARGET_SIDS[sid]) continue;

        const matches = await fetchMatchesForSid(sid);
        if (matches.length === 0) {
            // 如果该运动当前没有比赛，清空旧缓存
            await redis.set(`${REDIS_KEY_PREFIX}_${sid}`, JSON.stringify([]), { ex: 7200 });
            continue;
        }

        const resolvedStreams = [];
        
        // 核心修复：限制并发，每次只并发 5 个请求，防止 504 超时
        const chunkSize = 5; 
        for (let i = 0; i < matches.length; i += chunkSize) {
            const chunk = matches.slice(i, i + chunkSize);
            const streamPromises = chunk.map(async (match) => {
                const streams = await fetchStreamsForMatch(sid, match.iid);
                if (streams.length > 0) {
                    return { ...match, streams };
                }
                return null;
            });
            
            const chunkResults = await Promise.all(streamPromises);
            resolvedStreams.push(...chunkResults.filter(item => item !== null));
        }

        // 按 SID 独立存入 Redis，避免更新某一个运动时把其他的覆盖掉，过期时间 2 小时
        await redis.set(`${REDIS_KEY_PREFIX}_${sid}`, JSON.stringify(resolvedStreams), { ex: 7200 });
        totalMatches += resolvedStreams.length;
    }

    return c.json({
        success: true,
        message: targetSid ? `SID ${targetSid} (${TARGET_SIDS[targetSid]}) 抓取完成` : "全量抓取完成",
        total_matches: totalMatches,
        time: new Date().toISOString()
    });
});

// 获取所有 Redis 数据的聚合函数
async function getAllData(redis) {
    const sids = Object.keys(TARGET_SIDS);
    let allData = [];
    
    for (const sid of sids) {
        const dataStr = await redis.get(`${REDIS_KEY_PREFIX}_${sid}`);
        if (dataStr) {
            const parsedData = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
            allData = allData.concat(parsedData);
        }
    }
    return allData;
}

// 接口 2: 获取 TXT 格式清单：/txt
app.get('/txt', async (c) => {
    const redis = getRedisClient(c.env);
    const data = await getAllData(redis);

    let txtContent = `=== 体育滚球数据分析报告 ===\n生成时间: ${new Date().toISOString()}\n总计捕获到直播流的比赛: ${data.length} 场\n==================================================\n\n`;

    data.forEach(r => {
        txtContent += `【运动】: ${r.sid_name}\n`;
        txtContent += `【联赛】: ${r.league}\n`;
        txtContent += `【对阵】: ${r.title}\n`;
        txtContent += `【赛事ID】: ${r.iid}\n`;
        r.streams.forEach((url, idx) => {
            txtContent += `【信号流 ${idx + 1}】: ${url}\n`;
        });
        txtContent += "----------------------------------------\n";
    });

    return c.text(txtContent);
});

// 接口 3: 获取 M3U 播放列表：/m3u
app.get('/m3u', async (c) => {
    const redis = getRedisClient(c.env);
    const data = await getAllData(redis);

    let m3uContent = "#EXTM3U\n";

    data.forEach(r => {
        r.streams.forEach((url, idx) => {
            m3uContent += `#EXTINF:-1 group-title="${r.sid_name}直播", ${r.league} | ${r.title} (线路${idx + 1})\n`;
            m3uContent += `${url}\n`;
        });
    });

    // 强行指定文件头为 M3U，方便播放器识别
    c.header('Content-Type', 'application/vnd.apple.mpegurl');
    c.header('Content-Disposition', 'attachment; filename="sports_live.m3u"');
    
    return c.body(m3uContent);
});

// 根路由：健康检查
app.get('/', (c) => c.text('Sports Live Edge API is running. Ready to fetch!'));

export default app;
