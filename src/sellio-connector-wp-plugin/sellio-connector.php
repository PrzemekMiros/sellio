<?php
/**
 * Plugin Name: Sellio Connector
 * Description: Bezpieczny konektor WooCommerce z panelem Sellio.
 * Version: 1.0.0
 * Requires at least: 6.4
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * WC requires at least: 8.0
 * WC tested up to: 10.4
 * Text Domain: sellio-connector
 */
defined( 'ABSPATH' ) || exit;
define( 'SELLIO_CONNECTOR_VERSION', '1.0.0' );
define( 'SELLIO_CONNECTOR_FILE', __FILE__ );
define( 'SELLIO_CONNECTOR_DIR', plugin_dir_path( __FILE__ ) );

foreach ( array( 'class-settings', 'class-crypto', 'class-outbox', 'class-serializer', 'class-client', 'class-queue', 'class-rest-api', 'class-admin', 'class-plugin' ) as $file ) {
	require_once SELLIO_CONNECTOR_DIR . 'includes/' . $file . '.php';
}
register_activation_hook( __FILE__, array( 'Sellio\\Connector\\Plugin', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'Sellio\\Connector\\Plugin', 'deactivate' ) );
add_action( 'before_woocommerce_init', static function () {
	if ( class_exists( '\\Automattic\\WooCommerce\\Utilities\\FeaturesUtil' ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', SELLIO_CONNECTOR_FILE, true );
	}
} );
add_action( 'plugins_loaded', array( 'Sellio\\Connector\\Plugin', 'init' ) );
