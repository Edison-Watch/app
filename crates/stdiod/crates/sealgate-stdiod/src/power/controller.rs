//! The keep-awake controller thread.
//!
//! One OS thread owns the [`Platform`] backend for the whole daemon lifetime
//! (across tunnel reconnects). It combines three inputs:
//!
//! - the dashboard value, from `server_hello` / `device_settings_update` /
//!   the `PUT /api/v1/client/device-state` response;
//! - the local choice, read from `config.toml` every [`CONFIG_POLL`], so a
//!   `sealgate-stdiod keep-awake ...` call or a desktop toggle takes effect
//!   without a restart;
//! - the power source, read every [`POWER_POLL`] and after a resume.
//!
//! It holds or releases the OS block, writes `state.json`, and, while a tunnel
//! session is up, reports changes of the local choice or the effective state
//! to the backend. The `client_hello` carries the same two values at each
//! connect, so a change while disconnected reaches the backend at reconnect.
//!
//! The thread also notices a resume from sleep (a wall-clock jump), so the
//! next `client_hello` can say that the last disconnect was a sleep.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use tracing::{debug, info, warn};

use super::report::report;
use super::{Effective, KeepAwakeStatus, LocalChoice, Platform};
use crate::state::StateWriter;

/// How often the thread wakes up when nothing happens.
const TICK: Duration = Duration::from_secs(5);
const CONFIG_POLL: Duration = Duration::from_secs(5);
const POWER_POLL: Duration = Duration::from_secs(30);
/// After the OS refuses the block, try again this much later.
const UNSUPPORTED_RETRY: Duration = Duration::from_secs(600);
/// After a failed report, try again this much later.
const REPORT_RETRY: Duration = Duration::from_secs(60);
/// A wall-clock gap between ticks larger than this means the machine slept.
/// It matches the heartbeat's resume gap in `daemon.rs`.
const RESUME_GAP: Duration = Duration::from_secs(45);

/// Where to report state changes: the backend and credential of the tunnel
/// session that is up now.
#[derive(Clone)]
pub struct ReportTarget {
    pub backend: String,
    pub credential: String,
    pub device_id: String,
}

enum Event {
    /// The dashboard value.
    Desired(bool),
    /// A tunnel session came up (`Some`, with the values its `client_hello`
    /// sent) or went down (`None`).
    Session(Option<(ReportTarget, LocalChoice, Effective)>),
    /// A report finished. `generation` is the session that sent it, so a
    /// late result from an earlier session cannot overwrite the current
    /// session's dashboard value.
    Reported {
        generation: u64,
        /// The dashboard-value version when the report was sent. A newer
        /// `device_settings_update` makes the response's value outdated.
        version: u64,
        result: ReportResult,
    },
}

enum ReportResult {
    /// The dashboard value from the response.
    Desired(bool),
    /// A failure worth a retry.
    Failed,
}

/// Resume detection shared by the controller thread, the heartbeat and the
/// code that builds `client_hello`.
pub(crate) struct Resume {
    /// Set when a resume was seen since the last `server_hello`.
    slept: AtomicBool,
    /// Wall-clock time of the controller thread's last tick.
    last_tick: Mutex<SystemTime>,
}

impl Resume {
    fn new() -> Self {
        Self {
            slept: AtomicBool::new(false),
            last_tick: Mutex::new(SystemTime::now()),
        }
    }

    /// Record a tick. Returns true when the gap since the previous tick
    /// means the machine slept.
    fn tick(&self) -> bool {
        let now = SystemTime::now();
        let mut last = self.last_tick.lock().expect("resume lock");
        let gap = now.duration_since(*last).unwrap_or_default();
        *last = now;
        if gap > RESUME_GAP {
            info!(?gap, "keep-awake: the machine resumed from sleep");
            self.slept.store(true, Ordering::SeqCst);
        }
        gap > RESUME_GAP
    }

    /// True when a resume was seen, or when the thread has not ticked for
    /// longer than [`RESUME_GAP`] by the wall clock. The second check
    /// covers a reconnect that happens right after a resume, before the
    /// thread's next tick.
    fn slept(&self) -> bool {
        if self.slept.load(Ordering::SeqCst) {
            return true;
        }
        let last = *self.last_tick.lock().expect("resume lock");
        SystemTime::now()
            .duration_since(last)
            .is_ok_and(|gap| gap > RESUME_GAP)
    }

    /// The backend has the flag. Restart the gap from now, so the gap that
    /// was just reported is not reported again by the next tick.
    fn clear(&self) {
        *self.last_tick.lock().expect("resume lock") = SystemTime::now();
        self.slept.store(false, Ordering::SeqCst);
    }
}

/// Handle to the controller thread. Cheap to clone.
#[derive(Clone)]
pub struct KeepAwake {
    events: mpsc::Sender<Event>,
    status: Arc<Mutex<KeepAwakeStatus>>,
    resume: Arc<Resume>,
    /// False where keep-awake is not offered (every OS except Windows). The
    /// thread then only detects resumes from sleep.
    enabled: bool,
}

