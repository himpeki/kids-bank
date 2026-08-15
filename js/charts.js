// 残高推移グラフ。取引に埋め込んだ balanceAfter を使うので全履歴のリプレイは不要。
// Chart.js は各ページで CDN の UMD 版を読み込み、グローバル Chart を使う。

let chartInstance = null;

/**
 * @param canvas   描画先 canvas
 * @param txns     この子が関わる取引(createdAt 昇順)
 * @param memberId 対象の子
 * @param wallet   現在の残高 {yen, pt}
 */
export function drawBalanceChart(canvas, txns, memberId, wallet) {
  const labels = [];
  const yenData = [];
  const ptData = [];
  let yen = null;
  let pt = null;

  for (const t of txns) {
    const mine = t.fromMemberId === memberId ? t.balanceAfter?.from : t.balanceAfter?.to;
    if (mine == null) continue;
    if (t.currency === "yen") yen = mine;
    else pt = mine;
    const d = t.createdAt?.toDate?.() ?? new Date();
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    yenData.push(yen);
    ptData.push(pt);
  }
  // 現在値を最後に追加(取引が無くても1点は描く)
  labels.push("いま");
  yenData.push(wallet.yen);
  ptData.push(wallet.pt);

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "おこづかい(えん)",
          data: yenData,
          borderColor: "#4d96ff",
          backgroundColor: "rgba(77,150,255,0.12)",
          fill: true,
          tension: 0.25,
          spanGaps: true,
        },
        {
          label: "ポイント(pt)",
          data: ptData,
          borderColor: "#ff8fab",
          backgroundColor: "rgba(255,143,171,0.12)",
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
