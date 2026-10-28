import { StudioPage } from "../../src/components/studio/StudioPage";

export function meta() {
  return [{ title: "图像工坊 · 创作工作台" }, { name: "description", content: "使用自己的图片服务 URL 与 API Key 自由创作，作品保存在此浏览器。" }];
}
export default function StudioRoute() { return <StudioPage />; }
