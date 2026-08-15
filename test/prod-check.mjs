// 本番サイトのスモークチェック。
// 前提: Chromeを --remote-debugging-port=9333 で起動しておく(README/E2Eと同じ方式)
// 確認内容: ページが開き、実Firebaseへの匿名認証が通り、未登録端末向けの
// ランディング画面が表示されること(コンソールエラーなし)。
import puppeteer from "puppeteer-core";

const URL = process.argv[2] || "https://himpeki.github.io/kids-bank/";
const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9333",
  defaultViewport: { width: 430, height: 900 },
});
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(`console: ${m.text().slice(0, 150)}`);
});

try {
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector("#landing:not(.hidden)", { timeout: 30000 });
  console.log("✅ ランディング表示OK(匿名認証+Firestore照会が本番Firebaseで成功)");
} catch (e) {
  console.log(`❌ 失敗: ${e.message}`);
  const body = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "");
  console.log("画面テキスト:", body);
} finally {
  if (errors.length) console.log("エラーログ:\n" + errors.join("\n"));
  else console.log("コンソールエラーなし");
  await ctx.close();
  await browser.disconnect();
}
