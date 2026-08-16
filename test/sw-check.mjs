// 本番サイトの Service Worker 検証。
// 前提: Chrome を --remote-debugging-port=9333 で起動しておく(他のチェックと同じ方式)
// 確認内容:
//  1) SW が登録・有効化され、静的アセットがキャッシュされること
//  2) 完全オフラインでも再読み込みでページが表示されること(白画面にならない)
import puppeteer from "puppeteer-core";

const URL = process.argv[2] || "https://himpeki.github.io/kids-bank/";
const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9333",
  defaultViewport: { width: 430, height: 900 },
});
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  if (!cond) failures++;
};

try {
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 45000 });

  // 1) SW の有効化とキャッシュ内容
  const swState = await page.evaluate(async () => {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error("SW ready timeout")), 20000)),
    ]);
    // プリキャッシュ完了を少し待ってから数える
    await new Promise((r) => setTimeout(r, 3000));
    const keys = await caches.keys();
    const cache = await caches.open(keys[0] ?? "none");
    const entries = (await cache.keys()).map((r) => r.url);
    return { active: !!reg.active, cacheName: keys[0], count: entries.length };
  });
  check(`SW登録・有効化(cache=${swState.cacheName}, ${swState.count}件保存)`, swState.active && swState.count >= 20);

  // 2) SW にページ制御をさせてから完全オフラインで再読み込み
  await page.reload({ waitUntil: "networkidle2" });
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check("再読み込み後にSWがページを制御", controlled);

  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  const offlineView = await page.evaluate(() => ({
    title: document.title,
    // base.css が効いていれば font-family にアプリ指定のフォント名が入る
    styled: getComputedStyle(document.body).fontFamily.includes("Zen Maru Gothic"),
    hasContent: document.body.innerText.trim().length > 0,
  }));
  check(
    `オフラインでもページ表示(title=${offlineView.title}, CSS適用=${offlineView.styled})`,
    offlineView.title === "おこづかいバンク" && offlineView.styled && offlineView.hasContent,
  );
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
} catch (e) {
  failures++;
  console.log(`❌ 失敗: ${e.message}`);
} finally {
  await ctx.close();
  await browser.disconnect();
}
console.log(failures ? `NG: ${failures}件` : "🎉 SW検証すべて成功");
process.exit(failures ? 1 : 0);
