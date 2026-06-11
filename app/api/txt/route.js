import { NextResponse } from 'next/server';
import { getRedisClient, getAllData } from '../shared';

export const runtime = 'edge';

export async function GET() {
    const redis = getRedisClient();
    const data = await getAllData(redis);

    // 标准壳子播放器 TXT 格式的头部（分组名）
    let txtContent = "皇冠线路,#genre#\n";

    data.forEach(r => {
        r.streams.forEach((url, idx) => {
            // 组装频道名称，严格使用英文逗号 "," 分隔名称与链接
            const channelName = `${r.sid_name} | ${r.title} (线${idx + 1})`;
            txtContent += `${channelName},${url}\n`;
        });
    });

    return new NextResponse(txtContent, {
        headers: {
            // 必须指定 utf-8，否则电视盒子上中文会变成乱码
            'Content-Type': 'text/plain; charset=utf-8'
        }
    });
}