impl KeepAwake {
    /// Start the controller thread. `previous` is the keep-awake status from
    /// the previous run (from `state.json`): its dashboard value applies until
    /// the backend sends one, and its local choice applies while
    /// `config.toml` cannot be read. Returns after the first decision, so the
    /// first `client_hello` already carries the real state.
    pub fn start(previous: Option<KeepAwakeStatus>, writer: StateWriter) -> Self {
        Self::start_with(
            super::platform(),
            super::read_local_choice,
            previous.is_some_and(|status| status.desired),
            previous.map(|status| status.local).unwrap_or_default(),
            writer,
        )
    }

    pub(crate) fn start_with(
        platform: Option<Box<dyn Platform>>,
        read_local: fn() -> Result<LocalChoice, String>,
        initial_desired: bool,
        initial_local: LocalChoice,
        writer: StateWriter,
    ) -> Self {
        let (events, rx) = mpsc::channel();
        let status = Arc::new(Mutex::new(KeepAwakeStatus {
            local: initial_local,
            desired: initial_desired,
            effective: Effective::Inactive,
        }));
        let handle = Self {
            events,
            status: status.clone(),
            resume: Arc::new(Resume::new()),
            enabled: platform.is_some(),
        };
        let (ready_tx, ready_rx) = mpsc::channel();
        let worker = Worker {
            platform,
            read_local,
            rx,
            events: handle.events.clone(),
            status,
            resume: handle.resume.clone(),
            writer,
            runtime: tokio::runtime::Handle::try_current().ok(),
            desired: initial_desired,
            desired_version: 0,
            local: initial_local,
            config_unreadable: false,
            session: None,
            generation: 0,
        };
        std::thread::Builder::new()
            .name("keep-awake".into())
            .spawn(move || worker.run(ready_tx))
            .expect("spawn keep-awake thread");
        let _ = ready_rx.recv_timeout(Duration::from_secs(3));
        handle
    }

    /// The current status, or `None` where keep-awake is not offered.
    pub fn status(&self) -> Option<KeepAwakeStatus> {
        self.enabled
            .then(|| *self.status.lock().expect("keep-awake status lock"))
    }

    /// The dashboard value from `server_hello` or `device_settings_update`.
    pub fn set_desired(&self, desired: bool) {
        let _ = self.events.send(Event::Desired(desired));
    }

    /// A tunnel session is up (after `server_hello`). `sent` is the status
    /// that its `client_hello` carried; the controller reports at once if the
    /// status changed since then.
    pub fn session_started(&self, target: ReportTarget, sent: KeepAwakeStatus) {
        let _ = self
            .events
            .send(Event::Session(Some((target, sent.local, sent.effective))));
    }

    pub fn session_ended(&self) {
        let _ = self.events.send(Event::Session(None));
    }

    /// Record that the machine just resumed from sleep.
    pub fn note_resume(&self) {
        self.resume.slept.store(true, Ordering::SeqCst);
    }

    /// True when the machine slept since the last `server_hello`.
    pub fn slept_since_last_session(&self) -> bool {
        self.resume.slept()
    }

    /// The backend received the sleep flag (it sent `server_hello`).
    pub fn clear_resume(&self) {
        self.resume.clear();
    }
}

struct Session {
    target: ReportTarget,
    /// The (local, effective) pair the backend has, or `None` after a failed
    /// report.
    known: Option<(LocalChoice, Effective)>,
    retry_after: Option<Instant>,
    generation: u64,
}

struct Worker {
    platform: Option<Box<dyn Platform>>,
    read_local: fn() -> Result<LocalChoice, String>,
    rx: mpsc::Receiver<Event>,
    events: mpsc::Sender<Event>,
    status: Arc<Mutex<KeepAwakeStatus>>,
    resume: Arc<Resume>,
    writer: StateWriter,
    runtime: Option<tokio::runtime::Handle>,
    desired: bool,
    /// Bumped whenever `desired` changes, so a report response that was sent
    /// before the change cannot restore the older value.
    desired_version: u64,
    /// The last local choice read from `config.toml`.
    local: LocalChoice,
    /// True while `config.toml` cannot be read, so the warning is logged once.
    config_unreadable: bool,
    session: Option<Session>,
    /// Bumped on every session start and end.
    generation: u64,
}

impl Worker {
    fn run(self, ready: mpsc::Sender<()>) {
        match self.platform {
            Some(_) => self.run_keep_awake(ready),
            None => self.run_resume_only(ready),
        }
    }

