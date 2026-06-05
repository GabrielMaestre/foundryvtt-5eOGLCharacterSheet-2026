// @ts-nocheck
import { log } from './helpers';
import { registerSettings } from './module/settings';
import { preloadTemplates } from './module/preloadTemplates';
import { MODULE_ID, MySettings } from './constants';

Handlebars.registerHelper('ogl5e-sheet-path', (relativePath: string) => `modules/${MODULE_ID}/${relativePath}`);

Handlebars.registerHelper('ogl5e-sheet-safeVal', (value, fallback) => {
  return new Handlebars.SafeString(value || fallback);
});

Handlebars.registerHelper('ogl5e-sheet-add', (value: number, toAdd: number) => {
  return new Handlebars.SafeString(String(Number(value || 0) + Number(toAdd || 0)));
});

Handlebars.registerHelper('ogl5e-sheet-isEmpty', (input: object | Array<any> | Set<any>) => {
  if (!input) return true;
  if (input instanceof Array) return input.length < 1;
  if (input instanceof Set) return input.size < 1;
  return isEmpty(input);
});

const LEGACY_SYSTEM_FEATURES = {
  attributeConfig: true,
  skillConfig: true,
  profLabel: false,
  currencyLabel: true,
  currencyLabels: true,
  componentLabels: true,
  levelDropdown: true,
  subclasses: true,
};

