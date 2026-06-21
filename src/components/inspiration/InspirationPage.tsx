import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { INSPIRATION_CATEGORIES, type InspirationsResponse } from "../../contracts/inspiration";
import { useInspirations } from "../../hooks/queries";
import { InspirationGallery } from "../InspirationGallery/InspirationGallery";
import { useShell } from "../shell/ShellContext";
import { TopBar } from "../shell/TopBar";
import styles from "./Inspiration.module.css";

// ⑤ 接真：灵感卡走 /api/inspirations（§6 建表前为服务端种子）。品类/搜索本地即时过滤（数据集小、体验更顺）。
export function InspirationPage({ initialInspirations }: { initialInspirations?: InspirationsResponse }) {
  const navigate = useNavigate();
  const shell = useShell();
  const [category, setCategory] = useState<string>("全部");
  const [query, setQuery] = useState("");

  const all = useInspirations("全部", "", initialInspirations).data?.items ?? [];

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((i) => category === "全部" || i.category === category)
      .filter(
        (i) =>
          !q ||
          i.title.toLowerCase().includes(q) ||
          (i.summary ?? "").toLowerCase().includes(q) ||
          i.prompt.toLowerCase().includes(q),
      );
  }, [all, category, query]);

  // 跨路由一键带回：跳主页并把提示词放进 location.state，ConversationView 读取后注入 Composer。
  const usePrompt = (prompt: string) => navigate("/", { state: { bringPrompt: prompt } });

  return (
    <>
      <TopBar title="灵感库" onOpenMenu={shell.openMenu} />
      <div className={styles.page}>
        <div className={styles.inner}>
          <h1 className={styles.title}>灵感库</h1>
          <p className={styles.sub}>站长维护、不支持用户上传 · 点「用此提示词」一键带回</p>

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
            {INSPIRATION_CATEGORIES.map((cat) => (
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
    </>
  );
}