    /// Where keep-awake is not offered: only detect resumes from sleep.
    fn run_resume_only(self, ready: mpsc::Sender<()>) {
        let _ = ready.send(());
        loop {
            match self.rx.recv_timeout(TICK) {
                Ok(_) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            self.resume.tick();
        }
    }

    fn platform(&mut self) -> &mut dyn Platform {
        self.platform
            .as_deref_mut()
            .expect("keep-awake runs only with a platform")
    }

    fn run_keep_awake(mut self, ready: mpsc::Sender<()>) {
        self.read_config();
        let mut on_battery = self.platform().on_battery();
        let mut last_config = Instant::now();
        let mut last_power = Instant::now();
        let mut unsupported_until: Option<Instant> = None;
        let mut published: Option<KeepAwakeStatus> = None;
        loop {
            // Decide and apply.
            let local = self.local;
            let wants = local.wants_awake(self.desired);
            let effective = if !wants {
                self.platform().release();
                unsupported_until = None;
                Effective::Inactive
            } else if on_battery {
                self.platform().release();
                Effective::OnBattery
            } else if unsupported_until.is_some_and(|until| Instant::now() < until) {
                Effective::Unsupported
            } else {
                match self.platform().hold() {
                    Ok(()) => {
                        unsupported_until = None;
                        Effective::Active
                    }
                    Err(error) => {
                        warn!(%error, "keep-awake: the OS refused the sleep block");
                        unsupported_until = Some(Instant::now() + UNSUPPORTED_RETRY);
                        Effective::Unsupported
                    }
                }
            };
            let status = KeepAwakeStatus {
                local,
                desired: self.desired,
                effective,
            };
            if published != Some(status) {
                info!(
                    local = local.as_str(),
                    desired = self.desired,
                    effective = effective.as_str(),
                    "keep-awake state"
                );
                *self.status.lock().expect("keep-awake status lock") = status;
                self.publish_state(status);
                if published.is_none() {
                    let _ = ready.send(());
                }
                published = Some(status);
            }
            self.report_if_needed(local, effective);

            // Wait for an event or the next tick.
            match self.rx.recv_timeout(TICK) {
                Ok(event) => self.handle(event),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    self.platform().release();
                    return;
                }
            }

            let resumed = self.resume.tick();
            if last_config.elapsed() >= CONFIG_POLL {
                self.read_config();
                last_config = Instant::now();
            }
            if resumed || last_power.elapsed() >= POWER_POLL {
                on_battery = self.platform().on_battery();
                last_power = Instant::now();
            }
        }
    }

    /// Read the local choice. An unreadable file keeps the last choice, and
    /// the warning is logged once per failure, not on every poll.
    fn read_config(&mut self) {
        match (self.read_local)() {
            Ok(local) => {
                if self.config_unreadable {
                    info!("keep-awake: config.toml can be read again");
                }
                self.config_unreadable = false;
                self.local = local;
            }
            Err(error) => {
                if !self.config_unreadable {
                    warn!(%error, "keep-awake: cannot read config.toml; keeping the last choice");
                }
                self.config_unreadable = true;
            }
        }
    }

    fn set_desired(&mut self, desired: bool) {
        self.desired = desired;
        self.desired_version += 1;
    }

    fn handle(&mut self, event: Event) {
        match event {
            Event::Desired(desired) => self.set_desired(desired),
            Event::Session(started) => {
                self.generation += 1;
                self.session = started.map(|(target, sent_local, sent_effective)| Session {
                    target,
                    known: Some((sent_local, sent_effective)),
                    retry_after: None,
                    generation: self.generation,
                });
            }
            Event::Reported {
                generation,
                version,
                result,
            } => {
                let Some(session) = self
                    .session
                    .as_mut()
                    .filter(|session| session.generation == generation)
                else {
                    debug!("keep-awake: dropping a report result from an earlier session");
                    return;
                };
                match result {
                    // A newer dashboard value, or a newer report response,
                    // arrived after this report was sent.
                    ReportResult::Desired(_) if version != self.desired_version => {
                        debug!("keep-awake: dropping an outdated report response");
                    }
                    ReportResult::Desired(desired) => self.set_desired(desired),
                    ReportResult::Failed => {
                        session.known = None;
                        session.retry_after = Some(Instant::now() + REPORT_RETRY);
                    }
                }
            }
        }
    }

    /// Write `state.json` from this thread and wait for it, so that two
    /// quick changes reach the file in order.
    fn publish_state(&self, status: KeepAwakeStatus) {
        let Some(runtime) = &self.runtime else {
            return;
        };
        runtime.block_on(self.writer.update(|state| state.keep_awake = Some(status)));
    }

    fn report_if_needed(&mut self, local: LocalChoice, effective: Effective) {
        let Some(runtime) = self.runtime.clone() else {
            return;
        };
        let Some(session) = self.session.as_mut() else {
            return;
        };
        if session.known == Some((local, effective)) {
            return;
        }
        if session
            .retry_after
            .is_some_and(|after| Instant::now() < after)
        {
            return;
        }
        session.known = Some((local, effective));
        session.retry_after = None;
        let target = session.target.clone();
        let generation = session.generation;
        let version = self.desired_version;
        let events = self.events.clone();
        runtime.spawn(async move {
            let result = match report(&target, local, effective).await {
                Ok(Some(desired)) => ReportResult::Desired(desired),
                Ok(None) => return,
                Err(error) => {
                    warn!(%error, "keep-awake: could not report the state to the backend");
                    ReportResult::Failed
                }
            };
            let _ = events.send(Event::Reported {
                generation,
                version,
                result,
            });
        });
    }
}

#[cfg(test)]
#[path = "controller_tests.rs"]
mod tests;
