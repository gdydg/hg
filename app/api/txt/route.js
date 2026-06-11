import { NextResponse } from 'next/server';
import { getRedisClient, getAllData } from '../shared';

// 强制使用 Edge Runtime (边缘节点运行，速度更快)
export const runtime = 'edge';

export async function GET() {
    const redis = getRedisClient();
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

    return new NextResponse(txtContent, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8'
        }
    });
}
