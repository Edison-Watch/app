//! The CPU architecture an executable was built for, from its PE header.
//!
//! Beeper's Windows installer is an x86 stub for every build, so only the
//! installed `Beeper.exe` says which build a machine got.

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arch {
    X64,
    Arm64,
    X86,
}

impl Arch {
    /// The token Beeper's and our own download links use.
    pub fn as_str(self) -> &'static str {
        match self {
            Arch::X64 => "x64",
            Arch::Arm64 => "arm64",
            Arch::X86 => "x86",
        }
    }

    fn from_machine(machine: u16) -> Option<Self> {
        match machine {
            0x8664 => Some(Arch::X64),
            0xAA64 => Some(Arch::Arm64),
            0x014C => Some(Arch::X86),
            _ => None,
        }
    }
}

/// The architecture `path` was built for, or None when it is not a PE file
/// (or cannot be read).
pub fn read(path: &Path) -> Option<Arch> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut mz = [0u8; 2];
    file.read_exact(&mut mz).ok()?;
    if &mz != b"MZ" {
        return None;
    }
    file.seek(SeekFrom::Start(0x3C)).ok()?;
    let mut offset = [0u8; 4];
    file.read_exact(&mut offset).ok()?;
    file.seek(SeekFrom::Start(u64::from(u32::from_le_bytes(offset))))
        .ok()?;
    let mut header = [0u8; 6];
    file.read_exact(&mut header).ok()?;
    if &header[..4] != b"PE\0\0" {
        return None;
    }
    Arch::from_machine(u16::from_le_bytes([header[4], header[5]]))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal PE header: "MZ", the PE offset at 0x3C, then the signature
    /// and machine field.
    fn pe(machine: u16) -> Vec<u8> {
        let mut bytes = vec![0u8; 0x40];
        bytes[0] = b'M';
        bytes[1] = b'Z';
        bytes[0x3C..0x40].copy_from_slice(&0x40u32.to_le_bytes());
        bytes.extend_from_slice(b"PE\0\0");
        bytes.extend_from_slice(&machine.to_le_bytes());
        bytes
    }

    /// Write `bytes` to a file named for the test, read it, and clean up.
    fn read_bytes(name: &str, bytes: &[u8]) -> Option<Arch> {
        let path = std::env::temp_dir().join(format!("exe-arch-{}-{name}.exe", std::process::id()));
        std::fs::write(&path, bytes).unwrap();
        let arch = read(&path);
        let _ = std::fs::remove_file(&path);
        arch
    }

    #[test]
    fn reads_each_machine_type() {
        assert_eq!(read_bytes("x64", &pe(0x8664)), Some(Arch::X64));
        assert_eq!(read_bytes("arm64", &pe(0xAA64)), Some(Arch::Arm64));
        assert_eq!(read_bytes("x86", &pe(0x014C)), Some(Arch::X86));
    }

    #[test]
    fn an_unknown_machine_is_none() {
        assert_eq!(read_bytes("unknown", &pe(0x1234)), None);
    }

    #[test]
    fn a_file_that_is_not_pe_is_none() {
        let mut bytes = pe(0x8664);
        bytes[0] = b'X';
        assert_eq!(read_bytes("not-pe", &bytes), None);
        assert_eq!(read(Path::new("/definitely/not/here.exe")), None);
    }
}
