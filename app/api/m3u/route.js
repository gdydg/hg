import { NextResponse } from 'next/server';
import { getRedisClient, getAllData } from '../shared';

export const runtime = 'edge';

export async function GET() {
    const redis = getRedisClient();
    const data = await getAllData(redis);

    let m3uContent = "#EXTM3U\n";

    data.forEach(r => {
        r.streams.forEach((url, idx) => {
            // 统一设置 group-title 为 "皇冠线路"
            m3uContent += `#EXTINF:-1 group-title="皇冠线路", ${r.sid_name} | ${r.title} (线路${idx + 1})\n`;
            m3uContent += `${url}\n`;
        });
    });

    return new NextResponse(m3uContent, {
        headers: {
            // 强制指定 M3U 文件类型，方便部分播放器直接拉取识别
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Content-Disposition': 'attachment; filename="sports_live.m3u"'
        }
    });
}
