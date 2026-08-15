// ヘッドレスChromeによるE2Eスモークテスト。
// 前提: `npm run emu`(エミュレータ)と `npm run serve`(:5500)が起動済みであること。
// 実行: node test/e2e.mjs
// 内容: セットアップ → 誕生日セット発行 → 子端末登録(QR相当URL) → 券使用→親承認 →
//       サプライズギフト開封 → 兄弟送金 → クエスト報告→承認 → 算数チャレンジ
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5500";
const SHOT_DIR = fileURLToPath(new URL("./e2e-shots/", import.meta.url));
mkdirSync(SHOT_DIR, { recursive: true });

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// まず起動済みChrome(--remote-debugging-port=9333)への接続を試し、無ければ自前で起動する。
// (環境によってはNode子プロセスとしてのChrome起動が失敗するため、接続方式を優先)
let browser;
let connected = false;
try {
  browser = await puppeteer.connect({
    browserURL: "http://127.0.0.1:9333",
    defaultViewport: { width: 430, height: 900 },
  });
  connected = true;
  console.log("既存のChrome(port 9333)に接続しました");
} catch {
  browser = await puppeteer.launch({
    executablePath: process.env.E2E_BROWSER || CHROME,
    headless: true,
    args: ["--window-size=430,900", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    defaultViewport: { width: 430, height: 900 },
  });
}

function wire(page, label) {
  page.on("pageerror", (e) => console.log(`   [${label}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/net::|favicon/.test(m.text())) {
      console.log(`   [${label}] console.error: ${m.text().slice(0, 200)}`);
    }
  });
}

try {
  // ============ 1. 親: セットアップ ============
  const pctx = await browser.createBrowserContext();
  const pp = await pctx.newPage();
  wire(pp, "parent");
  await pp.goto(`${BASE}/setup.html`, { waitUntil: "networkidle2" });
  await pp.type("#setup-key", "test-setup-key");
  await pp.type("#family-name", "たなかけ");
  await pp.type("#self-name", "パパ");
  const nameInputs = await pp.$$(".m-name");
  await nameInputs[0].type("たろう");
  await nameInputs[1].type("じろう");
  await nameInputs[2].type("ママ");
  await pp.click('#setup-form [type="submit"]');
  await pp.waitForSelector("#done:not(.hidden)", { timeout: 20000 });
  const invites = await pp.$$eval("#invite-list input", (els) => els.map((e) => e.value));
  check("セットアップ完了・招待リンク3件生成", invites.length === 3);

  // ============ 2. 親: たんじょうびセット発行 ============
  await pp.goto(`${BASE}/parent.html#manage`, { waitUntil: "networkidle2" });
  await pp.waitForSelector("#birthday-set", { timeout: 15000 });
  await sleep(500);
  await pp.click("#birthday-set");
  await pp.waitForSelector('.modal [data-act="ok"]');
  await pp.click('.modal [data-act="ok"]');
  await pp.waitForFunction(
    () => document.querySelectorAll("#ticket-admin-list .list-item").length >= 6,
    { timeout: 15000 },
  );
  check("たんじょうびセット6枚を発行", true);

  // ============ 2.5 親: クエスト単価の編集(みずやり 5pt → 7pt) ============
  await pp.waitForFunction(
    () => document.querySelectorAll("#quest-admin-list .list-item").length >= 6,
    { timeout: 15000 },
  );
  await pp.$$eval("#quest-admin-list .edit-quest", (els) => els[els.length - 1].click()); // 最後=みずやり
  await pp.waitForSelector("#quest-admin-list .eq-points");
  await pp.$eval("#quest-admin-list .eq-points", (el) => { el.value = ""; });
  await pp.type("#quest-admin-list .eq-points", "7");
  await pp.$eval("#quest-admin-list .save-quest", (el) => el.click());
  await pp.waitForFunction(
    () => document.querySelector("#quest-admin-list").textContent.includes("7pt"),
    { timeout: 15000 },
  );
  check("クエスト編集(みずやり 5pt → 7pt)", true);

  // ============ 3. 子: カードURLで端末登録 ============
  const cctx = await browser.createBrowserContext();
  const cp = await cctx.newPage();
  wire(cp, "child");
  await cp.goto(invites[0], { waitUntil: "networkidle2" }); // たろうのカードURL
  await cp.waitForSelector("#register-btn", { visible: true, timeout: 20000 });
  await cp.click("#register-btn");
  await cp.waitForSelector("#done:not(.hidden)", { timeout: 20000 });
  await Promise.all([cp.waitForNavigation({ waitUntil: "networkidle2" }), cp.click("#go-btn")]);
  await cp.waitForSelector("#bal-yen", { timeout: 20000 });
  await cp.waitForFunction(
    () => document.getElementById("my-name").textContent === "たろう",
    { timeout: 15000 },
  );
  check("子端末の登録と子ホーム表示(たろう)", true);

  // 券6枚が見えるか
  await cp.waitForFunction(
    () => document.querySelectorAll("#ticket-list .ticket-card").length >= 6,
    { timeout: 15000 },
  );
  check("子の画面に券6枚が届いている", true);
  await cp.screenshot({ path: `${SHOT_DIR}/child-home.png` });

  // ============ 4. 子: 券を使う → 親: 承認 ============
  await cp.evaluate(() => { location.hash = "#tickets"; });
  await sleep(300);
  await cp.click("#ticket-list .use-btn");
  await cp.waitForSelector('.modal [data-act="ok"]');
  await cp.click('.modal [data-act="ok"]');
  await cp.waitForSelector("#ticket-list .ticket-card.pending", { timeout: 15000 });
  check("券の使用申請(pending化)", true);

  await pp.evaluate(() => { location.hash = "#approvals"; });
  await pp.waitForSelector(".approval-item .approve-btn", { timeout: 15000 });
  await pp.$eval(".approval-item .approve-btn", (el) => el.click()); // 再描画レースを避けDOM内クリック
  await cp.waitForSelector("#ticket-list .ticket-card.used", { timeout: 15000 });
  check("親の承認 → 子の券が「つかったよ」に", true);

  // ============ 5. 親: サプライズギフト(500円) → 子: 開封 ============
  await pp.evaluate(() => { location.hash = "#gift"; });
  await sleep(300);
  await pp.click('#gift-kind [data-kind="yen"]');
  await pp.type("#gift-amount", "500");
  await pp.type("#gift-message", "おたんじょうびおめでとう!");
  await pp.click("#gift-send");
  await cp.waitForSelector(".gift-overlay #gift-box", { timeout: 15000 });
  await cp.screenshot({ path: `${SHOT_DIR}/gift-box.png` });
  await cp.click("#gift-box");
  await cp.waitForSelector(".gift-overlay #gift-ok", { visible: true, timeout: 10000 });
  await cp.screenshot({ path: `${SHOT_DIR}/gift-open.png` });
  await cp.click("#gift-ok");
  await cp.waitForFunction(
    () => document.getElementById("bal-yen").textContent === "500",
    { timeout: 15000 },
  );
  check("ギフト開封演出 → 残高500円", true);

  // ============ 6. 子: 兄弟送金(じろうへ100円) ============
  await cp.evaluate(() => { location.hash = "#send"; });
  await sleep(300);
  await cp.type("#send-amount", "100");
  await cp.type("#send-message", "はんぶんこ!");
  await cp.click("#send-btn");
  await cp.waitForSelector('.modal [data-act="ok"]');
  await cp.click('.modal [data-act="ok"]');
  await cp.waitForFunction(
    () => document.getElementById("bal-yen").textContent === "400",
    { timeout: 15000 },
  );
  check("兄弟間送金(100円)→ 残高400円", true);

  // ============ 7. 子: クエスト報告 → 親: 承認(+10pt) ============
  await cp.evaluate(() => { location.hash = "#quests"; });
  await cp.waitForSelector("#quest-list .report-btn", { timeout: 15000 });
  await sleep(500);
  await cp.$eval("#quest-list .report-btn", (el) => el.click()); // しょっきあらい 10pt
  await pp.waitForSelector(".approval-item .approve-btn", { timeout: 15000 });
  await sleep(300);
  await pp.$eval(".approval-item .approve-btn", (el) => el.click());
  await cp.waitForFunction(
    () => document.getElementById("bal-pt").textContent === "10",
    { timeout: 15000 },
  );
  check("クエスト報告 → 親承認 → +10pt", true);

  // ============ 8. 子: 算数チャレンジ ============
  await cp.evaluate(() => { location.hash = "#home"; });
  const q = await cp.$eval("#quiz-q", (el) => el.textContent);
  const m = q.match(/(\d+)\s*([+−×÷])\s*(\d+)/);
  let ans = null;
  if (m) {
    const [_, a, op, b] = m;
    const A = parseInt(a, 10), B = parseInt(b, 10);
    ans = op === "+" ? A + B : op === "−" ? A - B : op === "×" ? A * B : Math.floor(A / B);
  }
  check(`算数チャレンジの問題生成(${q.trim()})`, ans !== null);
  await cp.type("#quiz-answer", String(ans));
  await cp.click("#quiz-btn");
  await cp.waitForFunction(
    () => document.getElementById("bal-pt").textContent === "15",
    { timeout: 15000 },
  );
  check("算数チャレンジ正解 → +5pt(合計15pt)", true);
  await cp.screenshot({ path: `${SHOT_DIR}/child-final.png` });

  // ============ 8.5 子: きろくタブ(おこづかい帳+グラフ) ============
  await cp.evaluate(() => { location.hash = "#log"; });
  // ここまでの たろうの取引 = ギフト500円 + 送金100円 + クエスト10pt + クイズ5pt の4件
  await cp.waitForFunction(
    () => document.querySelectorAll("#txn-list .txn-item").length >= 4,
    { timeout: 15000 },
  );
  const chartDrawn = await cp.evaluate(() => {
    const c = document.getElementById("balance-chart");
    return c && c.width > 0 && c.height > 0;
  });
  check("おこづかい帳に取引履歴・残高グラフ描画", chartDrawn);

  // グラフの通貨切替(おこづかい ⇔ ポイント)
  await cp.$eval('#chart-currency [data-cur="pt"]', (el) => el.click());
  await sleep(400);
  const ptSelected = await cp.$eval('#chart-currency [data-cur="pt"]', (el) =>
    el.classList.contains("selected"));
  check("グラフをポイント表示に切替", ptSelected);
  await cp.screenshot({ path: `${SHOT_DIR}/child-log.png` });

  // 取引が50件未満なら「もっとみる」は出ない
  const moreHidden = await cp.$eval("#txn-more", (el) => el.classList.contains("hidden"));
  check("取引50件未満では「もっとみる」非表示", moreHidden);

  // ============ 9. 親: ダッシュボード最終確認 ============
  await pp.evaluate(() => { location.hash = "#home"; });
  await pp.waitForFunction(
    () => document.querySelector("#kid-cards")?.textContent.includes("400円"),
    { timeout: 15000 },
  );
  await pp.screenshot({ path: `${SHOT_DIR}/parent-dashboard.png` });
  check("親ダッシュボードに残高反映(たろう400円)", true);

  // ============ 10. 親: QRカード印刷ページ ============
  await pp.goto(`${BASE}/print.html`, { waitUntil: "networkidle2" });
  await pp.waitForSelector(".member-card canvas", { timeout: 15000 });
  const cardCount = await pp.$$eval(".member-card", (els) => els.length);
  check(`QRカード印刷ページにカード${cardCount}枚(子ども2人分)`, cardCount === 2);
  await pp.screenshot({ path: `${SHOT_DIR}/print-cards.png`, fullPage: true });
} catch (e) {
  failures++;
  console.error("❌ E2E失敗:", e.message);
} finally {
  if (connected) {
    // 常駐Chromeに接続した場合は自分のコンテキストだけ閉じて切断(Chrome本体は残す)
    for (const ctx of browser.browserContexts()) {
      if (ctx !== browser.defaultBrowserContext()) await ctx.close().catch(() => {});
    }
    await browser.disconnect();
  } else {
    await browser.close();
  }
}

console.log(failures ? `\nNG: ${failures}件の失敗` : "\n🎉 E2E全シナリオ成功");
process.exit(failures ? 1 : 0);
