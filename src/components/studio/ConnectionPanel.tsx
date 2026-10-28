import { useState } from "react";
import { ArrowLeft, Check, Copy, Eye, EyeOff, KeyRound, Link2, LockKeyhole, ShieldCheck, Trash2 } from "lucide-react";
import { DEFAULT_STUDIO_BASE_URL } from "../../contracts/studio";
import type { StudioConnection } from "../../lib/studio/connection";
import styles from "./Studio.module.css";

export function ConnectionPanel({ connection, onChange, onBack }: { connection: StudioConnection; onChange: (value: StudioConnection) => void; onBack: () => void }) {
  const [visible, setVisible] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const copyServiceUrl = async () => {
    try { await navigator.clipboard.writeText(DEFAULT_STUDIO_BASE_URL); setCopyStatus("服务地址已复制"); }
    catch { setCopyStatus("复制失败，请选中地址手动复制"); }
  };
  return <section className={styles.connectionPanel} aria-label="连接设置">
    <div className={styles.panelScroll}>
      <button type="button" className={styles.backButton} onClick={onBack}><ArrowLeft size={15} />返回创作</button>
      <div className={styles.panelHeading}><div><span className={styles.eyebrow}>YOUR CONNECTION</span><h1>连接设置</h1></div><Link2 size={22} className={styles.accentIcon} /></div>
      <p className={styles.panelDescription}>填写此服务的 API Key，即可开始创作。你的生成请求会通过本站安全转发。</p>
      <div className={styles.fixedService}><div><label htmlFor="studio-service-url">服务地址 URL</label><span><LockKeyhole size={11} />固定服务</span></div><div><input id="studio-service-url" readOnly value={DEFAULT_STUDIO_BASE_URL} spellCheck={false} /><button type="button" className={styles.iconButton} aria-label="复制服务地址" onClick={() => void copyServiceUrl()}><Copy size={15} /></button></div><small role="status">{copyStatus || "工作台统一使用此地址，无需修改。"}</small></div>
      <label className={styles.connectionField}><span>API Key</span><div className={styles.keyInput}><input type={visible ? "text" : "password"} value={connection.apiKey} placeholder="输入你的 API Key" autoComplete="off" spellCheck={false} onChange={(event) => onChange({ ...connection, apiKey: event.target.value })} /><button type="button" className={styles.iconButton} aria-label={visible ? "隐藏 API Key" : "显示 API Key"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
      <label className={styles.rememberKey}><input type="checkbox" checked={connection.rememberKey} onChange={(event) => onChange({ ...connection, rememberKey: event.target.checked })} /><span>在此浏览器记住 API Key<small>仅在你信任的设备上开启。</small></span></label>
      <div className={styles.privacyNote}><ShieldCheck size={18} /><p>{connection.rememberKey ? "API Key 已按你的选择保存在此浏览器。取消勾选即可删除本机保存的 Key。" : "默认只在当前页面会话使用 Key，刷新后需要重新填写。"}<br />生成历史不会记录 API Key。</p></div>
      <button type="button" className={styles.clearKey} onClick={() => { onChange({ ...connection, apiKey: "", rememberKey: false }); setVisible(false); }} disabled={!connection.apiKey && !connection.rememberKey}><Trash2 size={15} />清除 API Key</button>
      <div className={styles.modelNote}><KeyRound size={16} /><div><strong>使用你的服务额度</strong><span>可在创作面板选择模型，费用由图片服务决定。</span></div></div>
    </div>
    <div className={styles.composerFooter}><button type="button" className={styles.generateButton} onClick={onBack}><Check size={17} />完成，开始创作</button><p>连接设置的修改即时生效</p></div>
  </section>;
}
