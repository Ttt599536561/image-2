import {
  ArrowRight,
  Coins,
  Image,
  Images,
  KeyRound,
  Moon,
  MoveRight,
  Sparkles,
  Sun,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useThemeMode } from "../../lib/theme";
import { Reveal } from "./Reveal";
import styles from "./Landing.module.css";

export interface LandingItem {
  id: string;
  cover: string;
  title: string;
  summary: string | null;
  prompt: string;
  category: string | null;
  width: number | null;
  height: number | null;
  submitter: string | null;
}

/** 按视口宽度决定画廊列数（SSR 先按 5 列渲染，挂载后按实际宽度校正）。 */
function useGalleryColumns(): number {
  const [cols, setCols] = useState(5);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      setCols(w < 640 ? 2 : w < 1024 ? 3 : w < 1440 ? 4 : 5);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  return cols;
}

/**
 * 瀑布流分列：按封面宽高比（高/宽）降序后，逐张放进当前最矮的列（LPT 装箱）。
 * 先放高图再放矮图，矮图负责补齐列尾差，避免单列底部空出一大块。
 * 注意：会按高度重排作品顺序，仅用于画廊视觉排布。
 */
function distributeToColumns(items: LandingItem[], colCount: number): LandingItem[][] {
  const aspectOf = (item: LandingItem) =>
    item.width && item.height ? item.height / item.width : 1.25;
  const sorted = [...items].sort((a, b) => aspectOf(b) - aspectOf(a));
  const columns: LandingItem[][] = Array.from({ length: colCount }, () => []);
  const heights = new Array<number>(colCount).fill(0);
  for (const item of sorted) {
    const target = heights.indexOf(Math.min(...heights));
    columns[target].push(item);
    heights[target] += aspectOf(item);
  }
  return columns;
}

const CAPABILITIES = [
  {
    icon: Image,
    title: "文生图",
    body: "用一句话描述你想象中的画面，image-2 即刻为你生成成品图。风格、构图、氛围，都由你的文字决定。",
  },
  {
    icon: Images,
    title: "图生图",
    body: "上传一张参考图，在它的基础上重新创作。改风格、换元素、做变体，原图灵感不浪费。",
  },
  {
    icon: Wand2,
    title: "对话式二次编辑",
    body: "对生成结果直接说「把背景换成海边」「文字改成金色」，像聊天一样反复打磨同一张图。",
  },
];

const STEPS = [
  { no: "01", title: "注册账号", body: "邮箱即可注册，登录后立刻开始创作。" },
  { no: "02", title: "描述画面", body: "输入文字描述，也可以上传参考图辅助表达。" },
  { no: "03", title: "下载与保存", body: "生成的图片自动存入你的资产库，随时查看、下载。" },
];

const DEMO_PROMPTS = [
  "一座雪山上的小屋",
  "赛博朋克风格的猫",
  "黄昏海边的电影感海报",
  "水墨风格的产品摄影",
];

/** 提示词打字机：循环输入/删除示例提示词，暗示"说话就能出图"。 */
function PromptTyper() {
  const [text, setText] = useState(DEMO_PROMPTS[0]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let promptIndex = 0;
    let charIndex = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const current = DEMO_PROMPTS[promptIndex];
      if (!deleting) {
        charIndex += 1;
        setText(current.slice(0, charIndex));
        if (charIndex >= current.length) {
          deleting = true;
          timer = setTimeout(tick, 1600);
          return;
        }
        timer = setTimeout(tick, 90);
      } else {
        charIndex -= 1;
        setText(current.slice(0, charIndex));
        if (charIndex <= 0) {
          deleting = false;
          promptIndex = (promptIndex + 1) % DEMO_PROMPTS.length;
          timer = setTimeout(tick, 400);
          return;
        }
        timer = setTimeout(tick, 40);
      }
    };
    charIndex = DEMO_PROMPTS[0].length;
    deleting = true;
    timer = setTimeout(tick, 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <p className={styles.typer} aria-label={`示例提示词：${text}`}>
      <span className={styles.typerLabel}>试试这样说</span>
      <span className={styles.typerText}>
        {text}
        <span className={styles.caret} aria-hidden />
      </span>
    </p>
  );
}

