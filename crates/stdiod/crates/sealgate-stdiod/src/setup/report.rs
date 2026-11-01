//! What a setup step tells its caller: readable lines for a person in a
//! terminal, or one JSON object per line for the installer that drives it.

use std::io::Write;

use serde_json::{json, Value};

pub struct Reporter {
    json: bool,
}

impl Reporter {
    pub fn new(json: bool) -> Self {
        Self { json }
    }

    pub fn ok(&self, message: &str) {
        self.line("ok", "   + ", message);
    }

    pub fn info(&self, message: &str) {
        self.line("info", "   - ", message);
    }

    pub fn warn(&self, message: &str) {
        self.line("warn", "   ! ", message);
    }

    /// Something only the person can do, such as clicking Allow.
    pub fn action(&self, message: &str) {
        self.line("action", "   action: ", message);
    }

    /// How far a long step has got: a progress event, or a "downloaded N%"
    /// line the setup program also reads.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn progress(&self, percent: u8) {
        if self.json {
            emit(&json!({ "kind": "progress", "percent": percent }));
        } else {
            println!("   - downloaded {percent}%");
        }
    }

    /// The step's outcome as data, last line of the JSON stream. Silent in a
    /// terminal, where the lines before it already said it.
    pub fn result(&self, data: Value) {
        if self.json {
            let mut out = json!({ "kind": "result" });
            if let (Some(out), Value::Object(data)) = (out.as_object_mut(), data) {
                out.extend(data);
            }
            emit(&out);
        }
    }

    fn line(&self, kind: &str, prefix: &str, message: &str) {
        if self.json {
            emit(&json!({ "kind": kind, "message": message }));
        } else {
            println!("{prefix}{message}");
        }
    }
}

fn emit(value: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    // Flushed per line: the installer reads the stream while the step runs.
    let _ = out.flush();
}
