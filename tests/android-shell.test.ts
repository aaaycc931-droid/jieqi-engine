import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const sourceHtml = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const sourceCss = readFileSync(new URL("../web/style.css", import.meta.url), "utf8");
const bundledHtml = readFileSync(new URL("../android/app/src/main/assets/game/web/index.html", import.meta.url), "utf8");
const bundledCss = readFileSync(new URL("../android/app/src/main/assets/game/web/style.css", import.meta.url), "utf8");
const bundledApp = readFileSync(new URL("../android/app/src/main/assets/game/web/app.js", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../android/app/src/main/java/com/jieqi/bluetooth/GameWebBridge.java", import.meta.url), "utf8");
const session = readFileSync(new URL("../android/app/src/main/java/com/jieqi/bluetooth/BluetoothGameSession.java", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");

test("ANDROID-ASSET-01 APK 内置 HTML 与 CSS 已同步到当前 UI", () => {
  assert.equal(bundledHtml, sourceHtml);
  assert.equal(bundledCss, sourceCss);
  for (const asset of [
    "../android/app/src/main/assets/game/web/assets/menu-v1/title-lezi-xiangqi.png",
    "../android/app/src/main/assets/game/web/assets/menu-v1/label-bluetooth.png",
    "../android/app/src/main/assets/game/web/assets/rps-v1/gesture-rock.png",
  ]) {
    assert.equal(existsSync(new URL(asset, import.meta.url)), true, `${asset} 应已同步进 APK 资源`);
  }
  assert.match(bundledApp, /function renderMovementGuides\(/);
  assert.match(bundledApp, /permission-granted/);
  assert.match(bundledApp, /CHAT_MAX_CHARACTERS/);
});

test("ANDROID-BT-01 未取得附近设备权限前不调用受保护的蓝牙状态 API", () => {
  const statusMethod = bridge.match(/public String status\(\)[\s\S]*?return value\.toString\(\);/)?.[0] ?? "";
  assert.match(statusMethod, /boolean permissionGranted = activity\.hasBluetoothPermission\(\)/);
  assert.match(statusMethod, /if \(adapter != null && permissionGranted\)/);
  assert.ok(statusMethod.indexOf("permissionGranted") < statusMethod.indexOf("adapter.isEnabled()"));
  assert.match(bridge, /catch \(SecurityException error\)/);
});

test("ANDROID-BT-02 创建与加入中的阻塞 socket 都能被取消操作关闭", () => {
  const hostMethod = session.match(/private synchronized void startHost[\s\S]*?\n  \}/)?.[0] ?? "";
  const guestMethod = session.match(/private synchronized void startGuest[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(hostMethod, /serverSocket = candidate;[\s\S]*?candidate\.accept\(\)/);
  assert.match(guestMethod, /socket = candidate;[\s\S]*?candidate\.connect\(\)/);
  assert.match(session, /蓝牙权限已失效，请在系统设置重新允许/);
});

test("ANDROID-UI-01 软键盘使用 resize 模式以配合半屏消息面板", () => {
  assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
});
