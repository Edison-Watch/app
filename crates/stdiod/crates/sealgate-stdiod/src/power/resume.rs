//! Resume-from-sleep detection for the `last_gap_was_sleep` flag
//! (PROTOCOL.md T-79). The keep-awake thread ticks it, the heartbeat reports
//! resumes it sees, and `client_hello` takes a snapshot of it.

use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use tracing::info;

/// A wall-clock gap between ticks larger than this means the machine slept.
/// It matches the heartbeat's resume gap in `daemon.rs`.
pub(crate) const RESUME_GAP: Duration = Duration::from_secs(45);

/// Resume detection shared by the controller thread, the heartbeat and the
/// code that builds `client_hello`.
pub(crate) struct Resume {
    state: Mutex<ResumeState>,
    /// Wall-clock time of the controller thread's last tick.
    pub(crate) last_tick: Mutex<SystemTime>,
}

#[derive(Default)]
struct ResumeState {
    /// A resume was seen that the backend has not received yet.
    pending: bool,
    /// Counts every resume seen, so clearing after `server_hello` does not
    /// erase a resume that came in after the `client_hello` was built.
    seq: u64,
}

/// What a `client_hello` carried about sleep. Pass it back to
/// [`KeepAwake::clear_resume`] when the session's `server_hello` arrives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResumeToken {
    pub slept: bool,
    seq: u64,
}

impl Resume {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(ResumeState::default()),
            last_tick: Mutex::new(SystemTime::now()),
        }
    }

    pub(crate) fn note(&self) {
        let mut state = self.state.lock().expect("resume lock");
        state.pending = true;
        state.seq += 1;
    }

    /// Record a tick. Returns true when the gap since the previous tick
    /// means the machine slept.
    pub(crate) fn tick(&self) -> bool {
        let now = SystemTime::now();
        let gap = {
            let mut last = self.last_tick.lock().expect("resume lock");
            let gap = now.duration_since(*last).unwrap_or_default();
            *last = now;
            gap
        };
        let resumed = gap > RESUME_GAP;
        if resumed {
            info!(?gap, "keep-awake: the machine resumed from sleep");
            self.note();
        }
        resumed
    }

    /// How many resumes were seen so far.
    pub(crate) fn seq(&self) -> u64 {
        self.state.lock().expect("resume lock").seq
    }

    /// The flag for the next `client_hello`. It ticks first, so a resume
    /// that the thread has not ticked over yet (a reconnect right after
    /// waking) counts too.
    pub(crate) fn snapshot(&self) -> ResumeToken {
        self.tick();
        let state = self.state.lock().expect("resume lock");
        ResumeToken {
            slept: state.pending,
            seq: state.seq,
        }
    }

    /// The backend has the flag from `token`. Clear it, unless another
    /// resume was seen after the token was taken.
    pub(crate) fn clear(&self, token: ResumeToken) {
        let mut state = self.state.lock().expect("resume lock");
        if state.seq == token.seq {
            state.pending = false;
        }
    }
}
