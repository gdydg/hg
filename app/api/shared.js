import { Redis } from '@upstash/redis';

// ==================== 1. 核心指纹与Token配置 ====================
const STATIC_HASH = "373c3c5eddd48672e373817c3ae6d27ea8294fdf78ffaeafff46ba807f55a186";
const DOMAIN = "2x2the4scoihla6w.app";
const UUID = "f50743a72e22fde30abfc716e1e24a32";
const AUTH_TOKEN = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpY2xhaW1zIjp7ImxhbmRsb3JkX2lkIjoicGQzIiwidXNlcl9pZCI6InBkM19hbGluYTI1IiwidXNlcl90YWdfaWQiOjAsInVzZXJfYWNjb3VudCI6InBkM19hbGluYTI1IiwidHlwZSI6MCwidXNlcl9uYW1lIjoiYWxpbmEyNSIsImRldmljZSI6MSwiY3VycmVuY3kiOiJDTlkiLCJzcGVjaWFsX2xpbWl0IjoiMCIsInRhZ19pZCI6MCwidGFnX25hbWUiOiIiLCJ0YWdfc3BlY2lhbF9saW1pdCI6IjAiLCJ0YWdfZXh0cmFfZGVsYXkiOjAsInRhZ19pc19iZXQiOjAsInRhZ19pc190ZXN0IjowLCJ0YWdfaXNfZWFybHkiOjB9LCJsYW5nIjoiZW4iLCJ0aW1lem9uZSI6IlVUQyIsImlzcyI6Imp3dCIsImV4cCI6MTc4MTIzOTY1NywiaWF0IjoxNzgxMTUzMjU3fQ.xwXVqCn33hAiYdT7dsX3hRA_Alnq8DlDm8OeQa8lsa4";

export const TARGET_SIDS = {
    1: "足球", 2: "篮球", 3: "网球", 4: "棒球", 9: "羽毛球", 29: "乒乓球"
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
    const rawStr = `${STATIC_HASH}|${DOMAIN}|${UUID}|${ts}|`;
    const dynamicChecksum = btoa(rawStr); 

    return {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'zh-cn',
        'apptype': '2',
        'authorization': AUTH_TOKEN,
        'origin': `https://${DOMAIN}`,
        'referer': `https://${DOMAIN}/`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/148.0.0.0 Safari/537.36',
        'x-uuid': UUID,
        'x-checksum': dynamicChecksum
    };
}

export async function fetchMatchesForSid(sid) {
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
        return [];
    }
}

export async function fetchStreamsForMatch(sid, iid) {
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
