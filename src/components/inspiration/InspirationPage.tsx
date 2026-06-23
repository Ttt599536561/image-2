import { Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { InspirationsResponse } from "../../contracts/inspiration";
import { useInspirations } from "../../hooks/queries";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { InspirationGallery } from "../InspirationGallery/InspirationGallery";
import { useShell } from "../shell/ShellContext";
import { TopBar } from "../shell/TopBar";
import { SubmitInspirationModal } from "./SubmitInspirationModal";
import styles from "./Inspiration.module.css";

// P3-S4：品类/搜索下沉为 SQL（useInspirations 服务端过滤 + 250ms debounce，与 S2 同范式）。
// 品类 Tab 从 DISTINCT category 动态出（来源稳定 SSR 首屏 categories，切 Tab/搜索不抖）。
export function InspirationPage({ initialInspirations }: { initialInspirations?: InspirationsResponse }) {
  const navigate = useNavigate();
  const shell = useShell();
  const [category, setCategory] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const [submitOpen, setSubmitOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 250);

  const insp = useInspirations(category, debouncedQuery, initialInspirations);
  const items = insp.data?.items ?? [];

  // Tab = "全部" + 动态品类。用 SSR 首屏 categories 作稳定来源（筛选返回的 categories 同样不随筛选变，二者择一回退）。
  const tabs = useMemo(
    () => ["全部", ...(initialInspirations?.categories ?? insp.data?.categories ?? [])],
    [initialInspirations, insp.data?.categories],
  );

  // 跨路由一键带回：跳主页并把提示词放进 location.state，ConversationView 读取后注入 Composer。
  const usePrompt = (prompt: string) => navigate("/", { state: { bringPrompt: prompt } });

  return (
    <>
      <TopBar title="灵感库" onOpenMenu={shell.openMenu} />
      <div className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.headRow}>
            <h1 className={styles.title}>灵感库</h1>
            <button type="button" className={styles.submitBtn} onClick={() => setSubmitOpen(true)}>
              <Upload size={15} />
              投稿
            </button>
          </div>

          <div className={styles.search}>
            <Search size={16} />
            <input
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、标签或提示词"
            />
          </div>

          <div className={styles.tabs}>
            {tabs.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`${styles.tab} ${category === cat ? styles.tabActive : ""}`}
                onClick={() => setCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {items.length === 0 ? (
            <div className={styles.empty}>没有匹配的灵感卡</div>
          ) : (
            <InspirationGallery items={items} onUsePrompt={usePrompt} />
          )}
        </div>
      </div>
      {submitOpen ? <SubmitInspirationModal onClose={() => setSubmitOpen(false)} /> : null}
    </>
  );
}
