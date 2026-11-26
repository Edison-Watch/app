//! Tests for the keep-awake controller (`controller.rs`).

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

fn auto() -> Result<LocalChoice, String> {
    Ok(LocalChoice::Auto)
}
fn on() -> Result<LocalChoice, String> {
    Ok(LocalChoice::On)
}
fn off() -> Result<LocalChoice, String> {
    Ok(LocalChoice::Off)
}
fn unreadable() -> Result<LocalChoice, String> {
    Err("config.toml: invalid TOML".into())
}

#[test]
fn follows_the_dashboard_in_auto() {
    let fake = Fake::default();
    let keep_awake = KeepAwake::start_with(
        Some(Box::new(fake.clone())),
        auto,
        false,
        LocalChoice::Auto,
        writer(),
    );
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
    let keep_awake = KeepAwake::start_with(
        Some(Box::new(fake.clone())),
        off,
        true,
        LocalChoice::Auto,
        writer(),
    );
    assert_eq!(keep_awake.status().unwrap().effective, Effective::Inactive);
    assert_eq!(keep_awake.status().unwrap().local, LocalChoice::Off);
    assert!(!fake.holding.load(Ordering::SeqCst));
}

#[test]
fn local_on_wins_over_the_dashboard() {
    let fake = Fake::default();
    let keep_awake = KeepAwake::start_with(
        Some(Box::new(fake.clone())),
        on,
        false,
        LocalChoice::Auto,
        writer(),
    );
    assert_eq!(keep_awake.status().unwrap().effective, Effective::Active);
    assert!(fake.holding.load(Ordering::SeqCst));
}

#[test]
fn battery_releases_the_block() {
    let fake = Fake::default();
    fake.battery.store(true, Ordering::SeqCst);
    let keep_awake = KeepAwake::start_with(
        Some(Box::new(fake.clone())),
        on,
        false,
        LocalChoice::Auto,
        writer(),
    );
    assert_eq!(keep_awake.status().unwrap().effective, Effective::OnBattery);
    assert!(!fake.holding.load(Ordering::SeqCst));
}

#[test]
fn refused_block_reports_unsupported() {
    let fake = Fake::default();
    fake.refuse.store(true, Ordering::SeqCst);
    let keep_awake = KeepAwake::start_with(
        Some(Box::new(fake.clone())),
        on,
        false,
        LocalChoice::Auto,
        writer(),
    );
    assert_eq!(
        keep_awake.status().unwrap().effective,
        Effective::Unsupported
    );
}

#[test]
fn resume_flag_is_set_and_cleared() {
    let keep_awake = KeepAwake::start_with(
        Some(Box::new(Fake::default())),
        auto,
        false,
        LocalChoice::Auto,
        writer(),
    );
    assert!(!keep_awake.slept_since_last_session());
    keep_awake.note_resume();
    assert!(keep_awake.slept_since_last_session());
    keep_awake.clear_resume();
    assert!(!keep_awake.slept_since_last_session());
}

#[test]
fn without_a_platform_only_resume_detection_runs() {
    let keep_awake = KeepAwake::start_with(None, on, true, LocalChoice::Auto, writer());
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

fn target() -> ReportTarget {
    ReportTarget {
        backend: "http://localhost:3001".into(),
        credential: "test".into(),
        device_id: "dev".into(),
    }
}

fn worker() -> Worker {
    let (events, rx) = mpsc::channel();
    Worker {
        platform: Some(Box::new(Fake::default())),
        read_local: auto,
        rx,
        events,
        status: Arc::new(Mutex::new(KeepAwakeStatus {
            local: LocalChoice::Auto,
            desired: false,
            effective: Effective::Inactive,
        })),
        resume: Arc::new(Resume::new()),
        writer: writer(),
        runtime: None,
        desired: false,
        desired_version: 0,
        local: LocalChoice::Auto,
        config_unreadable: false,
        session: None,
        generation: 0,
    }
}

#[test]
fn a_late_report_from_an_earlier_session_is_dropped() {
    let mut worker = worker();
    worker.handle(Event::Session(Some((
        target(),
        LocalChoice::Auto,
        Effective::Inactive,
    ))));
    let first = worker.generation;
    // The first session ends and a new one starts with keep_awake = false.
    worker.handle(Event::Session(None));
    worker.handle(Event::Session(Some((
        target(),
        LocalChoice::Auto,
        Effective::Inactive,
    ))));
    worker.handle(Event::Desired(false));
    // The first session's report finishes late with keep_awake = true.
    worker.handle(Event::Reported {
        generation: first,
        version: worker.desired_version,
        result: ReportResult::Desired(true),
    });
    assert!(!worker.desired);
    // A result from the current session is applied.
    worker.handle(Event::Reported {
        generation: worker.generation,
        version: worker.desired_version,
        result: ReportResult::Desired(true),
    });
    assert!(worker.desired);
}

#[test]
fn a_report_response_older_than_a_dashboard_change_is_dropped() {
    let mut worker = worker();
    worker.handle(Event::Session(Some((
        target(),
        LocalChoice::Auto,
        Effective::Inactive,
    ))));
    // A report is sent; the backend still has keep_awake = true.
    let sent_at = worker.desired_version;
    // The dashboard turns it off before the report's response arrives.
    worker.handle(Event::Desired(false));
    worker.handle(Event::Reported {
        generation: worker.generation,
        version: sent_at,
        result: ReportResult::Desired(true),
    });
    assert!(!worker.desired);
}

#[test]
fn an_unreadable_config_keeps_the_choice_from_the_last_run() {
    let fake = Fake::default();
    let keep_awake = KeepAwake::start_with(
        Some(Box::new(fake.clone())),
        unreadable,
        false,
        LocalChoice::On,
        writer(),
    );
    let status = keep_awake.status().unwrap();
    assert_eq!(status.local, LocalChoice::On);
    assert_eq!(status.effective, Effective::Active);
}
