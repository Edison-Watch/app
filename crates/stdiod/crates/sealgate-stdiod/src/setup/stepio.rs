//! How the Windows setup program follows a step it started in the background.
//!
//! The release daemon has no console, and the wizard must stay responsive
//! while a step waits for the person (the browser sign-in, Beeper's Allow).
//! So the wizard starts the step without waiting and watches three files:
//! `--output-file` (what the step prints), `--exit-code-file` (written once,
//! on every way out) and `--stop-file` (the wizard creates it on Stop).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

/// The exit code of a command stopped through `--stop-file`.
pub const EXIT_STOPPED: i32 = 130;

static EXIT_CODE_FILE: OnceLock<PathBuf> = OnceLock::new();

pub fn set_exit_code_file(path: PathBuf) {
    let _ = EXIT_CODE_FILE.set(path);
}

pub fn has_exit_code_file() -> bool {
    EXIT_CODE_FILE.get().is_some()
}

/// Exit with `code`, recording it first for whoever started this process.
pub fn exit(code: i32) -> ! {
    flush_streams();
    #[cfg(windows)]
    finish_output();
    if let Some(path) = EXIT_CODE_FILE.get() {
        publish(path, code.to_string().as_bytes());
    }
    std::process::exit(code)
}

/// Flush stdout and stderr, giving up after half a second: a command can
/// hold the stdout lock for its whole run (`logs --follow`), and a stop must
/// not wait on it forever.
fn flush_streams() {
    use std::io::Write;
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = std::io::stdout().flush();
        let _ = std::io::stderr().flush();
        let _ = done_tx.send(());
    });
    let _ = done_rx.recv_timeout(Duration::from_millis(500));
}

/// `path` + ".partial": where a file is written before it is renamed into place.
fn partial(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".partial");
    PathBuf::from(name)
}

/// Write `bytes` to `path` by renaming a finished file into place, so a
/// reader only ever sees a whole file and never finds it held open. The
/// rename can fail for a moment while a reader has the old one open; it is
/// retried briefly, and the next publish carries everything anyway.
fn publish(path: &Path, bytes: &[u8]) {
    let staged = partial(path);
    if std::fs::write(&staged, bytes).is_err() {
        return;
    }
    for _ in 0..20 {
        if std::fs::rename(&staged, path).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Exit with [`EXIT_STOPPED`] as soon as `path` exists.
pub fn watch_stop_file(path: PathBuf) {
    tokio::spawn(async move {
        loop {
            if path.exists() {
                exit(EXIT_STOPPED);
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    });
}

/// The pipe end stdout and stderr write to, and the signal that everything
/// read from the pipe has been published.
#[cfg(windows)]
static OUTPUT_PIPE: std::sync::Mutex<Option<(usize, std::sync::mpsc::Receiver<()>)>> =
    std::sync::Mutex::new(None);

/// Send this process's stdout and stderr to `path`, kept current while the
/// step runs: they write into a pipe, and a thread re-publishes everything
/// read so far after each chunk. Rust's standard streams look the handle up
/// on every write, so this covers everything printed afterwards, logs
/// included.
#[cfg(windows)]
pub fn redirect_output(path: &Path) -> std::io::Result<()> {
    use std::io::Read;
    use std::os::windows::io::FromRawHandle;
    use windows_sys::Win32::System::Console::{SetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE};
    use windows_sys::Win32::System::Pipes::CreatePipe;

    let (mut read, mut write) = (std::ptr::null_mut(), std::ptr::null_mut());
    // SAFETY: both out-params are valid; no security attributes.
    if unsafe { CreatePipe(&mut read, &mut write, std::ptr::null(), 0) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: `write` is the open pipe end created above, closed in
    // finish_output.
    let ok = unsafe {
        SetStdHandle(STD_OUTPUT_HANDLE, write) != 0 && SetStdHandle(STD_ERROR_HANDLE, write) != 0
    };
    if !ok {
        return Err(std::io::Error::last_os_error());
    }
    publish(path, b"");
    let path = path.to_path_buf();
    // Handles are raw pointers, not Send; the pump owns the read end alone.
    let read = read as usize;
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        // SAFETY: the read end created above, owned (and closed) here only.
        let mut pipe = unsafe { std::fs::File::from_raw_handle(read as _) };
        let (mut seen, mut buf) = (Vec::new(), [0u8; 4096]);
        while let Ok(n) = pipe.read(&mut buf) {
            if n == 0 {
                break;
            }
            seen.extend_from_slice(&buf[..n]);
            publish(&path, &seen);
        }
        let _ = done_tx.send(());
    });
    if let Ok(mut slot) = OUTPUT_PIPE.lock() {
        *slot = Some((write as usize, done_rx));
    }
    Ok(())
}

/// Close our end of the output pipe and wait for the last of it to be
/// published. Bounded: a child that inherited the pipe (a browser opened
/// for sign-in) can keep it open after we are done.
#[cfg(windows)]
fn finish_output() {
    use windows_sys::Win32::Foundation::CloseHandle;
    let Some((write, done)) = OUTPUT_PIPE.lock().ok().and_then(|mut slot| slot.take()) else {
        return;
    };
    // SAFETY: our write end, taken out of the slot so it is closed once.
    unsafe { CloseHandle(write as _) };
    let _ = done.recv_timeout(Duration::from_secs(2));
}

/// Only the Windows setup program asks for this.
#[cfg(not(windows))]
pub fn redirect_output(_path: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "--output-file is only supported on Windows",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_file_stages_under_its_own_name() {
        assert_eq!(
            partial(Path::new("C:/tmp/step.rc")),
            PathBuf::from("C:/tmp/step.rc.partial")
        );
        assert_eq!(
            partial(Path::new("C:/tmp/step.out")),
            PathBuf::from("C:/tmp/step.out.partial")
        );
    }

    #[test]
    fn publish_replaces_the_whole_file() {
        let path = std::env::temp_dir().join(format!("stepio-{}.out", std::process::id()));
        publish(&path, b"first");
        publish(&path, b"first and more");
        assert_eq!(std::fs::read(&path).unwrap(), b"first and more");
        assert!(!partial(&path).exists());
        let _ = std::fs::remove_file(&path);
    }
}
