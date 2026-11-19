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
 * 1.2.0: site tracking (Pingsell script on every page). Since 1.3.0 tracking is an explicit choice of the
 * merchant: a shop coming from an older version, which never used it, keeps it off.
 *
 * @param Pingsell $module
 *
 * @return bool
 */
function upgrade_module_1_2_0($module)
{
    if (Configuration::get('PINGSELL_TRACKING') === false) {
        Configuration::updateValue('PINGSELL_TRACKING', 0);
    }

    return $module->registerHook('displayHeader');
}
