import React, { useEffect, useRef } from "react";
import { t, autoSaveConfig } from "../../helpers";
import { Toggle } from "../../widgets/Toggle";
import styles from "../../Settings.module.css";

// Local copy of OPTIONAL_TOOL_NAMES. Frontend intentionally does NOT import
// from shared/tool-categories.js to keep the desktop bundle independent of
// node-only server code. Drift between this constant and the backend's
// shared/tool-categories.js is caught by tests/optional-tool-names-drift.test.js
// (Task 10b) which imports both and asserts equality.
const OPTIONAL_TOOL_NAMES = [
  "browser",
  "cron",
  "dm",
  "install_skill",
  "update_settings",
] as const;

type OptionalToolName = (typeof OPTIONAL_TOOL_NAMES)[number];

interface Props {
  availableTools: string[];
  disabled: string[];
}

export function AgentToolsSection({ availableTools, disabled }: Props) {
  // Only render rows for tools the agent actually has registered.
  // This naturally hides dm in single-agent environments where the agent
  // has no channelsDir/agentsDir wiring.
  const renderable = OPTIONAL_TOOL_NAMES.filter((name) =>
    availableTools.includes(name)
  );

  // Toggle visual state is derived from the `disabled` prop (no useState),
  // but writes must be computed from the freshest known list, not the prop
  // captured at the previous render. Rapid-click-before-prop-refresh would
  // otherwise rebuild `newDisabled` from stale data and silently clobber the
  // earlier click. disabledRef tracks the latest known value (updated both
  // by prop sync below and optimistically after each toggleTool call) so
  // two consecutive toggles on different tools before the first PUT+GET
  // round-trip both survive.
  const disabledRef = useRef(disabled);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  const toggleTool = (name: OptionalToolName) => {
    const current = disabledRef.current;
    const currentlyOff = current.includes(name);
    const newDisabled = currentlyOff
      ? current.filter((n) => n !== name)
      : [...current, name];
    disabledRef.current = newDisabled;
    autoSaveConfig({ tools: { disabled: newDisabled } });
  };

  if (renderable.length === 0) {
    return null;
  }

  return (
    <section className={styles["settings-section"]}>
      <h2 className={styles["settings-section-title"]}>
        {t("settings.agent.tools.title")}
      </h2>
      <p className={styles["settings-hint"]}>
        {t("settings.agent.tools.description")}
      </p>
      <div className={styles["tool-list"]}>
        {renderable.map((name) => {
          const isOn = !disabled.includes(name);
          return (
            <div
              className={styles["tool-row"]}
              key={name}
              data-tool-name={name}
            >
              <div className={styles["tool-row-info"]}>
                <div className={styles["tool-row-label"]}>
                  {t(`settings.agent.tools.items.${name}.label`)}
                </div>
                <div className={styles["tool-row-summary"]}>
                  {t(`settings.agent.tools.items.${name}.summary`)}
                </div>
              </div>
              <Toggle on={isOn} onChange={() => toggleTool(name)} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
