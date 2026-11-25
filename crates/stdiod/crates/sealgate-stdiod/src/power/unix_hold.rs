//! A sleep block held by a helper process (macOS `caffeinate`, Linux
//! `systemd-inhibit`). The block lasts while the helper runs. Each helper
//! watches the daemon's PID and exits with it, so a crashed daemon never
//! leaves a block behind.

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

/// How long a helper must stay up before the block counts as taken. A
/// helper that the OS refuses exits at once with an error.
const STARTUP_CHECK: Duration = Duration::from_millis(400);

pub(crate) struct HelperHold {
    program: &'static str,
    args: Vec<String>,
    child: Option<Child>,
}

impl HelperHold {
    pub(crate) fn new(program: &'static str, args: Vec<String>) -> Self {
        Self {
            program,
            args,
            child: None,
        }
    }

    pub(crate) fn hold(&mut self) -> Result<(), String> {
        if self.is_holding() {
            return Ok(());
        }
        let mut child = Command::new(self.program)
            .args(&self.args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("could not start {}: {error}", self.program))?;
        std::thread::sleep(STARTUP_CHECK);
        match child.try_wait() {
            Ok(None) => {
                self.child = Some(child);
                Ok(())
            }
            Ok(Some(status)) => {
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut stderr);
                }
                Err(format!(
                    "{} exited ({status}): {}",
                    self.program,
                    stderr.trim()
                ))
            }
            Err(error) => Err(format!("could not watch {}: {error}", self.program)),
        }
    }

    pub(crate) fn release(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub(crate) fn is_holding(&mut self) -> bool {
        match self.child.as_mut().map(Child::try_wait) {
            Some(Ok(None)) => true,
            Some(_) => {
                self.child = None;
                false
            }
            None => false,
        }
    }
}

impl Drop for HelperHold {
    fn drop(&mut self) {
        self.release();
    }
}
