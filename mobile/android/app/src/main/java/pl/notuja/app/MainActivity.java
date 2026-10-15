package pl.notuja.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Musi być przed super.onCreate(): wtyczka rejestruje window.notujaNative
        // zanim WebView zacznie ładować stronę.
        registerPlugin(NotujaPlugin.class);
        super.onCreate(savedInstanceState);

        // Wstecz: cofnij w historii WebView; na początku historii schowaj aplikację
        // zamiast ją zamykać (zamknięcie aktywności przerwałoby trwające nagranie).
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        try {
                            WebView webView = bridge != null ? bridge.getWebView() : null;
                            if (webView != null && webView.canGoBack()) {
                                webView.goBack();
                                return;
                            }
                        } catch (Throwable ignored) {
                            // nic - poniżej chowamy aplikację
                        }
                        moveTaskToBack(true);
                    }
                }
            );
    }
}