export class OGL5eCharacterSheet extends dnd5e.applications.actor.CharacterActorSheet {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    classes: [...super.DEFAULT_OPTIONS.classes, 'dnd5e', 'sheet', 'actor', 'character', 'ogl5e-sheet'],
    position: {
      width: 830,
      height: 680,
    },
  });

  static PARTS = {
    sheet: {
      template: `modules/${MODULE_ID}/templates/character-sheet.hbs`,
      scrollable: ['.sheet-body', '.biography', '.spellbook', '.features'],
    },
  };

  static LIMITED_PARTS = {
    sheet: {
      template: `modules/${MODULE_ID}/templates/character-sheet-ltd.hbs`,
      scrollable: ['.sheet-body'],
    },
  };

  tabGroups = { primary: 'core' };

  get isLegacyLimited() {
    return !game.user.isGM && this.actor.limited && !game.settings.get(MODULE_ID, MySettings.expandedLimited);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    context.owner = this.actor.isOwner;
    context.editable = this.isEditable;
    context.cssClass = this.options.classes.join(' ');
    context.isCharacter = true;
    context.isVehicle = false;
    context.systemFeatures = LEGACY_SYSTEM_FEATURES;
    context.filters = { spellbook: new Set() };
    context.labels = {
      ...context.labels,
      currencies: Object.fromEntries(
        Object.entries(CONFIG.DND5E.currencies).map(([key, value]: [string, any]) => [
          key,
          value.abbreviation ?? value.label ?? key.toUpperCase(),
        ])
      ),
    };

    const enrichmentOptions = {
      secrets: this.actor.isOwner,
      rollData: context.rollData,
      async: true,
      relativeTo: this.actor,
    };

    if (this.isLegacyLimited) {
      context.disableExperience = true;
      context.biographyHTML = await TextEditor.enrichHTML(context.system.details.biography?.value ?? '', enrichmentOptions);
      context.appearance = await TextEditor.enrichHTML(context.system.details.appearance ?? '', enrichmentOptions);
      return context;
    }

    await this._prepareHeaderContext(context, options);
    await this._prepareDetailsContext(context, options);
    await this._prepareInventoryContext(context, options);
    const inventorySections = this._adaptSections(context.sections ?? [], context.itemContext ?? {});

    await this._prepareFeaturesContext(context, options);
    const featureSections = this._adaptSections(context.sections ?? [], context.itemContext ?? {});

    const rawSpellbook = Object.values(context.spellbook ?? {});
    await this._prepareSpellsContext(context, options);
    const spellbookSections = this._adaptSpellbook(rawSpellbook, context.itemContext ?? {});

    await this._prepareBiographyContext(context, options);
    await this._prepareSidebarContext(context, options);

    this._applyLegacyAbilities(context);
    this._applyLegacySkills(context);
    this._applyLegacyTraits(context);

    context.inventory = inventorySections;
    context.features = featureSections;
    context.spellbook = spellbookSections;
    context.classLabels = context.labels.class;
    context.disableExperience = !context.showExperience;
    context.backgroundDisplay = context.background?.name ?? this._stringValue(context.system.details.background);
    context.raceDisplay = context.species?.name ?? this._stringValue(context.system.details.race);
    context.movement = this._prepareLegacyMovement(context.system.attributes.movement);
    context.resources = this._prepareLegacyResources(context.system.resources);
    context.preparedSpells = this.actor.itemTypes.spell?.filter((item) => !!item.system.prepared).length ?? 0;
    context.biographyHTML = context.enriched?.value ?? '';
    context.system.attributes.spelldc = context.system.attributes.spell?.dc ?? context.system.attributes.spelldc;

    context.trait = await TextEditor.enrichHTML(context.system.details.trait ?? '', enrichmentOptions);
    context.ideal = await TextEditor.enrichHTML(context.system.details.ideal ?? '', enrichmentOptions);
    context.bond = await TextEditor.enrichHTML(context.system.details.bond ?? '', enrichmentOptions);
    context.flaw = await TextEditor.enrichHTML(context.system.details.flaw ?? '', enrichmentOptions);
    context.appearance = await TextEditor.enrichHTML(context.system.details.appearance ?? '', enrichmentOptions);

    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._activateLegacyTabs();
    this._activateLegacyControls();
    await this._injectActionsList();
  }

  _applyLegacyAbilities(context) {
    const abilities = this._prepareAbilities(context);
    for (const ability of abilities) {
      const value = context.editable ? ability.baseProf : ability.proficient;
      context.system.abilities[ability.key] = {
        ...context.system.abilities[ability.key],
        ...ability,
        baseProf: ability.baseProf ?? ability.proficient ?? 0,
        icon: this._legacyProficiencyIcon(value),
      };
    }
  }

  _applyLegacySkills(context) {
    const entries = Object.fromEntries(
      (context.skills ?? []).map((skill) => {
        const value = context.editable ? skill.baseValue : skill.value;
        return [
          skill.key,
          {
            ...context.system.skills?.[skill.key],
            ...skill,
            ability: CONFIG.DND5E.abilities[skill.baseAbility]?.abbreviation ?? skill.baseAbility,
            baseValue: skill.baseValue ?? skill.value ?? 0,
            icon: this._legacyProficiencyIcon(value),
            hover: skill.hover ?? '',
          },
        ];
      })
    );

    context.system.skills = entries;
  }

  _applyLegacyTraits(context) {
    const traitLabels = (key) => (context.traits?.[key] ?? []).map((entry) => entry.label ?? entry);
    const languageLabels = this._traitLabels(context.system.traits.languages, CONFIG.DND5E.languages);
    const simpleTraitLabels = (key, configPath) =>
      this._traitLabels(context.system.traits[key], foundry.utils.getProperty(CONFIG.DND5E, configPath) ?? {});

    context.senses = (context.senses ?? []).map((sense) => {
      if (typeof sense === 'string') return sense;
      return sense.value ? `${sense.label} ${sense.value}` : sense.label;
    });

    foundry.utils.setProperty(context, 'system.traits.languages.selected', languageLabels);
    foundry.utils.setProperty(context, 'system.traits.di.selected', traitLabels('di').length ? traitLabels('di') : simpleTraitLabels('di', 'damageTypes'));
    foundry.utils.setProperty(context, 'system.traits.dr.selected', traitLabels('dr').length ? traitLabels('dr') : simpleTraitLabels('dr', 'damageTypes'));
    foundry.utils.setProperty(context, 'system.traits.dv.selected', traitLabels('dv').length ? traitLabels('dv') : simpleTraitLabels('dv', 'damageTypes'));
    foundry.utils.setProperty(context, 'system.traits.ci.selected', traitLabels('ci').length ? traitLabels('ci') : simpleTraitLabels('ci', 'conditionTypes'));
    foundry.utils.setProperty(context, 'system.traits.weaponProf.selected', simpleTraitLabels('weaponProf', 'weaponProficiencies'));
    foundry.utils.setProperty(context, 'system.traits.armorProf.selected', simpleTraitLabels('armorProf', 'armorProficiencies'));
    foundry.utils.setProperty(context, 'system.traits.toolProf.selected', simpleTraitLabels('toolProf', 'toolIds'));
  }

  _traitLabels(trait, config) {
    const values = trait?.value instanceof Set ? Array.from(trait.value) : Array.isArray(trait?.value) ? trait.value : [];
    const labels = values.map((value) => config?.[value]?.label ?? config?.[value]?.abbreviation ?? value);
    if (trait?.custom) labels.push(...String(trait.custom).split(/[,;]+/).map((label) => label.trim()).filter(Boolean));
    return labels;
  }

  _prepareLegacyMovement(movement) {
    const entries = Object.entries(movement ?? {}).filter(([key, value]) => {
      return !['units', 'hover'].includes(key) && Number.isFinite(value) && value > 0;
    });
    const units = movement?.units ? ` ${movement.units}` : '';
    const [primaryKey, primaryValue] = entries[0] ?? ['walk', 0];
    const special = entries
      .slice(1)
      .map(([key, value]) => `${CONFIG.DND5E.movementTypes?.[key]?.label ?? key} ${value}${units}`)
      .join(', ');

    return {
      primary: `${primaryValue}${units}`,
      special,
      type: primaryKey,
    };
  }

  _prepareLegacyResources(resources) {
    return Object.entries(resources ?? {}).map(([name, resource]: [string, any]) => ({
      name,
      label: resource.label ?? '',
      placeholder: game.i18n.localize(`DND5E.Resource${name.titleCase?.() ?? name}`) || '',
      value: resource.value ?? '',
      max: resource.max ?? '',
      sr: !!resource.sr,
      lr: !!resource.lr,
    }));
  }

  _adaptSections(sections, itemContext) {
    return (sections ?? []).map((section) => ({
      ...section,
      items: (section.items ?? []).map((item) => this._decorateItem(item, itemContext)),
    }));
  }

  _adaptSpellbook(sections, itemContext) {
    return (sections ?? [])
      .sort((left: any, right: any) => (left.order ?? 0) - (right.order ?? 0))
      .map((section: any) => {
        const slotData = section.slot ? foundry.utils.getProperty(this.actor.system.spells, section.slot) : null;
        return {
          ...section,
          prop: section.slot,
          uses: slotData?.value ?? '',
          slots: slotData ? slotData.override ?? slotData.max ?? 0 : '',
          canCreate: this.isEditable,
          spells: (section.items ?? []).map((item) => this._decorateItem(item, itemContext)),
        };
      });
  }

  _decorateItem(item, itemContext) {
    const ctx = itemContext?.[item.id] ?? {};
    const activation = ctx.activation ?? item.labels?.activation ?? '';
    const toggle = ctx.preparation?.applicable ? ctx.preparation : ctx.equip?.applicable ? ctx.equip : null;

    return {
      _id: item.id,
      id: item.id,
      name: item.name,
      type: item.type,
      img: item.img,
      system: item.system,
      item,
      labels: {
        ...item.labels,
        activation,
        activationAbbrev: this._abbreviateActivation(activation),
      },
      hasUses: ctx.uses?.hasUses ?? item.hasLimitedUses,
      isOnCooldown: ctx.uses?.isOnCooldown ?? item.isOnCooldown,
      totalWeight: ctx.totalWeight,
      availableLevels: this._availableLevels(item),
      toggleClass: toggle?.cls ?? '',
      toggleTitle: toggle?.title ? game.i18n.localize(toggle.title) : '',
      toggleType: ctx.preparation?.applicable ? 'prepared' : ctx.equip?.applicable ? 'equipped' : null,
    };
  }

  _availableLevels(item) {
    if (item.type !== 'class') return [];
    return Array.fromRange(CONFIG.DND5E.maxLevel, 1).map((level) => ({
      delta: level - item.system.levels,
      level,
      disabled: false,
    }));
  }

  _abbreviateActivation(label) {
    if (!label) return '';
    return String(label)
      .split(' ')
      .map((part, index) => {
        if (index === 0) return part;
        return part.slice(0, 1);
      })
      .join(' ');
  }

  _legacyProficiencyIcon(value) {
    switch (Number(value)) {
      case 2:
        return '<i class="fas fa-check-double"></i>';
      case 1:
        return '<i class="fas fa-check"></i>';
      case 0.5:
        return '<i class="fas fa-adjust"></i>';
      default:
        return '<i class="far fa-circle"></i>';
    }
  }

  _stringValue(value) {
    if (typeof value === 'string') return value;
    if (value?.name) return value.name;
    return '';
  }

  _activateLegacyTabs() {
    const root = this.element;
    if (!root) return;

    const activateTab = (tabId) => {
      this.tabGroups.primary = tabId;
      root.querySelectorAll('.sheet-navigation [data-tab]').forEach((navItem) => {
        navItem.classList.toggle('active', navItem.dataset.tab === tabId);
      });
      root.querySelectorAll('.sheet-body > .tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
      });
    };

    const initialTab = this.tabGroups.primary ?? 'core';
    activateTab(initialTab);

    root.querySelectorAll('.sheet-navigation [data-tab]').forEach((navItem) => {
      navItem.addEventListener('click', (event) => {
        event.preventDefault();
        activateTab(navItem.dataset.tab);
      });
    });
  }

  _activateLegacyControls() {
    const root = this.element;
    if (!root) return;

    root.querySelectorAll('.item-quantity input').forEach((input: HTMLInputElement) => {
      input.addEventListener('change', async (event) => {
        const itemId = input.closest('[data-item-id]')?.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;
        await item.update({ 'system.quantity': Number(input.value || 0) });
      });
    });

    root.querySelectorAll('.item-uses input').forEach((input: HTMLInputElement) => {
      input.addEventListener('change', async () => {
        const itemId = input.closest('[data-item-id]')?.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;
        await item.update({ 'system.uses.value': Number(input.value || 0) });
      });
    });

    root.querySelectorAll('.item-control.item-create').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        const type = button.dataset.type ?? button.closest('[data-type]')?.dataset.type ?? 'loot';
        await Item.implementation.createDialog({ type }, { parent: this.actor });
      });
    });

    root.querySelectorAll('.item-control.item-edit').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const itemId = button.closest('[data-item-id]')?.dataset.itemId;
        const item = this.actor.items.get(itemId);
        item?.sheet?.render(true);
      });
    });

    root.querySelectorAll('.item-control.item-delete').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        const itemId = button.closest('[data-item-id]')?.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;
        if (typeof item.deleteDialog === 'function') return item.deleteDialog();
        await item.delete();
      });
    });

    root.querySelectorAll('.item-control.item-toggle').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        const itemId = button.closest('[data-item-id]')?.dataset.itemId;
        const item = this.actor.items.get(itemId);
        const toggleType = button.closest('[data-item-id]')?.querySelector('[data-toggle-type]')?.dataset.toggleType
          || button.dataset.toggleType
          || button.closest('.item')?.dataset.toggleType;
        if (!item) return;

        if (toggleType === 'prepared' || item.type === 'spell') {
          await item.update({ 'system.prepared': !item.system.prepared });
          return;
        }

        if ('equipped' in item.system) {
          await item.update({ 'system.equipped': !item.system.equipped });
        }
      });
    });

    root.querySelectorAll('.item-recharge').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        const itemId = button.closest('[data-item-id]')?.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;
        if (typeof item.rollRecharge === 'function') return item.rollRecharge({ event });
        if (typeof item.use === 'function') return item.use({ event }, { legacy: false, options: { sheet: this } });
      });
    });

    root.querySelectorAll('.level-selector').forEach((select: HTMLSelectElement) => {
      select.addEventListener('change', async () => {
        const itemId = select.closest('[data-item-id]')?.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;
        const delta = Number(select.value || 0);
        if (!delta) return;
        await item.update({ 'system.levels': Math.max(1, Number(item.system.levels || 1) + delta) });
      });
    });
  }

  async _injectActionsList() {
    const actionsListApi = game.modules.get('character-actions-list-5e')?.api;
    const container = this.element?.querySelector('.actions');
    if (!container || !actionsListApi) return;

    try {
      container.innerHTML = await actionsListApi.renderActionsList(this.actor);
    } catch (error) {
      log(true, error);
    }
  }
}

Hooks.once('init', async function () {
  log(true, `Initializing ${MODULE_ID}`);
  registerSettings();
  await preloadTemplates();
});

Hooks.once('setup', function () {
  const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;
  DocumentSheetConfig.registerSheet(Actor, 'dnd5e', OGL5eCharacterSheet, {
    label: 'OGL Character Sheet',
    types: ['character'],
    makeDefault: false,
  });
});

Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});
