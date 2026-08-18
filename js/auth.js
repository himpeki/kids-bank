// 匿名認証・端末登録・家族セットアップのフロー。
import { ensureSignedIn } from "./firebase-init.js";
import {
  db,
  doc,
  getDoc,
  writeBatch,
  serverTimestamp,
  arrayUnion,
  Timestamp,
  setFamilyId,
  uidRef,
  newId,
  shortId,
} from "./db.js";
import { DEFAULT_SETTINGS } from "./config.js";
import { QUEST_PRESETS, REWARD_PRESETS } from "./presets.js";

// 身元キャッシュのキー。index.html の高速パス(インラインスクリプト)も同じキーを
// 直書きで参照しているので、変えるときは両方直すこと
const LS_IDENTITY = "okozukai.identity";

/**
 * この端末の身元 {uid, familyId, memberId, role} を返す。未登録なら null。
 * 真実は Firestore の uids/{uid}(localStorage は表示高速化のキャッシュのみ)。
 */
export async function resolveIdentity() {
  const user = await ensureSignedIn();
  let snap;
  try {
    snap = await getDoc(uidRef(user.uid));
  } catch (e) {
    // 一時的な読み取り失敗(電波不良など)。同じユーザーの身元キャッシュがあれば
    // それで続行する(Firestoreの永続キャッシュがデータ表示を支える)
    const cached = cachedIdentityFor(user.uid);
    if (cached) {
      setFamilyId(cached.familyId);
      return cached;
    }
    throw e;
  }
  if (!snap.exists()) {
    localStorage.removeItem(LS_IDENTITY);
    return null;
  }
  const ident = { uid: user.uid, ...snap.data() };
  localStorage.setItem(LS_IDENTITY, JSON.stringify(ident));
  setFamilyId(ident.familyId);
  return ident;
}

/** uid が一致する場合のみ身元キャッシュを返す(別ユーザーへの化けを防ぐ) */
function cachedIdentityFor(uid) {
  try {
    const c = JSON.parse(localStorage.getItem(LS_IDENTITY));
    return c && c.uid === uid ? c : null;
  } catch {
    return null;
  }
}

/** ページの入場ガード。ロールが合わなければ適切なページへ送り返す */
export async function requireRole(...roles) {
  let ident;
  try {
    ident = await resolveIdentity();
  } catch (e) {
    // 白画面のまま死なせず、再試行ボタンを出す
    document.body.innerHTML = `
      <div class="container"><div class="card" style="margin-top:60px;text-align:center">
        <div style="font-size:48px">📡</div>
        <h3>うまく つながらないよ</h3>
        <p class="muted">でんぱの いいばしょで もういちど ためしてみてね。</p>
        <button class="btn btn-primary btn-big" onclick="location.reload()">もういちど</button>
      </div></div>`;
    throw e;
  }
  if (!ident) {
    location.replace("./index.html");
    throw new Error("unregistered");
  }
  if (!roles.includes(ident.role)) {
    location.replace(ident.role === "child" ? "./child.html" : "./parent.html");
    throw new Error("wrong role");
  }
  return ident;
}

/** 招待トークンでこの端末を登録する。QRカード読み取り・親の追加端末どちらもこれ */
export async function registerWithInvite(famId, token) {
  const user = await ensureSignedIn();
  const invSnap = await getDoc(doc(db, "families", famId, "invites", token));
  if (!invSnap.exists()) throw new Error("しょうたいけんが見つかりません。カードをもういちど読みこんでね。");
  const inv = invSnap.data();
  if (inv.revoked) throw new Error("このしょうたいけんは使えなくなっています。おうちの人にそうだんしてね。");
  if (inv.expiresAt && inv.expiresAt.toDate() < new Date()) {
    throw new Error("しょうたいけんの きげんが切れています。おうちの人にそうだんしてね。");
  }

  // 別メンバーとして登録済みの端末は、先に自分の登録を外す(切り替え)。
  // ルール上 devices/uids は上書き不可のため delete → create の2段階で行う。
  // 招待の有効性は上で確認済みなので、外したあとの再登録が失敗する余地は小さい
  // (万一失敗しても、カードの再スキャンでいつでも登録し直せる)
  const uidSnap = await getDoc(uidRef(user.uid));
  if (uidSnap.exists()) {
    const old = uidSnap.data();
    const del = writeBatch(db);
    del.delete(doc(db, "families", old.familyId, "devices", user.uid));
    del.delete(uidRef(user.uid));
    await del.commit();
  }

  const batch = writeBatch(db);
  batch.set(doc(db, "families", famId, "devices", user.uid), {
    memberId: inv.memberId,
    role: inv.role,
    inviteToken: token,
    label: navigator.userAgent.slice(0, 100),
    registeredAt: serverTimestamp(),
  });
  batch.set(uidRef(user.uid), {
    familyId: famId,
    memberId: inv.memberId,
    role: inv.role,
  });
  if (!inv.reusable) {
    // 一回限りトークンは登録と同時に消費(ルールが同一バッチでの消費を強制する)
    batch.update(doc(db, "families", famId, "invites", token), {
      revoked: true,
      usedBy: arrayUnion(user.uid),
    });
  }
  await batch.commit();
  return resolveIdentity();
}

