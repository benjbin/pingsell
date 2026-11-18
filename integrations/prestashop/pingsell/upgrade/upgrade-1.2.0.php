<?php
/**
 * 1.2.0 — site tracking: the Pingsell script on every page (switch « Suivi des visites »).
 */
if (!defined('_PS_VERSION_')) {
    exit;
}

function upgrade_module_1_2_0($module)
{
    Configuration::updateValue('PINGSELL_TRACKING', 1);
    return $module->registerHook('displayHeader');
}
