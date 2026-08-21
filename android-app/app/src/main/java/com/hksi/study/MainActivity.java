package com.hksi.study;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

public class MainActivity extends Activity {
    private static final String KEY_ALIAS = "hksi_openai_key";
    private static final String PREFS = "hksi_secure";
    private static final String PREF_CIPHER = "api_key_cipher";
    private static final String PREF_IV = "api_key_iv";
    private WebView webView;
    private final ExecutorService executor = Executors.newFixedThreadPool(3);

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(21, 49, 79));
        getWindow().setNavigationBarColor(Color.rgb(245, 243, 238));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(245, 243, 238));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (android.os.Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);

        webView.addJavascriptInterface(new NativeBridge(this), "HKSI_NATIVE");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme())) return false;
                if ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                }
                return false;
            }
        });
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    private void callback(String requestId, boolean success, String payload) {
        String script = "window.HKSI_NATIVE_CALLBACK(" + JSONObject.quote(requestId) + "," + success + "," + JSONObject.quote(payload) + ")";
        runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }

    private String readBody(HttpURLConnection connection, boolean success) throws Exception {
        InputStream stream = success ? connection.getInputStream() : connection.getErrorStream();
        if (stream == null) return "";
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder result = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
            return result.toString();
        }
    }

    private void nativeRequest(String requestId, String method, String endpoint, String body) {
        executor.execute(() -> {
            try {
                URL url = new URL(endpoint);
                if (!"https".equalsIgnoreCase(url.getProtocol())) throw new Exception("同步地址必须使用 https");
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod(method);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(25000);
                connection.setRequestProperty("Accept", "application/json");
                if (body != null) {
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(body.getBytes(StandardCharsets.UTF_8));
                    }
                }
                int status = connection.getResponseCode();
                String response = readBody(connection, status >= 200 && status < 300);
                if (status < 200 || status >= 300) throw new Exception("服务返回 " + status + (response.isEmpty() ? "" : "：" + response));
                callback(requestId, true, response.isEmpty() ? "{}" : response);
            } catch (Exception error) {
                callback(requestId, false, error.getMessage() == null ? "网络请求失败" : error.getMessage());
            }
        });
    }

    private void saveEncryptedKey(String value) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build());
            generator.generateKey();
        }
        SecretKey key = ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putString(PREF_CIPHER, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString(PREF_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .apply();
    }

    private String readEncryptedKey() throws Exception {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String encrypted = prefs.getString(PREF_CIPHER, "");
        String iv = prefs.getString(PREF_IV, "");
        if (encrypted.isEmpty() || iv.isEmpty()) return "";
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey key = ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    public class NativeBridge {
        private final Context context;
        NativeBridge(Context context) { this.context = context; }

        @JavascriptInterface
        public boolean isNativeApp() { return true; }

        @JavascriptInterface
        public boolean hasApiKey() {
            try { return !readEncryptedKey().isEmpty(); }
            catch (Exception ignored) { return false; }
        }

        @JavascriptInterface
        public boolean saveApiKey(String value) {
            try {
                String trimmed = value == null ? "" : value.trim();
                if (trimmed.length() < 20) return false;
                saveEncryptedKey(trimmed);
                return true;
            } catch (Exception ignored) { return false; }
        }

        @JavascriptInterface
        public void clearApiKey() {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().clear().apply();
        }

        @JavascriptInterface
        public void askAI(String requestId, String prompt) {
            executor.execute(() -> {
                try {
                    String apiKey = readEncryptedKey();
                    if (apiKey.isEmpty()) throw new Exception("请先在“我的 → AI 设置”中保存密钥");
                    HttpURLConnection connection = (HttpURLConnection) new URL("https://api.openai.com/v1/responses").openConnection();
                    connection.setRequestMethod("POST");
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(60000);
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Authorization", "Bearer " + apiKey);
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    JSONObject request = new JSONObject();
                    request.put("model", "gpt-5.6");
                    request.put("store", false);
                    request.put("max_output_tokens", 1000);
                    request.put("reasoning", new JSONObject().put("effort", "low"));
                    request.put("text", new JSONObject().put("verbosity", "medium"));
                    request.put("instructions", "你是 HKSI 卷一私人备考助手。只根据用户提供的题目、选项、答案、已有解析和章节内容解释。先说结论，再解释判断依据，指出干扰项为什么错，最后给一个简短记忆方法。使用简体中文；不要编造法规条文或保证考试结果。若资料不足，明确说明。");
                    request.put("input", prompt == null ? "" : prompt);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(request.toString().getBytes(StandardCharsets.UTF_8));
                    }
                    int status = connection.getResponseCode();
                    String raw = readBody(connection, status >= 200 && status < 300);
                    if (status < 200 || status >= 300) {
                        String message = "AI 服务返回 " + status;
                        try { message = new JSONObject(raw).getJSONObject("error").optString("message", message); }
                        catch (Exception ignored) { }
                        throw new Exception(message);
                    }
                    JSONObject response = new JSONObject(raw);
                    JSONArray output = response.optJSONArray("output");
                    StringBuilder answer = new StringBuilder();
                    if (output != null) {
                        for (int i = 0; i < output.length(); i++) {
                            JSONArray content = output.getJSONObject(i).optJSONArray("content");
                            if (content == null) continue;
                            for (int j = 0; j < content.length(); j++) {
                                JSONObject item = content.getJSONObject(j);
                                if ("output_text".equals(item.optString("type"))) {
                                    if (answer.length() > 0) answer.append("\n");
                                    answer.append(item.optString("text"));
                                }
                            }
                        }
                    }
                    if (answer.length() == 0) throw new Exception("AI 没有返回文字内容");
                    callback(requestId, true, answer.toString());
                } catch (Exception error) {
                    callback(requestId, false, error.getMessage() == null ? "AI 请求失败" : error.getMessage());
                }
            });
        }

        @JavascriptInterface
        public void syncGet(String requestId, String endpoint, String code) {
            try {
                String divider = endpoint.contains("?") ? "&" : "?";
                nativeRequest(requestId, "GET", endpoint + divider + "code=" + URLEncoder.encode(code, "UTF-8"), null);
            } catch (Exception error) {
                callback(requestId, false, "同步码无效");
            }
        }

        @JavascriptInterface
        public void syncPut(String requestId, String endpoint, String code, String json) {
            try {
                String divider = endpoint.contains("?") ? "&" : "?";
                nativeRequest(requestId, "POST", endpoint + divider + "code=" + URLEncoder.encode(code, "UTF-8"), json);
            } catch (Exception error) {
                callback(requestId, false, "同步码无效");
            }
        }

        @JavascriptInterface
        public String deviceName() {
            String model = android.os.Build.MODEL;
            return model == null || model.isEmpty() ? "Android 手机" : model;
        }

        @JavascriptInterface
        public String installationId() {
            return Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
        }
    }
}