/** 主题切换按钮（复用全站 cookie 机制）。 */
function ThemeToggle() {
  const { theme, toggle } = useThemeMode();
  const next = theme === "light" ? "深色" : "浅色";
  return (
    <button
      type="button"
      onClick={toggle}
      className={styles.themeToggle}
      aria-label={`切换为${next}模式`}
      title={`切换为${next}模式`}
    >
      {theme === "light" ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
    </button>
  );
}

export function LandingPage({ items }: { items: LandingItem[] }) {
  const heroItems = items.slice(0, 3);
  const demoItems = items.slice(0, 2);
  const galleryColCount = useGalleryColumns();
  const galleryColumns = useMemo(
    () => distributeToColumns(items.slice(0, 14), galleryColCount),
    [items, galleryColCount],
  );
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={styles.page}>
      <header className={`${styles.nav} ${scrolled ? styles.navScrolled : ""}`}>
        <span className={styles.brand}>
          <Sparkles size={18} aria-hidden />
          one-image2
        </span>
        <nav className={styles.navLinks}>
          <ThemeToggle />
          <Link to="/login" className={styles.navLogin}>
            登录
          </Link>
          <Link to="/register" className={styles.navCta}>
            免费注册
          </Link>
        </nav>
      </header>

      {/* ① Hero：左文案右叠层画卡 */}
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <Reveal>
            <p className={styles.eyebrow}>由 image-2 模型驱动</p>
            <h1 className={styles.heroTitle}>
              一句话描述
              <br />
              即刻生成你想要的画面
            </h1>
            <p className={styles.heroSub}>
              文生图、图生图、对话式二次编辑——像聊天一样创作图片。
              每一张作品都可下载、保存、随时回看。
            </p>
            <PromptTyper />
            <div className={styles.heroActions}>
              <Link to="/register" className={styles.primaryBtn}>
                免费开始创作
                <ArrowRight size={16} aria-hidden className={styles.btnArrow} />
              </Link>
              <a href="#magic" className={styles.ghostBtn}>
                先看看效果
              </a>
            </div>
          </Reveal>
        </div>
        {heroItems.length > 0 ? (
          <div className={styles.heroVisual}>
            <div className={styles.glow} aria-hidden />
            {heroItems.map((item, i) => (
              <img
                key={item.id}
                src={item.cover}
                alt={item.title}
                loading="eager"
                className={`${styles.heroCard} ${styles[`heroCard${i}`]}`}
              />
            ))}
          </div>
        ) : null}
      </section>

      {/* ② 魔法演示：对话式创作过程 */}
      {demoItems.length >= 2 ? (
        <section id="magic" className={styles.section}>
          <Reveal>
            <h2 className={styles.sectionTitle}>看见魔法发生</h2>
            <p className={styles.sectionSub}>说一句话就出一图；不满意？接着说，接着改</p>
          </Reveal>
          <Reveal delay={120}>
            <div className={styles.magicCard}>
              <div className={styles.magicRow}>
                <div className={styles.bubble}>黄昏时分的山脉，电影感，宽画幅</div>
                <MoveRight size={20} aria-hidden className={styles.magicArrow} />
                <figure className={styles.magicFig}>
                  <img src={demoItems[0].cover} alt={demoItems[0].title} loading="lazy" />
                  <figcaption>image-2 生成</figcaption>
                </figure>
              </div>
              <div className={styles.magicRow}>
                <div className={styles.bubble}>
                  <span className={styles.bubbleEdit}>二次编辑</span>
                  把色调改得更冷一些
                </div>
                <MoveRight size={20} aria-hidden className={styles.magicArrow} />
                <figure className={styles.magicFig}>
                  <img src={demoItems[1].cover} alt={demoItems[1].title} loading="lazy" />
                  <figcaption>对话式修改后</figcaption>
                </figure>
              </div>
            </div>
          </Reveal>
        </section>
      ) : null}

      {/* ③ 画廊：紧密照片墙，图片铺满卡片，标题与提示词 hover 浮现 */}
      {galleryColumns.some((col) => col.length > 0) ? (
        <section className={`${styles.section} ${styles.sectionWide}`}>
          <Reveal>
            <h2 className={styles.sectionTitle}>站内用户的真实作品</h2>
            <p className={styles.sectionSub}>
              全部由 image-2 生成 · 把鼠标放到作品上，看看他们是怎么"说"的
            </p>
          </Reveal>
          <div className={styles.gallery}>
            {galleryColumns.map((col, ci) => (
              <div key={ci} className={styles.galleryCol}>
                {col.map((item, i) => (
                  <Reveal key={item.id} delay={(i % 4) * 80} className={styles.cardReveal}>
                    <figure className={styles.card}>
                      <div className={styles.cardImgWrap}>
                        <img
                          src={item.cover}
                          alt={item.title}
                          loading="lazy"
                          className={styles.cardImg}
                        />
                        <div className={styles.cardOverlay}>
                          <div className={styles.cardOverlayHead}>
                            <span className={styles.cardTitle}>{item.title}</span>
                            {item.category ? (
                              <span className={styles.cardCategory}>{item.category}</span>
                            ) : null}
                          </div>
                          <span className={styles.cardPrompt}>{item.prompt}</span>
                        </div>
                      </div>
                    </figure>
                  </Reveal>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ④ 三大能力 */}
      <section className={styles.section}>
        <Reveal>
          <h2 className={styles.sectionTitle}>三种方式，随心所欲地创作</h2>
        </Reveal>
        <div className={styles.capGrid}>
          {CAPABILITIES.map((cap, i) => (
            <Reveal key={cap.title} delay={i * 100}>
              <div className={styles.capCard}>
                <cap.icon size={22} aria-hidden className={styles.capIcon} />
                <h3 className={styles.capTitle}>{cap.title}</h3>
                <p className={styles.capBody}>{cap.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ⑤ 三步上手 */}
      <section className={styles.section}>
        <Reveal>
          <h2 className={styles.sectionTitle}>三步，开出你的第一张图</h2>
        </Reveal>
        <div className={styles.stepGrid}>
          {STEPS.map((step, i) => (
            <Reveal key={step.no} delay={i * 100}>
              <div className={styles.stepCard}>
                <span className={styles.stepNo}>{step.no}</span>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepBody}>{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ⑥ 特色条 */}
      <section className={styles.section}>
        <div className={styles.featureStrip}>
          <Reveal>
            <div className={styles.feature}>
              <KeyRound size={20} aria-hidden className={styles.capIcon} />
              <div>
                <h3 className={styles.featureTitle}>自带 Key · 本站零扣费</h3>
                <p className={styles.featureBody}>
                  高级用户可以接入自己的 API Key，使用期间本站不扣任何积分，
                  任务完成后凭据立即销毁。
                </p>
              </div>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className={styles.feature}>
              <Coins size={20} aria-hidden className={styles.capIcon} />
              <div>
                <h3 className={styles.featureTitle}>透明计费 · 随时可查</h3>
                <p className={styles.featureBody}>
                  按张计费，只有生成成功才扣积分。余额、流水、批次明细在账单页一目了然。
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ⑦ 收口 CTA */}
      <section className={styles.finalCta}>
        <Reveal>
          <h2 className={styles.finalTitle}>现在开始，免费创作你的第一张图</h2>
          <Link to="/register" className={styles.primaryBtn}>
            免费开始创作
            <ArrowRight size={16} aria-hidden className={styles.btnArrow} />
          </Link>
        </Reveal>
      </section>

      <footer className={styles.footer}>© 2026 one-image2 · 由 image-2 模型驱动</footer>
    </div>
  );
}
