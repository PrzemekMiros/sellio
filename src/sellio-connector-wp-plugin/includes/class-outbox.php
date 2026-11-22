<?php
namespace Sellio\Connector;
defined( 'ABSPATH' ) || exit;
final class Outbox {
	public static function table() { global $wpdb; return $wpdb->prefix . 'sellio_outbox'; }
	public static function install() { global $wpdb; require_once ABSPATH . 'wp-admin/includes/upgrade.php'; dbDelta( 'CREATE TABLE ' . self::table() . " (id bigint unsigned NOT NULL AUTO_INCREMENT,event_id char(36) NOT NULL,order_id bigint unsigned NOT NULL,event_type varchar(32) NOT NULL,payload longtext NOT NULL,status varchar(16) NOT NULL DEFAULT 'pending',attempts smallint unsigned NOT NULL DEFAULT 0,next_attempt datetime NULL,last_error varchar(255) NULL,created_at datetime NOT NULL,updated_at datetime NOT NULL,PRIMARY KEY (id),UNIQUE KEY event_id (event_id),KEY work (status,next_attempt),KEY order_id (order_id)) " . $wpdb->get_charset_collate() . ';' ); }
	public static function create( $order, $type ) { global $wpdb; $event = wp_generate_uuid4(); $payload = Serializer::event( $order, $type, $event ); $now = current_time( 'mysql', true ); $wpdb->insert( self::table(), array( 'event_id' => $event, 'order_id' => $order->get_id(), 'event_type' => $type, 'payload' => wp_json_encode( $payload ), 'created_at' => $now, 'updated_at' => $now ) ); return $event; }
	public static function get( $id ) { global $wpdb; return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE id=%d', $id ) ); }
	public static function pending_count( $failed = false ) { global $wpdb; return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::table() . ' WHERE status=%s', $failed ? 'failed' : 'pending' ) ); }
	public static function due( $limit = 25 ) { global $wpdb; return $wpdb->get_col( $wpdb->prepare( "SELECT id FROM " . self::table() . " WHERE status='pending' AND (next_attempt IS NULL OR next_attempt <= UTC_TIMESTAMP()) ORDER BY id ASC LIMIT %d", $limit ) ); }
	public static function lock( $id ) { global $wpdb; return 1 === $wpdb->query( $wpdb->prepare( "UPDATE " . self::table() . " SET status='processing',updated_at=UTC_TIMESTAMP() WHERE id=%d AND status='pending'", $id ) ); }
	public static function update( $id, $data ) { global $wpdb; $data['updated_at'] = current_time( 'mysql', true ); $wpdb->update( self::table(), $data, array( 'id' => $id ) ); }
	public static function cancel_pending() { global $wpdb; $wpdb->query( "UPDATE " . self::table() . " SET status='cancelled',updated_at=UTC_TIMESTAMP() WHERE status IN ('pending','processing')" ); }
}
