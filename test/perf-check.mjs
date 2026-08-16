// 本番サイトの読み込み性能計測。モバイル回線相当(4G: 遅延100ms/下り5Mbps + CPU4倍遅)で
// index.html のランディング表示までを分解計測する。
// 前提: Chrome を --remote-debugging-port=9333 で起動しておく(E2Eと同じ方式)
import puppeteer from "puppeteer-core";

const URL = process.argv[2] || "https://himpeki.github.io/kids-bank/";
const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9333",
  defaultViewport: { width: 390, height: 844, isMobile: true, deviceScaleFactor: 3 },
});

async function run(label, ctx) {
  const page = await ctx.newPage();
  const client = await page.createCDPSession();
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 100,
    downloadThroughput: (5 * 1024 * 1024) / 8,
    uploadThroughput: (1.5 * 1024 * 1024) / 8,
  });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  const tDcl = Date.now() - t0;
  await page.waitForSelector("#landing:not(.hidden)", { timeout: 60000 });
  const tLanding = Date.now() - t0;

  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return { ttfb: Math.round(n.responseStart) };
  });
  const resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((r) => ({
      name: r.name,
      dur: Math.round(r.duration),
      start: Math.round(r.startTime),
      size: r.transferSize,
    })),
  );

  console.log(`\n=== ${label} ===`);
  console.log(`HTML表示(DCL): ${tDcl}ms / ランディング表示完了: ${tLanding}ms (TTFB ${nav.ttfb}ms)`);

  const byHost = {};
  for (const r of resources) {
    let h;
    try { h = new globalThis.URL(r.name).host; } catch { h = "?"; }
    byHost[h] = byHost[h] || { n: 0, size: 0 };
    byHost[h].n++;
    byHost[h].size += r.size || 0;
  }
  console.log("ホスト別 転送量:");
  for (const [h, v] of Object.entries(byHost))
    console.log(`  ${h}: ${v.n}件 ${(v.size / 1024).toFixed(0)}KB`);

  console.log("時間のかかったリソース上位:");
  for (const r of [...resources].sort((a, b) => b.dur - a.dur).slice(0, 8))
    console.log(
      `  ${String(r.dur).padStart(5)}ms (開始+${String(r.start).padStart(5)}ms, ${((r.size || 0) / 1024).toFixed(0)}KB) ${r.name.replace(/^https?:\/\//, "").slice(0, 90)}`,
    );

  await page.close();
  return tLanding;
}

// 初回(新規コンテキスト=キャッシュなし)と2回目(同一コンテキスト=キャッシュあり)
const ctx = await browser.createBrowserContext();
try {
  await run("初回アクセス(キャッシュなし・4G相当)", ctx);
  await run("2回目アクセス(キャッシュあり・4G相当)", ctx);
} finally {
  await ctx.close();
  await browser.disconnect();
}
