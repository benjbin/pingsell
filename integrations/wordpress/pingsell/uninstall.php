<?php
/**
 * Removes everything Pingsell stored when the plugin is deleted from the admin.
 *
 * @package Pingsell
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('pingsell_settings');
delete_option('pingsell_connect_state');
delete_option('pingsell_version');
delete_transient('pingsell_inbound');
delete_transient('pingsell_inbound_failed');

// Per-user notices and per-IP capture counters (short-lived transients with a variable name).
global $wpdb;
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-time cleanup on uninstall, no API lists transients by prefix.
$wpdb->query(
    $wpdb->prepare(
        "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s OR option_name LIKE %s OR option_name LIKE %s",
        $wpdb->esc_like('_transient_pingsell_') . '%',
        $wpdb->esc_like('_transient_timeout_pingsell_') . '%',
        $wpdb->esc_like('_site_transient_pingsell_') . '%',
        $wpdb->esc_like('_site_transient_timeout_pingsell_') . '%'
    )
);

// Pending background sends.
if (function_exists('as_unschedule_all_actions')) {
    as_unschedule_all_actions('', array(), 'pingsell');
}
