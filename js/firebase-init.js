// Firebase 初期化。全ページがここから auth / db を import する。
// ?emu=1 を付けて開くとエミュレータ接続を記憶する(?emu=0 で解除)。localhost は常にエミュレータ。
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  connectAuthEmulator,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { FIREBASE_CONFIG } from "./config.js";

const params = new URLSearchParams(location.search);
if (params.has("emu")) {
  if (params.get("emu") === "0") localStorage.removeItem("emu");
  else localStorage.setItem("emu", "1");
}

export const useEmulator =
  localStorage.getItem("emu") === "1" ||
  ["localhost", "127.0.0.1"].includes(location.hostname);

// エミュレータは demo- プレフィックスのプロジェクトIDなら実プロジェクト不要で動く
const config = useEmulator
  ? { apiKey: "demo-key", authDomain: "demo.local", projectId: "demo-okozukai-bank" }
  : FIREBASE_CONFIG;

export const app = initializeApp(config);
export const auth = getAuth(app);
// 永続ローカルキャッシュ(IndexedDB): 2回目以降の読み取りは端末内から即返り、
// 書き込みは即ローカル反映+裏で同期(オフラインでもキューに積まれて消えない)。
// IndexedDB が使えない環境では SDK が自動でメモリキャッシュに切り替える。
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (useEmulator) {
  // スマホ実機から LAN 経由で試すときは、エミュレータを --host 0.0.0.0 で起動し
  // http://<PCのIP>:5500/?emu=1 のようにアクセスする(ホスト名をそのまま使う)
  const host = location.hostname || "localhost";
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
}

/** 匿名認証でサインイン済みの User を返す(未サインインなら新規作成) */
// 注意: onAuthStateChanged の「未サインイン」通知は本番の通信遅延下で複数回来ることが
// あり、そのたびに signInAnonymously すると匿名ユーザーが複数作られて
// 「登録したユーザー」と「端末に保存されたユーザー」がズレる(→ 権限エラー・未登録扱い)。
// サインイン処理は必ず1本に共有する。
let signingIn = null;
export function ensureSignedIn() {
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          stop();
          resolve(user);
        } else {
          signingIn ??= signInAnonymously(auth).finally(() => {
            signingIn = null;
          });
          signingIn.catch((e) => {
            stop();
            reject(e);
          });
        }
      },
      (e) => reject(e),
    );
  });
}
