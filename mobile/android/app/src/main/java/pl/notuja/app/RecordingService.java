package pl.notuja.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Usługa pierwszoplanowa typu "microphone". Sama niczego nie nagrywa - nagrywa strona
 * w WebView (getUserMedia + MediaRecorder). Usługa utrzymuje proces przy życiu, pokazuje
 * stałe powiadomienie i trzyma częściową blokadę wybudzenia, dzięki czemu nagrywanie
 * trwa przy zgaszonym ekranie i po przejściu aplikacji w tło.
 *
 * Android 14+: usługa typu microphone musi zostać uruchomiona, gdy aplikacja jest
 * widoczna i ma już przyznane RECORD_AUDIO - dlatego startuje dokładnie w chwili,
 * w której strona zgłasza początek nagrywania.
 */
public class RecordingService extends Service {

    private static final String TAG = "NotujaRecording";
    private static final String CHANNEL_ID = "notuja_recording";
    private static final int NOTIFICATION_ID = 4101;
    private static final String EXTRA_TITLE = "title";
    /** Bezpiecznik: blokada wybudzenia zwalnia się sama po tym czasie. */
    private static final long WAKE_LOCK_TIMEOUT_MS = 12L * 60L * 60L * 1000L;

    private static volatile boolean running = false;

    private PowerManager.WakeLock wakeLock;
    private boolean foregroundStarted = false;
    private long startedAt = 0L;

    public static boolean isRunning() {
        return running;
    }

    /** Uruchamia usługę albo aktualizuje tytuł. Zwraca false, gdy się nie udało. */
    public static boolean start(Context context, String title) {
        try {
            Context app = context.getApplicationContext();
            if (ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "Brak uprawnienia RECORD_AUDIO - usługa nie zostanie uruchomiona");
                return false;
            }
            Intent intent = new Intent(app, RecordingService.class);
            intent.putExtra(EXTRA_TITLE, title == null ? "" : title);
            // Celowo startService, a nie startForegroundService: wywołanie przychodzi, gdy
            // aplikacja jest na pierwszym planie (albo usługa już działa), więc jest dozwolone,
            // a nie obowiązuje wtedy twardy limit czasu na startForeground().
            app.startService(intent);
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "Nie udało się uruchomić usługi nagrywania", t);
            return false;
        }
    }

    public static void stop(Context context) {
        try {
            Context app = context.getApplicationContext();
            app.stopService(new Intent(app, RecordingService.class));
        } catch (Throwable t) {
            Log.w(TAG, "Nie udało się zatrzymać usługi nagrywania", t);
        }
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent == null) {
            // Restart przez system bez intencji - strona już nie nagrywa.
            stopSelf();
            return START_NOT_STICKY;
        }
        String title = intent.getStringExtra(EXTRA_TITLE);
        try {
            if (!foregroundStarted) {
                startedAt = System.currentTimeMillis();
                createChannel();
                int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
                ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(title), type);
                foregroundStarted = true;
                running = true;
                acquireWakeLock();
            } else {
                // Sama zmiana tytułu: bez ponownego startForeground(), bo w tle Android 14+
                // ponownie sprawdziłby uprawnienia "podczas używania" i mógłby rzucić wyjątek.
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.notify(NOTIFICATION_ID, buildNotification(title));
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "startForeground nie powiódł się", t);
            if (!foregroundStarted) {
                stopSelf();
            }
        }
        // Nie wznawiać po zabiciu procesu: bez strony w WebView nie ma czego podtrzymywać.
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        releaseWakeLock();
        try {
            if (foregroundStarted) {
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            }
        } catch (Throwable ignored) {
            // nic
        }
        foregroundStarted = false;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.recording_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.recording_channel_description));
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);
        nm.createNotificationChannel(channel);
    }

    private Notification buildNotification(@Nullable String title) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String text = title == null ? "" : title.trim();
        if (text.isEmpty()) {
            text = getString(R.string.recording_notification_text);
        } else if (text.length() > 120) {
            text = text.substring(0, 120);
        }

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notuja)
            .setColor(ContextCompat.getColor(this, R.color.notuja_brand))
            .setContentTitle(getString(R.string.recording_notification_title))
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setWhen(startedAt)
            .setUsesChronometer(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                return;
            }
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) {
                return;
            }
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Notuja:recording");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
        } catch (Throwable t) {
            Log.w(TAG, "Nie udało się założyć blokady wybudzenia", t);
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Throwable ignored) {
            // nic
        }
        wakeLock = null;
    }
}
