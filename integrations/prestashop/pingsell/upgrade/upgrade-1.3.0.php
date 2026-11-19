<?php
/**
 * NOTICE OF LICENSE
 *
 * This source file is subject to the Academic Free License version 3.0
 * that is bundled with this package in the file LICENSE.
 * It is also available through the world-wide-web at this URL:
 * https://opensource.org/licenses/AFL-3.0
 *
 * DISCLAIMER
 *
 * Do not edit or add to this file if you wish to upgrade this module to newer
 * versions in the future. If you wish to customize this module for your
 * needs please refer to the module documentation (docs/README.md).
 *
 * @author    Pingsell
 * @copyright Since 2024 Pingsell
 * @license   https://opensource.org/licenses/AFL-3.0 Academic Free License version 3.0
 */
if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * 1.3.0: « Connect to Pingsell » button, visitor tracking off by default on new installs.
 * A merchant who already uses tracking keeps it: the switch is never turned off by this upgrade.
 *
 * @param Pingsell $module
 *
 * @return bool
 */
function upgrade_module_1_3_0($module)
{
    // Module files of 1.2 without a stored value treated tracking as on: keep it on.
    if (Configuration::get('PINGSELL_TRACKING') === false) {
        Configuration::updateValue('PINGSELL_TRACKING', 1);
    }
    // The cached script settings changed format.
    Configuration::deleteByName('PINGSELL_INBOUND');

    return $module->registerHook('displayHeader') && $module->registerHook('displayFooterBefore');
}
