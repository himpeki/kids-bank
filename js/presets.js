// ギフト券・お手伝いクエストのプリセット。
// 券は親がいつでも「たんじょうびセット」として子に一括発行できる。

export const TICKET_PRESETS = [
  { emoji: "🚗", title: "おでかけけん", desc: "すきなところへ かぞくで 1かい おでかけできるよ" },
  { emoji: "🍛", title: "ばんごはんリクエストけん", desc: "ばんごはんのメニューを 1かい えらべるよ" },
  { emoji: "🌙", title: "よふかしけん", desc: "30ぷん おそくまで おきていられるよ" },
  { emoji: "🍭", title: "おやつえらびほうだいけん", desc: "300えんまで すきなおやつを えらべるよ" },
  { emoji: "🤗", title: "ひとりじめけん", desc: "パパかママを 30ぷん ひとりじめできるよ" },
  { emoji: "🎬", title: "おうちえいがかんけん", desc: "みんなでみる えいがを えらべるよ" },
];

export const QUEST_PRESETS = [
  { emoji: "🍽️", title: "しょっきあらい", points: 10 },
  { emoji: "🛁", title: "おふろそうじ", points: 30 },
  { emoji: "🧺", title: "せんたくものたたみ", points: 20 },
  { emoji: "🗑️", title: "ごみすて", points: 10 },
  { emoji: "🧹", title: "そうじきがけ", points: 30 },
  { emoji: "🌱", title: "みずやり", points: 5 },
];

// ポイントの使い道(ごほうびショップ)。子はポイントを消費して券と交換できる
export const REWARD_PRESETS = [
  { emoji: "🎲", title: "かぞくでボードゲームけん", costPt: 50 },
  { emoji: "🍨", title: "アイスけん", costPt: 60 },
  { emoji: "📺", title: "どうが30ぷんけん", costPt: 80 },
  { emoji: "🎮", title: "ゲーム30ぷんけん", costPt: 100 },
  { emoji: "🌙", title: "よふかし15ふんけん", costPt: 120 },
];

export const ROLE_LABELS = { parent: "おうちの人", giver: "おくる人(サポーター)", child: "こども" };
