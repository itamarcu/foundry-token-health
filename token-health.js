// @ts-check

import settings, {CONFIG} from './settings.js';
import {i18n} from './ui.js';
import getNewHP from './getNewHP.js';

const DELAY = 400;

let tokenHealthDisplayed = false;
let dialog, timer, KeyBinding;

/**
 * Extend Dialog class to force focus on the input
 */
class TokenHealthDialog extends Dialog {
  activateListeners(html) {
    super.activateListeners(html);

    // Focus the input
    html.find('#token-health-input').focus();

    // Add a class to dialog-buttons to be able to style them without breaking other stuff :/
    html.addClass('token-health');
  }
}

/**
 * Apply damage, use the Actor5e formula
 *
 * @param {HTMLElement} html The html element
 * @param {boolean} isDamage Is the amount a damage? false if it's healing
 * @param {boolean} isTargeted Is it a targeted token?
 * @returns {Promise<Entity|Entity[]>}
 */
const applyDamage = async (html, isDamage, isTargeted) => {
  const value = html.find('input[type=number]').val();
  const damage = isDamage ? Number(value) : Number(value) * -1;

  const tokens = isTargeted
    ? Array.from(game.user.targets)
    : canvas.tokens.controlled;

  const thoseThatWentDown = []

  const promises = tokens.map(({ actor }) => {
    // Handle temp hp if any
    const data = actor.data.data;
    const hp = getProperty(data, CONFIG.HITPOINTS_ATTRIBUTE);
    const max = getProperty(data, CONFIG.MAX_HITPOINTS_ATTRIBUTE);
    const temp = getProperty(data, CONFIG.TEMP_HITPOINTS_ATTRIBUTE);

    const [newHP, newTempHP] = getNewHP(hp, max, temp, damage, {
      allowNegative: CONFIG.ALLOW_NEGATIVE,
    });

    if (newHP === 0 && damage > 0) {
      const excessDamage = damage - hp
      thoseThatWentDown.push([actor.name, excessDamage])
    }

    const updates = {
      _id: actor.id,
      isToken: actor.isToken,
      [`data.${CONFIG.HITPOINTS_ATTRIBUTE || 'attributes.hp.value'}`]: newHP,
      [`data.${
        CONFIG.TEMP_HITPOINTS_ATTRIBUTE || 'attributes.hp.temp'
      }`]: newTempHP,
    };
    console.log(updates);

    // Prepare the update
    return actor.update(updates);
  });

  if (value) {
    const actorNames = tokens.map(t => t.name).join(', ')
    const isActuallyDamage = isDamage ^ (value < 0)
    const absValue = Math.abs(value)
    const damageOrHealingText = isActuallyDamage
      ? `<p style="display:inline; color: #bc1700; font-weight: bold">${absValue} damage</p> dealt to`
      : `<p style="display:inline; color: #008a00; font-weight: bold">${absValue} healing</p> granted to`
    const messageContent = `${damageOrHealingText} ${actorNames}.`
    const data = { content: messageContent }
    ChatMessage.applyRollMode(data, game.settings.get("core", "rollMode"))
    ChatMessage.create(data)
  }
  for (const pair of thoseThatWentDown) {
    const name = pair[0], excess = pair[1]
    const messageContent = `${name} went down (<p style="display:inline; color: #bc1700">${excess} excess damage</p>).`
    const data = { content: messageContent }
    ChatMessage.applyRollMode(data, game.settings.get("core", "rollMode"))
    ChatMessage.create(data)
  }

  return Promise.all(promises)
}

/**
 * Display token Health overlay.
 *
 * @returns {Promise<void>}
 */
