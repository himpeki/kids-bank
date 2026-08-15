// お金が動く操作はすべてここ。wallet 更新と transactions 作成を必ず同一コミットにする
// (セキュリティルールの lastTxnId ペアリングが前提)。
import { auth } from "./firebase-init.js";
import {
  db,
  doc,
  writeBatch,
  runTransaction,
  serverTimestamp,
  famCol,
  famDoc,
  walletRef,
  shortId,
} from "./db.js";

function assertAmount(amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("金額は1いじょうの整数にしてね");
}

function baseTxn(fields) {
  return {
    byUid: auth.currentUser.uid,
    message: "",
    refId: null,
    createdAt: serverTimestamp(),
    ...fields,
  };
}

/** 兄弟間送金(子が実行)。ありがとうメッセージ付き */
export async function transfer({ fromMemberId, toMemberId, currency, amount, message = "" }) {
  assertAmount(amount);
  const fromRef = walletRef(fromMemberId);
  const toRef = walletRef(toMemberId);
  await runTransaction(db, async (tx) => {
    const [fromSnap, toSnap] = await Promise.all([tx.get(fromRef), tx.get(toRef)]);
    const from = fromSnap.data();
    const to = toSnap.data();
    if (from[currency] < amount) throw new Error("ざんだかが たりないよ");
    const txnRef = doc(famCol("transactions"), "t" + shortId());
    const newFrom = from[currency] - amount;
    const newTo = to[currency] + amount;
    tx.update(fromRef, { [currency]: newFrom, lastTxnId: txnRef.id });
    tx.update(toRef, { [currency]: newTo, lastTxnId: txnRef.id });
    tx.set(txnRef, baseTxn({
      type: "transfer",
      currency,
      amount,
      fromMemberId,
      toMemberId,
      memberIds: [fromMemberId, toMemberId],
      balanceAfter: { from: newFrom, to: newTo },
      message,
    }));
  });
}

/**
 * 親/祖父母による残高操作。
 * type: 'grant'(入金) | 'gift'(サプライズ) | 'withdraw'(引き出し) | 'adjust'(調整)
 * direction: 'in'(増やす) | 'out'(減らす)
 * 戻り値: 作成した取引ID
 */
export async function adultMoneyOp({ type, memberId, currency, amount, direction = "in", message = "", extraWrites }) {
  assertAmount(amount);
  const wRef = walletRef(memberId);
  let txnId = null;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(wRef);
    const w = snap.data();
    const delta = direction === "in" ? amount : -amount;
    const newBal = w[currency] + delta;
    if (newBal < 0) throw new Error("残高が不足しています");
    const txnRef = doc(famCol("transactions"), "t" + shortId());
    txnId = txnRef.id;
    tx.update(wRef, { [currency]: newBal, lastTxnId: txnRef.id });
    tx.set(txnRef, baseTxn({
      type,
      currency,
      amount,
      fromMemberId: direction === "in" ? null : memberId,
      toMemberId: direction === "in" ? memberId : null,
      memberIds: [memberId],
      balanceAfter: direction === "in" ? { from: null, to: newBal } : { from: newBal, to: null },
      message,
    }));
    if (extraWrites) extraWrites(tx, txnRef.id);
  });
  return txnId;
}

/** サプライズギフト(お金): wallet + gift取引 + gifts ドキュメントを1コミットで */
export async function sendMoneyGift({ fromMemberId, toMemberId, currency, amount, message }) {
  await adultMoneyOp({
    type: "gift",
    memberId: toMemberId,
    currency,
    amount,
    direction: "in",
    message,
    extraWrites: (tx, txnId) => {
      tx.set(doc(famCol("gifts"), "g" + shortId()), {
        toMemberId,
        fromMemberId,
        kind: currency,
        amount,
        refId: txnId,
        message: message || "",
        seenAt: null,
        createdAt: serverTimestamp(),
      });
    },
  });
}

