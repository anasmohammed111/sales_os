const { processDueReminders, runStuckCheck } = require('../services/admissions/reminders');

let running = false;

/** One pass: send due reminders (including any missed while asleep) and stuck alerts. */
const runAdmissionsJobs = async () => {
    if (running) return;
    running = true;
    try {
        const now = new Date();
        const reminders = await processDueReminders(now);
        const stuck = await runStuckCheck(now);
        if (reminders || stuck) {
            console.log(`[Admissions Job] Sent ${reminders} reminder(s) and ${stuck} stuck alert(s).`);
        }
    } catch (err) {
        console.error('[Admissions Job] Error:', err.message);
    } finally {
        running = false;
    }
};

/**
 * Runs shortly after startup, then every intervalSeconds (default 60).
 * State lives in MongoDB, so restarts and sleeping instances lose nothing.
 */
const startAdmissionsReminderJob = (intervalSeconds = Number(process.env.ADMISSIONS_JOB_INTERVAL_SECONDS) || 60) => {
    setTimeout(runAdmissionsJobs, 5000).unref?.();
    const timer = setInterval(runAdmissionsJobs, intervalSeconds * 1000);
    timer.unref?.();
    console.log(`[Admissions Job] Reminders and stuck alerts checked every ${intervalSeconds} seconds.`);
};

module.exports = { runAdmissionsJobs, startAdmissionsReminderJob };
