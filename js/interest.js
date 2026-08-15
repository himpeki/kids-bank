// 利息の遅延実行。サーバー処理(Cloud Functions)が無いため、
// 子ホームを開いたときに「前回付与から経過した週の数だけ」1週間分ずつ付与する。
// 二重付与はセキュリティルール(lastInterestAt が正確に7日きざみでしか進まない)が防ぐ。
import {
  db,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  famCol,
  walletRef,
  settingsRef,
  shortId,
  Timestamp,
  updateDoc,
} from "./db.js";
import { auth } from "./firebase-init.js";

const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * 未付与の利息をすべて適用する。付与された合計ptを返す(0なら演出なし)。
 * unlocked でない場合は何もしない。
 */
export async function applyPendingInterest({ memberId, unlocked }) {
  if (!unlocked) return 0;
  const settingsSnap = await getDoc(settingsRef());
  const rateBp = settingsSnap.data()?.weeklyRateBp ?? 0;
  let total = 0;

  // 起点が古すぎても暴走しないよう上限を設ける(1年分)
  for (let i = 0; i < 53; i++) {
    const wSnap = await getDoc(walletRef(memberId));
    const w = wSnap.data();
    const nextAt = w.lastInterestAt.toMillis() + WEEK_MS;
    if (nextAt > Date.now()) break;

    const amount = Math.floor((w.pt * rateBp) / 10000);
    const nextTs = Timestamp.fromMillis(nextAt);
    if (amount <= 0) {
      // 0pt の週は日付だけ進める(ルールの interestSkip)
      await updateDoc(walletRef(memberId), { lastInterestAt: nextTs });
      continue;
    }
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(walletRef(memberId));
      const cur = snap.data();
      if (cur.lastInterestAt.toMillis() + WEEK_MS > Date.now()) return; // 他端末が先に付与済み
      const amt = Math.floor((cur.pt * rateBp) / 10000);
      if (amt <= 0) {
        // リトライ中に残高が変わって0ptになったら日付だけ進める
        tx.update(walletRef(memberId), {
          lastInterestAt: Timestamp.fromMillis(cur.lastInterestAt.toMillis() + WEEK_MS),
        });
        return;
      }
      const newPt = cur.pt + amt;
      const txnRef = doc(famCol("transactions"), "t" + shortId());
      tx.update(walletRef(memberId), {
        pt: newPt,
        lastTxnId: txnRef.id,
        lastInterestAt: Timestamp.fromMillis(cur.lastInterestAt.toMillis() + WEEK_MS),
      });
      tx.set(txnRef, {
        type: "interest",
        currency: "pt",
        amount: amt,
        fromMemberId: null,
        toMemberId: memberId,
        memberIds: [memberId],
        balanceAfter: { from: null, to: newPt },
        byUid: auth.currentUser.uid,
        message: "りそくの日! あずけていると ふえるよ",
        refId: null,
        createdAt: serverTimestamp(),
      });
    });
    total += amount;
  }
  return total;
}
