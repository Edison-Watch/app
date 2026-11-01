//! Authenticode on Windows: is a file validly signed, and by whom.
//!
//! `WinVerifyTrust` decides validity (chain, timestamp, tampering). The signer
//! certificate is then read out of the file's embedded PKCS#7 so
//! [`super::publisher::check`] can decide whether it is Beeper's.

use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{
    CERT_E_REVOCATION_FAILURE, CERT_E_REVOKED, CRYPT_E_REVOCATION_OFFLINE,
};
use windows_sys::Win32::Security::Cryptography::{
    CertCloseStore, CertFindCertificateInStore, CertFreeCertificateContext,
    CertGetEnhancedKeyUsage, CertGetNameStringW, CryptMsgClose, CryptMsgGetParam, CryptQueryObject,
    CERT_CONTEXT, CERT_FIND_EXT_ONLY_ENHKEY_USAGE_FLAG, CERT_FIND_SUBJECT_CERT, CERT_INFO,
    CERT_NAME_ATTR_TYPE, CERT_NAME_ISSUER_FLAG, CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED,
    CERT_QUERY_FORMAT_FLAG_BINARY, CERT_QUERY_OBJECT_FILE, CMSG_SIGNER_INFO,
    CMSG_SIGNER_INFO_PARAM, CTL_USAGE, HCERTSTORE, PKCS_7_ASN_ENCODING, X509_ASN_ENCODING,
};
use windows_sys::Win32::Security::WinTrust::{
    WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0,
    WINTRUST_FILE_INFO, WTD_CHOICE_FILE, WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT,
    WTD_REVOKE_WHOLECHAIN, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE,
};

use super::publisher::Signer;

const ENCODING: u32 = X509_ASN_ENCODING | PKCS_7_ASN_ENCODING;
const OID_COMMON_NAME: &[u8] = b"2.5.4.3\0";
const OID_ORGANIZATION: &[u8] = b"2.5.4.10\0";

/// The signer of `path` when its Authenticode signature is valid; why not
/// otherwise.
pub fn signer(path: &Path) -> Result<Signer, String> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    verify_trust(&wide)?;
    read_signer(&wide)
}

fn verify_trust(wide: &[u16]) -> Result<(), String> {
    // SAFETY: zeroed is the documented initial state for both structs; every
    // pointer they hold is set below and outlives both calls.
    let mut file: WINTRUST_FILE_INFO = unsafe { std::mem::zeroed() };
    file.cbStruct = std::mem::size_of::<WINTRUST_FILE_INFO>() as u32;
    file.pcwszFilePath = wide.as_ptr();
    let mut data: WINTRUST_DATA = unsafe { std::mem::zeroed() };
    data.cbStruct = std::mem::size_of::<WINTRUST_DATA>() as u32;
    data.dwUIChoice = WTD_UI_NONE;
    // A timestamped signature outlives its certificate, so revocation is
    // what rejects a file signed with a compromised key. It needs the
    // network, which the download just used; a failed check fails closed.
    data.fdwRevocationChecks = WTD_REVOKE_WHOLECHAIN;
    data.dwProvFlags = WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT;
    data.dwUnionChoice = WTD_CHOICE_FILE;
    data.Anonymous = WINTRUST_DATA_0 { pFile: &mut file };
    data.dwStateAction = WTD_STATEACTION_VERIFY;
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    // SAFETY: INVALID_HANDLE_VALUE-free call with a fully initialised struct.
    let status = unsafe {
        WinVerifyTrust(
            null_mut(),
            &mut action,
            (&mut data as *mut WINTRUST_DATA).cast(),
        )
    };
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    // SAFETY: releases the state the verify call allocated.
    unsafe {
        WinVerifyTrust(
            null_mut(),
            &mut action,
            (&mut data as *mut WINTRUST_DATA).cast(),
        )
    };
    trust_result(status)
}

/// `WinVerifyTrust`'s status as a reason the person can act on.
fn trust_result(status: i32) -> Result<(), String> {
    match status {
        0 => Ok(()),
        CERT_E_REVOKED => Err("the signing certificate has been revoked".into()),
        CRYPT_E_REVOCATION_OFFLINE | CERT_E_REVOCATION_FAILURE => Err(format!(
            "could not check whether the signing certificate was revoked (0x{:08X}); \
             check the internet connection and try again",
            status as u32
        )),
        _ => Err(format!(
            "the signature is not valid (0x{:08X})",
            status as u32
        )),
    }
}

fn read_signer(wide: &[u16]) -> Result<Signer, String> {
    let mut store: HCERTSTORE = null_mut();
    let mut msg: *mut core::ffi::c_void = null_mut();
    // SAFETY: out-params are valid; both handles are closed below.
    let found = unsafe {
        CryptQueryObject(
            CERT_QUERY_OBJECT_FILE,
            wide.as_ptr().cast(),
            CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED,
            CERT_QUERY_FORMAT_FLAG_BINARY,
            0,
            null_mut(),
            null_mut(),
            null_mut(),
            &mut store,
            &mut msg,
            null_mut(),
        )
    };
    if found == 0 {
        return Err("no embedded signature".into());
    }
    let result = signer_from(store, msg);
    // SAFETY: both were opened by CryptQueryObject above.
    unsafe {
        CryptMsgClose(msg);
        CertCloseStore(store, 0);
    }
    result
}

