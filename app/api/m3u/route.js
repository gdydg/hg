import { NextResponse } from 'next/server';
import { getRedisClient, getAllData } from '../shared';

export const runtime = 'edge';

export async function GET() {
    const redis = getRedisClient();
    const data = await getAllData(redis);

    let m3uContent = "#EXTM3U\n";

    data.forEach(r => {
        r.streams.forEach((url, idx) => {
            m3uContent += `#EXTINF:-1 group-title="${r.sid_name}直播", ${r.league} | ${r.title} (线路${idx + 1})\n`;
            m3uContent += `${url}\n`;
        });
    });

    return new NextResponse(m3uContent, {
        headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Content-Disposition': 'attachment; filename="sports_live.m3u"'
        }
    });
}
