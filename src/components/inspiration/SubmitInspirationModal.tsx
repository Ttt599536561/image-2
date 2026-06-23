import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import type { ImageItem } from "../../contracts/image";
import { INSPIRATION_CATEGORIES } from "../../contracts/inspiration";
import { InspirationSubmitResponse, type MySubmissionItem } from "../../contracts/inspirationSubmission";
import { useAssets, useMySubmissions } from "../../hooks/queries";
import { ApiError, apiPost } from "../../lib/api-client";
import { useToast } from "../Toast/ToastProvider";
import styles from "./SubmitInspirationModal.module.css";

// §13.1：从「我的作品」选一张图投稿到灵感库（填标题/提示词/分类/简介）→ 后台审核。含「我的投稿」状态查看。
const CATEGORIES = INSPIRATION_CATEGORIES.filter((c) => c !== "全部");

function statusLabel(s: MySubmissionItem["status"]): { text: string; cls: string } {
  if (s === "approved") return { text: "已通过", cls: styles.stApproved };
  if (s === "rejected") return { text: "已驳回", cls: styles.stRejected };
  return { text: "待审核", cls: styles.stPending };
}

export function SubmitInspirationModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<"submit" | "mine">("submit");

  // 投稿选图取较大页（契约上限 200），避免重度用户老作品（默认仅最近 50 张）选不到。
  const assets = useAssets({ range: "all", pageSize: 200 });
  const myImages = assets.data?.items ?? [];

  const [picked, setPicked] = useState<ImageItem | null>(null);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("");
  const [summary, setSummary] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // 「我的投稿」仅在切到该 Tab 时才拉，避免无谓请求。
  const mine = useMySubmissions(tab === "mine");

  function reset() {
    setPicked(null);
    setTitle("");
    setPrompt("");
    setCategory("");
    setSummary("");
    setErr(null);
  }

  function pick(img: ImageItem) {
    setPicked(img);
    setPrompt(img.prompt); // 预填原图提示词，可改
    setErr(null);
  }

  const submit = useMutation({
    mutationFn: () =>
      apiPost(
        "/api/inspiration-submissions",
        {
          imageId: picked?.id,
          title: title.trim(),
          prompt: prompt.trim(),
          category: category.trim() ? category.trim() : null,
          summary: summary.trim() ? summary.trim() : null,
        },
        InspirationSubmitResponse,
      ),
    onSuccess: () => {
      toast.success("投稿已提交，待管理员审核");
      qc.invalidateQueries({ queryKey: ["my-submissions"] });
      reset();
      setTab("mine");
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "投稿失败，请重试"),
  });

  const canSubmit = !!picked && !!title.trim() && !!prompt.trim() && !submit.isPending;

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label="投稿到灵感库"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <h2 className={styles.title}>投稿到灵感库</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === "submit" ? styles.tabActive : ""}`}
            onClick={() => setTab("submit")}
          >
            投稿
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === "mine" ? styles.tabActive : ""}`}
            onClick={() => setTab("mine")}
          >
            我的投稿
          </button>
        </div>

        <div className={styles.body}>
          {tab === "submit" ? (
            !picked ? (
              <>
                <p className={styles.hint}>从你生成的作品中选一张投稿，通过后将公开展示并署名你的昵称（邮箱前缀）。</p>
                {assets.isLoading ? (
                  <div className={styles.empty}>加载作品中…</div>
                ) : myImages.length === 0 ? (
                  <div className={styles.empty}>你还没有作品，先去生成几张再来投稿吧。</div>
                ) : (
                  <div className={styles.pickGrid}>
                    {myImages.map((img) => (
                      <button
                        key={img.id}
                        type="button"
                        className={styles.pickCell}
                        onClick={() => pick(img)}
                        aria-label="选择这张图投稿"
                      >
                        <img src={img.publicUrl} alt={img.prompt} loading="lazy" decoding="async" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <img className={styles.preview} src={picked.publicUrl} alt={title || picked.prompt} />
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="sub-title">
                    标题
                  </label>
                  <input
                    id="sub-title"
                    className={styles.input}
                    value={title}
                    maxLength={100}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="给你的作品起个名字"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="sub-prompt">
                    提示词
                  </label>
                  <textarea
                    id="sub-prompt"
                    className={styles.textarea}
                    value={prompt}
                    maxLength={4000}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="sub-category">
                    分类（可选）
                  </label>
                  <select
                    id="sub-category"
                    className={styles.select}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">不分类</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="sub-summary">
                    一行简介（可选）
                  </label>
                  <input
                    id="sub-summary"
                    className={styles.input}
                    value={summary}
                    maxLength={500}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="一句话描述这张作品"
                  />
                </div>

                {err ? <p className={styles.err}>{err}</p> : null}

                <div className={styles.actions}>
                  <button type="button" className={styles.btn} onClick={() => setPicked(null)} disabled={submit.isPending}>
                    重新选图
                  </button>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={() => submit.mutate()}
                    disabled={!canSubmit}
                  >
                    {submit.isPending ? "提交中…" : "提交投稿"}
                  </button>
                </div>
              </>
            )
          ) : (
            // 我的投稿
            <>
              {mine.isLoading ? (
                <div className={styles.empty}>加载中…</div>
              ) : (mine.data?.items ?? []).length === 0 ? (
                <div className={styles.empty}>还没有投稿记录。</div>
              ) : (
                <div className={styles.subList}>
                  {mine.data?.items.map((s) => {
                    const st = statusLabel(s.status);
                    return (
                      <div key={s.id} className={styles.subItem}>
                        <img
                          className={styles.subThumb}
                          src={s.image}
                          alt={s.title}
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.visibility = "hidden";
                          }}
                        />
                        <div className={styles.subMeta}>
                          <p className={styles.subTitle}>{s.title}</p>
                          {s.status === "rejected" && s.reviewReason ? (
                            <p className={styles.subReason}>驳回原因：{s.reviewReason}</p>
                          ) : null}
                        </div>
                        <span className={`${styles.statusBadge} ${st.cls}`}>{st.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
