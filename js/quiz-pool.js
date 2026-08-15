// 1日1問の算数チャレンジ。日付+メンバーIDから決定的に生成する
// (リロードしても同じ問題。答えはクライアントにあるが、報酬はルールが
//  「20時間に1回・固定pt」に制限しているのでチートしても実害なし)。
//
// レベル定義(親の設定画面から Lv1〜6 で調整):
//   Lv1: 1けたの たしざん・ひきざん(こたえは10まで)
//   Lv2: 2けたの たしざん・ひきざん
//   Lv3: 九九、3けたの たしざん
//   Lv4: 2けた×1けた、かんたんな わりざん
//   Lv5: あまりのある わりざん
//   Lv6: 2けた×2けた、3けたの わりざん

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** level(メンバーのレベル)に応じた今日の問題 {question, answer} を返す */
export function todaysQuiz(memberId, level = 1) {
  const today = new Date();
  const key = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}-${memberId}`;
  const rnd = mulberry32(hashStr(key));
  const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
  const lv = Math.max(1, Math.min(6, level));

  if (lv === 1) {
    // 1けたの たしざん・ひきざん(こたえは0〜10)
    if (rnd() < 0.5) {
      const a = int(1, 9);
      const b = int(1, 10 - a);
      return { question: `${a} + ${b} = ?`, answer: a + b };
    }
    const a = int(2, 9);
    const b = int(1, a - 1);
    return { question: `${a} − ${b} = ?`, answer: a - b };
  }
  if (lv === 2) {
    // 2けたの たしざん・ひきざん
    if (rnd() < 0.5) {
      const a = int(11, 89);
      const b = int(11, 99 - a);
      return { question: `${a} + ${b} = ?`, answer: a + b };
    }
    const a = int(30, 99);
    const b = int(11, a - 10);
    return { question: `${a} − ${b} = ?`, answer: a - b };
  }
  if (lv === 3) {
    // 九九 と 3けたの たしざん
    if (rnd() < 0.5) {
      const a = int(2, 9);
      const b = int(2, 9);
      return { question: `${a} × ${b} = ?`, answer: a * b };
    }
    const a = int(110, 640);
    const b = int(110, 999 - a);
    return { question: `${a} + ${b} = ?`, answer: a + b };
  }
  if (lv === 4) {
    // 2けた×1けた と かんたんな わりざん(ちょっと せのび!)
    if (rnd() < 0.5) {
      const a = int(12, 49);
      const b = int(2, 9);
      return { question: `${a} × ${b} = ?`, answer: a * b };
    }
    const b = int(2, 9);
    const ans = int(2, 9);
    return { question: `${b * ans} ÷ ${b} = ?`, answer: ans };
  }
  if (lv === 5) {
    // あまりのある わりざん(答えは「しょう」だけ)
    const b = int(3, 9);
    const ans = int(3, 12);
    const r = int(1, b - 1);
    return {
      question: `${b * ans + r} ÷ ${b} = ? あまり ${r}(?に入るかずをこたえてね)`,
      answer: ans,
    };
  }
  // Lv6: 2けた×2けた と 3けたの わりざん(わりきれる)
  if (rnd() < 0.5) {
    const a = int(12, 39);
    const b = int(11, 29);
    return { question: `${a} × ${b} = ?`, answer: a * b };
  }
  const b = int(3, 9);
  const ans = int(Math.ceil(100 / b), Math.floor(999 / b));
  return { question: `${b * ans} ÷ ${b} = ?`, answer: ans };
}
