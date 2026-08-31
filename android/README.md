# 揭棋·蓝牙版 Android 外壳

当前是第一阶段：APK 内置现有揭棋网页，尚未接入蓝牙。它不需要网络权限，也没有 JavaScript 原生接口。

## 构建前提

- Android Studio 当前稳定版；
- JDK 17；
- Android SDK Platform 37 与 Build Tools 36；
- Node.js 24 或更高版本（只在更新网页资源时需要）。

本工作区未包含 Android SDK 或 Gradle，因此请在 Android Studio 中直接打开本目录并完成首次同步。Android Gradle Plugin 9.3.0 使用 Gradle 9.5 与 JDK 17。

## 更新内置网页

在 `jieqi-engine` 根目录运行：

```sh
node scripts/build-web.ts
node android/scripts/sync-web-assets.mjs
```

## 生成测试 APK

在 Android Studio 选择 `Build > Build APK(s)`，输出位于：

```text
app/build/outputs/apk/debug/app-debug.apk
```

在两台安卓手机上安装时，系统会要求确认来自此来源的 APK。蓝牙权限与连接流程将在第二阶段加入。
