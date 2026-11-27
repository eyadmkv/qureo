package com.eyadmkv.qureo

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

object ProgressBus {
    val messages = MutableSharedFlow<String>(extraBufferCapacity = 256)
    val running = MutableStateFlow(false)

    fun post(message: String) {
        messages.tryEmit(message)
    }
}

class SolverService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.getStringExtra(EXTRA_ACTION)
        val notification = buildNotification("Preparing solver")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        if (ProgressBus.running.value) {
            ProgressBus.post("A solver task is already running.")
            stopSelf(startId)
            return START_NOT_STICKY
        }

        ProgressBus.running.value = true
        acquireWakeLock()
        scope.launch {
            try {
                when (action) {
                    ACTION_QUREO -> {
                        val target = intent?.getStringExtra(EXTRA_TARGET)?.takeIf { it.isNotBlank() }
                        val course = intent?.getStringExtra(EXTRA_COURSE) ?: "python_short_ar"
                        val single = intent?.getBooleanExtra(EXTRA_SINGLE, false) ?: false
                        val dryRun = intent?.getBooleanExtra(EXTRA_DRY_RUN, false) ?: false
                        val solver = QureoSolver(applicationContext, QureoClient(applicationContext), ::report)
                        solver.solveCourse(course, target, single, dryRun)
                    }
                    ACTION_SPRIX -> {
                        val subject = intent?.getStringExtra(EXTRA_SUBJECT) ?: "7"
                        val single = intent?.getBooleanExtra(EXTRA_SINGLE, false) ?: false
                        val dryRun = intent?.getBooleanExtra(EXTRA_DRY_RUN, false) ?: false
                        val solver = SprixSolver(applicationContext, SprixClient(applicationContext), ::report)
                        solver.solve(subject, single, dryRun)
                    }
                    else -> throw IllegalArgumentException("Unknown solver action.")
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                report("ERROR: ${error.message ?: error.javaClass.simpleName}")
            } finally {
                ProgressBus.running.value = false
                releaseWakeLock()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf(startId)
            }
        }
        return START_NOT_STICKY
    }

    private fun report(message: String) {
        ProgressBus.post(message)
        val notification = buildNotification(message.take(140))
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, notification)
    }

    private fun buildNotification(text: String): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("QUREO + SPRIX")
            .setContentText(text)
            .setOngoing(ProgressBus.running.value)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Course solver",
                NotificationManager.IMPORTANCE_LOW
            )
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
    }

    private fun acquireWakeLock() {
        val manager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "QureoAndroid:Solver")
            .apply { acquire(6 * 60 * 60 * 1000L) }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    override fun onDestroy() {
        releaseWakeLock()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val EXTRA_ACTION = "solver_action"
        const val EXTRA_TARGET = "target_chapter"
        const val EXTRA_COURSE = "course_id"
        const val EXTRA_SUBJECT = "subject_id"
        const val EXTRA_SINGLE = "single"
        const val EXTRA_DRY_RUN = "dry_run"
        const val ACTION_QUREO = "qureo"
        const val ACTION_SPRIX = "sprix"
        private const val CHANNEL_ID = "solver_tasks"
        private const val NOTIFICATION_ID = 5101

        fun start(
            context: Context,
            action: String,
            target: String? = null,
            subject: String? = null,
            course: String = "python_short_ar",
            single: Boolean = false,
            dryRun: Boolean = false
        ) {
            val intent = Intent(context, SolverService::class.java)
                .putExtra(EXTRA_ACTION, action)
                .putExtra(EXTRA_COURSE, course)
                .putExtra(EXTRA_SINGLE, single)
                .putExtra(EXTRA_DRY_RUN, dryRun)
            target?.let { intent.putExtra(EXTRA_TARGET, it) }
            subject?.let { intent.putExtra(EXTRA_SUBJECT, it) }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
