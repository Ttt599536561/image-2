import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Coins, ExternalLink, Ticket } from "lucide-react";
import { useMemo, useState } from "react";
import { RedeemResponse, REDEEM_CODE_RE } from "../../contracts/redeem";
import type { PackageItem, PackagesResponse } from "../../contracts/package";
import { useMe, usePackages } from "../../hooks/queries";
import { ApiError, apiPost } from "../../lib/api-client";
import { formatCash, formatCredits, formatMonthDay, formatValidDays } from "../../lib/format";
import { useShell } from "../shell/ShellContext";
import { TopBar } from "../shell/TopBar";
import { useToast } from "../Toast/ToastProvider";
import styles from "./Billing.module.css";

// 推荐档 = 性价比最高（creditsMp/priceCash 比值最大）；DB packages 无 recommended 列，按值派生（确定性）。
function bestValueId(items: PackageItem[]): string | null {
  let best: PackageItem | null = null;
  let bestRatio = -1;
  for (const p of items) {
    const ratio = p.priceCash > 0 ? p.creditsMp / p.priceCash : 0;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = p;
    }
  }
  return best?.id ?? null;
}

export function BillingPage({ initialPackages }: { initialPackages?: PackagesResponse }) {
  const me = useMe();
  const toast = useToast();
  const shell = useShell();
  const qc = useQueryClient();
  const packages = usePackages(initialPackages).data?.items ?? [];
  const recommendedId = useMemo(() => bestValueId(packages), [packages]);

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [redeemOk, setRedeemOk] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ?? recommendedId ?? packages[0]?.id ?? null;

  const balanceMp = me.data?.balanceMp ?? 0;
  const expiringSoon = me.data?.expiringSoon;
  const expMp = Number(expiringSoon?.mp || "0");

  const redeemMutation = useMutation({
    mutationFn: (value: string) => apiPost("/api/redeem", { code: value }, RedeemResponse),
    onSuccess: (res) => {
      setRedeemOk(`兑换成功，到账 ${formatCredits(res.creditsValueMp)} 积分`);
      setCode("");
      qc.invalidateQueries({ queryKey: ["me", "balance"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "兑换失败，请重试"),
  });

  const buy = (pkg: PackageItem) => {
    setSelectedId(pkg.id);
    if (pkg.redirectUrl && pkg.redirectUrl !== "#") {
      window.open(pkg.redirectUrl, "_blank", "noopener");
    } else {
      toast.info("购买将跳转第三方店铺（链接待站长配置）");
    }
  };

  const onRedeem = () => {
    setError(null);
    setRedeemOk(null);
    const value = code.trim().toUpperCase();
    if (!REDEEM_CODE_RE.test(value)) {
      setError("兑换码无效");
      return;
    }
    if (!redeemMutation.isPending) redeemMutation.mutate(value);
  };

  return (
    <>
      <TopBar title="充值" onOpenMenu={shell.openMenu} />
      <div className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.balanceCard}>
            <div>
              <div className={styles.balanceNum}>{formatCredits(balanceMp)}</div>
              <div className={styles.balanceLabel}>当前积分余额 · 1 积分 = ¥1 · 0.07 积分/张</div>
            </div>
            {expMp > 0 && expiringSoon?.nearestExpiresAt ? (
              <span className={styles.expiring}>
                <Clock size={13} />
                {formatCredits(expMp)} 积分将于 {formatMonthDay(expiringSoon.nearestExpiresAt)} 过期
              </span>
            ) : null}
          </div>

          <div>
            <h2 className={styles.sectionTitle}>选择套餐</h2>
            <div className={styles.grid} style={{ marginTop: "var(--space-4)" }}>
              {packages.map((p) => (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected === p.id}
                  className={`${styles.pkg} ${selected === p.id ? styles.pkgSelected : ""}`}
                  onClick={() => setSelectedId(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(p.id);
                    }
                  }}
                >
                  {p.id === recommendedId ? <span className={styles.badge}>更划算</span> : null}
                  <span className={styles.pkgTitle}>{p.title}</span>
                  <span className={styles.pkgPrice}>¥{formatCash(p.priceCash)}</span>
                  <span className={styles.pkgCredits}>
                    <Coins size={12} /> {formatCredits(p.creditsMp)} 积分
                  </span>
                  <p className={styles.pkgDesc}>{p.description ?? ""}</p>
                  <span className={styles.pkgValid}>{formatValidDays(p.validDays)}</span>
                  <button
                    type="button"
                    className={styles.buyBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      buy(p);
                    }}
                  >
                    去购买
                    <ExternalLink size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.redeemCard}>
            <h2 className={styles.sectionTitle}>
              <Ticket size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              兑换码充值
            </h2>
            <div className={styles.redeemRow}>
              <input
                className={styles.redeemInput}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  if (error) setError(null);
                  if (redeemOk) setRedeemOk(null);
                }}
                onBlur={() => {
                  const v = code.trim().toUpperCase();
                  if (v && !REDEEM_CODE_RE.test(v)) setError("兑换码无效");
                }}
                placeholder="输入 18 位兑换码"
                maxLength={18}
                onKeyDown={(e) => e.key === "Enter" && onRedeem()}
              />
              <button
                type="button"
                className={styles.redeemBtn}
                onClick={onRedeem}
                disabled={redeemMutation.isPending}
              >
                兑换
              </button>
            </div>
            {error ? <p className={styles.redeemError}>{error}</p> : null}
            {redeemOk ? <p className={styles.redeemOk}>{redeemOk}</p> : null}
          </div>
        </div>
      </div>
    </>
  );
}
