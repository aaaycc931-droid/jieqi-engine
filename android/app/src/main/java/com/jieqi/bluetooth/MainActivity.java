package com.jieqi.bluetooth;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Build;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Trusted offline game shell. The bundled page receives only the narrow
 * Bluetooth transport bridge needed for the two-phone room protocol. */
public final class MainActivity extends Activity {
  private static final String GAME_URL = "file:///android_asset/game/web/index.html";
  private static final int BLUETOOTH_PERMISSION_REQUEST = 4101;
  private WebView gameView;
  private GameWebBridge gameBridge;

  @Override
  @SuppressLint("SetJavaScriptEnabled")
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    gameView = new WebView(this);
    gameView.setBackgroundColor(Color.rgb(45, 26, 20));
    gameView.getSettings().setJavaScriptEnabled(true);
    gameView.getSettings().setDomStorageEnabled(false);
    gameView.getSettings().setAllowContentAccess(false);
    gameView.getSettings().setAllowFileAccess(true);
    // The packaged page is an ES module that imports the bundled rule modules
    // from the same android_asset/game directory. Android disables file-to-file
    // JavaScript access by default on modern target SDKs, which otherwise leaves
    // the visible HTML loaded but none of its click handlers registered.
    gameView.getSettings().setAllowFileAccessFromFileURLs(true);
    gameView.getSettings().setAllowUniversalAccessFromFileURLs(false);
    gameView.setWebViewClient(new GameOnlyWebViewClient());
    BluetoothManager manager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
    BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
    gameBridge = new GameWebBridge(this, gameView, adapter);
    gameView.addJavascriptInterface(gameBridge, "JieqiBluetooth");
    setContentView(gameView);

    if (savedInstanceState == null) {
      gameView.loadUrl(GAME_URL);
    } else {
      gameView.restoreState(savedInstanceState);
    }
  }

  @Override
  protected void onSaveInstanceState(Bundle outState) {
    gameView.saveState(outState);
    super.onSaveInstanceState(outState);
  }

  @Override
  public void onBackPressed() {
    if (gameView.canGoBack()) {
      gameView.goBack();
    } else {
      super.onBackPressed();
    }
  }

  boolean hasBluetoothPermission() {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
      || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
  }

  boolean ensureBluetoothPermission() {
    if (hasBluetoothPermission()) return true;
    requestPermissions(new String[] { Manifest.permission.BLUETOOTH_CONNECT }, BLUETOOTH_PERMISSION_REQUEST);
    return false;
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode == BLUETOOTH_PERMISSION_REQUEST && gameBridge != null) {
      gameBridge.onPermissionResult(hasBluetoothPermission());
    }
  }

  @Override
  protected void onDestroy() {
    if (gameBridge != null) gameBridge.close();
    if (gameView != null) gameView.destroy();
    super.onDestroy();
  }

  private static final class GameOnlyWebViewClient extends WebViewClient {
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      // The first APK contains only trusted local game assets.  Do not allow a
      // page navigation to turn this WebView into a general-purpose browser.
      return !request.getUrl().toString().startsWith("file:///android_asset/game/");
    }
  }
}
