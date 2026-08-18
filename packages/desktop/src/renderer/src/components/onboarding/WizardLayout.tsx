import StepIndicator from "./StepIndicator";
import logoDark from "../../assets/logo-dark.png";
import DaemonWarningBanner from "../DaemonWarningBanner";
import FullDiskAccessBanner from "../FullDiskAccessBanner";

interface WizardLayoutProps {
  currentStep: number;
  maxVisitedStep?: number;
  locked?: boolean;
  onStepClick?: (step: number) => void;
  /** Drives the Full Disk Access prompt, which must stay quiet before sign-in. */
  signedIn: boolean;
  children: React.ReactNode;
}

export default function WizardLayout({ currentStep, maxVisitedStep, locked, onStepClick, signedIn, children }: WizardLayoutProps): React.ReactNode {
  return (
    <div className="flex h-screen flex-col items-center overflow-y-auto bg-[var(--bg-base)]">
      {/* Onboarding depends on the daemon for every step that touches an agent,
          so the warning belongs here too, not only in the main window. */}
      <div className="w-full">
        <DaemonWarningBanner />
        {/* Onboarding is also the first chance to ask for Full Disk Access, but
            only once the user has signed in - step 0 is the sign-in screen, and
            asking for a system-wide grant before that is premature. */}
        <FullDiskAccessBanner signedIn={signedIn} />
      </div>

      {/* Header with branding */}
      <header className="flex w-full flex-col items-center gap-3 px-6 pt-8 pb-4">
        <img src={logoDark} alt="SealGate" className="h-7 w-auto" />
        <StepIndicator currentStep={currentStep} maxVisitedStep={maxVisitedStep} locked={locked} onStepClick={onStepClick} />
      </header>

      {/* Content area */}
      <main className="flex w-full max-w-lg flex-1 flex-col px-6 pb-8">
        {children}
      </main>
    </div>
  );
}
