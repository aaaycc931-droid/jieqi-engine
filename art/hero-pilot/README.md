# 司衡静态美术 v1

受托设计者自主定稿，非用户逐图审批。两张原始PNG来自内置imagegen，未重绘或裁改；提示词与选取原因见PROMPTS.json。全身立绘的右袖卷起、左腕两枚配重与DESIGN.md一致。

`node scripts/hero-pilot/package-art.cjs` 使用sharp0.35.5导出4个WebP运行资产及尺寸检查板；包只做等比缩放/编码。Web资源总计145958 bytes，原图不随普通Web构建打包。

运行时：名册/选将/对局头像使用响应式头像；开场介绍与英雄详情展示立绘。只接入siheng，默认英雄池和旧英雄占位保持。QA与SHA见review/hero-pilot/ART_VALIDATION.json和ART_ASSET_MANIFEST.json。没有动画或真实浏览器视觉验收。

恢复记录：原工作树的两张生成母版、四张导出及七个实现文件已完整找回；本轮保留原字节。用户重新上传的头像与母版RGBA完全一致；立绘alpha完全一致，公共底色上合成前浮点颜色最大差异小于一个8位色阶，但文件不完全相同。详见`review/hero-pilot/ART_RECOVERY.json`。本轮没有调用图像生成或重新导出。
