/**
 * @typedef {{ id: string, label: string, disabled?: boolean, description?: string }} MenuChoice
 * @typedef {{ id: string, label: string, choices: MenuChoice[], selected: () => string, choose: (id: string) => void,
 *             customLabel?: string }} MenuSetting
 */

/** @param {MenuSetting} setting */
export function createMenuSelect(setting) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', setting.label);
  select.dataset.setting = setting.id;
  for (const choice of setting.choices) {
    const option = new Option(choice.label, choice.id);
    option.disabled = !!choice.disabled;
    select.append(option);
  }
  const other = new Option(setting.customLabel ?? 'Custom module', '');
  other.disabled = true;

  function refresh() {
    const id = setting.selected();
    const listed = setting.choices.some((choice) => choice.id === id);
    if (listed) other.remove();
    else {
      other.value = id;
      select.prepend(other);
    }
    select.value = id;
  }

  select.addEventListener('change', () => {
    const choice = setting.choices.find(({ id }) => id === select.value);
    if (choice && !choice.disabled && choice.id !== setting.selected()) setting.choose(choice.id);
  });
  refresh();
  return { select, refresh };
}

/** @param {MenuSetting} setting @param {(choice: MenuChoice) => void} onChoice */
export function createMenuToggle(setting, onChoice) {
  const toggle = document.createElement('span');
  toggle.dataset.setting = setting.id;
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', setting.label);
  const selected = setting.selected();
  for (const choice of setting.choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.choice = choice.id;
    button.textContent = choice.label;
    button.disabled = !!choice.disabled;
    button.setAttribute('aria-pressed', String(choice.id === selected));
    if (choice.description) {
      button.title = choice.description;
      button.setAttribute('aria-label', `${choice.label} (${choice.description})`);
    }
    button.addEventListener('click', () => {
      if (!choice.disabled && choice.id !== setting.selected()) onChoice(choice);
    });
    toggle.append(button);
  }
  return toggle;
}
