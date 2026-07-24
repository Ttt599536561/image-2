import { ArrowRight, Coins, Image, Images, KeyRound, Sparkles, Wand2 } from "lucide-react";
import { Link } from "react-router";
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

const CAPABILITIES = [
  {
    icon: Image,
    title: "文生图",
    body: "用一句话描述你想象中的画面，即刻生成成品图。风格、构图、氛围，都由你的文字决定。",
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

export function LandingPage({ items }: { items: LandingItem[] }) {
  const heroItems = items.slice(0, 3);
  const galleryItems = items.slice(0, 12);

  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <span className={styles.brand}>
          <Sparkles size={18} aria-hidden />
          AI 图像工坊
        </span>
        <nav className={styles.navLinks}>
          <Link to="/login" className={styles.navLogin}>
            登录
          </Link>
          <Link to="/register" className={styles.navCta}>
            免费注册
          </Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>对话式 AI 生图</p>
        <h1 className={styles.heroTitle}>
          一句话描述
          <br />
          即刻生成你想要的画面
        </h1>
        <p className={styles.heroSub}>
          文生图、图生图、对话式二次编辑——像聊天一样创作图片。
          每一张作品都可下载、保存、随时回看。
        </p>
        <div className={styles.heroActions}>
          <Link to="/register" className={styles.primaryBtn}>
            免费开始创作
            <ArrowRight size={16} aria-hidden />
          </Link>
          <a href="#gallery" className={styles.ghostBtn}>
            先看看效果
          </a>
        </div>
        {heroItems.length > 0 ? (
          <div className={styles.heroStrip}>
            {heroItems.map((item) => (
              <img
                key={item.id}
                src={item.cover}
                alt={item.title}
                loading="eager"
                className={styles.heroImg}
              />
            ))}
          </div>
        ) : null}
      </section>

      {galleryItems.length > 0 ? (
        <section id="gallery" className={styles.section}>
          <h2 className={styles.sectionTitle}>站内用户的真实作品</h2>
          <p className={styles.sectionSub}>以下图片全部由本站用户用 AI 图像工坊生成</p>
          <div className={styles.gallery}>
            {galleryItems.map((item) => (
              <figure key={item.id} className={styles.card}>
                <img src={item.cover} alt={item.title} loading="lazy" className={styles.cardImg} />
                <figcaption className={styles.cardCaption}>
                  <span className={styles.cardTitle}>{item.title}</span>
                  {item.category ? (
                    <span className={styles.cardCategory}>{item.category}</span>
                  ) : null}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>三种方式，随心所欲地创作</h2>
        <div className={styles.capGrid}>
          {CAPABILITIES.map((cap) => (
            <div key={cap.title} className={styles.capCard}>
              <cap.icon size={22} aria-hidden className={styles.capIcon} />
              <h3 className={styles.capTitle}>{cap.title}</h3>
              <p className={styles.capBody}>{cap.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>三步，开出你的第一张图</h2>
        <div className={styles.stepGrid}>
          {STEPS.map((step) => (
            <div key={step.no} className={styles.stepCard}>
              <span className={styles.stepNo}>{step.no}</span>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepBody}>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.featureStrip}>
          <div className={styles.feature}>
            <KeyRound size={20} aria-hidden className={styles.capIcon} />
            <div>
              <h3 className={styles.featureTitle}>自带 Key · 本站零扣费</h3>
              <p className={styles.featureBody}>
                高级用户可以接入自己的 API Key，使用期间本站不扣任何积分，任务完成后凭据立即销毁。
              </p>
            </div>
          </div>
          <div className={styles.feature}>
            <Coins size={20} aria-hidden className={styles.capIcon} />
            <div>
              <h3 className={styles.featureTitle}>透明计费 · 随时可查</h3>
              <p className={styles.featureBody}>
                按张计费，只有生成成功才扣积分。余额、流水、批次明细在账单页一目了然。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.finalCta}>
        <h2 className={styles.finalTitle}>现在开始，免费创作你的第一张图</h2>
        <Link to="/register" className={styles.primaryBtn}>
          免费开始创作
          <ArrowRight size={16} aria-hidden />
        </Link>
      </section>

      <footer className={styles.footer}>© 2026 AI 图像工坊 · one-image2</footer>
    </div>
  );
}
