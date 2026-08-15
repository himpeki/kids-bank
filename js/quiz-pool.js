// 1日1問の算数チャレンジ。日付+メンバーIDから決定的に生成する
// (リロードしても同じ問題。答えはクライアントにあるが、報酬はルールが
//  「20時間に1回・固定pt」に制限しているのでチートしても実害なし)。

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

  if (level <= 2) {
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
  if (level === 3) {
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
  if (level === 4) {
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
  // level 5+: あまりのある わりざん(答えは「しょう」だけ)
  const b = int(3, 9);
  const ans = int(3, 12);
  const r = int(1, b - 1);
  return {
    question: `${b * ans + r} ÷ ${b} = ? あまり ${r}(?に入るかずをこたえてね)`,
    answer: ans,
  };
}
