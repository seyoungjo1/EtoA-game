package app.etoa.gameboard;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

/**
 * EtoA 게임판 — 사이트를 그대로 띄우는 껍데기 앱.
 * 화면은 전부 사이트(GitHub Pages)에서 오므로 앱을 다시 설치할 일이 없다.
 */
public class MainActivity extends Activity {

    /** 게임판 주소. 이 호스트 밖으로 나가는 링크는 브라우저로 넘긴다. */
    private static final String HOME = "https://seyoungjo1.github.io/EtoA-game/";
    private static final String HOST = "seyoungjo1.github.io";
    private static final int REQ_FILE = 1001;

    private FrameLayout root;
    private WebView web;
    private ValueCallback<Uri[]> pendingFile;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        // 코트 옆에 세워 두고 보는 화면이라 꺼지지 않게 한다
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        root = new FrameLayout(this);
        setContentView(root);
        goFullscreen();
        buildWebView();

        if (saved != null) web.restoreState(saved);
        if (web.getUrl() == null) web.loadUrl(HOME);
    }

    /** 가로 전체화면. 상태바·내비게이션바를 감추고, 가장자리에서 쓸어내리면 잠깐만 나온다. */
    private void goFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // 노치가 있는 기기에서도 그 옆까지 화면을 쓴다. 사이트가 safe-area 만큼 여백을 둔다.
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goFullscreen();     // 다른 창을 다녀와도 전체화면을 유지한다
    }

    private void buildWebView() {
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // 로그인 상태·설정이 localStorage 에 있다
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);                    // 시스템 글자 크기와 무관하게 사이트 배치를 지킨다
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setBackgroundColor(0xFFEEF2F5);
        web.addJavascriptInterface(new Bridge(), "EtoAApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
    }

    /* ---------- 사이트 안 링크만 앱에서 연다 ---------- */
    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            String scheme = u.getScheme() == null ? "" : u.getScheme();
            boolean inside = HOST.equalsIgnoreCase(u.getHost())
                    && ("https".equals(scheme) || "http".equals(scheme));
            if (inside || "about".equals(scheme) || "data".equals(scheme) || "blob".equals(scheme)) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (ActivityNotFoundException ignored) { /* 열 앱이 없으면 그냥 둔다 */ }
            return true;
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
            if (!req.isForMainFrame()) return;
            v.loadDataWithBaseURL(HOME, OFFLINE_HTML, "text/html", "utf-8", HOME);
        }

        /** 웹뷰 프로세스가 죽으면 빈 화면이 되므로 새로 만든다 */
        @Override
        public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
            root.removeView(v);
            v.destroy();
            buildWebView();
            web.loadUrl(HOME);
            return true;
        }
    }

    /* ---------- 파일 고르기 (모임 로고 · 기록 불러오기) ---------- */
    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (pendingFile != null) pendingFile.onReceiveValue(null);
            pendingFile = cb;
            try {
                startActivityForResult(p.createIntent(), REQ_FILE);
            } catch (ActivityNotFoundException e) {
                pendingFile = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_FILE) {
            if (pendingFile != null) {
                pendingFile.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
                pendingFile = null;
            }
            return;
        }
        super.onActivityResult(req, res, data);
    }

    /* ---------- 사이트 → 앱: 기록 내보내기 ---------- */
    private final class Bridge {
        /** 사이트가 다운로드 대신 부른다. 파일을 만들어 공유 창을 띄운다. */
        @JavascriptInterface
        public void saveText(String filename, String text) {
            runOnUiThread(() -> shareText(filename, text));
        }
    }

    private void shareText(String filename, String text) {
        try {
            File dir = new File(getCacheDir(), "export");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("cache");
            String safe = filename == null ? "etoa.json" : filename.replaceAll("[\\\\/:*?\"<>|]", "_");
            File f = new File(dir, safe);
            try (OutputStreamWriter w = new OutputStreamWriter(new FileOutputStream(f), StandardCharsets.UTF_8)) {
                w.write(text == null ? "" : text);
            }
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            Intent send = new Intent(Intent.ACTION_SEND)
                    .setType("application/json")
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .putExtra(Intent.EXTRA_SUBJECT, safe)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(send, getString(R.string.share_export)));
        } catch (Exception e) {
            Toast.makeText(this, "내보내기에 실패했습니다", Toast.LENGTH_SHORT).show();
        }
    }

    /* ---------- 뒤로 가기 · 상태 보존 ---------- */
    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** 인터넷이 없을 때 보여 주는 화면. 다시 시도를 누르면 사이트를 다시 연다. */
    private static final String OFFLINE_HTML =
            "<!doctype html><html lang=ko><head><meta charset=utf-8>"
            + "<meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<style>"
            + "html,body{height:100%;margin:0}"
            + "body{display:grid;place-items:center;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;"
            + "background:#eef2f5;color:#16212b;-webkit-tap-highlight-color:transparent}"
            + ".c{text-align:center;padding:28px 32px;background:#fff;border:1px solid #dde5ec;border-radius:20px;"
            + "box-shadow:0 20px 56px rgba(16,32,48,.18);max-width:360px;margin:16px}"
            + ".i{font-size:40px;line-height:1;margin-bottom:6px}"
            + "h1{font-size:19px;margin:0 0 4px;letter-spacing:-.3px}"
            + "p{margin:0 0 16px;font-size:13px;color:#93a3b1;font-weight:700;line-height:1.6}"
            + "button{border:0;border-radius:12px;padding:11px 28px;font-size:15px;font-weight:800;color:#fff;"
            + "background:linear-gradient(180deg,#0e9f6e,#0b7f58)}"
            + "</style></head><body><div class=c><div class=i>📡</div>"
            + "<h1>인터넷 연결을 확인해주세요</h1><p>게임판은 인터넷이 있어야 열립니다.</p>"
            + "<button onclick=\"location.replace('" + HOME + "')\">다시 시도</button></div></body></html>";
}