fn signer_from(store: HCERTSTORE, msg: *mut core::ffi::c_void) -> Result<Signer, String> {
    let mut size = 0u32;
    // SAFETY: size query, then a buffer of that size; read back as the struct
    // the API documents for this parameter.
    let info = unsafe {
        if CryptMsgGetParam(msg, CMSG_SIGNER_INFO_PARAM, 0, null_mut(), &mut size) == 0 {
            return Err("no signer in the signature".into());
        }
        let mut buf = vec![0u8; size as usize];
        if CryptMsgGetParam(
            msg,
            CMSG_SIGNER_INFO_PARAM,
            0,
            buf.as_mut_ptr().cast(),
            &mut size,
        ) == 0
        {
            return Err("could not read the signer".into());
        }
        buf
    };
    // SAFETY: `info` holds a CMSG_SIGNER_INFO and stays alive while it is used.
    let signer_info = unsafe { &*(info.as_ptr() as *const CMSG_SIGNER_INFO) };
    let mut lookup: CERT_INFO = unsafe { std::mem::zeroed() };
    lookup.Issuer = signer_info.Issuer;
    lookup.SerialNumber = signer_info.SerialNumber;
    // SAFETY: finds the signer's certificate in the message's own store.
    let cert = unsafe {
        CertFindCertificateInStore(
            store,
            ENCODING,
            0,
            CERT_FIND_SUBJECT_CERT,
            (&lookup as *const CERT_INFO).cast(),
            null(),
        )
    };
    if cert.is_null() {
        return Err("the signer's certificate is not in the signature".into());
    }
    let signer = Signer {
        ekus: ekus(cert),
        subject_o: name(cert, OID_ORGANIZATION, 0),
        subject_cn: name(cert, OID_COMMON_NAME, 0),
        issuer_o: name(cert, OID_ORGANIZATION, CERT_NAME_ISSUER_FLAG),
        issuer_cn: name(cert, OID_COMMON_NAME, CERT_NAME_ISSUER_FLAG),
    };
    // SAFETY: returned by CertFindCertificateInStore above.
    unsafe { CertFreeCertificateContext(cert) };
    Ok(signer)
}

fn ekus(cert: *const CERT_CONTEXT) -> Vec<String> {
    let mut size = 0u32;
    // SAFETY: size query, then a buffer of that size holding a
    // CERT_ENHKEY_USAGE (CTL_USAGE) whose OID pointers point into the same buffer.
    unsafe {
        if CertGetEnhancedKeyUsage(
            cert,
            CERT_FIND_EXT_ONLY_ENHKEY_USAGE_FLAG,
            null_mut(),
            &mut size,
        ) == 0
        {
            return Vec::new();
        }
        let mut buf = vec![0u8; size as usize];
        let usage = buf.as_mut_ptr() as *mut CTL_USAGE;
        if CertGetEnhancedKeyUsage(cert, CERT_FIND_EXT_ONLY_ENHKEY_USAGE_FLAG, usage, &mut size)
            == 0
        {
            return Vec::new();
        }
        let usage = &*usage;
        (0..usage.cUsageIdentifier as usize)
            .map(|i| {
                let oid = *usage.rgpszUsageIdentifier.add(i);
                std::ffi::CStr::from_ptr(oid.cast())
                    .to_string_lossy()
                    .into_owned()
            })
            .collect()
    }
}

/// One attribute (by OID) of the subject, or of the issuer with
/// `CERT_NAME_ISSUER_FLAG`. Empty when absent.
fn name(cert: *const CERT_CONTEXT, oid: &[u8], flags: u32) -> String {
    let mut buf = [0u16; 512];
    // SAFETY: the OID is NUL-terminated; the buffer length is passed in.
    let len = unsafe {
        CertGetNameStringW(
            cert,
            CERT_NAME_ATTR_TYPE,
            flags,
            oid.as_ptr().cast(),
            buf.as_mut_ptr(),
            buf.len() as u32,
        )
    };
    // The length includes the terminating NUL; 1 means not present.
    String::from_utf16_lossy(&buf[..(len as usize).saturating_sub(1)])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PowerShell 7's exe carries an embedded Microsoft signature, and is on
    /// GitHub's Windows runners. Skipped where it is not installed.
    #[test]
    fn reads_the_signer_of_a_signed_exe_and_it_is_not_beeper() {
        let pwsh = Path::new(r"C:\Program Files\PowerShell\7\pwsh.exe");
        if !pwsh.exists() {
            return;
        }
        let signer = signer(pwsh).expect("pwsh.exe is validly signed");
        assert_eq!(signer.subject_o, "Microsoft Corporation");
        assert!(signer.subject_cn.starts_with("Microsoft"));
        assert!(
            signer.ekus.iter().any(|e| e == "1.3.6.1.5.5.7.3.3"),
            "{:?}",
            signer.ekus
        );
        assert!(super::super::publisher::check(&signer).is_err());
    }

    #[test]
    fn an_unsigned_file_is_refused() {
        let path = std::env::temp_dir().join(format!("unsigned-{}.exe", std::process::id()));
        std::fs::write(&path, b"MZ not really a program").unwrap();
        let result = signer(&path);
        let _ = std::fs::remove_file(&path);
        assert!(result.is_err());
    }

    #[test]
    fn a_revoked_signer_is_refused() {
        assert!(trust_result(CERT_E_REVOKED)
            .unwrap_err()
            .contains("revoked"));
    }

    #[test]
    fn an_unchecked_revocation_is_refused_not_passed() {
        for status in [CRYPT_E_REVOCATION_OFFLINE, CERT_E_REVOCATION_FAILURE] {
            let reason = trust_result(status).unwrap_err();
            assert!(reason.contains("could not check"), "{reason}");
        }
    }

    #[test]
    fn a_valid_signature_passes() {
        assert!(trust_result(0).is_ok());
    }
}
