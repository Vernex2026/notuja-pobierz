package pl.notuja.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Most między stroną a natywną powłoką. Wystawia w WebView obiekt
 * <code>window.notujaNative</code> i pilnuje, żeby WebView nie "zasypiał" w tle,
 * dopóki trwa nagrywanie.
 *
 * Zrobione jako wtyczka Capacitora wyłącznie dlatego, że Plugin.load() wykonuje się
 * przed pierwszym loadUrl() - obiekt jest więc dostępny już na pierwszej stronie.
 */
@CapacitorPlugin(name = "NotujaNative")
public class NotujaPlugin extends Plugin {

    private static final String TAG = "NotujaNative";
    private static final String JS_NAME = "notujaNative";
    private static final int REQUEST_NOTIFICATIONS = 4102;
    private static final long KEEP_VISIBLE_DELAY_MS = 1000L;

    private volatile boolean recording = false;
    private volatile boolean activityStopped = false;
    private boolean notificationPermissionAsked = false;

    @Override
    public void load() {
        try {
            WebView webView = getBridge().getWebView();
            // Bezpieczne tylko dlatego, że WebView ładuje wyłącznie nasz serwis
            // (pozostałe adresy otwierają się w przeglądarce systemowej).
            webView.addJavascriptInterface(new JsApi(), JS_NAME);
            getBridge().addWebViewListener(
                new WebViewListener() {
                    @Override
                    public void onPageStarted(WebView view) {
                        // Pełne przeładowanie strony kończy MediaRecorder - nie zostawiamy
                        // powiadomienia "nagrywa" po nagraniu, którego już nie ma.
                        if (recording) {
                            applyRecording(false, "");
                        }
                    }
                }
            );
        } catch (Throwable t) {
            Log.e(TAG, "Nie udało się zarejestrować mostu notujaNative", t);
        }
    }

    @Override
    protected void handleOnStart() {
        activityStopped = false;
    }

    @Override
    protected void handleOnStop() {
        activityStopped = true;
        if (recording) {
            scheduleKeepVisible();
        }
    }

    @Override
    protected void handleOnDestroy() {
        // Aktywność (a z nią WebView) znika - nagranie w stronie też, więc usługa nie ma sensu.
        recording = false;
        RecordingService.stop(getContext());
    }

    /** Wywoływane z wątku mostu JS albo z wątku UI. Nigdy nie rzuca wyjątku. */
    private void applyRecording(boolean active, String title) {
        try {
            if (active) {
                boolean started = RecordingService.start(getContext(), title);
                recording = started;
                if (started) {
                    runOnUi(this::requestNotificationPermissionOnce);
                    if (activityStopped) {
                        scheduleKeepVisible();
                    }
                }
            } else {
                recording = false;
                RecordingService.stop(getContext());
                runOnUi(this::restoreWebViewVisibility);
            }
        } catch (Throwable t) {
            Log.w(TAG, "setRecording nie powiodło się", t);
        }
    }

    /**
     * Capacitor (BridgeActivity/Bridge) nie wywołuje WebView.onPause() ani pauseTimers(),
     * więc JS działa dalej także w tle. Jedyne, co się zmienia po onStop, to widoczność
     * okna: Chromium oznacza stronę jako ukrytą i dławi timery. Dopóki trwa nagrywanie,
     * zgłaszamy WebView, że okno jest nadal widoczne.
     */
    private void scheduleKeepVisible() {
        try {
            final WebView webView = getBridge().getWebView();
            webView.postDelayed(
                () -> {
                    try {
                        if (recording && activityStopped) {
                            webView.dispatchWindowVisibilityChanged(View.VISIBLE);
                        }
                    } catch (Throwable t) {
                        Log.w(TAG, "Nie udało się podtrzymać widoczności WebView", t);
                    }
                },
                KEEP_VISIBLE_DELAY_MS
            );
        } catch (Throwable t) {
            Log.w(TAG, "scheduleKeepVisible", t);
        }
    }

    /** Po zakończeniu nagrywania w tle przywraca WebView prawdziwy stan okna. */
    private void restoreWebViewVisibility() {
        try {
            if (!activityStopped) {
                return;
            }
            WebView webView = getBridge().getWebView();
            webView.dispatchWindowVisibilityChanged(webView.getWindowVisibility());
        } catch (Throwable t) {
            Log.w(TAG, "restoreWebViewVisibility", t);
        }
    }

    private void requestNotificationPermissionOnce() {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || notificationPermissionAsked) {
                return;
            }
            Activity activity = getActivity();
            if (activity == null || activity.isFinishing()) {
                return;
            }
            if (
                ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            ) {
                return;
            }
            notificationPermissionAsked = true;
            ActivityCompat.requestPermissions(activity, new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQUEST_NOTIFICATIONS);
        } catch (Throwable t) {
            Log.w(TAG, "Prośba o zgodę na powiadomienia nie powiodła się", t);
        }
    }

    private void runOnUi(Runnable action) {
        try {
            Activity activity = getActivity();
            if (activity != null) {
                activity.runOnUiThread(action);
            }
        } catch (Throwable t) {
            Log.w(TAG, "runOnUi", t);
        }
    }

    private String appVersion() {
        try {
            String name = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName;
            return name == null ? "" : name;
        } catch (Throwable t) {
            return "";
        }
    }

    /** Obiekt widoczny w stronie jako window.notujaNative. Metody są synchroniczne. */
    public final class JsApi {

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public String version() {
            return appVersion();
        }

        @JavascriptInterface
        public void setRecording(boolean active, String title) {
            applyRecording(active, title == null ? "" : title);
        }

        /** Dodatek poza kontraktem: czy usługa pierwszoplanowa faktycznie działa. */
        @JavascriptInterface
        public boolean isRecordingServiceActive() {
            try {
                return RecordingService.isRunning();
            } catch (Throwable t) {
                return false;
            }
        }

        /** Dodatek poza kontraktem: używa go lokalna strona "Brak połączenia". */
        @JavascriptInterface
        public void reload() {
            runOnUi(
                () -> {
                    try {
                        String url = getBridge().getServerUrl();
                        if (url == null || url.isEmpty()) {
                            url = getBridge().getAppUrl();
                        }
                        getBridge().getWebView().loadUrl(url);
                    } catch (Throwable t) {
                        Log.w(TAG, "reload", t);
                    }
                }
            );
        }
    }
}
