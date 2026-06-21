import { Clock, Coins, ExternalLink, Ticket } from "lucide-react";
import { useState } from "react";
import { formatCash, formatCredits, formatMonthDay, formatValidDays } from "../../lib/format";
import { MOCK_PACKAGES } from "../../mocks/data";
import { useMock } from "../../mocks/store";
import { useShell } from "../shell/ShellContext";
import { TopBar } from "../shell/TopBar";
import { useToast } from "../Toast/ToastProvider";
import styles from "./Billing.module.css";

const REDEEM_RE = /^[A-HJKMNP-Z2-9]{18}$/;
const REDEEM_ERRORS: Record<string, string> = {
  CODE_NOT_FOUND: "兑换码无效",
  CODE_USED: "该兑换码已被使用",
  CODE_DISABLED: "兑换码已失效",
};

export function BillingPage() {
  const mock = useMock();
  const toast = useToast();
  const shell = useShell();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(
    MOCK_PACKAGES.find((p) => p.recommended)?.id ?? MOCK_PACKAGES[0].id,
  );

  const expMp = Number(mock.expiringSoon.mp || "0");

  const buy = (pkg: (typeof MOCK_PACKAGES)[number]) => {
    setSelectedId(pkg.id);
    if (pkg.redirectUrl && pkg.redirectUrl !== "#") {
      window.open(pkg.redirectUrl, "_blank", "noopener");
    } else {
      toast.info("购买将跳转第三方店铺（链接待站长配置）");
    }
  };

  const onRedeem = () => {
    setError(null);
    const value = code.trim().toUpperCase();
    if (!REDEEM_RE.test(value)) {
      setError("兑换码无效");
      return;
    }
    const result = mock.redeem(value);
    if (result.ok) {
      toast.success("积分到账");
      setCode("");
    } else {
      setError(REDEEM_ERRORS[result.code] ?? "兑换码无效");
    }
  };

  return (
    <>
      <TopBar title="充值" onOpenMenu={shell.openMenu} />
      <div className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.balanceCard}>
            <div>
              <div className={styles.balanceNum}>{formatCredits(mock.balanceMp)}</div>
              <div className={styles.balanceLabel}>当前积分余额 · 1 积分 = ¥1 · 0.07 积分/张</div>
            </div>
            {expMp > 0 && mock.expiringSoon.nearestExpiresAt ? (
              <span className={styles.expiring}>
                <Clock size={13} />
                {formatCredits(expMp)} 积分将于 {formatMonthDay(mock.expiringSoon.nearestExpiresAt)} 过期
              </span>
            ) : null}
          </div>

          <div>
            <h2 className={styles.sectionTitle}>选择套餐</h2>
            <div className={styles.grid} style={{ marginTop: "var(--space-4)" }}>
              {MOCK_PACKAGES.map((p) => (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedId === p.id}
                  className={`${styles.pkg} ${selectedId === p.id ? styles.pkgSelected : ""}`}
                  onClick={() => setSelectedId(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(p.id);
                    }
                  }}
                >
                  {p.recommended ? <span className={styles.badge}>更划算</span> : null}
                  <span className={styles.pkgTitle}>{p.title}</span>
                  <span className={styles.pkgPrice}>¥{formatCash(p.priceCash)}</span>
                  <span className={styles.pkgCredits}>
                    <Coins size={12} /> {formatCredits(p.creditsMp)} 积分
                  </span>
                  <p className={styles.pkgDesc}>{p.description}</p>
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
                }}
                onBlur={() => {
                  const v = code.trim().toUpperCase();
                  if (v && !REDEEM_RE.test(v)) setError("兑换码无效");
                }}
                placeholder="输入 18 位兑换码"
                maxLength={18}
                onKeyDown={(e) => e.key === "Enter" && onRedeem()}
              />
              <button type="button" className={styles.redeemBtn} onClick={onRedeem}>
                兑换
              </button>
            </div>
            {error ? <p className={styles.redeemError}>{error}</p> : null}
            <p className={styles.redeemHint}>
              演示码：AAAAAAAAAAAAAAAAAA（成功 +10）· BBBBBBBBBBBBBBBBBB（已使用）· CCCCCCCCCCCCCCCCCC（已失效）
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
