//! Whether a signing certificate is Beeper's.
//!
//! Beeper signs through Microsoft's signing service, whose certificates last
//! three days with a new key each time, so no certificate or key can be pinned.
//! What stays the same is the identity EKU Microsoft puts in every certificate
//! it issues to this verified publisher: that is the pin, with the publisher's
//! name and the issuer checked exactly beside it. Same rule as
//! `Test-BeeperSigner` in `scripts/install-beeper.ps1`.

pub const BEEPER_IDENTITY_EKU: &str = "1.3.6.1.4.1.311.97.957952903.505523381.893587982.878473517";
pub const BEEPER_PUBLISHER: &str = "Automattic Inc.";

/// The fields of a signer certificate the check reads.
#[derive(Debug, Default)]
pub struct Signer {
    pub ekus: Vec<String>,
    pub subject_o: String,
    pub subject_cn: String,
    pub issuer_o: String,
    pub issuer_cn: String,
}

/// Why `signer` is not Beeper's signing certificate, or Ok.
pub fn check(signer: &Signer) -> Result<(), String> {
    if !signer.ekus.iter().any(|eku| eku == BEEPER_IDENTITY_EKU) {
        return Err(format!(
            "not Beeper's publisher identity (O={}, CN={})",
            signer.subject_o, signer.subject_cn
        ));
    }
    if signer.subject_o != BEEPER_PUBLISHER || signer.subject_cn != BEEPER_PUBLISHER {
        return Err(format!(
            "publisher is not exactly {BEEPER_PUBLISHER} (O={}, CN={})",
            signer.subject_o, signer.subject_cn
        ));
    }
    if signer.issuer_o != "Microsoft Corporation"
        || !signer.issuer_cn.starts_with("Microsoft ID Verified CS ")
    {
        return Err(format!(
            "not issued by Microsoft's signing service (O={}, CN={})",
            signer.issuer_o, signer.issuer_cn
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Beeper's real certificate, as read from the 4.3.229 installer.
    fn beeper() -> Signer {
        Signer {
            ekus: vec![
                "1.3.6.1.4.1.311.97.1.0".into(),
                "1.3.6.1.5.5.7.3.3".into(),
                BEEPER_IDENTITY_EKU.into(),
            ],
            subject_o: "Automattic Inc.".into(),
            subject_cn: "Automattic Inc.".into(),
            issuer_o: "Microsoft Corporation".into(),
            issuer_cn: "Microsoft ID Verified CS EOC CA 03".into(),
        }
    }

    #[test]
    fn beepers_certificate_passes() {
        assert_eq!(check(&beeper()), Ok(()));
    }

    #[test]
    fn a_lookalike_organisation_without_the_identity_fails() {
        let signer = Signer {
            ekus: vec!["1.3.6.1.5.5.7.3.3".into()],
            subject_o: "Automattic Inc. Holdings".into(),
            ..beeper()
        };
        assert!(check(&signer).is_err());
    }

    #[test]
    fn the_exact_names_without_the_identity_fail() {
        let signer = Signer {
            ekus: vec!["1.3.6.1.5.5.7.3.3".into()],
            ..beeper()
        };
        assert!(check(&signer).is_err());
    }

    #[test]
    fn the_identity_under_another_name_fails() {
        let signer = Signer {
            subject_o: "Automattic Inc. Holdings".into(),
            ..beeper()
        };
        assert!(check(&signer).is_err());
    }

    #[test]
    fn the_identity_from_another_issuer_fails() {
        let signer = Signer {
            issuer_o: "Automattic Inc.".into(),
            issuer_cn: "Automattic Inc.".into(),
            ..beeper()
        };
        assert!(check(&signer).is_err());
    }
}