/** サプライズギフト(券): 券の発行 + gifts ドキュメントを1バッチで */
export async function sendTicketGift({ fromMemberId, toMemberId, ticket, message }) {
  const batch = writeBatch(db);
  const tRef = doc(famCol("tickets"), "tk" + shortId());
  batch.set(tRef, {
    memberId: toMemberId,
    emoji: ticket.emoji,
    title: ticket.title,
    desc: ticket.desc || "",
    status: "unused",
    approvalId: null,
    createdByUid: auth.currentUser.uid,
    createdAt: serverTimestamp(),
    usedAt: null,
  });
  batch.set(doc(famCol("gifts"), "g" + shortId()), {
    toMemberId,
    fromMemberId,
    kind: "ticket",
    amount: null,
    refId: tRef.id,
    message: message || "",
    seenAt: null,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

/** 券の発行(演出なし・親の管理画面用) */
export async function issueTicket({ memberId, emoji, title, desc }) {
  const tRef = doc(famCol("tickets"), "tk" + shortId());
  const batch = writeBatch(db);
  batch.set(tRef, {
    memberId,
    emoji,
    title,
    desc: desc || "",
    status: "unused",
    approvalId: null,
    createdByUid: auth.currentUser.uid,
    createdAt: serverTimestamp(),
    usedAt: null,
  });
  await batch.commit();
  return tRef.id;
}

/** 子: 券を「つかう」→ 承認待ちにする */
export async function requestTicketUse({ ticketId, memberId }) {
  const aRef = doc(famCol("approvals"), "a" + shortId());
  const batch = writeBatch(db);
  batch.update(famDoc("tickets", ticketId), { status: "pending", approvalId: aRef.id });
  batch.set(aRef, {
    kind: "ticket",
    refId: ticketId,
    memberId,
    status: "pending",
    requestedAt: serverTimestamp(),
  });
  await batch.commit();
}

/** 子: 券の使用申請を取り下げる */
export async function cancelTicketRequest({ ticketId, approvalId }) {
  const batch = writeBatch(db);
  batch.update(famDoc("tickets", ticketId), { status: "unused" });
  batch.update(famDoc("approvals", approvalId), { status: "canceled" });
  await batch.commit();
}

/** 子: 「おてつだい やった!」報告 */
export async function reportQuest({ questId, memberId }) {
  const aRef = doc(famCol("approvals"), "a" + shortId());
  const batch = writeBatch(db);
  batch.set(aRef, {
    kind: "quest",
    refId: questId,
    memberId,
    status: "pending",
    requestedAt: serverTimestamp(),
  });
  await batch.commit();
  return aRef.id;
}

/** 子: クエスト報告の取り下げ */
export async function cancelQuestRequest({ approvalId }) {
  const batch = writeBatch(db);
  batch.update(famDoc("approvals", approvalId), { status: "canceled" });
  await batch.commit();
}

function decisionFields(status, note = "") {
  return {
    status,
    decidedAt: serverTimestamp(),
    decidedByUid: auth.currentUser.uid,
    note,
  };
}

/** 親: 券の使用を承認 */
export async function approveTicket({ approvalId, ticketId }) {
  const batch = writeBatch(db);
  batch.update(famDoc("approvals", approvalId), decisionFields("approved"));
  batch.update(famDoc("tickets", ticketId), { status: "used", usedAt: serverTimestamp() });
  await batch.commit();
}

/** 親: 券の使用を却下(券は未使用に戻す) */
export async function rejectTicket({ approvalId, ticketId, note }) {
  const batch = writeBatch(db);
  batch.update(famDoc("approvals", approvalId), decisionFields("rejected", note));
  batch.update(famDoc("tickets", ticketId), { status: "unused", approvalId: null });
  await batch.commit();
}

/** 親: クエストを承認してポイント付与(承認更新と付与を1コミットで) */
export async function approveQuest({ approvalId, memberId, points, questTitle }) {
  await adultMoneyOp({
    type: "quest",
    memberId,
    currency: "pt",
    amount: points,
    direction: "in",
    message: questTitle || "",
    extraWrites: (tx) => {
      tx.update(famDoc("approvals", approvalId), decisionFields("approved"));
    },
  });
}

/** 親: クエスト報告を却下 */
export async function rejectQuest({ approvalId, note }) {
  const batch = writeBatch(db);
  batch.update(famDoc("approvals", approvalId), decisionFields("rejected", note));
  await batch.commit();
}

/** 子: ひきだし申請(おこづかい残高を現金にかえてもらうお願い) */
export async function requestWithdraw({ memberId, amount }) {
  assertAmount(amount);
  const aRef = doc(famCol("approvals"), "a" + shortId());
  const batch = writeBatch(db);
  batch.set(aRef, {
    kind: "withdraw",
    currency: "yen",
    amount,
    refId: null,
    memberId,
    status: "pending",
    requestedAt: serverTimestamp(),
  });
  await batch.commit();
  return aRef.id;
}

/** 親: ひきだし申請を承認(残高減+取引記録+承認更新を1コミットで。現金は手渡し) */
export async function approveWithdraw({ approvalId, memberId, amount }) {
  await adultMoneyOp({
    type: "withdraw",
    memberId,
    currency: "yen",
    amount,
    direction: "out",
    message: "げんきんに かえたよ",
    extraWrites: (tx) => {
      tx.update(famDoc("approvals", approvalId), decisionFields("approved"));
    },
  });
}

/** 子: ごほうびショップでポイントを券と交換(pt消費+取引+券発行を1コミットで) */
export async function redeemReward({ memberId, rewardId, reward }) {
  await runTransaction(db, async (tx) => {
    const wSnap = await tx.get(walletRef(memberId));
    const w = wSnap.data();
    if (w.pt < reward.costPt) throw new Error("ポイントが たりないよ");
    const ticketRef = doc(famCol("tickets"), "tk" + shortId());
    const txnRef = doc(famCol("transactions"), "t" + shortId());
    const newPt = w.pt - reward.costPt;
    tx.update(walletRef(memberId), { pt: newPt, lastTxnId: txnRef.id });
    tx.set(txnRef, baseTxn({
      type: "redeem",
      currency: "pt",
      amount: reward.costPt,
      fromMemberId: memberId,
      toMemberId: null,
      memberIds: [memberId],
      balanceAfter: { from: newPt, to: null },
      refId: ticketRef.id,
      message: reward.title,
    }));
    tx.set(ticketRef, {
      memberId,
      emoji: reward.emoji ?? "🎁",
      title: reward.title,
      desc: reward.desc ?? "ポイントで こうかんしたよ",
      status: "unused",
      approvalId: null,
      rewardId,
      redeemTxnId: txnRef.id,
      createdByUid: auth.currentUser.uid,
      createdAt: serverTimestamp(),
      usedAt: null,
    });
  });
}

/** 子: 算数チャレンジ正解のボーナス(ルールが20時間クールダウンと金額を強制) */
export async function claimQuizReward({ memberId, bonusPt }) {
  const wRef = walletRef(memberId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(wRef);
    const w = snap.data();
    const txnRef = doc(famCol("transactions"), "t" + shortId());
    const newPt = w.pt + bonusPt;
    tx.update(wRef, { pt: newPt, lastTxnId: txnRef.id, lastQuizAt: serverTimestamp() });
    tx.set(txnRef, baseTxn({
      type: "quiz",
      currency: "pt",
      amount: bonusPt,
      fromMemberId: null,
      toMemberId: memberId,
      memberIds: [memberId],
      balanceAfter: { from: null, to: newPt },
      message: "さんすうチャレンジ せいかい!",
    }));
  });
}
