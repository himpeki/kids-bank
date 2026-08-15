// Firestore アクセスの集約層。パス構築とよく使う関数の再エクスポートをここに集める。
// 各ページは gstatic を直接 import せず、このモジュール経由で Firestore を触る。
export { db } from "./firebase-init.js";
export {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  runTransaction,
  serverTimestamp,
  arrayUnion,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import { db } from "./firebase-init.js";
import {
  doc,
  collection,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

let familyId = null;
export function setFamilyId(id) {
  familyId = id;
}
export function getFamilyId() {
  if (!familyId) throw new Error("familyId が未設定です(先に resolveIdentity を呼ぶ)");
  return familyId;
}

export const famRef = () => doc(db, "families", getFamilyId());
export const famCol = (name) => collection(db, "families", getFamilyId(), name);
export const famDoc = (name, id) => doc(db, "families", getFamilyId(), name, id);
export const walletRef = (memberId) => famDoc("wallets", memberId);
export const settingsRef = () => famDoc("settings", "config");
export const uidRef = (uid) => doc(db, "uids", uid);

/** 推測不能なランダムID(famId・招待トークン用)。32文字アルファベットで偏りなし */
export function newId(len = 20) {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789"; // 紛らわしい l,o,0,1 を除いた32字
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** ドキュメント用の短いID */
export function shortId() {
  return newId(10);
}
