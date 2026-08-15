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
    b.set(fdoc(db, "tickets", "tk1"), {
      memberId: "taro", emoji: "🚗", title: "おでかけけん", desc: "",
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
describe("兄弟間送金", () => {
  it("正しい送金は成功する", async () => {
    await assertSucceeds(transferBatch(as(UID.taro), UID.taro, {
      from: "taro", to: "jiro", currency: "yen", amount: 100, newFrom: 400, newTo: 400,
    }));
  });

  it("金額と残高変化が一致しない送金は拒否", async () => {
    await assertFails(transferBatch(as(UID.taro), UID.taro, {
      from: "taro", to: "jiro", currency: "yen", amount: 100, newFrom: 450, newTo: 400,
    }));
    // 相手だけ多く増やすのも拒否
    await assertFails(transferBatch(as(UID.taro), UID.taro, {
      from: "taro", to: "jiro", currency: "yen", amount: 100, newFrom: 400, newTo: 900,
    }));
  });

  it("残高を超える送金(マイナス残高)は拒否", async () => {
    await assertFails(transferBatch(as(UID.taro), UID.taro, {
      from: "taro", to: "jiro", currency: "yen", amount: 600, newFrom: -100, newTo: 900,
    }));
  });

  it("他人のおさいふからの送金(なりすまし)は拒否", async () => {
    await assertFails(transferBatch(as(UID.jiro), UID.jiro, {
      from: "taro", to: "jiro", currency: "yen", amount: 100, newFrom: 400, newTo: 400,
    }));
  });

  it("子は grant(自分への入金)を作れない", async () => {
    const { commit } = adultOpBatch(as(UID.taro), UID.taro, {
      type: "grant", memberId: "taro", currency: "yen", amount: 1000, newBal: 1500,
    });
    await assertFails(commit());
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

  it("20時間以内の再取得は拒否", async () => {
    await assertSucceeds(quizBatch(as(UID.taro), UID.taro, "taro", { amount: 5, newPt: 105 }));
    await assertFails(quizBatch(as(UID.taro), UID.taro, "taro", { amount: 5, newPt: 110, txnId: "t-q2" }));
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
});
