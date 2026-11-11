import { ArrowLeft, ArrowUpRight, Sparkles } from "lucide-react";
import { createPageMeta } from "../../src/lib/seo";
import { getSeoConfig } from "../../src/server/seo.server";
import styles from "../../src/styles/guide.module.css";
import type { Route } from "./+types/guide";

export function loader() { return { seo: getSeoConfig() }; }

export function meta({ loaderData, error }: Route.MetaArgs) {
  if (error || !loaderData) return [{ title: "使用指南 · AI 图像工坊" }, { name: "robots", content: "noindex, nofollow" }];
  return createPageMeta({
    origin: loaderData.seo.origin,
    path: "/guide",
    title: "AI 生图使用指南：文生图、图生图与 GIF · AI 图像工坊",
    description: "了解 AI 图像工坊的 API Key 设置、文生图和多参考图编辑流程，查看提示词示例、Image 2 系列模型、GIF 输出条件与本机历史保存说明。",
  });
}

const sections = [
  ["start", "开始使用"], ["text-to-image", "文生图与提示词"],
  ["image-to-image", "参考图与图生图"], ["models", "模型与 GIF"],
  ["history", "保存与历史"], ["questions", "常见问题"],
] as const;

export default function GuideRoute() {
  return <div className={styles.page}>
    <header className={styles.header}>
      <a href="/" className={styles.brand}><Sparkles size={22} aria-hidden /><span>AI 图像工坊</span></a>
      <a href="/" className={styles.back}><ArrowLeft size={16} aria-hidden />返回工作台</a>
    </header>
    <main className={styles.main}>
      <div className={styles.hero}>
        <p className={styles.eyebrow}>使用指南</p>
        <h1>从文字和参考图，<br />开始你的 AI 图片创作。</h1>
        <p className={styles.intro}>AI 图像工坊提供文生图、图生图和 GIF 输出选项。无需在本站注册或登录，填写自己的图片服务 API Key，即可在工作台设置画面、提交生成并下载作品。</p>
        <a href="/" className={styles.primaryLink}>打开创作工作台<ArrowUpRight size={18} aria-hidden /></a>
      </div>
      <div className={styles.layout}>
        <nav className={styles.toc} aria-label="使用指南目录">
          <p>本页内容</p>
          {sections.map(([id, label], index) => <a key={id} href={`#${id}`}><span>{String(index + 1).padStart(2, "0")}</span>{label}</a>)}
        </nav>
        <div className={styles.content}>
          <section id="start" aria-labelledby="start-title">
            <h2 id="start-title">开始使用</h2>
            <ol className={styles.steps}>
              <li><strong>配置 API Key。</strong>在工作台打开“连接设置”，填写适用于 <code>https://api.tangguo.xin/v1</code> 的 API Key。服务地址固定，不能替换为其他服务。</li>
              <li><strong>描述画面。</strong>返回“创作”，选择生成模型，在“画面描述”中写下主体、场景、光线与风格。</li>
              <li><strong>选择输出设置。</strong>根据用途选择画面比例、生成质量和图片背景。静态图片可从默认的 PNG 选项开始。</li>
              <li><strong>生成并下载。</strong>点击“开始生成”，在结果区查看任务状态；完成后检查图片并下载原文件。也可以用 Ctrl / ⌘ + Enter 提交。</li>
            </ol>
            <aside className={styles.note}>本站不提供套餐、积分或充值。生成通过你自己的 API Key 调用图片服务，可能产生服务商费用；可用模型、权限和计费以该 Key 对应的服务为准。</aside>
          </section>

          <section id="text-to-image" aria-labelledby="text-title">
            <h2 id="text-title">文生图：把想法写得具体</h2>
            <p>不添加参考图时，工作台按文字描述生成图片。提示词可以按“主体 + 场景 + 构图 + 光线 + 风格 + 细节要求”组织；需要画中文字时，明确写出原文、位置和排版。</p>
            <div className={styles.example}>
              <h3>产品图片示例</h3>
              <p>一只磨砂白色陶瓷咖啡杯，放在浅橡木桌面中央，背景为柔和的米色墙面。左侧窗户照入自然光，杯子右侧形成轻微阴影。近景产品摄影，构图简洁，杯身无文字，保留真实陶瓷质感。</p>
            </div>
            <div className={styles.example}>
              <h3>活动海报示例</h3>
              <p>设计一张竖版春日花市海报，奶油白背景，底部是一束橙色郁金香与绿色枝叶。顶部大字写“春日花市”，下方小字写“周末见”。留出清晰的文字空间，采用简洁的杂志排版与柔和插画风格。</p>
            </div>
            <p>结果需要调整时，使用“复用参数”修改描述后再次生成。每次生成都可能不同；文字、细节和尺寸请以实际结果为准。</p>
          </section>

          <section id="image-to-image" aria-labelledby="image-title">
            <h2 id="image-title">图生图：使用一张或多张参考图</h2>
            <p>在创作面板选择、拖入或粘贴参考图，再描述希望保留和修改的部分。一次最多添加 <strong>4 张参考图</strong>，每张不超过 <strong>4 MiB</strong>；图片按显示顺序提交，可逐张移除。</p>
            <div className={styles.example}>
              <h3>两张参考图的提示词示例</h3>
              <p>以第 1 张图中的杯子为主体，保留杯子的形状、把手与颜色；参考第 2 张图的背景色和柔和光线。将杯子放在画面中央的石质台面上，去掉其他物品，不增加文字。</p>
            </div>
            <p>编辑已有作品时，可点击结果区的“以图编辑”，将原图设为参考图并填写修改要求。图生图使用 PNG 输出设置；上传失败后请查看错误提示，确认文件和连接再手动重试。</p>
          </section>

          <section id="models" aria-labelledby="models-title">
            <h2 id="models-title">模型选择与 GIF 动图</h2>
            <p>工作台提供以下模型名称，默认选择 <code>gpt-image-2</code>。不同模型是否可调用，取决于图片服务及你的 API Key 权限。</p>
            <div className={styles.tableWrap}>
              <table>
                <caption>工作台模型与输出选项</caption>
                <thead><tr><th scope="col">模型</th><th scope="col">静态图片</th><th scope="col">GIF 选项</th></tr></thead>
                <tbody>
                  <tr><th scope="row"><code>gpt-image-2</code></th><td>文生图 / 图生图</td><td>不支持</td></tr>
                  <tr><th scope="row"><code>gpt-image-2.5-sunburst</code></th><td>文生图 / 图生图</td><td>不支持</td></tr>
                  <tr><th scope="row"><code>gpt-image-2.6</code></th><td>文生图 / 图生图</td><td>仅文生图</td></tr>
                  <tr><th scope="row"><code>gpt-image-2.6-flare</code></th><td>文生图 / 图生图</td><td>仅文生图</td></tr>
                </tbody>
              </table>
            </div>
            <p>请求动图时，选择两个 2.6 模型之一，并明确切换到“GIF 动图”。描述主体的动作和循环方式，不添加参考图，也不选择透明背景。GIF 可用性仍需图片服务与 Key 具备相应权限。</p>
            <p>如果请求 GIF 后服务实际返回 PNG、JPEG 或 WebP，工作台会保留原图、提示实际格式，并按真实文件类型下载。仅在提示词中写“动图”不会自动切换输出格式。</p>
          </section>

          <section id="history" aria-labelledby="history-title">
            <h2 id="history-title">保存作品与此设备历史</h2>
            <p>历史记录和已缓存图片保存在当前浏览器，最多 <strong>50 条 / 200 MiB</strong>，不跨设备同步。清理浏览器站点数据、更换浏览器或使用隐私浏览，都可能导致本机记录不可用；重要作品请及时下载留存。</p>
            <p>服务器生成图片临时保留 7 日，浏览器已缓存的副本独立保留。刷新页面后可恢复已送达服务的任务状态；尚未完成上传并送达服务的任务，需要重新选图提交。</p>
            <p>模型、尺寸、质量、背景和输出格式会保存在当前浏览器。API Key 默认只在当前页面会话使用，只有明确勾选“在此浏览器记住 API Key”才会在浏览器中保存；共用设备请勿勾选。</p>
          </section>

          <section id="questions" aria-labelledby="questions-title">
            <h2 id="questions-title">常见问题</h2>
            <h3>为什么提示连接失败或没有模型权限？</h3>
            <p>先确认 Key 属于固定的图片服务、输入完整且仍有效，再检查该 Key 的余额及所选模型权限。本站不会使用站长 Key 替代你的 Key。服务超时或临时不可用时，请根据错误提示处理。</p>
            <h3>可以上传图片做局部修改吗？</h3>
            <p>可以添加参考图，在提示词中明确需要改变的对象以及希望保持的区域。工作台提交整张参考图，修改范围和一致性以模型返回结果为准。</p>
            <h3>为什么在另一台设备看不到作品？</h3>
            <p>“此设备历史”保存在本机浏览器，没有普通用户账户或跨设备作品库。请通过下载的原文件保留、转移作品。</p>
            <h3>选择了 GIF，为什么下载的是 PNG？</h3>
            <p>输出选项表示向服务请求的格式，最终可能收到静态图片。工作台会明确显示实际返回格式，不会将 PNG 文件改后缀伪装成 GIF；下一次生成仍保留你选择的输出设置。</p>
          </section>
          <footer className={styles.footer}><p>准备好一个想法，就可以开始。</p><a href="/" className={styles.primaryLink}>返回工作台创作<ArrowUpRight size={18} aria-hidden /></a></footer>
        </div>
      </div>
    </main>
  </div>;
}
