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

use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

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
const REPORT_PATH: &str = "/api/v1/client/device-state";

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
    /// A report failed for a reason worth a retry.
    ReportFailed,
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
    /// Start the controller thread. `initial_desired` is the dashboard value
    /// from the previous run (from `state.json`), used until the backend
    /// sends one. Returns after the first decision, so the first
    /// `client_hello` already carries the real state.
    pub fn start(initial_desired: bool, writer: StateWriter) -> Self {
        Self::start_with(
            super::platform(),
            super::read_local_choice,
            initial_desired,
            writer,
        )
    }

    pub(crate) fn start_with(
        platform: Option<Box<dyn Platform>>,
        read_local: fn() -> LocalChoice,
        initial_desired: bool,
        writer: StateWriter,
    ) -> Self {
        let (events, rx) = mpsc::channel();
        let status = Arc::new(Mutex::new(KeepAwakeStatus {
            local: LocalChoice::Auto,
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
            session: None,
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
}

struct Worker {
    platform: Option<Box<dyn Platform>>,
    read_local: fn() -> LocalChoice,
    rx: mpsc::Receiver<Event>,
    events: mpsc::Sender<Event>,
    status: Arc<Mutex<KeepAwakeStatus>>,
    resume: Arc<Resume>,
    writer: StateWriter,
    runtime: Option<tokio::runtime::Handle>,
    desired: bool,
    session: Option<Session>,
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
        let mut local = (self.read_local)();
        let mut on_battery = self.platform().on_battery();
        let mut last_config = Instant::now();
        let mut last_power = Instant::now();
        let mut unsupported_until: Option<Instant> = None;
        let mut published: Option<KeepAwakeStatus> = None;
        loop {
            // Decide and apply.
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
                Ok(Event::Desired(desired)) => self.desired = desired,
                Ok(Event::Session(Some((target, sent_local, sent_effective)))) => {
                    self.session = Some(Session {
                        target,
                        known: Some((sent_local, sent_effective)),
                        retry_after: None,
                    });
                }
                Ok(Event::Session(None)) => self.session = None,
                Ok(Event::ReportFailed) => {
                    if let Some(session) = self.session.as_mut() {
                        session.known = None;
                        session.retry_after = Some(Instant::now() + REPORT_RETRY);
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    self.platform().release();
                    return;
                }
            }

            let resumed = self.resume.tick();
            if last_config.elapsed() >= CONFIG_POLL {
                local = (self.read_local)();
                last_config = Instant::now();
            }
            if resumed || last_power.elapsed() >= POWER_POLL {
                on_battery = self.platform().on_battery();
                last_power = Instant::now();
            }
        }
    }

    fn publish_state(&self, status: KeepAwakeStatus) {
        let Some(runtime) = &self.runtime else {
            return;
        };
        let writer = self.writer.clone();
        runtime.spawn(async move {
            writer.update(|state| state.keep_awake = Some(status)).await;
        });
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
        let events = self.events.clone();
        runtime.spawn(async move {
            match report(&target, local, effective).await {
                Ok(Some(desired)) => {
                    let _ = events.send(Event::Desired(desired));
                }
                Ok(None) => {}
                Err(error) => {
                    warn!(%error, "keep-awake: could not report the state to the backend");
                    let _ = events.send(Event::ReportFailed);
                }
            }
        });
    }
}

#[derive(Serialize)]
struct ReportBody {
    keep_awake_local: LocalChoice,
    keep_awake_effective: Effective,
}

#[derive(Deserialize)]
struct ReportResponse {
    device_settings: sealgate_tunnel_protocol::DeviceSettings,
}

/// `PUT /api/v1/client/device-state`. Returns the dashboard value from the
/// response, `Ok(None)` when the backend does not know the endpoint or the
/// device (older backend, or no device row yet), and `Err` for failures
/// worth a retry.
async fn report(
    target: &ReportTarget,
    local: LocalChoice,
    effective: Effective,
) -> anyhow::Result<Option<bool>> {
    let base = crate::config::normalize_backend_url(&target.backend)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(crate::update::user_agent())
        .build()?;
    let response = client
        .put(format!("{base}{REPORT_PATH}"))
        .bearer_auth(&target.credential)
        .header("X-SealGate-Device-Id", &target.device_id)
        .json(&ReportBody {
            keep_awake_local: local,
            keep_awake_effective: effective,
        })
        .send()
        .await?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::METHOD_NOT_ALLOWED
    {
        debug!(%status, "keep-awake: the backend has no device state for this device");
        return Ok(None);
    }
    if !status.is_success() {
        anyhow::bail!("PUT {REPORT_PATH} returned HTTP {status}");
    }
    let body: ReportResponse = response.json().await?;
    Ok(Some(body.device_settings.keep_awake))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[derive(Clone, Default)]
    struct Fake {
        battery: Arc<AtomicBool>,
        refuse: Arc<AtomicBool>,
        holding: Arc<AtomicBool>,
        holds: Arc<AtomicUsize>,
    }

    impl Platform for Fake {
        fn on_battery(&mut self) -> bool {
            self.battery.load(Ordering::SeqCst)
        }
        fn hold(&mut self) -> Result<(), String> {
            if self.refuse.load(Ordering::SeqCst) {
                return Err("refused".into());
            }
            if !self.holding.swap(true, Ordering::SeqCst) {
                self.holds.fetch_add(1, Ordering::SeqCst);
            }
            Ok(())
        }
        fn release(&mut self) {
            self.holding.store(false, Ordering::SeqCst);
        }
    }

    fn writer() -> StateWriter {
        let path = std::env::temp_dir().join(format!(
            "sealgate-keep-awake-{}-{:?}.json",
            std::process::id(),
            std::thread::current().id()
        ));
        StateWriter::new_at(crate::state::State::default(), path)
    }

    fn wait_for(keep_awake: &KeepAwake, effective: Effective) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while keep_awake.status().unwrap().effective != effective {
            assert!(
                Instant::now() < deadline,
                "timed out waiting for {effective:?}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn auto() -> LocalChoice {
        LocalChoice::Auto
    }
    fn on() -> LocalChoice {
        LocalChoice::On
    }
    fn off() -> LocalChoice {
        LocalChoice::Off
    }

    #[test]
    fn follows_the_dashboard_in_auto() {
        let fake = Fake::default();
        let keep_awake = KeepAwake::start_with(Some(Box::new(fake.clone())), auto, false, writer());
        assert_eq!(keep_awake.status().unwrap().effective, Effective::Inactive);
        assert!(!fake.holding.load(Ordering::SeqCst));
        keep_awake.set_desired(true);
        wait_for(&keep_awake, Effective::Active);
        assert!(fake.holding.load(Ordering::SeqCst));
        keep_awake.set_desired(false);
        wait_for(&keep_awake, Effective::Inactive);
        assert!(!fake.holding.load(Ordering::SeqCst));
    }

    #[test]
    fn local_off_wins_over_the_dashboard() {
        let fake = Fake::default();
        let keep_awake = KeepAwake::start_with(Some(Box::new(fake.clone())), off, true, writer());
        assert_eq!(keep_awake.status().unwrap().effective, Effective::Inactive);
        assert_eq!(keep_awake.status().unwrap().local, LocalChoice::Off);
        assert!(!fake.holding.load(Ordering::SeqCst));
    }

    #[test]
    fn local_on_wins_over_the_dashboard() {
        let fake = Fake::default();
        let keep_awake = KeepAwake::start_with(Some(Box::new(fake.clone())), on, false, writer());
        assert_eq!(keep_awake.status().unwrap().effective, Effective::Active);
        assert!(fake.holding.load(Ordering::SeqCst));
    }

    #[test]
    fn battery_releases_the_block() {
        let fake = Fake::default();
        fake.battery.store(true, Ordering::SeqCst);
        let keep_awake = KeepAwake::start_with(Some(Box::new(fake.clone())), on, false, writer());
        assert_eq!(keep_awake.status().unwrap().effective, Effective::OnBattery);
        assert!(!fake.holding.load(Ordering::SeqCst));
    }

    #[test]
    fn refused_block_reports_unsupported() {
        let fake = Fake::default();
        fake.refuse.store(true, Ordering::SeqCst);
        let keep_awake = KeepAwake::start_with(Some(Box::new(fake.clone())), on, false, writer());
        assert_eq!(
            keep_awake.status().unwrap().effective,
            Effective::Unsupported
        );
    }

    #[test]
    fn resume_flag_is_set_and_cleared() {
        let keep_awake =
            KeepAwake::start_with(Some(Box::new(Fake::default())), auto, false, writer());
        assert!(!keep_awake.slept_since_last_session());
        keep_awake.note_resume();
        assert!(keep_awake.slept_since_last_session());
        keep_awake.clear_resume();
        assert!(!keep_awake.slept_since_last_session());
    }

    #[test]
    fn without_a_platform_only_resume_detection_runs() {
        let keep_awake = KeepAwake::start_with(None, on, true, writer());
        // No keep-awake status, so client_hello sends no keep-awake fields.
        assert!(keep_awake.status().is_none());
        keep_awake.set_desired(true);
        assert!(keep_awake.status().is_none());
        // Sleep detection still works for the offline-failure tracking.
        keep_awake.note_resume();
        assert!(keep_awake.slept_since_last_session());
    }

    #[test]
    fn a_wall_clock_gap_counts_before_the_next_tick() {
        let resume = Resume::new();
        assert!(!resume.slept());
        // The machine slept: the last tick lies far in the past by the wall
        // clock, and the thread has not ticked since the resume.
        *resume.last_tick.lock().unwrap() = SystemTime::now() - Duration::from_secs(120);
        assert!(resume.slept());
        // After server_hello, the same gap is not reported again.
        resume.clear();
        assert!(!resume.slept());
        assert!(!resume.tick());
    }

    #[test]
    fn a_tick_after_a_gap_sets_the_flag() {
        let resume = Resume::new();
        *resume.last_tick.lock().unwrap() = SystemTime::now() - Duration::from_secs(120);
        assert!(resume.tick());
        assert!(resume.slept());
    }
}
