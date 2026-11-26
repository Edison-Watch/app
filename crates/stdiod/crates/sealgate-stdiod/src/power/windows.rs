//! Windows: `SetThreadExecutionState` on the controller thread.
//!
//! `ES_SYSTEM_REQUIRED` with `ES_CONTINUOUS` stops the idle timer from putting
//! the system to sleep until the same thread clears it, or the process exits.
//! It does not keep the display on and does not stop a lid close or a sleep
//! that the user starts. It needs no admin rights.

use windows_sys::Win32::System::Power::{
    GetSystemPowerStatus, SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    SYSTEM_POWER_STATUS,
};

#[derive(Default)]
pub(crate) struct WindowsPower {
    holding: bool,
}

impl super::Platform for WindowsPower {
    fn on_battery(&mut self) -> bool {
        // SAFETY: GetSystemPowerStatus writes into the struct we pass.
        let mut status: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
        if unsafe { GetSystemPowerStatus(&mut status) } == 0 {
            return false;
        }
        // 0 = offline (battery), 1 = online, 255 = unknown.
        status.ACLineStatus == 0
    }

    fn hold(&mut self) -> Result<(), String> {
        if self.holding {
            return Ok(());
        }
        // SAFETY: plain flag call; the state belongs to the calling thread.
        let previous = unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
        if previous == 0 {
            return Err("SetThreadExecutionState refused the sleep block".into());
        }
        self.holding = true;
        Ok(())
    }

    fn release(&mut self) {
        if self.holding {
            // SAFETY: as above; ES_CONTINUOUS alone clears the requirement.
            // A failed call returns 0 and leaves the requirement in place, so
            // `holding` stays true and the next tick tries again.
            if unsafe { SetThreadExecutionState(ES_CONTINUOUS) } != 0 {
                self.holding = false;
            }
        }
    }
}
