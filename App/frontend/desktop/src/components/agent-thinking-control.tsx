import { Brain, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  resolveThinkingEnabled,
  resolveThinkingLevel,
  type ModelThinkingConfig,
  type ThinkingLevel
} from "@memmy/local-api-contracts";
import { useTranslation } from "../i18n/use-translation.js";
import { agentActions } from "../state/app-actions.js";
import { useAppState } from "../state/app-state.js";

export interface AgentThinkingControlProps {
  scopeKey: string;
  thinkingConfig: ModelThinkingConfig | null;
  disabled: boolean;
}

export function AgentThinkingControl(props: AgentThinkingControlProps) {
  const { t } = useTranslation();
  const { state, dispatch } = useAppState();
  const [pickerOpen, setPickerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const config = props.thinkingConfig;

  const thinkingState = state.agent.thinkingStateByScope[props.scopeKey];
  const enabled = config
    ? resolveThinkingEnabled(config, thinkingState?.enabled)
    : false;
  const currentLevel = config
    ? resolveThinkingLevel(config, thinkingState?.level)
    : null;

  useEffect(() => {
    if (!pickerOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [pickerOpen]);

  if (!config) {
    return null;
  }

  const hasLevels = config.levels.length > 0;
  const showLevels = hasLevels && enabled && currentLevel !== null;
  const level: ThinkingLevel | null = showLevels ? currentLevel : null;

  function toggleThinking() {
    dispatch(agentActions.thinkingToggled(props.scopeKey, !enabled));
  }

  function selectLevel(next: string) {
    dispatch(agentActions.thinkingLevelChanged(props.scopeKey, next));
    setPickerOpen(false);
  }

  return (
    <div ref={containerRef} className="agent-thinking-control">
      {config.switchable && (
        <button
          type="button"
          onClick={toggleThinking}
          disabled={props.disabled}
          aria-pressed={enabled}
          className={`thinking-toggle ${enabled ? "thinking-toggle--on" : ""}`}
          aria-label={t("home.thinking.toggle")}
        >
          <Brain size={16} className="thinking-toggle__icon" />
          <span className="thinking-toggle__label">{t("home.thinking.label")}</span>
          <div className={`thinking-toggle__switch ${enabled ? "thinking-toggle__switch--on" : ""}`}>
            <div className="thinking-toggle__switch-thumb" />
          </div>
        </button>
      )}

      {level !== null && (
        <div className="thinking-level-trigger-container">
          <button
            type="button"
            onClick={() => setPickerOpen(!pickerOpen)}
            disabled={props.disabled}
            className="thinking-level-trigger"
            aria-label={t("home.thinking.selectLevel")}
          >
            <span className="thinking-level-trigger__label">
              {t("home.thinking.level")}: {t(`home.thinking.levelValue.${level}`)}
            </span>
            <ChevronDown size={14} className="thinking-level-trigger__icon" />
          </button>

          {pickerOpen && (
            <div className="thinking-level-picker">
              <div className="thinking-level-picker__header">
                {t("home.thinking.levelHeader")}
              </div>
              {config.levels.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => selectLevel(option)}
                  className={`thinking-level-option ${level === option ? "thinking-level-option--selected" : ""}`}
                >
                  {t(`home.thinking.levelValue.${option}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
