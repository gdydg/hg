import { NextResponse } from 'next/server';
import { 
    getRedisClient, TARGET_SIDS, REDIS_KEY_PREFIX, 
    fetchMatchesForSid, fetchStreamsForMatch 
} from '../shared';

export const runtime = 'edge';
// 允许该接口执行最长 60 秒 (如果在 Vercel/NextJS 环境中)
export const maxDuration = 60; 

export async function GET(request) {
    const redis = getRedisClient();
    
    // 解析 URL 参数，支持 ?sid=1 这种形式
    const { searchParams } = new URL(request.url);
    const targetSid = searchParams.get('sid');
    
    const sidsToProcess = targetSid ? [targetSid] : Object.keys(TARGET_SIDS);
    let totalMatches = 0;

    for (const sid of sidsToProcess) {
        if (!TARGET_SIDS[sid]) continue;

        const matches = await fetchMatchesForSid(sid);
        if (matches.length === 0) {
            await redis.set(`${REDIS_KEY_PREFIX}_${sid}`, JSON.stringify([]), { ex: 7200 });
            continue;
        }

        const resolvedStreams = [];
        const chunkSize = 5; 
        
        for (let i = 0; i < matches.length; i += chunkSize) {
            const chunk = matches.slice(i, i + chunkSize);
            const streamPromises = chunk.map(async (match) => {
                const streams = await fetchStreamsForMatch(sid, match.iid);
                if (streams.length > 0) return { ...match, streams };
                return null;
            });
            
            const chunkResults = await Promise.all(streamPromises);
            resolvedStreams.push(...chunkResults.filter(item => item !== null));
        }

        await redis.set(`${REDIS_KEY_PREFIX}_${sid}`, JSON.stringify(resolvedStreams), { ex: 7200 });
        totalMatches += resolvedStreams.length;
    }

    return NextResponse.json({
        success: true,
        message: targetSid ? `SID ${targetSid} (${TARGET_SIDS[targetSid]}) 抓取完成` : "全量抓取完成",
        total_matches: totalMatches,
        time: new Date().toISOString()
    });
}
