# 揭棋·蓝牙版 Android 外壳

当前已完成第二阶段的通信基础：APK 内置现有揭棋网页，并加入 Bluetooth Classic RFCOMM 主机/加入传输层。它不需要网络权限。

蓝牙房主在手机上创建单人房间，另一台已配对手机加入；消息以版本化 JSON 行传输，单条最大 48 KiB。主机之后会持有完整规则状态，来宾只提交操作并接收公开快照。

本次尚未把网页中的猜拳、选英雄、布陷阱和走子操作改接到这个通道，因此当前 APK 仍只能离线同设备试玩；下一步才是将已完成的权威房间契约接入网页桥。

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

在两台安卓手机上安装时，系统会要求确认来自此来源的 APK。首次使用蓝牙入口时，Android 12+ 会请求“附近的设备”连接权限；双方需先在系统蓝牙设置中完成配对。本阶段不会扫描附近设备或请求定位权限。
