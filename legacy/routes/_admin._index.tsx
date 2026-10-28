import { AlertTriangle, Ruler } from "lucide-react";
import { formatCash, formatCredits, formatTimer } from "../../src/lib/format";
import styles from "../../src/components/admin/Admin.module.css";
import { requireAdminPage } from "../../src/server/page.server";
import { loadDashboard } from "../../src/server/admin/dashboard.server";
import type { Route } from "./+types/_admin._index";

// 后台数据看板（09 §10.7）——只读：注册/图量/成功失败/收入/积分发放消耗/账面负债/队列/平均时长/尺寸占比。
// 🔴 SUM 类口径（收入/积分/负债）从 loader 取 string，展示前 Number() 再 format（避免大额截断把钱算错）。
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminPage(request);
  const data = await loadDashboard();
  return { data };
}

type Tile = { num: string; label: string; sub?: string };

export default function Page({ loaderData }: Route.ComponentProps) {
  const d = loaderData.data;

  const conversion = d.totalUsers ? `${((d.paidUsers / d.totalUsers) * 100).toFixed(1)}%` : "—";

  const tiles: Tile[] = [
    { num: String(d.todayRegistrations), label: "今日注册" },
    { num: String(d.totalImages), label: "累计总图" },
    { num: String(d.todaySucceeded), label: "今日成功" },
    { num: String(d.todayFailed), label: "今日失败" },
    { num: `¥${formatCash(Number(d.todayRevenueCash))}`, label: "今日收入" },
    { num: `¥${formatCash(Number(d.totalRevenueCash))}`, label: "累计收入" },
    { num: formatCredits(Number(d.grantedMp)), label: "累计发放积分" },
    { num: formatCredits(Number(d.consumedMp)), label: "累计消耗" },
    { num: formatCredits(Number(d.liabilityMp)), label: "账面负债" },
    { num: String(d.queueQueued), label: "队列待处理" },
    { num: String(d.queueRunning), label: "运行中" },
    { num: formatTimer(d.avgDurationMs), label: "平均生图时长" },
    { num: String(d.totalUsers), label: "注册用户" },
    { num: String(d.paidUsers), label: "付费用户", sub: `付费转化率 ${conversion}` },
  ];

  return (
    <>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>数据看板</h1>
      </div>

      <div className={styles.statGrid}>
        {tiles.map((t) => (
          <div key={t.label} className={styles.statCard}>
            <div className={styles.statNum}>{t.num}</div>
            <div className={styles.statLabel}>{t.label}</div>
            {t.sub ? <div className={styles.statSub}>{t.sub}</div> : null}
          </div>
        ))}
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <AlertTriangle size={16} /> 今日失败原因
        </div>
        {d.failedTop.length === 0 ? (
          <div className={styles.empty}>今日暂无失败记录</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tr}>
                  <th className={styles.th}>错误码</th>
                  <th className={styles.th}>次数</th>
                </tr>
              </thead>
              <tbody>
                {d.failedTop.map((f) => (
                  <tr key={f.code} className={styles.tr}>
                    <td className={styles.td}>
                      <span className={`${styles.badge} ${styles.badgeDanger}`}>{f.code}</span>
                    </td>
                    <td className={`${styles.td} ${styles.mono}`}>{f.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <Ruler size={16} /> 成功图尺寸占比
        </div>
        {d.sizeBreakdown.length === 0 ? (
          <div className={styles.empty}>暂无成功生成记录</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tr}>
                  <th className={styles.th}>尺寸</th>
                  <th className={styles.th}>张数</th>
                </tr>
              </thead>
              <tbody>
                {d.sizeBreakdown.map((s) => (
                  <tr key={s.size} className={styles.tr}>
                    <td className={`${styles.td} ${styles.mono}`}>{s.size}</td>
                    <td className={`${styles.td} ${styles.mono}`}>{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}