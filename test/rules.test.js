// セキュリティルールのユニットテスト。
// 「子が開発者ツールを開いても残高を改ざんできない」ことをここで証明する。
// 実行: npm test (firebase emulators:exec 経由で Firestore エミュレータ上で走る)
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  writeBatch,
  serverTimestamp,
  arrayUnion,
  Timestamp,
  query,
} from "firebase/firestore";

const PROJECT = "demo-okozukai-bank";
const FAM = "famtest";
const KEY = "test-setup-key";
const DAY = 86400000;
const WEEK = 7 * DAY;
const NOW_MS = Date.now();
const WEEK_AGO_8 = Timestamp.fromMillis(NOW_MS - 8 * DAY);
const EPOCH = Timestamp.fromMillis(0);

const UID = {
  papa: "uid-papa",
  jiji: "uid-jiji",
  taro: "uid-taro",
  jiro: "uid-jiro",
  stranger: "uid-stranger",
};

let env;

const fdoc = (db, ...segs) => doc(db, "families", FAM, ...segs);
const as = (uid) => env.authenticatedContext(uid).firestore();

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    const b = writeBatch(db);
    b.set(doc(db, "families", FAM), {
      name: "テスト家", setupKey: KEY, createdBy: UID.papa, createdAt: now,
    });
    b.set(fdoc(db, "settings", "config"), { weeklyRateBp: 100, quizBonusPt: 5 });

    const unlocksOn = { quest: true, goal: true, interest: true, invest: false };
    b.set(fdoc(db, "members", "papa"), { name: "パパ", role: "parent", level: 1, unlocks: {}, sort: 0 });
    b.set(fdoc(db, "members", "jiji"), { name: "じいじ", role: "giver", level: 1, unlocks: {}, sort: 1 });
    b.set(fdoc(db, "members", "taro"), { name: "たろう", role: "child", level: 2, unlocks: unlocksOn, sort: 2 });
    b.set(fdoc(db, "members", "jiro"), { name: "じろう", role: "child", level: 1, unlocks: { ...unlocksOn, interest: false }, sort: 3 });

    for (const [m, uid, role] of [
      ["papa", UID.papa, "parent"],
      ["jiji", UID.jiji, "giver"],
      ["taro", UID.taro, "child"],
      ["jiro", UID.jiro, "child"],
    ]) {
      b.set(fdoc(db, "devices", uid), { memberId: m, role, inviteToken: null, label: "test", registeredAt: now });
      b.set(doc(db, "uids", uid), { familyId: FAM, memberId: m, role });
    }

    b.set(fdoc(db, "wallets", "taro"), { yen: 500, pt: 100, lastTxnId: "", lastInterestAt: WEEK_AGO_8, lastQuizAt: EPOCH });
    b.set(fdoc(db, "wallets", "jiro"), { yen: 300, pt: 50, lastTxnId: "", lastInterestAt: WEEK_AGO_8, lastQuizAt: EPOCH });

    b.set(fdoc(db, "quests", "q1"), { title: "しょっきあらい", points: 30, emoji: "🍽️", active: true, sort: 0 });
    b.set(fdoc(db, "rewards", "r1"), { title: "ゲームけん", emoji: "🎮", costPt: 30, active: true, sort: 0 });
    b.set(fdoc(db, "rewards", "r2"), { title: "おやすみけん", emoji: "🌙", costPt: 50, active: false, sort: 1 });
    b.set(fdoc(db, "tickets", "tk1"), {
      memberId: "taro", emoji: "🚗", title: "おでかけけん", desc: "",
      status: "unused", approvalId: null, createdByUid: UID.papa, createdAt: now, usedAt: null,
    });
    b.set(fdoc(db, "tickets", "tk2"), {
      memberId: "jiro", emoji: "🍦", title: "アイスけん", desc: "",
      status: "unused", approvalId: null, createdByUid: UID.papa, createdAt: now, usedAt: null,
    });
    b.set(fdoc(db, "transactions", "t-seed"), {
      type: "grant", currency: "yen", amount: 500, fromMemberId: null, toMemberId: "taro",
      memberIds: ["taro"], byUid: UID.papa, message: "", refId: null,
      balanceAfter: { from: null, to: 500 }, createdAt: now,
    });

    b.set(fdoc(db, "invites", "inv-taro-card"), {
      role: "child", memberId: "taro", reusable: true, revoked: false, expiresAt: null, usedBy: [], createdAt: now,
    });
    b.set(fdoc(db, "invites", "inv-mama-once"), {
      role: "parent", memberId: "mama", reusable: false, revoked: false,
      expiresAt: Timestamp.fromMillis(NOW_MS + DAY), usedBy: [], createdAt: now,
    });
    b.set(fdoc(db, "invites", "inv-revoked"), {
      role: "child", memberId: "taro", reusable: true, revoked: true, expiresAt: null, usedBy: [], createdAt: now,
    });
    b.set(fdoc(db, "invites", "inv-expired"), {
      role: "parent", memberId: "mama", reusable: false, revoked: false,
      expiresAt: Timestamp.fromMillis(NOW_MS - DAY), usedBy: [], createdAt: now,
    });
    await b.commit();
  });
}

/** ルール無効で fixture を書き換えるユーティリティ */
async function raw(fn) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

