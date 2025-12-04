import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";

/**
 * Nocur Onboarding
 * Uses the global semantic color system defined in globals.css
 */

interface ClaudeCodeStatus {
  installed: boolean;
  path: string | null;
  loggedIn: boolean;
  hasActivePlan: boolean;
  error: string | null;
}

type OnboardingStep = "checking" | "not-installed" | "not-logged-in" | "no-plan" | "ready";

const StepIndicator = ({ current, total }: { current: number; total: number }) => (
  <div className="flex items-center gap-2">
    {Array.from({ length: total }).map((_, i) => (
      <div
        key={i}
        className={`h-1 w-8 rounded-full transition-colors ${
          i < current ? "bg-success" : i === current ? "bg-accent" : "bg-surface-overlay"
        }`}
      />
    ))}
  </div>
);

// Claude Code sparkle icon
const ClaudeIcon = ({ className = "" }: { className?: string }) => (
  <span className={`text-accent ${className}`}>✳</span>
);

const CheckMark = () => (
  <span className="text-success text-lg">✓</span>
);

const PendingMark = () => (
  <span className="text-text-tertiary text-lg">○</span>
);

const SpinnerIcon = () => (
  <div className="w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin" />
);

interface OnboardingProps {
  onComplete: () => void;
}

// Requirement item component
const RequirementItem = ({
  status,
  title,
  description,
}: {
  status: "done" | "pending" | "current";
  title: string;
  description: string;
}) => (
  <div className="flex items-start gap-3">
    <div className="mt-0.5 w-5 flex justify-center">
      {status === "done" ? <CheckMark /> : status === "current" ? <ClaudeIcon /> : <PendingMark />}
    </div>
    <div>
      <h3 className={`text-sm font-medium ${status === "done" ? "text-text-secondary" : "text-text-primary"}`}>
        {title}
      </h3>
      <p className="text-xs text-text-tertiary mt-0.5">{description}</p>
    </div>
  </div>
);

// DEBUG: Set to "not-installed" | "not-logged-in" | "no-plan" | "ready" | null to force a state
const DEBUG_FORCE_STEP: OnboardingStep | null = null;

