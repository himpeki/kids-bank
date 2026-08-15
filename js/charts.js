// 残高推移グラフ。取引に埋め込んだ balanceAfter を使うので全履歴のリプレイは不要。
// 円とptはレートが違いすぎて1枚のグラフでは潰れるため、mode で片方ずつ表示する。
// Chart.js は各ページで CDN の UMD 版を読み込み、グローバル Chart を使う。

let chartInstance = null;

const STYLES = {
  yen: {
    label: "おこづかい(えん)",
    borderColor: "#4d96ff",
    backgroundColor: "rgba(77,150,255,0.12)",
  },
  pt: {
    label: "ポイント(pt)",
    borderColor: "#ff8fab",
    backgroundColor: "rgba(255,143,171,0.12)",
  },
};

/**
 * @param canvas   描画先 canvas
 * @param txns     この子が関わる取引(createdAt 昇順)
 * @param memberId 対象の子
 * @param wallet   現在の残高 {yen, pt}
 * @param mode     "yen" | "pt" 表示する通貨
 */
export function drawBalanceChart(canvas, txns, memberId, wallet, mode = "yen") {
  const labels = [];
  const data = [];

  for (const t of txns) {
    if (t.currency !== mode) continue;
    const mine = t.fromMemberId === memberId ? t.balanceAfter?.from : t.balanceAfter?.to;
    if (mine == null) continue;
    const d = t.createdAt?.toDate?.() ?? new Date();
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    data.push(mine);
  }
  // 現在値を最後に追加(取引が無くても1点は描く)
  labels.push("いま");
  data.push(wallet[mode] ?? 0);

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          ...STYLES[mode],
          data,
          fill: true,
          tension: 0.25,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { size: 14 } } } },
      scales: { y: { beginAtZero: true } },
    },
  });
}