/** 送金バッチ(クライアント実装のミラー) */
function transferBatch(db, byUid, { from, to, currency, amount, newFrom, newTo, txnId = "t-x1" }) {
  const b = writeBatch(db);
  b.update(fdoc(db, "wallets", from), { [currency]: newFrom, lastTxnId: txnId });
  b.update(fdoc(db, "wallets", to), { [currency]: newTo, lastTxnId: txnId });
  b.set(fdoc(db, "transactions", txnId), {
    type: "transfer", currency, amount, fromMemberId: from, toMemberId: to,
    memberIds: [from, to], byUid, message: "テスト", refId: null,
    balanceAfter: { from: newFrom, to: newTo }, createdAt: serverTimestamp(),
  });
  return b.commit();
}

/** 大人の付与/引出バッチ */
function adultOpBatch(db, byUid, { type, memberId, currency, amount, newBal, direction = "in", txnId = "t-a1" }) {
  const b = writeBatch(db);
  b.update(fdoc(db, "wallets", memberId), { [currency]: newBal, lastTxnId: txnId });
  b.set(fdoc(db, "transactions", txnId), {
    type, currency, amount,
    fromMemberId: direction === "in" ? null : memberId,
    toMemberId: direction === "in" ? memberId : null,
    memberIds: [memberId], byUid, message: "", refId: null,
    balanceAfter: direction === "in" ? { from: null, to: newBal } : { from: newBal, to: null },
    createdAt: serverTimestamp(),
  });
  return { batch: b, commit: () => b.commit() };
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      rules: readFileSync(new URL("../rules/firestore.rules", import.meta.url), "utf8")
        .replaceAll("__SETUP_KEY__", KEY),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(seed);

// ================================================================
describe("アクセス制御", () => {
  it("未登録UIDは家族データを一切読めない", async () => {
    const db = as(UID.stranger);
    await assertFails(getDoc(fdoc(db, "wallets", "taro")));
    await assertFails(getDoc(fdoc(db, "members", "taro")));
    await assertFails(getDoc(fdoc(db, "settings", "config")));
    await assertFails(getDocs(collection(db, "families", FAM, "transactions")));
  });

  it("家族メンバーは残高を読める", async () => {
    await assertSucceeds(getDoc(fdoc(as(UID.taro), "wallets", "jiro")));
    await assertSucceeds(getDoc(fdoc(as(UID.jiji), "wallets", "taro")));
  });

  it("子は devices(トークン入り)を読めない・招待の一覧も不可", async () => {
    const db = as(UID.taro);
    await assertFails(getDoc(fdoc(db, "devices", UID.papa)));
    await assertFails(getDocs(collection(db, "families", FAM, "invites")));
    // トークンを知っていれば get は可能(登録フローに必要)
    await assertSucceeds(getDoc(fdoc(db, "invites", "inv-taro-card")));
  });
});

// ================================================================
describe("残高改ざん防止", () => {
  it("取引とペアでない wallet 更新は拒否", async () => {
    await assertFails(updateDoc(fdoc(as(UID.taro), "wallets", "taro"), { yen: 99999 }));
    await assertFails(updateDoc(fdoc(as(UID.taro), "wallets", "taro"), { yen: 600, lastTxnId: "t-fake" }));
  });

  it("幽霊取引(wallet を動かさない取引作成)は拒否", async () => {
    await assertFails(setDoc(fdoc(as(UID.taro), "transactions", "t-ghost"), {
      type: "transfer", currency: "yen", amount: 100, fromMemberId: "taro", toMemberId: "jiro",
      memberIds: ["taro", "jiro"], byUid: UID.taro, message: "", refId: null,
      balanceAfter: { from: 400, to: 400 }, createdAt: serverTimestamp(),
    }));
  });

  it("元帳は親でも変更・削除できない", async () => {
    const db = as(UID.papa);
    await assertFails(updateDoc(fdoc(db, "transactions", "t-seed"), { amount: 1 }));
    await assertFails(deleteDoc(fdoc(db, "transactions", "t-seed")));
  });
});

// ================================================================
describe("兄弟間送金(承認制)", () => {
  const transferReq = (db, { amount = 100, currency = "yen", to = "jiro", id = "at1" } = {}) =>
    setDoc(fdoc(db, "approvals", id), {
      kind: "transfer", refId: null, memberId: "taro", toMemberId: to, currency, amount,
      message: "おやつ代", status: "pending", requestedAt: serverTimestamp(),
    });

  it("子は残高内で送金リクエストでき、残高超過・自分宛は拒否", async () => {
    await assertSucceeds(transferReq(as(UID.taro)));
    await assertFails(transferReq(as(UID.taro), { amount: 9999, id: "at2" }));
    await assertFails(transferReq(as(UID.taro), { to: "taro", id: "at3" }));
  });

  it("子が直接 transfer 取引で残高を動かすのは拒否(承認制のため)", async () => {
    await assertFails(transferBatch(as(UID.taro), UID.taro, {
      from: "taro", to: "jiro", currency: "yen", amount: 100, newFrom: 400, newTo: 400,
    }));
    await assertFails(transferBatch(as(UID.jiro), UID.jiro, {
      from: "taro", to: "jiro", currency: "yen", amount: 100, newFrom: 400, newTo: 400,
    }));
  });

  it("親の承認で送金が成立し、受け取り側に開封演出用ギフトも作られる", async () => {
    await transferReq(as(UID.taro));
    const db = as(UID.papa);
    const b = writeBatch(db);
    b.update(fdoc(db, "wallets", "taro"), { yen: 400, lastTxnId: "t-x1" });
    b.update(fdoc(db, "wallets", "jiro"), { yen: 400, lastTxnId: "t-x1" });
    b.set(fdoc(db, "transactions", "t-x1"), {
      type: "transfer", currency: "yen", amount: 100, fromMemberId: "taro", toMemberId: "jiro",
      memberIds: ["taro", "jiro"], byUid: UID.papa, message: "おやつ代", refId: "at1",
      balanceAfter: { from: 400, to: 400 }, createdAt: serverTimestamp(),
    });
    b.set(fdoc(db, "gifts", "g-t1"), {
      toMemberId: "jiro", fromMemberId: "taro", kind: "yen", amount: 100, refId: "t-x1",
      message: "おやつ代", seenAt: null, createdAt: serverTimestamp(),
    });
    b.update(fdoc(db, "approvals", "at1"), {
      status: "approved", decidedAt: serverTimestamp(), decidedByUid: UID.papa, note: "",
    });
    await assertSucceeds(b.commit());
  });

  it("子は grant(自分への入金)を作れない", async () => {
    const { commit } = adultOpBatch(as(UID.taro), UID.taro, {
      type: "grant", memberId: "taro", currency: "yen", amount: 1000, newBal: 1500,
    });
    await assertFails(commit());
  });
});

// ================================================================
describe("券の譲渡・交換(承認制)", () => {
  const ticketTransferReq = (db, { ticketId = "tk1", approvalId = "att1", memberId = "taro", to = "jiro", want = null } = {}) => {
    const b = writeBatch(db);
    b.update(fdoc(db, "tickets", ticketId), { status: "pending", approvalId });
    b.set(fdoc(db, "approvals", approvalId), {
      kind: "ticketTransfer", refId: ticketId, memberId, toMemberId: to,
      wantTicketId: want, status: "pending", requestedAt: serverTimestamp(),
    });
    return b.commit();
  };

  it("自分の券の譲渡リクエストができる", async () => {
    await assertSucceeds(ticketTransferReq(as(UID.taro)));
  });

  it("自分宛の譲渡・他人の券の譲渡は拒否", async () => {
    await assertFails(ticketTransferReq(as(UID.taro), { to: "taro", approvalId: "att2" }));
    await assertFails(ticketTransferReq(as(UID.jiro), { approvalId: "att3" })); // tk1 はたろうの券
  });

  it("交換は相手の同意がないと親も承認できず、同意後は承認できる", async () => {
    await ticketTransferReq(as(UID.taro), { want: "tk2" });
    const decide = (status) => updateDoc(fdoc(as(UID.papa), "approvals", "att1"), {
      status, decidedAt: serverTimestamp(), decidedByUid: UID.papa, note: "",
    });
    await assertFails(decide("approved"));                       // 同意なし承認は不可
    await assertFails(updateDoc(fdoc(as(UID.taro), "approvals", "att1"), { peerConsent: true })); // 本人のなりすまし同意は不可
    await assertSucceeds(updateDoc(fdoc(as(UID.jiro), "approvals", "att1"), { peerConsent: true }));
    await assertSucceeds(decide("approved"));
  });

  it("相手はことわれる(券が戻り、依頼者に通知される)", async () => {
    await ticketTransferReq(as(UID.taro), { want: "tk2" });
    const db = as(UID.jiro);
    const b = writeBatch(db);
    b.update(fdoc(db, "approvals", "att1"), { status: "rejected", note: "じろうが ことわったよ", seenAt: null });
    b.update(fdoc(db, "tickets", "tk1"), { status: "unused" });
    await assertSucceeds(b.commit());
  });

  it("券を戻さないおことわり・第三者のおことわりは拒否", async () => {
    await ticketTransferReq(as(UID.taro), { want: "tk2" });
    // 券の巻き戻しなしのおことわりは不可
    await assertFails(updateDoc(fdoc(as(UID.jiro), "approvals", "att1"), {
      status: "rejected", note: "x", seenAt: null,
    }));
    // 依頼者本人が「おことわり」を装うのは不可
    const db = as(UID.taro);
    const b = writeBatch(db);
    b.update(fdoc(db, "approvals", "att1"), { status: "rejected", note: "x", seenAt: null });
    b.update(fdoc(db, "tickets", "tk1"), { status: "unused" });
    await assertFails(b.commit());
  });

  it("親の承認で券の持ち主が変わり、ギフトが作られる", async () => {
    await ticketTransferReq(as(UID.taro));
    const db = as(UID.papa);
    const b = writeBatch(db);
    b.update(fdoc(db, "approvals", "att1"), {
      status: "approved", decidedAt: serverTimestamp(), decidedByUid: UID.papa, note: "",
    });
    b.update(fdoc(db, "tickets", "tk1"), { memberId: "jiro", status: "unused", approvalId: null });
    b.set(fdoc(db, "gifts", "g-tt1"), {
      toMemberId: "jiro", fromMemberId: "taro", kind: "ticket", amount: null, refId: "tk1",
      message: "", seenAt: null, createdAt: serverTimestamp(),
    });
    await assertSucceeds(b.commit());
  });
});

// ================================================================
describe("却下のお知らせ(既読)", () => {
  it("却下は本人だけが1回だけ既読にできる", async () => {
    await raw((db) => setDoc(fdoc(db, "approvals", "ar1"), {
      kind: "withdraw", currency: "yen", amount: 100, refId: null, memberId: "taro",
      status: "rejected", requestedAt: Timestamp.now(), decidedAt: Timestamp.now(),
      decidedByUid: UID.papa, note: "", seenAt: null,
    }));
    await assertFails(updateDoc(fdoc(as(UID.jiro), "approvals", "ar1"), { seenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(fdoc(as(UID.taro), "approvals", "ar1"), { seenAt: serverTimestamp() }));
    await assertFails(updateDoc(fdoc(as(UID.taro), "approvals", "ar1"), { seenAt: serverTimestamp() }));
  });
});

// ================================================================
describe("親と祖父母の残高操作", () => {
  it("親の入金・引き出しは成功する", async () => {
    const g = adultOpBatch(as(UID.papa), UID.papa, {
      type: "grant", memberId: "taro", currency: "yen", amount: 200, newBal: 700,
    });
    await assertSucceeds(g.commit());
    const w = adultOpBatch(as(UID.papa), UID.papa, {
      type: "withdraw", memberId: "jiro", currency: "yen", amount: 100, newBal: 200,
      direction: "out", txnId: "t-a2",
    });
    await assertSucceeds(w.commit());
  });

  it("親でもマイナス残高になる引き出しは拒否", async () => {
    const { commit } = adultOpBatch(as(UID.papa), UID.papa, {
      type: "withdraw", memberId: "jiro", currency: "yen", amount: 500, newBal: -200, direction: "out",
    });
    await assertFails(commit());
  });

  it("祖父母(giver)は増額のみ可能・減額は拒否", async () => {
    const g = adultOpBatch(as(UID.jiji), UID.jiji, {
      type: "gift", memberId: "taro", currency: "pt", amount: 50, newBal: 150,
    });
    await assertSucceeds(g.commit());
    const w = adultOpBatch(as(UID.jiji), UID.jiji, {
      type: "withdraw", memberId: "taro", currency: "yen", amount: 100, newBal: 400,
      direction: "out", txnId: "t-a2",
    });
    await assertFails(w.commit());
  });

  it("giver は設定・クエストを書けない", async () => {
    const db = as(UID.jiji);
    await assertFails(updateDoc(fdoc(db, "settings", "config"), { weeklyRateBp: 9999, quizBonusPt: 5 }));
    await assertFails(setDoc(fdoc(db, "quests", "q9"), { title: "x", points: 10, active: true }));
  });
});

// ================================================================
describe("利息(単利・週次)", () => {
  const interestBatch = (db, byUid, { pt, amount, newPt, lastAt, txnId = "t-i1" }) => {
    const b = writeBatch(db);
    b.update(fdoc(db, "wallets", "taro"), {
      pt: newPt, lastTxnId: txnId, lastInterestAt: Timestamp.fromMillis(lastAt),
    });
    b.set(fdoc(db, "transactions", txnId), {
      type: "interest", currency: "pt", amount, fromMemberId: null, toMemberId: "taro",
      memberIds: ["taro"], byUid, message: "", refId: null,
      balanceAfter: { from: null, to: newPt }, createdAt: serverTimestamp(),
    });
    return b.commit();
  };

  it("正しい利息(残高100pt×1%=1pt、+7日)は成功", async () => {
    await assertSucceeds(interestBatch(as(UID.taro), UID.taro, {
      pt: 100, amount: 1, newPt: 101, lastAt: WEEK_AGO_8.toMillis() + WEEK,
    }));
  });

  it("水増しした利息額は拒否", async () => {
    await assertFails(interestBatch(as(UID.taro), UID.taro, {
      pt: 100, amount: 50, newPt: 150, lastAt: WEEK_AGO_8.toMillis() + WEEK,
    }));
  });

  it("未来分の先取り(2週目)は拒否", async () => {
    await assertSucceeds(interestBatch(as(UID.taro), UID.taro, {
      pt: 100, amount: 1, newPt: 101, lastAt: WEEK_AGO_8.toMillis() + WEEK,
    }));
    await assertFails(interestBatch(as(UID.taro), UID.taro, {
      pt: 101, amount: 1, newPt: 102, lastAt: WEEK_AGO_8.toMillis() + 2 * WEEK, txnId: "t-i2",
    }));
  });

  it("利息が未解放の子(jiro)は拒否", async () => {
    const db = as(UID.jiro);
    const batch = writeBatch(db);
    batch.update(fdoc(db, "wallets", "jiro"), {
      pt: 50, lastTxnId: "t-i9", lastInterestAt: Timestamp.fromMillis(WEEK_AGO_8.toMillis() + WEEK),
    });
    batch.set(fdoc(db, "transactions", "t-i9"), {
      type: "interest", currency: "pt", amount: 0, fromMemberId: null, toMemberId: "jiro",
      memberIds: ["jiro"], byUid: UID.jiro, message: "", refId: null,
      balanceAfter: { from: null, to: 50 }, createdAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it("0pt週の日付送り(スキップ)は残高が小さいときだけ成功", async () => {
    await raw((db) => updateDoc(fdoc(db, "wallets", "taro"), { pt: 50 })); // 50×1%=0.5→0pt
    await assertSucceeds(updateDoc(fdoc(as(UID.taro), "wallets", "taro"), {
      lastInterestAt: Timestamp.fromMillis(WEEK_AGO_8.toMillis() + WEEK),
    }));
    // 利息が出る残高(pt100)ではスキップ不可
    await raw((db) => updateDoc(fdoc(db, "wallets", "jiro"), { pt: 100 }));
    await assertFails(updateDoc(fdoc(as(UID.jiro), "wallets", "jiro"), {
      lastInterestAt: Timestamp.fromMillis(WEEK_AGO_8.toMillis() + WEEK),
    }));
  });
});

// ================================================================
describe("算数チャレンジ", () => {
  const quizBatch = (db, byUid, member, { amount, newPt, txnId = "t-q1" }) => {
    const b = writeBatch(db);
    b.update(fdoc(db, "wallets", member), {
      pt: newPt, lastTxnId: txnId, lastQuizAt: serverTimestamp(),
    });
    b.set(fdoc(db, "transactions", txnId), {
      type: "quiz", currency: "pt", amount, fromMemberId: null, toMemberId: member,
      memberIds: [member], byUid, message: "", refId: null,
      balanceAfter: { from: null, to: newPt }, createdAt: serverTimestamp(),
    });
    return b.commit();
  };

  it("正解ボーナス(設定通りの5pt)は成功", async () => {
    await assertSucceeds(quizBatch(as(UID.taro), UID.taro, "taro", { amount: 5, newPt: 105 }));
  });

  it("設定と違う金額は拒否", async () => {
    await assertFails(quizBatch(as(UID.taro), UID.taro, "taro", { amount: 100, newPt: 200 }));
  });

  it("同じ日(日本時間)の再取得は拒否、日付が変われば取得できる", async () => {
    // 1回目は成功 → 直後(同じ日)の2回目は拒否
    await assertSucceeds(quizBatch(as(UID.taro), UID.taro, "taro", { amount: 5, newPt: 105 }));
    await assertFails(quizBatch(as(UID.taro), UID.taro, "taro", { amount: 5, newPt: 110, txnId: "t-q2" }));

    const jstMidnightMs =
      Math.floor((Date.now() + 9 * 3600 * 1000) / 86400000) * 86400000 - 9 * 3600 * 1000;
    // 前日23:59(JST)にクリア済み → 日付が変わっているので取得できる
    await raw((db) => updateDoc(fdoc(db, "wallets", "taro"), {
      lastQuizAt: Timestamp.fromMillis(jstMidnightMs - 60000), pt: 100, lastTxnId: "",
    }));
    await assertSucceeds(quizBatch(as(UID.taro), UID.taro, "taro", { amount: 5, newPt: 105, txnId: "t-q3" }));
    // 今日0:30(JST)にクリア済み → 同じ日なので拒否
    await raw((db) => updateDoc(fdoc(db, "wallets", "taro"), {
      lastQuizAt: Timestamp.fromMillis(jstMidnightMs + 30 * 60000), pt: 100, lastTxnId: "",
    }));
    await assertFails(quizBatch(as(UID.taro), UID.taro, "taro", { amount: 5, newPt: 105, txnId: "t-q4" }));
  });
});

// ================================================================
describe("端末登録", () => {
  const registerBatch = (db, uid, { token, role, memberId, consume = false }) => {
    const b = writeBatch(db);
    b.set(fdoc(db, "devices", uid), {
      memberId, role, inviteToken: token, label: "new device", registeredAt: serverTimestamp(),
    });
    b.set(doc(db, "uids", uid), { familyId: FAM, memberId, role });
    if (consume) {
      b.update(fdoc(db, "invites", token), { revoked: true, usedBy: arrayUnion(uid) });
    }
    return b.commit();
  };

  it("有効なカードトークンで子端末を登録できる", async () => {
    await assertSucceeds(registerBatch(as(UID.stranger), UID.stranger, {
      token: "inv-taro-card", role: "child", memberId: "taro",
    }));
  });

  it("子トークンで親として登録(ロール偽装)は拒否", async () => {
    await assertFails(registerBatch(as(UID.stranger), UID.stranger, {
      token: "inv-taro-card", role: "parent", memberId: "taro",
    }));
    await assertFails(registerBatch(as(UID.stranger), UID.stranger, {
      token: "inv-taro-card", role: "child", memberId: "jiro", // 別メンバーへのすり替えも拒否
    }));
  });

  it("無効化済み・期限切れトークンは拒否", async () => {
    await assertFails(registerBatch(as(UID.stranger), UID.stranger, {
      token: "inv-revoked", role: "child", memberId: "taro",
    }));
    await assertFails(registerBatch(as(UID.stranger), UID.stranger, {
      token: "inv-expired", role: "parent", memberId: "mama", consume: true,
    }));
  });

  it("一回限りトークンは同時消費が必須で、消費後は使えない", async () => {
    // 消費なしの登録は拒否
    await assertFails(registerBatch(as(UID.stranger), UID.stranger, {
      token: "inv-mama-once", role: "parent", memberId: "mama",
    }));
    // 消費付きは成功
    await assertSucceeds(registerBatch(as(UID.stranger), UID.stranger, {
      token: "inv-mama-once", role: "parent", memberId: "mama", consume: true,
    }));
    // 2人目は失敗
    await assertFails(registerBatch(as("uid-second"), "uid-second", {
      token: "inv-mama-once", role: "parent", memberId: "mama", consume: true,
    }));
  });

  it("端末は自分の登録を解除できるが、他人の登録は解除できない(親を除く)", async () => {
    const deleteRegs = (db, uid) => {
      const b = writeBatch(db);
      b.delete(fdoc(db, "devices", uid));
      b.delete(doc(db, "uids", uid));
      return b.commit();
    };
    // 子が兄弟の登録を消すのは拒否
    await assertFails(deleteRegs(as(UID.taro), UID.jiro));
    // 未登録UIDが他人の登録を消すのも拒否
    await assertFails(deleteRegs(as(UID.stranger), UID.taro));
    // 自分自身の登録解除は成功
    await assertSucceeds(deleteRegs(as(UID.taro), UID.taro));
    // 親は端末整理として他の端末を消せる
    await assertSucceeds(deleteRegs(as(UID.papa), UID.jiro));
  });

  it("登録済み端末の別メンバーへの切り替え: 上書きは拒否・解除→再登録は成功", async () => {
    const db = as(UID.taro);
    // 上書き(既存 devices/uids への set)は拒否されること
    await assertFails(registerBatch(db, UID.taro, {
      token: "inv-taro-card", role: "child", memberId: "taro",
    }));
    // クライアント実装のミラー: 自分の登録を外してから登録し直す
    const del = writeBatch(db);
    del.delete(fdoc(db, "devices", UID.taro));
    del.delete(doc(db, "uids", UID.taro));
    await assertSucceeds(del.commit());
    await assertSucceeds(registerBatch(db, UID.taro, {
      token: "inv-taro-card", role: "child", memberId: "taro",
    }));
  });
});

// ================================================================
describe("券と承認フロー", () => {
  const useTicketBatch = (db, member, { ticketId = "tk1", approvalId = "a1" } = {}) => {
    const b = writeBatch(db);
    b.update(fdoc(db, "tickets", ticketId), { status: "pending", approvalId });
    b.set(fdoc(db, "approvals", approvalId), {
      kind: "ticket", refId: ticketId, memberId: member, status: "pending", requestedAt: serverTimestamp(),
    });
    return b.commit();
  };

  it("子は自分の券の使用申請ができる", async () => {
    await assertSucceeds(useTicketBatch(as(UID.taro), "taro"));
  });

  it("他人の券の使用申請・直接「使用済み」化は拒否", async () => {
    await assertFails(useTicketBatch(as(UID.jiro), "jiro"));
    await assertFails(updateDoc(fdoc(as(UID.taro), "tickets", "tk1"), { status: "used" }));
  });

  it("親は承認でき、子は自分で承認できない", async () => {
    await useTicketBatch(as(UID.taro), "taro");
    // 子の自己承認は拒否
    await assertFails(updateDoc(fdoc(as(UID.taro), "approvals", "a1"), {
      status: "approved", decidedAt: serverTimestamp(), decidedByUid: UID.taro, note: "",
    }));
    // 親の承認は成功(承認+券使用済み化)
    const db = as(UID.papa);
    const b = writeBatch(db);
    b.update(fdoc(db, "approvals", "a1"), {
      status: "approved", decidedAt: serverTimestamp(), decidedByUid: UID.papa, note: "",
    });
    b.update(fdoc(db, "tickets", "tk1"), { status: "used", usedAt: serverTimestamp() });
    await assertSucceeds(b.commit());
  });

  it("子は申請を取り下げられる(券が unused に戻るときだけ)", async () => {
    await useTicketBatch(as(UID.taro), "taro");
    // 承認だけ canceled にして券を pending のまま残すのは拒否
    await assertFails(updateDoc(fdoc(as(UID.taro), "approvals", "a1"), { status: "canceled" }));
    // 券を戻すバッチなら成功
    const db = as(UID.taro);
    const b = writeBatch(db);
    b.update(fdoc(db, "tickets", "tk1"), { status: "unused" });
    b.update(fdoc(db, "approvals", "a1"), { status: "canceled" });
    await assertSucceeds(b.commit());
  });

  it("クエスト報告→親の承認でポイント付与", async () => {
    await assertSucceeds(setDoc(fdoc(as(UID.taro), "approvals", "aq1"), {
      kind: "quest", refId: "q1", memberId: "taro", status: "pending", requestedAt: serverTimestamp(),
    }));
    // 承認 + pt付与 + 取引 を1コミットで
    const db = as(UID.papa);
    const b = writeBatch(db);
    b.update(fdoc(db, "approvals", "aq1"), {
      status: "approved", decidedAt: serverTimestamp(), decidedByUid: UID.papa, note: "",
    });
    b.update(fdoc(db, "wallets", "taro"), { pt: 130, lastTxnId: "t-qst1" });
    b.set(fdoc(db, "transactions", "t-qst1"), {
      type: "quest", currency: "pt", amount: 30, fromMemberId: null, toMemberId: "taro",
      memberIds: ["taro"], byUid: UID.papa, message: "しょっきあらい", refId: "aq1",
      balanceAfter: { from: null, to: 130 }, createdAt: serverTimestamp(),
    });
    await assertSucceeds(b.commit());
  });

  it("存在しない/停止中クエストの報告は拒否", async () => {
    await raw((db) => updateDoc(fdoc(db, "quests", "q1"), { active: false }));
    await assertFails(setDoc(fdoc(as(UID.taro), "approvals", "aq2"), {
      kind: "quest", refId: "q1", memberId: "taro", status: "pending", requestedAt: serverTimestamp(),
    }));
  });
});

// ================================================================
describe("サプライズギフト", () => {
  it("親のお金ギフト(取引ペア付き)は成功、取引なしは拒否", async () => {
    const db = as(UID.papa);
    const b = writeBatch(db);
    b.update(fdoc(db, "wallets", "taro"), { yen: 1000, lastTxnId: "t-g1" });
    b.set(fdoc(db, "transactions", "t-g1"), {
      type: "gift", currency: "yen", amount: 500, fromMemberId: null, toMemberId: "taro",
      memberIds: ["taro"], byUid: UID.papa, message: "おめでとう", refId: null,
      balanceAfter: { from: null, to: 1000 }, createdAt: serverTimestamp(),
    });
    b.set(fdoc(db, "gifts", "g1"), {
      toMemberId: "taro", fromMemberId: "papa", kind: "yen", amount: 500, refId: "t-g1",
      message: "おめでとう", seenAt: null, createdAt: serverTimestamp(),
    });
    await assertSucceeds(b.commit());

    await assertFails(setDoc(fdoc(as(UID.papa), "gifts", "g2"), {
      toMemberId: "taro", fromMemberId: "papa", kind: "yen", amount: 500, refId: "t-nothing",
      message: "", seenAt: null, createdAt: serverTimestamp(),
    }));
  });

  it("祖父母の券ギフトは成功", async () => {
    const db = as(UID.jiji);
    const b = writeBatch(db);
    b.set(fdoc(db, "tickets", "tk-gift"), {
      memberId: "taro", emoji: "🍦", title: "アイスけん", desc: "",
      status: "unused", approvalId: null, createdByUid: UID.jiji, createdAt: serverTimestamp(), usedAt: null,
    });
    b.set(fdoc(db, "gifts", "g3"), {
      toMemberId: "taro", fromMemberId: "jiji", kind: "ticket", amount: null, refId: "tk-gift",
      message: "じいじより", seenAt: null, createdAt: serverTimestamp(),
    });
    await assertSucceeds(b.commit());
  });

  it("giver は差出人を他人にできない(代行は親のみ)", async () => {
    const db = as(UID.jiji);
    const b = writeBatch(db);
    b.set(fdoc(db, "tickets", "tk-spoof"), {
      memberId: "taro", emoji: "🎫", title: "x", desc: "", status: "unused",
      approvalId: null, createdByUid: UID.jiji, createdAt: serverTimestamp(), usedAt: null,
    });
    b.set(fdoc(db, "gifts", "g-spoof"), {
      toMemberId: "taro", fromMemberId: "papa", kind: "ticket", amount: null, refId: "tk-spoof",
      message: "", seenAt: null, createdAt: serverTimestamp(),
    });
    await assertFails(b.commit());
  });

  it("開封記録は宛先の子だけができる", async () => {
    await raw((db) => setDoc(fdoc(db, "gifts", "g9"), {
      toMemberId: "taro", fromMemberId: "papa", kind: "pt", amount: 10, refId: "t-x",
      message: "", seenAt: null, createdAt: Timestamp.now(),
    }));
    await assertFails(updateDoc(fdoc(as(UID.jiro), "gifts", "g9"), { seenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(fdoc(as(UID.taro), "gifts", "g9"), { seenAt: serverTimestamp() }));
    // 2回目の開封(上書き)は拒否
    await assertFails(updateDoc(fdoc(as(UID.taro), "gifts", "g9"), { seenAt: serverTimestamp() }));
  });
});

// ================================================================
describe("ひきだし申請と承認", () => {
  const withdrawReq = (db, { amount, id = "aw1" }) =>
    setDoc(fdoc(db, "approvals", id), {
      kind: "withdraw", currency: "yen", amount, refId: null,
      memberId: "taro", status: "pending", requestedAt: serverTimestamp(),
    });

  it("残高内の申請はでき、残高超過・0円は拒否", async () => {
    await assertSucceeds(withdrawReq(as(UID.taro), { amount: 200 }));
    await assertFails(withdrawReq(as(UID.taro), { amount: 9999, id: "aw2" }));
    await assertFails(withdrawReq(as(UID.taro), { amount: 0, id: "aw3" }));
  });

  it("親の承認で残高減+取引記録が成立する", async () => {
    await withdrawReq(as(UID.taro), { amount: 200 });
    const db = as(UID.papa);
    const b = writeBatch(db);
    b.update(fdoc(db, "approvals", "aw1"), {
      status: "approved", decidedAt: serverTimestamp(), decidedByUid: UID.papa, note: "",
    });
    b.update(fdoc(db, "wallets", "taro"), { yen: 300, lastTxnId: "t-w1" });
    b.set(fdoc(db, "transactions", "t-w1"), {
      type: "withdraw", currency: "yen", amount: 200, fromMemberId: "taro", toMemberId: null,
      memberIds: ["taro"], byUid: UID.papa, message: "", refId: "aw1",
      balanceAfter: { from: 300, to: null }, createdAt: serverTimestamp(),
    });
    await assertSucceeds(b.commit());
  });

  it("子はひきだし申請を取り下げられる", async () => {
    await withdrawReq(as(UID.taro), { amount: 100 });
    await assertSucceeds(updateDoc(fdoc(as(UID.taro), "approvals", "aw1"), { status: "canceled" }));
  });
});

// ================================================================
describe("ごほうび交換(ポイントの使い道)", () => {
  const redeemBatch = (db, uid, {
    rewardId = "r1", title = "ゲームけん", cost = 30, newPt = 70,
    txnId = "t-r1", ticketId = "tk-r1", withTicket = true, withWallet = true,
  } = {}) => {
    const b = writeBatch(db);
    if (withWallet) b.update(fdoc(db, "wallets", "taro"), { pt: newPt, lastTxnId: txnId });
    b.set(fdoc(db, "transactions", txnId), {
      type: "redeem", currency: "pt", amount: cost, fromMemberId: "taro", toMemberId: null,
      memberIds: ["taro"], byUid: uid, message: title, refId: ticketId,
      balanceAfter: { from: newPt, to: null }, createdAt: serverTimestamp(),
    });
    if (withTicket) b.set(fdoc(db, "tickets", ticketId), {
      memberId: "taro", emoji: "🎮", title, desc: "", status: "unused", approvalId: null,
      rewardId, redeemTxnId: txnId, createdByUid: uid, createdAt: serverTimestamp(), usedAt: null,
    });
    return b.commit();
  };

  it("正しい交換(30pt→券)は成功", async () => {
    await assertSucceeds(redeemBatch(as(UID.taro), UID.taro));
  });

  it("コストと違う支払い・減額のごまかしは拒否", async () => {
    await assertFails(redeemBatch(as(UID.taro), UID.taro, { cost: 1, newPt: 99 }));
    await assertFails(redeemBatch(as(UID.taro), UID.taro, { cost: 30, newPt: 99 }));
  });

  it("停止中のごほうびは交換できない", async () => {
    await assertFails(redeemBatch(as(UID.taro), UID.taro, {
      rewardId: "r2", title: "おやすみけん", cost: 50, newPt: 50,
    }));
  });

  it("券なしのpt消費・pt消費なしの券取得はどちらも拒否", async () => {
    await assertFails(redeemBatch(as(UID.taro), UID.taro, { withTicket: false }));
    await assertFails(redeemBatch(as(UID.taro), UID.taro, { withWallet: false }));
  });

  it("子はごほうびマスタを書けない", async () => {
    await assertFails(setDoc(fdoc(as(UID.taro), "rewards", "r9"), {
      title: "ずる", emoji: "😈", costPt: 1, active: true,
    }));
  });
});

// ================================================================
describe("カスタム画像(家族限定配信)", () => {
  const imageDoc = { name: "テスト", dataUrl: "data:image/jpeg;base64,AAAA", uploadedByUid: UID.papa };

  it("親はアップロードでき、子・giverはできない", async () => {
    await assertSucceeds(setDoc(fdoc(as(UID.papa), "images", "img1"), {
      ...imageDoc, createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(fdoc(as(UID.taro), "images", "img2"), {
      ...imageDoc, createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(fdoc(as(UID.jiji), "images", "img3"), {
      ...imageDoc, createdAt: serverTimestamp(),
    }));
  });

  it("家族は読める・未登録UIDは読めない", async () => {
    await raw((db) => setDoc(fdoc(db, "images", "img1"), { ...imageDoc, createdAt: Timestamp.now() }));
    await assertSucceeds(getDoc(fdoc(as(UID.taro), "images", "img1")));
    await assertFails(getDoc(fdoc(as(UID.stranger), "images", "img1")));
  });

  it("巨大すぎる画像データは拒否", async () => {
    await assertFails(setDoc(fdoc(as(UID.papa), "images", "img-big"), {
      name: "でかい", dataUrl: "x".repeat(1000000), uploadedByUid: UID.papa, createdAt: serverTimestamp(),
    }));
  });
});

// ================================================================
describe("セットアップと設定", () => {
  it("正しいあいことばで新しい家族を作成できる", async () => {
    const db = as("uid-new");
    const b = writeBatch(db);
    b.set(doc(db, "families", "famnew"), {
      name: "新しい家", setupKey: KEY, createdBy: "uid-new", createdAt: serverTimestamp(),
    });
    b.set(doc(db, "families", "famnew", "devices", "uid-new"), {
      memberId: "self", role: "parent", inviteToken: null, label: "x", registeredAt: serverTimestamp(),
    });
    b.set(doc(db, "uids", "uid-new"), { familyId: "famnew", memberId: "self", role: "parent" });
    await assertSucceeds(b.commit());
  });

  it("あいことばが違うと家族を作成できない", async () => {
    const db = as("uid-bad");
    const b = writeBatch(db);
    b.set(doc(db, "families", "fambad"), {
      name: "x", setupKey: "wrong-key", createdBy: "uid-bad", createdAt: serverTimestamp(),
    });
    b.set(doc(db, "families", "fambad", "devices", "uid-bad"), {
      memberId: "self", role: "parent", inviteToken: null, label: "x", registeredAt: serverTimestamp(),
    });
    b.set(doc(db, "uids", "uid-bad"), { familyId: "fambad", memberId: "self", role: "parent" });
    await assertFails(b.commit());
  });

  it("子は設定を書けない・親は書ける", async () => {
    await assertFails(updateDoc(fdoc(as(UID.taro), "settings", "config"), { weeklyRateBp: 10000, quizBonusPt: 999 }));
    await assertSucceeds(updateDoc(fdoc(as(UID.papa), "settings", "config"), { weeklyRateBp: 200, quizBonusPt: 10 }));
  });

  it("子はメンバー(レベル・アンロック)を書けない", async () => {
    await assertFails(updateDoc(fdoc(as(UID.taro), "members", "taro"), { level: 9 }));
  });

  it("きせかえ(テーマ・アバター・背景)は親のみ変更でき、子は変更できない", async () => {
    await assertSucceeds(updateDoc(fdoc(as(UID.papa), "members", "taro"), {
      theme: "sky", avatar: "🦄", bgImageId: "img1", avatarImageId: null,
    }));
    await assertFails(updateDoc(fdoc(as(UID.taro), "members", "taro"), { theme: "sky" }));
    await assertFails(updateDoc(fdoc(as(UID.taro), "members", "taro"), { avatar: "🐰" }));
    await assertFails(updateDoc(fdoc(as(UID.taro), "members", "taro"), { bgImageId: "img1" }));
  });
});