export const Onboarding = ({ onComplete }: OnboardingProps) => {
  const [step, setStep] = useState<OnboardingStep>("checking");
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  const checkStatus = async () => {
    // DEBUG: Force a specific step for testing
    if (DEBUG_FORCE_STEP) {
      setStep(DEBUG_FORCE_STEP);
      setStatus({ installed: true, path: "/usr/local/bin/claude", loggedIn: true, hasActivePlan: false, error: null });
      return;
    }

    setIsChecking(true);
    try {
      const result = await invoke<ClaudeCodeStatus>("check_claude_code_status");
      setStatus(result);

      if (!result.installed) {
        setStep("not-installed");
      } else if (!result.loggedIn) {
        setStep("not-logged-in");
      } else if (!result.hasActivePlan) {
        setStep("no-plan");
      } else {
        setStep("ready");
        // Fade out after showing success, then complete
        setTimeout(() => {
          setIsFadingOut(true);
          setTimeout(onComplete, 300); // Match fade duration
        }, 1200);
      }
    } catch (error) {
      console.error("Failed to check Claude Code status:", error);
      setStep("not-installed");
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const openInstallDocs = async () => {
    await open("https://docs.anthropic.com/en/docs/claude-code");
  };

  const openTerminal = async () => {
    try {
      await invoke("open_claude_login");
    } catch (error) {
      console.error("Failed to open terminal:", error);
    }
  };

  const openPricing = async () => {
    await open("https://www.anthropic.com/pricing");
  };

  const getStepNumber = () => {
    switch (step) {
      case "checking": return 0;
      case "not-installed": return 1;
      case "not-logged-in": return 2;
      case "no-plan": return 3;
      case "ready": return 4;
    }
  };

  return (
    <div className={`fixed inset-0 bg-surface-base flex items-center justify-center transition-opacity duration-300 ${isFadingOut ? "opacity-0" : "opacity-100"}`}>
      <div className={`max-w-md w-full mx-4 transition-all duration-300 ${isFadingOut ? "scale-95 opacity-0" : "scale-100 opacity-100"}`}>
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-4 text-text-primary">◎</div>
          <h1 className="text-2xl font-semibold text-text-primary mb-1">Nocur</h1>
          <p className="text-sm text-text-tertiary">AI-powered iOS development verification</p>
        </div>

        {/* Progress */}
        <div className="flex justify-center mb-8">
          <StepIndicator current={getStepNumber()} total={4} />
        </div>

        {/* Content */}
        <div className="bg-surface-raised/50 border border-border rounded-lg p-6">
          {step === "checking" && (
            <div className="flex flex-col items-center py-8 gap-4">
              <SpinnerIcon />
              <p className="text-sm text-text-secondary">Checking Claude Code status...</p>
            </div>
          )}

          {step === "not-installed" && (
            <div className="space-y-5">
              {/* Requirements checklist */}
              <div className="space-y-3">
                <RequirementItem
                  status="current"
                  title="Install Claude Code"
                  description="Required to power the AI agent"
                />
                <RequirementItem
                  status="pending"
                  title="Sign in to Claude"
                  description="Connect your Anthropic account"
                />
                <RequirementItem
                  status="pending"
                  title="Active subscription"
                  description="Claude Pro or Team plan required"
                />
              </div>

              {/* Install command */}
              <div className="bg-surface-overlay rounded-md p-3 font-mono text-xs">
                <div className="flex items-center gap-2 text-text-secondary">
                  <span className="text-accent">❯</span>
                  <span>npm install -g @anthropic-ai/claude-code</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={openInstallDocs}
                  className="flex-1 px-4 py-2.5 text-sm font-medium rounded-md bg-surface-overlay hover:bg-hover text-text-primary transition-colors"
                >
                  Install Guide
                </button>
                <button
                  onClick={checkStatus}
                  disabled={isChecking}
                  className="px-4 py-2.5 text-sm font-medium rounded-md bg-surface-overlay hover:bg-hover text-text-secondary transition-colors disabled:opacity-50"
                >
                  {isChecking ? "..." : "Retry"}
                </button>
              </div>
            </div>
          )}

          {step === "not-logged-in" && (
            <div className="space-y-5">
              {/* Requirements checklist */}
              <div className="space-y-3">
                <RequirementItem
                  status="done"
                  title="Claude Code installed"
                  description={status?.path || "Ready to use"}
                />
                <RequirementItem
                  status="current"
                  title="Sign in to Claude"
                  description="Run 'claude' in your terminal"
                />
                <RequirementItem
                  status="pending"
                  title="Active subscription"
                  description="Claude Pro or Team plan required"
                />
              </div>

              {/* Login command */}
              <div className="bg-surface-overlay rounded-md p-3 font-mono text-xs">
                <div className="flex items-center gap-2 text-text-secondary">
                  <span className="text-accent">❯</span>
                  <span>claude</span>
                </div>
                <p className="text-text-tertiary mt-2 pl-4">Follow the prompts to sign in</p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={openTerminal}
                  className="flex-1 px-4 py-2.5 text-sm font-medium rounded-md bg-surface-overlay hover:bg-hover text-text-primary transition-colors"
                >
                  Open Terminal
                </button>
                <button
                  onClick={checkStatus}
                  disabled={isChecking}
                  className="px-4 py-2.5 text-sm font-medium rounded-md bg-surface-overlay hover:bg-hover text-text-secondary transition-colors disabled:opacity-50"
                >
                  {isChecking ? "..." : "Retry"}
                </button>
              </div>
            </div>
          )}

          {step === "no-plan" && (
            <div className="space-y-5">
              {/* Requirements checklist */}
              <div className="space-y-3">
                <RequirementItem
                  status="done"
                  title="Claude Code installed"
                  description={status?.path || "Ready to use"}
                />
                <RequirementItem
                  status="done"
                  title="Signed in to Claude"
                  description="Account connected"
                />
                <RequirementItem
                  status="current"
                  title="Active subscription"
                  description="Claude Pro or Team plan required"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={openPricing}
                  className="flex-1 px-4 py-2.5 text-sm font-medium rounded-md bg-surface-overlay hover:bg-hover text-text-primary transition-colors"
                >
                  View Plans
                </button>
                <button
                  onClick={checkStatus}
                  disabled={isChecking}
                  className="px-4 py-2.5 text-sm font-medium rounded-md bg-surface-overlay hover:bg-hover text-text-secondary transition-colors disabled:opacity-50"
                >
                  {isChecking ? "..." : "Retry"}
                </button>
              </div>
            </div>
          )}

          {step === "ready" && (
            <div className="space-y-5">
              {/* Requirements checklist - all done */}
              <div className="space-y-3">
                <RequirementItem
                  status="done"
                  title="Claude Code installed"
                  description={status?.path || "Ready to use"}
                />
                <RequirementItem
                  status="done"
                  title="Signed in to Claude"
                  description="Account connected"
                />
                <RequirementItem
                  status="done"
                  title="Active subscription"
                  description="You're all set"
                />
              </div>

              {/* Launch message */}
              <div className="text-center pt-2">
                <p className="text-sm text-text-tertiary">Launching Nocur...</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-text-tertiary">
            Having trouble?{" "}
            <button
              onClick={() => open("https://github.com/anthropics/claude-code/issues")}
              className="text-text-secondary hover:text-text-primary underline"
            >
              Get help
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
