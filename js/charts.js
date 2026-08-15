// 残高推移グラフ。取引に埋め込んだ balanceAfter を使うので全履歴のリプレイは不要。
// 円とptはレートが違いすぎて1枚のグラフでは潰れるため、mode で片方ずつ表示する。
// 線の色はテーマのCSS変数(--chart-yen / --chart-pt)を優先し、軸の文字色は
// 現在の文字色に追従する(ダークテーマ対応)。
// Chart.js は各ページで CDN の UMD 版を読み込み、グローバル Chart を使う。

let chartInstance = null;

function themeVar(name, fallback) {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * @param canvas    描画先 canvas
 * @param txns      この子が関わる取引(createdAt 昇順)
 * @param memberId  対象の子
 * @param wallet    現在の残高 {yen, pt}
 * @param mode      "yen" | "pt" 表示する通貨
 * @param appendNow 末尾に現在残高の点「いま」を足すか(今月表示のときだけ true)
 */
export function drawBalanceChart(canvas, txns, memberId, wallet, mode = "yen", appendNow = true) {
  const styles = {
    yen: { label: "おこづかい(えん)", color: themeVar("--chart-yen", "#4d96ff") },
    pt: { label: "ポイント(pt)", color: themeVar("--chart-pt", "#ff8fab") },
  };
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
  // 今月表示のときは現在値を最後に追加(取引が無くても1点は描く)
  if (appendNow) {
    labels.push("いま");
    data.push(wallet[mode] ?? 0);
  }

  const s = styles[mode];
  const textColor = getComputedStyle(canvas).color || "#3d3a4b";
  const gridColor = "rgba(128, 128, 128, 0.22)";

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: s.label,
          data,
          borderColor: s.color,
          backgroundColor: `${s.color}22`,
          fill: true,
          tension: 0.25,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { size: 14 }, color: textColor } } },
      scales: {
        y: { beginAtZero: true, ticks: { color: textColor }, grid: { color: gridColor } },
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
      },
    },
  });
}
