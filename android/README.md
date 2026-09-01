# 揭棋·蓝牙版 Android 外壳

APK 内置完整揭棋网页，并加入 Bluetooth Classic RFCOMM 主机/加入传输层。它不需要网络权限。

蓝牙房主在手机上创建房间，另一台已配对手机加入；消息以版本化 JSON 行传输，单条最大 48 KiB。房主 WebView 持有完整规则状态，来宾只提交猜拳、英雄、陷阱、走子、刺杀或臣服操作，并接收已净化的公开快照和仅属于自己的私有信息。

网页大厅已接入该通道：双方可在各自手机上秘密猜拳、私下选英雄、私下放置猎人陷阱，并完整使用刺杀、强击、防护壁垒和六项畸变。背刺与裁决由房主先结算，再在两端播放同一份终结动画。断开连接会暂停当前对局；尚未实现自动断线胜负判定。

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

在两台安卓手机上安装时，系统会要求确认来自此来源的 APK。首次使用蓝牙入口时，Android 12+ 会请求“附近的设备”连接权限；双方需先在系统蓝牙设置中完成配对。打开应用后：房主点“创建蓝牙房间”，来宾点“刷新已配对设备”、选择房主并点“加入蓝牙房间”。本应用不会扫描附近设备或请求定位权限。
