<?php
namespace Sellio\Connector;
defined( 'ABSPATH' ) || exit;
final class Settings {
	const OPTION = 'sellio_connector_settings';
	public static function all() { return wp_parse_args( get_option( self::OPTION, array() ), array( 'api_base_url' => '', 'store_id' => '', 'token' => '', 'automatic' => 1, 'verified_at' => '', 'last_success_at' => '', 'last_error' => '', 'catalog_hash' => '', 'catalog_created' => '' ) ); }
	public static function save( $input ) {
		$old = self::all(); $next = $old;
		foreach ( array( 'api_base_url', 'store_id' ) as $field ) { if ( isset( $input[ $field ] ) ) { $next[ $field ] = $field === 'api_base_url' ? esc_url_raw( trim( $input[ $field ] ) ) : sanitize_text_field( $input[ $field ] ); } }
		$next['automatic'] = empty( $input['automatic'] ) ? 0 : 1;
		if ( ! empty( $input['token'] ) ) { $next['token'] = Crypto::encrypt( trim( $input['token'] ) ); }
		if ( $next['api_base_url'] !== $old['api_base_url'] || $next['store_id'] !== $old['store_id'] || ! empty( $input['token'] ) ) { $next['verified_at'] = ''; }
		update_option( self::OPTION, $next, false ); return $next;
	}
	public static function token() { $s = self::all(); if ( defined( 'SELLIO_CONNECTOR_API_TOKEN' ) ) { return (string) SELLIO_CONNECTOR_API_TOKEN; } return empty( $s['token'] ) ? '' : Crypto::decrypt( $s['token'] ); }
	public static function configured() { $s = self::all(); return $s['api_base_url'] && $s['store_id'] && self::token(); }
	public static function connection_status() { $s = self::all(); return ! self::configured() ? 'incomplete' : ( $s['verified_at'] ? 'connected' : 'unverified' ); }
	public static function disconnect() { update_option( self::OPTION, array( 'automatic' => 0, 'last_error' => '' ), false ); delete_option( 'sellio_connector_catalog_token_hash' ); delete_option( 'sellio_connector_catalog_token_created' ); }
}
