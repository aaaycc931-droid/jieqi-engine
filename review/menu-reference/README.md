# 首页原图外观对照样稿

状态：2026-10-02 **样稿，未获正式采用批准**。当前 APK 首页已被用户否决。

- 唯一视觉原图：`国风象棋主菜单按钮下移.png`，941 × 1672；保留原图像素。
- 对照样稿保留真实 HTML 按钮、原有事件和无障碍名称，覆盖本机双人、蓝牙对局、禁用联机、玩法说明、设置。
- 原图拆成网页中的上部、空白宣纸带、下部三个显示窗口。标题、墨环、装饰、按钮和文字按宽度等比缩放，长屏只增加中间宣纸带。
- 设置入口是后续确认项，原图没有；样稿继续保留小型设置控件。
- 此方式改变了正式方案中禁止从合成图截取显示区域的约束，**只用于实际渲染及交互对照**，尚不作为正式组件使用。
- `scripts/review/prepare-menu-review.mjs` 单独生成 `review-output`，不修改 `web/index.html`，不复制到 Android。
- 原方案仍可保留独立素材重建，但缺少原始图层时不能承诺笔触和像素与合成图完全一致。

## 本地生成

```sh
node scripts/build-web.ts
node scripts/review/prepare-menu-review.mjs
node scripts/review/capture-menu-review.mjs
```

最后一步要求安装 Playwright 及 Chromium。输出为真实浏览器截图和交互结果；截图仍需要用户视觉审核和 Android WebView 验证。
