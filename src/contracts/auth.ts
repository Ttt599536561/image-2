// 鉴权请求契约（05 §6.4，前后端共用）。密码 ≥6 且 ≤72 字节（防 bcrypt 72 字节截断），复用 account.ts 的 passwordField。
import { z } from "zod";
import { passwordField } from "./account";

export const signUpSchema = z.object({ email: z.email(), password: passwordField });
export type SignUpRequest = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({ email: z.email(), password: z.string().min(1, "请输入密码") });
export type SignInRequest = z.infer<typeof signInSchema>;

// 改密同样限长（与 account.ts ChangePasswordRequest 对齐）。
export const resetPwSchema = z.object({ password: passwordField });
export type ResetPwRequest = z.infer<typeof resetPwSchema>;