/** 直近の日曜 0:00 (JST) を返す。利息付与の起点 */
export function lastSundayJST(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const start = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - jst.getUTCDay());
  return new Date(start - 9 * 3600 * 1000);
}

/**
 * 家族の新規作成。2コミット構成:
 *  1) family ルート + 自分の devices/uids(ルールの bootstrapping 検証)
 *  2) 以降は親権限で settings・members・wallets・quests・invites を作成
 * 戻り値: { familyId, invites: [{memberId, name, role, token, reusable}] }
 */
export async function createFamily({ setupKey, familyName, selfName, members }) {
  const user = await ensureSignedIn();
  const famId = newId(20);
  const selfId = "m" + shortId();

  const batch1 = writeBatch(db);
  batch1.set(doc(db, "families", famId), {
    name: familyName,
    setupKey,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  });
  batch1.set(doc(db, "families", famId, "devices", user.uid), {
    memberId: selfId,
    role: "parent",
    inviteToken: null,
    label: navigator.userAgent.slice(0, 100),
    registeredAt: serverTimestamp(),
  });
  batch1.set(uidRef(user.uid), { familyId: famId, memberId: selfId, role: "parent" });
  await batch1.commit();

  const batch2 = writeBatch(db);
  batch2.set(doc(db, "families", famId, "settings", "config"), { ...DEFAULT_SETTINGS });
  batch2.set(doc(db, "families", famId, "members", selfId), {
    name: selfName,
    role: "parent",
    level: 1,
    unlocks: { quest: true, goal: false, interest: false, invest: false },
    sort: 0,
  });

  const invites = [];
  members.forEach((m, i) => {
    const mid = "m" + shortId();
    batch2.set(doc(db, "families", famId, "members", mid), {
      name: m.name,
      role: m.role,
      level: 1,
      unlocks: { quest: true, goal: false, interest: false, invest: false },
      sort: i + 1,
    });
    if (m.role === "child") {
      batch2.set(doc(db, "families", famId, "wallets", mid), {
        yen: 0,
        pt: 0,
        lastTxnId: "",
        lastInterestAt: Timestamp.fromDate(lastSundayJST()),
        lastQuizAt: Timestamp.fromDate(new Date(0)),
      });
    }
    // 子はカード用の永続トークン、親/祖父母は7日期限の一回限りトークン
    const token = newId(24);
    const reusable = m.role === "child";
    batch2.set(doc(db, "families", famId, "invites", token), {
      role: m.role,
      memberId: mid,
      reusable,
      revoked: false,
      expiresAt: reusable ? null : Timestamp.fromDate(new Date(Date.now() + 7 * 86400 * 1000)),
      usedBy: [],
      createdAt: serverTimestamp(),
    });
    invites.push({ memberId: mid, name: m.name, role: m.role, token, reusable });
  });

  QUEST_PRESETS.forEach((q, i) => {
    batch2.set(doc(db, "families", famId, "quests", "q" + shortId()), {
      ...q,
      active: true,
      sort: i,
    });
  });
  REWARD_PRESETS.forEach((r, i) => {
    batch2.set(doc(db, "families", famId, "rewards", "r" + shortId()), {
      ...r,
      active: true,
      sort: i,
    });
  });

  await batch2.commit();
  setFamilyId(famId);
  // 作成直後の遷移で uids 照会が一時失敗しても続行できるよう身元キャッシュも保存
  localStorage.setItem(
    LS_IDENTITY,
    JSON.stringify({ uid: user.uid, familyId: famId, memberId: selfId, role: "parent" }),
  );
  return { familyId: famId, selfId, invites };
}
