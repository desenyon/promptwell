"use client";

import { useEffect, useState } from "react";

const PHASES = [
  "Reading the rough request",
  "Searching primary sources",
  "Mapping your tool stack",
  "Closing gaps below the 85 gate",
  "Drafting adaptive questions",
  "Locking verification criteria",
] as const;

export default function ResearchingScene({ researchEnabled = true }: { researchEnabled?: boolean }) {
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhaseIndex((current) => (current + 1) % PHASES.length);
    }, 2200);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="research-scene" aria-live="polite" aria-busy="true">
      <div className="research-scene-copy">
        <span className="modal-kicker">{researchEnabled ? "Research in progress" : "Preparing prompt"}</span>
        <h2>Forging the specification</h2>
        <p>{!researchEnabled && phaseIndex === 1 ? "Applying saved context" : PHASES[phaseIndex]}</p>
      </div>

      <div className="research-stage" aria-hidden="true">
        <div className="research-floor" />
        <div className="research-orbit research-orbit--outer" />
        <div className="research-orbit research-orbit--inner" />

        <div className="research-rig">
          <div className="research-core">
            {(["front", "back", "right", "left", "top", "bottom"] as const).map((face) => (
              <span className={`research-face research-face--${face}`} key={face}>
                <i />
                <i />
                <i />
                <i />
              </span>
            ))}
            <span className="research-nucleus" />
          </div>

          <span className="research-chip research-chip--a">CTX</span>
          <span className="research-chip research-chip--b">SRC</span>
          <span className="research-chip research-chip--c">QA</span>
        </div>
      </div>

      <div className="research-scene-meter" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
