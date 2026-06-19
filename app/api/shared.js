import { Redis } from '@upstash/redis';

// ==================== 1. 核心指纹与Token配置 ====================
// 🚨 警告：目前使用抓包获取的静态 Hash。如果服务端严格校验 x-checksum 与请求内容的对应关系导致 403，
// 则需要进一步逆向前端找出真实的 SHA256 加密规则。
const STATIC_HASH = "4bdc1c1091a80d644b6338f627b810cf9c5372be0989d600766a89fffed3271f";
const DOMAIN = "z2u5hpn84mjfgbej.app";
const UUID = "f50743a72e22fde30abfc716e1e24a32";
const AUTH_TOKEN = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpY2xhaW1zIjp7ImxhbmRsb3JkX2lkIjoicGQzIiwidXNlcl9pZCI6InBkM19hbGluYTI1IiwidXNlcl90YWdfaWQiOjAsInVzZXJfYWNjb3VudCI6InBkM19hbGluYTI1IiwidHlwZSI6MCwidXNlcl9uYW1lIjoiYWxpbmEyNSIsImRldmljZSI6MSwiY3VycmVuY3kiOiJDTlkiLCJzcGVjaWFsX2xpbWl0IjoiMCIsInRhZ19pZCI6MCwidGFnX25hbWUiOiIiLCJ0YWdfc3BlY2lhbF9saW1pdCI6IjAiLCJ0YWdfZXh0cmFfZGVsYXkiOjAsInRhZ19pc19iZXQiOjAsInRhZ19pc190ZXN0IjowLCJ0YWdfaXNfZWFybHkiOjB9LCJsYW5nIjoiZW4iLCJ0aW1lem9uZSI6IlVUQyIsImlzcyI6Imp3dCIsImV4cCI6MTc4MTkyNDcyOSwiaWF0IjoxNzgxODM4MzI5fQ.xu7YI2_DQfcLXF2V0TWbV-i7WxmMnAk2eN-eRrr8xr0";

export const TARGET_SIDS = {
    1: "足球", 2: "篮球", 3: "网球", 4: "棒球", 9: "羽毛球", 39: "乒乓球"
};

export const REDIS_KEY_PREFIX = "sports_live_streams";

// ==================== 2. 公共功能 ====================
export function getRedisClient() {
    return new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
}

function getHeaders() {
    const ts = Date.now();
    
    // 动态生成 cks: 10位秒级时间戳 + 5位随机十六进制
    const tsSec = Math.floor(ts / 1000);
    const randomHex = Math.floor(Math.random() * 0xfffff).toString(16).padStart(5, '0');
    const cks = `${tsSec}${randomHex}`;

    // 生成动态签名 base64
    const rawStr = `${STATIC_HASH}|${DOMAIN}|${UUID}|${ts}|`;
    const dynamicChecksum = btoa(rawStr); 

    return {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'zh-cn',
        'apptype': '2',
        'authorization': AUTH_TOKEN,
        'browser': 'Chrome',
        'cks': cks,
        'currency': 'CNY',
        'device': 'mobile',
        'origin': `https://${DOMAIN}`,
        'os': 'unknown 10',
        'priority': 'u=1, i',
        'referer': `https://${DOMAIN}/`,
        'screen': '934x898',
        'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
        'time-zone': 'GMT+08:00',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        'x-checksum': dynamicChecksum,
        'x-uuid': UUID
    };
}

// ==================== 3. 业务接口 ====================
export async function fetchMatchesForSid(sid) {
    // 已移除旧版失效的 sort=tournament 参数
    const url = `https://pub-nwapi-ddos.zuanqian8.com/product/business/sport/tournament/info?sid=${sid}&inplay=true&language=zh-cn`;
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
        console.error(`获取 sid=${sid} 比赛列表失败:`, e.message);
        return [];
    }
}

export async function fetchStreamsForMatch(sid, iid) {
    const url = `https://pub-nwapi-ddos.zuanqian8.com/product/business/sport/inplay/match?sid=${sid}&iid=${iid}&language=zh-cn`;
    try {
        const res = await fetch(url, { headers: getHeaders() });
        const data = await res.json();
        const streams = [];
        const videos = data.data?.data?.videos || [];
        
        for (const v of videos) {
            if (v.info && v.info.includes("http")) {
                let rawUrl = v.info;
                
                // URL 清洗逻辑
                // 1. 截断问号，丢弃所有尾部的 token 和时间戳参数
                let cleanUrl = rawUrl.split('?')[0]; 
                
                // 2. 将自适应画质替换为强制 1080p
                cleanUrl = cleanUrl.replace('adaptive.m3u8', '1080p.m3u8');
                
                streams.push(cleanUrl);
            }
        }
        return streams;
    } catch (e) {
        console.error(`获取 iid=${iid} 直播流失败:`, e.message);
        return [];
    }
}

export async function getAllData(redis) {
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
