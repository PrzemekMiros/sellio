<?php
namespace Sellio\Connector;
defined( 'ABSPATH' ) || exit;
final class Plugin {
	public static function activate() { Outbox::install(); if ( function_exists( 'as_schedule_recurring_action' ) && ! as_next_scheduled_action( 'sellio_connector_recover', array(), Queue::GROUP ) ) { as_schedule_recurring_action( time() + 300, 300, 'sellio_connector_recover', array(), Queue::GROUP ); } }
	public static function deactivate() { if ( function_exists( 'as_unschedule_all_actions' ) ) { as_unschedule_all_actions( 'sellio_connector_process', array(), Queue::GROUP ); as_unschedule_all_actions( 'sellio_connector_recover', array(), Queue::GROUP ); } }
	public static function init() { if ( ! class_exists( 'WooCommerce' ) ) { add_action( 'admin_notices', static function () { if ( current_user_can( 'activate_plugins' ) ) { echo '<div class="notice notice-error"><p>Sellio Connector wymaga aktywnego WooCommerce.</p></div>'; } } ); return; } Queue::init(); Rest_API::init(); Admin::init(); }
}
