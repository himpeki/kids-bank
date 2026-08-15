// テスト・エミュレータ用に __SETUP_KEY__ をテスト値へ置換した rules を生成する。
// 本番デプロイは tools/deploy-rules.ps1(本物のあいことばで置換)を使うこと。
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(new URL("../rules/firestore.rules", import.meta.url), "utf8");
writeFileSync(
  new URL("../rules/firestore.deploy.rules", import.meta.url),
  src.replaceAll("__SETUP_KEY__", "test-setup-key"),
);
console.log("rules/firestore.deploy.rules (テストキー版) を生成しました");
