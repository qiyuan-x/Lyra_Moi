import type { AppearanceMode } from "../../lib/appearance.js";

interface AppearanceSettingsProps {
  mode: AppearanceMode;
  onChange: (mode: AppearanceMode) => void;
}

export function AppearanceSettings(props: AppearanceSettingsProps) {
  const options: Array<{
    mode: AppearanceMode;
    label: string;
    description: string;
  }> = [
    { mode: "light", label: "浅色", description: "始终使用浅色界面。" },
    { mode: "dark", label: "深色", description: "始终使用深色界面。" },
    { mode: "system", label: "跟随系统", description: "根据系统外观自动切换。" }
  ];

  return (
    <section className="appearance-settings">
      <header className="settings-overview-heading">
        <div>
          <h2>显示设置</h2>
          <p>调整应用外观。修改后自动保存并立即生效。</p>
        </div>
      </header>
      <section className="appearance-section">
        <header>
          <strong>应用主题</strong>
          <span>查看器背景主题将在此栏目继续扩展。</span>
        </header>
        <div className="appearance-theme-options">
          {options.map((option) => (
            <label
              className={props.mode === option.mode ? "selected" : ""}
              key={option.mode}
            >
              <input
                type="radio"
                name="appearance-mode"
                value={option.mode}
                checked={props.mode === option.mode}
                onChange={() => props.onChange(option.mode)}
              />
              <span className={`appearance-preview preview-${option.mode}`}>
                <i /><i /><i />
              </span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </label>
          ))}
        </div>
      </section>
    </section>
  );
}
