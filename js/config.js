// Firebase コンソール > プロジェクトの設定 > マイアプリ(ウェブアプリ) の値に置き換える。
// apiKey はサーバー秘密ではなく「どのプロジェクトか」の識別子なので、公開リポジトリに置いてよい。
// データの保護は Firestore セキュリティルール(rules/firestore.rules)が担う。
export const FIREBASE_CONFIG = {
  apiKey: "__REPLACE_ME__",
  authDomain: "__REPLACE_ME__.firebaseapp.com",
  projectId: "__REPLACE_ME__",
};

export const APP_NAME = "おこづかいバンク";

// 新規ファミリー作成時の初期設定(作成後は Firestore の settings/config が信頼できる唯一の値)
export const DEFAULT_SETTINGS = {
  weeklyRateBp: 100, // 利息: 週1% をベーシスポイントで(100bp = 1%)
  quizBonusPt: 5,    // 算数チャレンジ正解ボーナス(pt)
};
