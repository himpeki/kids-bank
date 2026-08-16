// 本番環境での「登録済み端末」フローの診断。
// 本番Firebaseにテスト用の家族を1つ作り(ユーザー家族とは完全分離)、
// 親画面・子画面の全タブを実際に開いてコンソールエラーと表示崩れを確認する。
// 前提: Chrome を --remote-debugging-port=9333 で起動しておく
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "https://himpeki.github.io/kids-bank";
const SETUP_KEY = readFileSync(new URL("../rules/setup-key.local.txt", import.meta.url), "utf8").trim();
const SHOT_DIR = fileURLToPath(new URL("./e2e-shots/", import.meta.url));

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9333",
  defaultViewport: { width: 430, height: 900 },
});

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
function wire(page, label) {
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon/.test(m.text())) {
      errors.push(`[${label}] console: ${m.text().slice(0, 200)}`);
    }
  });
}

const pctx = await browser.createBrowserContext();
const cctx = await browser.createBrowserContext();
try {
  // 1) テスト家族を作成
  const pp = await pctx.newPage();
  wire(pp, "parent");
  await pp.goto(`${BASE}/setup.html`, { waitUntil: "networkidle2", timeout: 45000 });
  await pp.type("#setup-key", SETUP_KEY);
  await pp.type("#family-name", "動作確認用(データ無視でOK)");
  await pp.type("#self-name", "テスト親");
  const nameInputs = await pp.$$(".m-name");
  await nameInputs[0].type("テスト子A");
  await nameInputs[1].type("テスト子B");
  await nameInputs[2].type("テスト親2");
  await pp.click('#setup-form [type="submit"]');
  await pp.waitForSelector("#done:not(.hidden)", { timeout: 30000 });
  const invites = await pp.$$eval("#invite-list input", (els) => els.map((e) => e.value));
  check(`本番でテスト家族を作成(招待${invites.length}件)`, invites.length === 3);

  // 2) 親画面: 全タブを巡回
  await pp.goto(`${BASE}/parent.html`, { waitUntil: "networkidle2", timeout: 45000 });
  await pp.waitForFunction(() => document.querySelectorAll("#kid-cards .kid-card").length >= 2, { timeout: 20000 });
  check("親: ダッシュボード表示(子カード2枚)", true);
  for (const tab of ["approvals", "gift", "money", "manage", "settings"]) {
    await pp.evaluate((t) => { location.hash = "#" + t; }, tab);
    await sleep(800);
    const visible = await pp.evaluate(
      (t) => !document.getElementById("tab-" + t).classList.contains("hidden"),
      tab,
    );
    check(`親: ${tab} タブ表示`, visible);
  }
  await pp.screenshot({ path: `${SHOT_DIR}/prod-parent-settings.png` });

  // 3) クエスト切り替えの応答速度(ユーザー報告の操作)
  await pp.evaluate(() => { location.hash = "#manage"; });
  await pp.waitForFunction(() => document.querySelectorAll("#quest-admin-list .toggle-quest").length >= 1, { timeout: 20000 });
  const t0 = Date.now();
  await pp.$eval("#quest-admin-list .toggle-quest", (el) => el.click());
  await pp.waitForFunction(
    () => document.querySelector("#quest-admin-list").textContent.includes("停止中"),
    { timeout: 20000 },
  );
  const toggleMs = Date.now() - t0;
  check(`親: クエスト停止が画面反映されるまで ${toggleMs}ms`, toggleMs < 1500);

  // 4) 子画面: カードURLで登録して全タブ巡回
  const cp = await cctx.newPage();
  wire(cp, "child");
  await cp.goto(invites[0], { waitUntil: "networkidle2", timeout: 45000 });
  await cp.waitForSelector("#bal-yen", { timeout: 30000 });
  await cp.waitForFunction(() => document.getElementById("my-name").textContent === "テスト子A", { timeout: 20000 });
  check("子: カードURLから登録→ホーム表示", true);
  for (const tab of ["tickets", "quests", "send", "log", "home"]) {
    await cp.evaluate((t) => { location.hash = "#" + t; }, tab);
    await sleep(800);
    const visible = await cp.evaluate(
      (t) => !document.getElementById("tab-" + t).classList.contains("hidden"),
      tab,
    );
    check(`子: ${tab} タブ表示`, visible);
  }
  await cp.screenshot({ path: `${SHOT_DIR}/prod-child-home.png` });

  // 5) 再読み込み(SWキャッシュ経由)でも同様に表示されるか
  await cp.reload({ waitUntil: "networkidle2" });
  await cp.waitForFunction(() => document.getElementById("my-name").textContent === "テスト子A", { timeout: 20000 });
  check("子: 再読み込み後も表示(SW経由)", true);
} catch (e) {
  failures++;
  console.log(`❌ 失敗: ${e.message}`);
} finally {
  if (errors.length) console.log("コンソールエラー:\n" + errors.join("\n"));
  else console.log("コンソールエラーなし");
  await pctx.close().catch(() => {});
  await cctx.close().catch(() => {});
  await browser.disconnect();
}
console.log(failures ? `NG: ${failures}件` : "🎉 本番の登録済みフロー正常");
process.exit(failures ? 1 : 0);
