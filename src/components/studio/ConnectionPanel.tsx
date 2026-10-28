import { useState } from "react";
import { ArrowLeft, Check, Eye, EyeOff, KeyRound, Link2, ShieldCheck, Trash2 } from "lucide-react";
import type { StudioConnection } from "../../lib/studio/connection";
import styles from "./Studio.module.css";

export function ConnectionPanel({ connection, onChange, onBack }: { connection: StudioConnection; onChange: (value: StudioConnection) => void; onBack: () => void }) {
  const [visible, setVisible] = useState(false);
  return <section className={styles.connectionPanel} aria-label="连接设置">
    <div className={styles.panelScroll}>
      <button type="button" className={styles.backButton} onClick={onBack}><ArrowLeft size={15} />返回创作</button>
      <div className={styles.panelHeading}><div><span className={styles.eyebrow}>YOUR CONNECTION</span><h1>连接设置</h1></div><Link2 size={22} className={styles.accentIcon} /></div>
      <p className={styles.panelDescription}>接入你自己的图片服务，使用 URL 与 API Key 开始创作。生成请求会经本站转发到你填写的服务地址。</p>
      <label className={styles.connectionField}><span>服务地址 URL</span><input type="url" value={connection.baseUrl} placeholder="https://api.tangguo.xin/v1" autoComplete="off" spellCheck={false} onChange={(event) => onChange({ ...connection, baseUrl: event.target.value })} /><small>OpenAI 兼容图片接口，支持 HTTPS 地址。</small></label>
      <label className={styles.connectionField}><span>API Key</span><div className={styles.keyInput}><input type={visible ? "text" : "password"} value={connection.apiKey} placeholder="输入你的 API Key" autoComplete="off" spellCheck={false} onChange={(event) => onChange({ ...connection, apiKey: event.target.value })} /><button type="button" className={styles.iconButton} aria-label={visible ? "隐藏 API Key" : "显示 API Key"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
      <label className={styles.rememberKey}><input type="checkbox" checked={connection.rememberKey} onChange={(event) => onChange({ ...connection, rememberKey: event.target.checked })} /><span>在此浏览器记住 API Key<small>仅在你信任的设备上开启。</small></span></label>
      <div className={styles.privacyNote}><ShieldCheck size={18} /><p>{connection.rememberKey ? "API Key 已按你的选择保存在此浏览器。取消勾选即可删除本机保存的 Key。" : "默认只在当前页面会话使用 Key，刷新后需要重新填写。"}<br />生成历史不会记录 API Key。</p></div>
      <button type="button" className={styles.clearKey} onClick={() => { onChange({ ...connection, apiKey: "", rememberKey: false }); setVisible(false); }} disabled={!connection.apiKey && !connection.rememberKey}><Trash2 size={15} />清除 API Key</button>
      <div className={styles.modelNote}><KeyRound size={16} /><div><strong>GPT Image 2</strong><span>费用及可用额度由你连接的服务决定。</span></div></div>
    </div>
    <div className={styles.composerFooter}><button type="button" className={styles.generateButton} onClick={onBack}><Check size={17} />完成，开始创作</button><p>连接设置的修改即时生效</p></div>
  </section>;
}