const displayOverlay = async (isDamage, isTargeted = false) => {
  tokenHealthDisplayed = true;

  const buttons = {
    heal: {
      icon: "<i class='fas fa-plus-circle'></i>",
      label: `${i18n('TOKEN_HEALTH.Heal')}  <kbd>⮐</kbd>`,
      callback: html => applyDamage(html, isDamage, isTargeted),
      condition: !isDamage,
    },
    damage: {
      icon: "<i class='fas fa-minus-circle'></i>",
      label: `${i18n('TOKEN_HEALTH.Damage')}  <kbd>⮐</kbd>`,
      callback: html => applyDamage(html, isDamage, isTargeted),
      condition: isDamage,
    },
  };

  let dialogTitle = `TOKEN_HEALTH.Dialog_${isDamage ? 'Damage' : 'Heal'}_Title${
    isTargeted ? '_targeted' : ''
  }`;

  const tokens = isTargeted ? Array.from(game.user.targets) : canvas.tokens.controlled
  const nameOfTokens = tokens.map(t => t.name).sort((a, b) => a.length - b.length).join(', ')
  // we will show the first four thumbnails, with the 4th cut in half and gradually more and more translucent
  let thumbnails = tokens.slice(0, 4).map((t, idx) => ({ image: t.data.img, opacity: (1 - 0.15 * idx) }))

  const content = await renderTemplate(
    `modules/token-health/templates/token-health.hbs`,
    { thumbnails },
  )

  // Render the dialog
  dialog = new TokenHealthDialog({
    title: i18n(dialogTitle).replace('$1', nameOfTokens),
    buttons,
    content,
    default: isDamage ? 'damage' : 'heal',
    close: () => {
      timer = setTimeout(() => {
        tokenHealthDisplayed = false;
      }, DELAY);
    },
  }).render(true);
};

/**
 * Force closing dialog on Escape (FVTT denies that if you focus something)
 */
const onEscape = () => {
  if (dialog && tokenHealthDisplayed) {
    dialog.close();
  }
};

/**
 * Open the dialog on ToggleKey
 */
const toggle = (event, key, isDamage = true, isTarget = false) => {
  event.preventDefault();

  // Make sure to call only once.
  keyboard._handled.add(key);

  // Don't display if no tokens are controlled. Don't display as well if we were trying
  // to apply damage to targets
  if (
    !tokenHealthDisplayed &&
    canvas.tokens.controlled.length > 0 &&
    !isTarget
  ) {
    displayOverlay(isDamage).catch(console.error);
  }
  // Don't display if no tokens are targeted and we were trying to attack selected
  if (!tokenHealthDisplayed && game.user.targets.size > 0 && isTarget) {
    displayOverlay(isDamage, isTarget).catch(console.error);
  }
};

/**
 * Handle custom keys not handled by FVTT
 *
 * @param {KeyboardEvent} event The keyboard event
 * @param {string} key The pressed key
 * @param {Boolean} up Is the button up
 */
const handleKeys = function (event, key, up) {
  if (up || this.hasFocus) return;

  // Base key is pressed.
  const toggleKeyBase = KeyBinding.parse(CONFIG.TOGGLE_KEY_BASE);
  if (KeyBinding.eventIsForBinding(event, toggleKeyBase)) toggle(event, key);

  // Alt key is pressed.
  const toggleKeyAlt = KeyBinding.parse(CONFIG.TOGGLE_KEY_ALT);
  if (KeyBinding.eventIsForBinding(event, toggleKeyAlt))
    toggle(event, key, false);

  // Targeting key is pressed
  const toggleKeyTarget = KeyBinding.parse(CONFIG.TOGGLE_KEY_TARGET);
  if (KeyBinding.eventIsForBinding(event, toggleKeyTarget))
    toggle(event, key, true, true);

  // Alt Targeting key is pressed
  const toggleKeyTargetAlt = KeyBinding.parse(CONFIG.TOGGLE_KEY_TARGET_ALT);
  if (KeyBinding.eventIsForBinding(event, toggleKeyTargetAlt))
    toggle(event, key, false, true);
};

/**
 * Initialize our stuff
 */
Hooks.once('ready', () => {
  // Extend _handleKeys method with our own function
  const cached_handleKeys = keyboard._handleKeys;
  keyboard._handleKeys = function () {
    handleKeys.call(this, ...arguments);
    cached_handleKeys.call(this, ...arguments);
  };

  // Extend _onEscape method with our own function
  const cached_onEscape = keyboard._onEscape;
  keyboard._onEscape = function () {
    onEscape.call(this, ...arguments);
    cached_onEscape.call(this, ...arguments);
  };

  // Initialize settings
  settings();

  // Use Azzurite settings-extender
  KeyBinding = window.Azzu.SettingsTypes.KeyBinding;
});
