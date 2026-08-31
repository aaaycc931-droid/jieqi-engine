package com.jieqi.bluetooth;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * First-stage offline shell.  The complete game UI and rules are bundled below
 * android_asset/game.  Bluetooth and the JavaScript bridge deliberately arrive
 * in the next stage, so no native surface is exposed to page JavaScript yet.
 */
public final class MainActivity extends Activity {
  private static final String GAME_URL = "file:///android_asset/game/web/index.html";
  private WebView gameView;

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
    gameView.setWebViewClient(new GameOnlyWebViewClient());
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

  private static final class GameOnlyWebViewClient extends WebViewClient {
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      // The first APK contains only trusted local game assets.  Do not allow a
      // page navigation to turn this WebView into a general-purpose browser.
      return !request.getUrl().toString().startsWith("file:///android_asset/game/");
    }
  }
}
